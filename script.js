// ▼▼▼ Firebaseプロジェクトの設定情報 ▼▼▼
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
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// --- DOM要素の取得 ---
// ... (変更なし) ...
const loginContainer = document.getElementById('login-container');
const mainAppContainer = document.getElementById('main-app-container');
const loginButton = document.getElementById('loginButton');
const logoutButton = document.getElementById('logoutButton');
const loginEmailInput = document.getElementById('loginEmail');
const loginPasswordInput = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');
const userEmailSpan = document.getElementById('userEmail');
const tableBody = document.querySelector("#appointmentsTable tbody");
const uploader = document.getElementById('pdfUploader');
const uploadButton = document.getElementById('uploadButton');
const uploadStatus = document.getElementById('uploadStatus');
const dateFilter = document.getElementById('dateFilter');
const editModal = document.getElementById('editModal');
const dateSelect = document.getElementById('dateSelect');
const timeSelect = document.getElementById('timeSelect');
const confirmEditBtn = document.getElementById('confirmEdit');
const cancelEditBtn = document.getElementById('cancelEdit');

let logoutTimer;
let editingDocId = null;

// --- ログイン状態の監視 ---
auth.onAuthStateChanged(user => {
    // ... (変更なし) ...
    if (user) {
        loginContainer.style.display = 'none';
        mainAppContainer.style.display = 'block';
        userEmailSpan.textContent = user.email;
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        dateFilter.value = `${year}-${month}-${day}`;
        setupRealtimeListener();
        startLogoutTimer();
    } else {
        loginContainer.style.display = 'block';
        mainAppContainer.style.display = 'none';
        clearTimeout(logoutTimer);
    }
});

// --- イベントリスナー ---
// ... (ログイン、ログアウト、アップロード、日付フィルターのリスナーは変更なし) ...
loginButton.addEventListener('click', () => { /* ... */ });
logoutButton.addEventListener('click', () => { auth.signOut(); });
dateFilter.addEventListener('change', () => { setupRealtimeListener(); });
uploadButton.addEventListener('click', () => { /* ... */ });


// --- Firestoreのリアルタイム監視 ---
function setupRealtimeListener() {
    const localDateStr = dateFilter.value;
    if (!localDateStr) return;
    const filterDate = new Date(`${localDateStr}T00:00:00`);
    
    db.collection("appointments")
      .where("appointmentDateTime", ">=", filterDate)
      .orderBy("appointmentDateTime", "asc")
      .onSnapshot(querySnapshot => {
          let tableRowsHTML = "";
          querySnapshot.forEach(doc => {
              const data = doc.data();
              let displayDate = '日付なし';
              if (data.appointmentDate) {
                  const dateObj = new Date(data.appointmentDate);
                  displayDate = dateObj.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
              }

              // ▼▼▼ 行のHTML生成を修正 ▼▼▼
              tableRowsHTML += `
                  <tr data-id="${doc.id}">
                      <td class="date-cell">${displayDate}</td>
                      <td>${data.claimantName || ''}</td>
                      <td>${data.contractNumber || ''}</td>
                      <td>${data.japanCellPhone || ''}</td>
                      <td>${(data.services || []).join(', ')}</td>
                      <td>
                          <button class="view-pdf-btn">PDF表示</button>
                          <button class="delete-btn">削除</button>
                      </td>
                  </tr>`;
              // ▲▲▲ 行のHTML生成を修正 ▲▲▲
          });
          tableBody.innerHTML = tableRowsHTML;
      }, error => {
          console.error("Firestoreのリアルタイム監視でエラー:", error);
      });
}

// --- 自動ログアウトタイマー (変更なし) ---
function startLogoutTimer() { /* ... */ }

// --- テーブルのボタン処理 ---
// ▼▼▼ クリック処理を修正 ▼▼▼
tableBody.addEventListener('click', (e) => {
    const target = e.target;
    const tr = target.closest('tr');
    if (!tr) return;
    const docId = tr.dataset.id;
    if (!docId) return;

    // 日付セル（またはその中身）がクリックされた場合
    if (target.matches('.date-cell, .date-cell *')) {
        openEditModal(docId);
    }
    // 削除ボタンが押された場合
    if (target.classList.contains('delete-btn')) {
        if (confirm('このデータを本当に削除しますか？')) {
            db.collection('appointments').doc(docId).delete().then(() => console.log('削除成功')).catch(error => console.error('削除エラー:', error));
        }
    }
    // PDF表示ボタンが押された場合
    if (target.classList.contains('view-pdf-btn')) {
        handleViewPdf(docId);
    }
});
// ▲▲▲ クリック処理を修正 ▲▲▲


// ▼▼▼ PDF表示用の新しい関数を追加 ▼▼▼
function handleViewPdf(docId) {
    const docRef = db.collection('appointments').doc(docId);
    docRef.get().then(doc => {
        if (!doc.exists) {
            alert('データベースにレコードが見つかりません。');
            return;
        }
        const data = doc.data();
        const fileName = data.originalFileName;

        if (!fileName) {
            alert('このレコードにPDFファイルは関連付けられていません。');
            return;
        }

        // Cloud StorageからダウンロードURLを取得
        const storageRef = storage.ref(fileName);
        storageRef.getDownloadURL()
            .then(url => {
                // 新しいタブでPDFを開く
                window.open(url, '_blank');
            })
            .catch(error => {
                if (error.code === 'storage/object-not-found') {
                    alert('PDFファイルがストレージに見つかりません。古いレコードのため削除された可能性があります。');
                } else {
                    console.error("PDF取得エラー:", error);
                    alert('PDFの表示中にエラーが発生しました。');
                }
            });
    });
}
// ▲▲▲ PDF表示用の新しい関数を追加 ▲▲▲


// --- 編集モーダル関連の関数 ---
// (変更なし)
function openEditModal(docId) { /* ... */ }
confirmEditBtn.addEventListener('click', () => { /* ... */ });
cancelEditBtn.addEventListener('click', () => { editModal.style.display = 'none'; });

// 省略した関数の内容をペーストしてください
// loginButton, logoutButton, uploadButton, startLogoutTimer, openEditModal, confirmEditBtn