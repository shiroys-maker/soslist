const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const local=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(local,p),'utf8');
test('retired row clicks cannot trigger collection while DBQ handoff remains',()=>{
 let click;const messages=[],reads=[];
 const s=read('script.js');const source=s.slice(s.indexOf("tableBody.addEventListener('click'"),s.indexOf("confirmEditBtn.addEventListener('click'"));
 const context={tableBody:{addEventListener(_,fn){click=fn}},window:{webkit:{messageHandlers:{startEvidenceReview:{postMessage:x=>messages.push(x)}}}},readInteractionAppointment:x=>reads.push(x)};
 vm.runInNewContext(source,context);
 for(const legacy of ['.evidence-btn','.evidence-resume-btn'])click({target:{classList:{contains:()=>false},closest:s=>s==='tr'?{dataset:{id:'fictional'}}:s===legacy?{}:null}});
 assert.equal(messages.length,0);assert.equal(reads.length,0);
 assert.match(source,/openDBQProcessor/);assert.match(source,/openClaimDetailModal/);assert.match(source,/openShokaijyoModal/);assert.match(source,/handleViewPdf/);
});
test('collection toolbar, callbacks, timers and native message registration are absent',()=>{
 assert.doesNotMatch(read('index.html'),/fetchEvidenceButton|resumeEvidenceButton|stopEvidenceButton|resumeInstruction|evidenceStatus|evidence-review.js/);
 assert.doesNotMatch(read('script.js'),/evidenceController|__sosEvidenceStatus|SOSEvidenceReview|EvidenceReviewStatus/);
 assert.doesNotMatch(read('mac-app/Sources/SOSListLocalApp/main.swift'),/EvidenceReviewProcess|startEvidenceReview|stopEvidenceReview|getEvidenceReviewStatus/);
 assert.doesNotMatch(read('../shared/core.js'),/evidence-btn|evidence-resume-btn/);
 assert.match(read('style.css'),/\.dbq-btn \{[\s\S]*?border-radius: 5px/);
});
test('only shared Codex transport is packaged and collection setting stays hidden',()=>{
 const build=read('mac-app/script/build_and_run.sh');
 assert.match(build,/for f in app-server.cjs codex-path.cjs/);assert.doesNotMatch(build,/cp -R .*evidence-review/);
 assert.doesNotMatch(read('ai-settings.js'),/\['bill','evidence'/);
 assert.ok(fs.existsSync(path.join(local,'evidence-review/app-server.cjs')));
 assert.ok(fs.existsSync(path.join(local,'evidence-review/codex-path.cjs')));
 assert.equal(fs.existsSync(path.join(local,'evidence-review/runner.cjs')),false);
});
