import {createPostgresStore} from '../server/postgres-store.mjs';
import {Pool,neonConfig} from '@neondatabase/serverless';
import WebSocket from 'ws';
neonConfig.webSocketConstructor=WebSocket;
import assert from 'node:assert/strict';
import {databaseUrl} from '../server/runtime-store.mjs';
process.env.DATABASE_URL=await databaseUrl();
const a=await createPostgresStore();const b=await createPostgresStore();const ids=[];
try{
 const password='Temporary contract password '+crypto.randomUUID();
 const email='qa-'+crypto.randomUUID()+'@example.test';
 const user=await a.register(email,password);ids.push(user.id);
 assert.equal((await b.login(email,password)).id,user.id);
 const session=await a.createSession(user);assert.equal((await b.sessionUser(session)).id,user.id);
 const {dayList}=await import('../src/booking.mjs');const input={date:dayList()[1].key,tables:[1,2],start:600,duration:90};
 const booking=await a.book(user,input);assert.equal(booking.price,2100);
 assert.equal((await b.state(user)).bookings[0].id,booking.id);
 await assert.rejects(()=>b.book(user,input));
 await b.cancel(user,booking.id);assert.equal((await a.state(user)).bookings[0].status,'cancelled');
 await a.logout(session);assert.equal(await b.sessionUser(session),null);
 console.log('Postgres contract passed: cross-instance accounts, sessions, grouped booking, conflict and cancellation.');
}finally{const pool=new Pool({connectionString:process.env.DATABASE_URL});for(const id of ids){await pool.query('DELETE FROM bookings WHERE user_id=$1',[id]);await pool.query('DELETE FROM users WHERE id=$1',[id]);}await pool.end();await a.close();await b.close();}
