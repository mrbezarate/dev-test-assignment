import type { Booking, Master, Service } from './types.ts';
import { now } from './clock.ts';
import {
  TZ_OFFSET,
  almatyDate,
  almatyMinutes,
  fromMinutes,
  overlaps,
  toMinutes,
  weekday,
  type Range,
} from './time.ts';

export const SLOT_STEP_MIN = 15;
const CLEANUP_MIN = 7;

// Свободные слоты мастера на дату, 'HH:mm' по Алматы
export function getSlots(
  master: Master,
  service: Service,
  date: string,
  bookings: Booking[],
  at: Date = now(),
): string[] {
  const day = master.schedule[weekday(date)];
  if (!day) return [];

  const today = almatyDate(at);
  if (date < today) return [];

  const nowMin = date === today ? almatyMinutes(at) : -1;
  const breaks: Range[] = day.breaks.map((b) => ({
    start: toMinutes(b.from),
    end: toMinutes(b.to),
  }));

  const busy: Range[] = [];
  for (const booking of bookings) {
    if (booking.masterId !== master.id || booking.status !== 'active') continue;
    const range = localRange(booking, date);
    if (!range) continue;
    // После записи мастеру нужно 7 минут на уборку
    busy.push({ start: range.start, end: range.end + CLEANUP_MIN });
  }

  const result: string[] = [];
  const end = toMinutes(day.to);
  for (let t = toMinutes(day.from); t + service.durationMin <= end; t += SLOT_STEP_MIN) {
    if (t <= nowMin) continue;

    const slot = { start: t, end: t + service.durationMin };
    if (breaks.some((b) => overlaps(slot, b))) continue;
    if (busy.some((b) => overlaps(slot, b))) continue;

    result.push(fromMinutes(t));
  }
  return result;
}

function localRange(booking: Booking, date: string): Range | null {
  const dayStart = new Date(`${date}T00:00:00${TZ_OFFSET}`).getTime();
  const start = (new Date(booking.start).getTime() - dayStart) / 60000;
  const end = (new Date(booking.end).getTime() - dayStart) / 60000;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end <= 0 || start >= 24 * 60) return null;
  return { start, end };
}
