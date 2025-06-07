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
// (変更なし)
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

// --- イベントリスナー ---
// (変更なし)
loginButton.addEventListener('click', () => {
    const email = loginEmailInput.value;
    const password = loginPasswordInput.value;
    auth.signInWithEmailAndPassword(email, password)
        .catch(error => {
            loginError.textContent = `ログインに失敗しました: ${error.message}`;
        });
});

logoutButton.addEventListener('click', () => {
    auth.signOut();
});

uploadButton.addEventListener('click', () => {
    const files = uploader.files;
    if (files.length === 0) {
        uploadStatus.textContent = 'ファイルが選択されていません。';
        return;
    }
    for (const file of files) {
        const fileName = `${new Date().getTime()}_${file.name}`;
        const storageRef = storage.ref(`uploads/${fileName}`);
        const task = storageRef.put(file);
        task.on('state_changed',
            (snapshot) => uploadStatus.textContent = `${file.name} をアップロード中...`,
            (error) => console.error(`${file.name} のアップロード失敗:`, error),
            () => console.log(`${file.name} のアップロード完了！`)
        );
    }
    uploader.value = '';
    uploadStatus.textContent = '全てのファイルのアップロードを開始しました。';
});

dateFilter.addEventListener('change', () => {
    setupRealtimeListener();
});

// --- Firestoreのリアルタイム監視 ---
function setupRealtimeListener() {
    const localDateStr = dateFilter.value;
    if (!localDateStr) return;

    // フィルターの日付をJSTの0時0分として解釈
    const filterDate = new Date(`${localDateStr}T00:00:00`);

    db.collection("appointments")
      .where("appointmentDateTime", ">=", filterDate)
      .orderBy("appointmentDateTime", "asc")
      .onSnapshot(querySnapshot => {
          tableBody.innerHTML = "";
          querySnapshot.forEach(doc => {
              const data = doc.data();
              const appointmentDate = data.appointmentDateTime?.toDate();

              // ▼▼▼ ここが修正された部分です ▼▼▼
              // UTC時刻に9時間を足すのではなく、toLocaleStringの機能で正しくJSTに変換・表示します
              const dateOptions = { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
              const date = appointmentDate ? appointmentDate.toLocaleString('ja-JP', dateOptions) : '日付なし';
              // ▲▲▲ ここが修正された部分です ▲▲▲

              const row = `<tr data-id="${doc.id}"><td>${date}</td><td>${data.claimantName || ''}</td><td>${data.contractNumber || ''}</td><td>${data.japanCellPhone || ''}</td><td>${(data.services || []).join(', ')}</td><td><button class="edit-btn">編集</button><button class="delete-btn">削除</button></td></tr>`;
              tableBody.innerHTML += row;
          });
      }, error => {
          console.error("Firestoreのリアルタイム監視でエラー:", error);
      });
}

// --- 自動ログアウトタイマー ---
// (変更なし)
function startLogoutTimer() {
    clearTimeout(logoutTimer);
    logoutTimer = setTimeout(() => {
        alert('30分間操作がなかったため、自動的にログアウトします。');
        auth.signOut();
    }, 1800000);
}

// --- テーブルのボタン処理 ---
// (変更なし)
tableBody.addEventListener('click', (e) => {
    const target = e.target;
    const tr = target.closest('tr');
    if (!tr) return;

    const docId = tr.dataset.id;
    if (!docId) return;

    if (target.classList.contains('delete-btn')) {
        if (confirm('このデータを本当に削除しますか？')) {
            db.collection('appointments').doc(docId).delete().then(() => console.log('削除成功')).catch(error => console.error('削除エラー:', error));
        }
    } else if (target.classList.contains('edit-btn')) {
        openEditModal(docId);
    }
});

// --- 編集モーダル関連の関数 ---
// (変更なし、前回の修正で正常です)
function openEditModal(docId) {
  const docRef = db.collection('appointments').doc(docId);
  docRef.get().then(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    const timestamp = data.appointmentDateTime?.toDate();

    if (timestamp) {
      const dateOptions = { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' };
      const timeOptions = { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false };
      
      const dateString = new Intl.DateTimeFormat('ja-JP', dateOptions).format(timestamp).replace(/\//g, '-');
      const timeString = new Intl.DateTimeFormat('ja-JP', timeOptions).format(timestamp);
      
      dateSelect.value = dateString;
      timeSelect.value = timeString;
    }
    
    editingDocId = docId;
    editModal.style.display = 'flex';
  });
}

confirmEditBtn.addEventListener('click', () => {
  if (!dateSelect.value || !timeSelect.value || !editingDocId) return;

  const jstDateTimeStr = `${dateSelect.value}T${timeSelect.value}:00`;
  const dateInJST = new Date(jstDateTimeStr);
  const newTimestamp = firebase.firestore.Timestamp.fromDate(dateInJST);

  db.collection('appointments').doc(editingDocId).update({ appointmentDateTime: newTimestamp })
    .then(() => {
        console.log('更新成功');
        editModal.style.display = 'none';
    })
    .catch(error => {
        console.error('更新エラー:', error);
        alert('更新に失敗しました。');
    });
});

cancelEditBtn.addEventListener('click', () => {
  editModal.style.display = 'none';
});