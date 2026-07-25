#!/usr/bin/env node
/**
 * daily-brief / server.js  — ミニアプリ
 * ------------------------------------------------------------------
 * 日付を入れて「作成」ボタンを押すと、その日のブリーフ + ポッドキャスト音声を
 * 生成して、画面上で要約の表示と音声の再生ができるローカルWebアプリ。
 *
 * 起動:  node server.js     (または bash run-app.sh)
 * ブラウザ:  http://127.0.0.1:8790/
 *
 * 必要な環境変数は generate-brief.js と同じ (.env 参照):
 *   OPENAI_API_KEY / GOOGLE_APPLICATION_CREDENTIALS
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { run, getExistingBriefResult, saveBriefToFirestore } = require('./generate-brief');

const PORT = Number(process.env.PORT || 8790);
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.join(__dirname, 'output');

let busy = false; // 同時生成を防ぐ簡易ロック

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

function summaryPopupPage(ymd, mode = 'generate') {
  const safeDate = escapeHtml(ymd);
  const safeMode = mode === 'view' ? 'view' : 'generate';
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
      <div class="actions hidden" id="confirmActions">
        <button type="button" class="secondary" id="showExistingButton">キャンセル</button>
        <button type="button" class="danger" id="regenerateButton">再生成</button>
      </div>
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
  const mode = ${JSON.stringify(safeMode)};
  const statusEl = document.getElementById('status');
  const metaEl = document.getElementById('meta');
  const confirmActions = document.getElementById('confirmActions');
  const showExistingButton = document.getElementById('showExistingButton');
  const regenerateButton = document.getElementById('regenerateButton');
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

  function setBusy(message) {
    confirmActions.classList.add('hidden');
    showExistingButton.disabled = true;
    regenerateButton.disabled = true;
    statusEl.innerHTML = '<span class="spinner"></span>' + message;
  }

  function setIdle(message) {
    statusEl.textContent = message;
    showExistingButton.disabled = false;
    regenerateButton.disabled = false;
  }

  function renderResult(data) {
    metaEl.textContent = data.ymd + (Number.isFinite(data.count) ? ' / 予約 ' + data.count + ' 件' : '');
    statusEl.textContent = '表示中';
    confirmActions.classList.add('hidden');
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

  async function generate() {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: ymd, noAudio: false, sample: false })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function boot() {
    try {
      setBusy('確認中...');
      const status = await fetchStatus();
      if (status.exists) {
        if (mode === 'view') {
          renderResult(status);
          return;
        }
        setIdle('既に作成済みです。再生成しますか。');
        confirmActions.classList.remove('hidden');
        showExistingButton.onclick = () => renderResult(status);
        regenerateButton.onclick = async () => {
          try {
            setBusy('再生成中... 音声ありだと1〜2分かかることがあります。');
            const result = await generate();
            renderResult(result);
          } catch (error) {
            setIdle('エラーが発生しました。');
            alert('Summery の再生成に失敗しました。\\n' + (error.message || error));
          }
        };
        window.requestAnimationFrame(() => showExistingButton.focus());
        return;
      }

      if (mode === 'view') {
        metaEl.textContent = ymd;
        statusEl.textContent = 'サマリーは未作成です。';
        summaryEl.innerHTML = '<p>サマリーは未作成です。</p>';
        summaryCard.classList.remove('hidden');
        audioEl.removeAttribute('src');
        audioCard.classList.add('hidden');
        return;
      }

      setBusy('生成中... 音声ありだと1〜2分かかることがあります。');
      const result = await generate();
      renderResult(result);
    } catch (error) {
      statusEl.textContent = 'エラーが発生しました。';
      alert('Summery の取得に失敗しました。\\n' +
        'daily-brief サーバーを起動してから再試行してください。\\n' +
        'cd ~/Documents/GitHub/soslist/daily-brief\\nbash run-app.sh\\n\\n' +
        '詳細: ' + (error.message || error));
    }
  }

  boot();
</script>
</body>
</html>`;
}

// ----------------------------- HTML UI -----------------------------
function page() {
  // 既定の日付 = 翌日(JST)
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>予約ポッドキャスト生成</title>
<style>
  :root { --accent:#5b2b74; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", sans-serif;
         margin: 0; background:#f6f4f9; color:#222; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; color: var(--accent); }
  .card { background:#fff; border-radius:12px; padding:18px; margin-top:16px;
          box-shadow:0 1px 4px rgba(0,0,0,.08); }
  .row { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
  label { font-size:13px; color:#555; display:block; margin-bottom:4px; }
  input[type=date] { font-size:16px; padding:8px 10px; border:1px solid #ccc; border-radius:8px; }
  button { font-size:15px; padding:9px 18px; border:0; border-radius:8px;
           background:var(--accent); color:#fff; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .opts { font-size:13px; color:#555; margin-top:10px; display:flex; gap:16px; }
  #status { margin-top:14px; font-size:14px; min-height:20px; }
  .spinner { display:inline-block; width:14px; height:14px; border:2px solid #ccc;
             border-top-color:var(--accent); border-radius:50%; animation:spin .8s linear infinite;
             vertical-align:-2px; margin-right:6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  audio { width:100%; margin-top:8px; }
  pre { white-space:pre-wrap; word-break:break-word; font-size:14px; line-height:1.6;
        background:#faf9fc; padding:14px; border-radius:8px; border:1px solid #eee; }
  .muted { color:#888; font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>翌日予約ポッドキャスト生成</h1>
  <div class="card">
    <div class="row">
      <div>
        <label for="date">対象日</label>
        <input type="date" id="date">
      </div>
      <button id="go">作成</button>
    </div>
    <div class="opts">
      <label><input type="checkbox" id="noAudio"> 音声なし(テキストのみ・高速)</label>
      <label><input type="checkbox" id="sample"> サンプルデータで試す</label>
    </div>
    <div id="status"></div>
  </div>

  <div class="card" id="result" style="display:none;">
    <div id="audioWrap"></div>
    <h3 style="margin-top:18px;">ブリーフ</h3>
    <pre id="summary"></pre>
  </div>
</div>

<script>
  // 既定日付 = 翌日(ローカル時刻基準)
  const d = new Date(Date.now() + 86400000);
  document.getElementById('date').value =
    d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');

  const goBtn = document.getElementById('go');
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');

  goBtn.addEventListener('click', async () => {
    const date = document.getElementById('date').value;
    const noAudio = document.getElementById('noAudio').checked;
    const sample = document.getElementById('sample').checked;
    if (!date) { statusEl.textContent = '日付を選んでください。'; return; }

    goBtn.disabled = true;
    resultEl.style.display = 'none';
    statusEl.innerHTML = '<span class="spinner"></span>生成中… 音声ありだと1〜2分かかることがあります。';

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, noAudio, sample })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));

      statusEl.innerHTML = '完了：' + data.ymd + '（予約 ' + data.count + ' 件）';
      document.getElementById('summary').textContent = data.summaryMarkdown || '(要約なし)';
      const audioWrap = document.getElementById('audioWrap');
      if (data.audioUrl) {
        audioWrap.innerHTML =
          '<audio controls preload="metadata" src="' + data.audioUrl + '"></audio>' +
          '<div class="muted">右クリックで保存できます。</div>';
      } else {
        audioWrap.innerHTML = '<div class="muted">音声なしで生成しました。</div>';
      }
      resultEl.style.display = 'block';
    } catch (e) {
      statusEl.textContent = 'エラー: ' + e.message;
    } finally {
      goBtn.disabled = false;
    }
  });
</script>
</body>
</html>`;
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
    const mode = url.searchParams.get('mode') === 'view' ? 'view' : 'generate';
    if (!validateYmd(ymd)) {
      writeJson(res, 400, { ok: false, error: 'date は YYYY-MM-DD 形式で指定してください。' });
      return;
    }
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(summaryPopupPage(ymd, mode));
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

  // 生成API
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    if (busy) {
      writeJson(res, 429, { ok: false, error: '別の生成処理が実行中です。完了までお待ちください。' });
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      busy = true;
      try {
        const opts = body ? JSON.parse(body) : {};
        const result = await run({
          date: opts.date || null,
          sample: !!opts.sample,
          noAudio: !!opts.noAudio,
        });
        writeJson(res, 200, {
          ok: true,
          ymd: result.ymd,
          count: result.count,
          summaryMarkdown: result.summaryMarkdown,
          audioUrl: toAudioUrl(result),
        });
      } catch (e) {
        console.error(e);
        writeJson(res, 500, { ok: false, error: e.message || String(e) });
      } finally {
        busy = false;
      }
    });
    return;
  }

  writeJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[daily-brief] ミニアプリ起動: http://127.0.0.1:${PORT}/`);
  console.log(`[daily-brief] 出力先: ${OUTPUT_DIR}`);
});
