const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { splitDialogue, buildRequest, extractWav, requestAudio, synthesizeGemini } = require('../gemini-tts');

const config = { model: 'gemini-3.8-flash-tts', voiceA: 'Kore', voiceB: 'Alnilam',
  style: '自然で明瞭な日本語。', apiKey: 'synthetic-secret', timeoutMs: 1000 };
function wav() {
  const b = Buffer.alloc(48);
  b.write('RIFF'); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(4, 40);
  return b;
}
const payload = () => ({ status: 'completed', steps: [{ type: 'model_output', content: [
  { type: 'audio', mime_type: 'audio/wav', data: wav().toString('base64') },
] }] });

test('Gemini request separates exact transcript from two-speaker Japanese delivery metadata', () => {
  const turns = [{ speaker: 'A', text: '右膝90度、腫脹なし。' }, { speaker: 'B', text: '未確認です。' }];
  const req = buildRequest(turns, config);
  assert.equal(req.model, 'gemini-3.8-flash-tts');
  assert.equal(req.store, false);
  assert.deepEqual(req.input[0].content.map(c => c.text), turns.map(t => t.text));
  assert.deepEqual(req.input[0].content.map(c => c.annotations[0].speaker), ['A', 'B']);
  assert.equal(req.input[0].content[0].annotations[0].style, config.style);
  assert.deepEqual(req.generation_config.speech_config.speakers,
    [{ speaker: 'A', voice: 'Kore' }, { speaker: 'B', voice: 'Alnilam' }]);
  assert.equal(req.response_format.mime_type, 'audio/wav');
});

test('long dialogue splitting preserves order, all text, and surrogate pairs within limits', () => {
  const input = [{ speaker: 'A', text: '長い説明です。'.repeat(400) },
    { speaker: 'B', text: '🙂'.repeat(1400) }, { speaker: 'A', text: '終わりです。' }];
  const before = JSON.stringify(input);
  const chunks = splitDialogue(input);
  assert.ok(chunks.length > 2);
  for (const chunk of chunks) assert.ok(chunk.reduce((n, t) => n + Array.from(t.text).length, 0) <= 1200);
  assert.equal(chunks.flat().map(t => t.text).join(''), input.map(t => t.text).join(''));
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => splitDialogue([{ speaker: 'C', text: 'x' }]), /形式/);
});

test('only completed, nonempty, complete WAV responses are accepted without adding another header', () => {
  assert.deepEqual(extractWav(payload()), wav());
  assert.throws(() => extractWav({ ...payload(), status: 'failed' }), /完了/);
  assert.throws(() => extractWav({ steps: [] }), /取得/);
  const bad = payload(); bad.steps[0].content[0].data = wav().subarray(0, 45).toString('base64');
  assert.throws(() => extractWav(bad), /不完全/);
});

test('credentials go in headers, HTTP errors do not echo secrets, and requests time out', async () => {
  await requestAudio([{ speaker: 'A', text: '確認。' }], config, async (url, options) => {
    assert.ok(!url.includes(config.apiKey));
    assert.equal(options.headers['x-goog-api-key'], config.apiKey);
    return { ok: true, json: async () => payload() };
  });
  await assert.rejects(requestAudio([], config, async () => ({ ok: false, status: 403,
    json: async () => ({ message: config.apiKey }) })), e => /403/.test(e.message) && !e.message.includes(config.apiKey));
  await assert.rejects(requestAudio([], { ...config, timeoutMs: 10 }, async (_, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  })), /秒以内/);
});

test('failed later chunks retain existing audio; success atomically publishes 1.3x MP3 and cleans staging', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-tts-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test';
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const base = path.join(dir, 'podcast');
  fs.writeFileSync(base + '.mp3', 'original');
  fs.writeFileSync(base + '.wav', 'original-wav');
  let calls = 0;
  await assert.rejects(synthesizeGemini([{ speaker: 'A', text: '検査。'.repeat(800) }], base, {
    speed: 1.3, log() {}, runLocalTool() { assert.fail('Must not encode partial dialogue'); },
    fetchImpl: async () => ++calls === 1 ? { ok: true, json: async () => payload() } : { ok: false, status: 429 },
  }), /429/);
  assert.equal(fs.readFileSync(base + '.mp3', 'utf8'), 'original');
  assert.equal(fs.readFileSync(base + '.wav', 'utf8'), 'original-wav');
  const result = await synthesizeGemini([{ speaker: 'A', text: '確認。' }], base, {
    speed: 1.3, log() {}, fetchImpl: async () => ({ ok: true, json: async () => payload() }),
    runLocalTool(cmd, args) { assert.equal(cmd, 'ffmpeg'); assert.ok(args.includes('atempo=1.3')); fs.writeFileSync(args.at(-1), 'new-mp3'); },
  });
  assert.equal(result.mp3Path, base + '.mp3');
  assert.equal(fs.readFileSync(result.mp3Path, 'utf8'), 'new-mp3');
  assert.deepEqual(fs.readdirSync(dir), ['podcast.mp3']);
});
