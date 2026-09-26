(function (root) {
    'use strict';
    function buildRequest(mode, value) {
        if (!['single', 'batch'].includes(mode)) throw new Error('取得方法が不正です。');
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
        if (result.outcome === 'no_records' && (request.mode !== 'batch' || result.found !== 0 || !result.enumerationComplete)) fail();
        if (result.outcome === 'completed' && (!result.enumerationComplete || !result.found || result.incomplete || !result.completed)) fail();
        return result;
    }

    function createController({ send, onState }) {
        let state = { busy: false, jobId: null, state: 'idle', message: '' };
        const publish = update => { state = { ...state, ...update }; onState(state); };
        return {
            get state() { return state; },
            start(mode, appointment) {
                if (state.busy) return null;
                try {
                    const request = { ...buildRequest(mode, appointment), jobId: root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}` };
                    publish({ busy: true, jobId: request.jobId, state: 'starting', message: '取得を開始しています…' });
                    send(request);
                    return request;
                } catch (error) {
                    publish({ busy: false, state: 'error', message: error.message });
                    return null;
                }
            },
            receive(update) {
                if (!update || !update.jobId || (state.jobId && update.jobId !== state.jobId)) return;
                publish({ ...update, busy: ['starting', 'running', 'progress', 'cancelling'].includes(update.state) });
            }
        };
    }
    const api = { buildRequest, validateResult, createController };
    if (typeof module !== 'undefined') module.exports = api;
    else root.SOSEvidenceReview = api;
})(typeof window === 'undefined' ? globalThis : window);
