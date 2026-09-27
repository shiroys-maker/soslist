const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const viewer = web.slice(web.indexOf('function openClaimDetailModal('), web.indexOf('// 氏名の部分一致マッチング'));
const handlers = web.slice(web.indexOf('function handleAppointmentInteraction('), web.indexOf("confirmEditBtn.addEventListener('click'"));
const data = () => ({ claimantName: 'TEST, WEB', contractNumber: 'SYNTHETIC.1.2',
    appointmentDateTime: { toDate: () => new Date('2026-09-24T01:00:00Z') }, services: ['Focused Requiring 1-5 DBQs'],
    claimDetail: 'Claim A: Direct\n\nClaim B: TERA\n<script>literal text</script>', notes: 'Independent memo' });
function context() {
    const events = {}, alerts = [];
    const tableBody = { innerHTML: '', querySelectorAll: () => [], addEventListener: (type, fn) => { events.table = fn; } };
    const mobile = { innerHTML: '', addEventListener: (type, fn) => { events.mobile = fn; } };
    const record = data();
    const snapshot = { forEach: fn => fn({ id: 'exact-web-doc', data: () => record }) };
    let listener;
    const query = { where() { return this; }, orderBy() { return this; }, limit() { return this; }, onSnapshot(fn) { listener = fn; return () => {}; } };
    const ctx = vm.createContext({ Date, Intl, console, HTMLElement: class HTMLElement {},
        firebase: { initializeApp() {}, auth() {}, storage() {}, firestore: () => ({ collection: () => query }) },
        SOSLIST_TARGET: { mobileUI: true, servicesCellClass: 'col-services services-cell', perReferralStatus: true },
        window: {}, unsubscribe: null, tableBody, mobileAppointmentsList: mobile,
        dateFilter: { value: '2026-09-24' }, shokaijyoEditingDocId: null,
        document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => mobile, body: { classList: { add() {}, remove() {} } } },
        claimDetailModal: { style: { display: 'none' } }, claimDetailText: { textContent: '' }, claimDetailIdentity: { textContent: '' },
        alert: text => alerts.push(text), MOBILE_CARD_ACTIONABLE_SELECTOR: 'button',
        toggleAppointmentCardExpansion() { throw new Error('Claim click must not expand its card'); }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'shared/core.js'), 'utf8') + viewer + handlers, ctx);
    ctx.setupRealtimeListener(); listener(snapshot);
    return { ctx, record, alerts, events, tableBody, mobile, emit: () => listener(snapshot) };
}

test('Web Claim detail reads current list data immediately and preserves literal multiline text', () => {
    const h = context(); const before = JSON.stringify(h.record);
    h.ctx.openClaimDetailModal('exact-web-doc');
    assert.equal(h.ctx.claimDetailModal.style.display, 'flex');
    assert.equal(h.ctx.claimDetailText.textContent, h.record.claimDetail);
    assert.equal(h.ctx.claimDetailText.scrollTop, 0);
    assert.match(h.ctx.claimDetailIdentity.textContent, /SYNTHETIC\.1\.2/);
    assert.equal(JSON.stringify(h.record), before);
    h.ctx.closeClaimDetailModal();
    assert.equal(h.ctx.claimDetailModal.style.display, 'none');
    assert.equal(h.ctx.claimDetailText.textContent, '');
    h.record.claimDetail = 'Updated on Local'; h.emit();
    h.ctx.openClaimDetailModal('exact-web-doc');
    assert.equal(h.ctx.claimDetailText.textContent, 'Updated on Local');
});

test('both desktop and mobile expose claim buttons and route nested clicks to the exact appointment', () => {
    const h = context();
    assert.match(h.tableBody.innerHTML, /<button[^>]*class="[^"]*services-cell[^>]*aria-haspopup="dialog"/);
    assert.match(h.mobile.innerHTML, /appointment-card-services services-cell/);
    assert.match(h.mobile.innerHTML, /claim-detail-link services-cell/);
    for (const layout of ['table', 'mobile']) {
        h.ctx.closeClaimDetailModal(); let prevented = false;
        const target = new h.ctx.HTMLElement();
        target.closest = selector => selector === 'tr' || selector === '.appointment-card' ? { dataset: { id: 'exact-web-doc' } }
            : selector === 'button' || selector === '.services-cell' ? target : null;
        h.events[layout]({ target, preventDefault() { prevented = true; } });
        assert.equal(prevented, true);
        assert.equal(h.ctx.claimDetailModal.style.display, 'flex');
        assert.equal(h.ctx.claimDetailText.textContent, h.record.claimDetail);
    }
});

test('empty claims stay empty and records outside the current list cannot open', () => {
    const h = context(); h.record.claimDetail = ''; h.emit();
    h.ctx.openClaimDetailModal('exact-web-doc');
    assert.equal(h.ctx.claimDetailText.textContent, '');
    h.ctx.closeClaimDetailModal(); h.ctx.openClaimDetailModal('unknown');
    assert.equal(h.ctx.claimDetailModal.style.display, 'none');
    assert.match(h.alerts[0], /再接続/);
});

test('Web viewer is read-only and has no save or database mutation path', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const modal = html.slice(html.indexOf('<div id="claimDetailModal"'), html.indexOf('<div id="searchResultsModal"'));
    assert.match(modal, /<div[^>]*id="claimDetailText"[^>]*role="region"/);
    assert.doesNotMatch(modal, /<textarea|contenteditable/);
    assert.doesNotMatch(modal, /保存|save/i);
    assert.doesNotMatch(viewer, /\bdb\.|\.update\(|\.set\(|runTransaction/);
});
