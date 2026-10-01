const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
test('all tasks retain defaults, independent custom IDs survive restart, and active snapshot stays separate',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sos-ai-test-'));const previous=process.env.SOSLIST_AI_SETTINGS_FILE;process.env.SOSLIST_AI_SETTINGS_FILE=path.join(dir,'tasks.json');
 try{const api=require('./task-settings.cjs');const initial=api.all();assert.equal(initial.bill.model,'gpt-6.1-sol');assert.equal(initial.evidence.model,'gpt-6-astra');
 api.begin('xray',initial.xray);initial.xray.model='fixture-next-xray';initial.xray.effort='medium';api.save(initial);
 const got=spawnSync(process.execPath,[__filename.replace('task-settings.test.cjs','task-settings.cjs'),'get'],{encoding:'utf8',env:process.env});assert.equal(got.status,0);const reloaded=JSON.parse(got.stdout);
 assert.equal(reloaded.xray.model,'fixture-next-xray');assert.equal(reloaded.xray.execution.model,'gpt-6-astra');assert.equal(reloaded.summary.model,'gpt-6-astra');
 assert.equal(fs.statSync(process.env.SOSLIST_AI_SETTINGS_FILE).mode&0o777,0o600);
 assert.throws(()=>api.save({...initial,kana:{...initial.kana,service:'gemini'}}));
 }finally{previous===undefined?delete process.env.SOSLIST_AI_SETTINGS_FILE:process.env.SOSLIST_AI_SETTINGS_FILE=previous;fs.rmSync(dir,{recursive:true,force:true});}
});

test('Summary saves Claude Opus and keeps separate Codex and Claude selections across restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sos-summary-settings-')),previous=process.env.SOSLIST_AI_SETTINGS_FILE;
 process.env.SOSLIST_AI_SETTINGS_FILE=path.join(dir,'tasks.json');
 try{
  const api=require('./task-settings.cjs'),tasks=api.all();
  tasks.summary.model='gpt-6.1-sol';tasks.summary.effort='medium';tasks.summary=api.save(tasks).summary;
  tasks.summary={...tasks.summary,service:'claude',model:'opus',effort:'high'};
  api.save(tasks);
  const result=spawnSync(process.execPath,[path.join(__dirname,'task-settings.cjs'),'get'],{encoding:'utf8',env:process.env});
  assert.equal(result.status,0);
  const saved=JSON.parse(result.stdout).summary;
  assert.equal(saved.service,'claude');assert.equal(saved.model,'opus');assert.equal(saved.effort,'high');
  assert.deepEqual(saved.selections.openai,{model:'gpt-6.1-sol',effort:'medium'});
  assert.deepEqual(saved.selections.claude,{model:'opus',effort:'high'});
  assert.equal(api.choice('evidence').service,'openai');
  api.begin('summary',saved);
  tasks.summary={...saved,service:'openai',model:'gpt-6.1-sol',effort:'medium'};api.save(tasks);
  const active=api.all().summary.execution;assert.equal(active.service,'claude');assert.equal(active.model,'opus');
  assert.throws(()=>api.save({...tasks,summary:{...saved,effort:'ultra'}}));
  assert.throws(()=>api.save({...tasks,evidence:{...tasks.evidence,service:'claude',model:'opus'}}));
 }finally{previous===undefined?delete process.env.SOSLIST_AI_SETTINGS_FILE:process.env.SOSLIST_AI_SETTINGS_FILE=previous;fs.rmSync(dir,{recursive:true,force:true});}
});

test('model refresh replaces each successful provider and preserves only failed providers from cache',async()=>{
 const api=require('./task-settings.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sos-catalog-test-')),cacheFile=path.join(dir,'models.json');
 try{
  fs.writeFileSync(cacheFile,JSON.stringify([{service:'openai',id:'old-codex'},{service:'claude',id:'old-claude'}]));
  const result=await api.models({cacheFile,providers:{openai:async()=>{throw Error('offline');},claude:async()=>[{service:'claude',id:'claude-opus-5-5',name:'Opus 5.5',efforts:['high']}]}});
  assert.equal(result.cached,true);assert.match(result.warning,/Codex/);assert.ok(!result.warning.includes('Claude Code'));
  assert.deepEqual(result.models.map(m=>m.id),['old-codex','claude-opus-5-5']);
  const next=await api.models({cacheFile,providers:{openai:async()=>[{service:'openai',id:'new-codex'}],claude:async()=>{throw Error('offline');}}});
  assert.deepEqual(next.models.map(m=>m.id),['new-codex','claude-opus-5-5']);assert.match(next.warning,/Claude Code/);
  assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile)),next.models);
  const refreshed=await api.models({cacheFile,providers:{claude:async()=>[{service:'claude',id:'new-opus'}]}});assert.equal(refreshed.cached,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
