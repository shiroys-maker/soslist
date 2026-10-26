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

test('TTS error diagnostics use fixed allowlists and omit patient text, keys, unknown identifiers and raw responses', async () => {
  const { ttsErrorDetails } = require('../gemini-tts');
  const secret = 'SYNTHETIC_PRIVATE_VALUE';
  const body = { error: { code: 'parameter_unknown', message: secret, field: 'generation_config.speech_config.mode',
    details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [
      { field: 'input[0].content[4].annotations[0].speaker', description: secret },
      { field: secret, description: secret },
    ] }, { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', metadata: { key: secret } },
      { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: secret }] } };
  assert.deepEqual(ttsErrorDetails(body), { code: 'parameter_unknown', status: null,
    fields: ['generation_config.speech_config.mode', 'input[].content[].annotations[].speaker'], reasons: ['API_KEY_INVALID'] });
  assert.deepEqual(ttsErrorDetails({ error: { code: secret, status: secret, message: secret } }), { code: 'unclassified', status: null, fields: [], reasons: [] });
  assert.deepEqual(ttsErrorDetails({ error: { code: 400, status: 'FAILED_PRECONDITION', message: secret } }), { code: 'unclassified', status: 'FAILED_PRECONDITION', fields: [], reasons: [] });
  await assert.rejects(requestAudio([{ speaker: 'A', text: 'SYNTHETIC TEXT' }], config,
    async () => ({ ok: false, status: 400, json: async () => body })), error => {
      assert.match(error.message, /HTTP 400/);assert.match(error.message, /code=parameter_unknown/);
      assert.ok(!error.message.includes(secret));assert.ok(!error.stack.includes(secret));assert.ok(!JSON.stringify(error.providerDetails).includes(secret));return true;
    });
});
test('non-JSON or unrecognized provider errors stay anonymous and HTTP 400 is not retried', async () => {
  for (const json of [async () => { throw Error('SYNTHETIC_PRIVATE_PARSE_CONTEXT'); }, async () => ({ error: { code: 'patient_identifier', message: 'SYNTHETIC_PRIVATE_VALUE' } })]) {
    let calls = 0;
    await assert.rejects(requestAudio([], config, async () => { calls++; return { ok: false, status: 400, json }; }), error => /code=unclassified/.test(error.message) && !/SYNTHETIC_PRIVATE|patient_identifier/.test(error.message));
    assert.equal(calls, 1);
  }
});

test('array-wrapped Google errors expose API_KEY_INVALID at HTTP 400 without logging values or retrying', async () => {
  const { ttsErrorDetails } = require('../gemini-tts');
  const secret = 'SYNTHETIC_PRIVATE_VALUE';
  const body = [{ error: { code: 400, status: 'INVALID_ARGUMENT', message: secret,
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID',
      domain: secret, metadata: { key: secret } }] } }];
  assert.deepEqual(ttsErrorDetails(body), { code: 'unclassified', status: 'INVALID_ARGUMENT',
    fields: [], reasons: ['API_KEY_INVALID'] });
  assert.deepEqual(ttsErrorDetails([null, secret, { error: secret }]),
    { code: 'unclassified', status: null, fields: [], reasons: [] });
  let calls = 0;
  await assert.rejects(requestAudio([], config, async () => {
    calls++;return { ok: false, status: 400, json: async () => body };
  }), error => {
    assert.match(error.message, /HTTP 400/);assert.match(error.message, /status=INVALID_ARGUMENT/);
    assert.match(error.message, /reasons=API_KEY_INVALID/);assert.match(error.message, /APIキー・API利用権限/);
    assert.ok(!JSON.stringify(error.providerDetails).includes(secret));assert.ok(!error.stack.includes(secret));return true;
  });
  assert.equal(calls, 1);
});

test('structured field diagnostics recognize request containers without exposing their values', () => {
  const { ttsErrorDetails } = require('../gemini-tts');
  for (const field of ['input[0].type', 'input[0].content', 'input[0].content[4].text',
    'input[0].content[4].annotations']) {
    const details = ttsErrorDetails({ error: { code: 'invalid_request', field,
      message: 'SYNTHETIC_PRIVATE_VALUE' } });
    assert.deepEqual(details.fields, [field.replace(/\[\d+\]/g, '[]')]);
    assert.ok(!JSON.stringify(details).includes('SYNTHETIC_PRIVATE_VALUE'));
  }
});

test('unknown-field messages disclose only exact allowlisted request paths', async () => {
  const { ttsErrorDetails } = require('../gemini-tts');
  const secret = 'SYNTHETIC_PRIVATE_VALUE';
  for (const [message, expected] of [
    [`Invalid JSON payload received. Unknown name "mode" at 'generation_config.speech_config': ${secret}`, 'generation_config.speech_config.mode'],
    [`Unknown name "speech_config" at 'generation_config': ${secret}`, 'generation_config.speech_config'],
    [`Unknown name "speaker" at 'input[0].content[2].annotations[0]': ${secret}`, 'input[].content[].annotations[].speaker'],
    [`Unknown name "structured_speech_config" at 'generation_config': ${secret}`, 'generation_config.structured_speech_config'],
    [`Unknown name "${secret}" at 'generation_config': Cannot find field.`, null],
    [`Unknown name "mode" at '${secret}': Cannot find field.`, null],
    [`Verbatim transcript mentions generation_config.speech_config.mode ${secret}`, null],
  ]) {
    const body = { error: { code: 'invalid_request', message } };
    assert.deepEqual(ttsErrorDetails(body).fields, []);
    assert.deepEqual(ttsErrorDetails(body).fieldHints || [], expected ? [expected] : []);
    await assert.rejects(requestAudio([], config, async () => ({ ok: false, status: 400,
      json: async () => body })), error => {
      assert.ok(!error.stack.includes(secret));
      assert.ok(!JSON.stringify(error.providerDetails).includes(secret));
      assert.ok(!error.message.includes('Unknown name'));
      return true;
    });
  }
  const long = ttsErrorDetails({ error: { message: 'x'.repeat(8192) +
    'Unknown name "mode" at \'generation_config.speech_config\'' } });
  assert.deepEqual(long.fields, []);assert.equal(long.fieldHints, undefined);
  const structured = ttsErrorDetails({ error: { field: 'input[0].type', message:
    'Unknown name "mode" at \'generation_config.speech_config\'' } });
  assert.deepEqual(structured.fields, ['input[].type']);assert.equal(structured.fieldHints, undefined);
});

test('transport failures do not expose exception text, causes or retries', async () => {
  const secret = 'SYNTHETIC_PRIVATE_TRANSPORT_VALUE';
  let calls = 0;
  await assert.rejects(requestAudio([], config, async () => {
    calls++;throw new Error(secret, { cause: new Error(config.apiKey) });
  }), error => {
    assert.match(error.message, /code=transport_error/);
    assert.ok(!error.stack.includes(secret));assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(calls, 1);
});

test('successful HTTP responses with invalid JSON do not expose parser context', async () => {
  const secret = 'SYNTHETIC_PRIVATE_RESPONSE_VALUE';
  await assert.rejects(requestAudio([], config, async () => ({ ok: true,
    json: async () => { throw new SyntaxError(secret); } })), error => {
    assert.match(error.message, /code=response_json_invalid/);
    assert.ok(!error.stack.includes(secret));assert.equal(error.cause, undefined);
    return true;
  });
});

test('a quoted unknown-field phrase remains an unverified hint rather than structured field evidence', async () => {
  const body = { error: { code: 'invalid_request', message:
    'Echoed SYNTHETIC_PRIVATE_TEXT: Unknown name "mode" at \'generation_config.speech_config\'' } };
  const { ttsErrorDetails } = require('../gemini-tts');
  assert.deepEqual(ttsErrorDetails(body).fields, []);
  assert.deepEqual(ttsErrorDetails(body).fieldHints, ['generation_config.speech_config.mode']);
  await assert.rejects(requestAudio([], config, async () => ({ ok: false, status: 400,
    json: async () => body })), error => {
    assert.match(error.message, /unverified_field_hints=generation_config.speech_config.mode/);
    assert.doesNotMatch(error.message, /\[fields=|; fields=/);
    assert.ok(!error.stack.includes('SYNTHETIC_PRIVATE_TEXT'));return true;
  });
});

test('HTTP 400 stops on the first of five chunks and preserves saved source, speech cache and old audio', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-first-chunk-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const saved = { key: process.env.GEMINI_API_KEY, settings: process.env.SOSLIST_AI_SETTINGS_FILE };
  process.env.GEMINI_API_KEY = 'synthetic-only-key';
  process.env.SOSLIST_AI_SETTINGS_FILE = path.join(dir, 'ai-settings.json');
  t.after(() => {
    for (const [name, value] of [['GEMINI_API_KEY', saved.key], ['SOSLIST_AI_SETTINGS_FILE', saved.settings]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const originals = { 'brief.md': '# Synthetic Summary', 'podcast-script.txt': 'Synthetic script',
    'podcast-speech.txt': 'Synthetic spoken script', 'podcast-speech.json': '{"synthetic":true}',
    'podcast.mp3': 'old mp3', 'podcast.wav': 'old wav' };
  for (const [name, text] of Object.entries(originals)) fs.writeFileSync(path.join(dir, name), text);
  const dialogue = [{ speaker: 'A', text: '合成です。'.repeat(600) },
    { speaker: 'B', text: '合成です。'.repeat(600) }];
  const chunks = splitDialogue(dialogue);assert.equal(chunks.length, 5);
  const before = JSON.stringify(dialogue);let calls = 0;const logs = [];
  await assert.rejects(synthesizeGemini(dialogue, path.join(dir, 'podcast'), {
    speed: 1.3, log: message => logs.push(message), runLocalTool() { assert.fail('No partial encoding'); },
    fetchImpl: async (_, options) => {
      calls++;const request = JSON.parse(options.body);
      assert.deepEqual(request.input[0].content.map(c => c.text), chunks[0].map(turn => turn.text));
      assert.deepEqual(request.input[0].content.map(c => c.annotations[0].speaker), chunks[0].map(turn => turn.speaker));
      return { ok: false, status: 400, json: async () => ({ error: { code: 'invalid_request',
        message: 'SYNTHETIC_PRIVATE_VALUE' } }) };
    },
  }), /HTTP 400/);
  assert.equal(calls, 1);assert.equal(JSON.stringify(dialogue), before);
  for (const [name, text] of Object.entries(originals)) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), text);
  assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.gemini-tts-')), false);
  assert.ok(logs.every(line => !line.includes('SYNTHETIC_PRIVATE_VALUE')));
});
