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
 if(scenario==='slow-exit')process.on('SIGTERM',()=>{});
 const wire=v=>console.log(JSON.stringify(v)),log=v=>fs.appendFileSync(path.join(__dirname,'wire.jsonl'),JSON.stringify(v)+'\\n');
 fs.writeFileSync(path.join(__dirname,'capture.json'),JSON.stringify({pid:process.pid,args:process.argv,api:process.env.OPENAI_API_KEY||null}));
 function req(tool,args){wire({id:'s'+(++stage),method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'call'+stage,tool,arguments:args}});}
 function complete(){wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{type:'agentMessage',phase:'final_answer',text:scenario==='malformed'?'SECRET_CLINICAL invalid JSON':JSON.stringify(empty)}}});wire({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});}
 rl.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);log(m);
 if(!m.method){if(m.id==='permission'){if(m.result?.action==='accept'){for(let i=0;i<2;i++)wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'r'+i,type:'mcpToolCall',result:{}}}});req('sos_ready',{edge:true,soslist:true});}return;}if(m.id==='s1')req('sos_set_queue',{enumerationComplete:true,appointments:[]});else if(m.id==='s2'){
  if(scenario==='crash')process.exit(7);
  else if(['hang','no-ended'].includes(scenario))return;
  else if(scenario==='window'){for(let i=0;i<3;i++)wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'w'+i,type:'mcpToolCall',error:{message:'cgWindowNotFound'}}}});}
  else if(scenario==='ownership'){wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'w',type:'mcpToolCall',error:{message:'Tab 123 is already part of browser session other-session'}}}});req('sos_ready',{edge:true,soslist:true});}
  else complete();
 }return;}
 let r={};
 if(m.method==='account/read')r={account:{type:'chatgpt'}};
 if(['thread/start','thread/resume'].includes(m.method))r={thread:{id:'thread',sessionId:'actual-session'}};
 if(m.method==='thread/resume'&&scenario==='large-history'&&!m.params.excludeTurns)r.thread.turns=[{syntheticScreenshot:'x'.repeat(8_100_000)}];
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
  if(scenario==='app-approval'){wire({id:'permission',method:'mcpServer/elicitation/request',params:${JSON.stringify(appRequest())}});return;}
  for(let i=0;i<2;i++)wire({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'r'+i,type:'mcpToolCall',result:{_meta:{'codex/toolSurface':{kind:'browserUse'}}}}}});
  req('sos_ready',{edge:true,soslist:true});
 }
 });`,{mode:0o700});
 return {requestIntakeConsent:async()=> 'accept',root,codexPath,skillPath,runRoot:path.join(root,'jobs'),cuaConfig:{command:'/usr/bin/true',args:[],env:{}},timeouts:{rpc:600,cleanup:250,stall:160,tick:20},environment:{OPENAI_API_KEY:'synthetic-secret'}};
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
 const f=fixture(t),{ReviewStore}=require('../evidence-review/store.cjs'),events=[];
 const appointment={docId:'synthetic-selected',claimantName:'SYNTHETIC',contractNumber:'TEST.1.2',appointmentDateTimeMs:1791248400000,services:['SHA'],sha:true};
 const store=ReviewStore.create(f.runRoot,{mode:'single',appointment});
 store.queue({enumerationComplete:true,appointments:[appointment]});
 store.progress({contractNumber:appointment.contractNumber,phase:'blocked'});
 // The transport's empty batch result is deliberately invalid for this selection.
 await assert.rejects(runJob({mode:'resume',resumeId:store.id},{...f,onEvent:e=>events.push(e)}));
 assert.ok(events.length);assert.ok(events.every(e=>e.resumeDocId===appointment.docId));
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


test('large resumed history is omitted from the response without changing the persistent session',async t=>{
 const f=fixture(t,'large-history'),{ReviewStore}=require('../evidence-review/store.cjs');
 const store=ReviewStore.create(f.runRoot,{mode:'batch'});
 store.setSession({threadId:'thread',sessionId:'actual-session'});
 const result=await runJob({mode:'resume',resumeId:store.id},f);
 assert.equal(result.outcome,'no_records');
 const resume=readWire(f).find(m=>m.method==='thread/resume');
 assert.equal(resume.params.threadId,'thread');assert.equal(resume.params.excludeTurns,true);
 assert.ok(!Object.hasOwn(resume.params,'history'));
 assert.equal(readWire(f).some(m=>m.method==='thread/start'),false);
});


test('explicit resume clarification reaches the original session and survives the next retry',async t=>{
 const f=fixture(t),{ReviewStore}=require('../evidence-review/store.cjs');
 const appointment={docId:'synthetic-selected',claimantName:'SYNTHETIC',contractNumber:'TEST.1.2',appointmentDateTimeMs:1791248400000,services:['SHA'],sha:true};
 const store=ReviewStore.create(f.runRoot,{mode:'single',appointment});
 store.queue({enumerationComplete:true,appointments:[appointment]});
 store.setSession({threadId:'thread',sessionId:'actual-session'});
 const clarification='SYNTHETIC_USER_CLARIFICATION_ONLY';
 await assert.rejects(runJob({mode:'resume',resumeId:store.id,userInstruction:clarification},f));
 await assert.rejects(runJob({mode:'resume',resumeId:store.id},f));
 const wire=readWire(f),turns=wire.filter(m=>m.method==='turn/start');
 assert.equal(turns.length,2);
 for(const turn of turns){
  const text=turn.params.input[0].text;
  assert.ok(text.includes('USER-PROVIDED RESUME INSTRUCTIONS'));
  assert.ok(text.includes(clarification));assert.ok(text.includes('do not prove a historical state transition'));
 }
 assert.equal(wire.some(m=>m.method==='thread/start'),false);
 for(const resume of wire.filter(m=>m.method==='thread/resume'))assert.equal(resume.params.threadId,'thread');
 const retained=ReviewStore.open(f.runRoot,store.id);
 assert.equal(retained.data.userInstructions.length,1);
 assert.deepEqual(retained.data.request,{mode:'single',appointment});
 assert.deepEqual(retained.data.appointments[0].verified,{});
 assert.equal(retained.data.appointments[0].shaEditStarted,undefined);
});

function appRequest(app='com.apple.finder') {
 return {threadId:'thread',turnId:'turn',serverName:'cua_repl',mode:'form',message:'Allow Computer Use?',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',connector_id:'computer-use',tool_name:'get_app_state',tool_params:{app},riskLevel:'low'}};
}
test('native app permission reaches the host and continues only after explicit acceptance', async t=>{
 const f=fixture(t,'app-approval'); let prompted=0;
 const r=await runJob({mode:'batch'},{...f,requestAppApproval:async request=>{prompted++;assert.equal(request.appId,'com.apple.finder');return 'accept';}});
 assert.equal(r.outcome,'no_records');assert.equal(prompted,1);
 const response=readWire(f).find(m=>m.id==='permission');assert.equal(response.result.action,'accept');assert.equal(response.result._meta.persist,'session');
});
test('declined app permission stops and preserves resumable state',async t=>{
 const f=fixture(t,'app-approval');await assert.rejects(runJob({mode:'batch'},{...f,requestAppApproval:async()=> 'decline'}),/許可/);
 assert.equal(readWire(f).find(m=>m.id==='permission').result.action,'decline');assert.equal(checkpoints(f).length,1);
});
test('app permissions cannot accept unrelated apps, audio, URL requests, or extra form data',()=>{
 const {appApprovalRequest}=require('../evidence-review/runner.cjs');
 assert.equal(appApprovalRequest(appRequest()).appId,'com.apple.finder');
 for(const app of ['com.apple.Terminal','computer-audio','com.apple.finder.attacker'])assert.equal(appApprovalRequest(appRequest(app)),null);
 for(const modify of [p=>p.serverName='untrusted',p=>p.mode='url',p=>p._meta.tool_name='start_audio_recording',p=>p.requestedSchema.properties={secret:{type:'string'}}]){const p=appRequest();modify(p);assert.equal(appApprovalRequest(p),null);}
});


test('batch consent shows medical data destinations and reaches the user prompt before any browser turn',async t=>{
 const f=fixture(t);let prompt;
 await runJob({mode:'batch'},{...f,requestIntakeConsent:async request=>{prompt=request;assert.ok(!readWire(f).some(m=>m.method==='turn/start'));return 'accept';}});
 assert.match(prompt.message,/201 Bill/);assert.match(prompt.message,/Dropbox/);assert.match(prompt.message,/OpenAI/);assert.match(prompt.message,/Firestore/);assert.match(prompt.message,/Storage/);
 const text=readWire(f).find(m=>m.method==='turn/start').params.input[0].text;
 assert.match(text,/CURRENT EXPLICIT INTAKE AUTHORIZATION/);assert.ok(text.includes(prompt.message));
});
test('missing or declined batch consent retains checkpoint and starts no model turn',async t=>{
 for(const consent of [undefined,async()=> 'decline']){
  const f=fixture(t);await assert.rejects(runJob({mode:'batch'},{...f,requestIntakeConsent:consent}),/保存.*許可/);
  assert.ok(!readWire(f).some(m=>['thread/start','thread/resume','turn/start'].includes(m.method)));assert.equal(checkpoints(f).length,1);
 }
});
test('resuming asks for current scoped review consent; single recovery does not export a bill',async t=>{
 const {ReviewStore}=require('../evidence-review/store.cjs'),f=fixture(t);const store=ReviewStore.create(f.runRoot,{mode:'batch'});
 let calls=0;await runJob({mode:'resume',resumeId:store.id},{...f,requestIntakeConsent:async()=>{calls++;return 'accept';}});assert.equal(calls,1);
 const g=fixture(t),appointment={docId:'synthetic-selected',claimantName:'SYNTHETIC',contractNumber:'TEST.1.2',appointmentDateTimeMs:1791248400000,services:['SHA']};
 const single=ReviewStore.create(g.runRoot,{mode:'single',appointment});
 let singleConsent;
 await assert.rejects(runJob({mode:'resume',resumeId:single.id},{...g,requestIntakeConsent:async request=>{singleConsent=request;return 'accept';}}));
 assert.ok(singleConsent, 'single work must show the actions before a model turn');
 assert.match(singleConsent.message,/TEST\.1\.2/);
 assert.doesNotMatch(singleConsent.message,/201 Bill/);
 const singleText=readWire(g).find(m=>m.method==='turn/start').params.input[0].text;
 assert.match(singleText,/CURRENT EXPLICIT EVIDENCE REVIEW AUTHORIZATION/);
 assert.ok(singleText.includes(singleConsent.message));
 assert.ok(readWire(g).some(m=>m.method==='turn/start'));
});

test('review consent explicitly covers bounded SHA editing and survives resume without broadening scope',async t=>{
 const f=fixture(t,'hang'),{ReviewStore}=require('../evidence-review/store.cjs');
 let consent;
 await assert.rejects(runJob({mode:'batch'},{...f,requestIntakeConsent:async request=>{consent=request;return 'accept';}}));
 assert.match(consent.message,/Yes, Edit Exam/);
 assert.match(consent.message,/Data Entry.*Provider In Progress/);
 for(const section of ['III','IV','VI']) assert.ok(consent.message.includes(section));
 assert.match(consent.message,/署名・送信/);
 const id=checkpoints(f)[0].slice(0,-5);
 const store=ReviewStore.open(f.runRoot,id);
 assert.equal(store.data.reviewAuthorization,undefined, 'consent is not persisted as permission for later invocations');
 const healthy=fixture(t);let resumed;
 await runJob({mode:'resume',resumeId:id},{...f,codexPath:healthy.codexPath,requestIntakeConsent:async request=>{resumed=request;return 'accept';}});
 assert.match(resumed.message,/Yes, Edit Exam/);
 const wire=readWire(healthy),turn=wire.find(m=>m.method==='turn/start');
 assert.ok(turn.params.input[0].text.includes(resumed.message));
 assert.equal(wire.find(m=>m.method==='thread/resume').params.threadId,'thread');
});

test('declined single review consent cannot start a model or browser turn',async t=>{
 const f=fixture(t),appointment={docId:'synthetic-selected',claimantName:'SYNTHETIC',contractNumber:'TEST.1.2',appointmentDateTimeMs:1791248400000,services:['SHA']};
 await assert.rejects(runJob({mode:'single',appointment},{...f,requestIntakeConsent:async()=> 'decline'}),/許可/);
 assert.ok(!readWire(f).some(m=>['thread/start','thread/resume','turn/start'].includes(m.method)));
 assert.equal(checkpoints(f).length,1);
});

test('intake consent timeout and cancellation cannot start a browser turn',async t=>{
 const f=fixture(t);await assert.rejects(runJob({mode:'batch'},{...f,timeouts:{...f.timeouts,approval:20},requestIntakeConsent:()=>new Promise(()=>{})}),/保存.*許可/);
 assert.ok(!readWire(f).some(m=>m.method==='turn/start'));
 const g=fixture(t);let pending;
 const run=runJob({mode:'batch'},{...g,requestIntakeConsent:()=>{setTimeout(()=>process.emit('SIGTERM'),1);return new Promise(resolve=>{pending=resolve;});}});
 assert.equal(await run,null);pending('accept');
 assert.ok(!readWire(g).some(m=>m.method==='turn/start'));assert.equal(checkpoints(g).length,1);
});


test('completion follows cleanup notification and actual app-server exit',async t=>{
 for(const scenario of ['normal','slow-exit']) {
 const f=fixture(t,scenario),events=[];
 await runJob({mode:'batch'},{...f,onEvent:e=>{
  events.push(e);
  if(['completed','no_records'].includes(e.state)){
   const {pid}=JSON.parse(fs.readFileSync(path.join(f.root,'capture.json')));
   assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'completed status must wait for app-server shutdown');
  }
 }});
 assert.ok(events.some(e=>e.state==='progress'&&e.phase==='cleanup'));
 assert.equal(events.at(-1).phase,'complete');
 assert.equal(events.filter(e=>e.state==='no_records').length,1);
 const wire=readWire(f);
 const release=wire.findIndex(m=>m.method==='mcpServer/tool/call');
 const deletion=wire.findIndex(m=>m.method==='thread/delete');
 assert.ok(release>=0&&deletion>release);
 }
});
