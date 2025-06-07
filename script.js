// ▼▼▼ ここにあなたのFirebaseプロジェクトの設定情報を貼り付けてください ▼▼▼
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

let logoutTimer;

// --- ログイン状態の監視 ---
auth.onAuthStateChanged(user => {
    if (user) {
        loginContainer.style.display = 'none';
        mainAppContainer.style.display = 'block';
        userEmailSpan.textContent = user.email;

        // 日付フィルターを本日に設定
        const today = new Date();
        dateFilter.value = today.toISOString().split('T')[0];

        setupRealtimeListener();
        startLogoutTimer();
    } else {
        loginContainer.style.display = 'block';
        mainAppContainer.style.display = 'none';
        clearTimeout(logoutTimer);
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
            (snapshot) => {
                uploadStatus.textContent = `${file.name} をアップロード中...`;
            },
            (error) => {
                console.error(`${file.name} のアップロード失敗:`, error);
            },
            () => {
                console.log(`${file.name} のアップロード完了！`);
                uploadStatus.textContent = '全てのアップロードが完了しました。';
            }
        );
    }
    uploader.value = '';
});

// --- 日付フィルター変更で再読み込み ---
dateFilter.addEventListener('change', () => {
    setupRealtimeListener();
});

// --- Firestoreのリアルタイム監視 ---
function setupRealtimeListener() {
    const filterDate = new Date(dateFilter.value + 'T00:00:00+09:00');

    db.collection("appointments")
      .orderBy("appointmentDateTime", "asc")
      .onSnapshot(querySnapshot => {
          tableBody.innerHTML = "";
          querySnapshot.forEach(doc => {
              const data = doc.data();
              const appointmentDate = data.appointmentDateTime?.toDate();

              if (appointmentDate && appointmentDate < filterDate) return;

              const date = appointmentDate
                  ? new Date(appointmentDate.getTime() - 9 * 60 * 60 * 1000).toLocaleString('ja-JP', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false
                    })
                  : '日付なし';

              const row = `
                  <tr data-id="${doc.id}">
                      <td>${date}</td>
                      <td>${data.claimantName || ''}</td>
                      <td>${data.contractNumber || ''}</td>
                      <td>${data.japanCellPhone || ''}</td>
                      <td>${(data.services || []).join(', ')}</td>
                      <td>
                          <button class="edit-btn">編集</button>
                          <button class="delete-btn">削除</button>
                      </td>
                  </tr>
              `;
              tableBody.innerHTML += row;
          });
      }, error => {
          console.error("Firestoreのリアルタイム監視でエラー:", error);
      });
}

function startLogoutTimer() {
    clearTimeout(logoutTimer);
    logoutTimer = setTimeout(() => {
        alert('5分間操作がなかったため、自動的にログアウトします。');
        auth.signOut();
    }, 300000);
}

// --- テーブルのボタン処理 ---
tableBody.addEventListener('click', (e) => {
    const target = e.target;
    const tr = target.closest('tr');
    if (!tr) return;

    const docId = tr.dataset.id;
    if (!docId) return;

    if (target.classList.contains('delete-btn')) {
        if (confirm('このデータを本当に削除しますか？')) {
            db.collection('appointments').doc(docId).delete()
                .then(() => {
                    console.log('削除成功');
                })
                .catch(error => {
                    console.error('削除エラー:', error);
                    alert('削除に失敗しました。');
                });
        }
    }

    if (target.classList.contains('edit-btn')) {
        handleEdit(docId);
    }
});

// 編集処理を行う関数

function handleEdit(docId) {
  const docRef = db.collection('appointments').doc(docId);
  docRef.get().then(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    const timestamp = data.appointmentDateTime?.toDate();
    if (timestamp) {
      const jstDate = new Date(timestamp.getTime() - 9 * 60 * 60 * 1000);
      document.getElementById('dateSelect').value = jstDate.toISOString().split('T')[0];
      document.getElementById('timeSelect').value = jstDate.toTimeString().slice(0, 5);
    }
    editingDocId = docId;
    document.getElementById('editModal').style.display = 'flex';
  });
}
;
        if (newDate !== null) dataToUpdate.appointmentDateTime = newDate;
        if (newPhone !== null) dataToUpdate.japanCellPhone = newPhone;
        if (Object.keys(dataToUpdate).length > 0) {
            docRef.update(dataToUpdate)
                .then(() => console.log('更新成功'))
                .catch(error => {
                    console.error('更新エラー:', error);
                    alert('更新に失敗しました。');
                });
        }


document.getElementById("saveEditBtn").addEventListener("click", () => {
  const date = document.getElementById("dateSelect").value;
  const time = document.getElementById("timeSelect").value;
  const jstDateTimeStr = `${date}T${time}`;

  // JSTとして入力された日時をUTCに補正
  const utcDate = new Date(new Date(jstDateTimeStr).getTime() - 9 * 60 * 60 * 1000);

  const dataToUpdate = {
    appointmentDateTime: firebase.firestore.Timestamp.fromDate(utcDate),
    appointmentDate: `${jstDateTimeStr}:00`
  };

  if (editingDocId) {
    db.collection('appointments').doc(editingDocId).update(dataToUpdate)
      .then(() => {
        console.log('更新成功');
        document.getElementById('editModal').style.display = 'none';
      })
      .catch(error => {
        console.error('更新エラー:', error);
        alert('更新に失敗しました。');
      });
  }
});
