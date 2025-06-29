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
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const searchResultsModal = document.getElementById('searchResultsModal');
const searchResultsList = document.getElementById('searchResultsList');
const closeSearchResultsButton = document.getElementById('closeSearchResultsButton');
// 検査内容編集モーダル用の要素取得
const editServicesModal = document.getElementById('editServicesModal');
const servicesTextarea = document.getElementById('servicesTextarea');
const confirmServicesEditBtn = document.getElementById('confirmServicesEdit');
const cancelServicesEditBtn = document.getElementById('cancelServicesEdit');
// 検査費モーダル用の要素取得
const feeModal = document.getElementById('feeModal');
const feeModalHeader = document.getElementById('feeModalHeader');
const feeModalTableBody = document.querySelector("#feeModalTable tbody");
const feeModalTotalInput = document.getElementById('feeModalTotalInput'); // 合計入力ボックス
const printFeeModalButton = document.getElementById('printFeeModalButton');
const calculateFeeButton = document.getElementById('calculateFeeButton'); // 「計算」ボタン
const saveAndCloseFeeButton = document.getElementById('saveAndCloseFeeButton'); // 「保存して閉じる」ボタン
const cancelFeeModalButton = document.getElementById('cancelFeeModalButton'); // 「キャンセル」ボタン


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

loginEmailInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        loginButton.click();
    }
});

loginPasswordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        loginButton.click();
    }
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
    if (target.classList.contains('fee-cell')) {
        openFeeModal(docId);
        return;
    }
});

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
searchButton.addEventListener('click', searchAppointments);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { searchAppointments(); } });
closeSearchResultsButton.addEventListener('click', () => { searchResultsModal.style.display = 'none'; });
searchResultsList.addEventListener('click', (e) => {
    const targetItem = e.target.closest('.result-item');
    if (targetItem) {
        jumpToDate(targetItem.dataset.timestamp);
    }
});
const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
activityEvents.forEach(eventName => { window.addEventListener(eventName, resetLogoutTimer, true); });

// 検査費モーダルのイベントリスナー
calculateFeeButton.addEventListener('click', calculateFeeTotal);
saveAndCloseFeeButton.addEventListener('click', saveFeeData);
printFeeModalButton.addEventListener('click', () => { window.print(); });
cancelFeeModalButton.addEventListener('click', () => {
    feeModal.style.display = 'none';
});


// --- 関数定義 ---

/**
 * 金額の文字列や数値から、数字のみを抽出して数値型で返す。
 * @param {string | number} fee - 検査費データ
 * @returns {number | null} - クリーンな数値、または無効な場合はnull
 */
function parseFee(fee) {
    if (fee === null || fee === undefined) return null;
    const feeString = String(fee);
    const cleanedFee = feeString.replace(/[^0-9]/g, ''); // 数字以外の文字をすべて削除
    if (cleanedFee === '') return null;
    const feeNumber = parseInt(cleanedFee, 10);
    return isNaN(feeNumber) ? null : feeNumber;
}

function resetLogoutTimer() {
    startLogoutTimer();
}

function setupRealtimeListener() {
    if (unsubscribe) {
        unsubscribe();
    }
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
                  currentDateStr = `${dateObj.getUTCFullYear()}-${dateObj.getUTCMonth()}-${dateObj.getUTCDate()}`;
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
              const age = calculateAge(data.dateOfBirth);
              const displayAge = age ? `${age}` : '不明';

              // ▼▼▼【最終修正】「みなし表示」ロジックを一覧表示に追加 ▼▼▼
              let examinationFee = '';
              const feeNumber = parseFee(data.examinationFee);

              if (feeNumber !== null) {
                  // 1. 保存された値があれば最優先で表示
                  examinationFee = feeNumber.toLocaleString();
              } else {
                  // 2. 保存された値がなければ、条件に応じて「みなし」で表示
                  const services = data.services || [];
                  const isAudiologyOnly = services.length === 1 && services[0].toLowerCase() === 'audiology';
                  const cptCodeString = (data.cptCode || []).join(',').replace(/\s/g, '');
                  const isSpecificCpt = cptCodeString === "92557,92550,VA0004";

                  if (isAudiologyOnly || isSpecificCpt) {
                      examinationFee = (207000).toLocaleString();
                  }
              }
              // ▲▲▲【最終修正完了】▲▲▲

              tableRowsHTML += `
                  <tr data-id="${docId}" class="${rowClass}">
                      <td class="col-show show-toggle-cell">${checkmark}</td>
                      <td class="col-date date-cell">${displayDate}</td>
                      <td class="col-name name-cell">${data.claimantName || ''}</td>
                      <td class="col-age">${displayAge}</td>
                      <td class="col-contract">${data.contractNumber || ''}</td>
                      <td class="col-phone">${data.japanCellPhone || ''}</td>
                      <td class="col-services services-cell">${displayServicesText}</td>
                      <td class="col-actions">
                        <button class="view-pdf-btn">PDF</button>
                        <button class="delete-btn">削除</button>
                      </td>
                      <td class="col-cpt">${displayCptcodeText}</td>
                      <td class="col-fee fee-cell">${examinationFee}</td>
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

function searchAppointments() {
    const searchTerm = searchInput.value.trim();
    if (!searchTerm) {
        alert('検索する契約番号を入力してください。');
        return;
    }

    const endTerm = searchTerm.slice(0, -1) +
                  String.fromCharCode(searchTerm.charCodeAt(searchTerm.length - 1) + 1);

    db.collection("appointments")
      .where("contractNumber", ">=", searchTerm)
      .where("contractNumber", "<", endTerm)
      .orderBy("contractNumber")
      .limit(20)
      .get()
      .then(querySnapshot => {
          if (querySnapshot.empty) {
              alert('該当する契約番号の予約が見つかりませんでした。');
              return;
          }

          if (querySnapshot.size === 1) {
              const doc = querySnapshot.docs[0];
              jumpToDate(doc.data().appointmentDateTime);
              alert(`「${searchTerm}」で始まる契約番号の予約日にジャンプしました。`);
          }
          else {
              let resultsHTML = '';
              querySnapshot.forEach(doc => {
                  const data = doc.data();
                  const dateObj = data.appointmentDateTime.toDate();
                  const year = dateObj.getUTCFullYear();
                  const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
                  const day = String(dateObj.getUTCDate()).padStart(2, '0');
                  const targetDate = `${year}-${month}-${day}`;
                  
                  resultsHTML += `<div class="result-item" data-date="${targetDate}"><span>${data.claimantName}</span><span>${targetDate}</span></div>`;
              });
              searchResultsList.innerHTML = resultsHTML;
              searchResultsModal.style.display = 'flex';
          }
      })
      .catch(error => {
          console.error("検索エラー: ", error);
          alert("検索中にエラーが発生しました。");
      });
}

function jumpToDate(timestamp) {
    if (!timestamp) {
        alert('該当の予約には日付が設定されていません。');
        return;
    }
    const dateObj = timestamp.toDate();
    const year = dateObj.getUTCFullYear();
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    const targetDate = `${year}-${month}-${day}`;
    
    dateFilter.value = targetDate;
    dateFilter.dispatchEvent(new Event('change'));
}

function openDetailsModal(docId) {
  db.collection('appointments').doc(docId).get().then(doc => {
    if (!doc.exists) {
      alert('データが見つかりません');
      return;
    }
    const data = doc.data();

    let detailsHTML = '';
    const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'UTC' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' };
    const displayDate = data.appointmentDateTime
        ? new Intl.DateTimeFormat('ja-JP', dateOptions).format(data.appointmentDateTime.toDate()) + ' ' +
          new Intl.DateTimeFormat('ja-JP', timeOptions).format(data.appointmentDateTime.toDate())
        : '日付なし';

    const age = calculateAge(data.dateOfBirth);
    const displayAge = age ? `${age}歳` : '不明';

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

function calculateAge(dobString) {
    if (!dobString) return '';
    const dob = new Date(dobString);
    if (isNaN(dob.getTime())) return '';
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDifference = today.getMonth() - dob.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    return age;
}

// 検査費モーダル関連の関数
function openFeeModal(docId) {
    const docRef = db.collection('appointments').doc(docId);
    docRef.get().then(doc => {
        if (!doc.exists) return;
        const data = doc.data();

        feeModalHeader.innerHTML = `
            <span><strong>予約日:</strong> ${data.appointmentDate ? new Date(data.appointmentDate).toLocaleDateString('ja-JP') : ''}</span>
            <span><strong>契約番号:</strong> ${data.contractNumber || ''}</span>
            <span><strong>氏名:</strong> ${data.claimantName || ''}</span>
        `;

        const cptCodes = data.cptCode || [];
        const feeBreakdown = Array.isArray(data.feeBreakdown) ? data.feeBreakdown : [];
        let tableRows = '';
        for (let i = 0; i < 10; i++) {
            tableRows += `
                <tr>
                    <td><input type="text" class="cpt-code-input" value="${cptCodes[i] || ''}"></td>
                    <td><input type="number" class="fee-breakdown-input" value="${feeBreakdown[i] || ''}"></td>
                </tr>
            `;
        }
        feeModalTableBody.innerHTML = tableRows;

        let defaultTotal = '';
        const feeNumber = parseFee(data.examinationFee);
        if (feeNumber !== null) {
            defaultTotal = feeNumber;
        } else {
            const services = data.services || [];
            const isAudiologyOnly = services.length === 1 && services[0].toLowerCase() === 'audiology';
            const cptCodeString = (data.cptCode || []).join(',').replace(/\s/g, '');
            const isSpecificCpt = cptCodeString === "92557,92550,VA0004";

            if (isAudiologyOnly || isSpecificCpt) {
                defaultTotal = 207000;
            }
        }
        feeModalTotalInput.value = defaultTotal;

        editingDocId = docId;
        feeModal.style.display = 'flex';
    });
}

function calculateFeeTotal() {
    const feeInputs = feeModalTableBody.querySelectorAll('.fee-breakdown-input');
    let total = 0;
    feeInputs.forEach(input => {
        const value = parseInt(input.value, 10);
        if (!isNaN(value)) {
            total += value;
        }
    });
    feeModalTotalInput.value = total;
}

function saveFeeData() {
    if (!editingDocId) return;

    const cptInputs = feeModalTableBody.querySelectorAll('.cpt-code-input');
    const feeInputs = feeModalTableBody.querySelectorAll('.fee-breakdown-input');
    
    const newCptCodes = [];
    const newFeeBreakdown = [];

    for(let i = 0; i < cptInputs.length; i++) {
        const cpt = cptInputs[i].value.trim();
        const fee = feeInputs[i].value.trim();
        if (cpt || fee) {
            newCptCodes.push(cpt);
            newFeeBreakdown.push(parseInt(fee, 10) || 0);
        }
    }
    
    const totalFee = parseFee(feeModalTotalInput.value) || 0;

    const dataToUpdate = {
        cptCode: newCptCodes,
        feeBreakdown: newFeeBreakdown,
        examinationFee: totalFee
    };

    db.collection('appointments').doc(editingDocId).update(dataToUpdate)
      .then(() => {
          console.log('検査費を更新しました。');
          feeModal.style.display = 'none';
      })
      .catch(error => {
          console.error('検査費の更新エラー:', error);
          alert('更新に失敗しました。');
      });
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

              let feeForSum = 0;
              const feeNumber = parseFee(data.examinationFee);

              if (feeNumber !== null) {
                  feeForSum = feeNumber;
              } else {
                  const cptCodeString = (data.cptCode || []).join(', ').replace(/\s/g, '');
                  if (cptCodeString === "92557,92550,VA0004") {
                      feeForSum = 220000;
                  }
              }
              totalFee += feeForSum;
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


function generateInvoiceHTML(records, from, to, total) {
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
                .button-area { margin-top: 20px; text-align: right; }
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
                    <tbody id="invoice-tbody">
                        </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5" style="text-align: right;">合計:</td>
                            <td class="fee-cell">${total.toLocaleString()}</td>
                        </tr>
                    </tfoot>
                </table>
                <div class="button-area no-print">
                    <button onclick="window.print()">このページを印刷</button>
                    <button onclick="exportToCsv()">Excelエクスポート</button>
                </div>
            </div>
        </body>
        </html>
    `;

    const newWindow = window.open('', '_blank');
    newWindow.document.write(invoiceHTML);
    
    let tableRows = '';
    records.forEach(data => {
        const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' };
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' };
        const displayDate = data.appointmentDateTime
            ? new Intl.DateTimeFormat('en-US', dateOptions).format(data.appointmentDateTime.toDate()) + ' ' +
              new Intl.DateTimeFormat('ja-JP', timeOptions).format(data.appointmentDateTime.toDate())
            : '日付なし';
        
        let displayFee = '0';
        const feeNumber = parseFee(data.examinationFee);
        if (feeNumber !== null) {
            displayFee = feeNumber.toLocaleString();
        } else {
            const cptCodeString = (data.cptCode || []).join(', ').replace(/\s/g, '');
            if (cptCodeString === "92557,92550,VA0004") {
                displayFee = '220,000';
            }
        }

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
    newWindow.document.getElementById('invoice-tbody').innerHTML = tableRows;

    newWindow.exportToCsv = function() {
        const headers = ["予約日時", "契約番号", "氏名", "生年月日", "CPTCODE", "検査費"];
        let csvContent = "\uFEFF" + headers.join(',') + "\n";

        records.forEach(data => {
            const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' };
            const csvDate = data.appointmentDateTime ? new Intl.DateTimeFormat('en-US', dateOptions).format(data.appointmentDateTime.toDate()) : '';

            let csvFee = '0';
            const feeNumber = parseFee(data.examinationFee);
            if (feeNumber !== null) {
                csvFee = feeNumber;
            } else {
                const cptCodeString = (data.cptCode || []).join(', ').replace(/\s/g, '');
                if (cptCodeString === "92557,92550,VA0004") {
                    csvFee = '220000';
                }
            }
            
            const claimantNameCsv = `"${data.claimantName || ''}"`;
            const cptCodeCsv = `"${(data.cptCode || []).join(', ')}"`;

            const row = [
                csvDate,
                data.contractNumber || '',
                claimantNameCsv,
                data.dateOfBirth || '',
                cptCodeCsv,
                String(csvFee)
            ];
            csvContent += row.join(',') + "\n";
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `invoice_${from}_to_${to}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    newWindow.document.close();
}

function openServicesEditModal(docId) {
    db.collection('appointments').doc(docId).get().then(doc => {
        if (!doc.exists) {
            alert('データが見つかりません');
            return;
        }
        const data = doc.data();
        const currentServices = (data.services || []).join(', ');
        servicesTextarea.value = currentServices;
        
        editingDocId = docId;
        editServicesModal.style.display = 'flex';
    });
}

function closeServicesEditModal() {
    editServicesModal.style.display = 'none';
    editingDocId = null;
}

function saveServices() {
    if (!editingDocId) return;

    const newServicesString = servicesTextarea.value;
    const newServicesArray = newServicesString.split(',')
                                            .map(s => s.trim())
                                            .filter(s => s !== '');

    db.collection('appointments').doc(editingDocId).update({
        services: newServicesArray
    })
    .then(() => {
        console.log('検査内容を更新しました。');
        closeServicesEditModal();
    })
    .catch(error => {
        console.error('検査内容の更新エラー:', error);
        alert('検査内容の更新に失敗しました。');
    });
}
