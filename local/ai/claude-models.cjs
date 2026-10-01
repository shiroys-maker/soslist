'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {resolveClaude}=require('./claude-path.cjs');
const levels=['low','medium','high','xhigh','max'];
function parseModels(items){
 const models=new Map(),valid=id=>typeof id==='string'&&id.length>0&&id.length<=200&&!/[\r\n\0]/.test(id);
 for(const m of Array.isArray(items)?items:[]){
  if(!valid(m.value))continue;
  const efforts=(m.supportedEffortLevels||[]).filter(x=>levels.includes(x));
  const name=m.displayName||m.value;
  models.set(m.value,{service:'claude',id:m.value,name:name+(m.value==='opus'?'（最新）':''),efforts});
  if(valid(m.resolvedModel)&&m.resolvedModel!==m.value&&!models.has(m.resolvedModel))models.set(m.resolvedModel,{service:'claude',id:m.resolvedModel,name:(m.description||'').replace(/^Use the default model \(currently (.*)\)$/,'$1').split(' · ')[0]||m.resolvedModel,efforts});
 }
 if(!models.size)throw Error('Claude Codeのモデル一覧が空です。');
 return [...models.values()];
}
async function claudeModels(options={}){
 const source=options.env||process.env,executable=options.executable||resolveClaude(source);
 const env=Object.fromEntries(['HOME','USER','LOGNAME','PATH','TMPDIR','LANG','LC_ALL'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'soslist-claude-models-'));
 // Same initialize protocol as the official Agent SDK. No user message or generation request is sent.
 const args=['--safe-mode','--setting-sources','','--settings','{"forceLoginMethod":"claudeai","disableAllHooks":true}','-p','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--no-session-persistence','--permission-mode','dontAsk','--input-format','stream-json','--output-format','stream-json','--verbose'];
 try{return await new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd,env,stdio:['pipe','pipe','pipe']});let buffer='',bytes=0,result,failure;
  const timer=setTimeout(()=>{failure=Error('Claude Codeのモデル一覧取得が時間内に完了しませんでした。');child.kill('SIGKILL');},options.timeoutMs||20000);
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{
   bytes+=chunk.length;if(bytes>2000000){failure=Error('Claude Codeの応答が上限を超えました。');child.kill('SIGKILL');return;}
   buffer+=chunk.toString();let end;
   while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch(_){continue;}
    if(m.type!=='control_response'||m.response?.request_id!=='soslist-models')continue;
    try{if(m.response.subtype!=='success')throw Error('Claude Codeのモデル一覧を取得できませんでした。');result=parseModels(m.response.response?.models);}catch(e){failure=e;}
    child.stdin.end();
   }
  });
  child.once('error',e=>{clearTimeout(timer);reject(Error('Claude Codeを起動できません: '+e.message));});
  child.once('close',code=>{clearTimeout(timer);if(failure)reject(failure);else if(code!==0||!result)reject(Error('Claude Codeのモデル一覧を取得できませんでした。'));else resolve(result);});
  child.stdin.write(JSON.stringify({type:'control_request',request_id:'soslist-models',request:{subtype:'initialize',hooks:null}})+'\n');
 });}finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={claudeModels,parseModels};
