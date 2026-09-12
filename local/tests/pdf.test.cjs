const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness({ exists = true, fileName = 'Example PDF.pdf', reject } = {}) {
    const paths = [], opened = [];
    const storage = { ref(candidate) { paths.push(candidate); return { async getDownloadURL() { if (reject) await reject(candidate); return 'https://example.invalid/synthetic.pdf'; } }; } };
    const db = { collection() { return { doc() { return { async get() { return { exists, data: () => ({ originalFileName: fileName }) }; } }; } }; } };
    const ctx = vm.createContext({ console, window: { sosPdfViewer: { async open(resolve) { opened.push(await resolve()); } }, open() { throw Error('Must not open an external window'); } }, firebase: { initializeApp() {}, auth() {}, firestore: () => db, storage: () => storage } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../shared/core.js'), 'utf8'), ctx);
    return { ctx, paths, opened };
}
test('PDF button resolves the stored path into the in-app viewer', async () => {
    const h = harness(); await h.ctx.handleViewPdf('synthetic');
    assert.deepEqual(h.paths, ['Example PDF.pdf']);
    assert.deepEqual(h.opened, ['https://example.invalid/synthetic.pdf']);
});
test('legacy PDF path fallback is retained', async () => {
    const h = harness({ reject(candidate) { if (!candidate.startsWith('pdfs/')) throw { code: 'storage/object-not-found' }; } });
    await h.ctx.handleViewPdf('synthetic');
    assert.deepEqual(h.paths, ['Example PDF.pdf', 'pdfs/Example PDF.pdf']);
});
test('missing records and filenames produce a closable source error without storage access', async () => {
    for (const options of [{ exists: false }, { fileName: '' }]) {
        const h = harness(options);
        await assert.rejects(h.ctx.handleViewPdf('synthetic'), error => error.pdfSourceError === true);
        assert.deepEqual(h.paths, []);
    }
});
test('permission errors do not try alternate paths; missing files exhaust bounded unique paths', async () => {
    const denied = harness({ reject() { throw { code: 'storage/unauthorized' }; } });
    await assert.rejects(denied.ctx.handleViewPdf('synthetic'), error => error.code === 'storage/unauthorized');
    assert.equal(denied.paths.length, 1);
    const missing = harness({ fileName: 'example.pdf', reject() { throw { code: 'storage/object-not-found' }; } });
    await assert.rejects(missing.ctx.handleViewPdf('synthetic'), error => error.pdfSourceError === true);
    assert.deepEqual(missing.paths, ['example.pdf', 'pdfs/example.pdf']);
});
