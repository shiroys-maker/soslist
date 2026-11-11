// End-to-end: real WebAuthn ceremony in Chrome (CDP virtual authenticator) against app.mjs
// with an in-memory store and a fake Firebase Admin. No Google services are contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';
import { createApp, emailDigest } from '../app.mjs';

const lib = readFileSync(new URL('../../shared/vendor/simplewebauthn/browser-13.3.0.umd.min.js', import.meta.url), 'utf8');
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

function memoryStore() {
  const ch = new Map(), cr = new Map();
  return {
    cr,
    async createChallenge(d) { const id = randomBytes(18).toString('base64url'); ch.set(id, d); return id; },
    async consumeChallenge(id) { const d = ch.get(id); ch.delete(id); return d ?? null; },
    async getCredential(id) { return cr.get(id) ?? null; },
    async putCredential(c) { if (cr.has(c.id)) throw new Error('exists'); cr.set(c.id, { ...c }); },
    async updateCredential(id, p) { Object.assign(cr.get(id), p); },
    async listCredentials(uid) { return [...cr.values()].filter(c => c.uid === uid); },
    async deleteCredential(id) { cr.delete(id); },
  };
}

test('passkey register (Google-verified) + login + guards', async () => {
  let clock = Date.now();
  let authTime = Math.floor(clock / 1000);
  const P = 'test-proj';
  const allowlist = { sharedEmail: 'shared@example.com', people: [
    { id: 'owner', emailDigest: emailDigest(P, 'owner@example.com') },
    { id: 'staff-1', emailDigest: emailDigest(P, 'staff1@example.com') },
  ] };
  const g = (uid, email) => ({ uid, email, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
  const tokens = {
    'g-owner': g('gu-owner', 'Owner@Example.com'),
    'g-staff1': g('gu-staff1', 'staff1@example.com'),
    'g-stranger': g('gu-x', 'stranger@example.com'),
    'g-unverified': { ...g('gu-owner', 'owner@example.com'), email_verified: false },
    'shared': { uid: 'shared-uid', email: 'shared@example.com', firebase: { sign_in_provider: 'password' } },
    'other': { uid: 'reader-uid', firebase: { sign_in_provider: 'password' } },
  };
  const auth = {
    async verifyIdToken(t) { const u = tokens[t]; if (!u) throw new Error('bad'); return { ...u, auth_time: authTime }; },
    async createCustomToken(uid, claims) { return `custom:${uid}:${JSON.stringify(claims)}`; },
    async getUserByEmail(e) { assert.equal(e, 'shared@example.com'); return { uid: 'shared-uid' }; },
  };
  const page = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><script>${lib}</script>`);
  });
  const pagePort = await listen(page);
  const origin = `http://localhost:${pagePort}`;
  const store = memoryStore();
  const api = http.createServer(createApp({ store, auth, rpID: 'localhost', origins: [origin], projectId: P, allowlist, now: () => clock }));
  const apiPort = await listen(api);
  const API = `http://127.0.0.1:${apiPort}`;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await p.goto(origin);

    const run = (script, arg) => p.evaluate(new Function('arg', `return (async()=>{const API=${JSON.stringify(API)};
      const call=async(path,body,tok)=>{const h={'content-type':'application/json'};if(tok)h.authorization='Bearer '+tok;
        const r=await fetch(API+'/'+path,{method:'POST',headers:h,body:JSON.stringify(body||{})});return {status:r.status,data:await r.json()};};
      const L=SimpleWebAuthnBrowser;
      const register=async(tok,label)=>{const o=await call('register/options',{},tok);if(o.status!==200)return o;
        const resp=await L.startRegistration({optionsJSON:o.data.options});
        return call('register/verify',{challengeId:o.data.challengeId,response:resp,label},tok);};
      const login=async()=>{const o=await call('login/options');
        const resp=await L.startAuthentication({optionsJSON:o.data.options});
        return call('login/verify',{challengeId:o.data.challengeId,response:resp});};
      ${script}})()`), arg);

    // Registration needs a Google sign-in of an allowlisted, verified person
    let r = await run(`return [await call('register/options',{}), await call('register/options',{},'shared'),
      await call('register/options',{},'g-stranger'), await call('register/options',{},'g-unverified')];`);
    assert.deepEqual(r.map(x => [x.status, x.data.error]), [[401, 'LOGIN_REQUIRED'], [403, 'GOOGLE_REQUIRED'], [403, 'NOT_ALLOWED'], [403, 'GOOGLE_REQUIRED']]);

    // Stale Google sign-in refused
    authTime -= 3600;
    r = await run(`return call('register/options',{},'g-owner');`);
    assert.equal(r.data.error, 'RECENT_LOGIN_REQUIRED');
    authTime += 3600;

    // Owner registers (email case-insensitive); challenge is single-use and bound to that Google user
    r = await run(`const o=await call('register/options',{},'g-owner');
      const resp=await L.startRegistration({optionsJSON:o.data.options});
      const stolen=await call('register/verify',{challengeId:o.data.challengeId,response:resp},'g-staff1');
      const o2=await call('register/options',{},'g-owner');
      const resp2=await L.startRegistration({optionsJSON:o2.data.options}).catch(e=>e.name);
      return {stolen, resp2};`);
    assert.equal(r.stolen.status, 400, 'challenge bound to Google user');
    r = await run(`return register('g-owner','owner phone');`);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.data.owner, 'owner@example.com');
    const cred = [...store.cr.values()][0];
    assert.equal(cred.uid, 'shared-uid');
    assert.equal(cred.person, 'owner');

    // Login -> custom token for the shared account, tagged with the owner
    r = await run(`return login();`);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.data.customToken, 'custom:shared-uid:{"passkey":true,"staff":"owner","staffEmail":"owner@example.com"}');
    assert.ok(cred.lastUsedAt);

    // List / delete only from the shared account
    r = await run(`return [await call('list',{},'shared'), await call('list',{},'other'), await call('list',{},'g-owner')];`);
    assert.equal(r[0].status, 200);
    assert.equal(r[0].data.passkeys[0].owner, 'owner@example.com');
    assert.equal(r[1].status, 403);
    assert.equal(r[2].status, 403);

    // Removed from allowlist -> passkey stops working
    allowlist.people.shift();
    const app2 = http.createServer(createApp({ store, auth, rpID: 'localhost', origins: [origin], projectId: P, allowlist, now: () => clock }));
    const port2 = await listen(app2);
    r = await p.evaluate(async API2 => {
      const o = await (await fetch(API2 + '/login/options', { method: 'POST' })).json();
      const resp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: o.options });
      const v = await fetch(API2 + '/login/verify', { method: 'POST', body: JSON.stringify({ challengeId: o.challengeId, response: resp }) });
      return { status: v.status, data: await v.json() };
    }, `http://127.0.0.1:${port2}`);
    app2.close();
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'UNKNOWN_PASSKEY');

    // Delete (shared session) then login -> UNKNOWN_PASSKEY
    r = await run(`return call('delete',{id:arg},'shared');`, cred.id);
    assert.equal(r.status, 200);
    r = await run(`return login();`);
    assert.equal(r.data.error, 'UNKNOWN_PASSKEY');
  } finally {
    await browser.close(); page.close(); api.close();
  }
});

test('foreign origin refused, unknown route 404', async () => {
  const app = createApp({ store: memoryStore(), auth: { verifyIdToken() {}, createCustomToken() {} }, rpID: 'localhost', origins: ['https://soslist.niraissc.jp'], projectId: 'p', allowlist: { sharedEmail: 's@x', people: [{ id: 'a', emailDigest: 'x' }] } });
  const srv = http.createServer(app); const port = await listen(srv);
  try {
    let r = await fetch(`http://127.0.0.1:${port}/login/options`, { method: 'POST', headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    r = await fetch(`http://127.0.0.1:${port}/login/options`, { method: 'POST', headers: { origin: 'https://soslist.niraissc.jp' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://soslist.niraissc.jp');
    r = await fetch(`http://127.0.0.1:${port}/nope`, { method: 'POST' });
    assert.equal(r.status, 404);
  } finally { srv.close(); }
});
