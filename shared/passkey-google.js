// パスキー登録時の「Googleで本人確認」専用（SOSList本体のログインとは完全に別）。
// 本体の Firebase 9.6.1 はGoogle画面が閉じてから結果を2秒しか待たず、iPhoneで
// 「popup-closed-by-user」になることがあるため、ここだけ新しい版（8秒待つ）を使う。
// ページ読み込み時に準備しておき、ボタンのタップ直後に同期的にポップアップを開く（ブロック回避）。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    initializeAuth, inMemoryPersistence, browserPopupRedirectResolver,
    GoogleAuthProvider, signInWithPopup, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

/* global firebaseConfig */
const app = initializeApp(firebaseConfig, 'passkey-google');
const auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });

window.SOS_PASSKEY_GOOGLE = {
    signIn() {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return signInWithPopup(auth, provider).then(async result => {
            const token = await result.user.getIdToken();
            const email = result.user.email;
            await signOut(auth).catch(() => {});
            return { token, email };
        });
    },
};
