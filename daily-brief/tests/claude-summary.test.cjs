const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {generateClaudeSummary}=require('../claude-summary.cjs');
function fixture(t,response){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sos-claude-summary-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const capture=path.join(dir,'capture.json'),exe=path.join(dir,'claude');
 fs.writeFileSync(exe,'#!'+process.execPath+'\n'+`let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{require('fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),input,env:process.env}));process.stdout.write(${JSON.stringify(JSON.stringify(response))});});\n`,{mode:0o700});
 const context={ymd:'2099-01-01',outDir:dir,briefPath:path.join(dir,'brief.md'),scriptPath:path.join(dir,'podcast-script.txt'),prompt:'Synthetic only: no appointments. Keep 2099-01-01.'};
 return {dir,exe,capture,context};
}
test('Claude Summary executes Opus/high without tools and saves both validated outputs',async t=>{
 const f=fixture(t,{type:'result',subtype:'success',is_error:false,structured_output:{brief:'# 2099-01-01\n架空の確認',script:'進行役: 架空の確認です。\n専門役: はい。'}});
 await generateClaudeSummary(f.context,{service:'claude',model:'opus',effort:'high'},{executable:f.exe,env:{...process.env,ANTHROPIC_API_KEY:'synthetic-key',CLAUDECODE:'1'}});
 assert.match(fs.readFileSync(f.context.briefPath,'utf8'),/2099-01-01/);assert.match(fs.readFileSync(f.context.scriptPath,'utf8'),/専門役:/);
 const invocation=JSON.parse(fs.readFileSync(f.capture));
 assert.equal(invocation.args[invocation.args.indexOf('--model')+1],'opus');assert.equal(invocation.args[invocation.args.indexOf('--effort')+1],'high');
 assert.equal(invocation.args[invocation.args.indexOf('--tools')+1],'');assert.ok(invocation.args.includes('--strict-mcp-config'));
 assert.equal(invocation.env.ANTHROPIC_API_KEY,undefined);assert.equal(invocation.env.CLAUDECODE,undefined);
 assert.ok(invocation.input.includes('Synthetic only'));assert.ok(!invocation.input.includes(f.context.briefPath));
});
test('malformed output leaves previous Summary and Podcast untouched',async t=>{
 const f=fixture(t,{type:'result',subtype:'success',is_error:false,structured_output:{brief:'valid',script:'unlabelled'}});
 fs.writeFileSync(f.context.briefPath,'previous brief');fs.writeFileSync(f.context.scriptPath,'previous script');
 await assert.rejects(generateClaudeSummary(f.context,{service:'claude',model:'opus',effort:'high'},{executable:f.exe}),/台本/);
 assert.equal(fs.readFileSync(f.context.briefPath,'utf8'),'previous brief');assert.equal(fs.readFileSync(f.context.scriptPath,'utf8'),'previous script');
});
test('Claude error is never treated as output success',async t=>{
 const f=fixture(t,{type:'result',subtype:'error',is_error:true,result:'synthetic failure'});
 await assert.rejects(generateClaudeSummary(f.context,{service:'claude',model:'opus',effort:'high'},{executable:f.exe}),/Claude/);
 assert.equal(fs.existsSync(f.context.briefPath),false);
});
