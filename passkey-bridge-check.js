// Public, non-patient acceptance check. No database or storage SDK is loaded.
const ORIGIN = 'https://soslist.niraissc.jp';
const API = 'https://access.soslist.niraissc.jp';
const PROJECT = 'sos-list-4d150';
const MARKER = 'soslist.bridge.check.pending.v1';
const LOCK = 'soslist.bridge.check.operation.v1';
const KEYS = ['generation', 'role', 'sid', 'subjectDigest', 'uid'];
const exact = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join();
function identity(v) {
  return exact(v, KEYS) && typeof v.uid === 'string' && v.uid.length > 0 && v.uid.length <= 128 && /^[a-f0-9]{64}$/.test(v.subjectDigest) && /^session-[a-z0-9-]+$/.test(v.sid) && Number.isSafeInteger(v.generation) && v.generation > 0 && ['admin', 'staff'].includes(v.role);
}
const same = (a, b) => identity(a) && identity(b) && KEYS.every(k => a[k] === b[k]);
const fail = () => { throw Error('CHECK_NOT_CONFIRMED'); };

export function validateUser(user, expected, result) {
  const c = result?.claims;
  if (!identity(expected) || user?.uid !== expected.uid || !c || c.aud !== PROJECT || c.iss !== 'https://securetoken.google.com/' + PROJECT || c.firebase?.sign_in_provider !== 'custom' || c.bridgeSubject !== expected.subjectDigest || c.bridgeSession !== expected.sid || c.bridgeGeneration !== expected.generation || c.bridgeRole !== expected.role) fail();
}

export function createCheck({api, loadSDK, storage, withLock, onChange = () => {}, random = () => crypto.randomUUID()}) {
  let phase = 'idle', epoch = 0, sdk, sdkPromise, signing, ending, owner, attempted = false;
  const checks = {connected: false, ended: false, denied: false, localSignedOut: false};
  const state = () => ({phase, ...checks});
  const emit = p => { phase = p; onChange(state()); };
  const read = () => storage.getItem(MARKER);
  const write = v => { storage.setItem(MARKER, v); if (read() !== v) fail(); };
  const assertCurrent = e => { if (e !== epoch || read() !== owner || phase !== 'connecting') fail(); };
  const getSDK = () => sdkPromise ??= Promise.resolve().then(loadSDK).then(s => { sdk = s; return s; });
  async function localOut() {
    if (sdkPromise) { try { await sdkPromise; } catch { return true; } }
    if (signing) { try { await signing; } catch {} }
    if (sdk) { await sdk.signOut(); if (sdk.currentUser !== null) fail(); }
    return true;
  }
  async function finish() {
    ++epoch; emit('ending');
    let markerOK = true;
    try { if (!read()) write('pending.' + random()); } catch { markerOK = false; }
    // Fence the server before waiting for a delayed SDK sign-in.
    const server = api('end', {keepalive: true});
    const cleanup = localOut();
    const [s, l] = await Promise.allSettled([server, cleanup]);
    checks.localSignedOut = l.status === 'fulfilled' && l.value === true;
    checks.ended = s.status === 'fulfilled' && s.value.status === 200 && exact(s.value.body, ['ended']) && s.value.body.ended === true;
    if (!markerOK || !checks.ended || !checks.localSignedOut) { emit('pending'); return state(); }
    try {
      const denied = await api('inspect');
      checks.denied = denied.status === 401 && denied.body?.error === 'BRIDGE_DENIED';
      if (!checks.denied) fail();
      storage.removeItem(MARKER); if (read() !== null) fail();
      emit('ended');
    } catch { emit('pending'); }
    return state();
  }
  const client = {
    state,
    async initialize() {
      try {
        if (read() !== null) { emit('pending'); return state(); }
        const probe = MARKER + '.probe'; storage.setItem(probe, '1'); if (storage.getItem(probe) !== '1') fail(); storage.removeItem(probe);
        emit('idle');
      } catch { emit('blocked'); }
      return state();
    },
    async connect() {
      if (phase !== 'idle' || attempted) return state();
      attempted = true; const e = ++epoch; emit('connecting');
      try {
        await withLock(async () => {
          if (read() !== null || e !== epoch) fail();
          owner = 'pending.' + random(); write(owner);
          const auth = await getSDK(); assertCurrent(e);
          await auth.signOut(); assertCurrent(e);
          let reply = await api('exchange'); assertCurrent(e);
          if (reply.status !== 200 || !exact(reply.body, ['customToken', 'identity']) || !identity(reply.body.identity) || typeof reply.body.customToken !== 'string' || !reply.body.customToken || reply.body.customToken.length > 16384) fail();
          const expected = {...reply.body.identity};
          // Do not retain the response/token beyond the SDK call; never log it.
          signing = auth.signIn(reply.body.customToken); reply = undefined;
          const signed = await signing.finally(() => { signing = undefined; }); assertCurrent(e);
          validateUser(signed?.user, expected, await signed.user.getIdTokenResult()); assertCurrent(e);
          if (auth.currentUser?.uid !== expected.uid) fail();
          const inspected = await api('inspect'); assertCurrent(e);
          if (inspected.status !== 200 || !exact(inspected.body, ['authenticated', 'identity']) || inspected.body.authenticated !== true || !same(inspected.body.identity, expected)) fail();
          checks.connected = true; emit('active');
        });
      } catch {
        if (e === epoch) await client.end();
        else { try { await localOut(); } catch {} }
      }
      return state();
    },
    end() {
      if (ending) return ending;
      if (phase === 'ended') return Promise.resolve(state());
      const watchdog = setTimeout(() => { if (phase === 'ending') emit('pending'); }, 25000);
      ending = finish().finally(() => { clearTimeout(watchdog); ending = undefined; }); return ending;
    },
    leave() { if (['connecting', 'active', 'ending', 'pending'].includes(phase)) void client.end(); },
    observe() {
      // A different check tab may fence this attempt; never start a new exchange.
      if (['connecting', 'active'].includes(phase)) { try { if (read() !== owner) void client.end(); } catch { void client.end(); } }
    },
  };
  return Object.freeze(client);
}

async function browserAPI(operation, {keepalive = false} = {}) {
  if (location.origin !== ORIGIN || !['exchange', 'inspect', 'end'].includes(operation)) fail();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(API + '/api/bridge/' + operation, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}', credentials: 'include', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal, keepalive});
    if (!r.headers.get('content-type')?.startsWith('application/json')) fail();
    const reader = r.body.getReader(), chunks = []; let size = 0;
    while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 32768) { await reader.cancel(); fail(); } chunks.push(value); }
    const bytes = new Uint8Array(size); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return {status: r.status, body: JSON.parse(new TextDecoder().decode(bytes))};
  } finally { clearTimeout(timer); }
}

async function browserSDK() {
  // Public Firebase web configuration already used by this site, not a credential.
  if (location.origin !== ORIGIN) fail();
  const [{initializeApp}, {initializeAuth, inMemoryPersistence, signInWithCustomToken, signOut}] = await Promise.all([import('https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js'), import('https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js')]);
  const app = initializeApp({apiKey: 'AIzaSyBIkxaIgnjkrOYfx3oyA0BGX5dubL5QhvI', authDomain: 'sos-list-4d150.firebaseapp.com', projectId: PROJECT, appId: '1:455081821929:web:da87d8dd1f16bbe99e9278'}, 'soslist-bridge-check');
  const auth = initializeAuth(app, {persistence: inMemoryPersistence});
  return {get currentUser() { return auth.currentUser; }, signIn: token => signInWithCustomToken(auth, token), signOut: () => signOut(auth)};
}

export function mount(doc = document) {
  const status = doc.getElementById('status'), connect = doc.getElementById('connect'), end = doc.getElementById('end'), result = doc.getElementById('result');
  const messages = {
    idle: '先に認証画面でパスキーログインを済ませ、ここに戻って「接続確認」を押してください。',
    connecting: '接続を確認しています。この画面を開いたままお待ちください。',
    active: '接続できました。続けて「利用終了・拒否確認」を押してください。',
    ending: '利用終了と、終了後の拒否を確認しています。',
    ended: '利用終了を確認しました。下の結果だけをお知らせください。',
    pending: '終了を確定できていません。「利用終了を再確認」を押してください。解決しない場合は再ログインせず、この表示をお知らせください。',
    blocked: 'このブラウザでは安全に試験できません。Safariで開き直してください。',
  };
  const render = s => {
    status.textContent = messages[s.phase]; connect.disabled = s.phase !== 'idle';
    end.disabled = !['active', 'pending', 'connecting'].includes(s.phase); end.textContent = s.phase === 'pending' ? '利用終了を再確認' : '利用終了・拒否確認';
    doc.getElementById('login').hidden = !['idle','ended','blocked'].includes(s.phase);
    result.textContent = '確認版 BC1\n接続：' + (s.connected ? '確認済み' : '未確認') + '\n利用終了：' + (s.ended ? '確認済み' : '未確認') + '\n終了後の拒否：' + (s.denied ? '確認済み' : '未確認') + '\nこの試験の端末内ログアウト：' + (s.localSignedOut ? '確認済み' : '未確認');
  };
  if (location.origin !== ORIGIN || !navigator.locks?.request) { render({phase:'blocked'}); return; }
  let storage; try { storage = localStorage; } catch { render({phase:'blocked'}); return; }
  const client = createCheck({api: browserAPI, loadSDK: browserSDK, storage, withLock: fn => navigator.locks.request(LOCK, {mode:'exclusive'}, fn), onChange: render});
  connect.addEventListener('click', () => { void client.connect(); });
  end.addEventListener('click', () => { void client.end(); });
  window.addEventListener('pagehide', () => client.leave());
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') client.leave(); });
  window.addEventListener('storage', e => { if (e.key === MARKER || e.key === null) client.observe(); });
  window.addEventListener('pageshow', e => { if (e.persisted) { client.leave(); } });
  void client.initialize();
}
if (typeof document !== 'undefined') mount();
