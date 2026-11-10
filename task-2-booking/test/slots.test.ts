import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSlots } from '../src/slots.ts';
import { overlaps, toMinutes } from '../src/time.ts';
import type { Booking, Master, Service } from '../src/types.ts';

const day = { from: '10:00', to: '13:00', breaks: [] };

const master: Master = {
  id: 'm-1',
  name: 'Тест',
  schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null },
};

const cut: Service = { id: 's-cut', name: 'Стрижка', durationMin: 60, masterIds: ['m-1'] };

const range = (from: string, to: string) => ({ start: toMinutes(from), end: toMinutes(to) });

const booking = (over: Partial<Booking>): Booking => ({
  id: 'bk-test',
  masterId: 'm-1',
  serviceId: 's-cut',
  start: '2030-11-18T05:30:00.000Z',
  end: '2030-11-18T06:00:00.000Z',
  clientPhone: '+77012345678',
  status: 'active',
  ...over,
});

test('overlaps: пересекающиеся интервалы', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('10:30', '11:30')), true);
});

test('overlaps: запись сразу после другой не пересекается', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('11:00', '12:00')), false);
});

test('getSlots: свободный день', () => {
  // 2030-11-18 — понедельник
  const slots = getSlots(master, cut, '2030-11-18', []);
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: выходной', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-23', []), []);
});

test('getSlots: слот не пересекает перерыв', () => {
  const breakDay = { from: '10:00', to: '13:00', breaks: [{ from: '11:00', to: '11:30' }] };
  const withBreak: Master = {
    ...master,
    schedule: { ...master.schedule, mon: breakDay },
  };
  assert.deepEqual(getSlots(withBreak, cut, '2030-11-18', []), [
    '10:00',
    '11:30',
    '11:45',
    '12:00',
  ]);
});

test('getSlots: занятое время не выдаётся, отменённые записи не мешают', () => {
  const brows: Service = { id: 's-brows', name: 'Брови', durationMin: 30, masterIds: ['m-1'] };
  const active = booking({});
  const cancelled = booking({
    id: 'bk-cancelled',
    start: '2030-11-18T07:00:00.000Z',
    end: '2030-11-18T07:30:00.000Z',
    status: 'cancelled',
  });

  const slots = getSlots(master, brows, '2030-11-18', [active, cancelled]);
  assert.ok(slots.includes('10:00'));
  assert.ok(!slots.includes('10:15'));
  assert.ok(!slots.includes('11:00')); // 7 минут на уборку после записи
  assert.ok(slots.includes('11:15'));
  assert.ok(slots.includes('12:00')); // отменённая запись не мешает
});

test('getSlots: прошедшее время не выдаётся', () => {
  const at = new Date('2030-11-18T11:00:00+05:00');
  const slots = getSlots(master, cut, '2030-11-18', [], at);
  assert.equal(slots[0], '11:15');
});
