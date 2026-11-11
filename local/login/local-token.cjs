#!/usr/bin/env node
// SOSList Local の自動ログイン用トークンを作る（パスワード不要）。
// 1) この Mac の Google Cloud 認証 (ADC) で Firebase カスタムトークンに署名する
//    - 利用者本人の認証 (authorized_user, MacBook): 署名専用サービスアカウント sos-local-signer に署名を依頼
//    - 管理用サービスアカウント鍵 (service_account, Mac mini): その鍵でこの Mac 上で直接署名
// 3) この Mac 固有の秘密鍵（macOS キーチェーン）をクレームに含める。データベースの規則はその鍵の
//    ハッシュを確認してから「ローカルツール用の全権限」を与える。
// 出力: {"token":"..."} / 失敗時 {"error":"CODE","message":"..."}（終了コード1）
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const PROJECT = 'sos-list-4d150';
const SIGNER = `sos-local-signer@${PROJECT}.iam.gserviceaccount.com`;
const UID = 'jpnoE4ygk5ZqR8rsaJnzRSy5poA3'; // sos@niraissc.jp
const KEYCHAIN_SERVICE = 'soslist-local-login';
const AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

class Fail extends Error { constructor(code, message) { super(message); this.code = code; } }

function readAdc() {
  // GOOGLE_APPLICATION_CREDENTIALS は意図的に見ない（daily-brief の .env が管理用キーを指すため）。
  // 常にこの Mac の利用者本人の gcloud 認証を使う。
  const file = process.env.SOSLIST_LOCAL_ADC || path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  let adc;
  try { adc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Fail('ADC_MISSING', 'この Mac の Google Cloud 認証がありません（gcloud auth application-default login が必要）。'); }
  if (adc.type === 'authorized_user' && adc.refresh_token) return adc;
  if (adc.type === 'service_account' && adc.private_key && adc.client_email && adc.project_id === PROJECT) return adc;
  throw new Fail('ADC_UNSUPPORTED', 'Google Cloud 認証の形式が想定と違います。');
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

function b64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }

async function main() {
  const adc = readAdc();
  const localKey = process.env.SOSLIST_LOCAL_TEST_KEY || readLocalKey();
  const now = Math.floor(Date.now() / 1000);
  const claims = { local: true, localKey };

  if (adc.type === 'service_account') {
    const payload = { iss: adc.client_email, sub: adc.client_email, aud: AUDIENCE, iat: now, exp: now + 3600, uid: UID, claims };
    const unsigned = b64url({ alg: 'RS256', typ: 'JWT', kid: adc.private_key_id }) + '.' + b64url(payload);
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(adc.private_key, 'base64url');
    process.stdout.write(JSON.stringify({ token: unsigned + '.' + signature }));
    return;
  }

  const tok = await post('https://oauth2.googleapis.com/token', new URLSearchParams({
    grant_type: 'refresh_token', client_id: adc.client_id, client_secret: adc.client_secret, refresh_token: adc.refresh_token,
  }), { 'content-type': 'application/x-www-form-urlencoded' });
  if (!tok.ok || !tok.data.access_token) throw new Fail('ADC_EXPIRED', 'Google Cloud 認証の更新が必要です（gcloud auth application-default login）。');

  const payload = { iss: SIGNER, sub: SIGNER, aud: AUDIENCE, iat: now, exp: now + 3600, uid: UID, claims };
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
