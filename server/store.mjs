import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { makeBooking, cancelBooking, dayList } from '../src/booking.mjs';

const derive = promisify(scrypt);
const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashToken = token => createHash('sha256').update(token).digest('hex');
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Введите корректный e-mail.');
  return email;
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw new ApiError(400, 'Пароль должен содержать от 10 до 128 символов.');
}
export const publicUser = row => row ? { id: row.id, email: row.email, role: row.role } : null;
export async function passwordRecord(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 64, scryptOptions)).toString('hex');
  return { salt, hash };
}

export function createStore({ dbPath, now = () => new Date() }) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('player','admin')), salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id);`);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const allBookings = () => db.prepare('SELECT data FROM bookings').all().map(row => JSON.parse(row.data));
  function sessionUser(token) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return publicUser(db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(token), now().getTime()));
  }
  function createSession(user) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now().getTime());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token), user.id, now().getTime() + 30 * 86400000);
    return token;
  }
  async function register(email, password) {
    email = normalizeEmail(email);
    const { salt, hash } = await passwordRecord(password);
    const id = randomUUID();
    try { db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, email, 'player', salt, hash, now().toISOString()); }
    catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new ApiError(409, 'Такой аккаунт уже зарегистрирован. Войдите с паролем.');
      throw error;
    }
    return { id, email, role: 'player' };
  }
  async function login(email, password, adminOnly = false) {
    email = normalizeEmail(email);
    if (typeof password !== 'string' || password.length > 128) throw new ApiError(401, 'Неверный e-mail или пароль.');
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const hash = await derive(password, row?.salt ?? 'invalid-account-salt', 64, scryptOptions);
    const expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
    if (!row || !timingSafeEqual(hash, expected) || (adminOnly && row.role !== 'admin')) throw new ApiError(401, 'Неверный e-mail или пароль.');
    return publicUser(row);
  }
  async function setAdministrator(email, password) {
    email = normalizeEmail(email);
    const { salt, hash } = await passwordRecord(password);
    return transaction(() => {
      const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const id = existing?.id ?? randomUUID();
      db.prepare(`INSERT INTO users VALUES (?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET role='admin', salt=excluded.salt, password_hash=excluded.password_hash`).run(id, email, 'admin', salt, hash, now().toISOString());
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      return { id, email, role: 'admin' };
    });
  }
  function state(user) {
    const all = allBookings();
    const cutoff = now().getTime();
    return {
      user,
      availability: all.filter(b => b.status === 'active' && Date.parse(b.endAt) > cutoff).map(b => ({ tables: b.tables, startAt: b.startAt, endAt: b.endAt, status: 'active' })),
      bookings: user ? all.filter(b => user.role === 'admin' || b.userId === user.id) : [],
      users: user?.role === 'admin' ? db.prepare('SELECT id,email,role FROM users').all() : [],
    };
  }
  function book(user, input) {
    if (!user) throw new ApiError(401, 'Войдите в аккаунт.');
    if (!dayList(now()).some(d => d.key === input.date)) throw new ApiError(400, 'Выберите дату в доступном календаре.');
    return transaction(() => {
      let booking;
      try { booking = makeBooking({ actor: user, date: input.date, tables: input.tables, start: input.start, duration: input.duration, bookings: allBookings(), now: now() }); }
      catch (error) { throw new ApiError(409, error.message); }
      db.prepare('INSERT INTO bookings VALUES (?,?,?)').run(booking.id, user.id, JSON.stringify(booking));
      return booking;
    });
  }
  function cancel(user, id) {
    if (!user) throw new ApiError(401, 'Войдите в аккаунт.');
    return transaction(() => {
      const row = db.prepare('SELECT data FROM bookings WHERE id=?').get(id);
      if (!row) throw new ApiError(404, 'Бронирование не найдено.');
      const booking = JSON.parse(row.data);
      if (user.role !== 'admin' && booking.userId !== user.id) throw new ApiError(403, 'Эта бронь принадлежит другому пользователю.');
      let updated;
      try { updated = { ...cancelBooking(booking, user, now()), cancelledByRole: user.role }; }
      catch (error) { throw new ApiError(409, error.message); }
      db.prepare('UPDATE bookings SET data=? WHERE id=?').run(JSON.stringify(updated), id);
      return updated;
    });
  }
  return { register, login, setAdministrator, sessionUser, createSession, state, book, cancel,
    logout: token => { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)); },
    close: () => db.close(),
  };
}
