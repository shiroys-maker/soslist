const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs').promises;
const admin = require('firebase-admin');
const OpenAI = require('openai');
const pdf = require("pdf-parse");

// --- 設定項目 ---
// ★★★ あなたが監視したいフォルダのパスに変更してください ★★★
const WATCH_FOLDER = process.env.SOSPDF_WATCH_FOLDER || '/Users/shungohiroyasu/Library/CloudStorage/Dropbox/VA/SOSPDF';
// ★★★ FirebaseプロジェクトのデフォルトStorageバケット名 ★★★
const BUCKET_NAME = 'sos-list-4d150.firebasestorage.app';
// ★★★ OpenAI APIキーを環境変数から読み込み ★★★
const API_KEY = process.env.OPENAI_API_KEY;
// --- 設定項目ここまで ---

if (!API_KEY) {
  console.error("エラー: 環境変数 'OPENAI_API_KEY' が設定されていません。");
  process.exit(1);
}

// Firebase Admin SDKを初期化
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

async function extractAppointmentData(filePath, destination) {
    const fileBuffer = await fs.readFile(filePath);
    const data = await pdf(fileBuffer);
    const pdfText = data.text;

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

    const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0].message.content;
    const extractedData = JSON.parse(responseText);

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

    return {
      ...extractedData,
      japanCellPhone: finalPhoneNumber,
      appointmentDateTime: new Date(dateString),
      originalFileName: destination,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}

async function uploadAndVerify(filePath, destination) {
    await bucket.upload(filePath, {
        destination,
        metadata: { contentType: 'application/pdf' },
    });

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

        const firestoreData = await extractAppointmentData(filePath, destination);

        await uploadAndVerify(filePath, destination);
        console.log(`Cloud Storageへのアップロード成功: ${filePath}`);

        if (existingSnapshot.empty) {
            await db.collection("appointments").add(firestoreData);
            console.log(`Firestoreへのデータ追加成功: ${filePath}`);
            return;
        }

        const batch = db.batch();
        existingSnapshot.docs.forEach((doc) => {
            batch.update(doc.ref, {
                ...firestoreData,
                pdfUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
        await batch.commit();
        console.log(`Firestoreの既存データ更新成功: ${filePath} (${existingSnapshot.size}件)`);

    } catch (error) {
        console.error(`処理中にエラーが発生しました: ${filePath}`, error);
    }
}

watcher.on('add', (filePath) => processPdf(filePath, 'add'));
watcher.on('change', (filePath) => processPdf(filePath, 'change'));
