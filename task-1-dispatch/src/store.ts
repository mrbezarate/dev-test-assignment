import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Assignment, Branch, Order } from './types.ts';
import { almatyDate } from './time.ts';

const dataDir = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data');

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;
}

export const branches: Branch[] = load('branches.json');
export const orders: Order[] = load('orders.json');

// orderId -> распределение
export const assignments = new Map<string, Assignment>();

// Сколько заказов уже закреплено за филиалом на дату по Алматы
export function getLoad(branchId: string, date: string): number {
  let count = 0;
  for (const assignment of assignments.values()) {
    if (assignment.branchId !== branchId) continue;
    const order = orders.find((o) => o.id === assignment.orderId);
    if (order && almatyDate(order.createdAt) === date) count++;
  }
  return count;
}
