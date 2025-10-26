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
// 電話番号編集モーダル用の要素取得
const editPhoneModal = document.getElementById('editPhoneModal');
const phoneInput = document.getElementById('phoneInput');
const confirmPhoneEditBtn = document.getElementById('confirmPhoneEdit');
const cancelPhoneEditBtn = document.getElementById('cancelPhoneEdit');


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
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        db.collection("appointments")
            .where("appointmentDateTime", "<", startOfToday)
            .orderBy("appointmentDateTime", "desc")
            .limit(1)
            .get()
            .then(querySnapshot => {
                if (!querySnapshot.empty) {
                    const lastAppointment = querySnapshot.docs[0].data();
                    const dateObj = lastAppointment.appointmentDateTime.toDate();
                    const year = dateObj.getUTCFullYear();
                    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
                    const day = String(dateObj.getUTCDate()).padStart(2, '0');
                    dateFilter.value = `${year}-${month}-${day}`;
                } else {
                    // No past appointments, use today's date
                    const year = today.getFullYear();
                    const month = String(today.getMonth() + 1).padStart(2, '0');
                    const day = String(today.getDate()).padStart(2, '0');
                    dateFilter.value = `${year}-${month}-${day}`;
                }
                setupRealtimeListener();
            })
            .catch(error => {
                console.error("Error getting last appointment: ", error);
                // On error, fallback to today's date
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const day = String(today.getDate()).padStart(2, '0');
                dateFilter.value = `${year}-${month}-${day}`;
                setupRealtimeListener();
            });

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
    if (target.classList.contains('phone-cell')) {
        openPhoneEditModal(docId);
        return;
    }
    if (target.classList.contains('age-cell')) {
        const docRef = db.collection('appointments').doc(docId);
        const isPink = target.classList.toggle('pink');
        docRef.update({ isAgePink: isPink });
        return;
    }
});

// ダブルクリックで削除を実行
tableBody.addEventListener('dblclick', (e) => {
    const target = e.target;
    const tr = target.closest('tr');
    if (!tr) return;

    const docId = tr.dataset.id;
    if (!docId) return;

    if (target.classList.contains('delete-btn')) {
        if (confirm('このデータを本当に削除しますか？')) {
            db.collection('appointments').doc(docId).delete();
        }
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
confirmPhoneEditBtn.addEventListener('click', savePhone);
cancelPhoneEditBtn.addEventListener('click', closePhoneEditModal);
searchButton.addEventListener('click', searchAppointments);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { searchAppointments(); } });
closeSearchResultsButton.addEventListener('click', () => { 
    searchResultsModal.style.display = 'none'; 
    document.body.classList.remove('modal-open');
});
searchResultsList.addEventListener('click', (e) => {
    const targetItem = e.target.closest('.result-item');
    if (targetItem) {
        jumpToDate(targetItem.dataset.timestamp);
    }
});
const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
activityEvents.forEach(eventName => { window.addEventListener(eventName, resetLogoutTimer, true); });

// --- 関数定義 ---

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
                  let dateObj = data.appointmentDateTime.toDate();

                  // 移行期間の暫定対応：特定の時間以前のデータは9時間引く
                  const transitionTimestamp = new Date('2025-10-26T02:00:00+09:00').getTime();
                  const processedAtTimestamp = data.processedAt ? data.processedAt.toDate().getTime() : 0;

                  if (processedAtTimestamp > 0 && processedAtTimestamp < transitionTimestamp) {
                      dateObj.setHours(dateObj.getHours() - 9);
                  }

                  const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'Asia/Tokyo' };
                  const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' };
                  const datePart = new Intl.DateTimeFormat('ja-JP', dateOptions).format(dateObj);
                  const timePart = new Intl.DateTimeFormat('ja-JP', timeOptions).format(dateObj);
                  displayDate = `${datePart}<br>${timePart}`;
              }
              const displayServicesText = (data.services || []).join(', ').toLowerCase().includes("audiologist") ? "Audiology" : (data.services || []).join(', ');
              const age = calculateAge(data.dateOfBirth);
              const displayAge = age ? `${age}` : '不明';
              const ageCellClass = data.isAgePink ? 'age-cell pink' : 'age-cell';

              tableRowsHTML += `
                  <tr data-id="${docId}" class="${rowClass}">
                      <td class="col-show show-toggle-cell">${checkmark}</td>
                      <td class="col-date date-cell">${displayDate}</td>
                      <td class="col-name name-cell">${data.claimantName || ''}</td>
                      <td class="col-age ${ageCellClass}">${displayAge}</td>
                      <td class="col-contract">${data.contractNumber || ''}</td>
                      <td class="col-phone phone-cell">${data.japanCellPhone || ''}</td>
                      <td class="col-services services-cell">${displayServicesText}</td>
                      <td class="col-actions">
                        <button class="view-pdf-btn">PDF</button>
                        <button class="delete-btn">削除</button>
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
      // JSTで年月日時分を取得するためのフォーマッタ
      const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Tokyo' }).format(dateObj);
      const month = new Intl.DateTimeFormat('en', { month: '2-digit', timeZone: 'Asia/Tokyo' }).format(dateObj);
      const day = new Intl.DateTimeFormat('en', { day: '2-digit', timeZone: 'Asia/Tokyo' }).format(dateObj);
      const hours = new Intl.DateTimeFormat('en', { hour: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' }).format(dateObj);
      const minutes = new Intl.DateTimeFormat('en', { minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(dateObj);
      dateSelect.value = `${year}-${month}-${day}`;
      timeSelect.value = `${hours}:${minutes}`;
    }
    editingDocId = docId;
    editModal.style.display = 'flex';
    document.body.classList.add('modal-open');
  });
}

function closeEditModal() {
    editModal.style.display = 'none';
    editingDocId = null;
    document.body.classList.remove('modal-open');
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
              document.body.classList.add('modal-open');
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
    const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'Asia/Tokyo' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' };
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
    detailsHTML += `<div class="detail-row detail-row-full">
                      <div class="detail-item"><strong>検査内容</strong><span>${(data.services || []).join(', ')}</span></div>
                    </div>`;

    detailsContentContainer.innerHTML = detailsHTML;
    notesTextarea.value = data.notes || '';
    
    detailsModal.dataset.editingId = docId;
    detailsModal.style.display = 'flex';
    document.body.classList.add('modal-open');
  });
}

function closeDetailsModal() {
    detailsModal.style.display = 'none';
    detailsModal.dataset.editingId = '';
    document.body.classList.remove('modal-open');
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
          if (querySnapshot.empty) {
              alert('選択された期間に、SHOWがチェックされたレコードはありませんでした。');
              return;
          }

          const allRecords = [];
          querySnapshot.forEach(doc => {
              const data = doc.data();
              let correctedDateObj = null;
              if (data.appointmentDateTime) {
                  let dateObj = data.appointmentDateTime.toDate();
                  const transitionTimestamp = new Date('2025-10-26T02:00:00+09:00').getTime();
                  const processedAtTimestamp = data.processedAt ? data.processedAt.toDate().getTime() : 0;
                  if (processedAtTimestamp > 0 && processedAtTimestamp < transitionTimestamp) {
                      dateObj.setHours(dateObj.getHours() - 9);
                  }
                  correctedDateObj = dateObj;
              }
              allRecords.push({ ...data, correctedDateObj: correctedDateObj });
          });

          const isAudiologistExamination = (service) => service.replace(/\s/g, '').toLowerCase().includes('audiologistexamination');
          
          // --- 1. Audiologyリストの作成 ---
          const audiologyRecords = allRecords
              .filter(record => {
                  const services = record.services || [];
                  return services.some(isAudiologistExamination);
              })
              .map(record => ({
                  contractNumber: record.contractNumber || '',
                  fee: 209000
              }));

          // --- 2. Day Rateリストの作成 ---
          const recordsByDate = {};
          allRecords.forEach(record => {
              if (record.correctedDateObj) {
                  const jstDateFormatter = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo' });
                  const jstDateString = jstDateFormatter.format(record.correctedDateObj).replace(/\//g, '-');
                  if (!recordsByDate[jstDateString]) {
                      recordsByDate[jstDateString] = [];
                  }
                  recordsByDate[jstDateString].push(record);
              }
          });

          const dayRateList = [];
          Object.keys(recordsByDate).forEach(date => {
              const dailyAppointments = recordsByDate[date];
              
              const isDayRateTarget = dailyAppointments.some(appt => {
                  const services = appt.services || [];
                  if (services.length === 0) return false;
                  return !services.some(isAudiologistExamination);
              });

              if (isDayRateTarget) {
                  let hasMorning = false;
                  let hasAfternoon = false;
                  dailyAppointments.forEach(appt => {
                      if (appt.correctedDateObj) {
                          const jstHour = parseInt(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' }).format(appt.correctedDateObj), 10);
                          if (jstHour < 12) hasMorning = true;
                          else hasAfternoon = true;
                      }
                  });
                  const dayRate = (hasMorning && hasAfternoon) ? 'Full Day Rate' : 'Half Day Rate';
                  dayRateList.push({ date: date, dayRate: dayRate, amount: '' });
              }
          });
          
          dayRateList.sort((a, b) => new Date(a.date) - new Date(b.date));

          generateNewInvoiceHTML(audiologyRecords, dayRateList, fromDateStr, toDateStr);
      })
      .catch(error => {
          console.error("Invoiceデータの取得エラー: ", error);
          alert("データの取得中にエラーが発生しました。コンソールでエラー内容を確認してください。\n（複合インデックスの作成が必要な場合があります）");
      });
}

function generateNewInvoiceHTML(audiologyRecords, dayRateList, from, to) {
    const audiologyTotal = audiologyRecords.reduce((sum, record) => sum + record.fee, 0);

    const invoiceHTML = `
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <title>Invoice and Day Rate Sheet</title>
            <style>
                body { font-family: 'Helvetica Neue', Arial, sans-serif; }
                .page-container { max-width: 800px; margin: auto; padding: 20px; }
                h1, h2 { text-align: center; color: #333; }
                h1 { font-size: 24px; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 10px;}
                h2 { font-size: 18px; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ccc; padding: 10px; text-align: left; font-size: 14px; }
                th { background-color: #f2f2f2; font-weight: bold; }
                tfoot td { font-weight: bold; font-size: 16px; background-color: #f9f9f9; }
                .fee-cell { text-align: right; }
                .button-area { margin-top: 30px; text-align: center; }
                .day-rate-sheet { page-break-before: always; } /* 2ページ目の開始 */
                @media print {
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <!-- 1ページ目: Audiology Invoice -->
            <div class="page-container">
                <h1>Audiology Invoice</h1>
                <h2>Period: ${from} to ${to}</h2>
                <table>
                    <thead>
                        <tr>
                            <th>契約番号</th>
                            <th class="fee-cell">検査費</th>
                        </tr>
                    </thead>
                    <tbody id="audiology-tbody">
                        </tbody>
                    <tfoot>
                        <tr>
                            <td style="text-align: right;"><strong>合計:</strong></td>
                            <td class="fee-cell">${audiologyTotal.toLocaleString()}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <!-- 2ページ目: Day Rate Sheet -->
            <div class="page-container day-rate-sheet">
                <h1>Day Rate Sheet</h1>
                <h2>Period: ${from} to ${to}</h2>
                <table>
                    <thead>
                        <tr>
                            <th>日付</th>
                            <th>Day Rate</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody id="dayrate-tbody">
                        </tbody>
                </table>
            </div>
            
            <div class="button-area no-print">
                <button onclick="window.print()">このページを印刷</button>
            </div>
        </body>
        </html>
    `;

    const newWindow = window.open('', '_blank');
    newWindow.document.write(invoiceHTML);
    
    // Audiologyテーブルの内容を書き込み
    let audiologyRows = '';
    audiologyRecords.forEach(data => {
        audiologyRows += `
            <tr>
                <td>${data.contractNumber}</td>
                <td class="fee-cell">${data.fee.toLocaleString()}</td>
            </tr>
        `;
    });
    newWindow.document.getElementById('audiology-tbody').innerHTML = audiologyRows;

    // Day Rateテーブルの内容を書き込み
    let dayRateRows = '';
    dayRateList.forEach(data => {
        dayRateRows += `
            <tr>
                <td>${data.date}</td>
                <td>${data.dayRate}</td>
                <td>${data.amount}</td>
            </tr>
        `;
    });
    newWindow.document.getElementById('dayrate-tbody').innerHTML = dayRateRows;

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
        document.body.classList.add('modal-open');
    });
}

function closeServicesEditModal() {
    editServicesModal.style.display = 'none';
    editingDocId = null;
    document.body.classList.remove('modal-open');
}

function openPhoneEditModal(docId) {
    db.collection('appointments').doc(docId).get().then(doc => {
        if (!doc.exists) {
            alert('データが見つかりません');
            return;
        }
        const data = doc.data();
        phoneInput.value = data.japanCellPhone || '';
        
        editingDocId = docId;
        editPhoneModal.style.display = 'flex';
        document.body.classList.add('modal-open');
    });
}

function closePhoneEditModal() {
    editPhoneModal.style.display = 'none';
    editingDocId = null;
    document.body.classList.remove('modal-open');
}

function savePhone() {
    if (!editingDocId) return;

    const newPhone = phoneInput.value.trim();

    db.collection('appointments').doc(editingDocId).update({
        japanCellPhone: newPhone
    })
    .then(() => {
        console.log('電話番号を更新しました。');
        closePhoneEditModal();
    })
    .catch(error => {
        console.error('電話番号の更新エラー:', error);
        alert('電話番号の更新に失敗しました。');
    });
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
