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

let logoutTimer; // ログアウトタイマー用の変数を宣言

// --- ログイン状態の監視 ---
auth.onAuthStateChanged(user => {
    if (user) {
        // ログインしている場合
        loginContainer.style.display = 'none';
        mainAppContainer.style.display = 'block';
        userEmailSpan.textContent = user.email;

        // ログイン時にFirestoreの監視を開始
        setupRealtimeListener();

        // 5分後に自動ログアウトするタイマーを開始
        startLogoutTimer();

    } else {
        // ログアウトしている場合
        loginContainer.style.display = 'block';
        mainAppContainer.style.display = 'none';
        
        // ログアウトタイマーを解除
        clearTimeout(logoutTimer);
    }
});

// --- イベントリスナー ---

// ログインボタン
loginButton.addEventListener('click', () => {
    const email = loginEmailInput.value;
    const password = loginPasswordInput.value;
    auth.signInWithEmailAndPassword(email, password)
        .catch(error => {
            loginError.textContent = `ログインに失敗しました: ${error.message}`;
        });
});

// ログアウトボタン
logoutButton.addEventListener('click', () => {
    auth.signOut();
});

// PDFアップロードボタン
uploadButton.addEventListener('click', () => {
    // (この中のコードは変更なし)
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


// --- 関数 ---

// Firestoreのリアルタイム監視を設定する関数
function setupRealtimeListener() {
    db.collection("appointments")
      .orderBy("appointmentDateTime", "desc")
      .onSnapshot(querySnapshot => {
          tableBody.innerHTML = "";
          querySnapshot.forEach(doc => {
              const data = doc.data();
              const date = data.appointmentDateTime ? data.appointmentDateTime.toDate().toLocaleString('ja-JP') : '日付なし';
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

// 5分間の自動ログアウトタイマーを開始する関数
function startLogoutTimer() {
    clearTimeout(logoutTimer); // 既存のタイマーをリセット
    logoutTimer = setTimeout(() => {
        alert('5分間操作がなかったため、自動的にログアウトします。');
        auth.signOut();
    }, 300000); // 5分 = 300,000ミリ秒
}