'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateResult } = require('../evidence-review.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function atomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
        fs.renameSync(temporary, file);
        const directory = fs.openSync(path.dirname(file), 'r');
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } finally { if (fd != null) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function identity(value) {
    if (!value || !['claimantName', 'contractNumber'].every(k => typeof value[k] === 'string' && value[k].trim()) ||
        typeof value.docId !== 'string' || !Number.isFinite(value.appointmentDateTimeMs) || value.appointmentDateTimeMs <= 0 ||
        !Array.isArray(value.services) || !value.services.length || value.services.some(v => typeof v !== 'string' || !v.trim()) ||
        (value.sha !== undefined && typeof value.sha !== 'boolean') ||
        (value.referralRequired !== undefined && typeof value.referralRequired !== 'boolean')) throw Error('Invalid appointment identity');
    return { docId: value.docId, claimantName: value.claimantName, contractNumber: value.contractNumber,
        appointmentDateTimeMs: value.appointmentDateTimeMs, services: value.services, sha: value.sha === true,
        referralRequired: value.referralRequired === true };
}
function same(a, b) { return ['claimantName', 'contractNumber', 'appointmentDateTimeMs'].every(k => a[k] === b[k]) &&
    JSON.stringify(a.services) === JSON.stringify(b.services) && (!a.docId || a.docId === b.docId); }
function validOwner(owner) {
    return owner && typeof owner === 'object' && !Array.isArray(owner) &&
        Object.keys(owner).every(k => ['threadId', 'sessionId', 'turnId', 'serverPid'].includes(k)) &&
        ['threadId', 'sessionId'].every(k => typeof owner[k] === 'string' && owner[k].trim()) &&
        (!Object.hasOwn(owner, 'turnId') || (typeof owner.turnId === 'string' && owner.turnId.trim())) &&
        (!Object.hasOwn(owner, 'serverPid') || (Number.isSafeInteger(owner.serverPid) && owner.serverPid > 0));
}
function validSession(session) {
    return session && typeof session === 'object' && !Array.isArray(session) &&
        Object.keys(session).length === 2 &&
        Object.keys(session).every(k => ['threadId', 'sessionId'].includes(k)) &&
        ['threadId', 'sessionId'].every(k => typeof session[k] === 'string' && session[k].trim());
}
function validRecoveryIdentity(data) {
    if (data.owner !== null && !validOwner(data.owner)) return false;
    if (data.session != null && !validSession(data.session)) return false;
    return !(data.owner && data.session &&
        (data.owner.threadId !== data.session.threadId || data.owner.sessionId !== data.session.sessionId));
}
class ReviewStore {
    constructor(root, id, data) { this.root = root; this.id = id; this.file = path.join(root, 'checkpoints', `${id}.json`); this.data = data; }
    static create(root, request) {
        const id = hash(crypto.randomUUID());
        const s = new ReviewStore(root, id, { version: 1, id, request, createdAt: new Date().toISOString(), appointments: [], enumerationComplete: false, owner: null });
        s.save(); return s;
    }
    static open(root, id) {
        if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid resume identifier');
        const file = path.join(root, 'checkpoints', `${id}.json`);
        let data;
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (_) { throw Error('Invalid checkpoint JSON'); }
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            data.version !== 1 || data.id !== id || !['single', 'batch'].includes(data.request?.mode) ||
            !Array.isArray(data.appointments) || typeof data.enumerationComplete !== 'boolean' ||
            !validRecoveryIdentity(data)) throw Error('Invalid checkpoint');
        if (data.request.mode === 'single') identity(data.request.appointment);
        const contracts = new Set(), documents = new Set();
        for (const a of data.appointments) {
            identity(a);
            if (contracts.has(a.contractNumber) || (a.docId && documents.has(a.docId)) || !Array.isArray(a.sources) ||
                !a.verified || typeof a.verified !== 'object' || Array.isArray(a.verified)) throw Error('Invalid checkpoint');
            contracts.add(a.contractNumber); if (a.docId) documents.add(a.docId);
            for (const source of a.sources) {
                if (!source || typeof source !== 'object' || Array.isArray(source) ||
                    !['title', 'date', 'author', 'excerpt', 'coverage'].every(k => typeof source[k] === 'string') ||
                    !source.title || !source.excerpt || !source.coverage) throw Error('Invalid checkpoint source');
                const { id: sourceID, ...original } = source;
                if (sourceID !== hash(JSON.stringify(original))) throw Error('Invalid checkpoint source');
            }
            for (const [field, draft] of [['notes', 'notesDraft'], ['claimDetail', 'claimDetailDraft'], ['sha', 'shaDraft'], ['referral', 'referralDraft']]) {
                if (a[draft] !== undefined && typeof a[draft] !== 'string') throw Error('Invalid checkpoint draft');
                if (a.verified[field] !== undefined && typeof a.verified[field] !== 'boolean') throw Error('Invalid checkpoint verification');
                const readbackHash = a[`${field}ReadbackHash`];
                if (a.verified[field] === true && (!a[draft] || readbackHash !== hash(a[draft]))) throw Error('Invalid checkpoint verification');
                if (a.verified[field] !== true && readbackHash !== undefined) throw Error('Invalid checkpoint verification');
            }
        }
        if (data.request.mode === 'single' && (data.appointments.length > 1 || data.appointments.some(a =>
            !same(data.request.appointment, a) || (data.request.appointment.sha === true && !a.sha) ||
            (data.request.appointment.referralRequired === true && !a.referralRequired)))) throw Error('Invalid checkpoint selection');
        return new ReviewStore(root, id, data);
    }
    save(next = structuredClone(this.data)) {
        if (!validRecoveryIdentity(next)) throw Error('Invalid recovery identity');
        next.updatedAt = new Date().toISOString();
        if (Buffer.byteLength(JSON.stringify(next)) > 12_000_000) throw Error('Checkpoint size limit reached; pause and inspect');
        atomic(this.file, next);
        this.data = next;
    }
    owner(owner) {
        if (owner !== null && !validOwner(owner)) throw Error('Invalid ownership identity');
        const next = structuredClone(this.data); next.owner = owner; this.save(next);
    }
    setSession(session) {
        if (!validSession(session)) throw Error('Invalid session identity');
        const next = structuredClone(this.data); next.session = session; this.save(next);
    }
    queue({ enumerationComplete, appointments }) {
        if (typeof enumerationComplete !== 'boolean' || !Array.isArray(appointments)) throw Error('Invalid queue');
        const ids = appointments.map(identity);
        if (new Set(ids.map(a => a.contractNumber)).size !== ids.length) throw Error('Duplicate queue identity');
        if (new Set(ids.filter(a => a.docId).map(a => a.docId)).size !== ids.filter(a => a.docId).length) throw Error('Duplicate queue document');
        if (this.data.request.mode === 'single') {
            const selected = identity(this.data.request.appointment);
            if (ids.length !== 1 || !same(selected, ids[0]) || (selected.sha && !ids[0].sha) ||
                (selected.referralRequired && !ids[0].referralRequired)) throw Error('Queue identity differs from selection');
        }
        if (this.data.appointments.some(old => !ids.some(a => same(old, a)))) throw Error('Queue identity cannot be replaced or removed');
        if (this.data.enumerationComplete && (!enumerationComplete || ids.length !== this.data.appointments.length)) throw Error('Completed queue cannot change');
        for (const old of this.data.appointments) {
            const incoming = ids.find(a => a.contractNumber === old.contractNumber);
            if (!incoming || (old.sha && !incoming.sha) || (old.referralRequired && !incoming.referralRequired)) throw Error('Required queue work cannot be downgraded');
        }
        const next = structuredClone(this.data);
        next.appointments = ids.map(a => {
            const old = this.data.appointments.find(x => x.contractNumber === a.contractNumber);
            return { sources: [], verified: {}, phase: 'identity', ...old, ...a };
        });
        next.enumerationComplete = enumerationComplete; this.save(next);
    }
    appointment(contract, data = this.data) { const a = data.appointments.find(a => a.contractNumber === contract); if (!a) throw Error('Unknown appointment identity'); return a; }
    progress(value) {
        const next = structuredClone(this.data), a = this.appointment(value.contractNumber, next);
        if (!['identity', 'intake', 'claims', 'records', 'draft', 'save', 'sha', 'referral', 'verify', 'blocked'].includes(value.phase)) throw Error('Invalid phase');
        a.phase = value.phase;
        if (value.source !== undefined) {
            const source = value.source;
            if (!source || typeof source !== 'object' || Array.isArray(source) || 'id' in source ||
                !['title', 'date', 'author', 'excerpt', 'coverage'].every(k => typeof source[k] === 'string') ||
                !source.title || !source.excerpt || !source.coverage) throw Error('Source text and provenance required');
            const id = hash(JSON.stringify(source));
            if (!a.sources.some(s => s.id === id)) a.sources.push({ ...source, id });
        }
        for (const [draft, field] of [['notesDraft', 'notes'], ['claimDetailDraft', 'claimDetail'], ['shaDraft', 'sha'], ['referralDraft', 'referral']]) {
            if (value[draft] !== undefined) {
                if (typeof value[draft] !== 'string') throw Error('Invalid draft');
                if (a[draft] !== value[draft] && a.verified[field] === true) a.verified[field] = false;
                if (a[draft] !== value[draft]) delete a[`${field}ReadbackHash`];
                a[draft] = value[draft];
            }
        }
        if (value.coverage !== undefined) { if (typeof value.coverage !== 'string') throw Error('Invalid coverage'); a.coverage = value.coverage; }
        if (value.statusBefore === 'Data Entry' && value.statusAfter === 'Provider In Progress' && a.sha) a.shaEditStarted = true;
        this.save(next);
    }
    verify({ contractNumber, docId, field, expected, readback }) {
        const next = structuredClone(this.data), a = this.appointment(contractNumber, next);
        if (!docId || docId !== a.docId) throw Error('Readback identity mismatch');
        const draft = { notes: 'notesDraft', claimDetail: 'claimDetailDraft', sha: 'shaDraft', referral: 'referralDraft' }[field];
        if (!draft || typeof expected !== 'string' || !expected.trim() || a[draft] !== expected || readback !== expected) throw Error('Full readback does not match the prepared draft');
        a.verified[field] = true; a[`${field}ReadbackHash`] = hash(readback); this.save(next);
    }
    finish(result, { retain = false } = {}) {
        if (typeof retain !== 'boolean') throw Error('Invalid retention option');
        validateResult(this.data.request, result);
        if (['completed', 'no_records'].includes(this.data.result?.outcome) &&
            JSON.stringify(this.data.result) !== JSON.stringify(result)) throw Error('Final result differs from retained checkpoint');
        if (result.enumerationComplete !== this.data.enumerationComplete || result.found !== this.data.appointments.length) throw Error('Result differs from checkpoint queue');
        for (const row of result.appointments) {
            const a = this.appointment(row.contractNumber);
            if (row.docId !== a.docId) throw Error('Result identity mismatch');
            if ((row.notesVerified === true && !a.verified.notes) ||
                (row.claimDetailVerified === true && !a.verified.claimDetail)) throw Error('Result claims an unverified saved field');
            if (row.outcome === 'completed' && (!a.verified.notes || !a.verified.claimDetail || (a.sha && !a.verified.sha) || (a.referralRequired && !a.verified.referral))) throw Error('Not all required fields are verified');
        }
        if (this.data.owner) throw Error('Browser cleanup not confirmed');
        if (['completed', 'no_records'].includes(result.outcome) && !retain) fs.unlinkSync(this.file);
        else { const next = structuredClone(this.data); next.result = result; this.save(next); }
        return result;
    }
}
module.exports = { ReviewStore, atomic, hash };
