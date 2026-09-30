const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { applyReadings, prepareSpeechDialogue } = require('../prepare-speech');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const edit = (source, reading, turn = 0, occurrence = 0) => ({ turn, source, reading, occurrence });

test('anchored readings preserve numbers, speaker order, original text, and repeated occurrences', () => {
  const source = [{ speaker: 'A', text: '右膝の屈曲90°、腫脹なし。骨棘と骨棘。' }, { speaker: 'B', text: 'MRIは未確認。' }];
  const snapshot = JSON.stringify(source);
  const output = applyReadings(source, { edits: [edit('膝', 'ヒザ'), edit('屈曲', 'クッキョク'),
    edit('°', 'ド'), edit('腫脹', 'シュチョウ'), edit('骨棘', 'コツキョク', 0, 1), edit('MRI', 'エムアールアイ', 1)] });
  assert.equal(output.dialogue[0].text, '右ヒザのクッキョク90ド、シュチョウなし。骨棘とコツキョク。');
  assert.deepEqual(output.dialogue[1], { speaker: 'B', text: 'エムアールアイは未確認。' });
  assert.equal(JSON.stringify(source), snapshot);
  assert.equal(output.rejected.length, 0);
});

test('reject numeric, laterality, negation, certainty, and partial protected-token edits', () => {
  const text = '左膝90度、右膝30度。二回、陰性、陽性、なし、未確認、疑い、可能性。not confirmed。4 ／ 5。';
  const attempts = ['左', '右膝', '90', '二回', '陰性', '陽性', 'なし', '未確認', '確認', '疑い', '可能性', 'not', '／'];
  const result = applyReadings([{ speaker: 'A', text }], { edits: attempts.map(s => edit(s, 'ヘンコウ')) });
  assert.equal(result.dialogue[0].text, text);
  assert.equal(result.rejected.length, attempts.length);
});

test('reject hallucinated anchors, overlaps, deletions, non-kana, and malformed edits', () => {
  const input = [{ speaker: 'A', text: '骨棘あり。' }];
  const result = applyReadings(input, { edits: [edit('骨棘', 'コツキョク'), edit('骨棘', 'ホネトゲ'),
    edit('関節', 'カンセツ'), edit('あり', ''), edit('あり', 'なし1'), edit('あり', '陰性'), null] });
  assert.equal(result.accepted, 1);
  assert.equal(result.rejected.length, 6);
  assert.equal(result.dialogue[0].text, 'コツキョクあり。');
  assert.throws(() => applyReadings(input, {}), /形式/);
});

test('cache is tied to source content and revalidates edits, never trusting cached dialogue', async t => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'podcast-script.txt'), 'original');
  fs.writeFileSync(path.join(dir, 'brief.md'), 'summary');
  let calls = 0;
  const convert = async () => { calls++; return { edits: [edit('骨棘', 'コツキョク')] }; };
  const original = [{ speaker: 'A', text: '骨棘あり。' }];
  await prepareSpeechDialogue(original, dir, { convert });
  const cacheFile = path.join(dir, 'podcast-speech.json');
  const cache = JSON.parse(fs.readFileSync(cacheFile));
  cache.dialogue = [{ speaker: 'B', text: '誤った内容' }];
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  assert.equal((await prepareSpeechDialogue(original, dir, { convert }))[0].text, 'コツキョクあり。');
  assert.equal(calls, 1);
  await prepareSpeechDialogue([{ speaker: 'A', text: '骨棘なし。' }], dir, { convert });
  assert.equal(calls, 2);
  assert.match(fs.readFileSync(path.join(dir, 'podcast-speech.txt'), 'utf8'), /コツキョクなし/);
  assert.equal(fs.readFileSync(path.join(dir, 'podcast-script.txt'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(dir, 'brief.md'), 'utf8'), 'summary');
});

function generatorHarness(prepare, synthesize = async () => {}, engine = 'gemini') {
  const file = path.resolve(__dirname, '../generate-brief.js');
  const ctx = vm.createContext({ require: name => name === './prepare-speech'
    ? { prepareSpeechDialogue: prepare } : name === './gemini-tts'
    ? { validateSettings() {}, synthesizeGemini: synthesize } : require(name), module: { exports: {} },
  __dirname: path.dirname(file), process: { argv: [], env: { PODCAST_AUDIO_ENGINE: engine } }, console: { error() {} } });
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return ctx;
}

test('Gemini route converts first and passes converted dialogue to synthesis', async () => {
  const order = [];
  const ctx = generatorHarness(async () => { order.push('convert'); return [{ speaker: 'B', text: 'コツキョク' }]; },
    async dialogue => { order.push('synthesize'); assert.equal(dialogue[0].text, 'コツキョク'); });
  await ctx.module.exports.synthesizePodcast(null, [{ speaker: 'B', text: '骨棘' }], '/tmp/speech/podcast');
  assert.deepEqual(order, ['convert', 'synthesize']);
});

test('conversion failures preserve existing audio and never synthesize', async () => {
  const ctx = generatorHarness(async () => { throw new Error('conversion failed'); },
    () => assert.fail('Invalid conversion must not be spoken'));
  await assert.rejects(ctx.module.exports.synthesizePodcast(null, [], '/tmp/speech/podcast'), /conversion failed/);
});

test('removed engines fail before conversion or external work', async () => {
  for (const engine of ['aivis', 'say', 'openai', 'unknown']) {
    const ctx = generatorHarness(() => assert.fail('must not convert'), () => assert.fail('must not synthesize'), engine);
    await assert.rejects(ctx.module.exports.synthesizePodcast(null, [], '/tmp/speech/podcast'), /Gemini/);
  }
});
