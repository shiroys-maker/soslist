// Run with PLAYWRIGHT_MODULE pointing to an installed playwright package.
// Set CLAIM_BASE_URL to verify the deployed assets with synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
const fixture = 'Synthetic claim\n\n<script>literal text</script>\n'.repeat(800);
async function source(file) {
    if (!process.env.CLAIM_BASE_URL) return fs.readFileSync(path.join(root, file), 'utf8');
    const response = await fetch(new URL(file, process.env.CLAIM_BASE_URL));
    assert.equal(response.status, 200);
    return response.text();
}
(async () => {
    const [html, css, sharedCss, web, ui] = await Promise.all(
        ['index.html', 'style.css', 'shared/ui.css', 'script.js', 'shared/ui.js'].map(source));
    const modal = html.slice(html.indexOf('<div id="claimDetailModal"'), html.indexOf('<div id="searchResultsModal"'));
    const viewer = web.slice(web.indexOf('function openClaimDetailModal('), web.indexOf('// 氏名の部分一致マッチング'));
    const listeners = web.slice(web.indexOf("closeClaimDetailButton.addEventListener('click'"), web.indexOf('mobileCompactViewButton?.addEventListener'));
    const engine = process.env.CLAIM_BROWSER || 'webkit';
    const browser = await playwright[engine].launch(engine === 'chromium' ? { channel: 'chrome' } : {});
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 667, height: 375 }, { width: 1280, height: 800 }]) {
            const page = await browser.newPage({ viewport, isMobile: viewport.width < 800, hasTouch: true });
            await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><button id="opener">Claim表示</button>' + modal);
            await page.addStyleTag({ content: css + sharedCss });
            await page.addScriptTag({ content: `
                const claimDetailModal = document.getElementById('claimDetailModal');
                const claimDetailText = document.getElementById('claimDetailText');
                const claimDetailIdentity = document.getElementById('claimDetailIdentity');
                const closeClaimDetailButton = document.getElementById('closeClaimDetailButton');
                const record = { claimantName: 'SYNTHETIC TEST', contractNumber: 'TEST.1.2', claimDetail: ${JSON.stringify(fixture)} };
                const displayedAppointments = new Map([['fixture', record]]);
                function getCorrectedAppointmentDate() { return null; }
                ${viewer}
                ${listeners}
                document.getElementById('opener').addEventListener('click', () => openClaimDetailModal('fixture'));
            ` });
            await page.addScriptTag({ content: ui });
            for (let repeat = 0; repeat < 3; repeat++) {
                await page.locator('#opener').tap();
                assert.equal(await page.evaluate(() => document.activeElement.id), 'closeClaimDetailButton', 'opening the viewer must focus Close, without activating a native text input');
                assert.equal(await page.locator('#claimDetailText').textContent(), fixture);
                assert.equal(await page.locator('#claimDetailText script').count(), 0);
                assert.equal(await page.locator('#claimDetailText').evaluate(e => e.scrollTop), 0);
                const before = await page.locator('#closeClaimDetailButton').boundingBox();
                await page.locator('#claimDetailText').evaluate(e => { e.scrollTop = e.scrollHeight; });
                const after = await page.locator('#closeClaimDetailButton').boundingBox();
                assert.deepEqual(after, before, 'scrolling the claim must not move Close');
                assert.ok(after.y >= 0 && after.y + after.height <= viewport.height);
                assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id,
                    { x: after.x + after.width / 2, y: after.y + after.height / 2 }), 'closeClaimDetailButton');
                await page.touchscreen.tap(after.x + after.width / 2, after.y + after.height / 2);
                assert.equal(await page.locator('#claimDetailModal').isHidden(), true, 'one tap must close');
                assert.equal(await page.locator('body').evaluate(e => e.classList.contains('modal-open')), false);
                assert.equal(await page.evaluate(() => record.claimDetail), fixture);
            }
            await page.locator('#opener').click();
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#claimDetailModal').isHidden(), true);
            await page.evaluate(() => { record.claimDetail = ''; });
            await page.locator('#opener').tap();
            assert.equal(await page.locator('#claimDetailText').textContent(), '');
            await page.locator('#closeClaimDetailButton').tap();
            console.log(`${engine} ${viewport.width}x${viewport.height}: repeated taps, scroll, literal text, Escape and empty claim passed`);
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
