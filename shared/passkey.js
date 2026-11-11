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
    const firstRegisterButton = $('passkeyFirstRegisterButton');
    const loginStatus = $('passkeyLoginStatus');

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
        RECENT_LOGIN_REQUIRED: '安全のため、もう一度ログインし直してから操作してください。',
        GOOGLE_REQUIRED: 'Googleアカウントでの本人確認が必要です。',
        NOT_ALLOWED: 'このGoogleアカウントは登録が許可されていません。管理者に連絡してください。',
        CHALLENGE_EXPIRED: '時間切れです。もう一度お試しください。',
        UNKNOWN_PASSKEY: 'このパスキーは登録されていないか、削除されています。「パスキーを登録」から登録し直してください。',
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
    // iPhoneのSafari対策: ログイン用チャレンジを事前に取得しておき、タップ直後にパスキーを呼び出す
    let prepared = null; // { challengeId, options, at }
    async function prefetchLogin() {
        if (auth.currentUser) return;
        try { prepared = { ...(await call('login/options')), at: Date.now() }; } catch (_) { prepared = null; }
    }
    auth.onAuthStateChanged(user => { if (!user) prefetchLogin(); else prepared = null; });
    setInterval(() => { if (!auth.currentUser && !busy) prefetchLogin(); }, 4 * 60 * 1000);

    let busy = false;
    loginButton.addEventListener('click', async () => {
        if (busy) return;
        busy = true; loginButton.disabled = true; loginError.textContent = '';
        try {
            const fresh = prepared && Date.now() - prepared.at < 4 * 60 * 1000 ? prepared : null;
            prepared = null;
            const { challengeId, options } = fresh || await call('login/options');
            const response = await lib.startAuthentication({ optionsJSON: options });
            const { customToken } = await call('login/verify', { challengeId, response });
            await auth.signInWithCustomToken(customToken);
        } catch (e) {
            if (!cancelled(e)) loginError.textContent = 'パスキーでログインできませんでした: ' + message(e);
        } finally {
            busy = false; loginButton.disabled = false;
            if (!auth.currentUser) prefetchLogin();
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
                text.textContent = `${p.owner || '(旧)'} ・ ${p.label}（登録 ${fmt(p.createdAt)} / 最終使用 ${fmt(p.lastUsedAt)}）`;
                const del = document.createElement('button');
                del.type = 'button'; del.textContent = '削除';
                del.addEventListener('click', async () => {
                    if (!confirm(`${p.owner || ''} の「${p.label}」を削除しますか？そのパスキーではログインできなくなります。`)) return;
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

    // Googleで本人確認（SOSListのログイン状態には影響しない別インスタンスを使う）
    async function googleIdToken() {
        const app = firebase.initializeApp(firebaseConfig, 'passkey-google-' + Date.now());
        try {
            const gAuth = app.auth();
            await gAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            const result = await gAuth.signInWithPopup(provider);
            const token = await result.user.getIdToken();
            const email = result.user.email;
            await gAuth.signOut().catch(() => {});
            return { token, email };
        } finally {
            app.delete().catch(() => {});
        }
    }

    // 登録は2タップ: ①Googleで本人確認（＋準備）→ ②パスキー作成。
    // iPhoneのSafariはパスキー作成をタップ直後にしか許可しないため、②は通信を挟まず即座に呼び出す。
    let pending = null; // { g, label, challengeId, options, at }

    async function prepare() {
        let g;
        try { g = await googleIdToken(); }
        catch (e) {
            if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return 'Googleでの本人確認を取り消しました。';
            if (e?.code === 'auth/popup-blocked') return 'ポップアップがブロックされました。ブラウザでポップアップを許可してから、もう一度押してください。';
            return 'Googleで本人確認できませんでした: ' + (e?.message || '');
        }
        const label = prompt(`${g.email} のパスキーを登録します。\nこの端末の名前（例: iPhone、事務所PC）`, '');
        if (label === null) return '登録を取り消しました。';
        try {
            const { challengeId, options } = await call('register/options', {}, g.token);
            pending = { g, label, challengeId, options, at: Date.now() };
            return `本人確認できました（${g.email}）。もう一度ボタンを押してパスキーを作成してください。`;
        } catch (e) {
            return '登録できませんでした: ' + message(e);
        }
    }

    async function create() {
        const p = pending; pending = null;
        try {
            const response = await lib.startRegistration({ optionsJSON: p.options });
            await call('register/verify', { challengeId: p.challengeId, response, label: p.label }, p.g.token);
            return `登録しました（${p.g.email}）。次回から「パスキーでログイン」を使えます。`;
        } catch (e) {
            if (cancelled(e)) return '登録を取り消しました。';
            if (e?.name === 'InvalidStateError') return 'この端末には既に登録済みです。';
            return '登録できませんでした: ' + message(e);
        }
    }

    const buttons = [[firstRegisterButton, loginStatus], [registerButton, statusEl]];
    const defaultText = new Map(buttons.map(([b]) => [b, b.textContent]));
    function syncButtons() {
        for (const [b] of buttons) b.textContent = pending ? `パスキーを作成する（${pending.g.email}）` : defaultText.get(b);
    }
    for (const [button, status] of buttons) {
        button.addEventListener('click', async () => {
            if (pending && Date.now() - pending.at > 4 * 60 * 1000) pending = null;
            for (const [b] of buttons) b.disabled = true;
            if (button === firstRegisterButton) loginError.textContent = '';
            try {
                if (pending) { status.textContent = '作成中…'; status.textContent = await create(); }
                else { status.textContent = 'Googleで本人確認中…'; status.textContent = await prepare(); }
            } finally {
                for (const [b] of buttons) b.disabled = false;
                syncButtons();
                if (button === registerButton) refreshList();
            }
        });
    }

    // パスキーでのログインは6時間で自動終了（データベース側の規則でも6時間を過ぎると拒否される）
    const SESSION_LIMIT_MS = 6 * 60 * 60 * 1000;
    let sessionEndsAt = null;
    function checkSessionLimit() {
        if (sessionEndsAt === null || !auth.currentUser || Date.now() < sessionEndsAt) return;
        sessionEndsAt = null;
        document.getElementById('logoutButton').click();
        loginError.textContent = 'パスキーでのログインから6時間たったため、自動でログアウトしました。もう一度「パスキーでログイン」を押してください。';
    }
    setInterval(checkSessionLimit, 30 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkSessionLimit(); });

    // ログイン中の表示に「誰のパスキーか」を添える ＋ 6時間の期限を設定
    auth.onAuthStateChanged(async user => {
        sessionEndsAt = null;
        if (!user) return;
        try {
            const { claims } = await user.getIdTokenResult();
            if (auth.currentUser !== user || !claims.passkey) return;
            sessionEndsAt = Number(claims.auth_time) * 1000 + SESSION_LIMIT_MS;
            checkSessionLimit();
            if (claims.staffEmail && auth.currentUser) {
                const span = document.getElementById('userEmail');
                span.textContent = `${user.email}（パスキー: ${claims.staffEmail}）`;
            }
        } catch (_) {}
    });
})();
