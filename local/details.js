const detailsRoot = document.getElementById('detailsRoot');
const injectedDetailsPayload = window.__SOSLIST_DETAILS_PAYLOAD__ || null;
const docId = injectedDetailsPayload?.docId || getDocIdFromLocation();
const DETAIL_PAYLOAD_PREFIX = 'soslist-detail-payload:';
const DETAIL_SAVE_REQUEST_KEY = 'soslist-detail-save-request';
const DETAIL_SAVE_RESPONSE_PREFIX = 'soslist-detail-save-response:';
const DETAIL_REFERRAL_OPEN_REQUEST_KEY = 'soslist-detail-referral-open-request';
const DETAIL_CLOSE_WINDOW_KEY = 'soslist-detail-close-window';
const REFERRAL_DISPLAY = { ASBO: 'aSBo', KIN: 'KINSP', ANSHIN: 'ANSIN', LAB: 'Lab' };
const QTC_TOOL_LABELS = {
    imaging: 'XR',
    audiogram: 'AUD'
};
let activeSaveRequestId = null;
let currentDetailsData = null;
let pendingCloseAfterSave = false;

if (injectedDetailsPayload?.docId) {
    renderDetails(injectedDetailsPayload.docId, injectedDetailsPayload);
} else if (!docId) {
    renderError('予約IDが指定されていません。');
} else {
    loadDetailsFromStorage(docId);
}

window.addEventListener('storage', handleStorageEvent);
window.addEventListener('va-records-result', handleVaRecordsResult);

function getDocIdFromLocation() {
    const searchParams = new URLSearchParams(window.location.search);
    const searchId = searchParams.get('id');
    if (searchId) {
        return searchId;
    }

    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    return hashParams.get('id');
}

function loadDetailsFromStorage(targetDocId) {
    const rawPayload = localStorage.getItem(`${DETAIL_PAYLOAD_PREFIX}${targetDocId}`);
    if (!rawPayload) {
        renderError('予約詳細データが見つかりません。もう一度氏名をクリックしてください。');
        return;
    }

    try {
        renderDetails(targetDocId, JSON.parse(rawPayload));
    } catch (error) {
        console.error(error);
        renderError('予約詳細データの読み込みに失敗しました。');
    }
}

function renderDetails(targetDocId, data) {
    currentDetailsData = { ...data };
    const displayDate = formatAppointmentDateTime(data.appointmentDateTimeMs);
    const services = Array.isArray(data.services) ? data.services.join(', ') : '';
    const notes = data.notes || '';
    const referenceUrl = data.referenceUrl || '';
    const referralDests = Array.isArray(data.referralDests) ? data.referralDests : [];
    const referrals = data.referrals || {};
    const contractNumber = data.contractNumber || '';
    const referralMarkup = referralDests.length > 0
        ? referralDests.map((destKey) => {
            const isSaved = !!(referrals[destKey] && referrals[destKey].savedAt);
            const savedClass = isSaved ? ' referral-chip-saved' : '';
            if (destKey === 'LAB') {
                return `<span class="referral-chip referral-chip-lab" data-dest="${escapeHtml(destKey)}">${escapeHtml(REFERRAL_DISPLAY[destKey] || destKey)}</span>`;
            }
            return `<button type="button" class="referral-chip${savedClass}" data-dest="${escapeHtml(destKey)}">${escapeHtml(REFERRAL_DISPLAY[destKey] || destKey)}</button>`;
        }).join('')
        : '<div class="detail-value">紹介先なし</div>';
    const qtcToolButtons = Object.entries(QTC_TOOL_LABELS).map(([toolKey, label]) => (
        `<button type="button" class="secondary qtc-tool-button" data-tool="${escapeHtml(toolKey)}"${contractNumber ? '' : ' disabled'}>${escapeHtml(label)}</button>`
    )).join('');
    const utilityButtons = `
        <button type="button" class="secondary utility-tool-button" data-tool="va-records">Folder</button>
    `;

    detailsRoot.className = 'page';
    detailsRoot.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">予約詳細</h1>
            <div class="action-bar">
                ${qtcToolButtons}
                ${utilityButtons}
                <button type="button" id="closeWindowButton" class="secondary">閉じる</button>
            </div>
        </div>

        <div class="detail-grid">
            <section class="detail-card">
                <span class="detail-label">予約日時</span>
                <div class="detail-value">${escapeHtml(displayDate)}</div>
            </section>
            <section class="detail-card">
                <span class="detail-label">契約番号</span>
                <div class="detail-value">${escapeHtml(data.contractNumber || '')}</div>
            </section>
            <section class="detail-card">
                <span class="detail-label">氏名</span>
                <div class="detail-value">${escapeHtml(data.claimantName || '')}</div>
            </section>
            <section class="detail-card">
                <span class="detail-label">紹介先</span>
                <div class="referral-chip-row">${referralMarkup}</div>
            </section>
            <section class="detail-card full-span">
                <span class="detail-label">検査内容</span>
                <div class="detail-value">${escapeHtml(services)}</div>
            </section>
        </div>

        <section class="notes-card">
            <span class="detail-label">URL</span>
            <input id="referenceUrlInput" type="url" class="detail-input" placeholder="https://..." value="${escapeHtml(referenceUrl)}">
            <a id="referenceUrlLink" class="reference-link${sanitizeUrl(referenceUrl) ? '' : ' is-hidden'}" href="${escapeAttribute(sanitizeUrl(referenceUrl))}" rel="noopener noreferrer">${escapeHtml(sanitizeUrl(referenceUrl))}</a>
            <span class="detail-label">メモ (所見など)</span>
            <textarea id="notesTextarea" placeholder="1500文字程度まで入力可能...">${escapeHtml(notes)}</textarea>
            <div class="button-row">
                <div id="statusText" class="status-text"></div>
                <div class="button-group">
                    <button type="button" id="saveNotesButton">保存</button>
                </div>
            </div>
        </section>
    `;

    document.getElementById('closeWindowButton').addEventListener('click', () => {
        saveNotes(targetDocId, { closeAfterSave: true });
    });

    document.getElementById('saveNotesButton').addEventListener('click', () => {
        saveNotes(targetDocId);
    });

    const referenceUrlInput = document.getElementById('referenceUrlInput');
    referenceUrlInput.addEventListener('input', () => {
        syncReferenceUrlLink(referenceUrlInput.value);
    });

    document.querySelectorAll('.referral-chip').forEach((button) => {
        button.addEventListener('click', () => {
            if (button.dataset.dest === 'LAB') return;
            openReferralSheet(targetDocId, button.dataset.dest || '');
        });
    });

    document.querySelectorAll('.qtc-tool-button').forEach((button) => {
        button.addEventListener('click', () => {
            openQtcTool(button.dataset.tool || '', contractNumber);
        });
    });

    document.querySelectorAll('.utility-tool-button').forEach((button) => {
        button.addEventListener('click', () => {
            runUtilityTool(button.dataset.tool || '');
        });
    });
}

function saveNotes(targetDocId, options = {}) {
    const { closeAfterSave = false } = options;
    const notesTextarea = document.getElementById('notesTextarea');
    const referenceUrlInput = document.getElementById('referenceUrlInput');
    const saveButton = document.getElementById('saveNotesButton');
    const statusText = document.getElementById('statusText');
    const originalLabel = saveButton.textContent;

    if (activeSaveRequestId) {
        pendingCloseAfterSave = pendingCloseAfterSave || closeAfterSave;
        return;
    }

    pendingCloseAfterSave = closeAfterSave;

    saveButton.disabled = true;
    saveButton.textContent = '保存中...';
    statusText.textContent = closeAfterSave ? '保存して閉じています...' : '保存しています...';

    activeSaveRequestId = `detail-save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const savePayload = {
        requestId: activeSaveRequestId,
        docId: targetDocId,
        notes: notesTextarea.value,
        referenceUrl: referenceUrlInput ? referenceUrlInput.value.trim() : ''
    };

    // ネイティブアプリではWKWebView間にstorageイベントが届かないため、ブリッジ経由で保存する
    const nativeSaveHandler = window.webkit?.messageHandlers?.saveDetails;
    if (nativeSaveHandler) {
        nativeSaveHandler.postMessage(savePayload);
    } else {
        localStorage.setItem(DETAIL_SAVE_REQUEST_KEY, JSON.stringify(savePayload));
    }

    window.setTimeout(() => {
        if (!activeSaveRequestId) {
            return;
        }
        statusText.textContent = '保存応答を待っています...';
    }, 1500);

    window.setTimeout(() => {
        if (activeSaveRequestId === null) {
            return;
        }
        statusText.textContent = '保存に時間がかかっています。';
        saveButton.disabled = false;
        saveButton.textContent = originalLabel;
    }, 5000);
}

function applySaveResponse(response) {
    const saveButton = document.getElementById('saveNotesButton');
    const statusText = document.getElementById('statusText');
    const originalLabel = '保存';

    statusText.textContent = response?.message || '';
    if (response?.status !== 'success') {
        window.alert('メモの保存に失敗しました。');
    } else if (pendingCloseAfterSave) {
        closeDetailsWindowImmediately();
    }

    saveButton.disabled = false;
    saveButton.textContent = originalLabel;
    activeSaveRequestId = null;
    pendingCloseAfterSave = false;
}

// ネイティブアプリからの保存結果（saveDetailsブリッジの応答）
window.__sosDetailSaveResult = function(response) {
    if (!activeSaveRequestId || response?.requestId !== activeSaveRequestId) {
        return;
    }
    applySaveResponse(response);
};

function handleStorageEvent(event) {
    if (!activeSaveRequestId) {
        return;
    }

    const expectedKey = `${DETAIL_SAVE_RESPONSE_PREFIX}${activeSaveRequestId}`;
    if (event.key !== expectedKey || !event.newValue) {
        return;
    }

    let response = null;
    try {
        response = JSON.parse(event.newValue);
    } catch (error) {
        console.error(error);
    }
    localStorage.removeItem(expectedKey);
    applySaveResponse(response);
}

function openReferralSheet(targetDocId, destKey) {
    if (!destKey) {
        return;
    }

    const request = {
        requestId: `detail-referral-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        docId: targetDocId,
        destKey
    };

    // ネイティブアプリではブリッジ経由でメインWebViewに紹介状を開かせる
    const nativeReferralHandler = window.webkit?.messageHandlers?.openReferralFromDetails;
    if (nativeReferralHandler) {
        nativeReferralHandler.postMessage(request);
        return;
    }

    if (window.webkit?.messageHandlers?.focusMainWindow) {
        window.webkit.messageHandlers.focusMainWindow.postMessage(destKey);
    }

    localStorage.setItem(DETAIL_REFERRAL_OPEN_REQUEST_KEY, JSON.stringify(request));
}

function closeDetailsWindowImmediately() {
    if (window.webkit?.messageHandlers?.closeDetailsWindow) {
        window.webkit.messageHandlers.closeDetailsWindow.postMessage(docId || '');
        return;
    }

    localStorage.setItem(DETAIL_CLOSE_WINDOW_KEY, JSON.stringify({
        requestId: `detail-close-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        docId: docId || ''
    }));

    window.close();
}

function openQtcTool(toolName, contractNumber) {
    if (!toolName || !contractNumber) {
        window.alert('契約番号がないため開けません。');
        return;
    }

    if (window.webkit?.messageHandlers?.openQtcTool) {
        window.webkit.messageHandlers.openQtcTool.postMessage({
            tool: toolName,
            contractNumber
        });
        return;
    }

    const toolFile = toolName === 'audiogram' ? 'audiogram.html' : 'ImageReport.html';
    const url = `http://127.0.0.1:19876/${encodeURIComponent(toolFile)}?contract=${encodeURIComponent(contractNumber)}`;
    const childWindow = window.open(url, '_blank', 'noopener');
    if (!childWindow) {
        window.alert('ツール画面を開けませんでした。');
    }
}

function runUtilityTool(toolName) {
    const statusText = document.getElementById('statusText');

    if (toolName !== 'va-records') {
        return;
    }

    if (window.webkit?.messageHandlers?.runUtilityTool) {
        const notesTextarea = document.getElementById('notesTextarea');
        if (statusText) {
            statusText.textContent = 'VA Records を保存しています...';
        }
        window.webkit.messageHandlers.runUtilityTool.postMessage({
            tool: toolName,
            details: {
                ...(currentDetailsData || {}),
                docId: docId || '',
                notes: notesTextarea ? notesTextarea.value : (currentDetailsData?.notes || '')
            }
        });
        return;
    }

    window.alert('この機能はローカルアプリ版で使用してください。');
}

function handleVaRecordsResult(event) {
    const statusText = document.getElementById('statusText');
    const detail = event.detail || {};
    const message = detail.message || '';

    if (statusText) {
        statusText.textContent = message;
    }

    if (detail.status === 'error' && message) {
        window.alert(message);
    }
}

function syncReferenceUrlLink(rawValue) {
    const link = document.getElementById('referenceUrlLink');
    if (!link) {
        return;
    }

    const trimmedValue = (rawValue || '').trim();
    if (!trimmedValue) {
        link.classList.add('is-hidden');
        link.removeAttribute('href');
        link.textContent = '';
        return;
    }

    const safeUrl = sanitizeUrl(trimmedValue);
    if (!safeUrl) {
        link.classList.add('is-hidden');
        link.removeAttribute('href');
        link.textContent = '';
        return;
    }
    link.classList.remove('is-hidden');
    link.href = safeUrl;
    link.textContent = safeUrl;
}

function renderError(message) {
    detailsRoot.className = 'error';
    detailsRoot.textContent = message;
}

function formatAppointmentDateTime(timestampMs) {
    if (!timestampMs) {
        return '日付なし';
    }

    const date = new Date(timestampMs);
    const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'Asia/Tokyo' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' };

    return `${new Intl.DateTimeFormat('ja-JP', dateOptions).format(date)} ${new Intl.DateTimeFormat('ja-JP', timeOptions).format(date)}`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return entities[char];
    });
}

function escapeAttribute(value) {
    return escapeHtml(value);
}

// http/https 以外のスキーム（javascript: 等）はリンク化しない
function sanitizeUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return trimmed;
        }
    } catch (_) { /* 不正なURLはリンク化しない */ }
    return '';
}
