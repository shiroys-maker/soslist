'use strict';
const {createHash}=require('node:crypto');
const checksum=body=>createHash('sha256').update(body,'utf8').digest('hex');
const BEGIN='<!-- soslist-evidence-review:start -->',END='<!-- soslist-evidence-review:end -->';
const heading=/^(?:#{1,6}\s+)?Evidence\s*Review\s*:?[ \t]*\r?$/gim;
function validateEvidenceReviewText(body){
 if(typeof body!=='string'||!body.trim())throw Error('Evidence Reviewの要約が空または不正です。');
 // Reject formatting rather than stripping it: conversion can erase clinical
 // punctuation, table relationships, source URLs or ordered chronology.
 const markdown=[
  /^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/m,
  /^[ \t]*(?:`{3,}|~{3,})/m, /`/,
  /^(?: {4}|\t)[ \t]*\S/m,
  /^[ \t]*(?:[-+*][ \t]+|\d+[.)][ \t]+|>)/m,
  /^[ \t]*(?:[-=]+|(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/m,
  /^[ \t]*\|/m, /^[ \t]*\S[^\n]*\|[^\n]*\r?\n[ \t]*:?-+:?[ \t]*\|/m,
  /\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~/,
  /(?:^|[^\w])\*[^\s*][^*]*\*(?=$|[^\w])/m,
  /(?:^|[^\w])_[^\s_][^_]*_(?=$|[^\w])/m,
  /!?\[[^\]\n]*\]\([\s\S]*?\)/, /\[[^\]\n]+\]\[[^\]\n]*\]/,
  /^[ \t]*\[[^\]\n]+\]:[ \t]*\S/m, /\[\^[^\]\n]+\]/,
  /<!--[\s\S]*?-->|<!--|<\/?[a-z][^>\n]*>|<(?:https?:\/\/|mailto:)[^>\n]+>/i,
 ];
 if(markdown.some(pattern=>pattern.test(body))||[...body.matchAll(heading)].length)throw Error('Evidence ReviewがPlain Textではありません。Markdown等を自動変換せず、Claim詳細を保持して保存前に停止します。');
 return body.trim();
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
module.exports={BEGIN,END,validateEvidenceReviewText,reviewRange,replaceEvidenceReview,prepareAppointmentsEvidence,saveEvidenceReviewBatch,readBackEvidenceReview};
