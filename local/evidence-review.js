(function (root) {
    'use strict';
    function resumeInstruction(value) {
        if (value === undefined) return '';
        if (typeof value !== 'string' || value.length > 4000) throw new Error('追加指示は4000文字以内で入力してください。');
        return value.trim();
    }
    function buildRequest(mode, value) {
        if (!['single', 'batch', 'resume'].includes(mode)) throw new Error('取得方法が不正です。');
        if (mode === 'resume') {
            if (!value || typeof value.resumeId !== 'string' || !/^[a-f0-9]{64}$/i.test(value.resumeId)) {
                throw new Error('再開情報が不正です。アプリを再起動して状態を確認してください。');
            }
            const userInstruction = resumeInstruction(value.userInstruction);
            return { mode, resumeId: value.resumeId, ...(userInstruction ? { userInstruction } : {}) };
        }
        if (mode === 'batch') return { mode };
        if (!value || !['docId', 'claimantName', 'contractNumber'].every(key => typeof value[key] === 'string' && value[key].trim()) ||
            !Number.isFinite(value.appointmentDateTimeMs) || value.appointmentDateTimeMs <= 0 ||
            !Array.isArray(value.services) || !value.services.length) {
            throw new Error('氏名・契約番号・予約日時・検査内容を確認できません。再接続後に取得してください。');
        }
        return { mode, appointment: {
            docId: value.docId, claimantName: value.claimantName, contractNumber: value.contractNumber,
            appointmentDateTimeMs: value.appointmentDateTimeMs, services: value.services.map(String)
        } };
    }

    // CLI exit 0 alone cannot establish a completed review.
    function validateResult(request, result) {
        const fail = () => { throw new Error('取得結果の件数・対象予約・保存確認が一致しません。結果を確認してください。'); };
        if (!result || !['completed', 'no_records', 'partial', 'blocked'].includes(result.outcome) ||
            typeof result.summary !== 'string' || !result.summary.trim() || typeof result.enumerationComplete !== 'boolean' ||
            !['found', 'completed', 'skipped', 'incomplete'].every(key => Number.isInteger(result[key]) && result[key] >= 0) ||
            !Array.isArray(result.appointments) || result.appointments.length !== result.found ||
            result.completed + result.skipped + result.incomplete !== result.found) fail();
        const counts = { completed: 0, skipped: 0, incomplete: 0 }, seen = new Set();
        for (const item of result.appointments) {
            if (!item || !Object.hasOwn(counts, item.outcome) || typeof item.contractNumber !== 'string' ||
                !item.contractNumber || typeof item.docId !== 'string' || typeof item.reason !== 'string') fail();
            const identity = item.docId || item.contractNumber;
            if (seen.has(identity)) fail();
            seen.add(identity);
            counts[item.outcome]++;
            if (item.outcome === 'completed' && (!item.docId || item.notesVerified !== true || item.claimDetailVerified !== true)) fail();
            if (item.outcome !== 'completed' && !item.reason.trim()) fail();
            if (request.mode === 'single' && (item.docId !== request.appointment.docId || item.contractNumber !== request.appointment.contractNumber)) fail();
        }
        if (Object.keys(counts).some(key => counts[key] !== result[key])) fail();
        if (request.mode === 'single' && result.found > 1) fail();
        if (result.outcome === 'no_records' && (request.mode === 'single' || result.found !== 0 || !result.enumerationComplete)) fail();
        if (result.outcome === 'completed' && (!result.enumerationComplete || !result.found || result.incomplete || !result.completed)) fail();
        return result;
    }

    function createController({ send, onState }) {
        let state = { busy: false, jobId: null, state: 'idle', message: '', resumeId: null, resumeDocId: null, phase: null, lastProgressAt: null };
        const publish = update => { state = { ...state, ...update }; onState(state); };
        return {
            get state() { return state; },
            start(mode, appointment) {
                if (state.busy) return null;
                if (state.resumeId && mode !== 'resume') {
                    publish({ message: '未完了の取得があります。「再開」から確認してください。' });
                    return null;
                }
                try {
                    const request = { ...buildRequest(mode, appointment), jobId: root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}` };
                    publish({ busy: true, jobId: request.jobId, state: 'starting', message: mode === 'resume' ? '再開しています…' : '取得を開始しています…',
                        resumeId: mode === 'resume' ? request.resumeId : null,
                        resumeDocId: mode === 'resume' ? state.resumeDocId : mode === 'single' ? request.appointment.docId : null, phase: null, lastProgressAt: null });
                    send(request);
                    return request;
                } catch (error) {
                    publish({ busy: false, state: 'error', message: error.message });
                    return null;
                }
            },
            receive(update) {
                if (!update || typeof update.state !== 'string') return;
                // Persisted startup status has no jobId. It must never replace a live job.
                if (!update.jobId && (state.jobId || state.busy)) return;
                if (update.jobId && state.jobId && update.jobId !== state.jobId) return;
                const busy = ['starting', 'running', 'progress', 'recovering', 'cancelling'].includes(update.state);
                const resumable = busy || ['paused', 'blocked', 'partial', 'error', 'cancelled'].includes(update.state);
                const resumeId = resumable && typeof update.resumeId === 'string' && /^[a-f0-9]{64}$/i.test(update.resumeId)
                    ? update.resumeId : (busy ? state.resumeId : null);
                const resumeDocId = resumeId ? (Object.hasOwn(update, 'resumeDocId')
                    ? (typeof update.resumeDocId === 'string' && update.resumeDocId.trim() ? update.resumeDocId : null)
                    : state.resumeDocId) : null;
                publish({ ...update, busy, resumeId, resumeDocId,
                    phase: ['completed', 'no_records'].includes(update.state) ? 'complete'
                        : (typeof update.phase === 'string' ? update.phase : null),
                    lastProgressAt: update.lastProgressAt || null });
            }
        };
    }
    const api = { buildRequest, validateResult, createController, resumeInstruction };
    if (typeof module !== 'undefined') module.exports = api;
    else root.SOSEvidenceReview = api;
})(typeof window === 'undefined' ? globalThis : window);
