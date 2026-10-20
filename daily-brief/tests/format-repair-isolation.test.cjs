const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {summarizeNote}=require('../note-review-ai.cjs');
for(const service of ['claude','openai'])for(const forceChanged of [false,true])test(`${service} isolates correction from summarization and refuses changed content=${forceChanged}`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'format-repair-isolation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const exe=path.join(dir,'fixture'),capture=path.join(dir,'calls.json');
 const exact='Source_A.pdf p.2, 2021: left knee 5/5, >5 mm; no diagnosis; pending MRI.';
 fs.writeFileSync(exe,'#!'+process.execPath+'\n'+`let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const fs=require('fs'),args=process.argv.slice(2),file=${JSON.stringify(capture)},calls=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[],system=args.includes('--system-prompt')?args[args.indexOf('--system-prompt')+1]:'',repair=calls.length>0,contaminated=/Summarize ONLY|<appointment-memo>|SyntheticPrivateMemo/.test(input+system),exact=${JSON.stringify(exact)},text=repair?(contaminated||${forceChanged}?exact.replace('no diagnosis','diagnosis'):exact):'**'+exact+'**';calls.push({input,system});fs.writeFileSync(file,JSON.stringify(calls));if(args[0]==='exec')fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({evidenceReview:text}));else process.stdout.write(JSON.stringify({subtype:'success',structured_output:{evidenceReview:text}}));});`,{mode:0o700});
 const operation=summarizeNote('SyntheticPrivateMemo with additional source detail',{service,model:'fixture-model',effort:'medium'},{executable:exe});
 if(forceChanged)await assert.rejects(operation,error=>error.code==='EVIDENCE_REVIEW_CONTENT_CHANGED');else assert.equal(await operation,exact);
 const calls=JSON.parse(fs.readFileSync(capture));assert.equal(calls.length,2);
 assert.match(calls[0].input,/SyntheticPrivateMemo/);
 assert.doesNotMatch(calls[1].input+calls[1].system,/Summarize ONLY|<appointment-memo>|SyntheticPrivateMemo/);
 assert.match(calls[1].input,/Correct formatting ONLY/);assert.match(calls[1].input,/Preserve EVERY other word/);
 if(service==='claude')assert.match(calls[1].system,/format-only copy editor/);
});
