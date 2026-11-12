'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const defaultDirectory=()=>path.join(os.homedir(),'Library/Application Support/SOSList Local/AuthorizedRecovery/SummaryFailures');
const allowedFormats=new Set(['heading','fence','inline-code','indentation','list-or-quote','divider','table','emphasis','strikethrough','link','reference','html-or-marker','evidence-review-heading']);
function recordFailure({targetDate,draft,corrected,error},{directory=defaultDirectory(),now=()=>new Date()}={}){
 // Explicitly local recovery storage, outside the repository, Dropbox, logs and
 // sync packages. Retain at most ten complete failed responses; never truncate
 // clinical text or delete any existing recovery material automatically.
 if(!['EVIDENCE_REVIEW_FORMAT','EVIDENCE_REVIEW_CONTENT_CHANGED'].includes(error?.code)||typeof draft!=='string')return false;
 const record={schemaVersion:1,createdAt:now().toISOString(),targetDate:/^\d{4}-\d{2}-\d{2}$/.test(targetDate||'')?targetDate:null,stage:'note-review',code:error.code,formats:Array.isArray(error.issues)?error.issues.filter(issue=>allowedFormats.has(issue)):[],draft};
 if(typeof corrected==='string')record.corrected=corrected;
 const body=JSON.stringify(record,null,2)+'\n';if(Buffer.byteLength(body)>262144)return false;
 try{
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const info=fs.lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink())return false;fs.chmodSync(directory,0o700);
  if(fs.readdirSync(directory).filter(name=>/^summary-format-[a-f0-9-]+\.json$/.test(name)).length>=10)return false;
  fs.writeFileSync(path.join(directory,'summary-format-'+randomUUID()+'.json'),body,{flag:'wx',mode:0o600});return true;
 }catch{return false;}
}
module.exports={recordFailure,defaultDirectory};
