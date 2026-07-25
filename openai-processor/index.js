const chokidar = require('chokidar');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs').promises;
const admin = require('firebase-admin');
const OpenAI = require('openai');
const pdf = require("pdf-parse");

// --- .env 読み込み（openai-processor/.env → daily-brief/.env の順、既存の環境変数を優先） ---
const DAILY_BRIEF_DIR = path.join(__dirname, '..', 'daily-brief');

function loadDotEnv(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const content = fsSync.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

loadDotEnv(path.join(__dirname, '.env'));
loadDotEnv(path.join(DAILY_BRIEF_DIR, '.env'));

// --- 設定項目 ---
const WATCH_FOLDER = process.env.SOSPDF_WATCH_FOLDER ||
    path.join(os.homedir(), 'Library/CloudStorage/Dropbox/VA/SOSPDF');
const BUCKET_NAME = 'sos-list-4d150.firebasestorage.app';
const API_KEY = process.env.OPENAI_API_KEY;
// 抽出やアップロードに失敗したファイルの記録先（dead-letter）
const FAILED_LOG = path.join(__dirname, 'failed.log');
const MAX_ATTEMPTS = 3;
// --- 設定項目ここまで ---

if (!API_KEY) {
  console.error("エラー: 環境変数 'OPENAI_API_KEY' が設定されていません（openai-processor/.env でも指定可）。");
  process.exit(1);
}

// Firebase Admin SDKを初期化（GOOGLE_APPLICATION_CREDENTIALS があれば ~ を展開して使用）
const gac = expandHome(process.env.GOOGLE_APPLICATION_CREDENTIALS);
if (gac) {
  if (fsSync.existsSync(path.resolve(gac))) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(gac);
  } else {
    console.warn(`GOOGLE_APPLICATION_CREDENTIALS のファイルが見つかりません: ${gac}`);
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}
admin.initializeApp({
  storageBucket: BUCKET_NAME,
});

// OpenAI SDKを初期化
const openai = new OpenAI({ apiKey: API_KEY });

const db = admin.firestore();
const bucket = admin.storage().bucket(); // Use firebase-admin for storage

console.log(`フォルダを監視中: ${WATCH_FOLDER}`);

const watcher = chokidar.watch(WATCH_FOLDER, {
    ignored: /^\./,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
    }
});

// 指数バックオフ付きリトライ（1s → 2s → 4s）
async function withRetry(label, fn) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < MAX_ATTEMPTS) {
                const delayMs = 1000 * 2 ** (attempt - 1);
                console.warn(`${label} 失敗 (${attempt}/${MAX_ATTEMPTS})、${delayMs}ms後に再試行: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    throw lastError;
}

// 最終的に処理できなかったファイルをJSON行で記録し、後から再処理できるようにする
async function recordFailure(filePath, eventType, error) {
    const entry = {
        at: new Date().toISOString(),
        file: filePath,
        event: eventType,
        error: error.message,
    };
    try {
        await fs.appendFile(FAILED_LOG, JSON.stringify(entry) + '\n');
    } catch (logError) {
        console.error('failed.log への書き込みに失敗:', logError);
    }
}

function validateExtractedData(extracted, filePath) {
    const problems = [];
    if (!extracted.claimantName) problems.push('claimantName が空');
    if (!extracted.contractNumber) problems.push('contractNumber が空');
    if (!extracted.appointmentDate) problems.push('appointmentDate が空');
    if (problems.length > 0) {
        throw new Error(`抽出結果が不完全 (${problems.join(', ')}): ${filePath}`);
    }
}

async function extractAppointmentData(filePath, destination) {
    const fileBuffer = await fs.readFile(filePath);
    const data = await pdf(fileBuffer);
    const pdfText = data.text;

    // スキャン画像のみのPDF等はテキストが空になる。APIを呼ばずに失敗として記録する
    if (!pdfText || pdfText.trim().length === 0) {
        throw new Error(`PDFからテキストを抽出できません（スキャン画像のみ？）: ${filePath}`);
    }

    const prompt = `
          以下のテキストは医療サービスの請求書PDFから抽出したものです。
          この内容を解析し、以下のキーを持つJSON形式で情報を抽出してください。
          - claimantName: 受験者名 (例: "JONES, JONATHAN")
          - contractNumber: 契約番号 (例: "5880596.7.1")
          - appointmentDate: 予約日時 (例: "06/23/2025 at 01:30 PM JST")。タイムゾーンはJSTです。
            この日付を、JavaScriptのnew Date()で解釈可能なISO 8601形式（YYYY-MM-DDTHH:mm:ss）に変換してください。
          - japanCellPhones: テキスト内にある日本の携帯電話番号（070, 080, 090,
            +81で始まる番号）を全て抽出した配列
            (例: ["+818099881178", "09012345678"])
          - dateOfBirth: 誕生日 (例: "09/16/1997")
          - cptCode: CPTCODEの配列 (例: ["92557", "VA004"])
          - services: 検査内容の配列 (例: ["CBC", "Focused Requiring 1-5 DBQs"])

          抽出するテキスト:
          ---
          ${pdfText}
          ---
      `;

    const completion = await withRetry('OpenAI抽出', () => openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    }));

    const responseText = completion.choices[0].message.content;
    const extractedData = JSON.parse(responseText);
    validateExtractedData(extractedData, filePath);

    const excludedPhoneNumbers = ["+819045242828", "09045242828"];
    const validPhoneNumbers = (extractedData.japanCellPhones || []).filter(
        (phone) => !excludedPhoneNumbers.includes(phone),
    );
    const finalPhoneNumber = validPhoneNumbers.length > 0 ?
      validPhoneNumbers[0] :
      null;

    // Ensure the date string is treated as JST
    let dateString = extractedData.appointmentDate;
    if (dateString && !dateString.includes('Z') && !dateString.match(/[+-]\d{2}:\d{2}$/)) {
        dateString += "+09:00";
    }

    const appointmentDateTime = new Date(dateString);
    if (Number.isNaN(appointmentDateTime.getTime())) {
        throw new Error(`appointmentDate を日付として解釈できません: "${extractedData.appointmentDate}" (${filePath})`);
    }

    return {
      ...extractedData,
      japanCellPhone: finalPhoneNumber,
      appointmentDateTime,
      originalFileName: destination,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}

async function uploadAndVerify(filePath, destination) {
    await withRetry('Storageアップロード', () => bucket.upload(filePath, {
        destination,
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'no-store, max-age=0',
          metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() },
        },
    }));

    const [uploaded] = await bucket.file(destination).exists();
    if (!uploaded) {
        throw new Error(`Cloud Storage upload verification failed: ${destination}`);
    }
}

async function processPdf(filePath, eventType) {
    if (path.extname(filePath).toLowerCase() !== '.pdf') {
        console.log(`PDFではないためスキップ: ${filePath}`);
        return;
    }

    const isChange = eventType === 'change';
    console.log(isChange ? `更新されたPDFを発見: ${filePath}` : `新しいファイルを発見: ${filePath}`);

    try {
        const destination = `uploads/${path.basename(filePath)}`;
        const existingSnapshot = await db.collection("appointments")
          .where("originalFileName", "==", destination)
          .get();

        if (!existingSnapshot.empty && !isChange) {
            const [existsInStorage] = await bucket.file(destination).exists();
            if (!existsInStorage) {
                await uploadAndVerify(filePath, destination);
                console.log(`既存FirestoreレコードのPDFをCloud Storageへ補充: ${destination}`);
            } else {
                console.log(`既存レコードとPDFがあるためスキップ: ${destination}`);
            }
            return;
        }

        if (!existingSnapshot.empty && isChange) {
            await uploadAndVerify(filePath, destination);
            console.log(`Cloud StorageのPDF更新成功: ${filePath}`);

            const batch = db.batch();
            existingSnapshot.docs.forEach((doc) => {
                batch.update(doc.ref, {
                    pdfUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            });
            await batch.commit();
            console.log(`FirestoreのPDF更新日時を反映: ${filePath} (${existingSnapshot.size}件)`);
            return;
        }

        const firestoreData = await extractAppointmentData(filePath, destination);

        await uploadAndVerify(filePath, destination);
        console.log(`Cloud Storageへのアップロード成功: ${filePath}`);

        await db.collection("appointments").add(firestoreData);
        console.log(`Firestoreへのデータ追加成功: ${filePath}`);

    } catch (error) {
        console.error(`処理中にエラーが発生しました: ${filePath}`, error);
        await recordFailure(filePath, eventType, error);
    }
}

watcher.on('add', (filePath) => processPdf(filePath, 'add'));
watcher.on('change', (filePath) => processPdf(filePath, 'change'));
watcher.on('error', (error) => console.error('watcherエラー:', error));

process.on('unhandledRejection', (reason) => {
    console.error('未処理のPromise拒否:', reason);
});
