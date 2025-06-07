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

// --- イベントリスナー (変更なし) ---
loginButton.addEventListener('click', () => { /* ... */ });
logoutButton.addEventListener('click', () => { auth.signOut(); });
dateFilter.addEventListener('change', () => { setupRealtimeListener(); });
uploadButton.addEventListener('click', () => { /* ... */ });
tableBody.addEventListener('click', (e) => { /* ... */ });
cancelEditBtn.addEventListener('click', () => { editModal.style.display = 'none'; });

// --- Firestoreのリアルタイム監視 ---
function setupRealtimeListener() {
    const localDateStr = dateFilter.value;
    if (!localDateStr) return;

    const filterDate = new Date(`${localDateStr}T00:00:00`);
    
    db.collection("appointments")
      .where("appointmentDateTime", ">=", filterDate)
      .orderBy("appointmentDateTime", "asc")
      .onSnapshot(querySnapshot => {
          tableBody.innerHTML = "";
          querySnapshot.forEach(doc => {
              const data = doc.data();
              
              let displayDate = '日付なし';
              // ▼▼▼ 表示には `appointmentDate` (文字列) を「正」として使用 ▼▼▼
              if (data.appointmentDate) {
                  // JSTの文字列からDateオブジェクトを生成すると、ブラウザがJSTとして解釈する
                  const dateObj = new Date(data.appointmentDate);
                  displayDate = dateObj.toLocaleString('ja-JP', {
                      year: 'numeric', month: 'numeric', day: 'numeric',
                      hour: '2-digit', minute: '2-digit', second: '2-digit',
                      hour12: false
                  });
              }

              const row = `<tr data-id="${doc.id}"><td>${displayDate}</td><td>${data.claimantName || ''}</td><td>${data.contractNumber || ''}</td><td>${data.japanCellPhone || ''}</td><td>${(data.services || []).join(', ')}</td><td><button class="edit-btn">編集</button><button class="delete-btn">削除</button></td></tr>`;
              tableBody.innerHTML += row;
          });
      }, error => {
          console.error("Firestoreのリアルタイム監視でエラー:", error);
      });
}

// --- 自動ログアウトタイマー (変更なし) ---
function startLogoutTimer() { /* ... */ }

// --- 編集モーダル関連の関数 ---
function openEditModal(docId) {
  const docRef = db.collection('appointments').doc(docId);
  docRef.get().then(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    
    // ▼▼▼ モーダルの初期値も `appointmentDate` (文字列) を元に設定 ▼▼▼
    const dateTimeString = data.appointmentDate; // 例: "2025-06-19T13:30:00"
    if (dateTimeString && dateTimeString.includes('T')) {
      dateSelect.value = dateTimeString.split('T')[0];
      timeSelect.value = dateTimeString.split('T')[1].substr(0, 5);
    }
    
    editingDocId = docId;
    editModal.style.display = 'flex';
  });
}

confirmEditBtn.addEventListener('click', () => {
  if (!dateSelect.value || !timeSelect.value || !editingDocId) return;

  const jstDateTimeStr = `${dateSelect.value}T${timeSelect.value}:00`;

  // ▼▼▼ Cloud Functionの動作を再現し、両方のフィールドを更新 ▼▼▼
  // 1. 文字列フィールド用のデータ
  const appointmentDateString = jstDateTimeStr;

  // 2. タイムスタンプフィールド用のデータ（UTCとして解釈させるため'Z'を付与）
  const dateForTimestamp = new Date(jstDateTimeStr + 'Z');
  const appointmentDateTimeTimestamp = firebase.firestore.Timestamp.fromDate(dateForTimestamp);

  const dataToUpdate = {
      appointmentDate: appointmentDateString,
      appointmentDateTime: appointmentDateTimeTimestamp
  };

  db.collection('appointments').doc(editingDocId).update(dataToUpdate)
    .then(() => {
        console.log('更新成功');
        editModal.style.display = 'none';
    })
    .catch(error => {
        console.error('更新エラー:', error);
        alert('更新に失敗しました。');
    });
});