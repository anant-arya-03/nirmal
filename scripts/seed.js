import { openDatabase, transaction } from '../server/db.js';
import { hashPassword } from '../server/security.js';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production.');
const db = openDatabase();
if (db.prepare('SELECT count(*) n FROM accounts').get().n) {
  console.log('Database already has accounts. No records were changed.'); db.close(); process.exit(0);
}
const password = await hashPassword('Nirmal-demo-2026!');
const id = () => randomUUID(), ago = hours => new Date(Date.now() - hours * 3600000).toISOString();
const admin = id(), student = id(), second = id(), worker1 = id(), worker2 = id();
const run = (sql, ...values) => db.prepare(sql).run(...values);
transaction(db, () => {
  for (const [accountId,name,email,role,enrollment,phone,hostel,room] of [
    [admin,'Campus Operations','admin@nirmal.example','admin',null,'','',''],
    [student,'Aarav Sharma','student@nirmal.example','student','NU2026001','9876500001','Cedar','204'],
    [second,'Meera Rao','meera@nirmal.example','student','NU2026002','9876500002','Maple','118']
  ]) run('INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?,1,?)',accountId,name,email,password,role,enrollment,phone,hostel,room,ago(120));
  run('INSERT INTO workers VALUES (?,?,?,1)',worker1,'Ravi Kumar','Collection & washing');
  run('INSERT INTO workers VALUES (?,?,?,1)',worker2,'Sana Ali','Quality & resolution');
  const bags = [[id(),'NM-CEDAR01',student],[id(),'NM-CEDAR02',student],[id(),'NM-MAPLE01',second]];
  for(const [bagId,label,owner] of bags) run('INSERT INTO bags VALUES (?,?,?,?)',bagId,label,owner,ago(100));
  const stages=['Scheduled','Collected','Washing','Drying','Quality Check','Ready','Delivered'];
  for(const [i,status,garments,start] of [[0,'Washing',12,20],[1,'Delivered',8,96],[2,'Ready',10,30]]) {
    const cycle=id();
    run('INSERT INTO cycles VALUES (?,?,?,?,?,?,?,?,1)',cycle,bags[i][0],status,garments,worker1,ago(start),ago(start-48),status==='Delivered'?ago(55):null);
    for(let step=0;step<=stages.indexOf(status);step++) run('INSERT INTO cycle_events(cycle_id,status,note,actor_id,worker_id,created_at) VALUES (?,?,?,?,?,?)',cycle,stages[step],['Collection booked.','Garments counted at collection.','Wash cycle started.','Moved to drying.','Garments checked against the count.','Folded and ready for pickup.','Returned to the student.'][step],step===0?bags[i][2]:admin,step===0?null:worker1,ago(start-step*5));
  }
  const states=['Submitted','Under Review','Assigned','In Progress','Resolved','Closed'];
  for(const [index,category,status,hours,description] of [[0,'Missing clothes','In Progress',30,'One navy cotton shirt was missing from my returned bag. Please help locate it.'],[1,'Washing quality','Resolved',80,'A coffee stain remained on the sleeve after the wash. Please arrange a rewash.'],[2,'Delayed delivery','Submitted',55,'My collection is past its expected return time. Please share an updated delivery time.']]){
    const complaint=id(),bag=bags[index],assigned=states.indexOf(status)>=2?worker2:null;
    run('INSERT INTO complaints(id,ref,student_id,bag_id,category,description,status,worker_id,created_at,due_at,resolved_at,rating,feedback) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',complaint,`NM-DEMO00${index+1}`,bag[2],bag[0],category,description,status,assigned,ago(hours),ago(hours-48),status==='Resolved'?ago(50):null,status==='Resolved'?5:null,status==='Resolved'?'Thank you for arranging a careful rewash.':null);
    for(let s=0;s<=states.indexOf(status);s++)run('INSERT INTO complaint_events(complaint_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)',complaint,states[s],['Complaint received.','The team is reviewing the collection record.','Assigned to Sana for follow-up.','Checking the sorting area and bag inventory.','Garment rewashed and returned.'][s],s===0?bag[2]:admin,ago(hours-s*6));
    run('INSERT INTO notifications VALUES (?,?,?,?,?,0,?)',id(),bag[2],`NM-DEMO00${index+1} · ${status}`,category,`complaints/${complaint}`,ago(hours-states.indexOf(status)*6));
    run('INSERT INTO notifications VALUES (?,?,?,?,?,0,?)',id(),admin,`NM-DEMO00${index+1} needs your attention`,category,`complaints/${complaint}`,ago(hours));
  }
  run("UPDATE settings SET value='Northfield University · Demo' WHERE key='campus_name'");
});
db.close();
console.log('Fictional demo data created. Local development only.');
console.log('Student: student@nirmal.example | Administrator: admin@nirmal.example');
console.log('Password for demo accounts: Nirmal-demo-2026!');
