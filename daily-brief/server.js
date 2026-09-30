#!/usr/bin/env node
/**
 * daily-brief / server.js  — ミニアプリ
 * ------------------------------------------------------------------
 * 作成済みの要約の閲覧と音声の再生・配信を行うローカルWebアプリ。
 * 新規生成はSOSList LocalのネイティブCodex経路のみ。
 *
 * 起動:  node server.js     (または bash run-app.sh)
 * ブラウザ:  http://127.0.0.1:8790/
 *
 * 必要な環境変数は generate-brief.js と同じ (.env 参照):
 *   GOOGLE_APPLICATION_CREDENTIALS (既存Briefの同期用)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { getExistingBriefResult, saveBriefToFirestore } = require('./generate-brief');

const PORT = Number(process.env.PORT || 8790);
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.join(__dirname, 'output');


function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

function writeJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function validateYmd(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''));
}

function toAudioUrl(result) {
  if (!result?.audioFile) return null;
  return '/audio/' + encodeURIComponent(result.ymd) + '/' + path.basename(result.audioFile);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function summaryPopupPage(ymd) {
  const safeDate = escapeHtml(ymd);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Summery ${safeDate}</title>
<style>
  :root { --accent:#3c355e; --accent-2:#6d28d9; --danger:#991b1b; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", sans-serif;
    background: linear-gradient(180deg, #f4f0ff 0%, #fbfafc 180px, #ffffff 100%);
    color: #1f2937;
  }
  .page { max-width: 960px; margin: 0 auto; padding: 32px 24px 56px; }
  h1 { margin: 0 0 8px; font-size: 30px; color: var(--accent); }
  .meta { color: #6b7280; margin-bottom: 20px; }
  .card {
    background: rgba(255,255,255,0.94);
    border: 1px solid rgba(124,58,237,0.12);
    border-radius: 16px;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
    padding: 20px 22px;
    margin-bottom: 18px;
  }
  .status { line-height: 1.7; }
  .actions { display:flex; gap:10px; justify-content:flex-end; margin-top:18px; }
  button {
    font-size: 14px; padding: 10px 16px; border-radius: 10px; border: 0;
    background: var(--accent); color: #fff; cursor: pointer;
  }
  button.secondary { background: #6b7280; }
  button.danger { background: var(--danger); }
  button:disabled { opacity: .5; cursor: default; }
  audio { width: 100%; }
  h2, h3 { color: #312e81; }
  p, li { line-height: 1.75; font-size: 15px; }
  ul, ol { padding-left: 1.4em; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
  .hidden { display:none; }
  .spinner {
    display:inline-block; width:14px; height:14px; border:2px solid #ccc;
    border-top-color: var(--accent-2); border-radius:50%; animation:spin .8s linear infinite;
    vertical-align:-2px; margin-right:6px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="page">
    <h1>Summery</h1>
    <div class="meta" id="meta">${safeDate}</div>

    <section class="card status" id="statusCard">
      <div id="status"><span class="spinner"></span>確認中...</div>
    </section>

    <section class="card hidden" id="audioCard">
      <audio controls preload="metadata" id="audio"></audio>
    </section>

    <section class="card hidden" id="summaryCard">
      <h2>Brief</h2>
      <div id="summary"></div>
    </section>
  </div>

<script>
  const ymd = ${JSON.stringify(ymd)};
  const statusEl = document.getElementById('status');
  const metaEl = document.getElementById('meta');
  const summaryCard = document.getElementById('summaryCard');
  const summaryEl = document.getElementById('summary');
  const audioCard = document.getElementById('audioCard');
  const audioEl = document.getElementById('audio');

  function renderInlineMarkdown(text) {
    return escapeHtml(text)
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
  }

  function renderMarkdownToHtml(markdown) {
    const blocks = String(markdown || '').replace(/\\r/g, '').split(/\\n{2,}/);
    return blocks.map((block) => {
      const lines = block.split('\\n').filter(Boolean);
      if (lines.length === 0) return '';
      const heading = lines[0].match(/^(#{1,3})\\s+(.+)$/);
      if (heading && lines.length === 1) {
        const level = Math.min(heading[1].length, 3);
        return '<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>';
      }
      const unordered = lines.every((line) => /^-\\s+/.test(line));
      if (unordered) {
        return '<ul>' + lines.map((line) => '<li>' + renderInlineMarkdown(line.replace(/^-\\s+/, '')) + '</li>').join('') + '</ul>';
      }
      const ordered = lines.every((line) => /^\\d+\\.\\s+/.test(line));
      if (ordered) {
        return '<ol>' + lines.map((line) => '<li>' + renderInlineMarkdown(line.replace(/^\\d+\\.\\s+/, '')) + '</li>').join('') + '</ol>';
      }
      return '<p>' + lines.map((line) => renderInlineMarkdown(line)).join('<br>') + '</p>';
    }).join('\\n');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderResult(data) {
    metaEl.textContent = data.ymd + (Number.isFinite(data.count) ? ' / 予約 ' + data.count + ' 件' : '');
    statusEl.textContent = '表示中';
    summaryEl.innerHTML = renderMarkdownToHtml(data.summaryMarkdown || '(要約なし)');
    summaryCard.classList.remove('hidden');

    if (data.audioUrl) {
      audioEl.src = data.audioUrl;
      audioCard.classList.remove('hidden');
    } else {
      audioEl.removeAttribute('src');
      audioCard.classList.add('hidden');
    }

    if (data.syncWarning) {
      alert('Brief.md は表示しましたが、Firebase 同期に失敗しました。\\n' + data.syncWarning);
    }
  }

  async function fetchStatus() {
    const res = await fetch('/api/brief-status?date=' + encodeURIComponent(ymd), { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function boot() {
    try {
      const status = await fetchStatus();
      if (status.exists) { renderResult(status); return; }
      statusEl.textContent = 'サマリーは未作成です。SOSList Localアプリから作成してください。';
    } catch (error) {
      statusEl.textContent = 'サマリーを取得できませんでした。再読み込みしてください。';
    }
  }

  boot();
</script>
</body>
</html>`;
}

// ----------------------------- HTML UI -----------------------------
function page() {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Summary閲覧</title>
<style>body{font:16px -apple-system,sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#312e81}input,button{font:inherit;padding:10px}</style></head>
<body><h1>Summary閲覧</h1><p>作成済みの要約と音声を表示します。新規作成はSOSList Localアプリから行ってください。</p>
<form action="/summary-popup" method="get"><label>対象日 <input type="date" name="date" required></label> <button type="submit">表示</button></form>
</body></html>`;
}

// ----------------------------- 音声配信(Range対応) -----------------------------
function serveAudio(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    setCorsHeaders(res);
    res.writeHead(404); res.end('not found'); return;
  }
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= stat.size) end = stat.size - 1;
    setCorsHeaders(res);
    res.writeHead(206, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

// ----------------------------- ルーティング -----------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // トップページ
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/summary-popup') {
    const ymd = url.searchParams.get('date');
    if (!validateYmd(ymd)) {
      writeJson(res, 400, { ok: false, error: 'date は YYYY-MM-DD 形式で指定してください。' });
      return;
    }
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(summaryPopupPage(ymd));
    return;
  }

  // 音声ファイル配信: /audio/<ymd>/<file>
  if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
    const rel = decodeURIComponent(url.pathname.slice('/audio/'.length));
    // パストラバーサル防止
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(OUTPUT_DIR, safe);
    if (!filePath.startsWith(OUTPUT_DIR)) { writeJson(res, 403, { ok: false, error: 'forbidden' }); return; }
    serveAudio(req, res, filePath);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/brief-status') {
    const ymd = url.searchParams.get('date');
    if (!validateYmd(ymd)) {
      writeJson(res, 400, { ok: false, error: 'date は YYYY-MM-DD 形式で指定してください。' });
      return;
    }

    try {
      const existing = getExistingBriefResult(ymd);
      if (existing.exists) {
        let syncWarning = null;
        try {
          await saveBriefToFirestore(existing);
        } catch (error) {
          console.error('[daily-brief] Firestore sync failed:', error);
          syncWarning = error.message || String(error);
        }
        writeJson(res, 200, {
          ok: true,
          exists: true,
          ymd,
          summaryMarkdown: existing.summaryMarkdown,
          audioUrl: toAudioUrl(existing),
          updatedAt: existing.updatedAt,
          syncWarning,
        });
        return;
      }

      writeJson(res, 200, { ok: true, exists: false, ymd });
    } catch (error) {
      console.error(error);
      writeJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  writeJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[daily-brief] ミニアプリ起動: http://127.0.0.1:${PORT}/`);
  console.log(`[daily-brief] 出力先: ${OUTPUT_DIR}`);
});
