const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function environment(data, { fail = false, deferRead = false } = {}) {
    const writes = [], alerts = [];
    let release;
    const doc = { exists: true, data: () => data };
    const read = deferRead ? new Promise(resolve => { release = () => resolve(doc); }) : Promise.resolve(doc);
    const ref = { get: () => read, update: async patch => { if (fail) throw new Error('offline'); writes.push({ ...patch }); } };
    const ctx = vm.createContext({ console: { error() {} }, Date, Intl, alert: msg => alerts.push(msg), firebase: {
        initializeApp() {}, auth() {}, storage() {}, firestore: () => ({ collection: () => ({ doc: () => ref }) })
    } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../shared/core.js'), 'utf8'), ctx);
    return { ctx, writes, alerts, release };
}
function button(text = '受') {
    const attributes = {}, classes = new Set();
    return { disabled: false, textContent: text, attributes, setAttribute(k, v) { attributes[k] = v; }, removeAttribute(k) { delete attributes[k]; },
        classList: { toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } } };
}
function fixture() {
    return { services: ['RIGHT KNEE X-RAY', 'ECHOCARDIOGRAPHY', 'CBC'], appointmentDateTime: { toDate: () => new Date('2026-09-15T01:00:00Z') },
        referrals: { KIN: { isReceived: true }, ANSHIN: { isCompleted: true }, LAB: { isReceived: true } } };
}

test('a referral toggle updates only its destination and field', async () => {
    const data = fixture(), before = JSON.stringify(data), { ctx, writes } = environment(data);
    const target = button();
    await ctx.toggleAppointmentStatus(target, 'synthetic', 'isReceived', 'KIN');
    assert.deepEqual(writes, [{ 'referrals.KIN.isReceived': false }]);
    assert.equal(target.attributes['aria-pressed'], 'false');
    assert.equal(JSON.stringify(data), before);
    assert.equal(target.disabled, false);
});
test('legacy status is used only for the first destination', async () => {
    const data = fixture(); data.referrals = {}; data.isReceived = true;
    const { ctx, writes } = environment(data);
    await ctx.toggleAppointmentStatus(button(), 'synthetic', 'isReceived', 'KIN');
    await ctx.toggleAppointmentStatus(button(), 'synthetic', 'isReceived', 'ANSHIN');
    assert.deepEqual(writes, [{ 'referrals.KIN.isReceived': false }, { 'referrals.ANSHIN.isReceived': true }]);
});
test('double activation is blocked while saving and arrival remains appointment scoped', async () => {
    const { ctx, writes, release } = environment({ ...fixture(), isShown: false }, { deferRead: true });
    const target = button('未');
    const first = ctx.toggleAppointmentStatus(target, 'synthetic', 'isShown');
    await ctx.toggleAppointmentStatus(target, 'synthetic', 'isShown');
    assert.equal(target.disabled, true);
    release(); await first;
    assert.deepEqual(writes, [{ isShown: true }]);
    assert.equal(target.attributes['aria-pressed'], 'true');
});
test('failed writes retain the old visible status and release the control', async () => {
    const { ctx, writes, alerts } = environment(fixture(), { fail: true });
    const target = button('✓'); target.setAttribute('aria-pressed', 'true');
    await ctx.toggleAppointmentStatus(target, 'synthetic', 'isReceived', 'KIN');
    assert.deepEqual(writes, []);
    assert.equal(target.textContent, '✓');
    assert.equal(target.attributes['aria-pressed'], 'true');
    assert.equal(target.disabled, false);
    assert.equal(alerts.length, 1);
});
test('each grid row binds date and both controls to one destination; Lab has no date action', () => {
    const { ctx } = environment(fixture());
    const html = ctx.buildMobileReferralStatusHTML(fixture(), ['KIN', 'ANSHIN', 'LAB']);
    const rows = html.match(/<div class="mobile-referral-row"[\s\S]*?<\/div>/g);
    assert.equal(rows.length, 3);
    for (const [index, dest] of ['KIN', 'ANSHIN', 'LAB'].entries()) {
        const dests = [...rows[index].matchAll(/data-dest="([^"]+)"/g)].map(m => m[1]);
        assert.ok(dests.length >= 4 && dests.every(d => d === dest));
        assert.equal((rows[index].match(/aria-pressed=/g) || []).length, 2);
    }
    assert.doesNotMatch(rows[2], /<button[^>]*(referral-dest|visitdate-cell)/);
    assert.match(rows[2], /referral-lab-date[^>]*>&nbsp;<\/span>/);
});
test('collapsed service presentation preserves and escapes the entire original text', () => {
    const { ctx } = environment(fixture());
    const text = 'General Requiring 6-10 DBQs, ' + 'LONG SERVICE '.repeat(20) + '(<script>request</script>)';
    const html = ctx.buildServicesPreviewHTML([text], text, true, true);
    assert.match(html, /<details[^>]* open>/);
    assert.match(html, /&lt;script&gt;request&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.ok(html.includes(ctx.escapeHtml(text)));
    assert.match(html, /検査内容を編集/);
    assert.doesNotMatch(ctx.buildServicesPreviewHTML(['Audiologist'], 'Audiology'), /検査内容を編集/);
});

test('hearing label is reserved for standalone hearing loss and tinnitus DBQ appointments', () => {
    const { ctx } = environment(fixture());
    const labels = services => ctx.buildServicesPreviewHTML(services, services.join(', ')).match(/<span class="service-labels">(.*?)<\/span><\/span>/)[1];
    for (const services of [
        ['Audiologist Examination'],
        ['COMPREHENSIVE AUDIO TESTING', 'TYMPANOMETRY & REFLEX THRESH', 'Audiologist Examination'],
        ['Hearing Loss and Tinnitus DBQ'],
        ['DBQ AUDIO Hearing Loss and Tinnitus', 'AUDIOMETRY'],
        ['Hearing Loss & Tinnitus DBQ', 'TYMPANOMETRY']
    ]) {
        assert.match(labels(services), /聴力/);
        assert.doesNotMatch(labels(services), /一般診察/);
    }
    for (const services of [
        ['AUDIOMETRY'],
        ['Audiology'],
        ['AUDIOMETRY', 'Gen Med SHA Requiring 6-10 DBQs'],
        ['Audiologist Examination', 'Gen Med SHA Requiring 6-10 DBQs'],
        ['Hearing Loss and Tinnitus DBQ', 'Knee DBQ'],
        ['Hearing Loss and Tinnitus DBQ', 'CBC'],
        ['Gen Med SHA Requiring 6-10 DBQs', '(Hearing Loss and Tinnitus DBQ)']
    ]) assert.doesNotMatch(labels(services), /聴力/);
    assert.match(labels(['AUDIOMETRY', 'Gen Med SHA Requiring 6-10 DBQs']), /一般診察/);
});
