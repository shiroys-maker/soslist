const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runJob } = require('../evidence-review/runner.cjs');
const empty = { outcome:'no_records',found:0,completed:0,skipped:0,incomplete:0,enumerationComplete:true,summary:'Data Entryは0件です。',appointments:[] };
function fixture(t, scenario='normal') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sos-evidence-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const codexPath=path.join(root,'fake-codex'),skillPath=path.join(root,'SKILL.md');fs.writeFileSync(skillPath,'# synthetic skill');
 fs.writeFileSync(codexPath,`#!${process.execPath}
 const fs=require('fs'),path=require('path'),rl=require('readline');
 const scenario=${JSON.stringify(scenario)},empty=${JSON.stringify(empty)};let stage=0,active=false;
 const wire=v=>console.log(JSON.stringify(v)),log=v=>fs.appendFileSync(path.join(__dirname,'wire.jsonl'),JSON.stringify(v)+'\\n');
 fs.writeFileSync(path.join(__dirname,'capture.json'),JSON.stringify({args:process.argv,api:process.env.OPENAI_API_KEY||null}));
 function req(tool,args){wire({id:'s'+(++stage),method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'call'+stage,tool,arguments:args}});}
 function complete(){wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{type:'agentMessage',phase:'final_answer',text:scenario==='malformed'?'SECRET_CLINICAL invalid JSON':JSON.stringify(empty)}}});wire({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});}
 rl.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);log(m);
 if(!m.method){if(m.id==='s1')req('sos_set_queue',{enumerationComplete:true,appointments:[]});else if(m.id==='s2'){
  if(scenario==='crash')process.exit(7);
  else if(['hang','no-ended'].includes(scenario))return;
  else if(scenario==='window'){for(let i=0;i<3;i++)wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'w'+i,type:'mcpToolCall',error:{message:'cgWindowNotFound'}}}});}
  else if(scenario==='ownership'){wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'w',type:'mcpToolCall',error:{message:'Tab 123 is already part of browser session other-session'}}}});req('sos_ready',{edge:true,soslist:true});}
  else complete();
 }return;}
 let r={};
 if(m.method==='account/read')r={account:{type:'chatgpt'}};
 if(['thread/start','thread/resume'].includes(m.method))r={thread:{id:'thread',sessionId:'actual-session'}};
 if(m.method==='mcpServerStatus/list')r={data:[{name:'cua_repl',tools:{js:{name:'js'},turn_ended:{name:'turn_ended'}}}]};
 if(m.method==='mcpServer/tool/call'&&scenario==='cleanup-fail')r={isError:true};
 if(m.method==='turn/interrupt'&&scenario!=='no-ended')wire({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'interrupted'}}});
 if(m.method==='thread/delete'&&scenario==='delete-fail'){wire({id:m.id,error:{code:-32000,message:'Synthetic deletion failure'}});return;}
 if(m.method==='turn/start'){
  active=true;wire({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});r={turn:{id:'turn'}};
 }
 if(m.id!==undefined)wire({id:m.id,result:r});
 if(m.method==='turn/start'){
  if(scenario==='premature'){complete();return;}
  for(let i=0;i<2;i++)wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'r'+i,type:'mcpToolCall',result:{_meta:{'codex/toolSurface':{kind:'browserUse'}}}}}});
  req('sos_ready',{edge:true,soslist:true});
 }
 });`,{mode:0o700});
 return {root,codexPath,skillPath,runRoot:path.join(root,'jobs'),cuaConfig:{command:'/usr/bin/true',args:[],env:{}},timeouts:{rpc:600,cleanup:250,stall:160,tick:20},environment:{OPENAI_API_KEY:'synthetic-secret'}};
}
const readWire=f=>fs.readFileSync(path.join(f.root,'wire.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const checkpoints=f=>fs.readdirSync(path.join(f.runRoot,'checkpoints'));

test('app-server uses account login, exact session cleanup, preflight and verified zero queue',async t=>{
 const f=fixture(t),events=[];const r=await runJob({mode:'batch'},{...f,onEvent:e=>events.push(e)});
 assert.equal(r.outcome,'no_records');assert.equal(events.at(-1).state,'no_records');assert.equal(events.at(-1).resumeId,null);
 const capture=JSON.parse(fs.readFileSync(path.join(f.root,'capture.json')));assert.equal(capture.api,null);assert.ok(capture.args.includes('app-server'));assert.ok(!capture.args.some(a=>a.includes('dangerously-bypass')));
 const wire=readWire(f),start=wire.find(m=>['thread/start','thread/resume'].includes(m.method));assert.equal(start.params.ephemeral,false);assert.equal(start.params.approvalsReviewer,'auto_review');assert.ok(start.params.dynamicTools.length>=4);
 const cleanup=wire.find(m=>m.method==='mcpServer/tool/call');assert.equal(cleanup.params.arguments.session_id,'actual-session');assert.equal(cleanup.params.arguments.turn_id,'turn');
 assert.deepEqual(checkpoints(f),[]);assert.ok(!fs.existsSync(path.join(f.runRoot,'active.lock')));
});

test('premature final, ownership conflicts, repeated window loss and stalls retain resumable state',async t=>{
 for(const scenario of ['premature','ownership','window','hang','malformed']){
  const f=fixture(t,scenario),events=[];await assert.rejects(runJob({mode:'batch'},{...f,onEvent:e=>events.push(e)}));
  assert.equal(events.at(-1).state,'paused');assert.match(events.at(-1).resumeId,/^[a-f0-9]{64}$/);assert.equal(checkpoints(f).length,1);
  assert.ok(readWire(f).some(m=>m.method==='mcpServer/tool/call'));assert.ok(!events.some(e=>e.state==='completed'));assert.ok(!JSON.stringify(events).includes('SECRET_CLINICAL'));if(scenario==='ownership')assert.equal(readWire(f).find(m=>m.id==='s3')?.error?.code,-32000);
 }
});

test('failed cleanup and process crash keep exact owner; next run resumes the same session',async t=>{
 for(const scenario of ['cleanup-fail','crash']){
  const f=fixture(t,scenario);await assert.rejects(runJob({mode:'batch'},f));
  const id=checkpoints(f)[0].slice(0,-5),checkpoint=JSON.parse(fs.readFileSync(path.join(f.runRoot,'checkpoints',id+'.json')));
  assert.equal(checkpoint.owner.sessionId,'actual-session');
  await assert.rejects(runJob({mode:'batch'},f),/未完了/);
  // Switch only the fake transport, retaining the real durable work directory.
  const healthy=fixture(t);await runJob({mode:'resume',resumeId:id},{...f,codexPath:healthy.codexPath});
  const wire=readWire(healthy),resume=wire.findIndex(m=>m.method==='thread/resume');assert.ok(resume>=0&&resume<wire.findIndex(m=>m.method==='turn/start'));
  assert.equal(wire[resume].params.threadId,'thread');assert.equal(wire.filter(m=>m.method==='mcpServer/tool/call').length,1);assert.deepEqual(checkpoints(f),[]);
 }
});

test('second live instance cannot take a held job lock',async t=>{
 const f=fixture(t);fs.mkdirSync(f.runRoot);fs.writeFileSync(path.join(f.runRoot,'active.lock'),String(process.pid));
 await assert.rejects(runJob({mode:'batch'},f),/実行中/);assert.equal(fs.readFileSync(path.join(f.runRoot,'active.lock'),'utf8'),String(process.pid));
});

test('stop uses Interrupt cleanup and keeps a durable restart record',async t=>{
 const f=fixture(t,'hang'),events=[];
 const job=runJob({mode:'batch'},{...f,onEvent:e=>{events.push(e);if(e.state==='progress')setTimeout(()=>process.emit('SIGTERM'),1);}});
 assert.equal(await job,null);assert.equal(events.at(-1).state,'cancelled');assert.equal(checkpoints(f).length,1);
 assert.ok(readWire(f).some(m=>m.method==='mcpServer/tool/call'&&m.params.arguments.hook_event_name==='Interrupt'));
});


test('a still-live previous server cannot be released by a recovery host',async t=>{
 const f=fixture(t,'cleanup-fail');await assert.rejects(runJob({mode:'batch'},f));
 const file=path.join(f.runRoot,'checkpoints',checkpoints(f)[0]),s=JSON.parse(fs.readFileSync(file));s.owner.serverPid=process.pid;fs.writeFileSync(file,JSON.stringify(s));
 const healthy=fixture(t);await assert.rejects(runJob({mode:'resume',resumeId:s.id},{...f,codexPath:healthy.codexPath,timeouts:{...f.timeouts,oldExit:50}}),/終了を確認できません/);
 assert.ok(!readWire(healthy).some(m=>m.method==='mcpServer/tool/call'||m.method==='turn/start'));assert.equal(JSON.parse(fs.readFileSync(file)).owner.serverPid,process.pid);
});


test('failure deleting a verified session resumes cleanup only without another clinical turn',async t=>{
 const f=fixture(t,'delete-fail');await assert.rejects(runJob({mode:'batch'},f));
 const id=checkpoints(f)[0].slice(0,-5),data=JSON.parse(fs.readFileSync(path.join(f.runRoot,'checkpoints',id+'.json')));
 assert.equal(data.result.outcome,'no_records');assert.equal(data.sessionArchived,true);
 const healthy=fixture(t);const result=await runJob({mode:'resume',resumeId:id},{...f,codexPath:healthy.codexPath});assert.equal(result.outcome,'no_records');
 const wire=readWire(healthy);assert.ok(wire.some(m=>m.method==='thread/delete'));assert.ok(!wire.some(m=>['thread/start','thread/resume','turn/start'].includes(m.method)));assert.deepEqual(checkpoints(f),[]);
});


test('interrupt acknowledgement without turn completion retains the cleanup obligation',async t=>{
 const f=fixture(t,'no-ended');await assert.rejects(runJob({mode:'batch'},f));
 const s=JSON.parse(fs.readFileSync(path.join(f.runRoot,'checkpoints',checkpoints(f)[0])));assert.equal(s.owner.sessionId,'actual-session');
 assert.ok(!readWire(f).some(m=>m.method==='mcpServer/tool/call'));
});

test('disabled MCP servers have transports even without machine-local definitions',async t=>{
 const f=fixture(t);await runJob({mode:'batch'},f);
 const args=JSON.parse(fs.readFileSync(path.join(f.root,'capture.json'))).args;
 const mcp=args.find(a=>a.startsWith('mcp_servers='));
 for(const name of ['node_repl','computer-use'])assert.ok(mcp.includes('"'+name+'"={"command"="/usr/bin/false","enabled"=false}'));
 assert.ok(!args.some(a=>/^mcp_servers\.[^.]+\.enabled=/.test(a)));
});


test('single recovery uses the original explicit selection instead of the batch transition gate', async t => {
 const f=fixture(t),{ReviewStore}=require('../evidence-review/store.cjs');
 const appointment={docId:'synthetic-selected',claimantName:'SYNTHETIC',contractNumber:'TEST.1.2',appointmentDateTimeMs:1791248400000,services:['SHA'],sha:true};
 const store=ReviewStore.create(f.runRoot,{mode:'single',appointment});
 store.queue({enumerationComplete:true,appointments:[appointment]});
 store.progress({contractNumber:appointment.contractNumber,phase:'blocked'});
 // The transport's empty batch result is deliberately invalid for this selection.
 await assert.rejects(runJob({mode:'resume',resumeId:store.id},f));
 const start=readWire(f).find(m=>m.method==='thread/start');
 assert.match(start.params.developerInstructions,/HOST-RESOLVED SCOPE: original mode=single/);
 const turn=readWire(f).find(m=>m.method==='turn/start');
 assert.equal(turn.params.additionalContext.soslist_workflow.kind,'application');
 assert.equal(turn.params.additionalContext.soslist_workflow.value,start.params.developerInstructions);
 assert.match(turn.params.additionalContext.soslist_workflow.value,/HOST-RESOLVED SCOPE: original mode=single/);
 assert.match(start.params.developerInstructions,/historical Edit-transition evidence alone is NOT a blocker/);
 const retained=ReviewStore.open(f.runRoot,store.id);
 assert.equal(retained.data.appointments[0].shaEditStarted,undefined);
 assert.equal(retained.data.appointments[0].docId,appointment.docId);
 assert.deepEqual(retained.data.appointments[0].verified,{});
});

test('batch status scope still requires its own SHA transition and rejects unknown original modes',()=>{
 const {scopeInstructions}=require('../evidence-review/runner.cjs');
 assert.match(scopeInstructions({mode:'batch'}),/requires the recorded own SHA Edit transition/);
 assert.throws(()=>scopeInstructions({mode:'resume'}));
});
