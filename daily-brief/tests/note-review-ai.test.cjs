const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {summarizeNote}=require('../note-review-ai.cjs');
for(const service of ['claude','openai'])test(`${service} memo summarizer uses supplied model/effort, bounded output, no tools or secret environment`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'note-ai-fixture-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const exe=path.join(dir,'fixture'),capture=path.join(dir,'capture.json');
 fs.writeFileSync(exe,'#!'+process.execPath+'\n'+`let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const fs=require('fs'),args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args,input,env:process.env,cwd:process.cwd()}));const output={evidenceReview:'Synthetic source p.3; pending study.'};if(args[0]==='exec'){fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(output));}else{process.stdout.write(JSON.stringify({subtype:'success',structured_output:output}));}});`,{mode:0o700});
 assert.equal(await summarizeNote('SYNTHETIC MEMO only',{service,model:'fixture-configurable-model',effort:'medium'},{executable:exe,env:{...process.env,ANTHROPIC_API_KEY:'do-not-inherit',OPENAI_API_KEY:'do-not-inherit'}}),'Synthetic source p.3; pending study.');
 const actual=JSON.parse(fs.readFileSync(capture));assert.equal(actual.args[actual.args.indexOf('--model')+1],'fixture-configurable-model');assert.equal(actual.env.ANTHROPIC_API_KEY,undefined);assert.equal(actual.env.OPENAI_API_KEY,undefined);assert.match(actual.input,/SYNTHETIC MEMO/);assert.equal(fs.existsSync(actual.cwd),false);
 assert.match(actual.input,/Plain Text only/);assert.match(actual.input,/paragraphs separated by blank lines/);assert.match(actual.input,/literal heading Evidence Review/);assert.doesNotMatch(actual.input,/plain Markdown narrative/);
 if(service==='claude'){assert.equal(actual.args[actual.args.indexOf('--effort')+1],'medium');assert.equal(actual.args[actual.args.indexOf('--tools')+1],'');}else{assert.ok(actual.args.includes('features.shell_tool=false'));assert.ok(actual.args.includes('features.memories=false'));assert.ok(actual.args.includes('features.apps=false'));assert.ok(actual.args.includes('--ignore-user-config'));assert.ok(actual.args.includes('model_reasoning_effort="medium"'));}
});
for(const service of ['claude','openai'])test(`${service} rejects Markdown output and removes the isolated fixture workspace`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'note-ai-format-fixture-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const exe=path.join(dir,'fixture'),capture=path.join(dir,'cwd.txt');
 fs.writeFileSync(exe,'#!'+process.execPath+'\n'+`process.stdin.resume();process.stdin.on('end',()=>{const fs=require('fs'),args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(capture)},process.cwd());const output={evidenceReview:'**Synthetic source.pdf p.3, 2021**'};if(args[0]==='exec'){fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(output));}else{process.stdout.write(JSON.stringify({subtype:'success',structured_output:output}));}});`,{mode:0o700});
 await assert.rejects(summarizeNote('SYNTHETIC MEMO only',{service,model:'fixture-model',effort:'medium'},{executable:exe}),/Plain Text/);
 assert.equal(fs.existsSync(fs.readFileSync(capture,'utf8')),false);
});
test('invalid config fails before creating an AI process',async()=>{await assert.rejects(summarizeNote('Synthetic',{service:'claude',model:'fake\nmodel',effort:'medium'}),/設定/)});

function sequenceFixture(t,outputs,delayMs=0){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'note-ai-retry-fixture-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const exe=path.join(dir,'fixture'),capture=path.join(dir,'calls.json');
 fs.writeFileSync(exe,'#!'+process.execPath+'\n'+`let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const fs=require('fs'),args=process.argv.slice(2),file=${JSON.stringify(capture)},calls=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[],outputs=${JSON.stringify(outputs)},output=outputs[Math.min(calls.length,outputs.length-1)];calls.push({input,args,cwd:process.cwd(),env:process.env});fs.writeFileSync(file,JSON.stringify(calls));setTimeout(()=>{if(output.exit){process.exit(output.exit);}if(args[0]==='exec'){fs.writeFileSync(args[args.indexOf('--output-last-message')+1],output.raw||JSON.stringify({evidenceReview:output.body}));}else{process.stdout.write(output.raw||JSON.stringify({subtype:'success',structured_output:{evidenceReview:output.body}}));}},output.delayMs===undefined?${delayMs}:output.delayMs);});`,{mode:0o700});
 return {executable:exe,calls:()=>fs.existsSync(capture)?JSON.parse(fs.readFileSync(capture)):[]};
}
for(const service of ['claude','openai']){
 const selected={service,model:'fixture-configurable-model',effort:'medium'};
 test(`${service} repairs formatting once, validates full unchanged content, and retains isolation`,async t=>{
  const text='Source_A.pdf p.2, 2021: left knee 5/5, -10°; no diagnosis; pending MRI. https://example.test/a_b';
  const f=sequenceFixture(t,[{body:'**'+text+'**'},{body:text}]);
  assert.equal(await summarizeNote('SYNTHETIC MEMO only',selected,{executable:f.executable,env:{...process.env,OPENAI_API_KEY:'never-forward'}}),text);
  const calls=f.calls();assert.equal(calls.length,2);assert.match(calls[1].input,/Correct formatting ONLY/);assert.match(calls[1].input,/Preserve EVERY other word/);assert.match(calls[1].input,/SYNTHETIC MEMO only/);assert.ok(calls[1].input.includes(JSON.stringify('**'+text+'**')));
  for(const call of calls){assert.equal(fs.existsSync(call.cwd),false);assert.equal(call.env.OPENAI_API_KEY,undefined);assert.equal(call.args[call.args.indexOf('--model')+1],selected.model);}
 });
 test(`${service} stops after one repair and rejects clinical content changes`,async t=>{
  for(const second of ['**Left 5/5; no diagnosis; pending MRI.**','Right 5/5; no diagnosis; pending MRI.','Left 4/5; no diagnosis; pending MRI.','Left 5/5; diagnosis; pending MRI.','Left 5/5; no diagnosis; completed MRI.']){
   const f=sequenceFixture(t,[{body:'**Left 5/5; no diagnosis; pending MRI.**'},{body:second}]);
   await assert.rejects(summarizeNote('SYNTHETIC MEMO',selected,{executable:f.executable}),/Plain Text|本文の一致/);
   assert.equal(f.calls().length,2);assert.equal(fs.existsSync(f.calls()[0].cwd),false);
  }
 });
 test(`${service} does not retry ambiguous formats, process failures or malformed JSON; no raw content in error`,async t=>{
  for(const output of [{body:'1. Left 5/5'},{body:'| Side | Value |\n| --- | --- |\n| Left | 5 |'},{exit:1},{raw:'{"evidenceReview":"SyntheticPrivateMarker malformed'}]){
   const f=sequenceFixture(t,[output]);
   await assert.rejects(summarizeNote('SYNTHETIC MEMO',selected,{executable:f.executable}),error=>!error.message.includes('SyntheticPrivateMarker'));
   assert.equal(f.calls().length,1);assert.equal(fs.existsSync(f.calls()[0].cwd),false);
  }
 });
 test(`${service} shares the original timeout budget across the format retry`,async t=>{
  const f=sequenceFixture(t,[{body:'**Synthetic left 5/5**',delayMs:600},{body:'Synthetic left 5/5',delayMs:2500}]);
  const started=Date.now();await assert.rejects(summarizeNote('SYNTHETIC MEMO',selected,{executable:f.executable,timeoutMs:1800}),/時間内/);
  assert.ok(Date.now()-started<2200,'the repair must not receive a fresh timeout budget');
  assert.equal(f.calls().length,2);assert.equal(fs.existsSync(f.calls()[0].cwd),false);
 });
}
for(const service of ['claude','openai'])test(`${service} batch saves only after every repair passes; a changed later memo prevents all writes`,async t=>{
 const {prepareAppointmentsEvidence}=require('../evidence-review.cjs');
 const appointments=[{id:'synthetic-a',notes:'SYNTHETIC MEMO A',claimDetail:'Claim A'},{id:'synthetic-b',notes:'SYNTHETIC MEMO B',claimDetail:'Claim B'}],before=JSON.stringify(appointments);
 const selected={service,model:'fixture-model',effort:'medium'};
 for(const changed of [false,true]){
  const first='Synthetic A: left 5/5; no diagnosis.',second='Synthetic B: right 4/5; pending MRI.';
  const f=sequenceFixture(t,[{body:'**'+first+'**'},{body:first},{body:'**'+second+'**'},{body:changed?second.replace('pending','completed'):second}]);let saves=0,reads=0;
  const operation=prepareAppointmentsEvidence(appointments,{summarize:notes=>summarizeNote(notes,selected,{executable:f.executable}),saveBatch:async changes=>{assert.equal(f.calls().length,4);assert.equal(changes.length,2);saves++;},readBack:async()=>{assert.equal(saves,1);reads++;}});
  if(changed){await assert.rejects(operation,/本文の一致/);assert.equal(saves,0);assert.equal(reads,0);}else{const result=await operation;assert.equal(saves,1);assert.equal(reads,1);assert.ok(result[0].claimDetail.includes(first));assert.ok(result[1].claimDetail.includes(second));}
  assert.equal(JSON.stringify(appointments),before);
 }
});
