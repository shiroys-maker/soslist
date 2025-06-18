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
// 日時編集モーダル
const editModal = document.getElementById('editModal');
const dateSelect = document.getElementById('dateSelect');
const timeSelect = document.getElementById('timeSelect');
const confirmEditBtn = document.getElementById('confirmEdit');
const cancelEditBtn = document.getElementById('cancelEdit');
// 詳細表示モーダル
const detailsModal = document.getElementById('detailsModal');
const detailsContentContainer = document.getElementById('details-content-container');
const notesTextarea = document.getElementById('notesTextarea');
const saveNotesButton = document.getElementById('saveNotesButton');
const closeDetailsModalButton = document.getElementById('closeDetailsModalButton');
const invoiceFromDate = document.getElementById('invoiceFromDate');
const invoiceToDate = document.getElementById('invoiceToDate');
const printInvoiceButton = document.getElementById('printInvoiceButton');
// 検査内容編集モーダル用の要素取得 
const editServicesModal = document.getElementById('editServicesModal');
const servicesTextarea = document.getElementById('servicesTextarea');
const confirmServicesEditBtn = document.getElementById('confirmServicesEdit');
const cancelServicesEditBtn = document.getElementById('cancelServicesEdit');


// --- グローバル変数 ---
let logoutTimer;
let editingDocId = null; 
let unsubscribe;

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

tableBody.addEventListener('click', (e) => {
    const target = e.target;
    const tr = target.closest('tr');
    if (!tr) return;

    const docId = tr.dataset.id;
    if (!docId) return;

    if (target.classList.contains('name-cell')) {
        openDetailsModal(docId);
        return;
    }
    if (target.classList.contains('show-toggle-cell')) {
        const docRef = db.collection('appointments').doc(docId);
        docRef.get().then(doc => {
            if (doc.exists) {
                const currentIsShown = doc.data().isShown === true;
                docRef.update({ isShown: !currentIsShown });
            }
        });
        return;
    }
    if (target.closest('.date-cell')) {
        openEditModal(docId);
        return;
    }
    if (target.classList.contains('services-cell')) {
        openServicesEditModal(docId);
        return;
    }
    if (target.classList.contains('view-pdf-btn')) {
        handleViewPdf(docId);
    }
    if (target.classList.contains('delete-btn')) {
        if (confirm('このデータを本当に削除しますか？')) {
            db.collection('appointments').doc(docId).delete();
        }
    }
});

tableBody.addEventListener('blur', (e) => {
    if (e.target.classList.contains('fee-input')) {
        const inputElement = e.target;
        const docId = inputElement.closest('tr').dataset.id;
        if (docId) {
            db.collection('appointments').doc(docId).update({
                examinationFee: inputElement.value
            }).catch(error => console.error('検査費の更新エラー:', error));
        }
    }
}, true);

confirmEditBtn.addEventListener('click', () => {
    if (!dateSelect.value || !timeSelect.value || !editingDocId) return;
    const utcDateTimeStr = `${dateSelect.value}T${timeSelect.value}:00Z`;
    const dateInUTC = new Date(utcDateTimeStr);
    const newTimestamp = firebase.firestore.Timestamp.fromDate(dateInUTC);
    const dataToUpdate = {
        appointmentDate: `${dateSelect.value}T${timeSelect.value}:00`,
        appointmentDateTime: newTimestamp
    };
    db.collection('appointments').doc(editingDocId).update(dataToUpdate)
      .then(() => closeEditModal())
      .catch(error => alert('更新に失敗しました。'));
});

cancelEditBtn.addEventListener('click', closeEditModal);
saveNotesButton.addEventListener('click', saveNotes);
closeDetailsModalButton.addEventListener('click', closeDetailsModal);
printInvoiceButton.addEventListener('click', printInvoice);
confirmServicesEditBtn.addEventListener('click', saveServices);
cancelServicesEditBtn.addEventListener('click', closeServicesEditModal);

const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];

// 既存のタイマースタート関数を、タイマーリセット関数として再利用
function resetLogoutTimer() {
    startLogoutTimer();
}

activityEvents.forEach(eventName => {
    window.addEventListener(eventName, resetLogoutTimer, true);
});

// --- 関数定義 ---
function setupRealtimeListener() {
    if (unsubscribe) unsubscribe();
    const localDateStr = dateFilter.value;
    if (!localDateStr) return;
    const filterDate = new Date(`${localDateStr}T00:00:00`);

    unsubscribe = db.collection("appointments")
      .where("appointmentDateTime", ">=", filterDate)
      .onSnapshot(querySnapshot => {
          const appointments = [];
          querySnapshot.forEach(doc => {
              appointments.push({ id: doc.id, ...doc.data() });
          });
          appointments.sort((a, b) => {
              const timeA = a.appointmentDateTime ? a.appointmentDateTime.toMillis() : 0;
              const timeB = b.appointmentDateTime ? b.appointmentDateTime.toMillis() : 0;
              return timeA - timeB;
          });

          let tableRowsHTML = "";
          let previousDateStr = null;
          appointments.forEach(appointment => {
              const docId = appointment.id;
              const data = appointment;
              let rowClass = '';
              let currentDateStr = '';
              if (data.appointmentDateTime) {
                  const dateObj = data.appointmentDateTime.toDate();
                  // 比較用に日付部分のみの文字列を作成 (例: "2025-6-11")
                  currentDateStr = `${dateObj.getUTCFullYear()}-${dateObj.getUTCMonth()}-${dateObj.getUTCDate()}`;

                  // 前の行と日付が違っていたら、クラスを付与
                  if (previousDateStr && currentDateStr !== previousDateStr) {
                      rowClass = 'date-boundary';
                  }
              }
              const isShown = data.isShown === true;
              const checkmark = isShown ? '✅' : '';
              let displayDate = '日付なし';
              if (data.appointmentDateTime) {
                  const dateObj = data.appointmentDateTime.toDate();
                  const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'UTC' };
                  const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' };
                  const datePart = new Intl.DateTimeFormat('ja-JP', dateOptions).format(dateObj);
                  const timePart = new Intl.DateTimeFormat('ja-JP', timeOptions).format(dateObj);
                  displayDate = `${datePart}<br>${timePart}`;
              }
              const displayServicesText = (data.services || []).join(', ').toLowerCase().includes("audiologist") ? "Audiology" : (data.services || []).join(', ');
              const displayCptcodeText = (data.cptCode || []).join(', ');
              let initialFeeValue = data.examinationFee || '';
              if (!initialFeeValue && displayCptcodeText.replace(/\s/g, '') === "92557,92550,VA0004") {
                  initialFeeValue = '220,000';
              }
              const age = calculateAge(data.dateOfBirth);
              const displayAge = age ? `${age}` : '不明';

              tableRowsHTML += `
                  <tr data-id="${docId}" class="${rowClass}">
                      <td class="show-toggle-cell">${checkmark}</td>                 
                      <td class="date-cell">${displayDate}</td>
                      <td class="name-cell">${data.claimantName || ''}</td>
                      <td class="age-cell">${displayAge}</td>
                      <td>${data.contractNumber || ''}</td>
                      <td>${data.japanCellPhone || ''}</td>
                      <td class="services-cell">${displayServicesText}</td>
                      <td>
                          <button class="view-pdf-btn">PDF表示</button>
                          <button class="delete-btn">削除</button>
                      </td>
                      <td>${displayCptcodeText}</td>
                      <td>
                          <input type="text" class="fee-input" value="${initialFeeValue}" placeholder="金額入力">
                      </td>
                  </tr>`;
                  previousDateStr = currentDateStr;
          });
          tableBody.innerHTML = tableRowsHTML;
      }, error => {
          console.error("Firestoreのリアルタイム監視でエラー:", error);
      });
}

function startLogoutTimer() {
    clearTimeout(logoutTimer);
    logoutTimer = setTimeout(() => {
        if (auth.currentUser) {
            alert('120分間操作がなかったため、自動的にログアウトします。');
            auth.signOut();
        }
    }, 7200000); // 120分
}

function handleViewPdf(docId) {
    db.collection('appointments').doc(docId).get().then(doc => {
        if (!doc.exists) return alert('データベースにレコードが見つかりません。');
        const fileName = doc.data().originalFileName;
        if (!fileName) return alert('このレコードにPDFファイルは関連付けられていません。');
        
        storage.ref(fileName).getDownloadURL()
            .then(url => window.open(url, '_blank'))
            .catch(error => {
                if (error.code === 'storage/object-not-found') {
                    alert('PDFファイルがストレージに見つかりません。');
                } else {
                    alert('PDFの表示中にエラーが発生しました。');
                }
            });
    });
}

function openEditModal(docId) {
  db.collection('appointments').doc(docId).get().then(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    if (data.appointmentDateTime) {
      const dateObj = data.appointmentDateTime.toDate();
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getUTCDate()).padStart(2, '0');
      const hours = String(dateObj.getUTCHours()).padStart(2, '0');
      const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
      dateSelect.value = `${year}-${month}-${day}`;
      timeSelect.value = `${hours}:${minutes}`;
    }
    editingDocId = docId;
    editModal.style.display = 'flex';
  });
}

function closeEditModal() {
    editModal.style.display = 'none';
    editingDocId = null;
}

// script.js

function openDetailsModal(docId) {
  db.collection('appointments').doc(docId).get().then(doc => {
    if (!doc.exists) {
      alert('データが見つかりません');
      return;
    }
    const data = doc.data();

    // --- ▼▼▼【ここから変更】HTML生成ロジックを2列レイアウトに変更 ▼▼▼ ---
    let detailsHTML = '';
    const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'UTC' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' };
    const displayDate = data.appointmentDateTime 
        ? new Intl.DateTimeFormat('ja-JP', dateOptions).format(data.appointmentDateTime.toDate()) + ' ' + 
          new Intl.DateTimeFormat('ja-JP', timeOptions).format(data.appointmentDateTime.toDate())
        : '日付なし';

    // 年齢を計算
    const age = calculateAge(data.dateOfBirth);
    const displayAge = age ? `${age}歳` : '不明';

    // 2列レイアウトのHTMLを生成
    detailsHTML += `<div class="detail-row">
                      <div class="detail-item"><strong>予約日時</strong><span>${displayDate.replace('<br>',' ')}</span></div>
                      <div class="detail-item"><strong>契約番号</strong><span>${data.contractNumber || ''}</span></div>
                    </div>`;

    detailsHTML += `<div class="detail-row">
                      <div class="detail-item"><strong>氏名</strong><span>${data.claimantName || ''}</span></div>
                      <div class="detail-item"><strong>生年月日(年齢)</strong><span>${data.dateOfBirth || ''} (${displayAge})</span></div>
                    </div>`;
    
    detailsHTML += `<div class="detail-row">
                      <div class="detail-item"><strong>検査内容</strong><span>${(data.services || []).join(', ')}</span></div>
                    </div>`;

   // --- ▲▲▲ ここまで変更 ▲▲▲ ---

    detailsContentContainer.innerHTML = detailsHTML;
    notesTextarea.value = data.notes || '';
    
    detailsModal.dataset.editingId = docId;
    detailsModal.style.display = 'flex';
  });
}

function closeDetailsModal() {
    detailsModal.style.display = 'none';
    detailsModal.dataset.editingId = '';
}

function saveNotes() {
    const docId = detailsModal.dataset.editingId;
    if (!docId) return;
    db.collection('appointments').doc(docId).update({
        notes: notesTextarea.value
    })
    .then(() => {
        alert('メモを保存しました。');
        closeDetailsModal();
    })
    .catch(error => {
        alert('メモの保存に失敗しました。');
    });
}

// script.js の「--- 関数定義 ---」セクションに追加

function calculateAge(dobString) {
    // 生年月日の文字列がない場合は空文字を返す
    if (!dobString) return '';
    
    const dob = new Date(dobString);
    // 日付が無効な場合は空文字を返す
    if (isNaN(dob.getTime())) return '';

    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDifference = today.getMonth() - dob.getMonth();
    
    // 今年の誕生日がまだ来ていない場合は1歳引く
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    
    return age;
}


function printInvoice() {
    const fromDateStr = invoiceFromDate.value;
    const toDateStr = invoiceToDate.value;

    if (!fromDateStr || !toDateStr) {
        alert('FromとToの両方の日付を選択してください。');
        return;
    }

    const fromDate = new Date(`${fromDateStr}T00:00:00`);
    const toDate = new Date(`${toDateStr}T23:59:59`);

    db.collection("appointments")
      .where("isShown", "==", true)
      .where("appointmentDateTime", ">=", fromDate)
      .where("appointmentDateTime", "<=", toDate)
      .orderBy("appointmentDateTime", "asc")
      .get()
      .then(querySnapshot => {
          let records = [];
          let totalFee = 0;

          querySnapshot.forEach(doc => {
              const data = doc.data();
              records.push(data);

              // --- ▼▼▼【ここから変更】合計金額の計算ロジックを修正 ▼▼▼ ---
              let feeForSum = 0;
              // 保存された検査費がある場合
              if (data.examinationFee) {
                  const parsedFee = parseInt(String(data.examinationFee).replace(/,/g, ''), 10);
                  if (!isNaN(parsedFee)) {
                      feeForSum = parsedFee;
                  }
              } 
              // 保存された費用がなく、CPTコードが条件に一致する場合
              else {
                  const cptCodeString = (data.cptCode || []).join(', ').replace(/\s/g, '');
                  if (cptCodeString === "92557,92550,VA0004") {
                      feeForSum = 220000;
                  }
              }
              totalFee += feeForSum;
              // --- ▲▲▲ ここまで変更 ▲▲▲ ---
          });

          if (records.length === 0) {
              alert('選択された期間に、SHOWがチェックされたレコードはありませんでした。');
              return;
          }
          
          generateInvoiceHTML(records, fromDateStr, toDateStr, totalFee);

      })
      .catch(error => {
          console.error("Invoiceデータの取得エラー: ", error);
          alert("データの取得中にエラーが発生しました。コンソールでエラー内容を確認してください。\n（複合インデックスの作成が必要な場合があります）");
      });
}

// script.js

function generateInvoiceHTML(records, from, to, total) {
    let tableRows = '';
    records.forEach(data => {
        const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' };
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' };
        const displayDate = data.appointmentDateTime 
            ? new Intl.DateTimeFormat('en-US', dateOptions).format(data.appointmentDateTime.toDate()) + ' ' + 
              new Intl.DateTimeFormat('ja-JP', timeOptions).format(data.appointmentDateTime.toDate())
            : '日付なし';
        
        // --- ▼▼▼【ここから追加】各行の検査費表示ロジック ▼▼▼ ---
        let displayFee = data.examinationFee || ''; // 保存された値を優先
        // 保存された値がなく、CPTコードが条件と一致する場合
        if (!displayFee) {
            const cptCodeString = (data.cptCode || []).join(', ').replace(/\s/g, '');
            if (cptCodeString === "92557,92550,VA0004") {
                displayFee = '220,000';
            }
        }
        // それでも値がなければ'0'を表示
        if (!displayFee) {
            displayFee = '0';
        }
        // --- ▲▲▲ ここまで追加 ▲▲▲ ---

        tableRows += `
            <tr>
                <td>${displayDate}</td>
                <td>${data.contractNumber || ''}</td>
                <td>${data.claimantName || ''}</td>
                <td>${data.dateOfBirth || ''}</td>
                <td>${(data.cptCode || []).join(', ')}</td>
                <td class="fee-cell">${displayFee}</td>
            </tr>
        `;
    });

    // 請求書のHTML全体
    const invoiceHTML = `
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <title>Invoice</title>
            <style>
                body { font-family: sans-serif; }
                .invoice-container { max-width: 800px; margin: auto; padding: 20px; }
                h1, h2 { text-align: center; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
                th { background-color: #f2f2f2; }
                tfoot td { font-weight: bold; font-size: 14px; }
                .fee-cell { text-align: right; }
                @media print {
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="invoice-container">
                <h1>INVOICE</h1>
                <h2>Period: ${from} to ${to}</h2>
                <table>
                    <thead>
                        <tr>
                            <th>予約日時</th>
                            <th>契約番号</th>
                            <th>氏名</th>
                            <th>生年月日</th>
                            <th>CPTCODE</th>
                            <th class="fee-cell">検査費</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5" style="text-align: right;">合計:</td>
                            <td class="fee-cell">${total.toLocaleString()}</td>
                        </tr>
                    </tfoot>
                </table>
                <br>
                <button class="no-print" onclick="window.print()">このページを印刷</button>
            </div>
        </body>
        </html>
    `;

    // 新しいウィンドウを開いてHTMLを書き込む
    const newWindow = window.open('', '_blank');
    newWindow.document.write(invoiceHTML);
    newWindow.document.close();
}
// ▼▼▼【ここから追加】検査内容を編集するための関数群 ▼▼▼
function openServicesEditModal(docId) {
    db.collection('appointments').doc(docId).get().then(doc => {
        if (!doc.exists) {
            alert('データが見つかりません');
            return;
        }
        const data = doc.data();
        // services配列をカンマ区切りの文字列に変換してテキストエリアに設定
        const currentServices = (data.services || []).join(', ');
        servicesTextarea.value = currentServices;
        
        editingDocId = docId; // 編集対象のIDをグローバル変数にセット
        editServicesModal.style.display = 'flex';
    });
}

function closeServicesEditModal() {
    editServicesModal.style.display = 'none';
    editingDocId = null; // IDをリセット
}

function saveServices() {
    if (!editingDocId) return;

    const newServicesString = servicesTextarea.value;
    // テキストエリアの文字列をカンマで分割し、各項目の前後の空白を削除し、空の項目を除外して配列を作成
    const newServicesArray = newServicesString.split(',')
                                            .map(s => s.trim())
                                            .filter(s => s !== '');

    db.collection('appointments').doc(editingDocId).update({
        services: newServicesArray
    })
    .then(() => {
        console.log('検査内容を更新しました。');
        closeServicesEditModal(); // モーダルを閉じる
    })
    .catch(error => {
        console.error('検査内容の更新エラー:', error);
        alert('検査内容の更新に失敗しました。');
    });
}
// ▲▲▲【ここまで追加】▲▲▲