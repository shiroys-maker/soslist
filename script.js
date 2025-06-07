// ▼▼▼ ここにFirebaseプロジェクトの設定情報を貼り付け ▼▼▼
const firebaseConfig = {
  apiKey: "AIzaSyCR9lTDkTFXbhbRsAmPDb8HAUfLxYiIrDI",
  authDomain: "sos-list.firebaseapp.com",
  projectId: "sos-list",
  storageBucket: "sos-list.firebasestorage.app",
  messagingSenderId: "805971348088",
  appId: "1:805971348088:web:629ff907765dc65582fb8d"
};
// ▲▲▲ ここまで ▲▲▲

// Firebaseの初期化
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

// --- データ表示機能 ---
const tableBody = document.querySelector("#appointmentsTable tbody");

// Firestoreの'appointments'コレクションを監視
db.collection("appointments")
  .orderBy("appointmentDateTime", "desc") // appointmentDateTimeで降順ソート
  .onSnapshot(snapshot => {
      tableBody.innerHTML = ""; // テーブルを一旦空にする
      snapshot.forEach(doc => {
          const data = doc.data();

          // 日付を読みやすい形式にフォーマット
          const date = data.appointmentDateTime.toDate().toLocaleString('ja-JP');

          const row = `
              <tr>
                  <td><span class="math-inline">\{date\}</td\>
                  <td>{data.claimantName || ''}</td>
<td>data.contractNumber∣∣ 
′′
 </td><td>{data.japanCellPhone || ''}</td>
<td>${(data.services || []).join(', ')}</td>
</tr>
`;
tableBody.innerHTML += row;
});
});
// --- PDFアップロード機能 ---
const uploader = document.getElementById('pdfUploader');
const uploadButton = document.getElementById('uploadButton');
const uploadStatus = document.getElementById('uploadStatus');

uploadButton.addEventListener('click', () => {
    const file = uploader.files[0];
    if (!file) {
        uploadStatus.textContent = 'ファイルが選択されていません。';
        return;
    }

    // ファイル名にタイムスタンプを付けて一意にする
    const fileName = `<span class="math-inline">\{new Date\(\)\.getTime\(\)\}\_</span>{file.name}`;
    const storageRef = storage.ref(`uploads/${fileName}`);

    const task = storageRef.put(file);
    uploadStatus.textContent = 'アップロード中...';

    task.on('state_changed', 
        (snapshot) => { /* 進捗表示（必要なら実装） */ }, 
        (error) => { 
            console.error(error);
            uploadStatus.textContent = `アップロード失敗: ${error.message}`;
        }, 
        () => { 
            uploadStatus.textContent = 'アップロード完了！バックエンドで処理中です。';
            uploader.value = ''; // ファイル選択をリセット
        }
    );
});
```

