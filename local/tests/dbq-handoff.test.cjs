const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const listenerSource = source.slice(source.indexOf("tableBody.addEventListener('click'"), source.indexOf("confirmEditBtn.addEventListener('click'"));
const payloadSource = source.slice(source.indexOf('function buildDetailsPayload('), source.indexOf('function handleDetailStorageEvent('));
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ exists = true, error, bridge = true } = {}) {
    const reads = [], messages = [], alerts = [];
    const button = { disabled: false };
    let click;
    const record = { claimantName: 'DOE, JANE', contractNumber: 'SYNTHETIC.1.2',
        notes: 'Claims: Neck; requested direct opinion', services: [],
        appointmentDateTime: { toDate: () => new Date('2026-09-23T01:00:00Z') } };
    const ctx = { console, Date, Object, Number, Array, alert: message => alerts.push(message),
        window: { webkit: { messageHandlers: bridge ? { openDBQProcessor: { postMessage: value => messages.push(value) } } : {} } },
        tableBody: { addEventListener: (_, handler) => { click = handler; } },
        determineReferralDests: () => [],
        readInteractionAppointment: id => {
            reads.push(id);
            return error ? Promise.reject(error) : Promise.resolve({ exists, data: () => record });
        }
    };
    vm.runInNewContext(payloadSource + listenerSource, ctx);
    return { button, reads, messages, alerts, record, click() {
        click({ target: { classList: { contains: () => false }, closest: selector =>
            selector === 'tr' ? { dataset: { id: 'synthetic-appointment' } } : selector === '.dbq-btn' ? button : null } });
    } };
}

test('DBQ opens with the displayed appointment and memo while the server is stalled', async () => {
    const h = harness(); h.click();
    assert.equal(h.button.disabled, true);
    await flush();
    assert.deepEqual(h.reads, ['synthetic-appointment']);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].docId, 'synthetic-appointment');
    assert.equal(h.messages[0].contractNumber, h.record.contractNumber);
    assert.equal(h.messages[0].notes, h.record.notes);
    assert.equal(h.messages[0].appointmentDateTimeMs, Date.parse('2026-09-23T01:00:00Z'));
    assert.equal(h.button.disabled, false);
    assert.equal(h.alerts.length, 0);
});

test('missing or unreadable local records do not launch and release the button', async () => {
    for (const options of [{ exists: false }, { error: new Error('cache unavailable') }]) {
        const h = harness(options); h.click(); await flush();
        assert.equal(h.messages.length, 0);
        assert.equal(h.button.disabled, false);
        assert.equal(h.alerts.length, 1);
    }
});

test('a browser without the Local bridge does not load or hand off records', () => {
    const h = harness({ bridge: false }); h.click();
    assert.equal(h.reads.length, 0);
    assert.equal(h.messages.length, 0);
    assert.equal(h.button.disabled, false);
    assert.equal(h.alerts.length, 1);
});
