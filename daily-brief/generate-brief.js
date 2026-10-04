#!/usr/bin/env node
/**
 * daily-brief / generate-brief.js
 * ------------------------------------------------------------------
 * 翌日(JST)の予約を Firestore から取得し、検査内容(services)とClaim詳細(claimDetail)を（元メモは前段で要約・保存）
 * Codex用の入力を準備し、作成済みの要約 + 二人対話のポッドキャスト台本から、
 * クラウドTTSで音声(WAV/MP3)を出力する。
 *
 * 実行例:
 *   node generate-brief.js --scheduled-context # Codex定時処理用の対象日・入力を出力
 *   node generate-brief.js --codex-context --date YYYY-MM-DD # Codex手動処理用の対象日・入力を出力
 *   node generate-brief.js --finalize-prepared --date YYYY-MM-DD # 作成済み原稿を音声・保存処理
 *
 * 必要な環境変数:
 *   GOOGLE_APPLICATION_CREDENTIALS… Firebaseサービスアカウントjsonへのパス
 *                                   (openai-processor と同じ認証情報)
 *   ※ または SERVICE_ACCOUNT_PATH に明示指定も可
 *
 * 任意の環境変数:
 *   PODCAST_AUDIO_ENGINE (default gemini)        … geminiのみ
 *   GEMINI_API_KEY                             … Gemini TTS用APIキー
 *   GEMINI_TTS_MODEL (default gemini-3.8-flash-tts)
 *   PODCAST_MINUTES  (default 12)                … 目標尺(分)
 *   OUTPUT_DIR       (default ./output)          … 出力先
 *   FIREBASE_STORAGE_BUCKET (default sos-list-4d150.firebasestorage.app) … Web再生用MP3の保存先
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LOCAL_TOOL_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

function resolveLocalTool(cmd) {
  if (path.isAbsolute(cmd)) return cmd;
  const pathDirs = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of [...pathDirs, ...LOCAL_TOOL_DIRS]) {
    const candidate = path.join(dir, cmd);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {}
  }
  return cmd;
}

// ----------------------------- 引数解析 -----------------------------
const args = process.argv.slice(2);
const flags = {
  sample: args.includes('--sample'),
  noAudio: args.includes('--no-audio'),
  skipPrune: args.includes('--skip-prune'),
  dumpPrompt: args.includes('--dump-prompt'),
  finalizeManual: args.includes('--finalize-manual'),
  finalizePrepared: args.includes('--finalize-prepared'),
  syncAudio: args.includes('--sync-audio'),
  scheduledContext: args.includes('--scheduled-context'),
  codexContext: args.includes('--codex-context'),
  date: null,
};
const dateIdx = args.indexOf('--date');
if (dateIdx !== -1 && args[dateIdx + 1]) flags.date = args[dateIdx + 1];

const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.join(__dirname, 'output');
const DAILY_BRIEF_MIRROR_PREFIX = process.env.DAILY_BRIEF_MIRROR_PREFIX || 'dailyBrief_';
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'sos-list-4d150.firebasestorage.app';
const PODCAST_STORAGE_PREFIX = 'daily-brief';
const PODCAST_STORAGE_KEEP_DAYS = 2;
// high はかなり遅く、薄い出力時の自動2回目と組み合わさると体感が悪い。
// 初回プロンプト側を強くし、既定は medium + 1回生成に寄せる。
const PODCAST_AUDIO_ENGINE = process.env.PODCAST_AUDIO_ENGINE || 'gemini';
const PODCAST_MINUTES = Number(process.env.PODCAST_MINUTES || 12);
// 読み上げ速度(1.0=等速)。ユーザー希望により既定 1.3 倍速。
const PODCAST_SPEED = Number(process.env.PODCAST_SPEED || 1.3);
const LOCAL_TTS_TIMEOUT_MS = Number(process.env.LOCAL_TTS_TIMEOUT_MS || 60000);

// ----------------------------- ユーティリティ -----------------------------
function log(...a) {
  console.error(`[${new Date().toISOString()}]`, ...a);
}

/** JSTでのY-M-D文字列を返す */
function ymdInJST(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // => "2026-06-02"
}

/** 対象日(JST 1日分)の [start, end) を UTC Date で返す */
function targetDayRange(explicitYmd) {
  let ymd = explicitYmd;
  if (!ymd) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    ymd = ymdInJST(tomorrow);
  }
  const start = new Date(`${ymd}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { ymd, start, end };
}

/** JSTのHH:mm */
function hhmmInJST(date) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function isAudiology(services) {
  return (services || []).some(
    (s) => String(s).toLowerCase().includes('audiolog')
  );
}

/** dateOfBirth(例 "09/16/1997" MM/DD/YYYY)から満年齢を算出 */
function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const b = new Date(dateOfBirth);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

/**
 * 性別: アプリでは「年齢セルのピンク・トグル」(isAgePink)で表現される。
 * 慣習に従い pink(true)=女性 / 既定(false)=男性 とみなす。
 */
function sexFromFlag(isAgePink) {
  return isAgePink ? '女性' : '男性';
}

// ----------------------------- データ取得 -----------------------------
async function fetchAppointments(range) {
  const db = getFirestore();

  const snap = await db
    .collection('appointments')
    .where('appointmentDateTime', '>=', range.start)
    .where('appointmentDateTime', '<', range.end)
    .orderBy('appointmentDateTime', 'asc')
    .get();

  const list = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const dt = d.appointmentDateTime && d.appointmentDateTime.toDate
      ? d.appointmentDateTime.toDate()
      : new Date(d.appointmentDateTime);
    list.push({
      id: doc.id,
      time: hhmmInJST(dt),
      claimantName: d.claimantName || '',
      contractNumber: d.contractNumber || '',
      age: calculateAge(d.dateOfBirth),
      sex: sexFromFlag(d.isAgePink),
      services: Array.isArray(d.services) ? d.services : [],
      notes: d.notes || '',
      claimDetail: d.claimDetail || '',
      isAudiology: isAudiology(d.services),
    });
  });
  return list;
}

/** 翌日以降で最も早い予約日のJST日付を返す。 */
async function findNextUpcomingAppointmentDate() {
  const tomorrow = targetDayRange().start;
  const snap = await getFirestore()
    .collection('appointments')
    .where('appointmentDateTime', '>=', tomorrow)
    .orderBy('appointmentDateTime', 'asc')
    .limit(1)
    .get();

  if (snap.empty) return null;
  const value = snap.docs[0].data().appointmentDateTime;
  const date = value && typeof value.toDate === 'function'
    ? value.toDate()
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('次回予約の appointmentDateTime を日付として読めません。');
  }
  return ymdInJST(date);
}

function getFirebaseAdmin() {
  const admin = require('firebase-admin');

  if (!admin.apps.length) {
    const options = { storageBucket: FIREBASE_STORAGE_BUCKET };
    const saPath = process.env.SERVICE_ACCOUNT_PATH;
    if (saPath && fs.existsSync(path.resolve(saPath))) {
      const serviceAccount = require(path.resolve(saPath));
      options.credential = admin.credential.cert(serviceAccount);
    } else {
      const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (gac && !fs.existsSync(gac)) {
        log(`警告: GOOGLE_APPLICATION_CREDENTIALS のファイルが見つかりません(${gac})。` +
            ` gcloud ADC でのログインを試みます。`);
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      }
    }
    admin.initializeApp(options);
  }

  return admin;
}

function getFirestore() {
  return getFirebaseAdmin().firestore();
}

function getStorageBucket() {
  return getFirebaseAdmin().storage().bucket(FIREBASE_STORAGE_BUCKET);
}

function findExistingAudioFile(outDir) {
  const candidates = ['podcast.mp3', 'podcast.wav'];
  for (const filename of candidates) {
    const filePath = path.join(outDir, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function getExistingBriefResult(ymd) {
  const outDir = path.join(OUTPUT_DIR, ymd);
  const mdPath = path.join(outDir, 'brief.md');
  if (!fs.existsSync(mdPath)) {
    return {
      exists: false,
      ymd,
      outDir,
      mdPath,
      summaryMarkdown: null,
      audioFile: null,
      updatedAt: null,
    };
  }

  const summaryMarkdown = fs.readFileSync(mdPath, 'utf8');
  const stat = fs.statSync(mdPath);
  return {
    exists: true,
    ymd,
    outDir,
    mdPath,
    summaryMarkdown,
    audioFile: findExistingAudioFile(outDir),
    updatedAt: stat.mtime.toISOString(),
  };
}

async function saveBriefToFirestore(result) {
  if (!result?.ymd || !result?.summaryMarkdown) {
    throw new Error('Firestore に保存するブリーフ情報が不足しています。');
  }

  const admin = getFirebaseAdmin();
  const db = getFirestore();
  const audioStoragePath = result.audioStoragePath
    || (result.audioFile && path.extname(result.audioFile).toLowerCase() === '.mp3'
      ? podcastStoragePath(result.ymd)
      : null);
  const payload = {
    ymd: result.ymd,
    summaryMarkdown: result.summaryMarkdown,
    appointmentCount: Number.isFinite(result.count) ? result.count : null,
    hasAudio: Boolean(result.audioFile),
    audioFilename: result.audioFile ? path.basename(result.audioFile) : null,
    audioStoragePath,
    outDir: result.outDir || null,
    mdPath: result.mdPath || null,
    source: 'daily-brief-local',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('appointments').doc(`${DAILY_BRIEF_MIRROR_PREFIX}${result.ymd}`).set({
    docType: 'dailyBrief',
    dailyBriefDate: result.ymd,
    summaryMarkdown: result.summaryMarkdown,
    appointmentCount: payload.appointmentCount,
    hasAudio: payload.hasAudio,
    audioFilename: payload.audioFilename,
    audioStoragePath: payload.audioStoragePath,
    source: payload.source,
    updatedAt: payload.updatedAt,
  }, { merge: true });
}

function podcastStoragePath(ymd) {
  return `${PODCAST_STORAGE_PREFIX}/${ymd}/podcast.mp3`;
}

function isPodcastStorageFile(name) {
  const match = String(name || '').match(new RegExp(`^${PODCAST_STORAGE_PREFIX}/(\\d{4}-\\d{2}-\\d{2})/podcast\\.mp3$`));
  return match ? match[1] : null;
}

async function uploadPodcastToStorage(ymd, audioFile) {
  if (!audioFile || path.extname(audioFile).toLowerCase() !== '.mp3') {
    log('MP3がないため Firebase Storage への音声アップロードをスキップします。');
    return null;
  }

  const destination = podcastStoragePath(ymd);
  const bucket = getStorageBucket();
  await bucket.upload(audioFile, {
    destination,
    resumable: false,
    metadata: {
      contentType: 'audio/mpeg',
      cacheControl: 'private, max-age=3600',
    },
  });
  log(`Firebase Storage 音声アップロード: gs://${bucket.name}/${destination}`);
  return destination;
}

async function pruneStoredPodcasts() {
  const bucket = getStorageBucket();
  const [files] = await bucket.getFiles({ prefix: `${PODCAST_STORAGE_PREFIX}/` });
  const datedFiles = files
    .map((file) => ({ file, ymd: isPodcastStorageFile(file.name) }))
    .filter((entry) => entry.ymd)
    .sort((a, b) => b.ymd.localeCompare(a.ymd));

  const staleFiles = datedFiles.slice(PODCAST_STORAGE_KEEP_DAYS);
  for (const { file, ymd } of staleFiles) {
    await file.delete();
    log(`Firebase Storage 音声削除(保持件数=${PODCAST_STORAGE_KEEP_DAYS}): ${ymd}`);
  }
  return datedFiles.slice(0, PODCAST_STORAGE_KEEP_DAYS).map((entry) => entry.ymd);
}

async function uploadPodcastAndPrune(ymd, audioFile, options = {}) {
  const storagePath = await uploadPodcastToStorage(ymd, audioFile);
  if (!storagePath) return null;
  if (options.skipPrune !== true) await pruneStoredPodcasts();
  return storagePath;
}

function latestLocalPodcastFiles() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  return fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => ({
      ymd: entry.name,
      audioFile: path.join(OUTPUT_DIR, entry.name, 'podcast.mp3'),
    }))
    .filter((entry) => fs.existsSync(entry.audioFile))
    .sort((a, b) => b.ymd.localeCompare(a.ymd))
    .slice(0, PODCAST_STORAGE_KEEP_DAYS);
}

async function syncLatestPodcastAudio(options = {}) {
  const podcasts = latestLocalPodcastFiles();
  if (!podcasts.length) {
    log('同期対象の podcast.mp3 はありません。');
    return { uploaded: [], retained: [] };
  }

  const admin = getFirebaseAdmin();
  const db = getFirestore();
  const uploaded = [];
  for (const { ymd, audioFile } of podcasts) {
    const audioStoragePath = await uploadPodcastToStorage(ymd, audioFile);
    await db.collection('appointments').doc(`${DAILY_BRIEF_MIRROR_PREFIX}${ymd}`).set({
      docType: 'dailyBrief',
      dailyBriefDate: ymd,
      hasAudio: true,
      audioFilename: 'podcast.mp3',
      audioStoragePath,
      audioUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    uploaded.push({ ymd, audioStoragePath });
  }
  if (options.skipPrune === true) return { uploaded, retained: null, pruneSkipped: true };
  const retained = await pruneStoredPodcasts();
  return { uploaded, retained };
}

function sampleAppointments() {
  return [
    {
      id: 'sample1', time: '09:00', claimantName: 'SMITH, JOHN',
      contractNumber: '5880596.7.1', age: 58, sex: '男性',
      services: ['Audiologist Examination'], notes: '',
      isAudiology: true,
    },
    {
      id: 'sample2', time: '10:30', claimantName: 'DOE, JANE',
      contractNumber: '5990110.2.1', age: 34, sex: '女性',
      services: ['Focused Requiring 1-5 DBQs', 'CBC'],
      notes: 'SHA(退役前検査)。IMO不要。現役。主訴: 両膝痛と慢性腰痛。'
        + '2019年の訓練中に右膝を捻挫、以後ランニングで疼痛反復。2021年に腰部の筋筋膜性疼痛で'
        + '理学療法歴あり。現在もNSAIDs頓用。可動域や安定性の初回スクリーニングが目的。',
      isAudiology: false,
    },
    {
      id: 'sample3', time: '13:00', claimantName: 'BROWN, MICHAEL',
      contractNumber: '6010777.3.2', age: 47, sex: '男性',
      services: ['Knee DBQ', 'Right knee X-ray 2 views'],
      notes: '右膝 service connected の follow up。IMO不要。前回評価50%。'
        + '2010年イラク派遣中に右膝外傷、半月板部分切除術(2012)の既往。'
        + '前回検査(2023)では屈曲100度・軽度の不安定性。今回は悪化(可動域低下・腫脹・'
        + 'ロッキング症状)の有無が焦点。X線で関節症進行を確認。',
      isAudiology: false,
    },
    {
      id: 'sample4', time: '14:30', claimantName: 'GARCIA, LUIS',
      contractNumber: '6020888.4.1', age: 39, sex: '男性',
      services: ['PTSD DBQ', 'Mental Disorders'],
      claimDetail: 'PTSD 初回claim。Direct IMO依頼。過去にstressorの裏付け不足で一度reject。',
      notes: '2008-2012アフガニスタン2回派遣、IED爆発の目撃エピソードあり。'
        + '現在: 不眠・悪夢・過覚醒・回避傾向。民間でのカウンセリング歴半年。'
        + '軍歴(stressor)とのnexus、症状の発症時期と継続を要確認。',
      isAudiology: false,
    },
  ];
}

const CLAIM_DETAIL_INSTRUCTIONS = `# Claim詳細の読み込み(最重要)
- claimDetail（Claimリストと保存済みEvidence Review）だけをサマリーと台本の臨床本文の情報源にする。元メモは前段で要約・保存済みで、ここでは入力しない。
- claim名・部位・左右・DBQ・IMO種類をclaimごとに対応づける。同一予約の別claimや依頼を省略せず、重複計上しない。
- ClaimリストとEvidence Reviewが食い違う場合は情報源を添えて相違・要確認を明記する。どちらかで黙って上書きしない。
- Evidence Review内の病歴、受傷、治療、経過、現在症状、前回評価を時系列にまとめ、具体的な検査・問診の確認点へ結びつける。
- AudiologyでもIMO依頼や注意点を省略しない。入力にない病歴・診断・IMO依頼・否定所見は補わず、不足は記載なし／要確認とする。
- 予約ID・契約番号ごとに扱い、別予約の情報を混ぜない。servicesは検査種類の補足に使う。`;

function buildGeminiPrompt(appts, ymd) {
  const targetChars = Math.round(PODCAST_MINUTES * 360);
  return `あなたは米国退役軍人(VA)障害認定検査クリニックの臨床コーディネーターであり、
熟練のポッドキャスト構成作家でもあります。検査医が「翌日の予約」を移動中に聞いて把握できる、
日本語の準備用ブリーフを作成します。

# 対象日
- 対象日(JST): ${ymd}

# 最終成果物(必須)
- ` + "`brief.md`" + ` と ` + "`podcast-script.txt`" + ` の2つを作成すること。
- **Gemini のファイル生成機能を使って**、Gemini Desktop 上で **ダウンロード可能な別ファイル** として作成すること。
- 回答本文に完成原稿をそのまま長文表示しないこと。**本文ではなくファイル添付/ファイルカードとして返すことを最優先**すること。
- 2つのファイルが作れたら、チャット本文は短く「2ファイルを作成しました。ダウンロードしてください。」程度に留めること。
- ファイル名は必ず ` + "`brief.md`" + ` と ` + "`podcast-script.txt`" + ` にすること。
- 形式はそれぞれ Markdown(` + "` .md`" + `) と Plain Text(` + "` .txt`" + `) にすること。
- どちらのファイルも対象日 ` + "`" + `${ymd}` + "`" + ` を明記すること。
- もし最初の試行で本文表示になった場合は、**ファイル生成に切り替えて再試行**し、最終的にダウンロード可能ファイルとして提示すること。

# 予約の分類ルール(厳守)
1. Audiology(検査内容にAudiologist Examination等の聴覚検査): 特段の注意点が無ければ詳細は不要。
   氏名・時刻・「聴覚のみ」である旨を一言添える程度でよい。
2. Audiology以外:
   a. SHA(検査内容に「SHA」「退役前検査(Separation Health Assessment)」がある=現役veteranの検査):
      基本的に初回検査で、IMO(Independent Medical Opinion)は要求されない。
   b. SHA以外:
      I.  Service connected の follow up: IMOは要求されない。
          「診断(評価)が前回から変わったか=悪化/改善の有無」が焦点。
      II. それ以外(過去にrejectされている、または初回claim): IMOが必要。

${CLAIM_DETAIL_INSTRUCTIONS}

# claim集計の作り方(必須)
- 1日全体の claim 集計は書かないこと。` + "`brief.md`" + ` の冒頭に全体集計段落は不要。
- 代わりに、各予約ごとにその患者の claim を「整形」と「整形以外」に二分して件数を出す。
- 整形は spine / joint / extremity / musculoskeletal に相当する claim
  (例: 頚椎, 腰椎, 肩, 肘, 手, 股関節, 膝, 足, 足首 など)。
- それ以外は「整形以外」に入れる。
- 各予約の claim まとめの形式は次に合わせる:
  整形以外4件（副鼻腔炎、GERD、片頭痛(direct IMO)、IBS(TERA IMO)）、整形4件（頚椎(2ndly IMO)、腰椎、膝(2ndly IMO)、足）
- claim 名は claimDetail から日本語で短く正規化し、対象部位・左右を保って重複なく列挙する。同一予約の別claimは省略しない。
- IMO 種類が Direct / 2ndly / TERA のものだけ claim 名の後ろに「(<種類> IMO)」を付ける。
- Direct は表示時に direct IMO、2ndly は 2ndly IMO、TERA は TERA IMO とする。

# brief.md の形式
- Markdown で出力すること。
- 先頭に対象日 ` + "`" + `${ymd}` + "`" + ` と件数を書くこと。
- 各予約を時刻順に、『時刻 / 氏名(年齢・性別) / 分類 / claimまとめ(各claimごとのIMO付き) / 病歴の要約 / 確認すべき項目(箇条書き)』でまとめること。
- どの予約も、まず最初に年齢と性別を述べる。年齢/性別が不明の場合のみその旨を書く。

# podcast-script.txt の形式
- 日本語の二人対話だけを書くこと。
- A=進行役、B=専門役ではなく、**各行の先頭を必ず ` + "`進行役:`" + ` または ` + "`専門役:`" + ` で始める**こと。
- 1発話ごとに1行以上使ってよいが、各ターンの先頭ラベルは必ず残すこと。
- 冒頭は対象日と件数を一言、最後に当日の注意点を短くまとめる。
- 目標の長さは約${PODCAST_MINUTES}分=日本語で概ね ${Math.round(PODCAST_MINUTES * 330)}〜${Math.round(PODCAST_MINUTES * 400)} 文字。必ずこの分量を満たすこと。
- Audiology以外の各予約は最低8〜12往復(A/B交互)使い、病歴の時系列・前回比較・確認項目を深掘りする。
- Audiology予約は1〜2往復で簡潔に。
- 聞き手は専門家なので、Audiology / SHA / service connected / IMO / nexus / DBQ 等の用語説明や基礎解説は不要。

# 予約一覧(JSON)
${JSON.stringify(appts.map(({ notes, ...appointment }) => appointment), null, 2)}
`;
}

async function collectGenerationInputs(opts = {}) {
  const range = targetDayRange(opts.date || null);
  let appts;
  if (opts.sample) {
    appts = sampleAppointments();
  } else {
    appts = await fetchAppointments(range);
  }

  if (opts.prepareEvidence) {
    const { prepareAppointmentsEvidence, saveEvidenceReviewBatch, readBackEvidenceReview } = require('./evidence-review.cjs');
    const { summarizeNote } = require('./note-review-ai.cjs');
    const selected = opts.selected || require('../local/ai/task-settings.cjs').choice('summary');
    appts = await prepareAppointmentsEvidence(appts, {
      summarize: opts.summarize || (notes => summarizeNote(notes, selected)),
      saveBatch: opts.saveBatch || (changes => saveEvidenceReviewBatch(getFirestore(), changes)),
      readBack: opts.readBack || (changes => readBackEvidenceReview(getFirestore(), changes)),
    });
  }
  return {
    ymd: range.ymd,
    count: appts.length,
    appointments: appts,
    prompt: buildGeminiPrompt(appts, range.ymd),
  };
}

/**
 * Codex Scheduledが判断に使う定時実行コンテキスト。
 * 文章生成はCodexに委ね、音声合成・Firestore・Storage保存は既存処理に残す。
 */
async function getScheduledSummaryContext(options = {}) {
  const ymd = await findNextUpcomingAppointmentDate();
  if (!ymd) {
    return { action: 'skip', reason: '翌日以降に予約がありません。' };
  }

  const existing = getExistingBriefResult(ymd);
  const scriptPath = path.join(existing.outDir, 'podcast-script.txt');
  if (existing.exists && existing.audioFile) {
    return {
      action: 'skip',
      reason: `${ymd} は Summary と音声が既に作成済みです。`,
      ymd,
      outDir: existing.outDir,
    };
  }

  if (existing.exists && fs.existsSync(scriptPath)) {
    return {
      action: 'finalize',
      ymd,
      outDir: existing.outDir,
      reason: `${ymd} は原稿作成済みのため、音声・保存処理だけ実行します。`,
    };
  }

  const inputs = await collectGenerationInputs({ ...options, date: ymd, prepareEvidence: true });
  return {
    action: 'generate',
    ymd,
    count: inputs.count,
    outDir: existing.outDir,
    briefPath: existing.mdPath,
    scriptPath,
    prompt: inputs.prompt,
  };
}

/**
 * 手動の Codex Summary が使う対象日固定のコンテキスト。
 * 既存成果物の判定は UI 側で済ませ、ここでは常に指定日の原稿を作り直す。
 */
async function getCodexSummaryContext(date, options = {}) {
  if (!date) {
    throw new Error('--codex-context には --date YYYY-MM-DD が必要です。');
  }

  const inputs = await collectGenerationInputs({ ...options, date, prepareEvidence: true });
  const existing = getExistingBriefResult(inputs.ymd);
  return {
    action: 'generate',
    ymd: inputs.ymd,
    count: inputs.count,
    outDir: existing.outDir,
    briefPath: existing.mdPath,
    scriptPath: path.join(existing.outDir, 'podcast-script.txt'),
    prompt: inputs.prompt,
  };
}

function audioDescription() {
  const { model, voiceA, voiceB } = require('./gemini-tts').settings();
  return `engine=gemini, model=${model}, voices=${voiceA}/${voiceB}, speed=${PODCAST_SPEED}`;
}

function runLocalTool(cmd, args, errorMessage) {
  const toolPath = resolveLocalTool(cmd);
  const result = spawnSync(toolPath, args, {
    stdio: 'ignore',
    timeout: LOCAL_TTS_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (result.error) {
    throw new Error(`${errorMessage}: ${result.error.message}`);
  }
  if (result.signal === 'SIGKILL') {
    throw new Error(`${errorMessage}: timeout after ${LOCAL_TTS_TIMEOUT_MS}ms`);
  }
  if (result.status !== 0) {
    throw new Error(`${errorMessage}: exit=${result.status}`);
  }
}

// Gemini is the only supported audio engine. Reject stale settings before any work.
async function synthesizePodcast(openai, dialogue, outBaseNoExt) {
  if (String(PODCAST_AUDIO_ENGINE).toLowerCase() !== 'gemini') {
    throw new Error('音声エンジンはGeminiのみ対応しています。PODCAST_AUDIO_ENGINE=gemini を設定してください。');
  }
  const gemini = require('./gemini-tts');
  gemini.validateSettings();
  const { prepareSpeechDialogue } = require('./prepare-speech');
  dialogue = await prepareSpeechDialogue(dialogue, path.dirname(outBaseNoExt), { log });
  return gemini.synthesizeGemini(dialogue, outBaseNoExt, { runLocalTool, speed: PODCAST_SPEED, log });
}

function parsePodcastScript(scriptTxt) {
  const normalized = String(scriptTxt || '').replace(/\r/g, '');
  const lines = normalized.split('\n');
  const dialogue = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const hostA = line.match(/^進行役:\s*(.*)$/);
    const hostB = line.match(/^専門役:\s*(.*)$/);
    if (hostA || hostB) {
      if (current && current.text.trim()) {
        dialogue.push({
          speaker: current.speaker,
          text: current.text.trim(),
        });
      }
      current = {
        speaker: hostB ? 'B' : 'A',
        text: (hostA?.[1] || hostB?.[1] || '').trim(),
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      if (current.text && !current.text.endsWith('\n')) {
        current.text += '\n';
      }
      continue;
    }

    current.text += current.text ? `\n${trimmed}` : trimmed;
  }

  if (current && current.text.trim()) {
    dialogue.push({
      speaker: current.speaker,
      text: current.text.trim(),
    });
  }

  if (!dialogue.length) {
    throw new Error('podcast-script.txt から発話を解析できませんでした。各行を「進行役:」「専門役:」で始めてください。');
  }

  return dialogue;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function finalizeManualImport(opts = {}) {
  const range = targetDayRange(opts.date || null);
  const outDir = path.join(OUTPUT_DIR, range.ymd);
  const mdPath = path.join(outDir, 'brief.md');
  const scriptPath = path.join(outDir, 'podcast-script.txt');

  if (!fs.existsSync(mdPath)) {
    throw new Error(`brief.md が見つかりません: ${mdPath}`);
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`podcast-script.txt が見つかりません: ${scriptPath}`);
  }

  const summaryMarkdown = fs.readFileSync(mdPath, 'utf8');
  const scriptTxt = fs.readFileSync(scriptPath, 'utf8');

  if (opts.validateDate !== false) {
    const ymdPattern = new RegExp(escapeRegExp(range.ymd));
    if (!ymdPattern.test(summaryMarkdown)) {
      throw new Error(`brief.md に対象日 ${range.ymd} が見つかりません。`);
    }
  }

  const dialogue = parsePodcastScript(scriptTxt);
  fs.writeFileSync(
    path.join(outDir, 'dialogue.json'),
    JSON.stringify(dialogue, null, 2)
  );
  log('台本解析完了。');

  let audioFile = null;
  if (!opts.noAudio) {
    log(`音声生成中 (${audioDescription()}) ...`);
    const synthesized = await synthesizePodcast(null, dialogue, path.join(outDir, 'podcast'));
    audioFile = synthesized.mp3Path || synthesized.wavPath;
  } else {
    audioFile = findExistingAudioFile(outDir);
  }

  const result = {
    ymd: range.ymd,
    count: Number.isFinite(opts.count) ? opts.count : null,
    outDir,
    mdPath,
    summaryMarkdown,
    audioFile,
  };
  result.audioStoragePath = await uploadPodcastAndPrune(result.ymd, result.audioFile, opts);
  log('Firestore 保存中...');
  await saveBriefToFirestore(result);
  log('完了。');
  return result;
}

module.exports = {
  synthesizePodcast,
  getExistingBriefResult,
  saveBriefToFirestore,
  syncLatestPodcastAudio,
  collectGenerationInputs,
  getScheduledSummaryContext,
  getCodexSummaryContext,
  finalizeManualImport,
};

function summaryOptions() {
  const index = args.indexOf('--summary-ai-file');
  return index >= 0 ? { selected: JSON.parse(fs.readFileSync(args[index + 1], 'utf8')) } : {};
}

// ----------------------------- CLI -----------------------------
if (require.main === module) {
  (async () => {
    if (flags.dumpPrompt) {
      const payload = await collectGenerationInputs({ date: flags.date, sample: flags.sample });
      process.stdout.write(JSON.stringify(payload, null, 2));
      return;
    }

    if (flags.scheduledContext) {
      const result = await getScheduledSummaryContext(summaryOptions());
      process.stdout.write(JSON.stringify(result, null, 2));
      return;
    }

    if (flags.codexContext) {
      const result = await getCodexSummaryContext(flags.date, summaryOptions());
      process.stdout.write(JSON.stringify(result, null, 2));
      return;
    }

    if (flags.finalizeManual || flags.finalizePrepared) {
      const result = await finalizeManualImport({ date: flags.date, noAudio: flags.noAudio, skipPrune: flags.skipPrune });
      process.stdout.write(JSON.stringify({
        ymd: result.ymd,
        count: result.count,
        summaryMarkdown: result.summaryMarkdown,
        audioFile: result.audioFile,
      }, null, 2));
      return;
    }

    if (flags.syncAudio) {
      const result = await syncLatestPodcastAudio({ skipPrune: flags.skipPrune });
      process.stdout.write(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error('APIによる新規生成は廃止しました。SOSList Localアプリから作成してください。');
  })().catch((err) => {
    console.error('エラー:', err.stack || err.message || err);
    process.exit(1);
  });
}
