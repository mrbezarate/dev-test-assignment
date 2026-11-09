import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBranch } from '../src/router.ts';
import { distanceKm } from '../src/geo.ts';
import type { Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1',
  storeId: 's-1',
  name: 'Филиал',
  city: 'Алматы',
  lat: 43.24,
  lon: 76.91,
  active: true,
  pickupPointIds: [],
  dailyLimit: 100,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Алматы',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]);
  assert.notEqual(res.rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  const res = assignBranch(order({ city: 'Шымкент' }), [almaty]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('geo: выбирается ближайший филиал', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('geo: без координат заказ не распределяется', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.rule, 'unassigned');
});

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  const pickup = branch({ id: 'b-pick', city: 'Алматы', pickupPointIds: ['pp-1'] });
  const other = branch({ id: 'b-other', city: 'Алматы', lat: 43.3, lon: 76.8 });
  const res = assignBranch(order({ city: 'Конаев', pickupPointId: 'pp-1' }), [pickup, other]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-pick', rule: 'pickup_point' });
});

test('city: в городе заказа один филиал магазина', () => {
  const ala = branch({ id: 'b-ala', city: 'Алматы' });
  const ast = branch({ id: 'b-ast', city: 'Астана' });
  const res = assignBranch(order({ city: 'Алматы' }), [ala, ast]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'city' });
});

test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  const near = branch({ id: 'b-ast-near', city: 'Астана', lat: 43.2501, lon: 76.9201 });
  const ala1 = branch({ id: 'b-ala-1', city: 'Алматы', lat: 43.3, lon: 76.95 });
  const ala2 = branch({ id: 'b-ala-2', city: 'Алматы', lat: 43.35, lon: 77 });
  const res = assignBranch(order({ city: 'Алматы', lat: 43.25, lon: 76.92 }), [near, ala1, ala2]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala-1', rule: 'geo' });
});

test('лимит: заполненный филиал пропускается', () => {
  const ala = branch({ id: 'b-ala', city: 'Алматы', lat: 43.25, lon: 76.92, dailyLimit: 1 });
  const ast = branch({ id: 'b-ast', city: 'Астана', lat: 43.26, lon: 76.93, dailyLimit: 10 });
  const load = (id: string) => (id === 'b-ala' ? 1 : 0);
  const res = assignBranch(order({ city: 'Алматы' }), [ala, ast], load);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'geo' });
});

test('manual: лимит не проверяется', () => {
  const ala = branch({ id: 'b-ala', dailyLimit: 0 });
  const ast = branch({ id: 'b-ast', city: 'Астана' });
  const res = assignBranch(order({ manualBranchId: 'b-ala' }), [ala, ast], () => 999);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'manual' });
});

test('лимит: если свободных филиалов нет, заказ не распределяется', () => {
  const ala = branch({ id: 'b-ala', dailyLimit: 1 });
  const res = assignBranch(order({ city: 'Алматы' }), [ala], () => 1);
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('geo: филиал дальше 42 км не назначается', () => {
  const ala = branch({ id: 'b-ala', city: 'Алматы' });
  const ast = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });
  const res = assignBranch(order({ city: 'Конаев', lat: 40, lon: 70 }), [ala, ast]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'too_far' });
});
