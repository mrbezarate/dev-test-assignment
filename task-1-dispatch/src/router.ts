import type { Assignment, Branch, Order, Rule } from './types.ts';
import { distanceKm } from './geo.ts';
import { almatyDate } from './time.ts';

const MAX_DISTANCE_KM = 42;

type LoadFn = (branchId: string, date: string) => number;

export function assignBranch(order: Order, branches: Branch[], load: LoadFn = () => 0): Assignment {
  const own = branches.filter((b) => b.storeId === order.storeId && b.active);
  const date = almatyDate(order.createdAt);
  const isFull = (b: Branch) => load(b.id, date) >= b.dailyLimit;

  const withLimit = (branch: Branch, rule: Rule): Assignment => {
    if (!isFull(branch)) return { orderId: order.id, branchId: branch.id, rule };
    return fallback(order, own, isFull);
  };

  if (order.manualBranchId) {
    const manual = own.find((b) => b.id === order.manualBranchId);
    if (manual) return { orderId: order.id, branchId: manual.id, rule: 'manual' };
  }

  if (own.length === 1) return withLimit(own[0], 'single');

  if (order.pickupPointId) {
    const pickup = own.find((b) => b.pickupPointIds.includes(order.pickupPointId as string));
    if (pickup) return withLimit(pickup, 'pickup_point');
  }

  const city = own.filter((b) => b.city === order.city);
  if (city.length === 1) return withLimit(city[0], 'city');

  const nearest = pickNearest(order, own, own);
  if (!nearest) return unassigned(order);
  if (nearest.distance > MAX_DISTANCE_KM) return tooFar(order);
  if (isFull(nearest.branch)) return fallback(order, own, isFull);

  return { orderId: order.id, branchId: nearest.branch.id, rule: 'geo' };
}

function fallback(order: Order, own: Branch[], isFull: (b: Branch) => boolean): Assignment {
  const free = own.filter((b) => !isFull(b));
  const nearest = pickNearest(order, own, free);
  if (!nearest) return unassigned(order);
  if (nearest.distance > MAX_DISTANCE_KM) return tooFar(order);
  return { orderId: order.id, branchId: nearest.branch.id, rule: 'geo' };
}

function pickNearest(
  order: Order,
  all: Branch[],
  candidates: Branch[],
): { branch: Branch; distance: number } | null {
  if (order.lat === null || order.lon === null) return null;

  // Если в городе заказа несколько филиалов, сначала смотрим на них
  const city = all.filter((b) => b.city === order.city);
  const preferred = city.length > 1 ? candidates.filter((b) => b.city === order.city) : [];
  const pool = preferred.length > 0 ? preferred : candidates;

  let best: Branch | null = null;
  let bestDist = Infinity;
  for (const b of pool) {
    const d = distanceKm(order.lat, order.lon, b.lat, b.lon);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best ? { branch: best, distance: bestDist } : null;
}

function unassigned(order: Order): Assignment {
  return { orderId: order.id, branchId: null, rule: 'unassigned' };
}

function tooFar(order: Order): Assignment {
  return { orderId: order.id, branchId: null, rule: 'too_far' };
}
