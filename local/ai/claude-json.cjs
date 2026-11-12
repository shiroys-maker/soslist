'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {resolveClaude}=require('./claude-path.cjs');
// Schema-bound Claude Code generation with the Claude subscription. No tools, MCP, hooks, memory or session file.
async function runClaudeJSON({prompt,schema,model,effort,systemPrompt,timeoutMs=300000,label='Claude Code'},options={}){
 if(typeof model!=='string'||!model||!['low','medium','high','xhigh','max'].includes(effort))throw Error(label+'のモデル・effort設定を確認してください。');
 const sourceEnv=options.env||process.env;
 const env=Object.fromEntries(['HOME','USER','LOGNAME','PATH','TMPDIR','LANG','LC_ALL'].filter(k=>sourceEnv[k]!==undefined).map(k=>[k,sourceEnv[k]]));
 const executable=options.executable||resolveClaude(sourceEnv),workdir=fs.mkdtempSync(path.join(os.tmpdir(),'soslist-claude-json-'));
 const args=['--safe-mode','--setting-sources','','--settings',JSON.stringify({forceLoginMethod:'claudeai',disableAllHooks:true}),'-p','--tools','','--disallowedTools','mcp__*','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--no-session-persistence','--permission-mode','dontAsk','--model',model,'--effort',effort,'--output-format','json','--json-schema',JSON.stringify(schema),'--system-prompt',systemPrompt];
 try{
  const raw=await new Promise((resolve,reject)=>{
   const child=spawn(executable,args,{cwd:workdir,env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',failure;const stop=()=>child.kill('SIGKILL');
   const timer=setTimeout(()=>{failure=Error(label+'が時間内に完了しませんでした。再実行してください。');stop();},timeoutMs);
   child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(Buffer.byteLength(stdout)>8000000){failure=Error(label+'の出力が上限を超えました。');stop();}});
   child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8192);});
   child.stdin.on('error',()=>{});
   child.once('error',error=>{clearTimeout(timer);reject(Error('Claude Codeを起動できません: '+error.message));});
   child.once('close',code=>{clearTimeout(timer);if(failure)reject(failure);else if(code!==0)reject(Error(/usage limit|rate limit|quota/i.test(stderr+stdout)?'Claude Codeの利用上限により'+label+'を実行できません。':label+'に失敗しました。Claudeサブスクリプションのログイン・利用上限を確認してください。'));else resolve(stdout);});
   child.stdin.end(prompt);
  });
  let result;try{result=JSON.parse(raw);}catch(_){throw Error(label+'の結果を読み取れません。');}
  if(result.is_error||result.subtype!=='success'||!result.structured_output||typeof result.structured_output!=='object')throw Error(label+'に失敗しました。ログイン・モデル・利用上限を確認してください。');
  return result.structured_output;
 }finally{fs.rmSync(workdir,{recursive:true,force:true});}
}
module.exports={runClaudeJSON};
