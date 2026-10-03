'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const states=new Set(['running','waitingQueue','waitingInput','awaitingApproval','idle','failed','succeeded','interrupted','unknown']);
const terminal=new Set(['failed','succeeded','interrupted']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const utc=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const disabled=()=>({enabled:false,begin:()=>({id:null,transition(){},awaitApproval(){return null;},resolveApproval(){},succeed(){},fail(){},interrupt(){}}),heartbeat(){},close(){}});
// Read only the explicitly installed anonymous-output config; never app/patient settings.
function configuredDirectory(home=os.homedir()) {
 const base=path.join(home,'Library/Application Support/Codex Activity Monitor');let fd;
 try {
  const owner=os.userInfo().uid,dir=fs.lstatSync(base);
  if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==owner||(dir.mode&0o077)!==0)return null;
  fd=fs.openSync(path.join(base,'config.json'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const info=fs.fstatSync(fd);
  if(!info.isFile()||info.uid!==owner||(info.mode&0o077)!==0||info.size>4096)return null;
  const config=JSON.parse(fs.readFileSync(fd,'utf8'));
  if(Object.keys(config).sort().join(',')!=='reportsDirectory,schemaVersion'||config.schemaVersion!==1||typeof config.reportsDirectory!=='string'||!path.isAbsolute(config.reportsDirectory))return null;
  return config.reportsDirectory;
 } catch {return null;} finally {if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
function defaultDirectory(){return process.env.CODEX_ACTIVITY_DIRECTORY!==undefined?process.env.CODEX_ACTIVITY_DIRECTORY||null:configuredDirectory();}
function createReporter({category,device='macbook',kind='worker',directory=defaultDirectory()}={}){
 if(!['soslist','dbq','other'].includes(category)||!['macbook','macMini'].includes(device)||!['app','worker'].includes(kind))throw Error('Invalid anonymous reporter configuration');
 if(!directory||!path.isAbsolute(directory))return disabled();
 try{const s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==os.userInfo().uid||(s.mode&0o077)!==0)return disabled();}catch{return disabled();}
 const producerID=randomUUID(),epoch=randomUUID(),target=path.join(directory,producerID+'.producer.json');
 const tasks=new Map();let sequence=0,closed=false,healthy=true;
 function publish(presence='running'){
  if(!healthy)return;
  const value={schemaVersion:1,device,category,producerID,epoch,sequence:++sequence,capturedAt:utc(),producerKind:kind,producerPresence:presence,tasks:[...tasks.values()]};
  const temp=path.join(directory,'.'+producerID+'.'+randomUUID()+'.tmp');
  try{const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>262144)throw Error('Anonymous status too large');fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(temp,target);}catch{healthy=false;try{fs.unlinkSync(temp);}catch{}}
 }
 function begin(state='running',evidence='instrumented'){
  if(closed)return disabled().begin();
  if(!states.has(state)||!['instrumented','unmeasured'].includes(evidence)||evidence==='unmeasured'&&state!=='unknown'||state==='awaitingApproval')throw Error('Invalid anonymous task state');
  if(tasks.size>=128){const prior=[...tasks.values()].find(t=>terminal.has(t.state));if(prior)tasks.delete(prior.id);else return disabled().begin();}
  const record={id:randomUUID(),state,evidence,updatedAt:utc()};tasks.set(record.id,record);publish();
  function transition(next,options={}){
   if(closed)return;
   if(!states.has(next)||Object.keys(options).some(k=>k!=='approvalRequestID')||terminal.has(record.state)&&next!==record.state||record.evidence==='unmeasured'&&next!=='unknown')throw Error('Invalid anonymous task transition');
   if((next==='awaitingApproval')!==!!options.approvalRequestID||options.approvalRequestID&&!uuid.test(options.approvalRequestID))throw Error('Invalid anonymous approval identifier');
   record.state=next;record.updatedAt=utc();delete record.approvalRequestID;
   if(next==='awaitingApproval')record.approvalRequestID=options.approvalRequestID;
   publish();
  }
  return {id:record.id,transition,
   awaitApproval(){const request=record.approvalRequestID||randomUUID();transition('awaitingApproval',{approvalRequestID:request});return request;},
   resolveApproval(next='running'){transition(next);},
   succeed(){transition('succeeded');},fail(){transition('failed');},interrupt(){transition('interrupted');}};
 }
 function close(){if(closed)return;closed=true;clearInterval(timer);publish('stopped');process.removeListener('exit',exit);}
 const timer=setInterval(()=>publish(),5000);timer.unref();
 const exit=()=>close();process.once('exit',exit);publish();
 return {enabled:true,begin,heartbeat:()=>{if(!closed)publish();},close};
}
exports.createReporter=createReporter;
exports.configuredDirectory=configuredDirectory;
