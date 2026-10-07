'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

function settings() {
  return {
    model: require('../local/ai/task-settings.cjs').choice('tts').model,
    voiceA: process.env.GEMINI_TTS_VOICE_A || 'Kore',
    voiceB: process.env.GEMINI_TTS_VOICE_B || 'Alnilam',
    style: process.env.GEMINI_TTS_STYLE || '自然で落ち着いた日本語の会話。明瞭に。',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    timeoutMs: Number(process.env.GEMINI_TTS_TIMEOUT_MS || 240000),
  };
}

function validateSettings(config = settings()) {
  if (!config.apiKey) throw new Error('Gemini TTS用のGEMINI_API_KEYが設定されていません。');
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) throw new Error('GEMINI_TTS_TIMEOUT_MSが不正です。');
  if (config.voiceA === config.voiceB) throw new Error('Gemini TTSの二人の声には異なる音声を指定してください。');
  return config;
}

// Bound output duration as well as input size; keep full sentences/turns together when possible.
function splitDialogue(dialogue, maxChars = 1200) {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('音声分割サイズが不正です。');
  const chunks = [];
  let current = [], length = 0;
  for (const turn of dialogue) {
    if (!['A', 'B'].includes(turn.speaker) || typeof turn.text !== 'string') throw new Error('Gemini TTSの台本形式が不正です。');
    const text = turn.text.trim();
    if (!text) continue;
    const pieces = text.match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/gu) || [text];
    for (const sentence of pieces) {
      const chars = Array.from(sentence);
      for (let start = 0; start < chars.length; start += maxChars) {
        const part = chars.slice(start, start + maxChars).join('');
        if (length + Array.from(part).length > maxChars && current.length) {
          chunks.push(current); current = []; length = 0;
        }
        if (current.at(-1)?.speaker === turn.speaker) current[current.length - 1].text += part;
        else current.push({ speaker: turn.speaker, text: part });
        length += Array.from(part).length;
      }
    }
  }
  if (current.length) chunks.push(current);
  if (!chunks.length) throw new Error('Gemini TTS用の発話データがありません。');
  return chunks;
}

function buildRequest(dialogue, config) {
  return {
    model: config.model,
    store: false,
    input: [{ type: 'user_input', content: dialogue.map(turn => ({
      type: 'text', text: turn.text,
      annotations: [{ type: 'speech_metadata', speaker: turn.speaker, style: config.style }],
    })) }],
    response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
    generation_config: { speech_config: { mode: 'conversational', speakers: [
      { speaker: 'A', voice: config.voiceA }, { speaker: 'B', voice: config.voiceB },
    ] } },
  };
}

function extractWav(result) {
  if (result.status && result.status !== 'completed') throw new Error('Gemini TTSの音声生成が完了しませんでした。');
  const audio = (result.steps || []).filter(step => step.type === 'model_output')
    .flatMap(step => step.content || []).filter(item => item.type === 'audio').at(-1);
  if (!audio?.data || (audio.mime_type && !/^audio\/(?:wav|x-wav)(?:;|$)/i.test(audio.mime_type))) {
    throw new Error('Gemini TTSからWAV音声を取得できませんでした。');
  }
  const wav = Buffer.from(audio.data, 'base64');
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
    || wav.readUInt32LE(4) + 8 !== wav.length) throw new Error('Gemini TTSのWAV音声が不正または不完全です。');
  let hasFormat = false, hasAudio = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const type = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (offset + 8 + size > wav.length) throw new Error('Gemini TTSのWAV音声が途切れています。');
    if (type === 'fmt ' && size >= 16) hasFormat = true;
    if (type === 'data' && size > 0) hasAudio = true;
    offset += 8 + size + (size % 2);
  }
  if (!hasFormat || !hasAudio) throw new Error('Gemini TTSのWAV音声データが空です。');
  return wav;
}

const API_ERROR_CODES = new Set([
  'invalid_request', 'failed_precondition', 'out_of_range', 'parameter_unknown', 'authentication',
  'payment_required', 'permission_denied', 'not_found', 'model_not_found', 'already_exists', 'aborted',
  'rate_limit_exceeded', 'quota_exceeded', 'too_many_requests', 'cancelled', 'api_error', 'unimplemented',
  'service_unavailable', 'deadline_exceeded', 'safety', 'recitation', 'language', 'prohibited_content',
  'spii', 'blocklist', 'content_blocked',
]);
const CANONICAL_STATUSES = new Set(['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'UNAUTHENTICATED',
  'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'NOT_FOUND', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED']);
const ERROR_REASONS = new Set(['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'BILLING_DISABLED', 'SERVICE_DISABLED',
  'CONSUMER_INVALID', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);
const ERROR_FIELDS = new Set(['model', 'store', 'input', 'response_format', 'response_format.type',
  'response_format.mime_type', 'response_format.sample_rate', 'generation_config',
  'generation_config.speech_config', 'generation_config.speech_config.mode',
  'generation_config.speech_config.speakers', 'generation_config.speech_config.speakers[].speaker',
  'generation_config.speech_config.speakers[].voice', 'input[].content[].type',
  'input[].content[].annotations[].type', 'input[].content[].annotations[].speaker',
  'input[].content[].annotations[].style']);
function ttsErrorDetails(body) {
  // All emitted strings come from fixed allowlists. Messages, values and raw bodies are never logged.
  const envelope = Array.isArray(body)
    ? body.slice(0, 16).find(item => item?.error && typeof item.error === 'object' && !Array.isArray(item.error))
    : body;
  const error = envelope?.error;
  const code = API_ERROR_CODES.has(error?.code) ? error.code : 'unclassified';
  const status = CANONICAL_STATUSES.has(error?.status) ? error.status : null;
  const fields = new Set(), reasons = new Set();
  const addField = field => {
    if (typeof field !== 'string' || field.length > 160) return;
    const normalized = field.replace(/\[\d+\]/g, '[]');
    if (ERROR_FIELDS.has(normalized)) fields.add(normalized);
  };
  addField(error?.field);
  for (const detail of Array.isArray(error?.details) ? error.details.slice(0, 16) : []) {
    if (detail?.['@type'] === 'type.googleapis.com/google.rpc.BadRequest') {
      for (const violation of Array.isArray(detail.fieldViolations) ? detail.fieldViolations.slice(0, 16) : []) addField(violation?.field);
    }
    if (detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && ERROR_REASONS.has(detail.reason)) reasons.add(detail.reason);
  }
  return { code, status, fields: [...fields].slice(0, 8), reasons: [...reasons].slice(0, 8) };
}

async function requestAudio(dialogue, config, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify(buildRequest(dialogue, config)),
    });
    if (!response.ok) {
      let details = ttsErrorDetails(null);
      try { details = ttsErrorDetails(await response.json()); } catch (_) { /* Non-JSON errors stay anonymous. */ }
      const hint = response.status === 401 || response.status === 403 || details.reasons.some(reason => reason.startsWith('API_KEY_'))
        ? 'APIキー・API利用権限を確認してください。'
        : response.status === 429 ? 'APIの割り当て・課金設定を確認してください。'
          : response.status === 404 ? '指定したモデルの利用可否を確認してください。' : 'API設定・接続を確認してください。';
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 'unknown';
      const safeDetail = ['code=' + details.code, ...(details.status ? ['status=' + details.status] : []),
        ...(details.fields.length ? ['fields=' + details.fields.join(',')] : []),
        ...(details.reasons.length ? ['reasons=' + details.reasons.join(',')] : [])].join('; ');
      const error = new Error(`Gemini TTSに失敗しました (HTTP ${status})。${hint} [${safeDetail}]`);
      error.httpStatus = status;
      error.providerDetails = details;
      throw error;
    }
    return extractWav(await response.json());
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Gemini TTSが${config.timeoutMs / 1000}秒以内に完了しませんでした。`);
    throw error;
  } finally { clearTimeout(timer); }
}

async function synthesizeGemini(dialogue, outBase, { runLocalTool, speed, log, fetchImpl = fetch }) {
  const config = validateSettings();
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('Gemini TTSのPODCAST_SPEEDは0.5〜2で指定してください。');
  const chunks = splitDialogue(dialogue);
  const workdir = fs.mkdtempSync(path.join(path.dirname(outBase), '.gemini-tts-'));
  const monitor=require('../local/ai/task-settings.cjs');monitor.begin('tts',{model:config.model,effort:''});
  try {
    const segments = [];
    for (let i = 0; i < chunks.length; i++) {
      log(`Gemini TTSで音声生成中: ${i + 1}/${chunks.length} (model=${config.model})`);
      const audio = await requestAudio(chunks[i], config, fetchImpl);
      const filename = `segment-${i}.wav`;
      fs.writeFileSync(path.join(workdir, filename), audio);
      segments.push(`file '${filename}'`);
    }
    const listFile = path.join(workdir, 'concat.txt');
    fs.writeFileSync(listFile, segments.join('\n'));
    const stagedMp3 = path.join(workdir, 'podcast.mp3');
    runLocalTool('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-filter:a', `atempo=${speed}`, '-codec:a', 'libmp3lame', '-qscale:a', '4', stagedMp3],
    'Gemini TTSのMP3変換に失敗しました');
    if (!fs.existsSync(stagedMp3) || fs.statSync(stagedMp3).size === 0) throw new Error('Gemini TTSのMP3が空です。');
    // Publish only after every chunk and encoding succeeds; an API error leaves old audio intact.
    const mp3Path = `${outBase}.mp3`;
    fs.renameSync(stagedMp3, mp3Path);
    fs.rmSync(`${outBase}.wav`, { force: true });
    log(`MP3出力: ${mp3Path}`);
    return { wavPath: null, mp3Path };
  } finally { monitor.end('tts',{model:config.model,effort:''});fs.rmSync(workdir, { recursive: true, force: true }); }
}

module.exports = { ttsErrorDetails, settings, validateSettings, splitDialogue, buildRequest, extractWav, requestAudio, synthesizeGemini };
