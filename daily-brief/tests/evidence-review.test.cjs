const {test}=require('node:test'),assert=require('node:assert/strict');
const {BEGIN,END,reviewRange,replaceEvidenceReview,prepareAppointmentsEvidence,saveEvidenceReviewBatch,readBackEvidenceReview}=require('../evidence-review.cjs');
const claims='## Claims\nDBQ: Neck\nClaim: left knee — TERA\n';
const body='Synthetic record [fixture.pdf p.2], 2021. Left-sided symptoms.\nPending tests; no full-folder review asserted. 🙂';
test('claim prefix and suffix preserved; exactly one blank line; managed updates are idempotent',()=>{
 const first=replaceEvidenceReview(claims,body);assert.ok(first.startsWith(claims+'\n## Evidence Review\n'));assert.equal(reviewRange(first).body,body);
 assert.equal(replaceEvidenceReview(first,body),first);
 const suffix='\n\n## Manual remarks\nKEEP EXACT\n',second=replaceEvidenceReview(first+suffix,'New synthetic summary');assert.ok(second.endsWith(suffix));assert.equal(second.match(/## Evidence Review/g).length,1);
});
test('unmarked, edited, duplicate and broken managed reviews stop without changing original text',()=>{
 for(const input of [claims+'\nEvidence Review\nManual content',replaceEvidenceReview(claims,body).replace('2021','2022'),claims+'\n'+BEGIN+'\n'+body,replaceEvidenceReview(claims,body)+'\n## Evidence Review\nDuplicate'])assert.throws(()=>replaceEvidenceReview(input,'new'),/Evidence Review/);
});
function fixture(){const records={a:{notes:'Synthetic memo A',claimDetail:claims,contractNumber:'FIXTURE.1'},b:{notes:'Synthetic memo B',claimDetail:'Claim: headache',contractNumber:'FIXTURE.2'}};let updates=0;const db={collection(){return {doc(id){return {id,async get(){return {exists:!!records[id],data:()=>records[id]}}}}}},async runTransaction(fn){const pending=[];await fn({get:ref=>db.collection().doc(ref.id).get(),update:(ref,value)=>pending.push([ref.id,value])});for(const [id,value]of pending){Object.assign(records[id],value);updates++;}}};return {records,db,get updates(){return updates},appointments:()=>Object.entries(records).map(([id,x])=>({id,...x}))};}
test('all summaries complete before atomic save, preserve notes, and independently read back',async()=>{
 const f=fixture(),originalNotes=Object.values(f.records).map(x=>x.notes),events=[];
 const prepared=await prepareAppointmentsEvidence(f.appointments(),{summarize:async notes=>{assert.equal(f.updates,0);events.push('ai');return body+' '+notes;},saveBatch:changes=>{events.push('save');return saveEvidenceReviewBatch(f.db,changes)},readBack:changes=>{events.push('readback');return readBackEvidenceReview(f.db,changes)}});
 assert.deepEqual(events,['ai','ai','save','readback']);assert.equal(f.updates,2);assert.deepEqual(Object.values(f.records).map(x=>x.notes),originalNotes);assert.equal(prepared[0].claimDetail,f.records.a.claimDetail);
});
test('AI failure and concurrent edits retain every original Claim and prevent downstream',async()=>{
 for(const fail of ['ai','notes','claims']){
  const f=fixture(),before=JSON.stringify(f.records);let calls=0,readback=false;
  await assert.rejects(prepareAppointmentsEvidence(f.appointments(),{summarize:async()=>{if(++calls===2){if(fail==='ai')throw Error('Synthetic failure');if(fail==='notes')f.records.b.notes+=' external';if(fail==='claims')f.records.b.claimDetail+=' external';}return body;},saveBatch:changes=>saveEvidenceReviewBatch(f.db,changes),readBack:async()=>{readback=true;}}));
  assert.equal(f.updates,0);assert.equal(f.records.a.claimDetail,claims);assert.equal(readback,false);if(fail==='ai')assert.equal(JSON.stringify(f.records),before);
 }
});
test('readback mismatch stops downstream; empty notes preserve existing Claim',async()=>{
 const f=fixture();await assert.rejects(prepareAppointmentsEvidence(f.appointments(),{summarize:async()=>body,saveBatch:changes=>saveEvidenceReviewBatch(f.db,changes),readBack:async changes=>{f.records.a.claimDetail+=' external';await readBackEvidenceReview(f.db,changes);}}),/再読取/);
 let called=false;const input=[{id:'empty',notes:'',claimDetail:claims}];assert.deepEqual(await prepareAppointmentsEvidence(input,{summarize:()=>{called=true},saveBatch:async changes=>{assert.equal(changes[0].claimDetail,claims);}}),input);assert.equal(called,false);
});
