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

// ▼▼▼ onSnapshotからget()に変更してテスト ▼▼▼
db.collection("appointments")
  .orderBy("appointmentDateTime", "desc")
  .get()
  .then(querySnapshot => {
      console.log("Firestoreからのデータ取得に成功！");
      tableBody.innerHTML = ""; // テーブルを一旦空にする
      if (querySnapshot.empty) {
        console.log("データは空でした。");
        return;
      }
      querySnapshot.forEach(doc => {
          const data = doc.data();
          const date = data.appointmentDateTime.toDate().toLocaleString('ja-JP');
          const row = `
              <tr>
                  <td>${date}</td>
                  <td>${data.claimantName || ''}</td>
                  <td>${data.contractNumber || ''}</td>
                  <td>${data.japanCellPhone || ''}</td>
                  <td>${(data.services || []).join(', ')}</td>
              </tr>
          `;
          tableBody.innerHTML += row;
      });
  })
  .catch(error => {
      console.error("Firestoreからのデータ取得でエラーが発生しました:", error);
  });
// ▲▲▲ onSnapshotからget()に変更してテスト ▲▲▲


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

    const fileName = `${new Date().getTime()}_${file.name}`;
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