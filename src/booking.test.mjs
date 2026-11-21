import test from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, dateKey, dayList, startInstant, timeLabel, isAvailable, slots, makeBooking, canCancel, cancelBooking, readBookings, STORAGE_KEY, bookingTables, normalizeTables } from './booking.mjs';
const now = new Date('2030-01-01T09:00:00Z');
const alice = { id: 'alice', email: 'alice@example.test', role: 'player' };
const bob = { id: 'bob', email: 'bob@example.test', role: 'player' };
const admin = { id: 'demo-admin', role: 'admin' };
const base = { date: '2030-01-02', table: 1, start: 600, duration: 60, now };
const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
const booked = (options = {}) => makeBooking({ ...base, actor: alice, bookings: [], ...options });

test('all eight durations use the confirmed stepped and prorated tariff', () => {
  assert.deepEqual([30,60,90,120,150,180,210,240].map(d => priceFor(d)), [400,800,1050,1300,1550,1800,2050,2300]);
  for (const d of [0,45,270,60.5]) assert.throws(() => priceFor(d));
});
test('days are based on Moscow midnight regardless of execution timezone', () => {
  const instant = new Date('2030-01-31T22:30:00Z');
  assert.equal(dateKey(instant), '2030-02-01');
  const days = dayList(instant);
  assert.equal(days[0].key, '2030-02-01');
  assert.equal(days.length, 14);
  assert.equal(startInstant('2030-02-01', 0), Date.parse('2030-01-31T21:00:00Z'));
  assert.equal(timeLabel(1500), '01:00');
});
test('24-hour slots include midnight and 23:30 for a four-hour booking', () => {
  const result = slots({ ...base, duration: 240 });
  assert.equal(result.length,48); assert.equal(result[0],0); assert.equal(result.at(-1),1410);
});
test('past starts, invalid dates, tables and unaligned minutes are rejected', () => {
  assert.equal(isAvailable({ ...base, now: new Date('2030-01-02T07:00:00Z') }),false);
  for (const options of [{table:0},{table:4},{start:605},{start:1440},{start:-30},{duration:45},{date:'2030-02-30'}]) assert.equal(isAvailable({...base,...options}),false);
});
test('overnight reservation blocks intervals on both calendar days', () => {
  const booking = booked({ start:1410, duration:120 });
  assert.equal(booking.endAt,'2030-01-02T22:30:00.000Z');
  assert.equal(isAvailable({ ...base,start:1320,duration:120,bookings:[booking] }),false);
  assert.equal(isAvailable({ ...base,date:'2030-01-03',start:0,duration:60,bookings:[booking] }),false);
  assert.equal(isAvailable({ ...base,date:'2030-01-03',start:90,duration:60,bookings:[booking] }),true);
  assert.equal(isAvailable({ ...base,date:'2030-01-03',table:2,start:0,duration:60,bookings:[booking] }),true);
});
test('adjacent reservations are allowed; cancelled reservations release availability', () => {
  const booking = booked();
  assert.equal(isAvailable({...base,start:630,bookings:[booking]}),false);
  assert.equal(isAvailable({...base,start:660,bookings:[booking]}),true);
  assert.equal(isAvailable({...base,start:570,duration:30,bookings:[booking]}),true);
  const cancelled = cancelBooking(booking,alice,now);
  assert.equal(isAvailable({...base,bookings:[cancelled]}),true);
});
test('owner and administrator may cancel at exactly 60 minutes, not 59:59', () => {
  const booking = booked();
  const boundary = new Date(Date.parse(booking.startAt)-3600000);
  for (const actor of [alice,admin]) {
    assert.equal(canCancel(booking,actor,boundary),true);
    assert.equal(canCancel(booking,actor,new Date(boundary.getTime()+1)),false);
    assert.throws(()=>cancelBooking(booking,actor,new Date(boundary.getTime()+1)));
  }
  assert.equal(canCancel(booking,bob,boundary),false);
  assert.equal(canCancel(booking,null,boundary),false);
});
test('cancellation retains identity, price and audit information', () => {
  const booking = booked(); const changed = cancelBooking(booking,admin,now);
  assert.equal(changed.id,booking.id);assert.equal(changed.price,800);assert.equal(changed.userId,'alice');
  assert.equal(changed.status,'cancelled');assert.equal(changed.cancelledBy,'demo-admin');assert.equal(changed.cancelledAt,now.toISOString());
  assert.equal(canCancel(changed,admin,now),false);
});
test('booking requires an account and fixes duration and price on creation', () => {
  assert.throws(()=>makeBooking({...base,bookings:[]}));
  const b=booked({duration:90}); assert.equal(b.price,1050);assert.equal(b.userId,'alice');assert.equal(b.locationId,'moscow');
  assert.equal(Date.parse(b.endAt)-Date.parse(b.startAt),90*60000);
});
test('storage filters malformed rows and preserves valid active and cancelled bookings', () => {
  const storage=memory(); const b=booked();const c=cancelBooking(booked({table:2}),alice,now);
  storage.setItem(STORAGE_KEY,JSON.stringify([null,{},b,c,{...b,tables:[9]},{...b,endAt:'bad'}]));
  assert.equal(readBookings(storage).length,2);
  assert.deepEqual(readBookings({getItem(){throw Error('blocked')}}),[]);
  assert.deepEqual(readBookings({getItem(){return '{bad'}}),[]);
});
test('multi-table pricing sums the per-table tariff', () => {
  assert.equal(priceFor(90,2),2100);
  assert.equal(priceFor(240,3),6900);
  for (const count of [0,4,1.5]) assert.throws(()=>priceFor(60,count));
});
test('selected tables must be nonempty, unique and valid', () => {
  assert.deepEqual(normalizeTables([3,1]),[1,3]);
  for (const tables of [[],[1,1],[0],[4],[1,2,3,4],['1']]) {
    assert.equal(isAvailable({...base,tables}),false);
    assert.throws(()=>booked({tables}));
  }
});
test('joint availability is the intersection; one busy table rejects the entire group', () => {
  const existing=booked({table:2});
  const bookings=[existing];
  assert.equal(isAvailable({...base,tables:[1,3],bookings}),true);
  assert.equal(isAvailable({...base,tables:[1,2],bookings}),false);
  assert.throws(()=>booked({tables:[1,2,3],bookings}));
  assert.deepEqual(bookings,[existing]);
  assert.ok(!slots({...base,tables:[1,2],bookings}).includes(600));
});
test('one multi-table record blocks each chosen table overnight and cancels as a whole', () => {
  const group=booked({tables:[3,1],start:1410,duration:90});
  assert.deepEqual(group.tables,[1,3]);assert.equal(group.price,2100);assert.equal(group.pricePerTable,1050);
  for (const table of [1,3]) assert.equal(isAvailable({...base,date:'2030-01-03',start:0,table,bookings:[group]}),false);
  assert.equal(isAvailable({...base,date:'2030-01-03',start:0,table:2,bookings:[group]}),true);
  const cancelled=cancelBooking(group,alice,now);
  for (const table of [1,3]) assert.equal(isAvailable({...base,date:'2030-01-03',start:0,table,bookings:[cancelled]}),true);
  assert.deepEqual(cancelled.tables,[1,3]);assert.equal(cancelled.id,group.id);
});
test('stored single-table records remain readable alongside new multi-table bookings', () => {
  const storage=memory();const original=booked();
  const {tables,pricePerTable,...rest}=original;
  const legacy={...rest,table:1};
  const group=booked({tables:[2,3]});
  storage.setItem(STORAGE_KEY,JSON.stringify([legacy,group]));
  const loaded=readBookings(storage);
  assert.equal(loaded.length,2);assert.deepEqual(bookingTables(loaded[0]),[1]);assert.equal(loaded[0].price,800);
  assert.deepEqual(loaded[1].tables,[2,3]);assert.equal(loaded[1].price,1600);
  assert.equal(isAvailable({...base,tables:[1,2],bookings:[legacy]}),false);
});
