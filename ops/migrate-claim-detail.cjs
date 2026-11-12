'use strict';
// Preview first. The private plan contains the complete pre-migration snapshot.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

function appointmentMillis(value) {
    if (value?.toDate) return value.toDate().getTime();
    if (typeof (value?._seconds ?? value?.seconds) === 'number') return (value._seconds ?? value.seconds) * 1000;
    return new Date(value).getTime();
}

function splitClaimSuffix(services) {
    if (!Array.isArray(services) || services.some(value => typeof value !== 'string')) throw new Error('Invalid services');
    const text = services.join(', ');
    // Only a trailing note after the VA examination/opinion label qualifies.
    // Test qualifiers such as (LEG) LEFT, TEST(VDRL, RPR), and (AP & LATERAL) remain.
    const marker = /\b(?:DBQs?|Questions|Audiologist Examination)\s*,?\s*([（(])/gi;
    for (const match of text.matchAll(marker)) {
        const start = match.index + match[0].length - 1;
        let depth = 0, end = -1;
        for (let index = start; index < text.length; index++) {
            if ('(（'.includes(text[index])) depth++;
            if (')）'.includes(text[index])) depth--;
            if (depth === 0) { end = index; break; }
        }
        if (end < 0 || text.slice(end + 1).trim()) throw new Error('Ambiguous trailing claim note; review before migration');
        const claimDetail = text.slice(start + 1, end).trim();
        if (!claimDetail) throw new Error('Empty claim note');
        const prefixLength = text.slice(0, start).replace(/[\s,]+$/, '').length;
        const clean = [];
        let offset = 0;
        for (const service of services) {
            if (offset >= prefixLength) break;
            clean.push(service.slice(0, prefixLength - offset));
            offset += service.length + 2;
        }
        return { services: clean, claimDetail };
    }
    return { services, claimDetail: '' };
}

function migrationPatch(data, cutoff = '2026-09-15T00:00:00+09:00') {
    if (!(appointmentMillis(data.appointmentDateTime) >= Date.parse(cutoff))) return null;
    const split = splitClaimSuffix(data.services || []);
    const patch = {};
    if (!isDeepStrictEqual(split.services, data.services || [])) patch.services = split.services;
    if (data.claimDetail != null && typeof data.claimDetail !== 'string') throw new Error('Invalid claimDetail');
    if (split.claimDetail) {
        const existing = data.claimDetail || '';
        patch.claimDetail = !existing ? split.claimDetail : existing === split.claimDetail ? existing : existing + '\n\n' + split.claimDetail;
    } else if (data.claimDetail == null) patch.claimDetail = '';
    return Object.keys(patch).length ? patch : null;
}

const serializable = data => JSON.parse(JSON.stringify(data));
function savePrivate(filename, data) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filename, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
}

async function main() {
    const [mode, planFile, adminModule] = process.argv.slice(2);
    if (!['--preview', '--apply'].includes(mode) || !planFile || !adminModule) {
        throw new Error('Usage: node ops/migrate-claim-detail.cjs --preview|--apply PRIVATE_PLAN_PATH FIREBASE_ADMIN_MODULE_PATH');
    }
    const admin = require(path.resolve(adminModule));
    admin.initializeApp({ projectId: 'sos-list-4d150' });
    const db = admin.firestore(), collection = db.collection('appointments');
    const snapshot = await collection.get();
    const before = snapshot.docs.map(doc => ({ id: doc.id, data: serializable(doc.data()) }));
    if (mode === '--preview') {
        const updates = before.flatMap(({ id, data }) => {
            const patch = migrationPatch(data);
            return patch ? [{ id, patch }] : [];
        });
        const plan = { version: 1, projectId: 'sos-list-4d150', cutoff: '2026-09-15T00:00:00+09:00', before, updates };
        savePrivate(planFile, plan);
        console.log(JSON.stringify({ mode, records: before.length, targets: updates.length, claimsMoved: updates.filter(x => x.patch.services).length, planFile }));
        return;
    }
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    if (plan.version !== 1 || plan.projectId !== 'sos-list-4d150') throw new Error('Invalid plan');
    const originals = new Map(plan.before.map(row => [row.id, row.data]));
    for (const update of plan.updates) {
        if (!isDeepStrictEqual(update.patch, migrationPatch(originals.get(update.id), plan.cutoff))) throw new Error('Plan patch does not match preview');
    }
    // Persist the immediate pre-write snapshot too; no write occurs before backup.
    savePrivate(planFile + '.apply-before.json', before);
    await db.runTransaction(async tx => {
        const current = await tx.getAll(...plan.updates.map(row => collection.doc(row.id)));
        for (const doc of current) {
            if (!doc.exists || !isDeepStrictEqual(serializable(doc.data()), originals.get(doc.id))) throw new Error('Target changed since preview: ' + doc.id);
        }
        for (const row of plan.updates) tx.update(collection.doc(row.id), row.patch);
    });
    const after = await collection.get();
    const expected = new Map(before.map(row => [row.id, row.data]));
    for (const row of plan.updates) expected.set(row.id, { ...expected.get(row.id), ...row.patch });
    if (after.size !== expected.size) throw new Error('Collection size changed during verification');
    for (const doc of after.docs) {
        if (!isDeepStrictEqual(serializable(doc.data()), expected.get(doc.id))) throw new Error('Readback mismatch: ' + doc.id);
    }
    const receipt = { updated: plan.updates.length, claimsMoved: plan.updates.filter(x => x.patch.services).length, fullDatabaseReadbackVerified: true, otherFieldsAndRecordsUnchanged: true };
    savePrivate(planFile + '.receipt.json', receipt);
    console.log(JSON.stringify(receipt));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { appointmentMillis, splitClaimSuffix, migrationPatch };
