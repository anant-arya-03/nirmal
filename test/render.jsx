import React from 'react';
import { renderToString } from 'react-dom/server';
import assert from 'node:assert/strict';
import { Overview, Laundry, Complaints, NewComplaint, People, Analytics, Notifications, SettingsPage } from '../src/pages.jsx';
import Auth from '../src/Auth.jsx';
const user={id:'s1',name:'Test Student',email:'student@example.test',role:'student',enrollment:'E-1',phone:'9876543210',hostel:'Cedar',room:'101'};
const c={id:'c1',ref:'NM-TEST',category:'Missing clothes',description:'One shirt is missing.',status:'In Progress',bag_label:'NM-TESTBAG',student_name:'Test Student',created_at:'2026-11-27T10:00:00Z',due_at:'2026-11-29T10:00:00Z',version:1};
const data={bags:[{id:'b1',label:'NM-TESTBAG',owner_name:user.name,hostel:user.hostel,room:user.room,cycles:[{id:'y1',status:'Washing',garments:12,created_at:c.created_at,due_at:c.due_at,worker_name:'Worker',events:[]}]}],complaints:[c],notifications:[{id:'n1',title:'A laundry update',body:'Your bag has been collected.',target:'tracking',created_at:c.created_at,seen:0}],students:[user],workers:[{id:'w1',name:'Worker',specialty:'Washing',active:1,open_complaints:1,resolved:0,handovers:2}],settings:{campus_name:'Test Campus',resolution_hours:48,delivery_hours:48},analytics:{students:1,active_bags:1,total:1,pending:1,resolved:0,in_progress:1,overdue:0,average_hours:null,satisfaction:null,trends:[{day:'2026-11-27',count:1}],categories:[{category:'Missing clothes',count:1}],stages:[]}};
let checks=0;
for(const admin of [false,true])for(const empty of [false,true]){
  const d=empty?{...data,bags:[],complaints:[],notifications:[],students:[],workers:[],analytics:{...data.analytics,total:0,trends:[],categories:[]}}:data;
  const props={user:{...user,role:admin?'admin':'student'},admin,data:d,saved:async()=>{},setUser:()=>{}};
  const views=[<Overview {...props}/>,<Laundry {...props}/>,<Laundry {...props} tracking/>,<Complaints {...props}/>,<Notifications {...props}/>,<SettingsPage {...props}/>];
  if(admin)views.push(<People {...props} kind="students"/>,<People {...props} kind="workers"/>,<Analytics {...props}/>);
  else views.push(<NewComplaint {...props}/>);
  for(const view of views){const html=renderToString(view);assert.ok(html.length>200);assert.ok(!html.includes('[object Object]'));checks++;}
}
for(const route of ['overview','reset/'+'a'.repeat(64)]){assert.ok(renderToString(<Auth route={route} onLogin={()=>{}}/>).includes('password'));checks++;}
console.log(`Rendered ${checks} populated, empty, student, administrator, and authentication views successfully. This is a render check, not a browser interaction test.`);
