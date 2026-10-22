const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const e=require('../evidence-review.cjs'),{summarizeNote}=require('../note-review-ai.cjs'),{createDiagnostic}=require('../summary-diagnostics.cjs'),{recordFailure}=require('../note-review-failures.cjs');
test('numeric comparisons remain literal while real quotes, lists and nested structure are detected',()=>{
 for(const text of ['> 5','> 5 mm','>= 5 mg','> -0.5 dB','> .5 cm','>5 mm; no diagnosis.','SpO2 < 95%; no diagnosis.'])assert.equal(e.validateEvidenceReviewText(text),text);
 for(const text of ['> No diagnosis was recorded.','> 5 mm ambiguous quote.','>> 5 mm','- No diagnosis.','1. No diagnosis.','  - Nested item.'])assert.throws(()=>e.validateEvidenceReviewText(text),error=>error.issues.includes('list-or-quote'));
 for(const text of ['> No diagnosis.','1. No diagnosis.','- 5 mm','- Left knee.\n  - No diagnosis.','Text.\n- Left knee.'])assert.equal(e.formattingRepairPlan(text),null);
});
test('flat items retain paragraph boundaries, numbers, negation, dates and order exactly',()=>{
 const draft='- Source_A.pdf p.2: Left knee 5/5, > 5 mm.\n- No diagnosis; pending MRI, 2026-10-23.';
 const correct='Source_A.pdf p.2: Left knee 5/5, > 5 mm.\n\nNo diagnosis; pending MRI, 2026-10-23.';
 assert.equal(e.formattingRepairPlan(draft).kind,'flat-list');assert.doesNotThrow(()=>e.assertFormattingOnlyCorrection(draft,correct));
 for(const changed of [correct.replace('Left','Right'),correct.replace('5/5','4/5'),correct.replace('No diagnosis','Diagnosis'),correct.replace('pending','completed'),correct.replace('2026','2025'),correct.replace('> 5','< 5'),correct.replace('\n\n',' '),correct.split('\n\n').reverse().join('\n\n')])assert.throws(()=>e.assertFormattingOnlyCorrection(draft,changed),error=>error.code==='EVIDENCE_REVIEW_CONTENT_CHANGED');
});
function fixture(t,outputs){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'note-stability-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const capture=path.join(dir,'calls.json'),executable=path.join(dir,'fixture');
 fs.writeFileSync(executable,'#!'+process.execPath+'\n'+`let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const fs=require('fs'),args=process.argv.slice(2),file=${JSON.stringify(capture)},calls=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[],output=${JSON.stringify(outputs)}[Math.min(calls.length,${outputs.length}-1)];calls.push({args,input,schema:JSON.parse(args.includes('--json-schema')?args[args.indexOf('--json-schema')+1]:fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'))});fs.writeFileSync(file,JSON.stringify(calls));if(args[0]==='exec')fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(output));else process.stdout.write(JSON.stringify({subtype:'success',structured_output:output}));});`,{mode:0o700});
 return {executable,calls:()=>JSON.parse(fs.readFileSync(capture))};
}
for(const service of ['claude','openai']){
 const selected={service,model:'fixture-model',effort:'medium'};
 test(`${service} structured paragraphs constrain representation and preserve comparison text`,async t=>{
  const f=fixture(t,[{paragraphs:['> 5 mm','No diagnosis; pending MRI.']}]);
  assert.equal(await summarizeNote('SyntheticPrivateMemo',selected,{executable:f.executable}),'> 5 mm\n\nNo diagnosis; pending MRI.');assert.equal(f.calls().length,1);
  const schema=f.calls()[0].schema;
  assert.deepEqual(schema.required,['paragraphs']);const pattern=new RegExp(schema.properties.paragraphs.items.pattern);assert.equal(pattern.test('Plain paragraph; no diagnosis.'),true);assert.equal(pattern.test('- No diagnosis.'),false);assert.equal(pattern.test('> No diagnosis.'),false);assert.equal(pattern.test('>= 5 mg'),true);
 });
 for(const mode of ['success','changed','retry-failed','quote'])test(`${service} bounded structured repair ${mode} keeps text out of generic diagnostics`,async t=>{
  const item='SyntheticPrivateMarker: Left 5/5; no diagnosis.',second='Pending MRI; Source_A.pdf p.2.';
  const first=mode==='quote'?{paragraphs:['> '+item]}:{paragraphs:['- '+item,'- '+second]};
  const outputs=[first,mode==='retry-failed'?first:{paragraphs:[mode==='changed'?item.replace('no diagnosis','diagnosis'):item,second]}];
  const f=fixture(t,outputs),logs=[],saved=[],diagnostic=createDiagnostic('2099-01-01',{write:line=>logs.push(line)});
  const operation=summarizeNote('SyntheticPrivateOriginalMemo',selected,{executable:f.executable,diagnostic,failureRecorder:record=>{saved.push(record);return true;}});
  if(mode==='success')assert.equal(await operation,item+'\n\n'+second);else await assert.rejects(operation);
  assert.equal(f.calls().length,mode==='quote'?1:2);assert.ok(logs.every(line=>!line.includes('SyntheticPrivate')&&!line.includes(item)));
  if(mode==='success')assert.equal(saved.length,0);else{assert.equal(saved.length,1);assert.equal(saved[0].targetDate,'2099-01-01');assert.ok(saved[0].draft.includes('SyntheticPrivateMarker'));assert.equal(saved[0].notes,undefined);assert.equal(JSON.stringify(saved[0]).includes('SyntheticPrivateOriginalMemo'),false);assert.ok(logs.some(line=>line.includes('"recoveryRecorded":true')));}
  if(mode!=='quote'){assert.doesNotMatch(f.calls()[1].input,/SyntheticPrivateOriginalMemo|<appointment-memo>|Summarize ONLY/);}
 });
}
test('recovery evidence is local, permission restricted, bounded and never logs clinical text',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'note-local-failures-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const error=Object.assign(Error('SyntheticPrivateError'),{code:'EVIDENCE_REVIEW_FORMAT',issues:['list-or-quote','SyntheticPrivateIssue']}),input={targetDate:'2099-01-01',draft:'SyntheticPrivateDraft',corrected:'SyntheticPrivateCorrected',notes:'NEVER STORE ORIGINAL',error};
 for(let i=0;i<10;i++)assert.equal(recordFailure(input,{directory}),true);
 assert.equal(recordFailure(input,{directory}),false);const files=fs.readdirSync(directory);assert.equal(files.length,10);assert.equal(fs.statSync(directory).mode&0o777,0o700);
 const file=path.join(directory,files[0]);assert.equal(fs.statSync(file).mode&0o777,0o600);const data=JSON.parse(fs.readFileSync(file));assert.equal(data.draft,input.draft);assert.equal(data.corrected,input.corrected);assert.deepEqual(data.formats,['list-or-quote']);assert.equal(data.notes,undefined);assert.ok(!JSON.stringify(data).includes('SyntheticPrivateError'));assert.equal(recordFailure({...input,draft:'x'.repeat(262145)},{directory}),false);
});
