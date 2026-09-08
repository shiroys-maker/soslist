const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(process.env.CONNECTION_SOURCE || require('node:path').join(__dirname, '../connection.js'),'utf8');
function harness(get = () => new Promise(() => {})) {
 const tasks = new Map(), events = {}, label = {}, buttons = [{addEventListener(){}},{addEventListener(){}}]; let id=0, calls=0;
 const query = {where(){return this},orderBy(){return this},limit(){return this},get};
 const c = {console, Date, Promise, JSON, Blob, URL, navigator:{onLine:true}, localStorage:{getItem(){return null},setItem(){}},
 document:{querySelector(){return {after(){}}},createElement(){return {querySelector(){return label},querySelectorAll(){return buttons}}},getElementById(){return {prepend(){}}},addEventListener(n,f){events[n]=f}},
 setTimeout(f,ms){tasks.set(++id,{f,ms});return id},clearTimeout(id){tasks.delete(id)},
 db:{collection(){return query}},dateFilter:{value:''},formatDateInputValue:()=> '2026-09-08',getCorrectedAppointmentDate:x=>x.date,formatDateInTokyo:()=> '2026-09-07',
 setupRealtimeListener(){calls++; c.sosConnection.begin()},addEventListener(n,f){events[n]=f}};
 c.window=c;vm.runInNewContext(source,c);
 return {c,tasks,label,events,get calls(){return calls},fire(ms){const e=[...tasks].find(([,t])=>t.ms===ms);assert.ok(e,`timer ${ms}`);tasks.delete(e[0]);e[1].f()}};
}
test('startup falls back after eight seconds; late result cannot move date',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r)); const p=h.c.sosConnection.start();h.fire(8000);await p;
 assert.equal(h.calls,1);assert.equal(h.c.dateFilter.value,'2026-09-08');resolve({empty:false,docs:[{data:()=>({date:new Date()})}]});await Promise.resolve();assert.equal(h.c.dateFilter.value,'2026-09-08');
});
test('normal startup preserves previous appointment date',async()=>{
 const h=harness(async()=>({empty:false,docs:[{data:()=>({date:new Date()})}]}));await h.c.sosConnection.start();assert.equal(h.calls,1);assert.equal(h.c.dateFilter.value,'2026-09-07');
});
test('listener timeout retries; server event cancels retry; old callback ignored',async()=>{
 const h=harness(async()=>({empty:true}));await h.c.sosConnection.start();const old=h.c.sosConnection.begin();h.fire(15000);h.fire(1000);
 assert.equal(h.c.sosConnection.snapshot(old,{metadata:{fromCache:false}}),false);
 const token=h.c.sosConnection.begin();h.c.sosConnection.snapshot(token,{metadata:{fromCache:false}});assert.equal(h.tasks.size,0);
 h.c.sosConnection.snapshot(token,{metadata:{fromCache:true}});h.fire(15000);assert.match(h.label.textContent,/再試行/);
});
test('permission error does not loop; offline waits; online reconnects',async()=>{
 const h=harness(async()=>({empty:true}));await h.c.sosConnection.start();const t=h.c.sosConnection.begin();h.c.sosConnection.error(t,{code:'permission-denied'});assert.equal(h.tasks.size,0);assert.match(h.label.textContent,/permission-denied/);
 h.c.navigator.onLine=false;h.events.offline();assert.match(h.label.textContent,/オフライン/);h.c.navigator.onLine=true;h.events.online();assert.equal(h.calls,2);
});
test('logout cancels startup and retry; automatic attempts bounded',async()=>{
 const h=harness();const p=h.c.sosConnection.start();h.c.sosConnection.stop();h.fire(8000);await p;assert.equal(h.calls,0);
 const j=harness(async()=>({empty:true}));await j.c.sosConnection.start();for(let i=0;i<5;i++){j.fire(15000);j.fire(1000*2**i)}j.fire(15000);assert.equal(j.tasks.size,0);assert.match(j.label.textContent,/回復できません/);
});

test('mobile foreground return reconnects, hidden and logged-out pages do not',async()=>{
 const h=harness(async()=>({empty:true}));await h.c.sosConnection.start();
 h.c.document.hidden=true;h.events.visibilitychange();assert.equal(h.calls,1);
 h.c.document.hidden=false;h.events.visibilitychange();assert.equal(h.calls,2);
 if(h.events.pageshow){h.events.pageshow({persisted:false});assert.equal(h.calls,2);h.events.pageshow({persisted:true});assert.equal(h.calls,3);}
 h.c.sosConnection.stop();const count=h.calls;h.events.visibilitychange();h.events.online();assert.equal(h.calls,count);
});
