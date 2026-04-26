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
const hourSelect = document.getElementById('hourSelect');
const minuteSelect = document.getElementById('minuteSelect');
const confirmEditBtn = document.getElementById('confirmEdit');
const cancelEditBtn = document.getElementById('cancelEdit');
// 詳細表示モーダル
const detailsModal = document.getElementById('detailsModal');
const detailsContentContainer = document.getElementById('details-content-container');
const notesTextarea = document.getElementById('notesTextarea');
const saveNotesButton = document.getElementById('saveNotesButton');
const closeDetailsModalButton = document.getElementById('closeDetailsModalButton');
// Invoice印刷用
const invoiceYearSelect = document.getElementById('invoiceYearSelect');
const invoiceMonthSelect = document.getElementById('invoiceMonthSelect');
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
// 紹介状モーダル
const shokaijyoModal          = document.getElementById('shokaijyoModal');
const shokaijyoSheetContainer = document.getElementById('shokaijyoSheetContainer');
const shokaijyoModalTitle     = document.getElementById('shokaijyoModalTitle');
const saveShokaijyoBtn        = document.getElementById('saveShokaijyoBtn');
const printShokaijyoBtn       = document.getElementById('printShokaijyoBtn');
const closeShokaijyoBtn       = document.getElementById('closeShokaijyoBtn');
// 受診日モーダル
const visitDateModal      = document.getElementById('visitDateModal');
const visitDateInput      = document.getElementById('visitDateInput');
const confirmVisitDateBtn = document.getElementById('confirmVisitDateBtn');
const cancelVisitDateBtn  = document.getElementById('cancelVisitDateBtn');


// --- グローバル変数 ---
let logoutTimer;
let editingDocId = null;
let unsubscribe;

// --- 紹介先 定数 ---
// CLAUDE_API_KEY は config.js で定義（.gitignore済み）
const REFERRAL_DISPLAY = { ASBO: 'aSBo', KIN: 'KINSP', ANSHIN: 'ANSIN' };
const REFERRAL_FULL = {
    ASBO:   { name: 'aSBoメディカルクリニック',     doctor: '梁先生、望月 先生' },
    KIN:    { name: 'KINスポーツ・整形クリニック',  doctor: '新庄 琢磨 先生' },
    ANSHIN: { name: '沖縄北あんしん内科クリニック',  doctor: '山口 怜 先生' }
};
const SHOKAIJO_SENDER = {
    name: 'ニライシーサイドクリニック',
    address: '沖縄県国頭郡恩納村瀬良垣',
    tel: '090-4524-2828',
    doctor: '廣安 俊吾'
};
let shokaijyoEditingDocId = null;
let shokaijyoEditingDest  = null;
let visitDateEditingDocId = null;

// 子ウィンドウからのノート更新を処理する関数 
function updateAppointmentNote(docId, newNote) {
  // 予約リストが表示されている場合は再読み込みする
  if (unsubscribe) {
    setupRealtimeListener();
  }
}

// 年選択のプルダウンを動的に生成
function generateYearOptions() {
    const currentYear = new Date().getFullYear();
    
    // 過去3年分＋現在年を生成
    for (let year = currentYear - 3; year <= currentYear; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year + '年';
        invoiceYearSelect.appendChild(option);
    }
    
    // デフォルトで現在の年と月を選択
    invoiceYearSelect.value = currentYear;
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    invoiceMonthSelect.value = currentMonth;
}

// 選択された年月から月の最終日を取得
function getLastDayOfMonth(year, month) {
    // 翌月の0日目 = 当月の最終日
    return new Date(year, parseInt(month), 0).getDate();
}

// --- ログイン状態の監視 ---
auth.onAuthStateChanged(user => {
    if (user) {
        loginContainer.style.display = 'none';
        mainAppContainer.style.display = 'block';
        userEmailSpan.textContent = user.email;
        
        // 年選択オプションを生成
        generateYearOptions();

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
    if (target.classList.contains('referral-dest')) {
        const destKey = target.dataset.dest;
        openShokaijyoModal(docId, destKey);
        return;
    }
    if (target.classList.contains('visitdate-cell')) {
        openVisitDateModal(docId);
        return;
    }
    if (target.classList.contains('received-cell')) {
        const docRef = db.collection('appointments').doc(docId);
        docRef.get().then(doc => {
            if (doc.exists) docRef.update({ isReceived: !doc.data().isReceived });
        });
        return;
    }
    if (target.classList.contains('completed-cell')) {
        const docRef = db.collection('appointments').doc(docId);
        docRef.get().then(doc => {
            if (doc.exists) docRef.update({ isCompleted: !doc.data().isCompleted });
        });
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
    if (!dateSelect.value || !hourSelect.value || !minuteSelect.value || !editingDocId) return;
    const timeValue = `${hourSelect.value}:${minuteSelect.value}`;

    // 2025/10/26以降のデータはJST（UTC+9）として保存する
    // JSTの日時文字列からJST日時オブジェクトを作成
    const jstDateTimeStr = `${dateSelect.value}T${timeValue}:00+09:00`;
    const dateInJST = new Date(jstDateTimeStr);
    
    // 現在の日時とprocessedAtを取得/更新して日時保存処理を決定
    const now = new Date();
    const processedAt = firebase.firestore.Timestamp.fromDate(now);
    
    // 日時をFirestoreのTimestampに変換
    const newTimestamp = firebase.firestore.Timestamp.fromDate(dateInJST);
    
    const dataToUpdate = {
        appointmentDate: `${dateSelect.value}T${timeValue}:00`,
        appointmentDateTime: newTimestamp,
        processedAt: processedAt // 処理日時を記録（タイムスタンプ判定用）
    };
    
    db.collection('appointments').doc(editingDocId).update(dataToUpdate)
      .then(() => closeEditModal())
      .catch(error => {
          console.error('更新エラー:', error);
          alert('更新に失敗しました。');
      });
});

cancelEditBtn.addEventListener('click', closeEditModal);
saveNotesButton.addEventListener('click', saveNotes);
closeDetailsModalButton.addEventListener('click', closeDetailsModal);
printInvoiceButton.addEventListener('click', printInvoice);
confirmServicesEditBtn.addEventListener('click', saveServices);
cancelServicesEditBtn.addEventListener('click', closeServicesEditModal);
confirmPhoneEditBtn.addEventListener('click', savePhone);
cancelPhoneEditBtn.addEventListener('click', closePhoneEditModal);
saveShokaijyoBtn.addEventListener('click', saveShokaijyo);
printShokaijyoBtn.addEventListener('click', printShokaijyo);
closeShokaijyoBtn.addEventListener('click', closeShokaijyoModal);
confirmVisitDateBtn.addEventListener('click', saveVisitDate);
cancelVisitDateBtn.addEventListener('click', closeVisitDateModal);
searchButton.addEventListener('click', searchAppointments);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { searchAppointments(); } });
closeSearchResultsButton.addEventListener('click', () => { 
    searchResultsModal.style.display = 'none'; 
    document.body.classList.remove('modal-open');
});
searchResultsList.addEventListener('click', (e) => {
    const targetItem = e.target.closest('.result-item');
    if (targetItem) {
        // 変更: dataset.timestampからdataset.dateを使用する
        dateFilter.value = targetItem.dataset.date;
        dateFilter.dispatchEvent(new Event('change'));
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
    // JSTの日付を明示的に指定
    const filterDate = new Date(`${localDateStr}T00:00:00+09:00`);
    unsubscribe = db.collection("appointments")
      .where("appointmentDateTime", ">=", filterDate)
      .onSnapshot(querySnapshot => {
          const appointments = [];
          querySnapshot.forEach(doc => {
              appointments.push({ id: doc.id, ...doc.data() });
          });
          // ソート前に各アポイントメントの表示用時間を計算・付与する
          appointments.forEach(appointment => {
              if (appointment.appointmentDateTime) {
                  let dateObj = appointment.appointmentDateTime.toDate();
                  const transitionTimestamp = new Date('2025-10-26T00:00:00+09:00').getTime();
                  const processedAtTimestamp = appointment.processedAt ? appointment.processedAt.toDate().getTime() : 0;
                  
                  // 古いデータと新しいデータで比較可能な「補正済み時間」を作成
                  let normalizedDateObj = new Date(dateObj);
                  if (processedAtTimestamp > 0 && processedAtTimestamp < transitionTimestamp) {
                      // 古いデータ: UTCから9時間引いてJST表示用に調整
                      normalizedDateObj.setHours(normalizedDateObj.getHours() - 9);
                  }
                  // 新しいデータはそのまま（既にJSTで保存されている）
                  
                  // ソート用のミリ秒値を付与
                  appointment._sortTimeMillis = normalizedDateObj.getTime();
              } else {
                  appointment._sortTimeMillis = 0;
              }
          });
          
          // 補正済みの時間でソート
          appointments.sort((a, b) => {
              return a._sortTimeMillis - b._sortTimeMillis;
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

          // 日時調整のロジック
          // - 10/26より前のデータ: 元々UTC保存のため9時間引いてJST表示
          // - 10/26以降のデータ: 既にJST保存になっているため調整不要
          const transitionTimestamp = new Date('2025-10-26T00:00:00+09:00').getTime();
          const processedAtTimestamp = data.processedAt ? data.processedAt.toDate().getTime() : 0;

          if (processedAtTimestamp > 0 && processedAtTimestamp < transitionTimestamp) {
              // 古いデータ(10/26より前): UTCから9時間引いてJST表示
              dateObj.setHours(dateObj.getHours() - 9);
          }
          // 新しいデータ(10/26以降): そのまま表示(既にJSTで保存されている)

                  const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'Asia/Tokyo' };
                  const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' };
                  const datePart = new Intl.DateTimeFormat('ja-JP', dateOptions).format(dateObj);
                  const timePart = new Intl.DateTimeFormat('ja-JP', timeOptions).format(dateObj);
                  displayDate = `${datePart}<br>${timePart}`;
              }
              const displayServicesText = (data.services || []).join(', ').toLowerCase().includes("audiologist") ? "Audiology" : (data.services || []).join(', ');

              // 紹介先・受診日・受・済（フラット構造）
              const referralDests = determineReferralDests(data.services || []);
              const savedReferrals = data.referrals || {};
              const referralHTML   = referralDests.map(dk => {
                  const isSaved = !!(savedReferrals[dk] && savedReferrals[dk].savedAt);
                  return `<span class="referral-dest${isSaved ? ' saved' : ''}" data-dest="${dk}">${REFERRAL_DISPLAY[dk]}</span>`;
              }).join('');
              const visitdateHTML  = data.visitDate   || '';
              const receivedHTML   = data.isReceived  ? '✅' : '';
              const completedHTML  = data.isCompleted ? '✅' : '';

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
                      <td class="col-referral">${referralHTML}</td>
                      <td class="col-visitdate visitdate-cell">${visitdateHTML}</td>
                      <td class="col-received received-cell">${receivedHTML}</td>
                      <td class="col-completed completed-cell">${completedHTML}</td>
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
    // 自動ログアウト機能は無効化されています（時間制限なし）
}

function handleViewPdf(docId) {
    db.collection('appointments').doc(docId).get().then(doc => {
        if (!doc.exists) return alert('データベースにレコードが見つかりません。');
        const fileName = doc.data().originalFileName;
        if (!fileName) return alert('このレコードにPDFファイルは関連付けられていません。');
        
        console.log("PDF表示試行:", fileName);
        
        // 複数のパスパターンを試す
        tryMultiplePaths(fileName);
    });
}

function tryMultiplePaths(fileName) {
    // パスのバリエーションを試す
    const pathVariations = [
        fileName,                    // そのままのファイル名
        `pdfs/${fileName}`,          // pdfsフォルダ内
        fileName.toLowerCase(),      // 小文字化
        fileName.replace(/\s+/g, '_'), // スペースを_に置換
        encodeURIComponent(fileName) // URLエンコード
    ];
    
    // 最初のパスから順に試す
    tryNextPath(pathVariations, 0, fileName);
}

function tryNextPath(paths, index, originalFileName) {
    if (index >= paths.length) {
        // すべてのパスを試しても見つからなかった
        console.error("すべてのパスバリエーションで見つかりませんでした:", originalFileName);
        alert(`PDFファイル「${originalFileName}」がストレージ内に見つかりませんでした。`);
        return;
    }
    
    const currentPath = paths[index];
    console.log(`パスパターン試行 (${index+1}/${paths.length}): ${currentPath}`);
    
    storage.ref(currentPath).getDownloadURL()
        .then(url => {
            console.log("PDF見つかりました:", currentPath);
            window.open(url, '_blank');
        })
        .catch(error => {
            if (error.code === 'storage/object-not-found') {
                console.log(`パスパターン ${index+1} では見つかりませんでした、次を試します`);
                // 次のパスパターンを試す
                tryNextPath(paths, index + 1, originalFileName);
            } else {
                console.error("PDF取得エラー:", error.code, error.message, currentPath);
                alert(`PDFの表示中にエラーが発生しました: ${error.message}`);
            }
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
      hourSelect.value = hours.padStart(2, '0');
      minuteSelect.value = minutes.padStart(2, '0');
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
        alert('検索する契約番号または氏名を入力してください。');
        return;
    }

    // 数字のみ → 契約番号検索（既存ロジック）
    if (/^\d+$/.test(searchTerm)) {
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
              handleSearchResults(querySnapshot.docs, searchTerm);
          })
          .catch(error => {
              console.error("検索エラー: ", error);
              alert("検索中にエラーが発生しました。");
          });
        return;
    }

    // それ以外 → 氏名検索（全件取得＋クライアント側部分一致）
    db.collection("appointments")
      .get()
      .then(querySnapshot => {
          const matched = querySnapshot.docs.filter(doc => {
              const name = doc.data().claimantName || '';
              return nameMatches(name, searchTerm);
          });
          if (matched.length === 0) {
              alert('該当する氏名の予約が見つかりませんでした。');
              return;
          }
          handleSearchResults(matched, searchTerm);
      })
      .catch(error => {
          console.error("検索エラー: ", error);
          alert("検索中にエラーが発生しました。");
      });
}

// 氏名の部分一致マッチング
// 保存形式: "JONES, JONATHAN"（姓, 名、大文字）
// 対応: 姓のみ / 名のみ / 姓名 / 名姓 / カンマあり / 大文字小文字不問
function nameMatches(storedName, searchTerm) {
    if (!storedName) return false;
    const nameTokens = storedName.toLowerCase().split(/[,\s]+/).filter(Boolean);
    const searchTokens = searchTerm.toLowerCase().split(/[,\s]+/).filter(Boolean);
    return searchTokens.every(st => nameTokens.some(nt => nt === st));
}

function handleSearchResults(docs, searchTerm) {
    if (docs.length === 1) {
        const doc = docs[0];
        jumpToDate(doc.data().appointmentDateTime);
        alert(`「${searchTerm}」の予約日にジャンプしました。`);
        return;
    }

    let resultsHTML = '';
    docs.forEach(doc => {
        const data = doc.data();
        const dateObj = data.appointmentDateTime.toDate();

        let correctedDateObj = dateObj;
        const transitionTimestamp = new Date('2025-10-26T00:00:00+09:00').getTime();
        const processedAtTimestamp = data.processedAt ? data.processedAt.toDate().getTime() : 0;
        if (processedAtTimestamp > 0 && processedAtTimestamp < transitionTimestamp) {
            correctedDateObj = new Date(dateObj.getTime());
            correctedDateObj.setHours(correctedDateObj.getHours() - 9);
        }

        const jstOptions = { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' };
        const targetDate = new Intl.DateTimeFormat('en-CA', jstOptions).format(correctedDateObj);

        resultsHTML += `<div class="result-item" data-date="${targetDate}"><span>${data.claimantName}</span><span>${targetDate}</span></div>`;
    });
    searchResultsList.innerHTML = resultsHTML;
    searchResultsModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function jumpToDate(timestamp) {
    if (!timestamp) {
        alert('該当の予約には日付が設定されていません。');
        return;
    }
    const dateObj = timestamp.toDate();
    
    // 日時調整のロジック - 表示関数と同じロジックを適用
    // - 10/26より前のデータ: 元々UTC保存のため9時間引いてJST表示
    // - 10/26以降のデータ: 既にJST保存になっているため調整不要
    const transitionTimestamp = new Date('2025-10-26T00:00:00+09:00').getTime();
    const processedAtTimestamp = timestamp.seconds * 1000; // タイムスタンプを秒からミリ秒に変換
    if (processedAtTimestamp > 0 && processedAtTimestamp < transitionTimestamp) {
        dateObj.setHours(dateObj.getHours() - 9);
    }
    // 10/26以降のデータはそのまま使用（すでにJSTで保存されている）
    
    // 日本時間での日付を取得（YYYY-MM-DD形式）
    const jstOptions = { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' };
    const targetDate = new Intl.DateTimeFormat('en-CA', jstOptions).format(dateObj);
    
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

    // 日付と時刻のフォーマット設定
    const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'Asia/Tokyo' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' };
    const displayDate = data.appointmentDateTime
        ? new Intl.DateTimeFormat('ja-JP', dateOptions).format(data.appointmentDateTime.toDate()) + ' ' +
          new Intl.DateTimeFormat('ja-JP', timeOptions).format(data.appointmentDateTime.toDate())
        : '日付なし';

    const age = calculateAge(data.dateOfBirth);
    const displayAge = age ? `${age}歳` : '不明';

    // 新しいウィンドウで表示するための完全なHTMLを生成
    const detailsPageHTML = `
      <!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <title>予約詳細</title>
        <style>
          html, body { 
            font-family: 'Helvetica Neue', sans-serif;
            background: #eef5f9;
            color: #333;
            margin: 0;
            padding: 0;
            height: 100%;
            width: 100%;
          }
          .page-container {
            width: 95%;
            max-width: 1200px;
            min-height: 95vh;
            margin: 16px auto;
            background: #fff;
            padding: 24px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.06);
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
          }
          h1 {
            font-size: 28px;
            margin-top: 0;
            border-bottom: 1px solid #ddd;
            padding-bottom: 16px;
          }
          .detail-row {
            display: flex;
            margin-bottom: 20px;
            flex-wrap: wrap;
          }
          .detail-row-full {
            flex-direction: column;
          }
          .detail-item {
            flex: 1;
            min-width: 300px;
            margin-bottom: 12px;
            font-size: 16px;
          }
          .detail-item strong {
            display: inline-block;
            width: 140px;
            font-weight: bold;
          }
          .detail-item span {
            font-size: 16px;
          }
          .content-area {
            flex: 1;
            display: flex;
            flex-direction: column;
          }
          textarea {
            width: 100%;
            flex: 1;
            min-height: 300px;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 12px;
            margin-top: 10px;
            font-family: inherit;
            font-size: 15px;
            line-height: 1.5; /* メモ欄の行間を広げて読みやすく */
            box-sizing: border-box;
          }
          .button-area {
            margin-top: 24px;
            text-align: right;
          }
          button {
            background: #007acc;
            color: white;
            padding: 10px 20px;
            font-size: 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            margin-left: 10px;
          }
          button:hover {
            background: #005fa3;
          }
          label {
            display: block;
            font-weight: bold;
            margin-top: 20px;
            font-size: 16px;
          }
        </style>
      </head>
      <body>
        <div class="page-container">
          <h1>予約詳細</h1>
          
          <div class="detail-row">
            <div class="detail-item"><strong>予約日時</strong><span>${displayDate.replace('<br>',' ')}</span></div>
            <div class="detail-item"><strong>契約番号</strong><span>${data.contractNumber || ''}</span></div>
          </div>
          <div class="detail-row">
            <div class="detail-item"><strong>氏名</strong><span>${data.claimantName || ''}</span></div>
            <div class="detail-item"><strong>生年月日(年齢)</strong><span>${data.dateOfBirth || ''} (${displayAge})</span></div>
          </div>
          <div class="detail-row detail-row-full">
            <div class="detail-item"><strong>検査内容</strong><span>${(data.services || []).join(', ')}</span></div>
          </div>
          
          <div class="content-area">
            <label for="notesTextarea">メモ (所見など):</label>
            <textarea id="notesTextarea" placeholder="1500文字程度まで入力可能...">${data.notes || ''}</textarea>
          </div>
          
          <div class="button-area">
            <button id="saveNotesButton">メモを保存</button>
            <button id="closeButton">閉じる</button>
          </div>
        </div>

        <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
        <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
        <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
        <script>
          // Firebase関連の初期化 - 新しいウィンドウで直接初期化
          const firebaseConfig = {
            apiKey: "AIzaSyBIkxaIgnjkrOYfx3oyA0BGX5dubL5QhvI",
            authDomain: "sos-list-4d150.firebaseapp.com",
            projectId: "sos-list-4d150",
            storageBucket: "sos-list-4d150.firebasestorage.app",
            messagingSenderId: "455081821929",
            appId: "1:455081821929:web:da87d8dd1f16bbe99e9278",
            measurementId: "G-H3GQ56JJD8"
          };
          
          // 新しいウィンドウで直接Firebaseを初期化
          firebase.initializeApp(firebaseConfig);
          const db = firebase.firestore();
          const auth = firebase.auth();
          
          // 親ウィンドウから認証情報を取得
          const parentUser = window.opener.firebase.auth().currentUser;
          if (parentUser) {
            // カスタムトークンを使用して認証を維持
            auth.signInWithCustomToken = function(token) {
              return new Promise((resolve) => {
                setTimeout(() => resolve(), 100);
              });
            };
            
            // 認証状態をシミュレート
            auth.onAuthStateChanged = function(callback) {
              callback(parentUser);
              return function() {};
            };
          }
          
          const docId = "${docId}";
          
          // ボタンにイベントリスナーを設定
          document.getElementById('saveNotesButton').addEventListener('click', () => {
            const notesTextarea = document.getElementById('notesTextarea');
            
            // 保存中の表示
            const saveButton = document.getElementById('saveNotesButton');
            const originalText = saveButton.textContent;
            saveButton.textContent = '保存中...';
            saveButton.disabled = true;
            
            db.collection('appointments').doc(docId).update({
              notes: notesTextarea.value
            })
            .then(() => {
              alert('メモを保存しました。');
              // 元のボタンテキストに戻す
              saveButton.textContent = originalText;
              saveButton.disabled = false;
              
              // 親ウィンドウのデータも更新 (オプション)
              if (window.opener && !window.opener.closed) {
                try {
                  window.opener.updateAppointmentNote(docId, notesTextarea.value);
                } catch (e) {
                  // 親ウィンドウの更新に失敗しても続行
                  console.log('親ウィンドウの更新はスキップされました');
                }
              }
            })
            .catch(error => {
              alert('メモの保存に失敗しました。エラー: ' + error.message);
              console.error(error);
              saveButton.textContent = originalText;
              saveButton.disabled = false;
            });
          });
          
          document.getElementById('closeButton').addEventListener('click', () => {
            window.close();
          });
          
        </script>
      </body>
      </html>
    `;

    // 新しいウィンドウを開き、HTML内容を書き込む
    const newWindow = window.open('', '_blank');
    newWindow.document.write(detailsPageHTML);
    newWindow.document.close();
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
    const selectedYear = invoiceYearSelect.value;
    const selectedMonth = invoiceMonthSelect.value;
    
    // 選択された年月の最初の日と最後の日を計算
    const lastDay = getLastDayOfMonth(selectedYear, selectedMonth);
    const fromDateStr = `${selectedYear}-${selectedMonth}-01`;
    const toDateStr = `${selectedYear}-${selectedMonth}-${lastDay}`;

    console.log(`印刷期間: ${fromDateStr} から ${toDateStr}`);

    // 日付範囲のUTCタイムスタンプを作成（クエリに使用）
    // JSTの日付から大まかな日付範囲でクエリを行う
    const fromDate = firebase.firestore.Timestamp.fromDate(new Date(`${fromDateStr}T00:00:00+09:00`));
    // 翌日の00:00(JST)より1分前まで = 当日の23:59まで
    const nextDayStr = new Date(`${toDateStr}T00:00:00+09:00`);
    nextDayStr.setDate(nextDayStr.getDate() + 1);
    const toDate = firebase.firestore.Timestamp.fromDate(nextDayStr);

    db.collection("appointments")
      .where("isShown", "==", true)
      .get()
      .then(querySnapshot => {
          if (querySnapshot.empty) {
              alert('SHOWがチェックされたレコードはありませんでした。');
              return;
          }

          const allRecords = [];
          querySnapshot.forEach(doc => {
              const data = doc.data();
              if (!data.appointmentDateTime) return;
              
              let dateObj = data.appointmentDateTime.toDate();
              
              // 日時調整のロジック - 表示関数と同じロジックを適用
              const transitionTimestamp = new Date('2025-10-26T00:00:00+09:00').getTime();
              const processedAtTimestamp = data.processedAt ? data.processedAt.toDate().getTime() : 0;
              if (processedAtTimestamp > 0 && processedAtTimestamp < transitionTimestamp) {
                  // 古いデータ(10/26より前): UTCから9時間引いてJST表示
                  dateObj.setHours(dateObj.getHours() - 9);
              }
              // 新しいデータ(10/26以降): そのまま表示(既にJSTで保存されている)
              
              // 日本時間での日付を取得（YYYY-MM-DD形式）
              const jstOptions = { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' };
              const jstDateStr = new Intl.DateTimeFormat('en-CA', jstOptions).format(dateObj);
              
              // fromDateStr以上、toDateStr以下の日付のみを対象にする（時刻は考慮しない）
              if (jstDateStr >= fromDateStr && jstDateStr <= toDateStr) {
                  allRecords.push({ ...data, correctedDateObj: dateObj, jstDateStr: jstDateStr });
              }
          });

          const isAudiologistExamination = (service) => service.trim().toLowerCase() === 'audiologist examination';
          
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
                  return services.some(s => !isAudiologistExamination(s));
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
        editServicesModal.style.display = 'flex';
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

// ===== 紹介先 分類ロジック =====
function classifyServices(services) {
    const arr = (services || []).map(s => s.replace(/\s*\(.*$/, '').trim());
    return {
        has_nasal:      arr.some(s => /NASAL|SINUS/i.test(s)),
        has_echo:       arr.some(s => /ECHO/i.test(s)),
        has_chest_xray: arr.some(s => /CHEST/i.test(s)),
        has_ecg:        arr.some(s => /ECG|EKG/i.test(s)),
        has_ortho:      arr.some(s => /COMPLETE|X[\s-]?RAY|XRAY|RADIOGRAPH/i.test(s) &&
                                     !/CHEST|NASAL|SINUS/i.test(s))
    };
}

function determineReferralDests(services, classification) {
    // AIキャッシュがあればそれを使用、なければ正規表現フォールバック
    let e;
    if (classification) {
        e = {
            has_nasal:      !!classification.has_nasal,
            has_echo:       !!classification.has_echo,
            has_chest_xray: !!classification.has_chest_xray,
            has_ecg:        !!classification.has_ecg,
            has_ortho:      !!(classification.ortho_xrays_jp && classification.ortho_xrays_jp.length > 0)
        };
    } else {
        e = classifyServices(services);
    }
    const dests = [];
    if (e.has_nasal) dests.push('ASBO');
    if (e.has_ortho) dests.push('KIN');
    if (e.has_echo)  dests.push('ANSHIN');
    const kinTakesChest = e.has_ortho && e.has_chest_xray && !e.has_ecg && !e.has_echo;
    if (!e.has_echo && !dests.includes('ASBO')) {
        if ((e.has_chest_xray && !kinTakesChest) || e.has_ecg) {
            dests.push('ASBO');
        }
    }
    return dests.slice(0, 3);
}

// ===== AI 検査分類 (shokaijo-sakusei.html と同等) =====
async function classifyServicesWithAI(services) {
    const arr = (services || []).map(s => s.replace(/\s*\(.*$/, '').trim()).filter(s => s.length > 0);
    if (arr.length === 0) return { ortho_xrays_jp: [], has_echo: false, has_chest_xray: false, has_nasal: false, has_ecg: false };

    const prompt = `以下は米国退役軍人の健康診断で依頼された検査サービスの一覧です（英語）。
各項目を分類して、JSON形式で返してください。

サービス一覧:
${arr.map((s, i) => `${i + 1}. ${s}`).join('\n')}

返却するJSONの形式:
{
  "has_chest_xray": true/false,
  "has_nasal": true/false,
  "has_echo": true/false,
  "has_ecg": true/false,
  "ortho_xrays_jp": []
}
★ortho_xrays_jp: "COMPLETE","X-RAY","XRAY","RADIOGRAPH"などのキーワードがある整形外科レントゲンのみ。部位名を日本語で（例:"右膝関節レントゲン3方向"）。胸部・鼻骨は除く。

JSONのみ返してください。`;

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": CLAUDE_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                "anthropic-dangerous-direct-browser-access": "true"
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 512,
                messages: [{ role: "user", content: prompt }]
            })
        });
        const data = await res.json();
        const text = data.content?.[0]?.text?.trim() || '{}';
        const json = JSON.parse(text.replace(/^```json\n?|```$/g, ''));
        return {
            ortho_xrays_jp: json.ortho_xrays_jp || [],
            has_echo:       !!json.has_echo,
            has_chest_xray: !!json.has_chest_xray,
            has_nasal:      !!json.has_nasal,
            has_ecg:        !!json.has_ecg
        };
    } catch (e) {
        console.error('AI分類エラー:', e);
        return {
            ortho_xrays_jp: [],
            has_echo:       arr.some(s => /echo/i.test(s)),
            has_chest_xray: arr.some(s => /chest/i.test(s)),
            has_nasal:      arr.some(s => /nasal/i.test(s)),
            has_ecg:        arr.some(s => /ecg|ekg/i.test(s))
        };
    }
}

// ===== カタカナ変換 =====
async function convertToKatakana(nameEn) {
    if (!nameEn) return '';
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": CLAUDE_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                "anthropic-dangerous-direct-browser-access": "true"
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 100,
                messages: [{ role: "user", content: `"${nameEn}"を日本語のカタカナに変換してください。カタカナのみ返してください。` }]
            })
        });
        const data = await res.json();
        if (data.error) {
            console.error('カタカナ変換APIエラー:', data.error);
            return '';
        }
        return data.content?.[0]?.text?.trim() || '';
    } catch (e) {
        console.error('カタカナ変換エラー:', e);
        return '';
    }
}

// ===== 紹介状モーダル =====
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function shokaijyoSelectSex(el) {
    const siblings = el.parentElement.querySelectorAll('.sex-option');
    siblings.forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
}

function buildSheetHTML(patientData, destKey, saved, classification) {
    const dest = REFERRAL_FULL[destKey];
    const today = new Date();
    const reiwa = today.getFullYear() - 2018;
    const dateStr = `令和${reiwa}年${today.getMonth() + 1}月${today.getDate()}日`;

    const nameParts = (patientData.claimantName || '').split(',').map(s => s.trim());
    const nameEn = nameParts.length === 2
        ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1).toLowerCase() + ' ' +
          nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1).toLowerCase()
        : (patientData.claimantName || '');

    const dobRaw = patientData.dateOfBirth || '';
    let dobFormatted = dobRaw;
    const dobM = dobRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dobM) dobFormatted = `${dobM[3]}年${parseInt(dobM[1])}月${parseInt(dobM[2])}日`;
    const ageVal = calculateAge(dobRaw) || '';

    // AIキャッシュがあれば優先、なければ正規表現
    const e = classification
        ? { ...classification, has_ortho: !!(classification.ortho_xrays_jp && classification.ortho_xrays_jp.length > 0) }
        : classifyServices(patientData.services);
    const items = [];
    if (destKey === 'ASBO') {
        if (e.has_nasal)      items.push('鼻骨レントゲン(3方向)');
        if (e.has_chest_xray) items.push('胸部レントゲン2方向');
        if (e.has_ecg)        items.push('心電図');
    } else if (destKey === 'KIN') {
        const ortho = classification && classification.ortho_xrays_jp && classification.ortho_xrays_jp.length > 0
            ? classification.ortho_xrays_jp
            : ['整形外科レントゲン'];
        items.push(...ortho);
    } else {
        if (e.has_echo)       items.push('心エコー検査');
        if (e.has_chest_xray) items.push('胸部レントゲン2方向');
    }
    const defaultPurpose = items.length > 0 ? items.join('、') + 'の依頼' : '検査依頼';

    let defaultClinical = '';
    if (destKey === 'ASBO' || destKey === 'KIN') {
        defaultClinical = 'レントゲンは写真があれば特に読影は必要ないですが、写真の送付が困難であれば読影レポートをお願いします。';
    } else if (destKey === 'ANSHIN' && e.has_echo) {
        defaultClinical = '心エコーのレポートはLVEF(%), wall motion, wall thicknessに言及頂けると幸いです。';
    }

    const defaultMessage = 'いつもお世話になっております。\n結果をPDF (or CD)で頂けると幸いです。よろしくお願いいたします。';
    const isFemale = patientData.isAgePink === true;

    const v = saved || {};
    const kana     = v.name_kana !== undefined ? v.name_kana : '';
    const en       = v.name_en   !== undefined ? v.name_en   : nameEn;
    const dob      = v.dob       !== undefined ? v.dob       : dobFormatted;
    const age      = v.age       !== undefined ? v.age       : String(ageVal);
    const phone    = v.phone     !== undefined ? v.phone     : (patientData.japanCellPhone || '');
    const injury   = v.injury    !== undefined ? v.injury    : '(主訴) ';
    const purpose  = v.purpose   !== undefined ? v.purpose   : defaultPurpose;
    const history  = v.history   !== undefined ? v.history   : '';
    const clinical = v.clinical  !== undefined ? v.clinical  : defaultClinical;
    const message  = v.message   !== undefined ? v.message   : defaultMessage;
    const gender   = v.gender    !== undefined ? v.gender    : (isFemale ? 'F' : 'M');

    const maleClass   = gender === 'M' ? 'sex-option selected' : 'sex-option';
    const femaleClass = gender === 'F' ? 'sex-option selected' : 'sex-option';

    return `
    <div class="sheet">
        <div class="title">紹介状(診療情報提供書)</div>
        <div class="header-flex">
            <div class="header-left">
                <div><strong>紹介先医療機関名：</strong> ${escapeHtml(dest.name)}</div>
                <div class="doctor-names"><strong>担当医師：</strong> ${escapeHtml(dest.doctor)} 殿</div>
            </div>
            <div class="header-right">
                <div style="text-align:right;margin-bottom:5px;">${dateStr}</div>
                <div class="sender-info">
                    紹介元医療機関の所在地：${escapeHtml(SHOKAIJO_SENDER.address)}<br>
                    名称：<strong>${escapeHtml(SHOKAIJO_SENDER.name)}</strong><br>
                    電話番号：${escapeHtml(SHOKAIJO_SENDER.tel)}<br>
                    医師氏名：<span class="name-wrapper"><strong>${escapeHtml(SHOKAIJO_SENDER.doctor)}</strong><img src="stamp.png" class="hanko-img" alt="印" onerror="this.style.display='none'"></span>
                </div>
            </div>
        </div>
        <table style="margin-bottom:0;">
            <colgroup><col style="width:90px;"><col><col style="width:62px;"><col style="width:110px;"></colgroup>
            <tr>
                <th class="col-label">患者氏名</th>
                <td style="font-size:1.05em;">
                    <strong><input class="inline-input" style="width:95%;font-weight:bold;" name="name_kana" value="${escapeHtml(kana)}" placeholder="カタカナ氏名"></strong><br>
                    <input class="inline-input" style="width:90%;" name="name_en" value="${escapeHtml(en)}" placeholder="English Name">&nbsp;殿
                </td>
                <th style="text-align:center;">性別</th>
                <td style="text-align:center;">
                    <span class="${maleClass}" data-gender="M" onclick="shokaijyoSelectSex(this)">男</span>・<span class="${femaleClass}" data-gender="F" onclick="shokaijyoSelectSex(this)">女</span>
                </td>
            </tr>
            <tr>
                <th class="col-label">生年月日</th>
                <td style="white-space:nowrap;">
                    <input class="inline-input" name="dob" value="${escapeHtml(dob)}" style="width:120px;">（<input class="inline-input" name="age" value="${escapeHtml(age)}" style="width:34px;text-align:right;">歳）
                </td>
                <th style="text-align:center;">電話番号</th>
                <td><input class="inline-input" name="phone" value="${escapeHtml(phone)}" style="width:95%;"></td>
            </tr>
        </table>
        <table style="margin-top:10px;">
            <tr><th class="col-label">傷病名</th><td><textarea class="input-area" rows="1" name="injury">${escapeHtml(injury)}</textarea></td></tr>
            <tr><th class="col-label">紹介目的</th><td><textarea class="input-area" rows="3" name="purpose">${escapeHtml(purpose)}</textarea></td></tr>
            <tr><th class="col-label">既往歴</th><td><textarea class="input-area" rows="2" name="history">${escapeHtml(history)}</textarea></td></tr>
            <tr><th class="col-label">病状経過及び<br>検査結果</th><td><textarea class="input-area" rows="12" name="clinical">${escapeHtml(clinical)}</textarea></td></tr>
            <tr><th class="col-label">通信本文</th><td><textarea class="input-area" rows="3" name="message">${escapeHtml(message)}</textarea></td></tr>
        </table>
    </div>`;
}

function openShokaijyoModal(docId, destKey) {
    db.collection('appointments').doc(docId).get().then(async doc => {
        if (!doc.exists) return;
        const data = doc.data();
        const saved = data.referrals && data.referrals[destKey];

        const needsAIClassification = !saved || !saved.purpose;
        const needsKana = !saved || !saved.name_kana;

        // モーダルを即座に表示（保存済みデータがあればそのまま、なければ正規表現でデフォルト表示）
        shokaijyoModalTitle.textContent = `紹介状 — ${REFERRAL_FULL[destKey].name}`;
        shokaijyoSheetContainer.innerHTML = buildSheetHTML(data, destKey, saved || null, null);
        shokaijyoEditingDocId = docId;
        shokaijyoEditingDest  = destKey;
        shokaijyoModal.style.display = 'flex';
        document.body.classList.add('modal-open');

        // カタカナ欄に「変換中...」を表示
        const kanaInput = shokaijyoSheetContainer.querySelector('[name="name_kana"]');
        if (needsKana && kanaInput) kanaInput.value = '変換中...';

        // 英語名の組み立て
        const nameParts = (data.claimantName || '').split(',').map(s => s.trim());
        const nameEn = nameParts.length === 2
            ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1).toLowerCase() + ' ' +
              nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1).toLowerCase()
            : (data.claimantName || '');

        // AI分類とカタカナ変換を並列実行（未保存の場合のみAPIを呼ぶ）
        const [classification, kana] = await Promise.all([
            needsAIClassification ? classifyServicesWithAI(data.services || []) : Promise.resolve(null),
            needsKana             ? convertToKatakana(nameEn)                   : Promise.resolve(null)
        ]);

        // カタカナ結果を反映（モーダルが既に切り替わっていたら中断）
        if (shokaijyoEditingDocId !== docId) return;
        if (needsKana && kanaInput) {
            kanaInput.value = kana || '';
        }

        // AI分類結果で紹介目的フィールドを更新（保存済みでない場合のみ・Firestoreには保存しない）
        if (needsAIClassification && classification) {
            if (shokaijyoEditingDocId !== docId) return; // モーダルが既に切り替わっていたら中断
            const purposeField = shokaijyoSheetContainer.querySelector('[name="purpose"]');
            if (purposeField) {
                const items = [];
                if (destKey === 'ASBO') {
                    if (classification.has_nasal)      items.push('鼻骨レントゲン(3方向)');
                    if (classification.has_chest_xray) items.push('胸部レントゲン2方向');
                    if (classification.has_ecg)        items.push('心電図');
                } else if (destKey === 'KIN') {
                    const ortho = classification.ortho_xrays_jp && classification.ortho_xrays_jp.length > 0
                        ? classification.ortho_xrays_jp : ['整形外科レントゲン'];
                    items.push(...ortho);
                } else {
                    if (classification.has_echo)       items.push('心エコー検査');
                    if (classification.has_chest_xray) items.push('胸部レントゲン2方向');
                }
                if (items.length > 0) purposeField.value = items.join('、') + 'の依頼';
            }
        }
    });
}

function closeShokaijyoModal() {
    shokaijyoModal.style.display = 'none';
    shokaijyoSheetContainer.innerHTML = '';
    shokaijyoEditingDocId = null;
    shokaijyoEditingDest  = null;
    document.body.classList.remove('modal-open');
}

function saveShokaijyo() {
    if (!shokaijyoEditingDocId || !shokaijyoEditingDest) return;
    const sheet = shokaijyoSheetContainer.querySelector('.sheet');
    if (!sheet) return;
    const get = name => { const el = sheet.querySelector(`[name="${name}"]`); return el ? el.value : ''; };
    const selectedGender = sheet.querySelector('.sex-option.selected');
    const fieldPath = `referrals.${shokaijyoEditingDest}`;
    db.collection('appointments').doc(shokaijyoEditingDocId).update({
        [fieldPath]: {
            name_kana: get('name_kana'), name_en: get('name_en'),
            gender:    selectedGender ? selectedGender.dataset.gender : 'M',
            dob: get('dob'), age: get('age'), phone: get('phone'),
            injury: get('injury'), purpose: get('purpose'),
            history: get('history'), clinical: get('clinical'), message: get('message'),
            savedAt: firebase.firestore.FieldValue.serverTimestamp()
        }
    })
    .then(() => closeShokaijyoModal())
    .catch(err => { console.error(err); alert('保存に失敗しました'); });
}

function printShokaijyo() {
    const sheet = shokaijyoSheetContainer.querySelector('.sheet');
    if (!sheet) return;
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<style>
body{font-family:"Hiragino Mincho ProN","MS Mincho",serif;background:#f0f0f0;margin:0;padding:20px;color:#333;}
.sheet{background:white;width:210mm;padding:20mm;margin:0 auto;box-sizing:border-box;position:relative;overflow:hidden;box-shadow:0 0 10px rgba(0,0,0,.1);}
.title{text-align:center;font-size:22px;font-weight:bold;text-decoration:underline;margin-bottom:8mm;letter-spacing:2px;}
.header-flex{display:flex;justify-content:space-between;margin-bottom:5mm;font-size:14px;}
.header-left{width:60%;}.header-right{width:38%;text-align:left;}
.doctor-names{margin-top:5px;margin-left:10px;font-size:16px;}
.sender-info{margin-top:5px;line-height:1.3;}
.name-wrapper{position:relative;display:inline-block;}
.hanko-img{position:absolute;top:-6px;right:-32px;width:36px;height:auto;opacity:.7;z-index:10;mix-blend-mode:multiply;}
.sex-option{display:inline-block;width:1.5em;height:1.5em;line-height:1.5em;text-align:center;border-radius:50%;border:1px solid transparent;}
.sex-option.selected{border-color:#000;font-weight:bold;}
table{width:100%;border-collapse:collapse;margin-bottom:0;}
th,td{border:1px solid #000;padding:4px 6px;vertical-align:top;font-size:14px;}
th{background-color:#f5f5f5;text-align:center;white-space:nowrap;vertical-align:middle;}
.col-label{width:90px;}
.input-area{width:100%;border:none;font-family:"Hiragino Mincho ProN","MS Mincho",serif;font-size:14px;line-height:1.5;resize:none;outline:none;background:transparent;margin:0;padding:0;overflow:hidden;}
.inline-input{border:none;border-bottom:1px dashed #aaa;font-family:"Hiragino Mincho ProN","MS Mincho",serif;font-size:inherit;outline:none;background:transparent;min-width:80px;}
@media print{
  @page{size:A4;margin:0;}
  html,body{width:210mm;height:297mm;margin:0;padding:0;background:white;}
  .sheet{margin:0;padding:20mm;box-shadow:none;width:210mm;height:297mm;}
  .inline-input{border-bottom:none;}
  .sex-option.selected{border-color:#000!important;-webkit-print-color-adjust:exact;}
}
</style></head><body>
${sheet.outerHTML}
<script>window.onload=function(){window.print();};<\/script>
</body></html>`);
    w.document.close();
}

// ===== 受診日モーダル =====
function openVisitDateModal(docId) {
    visitDateEditingDocId = docId;
    visitDateInput.value = '';
    visitDateModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function closeVisitDateModal() {
    visitDateModal.style.display = 'none';
    visitDateEditingDocId = null;
    document.body.classList.remove('modal-open');
}

function saveVisitDate() {
    if (!visitDateEditingDocId || !visitDateInput.value) {
        closeVisitDateModal();
        return;
    }
    const parts = visitDateInput.value.split('-');
    const mmdd = `${parts[1]}/${parts[2]}`;
    db.collection('appointments').doc(visitDateEditingDocId).update({ visitDate: mmdd })
        .then(() => closeVisitDateModal())
        .catch(err => { console.error(err); alert('保存に失敗しました'); });
}
