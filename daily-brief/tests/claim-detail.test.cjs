const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const generator = path.join(__dirname, '..', 'generate-brief.js');
const source = fs.readFileSync(generator, 'utf8');
const ymd = '2099-09-24';
const records = [
  { id: 'general', contractNumber: 'SYNTHETIC.1.2', services: ['Focused Requiring 1-5 DBQs'],
    claimDetail: 'Left knee: Direct IMO\nMigraine: TERA IMO\n', notes: 'Knee pain began in 2021. Physical therapy in 2022.' },
  { id: 'audiology', contractNumber: 'SYNTHETIC.1.1', services: ['Audiologist Examination'],
    claimDetail: 'Tinnitus: Direct IMO\nReview noise exposure.', notes: '' },
  { id: 'legacy', contractNumber: 'SYNTHETIC.2.1', services: ['Knee DBQ'],
    notes: 'Right knee follow up. IMO不要。Surgery in 2012.' },
  { id: 'conflict', contractNumber: 'SYNTHETIC.3.1', services: ['Headaches DBQ'],
    claimDetail: 'Migraine: TERA IMO', notes: 'Migraine: Direct IMO. Attacks twice weekly.' },
];

function harness(t) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soslist-claim-test-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const ctx = vm.createContext({
    require, module: { exports: {} }, __dirname: path.dirname(generator),
    process: { argv: [], env: { OUTPUT_DIR: outputDir, PODCAST_GENERATION_MAX_ATTEMPTS: '2' } },
    console: { error() {} },
  });
  vm.runInContext(source, ctx, { filename: generator });
  ctx.getFirestore = () => ({ collection(name) {
    assert.equal(name, 'appointments');
    let limit = records.length;
    return {
      where() { return this; }, orderBy() { return this; }, limit(n) { limit = n; return this; },
      async get() {
        const docs = records.slice(0, limit).map(({ id, ...data }) => ({ id, data: () => ({
          ...data, claimantName: 'TEST, SYNTHETIC',
          appointmentDateTime: { toDate: () => new Date(`${ymd}T09:00:00+09:00`) },
        }) }));
        return { empty: !docs.length, docs, forEach: fn => docs.forEach(fn) };
      },
    };
  } });
  return ctx;
}

function assertEvidenceRules(prompt) {
  assert.match(prompt, /claimDetail[^\n]*notes[^\n]*全文/);
  assert.match(prompt, /notes が空でも claimDetail/);
  assert.match(prompt, /claimDetail が空または未設定[^\n]*notes/);
  assert.match(prompt, /重複計上しない/);
  assert.match(prompt, /情報源を添えて相違/);
  assert.match(prompt, /Audiologyでも claimDetail または notes にIMO依頼や注意点があれば省略しない/);
  assert.doesNotMatch(prompt, /判定はnotesを最優先|notes\s*先頭から|無い場合だけ「IMO不要」|notesが空のAudiology予約だけ/);
}

function promptAppointments(prompt) {
  return JSON.parse(prompt.split('# 予約一覧(JSON)\n')[1]);
}

test('Firestore input preserves separate multiline claims, notes, and same-patient appointment identities', async t => {
  const ctx = harness(t);
  const before = JSON.stringify(records);
  const inputs = await ctx.module.exports.collectGenerationInputs({ date: ymd });
  assert.equal(inputs.count, records.length);
  for (const [i, appt] of inputs.appointments.entries()) {
    assert.equal(appt.id, records[i].id);
    assert.equal(appt.contractNumber, records[i].contractNumber);
    assert.equal(appt.claimDetail, records[i].claimDetail || '');
    assert.equal(appt.notes, records[i].notes);
  }
  assert.equal(inputs.appointments[1].isAudiology, true);
  assert.equal(JSON.stringify(promptAppointments(inputs.prompt)), JSON.stringify(inputs.appointments));
  assertEvidenceRules(inputs.prompt);
  assert.equal(JSON.stringify(records), before);
});

test('manual and scheduled contexts deliver the same complete claim-aware prompt', async t => {
  const api = harness(t).module.exports;
  const manual = await api.getCodexSummaryContext(ymd);
  const scheduled = await api.getScheduledSummaryContext();
  for (const context of [manual, scheduled]) {
    assert.equal(context.action, 'generate');
    assert.equal(context.ymd, ymd);
    assert.equal(context.count, records.length);
    assertEvidenceRules(context.prompt);
    assert.equal(promptAppointments(context.prompt)[1].claimDetail, records[1].claimDetail);
  }
  assert.equal(manual.prompt, scheduled.prompt);
});

test('API generation and its retry both receive all claims and the corrected evidence rules', async t => {
  const ctx = harness(t);
  const inputs = await ctx.module.exports.collectGenerationInputs({ date: ymd });
  const requests = [];
  ctx.createJsonCompletion = async (_client, request) => {
    requests.push(request);
    return JSON.stringify({ summaryMarkdown: '要約'.repeat(requests.length === 1 ? 1 : 2500),
      podcastDialogue: [{ speaker: 'A', text: '台本'.repeat(3000) }] });
  };
  await ctx.generateBrief(null, inputs.appointments, ymd);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assertEvidenceRules(request.system);
    assert.ok(request.user.includes(JSON.stringify(inputs.appointments, null, 2)));
    assert.match(request.user, /claimDetail=Claim詳細/);
  }
});

test('empty-dialogue recovery retains claim-aware instructions and source data', async t => {
  const ctx = harness(t);
  const inputs = await ctx.module.exports.collectGenerationInputs({ date: ymd });
  const requests = [];
  ctx.createJsonCompletion = async (_client, request) => {
    requests.push(request);
    return JSON.stringify(requests.length === 1
      ? { summaryMarkdown: '要約'.repeat(2500), podcastDialogue: [] }
      : { podcastDialogue: [{ speaker: 'A', text: '台本'.repeat(3000) }] });
  };
  const result = await ctx.generateBrief(null, inputs.appointments, ymd);
  assert.equal(requests.length, 2);
  assert.equal(result.podcastDialogue.length, 1);
  assertEvidenceRules(requests[1].system);
  assert.ok(requests[1].user.includes(JSON.stringify(inputs.appointments, null, 2)));
});
