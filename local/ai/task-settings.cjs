'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const file=()=>process.env.SOSLIST_AI_SETTINGS_FILE||path.join(os.homedir(),'Library/Application Support/SOSList Local/ai-tasks.json');
const definitions={
 bill:{label:'201 Bill取り込み',scope:'手動・Evidence ReviewからのPDF予約情報解析',service:'openai',model:'gpt-6.1-sol',effort:'medium',env:'SOSPDF_CODEX_MODEL'},
 evidence:{label:'Evidence Review',scope:'単独・一括・再開、SHA MEP入力と紹介状保存を含む同一処理',service:'openai',model:'gpt-6-astra',effort:'high'},
 xray:{label:'XR / CD画像解析',scope:'画像アップロードとCD自動取得後の読影',service:'openai',model:'gpt-6-astra',effort:'high',env:'XRAY_CODEX_MODEL'},
 audiogram:{label:'Audiogram読み取り',scope:'聴力画像の数値転記',service:'openai',model:'gpt-6.1-sol',effort:'high',env:'AUDIOGRAM_CODEX_MODEL'},
 kana:{label:'氏名カナ変換',scope:'QTCローカルツールの氏名変換',service:'openai',model:'gpt-6-luna',effort:'low'},
 summary:{label:'Summary / Podcast原稿生成',scope:'両原稿を同じCLIで生成。手動・定時実行共通',service:'openai',model:'gpt-6-astra',effort:'high'},
 speech:{label:'読み上げ用整形',scope:'Podcast原稿の読み変換・キャッシュ',service:'openai',model:'gpt-6.1-sol',effort:'medium',env:'PODCAST_SPEECH_MODEL'},
 tts:{label:'音声生成',scope:'Gemini TTS。effort指定は非対応',service:'gemini',model:'gemini-3.8-flash-tts',effort:'',env:'GEMINI_TTS_MODEL'}
};
function read(){try{return JSON.parse(fs.readFileSync(file(),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
function choice(id,fallback={}){const d=definitions[id];if(!d)throw Error('Unknown AI task');const saved=read()[id];return {...d,model:(d.env&&process.env[d.env])||d.model,...fallback,...saved};}
function all(){return Object.fromEntries(Object.keys(definitions).map(id=>{
 let execution;try{execution=JSON.parse(fs.readFileSync(path.join(path.dirname(file()),'AIExecutions',id+'.json'),'utf8'));if(execution.state==='running'){try{process.kill(execution.pid,0);}catch(_){execution.state='interrupted';}}}catch(_){}
 return [id,{...choice(id),execution}];}));}
function record(id,selected,state='running',pid=process.pid){try{const dir=path.join(path.dirname(file()),'AIExecutions');fs.mkdirSync(dir,{recursive:true,mode:0o700});const target=path.join(dir,id+'.json');const tmp=target+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({model:selected.model,effort:selected.effort,state,pid,at:new Date().toISOString()}),{mode:0o600});fs.renameSync(tmp,target);}catch(e){if(!["EACCES","EPERM"].includes(e.code))throw e;}}
function begin(id,selected=choice(id)){record(id,selected);return selected;}
function end(id,selected){record(id,selected,'finished');}
function save(input){const previous=read(),next={...previous};for(const [id,d]of Object.entries(definitions)){
 const v=input[id];if(!v||v.service!==d.service||typeof v.model!=='string'||!v.model.trim()||/[\r\n\0]/.test(v.model)||v.model.length>200||!(id==='tts'?v.effort==='':['none','minimal','low','medium','high','xhigh','max','ultra'].includes(v.effort)))throw Error('設定を確認してください: '+d.label);
 next[id]={service:v.service,model:v.model.trim(),effort:v.effort};}
 fs.mkdirSync(path.dirname(file()),{recursive:true,mode:0o700});const temp=file()+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2),{mode:0o600});fs.renameSync(temp,file());return all();}
async function models(){
 const {AppServer}=require('../evidence-review/app-server.cjs');const {resolveCodexPath}=require('../evidence-review/codex-path.cjs');
 const cwd=path.dirname(file());fs.mkdirSync(cwd,{recursive:true,mode:0o700});
 const server=new AppServer({codex:resolveCodexPath(),cwd,cua:null,onEvent:()=>{},onFailure:()=>{},timeoutMs:20000});
 try{await server.rpc('initialize',{clientInfo:{name:'soslist-settings',version:'1.1.0'},capabilities:{experimentalApi:true}});server.write({method:'initialized'});let cursor,data=[];do{const r=await server.rpc('model/list',{limit:100,...(cursor?{cursor}:{} )});data.push(...r.data);cursor=r.nextCursor;}while(cursor);const result=data.filter(x=>!x.hidden).map(x=>({service:'openai',id:x.model||x.id,name:x.displayName||x.model,efforts:(x.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort)}));const key=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY;if(key){try{const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(10000)});if(response.ok){const body=await response.json();for(const m of body.models||[])if(/tts/i.test(m.name))result.push({service:'gemini',id:m.name.replace(/^models\//,''),name:m.displayName,efforts:[]});}}catch(_){} }fs.writeFileSync(path.join(cwd,'ai-models.json'),JSON.stringify(result),{mode:0o600});return result;}
 finally{await server.close();}
}
module.exports={choice,all,save,definitions,models,begin,end,record};
if(require.main===module)(async()=>{const action=process.argv[2];if(action==='get')return all();if(action==='save')return save(JSON.parse(fs.readFileSync(0,'utf8')));if(action==='record'){const id=process.argv[3];record(id,process.argv[6]?{model:process.argv[6],effort:process.argv[7]||''}:choice(id),process.argv[4],Number(process.argv[5]||process.ppid));return {}; }if(action==='value')return choice(process.argv[3])[process.argv[4]];if(action==='models'){try{return {models:await models(),cached:false};}catch(e){try{return {models:JSON.parse(fs.readFileSync(path.join(path.dirname(file()),'ai-models.json'),'utf8')),cached:true,warning:'一覧を取得できなかったため、保存済みの候補を表示しています。'};}catch(_){throw e;}}}throw Error('Unknown action');})().then(x=>process.stdout.write(typeof x==='string'?x:JSON.stringify(x))).catch(e=>{process.stderr.write(e.message);process.exitCode=1;});
