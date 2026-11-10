import { now } from './clock.ts';
import { getSlots } from './slots.ts';
import { bookingRepo, masters, nextBookingId, services } from './store.ts';
import { almatyDate, almatyMinutes, fromMinutes } from './time.ts';
import type { Booking } from './types.ts';

export type BookingErrorCode =
  | 'bad_request'
  | 'bad_phone'
  | 'bad_start'
  | 'master_not_found'
  | 'service_not_found'
  | 'service_not_available'
  | 'booking_not_found'
  | 'slot_unavailable'
  | 'too_late';

export class BookingError extends Error {
  code: BookingErrorCode;

  constructor(code: BookingErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

const MOBILE_PREFIXES = new Set([
  '700',
  '701',
  '702',
  '705',
  '706',
  '707',
  '708',
  '747',
  '750',
  '751',
  '760',
  '761',
  '762',
  '763',
  '771',
  '775',
  '776',
  '777',
  '778',
]);

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('7')) digits = `7${digits}`;

  if (digits.length !== 11 || !digits.startsWith('7')) return null;
  if (!MOBILE_PREFIXES.has(digits.slice(1, 4))) return null;

  return `+${digits}`;
}

type CreateBookingInput = {
  masterId: unknown;
  serviceId: unknown;
  start: unknown;
  clientPhone: unknown;
};

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  if (typeof input.masterId !== 'string' || typeof input.serviceId !== 'string') {
    throw new BookingError('bad_request');
  }

  const master = masters.find((m) => m.id === input.masterId);
  if (!master) throw new BookingError('master_not_found');

  const service = services.find((s) => s.id === input.serviceId);
  if (!service) throw new BookingError('service_not_found');
  if (!service.masterIds.includes(master.id)) {
    throw new BookingError('service_not_available');
  }

  const start = parseStart(input.start);
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) {
    throw new BookingError('slot_unavailable');
  }

  const phone = normalizePhone(input.clientPhone);
  if (!phone) throw new BookingError('bad_phone');

  const date = almatyDate(start);

  return withLock(async () => {
    const bookings = await bookingRepo.listByMaster(master.id);
    const slots = getSlots(master, service, date, bookings);
    const hhmm = fromMinutes(almatyMinutes(start));
    if (!slots.includes(hhmm)) throw new BookingError('slot_unavailable');

    const booking: Booking = {
      id: nextBookingId(),
      masterId: master.id,
      serviceId: service.id,
      start: start.toISOString(),
      end: new Date(start.getTime() + service.durationMin * 60_000).toISOString(),
      clientPhone: phone,
      status: 'active',
    };
    await bookingRepo.insert(booking);
    return booking;
  });
}

export async function cancelBooking(id: string): Promise<Booking> {
  const booking = await bookingRepo.get(id);
  if (!booking) throw new BookingError('booking_not_found');
  if (booking.status === 'cancelled') return booking;

  const start = new Date(booking.start);
  if (start.getTime() - now().getTime() < 2 * 60 * 60 * 1000) {
    throw new BookingError('too_late');
  }

  await bookingRepo.update(id, { status: 'cancelled' });
  return { ...booking, status: 'cancelled' };
}

function parseStart(value: unknown): Date {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw new BookingError('bad_start');
  }
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) throw new BookingError('bad_start');
  return start;
}

let queue: Promise<void> = Promise.resolve();

// В памяти один процесс, поэтому проверку слота и вставку делаем по очереди
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
