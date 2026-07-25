// Firebase初期化・共通定数・共通関数は ../shared/core.js（先に読み込み）にある

// ローカル版のターゲット設定（shared/core.js が実行時に参照）
const SOSLIST_TARGET = {
    mobileUI: false,                              // モバイルUIなし
    deleteColumn: true,                           // 削除ボタン列あり
    servicesCellClass: 'col-services services-cell', // 検査内容セルは編集可
    stampSrc: '../stamp.png'
};

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
const prevDateButton = document.getElementById('prevDateButton');
const nextDateButton = document.getElementById('nextDateButton');
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
const summaryDateInput = document.getElementById('summaryDateInput');
const summaryPrevDateButton = document.getElementById('summaryPrevDateButton');
const summaryNextDateButton = document.getElementById('summaryNextDateButton');
const generateSummaryButton = document.getElementById('generateSummaryButton');
const showSummaryButton = document.getElementById('showSummaryButton');
const summaryStatus = document.getElementById('summaryStatus');
const cdMonitorToggleButton = document.getElementById('cdMonitorToggleButton');
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
const visitTimeInput      = document.getElementById('visitTimeInput');
const confirmVisitDateBtn = document.getElementById('confirmVisitDateBtn');
const cancelVisitDateBtn  = document.getElementById('cancelVisitDateBtn');


// --- グローバル変数 ---
let logoutTimer;
let editingDateTimeDocId = null;
let editingServicesDocId = null;
let editingPhoneDocId = null;
let unsubscribe;
const CD_MONITOR_ENABLED_KEY = 'soslist-cd-monitor-enabled';
const DAILY_BRIEF_BASE_URL = 'http://127.0.0.1:8790';
let isCDMonitorEnabled = false;

let shokaijyoEditingDocId = null;
let shokaijyoEditingDest  = null;
let visitDateEditingDocId = null;
const DETAIL_PAYLOAD_PREFIX = 'soslist-detail-payload:';
const DETAIL_SAVE_REQUEST_KEY = 'soslist-detail-save-request';
const DETAIL_SAVE_RESPONSE_PREFIX = 'soslist-detail-save-response:';
const DETAIL_REFERRAL_OPEN_REQUEST_KEY = 'soslist-detail-referral-open-request';
const DETAIL_CLOSE_WINDOW_KEY = 'soslist-detail-close-window';
const handledDetailSaveRequests = new Set();
const handledDetailReferralRequests = new Set();
const pendingDeleteButtons = new Map();

// 子ウィンドウからのノート更新を処理する関数 
window.updateAppointmentNote = updateAppointmentNote;
window.saveAppointmentNote = function saveAppointmentNote(docId, newNote) {
    return db.collection('appointments').doc(docId).update({
        notes: newNote
    });
};

// 年選択のプルダウンを動的に生成
function syncCDMonitorSettingWithNative() {
    const nativeHandler = window.webkit?.messageHandlers?.setCDMonitoringEnabled;
    if (nativeHandler) {
        nativeHandler.postMessage({ enabled: isCDMonitorEnabled });
    }
}

function renderCDMonitorToggle() {
    if (!cdMonitorToggleButton) return;
    cdMonitorToggleButton.classList.toggle('is-active', isCDMonitorEnabled);
    cdMonitorToggleButton.setAttribute('aria-pressed', String(isCDMonitorEnabled));
    cdMonitorToggleButton.textContent = 'CD';
    cdMonitorToggleButton.title = isCDMonitorEnabled ? 'aSBo CD監視: ON' : 'aSBo CD監視: OFF';
}

function loadCDMonitorSetting() {
    isCDMonitorEnabled = localStorage.getItem(CD_MONITOR_ENABLED_KEY) === 'true';
    renderCDMonitorToggle();
    syncCDMonitorSettingWithNative();
}

function toggleCDMonitor() {
    isCDMonitorEnabled = !isCDMonitorEnabled;
    localStorage.setItem(CD_MONITOR_ENABLED_KEY, String(isCDMonitorEnabled));
    renderCDMonitorToggle();
    syncCDMonitorSettingWithNative();
}

// 選択された年月から月の最終日を取得
function buildDailyBriefUrl(pathname) {
    return `${DAILY_BRIEF_BASE_URL}${pathname}`;
}

function updateSummaryStatus(message, tone = 'neutral') {
    if (!summaryStatus) return;
    summaryStatus.textContent = message || '';
    summaryStatus.classList.remove('is-error', 'is-success');
    if (tone === 'error') {
        summaryStatus.classList.add('is-error');
    } else if (tone === 'success') {
        summaryStatus.classList.add('is-success');
    }
}

function openSummaryPopup(mode = 'generate') {
    if (!summaryDateInput?.value) {
        alert('Summeryの日付を選んでください。');
        return;
    }

    const targetDate = summaryDateInput.value;
    const popupUrl = buildDailyBriefUrl(`/summary-popup?date=${encodeURIComponent(targetDate)}&mode=${encodeURIComponent(mode)}`);
    const nativeSummaryHandler = window.webkit?.messageHandlers?.openSummaryWindow;
    if (nativeSummaryHandler) {
        nativeSummaryHandler.postMessage({
            url: popupUrl,
            title: `Summery ${targetDate}`
        });
        return;
    }

    const popup = window.open(popupUrl, '_blank', 'popup=yes,width=1180,height=920');
    if (!popup) {
        alert(
            'Summeryウィンドウを開けませんでした。\n' +
            'daily-brief サーバーを起動してから再試行してください。\n' +
            'cd ~/Documents/GitHub/soslist/daily-brief\nbash run-app.sh'
        );
        return;
    }
}

function handleSummaryGenerate() {
    if (!summaryDateInput?.value) {
        alert('Summeryの日付を選んでください。');
        return;
    }

    const nativeGenerateHandler = window.webkit?.messageHandlers?.startSummaryGeneration;
    if (!nativeGenerateHandler) {
        openSummaryPopup('generate');
        return;
    }

    updateSummaryStatus('Summary 作成を開始しています...');
    nativeGenerateHandler.postMessage({
        date: summaryDateInput.value
    });
}

function handleSummaryShow() {
    openSummaryPopup('view');
}

window.addEventListener('summary-generation-status', (event) => {
    const detail = event.detail || {};
    const state = detail.state || 'info';
    const message = detail.message || '';
    if (state === 'error') {
        updateSummaryStatus(message, 'error');
        return;
    }
    if (state === 'completed') {
        updateSummaryStatus(message, 'success');
        return;
    }
    updateSummaryStatus(message);
});

// --- ログイン状態の監視 ---
auth.onAuthStateChanged(user => {
    if (user) {
        loginContainer.style.display = 'none';
        mainAppContainer.style.display = 'block';
        userEmailSpan.textContent = user.email;
        
        // 年選択オプションを生成
        generateYearOptions();
        initializeSummaryDate();
        loadCDMonitorSetting();

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
                    const correctedDateObj = getCorrectedAppointmentDate(lastAppointment);
                    dateFilter.value = correctedDateObj
                        ? formatDateInTokyo(correctedDateObj)
                        : formatDateInputValue(today);
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

window.addEventListener('storage', handleDetailStorageEvent);

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

prevDateButton?.addEventListener('click', () => {
    jumpToAdjacentReservationDate(-1);
});

nextDateButton?.addEventListener('click', () => {
    jumpToAdjacentReservationDate(1);
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
                return docRef.update({ isShown: !currentIsShown });
            }
        }).catch(error => {
            console.error('来院表示の更新エラー:', error);
            alert('来院表示の更新に失敗しました。');
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
            if (doc.exists) return docRef.update({ isReceived: !doc.data().isReceived });
        }).catch(error => {
            console.error('受領フラグの更新エラー:', error);
            alert('受領フラグの更新に失敗しました。');
        });
        return;
    }
    if (target.classList.contains('completed-cell')) {
        const docRef = db.collection('appointments').doc(docId);
        docRef.get().then(doc => {
            if (doc.exists) return docRef.update({ isCompleted: !doc.data().isCompleted });
        }).catch(error => {
            console.error('完了フラグの更新エラー:', error);
            alert('完了フラグの更新に失敗しました。');
        });
        return;
    }
    if (target.classList.contains('contract-cell')) {
        handleViewPdf(docId);
        return;
    }
    const deleteButton = target.closest('.delete-btn');
    if (deleteButton) {
        handleDeleteButtonClick(deleteButton, docId);
        return;
    }
    if (target.classList.contains('phone-cell')) {
        openPhoneEditModal(docId);
        return;
    }
    if (target.classList.contains('age-cell')) {
        const docRef = db.collection('appointments').doc(docId);
        const isPink = target.classList.toggle('pink');
        docRef.update({ isAgePink: isPink }).catch(error => {
            // 書き込み失敗時は先行して切り替えた表示を元に戻す
            target.classList.toggle('pink', !isPink);
            console.error('性別フラグの更新エラー:', error);
            alert('性別フラグの更新に失敗しました。');
        });
        return;
    }
});

confirmEditBtn.addEventListener('click', () => {
    if (!dateSelect.value || !hourSelect.value || !minuteSelect.value || !editingDateTimeDocId) return;
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
    
    db.collection('appointments').doc(editingDateTimeDocId).update(dataToUpdate)
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
summaryPrevDateButton?.addEventListener('click', () => jumpToAdjacentSummaryReservationDate(-1));
summaryNextDateButton?.addEventListener('click', () => jumpToAdjacentSummaryReservationDate(1));
generateSummaryButton?.addEventListener('click', handleSummaryGenerate);
showSummaryButton?.addEventListener('click', handleSummaryShow);
cdMonitorToggleButton?.addEventListener('click', toggleCDMonitor);
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

// 氏名の部分一致マッチング
// 保存形式: "JONES, JONATHAN"（姓, 名、大文字）
// 対応: 姓のみ / 名のみ / 姓名 / 名姓 / カンマあり / 大文字小文字不問
function openDetailsModal(docId) {
    db.collection('appointments').doc(docId).get().then(doc => {
        if (!doc.exists) {
            alert('データが見つかりません');
            return;
        }

        const payload = buildDetailsPayload(docId, doc.data());
        localStorage.setItem(`${DETAIL_PAYLOAD_PREFIX}${docId}`, JSON.stringify(payload));

        const detailsUrl = `details.html#id=${encodeURIComponent(docId)}`;
        if (window.webkit?.messageHandlers?.openDetailsWindow) {
            window.webkit.messageHandlers.openDetailsWindow.postMessage(payload);
            return;
        }

        const newWindow = window.open('', '_blank', 'popup=yes,width=1280,height=920');
        if (!newWindow) {
            alert('予約詳細ウィンドウを開けませんでした。');
            return;
        }
        newWindow.location.href = detailsUrl;
    }).catch(error => {
        console.error('詳細ウィンドウの表示エラー:', error);
        alert('データの取得に失敗しました。');
    });
}

function buildDetailsPayload(docId, data) {
    const referralDests = determineReferralDests(data.services || []);
    const sanitizedReferrals = Object.fromEntries(
        Object.entries(data.referrals || {}).map(([destKey, referralValue]) => [
            destKey,
            {
                savedAt: referralValue?.savedAt?.toDate
                    ? referralValue.savedAt.toDate().toISOString()
                    : (referralValue?.savedAt || null)
            }
        ])
    );
    return {
        docId,
        claimantName: data.claimantName || '',
        contractNumber: data.contractNumber || '',
        dateOfBirth: data.dateOfBirth || '',
        japanCellPhone: data.japanCellPhone || '',
        visitDate: data.visitDate || '',
        referenceUrl: data.referenceUrl || '',
        notes: data.notes || '',
        services: Array.isArray(data.services) ? data.services : [],
        referralDests,
        referrals: sanitizedReferrals,
        appointmentDateTimeMs: data.appointmentDateTime?.toDate
            ? data.appointmentDateTime.toDate().getTime()
            : null
    };
}

function handleDetailStorageEvent(event) {
    if (!event.newValue) {
        return;
    }

    if (event.key === DETAIL_SAVE_REQUEST_KEY) {
        handleDetailSaveRequest(event.newValue);
        return;
    }

    if (event.key === DETAIL_REFERRAL_OPEN_REQUEST_KEY) {
        handleDetailReferralOpenRequest(event.newValue);
        return;
    }

    if (event.key === DETAIL_CLOSE_WINDOW_KEY) {
        handleDetailCloseRequest(event.newValue);
    }
}

function handleDetailSaveRequest(rawValue) {
    let request;
    try {
        request = JSON.parse(rawValue);
    } catch (error) {
        return;
    }

    if (!request?.requestId || handledDetailSaveRequests.has(request.requestId)) {
        return;
    }

    handledDetailSaveRequests.add(request.requestId);

    db.collection('appointments').doc(request.docId).update({
        notes: request.notes || '',
        referenceUrl: request.referenceUrl || ''
    })
        .then(() => {
            const payloadKey = `${DETAIL_PAYLOAD_PREFIX}${request.docId}`;
            const existingPayload = localStorage.getItem(payloadKey);
            if (existingPayload) {
                try {
                    const payload = JSON.parse(existingPayload);
                    payload.notes = request.notes || '';
                    payload.referenceUrl = request.referenceUrl || '';
                    localStorage.setItem(payloadKey, JSON.stringify(payload));
                } catch (error) {
                    console.error(error);
                }
            }
            localStorage.setItem(
                `${DETAIL_SAVE_RESPONSE_PREFIX}${request.requestId}`,
                JSON.stringify({ status: 'success', message: '保存しました。' })
            );
        })
        .catch((error) => {
            console.error(error);
            localStorage.setItem(
                `${DETAIL_SAVE_RESPONSE_PREFIX}${request.requestId}`,
                JSON.stringify({ status: 'error', message: '保存に失敗しました。' })
            );
        });
}

// ネイティブアプリ経由の保存リレー（WKWebView間はstorageイベントが届かないため、
// details → saveDetails(native) → __sosApplyDetailsSave(main) → detailsSaveResult(native) → details）
window.__sosApplyDetailsSave = function(request) {
    if (!request?.requestId || handledDetailSaveRequests.has(request.requestId)) {
        return;
    }
    handledDetailSaveRequests.add(request.requestId);

    const resultHandler = window.webkit?.messageHandlers?.detailsSaveResult;
    const reply = (status, message) => {
        if (resultHandler) {
            resultHandler.postMessage({ requestId: request.requestId, status, message });
        }
    };

    db.collection('appointments').doc(request.docId).update({
        notes: request.notes || '',
        referenceUrl: request.referenceUrl || ''
    })
        .then(() => reply('success', '保存しました。'))
        .catch((error) => {
            console.error('details保存エラー:', error);
            reply('error', '保存に失敗しました。');
        });
};

// ネイティブアプリ経由の紹介状オープン要求
window.__sosOpenReferralFromDetails = function(request) {
    if (!request?.requestId || handledDetailReferralRequests.has(request.requestId)) {
        return;
    }
    handledDetailReferralRequests.add(request.requestId);
    if (request.docId && request.destKey) {
        openShokaijyoModal(request.docId, request.destKey);
    }
};

function handleDetailReferralOpenRequest(rawValue) {
    let request;
    try {
        request = JSON.parse(rawValue);
    } catch (error) {
        return;
    }

    if (!request?.requestId || handledDetailReferralRequests.has(request.requestId)) {
        return;
    }

    handledDetailReferralRequests.add(request.requestId);

    if (!request.docId || !request.destKey) {
        return;
    }

    openShokaijyoModal(request.docId, request.destKey);
}

function handleDetailCloseRequest(rawValue) {
    try {
        JSON.parse(rawValue);
    } catch (error) {
        return;
    }
}

function handleDeleteButtonClick(button, docId) {
    const pending = pendingDeleteButtons.get(docId);

    if (pending && pending.button === button) {
        window.clearTimeout(pending.timeoutId);
        pendingDeleteButtons.delete(docId);
        button.textContent = pending.originalLabel;
        button.disabled = true;

        db.collection('appointments').doc(docId).delete()
            .catch(error => {
                console.error('削除エラー:', error);
                alert(`削除に失敗しました: ${error.message}`);
                button.disabled = false;
                button.textContent = pending.originalLabel;
            });
        return;
    }

    clearPendingDeleteState(docId);
    const originalLabel = button.textContent;
    button.textContent = '⚠️';
    const timeoutId = window.setTimeout(() => {
        if (button.isConnected) {
            button.textContent = originalLabel;
        }
        pendingDeleteButtons.delete(docId);
    }, 1500);

    pendingDeleteButtons.set(docId, { button, timeoutId, originalLabel });
}

function clearPendingDeleteState(docId) {
    const pending = pendingDeleteButtons.get(docId);
    if (!pending) {
        return;
    }

    window.clearTimeout(pending.timeoutId);
    if (pending.button.isConnected) {
        pending.button.textContent = pending.originalLabel;
    }
    pendingDeleteButtons.delete(docId);
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
        
        editingServicesDocId = docId;
        editServicesModal.style.display = 'flex';
        document.body.classList.add('modal-open');
    }).catch(error => {
        console.error('検査内容編集モーダルの表示エラー:', error);
        alert('データの取得に失敗しました。');
    });
}

function closeServicesEditModal() {
    editServicesModal.style.display = 'none';
    editingServicesDocId = null;
    document.body.classList.remove('modal-open');
}

function saveServices() {
    if (!editingServicesDocId) return;

    const newServicesString = servicesTextarea.value;
    const newServicesArray = newServicesString.split(',')
                                            .map(s => s.trim())
                                            .filter(s => s !== '');

    db.collection('appointments').doc(editingServicesDocId).update({
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
// ===== 紹介状モーダル =====
function openShokaijyoModal(docId, destKey) {
    db.collection('appointments').doc(docId).get().then(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        const saved = data.referrals && data.referrals[destKey];

        const needsAIClassification = !saved || !saved.purpose;

        // モーダルを即座に表示（保存済みデータがあればそのまま、なければ正規表現でデフォルト表示）
        shokaijyoModalTitle.textContent = `紹介状 — ${REFERRAL_FULL[destKey].name}`;
        shokaijyoSheetContainer.innerHTML = buildSheetHTML(data, destKey, saved || null, null);
        shokaijyoEditingDocId = docId;
        shokaijyoEditingDest  = destKey;
        shokaijyoModal.style.display = 'flex';
        document.body.classList.add('modal-open');

        // カタカナ氏名は自動変換せず手入力（placeholder「カタカナ氏名」あり）

        // 検査分類（正規表現ベース）で紹介目的の初期値を組み立て
        if (needsAIClassification) {
            const c = classifyServices(data.services || []);
            const purposeField = shokaijyoSheetContainer.querySelector('[name="purpose"]');
            if (purposeField) {
                const items = [];
                if (destKey === 'ASBO') {
                    if (c.has_nasal)      items.push('鼻骨レントゲン(3方向)');
                    if (c.has_facial)     items.push('顔面骨・頭蓋骨レントゲン');
                    if (c.has_chest_xray) items.push('胸部レントゲン2方向');
                    if (c.has_ecg)        items.push('心電図');
                } else if (destKey === 'KIN') {
                    if (c.has_ortho)      items.push('整形外科レントゲン');
                    if (c.has_chest_xray) items.push('胸部レントゲン2方向');
                } else {
                    if (c.has_echo)       items.push('心エコー検査');
                    if (c.has_chest_xray) items.push('胸部レントゲン2方向');
                    if (c.has_ecg)        items.push('心電図');
                }
                if (items.length > 0) purposeField.value = items.join('、') + 'の依頼';
            }
        }
    }).catch(error => {
        console.error('紹介状モーダルの表示エラー:', error);
        alert('データの取得に失敗しました。');
    });
}

// ===== 受診日モーダル =====