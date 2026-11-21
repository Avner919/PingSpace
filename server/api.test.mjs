import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApi } from './api.mjs';
const password='Cross-browser test password 2026!';
const fixed=()=>new Date('2030-01-01T09:00:00Z');
async function host(t, options={}) {
  const api=createApi({dbPath:':memory:',now:fixed,...options});
  const server=createServer((req,res)=>void api.handle(req,res));
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const base=`http://127.0.0.1:${server.address().port}`;
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;await new Promise(r=>server.close(r));api.close();};
  t.after(close);
  return {api,base,close};
}
function browser(base, initialCookie='') {
  let cookie=initialCookie;
  return { get cookie(){return cookie;}, async request(path, input, headers={}) {
    const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(input===undefined?{}:{'Content-Type':'application/json','X-PingSpace-Client':'1',Origin:base}),...headers},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    return {status:response.status,headers:response.headers,data:await response.json()};
  }};
}
const booking={date:'2030-01-02',tables:[1,2],start:600,duration:90};

test('registration persists, password is hashed, and a second browser can sign in after server restart',async t=>{
  const prefix=join(tmpdir(),'pingspace-auth-test-');const dir=await mkdtemp(prefix);
  t.after(async()=>{if(!resolve(dir).startsWith(resolve(prefix)))throw Error('Unexpected temporary path');await rm(dir,{recursive:true,force:true});});
  const dbPath=join(dir,'accounts.sqlite');
  const first=await host(t,{dbPath});const a=browser(first.base);
  const registered=await a.request('/api/register',{email:' ALICE@example.test ',password});
  assert.equal(registered.status,201);assert.equal(registered.data.user.email,'alice@example.test');
  assert.equal(registered.data.user.role,'player');assert.equal(registered.data.user.password_hash,undefined);
  assert.match(registered.headers.get('set-cookie'),/HttpOnly/);assert.match(registered.headers.get('set-cookie'),/SameSite=Lax/);
  const created=await a.request('/api/bookings',booking);assert.equal(created.status,201);assert.equal(created.data.booking.price,2100);
  const id=registered.data.user.id;const savedCookie=a.cookie;
  await first.close();
  assert.equal((await readFile(dbPath)).includes(Buffer.from(password)),false);
  const second=await host(t,{dbPath});
  const oldSession=await browser(second.base,savedCookie).request('/api/state');assert.equal(oldSession.data.user.id,id);
  const b=browser(second.base);assert.equal((await b.request('/api/state')).data.user,null);
  const signed=await b.request('/api/login',{email:'alice@example.test',password});
  assert.equal(signed.status,200);assert.equal(signed.data.user.id,id);assert.equal(signed.data.bookings.length,1);
  assert.deepEqual(signed.data.bookings[0].tables,[1,2]);assert.notEqual(b.cookie,savedCookie);
  await second.close();
});
test('wrong passwords, unknown accounts, short passwords and duplicate email are rejected',async t=>{
  const h=await host(t);const a=browser(h.base);
  assert.equal((await a.request('/api/register',{email:'bad',password})).status,400);
  assert.equal((await a.request('/api/register',{email:'alice@example.test',password:'short'})).status,400);
  assert.equal((await a.request('/api/register',{email:'alice@example.test',password})).status,201);
  assert.equal((await a.request('/api/register',{email:'ALICE@example.test',password})).status,409);
  const b=browser(h.base);
  const wrong=await b.request('/api/login',{email:'alice@example.test',password:'incorrect password'});
  const unknown=await b.request('/api/login',{email:'missing@example.test',password});
  assert.equal(wrong.status,401);assert.equal(unknown.status,401);assert.equal(wrong.data.error,unknown.data.error);
  assert.equal((await b.request('/api/state')).data.user,null);
});
test('public registration cannot grant administrator role',async t=>{
  const h=await host(t);const a=browser(h.base);
  const result=await a.request('/api/register',{email:'admin@example.test',password,role:'admin'});
  assert.equal(result.data.user.role,'player');assert.deepEqual(result.data.users,[]);
  const b=browser(h.base);
  assert.equal((await b.request('/api/login',{email:'admin@example.test',password,admin:true})).status,401);
  await h.api.store.setAdministrator('operator@example.test',password);
  const signed=await b.request('/api/login',{email:'operator@example.test',password,admin:true});
  assert.equal(signed.status,200);assert.equal(signed.data.user.role,'admin');assert.equal(signed.data.users.length,2);
});
test('logout revokes only that browser session; another browser stays signed in',async t=>{
  const h=await host(t);const a=browser(h.base),b=browser(h.base);
  await a.request('/api/register',{email:'alice@example.test',password});
  await b.request('/api/login',{email:'alice@example.test',password});
  const oldCookie=a.cookie;
  assert.equal((await a.request('/api/logout',{})).data.user,null);
  assert.equal((await browser(h.base,oldCookie).request('/api/state')).data.user,null);
  assert.ok((await b.request('/api/state')).data.user);
});
test('only owners and administrators see booking details; public availability contains no user identity',async t=>{
  const h=await host(t);const a=browser(h.base),b=browser(h.base),guest=browser(h.base);
  await a.request('/api/register',{email:'alice@example.test',password});
  const made=await a.request('/api/bookings',{...booking,price:1,userId:'forged'});
  assert.equal(made.data.booking.price,2100);assert.equal(made.data.booking.userId,made.data.user.id);
  await b.request('/api/register',{email:'bob@example.test',password});
  const view=await b.request('/api/state');assert.equal(view.data.bookings.length,0);assert.equal(view.data.availability.length,1);
  const publicView=(await guest.request('/api/state')).data;
  assert.deepEqual(publicView.bookings,[]);assert.deepEqual(publicView.users,[]);
  assert.equal(publicView.availability[0].userId,undefined);assert.equal(publicView.availability[0].email,undefined);
  assert.equal((await b.request(`/api/bookings/${made.data.booking.id}/cancel`,{})).status,403);
  assert.equal((await guest.request('/api/bookings',booking)).status,401);
});
test('competing group bookings are atomic and cannot partially reserve tables',async t=>{
  const h=await host(t);const a=browser(h.base),b=browser(h.base);
  await a.request('/api/register',{email:'alice@example.test',password});
  await b.request('/api/register',{email:'bob@example.test',password});
  const attempts=await Promise.all([a.request('/api/bookings',booking),b.request('/api/bookings',{...booking,tables:[2,3]})]);
  assert.deepEqual(attempts.map(x=>x.status).sort(),[201,409]);
  const state=(await browser(h.base).request('/api/state')).data;
  assert.equal(state.availability.length,1);assert.equal(state.availability[0].tables.length,2);
});
test('cancellation is shared between browsers and the time rule is enforced on server',async t=>{
  let current=new Date('2030-01-01T09:00:00Z');
  const h=await host(t,{now:()=>current});const a=browser(h.base),b=browser(h.base);
  await a.request('/api/register',{email:'alice@example.test',password});await b.request('/api/login',{email:'alice@example.test',password});
  const made=await a.request('/api/bookings',booking);
  assert.equal((await b.request('/api/state')).data.bookings.length,1);
  const cancelled=await b.request(`/api/bookings/${made.data.booking.id}/cancel`,{});
  assert.equal(cancelled.status,200);assert.equal(cancelled.data.booking.cancelledByRole,'player');
  assert.equal((await a.request('/api/state')).data.availability.length,0);
  const next=await a.request('/api/bookings',{...booking,start:720});
  current=new Date(Date.parse(next.data.booking.startAt)-3599999);
  assert.equal((await a.request(`/api/bookings/${next.data.booking.id}/cancel`,{})).status,409);
});
test('sessions expire after 30 days',async t=>{
  let current=fixed();const h=await host(t,{now:()=>current});const a=browser(h.base);
  await a.request('/api/register',{email:'alice@example.test',password});current=new Date(current.getTime()+31*86400000);
  assert.equal((await a.request('/api/state')).data.user,null);
  assert.equal((await a.request('/api/bookings',booking)).status,401);
});
test('cross-origin or non-JSON mutations are rejected',async t=>{
  const h=await host(t);const a=browser(h.base);
  assert.equal((await a.request('/api/register',{email:'alice@example.test',password},{Origin:'https://other.example'})).status,403);
  assert.equal((await a.request('/api/register',{email:'alice@example.test',password},{'X-PingSpace-Client':''})).status,403);
  assert.equal((await a.request('/api/register',{email:'alice@example.test',password},{'Content-Type':'text/plain'})).status,403);
});


test('a stale account in another tab cannot accidentally create a booking for the new session',async t=>{
  const h=await host(t);const a=browser(h.base);
  const created=await a.request('/api/register',{email:'alice@example.test',password});
  const result=await a.request('/api/bookings',{...booking,expectedUserId:'previous-user'});
  assert.equal(result.status,409);assert.equal((await a.request('/api/state')).data.bookings.length,0);
  const valid=await a.request('/api/bookings',{...booking,expectedUserId:created.data.user.id});
  assert.equal(valid.status,201);
});
