// SOSList パスキーログイン（Web版のみ）
// パスキーで本人確認 → サーバーが既存のFirebaseアカウント用トークンを返す → 通常のFirebaseログイン。
// ログイン後は従来と同じFirebaseの仕組み（再読み込みでも維持、ログアウトで終了）。
(function () {
    'use strict';
    const API = window.SOS_PASSKEY_API || 'https://sos-passkey-455081821929.asia-northeast1.run.app';
    const lib = window.SimpleWebAuthnBrowser;
    const $ = id => document.getElementById(id);
    const loginArea = $('passkeyLoginArea');
    const loginButton = $('passkeyLoginButton');
    const manageButton = $('passkeyManageButton');
    const modal = $('passkeyModal');
    const registerButton = $('passkeyRegisterButton');
    const statusEl = $('passkeyStatus');
    const listEl = $('passkeyList');
    const loginError = $('loginError');

    // 旧パスキー方式がブラウザに残した状態を削除（旧方式は撤去済み）
    try {
        for (const store of [window.localStorage, window.sessionStorage]) {
            for (const key of Object.keys(store)) {
                if (key.startsWith('soslist.bridge.') || key === 'soslist-bridge-event') store.removeItem(key);
            }
        }
    } catch (_) { /* ストレージ不可でも続行 */ }

    const supported = !!(lib && lib.browserSupportsWebAuthn());
    if (!supported) return;
    loginArea.hidden = false;

    const MESSAGES = {
        LOGIN_REQUIRED: 'ログインし直してください。',
        RECENT_LOGIN_REQUIRED: '安全のため、いったんログアウトしてもう一度ログインしてから登録してください。',
        CHALLENGE_EXPIRED: '時間切れです。もう一度お試しください。',
        UNKNOWN_PASSKEY: 'このパスキーは登録されていないか、削除されています。パスワードでログインして登録し直してください。',
        VERIFY_FAILED: 'パスキーを確認できませんでした。もう一度お試しください。',
        ORIGIN_DENIED: 'このページからは利用できません。',
    };
    const message = e => MESSAGES[e?.code] || e?.message || '通信に失敗しました。';
    const cancelled = e => e?.name === 'NotAllowedError' || e?.name === 'AbortError';

    async function call(path, body, idToken) {
        const headers = { 'content-type': 'application/json' };
        if (idToken) headers.authorization = 'Bearer ' + idToken;
        let res;
        try {
            res = await fetch(API + '/' + path, { method: 'POST', headers, body: JSON.stringify(body || {}), cache: 'no-store' });
        } catch (_) {
            throw Object.assign(new Error('通信に失敗しました。ネットワークを確認してください。'), { code: 'NETWORK' });
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { code: data.error });
        return data;
    }

    // --- パスキーでログイン ---
    let busy = false;
    loginButton.addEventListener('click', async () => {
        if (busy) return;
        busy = true; loginButton.disabled = true; loginError.textContent = '';
        try {
            const { challengeId, options } = await call('login/options');
            const response = await lib.startAuthentication({ optionsJSON: options });
            const { customToken } = await call('login/verify', { challengeId, response });
            await auth.signInWithCustomToken(customToken);
        } catch (e) {
            if (!cancelled(e)) loginError.textContent = 'パスキーでログインできませんでした: ' + message(e);
        } finally {
            busy = false; loginButton.disabled = false;
        }
    });

    // --- 登録・管理 ---
    auth.onAuthStateChanged(user => { manageButton.hidden = !user; });
    manageButton.addEventListener('click', () => { modal.style.display = 'block'; statusEl.textContent = ''; refreshList(); });
    $('passkeyCloseButton').addEventListener('click', () => { modal.style.display = 'none'; });

    const fmt = ms => ms ? new Date(ms).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '未使用';

    async function refreshList() {
        listEl.textContent = '読み込み中…';
        try {
            const { passkeys } = await call('list', {}, await auth.currentUser.getIdToken());
            listEl.textContent = '';
            if (!passkeys.length) { listEl.textContent = 'まだありません。'; return; }
            for (const p of passkeys) {
                const li = document.createElement('li');
                const text = document.createElement('span');
                text.textContent = `${p.label}（登録 ${fmt(p.createdAt)} / 最終使用 ${fmt(p.lastUsedAt)}）`;
                const del = document.createElement('button');
                del.type = 'button'; del.textContent = '削除';
                del.addEventListener('click', async () => {
                    if (!confirm(`「${p.label}」を削除しますか？この端末ではパスキーでログインできなくなります。`)) return;
                    try { await call('delete', { id: p.id }, await auth.currentUser.getIdToken()); refreshList(); }
                    catch (e) { statusEl.textContent = '削除できませんでした: ' + message(e); }
                });
                li.append(text, ' ', del);
                listEl.append(li);
            }
        } catch (e) {
            listEl.textContent = '一覧を取得できませんでした: ' + message(e);
        }
    }

    registerButton.addEventListener('click', async () => {
        const label = prompt('このパスキーの名前（例: 山田 iPhone）', '');
        if (label === null) return;
        registerButton.disabled = true; statusEl.textContent = '登録中…';
        try {
            const token = await auth.currentUser.getIdToken(true);
            const { challengeId, options } = await call('register/options', {}, token);
            const response = await lib.startRegistration({ optionsJSON: options });
            await call('register/verify', { challengeId, response, label }, token);
            statusEl.textContent = '登録しました。次回から「パスキーでログイン」を使えます。';
            refreshList();
        } catch (e) {
            statusEl.textContent = cancelled(e) ? '登録を取り消しました。'
                : e?.name === 'InvalidStateError' ? 'この端末には既に登録済みです。'
                : '登録できませんでした: ' + message(e);
        } finally {
            registerButton.disabled = false;
        }
    });
})();
