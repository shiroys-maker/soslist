#!/usr/bin/env node
// SOSList Local の自動ログイン用トークンを作る（パスワード不要）。
// 1) この Mac の Google Cloud 認証 (ADC) でアクセストークンを取得
// 2) 署名専用サービスアカウント sos-local-signer で Firebase カスタムトークンに署名
// 3) この Mac 固有の秘密鍵（macOS キーチェーン）をクレームに含める。データベースの規則はその鍵の
//    ハッシュを確認してから「ローカルツール用の全権限」を与える。
// 出力: {"token":"..."} / 失敗時 {"error":"CODE","message":"..."}（終了コード1）
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT = 'sos-list-4d150';
const SIGNER = `sos-local-signer@${PROJECT}.iam.gserviceaccount.com`;
const UID = 'jpnoE4ygk5ZqR8rsaJnzRSy5poA3'; // sos@niraissc.jp
const KEYCHAIN_SERVICE = 'soslist-local-login';
const AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

class Fail extends Error { constructor(code, message) { super(message); this.code = code; } }

function readAdc() {
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  let adc;
  try { adc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Fail('ADC_MISSING', 'この Mac の Google Cloud 認証がありません（gcloud auth application-default login が必要）。'); }
  if (adc.type !== 'authorized_user' || !adc.refresh_token) throw new Fail('ADC_UNSUPPORTED', 'Google Cloud 認証の形式が想定と違います。');
  return adc;
}

function readLocalKey() {
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', os.userInfo().username, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  } catch { throw new Fail('LOCAL_KEY_MISSING', 'この Mac 用のログイン鍵がありません（setup-local-login.sh が必要）。'); }
}

async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const adc = readAdc();
  const localKey = readLocalKey();
  const tok = await post('https://oauth2.googleapis.com/token', new URLSearchParams({
    grant_type: 'refresh_token', client_id: adc.client_id, client_secret: adc.client_secret, refresh_token: adc.refresh_token,
  }), { 'content-type': 'application/x-www-form-urlencoded' });
  if (!tok.ok || !tok.data.access_token) throw new Fail('ADC_EXPIRED', 'Google Cloud 認証の更新が必要です（gcloud auth application-default login）。');

  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: SIGNER, sub: SIGNER, aud: AUDIENCE, iat: now, exp: now + 3600, uid: UID, claims: { local: true, localKey } };
  const signed = await post(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SIGNER}:signJwt`,
    JSON.stringify({ payload: JSON.stringify(payload) }),
    { authorization: 'Bearer ' + tok.data.access_token, 'content-type': 'application/json', 'x-goog-user-project': PROJECT });
  if (!signed.ok || !signed.data.signedJwt) {
    throw new Fail('SIGN_DENIED', `ログイン用トークンに署名できませんでした（HTTP ${signed.status}）。setup-local-login.sh の実行が必要かもしれません。`);
  }
  process.stdout.write(JSON.stringify({ token: signed.data.signedJwt }));
}

main().catch(e => {
  process.stdout.write(JSON.stringify({ error: e.code || 'FAILED', message: e.code ? e.message : 'ログイン用トークンを作れませんでした。' }));
  process.exit(1);
});
