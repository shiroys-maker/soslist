const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { splitClaimSuffix, migrationPatch } = require('../../ops/migrate-claim-detail.cjs');

test('migration preserves test parentheses and removes only the final claim, including old comma-split entries', () => {
    const original = ['TIBIA & FIBULA', '(LEG) LEFT', 'SYPHILIS TEST(VDRL', 'RPR', 'ART)', 'X-RAY (AP & LATERAL)', 'Focused Requiring 1-5 DBQs', '(Neck (left)', 'Headache: TERA)'];
    const split = splitClaimSuffix(original);
    assert.deepEqual(split.services, original.slice(0, 7));
    assert.equal(split.claimDetail, 'Neck (left), Headache: TERA');
    assert.equal(original.length, 9);
    assert.deepEqual(splitClaimSuffix(['Focused Requiring 1-5 DBQs （asthma', 'rhinitis）']), {
        services: ['Focused Requiring 1-5 DBQs'], claimDetail: 'asthma, rhinitis'
    });
    assert.deepEqual(splitClaimSuffix(['SYPHILIS TEST(VDRL, RPR, ART)']), { services: ['SYPHILIS TEST(VDRL, RPR, ART)'], claimDetail: '' });
    assert.throws(() => splitClaimSuffix(['Focused Requiring 1-5 DBQs', '(asthma']), /Ambiguous/);
});

test('migration starts at JST September 15, preserves existing detail and is idempotent', () => {
    const before = { appointmentDateTime: '2026-09-14T23:59:59+09:00', services: ['Focused Requiring 1-5 DBQs (asthma)'] };
    assert.equal(migrationPatch(before), null);
    const record = { ...before, appointmentDateTime: { _seconds: Date.parse('2026-09-15T00:00:00+09:00') / 1000 }, claimDetail: 'Existing\ntext', notes: 'unchanged' };
    const patch = migrationPatch(record);
    assert.deepEqual(patch, { services: ['Focused Requiring 1-5 DBQs'], claimDetail: 'Existing\ntext\n\nasthma' });
    assert.equal(migrationPatch({ ...record, ...patch }), null);
    assert.equal(record.notes, 'unchanged');
    assert.deepEqual(migrationPatch({ ...record, services: ['Audiologist Examination'], claimDetail: undefined }), { claimDetail: '' });
});

const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const modalFunctions = source.slice(source.indexOf('function openClaimDetailModal('), source.indexOf('// ===== 紹介先 分類ロジック ====='));
const clickListener = source.slice(source.indexOf("tableBody.addEventListener('click'"), source.indexOf("confirmEditBtn.addEventListener('click'"));
function harness({ failure = false, cacheMissing = false, stalledServer = false } = {}) {
    const data = { claimantName: 'TEST, SYNTHETIC', contractNumber: 'TEST.1.2', services: ['Focused Requiring 1-5 DBQs'], claimDetail: 'Old claim', notes: 'Preserved memo' };
    const elements = Object.fromEntries(['claimDetailIdentity', 'claimDetailServices', 'claimDetailStatus'].map(id => [id, { textContent: '' }]));
    const writes = [], docIds = [], alerts = [], reads = [];
    const snapshot = () => ({ exists: true, data: () => data });
    const ref = { get: async options => {
        reads.push(options?.source);
        if (options?.source === 'cache') {
            return { exists: !cacheMissing, data: () => data };
        }
        if (stalledServer) return new Promise(() => {});
        return snapshot();
    } };
    const ctx = vm.createContext({ console: { error() {} }, Intl, Date, Error,
        displayedAppointments: new Map(cacheMissing ? [] : [['synthetic-doc', { ...data }]]),
        claimDetailSaving: false, editingClaimDetailDocId: null, originalClaimDetail: '',
        claimDetailTextarea: { value: '', disabled: false }, claimDetailModal: { style: { display: 'none' } },
        saveClaimDetailBtn: { disabled: false }, cancelClaimDetailBtn: { disabled: false },
        normalizeAppointmentDateTimeMs: () => Date.parse('2026-09-15T09:00:00+09:00'),
        alert: message => alerts.push(message), confirm: () => false,
        document: { getElementById: id => elements[id], body: { classList: { add() {}, remove() {} } } },
        db: { collection: name => { assert.equal(name, 'appointments'); return { doc: id => { docIds.push(id); return ref; } }; },
            runTransaction: async fn => {
                if (failure) throw new Error('offline');
                await fn({ get: async actual => { assert.equal(actual, ref); return snapshot(); },
                    update: (actual, patch) => { assert.equal(actual, ref); writes.push({ ...patch }); Object.assign(data, patch); } });
            }
        }
    });
    vm.runInContext(modalFunctions, ctx);
    return { ctx, data, elements, writes, docIds, alerts, reads };
}

test('Claim detail opens synchronously without any database read while the server is stalled', () => {
    const h = harness({ stalledServer: true });
    h.ctx.openClaimDetailModal('synthetic-doc');
    assert.deepEqual(h.reads, []);
    assert.equal(h.ctx.claimDetailModal.style.display, 'flex');
    assert.equal(h.ctx.claimDetailTextarea.value, 'Old claim');
});

test('a record no longer in the list asks for reconnection without a server wait', async () => {
    for (const options of [{ cacheMissing: true }]) {
        const h = harness(options);
        await h.ctx.openClaimDetailModal('synthetic-doc');
        assert.deepEqual(h.reads, []);
        assert.equal(h.ctx.claimDetailModal.style.display, 'none');
            assert.equal(h.ctx.editingClaimDetailDocId, null);
        assert.match(h.alerts[0], /再接続/);
        assert.equal(h.writes.length, 0);
    }
});

test('claim editor opens the exact appointment, saves multiline detail alone and reopens persisted content', async () => {
    const h = harness();
    await h.ctx.openClaimDetailModal('synthetic-doc');
    assert.equal(h.ctx.claimDetailTextarea.value, 'Old claim');
    assert.match(h.elements.claimDetailIdentity.textContent, /TEST\.1\.2/);
    h.ctx.claimDetailTextarea.value = 'Claim A\n\nClaim B (TERA)\n';
    await h.ctx.saveClaimDetail();
    assert.deepEqual(h.writes, [{ claimDetail: 'Claim A\n\nClaim B (TERA)\n' }]);
    assert.equal(h.ctx.claimDetailModal.style.display, 'none');
    await h.ctx.openClaimDetailModal('synthetic-doc');
    assert.equal(h.ctx.claimDetailTextarea.value, h.data.claimDetail);
    assert.deepEqual(h.data.services, ['Focused Requiring 1-5 DBQs']);
    assert.equal(h.data.notes, 'Preserved memo');
    assert.ok(h.docIds.every(id => id === 'synthetic-doc'));
});

test('concurrent edits and failed saves keep the draft open and do not overwrite saved data', async () => {
    for (const failure of [false, true]) {
        const h = harness({ failure });
        await h.ctx.openClaimDetailModal('synthetic-doc');
        h.ctx.claimDetailTextarea.value = 'My draft';
        h.data.claimDetail = 'Other window';
        await h.ctx.saveClaimDetail();
        assert.equal(h.ctx.claimDetailModal.style.display, 'flex');
        assert.equal(h.ctx.claimDetailTextarea.value, 'My draft');
        assert.equal(h.ctx.claimDetailTextarea.disabled, false);
        assert.equal(h.data.claimDetail, 'Other window');
        assert.equal(h.writes.length, 0);
        assert.ok(h.elements.claimDetailStatus.textContent);
        h.ctx.closeClaimDetailModal();
        assert.equal(h.ctx.claimDetailModal.style.display, 'flex');
    }
});

test('clicking the dedicated Claim detail button routes to the matching appointment', () => {
    const calls = []; let handler; let prevented = false;
    const ctx = { tableBody: { addEventListener: (_, fn) => { handler = fn; } }, openClaimDetailModal: id => calls.push(id) };
    vm.runInNewContext(clickListener, ctx);
    handler({ target: { classList: { contains: () => false }, closest: selector => selector === 'tr' ? { dataset: { id: 'exact-appointment' } } : selector === '.services-cell' ? {} : null }, preventDefault() { prevented = true; } });
    assert.deepEqual(calls, ['exact-appointment']); assert.equal(prevented, true);
});
