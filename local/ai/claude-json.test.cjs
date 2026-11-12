const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {runClaudeJSON}=require('./claude-json.cjs');
test('Claude JSON runner isolates API keys, passes model/effort/schema and returns structured output',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sos-claude-json-')),bin=path.join(dir,'claude'),log=path.join(dir,'args.json');
 fs.writeFileSync(bin,`#!${process.execPath}\nlet input='';process.stdin.on('data',c=>input+=c).on('end',()=>{require('fs').writeFileSync(${JSON.stringify(log)},JSON.stringify({argv:process.argv.slice(2),input,key:process.env.ANTHROPIC_API_KEY||null}));process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:{edits:[]}}));});\n`,{mode:0o755});
 try{
  const out=await runClaudeJSON({prompt:'台本',schema:{type:'object'},model:'opus',effort:'medium',systemPrompt:'s'},{executable:bin,env:{...process.env,ANTHROPIC_API_KEY:'test-only'}});
  assert.deepEqual(out,{edits:[]});
  const seen=JSON.parse(fs.readFileSync(log));
  assert.equal(seen.key,null);assert.equal(seen.input,'台本');
  assert.equal(seen.argv[seen.argv.indexOf('--model')+1],'opus');assert.equal(seen.argv[seen.argv.indexOf('--effort')+1],'medium');
  assert.equal(seen.argv[seen.argv.indexOf('--tools')+1],'');
  await assert.rejects(runClaudeJSON({prompt:'x',schema:{},model:'opus',effort:'ultra',systemPrompt:'s'},{executable:bin}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
