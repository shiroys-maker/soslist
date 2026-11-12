const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
for(const mode of ['manual','scheduled'])for(const action of ['generate','finalize'])for(const skipPrune of [false,true])test(`${mode} ${action} Summary preserves selection and skip-prune=${skipPrune}`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sos-summary-runner-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const daily=path.join(root,'daily-brief'),ai=path.join(root,'local/ai'),out=path.join(root,'output'),settings=path.join(root,'settings.json'),capture=path.join(root,'invocation.json');
 for(const dir of [daily,ai,out])fs.mkdirSync(dir,{recursive:true});
 fs.copyFileSync(path.join(repo,'local/ai/task-settings.cjs'),path.join(ai,'task-settings.cjs'));
 fs.copyFileSync(path.join(repo,'local/ai/claude-path.cjs'),path.join(ai,'claude-path.cjs'));

 fs.copyFileSync(path.join(repo,'daily-brief/claude-summary.cjs'),path.join(daily,'claude-summary.cjs'));
 fs.writeFileSync(path.join(daily,'.env'),'');
 fs.writeFileSync(settings,JSON.stringify({summary:{service:'claude',model:'opus',effort:'high'}}));
 const context={action,count:2,ymd:'2099-01-01',outDir:out,briefPath:path.join(out,'brief.md'),scriptPath:path.join(out,'podcast-script.txt'),prompt:'Synthetic appointment-free Summary'};
 if(action==='finalize')fs.writeFileSync(context.briefPath,'# 2099-01-01 Synthetic existing Summary');
 fs.writeFileSync(path.join(daily,'generate-brief.js'),`const fs=require('fs');if(process.argv.includes('--finalize-prepared')){if(!fs.readFileSync(${JSON.stringify(context.briefPath)},'utf8').includes('2099-01-01'))throw Error('missing Summary');fs.writeFileSync(${JSON.stringify(path.join(root,'finalized.json'))},JSON.stringify(process.argv.slice(2)));}else{const args=process.argv.slice(2),snapshot=JSON.parse(fs.readFileSync(args[args.indexOf('--summary-ai-file')+1]));if(snapshot.model!=='opus'||snapshot.service!=='claude')throw Error('starting snapshot lost');fs.writeFileSync(${JSON.stringify(settings)},JSON.stringify({summary:{service:'openai',model:'changed-during-preprocessing',effort:'low'}}));fs.writeFileSync(${JSON.stringify(path.join(root,'context-mode.json'))},JSON.stringify(process.argv.slice(2)));process.stdout.write(${JSON.stringify(JSON.stringify(context))});}`);
 const exe=path.join(root,'claude');
 fs.writeFileSync(exe,'#!'+process.execPath+'\n'+`let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{require('fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),input}));require('fs').writeFileSync(${JSON.stringify(settings)},JSON.stringify({summary:{service:'openai',model:'next-model',effort:'medium'}}));process.stdout.write(JSON.stringify({subtype:'success',is_error:false,structured_output:{brief:'# 2099-01-01\\n架空',script:'進行役: 架空。\\n専門役: 確認。'}}));});`,{mode:0o700});
 const source=fs.readFileSync(path.join(repo,'daily-brief/run-codex-summary.sh'),'utf8').replace('ROOT_DIR="/Users/shungohiroyasu/Documents/GitHub/soslist"','ROOT_DIR='+quote(root)).replace('NODE_BIN="/Users/shungohiroyasu/.nvm/versions/node/v22.14.0/bin/node"','NODE_BIN='+quote(process.execPath));
 const runner=path.join(daily,'runner.sh');fs.writeFileSync(runner,source);
 const result=spawnSync('/bin/zsh',[runner,...(mode==='manual'?['--date','2099-01-01']:['--scheduled']),...(skipPrune?['--skip-prune']:[])],{encoding:'utf8',env:{...process.env,SOSLIST_AI_SETTINGS_FILE:settings,SOSLIST_CLAUDE_BIN:exe},timeout:15000});
 assert.equal(result.status,0,result.stderr);
 if(action==='generate'){const invocation=JSON.parse(fs.readFileSync(capture));assert.equal(invocation.args[invocation.args.indexOf('--model')+1],'opus');assert.equal(invocation.args[invocation.args.indexOf('--effort')+1],'high');}
 else assert.equal(fs.existsSync(capture),false);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'finalized.json'))),['--finalize-prepared','--date','2099-01-01',...(skipPrune?['--skip-prune']:[]),'--count','2']);
 const contextMode=JSON.parse(fs.readFileSync(path.join(root,'context-mode.json')));assert.ok(contextMode.includes(mode==='manual'?'--codex-context':'--scheduled-context'));assert.ok(contextMode.includes('--summary-ai-file'));
 if(action==='generate'){const record=JSON.parse(fs.readFileSync(path.join(root,'AIExecutions/summary.json')));assert.equal(record.service,'claude');assert.equal(record.model,'opus');assert.equal(record.effort,'high');assert.equal(record.state,'finished');}
 assert.equal(JSON.parse(fs.readFileSync(settings)).summary.service,'openai');
 assert.deepEqual(fs.readdirSync(path.join(daily,'.runtime')),[]);
});
for(const skipPrune of [false,true])test(`scheduled wrapper forwards skip-prune=${skipPrune} without starting a real job`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sos-scheduled-wrapper-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const daily=path.join(root,'daily-brief');fs.mkdirSync(daily);const capture=path.join(root,'args.json');
 fs.writeFileSync(path.join(daily,'run-codex-summary.sh'),'#!'+process.execPath+'\n'+`require('fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));`,{mode:0o700});
 const script=fs.readFileSync(path.join(repo,'daily-brief/run-codex-scheduled-summary.sh'),'utf8').replace('ROOT_DIR="/Users/shungohiroyasu/Documents/GitHub/soslist"','ROOT_DIR='+quote(root)).replace('LOCK_DIR="/tmp/soslist-codex-scheduled-summary.lock"','LOCK_DIR='+quote(path.join(root,'lock')));
 const wrapper=path.join(root,'wrapper.sh');fs.writeFileSync(wrapper,script);
 const result=spawnSync('/bin/zsh',[wrapper,...(skipPrune?['--skip-prune']:[])],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(fs.readFileSync(capture)),['--scheduled',...(skipPrune?['--skip-prune']:[])]);
 assert.equal(fs.existsSync(path.join(root,'lock')),false);
});
for(const skipPrune of [false,true])test(`npm sync-audio command forwards skip-prune=${skipPrune}`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sos-sync-command-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'.env'),'');fs.writeFileSync(path.join(root,'generate-brief.js'),'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
 const command=JSON.parse(fs.readFileSync(path.join(repo,'daily-brief/package.json'))).scripts['sync-audio'].replace('node generate-brief.js',quote(process.execPath)+' generate-brief.js');
 const result=spawnSync('/bin/sh',['-c',command+(skipPrune?' --skip-prune':'')],{cwd:root,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),['--sync-audio',...(skipPrune?['--skip-prune']:[])]);
});
