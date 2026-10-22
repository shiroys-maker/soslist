'use strict';
const {createHash}=require('node:crypto');
const checksum=body=>createHash('sha256').update(body,'utf8').digest('hex');
const BEGIN='<!-- soslist-evidence-review:start -->',END='<!-- soslist-evidence-review:end -->';
const heading=/^(?:#{1,6}\s+)?Evidence\s*Review\s*:?[ \t]*\r?$/gim;
// Categories are fixed identifiers, never excerpts of clinical input.
// Preserve numeric comparisons exactly; do not treat a pure spaced numeric
// expression as a quotation. Other spaced/nested quote syntax stays rejected.
function numericComparisonLine(line){
 if(/^[ \t]*>=?[+-]?(?:\d|\.\d)/.test(line))return true;
 return /^[ \t]*>(?:[ \t]*=)?[ \t]+[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[ \t]*(?:%|mm(?:Hg)?|cm|m|mg(?:\/dL)?|g|kg|dB|Hz|bpm|ms|s|°[CF]?))?[ \t]*[.;]?[ \t]*$/i.test(line);
}
function listOrQuote(body){return body.split(/\r?\n/).some(line=>/^[ \t]*(?:[-+*•][ \t]+|\d+[.)][ \t]+)/.test(line)||(/^[ \t]*>/.test(line)&&!numericComparisonLine(line)));}
const formatRules=[
 ['heading',/^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/m],
 ['fence',/^[ \t]*(?:`{3,}|~{3,})/m], ['inline-code',/`/],
 ['indentation',/^(?: {4}|\t)[ \t]*\S/m],
 ['list-or-quote',/^[ \t]*(?:[-+*•][ \t]+|\d+[.)][ \t]+|>)/m],
 ['divider',/^[ \t]*(?:[-=]+|(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/m],
 ['table',/^[ \t]*\|/m], ['table',/^[ \t]*\S[^\n]*\|[^\n]*\r?\n[ \t]*:?-+:?[ \t]*\|/m],
 // Literal underscores in identifiers and blank/redaction runs are content.
 ['emphasis',/\*{2,}[^\s*](?:[\s\S]*?[^\s*])?\*{2,}|(?<!\w)_{2,}[^\s_](?:[\s\S]*?[^\s_])?_{2,}(?!\w)/], ['strikethrough',/~~[\s\S]+?~~/],
 ['emphasis',/(?:^|[^\w])\*[^\s*][^*]*\*(?=$|[^\w])/m],
 ['emphasis',/(?:^|[^\w])_[^\s_][^_]*_(?=$|[^\w])/m],
 ['link',/!?\[[^\]\n]*\]\([\s\S]*?\)/], ['link',/\[[^\]\n]+\]\[[^\]\n]*\]/],
 ['reference',/^[ \t]*\[[^\]\n]+\]:[ \t]*\S/m], ['reference',/\[\^[^\]\n]+\]/],
 ['html-or-marker',/<!--[\s\S]*?-->|<!--|<\/?[a-z][^>\n]*>|<(?:https?:\/\/|mailto:)[^>\n]+>/i],
 ['evidence-review-heading',heading],
];
function evidenceReviewFormatIssues(body){return [...new Set(formatRules.filter(([name,pattern])=>{pattern.lastIndex=0;const found=name==='list-or-quote'?listOrQuote(body):pattern.test(body);pattern.lastIndex=0;return found;}).map(([name])=>name))];}
function validateEvidenceReviewText(body){
 if(typeof body!=='string'||!body.trim())throw Error('Evidence Reviewの要約が空または不正です。');
 // Reject formatting rather than stripping it: conversion can erase clinical
 // punctuation, table relationships, source URLs or ordered chronology.
 const issues=evidenceReviewFormatIssues(body);
 if(issues.length){const error=Error('Evidence ReviewがPlain Textではありません。Markdown等を自動変換せず、Claim詳細を保持して保存前に停止します。 [format: '+issues.join(', ')+']');error.code='EVIDENCE_REVIEW_FORMAT';error.issues=issues;throw error;}
 return body.trim();
}
function formattingOnlyReference(draft){
 const allowed=new Set(['heading','fence','inline-code','indentation','emphasis','evidence-review-heading']);
 if(evidenceReviewFormatIssues(draft).some(issue=>!allowed.has(issue)))return null;
 let reference=draft.trim();
 // This projection is used ONLY for equality checks, never returned for saving.
 // Ambiguous structures (tables, lists, deletion markup, links) cannot be repaired.
 if(evidenceReviewFormatIssues(reference).includes('fence')){
  const wrapper=reference.match(/^(`{3,}|~{3,})(?:text|plaintext|plain text|markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n\1$/i);
  if(!wrapper)return null;reference=wrapper[2];
 }
 reference=reference.replace(heading,'').replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm,'').replace(/^(?: {4}|\t)[ \t]*/gm,'');
 reference=reference.replace(/(?<!\w)(\*\*|__)(\S[\s\S]*?\S|\S)\1(?!\w)/g,(match,marker,content)=>/[^\s*_]/.test(content)?content:match);
 reference=reference.replace(/(^|[^\w])([*_])([^\s*_][^\n]*?)\2(?=$|[^\w])/gm,'$1$3');
 reference=reference.replace(/`([^`\r\n]+)`/g,'$1');
 try{validateEvidenceReviewText(reference);}catch{return null;}
 return reference.replace(/\s+/g,' ').trim();
}
function formattingRepairPlan(draft){
 const reference=formattingOnlyReference(draft);
 if(reference!==null)return {kind:'wrappers',reference};
 // Only unambiguous Unicode bullets can be mapped to separate paragraphs.
 // ASCII +/- may encode a positive/negative clinical finding: never erase them.
 // Nested, ordered, mixed prose, numerical-minus and quote structures remain
 // ambiguous. Never erase ordering numbers or quotation meaning.
 const lines=draft.trim().split(/\r?\n/).filter(line=>line.trim());
 if(!lines.length)return null;
 const items=lines.map(line=>line.match(/^•[ \t]+([A-Za-z][^\r\n]*)$/)?.[1]);
 if(items.some(item=>item===undefined))return null;
 const references=items.map(formattingOnlyReference);
 if(references.some(item=>item===null))return null;
 return {kind:'flat-list',reference:references.join(' '),items:references};
}
function assertFormattingOnlyCorrection(draft,corrected){
 validateEvidenceReviewText(corrected);
 const plan=formattingRepairPlan(draft);
 const paragraphs=corrected.trim().split(/\r?\n[ \t]*\r?\n/).map(item=>item.replace(/\s+/g,' ').trim());
 if(!plan||plan.reference!==corrected.replace(/\s+/g,' ').trim()||(plan.kind==='flat-list'&&JSON.stringify(plan.items)!==JSON.stringify(paragraphs))){
  const error=Error('Evidence Reviewの書式修正で本文の一致を確認できません。Claim詳細を保持して保存前に停止します。');error.code='EVIDENCE_REVIEW_CONTENT_CHANGED';throw error;
 }
}
function reviewRange(text){
 const headings=[...text.matchAll(heading)],begins=[...text.matchAll(/<!-- soslist-evidence-review:start -->/g)],ends=[...text.matchAll(/<!-- soslist-evidence-review:end -->/g)];
 if(headings.length>1||begins.length>1||ends.length>1||begins.length!==ends.length)throw Error('Evidence Reviewの境界が曖昧です。元内容を保持して停止します。');
 if(begins.length){
  const h=headings[0],b=begins[0],e=ends[0];
  if(!h||b.index<h.index+h[0].length||e.index<b.index||text.slice(h.index+h[0].length,b.index).trim())throw Error('Evidence Reviewの境界が破損しています。');
  const body=text.slice(b.index+BEGIN.length,e.index).replace(/^\r?\n|\r?\n$/g,'');
  const seal=text.slice(e.index+END.length).match(/^\r?\n<!-- soslist-evidence-review:sha256:([a-f0-9]{64}) -->/);
  if(!seal||seal[1]!==checksum(body))throw Error('Evidence Reviewが手編集されています。元内容を保持して停止します。');
  return {start:h.index,end:e.index+END.length+seal[0].length,body};
 }
 if(!headings.length)return null;
 throw Error('既存Evidence Reviewに管理境界がありません。元内容を保持して停止します。');
}
function replaceEvidenceReview(claimDetail,body){
 if(typeof claimDetail!=='string')throw Error('Evidence Reviewの保存先が不正です。');
 body=validateEvidenceReviewText(body);
 const range=reviewRange(claimDetail),prefix=range?claimDetail.slice(0,range.start):claimDetail,suffix=range?claimDetail.slice(range.end):'';
 return prefix.replace(/(?:\r?\n)*$/,'')+'\n\nEvidence Review\n'+BEGIN+'\n'+body+'\n'+END+'\n<!-- soslist-evidence-review:sha256:'+checksum(body)+' -->'+(suffix?(suffix.startsWith('\n')?suffix:'\n\n'+suffix):'');
}
async function prepareAppointmentsEvidence(appointments,{summarize,saveBatch,readBack}){
 const changes=[],prepared=[];
 // Finish every AI call and boundary check before the single atomic save.
 for(const appointment of appointments){
  const original=appointment.claimDetail||'',notes=appointment.notes||'';
  reviewRange(original);
  let claimDetail=original;
  if(notes.trim())claimDetail=replaceEvidenceReview(original,await summarize(notes));
  changes.push({id:appointment.id,contractNumber:appointment.contractNumber,notes,original,claimDetail});
  prepared.push({...appointment,claimDetail});
 }
 if(changes.length)await saveBatch(changes);
 // Independent readback must finish before exposing a downstream prompt.
 if(readBack)await readBack(changes);
 return prepared;
}
async function readBackEvidenceReview(db,changes){
 for(const change of changes){const snapshot=await db.collection('appointments').doc(change.id).get(),current=snapshot.data();
  if(!snapshot.exists||(current.claimDetail||'')!==change.claimDetail||(current.notes||'')!==change.notes||(current.contractNumber||'')!==(change.contractNumber||''))throw Error('Evidence Review保存の再読取が一致しません。後続Summaryを停止しました。');
 }
}
async function saveEvidenceReviewBatch(db,changes){
 if(changes.length>400)throw Error('予約数が一括保存上限を超えています。保存せず停止しました。');
 return db.runTransaction(async transaction=>{
  const snapshots=[];
  for(const change of changes){const ref=db.collection('appointments').doc(change.id);snapshots.push({change,ref,snapshot:await transaction.get(ref)});}
  for(const {change,snapshot}of snapshots){
   const current=snapshot.data();
   if(!snapshot.exists||(current.notes||'')!==change.notes||(current.claimDetail||'')!==change.original||(current.contractNumber||'')!==(change.contractNumber||''))throw Error('予約メモまたはClaim詳細が変更されています。保存せず再作成してください。');
  }
  for(const {change,ref}of snapshots)if(change.claimDetail!==change.original)transaction.update(ref,{claimDetail:change.claimDetail});
 });
}
module.exports={BEGIN,END,evidenceReviewFormatIssues,formattingOnlyReference,formattingRepairPlan,assertFormattingOnlyCorrection,validateEvidenceReviewText,reviewRange,replaceEvidenceReview,prepareAppointmentsEvidence,saveEvidenceReviewBatch,readBackEvidenceReview};
