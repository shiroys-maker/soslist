#!/usr/bin/env node
/**
 * daily-brief / generate-brief.js
 * ------------------------------------------------------------------
 * 翌日(JST)の予約を Firestore から取得し、検査内容(services)とメモ(notes)を
 * 判定ルールに沿って OpenAI で要約 + 二人対話のポッドキャスト台本を生成し、
 * クラウドTTSで音声(WAV/MP3)を出力する。
 *
 * 実行例:
 *   node generate-brief.js                 # 翌日分を本番生成
 *   node generate-brief.js --date 2026-06-02   # 指定日(その日)を生成
 *   node generate-brief.js --no-audio      # 音声をスキップ(テキストのみ)
 *   node generate-brief.js --sample        # Firestore非依存のサンプルで通し検証
 *   node generate-brief.js --scheduled-context # Codex定時処理用の対象日・入力を出力
 *   node generate-brief.js --finalize-prepared --date YYYY-MM-DD # 作成済み原稿を音声・保存処理
 *
 * 必要な環境変数:
 *   ANTHROPIC_API_KEY             … Anthropic APIキー(要約 + 台本生成)
 *   OPENAI_API_KEY                … OpenAI APIキー(OpenAIモデルまたはOpenAI TTS使用時)
 *   GOOGLE_APPLICATION_CREDENTIALS… Firebaseサービスアカウントjsonへのパス
 *                                   (openai-processor と同じ認証情報)
 *   ※ または SERVICE_ACCOUNT_PATH に明示指定も可
 *
 * 任意の環境変数:
 *   LLM_PROVIDER     (default anthropic)        … anthropic / openai
 *   PODCAST_MODEL    (default claude-sonnet-5)  … 台本生成モデル
 *   PODCAST_FALLBACK_MODEL (default empty)      … 初回モデルで薄い時の高品質フォールバック
 *   ANTHROPIC_EFFORT (default medium)           … Claude API の出力工数(low / medium / high / xhigh / max)
 *   PODCAST_GENERATION_MAX_ATTEMPTS (default 1) … 同一モデルでの再生成回数。2以上は明示時のみ
 *   PODCAST_REASONING_EFFORT (default medium)   … gpt-5系 Responses API の reasoning effort
 *   PODCAST_AUDIO_ENGINE (default aivis)         … aivis / say / openai
 *   TTS_MODEL        (default tts-1)             … OpenAI TTS使用時の音声合成モデル
 *   TTS_VOICE_A      (default alloy)             … OpenAI TTS使用時のホストAの声
 *   TTS_VOICE_B      (default onyx)              … OpenAI TTS使用時のホストBの声
 *   SAY_VOICE        (default Kyoko)             … macOS say 使用時の声
 *   AIVIS_ENGINE_URL  (default http://127.0.0.1:10101) … AivisSpeech Engine URL
 *   AIVIS_STYLE_ID_A  (default 1937616896)       … 進行役: にせ / ノーマル
 *   AIVIS_STYLE_ID_B  (default 1388823424)       … 専門役: 凛音エル / ノーマル
 *   PODCAST_MINUTES  (default 12)                … 目標尺(分)
 *   OUTPUT_DIR       (default ./output)          … 出力先
 *   FIREBASE_STORAGE_BUCKET (default sos-list-4d150.firebasestorage.app) … Web再生用MP3の保存先
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ----------------------------- 引数解析 -----------------------------
const args = process.argv.slice(2);
const flags = {
  sample: args.includes('--sample'),
  noAudio: args.includes('--no-audio'),
  dumpPrompt: args.includes('--dump-prompt'),
  finalizeManual: args.includes('--finalize-manual'),
  finalizePrepared: args.includes('--finalize-prepared'),
  syncAudio: args.includes('--sync-audio'),
  scheduledContext: args.includes('--scheduled-context'),
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
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'anthropic';
const PODCAST_MODEL = process.env.PODCAST_MODEL || 'claude-sonnet-5';
const PODCAST_FALLBACK_MODEL = process.env.PODCAST_FALLBACK_MODEL || '';
// high はかなり遅く、薄い出力時の自動2回目と組み合わさると体感が悪い。
// 初回プロンプト側を強くし、既定は medium + 1回生成に寄せる。
const ANTHROPIC_EFFORT = process.env.ANTHROPIC_EFFORT || 'medium';
const PODCAST_REASONING_EFFORT = process.env.PODCAST_REASONING_EFFORT || 'medium';
const PODCAST_GENERATION_MAX_ATTEMPTS = Math.max(1, Number(process.env.PODCAST_GENERATION_MAX_ATTEMPTS || 1));
const PODCAST_TEMPERATURE = Number(process.env.PODCAST_TEMPERATURE || 0.4);
const PODCAST_AUDIO_ENGINE = process.env.PODCAST_AUDIO_ENGINE || 'aivis';
// tts-1 は speed パラメータ(0.25〜4.0)に対応するため既定にしている。
const TTS_MODEL = process.env.TTS_MODEL || 'tts-1';
const TTS_VOICE_A = process.env.TTS_VOICE_A || 'alloy';
const TTS_VOICE_B = process.env.TTS_VOICE_B || 'onyx';
const SAY_VOICE_A = process.env.SAY_VOICE_A || process.env.SAY_VOICE || 'Kyoko';
const SAY_VOICE_B = process.env.SAY_VOICE_B || 'Reed (日本語（日本）)';
const AIVIS_ENGINE_URL = process.env.AIVIS_ENGINE_URL || 'http://127.0.0.1:10101';
const AIVIS_STYLE_ID_A = Number(process.env.AIVIS_STYLE_ID_A || 1937616896);
const AIVIS_STYLE_ID_B = Number(process.env.AIVIS_STYLE_ID_B || 1388823424);
const AIVIS_APP_PATH = process.env.AIVIS_APP_PATH || '/Applications/AivisSpeech.app';
const PODCAST_MINUTES = Number(process.env.PODCAST_MINUTES || 12);
// 読み上げ速度(1.0=等速)。ユーザー希望により既定 1.4 倍速。
const PODCAST_SPEED = Number(process.env.PODCAST_SPEED || 1.4);
const LOCAL_TTS_TIMEOUT_MS = Number(process.env.LOCAL_TTS_TIMEOUT_MS || 60000);
const AIVIS_STARTUP_TIMEOUT_MS = Number(process.env.AIVIS_STARTUP_TIMEOUT_MS || 20000);

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
  const payload = {
    ymd: result.ymd,
    summaryMarkdown: result.summaryMarkdown,
    appointmentCount: Number.isFinite(result.count) ? result.count : null,
    hasAudio: Boolean(result.audioFile),
    audioFilename: result.audioFile ? path.basename(result.audioFile) : null,
    audioStoragePath: result.audioStoragePath || null,
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

async function uploadPodcastAndPrune(ymd, audioFile) {
  const storagePath = await uploadPodcastToStorage(ymd, audioFile);
  if (!storagePath) return null;
  await pruneStoredPodcasts();
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

async function syncLatestPodcastAudio() {
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
      notes: 'PTSD 初回claim。IMO必要。過去にstressorの裏付け不足で一度reject。'
        + '2008-2012アフガニスタン2回派遣、IED爆発の目撃エピソードあり。'
        + '現在: 不眠・悪夢・過覚醒・回避傾向。民間でのカウンセリング歴半年。'
        + '軍歴(stressor)とのnexus、症状の発症時期と継続を要確認。',
      isAudiology: false,
    },
  ];
}

function countNonAudiologyAppointments(appts) {
  return appts.filter((appt) => !appt.isAudiology).length;
}

function countAudiologyAppointments(appts) {
  return appts.filter((appt) => appt.isAudiology).length;
}

function minimumSummaryChars(appts) {
  // 内容要件(病歴6文・確認項目5件)を維持しつつ、表現差だけで不必要な再生成に
  // 入らないよう、初回出力の実用的な下限に合わせる。
  return 220 + (countNonAudiologyAppointments(appts) * 560) + (countAudiologyAppointments(appts) * 60);
}

function minimumDialogueChars() {
  return Math.round(PODCAST_MINUTES * 300);
}

function dialogueCharCount(dialogue) {
  return (dialogue || []).reduce((sum, turn) => sum + String(turn.text || '').length, 0);
}

function isBriefTooThin(summaryMarkdown, dialogue, appts) {
  const summaryLength = String(summaryMarkdown || '').length;
  const dialogueLength = dialogueCharCount(dialogue);
  return summaryLength < minimumSummaryChars(appts) || dialogueLength < minimumDialogueChars();
}

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

# メモ(notes)の読み込み(最重要)
- claim内容(主訴・対象部位)とIMOの有無は notes の先頭に書かれている。判定はnotesを最優先の根拠にする。
- notes 先頭から、claim名と IMO 種類を抽出すること。IMO 種類は Direct / 2ndly / TERA を優先して拾い、
  無い場合だけ「IMO不要」とみなす。
- 重要: IMO 種類は予約全体で 1 つではなく、claim ごとに別々に判定すること。
  同一予約内で「片頭痛は Direct、IBS は TERA、頚椎は 2ndly」のように混在しうる。
  したがって claim 集計でも各予約行でも、claim 名ごとに IMO 種類を対応づけて表示すること。
- notesに書かれた過去の病歴・受傷機転・手術歴・前回評価・経過・現在の症状を、
  単語の羅列ではなく時系列の文章で具体的に要約する。servicesは検査の種類の補足として使う。
- 「検査内容(services)に書かれた単語だけを読み上げる」のは禁止。必ずnotesの中身を咀嚼して語る。
- notesが空のAudiology予約だけは、ルール1に従い深掘り不要(氏名・年齢・性別・聴覚のみと一言)。
- 各予約で、検査医が問診時に確認すべき項目を具体的に挙げる。
  IMOが必要な案件は nexus(軍歴との因果)・受傷機転・発症時期・症状の継続の確認点を重視。
  follow up案件は「前回評価との比較」「悪化/改善の客観的所見」に重点。

# claim集計の作り方(必須)
- 1日全体の claim 集計は書かないこと。` + "`brief.md`" + ` の冒頭に全体集計段落は不要。
- 代わりに、各予約ごとにその患者の claim を「整形」と「整形以外」に二分して件数を出す。
- 整形は spine / joint / extremity / musculoskeletal に相当する claim
  (例: 頚椎, 腰椎, 肩, 肘, 手, 股関節, 膝, 足, 足首 など)。
- それ以外は「整形以外」に入れる。
- 各予約の claim まとめの形式は次に合わせる:
  整形以外4件（副鼻腔炎、GERD、片頭痛(direct IMO)、IBS(TERA IMO)）、整形4件（頚椎(2ndly IMO)、腰椎、膝(2ndly IMO)、足）
- claim 名は notes 先頭から日本語で短く正規化して列挙する。同一予約に複数 claim があればそのまま並べてよい。
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
${JSON.stringify(appts, null, 2)}
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
async function getScheduledSummaryContext() {
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

  const inputs = await collectGenerationInputs({ date: ymd });
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

function usesResponsesApi(model) {
  return /^gpt-5(?:\.|-|$)/.test(String(model || ''));
}

function providerForModel(model) {
  const normalized = String(model || '').toLowerCase();
  if (normalized.startsWith('claude-')) return 'anthropic';
  if (normalized.startsWith('gpt-')) return 'openai';
  return String(LLM_PROVIDER || 'openai').toLowerCase();
}

function extractResponseText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function extractJsonText(raw) {
  const text = String(raw || '').trim();
  if (!text) return text;
  if (text.startsWith('{') && text.endsWith('}')) return text;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }
  return text;
}

function isUnavailableModelError(error) {
  const status = error?.status || error?.code;
  const message = String(error?.message || '');
  return status === 404 && /model .*not available|limited preview|does not exist/i.test(message);
}

async function createJsonCompletion(openai, { model, system, user, maxOutputTokens = 16000 }) {
  const provider = providerForModel(model);
  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("環境変数 'ANTHROPIC_API_KEY' が設定されていません。");
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        output_config: { effort: ANTHROPIC_EFFORT },
        system,
        messages: [
          {
            role: 'user',
            content: `${user}\n\n重要: 返答はJSONオブジェクトのみ。Markdownコードフェンスや説明文は付けない。`,
          },
        ],
      }),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Anthropic API error ${response.status}: ${bodyText}`);
      error.status = response.status;
      throw error;
    }
    const body = JSON.parse(bodyText);
    const raw = (body.content || [])
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (!raw) throw new Error(`Anthropic API returned empty output. model=${model}`);
    return extractJsonText(raw);
  }

  if (usesResponsesApi(model)) {
    const response = await openai.responses.create({
      model,
      instructions: system,
      input: user,
      text: { format: { type: 'json_object' } },
      reasoning: { effort: PODCAST_REASONING_EFFORT },
      max_output_tokens: maxOutputTokens,
    });
    const raw = extractResponseText(response);
    if (!raw) throw new Error(`Responses API returned empty output. model=${model}`);
    return extractJsonText(raw);
  }

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: PODCAST_TEMPERATURE,
    max_tokens: maxOutputTokens,
  });
  return extractJsonText(completion.choices[0].message.content);
}

// ----------------------------- 台本生成 (OpenAI) -----------------------------
async function generateBrief(openai, appts, ymd) {
  const nonAudiologyCount = countNonAudiologyAppointments(appts);
  const audiologyCount = countAudiologyAppointments(appts);
  const summaryMinChars = minimumSummaryChars(appts);
  const dialogueMinChars = minimumDialogueChars();
  const dialogueTargetChars = Math.round(PODCAST_MINUTES * 360);
  const system = `あなたは米国退役軍人(VA)障害認定検査クリニックの臨床コーディネーターであり、
熟練のポッドキャスト構成作家でもあります。検査医が「翌日の予約」を移動中に聞いて把握できる、
日本語の準備用ブリーフを作成します。

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

# メモ(notes)の読み込み(最重要)
- claim内容(主訴・対象部位)とIMOの有無は notes の先頭に書かれている。判定はnotesを最優先の根拠にする。
- notes 先頭から、claim名と IMO 種類を抽出すること。IMO 種類は Direct / 2ndly / TERA を優先して拾い、
  無い場合だけ「IMO不要」とみなす。
- 重要: IMO 種類は予約全体で 1 つではなく、claim ごとに別々に判定すること。
  同一予約内で「片頭痛は Direct、IBS は TERA、頚椎は 2ndly」のように混在しうる。
  したがって claim 集計でも各予約行でも、claim 名ごとに IMO 種類を対応づけて表示すること。
- notesに書かれた**過去の病歴・受傷機転・手術歴・前回評価・経過・現在の症状**を、
  単語の羅列ではなく**時系列の文章で具体的に要約**する。servicesは検査の種類の補足として使う。
- 「検査内容(services)に書かれた単語だけを読み上げる」のは禁止。必ずnotesの中身を咀嚼して語る。
- notesが空のAudiology予約だけは、ルール1に従い深掘り不要(氏名・年齢・性別・聴覚のみと一言)。
- 各予約で、検査医が問診時に確認すべき項目を具体的に挙げる。
  IMOが必要な案件は nexus(軍歴との因果)・受傷機転・発症時期・症状の継続の確認点を重視。
  follow up案件は「前回評価との比較」「悪化/改善の客観的所見」に重点。
- **簡潔すぎる要約は禁止**。Audiology 以外の予約は、病歴要約で最低でも受傷/発症時期、経過、現在症状、今回の焦点を含めること。
- Audiology 以外の各予約について、病歴要約は原則 6 文以上で書き、既往・治療歴・前回評価・現在の訴え・今回の検査焦点まで展開すること。
- Audiology 以外の各予約では、確認すべき項目を最低5件は入れること。
- 各非Audiology予約は、必ず次の情報を本文に含める:
  1. notes先頭から抽出したclaim名とclaimごとのIMO種別
  2. 発症/受傷/診断の時期、軍歴や派遣歴との関係
  3. 治療歴、手術歴、画像検査、前回評価などnotesにある客観情報
  4. 現在症状、機能制限、悪化/改善の比較点
  5. 当日の問診・DBQ・nexus確認で落とせない焦点
- servicesだけからの推測で済ませず、notesにある具体語を患者ごとの準備事項へ展開すること。
- 対象日の各予約を省略せず、全件を個別に扱うこと。
- summaryMarkdown 全体は最低でも約${summaryMinChars}文字以上を目安にし、短すぎる場合は自分で追記してから返すこと。

# 初回で完結させる分量設計(必須)
- 一般論は省いてよいが、患者ごとの具体的な病歴・時系列・確認項目は短縮しないこと。
- 非Audiology予約は、summaryMarkdown で患者ごとにおおむね600文字以上を使う。見出し、claimまとめ、病歴要約、確認項目を別々に書くこと。
- podcastDialogue は、全体で約${dialogueTargetChars}文字を目標にする。非Audiology予約には導入・締めを除いて十分な分量を配分し、各症例を途中で切り上げないこと。
- 非Audiology予約ごとに A/B の発話を最低16ターン(8往復)入れ、病歴、現在症状、当日の確認点をそれぞれ別の発話で扱うこと。
- JSONを組み立てる前に内部で患者ごとの分量配分を決め、短く要約して終わらせないこと。内部の計画や文字数計算は出力しないこと。

# 出力前セルフチェック(必須)
JSONを返す直前に、次の不足が1つでもあれば本文を自分で補ってから返すこと。
- summaryMarkdown が最低約${summaryMinChars}文字に届かない。
- podcastDialogue が最低約${dialogueMinChars}文字に届かない。
- 非Audiology予約で病歴要約が6文未満。
- 非Audiology予約で確認項目が5件未満。
- claim名、claimごとのIMO種別、時系列、現在症状、今回の焦点のどれかが抜けている。
- notesにある具体情報を services の言い換えだけで済ませている。
- 非Audiology ${nonAudiologyCount}件のうち、briefまたはpodcastで個別に扱っていない予約がある。

# claim集計の作り方(必須)
- 1日全体の claim 集計は書かないこと。summaryMarkdown の冒頭に全体集計段落は不要。
- 代わりに、各予約ごとにその患者の claim を「整形」と「整形以外」に二分して件数を出す。
- 整形は spine / joint / extremity / musculoskeletal に相当する claim
  (例: 頚椎, 腰椎, 肩, 肘, 手, 股関節, 膝, 足, 足首 など)。
- それ以外は「整形以外」に入れる。
- 各予約の claim まとめの形式は次に合わせる:
  整形以外4件（副鼻腔炎、GERD、片頭痛(direct IMO)、IBS(TERA IMO)）、整形4件（頚椎(2ndly IMO)、腰椎、膝(2ndly IMO)、足）
- claim 名は notes 先頭から日本語で短く正規化して列挙する。同一予約に複数 claim があればそのまま並べてよい。
- IMO 種類が Direct / 2ndly / TERA のものだけ claim 名の後ろに「(<種類> IMO)」を付ける。
- Direct は表示時に direct IMO、2ndly は 2ndly IMO、TERA は TERA IMO とする。
- 予約ごとの claim まとめでも同じルールを使い、各 claim に対応する IMO を個別に付けること。
  例: 「片頭痛(direct IMO)、IBS(TERA IMO)」のように 1 行内で混在してよい。

# 各予約の語り出し(必須)
- どの予約も、まず最初に **年齢と性別** を述べる(例:「58歳・男性の…」)。続いて氏名・時刻・分類。
  年齢/性別が不明(null)の場合のみ「年齢不明」等と述べる。
- summaryMarkdown の各予約行でも、氏名の直後の「(年齢・性別)」の次に IMO 種類を入れること。
  ただし、ここでは予約全体の IMO を 1 つにまとめず、「年齢・性別」のみを書く。
  IMO 表記は後続の claim まとめで各 claim ごとに表現すること。

# 出力(JSONのみ)
{
  "summaryMarkdown": "テキスト版のブリーフ。日本語markdown。先頭に日付と件数。
     各予約を時刻順に、『時刻 / 氏名(年齢・性別) / 分類 / claimまとめ(各claimごとのIMO付き) / 病歴の要約 / 確認すべき項目(箇条書き)』でまとめる。",
  "podcastDialogue": [ {"speaker":"A","text":"..."}, {"speaker":"B","text":"..."} ]
}

# 聞き手の前提
- 聞き手は本人(VA障害認定検査の専門医)。Audiology / SHA / service connected / IMO / nexus / DBQ 等の
  用語説明や基礎解説は **一切不要**。冗長な前置き・一般論も省く。要点と確認事項に集中する。

# ポッドキャストの作り方(長さを必ず満たす)
- 二人の日本語対話。A=進行役(俯瞰し質問する)、B=臨床に詳しい専門役(病歴と確認点を解説)。
- 冒頭は日付と件数を一言、最後に当日の注意点を短くまとめる。
- 目標の長さは約${PODCAST_MINUTES}分=日本語で概ね ${Math.round(PODCAST_MINUTES * 330)}〜${Math.round(PODCAST_MINUTES * 400)} 文字。**必ずこの分量を満たす**。
- Audiology以外の各予約は **最低8〜12往復(A/B交互)** 使い、病歴の時系列・前回比較・確認項目を深掘りする。
  Audiology予約は1〜2往復で簡潔に。
- 1発話は2〜4文程度で区切り、AとBが自然に交互に話す。
- podcastDialogue 全体は最低でも約${dialogueMinChars}文字以上、理想は約${dialogueTargetChars}文字以上にし、短ければ掘り下げを足してから返すこと。
- 出力前に自分で確認し、summaryMarkdown と podcastDialogue の両方が十分に具体的であることを確認してから返すこと。`;

  const user = `対象日(JST): ${ymd}
予約件数: 全${appts.length}件（Audiology ${audiologyCount}件 / Audiology以外 ${nonAudiologyCount}件）
予約一覧(JSON。各予約に age=年齢, sex=性別, notes=病歴メモ を含む):
${JSON.stringify(appts, null, 2)}

分類ルールに従って判定し、指定のJSONのみを返す。
必須条件:
- 非Audiology ${nonAudiologyCount}件は全件とも省略せず、brief では各予約ごとに claimまとめ、病歴の時系列、現在症状、今回の焦点、確認項目を必ず分けて書くこと。
- summaryMarkdown は最低約${summaryMinChars}文字以上を目安にすること。
- podcastDialogue は最低約${dialogueMinChars}文字以上、理想は約${dialogueTargetChars}文字以上にすること。
- 非Audiology予約ごとに summary ではおおむね600文字以上、podcast では最低16ターンを配分すること。
- 各予約の語り出しで年齢・性別を述べること。
- notes の病歴を時系列の文章で具体的に要約し、claim ごとの IMO を claim まとめに反映すること。
- 初回出力から再生成不要な完成度にすること。短すぎる・浅すぎる・項目不足があれば、返答前に自分で追記して基準を満たすこと。

JSON以外は出力しない。`;

  let parsed = null;
  const modelAttempts = [
    { model: PODCAST_MODEL, maxAttempts: PODCAST_GENERATION_MAX_ATTEMPTS },
    ...(PODCAST_FALLBACK_MODEL && PODCAST_FALLBACK_MODEL !== PODCAST_MODEL
      ? [{ model: PODCAST_FALLBACK_MODEL, maxAttempts: 1 }]
      : []),
  ];

  for (const modelAttempt of modelAttempts) {
    for (let attempt = 0; attempt < modelAttempt.maxAttempts; attempt++) {
      const strictAddon = attempt === 0 && modelAttempt.model === PODCAST_MODEL ? '' : `

追加指示:
- 前回の出力は簡素すぎたため、今回は各予約の不足項目を明示的に補完すること。
- summaryMarkdown は各非Audiology予約ごとに、病歴要約6文以上、確認項目5件以上、今回の焦点1段落を必ず含めること。
- claim名、IMO種別、病歴時系列、現在症状、今回の焦点が欠けた予約があれば、notesから読み直して出力前に補完すること。
- podcastDialogue は短くまとめず、各非Audiology予約で病歴、鑑別/DBQ観点、nexus/悪化確認を十分に掘り下げること。
- summaryMarkdown は最低約${summaryMinChars}文字以上、podcastDialogue は最低約${dialogueMinChars}文字以上を必ず満たすこと。`;
      log(`ブリーフ生成中 (model=${modelAttempt.model}, attempt=${attempt + 1}/${modelAttempt.maxAttempts}) ...`);
      let raw;
      try {
        raw = await createJsonCompletion(openai, {
          model: modelAttempt.model,
          system: system + strictAddon,
          user,
          maxOutputTokens: 18000,
        });
      } catch (error) {
        if (isUnavailableModelError(error)) {
          log(`モデル ${modelAttempt.model} はこのAPIアカウントで未開放のためスキップします: ${error.message}`);
          break;
        }
        throw error;
      }
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.podcastDialogue)) parsed.podcastDialogue = [];
      if (!parsed.summaryMarkdown) parsed.summaryMarkdown = '(要約生成に失敗しました)';
      if (!parsed.podcastDialogue.length) {
        log('podcastDialogue が空だったため、台本のみ再生成します...');
        parsed.podcastDialogue = await generatePodcastDialogueFallback(openai, appts, ymd, parsed.summaryMarkdown, modelAttempt.model);
      }
      if (!isBriefTooThin(parsed.summaryMarkdown, parsed.podcastDialogue, appts)) {
        log(`ブリーフ生成完了: summary=${String(parsed.summaryMarkdown).length}/${summaryMinChars} chars, dialogue=${dialogueCharCount(parsed.podcastDialogue)}/${dialogueMinChars} chars`);
        return parsed;
      }
      log(`出力が簡素すぎたため再生成します... model=${modelAttempt.model}, summary=${String(parsed.summaryMarkdown || '').length} chars, dialogue=${dialogueCharCount(parsed.podcastDialogue)} chars`);
    }
  }
  return parsed;
}

async function generatePodcastDialogueFallback(openai, appts, ymd, summaryMarkdown, model = PODCAST_MODEL) {
  const system = `あなたは VA 障害認定検査クリニック向けの日本語ポッドキャスト台本作成者です。

出力は JSON のみです。
{
  "podcastDialogue": [ {"speaker":"A","text":"..."}, {"speaker":"B","text":"..."} ]
}

制約:
- podcastDialogue は必ず空配列でなく、A/B の発話を含めること。
- A=進行役、B=専門役。
- 冒頭で対象日と件数を短く述べ、最後に当日の注意点を短くまとめること。
- 聞き手は専門医なので一般的説明は不要。病歴要約と確認項目に集中すること。
- 各 text は空にしないこと。
- Audiology以外の各予約は最低8往復以上で掘り下げること。
- 出力が短すぎたり、患者ごとの論点が浅くならないようにすること。`;

  const targetChars = Math.round(PODCAST_MINUTES * 360);
  const user = `対象日: ${ymd}
予約一覧:
${JSON.stringify(appts, null, 2)}

既に確定している brief.md:
${summaryMarkdown}

上記に基づき、二人対話の台本を再生成してください。
合計で日本語 約${targetChars}文字以上を目安にし、podcastDialogue を必ず埋めてください。`;

  const raw = await createJsonCompletion(openai, {
    model,
    system,
    user,
    maxOutputTokens: 14000,
  });
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.podcastDialogue)) parsed.podcastDialogue = [];
  const filtered = parsed.podcastDialogue.filter((turn) => {
    return (turn.speaker === 'A' || turn.speaker === 'B') && String(turn.text || '').trim();
  });
  if (!filtered.length) {
    throw new Error('podcastDialogue の再生成にも失敗しました。');
  }
  return filtered;
}

function usesOpenAITts() {
  return String(PODCAST_AUDIO_ENGINE).toLowerCase() === 'openai';
}

function usesAivisTts() {
  return String(PODCAST_AUDIO_ENGINE).toLowerCase() === 'aivis';
}

function normalizeSpeechText(text) {
  return String(text || '').trim().replace(/\s*\n+\s*/g, ' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isAivisEngineReachable() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${AIVIS_ENGINE_URL}/version`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function ensureAivisEngineReady() {
  if (await isAivisEngineReachable()) {
    return;
  }

  log('AivisSpeech を起動します...');
  const openResult = spawnSync('open', [AIVIS_APP_PATH], { stdio: 'ignore' });
  if (openResult.error) {
    throw new Error(`AivisSpeech を起動できませんでした: ${openResult.error.message}`);
  }
  if (openResult.status !== 0) {
    throw new Error(`AivisSpeech を起動できませんでした: exit=${openResult.status}`);
  }

  const deadline = Date.now() + AIVIS_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isAivisEngineReachable()) {
      log('AivisSpeech Engine に接続しました。');
      return;
    }
    await sleep(500);
  }

  throw new Error(`AivisSpeech Engine が ${AIVIS_STARTUP_TIMEOUT_MS}ms 以内に起動しませんでした。`);
}

async function fetchJsonWithTimeout(url, options, errorMessage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_TTS_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${errorMessage}: HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${errorMessage}: timeout after ${LOCAL_TTS_TIMEOUT_MS}ms`);
    }
    throw new Error(`${errorMessage}: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchArrayBufferWithTimeout(url, options, errorMessage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_TTS_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${errorMessage}: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${errorMessage}: timeout after ${LOCAL_TTS_TIMEOUT_MS}ms`);
    }
    throw new Error(`${errorMessage}: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function runLocalTool(cmd, args, errorMessage) {
  const result = spawnSync(cmd, args, {
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

function convertAiffToWav(aiffPath, wavPath) {
  runLocalTool('afconvert', [
    '-f', 'WAVE',
    '-d', 'LEI16@24000',
    aiffPath,
    wavPath,
  ], `afconvert による WAV 変換に失敗しました: ${aiffPath}`);
}

function maybeEncodeMp3(wavPath, outBaseNoExt) {
  const mp3Path = `${outBaseNoExt}.mp3`;
  try {
    runLocalTool('ffmpeg', [
      '-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-qscale:a', '4',
      mp3Path,
    ], 'ffmpeg による MP3 変換に失敗しました');
    log(`MP3出力: ${mp3Path}`);
    try { fs.unlinkSync(wavPath); } catch (_) {}
    return mp3Path;
  } catch (_) {
    log('ffmpeg未検出または失敗のためWAVのみ出力(任意でffmpegを入れるとmp3も生成されます)');
  }
  return null;
}

function concatWavFiles(inputPaths, outputPath) {
  const listPath = `${outputPath}.concat.txt`;
  const listBody = inputPaths
    .map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listPath, listBody);

  runLocalTool('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outputPath,
  ], 'ffmpeg による say 音声の結合に失敗しました');
  try { fs.unlinkSync(listPath); } catch (_) {}
}

function synthesizePodcastWithSay(dialogue, outBaseNoExt) {
  const wavPath = `${outBaseNoExt}.wav`;
  const sayRate = Math.max(120, Math.min(360, Math.round(175 * PODCAST_SPEED)));
  const segmentPaths = [];
  const cleanupPaths = [];

  try {
    for (let i = 0; i < dialogue.length; i++) {
      const turn = dialogue[i];
      const text = normalizeSpeechText(turn.text);
      if (!text) continue;

      const textPath = `${outBaseNoExt}.segment-${String(i).padStart(3, '0')}.txt`;
      const aiffPath = `${outBaseNoExt}.segment-${String(i).padStart(3, '0')}.aiff`;
      const segmentWavPath = `${outBaseNoExt}.segment-${String(i).padStart(3, '0')}.wav`;
      const voice = turn.speaker === 'B' ? SAY_VOICE_B : SAY_VOICE_A;
      cleanupPaths.push(textPath, aiffPath, segmentWavPath);

      fs.writeFileSync(textPath, text);
      runLocalTool('say', [
        '-v', voice,
        '-r', String(sayRate),
        '-f', textPath,
        '-o', aiffPath,
      ], `say による音声生成に失敗しました。voice=${voice}`);
      try { fs.unlinkSync(textPath); } catch (_) {}

      convertAiffToWav(aiffPath, segmentWavPath);
      try { fs.unlinkSync(aiffPath); } catch (_) {}
      segmentPaths.push(segmentWavPath);
    }

    if (!segmentPaths.length) {
      throw new Error('say 用の発話データがありません。');
    }

    concatWavFiles(segmentPaths, wavPath);
    for (const segmentPath of segmentPaths) {
      try { fs.unlinkSync(segmentPath); } catch (_) {}
    }
    log(`WAV出力: ${wavPath}`);

    const mp3Path = maybeEncodeMp3(wavPath, outBaseNoExt);
    return { wavPath, mp3Path };
  } finally {
    for (const filePath of cleanupPaths) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
}

async function synthesizePodcastWithAivis(dialogue, outBaseNoExt) {
  await ensureAivisEngineReady();

  const wavPath = `${outBaseNoExt}.wav`;
  const segmentPaths = [];
  const cleanupPaths = [];

  try {
    for (let i = 0; i < dialogue.length; i++) {
      const turn = dialogue[i];
      const text = normalizeSpeechText(turn.text);
      if (!text) continue;

      const styleId = turn.speaker === 'B' ? AIVIS_STYLE_ID_B : AIVIS_STYLE_ID_A;
      const segmentWavPath = `${outBaseNoExt}.segment-${String(i).padStart(3, '0')}.wav`;
      cleanupPaths.push(segmentWavPath);

      const queryUrl = `${AIVIS_ENGINE_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${styleId}`;
      const audioQuery = await fetchJsonWithTimeout(
        queryUrl,
        { method: 'POST' },
        `AivisSpeech audio_query に失敗しました。styleId=${styleId}`
      );
      audioQuery.speedScale = PODCAST_SPEED;

      const synthesisUrl = `${AIVIS_ENGINE_URL}/synthesis?speaker=${styleId}`;
      const wavBuffer = await fetchArrayBufferWithTimeout(
        synthesisUrl,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(audioQuery),
        },
        `AivisSpeech synthesis に失敗しました。styleId=${styleId}`
      );
      fs.writeFileSync(segmentWavPath, wavBuffer);
      segmentPaths.push(segmentWavPath);
    }

    if (!segmentPaths.length) {
      throw new Error('AivisSpeech 用の発話データがありません。');
    }

    concatWavFiles(segmentPaths, wavPath);
    for (const segmentPath of segmentPaths) {
      try { fs.unlinkSync(segmentPath); } catch (_) {}
    }
    log(`WAV出力: ${wavPath}`);

    const mp3Path = maybeEncodeMp3(wavPath, outBaseNoExt);
    return { wavPath, mp3Path };
  } finally {
    for (const filePath of cleanupPaths) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
}

// ----------------------------- 音声生成 (OpenAI TTS / macOS say) -----------------------------
async function synthesizePodcast(openai, dialogue, outBaseNoExt) {
  if (usesAivisTts()) {
    return synthesizePodcastWithAivis(dialogue, outBaseNoExt);
  }
  if (!usesOpenAITts()) {
    return synthesizePodcastWithSay(dialogue, outBaseNoExt);
  }

  // 各発話をPCM(24kHz/mono/16bit)で生成して結合 → WAV。ffmpegがあればmp3も作る。
  const SAMPLE_RATE = 24000;
  const pcmChunks = [];

  // tts-1 系は speed パラメータに対応。gpt-4o 系(gpt-4o-mini-tts等)は非対応なので、
  // その場合は等速で合成し、後段の ffmpeg(atempo) で再生速度を変更する。
  const apiSpeedSupported = /^tts-1/.test(TTS_MODEL);

  for (let i = 0; i < dialogue.length; i++) {
    const turn = dialogue[i];
    const voice = turn.speaker === 'B' ? TTS_VOICE_B : TTS_VOICE_A;
    const text = String(turn.text || '').trim();
    if (!text) continue;

    const params = {
      model: TTS_MODEL,
      voice,
      input: text,
      response_format: 'pcm',
    };
    if (apiSpeedSupported && PODCAST_SPEED !== 1) params.speed = PODCAST_SPEED;

    const resp = await openai.audio.speech.create(params);
    const buf = Buffer.from(await resp.arrayBuffer());
    pcmChunks.push(buf);
    // 発話間に短い無音(150ms)を挿入
    pcmChunks.push(Buffer.alloc(Math.round(SAMPLE_RATE * 0.15) * 2));
    if ((i + 1) % 10 === 0) log(`  TTS進捗: ${i + 1}/${dialogue.length}`);
  }

  const pcm = Buffer.concat(pcmChunks);
  const wavPath = `${outBaseNoExt}.wav`;
  fs.writeFileSync(wavPath, wavFromPcm(pcm, SAMPLE_RATE, 1, 16));
  log(`WAV出力: ${wavPath} (${(pcm.length / 1024 / 1024).toFixed(1)}MB)`);

  // ffmpegで再生速度変更(必要時)とmp3化。
  const needTempo = !apiSpeedSupported && PODCAST_SPEED !== 1;
  const filterArgs = needTempo ? ['-filter:a', `atempo=${PODCAST_SPEED}`] : [];

  // 速度変更が必要ならWAVも上書きで作り直す(ピッチ保持)。
  if (needTempo) {
    const tmp = `${outBaseNoExt}.tmp.wav`;
    const r = spawnSync('ffmpeg', ['-y', '-i', wavPath, ...filterArgs, tmp], { stdio: 'ignore' });
    if (r.status === 0) {
      fs.renameSync(tmp, wavPath);
      log(`再生速度を ${PODCAST_SPEED}x に調整(ffmpeg atempo)`);
    } else {
      try { fs.unlinkSync(tmp); } catch (_) {}
      log(`警告: ffmpeg未検出のため速度変更を適用できませんでした(等速のまま)。brew install ffmpeg を推奨。`);
    }
  }

  const mp3Path = maybeEncodeMp3(wavPath, outBaseNoExt);
  return { wavPath, mp3Path };
}

/** PCMバッファにWAVヘッダを付与 */
function wavFromPcm(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function writeBriefArtifacts(outDir, summaryMarkdown, podcastDialogue) {
  const mdPath = path.join(outDir, 'brief.md');
  fs.writeFileSync(mdPath, summaryMarkdown);
  fs.writeFileSync(
    path.join(outDir, 'dialogue.json'),
    JSON.stringify(podcastDialogue, null, 2)
  );
  const scriptTxt = podcastDialogue
    .map((turn) => `${turn.speaker === 'B' ? '専門役' : '進行役'}: ${turn.text}`)
    .join('\n\n');
  fs.writeFileSync(path.join(outDir, 'podcast-script.txt'), scriptTxt);
  return { mdPath, scriptTxt };
}

function removeExistingAudioArtifacts(outDir) {
  for (const name of ['podcast.mp3', 'podcast.wav']) {
    const filePath = path.join(outDir, name);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
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
    removeExistingAudioArtifacts(outDir);
    if (usesOpenAITts() && !process.env.OPENAI_API_KEY) {
      throw new Error("環境変数 'OPENAI_API_KEY' が設定されていません。");
    }
    const openai = usesOpenAITts()
      ? new (require('openai'))({ apiKey: process.env.OPENAI_API_KEY })
      : null;
    log(
      usesOpenAITts()
        ? `音声生成中 (engine=openai, model=${TTS_MODEL}, voices=${TTS_VOICE_A}/${TTS_VOICE_B}, speed=${PODCAST_SPEED}) ...`
        : usesAivisTts()
          ? `音声生成中 (engine=aivis, styles=${AIVIS_STYLE_ID_A}/${AIVIS_STYLE_ID_B}, speed=${PODCAST_SPEED}) ...`
          : `音声生成中 (engine=say, voices=${SAY_VOICE_A}/${SAY_VOICE_B}, rate=${Math.max(120, Math.min(360, Math.round(175 * PODCAST_SPEED)))}) ...`
    );
    const synthesized = await synthesizePodcast(openai, dialogue, path.join(outDir, 'podcast'));
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
  result.audioStoragePath = await uploadPodcastAndPrune(result.ymd, result.audioFile);
  log('Firestore 保存中...');
  await saveBriefToFirestore(result);
  log('完了。');
  return result;
}

// ----------------------------- 実行本体(関数) -----------------------------
/**
 * 指定条件でブリーフ+音声を生成する。CLIとミニアプリ(server.js)の両方から呼ぶ。
 * @param {{date?:string, sample?:boolean, noAudio?:boolean}} opts
 * @returns {Promise<object>} 生成結果のメタ情報
 */
async function run(opts = {}) {
  const needsOpenAI = usesOpenAITts()
    || providerForModel(PODCAST_MODEL) === 'openai'
    || (PODCAST_FALLBACK_MODEL && providerForModel(PODCAST_FALLBACK_MODEL) === 'openai');
  if (needsOpenAI && !process.env.OPENAI_API_KEY) {
    throw new Error("環境変数 'OPENAI_API_KEY' が設定されていません。");
  }
  const OpenAI = needsOpenAI ? require('openai') : null;
  const openai = needsOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

  const inputs = await collectGenerationInputs(opts);
  log(`対象日(JST): ${inputs.ymd}`);
  if (opts.sample) {
    log('sample: 擬似データを使用');
  }
  log(`予約件数: ${inputs.count}`);

  const outDir = path.join(OUTPUT_DIR, inputs.ymd);
  fs.mkdirSync(outDir, { recursive: true });

  if (inputs.count === 0) {
    const md = `# ${inputs.ymd} の予約ブリーフ\n\n対象日の予約はありません。`;
    const mdPath = path.join(outDir, 'brief.md');
    fs.writeFileSync(mdPath, md);
    log('予約なし。テキストのみ出力して終了。');
    const result = { ymd: inputs.ymd, count: 0, outDir, mdPath, summaryMarkdown: md, audioFile: null };
    await saveBriefToFirestore(result);
    return result;
  }

  log(`台本生成中 (provider=${providerForModel(PODCAST_MODEL)}, model=${PODCAST_MODEL}) ...`);
  const brief = await generateBrief(openai, inputs.appointments, inputs.ymd);

  // テキスト保存
  const { mdPath } = writeBriefArtifacts(outDir, brief.summaryMarkdown, brief.podcastDialogue);
  log(`テキスト出力: ${mdPath}`);

  // 音声保存
  let audioFile = null;
  if (opts.noAudio) {
    log('noAudio: 音声生成をスキップ');
  } else {
    removeExistingAudioArtifacts(outDir);
    log(
      usesOpenAITts()
        ? `音声生成中 (engine=openai, model=${TTS_MODEL}, voices=${TTS_VOICE_A}/${TTS_VOICE_B}, speed=${PODCAST_SPEED}) ...`
        : usesAivisTts()
          ? `音声生成中 (engine=aivis, styles=${AIVIS_STYLE_ID_A}/${AIVIS_STYLE_ID_B}, speed=${PODCAST_SPEED}) ...`
          : `音声生成中 (engine=say, voices=${SAY_VOICE_A}/${SAY_VOICE_B}, rate=${Math.max(120, Math.min(360, Math.round(175 * PODCAST_SPEED)))}) ...`
    );
    const res = await synthesizePodcast(openai, brief.podcastDialogue, path.join(outDir, 'podcast'));
    audioFile = res.mp3Path || res.wavPath;
  }

  const result = {
    ymd: inputs.ymd,
    count: inputs.count,
    outDir,
    mdPath,
    summaryMarkdown: brief.summaryMarkdown,
    audioFile, // 絶対パス(.mp3 優先、無ければ .wav)
  };
  result.audioStoragePath = await uploadPodcastAndPrune(result.ymd, result.audioFile);
  log('Firestore 保存中...');
  await saveBriefToFirestore(result);
  log('完了。');
  return result;
}

module.exports = {
  run,
  getExistingBriefResult,
  saveBriefToFirestore,
  syncLatestPodcastAudio,
  collectGenerationInputs,
  getScheduledSummaryContext,
  finalizeManualImport,
};

// ----------------------------- CLI -----------------------------
if (require.main === module) {
  (async () => {
    if (flags.dumpPrompt) {
      const payload = await collectGenerationInputs({ date: flags.date, sample: flags.sample });
      process.stdout.write(JSON.stringify(payload, null, 2));
      return;
    }

    if (flags.scheduledContext) {
      const result = await getScheduledSummaryContext();
      process.stdout.write(JSON.stringify(result, null, 2));
      return;
    }

    if (flags.finalizeManual || flags.finalizePrepared) {
      const result = await finalizeManualImport({ date: flags.date, noAudio: flags.noAudio });
      process.stdout.write(JSON.stringify({
        ymd: result.ymd,
        count: result.count,
        summaryMarkdown: result.summaryMarkdown,
        audioFile: result.audioFile,
      }, null, 2));
      return;
    }

    if (flags.syncAudio) {
      const result = await syncLatestPodcastAudio();
      process.stdout.write(JSON.stringify(result, null, 2));
      return;
    }

    const result = await run({ date: flags.date, sample: flags.sample, noAudio: flags.noAudio });
    process.stdout.write(JSON.stringify({
      ymd: result.ymd,
      count: result.count,
      summaryMarkdown: result.summaryMarkdown,
      audioFile: result.audioFile,
    }, null, 2));
  })().catch((err) => {
    console.error('エラー:', err.stack || err.message || err);
    process.exit(1);
  });
}
