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
