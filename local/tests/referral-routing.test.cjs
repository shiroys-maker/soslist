const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const coreFile = process.env.SOSLIST_CORE_TEST_FILE || path.join(__dirname, '../../shared/core.js');
const ctx = vm.createContext({ console, Date, Intl, firebase: { initializeApp() {}, auth() {}, firestore() {}, storage() {} } });
vm.runInContext(fs.readFileSync(coreFile, 'utf8'), ctx);
vm.runInContext('const SOSLIST_TARGET = { referralHeaderDateMode: "visitDate", stampSrc: "stamp.png" };', ctx);
function fixture(date = '2026-09-25T00:00:00Z') {
  return { claimantName: 'TEST, SYNTHETIC', dateOfBirth: '01/02/1990', services: ['Cardiac ultrasonography', 'Thoracic radiography', 'Calcaneal radiograph', 'Treponemal antibody', 'MRI brain'], cptCode: [], appointmentDateTime: { toDate: () => new Date(date) }, referralRouting: {
    version: 1, provider: 'codex', sourceServices: ['Cardiac ultrasonography', 'Thoracic radiography', 'Calcaneal radiograph', 'Treponemal antibody', 'MRI brain'], sourceCptCodes: [],
    destinations: ['KIN', 'ANSHIN', 'LAB'], purposes: { KIN: '右踵骨X線の依頼', ANSHIN: '心エコー検査、胸部X線の依頼' },
    reviewRequired: true, assignments: [{ serviceIndex: 4, destination: 'REVIEW', reason: '紹介先未設定' }],
  } };
}
test('semantic routing overrides regex and keeps LAB date gate', () => {
  const data = fixture();
  assert.deepEqual(Array.from(ctx.determineReferralDests(data.services, null, data)), ['KIN', 'ANSHIN', 'LAB']);
  const older = fixture('2026-08-23T14:59:00Z');
  assert.deepEqual(Array.from(ctx.determineReferralDests(older.services, null, older)), ['KIN', 'ANSHIN']);
  const boundary = fixture('2026-08-23T15:00:00Z');
  assert.ok(ctx.determineReferralDests(boundary.services, null, boundary).includes('LAB'));
});
test('Codex purposes render once per owner and saved edits take precedence', () => {
  const data = fixture();
  const kin = ctx.buildSheetHTML(data, 'KIN', null, null);
  const ansin = ctx.buildSheetHTML(data, 'ANSHIN', null, null);
  assert.match(kin, /右踵骨X線の依頼/);
  assert.doesNotMatch(kin, /胸部X線/);
  assert.match(ansin, /心エコー検査、胸部X線の依頼/);
  assert.match(ctx.buildSheetHTML(data, 'KIN', { purpose: '手修正済み目的' }, null), /手修正済み目的/);
  assert.doesNotMatch(ctx.buildSheetHTML(data, 'KIN', { purpose: '' }, null), /右踵骨X線の依頼/);
});
test('legacy records retain regex and edited service/code arrays invalidate the cache', () => {
  const legacy = fixture(); delete legacy.referralRouting; legacy.services = ['CBC', 'ECHOCARDIOGRAPHY', 'TIBIA/FIBULA RIGHT'];
  assert.deepEqual(Array.from(ctx.determineReferralDests(legacy.services, null, legacy)), ['KIN', 'ANSHIN', 'LAB']);
  const data = fixture(); data.services = ['ECG'];
  assert.equal(ctx.getCodexReferralRouting(data), null);
  assert.deepEqual(Array.from(ctx.determineReferralDests(data.services, null, data)), ['ASBO']);
  assert.match(ctx.buildReferralReviewHTML(data), /紹介先要確認/);
  const changedCode = fixture(); changedCode.cptCode = ['NEW'];
  assert.equal(ctx.getCodexReferralRouting(changedCode), null);
});
test('NONE-only routing does not manufacture a destination; invalid clinic is rejected', () => {
  const data = fixture(); data.referralRouting.destinations = []; data.referralRouting.purposes = {};
  assert.deepEqual(Array.from(ctx.determineReferralDests(data.services, null, data)), []);
  data.referralRouting.destinations = ['UNKNOWN']; assert.equal(ctx.getCodexReferralRouting(data), null);
  data.referralRouting.destinations = ['__proto__']; assert.equal(ctx.getCodexReferralRouting(data), null);
});
test('review text is escaped; LAB is non-clickable and has no editable date', () => {
  const data = fixture(); data.referralRouting.assignments[0].reason = '<script>bad</script>';
  const review = ctx.buildReferralReviewHTML(data);
  assert.match(review, /紹介先要確認/); assert.doesNotMatch(review, /<script>/); assert.match(review, /&lt;script&gt;/);
  const html = ctx.buildReferralStatusHTML(data, ['KIN', 'ANSHIN', 'LAB']);
  assert.match(html.referralHTML, /referral-lab[^>]*data-dest="LAB"/);
  assert.doesNotMatch(html.referralHTML, /referral-dest[^>]*data-dest="LAB"/);
  assert.match(html.visitdateHTML, /referral-lab-date[^>]*data-dest="LAB">&nbsp;/);
});

test('legacy draft purposes also keep chest and ECG with the correct clinic', () => {
  const data = fixture(); delete data.referralRouting;
  data.services = ['RIGHT KNEE X-RAY', 'CHEST X-RAY', 'ECG'];
  assert.doesNotMatch(ctx.buildSheetHTML(data, 'KIN', null, null), /胸部レントゲン2方向/);
  assert.match(ctx.buildSheetHTML(data, 'ASBO', null, null), /胸部レントゲン2方向、心電図の依頼/);
  data.services = ['NASAL', 'RIGHT KNEE X-RAY', 'CHEST X-RAY'];
  assert.doesNotMatch(ctx.buildSheetHTML(data, 'ASBO', null, null), /胸部レントゲン2方向/);
  assert.match(ctx.buildSheetHTML(data, 'KIN', null, null), /胸部レントゲン2方向/);
  data.services.push('ECHOCARDIOGRAPHY', 'ECG');
  assert.doesNotMatch(ctx.buildSheetHTML(data, 'KIN', null, null), /胸部レントゲン2方向/);
  assert.doesNotMatch(ctx.buildSheetHTML(data, 'ASBO', null, null), /胸部レントゲン2方向|心電図/);
  assert.match(ctx.buildSheetHTML(data, 'ANSHIN', null, null), /心エコー検査、胸部レントゲン2方向、心電図の依頼/);
});
