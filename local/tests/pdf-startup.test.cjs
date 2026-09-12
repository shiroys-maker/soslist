const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
    const scripts = [], requests = [], idle = [], documentOptions = [];
    let workers = 0, destroyedDocuments = 0;
    class Element {
        constructor() { this.dataset = {}; this.style = {}; this.children = []; this.clientWidth = 800; this.classList = { add() {}, remove() {} }; }
        setAttribute() {}
        addEventListener() {}
        append(child) { this.children.push(child); }
        replaceChildren(...children) { this.children = children; }
        remove() {}
        focus() {}
        showModal() { this.open = true; }
        close() { this.open = false; }
        getContext() { return {}; }
        querySelector(selector) { return this.controls[selector] ||= new Element(); }
        controls = {};
    }
    const dialog = new Element();
    const document = {
        currentScript: { src: 'https://app.invalid/shared/pdf-viewer.js' }, activeElement: new Element(),
        createElement: tag => tag === 'dialog' ? dialog : new Element(),
        head: { append: script => scripts.push(script) }, body: new Element()
    };
    const worker = { promise: Promise.resolve(), destroy() { throw Error('Shared worker must survive document close'); } };
    const lib = {
        PDFWorker: { create() { workers++; return worker; } },
        getDocument(options) {
            documentOptions.push(options);
            return { destroy: async () => { destroyedDocuments++; }, promise: Promise.resolve({ numPages: 1,
                getPage: async () => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
                    render: () => ({ promise: Promise.resolve(), cancel() {} }) }) }) };
        }
    };
    class XHR {
        open() {}
        send() { requests.push(this); }
        abort() { this.aborted = true; this.onabort?.(); }
        finish() { this.status = 200; this.response = new ArrayBuffer(4); this.onload(); }
    }
    const window = { addEventListener() {}, requestIdleCallback: fn => idle.push(fn), sosPdfEngine: lib };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../shared/pdf-viewer.js'), 'utf8'), {
        window, document, URL, Uint8Array, XMLHttpRequest: XHR, setTimeout, clearTimeout, performance
    });
    return { viewer: window.sosPdfViewer, scripts, requests, idle, dialog, documentOptions,
        counts: () => ({ workers, destroyedDocuments }) };
}

test('idle preparation runs once without fetching any PDF and reuses its worker', async () => {
    const h = harness();
    h.viewer.warmup(); h.viewer.warmup();
    assert.equal(h.idle.length, 1);
    assert.equal(h.scripts.length, 0);
    h.idle[0](); h.scripts[0].onload(); await tick();
    assert.equal(h.requests.length, 0);
    assert.equal(h.documentOptions.length, 0);
    for (let index = 0; index < 2; index++) {
        const opened = h.viewer.open(async () => 'https://example.invalid/synthetic.pdf');
        await tick(); h.requests[index].finish(); await opened; h.viewer.close();
    }
    assert.deepEqual(h.counts(), { workers: 1, destroyedDocuments: 2 });
    assert.equal(h.documentOptions[0].worker, h.documentOptions[1].worker);
});

test('a cold click starts the PDF request before the renderer finishes loading', async () => {
    const h = harness();
    const opened = h.viewer.open(async () => 'https://example.invalid/synthetic.pdf');
    await tick();
    assert.equal(h.scripts.length, 1);
    assert.equal(h.requests.length, 1);
    h.requests[0].finish();
    assert.equal(h.documentOptions.length, 0);
    h.scripts[0].onload(); await opened;
    assert.equal(h.documentOptions.length, 1);
    assert.equal(h.dialog.querySelector('.pdf-viewport').children.length, 1);
});

test('closing during parallel startup aborts the download and prevents late rendering', async () => {
    const h = harness();
    const opened = h.viewer.open(async () => 'https://example.invalid/synthetic.pdf');
    await tick(); h.viewer.close(); h.scripts[0].onload(); await opened;
    assert.equal(h.requests[0].aborted, true);
    assert.equal(h.documentOptions.length, 0);
    assert.equal(h.dialog.open, false);
});

test('a failed warmup can retry on click, without an abandoned request', async () => {
    const h = harness();
    h.viewer.warmup(); h.idle[0](); h.scripts[0].onerror(); await tick();
    const opened = h.viewer.open(async () => 'https://example.invalid/synthetic.pdf');
    await tick(); h.scripts[1].onerror(); await opened;
    assert.equal(h.requests[0].aborted, true);
    assert.equal(h.dialog.open, true);
    assert.match(h.dialog.querySelector('.pdf-status').textContent, /表示できません/);
});
