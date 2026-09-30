const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRequest, validateResult, createController } = require('../evidence-review.js');

const appointment = { docId: 'synthetic-doc', claimantName: 'DOE, JANE', contractNumber: '1234567.1.2',
    appointmentDateTimeMs: Date.parse('2026-10-02T01:00:00Z'), services: ['General Medical Examination'], notes: 'private memo' };
const verified = { docId: 'synthetic-doc', contractNumber: '1234567.1.2', outcome: 'completed',
    notesVerified: true, claimDetailVerified: true, reason: '' };
const result = (overrides = {}) => ({ outcome: 'completed', found: 1, completed: 1, skipped: 0, incomplete: 0,
    enumerationComplete: true, summary: '保存・再読込確認済み', appointments: [verified], ...overrides });

test('single requests keep exact identity without copying clinical notes or unrelated fields', () => {
    const request = buildRequest('single', appointment);
    assert.equal(request.appointment.docId, 'synthetic-doc');
    assert.equal(request.appointment.contractNumber, '1234567.1.2');
    assert.equal(request.appointment.appointmentDateTimeMs, 1790902800000);
    assert.equal(request.appointment.notes, undefined);
    assert.throws(() => buildRequest('single', { ...appointment, appointmentDateTimeMs: null }));
    assert.throws(() => buildRequest('single', { ...appointment, contractNumber: '' }));
    assert.throws(() => buildRequest('unknown', appointment));
});

test('resume requests carry only the validated checkpoint ID', () => {
    const resumeId = 'a'.repeat(64);
    assert.deepEqual(buildRequest('resume', { resumeId, notes: 'private memo' }), { mode: 'resume', resumeId });
    for (const candidate of ['', 'a'.repeat(63), 'g'.repeat(64), '../checkpoint']) {
        assert.throws(() => buildRequest('resume', { resumeId: candidate }));
    }
});

test('completion requires saved-field verification and the exact selected document', () => {
    const request = buildRequest('single', appointment);
    assert.equal(validateResult(request, result()).outcome, 'completed');
    for (const change of [{ docId: 'another-doc' }, { notesVerified: false }, { claimDetailVerified: false }]) {
        assert.throws(() => validateResult(request, result({ appointments: [{ ...verified, ...change }] })));
    }
    assert.throws(() => validateResult(request, result({ completed: 2 })));
});

test('zero records is a batch outcome only after complete enumeration', () => {
    const empty = result({ outcome: 'no_records', found: 0, completed: 0, appointments: [] });
    assert.equal(validateResult(buildRequest('batch'), empty).outcome, 'no_records');
    assert.throws(() => validateResult(buildRequest('batch'), { ...empty, enumerationComplete: false }));
    assert.throws(() => validateResult(buildRequest('single', appointment), empty));
    assert.throws(() => validateResult(buildRequest('batch'), result({ outcome: 'completed', enumerationComplete: false })));
});

test('the controller prevents duplicate launch and ignores stale job updates', async () => {
    const sent = [], states = [];
    const controller = createController({ send: value => sent.push(value), onState: value => states.push(value) });
    const first = controller.start('single', appointment);
    controller.start('batch');
    assert.equal(sent.length, 1);
    controller.receive({ jobId: 'stale', state: 'completed', message: 'old' });
    assert.equal(controller.state.busy, true);
    controller.receive({ jobId: first.jobId, state: 'blocked', message: 'Edgeでログインしてください' });
    assert.equal(controller.state.busy, false);
    assert.equal(controller.state.message, 'Edgeでログインしてください');
    controller.start('batch');
    assert.equal(sent.length, 2);
});

test('restored incomplete state allows only explicit resume and ignores old callbacks', () => {
    const sent = [], controller = createController({ send: value => sent.push(value), onState: () => {} });
    const resumeId = 'b'.repeat(64);
    controller.receive({ state: 'paused', message: '中断', resumeId, phase: 'collecting' });
    assert.equal(controller.state.busy, false);
    assert.equal(controller.state.resumeId, resumeId);
    assert.equal(controller.start('batch'), null);
    assert.equal(sent.length, 0);
    const resumed = controller.start('resume', { resumeId });
    assert.equal(sent[0].resumeId, resumeId);
    assert.equal(controller.state.busy, true);
    controller.receive({ state: 'paused', message: 'stale persisted', resumeId });
    controller.receive({ jobId: 'old-job', state: 'completed', message: 'stale completion' });
    assert.equal(controller.state.jobId, resumed.jobId);
    assert.equal(controller.state.busy, true);
    controller.receive({ jobId: resumed.jobId, state: 'recovering', message: 'cleanup', resumeId });
    assert.equal(controller.state.busy, true);
    controller.receive({ jobId: resumed.jobId, state: 'completed', message: '完了' });
    assert.equal(controller.state.resumeId, null);
    assert.equal(controller.state.busy, false);
});

test('a failed bridge launch releases the lock and reports the error', () => {
    const controller = createController({ send: () => { throw Error('bridge failed'); }, onState: () => {} });
    controller.start('batch');
    assert.equal(controller.state.busy, false);
    assert.match(controller.state.message, /bridge failed/);
});

test('the actual row click hands off the corrected visible time for legacy imports', async () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
    const listener = source.slice(source.indexOf("tableBody.addEventListener('click'"), source.indexOf("confirmEditBtn.addEventListener('click'"));
    let click; const sent = [], button = {}, raw = { ...appointment, appointmentDateTimeMs: appointment.appointmentDateTimeMs + 9 * 3600000 };
    const controller = createController({ send: request => sent.push(request), onState: () => {} });
    vm.runInNewContext(listener, { tableBody: { addEventListener: (_, fn) => { click = fn; } }, evidenceController: controller,
        readInteractionAppointment: () => Promise.resolve({ exists: true, data: () => raw }),
        buildDetailsPayload: () => raw, getCorrectedAppointmentDate: () => new Date(appointment.appointmentDateTimeMs),
        syncEvidenceButtons() {}, alert: message => { throw Error(message); } });
    click({ target: { classList: { contains: () => false }, closest: selector => selector === 'tr' ? { dataset: { id: 'synthetic-doc' } } : selector === '.evidence-btn' ? button : null } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].appointment.appointmentDateTimeMs, 1790902800000);
    assert.equal(sent[0].appointment.docId, 'synthetic-doc');
});


test('resume accepts only explicit bounded user instructions without broadening the selection', () => {
 const resumeId = 'a'.repeat(64);
 assert.deepEqual(buildRequest('resume', {resumeId, userInstruction:'  Synthetic clarification  ', appointment}),
  {mode:'resume',resumeId,userInstruction:'Synthetic clarification'});
 assert.deepEqual(buildRequest('resume', {resumeId, userInstruction:'  '}), {mode:'resume',resumeId});
 for (const value of [null, {}, 42, 'x'.repeat(4001)]) assert.throws(() => buildRequest('resume',{resumeId,userInstruction:value}));
 assert.equal(buildRequest('single',{...appointment,userInstruction:'unrelated'}).userInstruction,undefined);
});


test('row resume scope survives restart and clears on completion or batch recovery', () => {
 const id='b'.repeat(64),controller=createController({send(){},onState(){}});
 controller.receive({state:'paused',resumeId:id,resumeDocId:'selected'});
 assert.equal(controller.state.resumeDocId,'selected');
 const request=controller.start('resume',{resumeId:id});
 controller.receive({state:'blocked',jobId:request.jobId,resumeId:id});
 assert.equal(controller.state.resumeDocId,'selected');
 controller.receive({state:'paused',jobId:request.jobId,resumeId:id,resumeDocId:null});
 assert.equal(controller.state.resumeDocId,null);
 controller.receive({state:'completed',jobId:request.jobId,resumeDocId:'selected'});
 assert.equal(controller.state.resumeId,null);assert.equal(controller.state.resumeDocId,null);
});

test('row resume displays only for the original document and shares the toolbar request path', () => {
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require('node:path').join(__dirname,'../script.js'),'utf8');
 const state={busy:false,resumeId:'c'.repeat(64),resumeDocId:'selected'},sent=[];
 const buttons=['selected','other'].map(id=>({closest:()=>({dataset:{id}})}));
 const ctx={evidenceController:{state,start:(...args)=>sent.push(args)},document:{querySelectorAll:sel=>sel==='.evidence-resume-btn'?buttons:[],getElementById:()=>({value:'scoped clarification'})}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function syncEvidenceButtons('),source.indexOf('// Firestore can replace')),ctx);
 vm.runInContext(source.slice(source.indexOf('function resumeEvidenceReview('),source.indexOf("document.getElementById('resumeEvidenceButton').addEventListener")),ctx);
 ctx.syncEvidenceButtons();assert.equal(buttons[0].hidden,false);assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].hidden,true);
 ctx.resumeEvidenceReview('other');assert.equal(sent.length,0);
 ctx.resumeEvidenceReview('selected');assert.equal(sent.length,1);assert.equal(sent[0][0],'resume');assert.equal(sent[0][1].resumeId,state.resumeId);assert.equal(sent[0][1].userInstruction,'scoped clarification');
 state.busy=true;ctx.syncEvidenceButtons();assert.equal(buttons[0].disabled,true);ctx.resumeEvidenceReview('selected');assert.equal(sent.length,1);
 state.busy=false;state.resumeDocId=null;ctx.syncEvidenceButtons();assert.ok(buttons.every(b=>b.hidden));
 state.resumeId=null;ctx.syncEvidenceButtons();assert.ok(buttons.every(b=>b.hidden));
});
