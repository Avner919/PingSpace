import {Pool,neonConfig} from '@neondatabase/serverless';
import WebSocket from 'ws';
neonConfig.webSocketConstructor=WebSocket;
import { randomBytes,randomUUID,createHash,scrypt,timingSafeEqual } from 'node:crypto';
import {promisify} from 'node:util';
import {ApiError,normalizeEmail,passwordRecord,publicUser} from './store.mjs';
import {makeBooking,cancelBooking,dayList} from '../src/booking.mjs';
const derive=promisify(scrypt);
const tokenHash=t=>createHash('sha256').update(t).digest('hex');
export async function createPostgresStore({connectionString=process.env.DATABASE_URL,now=()=>new Date()}={}) {
 if(!connectionString)throw Error('DATABASE_URL is required');
 const pool=new Pool({connectionString,max:3,connectionTimeoutMillis:15000,idleTimeoutMillis:10000});
 pool.on('error',e=>console.error('Postgres connection:',e.code||'unavailable'));
 async function tx(fn){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(918734)');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 try{await tx(c=>c.query(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('player','admin')),salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL);
 CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),data JSONB NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id); CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id);`));}catch(e){await pool.end();throw e;}
 const all=async(c=pool)=>(await c.query('SELECT data FROM bookings')).rows.map(r=>r.data);
 return {
 async sessionUser(token){if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;return publicUser((await pool.query('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2',[tokenHash(token),now().getTime()])).rows[0]);},
 async createSession(user){const token=randomBytes(32).toString('base64url');await pool.query('DELETE FROM sessions WHERE expires_at<=$1',[now().getTime()]);await pool.query('INSERT INTO sessions VALUES($1,$2,$3)',[tokenHash(token),user.id,now().getTime()+30*86400000]);return token;},
 async logout(token){if(token)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(token)]);},
 async register(email,password){email=normalizeEmail(email);const {salt,hash}=await passwordRecord(password);const id=randomUUID();try{await pool.query('INSERT INTO users VALUES($1,$2,$3,$4,$5,$6)',[id,email,'player',salt,hash,now().toISOString()]);}catch(e){if(e.code==='23505')throw new ApiError(409,'Такой аккаунт уже зарегистрирован. Войдите с паролем.');throw e;}return {id,email,role:'player'};},
 async login(email,password,adminOnly=false){email=normalizeEmail(email);if(typeof password!=='string'||password.length>128)throw new ApiError(401,'Неверный e-mail или пароль.');const row=(await pool.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];const hash=await derive(password,row?.salt??'invalid-account-salt',64,{N:32768,r:8,p:1,maxmem:64*1024*1024});const expected=row?Buffer.from(row.password_hash,'hex'):Buffer.alloc(64);if(!row||!timingSafeEqual(hash,expected)||(adminOnly&&row.role!=='admin'))throw new ApiError(401,'Неверный e-mail или пароль.');return publicUser(row);},
 async setAdministrator(email,password){email=normalizeEmail(email);const {salt,hash}=await passwordRecord(password);return tx(async c=>{const old=(await c.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];const id=old?.id??randomUUID();await c.query("INSERT INTO users VALUES($1,$2,'admin',$3,$4,$5) ON CONFLICT(email) DO UPDATE SET role='admin',salt=excluded.salt,password_hash=excluded.password_hash",[id,email,salt,hash,now().toISOString()]);await c.query('DELETE FROM sessions WHERE user_id=$1',[id]);return{id,email,role:'admin'};});},
 async state(user){const bookings=await all();return{user,availability:bookings.filter(b=>b.status==='active'&&Date.parse(b.endAt)>now().getTime()).map(b=>({tables:b.tables,startAt:b.startAt,endAt:b.endAt,status:'active'})),bookings:user?bookings.filter(b=>user.role==='admin'||b.userId===user.id):[],users:user?.role==='admin'?(await pool.query('SELECT id,email,role FROM users')).rows:[]};},
 async book(user,input){if(!user)throw new ApiError(401,'Войдите в аккаунт.');if(!dayList(now()).some(d=>d.key===input.date))throw new ApiError(400,'Выберите дату в доступном календаре.');return tx(async c=>{let b;try{b=makeBooking({actor:user,date:input.date,tables:input.tables,start:input.start,duration:input.duration,bookings:await all(c),now:now()});}catch(e){throw new ApiError(409,e.message);}await c.query('INSERT INTO bookings VALUES($1,$2,$3)',[b.id,user.id,JSON.stringify(b)]);return b;});},
 async cancel(user,id){if(!user)throw new ApiError(401,'Войдите в аккаунт.');return tx(async c=>{const row=(await c.query('SELECT data FROM bookings WHERE id=$1',[id])).rows[0];if(!row)throw new ApiError(404,'Бронирование не найдено.');const b=row.data;if(user.role!=='admin'&&b.userId!==user.id)throw new ApiError(403,'Эта бронь принадлежит другому пользователю.');let changed;try{changed={...cancelBooking(b,user,now()),cancelledByRole:user.role};}catch(e){throw new ApiError(409,e.message);}await c.query('UPDATE bookings SET data=$1 WHERE id=$2',[JSON.stringify(changed),id]);return changed;});},
 close:()=>pool.end()
 };
}
