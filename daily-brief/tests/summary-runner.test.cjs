const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
for(const mode of ['manual','scheduled'])test(`${mode} Summary runs the saved Claude selection and retains its starting snapshot`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sos-summary-runner-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const daily=path.join(root,'daily-brief'),ai=path.join(root,'local/ai'),out=path.join(root,'output'),settings=path.join(root,'settings.json'),capture=path.join(root,'invocation.json');
 for(const dir of [daily,ai,out])fs.mkdirSync(dir,{recursive:true});
 fs.copyFileSync(path.join(repo,'local/ai/task-settings.cjs'),path.join(ai,'task-settings.cjs'));
 fs.copyFileSync(path.join(repo,'local/ai/claude-path.cjs'),path.join(ai,'claude-path.cjs'));

 fs.copyFileSync(path.join(repo,'daily-brief/claude-summary.cjs'),path.join(daily,'claude-summary.cjs'));
 fs.writeFileSync(path.join(daily,'.env'),'');
 fs.writeFileSync(settings,JSON.stringify({summary:{service:'claude',model:'opus',effort:'high'}}));
 const context={action:'generate',ymd:'2099-01-01',outDir:out,briefPath:path.join(out,'brief.md'),scriptPath:path.join(out,'podcast-script.txt'),prompt:'Synthetic appointment-free Summary'};
 fs.writeFileSync(path.join(daily,'generate-brief.js'),`const fs=require('fs');if(process.argv.includes('--finalize-prepared')){if(!fs.readFileSync(${JSON.stringify(context.briefPath)},'utf8').includes('2099-01-01'))throw Error('missing Summary');fs.writeFileSync(${JSON.stringify(path.join(root,'finalized.json'))},JSON.stringify(process.argv.slice(2)));}else{fs.writeFileSync(${JSON.stringify(path.join(root,'context-mode.json'))},JSON.stringify(process.argv.slice(2)));process.stdout.write(${JSON.stringify(JSON.stringify(context))});}`);
 const exe=path.join(root,'claude');
 fs.writeFileSync(exe,'#!'+process.execPath+'\n'+`let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{require('fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),input}));require('fs').writeFileSync(${JSON.stringify(settings)},JSON.stringify({summary:{service:'openai',model:'next-model',effort:'medium'}}));process.stdout.write(JSON.stringify({subtype:'success',is_error:false,structured_output:{brief:'# 2099-01-01\\n架空',script:'進行役: 架空。\\n専門役: 確認。'}}));});`,{mode:0o700});
 const source=fs.readFileSync(path.join(repo,'daily-brief/run-codex-summary.sh'),'utf8').replace('ROOT_DIR="/Users/shungohiroyasu/Documents/GitHub/soslist"','ROOT_DIR='+quote(root)).replace('NODE_BIN="/Users/shungohiroyasu/.nvm/versions/node/v22.14.0/bin/node"','NODE_BIN='+quote(process.execPath));
 const runner=path.join(daily,'runner.sh');fs.writeFileSync(runner,source);
 const result=spawnSync('/bin/zsh',[runner,...(mode==='manual'?['--date','2099-01-01']:['--scheduled'])],{encoding:'utf8',env:{...process.env,SOSLIST_AI_SETTINGS_FILE:settings,SOSLIST_CLAUDE_BIN:exe},timeout:15000});
 assert.equal(result.status,0,result.stderr);
 const invocation=JSON.parse(fs.readFileSync(capture));assert.equal(invocation.args[invocation.args.indexOf('--model')+1],'opus');assert.equal(invocation.args[invocation.args.indexOf('--effort')+1],'high');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'finalized.json'))),['--finalize-prepared','--date','2099-01-01']);
 const contextMode=JSON.parse(fs.readFileSync(path.join(root,'context-mode.json')));assert.ok(contextMode.includes(mode==='manual'?'--codex-context':'--scheduled-context'));
 const record=JSON.parse(fs.readFileSync(path.join(root,'AIExecutions/summary.json')));assert.equal(record.service,'claude');assert.equal(record.model,'opus');assert.equal(record.effort,'high');assert.equal(record.state,'finished');
 assert.equal(JSON.parse(fs.readFileSync(settings)).summary.service,'openai');
 assert.deepEqual(fs.readdirSync(path.join(daily,'.runtime')),[]);
});
