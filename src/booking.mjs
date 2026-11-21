export const LOCATION = { id: 'moscow', name: 'PingSpace Москва', city: 'Москва', address: 'Тверская, 11', tables: 3, timezone: 'Europe/Moscow' };
export const STORAGE_KEY = 'pingspace-bookings-v2';
export const HORIZON_DAYS = 14; // Demonstration default; product horizon is not yet specified.
export const DURATIONS = Array.from({ length: 8 }, (_, i) => (i + 1) * 30);
const MINUTE = 60_000;
const moscowDate = new Intl.DateTimeFormat('en-CA', { timeZone: LOCATION.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

export function dateKey(date = new Date()) {
  const parts = Object.fromEntries(moscowDate.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function dayList(now = new Date()) {
  const today = dateKey(now);
  return Array.from({ length: HORIZON_DAYS }, (_, i) => {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return { key: d.toISOString().slice(0, 10), day: d.getUTCDate(), label: d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' }), full: d.toLocaleDateString('ru-RU', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) };
  });
}
export function timeLabel(minute) {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function startInstant(date, start) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(start) || start < 0 || start >= 1440 || start % 30) return NaN;
  const at = new Date(`${date}T${timeLabel(start)}:00+03:00`);
  return Number.isFinite(at.getTime()) && dateKey(at) === date ? at.getTime() : NaN;
}
export function normalizeTables(tables) {
  if (!Array.isArray(tables) || tables.length < 1 || tables.length > LOCATION.tables || new Set(tables).size !== tables.length || !tables.every(t => Number.isInteger(t) && t >= 1 && t <= LOCATION.tables)) return [];
  return [...tables].sort((a, b) => a - b);
}
export function bookingTables(booking) { return normalizeTables(booking.tables ?? [booking.table]); }
export function tablesLabel(tables) {
  if (!tables.length) return 'Столы не выбраны';
  return `${tables.length === 1 ? 'Стол' : 'Столы'} ${tables.map(t => String(t).padStart(2, '0')).join(', ')}`;
}
export function priceFor(duration, count = 1) {
  if (!DURATIONS.includes(duration)) throw new Error('Выберите длительность от 30 минут до 4 часов с шагом 30 минут.');
  if (!Number.isInteger(count) || count < 1 || count > LOCATION.tables) throw new Error('Выберите от одного до трёх столов.');
  return (800 * Math.min(duration, 60) / 60 + 500 * Math.max(duration - 60, 0) / 60) * count;
}
export const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
export const durationLabel = minutes => minutes % 60 ? (minutes > 60 ? `${Math.floor(minutes / 60)} ч 30 мин` : '30 мин') : `${minutes / 60} ч`;
export function intervalLabel(date, start, duration) {
  return `${timeLabel(start)} — ${timeLabel(start + duration)}${start + duration >= 1440 ? ' (+1 день)' : ''}`;
}
export function bookingDateLabel(booking) {
  return new Date(booking.startAt).toLocaleDateString('ru-RU', { timeZone: LOCATION.timezone, day: 'numeric', month: 'long', year: 'numeric' });
}
export function isAvailable({ date, table, tables, start, duration, bookings = [], now = new Date() }) {
  const selected = normalizeTables(tables ?? [table]);
  if (!selected.length || !DURATIONS.includes(duration)) return false;
  const at = startInstant(date, start);
  const until = at + duration * MINUTE;
  if (!Number.isFinite(at) || at <= new Date(now).getTime()) return false;
  return !bookings.some(b => b.status === 'active' && bookingTables(b).some(t => selected.includes(t)) && at < Date.parse(b.endAt) && until > Date.parse(b.startAt));
}
export function slots(options) {
  return Array.from({ length: 48 }, (_, i) => i * 30).filter(start => isAvailable({ ...options, start }));
}
export function makeBooking({ actor, date, table, tables, start, duration, bookings, now = new Date() }) {
  const selected = normalizeTables(tables ?? [table]);
  if (!actor?.id) throw new Error('Войдите в аккаунт, чтобы забронировать стол.');
  if (!selected.length) throw new Error('Выберите хотя бы один стол.');
  if (!isAvailable({ date, tables: selected, start, duration, bookings, now })) throw new Error('Это время уже недоступно. Выберите другой интервал.');
  const at = startInstant(date, start);
  return { id: crypto.randomUUID(), userId: actor.id, locationId: LOCATION.id, tables: selected, date, start, duration, startAt: new Date(at).toISOString(), endAt: new Date(at + duration * MINUTE).toISOString(), pricePerTable: priceFor(duration), price: priceFor(duration, selected.length), status: 'active', createdAt: new Date(now).toISOString() };
}
export function canCancel(booking, actor, now = new Date()) {
  return !!actor?.id && (actor.role === 'admin' || booking.userId === actor.id) && booking.status === 'active' && Date.parse(booking.startAt) - new Date(now).getTime() >= 60 * MINUTE;
}
export function cancelBooking(booking, actor, now = new Date()) {
  if (!canCancel(booking, actor, now)) throw new Error('Отмена недоступна: разрешена владельцу или администратору не позднее чем за час до начала.');
  return { ...booking, status: 'cancelled', cancelledAt: new Date(now).toISOString(), cancelledBy: actor.id };
}
export function readBookings(storage) {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(b => {
      if (!b || typeof b.id !== 'string' || typeof b.userId !== 'string' || b.locationId !== LOCATION.id || !['active', 'cancelled'].includes(b.status) || !bookingTables(b).length || !DURATIONS.includes(b.duration) || !Number.isFinite(b.price) || b.price < 0) return false;
      const start = startInstant(b.date, b.start);
      return Number.isFinite(start) && start === Date.parse(b.startAt) && Date.parse(b.endAt) === start + b.duration * MINUTE;
    }).map(b => ({ ...b, tables: bookingTables(b), pricePerTable: b.pricePerTable ?? b.price / bookingTables(b).length }));
  } catch { return []; }
}
