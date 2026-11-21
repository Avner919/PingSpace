import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, ChevronLeft, ChevronRight, MapPin, Clock3, Check, CheckCircle2, CalendarDays, CircleDot, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog';
import { LOCATION, DURATIONS, dayList, dateKey, timeLabel, slots, isAvailable, priceFor, money, durationLabel, intervalLabel, bookingDateLabel, canCancel, startInstant, bookingTables, tablesLabel } from './booking.mjs';
import { getState, register, signIn, signOut, createBooking, removeBooking } from './auth.mjs';

function Court({ variant = 0 }) {
  return <svg viewBox="0 0 420 240" role="img" aria-label="Иллюстрация стола для настольного тенниса">
    <rect width="420" height="240" fill={['#0014cd', '#161616', '#450023'][variant]} />
    <path d="M0 180L420 80V240H0Z" fill="white" opacity=".2" />
    <path d="M50 210L335 137M6 157L282 91M106 240L389 164" stroke="white" strokeWidth="2" opacity=".5" />
    <path d="M114 123V190M303 89V156M192 161V214M355 119V181" stroke="#080808" strokeWidth="9" />
    <path d="M75 113L249 64L365 118L190 168Z" fill="#0014cd" stroke="white" strokeWidth="3" />
    <path d="M132 140L305 91M163 88L277 143" stroke="white" strokeWidth="2" />
    <path className="court-net" d="M162 89V59L277 113V143Z" fill="#00054c" fillOpacity=".65" stroke="white" strokeWidth="2" />
    <path d="M162 67L277 121M162 74L277 128M162 81L277 135M185 70V100M208 81V111M231 91V121M254 102V132" stroke="white" strokeWidth=".8" opacity=".55" />
  </svg>;
}
function errorText(error) { return error.message; }
const periods = [{ id: 'all', label: 'Весь день', from: 0, to: 1440 }, { id: 'night', label: 'Ночь', from: 0, to: 360 }, { id: 'morning', label: 'Утро', from: 360, to: 720 }, { id: 'day', label: 'День', from: 720, to: 1080 }, { id: 'evening', label: 'Вечер', from: 1080, to: 1440 }];

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [actor, setActor] = useState(null);
  const [users, setUsers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const syncRef = useRef(0);
  const mutationRef = useRef(false);
  const [tables, setTables] = useState([1]);
  const [date, setDate] = useState(() => dateKey());
  const [week, setWeek] = useState(0);
  const [duration, setDuration] = useState(60);
  const [start, setStart] = useState(null);
  const [period, setPeriod] = useState('all');
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const [history, setHistory] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminDate, setAdminDate] = useState('');
  const [adminStatus, setAdminStatus] = useState('all');
  const [cancelId, setCancelId] = useState(null);
  const [authMode, setAuthMode] = useState(null);
  const [afterAuth, setAfterAuth] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const days = dayList(now);
  const selectedDay = days.find(d => d.key === date);
  const price = tables.length ? priceFor(duration, tables.length) : 0;
  const chosenPeriod = periods.find(p => p.id === period);
  const available = ready ? slots({ date, tables, duration, bookings: availability, now }).filter(m => m >= chosenPeriod.from && m < chosenPeriod.to) : [];
  const validSelection = ready && !busy && start !== null && isAvailable({ date, tables, start, duration, bookings: availability, now });
  const mine = bookings.filter(b => b.userId === actor?.id).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const adminBookings = bookings.filter(b => {
    if (adminStatus !== 'all' && b.status !== adminStatus) return false;
    if (!adminDate) return true;
    const at = startInstant(adminDate, 0);
    return Date.parse(b.startAt) < at + 86400000 && Date.parse(b.endAt) > at;
  }).sort((a, b) => a.startAt.localeCompare(b.startAt));

  function applyState(data) {
    setActor(data.user); setUsers(data.users); setBookings(data.bookings); setAvailability(data.availability); setReady(true); setNetworkError(''); setNow(new Date());
  }
  async function refresh() {
    if (mutationRef.current) return;
    const version = ++syncRef.current;
    try { const data = await getState(); if (version === syncRef.current) applyState(data); }
    catch (e) { if (version === syncRef.current) { setNetworkError(errorText(e)); setReady(false); } }
  }
  function beginAction() {
    if (mutationRef.current) return false;
    mutationRef.current = true; ++syncRef.current; setBusy(true); return true;
  }
  function endAction() { mutationRef.current = false; setBusy(false); }
  async function recoverState() { try { applyState(await getState()); } catch (e) { setReady(false); setNetworkError(errorText(e)); } }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { ++syncRef.current; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => {
    if (!dayList(now).some(d => d.key === date)) { setDate(dateKey(now)); setStart(null); setWeek(0); }
  }, [now, date]);
  function reset(fn) { fn(); setStart(null); setError(''); }
  function openAuth(mode = 'login', next = null) {
    setError(''); setEmail(''); setPassword(''); setAfterAuth(next); setAuthMode(mode);
  }
  async function authenticate(event) {
    event.preventDefault();
    if (!beginAction()) return;
    try {
      const data = authMode === 'register' ? await register(email, password) : await signIn(email, password, authMode === 'admin');
      applyState(data); setAuthMode(null); setPassword(''); setError('');
      if (afterAuth === 'review') setReview(true);
      if (afterAuth === 'history') setHistory(true);
      if (data.user.role === 'admin') setAdminOpen(true);
      setAfterAuth(null);
    } catch (e) { setError(errorText(e)); }
    finally { endAction(); }
  }
  async function logout() {
    if (!beginAction()) return;
    try {
      applyState(await signOut()); setReview(false); setHistory(false); setAdminOpen(false); setCancelId(null); setError('');
    } catch (e) { setError(errorText(e)); }
    finally { endAction(); }
  }
  async function confirm(event) {
    event.preventDefault();
    if (!beginAction()) return;
    try {
      const data = await createBooking({ date, tables, start, duration, expectedUserId: actor?.id });
      applyState(data); setConfirmed(data.booking); setReview(false); setStart(null); setError('');
    } catch (e) { setError(errorText(e)); await recoverState(); }
    finally { endAction(); }
  }
  async function cancel(id) {
    if (!beginAction()) return;
    try { applyState(await removeBooking(id, actor?.id)); setCancelId(null); setError(''); }
    catch (e) { setError(errorText(e)); await recoverState(); }
    finally { endAction(); }
  }
  function showHistory() { setError(''); setCancelId(null); actor ? setHistory(true) : openAuth('login', 'history'); }
  function renderBooking(b, adminView = false) {
    const cancellable = canCancel(b, actor, now);
    const ended = Date.parse(b.endAt) <= now.getTime();
    const ongoing = Date.parse(b.startAt) <= now.getTime() && !ended;
    return <article className="history-item" key={b.id}>
      <div className="history-heading"><strong>{tablesLabel(bookingTables(b))}</strong><span className={'booking-status ' + b.status}>{b.status === 'cancelled' ? 'Отменена' : ended ? 'Завершена' : ongoing ? 'Идёт игра' : 'Предстоит'}</span></div>
      <span>{bookingDateLabel(b)} · {intervalLabel(b.date, b.start, b.duration)}</span>
      <span>{durationLabel(b.duration)} · {money(b.price)} · Оплата в клубе</span>
      {bookingTables(b).length > 1 && <span>{money(b.pricePerTable)} за стол × {bookingTables(b).length} · отмена всех столов вместе</span>}
      {adminView && <span className="booking-owner">Игрок: {users.find(u => u.id === b.userId)?.email || 'Аккаунт недоступен'}</span>}
      <small>Бронь № {b.id.slice(0, 8).toUpperCase()}</small>
      {b.status === 'cancelled' ? <span className="cancel-note">Отменена {b.cancelledByRole === 'admin' ? 'администратором' : 'игроком'}. Время освобождено.</span> : cancelId === b.id ? <div className="cancel-actions"><span>{bookingTables(b).length > 1 ? 'Отменить бронь всех выбранных столов?' : 'Отменить эту бронь?'}</span><Button size="sm" disabled={busy} onClick={() => cancel(b.id)}>Да, отменить</Button><Button size="sm" variant="ghost" onClick={() => setCancelId(null)}>Оставить</Button></div> : <>
        <Button size="sm" variant="outline" disabled={busy || !cancellable} onClick={() => { setCancelId(b.id); setError(''); }}>Отменить бронь</Button>
        {!cancellable && <span className="cancel-note">{ended || ongoing ? 'Время отмены истекло.' : 'До начала меньше часа — отмена недоступна.'}</span>}
      </>}
    </article>;
  }

  return <>
    <header className="header">
      <a className="logo" href="/" aria-label="PingSpace — главная"><span className="logo-mark">p<span /></span>ping<span>space</span></a>
      <span className="header-label">Место для вашей игры.</span>
      <div className="header-actions">
        {actor?.role === 'admin' && <Button variant="outline" onClick={() => { setError(''); setAdminOpen(true); }}><ShieldCheck size={16} />Управление</Button>}
        <Button variant="outline" disabled={!ready || busy} onClick={showHistory}>Мои брони <ArrowUpRight size={16} /></Button>
        {actor ? <Button variant="ghost" aria-label="Выйти из аккаунта" title={actor.email} disabled={busy} onClick={logout}><LogOut size={16} /><span className="logout-label">Выйти</span></Button> : <Button variant="outline" disabled={!ready || busy} onClick={() => openAuth('login')}>Войти</Button>}
      </div>
    </header>
    <div className="brand-banner">МОСКВА · ТРИ СТОЛА · ИГРАЙТЕ КРУГЛОСУТОЧНО</div>
    <main>
      <section className="intro">
        <div><div className="eyebrow"><span /> ВРЕМЯ ДЛЯ ИГРЫ</div><h1>Ваша игра<br />начинается здесь<span>.</span></h1><p>Выберите один или несколько столов и удобное время.<br />Ракетки, мячи и хорошая компания — начало отличной партии.</p></div>
        <div className="hero-art"><img className="hero-photo" src="/images/pingspace-high-five.png" alt="Ребёнок и взрослый дают друг другу пять у стола для настольного тенниса" width="1340" height="1174" fetchPriority="high" /></div>
      </section>
      <section className="booking-section" aria-label="Бронирование столов">
        <div className="section-top"><h2>Забронировать столы</h2><span className="demo-badge"><CircleDot size={13} />Прототип · аккаунты и брони хранятся на сервере</span></div>
        {actor && <div className="account-strip"><span>{actor.role === 'admin' ? 'Администратор' : 'Вы вошли'}: <strong>{actor.email}</strong></span></div>}
        <div className="network-notice" role="status">{networkError || (!ready ? 'Загружаем общее расписание…' : 'Аккаунт и ваши брони доступны из любого браузера.')}</div>
        <div className="booking-layout">
          <div className="booking-main">
            <section className="step">
              <h3><span className="step-number">01</span>Выберите столы</h3>
              <div className="venue-strip"><MapPin size={16} /><span>{LOCATION.city}, {LOCATION.address}</span><span>Открыто 24/7</span></div>
              <div className="table-selection-actions"><span>Можно выбрать от 1 до 3 столов на одно время.</span><Button variant="ghost" size="sm" onClick={() => reset(() => setTables(tables.length === 3 ? [] : [1, 2, 3]))}>{tables.length === 3 ? 'Снять выбор' : 'Выбрать все столы'}</Button></div>
              <div className="locations">{[1, 2, 3].map((t, i) => <button key={t} className={'location-card ' + (tables.includes(t) ? 'selected' : '')} onClick={() => reset(() => setTables(tables.includes(t) ? tables.filter(selected => selected !== t) : [...tables, t].sort((a, b) => a - b)))} aria-pressed={tables.includes(t)} aria-label={'Выбрать стол 0' + t}>
                <div className="location-image"><Court variant={i} /><span className="location-tag">Круглосуточно</span>{tables.includes(t) && <span className="selected-check"><Check size={14} /></span>}</div>
                <div className="location-info"><strong>Стол 0{t}</strong><span>Ракетки и мячи включены</span><div><small>Первый час</small><b>{money(800)}<small> / час</small></b></div></div>
              </button>)}</div>
            </section>
            <section className="step date-step">
              <div className="step-title"><h3><span className="step-number">02</span>Выберите дату</h3><span>{selectedDay?.full}</span></div>
              <div className="date-row">
                <Button size="icon" variant="ghost" aria-label="Предыдущая неделя" disabled={week === 0} onClick={() => setWeek(0)}><ChevronLeft size={18} /></Button>
                <div className="days">{days.slice(week * 7, week * 7 + 7).map(d => <button key={d.key} aria-pressed={date === d.key} className={'day ' + (date === d.key ? 'active' : '')} onClick={() => reset(() => setDate(d.key))}><span>{d.key === days[0].key ? 'Сегодня' : d.label}</span><strong>{d.day}</strong></button>)}</div>
                <Button size="icon" variant="ghost" aria-label="Следующая неделя" disabled={week === 1} onClick={() => setWeek(1)}><ChevronRight size={18} /></Button>
              </div>
              <div className="duration-row"><label htmlFor="duration">Длительность игры</label><select id="duration" value={duration} onChange={e => reset(() => setDuration(Number(e.target.value)))}>{DURATIONS.map(d => <option key={d} value={d}>{durationLabel(d)} · {money(priceFor(d, Math.max(1, tables.length)))}{tables.length > 1 ? ' за все столы' : ' за стол'}</option>)}</select></div>
              <p className="tariff-note">Тариф за каждый стол: первый час — 800 ₽, далее — 500 ₽/час. Неполный час — пропорционально.</p>
            </section>
            <section className="step time-step">
              <div className="step-title"><h3><span className="step-number">03</span>Выберите время</h3><span className="available-legend"><i />{tablesLabel(tables)} · общее свободное время</span></div>
              <p className="time-note">Время московское (МСК, UTC+3). Показано время, когда свободны все выбранные столы. Можно играть после полуночи.</p>
              <div className="period-tabs" aria-label="Часть суток">{periods.map(p => <button key={p.id} aria-pressed={period === p.id} className={period === p.id ? 'active' : ''} onClick={() => setPeriod(p.id)}>{p.label}</button>)}</div>
              <div className="time-slots" aria-label="Доступное время начала">{available.length ? available.map(m => <button key={m} className={start === m ? 'active' : ''} aria-pressed={start === m} onClick={() => { setStart(m); setError(''); }}>{timeLabel(m)}</button>) : <p>{!ready ? 'Расписание пока недоступно. Дождитесь связи с сервером.' : tables.length ? 'Нет общего свободного времени. Выберите другую дату, длительность или набор столов.' : 'Выберите хотя бы один стол в первом шаге.'}</p>}</div>
              {start !== null && start + duration >= 1440 && <p className="overnight-note">Окончание на следующий день: {timeLabel(start + duration)} МСК. Тариф не меняется после полуночи.</p>}
            </section>
          </div>
          <aside className="summary">
            <div className="summary-top"><span>ВАША СЛЕДУЮЩАЯ ИГРА</span><ArrowUpRight size={20} /></div>
            <h3>Хорошая партия<br />уже близко.</h3><p>Осталось выбрать время.</p>
            <div className="summary-location"><MapPin size={19} /><div><strong>{LOCATION.name}</strong><span>{LOCATION.address} · открыто 24/7</span></div></div>
            <div className="summary-line"><CalendarDays size={17} /><span>{selectedDay?.full}</span></div>
            <div className="summary-line"><Clock3 size={17} /><span>{start !== null ? intervalLabel(date, start, duration) : 'Выберите начало'} · {durationLabel(duration)}</span></div>
            <div className="summary-line"><span className="mini-table" /><span>{tablesLabel(tables)} · московское время</span></div>
            <div className="price-row"><span>{tables.length > 1 ? `${money(priceFor(duration))} × ${tables.length} стола` : 'Аренда стола'}</span><strong>{money(price)}</strong></div>
            <div className="total-row"><span>Итого</span><strong>{money(price)}</strong></div>
            <Button className="reserve-button" disabled={!validSelection} onClick={() => { setError(''); actor ? setReview(true) : openAuth('login', 'review'); }}>{actor ? 'Проверить бронь' : 'Войти и забронировать'}<ArrowRight size={17} /></Button>
            <p className="summary-fine"><Check size={13} />Оплата в клубе · ракетки и мячи включены</p>
            <p className="summary-demo">Демо: реальные столы не резервируются. Отмена — не позднее чем за час до начала.</p>
            {error && !authMode && !review && !history && !adminOpen && <p className="error" role="alert">{error}</p>}
          </aside>
        </div>
      </section>
      <footer><span className="footer-logo">ping<strong>space.</strong></span><span>Москва · 24/7</span><Button variant="ghost" className="admin-entry" onClick={() => openAuth('admin')}><ShieldCheck size={14} />Вход администратора</Button></footer>
    </main>

    <Dialog open={!!authMode} onOpenChange={open => { if (!open) { setAuthMode(null); setError(''); setAfterAuth(null); } }}>
      <DialogContent className="dialog-content">
        <div className="eyebrow">АККАУНТ PINGSPACE</div>
        <DialogTitle className="modal-title">{authMode === 'admin' ? 'Вход администратора' : authMode === 'register' ? 'Начнём игру?' : 'С возвращением.'}</DialogTitle>
        <DialogDescription className="modal-description">{authMode === 'admin' ? 'Введите e-mail и пароль администратора.' : 'Введите e-mail и пароль. Аккаунт сохранится на сервере и будет доступен из другого браузера.'}</DialogDescription>
        {authMode !== 'admin' && <div className="auth-tabs"><Button variant={authMode === 'login' ? 'default' : 'outline'} onClick={() => { setAuthMode('login'); setError(''); }}>Войти</Button><Button variant={authMode === 'register' ? 'default' : 'outline'} onClick={() => { setAuthMode('register'); setError(''); }}>Регистрация</Button></div>}
        <form className="auth-form" onSubmit={authenticate}>
          <label htmlFor="account-email">E-mail</label><input id="account-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} />
          <label htmlFor="account-password">Пароль</label><input id="account-password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={10} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} />
          <small>От 10 до 128 символов.</small>
          {error && <p className="error" role="alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Подождите…' : authMode === 'admin' ? 'Войти как администратор' : authMode === 'register' ? 'Зарегистрироваться' : 'Войти в аккаунт'}<ArrowRight size={16} /></Button>
        </form>
        <p className="demo-auth-note">Раньше входили без пароля? Один раз зарегистрируйте аккаунт с паролем. Письма и восстановление пароля пока не настроены.</p>
      </DialogContent>
    </Dialog>

    <Dialog open={review} onOpenChange={setReview}><DialogContent className="dialog-content">
      <div className="eyebrow">ПЕРЕД НАЧАЛОМ</div><DialogTitle className="modal-title">Всё готово к игре?</DialogTitle><DialogDescription className="modal-description">Проверьте время и стоимость. Оплата в клубе; онлайн-списания не будет.</DialogDescription>
      <div className="review"><strong>{LOCATION.name} · {tablesLabel(tables)}</strong><span>{LOCATION.city}, {LOCATION.address}</span><span>{selectedDay?.full}</span><span>{start !== null && intervalLabel(date, start, duration)} МСК · {durationLabel(duration)}</span><span>{actor?.email}</span><span>{tables.length} × {money(priceFor(duration))} за стол</span><b>Итого: {money(price)}</b><small>Отмена всей брони вместе — не позднее чем за 1 час до начала.</small></div>
      {error && <p className="error" role="alert">{error}</p>}
      <form onSubmit={confirm}><Button type="submit" className="w-full" disabled={!validSelection || !actor}>Подтвердить бронь<ArrowRight size={16} /></Button></form>
    </DialogContent></Dialog>

    <Dialog open={!!confirmed} onOpenChange={open => { if (!open) setConfirmed(null); }}><DialogContent className="dialog-content">
      <CheckCircle2 size={45} className="success-icon" /><DialogTitle className="modal-title">{confirmed && bookingTables(confirmed).length > 1 ? 'Столы ждут вас.' : 'Стол ждёт вас.'}</DialogTitle><DialogDescription className="modal-description">Бронь сохранена на сервере и доступна после входа из другого браузера. Настоящее бронирование в клубе не создаётся.</DialogDescription>
      {confirmed && <div className="review"><strong>{LOCATION.name} · {tablesLabel(bookingTables(confirmed))}</strong><span>{LOCATION.city}, {LOCATION.address}</span><span>{bookingDateLabel(confirmed)}</span><span>{intervalLabel(confirmed.date, confirmed.start, confirmed.duration)} МСК</span><b>{money(confirmed.price)} · оплата в клубе</b><small>Бронь № {confirmed.id.slice(0, 8).toUpperCase()}</small></div>}
      <Button className="w-full" onClick={() => { setConfirmed(null); showHistory(); }}>Мои бронирования<ArrowRight size={16} /></Button>
    </DialogContent></Dialog>

    <Dialog open={history && !!actor} onOpenChange={setHistory}><DialogContent className="dialog-content">
      <DialogTitle className="modal-title">Ваше время играть.</DialogTitle><DialogDescription className="modal-description">Бронирования аккаунта {actor?.email}. Отмена доступна не позднее чем за час до начала, по московскому времени.</DialogDescription>
      <div className="booking-history">{mine.length ? mine.map(b => renderBooking(b)) : <p>У вас пока нет бронирований. Выберите столы и время для первой игры.</p>}</div>
      {error && <p className="error" role="alert">{error}</p>}
    </DialogContent></Dialog>

    <Dialog open={adminOpen && actor?.role === 'admin'} onOpenChange={setAdminOpen}><DialogContent className="dialog-content admin-dialog">
      <div className="eyebrow">АДМИНИСТРАТОР</div><DialogTitle className="modal-title">Управление бронями</DialogTitle><DialogDescription className="modal-description">Москва · 3 стола · 24/7. Общие брони локации. Для администратора действует тот же предел отмены — за час до начала.</DialogDescription>
      <div className="admin-filters"><label>Дата игры<input aria-label="Дата игры" type="date" value={adminDate} onChange={e => setAdminDate(e.target.value)} /></label><label>Статус<select aria-label="Статус брони" value={adminStatus} onChange={e => setAdminStatus(e.target.value)}><option value="all">Все</option><option value="active">Активные</option><option value="cancelled">Отменённые</option></select></label>{adminDate && <Button variant="ghost" onClick={() => setAdminDate('')}>Все даты</Button>}</div>
      <div className="booking-history admin-list">{adminBookings.length ? adminBookings.map(b => renderBooking(b, true)) : <p>Бронирований с такими условиями нет.</p>}</div>
      {error && <p className="error" role="alert">{error}</p>}
    </DialogContent></Dialog>
  </>;
}
