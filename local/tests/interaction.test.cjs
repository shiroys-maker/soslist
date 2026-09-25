const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const load = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function element() {
    return { style: {}, value: '', disabled: false, textContent: '', attributes: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute(k,v) { this.attributes[k]=v; }, removeAttribute(k) { delete this.attributes[k]; },
        querySelectorAll() { return this.controls || []; } };
}
function harness() {
    const timers = new Map(), checks = [], writes = [], messages = [], alerts = [];
    let sequence = 0, reads = 0, resolveWrite, rejectWrite;
    const record = { claimantName: 'TEST, SYNTHETIC', contractNumber: 'TEST.1.2', notes: 'Original memo',
        services: [], japanCellPhone: '000', appointmentDateTime: { toDate: () => new Date('2026-09-25T01:00:00Z') },
        referrals: { KIN: { visitDate: '09/28 11:00' } } };
    let displayedAppointments = new Map([['fixture', record]]);
    const ref = { get() { reads++; return new Promise(() => {}); }, update(patch) {
        writes.push(patch); return new Promise((resolve,reject) => { resolveWrite=resolve;rejectWrite=reject; });
    } };
    const db = { collection: () => ({ doc: () => ref }) };
    const ctx = { console: { log() {}, error() {} }, Date, Intl, Map, Promise, Error, Number, Array, Object,
        displayedAppointments, alert: text=>alerts.push(text),
        firebase: { initializeApp() {}, auth() {}, storage() {}, firestore: () => db },
        setTimeout(fn,ms) { timers.set(++sequence,{fn,ms});return sequence; }, clearTimeout(id) { timers.delete(id); },
        document: { createElement: element, body: { append(el) { ctx.label=el; }, classList: { add() {},remove() {} } }, addEventListener() {} },
        localStorage: { setItem() {} }, DETAIL_PAYLOAD_PREFIX: 'test:', REFERRAL_FULL: { KIN: {name:'Clinic'} },
        buildSheetHTML: () => '<div>synthetic</div>', autofillShokaijyoKana() {},
        buildDetailsPayload: (docId,data) => ({docId,...data}),
        editModal: element(), editPhoneModal: element(), visitDateModal: element(), shokaijyoModal: element(),
        dateSelect: element(), hourSelect: element(), minuteSelect: element(), phoneInput: element(),
        visitDateInput: element(), visitTimeInput: element(), shokaijyoModalTitle: element(), shokaijyoSheetContainer: element(),
        editingPhoneDocId:null, editingDateTimeDocId:null, visitDateEditingDocId:null, visitDateEditingDest:null,
        shokaijyoEditingDocId:null, shokaijyoEditingDest:null,
        sosConnection: { check: force=>checks.push(force) }, addEventListener() {},
        webkit: { messageHandlers: { openDetailsWindow: {postMessage: data=>messages.push(data)} } }
    };
    ctx.window=ctx;
    vm.createContext(ctx);
    vm.runInContext(load('../../shared/core.js'),ctx);
    displayedAppointments = vm.runInContext('displayedAppointments',ctx);
    displayedAppointments.set('fixture',record);
    ctx.buildSheetHTML = () => '<div>synthetic</div>';
    ctx.autofillShokaijyoKana = () => {};
    vm.runInContext(load('../interaction.js'),ctx);
    const local=load('../script.js');
    vm.runInContext(local.slice(local.indexOf('function openDetailsModal('),local.indexOf('function buildDetailsPayload(')),ctx);
    vm.runInContext(local.slice(local.indexOf('function openShokaijyoModal(')),ctx);
    return {ctx,record,timers,checks,writes,messages,alerts,displayedAppointments,
        get reads(){return reads;},resolveWrite(){resolveWrite();},rejectWrite(){rejectWrite(new Error('offline'));},
        fire(ms){ const entry=[...timers].find(([,v])=>v.ms===ms);assert.ok(entry,`timer ${ms}`);timers.delete(entry[0]);entry[1].fn(); } };
}
test('all main editors open from the visible record with a stalled server; refresh cannot replace draft fields', async()=>{
    const h=harness(),c=h.ctx;
    c.openDetailsModal('fixture');c.openEditModal('fixture');c.openPhoneEditModal('fixture');
    c.openVisitDateModal('fixture','KIN');c.openShokaijyoModal('fixture','KIN');await flush();
    assert.equal(h.reads,0);assert.equal(h.messages[0].notes,'Original memo');
    for(const name of ['editModal','editPhoneModal','visitDateModal','shokaijyoModal']) assert.equal(c[name].style.display,'flex',name);
    assert.equal(c.dateSelect.value,'2026-09-25');assert.equal(c.hourSelect.value,'10');
    assert.equal(c.phoneInput.value,'000');assert.equal(c.visitDateInput.value,'2026-09-28');assert.equal(c.visitTimeInput.value,'11:00');
    c.phoneInput.value='draft';h.displayedAppointments.set('fixture',{...h.record,japanCellPhone:'remote'});
    await flush();assert.equal(c.phoneInput.value,'draft');assert.deepEqual(h.alerts,[]);
});
test('an out-of-list record has a bounded read and does not open an empty editor on timeout', async()=>{
    const h=harness();h.ctx.openVisitDateModal('missing','KIN');h.fire(8000);await flush();
    assert.equal(h.reads,1);assert.notEqual(h.ctx.visitDateModal.style.display,'flex');
    assert.equal(h.ctx.visitDateEditingDocId,null);assert.equal(h.alerts.length,1);
});
test('save delay retains lock across replacement buttons; late acknowledgement releases it without resending',async()=>{
    const h=harness(),c=h.ctx,first=element(),replacement=element();
    const saving=c.toggleAppointmentStatus(first,'fixture','isShown');await flush();
    assert.equal(h.reads,0);assert.equal(h.writes.length,1);assert.equal(h.writes[0].isShown,true);
    h.fire(8000);assert.match(c.label.textContent,/保存完了を確認できていません/);
    await c.toggleAppointmentStatus(replacement,'fixture','isShown');assert.equal(h.writes.length,1);
    assert.equal(first.disabled,true);h.resolveWrite();await saving;
    assert.equal(first.disabled,false);assert.equal(c.sosInteraction.isPending('status:fixture::isShown'),false);
    assert.match(c.label.textContent,/保存しました/);
});
test('failed phone save retains input, reenables controls, and permits an explicit retry',async()=>{
    const h=harness(),c=h.ctx,saveButton=element();
    c.openPhoneEditModal('fixture');await flush();c.phoneInput.value='draft';
    c.editPhoneModal.controls=[c.phoneInput,saveButton];
    const saving=c.savePhone();assert.equal(saveButton.disabled,true);h.fire(8000);
    assert.equal(saveButton.disabled,true);h.rejectWrite();await saving;
    assert.equal(saveButton.disabled,false);assert.equal(c.phoneInput.value,'draft');assert.equal(c.editPhoneModal.style.display,'flex');
    const retry=c.savePhone();assert.equal(h.writes.length,2);h.resolveWrite();await retry;
    assert.equal(c.editPhoneModal.style.display,'none');
});
test('pending saves disable the whole editor until success and duplicate save functions never write twice',async()=>{
    const h=harness(),c=h.ctx,button=element();c.editPhoneModal.controls=[c.phoneInput,button];
    c.openPhoneEditModal('fixture');await flush();c.phoneInput.value='draft';
    const p=c.savePhone();await c.savePhone();assert.equal(h.writes.length,1);
    assert.equal(button.disabled,true);h.resolveWrite();await p;assert.equal(button.disabled,false);
});

test('reconnection retains rendered records, while an explicit date change clears them',()=>{
    const h=harness(),c=h.ctx;
    const query={where(){return this;},orderBy(){return this;},limit(){return this;},onSnapshot(){return ()=>{};}};
    vm.runInContext('db.collection = () => testQuery',Object.assign(c,{testQuery:query}));
    Object.assign(c,{unsubscribe:null, dateFilter:{value:'2026-09-25'},resultsWaitingOnly:false,
        SOSLIST_TARGET:{mobileUI:false,deleteColumn:true},tableBody:{innerHTML:'existing rows'}, clearInterval(){}});
    c.sosConnection.begin=()=>1;
    c.setupRealtimeListener({preserveRows:true});
    assert.equal(h.displayedAppointments.size,1);assert.equal(c.tableBody.innerHTML,'existing rows');
    c.setupRealtimeListener();assert.equal(h.displayedAppointments.size,0);assert.match(c.tableBody.innerHTML,/読み込み中/);
});

test('detail save timers belong to their request and a slow acknowledgement never enables duplicate submission',()=>{
    const elements=Object.fromEntries(['notesTextarea','referenceUrlInput','saveNotesButton','statusText'].map(id=>[id,element()]));
    const timers=[],messages=[];
    const c={Date,Math,Object,activeSaveRequestId:null,pendingCloseAfterSave:false,pendingSaveValues:null,
        currentDetailsData:{notes:'',referenceUrl:''},document:{getElementById:id=>elements[id]},
        setTimeout(fn,ms){timers.push({fn,ms});},webkit:{messageHandlers:{saveDetails:{postMessage:msg=>messages.push(msg)}}},alert(){}};
    c.window=c;vm.createContext(c);
    const source=load('../details.js');
    vm.runInContext(source.slice(source.indexOf('function hasUnsavedChanges('),source.indexOf('function handleStorageEvent(')),c);
    elements.notesTextarea.value='one';c.saveNotes('fixture');const first=messages[0].requestId;
    c.__sosDetailSaveResult({requestId:first,status:'success'});
    elements.notesTextarea.value='two';c.saveNotes('fixture');const second=messages[1].requestId;
    elements.statusText.textContent='second request';timers[0].fn();timers[1].fn();
    assert.equal(elements.statusText.textContent,'second request');
    timers[3].fn();assert.equal(elements.saveNotesButton.disabled,true);assert.match(elements.statusText.textContent,/保存完了を確認できていません/);
    c.saveNotes('fixture');assert.equal(messages.length,2);
    elements.notesTextarea.value='newer draft';c.__sosDetailSaveResult({requestId:second,status:'success'});
    assert.equal(c.currentDetailsData.notes,'two');assert.equal(elements.notesTextarea.value,'newer draft');
    assert.match(elements.statusText.textContent,/未保存/);assert.equal(elements.saveNotesButton.disabled,false);
});
