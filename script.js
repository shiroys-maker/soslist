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

// --- グローバル変数 ---
let logoutTimer;
let editingDocId = null; 
let unsubscribe; // Firestoreのリスナーを解除するための変数

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
        // ログアウト時にリスナーを解除
        if (unsubscribe) {
            unsubscribe();
        }
    }
});

// --- イベントリスナー ---
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
            () => {
                console.log(`${file.name} のアップロード完了！`);
                uploadStatus.textContent = 'アップロードが完了しました。';
            }
        );
    }
    uploader.value = '';
});

dateFilter.addEventListener('change', () => {
    setupRealtimeListener();
});

// --- テーブルのボタン処理 ---
tableBody.addEventListener('click', (e) => {
    const target = e.target;
    const tr = target.closest('tr');
    if (!tr) return;

    const docId = tr.dataset.id;
    if (!docId) return;

    if (target.closest('.date-cell')) {
        openEditModal(docId);
        return;
    }
    if (target.classList.contains('view-pdf-btn')) {
        handleViewPdf(docId);
    }
    if (target.classList.contains('delete-btn')) {
        if (confirm('このデータを本当に削除しますか？')) {
            db.collection('appointments').doc(docId).delete()
              .then(() => console.log('ドキュメントの削除に成功しました。'))
              .catch(error => console.error('ドキュメントの削除中にエラーが発生しました:', error));
        }
    }
});

// --- 編集モーダル関連 ---
confirmEditBtn.addEventListener('click', () => {
  if (!dateSelect.value || !timeSelect.value || !editingDocId) return;

  const jstDateTimeStr = `${dateSelect.value}T${timeSelect.value}:00`;
  const dateInJST = new Date(jstDateTimeStr);
  const newTimestamp = firebase.firestore.Timestamp.fromDate(dateInJST);

  const dataToUpdate = {
      appointmentDate: jstDateTimeStr,
      appointmentDateTime: newTimestamp
  };

  db.collection('appointments').doc(editingDocId).update(dataToUpdate)
    .then(() => {
        console.log('更新成功');
        closeEditModal();
    })
    .catch(error => {
        console.error('更新エラー:', error);
        alert('更新に失敗しました。');
    });
});

cancelEditBtn.addEventListener('click', () => {
    closeEditModal();
});


// --- 関数定義 ---
function setupRealtimeListener() {
    if (unsubscribe) {
        unsubscribe(); // 既存のリスナーがあれば解除
    }

    const localDateStr = dateFilter.value;
    if (!localDateStr) return;

    const filterDate = new Date(`${localDateStr}T00:00:00`);
    
    unsubscribe = db.collection("appointments")
      .where("appointmentDateTime", ">=", filterDate)
      .orderBy("appointmentDateTime", "asc")
      .onSnapshot(querySnapshot => {
          let tableRowsHTML = "";
          querySnapshot.forEach(doc => {
              const data = doc.data();
              let displayDate = '日付なし';
              if (data.appointmentDate) {
                  const dateObj = new Date(data.appointmentDate);

                  // 日付部分のフォーマット (例: 06/08 (日))
                  const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short' };
                  const datePart = new Intl.DateTimeFormat('ja-JP', dateOptions).format(dateObj);

                  // 時刻部分のフォーマット (例: 09:30)
                  const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
                  const timePart = new Intl.DateTimeFormat('ja-JP', timeOptions).format(dateObj);

                  // 改行(<br>)を使って2段で表示
                  displayDate = `${datePart}<br>${timePart}`;
              }
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
          });
          tableBody.innerHTML = tableRowsHTML;
      }, error => {
          console.error("Firestoreのリアルタイム監視でエラー:", error);
      });
}

function startLogoutTimer() {
    clearTimeout(logoutTimer);
    logoutTimer = setTimeout(() => {
        alert('30分間操作がなかったため、自動的にログアウトします。');
        auth.signOut();
    }, 1800000);
}

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
        const storageRef = storage.ref(fileName);
        storageRef.getDownloadURL()
            .then(url => {
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

function openEditModal(docId) {
  const docRef = db.collection('appointments').doc(docId);
  docRef.get().then(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    const dateTimeString = data.appointmentDate;
    if (dateTimeString && dateTimeString.includes('T')) {
      dateSelect.value = dateTimeString.split('T')[0];
      timeSelect.value = dateTimeString.split('T')[1].substr(0, 5);
    }
    editingDocId = docId;
    editModal.style.display = 'flex';
  });
}

function closeEditModal() {
    editModal.style.display = 'none';
    editingDocId = null;
}