const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const NOW = new Date('2026-09-15T03:00:00Z');
const timestamp = iso => ({ toDate: () => new Date(iso) });
const appointment = (extra = {}) => ({
    services: ['RIGHT KNEE X-RAY', 'ECHOCARDIOGRAPHY'],
    appointmentDateTime: timestamp('2026-09-01T00:00:00Z'),
    referrals: { KIN: { visitDate: '09/14 09:00', isCompleted: false } }, ...extra
});
function harness(mobileUI = true) {
    let clock = NOW.getTime(), timerId = 0;
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
    const listeners = [], timers = new Map(), controls = {}, buttons = [{}, {}];
    buttons.forEach(b => { b.setAttribute = (name, value) => { b[name] = value; }; });
    for (const id of ['dateFilter', 'prevDateButton', 'nextDateButton', 'todayDateButton', 'mobileAppointmentsList']) controls[id] = {};
    controls.dateFilter.value = '2026-09-15';
    const tableBody = { innerHTML: '', querySelectorAll: () => [] };
    const db = { collection() {
        const ops = [];
        return { where(...args) { ops.push(['where', ...args]); return this; }, orderBy(...args) { ops.push(['orderBy', ...args]); return this; }, limit(...args) { ops.push(['limit', ...args]); return this; },
            onSnapshot(callback) { const listener = { ops, callback }; listeners.push(listener); return () => { listener.stopped = true; }; } };
    } };
    const ctx = vm.createContext({ console, Date: Clock, Intl, window: {},
        document: { querySelector: () => null, querySelectorAll: () => buttons, getElementById: id => controls[id] },
        firebase: { initializeApp() {}, auth() {}, storage() {}, firestore: () => db },
        SOSLIST_TARGET: { mobileUI, deleteColumn: !mobileUI, perReferralStatus: true, servicesCellClass: '' },
        dateFilter: controls.dateFilter, tableBody, unsubscribe: null, shokaijyoEditingDocId: null,
        setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval(id) { timers.delete(id); }
    });
    vm.runInContext(fs.readFileSync(process.env.SOSLIST_CORE_TEST_FILE || path.join(__dirname, '../../shared/core.js'), 'utf8'), ctx);
    const emit = (rows, index = listeners.length - 1) => listeners[index].callback({ forEach: fn => rows.forEach(([id, data]) => fn({ id, data: () => data })) });
    return { ctx, listeners, timers, controls, buttons, tableBody, emit, advance(ms) { clock += ms; for (const fn of timers.values()) fn(); } };
}

test('past visit and completion must belong to the same visible referral; received is not required', () => {
    const { ctx } = harness();
    assert.equal(ctx.isAwaitingResults(appointment(), NOW), true);
    assert.equal(ctx.isAwaitingResults(appointment({ referrals: {
        KIN: { visitDate: '09/14 09:00', isCompleted: true },
        ANSHIN: { visitDate: '09/16 09:00', isCompleted: false }
    } }), NOW), false);
    assert.equal(ctx.isAwaitingResults(appointment({ referrals: {
        KIN: { visitDate: '09/14 09:00', isCompleted: true },
        ANSHIN: { visitDate: '09/14 10:00', isCompleted: false }
    } }), NOW), true);
    assert.equal(ctx.isAwaitingResults(appointment({ referrals: {} }), NOW), false);
    assert.equal(ctx.isAwaitingResults(appointment({ services: ['CBC'], referrals: {} }), NOW), true);
});

test('Lab uses the appointment time and its own completion state, keeping the UI date blank', () => {
    const { ctx } = harness();
    const data = appointment({ services: ['RIGHT KNEE X-RAY', 'CBC'],
        referrals: { KIN: { visitDate: '09/14 09:00', isCompleted: true }, LAB: { isCompleted: false } } });
    assert.equal(ctx.isAwaitingResults(data, NOW), true);
    data.referrals.LAB.isCompleted = true;
    assert.equal(ctx.isAwaitingResults(data, NOW), false);
    data.referrals.LAB.isCompleted = false;
    data.appointmentDateTime = timestamp('2026-09-15T03:00:00Z');
    assert.equal(ctx.isAwaitingResults(data, NOW), false);
    data.appointmentDateTime = timestamp('2026-09-16T03:00:00Z');
    assert.equal(ctx.isAwaitingResults(data, NOW), false);
    assert.match(ctx.buildMobileReferralStatusHTML(data, ['KIN', 'LAB']), /referral-lab-date[^>]*>&nbsp;<\/span>/);
});

test('legacy fallback belongs to first referral only; explicit empty/false values override it', () => {
    const { ctx } = harness();
    assert.equal(ctx.isAwaitingResults(appointment({ referrals: {}, visitDate: '09/14 09:00', isCompleted: false }), NOW), true);
    assert.equal(ctx.isAwaitingResults(appointment({ referrals: {}, visitDate: '09/14 09:00', isCompleted: true }), NOW), false);
    assert.equal(ctx.isAwaitingResults(appointment({ visitDate: '09/14 09:00', referrals: { KIN: { visitDate: '' } } }), NOW), false);
    assert.equal(ctx.isAwaitingResults(appointment({ isCompleted: true }), NOW), true);
});

test('cutoff is two calendar months in JST, exclusive, including month-end and year rollover', () => {
    const { ctx } = harness();
    assert.equal(ctx.resultsWaitingCutoff(NOW).toISOString(), '2026-07-15T03:00:00.000Z');
    assert.equal(ctx.resultsWaitingCutoff(new Date('2026-04-30T15:30:00Z')).toISOString(), '2026-02-28T15:30:00.000Z');
    assert.equal(ctx.resultsWaitingCutoff(new Date('2026-01-15T03:00:00Z')).toISOString(), '2025-11-15T03:00:00.000Z');
    assert.equal(ctx.isAwaitingResults(appointment({ appointmentDateTime: timestamp('2026-07-15T03:00:00Z') }), NOW), false);
    assert.equal(ctx.isAwaitingResults(appointment({ appointmentDateTime: timestamp('2026-07-15T03:00:00.001Z') }), NOW), true);
    assert.equal(ctx.isAwaitingResults(appointment({ appointmentDateTime: null }), NOW), false);
});

test('JST visit parsing rejects invalid dates and resolves yearless New Year dates near the appointment', () => {
    const { ctx } = harness();
    const parse = raw => ctx.parseResultsVisitDate(raw, appointment());
    for (const raw of ['', 'bad', '09/31 09:00', '09/14 24:00', '09/14 09:60']) assert.equal(parse(raw), null);
    assert.equal(parse('09/14').toISOString(), '2026-09-14T00:00:00.000Z');
    const december = appointment({ appointmentDateTime: timestamp('2026-12-28T00:00:00Z') });
    assert.equal(ctx.parseResultsVisitDate('01/05 10:00', december).toISOString(), '2027-01-05T01:00:00.000Z');
    assert.equal(ctx.isAwaitingResults(appointment({ referrals: { KIN: { visitDate: '09/15 12:00' } } }), NOW), false);
    assert.equal(ctx.isAwaitingResults(appointment({ referrals: { KIN: { visitDate: '09/15 11:59' } } }), NOW), true);
});

test('both layouts show pending rows in appointment order, lift the normal start date and row limit, then restore', () => {
    for (const mobileUI of [true, false]) {
        const h = harness(mobileUI);
        h.ctx.setResultsWaitingMode(true);
        assert.ok(h.buttons.every(button => button['aria-pressed'] === 'true'));
        assert.equal(h.controls.dateFilter.disabled, true);
        assert.equal(h.listeners[0].ops[0][1], 'appointmentDateTime');
        assert.equal(h.listeners[0].ops[0][3].toISOString(), '2026-07-15T03:00:00.000Z');
        assert.equal(h.listeners[0].ops.some(op => op[0] === 'limit'), false);
        const later = appointment({ appointmentDateTime: timestamp('2026-09-10T00:00:00Z') });
        h.emit([['later', later], ['earlier', appointment()], ['done', appointment({ isCompleted: true, referrals: {} })]]);
        assert.ok(h.tableBody.innerHTML.indexOf('data-id="earlier"') < h.tableBody.innerHTML.indexOf('data-id="later"'));
        assert.doesNotMatch(h.tableBody.innerHTML, /data-id="done"/);
        if (mobileUI) assert.ok(h.controls.mobileAppointmentsList.innerHTML.indexOf('data-id="earlier"') < h.controls.mobileAppointmentsList.innerHTML.indexOf('data-id="later"'));
        h.emit([]); assert.match(h.tableBody.innerHTML, /結果待ちの予約はありません/);
        h.ctx.setResultsWaitingMode(false);
        assert.ok(h.buttons.every(button => button['aria-pressed'] === 'false'));
        assert.equal(h.controls.dateFilter.value, '2026-09-15');
        assert.equal(h.controls.dateFilter.disabled, false);
        assert.ok(h.listeners[0].stopped);
        assert.equal(h.timers.size, 0);
        assert.ok(h.listeners[1].ops.some(op => op[0] === 'limit' && op[1] === 300));
        h.emit([['normal', appointment()]]); const normal = h.tableBody.innerHTML;
        h.emit([['stale', appointment()]], 0); assert.equal(h.tableBody.innerHTML, normal);
    }
});

test('time passing and realtime completion re-evaluate pending results without extra queries', () => {
    const h = harness(); h.ctx.setResultsWaitingMode(true);
    const data = appointment({ referrals: { KIN: { visitDate: '09/15 12:00' } } });
    h.emit([['timed', data]]); assert.doesNotMatch(h.tableBody.innerHTML, /data-id="timed"/);
    h.advance(30000); assert.match(h.tableBody.innerHTML, /data-id="timed"/);
    data.referrals.KIN.isCompleted = true; h.emit([['timed', data]]);
    assert.doesNotMatch(h.tableBody.innerHTML, /data-id="timed"/);
    assert.equal(h.listeners.length, 1);
    h.ctx.unsubscribe(); assert.equal(h.timers.size, 0);
});


test('an attended referral with no date remains waiting after its sibling completes', () => {
    for (const mobileUI of [true, false]) {
        const h = harness(mobileUI); h.ctx.setResultsWaitingMode(true);
        const data = appointment({ referrals: {
            KIN: { visitDate: '09/14 09:00', isCompleted: false },
            ANSHIN: { visitDate: '', isReceived: true, isCompleted: false }
        } });
        const visible = () => {
            h.emit([['partial', data]]);
            assert.match(h.tableBody.innerHTML, /data-id="partial"/);
            if (mobileUI) assert.match(h.controls.mobileAppointmentsList.innerHTML, /data-id="partial"/);
        };
        visible();
        data.referrals.KIN.isCompleted = true;
        visible();
        data.referrals.ANSHIN.isCompleted = true;
        h.emit([['partial', data]]);
        assert.doesNotMatch(h.tableBody.innerHTML, /data-id="partial"/);
        if (mobileUI) assert.doesNotMatch(h.controls.mobileAppointmentsList.innerHTML, /data-id="partial"/);
        data.referrals.ANSHIN.isCompleted = false;
        visible();
        assert.equal(h.listeners.length, 1);
    }
});

test('undated attendance is scoped to the active destination and retains the appointment time gate', () => {
    const { ctx } = harness();
    const data = appointment({ services: ['ECHOCARDIOGRAPHY'], referrals: { ANSHIN: { isReceived: true } } });
    assert.equal(ctx.isAwaitingResults(data, NOW), true, 'single attended waiting referral');
    data.referrals.ANSHIN.isCompleted = true;
    assert.equal(ctx.isAwaitingResults(data, NOW), false, 'single completed referral');
    data.referrals.ANSHIN.isCompleted = false;
    data.appointmentDateTime = timestamp(NOW.toISOString());
    assert.equal(ctx.isAwaitingResults(data, NOW), false);
    data.appointmentDateTime = timestamp('2026-09-16T00:00:00Z');
    assert.equal(ctx.isAwaitingResults(data, NOW), false);
    const legacy = appointment({ services: ['ECHOCARDIOGRAPHY'], referrals: {}, isReceived: true });
    assert.equal(ctx.isAwaitingResults(legacy, NOW), true);
    legacy.referrals.ANSHIN = { isReceived: false };
    assert.equal(ctx.isAwaitingResults(legacy, NOW), false, 'explicit false overrides legacy attendance');
    assert.equal(ctx.isAwaitingResults(appointment({ isReceived: true, referrals: { KIN: { isCompleted: true } } }), NOW), false,
        'first-destination legacy attendance cannot activate a sibling');
});

test('empty, unrequested, cancelled, future and inactive destinations are not waiting', () => {
    const { ctx } = harness();
    for (const raw of [undefined, '', '   ', '取消', 'キャンセル', '未依頼', '紹介なし', 'bad', '09/31 09:00', '09/16 09:00']) {
        const data = appointment({ services: ['ECHOCARDIOGRAPHY'], referrals: { ANSHIN: { visitDate: raw } } });
        assert.equal(ctx.isAwaitingResults(data, NOW), false, String(raw));
        if (raw && raw.trim()) {
            data.referrals.ANSHIN.isReceived = true;
            assert.equal(ctx.isAwaitingResults(data, NOW), false, 'nonblank date/status must not use undated fallback: ' + raw);
        }
    }
    const inactive = appointment({ services: [], referrals: { ANSHIN: { isReceived: true, visitDate: '09/14 09:00' } } });
    assert.equal(ctx.isAwaitingResults(inactive, NOW), false);
    const none = appointment();
    none.referralRouting = { version: 1, provider: 'codex', sourceServices: [...none.services], sourceCptCodes: [], destinations: [], purposes: {} };
    assert.equal(ctx.isAwaitingResults(none, NOW), false, 'explicit no-referral routing');
});

test('mixed lab and referral completion keeps either remaining result without mutating source data', () => {
    const { ctx } = harness();
    for (const [labDone, referralDone, expected] of [[false, false, true], [true, false, true], [false, true, true], [true, true, false]]) {
        const data = appointment({ services: ['CBC', 'ECHOCARDIOGRAPHY'], referrals: {
            LAB: { isCompleted: labDone }, ANSHIN: { isReceived: true, isCompleted: referralDone }
        } });
        const before = JSON.stringify(data);
        assert.equal(ctx.isAwaitingResults(data, NOW), expected);
        assert.equal(JSON.stringify(data), before);
    }
});
