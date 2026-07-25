#!/usr/bin/env node

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DAILY_BRIEF_DIR = path.join(PROJECT_ROOT, 'daily-brief');
const BUCKET_NAME = 'sos-list-4d150.firebasestorage.app';
const COLLECTION = 'appointments';

const DEFAULT_LOCAL_ROOTS = [
  '/Users/shungohiroyasu/Library/CloudStorage/Dropbox/VA/SOSPDF',
  '/Users/shungohiroyasu/Library/CloudStorage/GoogleDrive-shiroys@gmail.com/マイドライブ/VA/SOSPDF',
  '/Users/shungohiroyasu/Library/CloudStorage/CloudMounter-ShungoHiroyasu/VA/SOSPDF',
  '/Users/shungohiroyasu/Library/CloudStorage/CloudMounter-HiroyasuShungo/VA/SOSPDF',
];

function usage() {
  console.log(`Usage:
  node repair-missing-pdfs.js [--dry-run] [--upload] [--summary-only] [--contract <number>] [--local-root <dir>]

Default is --dry-run. This checks Firestore appointments.originalFileName values,
reports missing Firebase Storage PDFs, and only uploads when --upload is passed.

Examples:
  node repair-missing-pdfs.js --dry-run
  node repair-missing-pdfs.js --contract 7472566.1.1 --dry-run
  node repair-missing-pdfs.js --upload
`);
}

function parseArgs(argv) {
  const args = {
    upload: false,
    dryRun: false,
    contract: null,
    localRoots: [],
    help: false,
    summaryOnly: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--upload') {
      args.upload = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--contract') {
      args.contract = argv[++i];
    } else if (arg === '--local-root') {
      args.localRoots.push(argv[++i]);
    } else if (arg === '--summary-only') {
      args.summaryOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.upload) args.dryRun = true;
  return args;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return process.env.HOME;
  if (filePath.startsWith('~/')) return path.join(process.env.HOME, filePath.slice(2));
  return filePath;
}

function requireFirebaseAdmin() {
  try {
    return require('firebase-admin');
  } catch (error) {
    const fallback = path.join(DAILY_BRIEF_DIR, 'node_modules', 'firebase-admin');
    return require(fallback);
  }
}

function initializeFirebase() {
  loadDotEnv(path.join(__dirname, '.env'));
  loadDotEnv(path.join(DAILY_BRIEF_DIR, '.env'));

  const admin = requireFirebaseAdmin();
  if (admin.apps.length) {
    return admin;
  }

  const saPath = expandHome(process.env.SERVICE_ACCOUNT_PATH);
  if (saPath && fs.existsSync(path.resolve(saPath))) {
    const serviceAccount = require(path.resolve(saPath));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: BUCKET_NAME,
    });
    return admin;
  }

  const gac = expandHome(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (gac) process.env.GOOGLE_APPLICATION_CREDENTIALS = gac;
  if (gac && !fs.existsSync(path.resolve(gac))) {
    console.warn(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${gac}`);
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  admin.initializeApp({ storageBucket: BUCKET_NAME });
  return admin;
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function findLocalFile(roots, basenames) {
  const queue = roots.filter(Boolean);
  const names = Array.isArray(basenames) ? basenames : [basenames];
  const lowerBasenames = new Set(names.map((name) => name.toLowerCase()));

  while (queue.length > 0) {
    const current = queue.shift();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && lowerBasenames.has(entry.name.toLowerCase())) {
        return fullPath;
      }
    }
  }

  return null;
}

function localBasenameCandidates(basename) {
  const candidates = [basename];
  const withoutTimestamp = basename.replace(/^\d{10,}_/, '');
  if (withoutTimestamp !== basename) candidates.push(withoutTimestamp);
  return candidates;
}

function storagePathFromRecord(data) {
  const original = typeof data.originalFileName === 'string'
    ? data.originalFileName.trim()
    : '';
  if (!original) return '';
  return original.replace(/^\/+/, '');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const localRootsFromEnv = (process.env.SOSPDF_ROOTS || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  const localRoots = [
    ...args.localRoots,
    ...localRootsFromEnv,
    ...DEFAULT_LOCAL_ROOTS,
  ];
  const existingRoots = [];
  for (const root of [...new Set(localRoots)]) {
    if (await pathExists(root)) existingRoots.push(root);
  }

  if (existingRoots.length === 0) {
    throw new Error('No local PDF roots are readable. Pass --local-root /path/to/SOSPDF.');
  }

  const admin = initializeFirebase();
  const db = admin.firestore();
  const bucket = admin.storage().bucket(BUCKET_NAME);

  let query = db.collection(COLLECTION);
  if (args.contract) {
    query = query.where('contractNumber', '==', args.contract);
  }

  console.log(args.upload ? 'Mode: upload missing PDFs' : 'Mode: dry-run');
  console.log(`Collection: ${COLLECTION}`);
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log('Local roots:');
  existingRoots.forEach((root) => console.log(`  - ${root}`));
  console.log('');

  const snapshot = await query.get();
  const results = {
    checked: 0,
    skippedNoPath: 0,
    present: 0,
    missing: 0,
    uploadable: 0,
    uploaded: 0,
    noLocalFile: 0,
    failed: 0,
  };

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const storagePath = storagePathFromRecord(data);
    if (!storagePath) {
      results.skippedNoPath += 1;
      continue;
    }

    results.checked += 1;
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (exists) {
      results.present += 1;
      continue;
    }

    results.missing += 1;
    const basename = path.basename(storagePath);
    const localPath = await findLocalFile(existingRoots, localBasenameCandidates(basename));
    const label = `${data.contractNumber || '(no contract)'} ${data.claimantName || ''}`.trim();

    if (!args.summaryOnly) {
      console.log(`MISSING: ${storagePath}`);
      console.log(`  doc: ${doc.id}`);
      console.log(`  record: ${label}`);
    }

    if (!localPath) {
      results.noLocalFile += 1;
      if (!args.summaryOnly) {
        console.log('  local: not found');
        console.log('');
      }
      continue;
    }

    results.uploadable += 1;
    if (!args.summaryOnly) console.log(`  local: ${localPath}`);

    if (args.upload) {
      try {
        await bucket.upload(localPath, {
          destination: storagePath,
          metadata: {
            contentType: 'application/pdf',
            cacheControl: 'no-store, max-age=0',
            metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() },
          },
        });
        results.uploaded += 1;
        if (!args.summaryOnly) console.log('  action: uploaded');
      } catch (error) {
        results.failed += 1;
        if (!args.summaryOnly) console.log(`  action: failed (${error.message})`);
      }
    } else {
      if (!args.summaryOnly) console.log('  action: dry-run only');
    }

    if (!args.summaryOnly) console.log('');
  }

  console.log('Summary:');
  for (const [key, value] of Object.entries(results)) {
    console.log(`  ${key}: ${value}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
