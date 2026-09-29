'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildRequest } = require('../evidence-review.js');
const { ReviewStore, atomic } = require('./store.cjs');
const { AppServer, browserConfig } = require('./app-server.cjs');

const resultSchema = {
    type: 'object', additionalProperties: false,
    required: ['outcome', 'found', 'completed', 'skipped', 'incomplete', 'enumerationComplete', 'summary', 'appointments'],
    properties: {
        outcome: { type: 'string', enum: ['completed', 'no_records', 'partial', 'blocked'] },
        ...Object.fromEntries(['found', 'completed', 'skipped', 'incomplete'].map(key => [key, { type: 'integer', minimum: 0 }])),
        enumerationComplete: { type: 'boolean' }, summary: { type: 'string' },
        appointments: { type: 'array', items: {
            type: 'object', additionalProperties: false,
            required: ['docId', 'contractNumber', 'outcome', 'notesVerified', 'claimDetailVerified', 'reason'],
            properties: { docId: { type: 'string' }, contractNumber: { type: 'string' },
                outcome: { type: 'string', enum: ['completed', 'skipped', 'incomplete'] },
                notesVerified: { type: 'boolean' }, claimDetailVerified: { type: 'boolean' }, reason: { type: 'string' } }
        } }
    }
};

function resolveCodex() {
    for (const candidate of ['/Applications/ChatGPT.app/Contents/Resources/codex', '/Applications/Codex.app/Contents/Resources/codex',
        '/opt/homebrew/bin/codex', '/usr/local/bin/codex']) {
        try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch (_) {}
    }
    throw Error('Codex CLIが見つかりません。Codexアプリをインストールしてください。');
}

function acquireLock(lockFile) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(lockFile, 'wx', 0o600);
            fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
            return;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const pid = Number(fs.readFileSync(lockFile, 'utf8'));
            if (!Number.isInteger(pid) || pid <= 0) throw Error('取得ロックを確認できません。アプリを終了して状態を確認してください。');
            try { process.kill(pid, 0); } catch (probe) {
                if (probe.code === 'ESRCH') { fs.unlinkSync(lockFile); continue; }
            }
            throw Error('別の取得処理が実行中です。完了までお待ちください。');
        }
    }
    throw Error('取得ロックを作成できません。');
}
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' }, bool = { type: 'boolean' };
const dynamicTools = [
    ['sos_ready', 'After actual read-only UI preflight in Edge AND SOSList, confirm both are accessible. No patient mutation before this.', object({ edge: bool, soslist: bool })],
    ['sos_set_queue', 'Durably checkpoint the complete verified appointment identities before reviewing. Include retained appointments on resume. docId may be empty pending batch import.', object({ enumerationComplete: bool, appointments: { type: 'array', items: object({ docId: str, claimantName: str, contractNumber: str, appointmentDateTimeMs: { type: 'number' }, services: { type: 'array', items: str }, sha: bool, referralRequired: bool }) } })],
    ['sos_save_progress', 'Checkpoint each source immediately and prepare full drafts BEFORE saving. This private restart state is deleted after verified completion. Do not include credentials.', object({ contractNumber: str, phase: { type: 'string', enum: ['identity','intake','claims','records','draft','save','sha','referral','verify','blocked'] }, source: object({title:str,date:str,author:str,excerpt:str,coverage:str}), notesDraft:str, claimDetailDraft:str, shaDraft:str, referralDraft:str, coverage:str, statusBefore:str, statusAfter:str }, ['contractNumber','phase'])],
    ['sos_verify_saved', 'After fresh server receipt and reopening, supply the COMPLETE expected and actual readback for the exact record. SHA/referral use a canonical full field/value transcription. Never use draft text as a claimed readback.', object({ contractNumber:str,docId:str,field:{type:'string',enum:['notes','claimDetail','sha','referral']},expected:str,readback:str })],
    ['sos_import_bill', 'Run the existing importer for one verified PDF inside SOSPDF. Batch only. Never repeats an uncertain importer automatically; inspect live app first.', object({contractNumber:str,pdfPath:str})]
].map(([name, description, inputSchema]) => ({ type: 'function', name, description, inputSchema }));

function skillBody(skillPath) {
    let body = fs.readFileSync(skillPath, 'utf8');
    // This UI host must never receive an alternate credential-based procedure.
    body = body.replace(/### Direct Database Save Is Allowed[\s\S]*?(?=\n## |$)/g, '### Database access\nUse authenticated SOSList UI only.\n');
    const references = path.join(path.dirname(skillPath), 'references');
    if (fs.existsSync(references)) for (const name of fs.readdirSync(references).filter(n => n.endsWith('.md'))) {
        body += `\n\nREFERENCE ${name}\n${fs.readFileSync(path.join(references, name), 'utf8')}`;
    }
    return body;
}
async function runJob(input, options = {}) {
    const initial = buildRequest(input.mode, input.mode === 'resume' ? input : input.appointment);
    const home = os.homedir();
    const runRoot = options.runRoot || path.join(home, 'Library/Application Support/SOSList Local/EvidenceReview');
    const skillPath = options.skillPath || path.join(home, '.codex/skills/qtc-evidence-review/SKILL.md');
    const sosPdfDir = options.sosPdfDir || path.join(home, 'Library/CloudStorage/Dropbox/VA/SOSPDF');
    const importerPath = options.importerPath || path.join(home, 'soslist/openai-processor/km_folder_trigger.sh');
    const codex = options.codexPath || resolveCodex();
    const instructions = skillBody(skillPath);
    fs.mkdirSync(runRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(runRoot, 0o700);
    const lockFile = path.join(runRoot, 'active.lock'); acquireLock(lockFile);
    let store, server, thread, session, turn, starting, importChild, finalText = '', done = false, stopping = false;
    let terminal, watch, heartbeat, parentWatch, mayRelease = false, accepting = true, lastActivity = Date.now(), phase = 'preflight', preflight = false, cuaReads = 0, windowFailures = 0;
    const toolTimers = new Map(), finished = new Set(), seenCalls = new Set();
    let resolveTurn, rejectTurn;
    let confirmEnded;
    const turnEnded = new Promise(resolve => { confirmEnded = resolve; });
    const completion = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
    completion.catch(() => {});
    const duration = (name, fallback) => options.timeouts?.[name] ?? fallback;
    const emit = (state, message, extra = {}) => {
        const update = { state, message, ...(store ? { resumeId: store.id } : {}), phase, lastProgressAt: new Date(lastActivity).toISOString(), ...extra };
        const diagnostic = path.join(runRoot, 'events.jsonl');
        if (fs.existsSync(diagnostic) && fs.statSync(diagnostic).size > 256000) fs.renameSync(diagnostic, diagnostic + '.previous');
        fs.appendFileSync(diagnostic, JSON.stringify({ at: new Date().toISOString(), state, phase, lastProgressAt: update.lastProgressAt }) + '\n', { mode: 0o600 });
        atomic(path.join(runRoot, 'last-status.json'), update); options.onEvent?.(update);
    };
    const activity = () => { lastActivity = Date.now(); };
    const remember = id => {
        if (!id || finished.has(id)) return;
        if (turn && turn !== id) throw Error('操作ターンが一致しません。');
        turn = id; store.owner({ threadId: thread, sessionId: session, turnId: id, serverPid: server.child.pid }); activity();
    };
    const interrupt = async () => { if (thread && turn) await server.rpc('turn/interrupt', { threadId: thread, turnId: turn }, duration('cleanup', 8000)); };
    const fail = error => { if (!done && !stopping) { accepting = false; rejectTurn(error); } };
    const stop = () => {
        if (stopping || done) return; stopping = true; accepting = false;
        emit('cancelling', '停止しています。途中成果と未確認の保存状態を保持します。');
        rejectTurn(Error('利用者の操作で停止しました。'));
    };
    async function release(owner, event) {
        if (!owner) return;
        if (store.data.browserRecoveryRequired) throw Error('元のブラウザ接続の再取得が未確認です。所有記録を保持します。');
        if (!owner.turnId) throw Error('操作ターンの終了を確認できません。所有記録を保持しています。');
        const r = await server.rpc('mcpServer/tool/call', { threadId: thread, server: 'cua_repl', tool: 'turn_ended',
            arguments: { hook_event_name: event, session_id: owner.sessionId, turn_id: owner.turnId } }, duration('cleanup', 15000));
        if (r.isError) throw Error('Edge操作の終了通知が失敗しました。所有記録を保持しています。');
        store.owner(null);
    }
    async function openThread(previous) {
        const r = await server.rpc(previous ? 'thread/resume' : 'thread/start', { model: 'gpt-6-astra', modelProvider: 'openai', cwd: runRoot,
            approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write',
            ...(previous ? { threadId: previous.threadId } : { ephemeral: false, dynamicTools }),
            developerInstructions: fs.readFileSync(path.join(__dirname, 'workflow.md'), 'utf8') + '\n\nCURRENT SKILL AND REFERENCES (provided in full; no file reads needed):\n' + instructions,
        });
        thread = r.thread?.id; session = r.thread?.sessionId;
        if (!thread || !session) throw Error('Codexのsession IDを確認できないため操作を開始できません。');
        if (previous && (thread !== previous.threadId || session !== previous.sessionId)) throw Error('復旧前後の操作セッションが一致しません。所有権を変更せず停止しました。');
        const next = structuredClone(store.data); next.session = { threadId: thread, sessionId: session }; store.save(next);
        let cursor, browser = false, cleanup = false;
        do {
            const catalog = await server.rpc('mcpServerStatus/list', { threadId: thread, limit: 100, ...(cursor ? { cursor } : {}) });
            for (const s of catalog.data || []) if (s.name === 'cua_repl' && !s.toolsError) {
                for (const t of Object.values(s.tools || {})) { browser ||= t.name === 'js' || t.name?.endsWith('__js'); cleanup ||= t.name === 'turn_ended'; }
            }
            cursor = catalog.nextCursor;
        } while (cursor);
        if (!browser || !cleanup) throw Error('Computer Useの操作と終了処理の接続を確認できません。');
    }
    async function finalizeResult(result) {
        store.finish(result, { retain: true });
        atomic(path.join(runRoot, 'last-result.json'), result);
        if (['completed', 'no_records'].includes(result.outcome)) {
            // Retained final results resume ONLY this cleanup, never patient work.
            const originalThread = store.data.session?.threadId;
            if (!originalThread) throw Error('保存確認済みですが、復旧履歴の終了先を確認できません。');
            if (!store.data.sessionArchived) {
                await server.rpc('thread/archive', { threadId: originalThread });
                const next = structuredClone(store.data); next.sessionArchived = true; store.save(next);
            }
            if (!store.data.sessionDeleted) {
                await server.rpc('thread/delete', { threadId: originalThread });
                const next = structuredClone(store.data); next.sessionDeleted = true; store.save(next);
            }
            emit(result.outcome, result.summary, { result, resumeId: null });
            store.finish(result);
        }
        terminal = { state: result.outcome, message: result.summary, result, ...(['completed', 'no_records'].includes(result.outcome) ? { resumeId: null } : {}) };
        return result;
    }
    async function importBill(args) {
        if (store.data.request.mode !== 'batch') throw Error('Single mode cannot import');
        const a = store.appointment(args.contractNumber);
        if (a.importAttempt) throw Error('Importer was already attempted. Verify live SOSList and existing file; do not blindly repeat.');
        const base = fs.realpathSync(sosPdfDir), pdf = fs.realpathSync(args.pdfPath);
        if (!pdf.startsWith(base + path.sep) || path.extname(pdf).toLowerCase() !== '.pdf') throw Error('PDF is outside SOSPDF');
        const stat = fs.statSync(pdf); if (!stat.isFile() || stat.size < 5) throw Error('Invalid PDF');
        const fd = fs.openSync(pdf, 'r'), header = Buffer.alloc(5); try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
        if (header.toString() !== '%PDF-') throw Error('Invalid PDF');
        a.importAttempt = { startedAt: new Date().toISOString(), status: 'unknown' }; store.save();
        await new Promise((resolve, reject) => {
            importChild = spawn('/bin/zsh', [importerPath, pdf], { detached: true, stdio: 'ignore' });
            const deadline = setTimeout(() => { try { process.kill(-importChild.pid, 'SIGKILL'); } catch (_) {} reject(Error('Importer timed out; inspect live SOSList before proceeding')); }, duration('import', 300000));
            importChild.once('error', () => { clearTimeout(deadline); reject(Error('Importer could not start')); });
            importChild.once('exit', code => { clearTimeout(deadline); importChild = null; if (code === 0) resolve(); else reject(Error('Importer did not confirm completion; inspect live SOSList')); });
        });
        store.appointment(args.contractNumber).importAttempt.status = 'exited'; store.save();
        return { imported: true, verificationRequired: true };
    }
    async function event(message) {
        if (done) return;
        const p = message.params || {};
        if (p.threadId && p.threadId !== thread) return;
        if (message.method === 'turn/started') { remember(p.turn?.id); return; }
        if (message.method === 'turn/completed') {
            if (!p.turn?.id || finished.has(p.turn.id)) return;
            finished.add(p.turn.id);
            confirmEnded();
            accepting = false;
            if (p.turn.status !== 'completed') rejectTurn(Error('Codex処理が中断されました。途中成果を保持しています。'));
            else resolveTurn();
            return;
        }
        if (p.turnId && turn && p.turnId !== turn) return;
        if (message.id !== undefined) {
            if (message.method !== 'item/tool/call') {
                if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) server.write({ id: message.id, result: { decision: 'decline' } });
                else server.write({ id: message.id, error: { code: -32601, message: 'This UI-only host cannot fulfill this request. Stop safely and report the blocker.' } });
                fail(Error('追加の認証・承認または未対応の操作が必要なため停止しました。'));
                return;
            }
            if (!accepting) { server.write({ id: message.id, error: { code: -32000, message: 'Stopping; do not mutate.' } }); return; }
            let output, success = true;
            try {
                if (seenCalls.has(p.callId)) throw Error('Duplicate operation; inspect checkpoint before retry');
                seenCalls.add(p.callId);
                const args = p.arguments;
                if (p.tool === 'sos_ready') {
                    if (!args.edge || !args.soslist || cuaReads < 2) throw Error('Actual read-only Edge and SOSList preflight required');
                    preflight = true; output = { ready: true };
                } else {
                    if (!preflight) throw Error('Preflight is not complete');
                    if (p.tool === 'sos_set_queue') store.queue(args);
                    else if (p.tool === 'sos_save_progress') { store.progress(args); phase = args.phase; }
                    else if (p.tool === 'sos_verify_saved') { store.verify(args); phase = 'verify'; }
                    else if (p.tool === 'sos_import_bill') output = await importBill(args);
                    else throw Error('Unknown operation');
                    output ||= { persisted: true };
                }
                activity(); emit('progress', `取得中：${phase}（途中成果を保存済み）`);
            } catch (e) { success = false; output = { error: e.message }; }
            server.write({ id: message.id, result: { contentItems: [{ type: 'inputText', text: JSON.stringify(output) }], success } });
            return;
        }
        if (!accepting) return;
        if (message.method === 'item/started' && p.item?.type === 'mcpToolCall') {
            activity(); toolTimers.set(p.item.id, setTimeout(() => fail(Error('画面操作の応答がありません。保存状態を保持して停止します。')), duration('tool', 185000)));
        }
        if (message.method === 'item/completed' && p.item?.type === 'mcpToolCall') {
            clearTimeout(toolTimers.get(p.item.id)); toolTimers.delete(p.item.id); activity();
            const detail = JSON.stringify(p.item.error || p.item.result || {});
            if (/already belongs to another|already part of browser session|ownership conflict|owned by another|existing session.*in use/i.test(detail)) { fail(Error('別セッションがEdgeを使用中です。所有権を変更せず停止しました。')); return; }
            if (/noWindowsAvailable|cgWindowNotFound|window.*(not found|unavailable|closed)|target.*closed/i.test(detail)) {
                if (++windowFailures > 2) fail(Error('画面の復旧を2回試みても操作できないため停止しました。'));
                else emit('recovering', `画面への接続を取り直しています（${windowFailures}/2）。`);
            } else if (!p.item.error && p.item.status !== 'failed' && !/"isError"\s*:\s*true/.test(detail)) {
                cuaReads++;
                if (p.item.result?._meta?.['codex/toolSurface']?.kind === 'browserUse') {
                    const next = structuredClone(store.data); next.browserRecoveryRequired = false; store.save(next);
                }
            }
        }
        if (message.method === 'item/completed' && p.item?.type === 'agentMessage' && (p.item.phase === 'final_answer' || p.item.text?.trim().startsWith('{'))) finalText = p.item.text;
        if (message.method === 'error' && !p.willRetry) fail(Error('Codex処理でエラーが発生しました。途中成果を保持しています。'));
    }
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    const parentPid = process.ppid;
    if (require.main === module) parentWatch = setInterval(() => { if (process.ppid !== parentPid) stop(); }, 1000);
    try {
        const unfinished = fs.existsSync(path.join(runRoot, 'checkpoints')) ? fs.readdirSync(path.join(runRoot, 'checkpoints')).filter(n => /^[a-f0-9]{64}\.json$/.test(n)) : [];
        if (initial.mode !== 'resume' && unfinished.length) {
            if (unfinished.length === 1) store = ReviewStore.open(runRoot, unfinished[0].slice(0, -5));
            throw Error('未完了の取得があります。「再開」から続けてください。');
        }
        if (initial.mode === 'resume' && unfinished.some(n => n !== initial.resumeId + '.json')) throw Error('複数の未完了記録があります。所有状態を確認するまで操作を開始できません。');
        store = initial.mode === 'resume' ? ReviewStore.open(runRoot, initial.resumeId) : ReviewStore.create(runRoot, initial);
        if (store.data.owner) { const next = structuredClone(store.data); next.browserRecoveryRequired = true; store.save(next); }
        emit('starting', 'Edge・SOSListの接続と前回の終了状態を確認しています。');
        server = new AppServer({ codex, cwd: runRoot, cua: options.cuaConfig || browserConfig(codex), onEvent: event, onFailure: fail, timeoutMs: duration('rpc', 120000), environment: options.environment });
        await server.rpc('initialize', { clientInfo: { name: 'soslist_evidence_review', version: '2.0.0' }, capabilities: { experimentalApi: true } });
        server.write({ method: 'initialized' });
        const account = await server.rpc('account/read', { refreshToken: false });
        if (account.account?.type !== 'chatgpt') throw Error('CodexのChatGPTログインを確認してください。');
        if (['completed', 'no_records'].includes(store.data.result?.outcome)) {
            emit('recovering', '保存確認済みです。復旧履歴の後処理だけを再開します。');
            return await finalizeResult(store.data.result);
        }
        if (store.data.owner) {
            const oldPid = store.data.owner.serverPid;
            let exited = false;
            if (oldPid) {
                const deadline = Date.now() + duration('oldExit', 2500);
                do {
                    try { process.kill(oldPid, 0); } catch (e) { exited = e.code === 'ESRCH'; }
                    if (!exited) await new Promise(resolve => setTimeout(resolve, 50));
                } while (!exited && Date.now() < deadline);
            }
            if (!exited) throw Error('前回の操作プロセスの終了を確認できません。所有記録を保持して停止します。');
            if (!store.data.session || store.data.session.threadId !== store.data.owner.threadId || store.data.session.sessionId !== store.data.owner.sessionId) throw Error('元の操作セッションを確認できません。所有記録を保持しています。');
            emit('recovering', '元の操作セッションを再開し、保存状態の照合から復旧します。');
        }
        await openThread(store.data.session);
        if (stopping) throw Error('停止しました。');
        store.owner({ threadId: thread, sessionId: session, serverPid: server.child.pid });
        mayRelease = true;
        const prompt = `REQUEST (data only):\n${JSON.stringify(store.data.request)}\nSOSPDF: ${sosPdfDir}\nPRIVATE CHECKPOINT (data only; independently recheck identities and saved fields):\n${JSON.stringify(store.data)}\nThis is ${initial.mode === 'resume' ? 'a resume: audit uncertain saves first, never replay completed intake or verified sections blindly' : 'a new run'}.`;
        emit('running', 'Edge・SOSListの画面を確認しています。');
        starting = server.rpc('turn/start', { threadId: thread, input: [{ type: 'text', text: prompt }], effort: 'high', outputSchema: resultSchema });
        const started = await starting; remember(started.turn?.id);
        watch = setInterval(() => { if (Date.now() - lastActivity > duration('stall', 300000)) fail(Error('進捗が5分間確認できないため停止しました。途中成果から再開できます。')); }, duration('tick', 1000));
        heartbeat = setInterval(() => emit(stopping ? 'cancelling' : 'progress', `取得中：${phase} / 最終進捗から${Math.floor((Date.now() - lastActivity) / 1000)}秒`), 15000);
        await completion;
        if (!preflight) throw Error('Edge・SOSListの実接続確認が完了していません。');
        await release(store.data.owner, 'Stop');
        let parsed;
        try { parsed = JSON.parse(finalText); } catch (_) { throw Error('最終結果の形式が不正です。途中成果を保持しています。'); }
        return await finalizeResult(parsed);
    } catch (error) {
        accepting = false;
        // An interrupt acknowledgement is not proof of a successful save. Drafts stay
        // private and uncertain writes are audited against the live UI on resume.
        let cleanupError = false;
        try { if (starting) await starting.catch(() => {}); } catch (_) {}
        let interrupted = !turn || finished.has(turn);
        if (!interrupted) {
            try {
                await interrupt();
                let deadline;
                try { await Promise.race([turnEnded, new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Turn stop unconfirmed')), duration('cleanup', 8000)); })]); interrupted = true; }
                finally { clearTimeout(deadline); }
            } catch (_) {}
        }
        try {
            if (store?.data.owner && server) {
                if (!interrupted || !mayRelease) throw Error('Interrupt unconfirmed');
                await release(store.data.owner, 'Interrupt');
            }
        } catch (_) { cleanupError = true; }
        terminal = { state: stopping ? 'cancelled' : 'paused', message: `${error.message}${cleanupError ? ' 操作終了の確認が未完了です。次回は後処理から復旧します。' : ''}` };
        if (!stopping) throw error;
        return null;
    } finally {
        done = true; clearInterval(watch); clearInterval(heartbeat); clearInterval(parentWatch);
        for (const timer of toolTimers.values()) clearTimeout(timer);
        if (importChild?.pid) { try { process.kill(-importChild.pid, 'SIGKILL'); } catch (_) {} }
        await server?.close();
        process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
        try { if (terminal) emit(terminal.state, terminal.message, terminal); }
        finally { fs.unlinkSync(lockFile); }
    }
}
if (require.main === module) {
    let reported = false;
    let request;
    const emit = event => { if (['paused','cancelled','error'].includes(event.state)) reported = true; process.stdout.write(JSON.stringify(event) + '\n'); };
    process.stdout.on('error', () => process.emit('SIGTERM'));
    try {
        request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
        runJob(request, { onEvent: emit }).catch(error => { if (!reported) emit({ state: 'error', message: error.message, ...(/^[a-f0-9]{64}$/.test(request.resumeId || '') ? { resumeId: request.resumeId } : {}) }); process.exitCode = 1; });
    } catch (error) { emit({ state: 'error', message: error.message }); process.exitCode = 1; }
}
module.exports = { runJob, dynamicTools };
