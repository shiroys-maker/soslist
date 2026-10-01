const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const api=require('./claude-models.cjs');
test('Claude initialization returns aliases, versioned IDs and model-specific effort without a prompt',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'claude-model-test-')),bin=path.join(dir,'claude'),capture=path.join(dir,'capture.json');
 fs.writeFileSync(bin,`#!/usr/bin/env node\nconst fs=require('fs');process.stdin.once('data',c=>{const req=JSON.parse(c);fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({req,args:process.argv.slice(2),env:process.env,cwd:process.cwd()}));console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:req.request_id,response:{models:[{value:'opus',resolvedModel:'claude-opus-5-5',displayName:'Opus',description:'Opus 5.5 · Best for everyday',supportedEffortLevels:['low','high','max']},{value:'sonnet',resolvedModel:'claude-sonnet-5',displayName:'Sonnet',description:'Sonnet 5 · Routine'}]}}}));});process.stdin.on('end',()=>process.exit(0));\n`,{mode:0o700});
 try{
  const models=await api.claudeModels({executable:bin,env:{...process.env,ANTHROPIC_API_KEY:'secret',CLAUDE_CODE_OAUTH_TOKEN:'secret'}});
  assert.deepEqual(models.map(m=>m.id),['opus','claude-opus-5-5','sonnet','claude-sonnet-5']);
  assert.equal(models[1].name,'Opus 5.5');assert.deepEqual(models[1].efforts,['low','high','max']);
  const got=JSON.parse(fs.readFileSync(capture));assert.equal(got.req.request.subtype,'initialize');assert.equal(got.req.type,'control_request');assert.ok(got.args.includes('stream-json'));assert.equal(got.env.ANTHROPIC_API_KEY,undefined);assert.equal(got.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.equal(fs.existsSync(got.cwd),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Claude rejects empty catalogs and mismatched or failed initialization responses',()=>{
 assert.throws(()=>api.parseModels([]));assert.throws(()=>api.parseModels([{value:'\ninvalid'}]));
});
test('subscription catalog with 1M Opus identifies the resolved version clearly',()=>{
 const models=api.parseModels([{value:'default',resolvedModel:'claude-opus-5-5[1m]',displayName:'Default (recommended)',description:'Use the default model (currently Opus 5.5 (1M context)) · Best for everyday',supportedEffortLevels:['medium','high']},{value:'opus[1m]',resolvedModel:'claude-opus-5-5[1m]',displayName:'Opus (1M context)',description:'Opus 5.5 · Best for everyday'}]);
 assert.equal(models.find(m=>m.id==='claude-opus-5-5[1m]').name,'Opus 5.5 (1M context)');
 assert.equal(models.filter(m=>m.id==='claude-opus-5-5[1m]').length,1);
});
