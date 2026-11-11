// SOSList passkey server.
// - Registration: the person proves who they are with their own Google account (must be on the
//   allowlist). The passkey is recorded with its owner and logs into the shared SOSList account.
// - Login: a valid passkey returns a Firebase custom token for the shared account, tagged with the owner.
// Storage and Firebase Admin are injected so this file can be tested without Google.
import { createHash } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Registering requires a fresh Google sign-in; deleting requires a recent SOSList login.
const RECENT_GOOGLE_SEC = 10 * 60;
const RECENT_LOGIN_SEC = 15 * 60;
const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export const emailDigest = (projectId, email) => createHash('sha256').update(projectId + ':' + email.toLowerCase()).digest('hex');

export function createApp({ store, auth, rpID, rpName = 'SOSList', origins, projectId, allowlist, now = () => Date.now() }) {
  if (!store || !auth || !rpID || !Array.isArray(origins) || origins.length === 0 || !projectId
    || !allowlist?.sharedEmail || !Array.isArray(allowlist.people) || allowlist.people.length === 0) throw new Error('config');
  const people = new Map(allowlist.people.map(p => [p.emailDigest, p.id]));
  let sharedUid;
  async function getSharedUid() {
    sharedUid ??= (await auth.getUserByEmail(allowlist.sharedEmail)).uid;
    return sharedUid;
  }

  async function bearer(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) throw new HttpError(401, 'LOGIN_REQUIRED');
    try { return await auth.verifyIdToken(m[1], true); } catch { throw new HttpError(401, 'LOGIN_REQUIRED'); }
  }

  // A person on the allowlist, freshly signed in with their own Google account.
  async function requireStaffGoogle(req) {
    const t = await bearer(req);
    if (t.firebase?.sign_in_provider !== 'google.com' || t.email_verified !== true || typeof t.email !== 'string') throw new HttpError(403, 'GOOGLE_REQUIRED');
    const person = people.get(emailDigest(projectId, t.email));
    if (!person) throw new HttpError(403, 'NOT_ALLOWED');
    if (now() / 1000 - t.auth_time > RECENT_GOOGLE_SEC) throw new HttpError(403, 'RECENT_LOGIN_REQUIRED');
    return { person, email: t.email.toLowerCase(), googleUid: t.uid };
  }

  // Someone logged in to the shared SOSList account (password or passkey).
  async function requireShared(req, { recent = false } = {}) {
    const t = await bearer(req);
    if (t.uid !== await getSharedUid()) throw new HttpError(403, 'NOT_ALLOWED');
    if (recent && (now() / 1000 - t.auth_time) > RECENT_LOGIN_SEC) throw new HttpError(403, 'RECENT_LOGIN_REQUIRED');
    return t;
  }

  async function takeChallenge(id, purpose, uid) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,64}$/.test(id)) throw new HttpError(400, 'BAD_REQUEST');
    const c = await store.consumeChallenge(id);
    if (!c || c.purpose !== purpose || c.expiresAt < now() || (uid && c.uid !== uid)) throw new HttpError(400, 'CHALLENGE_EXPIRED');
    return c;
  }

  const routes = {
    async 'register/options'(req) {
      const g = await requireStaffGoogle(req);
      const existing = (await store.listCredentials(await getSharedUid())).filter(c => c.person === g.person);
      const options = await generateRegistrationOptions({
        rpName, rpID,
        userName: g.email,
        userDisplayName: `SOSList (${g.email})`,
        userID: new TextEncoder().encode(g.person),
        attestationType: 'none',
        excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      const challengeId = await store.createChallenge({ purpose: 'register', uid: g.googleUid, challenge: options.challenge, expiresAt: now() + CHALLENGE_TTL_MS });
      return { challengeId, options };
    },

    async 'register/verify'(req, body) {
      const g = await requireStaffGoogle(req);
      const c = await takeChallenge(body.challengeId, 'register', g.googleUid);
      let v;
      try {
        v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: c.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
      } catch { throw new HttpError(400, 'VERIFY_FAILED'); }
      if (!v.verified || !v.registrationInfo) throw new HttpError(400, 'VERIFY_FAILED');
      const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
      const label = String(body.label || '').trim().slice(0, 40) || '名称なし';
      await store.putCredential({
        id: credential.id, uid: await getSharedUid(), person: g.person, owner: g.email, label,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter, transports: credential.transports || [],
        deviceType: credentialDeviceType, backedUp: credentialBackedUp,
        createdAt: now(), lastUsedAt: null,
      });
      console.log(JSON.stringify({ event: 'passkey_registered', person: g.person }));
      return { registered: true, id: credential.id, label, owner: g.email };
    },

    async 'login/options'() {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
      const challengeId = await store.createChallenge({ purpose: 'login', challenge: options.challenge, expiresAt: now() + CHALLENGE_TTL_MS });
      return { challengeId, options };
    },

    async 'login/verify'(req, body) {
      const c = await takeChallenge(body.challengeId, 'login');
      const id = body.response?.id;
      if (typeof id !== 'string' || id.length > 1024) throw new HttpError(400, 'BAD_REQUEST');
      const cred = await store.getCredential(id);
      if (!cred) throw new HttpError(401, 'UNKNOWN_PASSKEY');
      let v;
      try {
        v = await verifyAuthenticationResponse({
          response: body.response, expectedChallenge: c.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true,
          credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, 'base64url'), counter: cred.counter, transports: cred.transports },
        });
      } catch { throw new HttpError(401, 'VERIFY_FAILED'); }
      if (!v.verified) throw new HttpError(401, 'VERIFY_FAILED');
      // userHandle (if sent) must match the stored owner.
      const handle = body.response?.response?.userHandle;
      if (handle && Buffer.from(handle, 'base64url').toString('utf8') !== cred.person) throw new HttpError(401, 'VERIFY_FAILED');
      // Removed from the allowlist -> passkey stops working immediately.
      if (![...people.values()].includes(cred.person) || cred.uid !== await getSharedUid()) throw new HttpError(401, 'UNKNOWN_PASSKEY');
      await store.updateCredential(cred.id, { counter: v.authenticationInfo.newCounter, lastUsedAt: now() });
      console.log(JSON.stringify({ event: 'passkey_login', person: cred.person }));
      const customToken = await auth.createCustomToken(cred.uid, { passkey: true, staff: cred.person, staffEmail: cred.owner });
      return { customToken };
    },

    async 'list'(req) {
      const user = await requireShared(req);
      const list = await store.listCredentials(user.uid);
      list.sort((a, b) => (a.owner || '').localeCompare(b.owner || '') || a.createdAt - b.createdAt);
      return { passkeys: list.map(c => ({ id: c.id, label: c.label, owner: c.owner, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })) };
    },

    async 'delete'(req, body) {
      const user = await requireShared(req, { recent: true });
      if (typeof body.id !== 'string') throw new HttpError(400, 'BAD_REQUEST');
      const cred = await store.getCredential(body.id);
      if (!cred || cred.uid !== user.uid) throw new HttpError(404, 'NOT_FOUND');
      await store.deleteCredential(body.id);
      return { deleted: true };
    },
  };

  return async function handle(req, res) {
    const origin = req.headers.origin;
    const cors = origins.includes(origin)
      ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST', 'access-control-max-age': '600', vary: 'Origin' }
      : {};
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const route = (req.url || '').split('?')[0].replace(/^\/+/, '');
    if (req.method !== 'POST' || !Object.hasOwn(routes, route)) return send(404, { error: 'NOT_FOUND' });
    if (!cors['access-control-allow-origin']) return send(403, { error: 'ORIGIN_DENIED' });
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) throw new HttpError(413, 'TOO_LARGE'); }
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'BAD_REQUEST'); } }
      if (!body || typeof body !== 'object') throw new HttpError(400, 'BAD_REQUEST');
      send(200, await routes[route](req, body));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.code });
      console.error('passkey-server error', route, e?.code || e?.message);
      send(500, { error: 'SERVER_ERROR' });
    }
  };
}
