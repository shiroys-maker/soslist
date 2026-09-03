// Firebase初期化・共通定数・共通関数は shared/core.js（先に読み込み）にある

// Web版のターゲット設定（shared/core.js が実行時に参照）
const SOSLIST_TARGET = {
    mobileUI: true,                      // モバイルカードUIあり
    deleteColumn: false,                 // 削除ボタン列なし
    perReferralStatus: true,             // 紹介先ごとに受診日・受・済を管理
    servicesCellClass: 'col-services',   // 検査内容セルは編集不可
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
const MOBILE_CONTROLS_OPEN_KEY = 'soslist-mobile-controls-open';
const MOBILE_CARD_ACTIONABLE_SELECTOR = 'button, a, .name-cell, .show-toggle-cell, .contract-cell, .phone-cell, .visitdate-cell, .received-cell, .completed-cell, .referral-dest, .age-cell';

let shokaijyoEditingDocId = null;
let shokaijyoEditingDest  = null;
let visitDateEditingDocId = null;
let visitDateEditingDest  = null;

window.addEventListener('resize', updateShokaijyoSheetScale);

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
    });
    if (willExpand) {
        card.classList.add('is-expanded');
    }
}

function setMobileControlsOpen(isOpen) {
    const normalized = Boolean(isOpen);
    document.body.dataset.mobileControlsOpen = normalized ? 'true' : 'false';
    mobileControlsToggle?.setAttribute('aria-expanded', normalized ? 'true' : 'false');
    mobileControlsToggle?.classList.toggle('is-open', normalized);
    mobileControlsPanel?.classList.toggle('is-open', normalized);
    mobileControlsToggle.textContent = normalized ? '操作 ▲' : '操作 ▼';
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

function renderInlineMarkdown(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderMarkdownToHtml(markdown) {
    const blocks = String(markdown || '').replace(/\r/g, '').split(/\n{2,}/);
    return blocks.map((block) => {
        const lines = block.split('\n').filter(Boolean);
        if (lines.length === 0) return '';

        const heading = lines[0].match(/^(#{1,3})\s+(.+)$/);
        if (heading && lines.length === 1) {
            const level = Math.min(heading[1].length, 3);
            return `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`;
        }

        const unordered = lines.every((line) => /^-\s+/.test(line));
        if (unordered) {
            return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^-\s+/, ''))}</li>`).join('')}</ul>`;
        }

        const ordered = lines.every((line) => /^\d+\.\s+/.test(line));
        if (ordered) {
            return `<ol>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
        }

        return `<p>${lines.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`;
    }).join('\n');
}

function openSummaryModal(ymd, summaryMarkdown, audioUrl = null) {
    summaryModalTitle.textContent = 'Summary';
    summaryModalMeta.textContent = ymd;
    summaryModalBody.innerHTML = summaryMarkdown
        ? renderMarkdownToHtml(summaryMarkdown)
        : '<p>サマリーは未作成です。</p>';

    if (audioUrl) {
        const playerSection = document.createElement('section');
        playerSection.className = 'summary-audio-player';

        const label = document.createElement('div');
        label.className = 'summary-audio-label';
        label.textContent = 'Summary 音声';

        const player = document.createElement('audio');
        player.controls = true;
        player.preload = 'metadata';
        player.src = audioUrl;

        playerSection.append(label, player);
        summaryModalBody.prepend(playerSection);
    }
    summaryModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function closeSummaryModal() {
    summaryModal.style.display = 'none';
    summaryModalMeta.textContent = '';
    summaryModalBody.innerHTML = '';
    document.body.classList.remove('modal-open');
}

async function showSummary() {
    if (!summaryDateInput?.value) {
        alert('Summaryの日付を選んでください。');
        return;
    }

    const targetDate = summaryDateInput.value;
    const summary = await fetchSummary(targetDate);
    let audioUrl = null;
    if (summary.audioStoragePath) {
        try {
            audioUrl = await storage.ref(summary.audioStoragePath).getDownloadURL();
        } catch (error) {
            console.warn('Summary 音声の取得に失敗しました:', error.code, error.message);
        }
    }
    openSummaryModal(targetDate, summary.summaryMarkdown, audioUrl);
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

// --- ログイン状態の監視 ---
auth.onAuthStateChanged(user => {
    if (user) {
        loginContainer.style.display = 'none';
        mainAppContainer.style.display = 'block';
        userEmailSpan.textContent = user.email;
        
        // 年選択オプションを生成
        generateYearOptions();
        initializeMobileViewMode();
        initializeMobileControlsState();
        initializeSummaryDate();

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

function handleAppointmentInteraction(target, docId) {
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
        const destKey = receivedTarget.dataset.dest || null;
        const docRef = db.collection('appointments').doc(docId);
        docRef.get().then(doc => {
            if (!doc.exists) return null;
            if (!destKey) return docRef.update({ isReceived: !doc.data().isReceived });
            const current = doc.data().referrals?.[destKey]?.isReceived === true;
            return docRef.update({ [`referrals.${destKey}.isReceived`]: !current });
        }).catch(error => {
            console.error('受領フラグの更新エラー:', error);
            alert('受領フラグの更新に失敗しました。');
        });
        return;
    }
    const completedTarget = target.closest('.completed-cell');
    if (completedTarget) {
        const destKey = completedTarget.dataset.dest || null;
        const docRef = db.collection('appointments').doc(docId);
        docRef.get().then(doc => {
            if (!doc.exists) return null;
            if (!destKey) return docRef.update({ isCompleted: !doc.data().isCompleted });
            const current = doc.data().referrals?.[destKey]?.isCompleted === true;
            return docRef.update({ [`referrals.${destKey}.isCompleted`]: !current });
        }).catch(error => {
            console.error('完了フラグの更新エラー:', error);
            alert('完了フラグの更新に失敗しました。');
        });
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

    handleAppointmentInteraction(target, docId);
});

mobileAppointmentsList?.addEventListener('click', (e) => {
    const rawTarget = e.target;
    if (!(rawTarget instanceof HTMLElement)) return;
    const card = rawTarget.closest('.appointment-card');
    if (!card) return;
    const interactiveTarget = rawTarget.closest(MOBILE_CARD_ACTIONABLE_SELECTOR);
    if (!interactiveTarget) {
        toggleAppointmentCardExpansion(card);
        return;
    }
    const docId = card?.dataset.id;
    if (!docId) return;
    handleAppointmentInteraction(interactiveTarget, docId);
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
showSummaryButton?.addEventListener('click', () => {
    showSummary().catch(error => {
        console.error('Summary display error:', error);
        alert(`Summaryの表示に失敗しました: ${error.message}`);
    });
});
closeSummaryModalButton?.addEventListener('click', closeSummaryModal);
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

// 氏名の部分一致マッチング
// 保存形式: "JONES, JONATHAN"（姓, 名、大文字）
// 対応: 姓のみ / 名のみ / 姓名 / 名姓 / カンマあり / 大文字小文字不問
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
    if (!REFERRAL_FULL[destKey]) return;

    db.collection('appointments').doc(docId).get().then(doc => {
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
