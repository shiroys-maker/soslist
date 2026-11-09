// Firebase初期化・共通定数・共通関数は shared/core.js（先に読み込み）にある

// Web版のターゲット設定（shared/core.js が実行時に参照）
const SOSLIST_TARGET = {
    mobileUI: true,                      // モバイルカードUIあり
    deleteColumn: false,                 // 削除ボタン列なし
    perReferralStatus: true,             // 紹介先ごとに受診日・受・済を管理
    servicesCellClass: 'col-services services-cell', // Claim詳細を参照
    referralHeaderDateMode: 'visitDate',
    stampSrc: 'stamp.png'
};

const SUMMARY_MIRROR_DOC_PREFIX = 'dailyBrief_';

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
const mobileAppointmentsList = document.getElementById('mobileAppointmentsList');
const mobileViewToggle = document.getElementById('mobileViewToggle');
const mobileCompactViewButton = document.getElementById('mobileCompactViewButton');
const mobileCardViewButton = document.getElementById('mobileCardViewButton');
const mobileControlsToggle = document.getElementById('mobileControlsToggle');
const mobileControlsPanel = document.getElementById('mobileControlsPanel');
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
const claimDetailModal = document.getElementById('claimDetailModal');
const claimDetailText = document.getElementById('claimDetailText');
const claimDetailIdentity = document.getElementById('claimDetailIdentity');
const closeClaimDetailButton = document.getElementById('closeClaimDetailButton');
const saveNotesButton = document.getElementById('saveNotesButton');
const closeDetailsModalButton = document.getElementById('closeDetailsModalButton');
// Invoice印刷用
const invoiceYearSelect = document.getElementById('invoiceYearSelect');
const invoiceMonthSelect = document.getElementById('invoiceMonthSelect');
const printInvoiceButton = document.getElementById('printInvoiceButton');
const summaryDateInput = document.getElementById('summaryDateInput');
const summaryPrevDateButton = document.getElementById('summaryPrevDateButton');
const summaryNextDateButton = document.getElementById('summaryNextDateButton');
const showSummaryButton = document.getElementById('showSummaryButton');
const summaryModal = document.getElementById('summaryModal');
const summaryModalTitle = document.getElementById('summaryModalTitle');
const summaryModalMeta = document.getElementById('summaryModalMeta');
const summaryModalBody = document.getElementById('summaryModalBody');
const closeSummaryModalButton = document.getElementById('closeSummaryModalButton');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const searchResultsModal = document.getElementById('searchResultsModal');
const searchResultsList = document.getElementById('searchResultsList');
const closeSearchResultsButton = document.getElementById('closeSearchResultsButton');
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
const detailsModalLabel       = document.querySelector('label[for="notesTextarea"]');
const DETAILS_EDITABLE        = false;
const SHOKAIJO_EDITABLE       = false;
// 受診日モーダル
const visitDateModal      = document.getElementById('visitDateModal');
const visitDateInput      = document.getElementById('visitDateInput');
const visitTimeInput      = document.getElementById('visitTimeInput');
const confirmVisitDateBtn = document.getElementById('confirmVisitDateBtn');
const cancelVisitDateBtn  = document.getElementById('cancelVisitDateBtn');


// --- グローバル変数 ---
let logoutTimer;
let editingDateTimeDocId = null;
let editingPhoneDocId = null;
let unsubscribe;
const MOBILE_VIEW_MODE_KEY = 'soslist-mobile-view-mode';
const MOBILE_CONTROLS_OPEN_KEY = 'soslist-mobile-search-controls-open';
const MOBILE_CARD_ACTIONABLE_SELECTOR = 'button, a, .name-cell, .show-toggle-cell, .contract-cell, .phone-cell, .visitdate-cell, .received-cell, .completed-cell, .referral-dest, .age-cell';

let shokaijyoEditingDocId = null;
let shokaijyoEditingDest  = null;
let visitDateEditingDocId = null;
let visitDateEditingDest  = null;

window.addEventListener('resize', updateShokaijyoSheetScale);
window.addEventListener('resize', () => {
    mobileControlsPanel.inert = window.innerWidth <= 768 && document.body.dataset.mobileControlsOpen !== 'true';
});

function applyMobileViewMode(mode) {
    const normalizedMode = mode === 'card' ? 'card' : 'compact';
    document.body.dataset.mobileViewMode = normalizedMode;
    mobileCompactViewButton?.classList.toggle('is-active', normalizedMode === 'compact');
    mobileCardViewButton?.classList.toggle('is-active', normalizedMode === 'card');
    try {
        localStorage.setItem(MOBILE_VIEW_MODE_KEY, normalizedMode);
    } catch (error) {
        console.warn('Failed to persist mobile view mode:', error);
    }
}

function initializeMobileViewMode() {
    let savedMode = null;
    try {
        savedMode = localStorage.getItem(MOBILE_VIEW_MODE_KEY);
    } catch (error) {
        console.warn('Failed to read mobile view mode:', error);
    }
    applyMobileViewMode(savedMode === 'card' ? 'card' : 'compact');
}

function toggleAppointmentCardExpansion(card) {
    if (!card) return;
    const willExpand = !card.classList.contains('is-expanded');
    mobileAppointmentsList?.querySelectorAll('.appointment-card.is-expanded').forEach((expandedCard) => {
        expandedCard.classList.remove('is-expanded');
        expandedCard.querySelector('.card-expand')?.setAttribute('aria-expanded', 'false');
        const label = expandedCard.querySelector('.card-expand');
        if (label) label.textContent = '詳細を展開';
    });
    if (willExpand) {
        card.classList.add('is-expanded');
        card.querySelector('.card-expand')?.setAttribute('aria-expanded', 'true');
        const label = card.querySelector('.card-expand');
        if (label) label.textContent = '折りたたむ';
    }
}

function setMobileControlsOpen(isOpen) {
    const normalized = Boolean(isOpen);
    document.body.dataset.mobileControlsOpen = normalized ? 'true' : 'false';
    mobileControlsToggle?.setAttribute('aria-expanded', normalized ? 'true' : 'false');
    mobileControlsToggle?.classList.toggle('is-open', normalized);
    mobileControlsPanel?.classList.toggle('is-open', normalized);
    if (mobileControlsPanel) mobileControlsPanel.inert = window.innerWidth <= 768 && !normalized;
    mobileControlsToggle.textContent = normalized ? '検索・日付・その他 ▲' : '検索・日付・その他 ▼';
    try {
        localStorage.setItem(MOBILE_CONTROLS_OPEN_KEY, normalized ? 'true' : 'false');
    } catch (error) {
        console.warn('Failed to persist mobile controls state:', error);
    }
}

function initializeMobileControlsState() {
    try {
        const savedState = localStorage.getItem(MOBILE_CONTROLS_OPEN_KEY);
        setMobileControlsOpen(savedState === 'true');
    } catch (error) {
        setMobileControlsOpen(false);
    }
}

function renderMarkdownToHtml(markdown) {
    return window.SOSSummaryMarkdown
        ? window.SOSSummaryMarkdown.render(markdown)
        : '<p style="white-space:pre-wrap">' + escapeHtml(String(markdown ?? '')) + '</p>';
}

// Candidate summary-only replacement. No retention changes, writes, retries or path search.
let summaryRequest = 0;
let summaryAbort = null;
function summaryPasskeyEnabled() {
    return typeof usualPasskey !== 'undefined' && usualPasskey;
}
function stopSummaryAudio() {
    for (const audio of summaryModalBody.querySelectorAll('audio')) {
        audio.pause(); audio.removeAttribute('src'); audio.load();
    }
}
function summaryAudioMessage(error) {
    const code = error?.code;
    if (code === 'NOT_FOUND' || code === 'storage/object-not-found' || error?.status === 404)
        return 'この日の音声は現在利用できません。本文は引き続き読めます。';
    if (['FORBIDDEN', 'UNAUTHENTICATED', 'SESSION_BLOCKED', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'SESSION_INVALID', 'INVALID_SESSION', 'storage/unauthorized', 'storage/unauthenticated'].includes(code) || [401, 403].includes(error?.status))
        return '音声へのアクセスを確認できません。ログイン状態をご確認ください。';
    if (['AUDIO_TIMEOUT','TOTAL_DEADLINE','REQUEST_DEADLINE'].includes(code)) return '音声の読み込みが時間内に完了しませんでした。本文は引き続き読めます。';
    if (['INVALID_RESPONSE','VERSION_CHANGED'].includes(code)) return '音声データを確認できませんでした。本文は引き続き読めます。';
    return '音声を読み込めませんでした。本文は引き続き読めます。';
}
function openSummaryModal(ymd, summaryMarkdown) {
    stopSummaryAudio();
    summaryModalTitle.textContent = 'Summary';
    summaryModalMeta.textContent = ymd;
    summaryModalBody.innerHTML = summaryMarkdown
        ? renderMarkdownToHtml(summaryMarkdown) : '<p>サマリーは未作成です。</p>';
    summaryModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}
function closeSummaryModal() {
    ++summaryRequest;
    summaryAbort?.abort();summaryAbort=null;
    if(summaryPasskeyEnabled())window.sosUsualWeb.files.cancel?.('summary-audio');
    stopSummaryAudio();
    summaryModal.style.display = 'none';
    summaryModalMeta.textContent = '';
    summaryModalBody.innerHTML = '';
    document.body.classList.remove('modal-open');
}
async function showSummary() {
    const viewIsCurrent = typeof captureSensitiveViewSession === 'function'
        ? captureSensitiveViewSession() : () => true;
    if (!viewIsCurrent()) return;
    if (!summaryDateInput?.value) { alert('Summaryの日付を選んでください。'); return; }
    closeSummaryModal();
    const request = summaryRequest;
    const operation = new AbortController();summaryAbort=operation;
    const targetDate = summaryDateInput.value;
    const passkey = summaryPasskeyEnabled();
    let epoch;
    const current = () => {
        if (request !== summaryRequest || targetDate !== summaryDateInput.value) return false;
        if (!viewIsCurrent()) { closeSummaryModal(); return false; }
        if (passkey) {
            try { window.sosUsualWeb.assert(epoch); }
            catch { closeSummaryModal(); return false; }
        }
        return true;
    };
    let summary;
    try {
        epoch = passkey ? window.sosUsualWeb.capture() : null;
        summary = await fetchSummary(targetDate);
    } catch {
        if (current()) alert('Summaryを読み込めませんでした。');
        return;
    }
    if (!current()) return;
    // Text is useful independently of audio and must not wait for it.
    openSummaryModal(targetDate, summary.summaryMarkdown);
    const section = document.createElement('section');
    section.className = 'summary-audio-player';
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    section.append(status);
    summaryModalBody.prepend(section);
    if (!summary.audioStoragePath) {
        status.textContent = 'この日の音声は登録されていません。';
        return;
    }
    status.textContent = '音声を読み込んでいます。';
    let timer;
    try {
        // Native files.get assembles a Blob; its transport owns 180s/25s deadlines.
        const audioUrl = passkey
            ? await window.sosUsualWeb.files.get(SUMMARY_MIRROR_DOC_PREFIX + targetDate, 'summary-audio', {signal:operation.signal})
            : await Promise.race([
                storage.ref(summary.audioStoragePath).getDownloadURL(),
                new Promise((_, reject) => { timer=setTimeout(()=>reject({code:'AUDIO_TIMEOUT'}),15000); })
            ]);
        if (!current()) return;
        if (typeof audioUrl !== 'string' || !/^(https:\/\/|blob:)/.test(audioUrl)) throw {code:'INVALID_RESPONSE'};
        const player = document.createElement('audio');
        player.controls = true;
        player.preload = 'metadata';
        if (passkey) player.crossOrigin = 'use-credentials';
        // Media events have no reliable HTTP status. Never label them as expired/404.
        player.addEventListener('error', () => {
            if (!current()) return;
            status.textContent = summaryAudioMessage({});
            player.pause(); player.removeAttribute('src'); player.load(); player.remove();
        }, {once:true});
        player.src = audioUrl;
        status.textContent = 'Summary 音声';
        section.append(player);
    } catch (error) {
        if (current()) status.textContent = summaryAudioMessage(error);
    } finally { clearTimeout(timer); }
}

async function fetchSummary(targetDate) {
    const mirrorSnapshot = await db
        .collection('appointments')
        .doc(`${SUMMARY_MIRROR_DOC_PREFIX}${targetDate}`)
        .get();
    if (mirrorSnapshot.exists) {
        const mirrorData = mirrorSnapshot.data() || {};
        return {
            summaryMarkdown: mirrorData.summaryMarkdown || '',
            // 古いローカル生成プロセスは audioStoragePath を保存していないことがある。
            // MP3 は日付ごとの固定パスへ保存するため、hasAudio から安全に補完する。
            audioStoragePath: mirrorData.audioStoragePath
                || (mirrorData.hasAudio ? `daily-brief/${targetDate}/podcast.mp3` : ''),
        };
    }
    return { summaryMarkdown: '', audioStoragePath: '' };
}

// Clear all sensitive DOM before changing users or attempting sign-out.
function clearSensitiveUi() {
    window.sosConnection.stop();
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    clearTimeout(logoutTimer);
    displayedAppointments.clear();
    setResultsWaitingMode(false, false);
    window.sosPdfViewer?.close();
    closeSummaryModal();
    closeClaimDetailModal();
    for (const modal of document.querySelectorAll('.modal')) modal.style.display = 'none';
    for (const region of [tableBody, mobileAppointmentsList, detailsContentContainer,
        searchResultsList, shokaijyoSheetContainer]) {
        if (region) region.innerHTML = '';
    }
    for (const input of document.querySelectorAll('.modal input, .modal textarea, .modal select')) input.value = '';
    searchInput.value = '';
    loginPasswordInput.value = '';
    userEmailSpan.textContent = '';
    detailsModal.dataset.editingId = '';
    editingDateTimeDocId = editingPhoneDocId = null;
    shokaijyoEditingDocId = shokaijyoEditingDest = null;
    visitDateEditingDocId = visitDateEditingDest = null;
    document.body.classList.remove('modal-open');
    mainAppContainer.style.display = 'none';
}

// --- ログイン状態の監視 ---
if (usualPasskey) {
    window.sosUsualWeb.bindUI({
        displayedAppointments,
        unsubscribe: () => { if (unsubscribe) { unsubscribe(); unsubscribe = null; } },
        reset: () => {
            closeSummaryModal(); closeClaimDetailModal(); closeDetailsModal(); closeShokaijyoModal();
            closeEditModal(); closePhoneEditModal(); closeVisitDateModal();
            editingDateTimeDocId = null; editingPhoneDocId = null;
            shokaijyoEditingDocId = null; shokaijyoEditingDest = null;
            visitDateEditingDocId = null; visitDateEditingDest = null;
            clearTimeout(logoutTimer);
        }
    });
    document.getElementById('passkeyLoginButton')?.addEventListener('click', () => { void window.sosUsualWeb.beginPasskeyLogin().catch(() => {}); });
    document.getElementById('retryEndButton')?.addEventListener('click', () => { void window.sosUsualWeb.client.retryEnd().catch(() => {}); });
    document.getElementById('resumeSessionButton')?.addEventListener('click', () => { void window.sosUsualWeb.gate.resume().catch(() => {}); });
}
function syncNativeLoginControls() {
    if (!usualPasskey) return;
    const phase = window.sosUsualWeb.client.state().phase;
    const setHidden = (id, hidden) => { const node = document.getElementById(id); if (node) node.hidden = hidden; };
    setHidden('passkeyLoginButton', false);
    setHidden('retryEndButton', !['end-pending', 'storage-blocked'].includes(phase));
    setHidden('resumeSessionButton', !['blocked', 'signed-out'].includes(phase));
    loginEmailInput.hidden = true; loginPasswordInput.hidden = true;
    loginButton.textContent = '従来のログインを使う';
    logoutButton.textContent = '利用終了';
    loginError.textContent = ['end-pending', 'storage-blocked'].includes(phase) ? '利用終了を確認できません。再試行してください。' : '';
}
auth.onAuthStateChanged(user => {
    syncNativeLoginControls();
    setSensitiveViewsAllowed(false);
    clearSensitiveUi();
    if (user) {
        setSensitiveViewsAllowed(true);
        loginContainer.style.display = 'none';
        mainAppContainer.style.display = 'block';
        userEmailSpan.textContent = user.email;
        generateYearOptions();
        initializeMobileViewMode();
        initializeMobileControlsState();
        initializeSummaryDate();
        window.sosConnection.start();
        startLogoutTimer();
    } else {
        loginContainer.style.display = 'block';
    }
});

// --- イベントリスナー ---
loginButton.addEventListener('click', () => {
    if (usualPasskey) { void window.sosUsualWeb.useLegacy().catch(() => {}); return; }
    const email = loginEmailInput.value;
    const password = loginPasswordInput.value;
    auth.signInWithEmailAndPassword(email, password)
        .catch(error => {
            loginError.textContent = `ログインに失敗しました: ${error.message}`;
        });
});

logoutButton.addEventListener('click', async () => {
    if (usualPasskey) { void window.sosUsualWeb.end().catch(() => {}); return; }
    setSensitiveViewsAllowed(false);
    clearSensitiveUi();
    loginContainer.style.display = 'block';
    try { await auth.signOut(); }
    catch (_) {
        loginError.textContent = 'ログアウトを完了できませんでした。画面の再表示は停止しました。端末を他の人へ渡さず、ページを再読み込みしてログアウトをやり直してください。';
    }
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

function handleAppointmentInteraction(target, docId, event) {
    if (target.closest('.services-cell')) {
        event?.preventDefault();
        openClaimDetailModal(docId);
        return;
    }
    if (target.classList.contains('name-cell')) {
        openDetailsModal(docId);
        return;
    }
    if (target.classList.contains('show-toggle-cell')) {
        toggleAppointmentStatus(target, docId, 'isShown');
        return;
    }
    if (target.closest('.date-cell')) {
        openEditModal(docId);
        return;
    }
    const referralTarget = target.closest('.referral-dest');
    if (referralTarget) {
        const destKey = referralTarget.dataset.dest;
        openShokaijyoModal(docId, destKey);
        return;
    }
    const visitDateTarget = target.closest('.visitdate-cell');
    if (visitDateTarget) {
        openVisitDateModal(docId, visitDateTarget.dataset.dest || null);
        return;
    }
    const receivedTarget = target.closest('.received-cell');
    if (receivedTarget) {
        toggleAppointmentStatus(receivedTarget, docId, 'isReceived', receivedTarget.dataset.dest || null);
        return;
    }
    const completedTarget = target.closest('.completed-cell');
    if (completedTarget) {
        toggleAppointmentStatus(completedTarget, docId, 'isCompleted', completedTarget.dataset.dest || null);
        return;
    }
    if (target.classList.contains('contract-cell') || target.classList.contains('col-contract')) {
        handleViewPdf(docId);
        return;
    }
    if (target.classList.contains('phone-cell')) {
        openPhoneEditModal(docId);
        return;
    }
    if (target.classList.contains('age-cell')) {
        const docRef = db.collection('appointments').doc(docId);
        if (usualPasskey) {
            const isPink = !target.classList.contains('pink');
            return window.sosUsualWeb.runEdit({key:'age:'+docId,button:target,
                write:()=>docRef.update({isAgePink:isPink}),
                onSuccess:()=>target.classList.toggle('pink',isPink),
                onFailure:()=>alert('更新を確認できませんでした。再読込して内容を確認してください。')});
        }
        const isPink = target.classList.toggle('pink');
        docRef.update({ isAgePink: isPink }).catch(error => {
            // 書き込み失敗時は先行して切り替えた表示を元に戻す
            target.classList.toggle('pink', !isPink);
            console.error('性別フラグの更新エラー:', error);
            alert('性別フラグの更新に失敗しました。');
        });
        return;
    }
}

tableBody.addEventListener('click', (e) => {
    const target = e.target;
    const tr = target.closest('tr');
    if (!tr) return;

    const docId = tr.dataset.id;
    if (!docId) return;

    handleAppointmentInteraction(target, docId, e);
});

mobileAppointmentsList?.addEventListener('click', (e) => {
    const rawTarget = e.target;
    if (!(rawTarget instanceof HTMLElement)) return;
    const card = rawTarget.closest('.appointment-card');
    if (!card) return;
    if (rawTarget.closest('.card-expand')) {
        toggleAppointmentCardExpansion(card);
        return;
    }
    const interactiveTarget = rawTarget.closest(MOBILE_CARD_ACTIONABLE_SELECTOR);
    if (!interactiveTarget) {
        toggleAppointmentCardExpansion(card);
        return;
    }
    const docId = card?.dataset.id;
    if (!docId) return;
    handleAppointmentInteraction(interactiveTarget, docId, e);
});

confirmEditBtn.addEventListener('click', () => {
    const passkeyEpoch = usualPasskey ? window.sosUsualWeb.capture() : null;
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
    
    if (usualPasskey) return window.sosUsualWeb.runEdit({key:'appointment',button:confirmEditBtn,
        write:()=>db.collection('appointments').doc(editingDateTimeDocId).update(dataToUpdate),
        onSuccess:closeEditModal,onFailure:()=>alert('更新を確認できませんでした。再読込して内容を確認してください。')});
    db.collection('appointments').doc(editingDateTimeDocId).update(dataToUpdate)
      .then(() => { if (usualPasskey) window.sosUsualWeb.assert(passkeyEpoch); closeEditModal(); })
      .catch(error => {
          console.error('更新エラー:', error);
          alert('更新に失敗しました。');
      });
});

cancelEditBtn.addEventListener('click', closeEditModal);
saveNotesButton.addEventListener('click', saveNotes);
closeDetailsModalButton.addEventListener('click', closeDetailsModal);
printInvoiceButton.addEventListener('click', printInvoice);
summaryPrevDateButton?.addEventListener('click', () => { closeSummaryModal(); return jumpToAdjacentSummaryReservationDate(-1); });
summaryNextDateButton?.addEventListener('click', () => { closeSummaryModal(); return jumpToAdjacentSummaryReservationDate(1); });
showSummaryButton?.addEventListener('click', () => { void showSummary(); });
summaryDateInput?.addEventListener('change', closeSummaryModal);
summaryModal?.addEventListener('keydown', event => { if (event.key === 'Escape') closeSummaryModal(); });
closeSummaryModalButton?.addEventListener('click', closeSummaryModal);
closeClaimDetailButton.addEventListener('click', closeClaimDetailModal);
claimDetailModal.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeClaimDetailModal();
});
mobileCompactViewButton?.addEventListener('click', () => applyMobileViewMode('compact'));
mobileCardViewButton?.addEventListener('click', () => applyMobileViewMode('card'));
mobileControlsToggle?.addEventListener('click', () => {
    setMobileControlsOpen(document.body.dataset.mobileControlsOpen !== 'true');
});
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

// Read-only viewer: use the exact record already loaded by the list.
function openClaimDetailModal(docId) {
    const data = displayedAppointments.get(docId);
    if (!data) {
        alert('一覧のデータを取得できませんでした。再接続後に開き直してください。');
        return;
    }
    const date = getCorrectedAppointmentDate(data);
    const dateText = date ? new Intl.DateTimeFormat('ja-JP', {
        dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tokyo'
    }).format(date) : '';
    claimDetailIdentity.textContent = [data.claimantName, data.contractNumber, dateText].filter(Boolean).join(' ｜ ');
    // A text region avoids native textarea focus/selection handling on iOS.
    claimDetailText.textContent = data.claimDetail || '';
    claimDetailModal.style.display = 'flex';
    claimDetailText.scrollTop = 0;
    document.body.classList.add('modal-open');
}

function closeClaimDetailModal() {
    claimDetailModal.style.display = 'none';
    claimDetailText.textContent = '';
    claimDetailIdentity.textContent = '';
    document.body.classList.remove('modal-open');
}

// 氏名の部分一致マッチング
// 保存形式: "JONES, JONATHAN"（姓, 名、大文字）
// 対応: 姓のみ / 名のみ / 姓名 / 名姓 / カンマあり / 大文字小文字不問
function openDetailsModal(docId) {
    const passkeyEpoch = usualPasskey ? window.sosUsualWeb.capture() : null;
    const viewIsCurrent = captureSensitiveViewSession();
    if (!viewIsCurrent()) return;
  db.collection('appointments').doc(docId).get().then(doc => {
        if (usualPasskey) window.sosUsualWeb.assert(passkeyEpoch);
        if (!viewIsCurrent()) return;
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
    detailsContentContainer.innerHTML = `
      <div class="detail-row">
        <div class="detail-item"><strong>予約日時</strong><span>${escapeHtml(displayDate)}</span></div>
        <div class="detail-item"><strong>契約番号</strong><span>${escapeHtml(data.contractNumber || '')}</span></div>
      </div>
      <div class="detail-row">
        <div class="detail-item"><strong>氏名</strong><span>${escapeHtml(data.claimantName || '')}</span></div>
        <div class="detail-item"><strong>生年月日(年齢)</strong><span>${escapeHtml(data.dateOfBirth || '')} (${escapeHtml(displayAge)})</span></div>
      </div>
      <div class="detail-row detail-row-full">
        <div class="detail-item"><strong>検査内容</strong><span>${escapeHtml((data.services || []).join(', '))}</span></div>
      </div>
    `;
    notesTextarea.value = data.notes || '';
    notesTextarea.readOnly = !DETAILS_EDITABLE;
    notesTextarea.placeholder = DETAILS_EDITABLE ? '1500文字程度まで入力可能...' : '';
    if (detailsModalLabel) detailsModalLabel.textContent = DETAILS_EDITABLE ? 'メモ (所見など):' : 'メモ:';
    saveNotesButton.style.display = DETAILS_EDITABLE ? '' : 'none';
    detailsModal.dataset.editingId = docId;
    detailsModal.style.display = 'flex';
    document.body.classList.add('modal-open');
  }).catch(error => {
      console.error('詳細モーダルの表示エラー:', error);
      alert('データの取得に失敗しました。');
  });
}

// ===== 紹介先 分類ロジック =====
// ===== 紹介状モーダル =====
function openShokaijyoModal(docId, destKey) {
    const passkeyEpoch = usualPasskey ? window.sosUsualWeb.capture() : null;
    const viewIsCurrent = captureSensitiveViewSession();
    if (!viewIsCurrent()) return;
    if (!REFERRAL_FULL[destKey]) return;

    db.collection('appointments').doc(docId).get().then(doc => {
        if (usualPasskey) window.sosUsualWeb.assert(passkeyEpoch);
        if (!viewIsCurrent()) return;
        if (!doc.exists) return;
        const data = doc.data();
        const saved = data.referrals && data.referrals[destKey];

        // モーダルを即座に表示（保存済みデータがあればそのまま、なければ正規表現でデフォルト表示）
        shokaijyoModalTitle.textContent = `紹介状 — ${REFERRAL_FULL[destKey].name}`;
        shokaijyoSheetContainer.innerHTML = buildSheetHTML(data, destKey, saved || null, null, SHOKAIJO_EDITABLE);
        shokaijyoEditingDocId = docId;
        shokaijyoEditingDest  = destKey;
        shokaijyoModal.style.display = 'flex';
        updateShokaijyoSheetScale();
        document.body.classList.add('modal-open');
        saveShokaijyoBtn.style.display = SHOKAIJO_EDITABLE ? '' : 'none';
        printShokaijyoBtn.style.display = '';
        if (SHOKAIJO_EDITABLE && !(saved && saved.name_kana)) {
            autofillShokaijyoKana(formatClaimantNameEn(data.claimantName));
        }
    }).catch(error => {
        console.error('紹介状モーダルの表示エラー:', error);
        alert('データの取得に失敗しました。');
    });
}

function updateShokaijyoSheetScale() {
    const sheet = shokaijyoSheetContainer?.querySelector('.sheet');
    if (!sheet) return;

    if (window.innerWidth > 768) {
        shokaijyoSheetContainer.style.setProperty('--shokaijyo-scale', '1');
        shokaijyoSheetContainer.style.minHeight = '';
        return;
    }

    const availableWidth = Math.max(shokaijyoSheetContainer.clientWidth - 12, 1);
    const availableHeight = Math.max(window.innerHeight * 0.62, 1);
    const baseWidth = sheet.offsetWidth || 1;
    const baseHeight = sheet.offsetHeight || 1;
    const scale = Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);

    shokaijyoSheetContainer.style.setProperty('--shokaijyo-scale', String(scale));
    shokaijyoSheetContainer.style.minHeight = `${Math.ceil(baseHeight * scale) + 12}px`;
}

// ===== 受診日モーダル =====
