const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {Writable}=require('node:stream');
const {once}=require('node:events');
const {spawnSync}=require('node:child_process');
const dir=path.resolve(__dirname,'..');
function harness(t){
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'summary-view-test-'));
 t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
 fs.mkdirSync(path.join(output,'2099-01-01'));
 fs.writeFileSync(path.join(output,'2099-01-01','podcast.mp3'),Buffer.from('synthetic audio'));
 let handler;let syncs=0;
 const ctx=vm.createContext({require:n=>n==='http'?{createServer:fn=>{handler=fn;return {listen(){}};}}:
 n==='./generate-brief'?{getExistingBriefResult:date=>({exists:date==='2099-01-01',ymd:date,summaryMarkdown:'# Synthetic brief',audioFile:path.join(output,date,'podcast.mp3')}),
 saveBriefToFirestore:async()=>{syncs++;}}:require(n),
 process:{env:{OUTPUT_DIR:output}},__dirname:dir,URL,console:{log(){},error(){}},fetch:()=>assert.fail('external request')});
 vm.runInContext(fs.readFileSync(path.join(dir,'server.js'),'utf8'),ctx);
 return {get syncs(){return syncs;},async request(method,url,headers={}){
  const chunks=[];const res=new Writable({write(c,e,cb){chunks.push(c);cb();}});
  res.headers={};res.setHeader=(k,v)=>res.headers[k]=v;
  res.writeHead=(status,headers={})=>{res.status=status;Object.assign(res.headers,headers);};
  const done=once(res,'finish');await handler({method,url,headers:{host:'localhost',...headers}},res);await done;
  return {status:res.status,headers:res.headers,body:Buffer.concat(chunks).toString()};
 }};
}
test('root and legacy generate-mode URL are view-only; removed POST has no work',async t=>{
 const h=harness(t);
 for(const url of ['/','/summary-popup?date=2099-01-01&mode=generate']){
  const r=await h.request('GET',url);assert.equal(r.status,200);
  assert.doesNotMatch(r.body,/api\/generate|regenerateButton|id="go"|id="sample"|id="noAudio"/);
 }
 const r=await h.request('POST','/api/generate');assert.equal(r.status,404);assert.equal(h.syncs,0);
});
test('existing and missing summaries retain status responses and existing sync',async t=>{
 const h=harness(t);const a=await h.request('GET','/api/brief-status?date=2099-01-01');
 assert.equal(a.status,200);const data=JSON.parse(a.body);assert.equal(data.summaryMarkdown,'# Synthetic brief');
 assert.equal(data.audioUrl,'/audio/2099-01-01/podcast.mp3');assert.equal(h.syncs,1);
 const b=await h.request('GET','/api/brief-status?date=2099-01-02');assert.equal(JSON.parse(b.body).exists,false);
});
test('audio full and partial range remain available',async t=>{
 const h=harness(t);const a=await h.request('GET','/audio/2099-01-01/podcast.mp3');assert.equal(a.status,200);assert.equal(a.body,'synthetic audio');
 const b=await h.request('GET','/audio/2099-01-01/podcast.mp3',{range:'bytes=0-3'});assert.equal(b.status,206);assert.equal(b.body,'synt');
});
test('removed CLI and provider functions cannot generate; native runner stays Astra/high',()=>{
 const api=require('../generate-brief');assert.equal(api.run,undefined);
 for(const args of [[],['--sample'],['--date','2099-01-01']]){
  const r=spawnSync(process.execPath,[path.join(dir,'generate-brief.js'),...args],{encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.equal(r.status,1);assert.match(r.stderr,/APIによる新規生成は廃止/);
 }
 const s=fs.readFileSync(path.join(dir,'generate-brief.js'),'utf8');
 assert.doesNotMatch(s,/api\.anthropic|require\('openai'\)|createJsonCompletion|PODCAST_FALLBACK_MODEL|async function run\(/);
 const runner=fs.readFileSync(path.join(dir,'run-codex-summary.sh'),'utf8');
 assert.match(runner,/--model gpt-6-astra/);assert.match(runner,/model_reasoning_effort="high"/);
 for(const mode of ['--scheduled-context','--codex-context','--finalize-prepared'])assert.ok(runner.includes(mode));
});

test('native button still sends the selected date; browser fallback never requests generation',()=>{
 const source=fs.readFileSync(path.join(dir,'../local/script.js'),'utf8');
 const start=source.indexOf('function handleSummaryGenerate()');
 const end=source.indexOf('function handleSummaryShow()',start);
 const sent=[];let message='';
 const ctx=vm.createContext({summaryDateInput:{value:'2099-01-01'},window:{},
 alert:()=>assert.fail('unexpected alert'),updateSummaryStatus:s=>message=s});
 vm.runInContext(source.slice(start,end),ctx);ctx.handleSummaryGenerate();assert.match(message,/SOSList Local/);
 ctx.window.webkit={messageHandlers:{startSummaryGeneration:{postMessage:p=>sent.push(p)}}};
 ctx.handleSummaryGenerate();assert.equal(sent.length,1);assert.equal(sent[0].date,'2099-01-01');
 assert.match(source,/generateSummaryButton.hidden = !window.webkit\?\.messageHandlers\?\.startSummaryGeneration/);
});
