// Production entry: Firebase Admin (Cloud Run service account) + Firestore storage.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { createApp } from './app.mjs';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'sos-list-4d150';
initializeApp({ projectId });
// Dedicated database: the service account is granted access to this database only,
// so the passkey server cannot read patient data in the (default) database.
const db = getFirestore(process.env.FIRESTORE_DB || 'soslist-passkey');
const challenges = db.collection('passkeyChallenges');
const credentials = db.collection('passkeyCredentials');

const store = {
  async createChallenge(data) {
    const id = randomBytes(18).toString('base64url');
    await challenges.doc(id).create({ ...data, expireAt: new Date(data.expiresAt) });
    return id;
  },
  async consumeChallenge(id) {
    return db.runTransaction(async tx => {
      const ref = challenges.doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.delete(ref);
      return snap.data();
    });
  },
  async getCredential(id) {
    const snap = await credentials.doc(id).get();
    return snap.exists ? snap.data() : null;
  },
  async putCredential(c) { await credentials.doc(c.id).create(c); },
  async updateCredential(id, patch) { await credentials.doc(id).update(patch); },
  async listCredentials(uid) {
    const q = await credentials.where('uid', '==', uid).get();
    return q.docs.map(d => d.data());
  },
  async deleteCredential(id) { await credentials.doc(id).delete(); },
};

const handler = createApp({
  store,
  auth: getAuth(),
  projectId,
  allowlist: JSON.parse(readFileSync(new URL('./allowlist.json', import.meta.url), 'utf8')),
  rpID: process.env.RP_ID || 'soslist.niraissc.jp',
  origins: (process.env.ORIGINS || 'https://soslist.niraissc.jp').split(',').map(s => s.trim()).filter(Boolean),
});

http.createServer(handler).listen(Number(process.env.PORT) || 8080);
