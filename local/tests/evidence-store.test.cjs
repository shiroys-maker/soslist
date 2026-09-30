'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ReviewStore } = require('../evidence-review/store.cjs');
const identity = { docId: 'synthetic-doc', claimantName: 'SYNTHETIC', contractNumber: 'TEST.1.2', appointmentDateTimeMs: 1791248400000, services: ['SHA'], sha: true };
function setup(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-store-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
test('private checkpoints survive restart and keep verified source text separate from clinical completion', t => {
    const root = setup(t), store = ReviewStore.create(root, { mode: 'single', appointment: identity });
    store.queue({ enumerationComplete: true, appointments: [identity] });
    store.progress({ contractNumber: identity.contractNumber, phase: 'records', source: { title: 'Synthetic STR', date: '2020-01-01', author: 'Test', excerpt: 'Original excerpt', coverage: 'Inspected all continuation pages' }, notesDraft: 'A\nB', claimDetailDraft: 'Claim\nC' });
    const restored = ReviewStore.open(root, store.id);
    assert.equal(restored.data.appointments[0].sources[0].excerpt, 'Original excerpt');
    assert.deepEqual(restored.data.appointments[0].verified, {});
    assert.equal(fs.statSync(restored.file).mode & 0o777, 0o600);
    assert.throws(() => restored.verify({ contractNumber: identity.contractNumber, docId: 'wrong', field: 'notes', expected: 'A\nB', readback: 'A\nB' }), /identity/i);
    assert.throws(() => restored.verify({ contractNumber: identity.contractNumber, docId: identity.docId, field: 'notes', expected: 'A\nB', readback: 'A B' }), /readback/i);
    restored.verify({ contractNumber: identity.contractNumber, docId: identity.docId, field: 'notes', expected: 'A\nB', readback: 'A\nB' });
    assert.equal(restored.data.appointments[0].verified.notes, true);
    restored.progress({ contractNumber: identity.contractNumber, phase: 'draft', notesDraft: 'New' });
    assert.equal(restored.data.appointments[0].verified.notes, false);
});
test('resume cannot silently replace queue identity or infer completion from partial saves', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    store.queue({ enumerationComplete: true, appointments: [identity] });
    assert.throws(() => store.queue({ enumerationComplete: true, appointments: [{ ...identity, docId: 'other' }] }), /identity/i);
    assert.throws(() => store.queue({ enumerationComplete: true, appointments: [] }), /queue/i);
    assert.throws(() => store.finish({ outcome: 'completed', found: 1, completed: 1, incomplete: 0, skipped: 0, enumerationComplete: true, summary: 'done', appointments: [{ docId: identity.docId, contractNumber: identity.contractNumber, outcome: 'completed', notesVerified: true, claimDetailVerified: true, reason: '' }] }), /verified/i);
});
test('required SHA and referral obligations cannot be downgraded or removed on requeue', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    assert.throws(() => store.queue({ enumerationComplete: true, appointments: [{ ...identity, sha: false }] }), /identity/i);
    const required = { ...identity, referralRequired: true };
    store.queue({ enumerationComplete: true, appointments: [required] });
    for (const changed of [{ ...required, sha: false }, { ...required, referralRequired: false },
        { ...required, services: ['Other'] }, { ...required, sha: 'true' }]) {
        assert.throws(() => store.queue({ enumerationComplete: true, appointments: [changed] }));
    }
    assert.deepEqual(ReviewStore.open(store.root, store.id).data.appointments[0].sha, true);
    assert.deepEqual(ReviewStore.open(store.root, store.id).data.appointments[0].referralRequired, true);
});
test('invalid progress and failed persistence leave memory and checkpoint unchanged', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    store.queue({ enumerationComplete: true, appointments: [identity] });
    const before = JSON.stringify(store.data);
    assert.throws(() => store.progress({ contractNumber: identity.contractNumber, phase: 'draft', notesDraft: 'secret', claimDetailDraft: 4 }), /draft/i);
    assert.equal(JSON.stringify(store.data), before);
    assert.equal(JSON.stringify(ReviewStore.open(store.root, store.id).data), before);
    assert.throws(() => store.progress({ contractNumber: identity.contractNumber, phase: 'records', source: { title: 'Source', date: '', author: '', excerpt: '', coverage: '' } }), /source/i);
    assert.equal(JSON.stringify(store.data), before);
    const originalFile = store.file;
    store.file = path.join(store.root, 'missing', 'unwritable.json');
    const originalAtomic = fs.renameSync;
    fs.renameSync = () => { throw Error('synthetic rename failure'); };
    try { assert.throws(() => store.progress({ contractNumber: identity.contractNumber, phase: 'draft', notesDraft: 'new' }), /synthetic/); }
    finally { fs.renameSync = originalAtomic; store.file = originalFile; }
    assert.equal(JSON.stringify(store.data), before);
    assert.equal(JSON.stringify(ReviewStore.open(store.root, store.id).data), before);
});
test('changed drafts invalidate readback hashes and corrupt verified flags are rejected on reopen', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    store.queue({ enumerationComplete: true, appointments: [identity] });
    store.progress({ contractNumber: identity.contractNumber, phase: 'draft', notesDraft: 'one' });
    store.verify({ contractNumber: identity.contractNumber, docId: identity.docId, field: 'notes', expected: 'one', readback: 'one' });
    store.progress({ contractNumber: identity.contractNumber, phase: 'draft', notesDraft: 'two' });
    assert.equal(store.data.appointments[0].verified.notes, false);
    assert.equal(store.data.appointments[0].notesReadbackHash, undefined);
    const corrupted = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    corrupted.appointments[0].verified.notes = true;
    fs.writeFileSync(store.file, JSON.stringify(corrupted));
    assert.throws(() => ReviewStore.open(store.root, store.id), /checkpoint/i);
});
test('source provenance cannot be changed after checkpoint persistence', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    store.queue({ enumerationComplete: true, appointments: [identity] });
    store.progress({ contractNumber: identity.contractNumber, phase: 'records', source: {
        title: 'Synthetic source', date: '2024-01-01', author: 'Test', excerpt: 'Verbatim text', coverage: 'Full section'
    } });
    const corrupted = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    corrupted.appointments[0].sources[0].excerpt = 'Changed text';
    fs.writeFileSync(store.file, JSON.stringify(corrupted));
    assert.throws(() => ReviewStore.open(store.root, store.id), /source/i);
});
test('ownership obligation is durable and sensitive content is deleted only after verified completion', t => {
    const root = setup(t), s = ReviewStore.create(root, { mode: 'single', appointment: { ...identity, sha: false } });
    s.queue({ enumerationComplete: true, appointments: [{ ...identity, sha: false }] });
    s.owner({ threadId: 'thread', sessionId: 'session', turnId: 'turn' });
    assert.equal(ReviewStore.open(root, s.id).data.owner.sessionId, 'session');
    s.progress({ contractNumber: identity.contractNumber, phase: 'draft', notesDraft: 'memo', claimDetailDraft: 'claim' });
    for (const [field, value] of [['notes', 'memo'], ['claimDetail', 'claim']]) s.verify({ contractNumber: identity.contractNumber, docId: identity.docId, field, expected: value, readback: value });
    const result = { outcome: 'completed', found: 1, completed: 1, incomplete: 0, skipped: 0, enumerationComplete: true, summary: 'done', appointments: [{ docId: identity.docId, contractNumber: identity.contractNumber, outcome: 'completed', notesVerified: true, claimDetailVerified: true, reason: '' }] };
    assert.throws(() => s.finish(result), /cleanup/i);
    s.owner(null);
    s.finish(result, { retain: true });
    assert.equal(fs.existsSync(s.file), true);
    assert.deepEqual(ReviewStore.open(root, s.id).data.result, result);
    s.finish(result);
    assert.equal(fs.existsSync(s.file), false);
});
test('session identity is optional for old checkpoints but must match an active owner', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    assert.equal(ReviewStore.open(store.root, store.id).data.session, undefined);
    store.setSession({ threadId: 'thread', sessionId: 'session' });
    store.owner({ threadId: 'thread', sessionId: 'session', serverPid: 12345 });
    assert.deepEqual(ReviewStore.open(store.root, store.id).data.session, { threadId: 'thread', sessionId: 'session' });
    for (const invalid of [
        {}, { threadId: 'thread' }, { threadId: ' ', sessionId: 'session' },
        { threadId: 'thread', sessionId: 4 },
        { threadId: 'thread', sessionId: 'session', extra: 'value' },
        { threadId: 'other', sessionId: 'session' }, { threadId: 'thread', sessionId: 'other' }
    ]) {
        assert.throws(() => store.setSession(invalid), /session|recovery/i);
        const corrupted = JSON.parse(fs.readFileSync(store.file, 'utf8'));
        corrupted.session = invalid;
        fs.writeFileSync(store.file, JSON.stringify(corrupted));
        assert.throws(() => ReviewStore.open(store.root, store.id), /checkpoint/i);
        store.save();
    }
});
test('no-records result can be retained until remote history is removed', t => {
    const store = ReviewStore.create(setup(t), { mode: 'batch' });
    store.queue({ enumerationComplete: true, appointments: [] });
    const result = { outcome: 'no_records', found: 0, completed: 0, incomplete: 0, skipped: 0,
        enumerationComplete: true, summary: 'No synthetic records', appointments: [] };
    store.finish(result, { retain: true });
    assert.deepEqual(ReviewStore.open(store.root, store.id).data.result, result);
    assert.throws(() => store.finish({ ...result, summary: 'different' }), /retained/i);
    store.finish(result);
    assert.equal(fs.existsSync(store.file), false);
});
test('malformed checkpoint JSON never leaks a patient fragment in the thrown error', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    fs.writeFileSync(store.file, '{"notesDraft":"SENSITIVE_RECORD_FRAGMENT"');
    assert.throws(() => ReviewStore.open(store.root, store.id), error => {
        assert.equal(error.message, 'Invalid checkpoint JSON');
        assert.doesNotMatch(error.message, /SENSITIVE_RECORD_FRAGMENT/);
        return true;
    });
});
test('reopen accepts pending-start owner without turnId and rejects unknown cleanup identities', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    store.owner({ threadId: 'thread', sessionId: 'session' });
    assert.deepEqual(ReviewStore.open(store.root, store.id).data.owner, { threadId: 'thread', sessionId: 'session' });
    store.owner({ threadId: 'thread', sessionId: 'session', serverPid: 12345 });
    assert.equal(ReviewStore.open(store.root, store.id).data.owner.serverPid, 12345);
    for (const invalid of [
        {}, { threadId: 'thread' }, { threadId: '', sessionId: 'session' },
        { threadId: 'thread', sessionId: ' ' },
        { threadId: 'thread', sessionId: 'session', turnId: '' },
        { threadId: 'thread', sessionId: 'session', turnId: 1 },
        { threadId: 'thread', sessionId: 'session', turnId: 'turn', unrelated: 'owner' },
        { threadId: 'thread', sessionId: 'session', serverPid: 0 },
        { threadId: 'thread', sessionId: 'session', serverPid: -1 },
        { threadId: 'thread', sessionId: 'session', serverPid: 1.5 },
        { threadId: 'thread', sessionId: 'session', serverPid: '12345' },
        ['thread', 'session']
    ]) {
        assert.throws(() => store.owner(invalid), /ownership/i);
        const corrupted = JSON.parse(fs.readFileSync(store.file, 'utf8'));
        corrupted.owner = invalid;
        fs.writeFileSync(store.file, JSON.stringify(corrupted));
        assert.throws(() => ReviewStore.open(store.root, store.id), /checkpoint/i);
        store.owner({ threadId: 'thread', sessionId: 'session' });
    }
});

test('partial reports cannot claim a field was verified without a saved readback checkpoint', t => {
    const store = ReviewStore.create(setup(t), { mode: 'single', appointment: identity });
    store.queue({ enumerationComplete: true, appointments: [identity] });
    const result = { outcome:'partial',found:1,completed:0,incomplete:1,skipped:0,enumerationComplete:true,summary:'incomplete',appointments:[{docId:identity.docId,contractNumber:identity.contractNumber,outcome:'incomplete',notesVerified:true,claimDetailVerified:false,reason:'Pending evidence'}] };
    assert.throws(() => store.finish(result), /unverified/);
    result.appointments[0].notesVerified = false;
    assert.equal(store.finish(result).outcome, 'partial');
});


test('user clarification persists only in its checkpoint without altering evidence or approval flags', t => {
 const root=setup(t),store=ReviewStore.create(root,{mode:'single',appointment:identity});
 store.queue({enumerationComplete:true,appointments:[identity]});
 const original=structuredClone(store.data.appointments);
 store.addUserInstruction('  Synthetic clarification  ');
 store.addUserInstruction('Synthetic clarification');
 const restored=ReviewStore.open(root,store.id);
 assert.equal(restored.data.userInstructions.length,1);
 assert.equal(restored.data.userInstructions[0].text,'Synthetic clarification');
 assert.deepEqual(restored.data.appointments,original);
 assert.deepEqual(restored.data.request,{mode:'single',appointment:identity});
 assert.equal(ReviewStore.create(root,{mode:'batch'}).data.userInstructions,undefined);
 assert.throws(()=>restored.addUserInstruction('x'.repeat(4001)));
 const invalid=structuredClone(restored.data);invalid.userInstructions[0].text={};
 fs.writeFileSync(restored.file,JSON.stringify(invalid));
 assert.throws(()=>ReviewStore.open(root,store.id),/checkpoint/i);
});
