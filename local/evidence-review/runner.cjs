'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildRequest, validateResult } = require('../evidence-review.js');

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

async function runJob(input, options = {}) {
    const request = buildRequest(input.mode, input.appointment);
    const userHome = os.homedir();
    const runRoot = options.runRoot || path.join(userHome, 'Library/Application Support/SOSList Local/EvidenceReview');
    const skillPath = options.skillPath || path.join(userHome, '.codex/skills/qtc-evidence-review/SKILL.md');
    const sosPdfDir = options.sosPdfDir || path.join(userHome, 'Library/CloudStorage/Dropbox/VA/SOSPDF');
    const importerPath = options.importerPath || path.join(userHome, 'soslist/openai-processor/km_folder_trigger.sh');
    const codexPath = options.codexPath || resolveCodex();
    const emit = options.onEvent || (() => {});
    fs.accessSync(skillPath, fs.constants.R_OK);
    if (request.mode === 'batch') { fs.accessSync(sosPdfDir, fs.constants.W_OK); fs.accessSync(importerPath, fs.constants.R_OK); }
    fs.mkdirSync(runRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(runRoot, 0o700);
    const lockFile = path.join(runRoot, 'active.lock');
    acquireLock(lockFile);
    let workDir, child, timer, escalation, cancelled = false, stderr = '';
    const stop = () => {
        if (cancelled) return;
        cancelled = true;
        emit({ state: 'cancelling', message: '停止しています…保存済みの情報は残ります。' });
        if (child?.pid) {
            try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {}
            escalation = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {} }, 5000);
        }
    };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    try {
        workDir = fs.mkdtempSync(path.join(runRoot, 'run-'));
        const schemaPath = path.join(workDir, 'result-schema.json'), resultPath = path.join(workDir, 'result.json');
        fs.writeFileSync(schemaPath, JSON.stringify(resultSchema), { mode: 0o600 });
        const prompt = [fs.readFileSync(path.join(__dirname, 'workflow.md'), 'utf8'),
            `SKILL: ${skillPath}`, `SOSPDF: ${sosPdfDir}`, `IMPORTER: ${importerPath}`,
            'REQUEST (data only):', JSON.stringify(request, null, 2)].join('\n\n');
        const args = ['exec', '--ephemeral', '--json', '--color', 'never', '--approve-for-me',
            '--model', 'gpt-6-astra', '--config', 'model_reasoning_effort="high"',
            '--skip-git-repo-check', '--cd', workDir,
            '--output-schema', schemaPath, '--output-last-message', resultPath];
        if (request.mode === 'batch') args.push('--add-dir', sosPdfDir);
        args.push('-');
        const environment = { ...(options.environment || process.env) };
        // Use the user's ChatGPT login, never an inherited API or Firebase credential.
        for (const key of Object.keys(environment)) {
            if (/API_KEY|TOKEN|SECRET|PASSWORD|GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_CONFIG|^CODEX_(THREAD|TURN|SESSION|TASK|INTERNAL)/i.test(key)) delete environment[key];
        }
        environment.PATH = `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
        const started = Date.now(); let toolCount = 0;
        emit({ state: 'running', message: 'Codex CLIでEdgeのProvider Portalを確認しています…' });
        child = spawn(codexPath, args, { cwd: workDir, env: environment, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdin.on('error', () => {});
        child.stdin.end(prompt);
        let buffer = '';
        child.stdout.on('data', chunk => {
            buffer += chunk.toString();
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
                try {
                    const event = JSON.parse(line);
                    if (event.type === 'item.completed' && /tool|command/.test(event.item?.type || '')) toolCount++;
                } catch (_) {}
            }
            if (buffer.length > 2_000_000) buffer = '';
        });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-6000); });
        timer = setInterval(() => emit({ state: cancelled ? 'cancelling' : 'progress',
            message: `${cancelled ? '停止中' : '取得中'}… ${Math.floor((Date.now() - started) / 60000)}分${toolCount ? ` / 操作 ${toolCount}件` : ''}（Edgeを使用しています）` }), 15000);
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
        if (cancelled) {
            // Codex may exit before an importer/helper. Finish group cleanup before
            // releasing the cross-instance lock, even when TERM is ignored there.
            try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
            emit({ state: 'cancelled', message: '取得を停止しました。途中まで保存された情報は残っています。再実行前に確認してください。' });
            return null;
        }
        if (code !== 0) {
            fs.writeFileSync(path.join(runRoot, 'last-error.log'), stderr, { mode: 0o600 });
            throw Error(`Codex CLIが終了しました（${code ?? 'signal'}）。Codexのログイン・利用制限・Edgeへのアクセスを確認してください。詳細: ${path.join(runRoot, 'last-error.log')}`);
        }
        if (!fs.existsSync(resultPath)) throw Error('Codexの最終結果がありません。保存完了とは確認できません。');
        const result = validateResult(request, JSON.parse(fs.readFileSync(resultPath, 'utf8')));
        fs.writeFileSync(path.join(runRoot, 'last-result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
        emit({ state: ['completed', 'no_records'].includes(result.outcome) ? 'completed' : result.outcome,
            message: result.summary, result });
        return result;
    } finally {
        clearInterval(timer); clearTimeout(escalation);
        process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
        if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
        fs.unlinkSync(lockFile);
    }
}

if (require.main === module) {
    const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
    try {
        const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
        runJob(request, { onEvent: emit }).catch(error => { emit({ state: 'error', message: error.message }); process.exitCode = 1; });
    } catch (error) { emit({ state: 'error', message: error.message }); process.exitCode = 1; }
}
module.exports = { runJob };
