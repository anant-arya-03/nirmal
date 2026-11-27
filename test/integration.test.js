import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { openDatabase } from '../server/db.js';
import { createApp, complaintStages, laundryStages } from '../server/app.js';
import { hashPassword, digest } from '../server/security.js';

const password='An-original-test-password!';
async function fixture(t, options={}) {
  const db=openDatabase(':memory:');
  const mail=[];
  const app=createApp(db,{origin:'http://localhost:4173',mailer:{sendMail:async message=>{mail.push(message);}},...options});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie='';
    return {get cookie(){return cookie;},async request(path,method='GET',body,headers={}){
      const response=await fetch(`${url}/api${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
      if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      const result=response.headers.get('content-type')?.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
      return {status:response.status,body:result,headers:response.headers};
    }};
  }
  const adminId=randomUUID();
  db.prepare("INSERT INTO accounts(id,name,email,password,role,created_at) VALUES (?,?,?,?,'admin',?)").run(adminId,'Test Admin','admin@university.test',await hashPassword(password),new Date().toISOString());
  const admin=client(),student=client(),other=client();
  assert.equal((await admin.request('/auth/login','POST',{email:'admin@university.test',password})).status,200);
  for(const [c,n]of [[student,1],[other,2]]) {
    const result=await c.request('/auth/register','POST',{name:`Student ${n}`,email:`student${n}@university.test`,password,enrollment:`ENR-${n}`,phone:'9876543210',hostel:'Cedar',room:`10${n}`,role:'admin'});
    assert.equal(result.status,201);assert.equal(result.body.role,'student');assert.equal(result.body.password,undefined);c.id=result.body.id;
  }
  const bag=(await admin.request('/bags','POST',{owner_id:student.id})).body;
  const worker=(await admin.request('/workers','POST',{name:'Test Worker',specialty:'Laundry operations'})).body;
  return {db,admin,student,other,client,bag,worker,mail};
}

test('authentication, session expiry, logout, CSRF and server-enforced roles',async t=>{
  const f=await fixture(t),anonymous=f.client();
  assert.equal((await anonymous.request('/bags')).status,401);
  assert.equal((await f.student.request('/students')).status,403);
  assert.equal((await f.student.request('/analytics')).status,403);
  assert.equal((await f.student.request('/bags','POST',{owner_id:f.student.id})).status,403);
  assert.equal((await f.student.request('/notifications/read','POST',{}, {Origin:'https://attacker.test'})).status,403);
  assert.equal((await f.student.request('/notifications/read','POST',{}, {'Sec-Fetch-Site':'cross-site'})).status,403);
  const login=await anonymous.request('/auth/login','POST',{email:'student1@university.test',password});
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await anonymous.request('/logout','POST',{})).status,200);
  assert.equal((await anonymous.request('/me')).status,401);
  f.db.prepare('UPDATE sessions SET expires=0 WHERE account_id=?').run(f.student.id);
  assert.equal((await f.student.request('/me')).status,401);
});

test('bag ownership, collection transitions, stale updates, persistent handovers and notifications',async t=>{
  const {admin,student,other,bag,worker}=await fixture(t);
  assert.equal((await other.request('/bags')).body.length,0);
  assert.equal((await other.request('/cycles','POST',{bag_id:bag.id,garments:3})).status,404);
  assert.equal((await student.request('/cycles','POST',{bag_id:bag.id,garments:0})).status,400);
  const created=await student.request('/cycles','POST',{bag_id:bag.id,garments:12});assert.equal(created.status,201);
  assert.equal((await student.request('/cycles','POST',{bag_id:bag.id,garments:1})).status,409);
  assert.equal((await admin.request(`/cycles/${created.body.id}`,'PATCH',{status:'Delivered',version:1,worker_id:worker.id,note:'Skip all steps'})).status,409);
  for(const [index,status]of laundryStages.slice(1).entries()) {
    const result=await admin.request(`/cycles/${created.body.id}`,'PATCH',{status,version:index+1,worker_id:worker.id,note:`Recorded handover for ${status}`});assert.equal(result.status,200);
  }
  const bags=(await student.request('/bags')).body;
  assert.equal(bags[0].cycles[0].status,'Delivered');assert.equal(bags[0].cycles[0].events.length,7);
  assert.equal((await student.request('/notifications')).body.length,7);
  assert.equal((await student.request('/cycles','POST',{bag_id:bag.id,garments:4})).status,201);
});

test('private evidence, full complaint lifecycle, feedback, reopen, concurrency, and real analytics',async t=>{
  const {admin,student,other,bag,worker,db}=await fixture(t);
  const image=PNG.sync.write({width:4,height:4,data:Buffer.alloc(4*4*4,128)});
  const body={bag_id:bag.id,category:'Missing clothes',description:'One blue cotton shirt was missing from the returned bag.',photo:`data:image/png;base64,${image.toString('base64')}`};
  assert.equal((await other.request('/complaints','POST',body)).status,404);
  assert.equal((await student.request('/complaints','POST',{...body,photo:'data:image/png;base64,bm90YW5pbWFnZQ=='})).status,400);
  const result=await student.request('/complaints','POST',body);assert.equal(result.status,201);assert.match(result.body.ref,/^NM-/);
  const path=`/complaints/${result.body.id}`;
  assert.equal((await other.request(path)).status,404);assert.equal((await other.request(`${path}/photo`)).status,404);
  assert.equal((await other.request('/complaints')).body.length,0);
  const photo=await student.request(`${path}/photo`);assert.equal(photo.headers.get('content-type'),'image/png');assert.equal(photo.headers.get('cache-control'),'no-store');assert.equal(PNG.sync.read(photo.body).width,4);
  assert.equal((await student.request(path,'PATCH',{status:'Resolved',version:1,note:'Do it myself'})).status,403);
  assert.equal((await admin.request(path,'PATCH',{status:'Resolved',version:1,note:'Skip review'})).status,409);
  for(const [index,status]of complaintStages.slice(1).entries()){
    assert.equal((await admin.request(path,'PATCH',{status,version:index+1,worker_id:worker.id,note:`A clear note for ${status}`})).status,200);
    assert.equal((await admin.request(path,'PATCH',{status,version:index+1,worker_id:worker.id,note:'Stale update'})).status,409);
  }
  const detail=(await student.request(path)).body;assert.equal(detail.events.length,6);assert.equal(detail.status,'Closed');assert.equal(detail.photo,undefined);
  assert.equal((await student.request(`${path}/feedback`,'POST',{version:6,rating:5,feedback:'Issue solved, thank you.'})).status,200);
  assert.equal((await other.request(`${path}/reopen`,'POST',{version:7,note:'Attempting to modify another account'})).status,404);
  const metrics=(await admin.request('/analytics')).body;assert.equal(metrics.total,1);assert.equal(metrics.resolved,1);assert.equal(metrics.satisfaction,5);
  assert.equal((await student.request(`${path}/reopen`,'POST',{version:7,note:'The item received is a different size.'})).status,200);
  const reopened=(await student.request(path)).body;assert.equal(reopened.status,'Under Review');assert.equal(reopened.rating,null);assert.equal(reopened.resolved_at,null);assert.equal(reopened.due_at,detail.due_at);
  assert.equal((await admin.request(`/workers/${worker.id}`,'PATCH',{active:false})).status,409);
  const count=db.prepare('SELECT count(*) n FROM complaint_events').get().n;assert.equal(count,7);
});

test('single-use password reset revokes sessions and hides tokens and account existence',async t=>{
  const {student,client,mail}=await fixture(t),anon=client();
  const known=await anon.request('/auth/forgot','POST',{email:'student1@university.test'});
  const unknown=await anon.request('/auth/forgot','POST',{email:'unknown@university.test'});
  assert.deepEqual(known.body,unknown.body);assert.equal(mail.length,1);
  const token=/reset\/([a-f0-9]{64})/.exec(mail[0].text)[1];assert.ok(!JSON.stringify(known.body).includes(token));
  assert.equal((await anon.request('/auth/reset','POST',{token,password:'A-new-password-for-this-account'})).status,200);
  assert.equal((await student.request('/me')).status,401);
  assert.equal((await anon.request('/auth/reset','POST',{token,password})).status,400);
  assert.equal((await anon.request('/auth/login','POST',{email:'student1@university.test',password})).status,401);
  assert.equal((await anon.request('/auth/login','POST',{email:'student1@university.test',password:'A-new-password-for-this-account'})).status,200);
});

test('profile, password change, settings, deactivation and notification ownership',async t=>{
  const {admin,student,other,client,db}=await fixture(t);
  assert.equal((await student.request('/profile','PATCH',{name:'Updated Student',phone:'9876543210',hostel:'Maple',room:'202',role:'admin'})).body.role,'student');
  assert.equal((await student.request('/settings','PATCH',{})).status,403);
  assert.equal((await admin.request('/settings','PATCH',{campus_name:'Test University',delivery_hours:24,resolution_hours:36})).status,200);
  assert.equal((await student.request('/settings')).body.resolution_hours,'36');
  assert.equal((await admin.request('/settings','PATCH',{campus_name:'Test University',delivery_hours:-1,resolution_hours:36})).status,400);
  const secondSession=client();await secondSession.request('/auth/login','POST',{email:'student1@university.test',password});
  assert.equal((await student.request('/password','POST',{current:password,password:'Updated-account-password-2026'})).status,200);
  assert.equal((await student.request('/me')).status,200);assert.equal((await secondSession.request('/me')).status,401);
  assert.equal((await other.request('/notifications/read','POST',{})).status,200);
  assert.equal(db.prepare('SELECT seen FROM notifications WHERE account_id=?').get(student.id).seen,0);
  assert.equal((await admin.request(`/students/${student.id}`,'PATCH',{active:false})).status,200);
  assert.equal((await student.request('/me')).status,401);
  assert.equal((await secondSession.request('/auth/login','POST',{email:'student1@university.test',password:'Updated-account-password-2026'})).status,401);
});

test('expired reset tokens fail and lack of mail transport is disclosed',async t=>{
  const {client,db,student}=await fixture(t,{mailer:null});
  const token='a'.repeat(64);db.prepare('INSERT INTO resets VALUES (?,?,?)').run(digest(token),student.id,Date.now()-1000);
  assert.equal((await client().request('/auth/reset','POST',{token,password})).status,400);
  assert.equal((await client().request('/auth/forgot','POST',{email:'student1@university.test'})).status,503);
});

test('SQLite records survive closing and reopening the database',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nirmal-test-')),path=join(dir,'records.sqlite');
  try{let db=openDatabase(path);db.prepare("UPDATE settings SET value='Persistent Campus' WHERE key='campus_name'").run();db.close();db=openDatabase(path);assert.equal(db.prepare("SELECT value FROM settings WHERE key='campus_name'").get().value,'Persistent Campus');db.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
