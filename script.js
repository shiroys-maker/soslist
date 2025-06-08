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
const loginContainer = document.getElementById('login-container');
const mainAppContainer = document.getElementById('main-app-container');
// ... (他の要素取得は省略、変更なし) ...
const tableBody = document.querySelector("#appointmentsTable tbody");
const dateFilter = document.getElementById('dateFilter');
// ... (他の要素取得は省略、変更なし) ...
const editModal = document.getElementById('editModal');
const dateSelect = document.getElementById('dateSelect');
const timeSelect = document.getElementById('timeSelect');
const confirmEditBtn = document.getElementById('confirmEdit');
const cancelEditBtn = document.getElementById('cancelEdit');

let logoutTimer;
let editingDocId = null; 

// --- ログイン状態の監視 ---
auth.onAuthStateChanged(user => {
    if (user) {
        // ... (変更なし) ...
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
// ... (変更なし) ...
loginButton.addEventListener('click', () => { /* ... */ });
logoutButton.addEventListener('click', () => { auth.signOut(); });
dateFilter.addEventListener('change', () => { setupRealtimeListener(); });
uploadButton.addEventListener('click', () => { /* ... */ });


// --- Firestoreのリアルタイム監視 ---
function setupRealtimeListener() {
    // ... (変更なし) ...
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
              // 日付セルに 'date-cell' クラスを付与
              tableRowsHTML += `<tr data-id="${doc.id}">
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
          });
          tableBody.innerHTML = tableRowsHTML;
      }, error => {
          console.error("Firestoreのリアルタイム監視でエラー:", error);
      });
}

// --- 自動ログアウトタイマー (変更なし) ---
function startLogoutTimer() { /* ... */ }

// --- テーブルのボタン処理 ---
// ▼▼▼ クリック処理をより確実な方法に修正 ▼▼▼
tableBody.addEventListener('click', (e) => {
    const target = e.target;
    // クリックされた要素から最も近い <tr> を探す
    const tr = target.closest('tr');
    if (!tr) return; // <tr> の外側がクリックされた場合は何もしない

    const docId = tr.dataset.id;
    if (!docId) return; // IDがない場合は何もしない

    // 日付セル（またはその中身）がクリックされたか判定
    // .closest('.date-cell') は、クリックされた要素自身か、その親をたどって .date-cell を見つける
    if (target.closest('.date-cell')) {
        openEditModal(docId);
        return; // 日付セルがクリックされたら、他の処理はしない
    }
    
    // PDF表示ボタンが押された場合
    if (target.classList.contains('view-pdf-btn')) {
        handleViewPdf(docId);
    }

    // 削除ボタンが押された場合
    if (target.classList.contains('delete-btn')) {
        if (confirm('このデータを本当に削除しますか？')) {
            db.collection('appointments').doc(docId).delete().then(() => console.log('削除成功')).catch(error => console.error('削除エラー:', error));
        }
    }
});
// ▲▲▲ クリック処理をより確実な方法に修正 ▲▲▲


// --- PDF表示用の新しい関数を追加 ---
function handleViewPdf(docId) { /* ... (変更なし) ... */ }

// --- 編集モーダル関連の関数 ---
// (変更なし)
function openEditModal(docId) { /* ... */ }
confirmEditBtn.addEventListener('click', () => { /* ... */ });
cancelEditBtn.addEventListener('click', () => { editModal.style.display = 'none'; });

// 省略した関数の内容をペーストしてください
// loginButton, logoutButton, uploadButton, startLogoutTimer, handleViewPdf, openEditModal, confirmEditBtn