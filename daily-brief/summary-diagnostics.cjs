'use strict';
const stages=new Set(['target-selection','appointments-fetch','evidence-review','note-review','summary-context','finalize']);
const events=new Set(['start','complete','skip','retry','failed','retry-exhausted']);
const formats=new Set(['heading','fence','inline-code','indentation','list-or-quote','divider','table','emphasis','strikethrough','link','reference','html-or-marker','evidence-review-heading']);
const codes=new Map([['NOTE_REVIEW_TIMEOUT','timeout'],['NOTE_REVIEW_OUTPUT_LIMIT','output-limit'],['NOTE_REVIEW_START','provider-start'],['NOTE_REVIEW_PROVIDER','provider-error'],['NOTE_REVIEW_JSON','invalid-json'],['NOTE_REVIEW_SCHEMA','invalid-paragraphs'],['NOTE_REVIEW_EMPTY','empty-output'],['EVIDENCE_REVIEW_FORMAT','evidence-format'],['EVIDENCE_REVIEW_CONTENT_CHANGED','content-changed']]);
function createDiagnostic(targetDate,{write=line=>console.error(line),now=()=>new Date()}={}){
 const date=/^\d{4}-\d{2}-\d{2}$/.test(targetDate||'')?targetDate:null;
 const diagnostic=(stage,event,error)=>{
  const record={timestamp:now().toISOString(),targetDate:date,stage:stages.has(stage)?stage:'summary-context',event:events.has(event)?event:'failed',classification:error?(codes.get(error.code)||'processing-error'):'none'};
  if(error?.code==='EVIDENCE_REVIEW_FORMAT'&&Array.isArray(error.issues))record.formats=[...new Set(error.issues.filter(issue=>formats.has(issue)))];
  if(typeof error?.recoveryRecorded==='boolean')record.recoveryRecorded=error.recoveryRecorded;
  if(['wrappers','flat-list'].includes(error?.repairKind))record.repairKind=error.repairKind;
  write('[summary-diagnostic] '+JSON.stringify(record));
 };
 Object.defineProperty(diagnostic,'targetDate',{value:date});return diagnostic;
}
async function withStage(diagnostic,stage,operation){diagnostic(stage,'start');try{const value=await operation();diagnostic(stage,'complete');return value;}catch(error){diagnostic(stage,'failed',error);throw error;}}
module.exports={createDiagnostic,withStage};
