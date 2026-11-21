async function request(path, input) {
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...(input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PingSpace-Client': '1' }, body: JSON.stringify(input) }) });
  } catch { throw new Error('Нет связи с сервером. Проверьте, что сервер PingSpace запущен.'); }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('API недоступен. Перезапустите сервер командой npm run dev.'); }
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
export const getState = () => request('/api/state');
export const register = (email, password) => request('/api/register', { email, password });
export const signIn = (email, password, admin = false) => request('/api/login', { email, password, admin });
export const signOut = () => request('/api/logout', {});
export const createBooking = input => request('/api/bookings', input);
export const removeBooking = (id, expectedUserId) => request(`/api/bookings/${encodeURIComponent(id)}/cancel`, { expectedUserId });
