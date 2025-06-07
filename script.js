// ▼▼▼ ここにFirebaseプロジェクトの設定情報を貼り付け ▼▼▼
const firebaseConfig = {
  apiKey: "AIzaSyBIkxaIgnjkrOYfx3oyA0BGX5dubL5QhvI",
  authDomain: "sos-list-4d150.firebaseapp.com",
  projectId: "sos-list-4d150",
  storageBucket: "sos-list-4d150.firebasestorage.app",
  messagingSenderId: "455081821929",
  appId: "1:455081821929:web:da87d8dd1f16bbe99e9278",
  measurementId: "G-H3GQ56JJD8"
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
          
          // ▼▼▼ 文字列の構文を修正 ▼▼▼
          const row = `
              <tr>
                  <td>${date}</td>
                  <td>${data.claimantName || ''}</td>
                  <td>${data.contractNumber || ''}</td>
                  <td>${data.japanCellPhone || ''}</td>
                  <td>${(data.services || []).join(', ')}</td>
              </tr>
          `;
          // ▲▲▲ 文字列の構文を修正 ▲▲▲
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

    // ▼▼▼ ファイル名の文字列構文を修正 ▼▼▼
    const fileName = `${new Date().getTime()}_${file.name}`;
    // ▲▲▲ ファイル名の文字列構文を修正 ▲▲▲
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