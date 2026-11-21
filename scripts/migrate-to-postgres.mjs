import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {Pool,neonConfig} from '@neondatabase/serverless';
import WebSocket from 'ws';
import {databaseUrl} from '../server/runtime-store.mjs';
neonConfig.webSocketConstructor=WebSocket;
if(!existsSync('.data/pingspace.sqlite')){console.log('No local database to migrate.');process.exit(0);}
const local=new DatabaseSync('.data/pingspace.sqlite',{readOnly:true});const users=local.prepare('SELECT * FROM users').all();const bookings=local.prepare('SELECT * FROM bookings').all();local.close();
const pool=new Pool({connectionString:await databaseUrl()});const c=await pool.connect();
try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(918734)');
 for(const u of users){
   const existing=(await c.query('SELECT * FROM users WHERE id=$1 OR email=$2',[u.id,u.email])).rows;
   if(existing.length){
     const same=existing.length===1&&['id','email','role','salt','password_hash'].every(k=>existing[0][k]===u[k]);
     if(!same)throw Error('Account conflict: migration rolled back without changing existing accounts.');
   }else await c.query('INSERT INTO users VALUES($1,$2,$3,$4,$5,$6)',[u.id,u.email,u.role,u.salt,u.password_hash,u.created_at]);
 }
 for(const r of bookings){
   const existing=(await c.query('SELECT id FROM bookings WHERE id=$1',[r.id])).rows[0];
   if(existing)throw Error('Booking already exists: migration rolled back to preserve cloud booking state.');
   const data=typeof r.data==='string'?JSON.parse(r.data):r.data;
   if(data.status==='active'){
     const conflicts=await c.query("SELECT data FROM bookings WHERE data->>'status'='active'");
     if(conflicts.rows.some(({data:b})=>Date.parse(data.startAt)<Date.parse(b.endAt)&&Date.parse(data.endAt)>Date.parse(b.startAt)&&data.tables.some(t=>b.tables.includes(t))))throw Error('Booking time conflict: migration rolled back.');
   }
   await c.query('INSERT INTO bookings VALUES($1,$2,$3)',[r.id,r.user_id,JSON.stringify(data)]);
 }
 await c.query('COMMIT');console.log(`Migrated ${users.length} accounts and ${bookings.length} bookings; passwords preserved as hashes. Sessions were not copied.`);
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
