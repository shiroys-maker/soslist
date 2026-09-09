const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(`${__dirname}/xray-upload.js`, 'utf8'), context);

function fixture(parseImages) {
    const previews = [];
    const alerts = [];
    const elements = Object.fromEntries(['out-region', 'out-findings', 'out-impression', 'caption-box']
        .map(id => [id, { innerText: id === 'out-region' ? 'CHEST XR' : 'Previous report' }]));
    elements['img-container'] = { insertBefore: image => previews.push(image) };
    const loader = { style: {}, dataset: {} };
    const upload = context.createXrayUploader({
        parseImages, toDataUrl: async file => file.name, loader,
        document: { getElementById: id => elements[id], createElement: () => ({}) },
        alert: message => alerts.push(message),
    });
    return { upload, previews, alerts, loader, elements };
}
const file = name => ({ name, type: 'image/png' });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('sequential drops each use all images, serialize execution, and suppress older results', async () => {
    const requests = [];
    const f = fixture(files => new Promise(resolve => requests.push({ names: files.map(f => f.name), resolve })));
    const first = f.upload([file('A')]);
    await tick();
    const second = f.upload([file('B')]);
    const third = f.upload([file('C'), file('D')]);
    await tick();
    assert.equal(requests.length, 1);
    requests[0].resolve({ findings: 'A only', impression: 'old' });
    await first;
    await tick();
    assert.equal(f.elements['out-findings'].innerText, 'Previous report');
    assert.equal(f.loader.style.display, 'inline');
    requests[1].resolve({ findings: 'AB', impression: 'old' });
    await second;
    await tick();
    requests[2].resolve({ findings: 'ABCD integrated', impression: 'latest' });
    await third;
    assert.deepEqual(requests.map(r => Array.from(r.names)), [['A'], ['A', 'B'], ['A', 'B', 'C', 'D']]);
    assert.deepEqual(f.previews.map(p => p.src), ['A', 'B', 'C', 'D']);
    assert.equal(f.elements['out-findings'].innerText, 'ABCD integrated');
    assert.equal(f.elements['out-impression'].innerText, 'latest');
    assert.equal(f.loader.style.display, 'none');
});

test('a failed reading does not stop later cumulative readings', async () => {
    let count = 0;
    const f = fixture(async files => {
        if (++count === 1) throw new Error('temporary failure');
        assert.equal(files.length, 2);
        return { findings: 'Both', impression: 'Updated' };
    });
    await f.upload([file('A')]);
    assert.equal(f.alerts.length, 1);
    assert.equal(f.elements['out-findings'].innerText, 'Previous report');
    await f.upload([file('B')]);
    assert.equal(f.elements['out-findings'].innerText, 'Both');
});

test('rejecting an over-limit drop does not pollute the accumulated images', async () => {
    const counts = [];
    const f = fixture(async files => {
        counts.push(files.length);
        return { findings: 'valid', impression: 'valid' };
    });
    await f.upload([file('A')]);
    await f.upload(Array.from({ length: 12 }, (_, i) => file(`excess-${i}`)));
    await f.upload([file('B')]);
    assert.deepEqual(counts, [1, 2]);
    assert.equal(f.alerts.length, 1);
    assert.equal(f.previews.length, 2);
});
