import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingError, cancelBooking, createBooking, normalizePhone } from '../src/booking.ts';

const phone = '8 (701) 234-56-78';

test('normalizePhone: казахстанские мобильные', () => {
  assert.equal(normalizePhone('+7 701 234 56 78'), '+77012345678');
  assert.equal(normalizePhone('87012345678'), '+77012345678');
  assert.equal(normalizePhone('8 (701) 234-56-78'), '+77012345678');
  assert.equal(normalizePhone('7012345678'), '+77012345678');
  assert.equal(normalizePhone('+7 727 123 45 67'), null);
  assert.equal(normalizePhone('12345'), null);
});

test('createBooking: создаёт запись и сохраняет телефон', async () => {
  const booking = await createBooking({
    masterId: 'm-2',
    serviceId: 's-cut',
    start: '2030-11-20T09:00:00+05:00',
    clientPhone: phone,
  });

  assert.match(booking.id, /^bk-\d+$/);
  assert.equal(booking.clientPhone, '+77012345678');
  assert.equal(booking.start, '2030-11-20T04:00:00.000Z');
  assert.equal(booking.end, '2030-11-20T05:00:00.000Z');
  assert.equal(booking.status, 'active');
});

test('createBooking: занятый слот не бронируется', async () => {
  await assert.rejects(
    () =>
      createBooking({
        masterId: 'm-1',
        serviceId: 's-cut',
        start: '2030-11-18T10:00:00+05:00',
        clientPhone: phone,
      }),
    (err) => err instanceof BookingError && err.code === 'slot_unavailable',
  );
});

test('createBooking: два клиента на один слот', async () => {
  const input = {
    masterId: 'm-1',
    serviceId: 's-cut',
    start: '2030-11-25T15:00:00+05:00',
    clientPhone: phone,
  };

  const results = await Promise.allSettled([createBooking(input), createBooking(input)]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');

  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.equal((failed[0] as PromiseRejectedResult).reason.code, 'slot_unavailable');
});

test('cancelBooking: отмена и повторная отмена', async () => {
  const booking = await createBooking({
    masterId: 'm-2',
    serviceId: 's-cut',
    start: '2030-11-27T09:00:00+05:00',
    clientPhone: phone,
  });

  const cancelled = await cancelBooking(booking.id);
  assert.equal(cancelled.status, 'cancelled');

  const again = await cancelBooking(booking.id);
  assert.equal(again.status, 'cancelled');
});

test('cancelBooking: меньше двух часов до начала', async () => {
  const booking = await createBooking({
    masterId: 'm-2',
    serviceId: 's-cut',
    start: '2030-12-04T09:00:00+05:00',
    clientPhone: phone,
  });

  const oldNow = process.env.NOW;
  process.env.NOW = '2030-12-04T08:00:00+05:00';
  try {
    await assert.rejects(
      () => cancelBooking(booking.id),
      (err) => err instanceof BookingError && err.code === 'too_late',
    );
  } finally {
    if (oldNow === undefined) delete process.env.NOW;
    else process.env.NOW = oldNow;
  }
});

test('cancelBooking: нет такой записи', async () => {
  await assert.rejects(
    () => cancelBooking('bk-404'),
    (err) => err instanceof BookingError && err.code === 'booking_not_found',
  );
});
