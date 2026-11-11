// End-to-end: real WebAuthn ceremony in Chrome (CDP virtual authenticator) against app.mjs
// with an in-memory store and a fake Firebase Admin. No Google services are contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';
import { createApp } from '../app.mjs';

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

test('passkey register + login + guards', async () => {
  let clock = Date.now();
  const users = { 'tok-u1': { uid: 'u1', email: 'a@example.com' }, 'tok-u2': { uid: 'u2', email: 'b@example.com' } };
  let authTime = Math.floor(clock / 1000);
  const auth = {
    async verifyIdToken(t) { const u = users[t]; if (!u) throw new Error('bad'); return { ...u, auth_time: authTime }; },
    async createCustomToken(uid, claims) { return `custom:${uid}:${JSON.stringify(claims)}`; },
  };
  const page = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><script>${lib}</script>`);
  });
  const pagePort = await listen(page);
  const origin = `http://localhost:${pagePort}`;
  const store = memoryStore();
  const api = http.createServer(createApp({ store, auth, rpID: 'localhost', origins: [origin], now: () => clock }));
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
      const L=SimpleWebAuthnBrowser;${script}})()`), arg);

    // Not logged in -> cannot register
    let r = await run(`return call('register/options',{});`);
    assert.equal(r.status, 401);

    // Register for u1
    r = await run(`const o=await call('register/options',{},'tok-u1');
      const resp=await L.startRegistration({optionsJSON:o.data.options});
      const v=await call('register/verify',{challengeId:o.data.challengeId,response:resp,label:'test phone'},'tok-u1');
      const replay=await call('register/verify',{challengeId:o.data.challengeId,response:resp,label:'x'},'tok-u1');
      return {v,replay};`);
    assert.equal(r.v.status, 200, JSON.stringify(r.v));
    assert.equal(r.v.data.label, 'test phone');
    assert.equal(r.replay.status, 400, 'challenge single-use');
    assert.equal(store.cr.size, 1);

    // Login with discoverable credential -> custom token for u1
    r = await run(`const o=await call('login/options');
      const resp=await L.startAuthentication({optionsJSON:o.data.options});
      const v=await call('login/verify',{challengeId:o.data.challengeId,response:resp});
      const replay=await call('login/verify',{challengeId:o.data.challengeId,response:resp});
      return {v,replay};`);
    assert.equal(r.v.status, 200, JSON.stringify(r.v));
    assert.equal(r.v.data.customToken, 'custom:u1:{"passkey":true}');
    assert.equal(r.replay.status, 400);
    assert.ok([...store.cr.values()][0].lastUsedAt);

    // List: u1 sees 1, u2 sees 0; u2 cannot delete u1's passkey
    r = await run(`return [await call('list',{},'tok-u1'), await call('list',{},'tok-u2')];`);
    assert.equal(r[0].data.passkeys.length, 1);
    assert.equal(r[1].data.passkeys.length, 0);
    const credId = r[0].data.passkeys[0].id;
    r = await run(`return call('delete',{id:arg},'tok-u2');`, credId);
    assert.equal(r.status, 404);

    // Stale login cannot register/delete
    authTime -= 3600;
    r = await run(`return call('register/options',{},'tok-u1');`);
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'RECENT_LOGIN_REQUIRED');
    authTime += 3600;

    // Expired challenge
    r = await run(`const o=await call('login/options'); return o.data.challengeId;`);
    clock += 6 * 60 * 1000;
    const expired = await run(`return call('login/verify',{challengeId:arg,response:{id:'x'}});`, r);
    assert.equal(expired.status, 400);
    clock -= 6 * 60 * 1000;

    // Delete then login -> UNKNOWN_PASSKEY
    r = await run(`return call('delete',{id:arg},'tok-u1');`, credId);
    assert.equal(r.status, 200);
    r = await run(`const o=await call('login/options');
      const resp=await L.startAuthentication({optionsJSON:o.data.options});
      return call('login/verify',{challengeId:o.data.challengeId,response:resp});`);
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'UNKNOWN_PASSKEY');
  } finally {
    await browser.close(); page.close(); api.close();
  }
});

test('foreign origin refused, unknown route 404', async () => {
  const app = createApp({ store: memoryStore(), auth: { verifyIdToken() {}, createCustomToken() {} }, rpID: 'localhost', origins: ['https://soslist.niraissc.jp'] });
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
