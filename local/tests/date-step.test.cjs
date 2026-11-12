const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ts = iso => ({ toDate: () => new Date(iso) });
const row = (id, ymd) => [id, { services: [], appointmentDateTime: ts(`${ymd}T10:00:00+09:00`) }];

function harness({ getResult } = {}) {
    const listeners = [], gets = [], controls = {}, changes = [];
    for (const id of ['dateFilter', 'prevDateButton', 'nextDateButton', 'todayDateButton', 'mobileAppointmentsList']) controls[id] = {};
    controls.dateFilter.value = '2026-11-10';
    let ctx;
    // Mirrors script.js: a date change restarts the list listener.
    controls.dateFilter.dispatchEvent = () => { changes.push(controls.dateFilter.value); ctx.setupRealtimeListener(); };
    const summaryDateInput = { value: '2026-11-10' };
    const db = { collection() {
        return { where() { return this; }, orderBy() { return this; }, limit() { return this; },
            get() { gets.push(1); return getResult ? getResult() : new Promise(() => {}); },
            onSnapshot(callback) { listeners.push(callback); return () => {}; } };
    } };
    const timers = [];
    ctx = vm.createContext({ console: { ...console, warn() {} }, Date, Intl, Promise, window: {}, Event: class { constructor(t) { this.type = t; } },
        document: { querySelector: () => null, querySelectorAll: () => [], getElementById: id => controls[id] },
        firebase: { initializeApp() {}, auth() {}, storage() {}, firestore: () => db },
        SOSLIST_TARGET: { mobileUI: false, deleteColumn: true, perReferralStatus: true, servicesCellClass: '' },
        dateFilter: controls.dateFilter, summaryDateInput, tableBody: { innerHTML: '', querySelectorAll: () => [] },
        unsubscribe: null, shokaijyoEditingDocId: null,
        setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval() {}, clearInterval() {}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../shared/core.js'), 'utf8'), ctx);
    const emit = rows => listeners[listeners.length - 1]({ forEach: fn => rows.forEach(([id, data]) => fn({ id, data: () => data })) });
    return { ctx, controls, summaryDateInput, gets, changes, emit, fireTimers: () => timers.splice(0).forEach(fn => fn()) };
}

test('next/prev use dates already loaded in the list without querying Firestore', async () => {
    const h = harness();
    h.ctx.setupRealtimeListener();
    h.emit([row('a', '2026-11-10'), row('b', '2026-11-12'), row('c', '2026-11-17')]);
    await h.ctx.jumpToAdjacentReservationDate(1);
    assert.equal(h.controls.dateFilter.value, '2026-11-12');
    h.emit([row('b', '2026-11-12'), row('c', '2026-11-17')]);
    await h.ctx.jumpToAdjacentReservationDate(1);
    assert.equal(h.controls.dateFilter.value, '2026-11-17');
    await h.ctx.jumpToAdjacentReservationDate(-1);
    assert.equal(h.controls.dateFilter.value, '2026-11-12');
    h.summaryDateInput.value = '2026-11-12';
    await h.ctx.jumpToAdjacentSummaryReservationDate(-1);
    assert.equal(h.summaryDateInput.value, '2026-11-10');
    assert.equal(h.gets.length, 0);
    assert.deepEqual(h.changes, ['2026-11-12', '2026-11-17', '2026-11-12']);
});

test('a stalled Firestore lookup falls back to one calendar day', async () => {
    const h = harness();
    const pending = h.ctx.jumpToAdjacentReservationDate(-1);
    await Promise.resolve();
    h.fireTimers();
    await pending;
    assert.equal(h.gets.length, 1);
    assert.equal(h.controls.dateFilter.value, '2026-11-09');
});

test('a cache-only answer is not trusted; a server answer is used', async () => {
    const cached = harness({ getResult: async () => ({ empty: true, metadata: { fromCache: true }, docs: [] }) });
    await cached.ctx.jumpToAdjacentReservationDate(1);
    assert.equal(cached.controls.dateFilter.value, '2026-11-11');
    const server = harness({ getResult: async () => ({ empty: false, metadata: { fromCache: false }, docs: [{ data: () => row('x', '2026-11-03')[1] }] }) });
    await server.ctx.jumpToAdjacentReservationDate(-1);
    assert.equal(server.controls.dateFilter.value, '2026-11-03');
});
