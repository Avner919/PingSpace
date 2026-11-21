import { resolve } from 'node:path';
import { createStore, ApiError } from './store.mjs';
export const COOKIE_NAME = 'pingspace_session';
export function createApi({ dbPath = resolve(process.env.PINGSPACE_DATA_DIR || '.data', 'pingspace.sqlite'), now, store: suppliedStore, publicOrigin = process.env.PINGSPACE_PUBLIC_ORIGIN } = {}) {
  const store = suppliedStore || createStore({ dbPath, now });
  const limits = new Map();
  function cookie(req) {
    return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_NAME + '='))?.slice(COOKIE_NAME.length + 1);
  }
  function setCookie(req, res, token) {
    const secure = req.socket.encrypted || process.env.VERCEL === '1' || publicOrigin?.startsWith('https:');
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 30 * 86400 : 0}${secure ? '; Secure' : ''}`);
  }
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json') || req.headers['x-pingspace-client'] !== '1') throw new ApiError(403, 'Запрос отклонён. Обновите страницу.');
    const expected = publicOrigin || `${(req.socket.encrypted || process.env.VERCEL === '1') ? 'https' : 'http'}://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== expected) throw new ApiError(403, 'Источник запроса не разрешён.');
    if (req.body !== undefined) { const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || JSON.stringify(parsed).length > 16384) throw new ApiError(400, 'Некорректный запрос.'); return parsed; }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new ApiError(413, 'Слишком большой запрос.'); chunks.push(chunk); }
    try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(); return data; }
    catch { throw new ApiError(400, 'Некорректный запрос.'); }
  }
  function rateLimit(req, path) {
    const key = `${req.socket.remoteAddress}:${path}`;
    const time = Date.now(); const entry = limits.get(key);
    if (!entry || time >= entry.until) { if (limits.size > 1000) limits.clear(); limits.set(key, { attempts: 1, until: time + 15 * 60000 }); }
    else if (++entry.attempts > 20) throw new ApiError(429, 'Слишком много попыток. Попробуйте через 15 минут.');
  }
  async function handle(req, res) {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const token = cookie(req);
      const user = await store.sessionUser(token);
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, await store.state(user));
      if (req.method !== 'POST') throw new ApiError(404, 'Маршрут не найден.');
      const input = await body(req);
      if (path === '/api/register' || path === '/api/login') {
        rateLimit(req, path);
        const account = path === '/api/register' ? await store.register(input.email, input.password) : await store.login(input.email, input.password, input.admin === true);
        // Rotate this browser's old session after a successful login; other browsers remain signed in.
        await store.logout(token);
        setCookie(req, res, await store.createSession(account));
        return json(res, path === '/api/register' ? 201 : 200, await store.state(account));
      }
      if (path === '/api/logout') { await store.logout(token); setCookie(req, res, null); return json(res, 200, await store.state(null)); }
      if ((path === '/api/bookings' || path.endsWith('/cancel')) && user && input.expectedUserId && input.expectedUserId !== user.id) throw new ApiError(409, 'Аккаунт изменился. Обновите страницу и повторите действие.');
      if (path === '/api/bookings') {
        const booking = await store.book(user, input);
        return json(res, 201, { ...await store.state(user), booking });
      }
      const match = path.match(/^\/api\/bookings\/([a-z0-9-]+)\/cancel$/i);
      if (match) { const booking = await store.cancel(user, match[1]); return json(res, 200, { ...await store.state(user), booking }); }
      throw new ApiError(404, 'Маршрут не найден.');
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('PingSpace API:', error.message);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Ошибка сервера. Попробуйте ещё раз.' });
      else res.end();
    }
  }
  return { handle, close: store.close, store };
}
