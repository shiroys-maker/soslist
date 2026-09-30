'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const toml = v => Array.isArray(v) ? `[${v.map(toml).join(',')}]` : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`).join(',')}}` : JSON.stringify(v);
function browserConfig(codex) {
    const base = path.join(os.homedir(), '.codex/plugins/cache/openai-bundled/unified-computer-use');
    const versions = fs.readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
        try {
            const c = JSON.parse(fs.readFileSync(path.join(base, version, '.mcp.json'), 'utf8')).mcpServers.cua_repl;
            fs.accessSync(c.command, fs.constants.X_OK);
            for (const arg of c.args) if (arg.startsWith('/')) fs.accessSync(arg, fs.constants.R_OK);
            return { command: c.command, args: c.args, env: { ...c.env, CODEX_CLI_PATH: codex } };
        } catch (_) {}
    }
    throw Error('Computer Use連携が見つかりません。Codexアプリの接続を確認してください。');
}
class AppServer {
    constructor({ codex, cwd, cua, onEvent, onFailure, timeoutMs = 120000, environment = process.env }) {
        this.pending = new Map(); this.sequence = 0; this.closed = false; this.timeoutMs = timeoutMs;
        this.onEvent = onEvent; this.onFailure = onFailure;
        // Disabled entries still need a transport to pass Codex config validation.
        // Do not depend on another Mac having saved MCP server definitions.
        const config = { forced_login_method: 'chatgpt', model_provider: 'openai', project_doc_max_bytes: 0, web_search: 'disabled',
            mcp_servers: { node_repl: { command: '/usr/bin/false', enabled: false }, 'computer-use': { command: '/usr/bin/false', enabled: false }, cua_repl: { ...cua, enabled: true, required: true, enabled_tools: ['js', 'js_reset', 'turn_ended'], startup_timeout_sec: 120, tool_timeout_sec: 180 } },
            'features.plugins': false, 'features.apps': false, 'features.hooks': false, 'features.memories': false, 'features.chronicle': false,
            'features.shell_tool': false, 'features.unified_exec': false, 'features.multi_agent': false, 'features.multi_agent_v2': false,
            'features.skip_host_skill_discovery': true, 'features.browser_use': false, 'features.browser_use_external': false,
            'features.computer_use': false, 'features.in_app_browser': false, 'features.image_generation': false, 'features.goals': false,
            'features.skill_search': false };
        const args = ['app-server', '--stdio', ...Object.entries(config).flatMap(([k, v]) => ['-c', `${k}=${toml(v)}`])];
        this.child = spawn(codex, args, { cwd, detached: true, env: {
            HOME: os.homedir(), PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
            TMPDIR: environment.TMPDIR || os.tmpdir(), LANG: 'en_US.UTF-8'
        }, stdio: ['pipe', 'pipe', 'pipe'] });
        // Raw stderr may contain tool output or patient data. Never retain it.
        this.child.stderr.on('data', () => {});
        this.child.on('error', () => this.fail(Error('Codex実行プロセスを起動できません。')));
        this.child.stdin.on('error', () => this.fail(Error('Codex操作接続が切断されました。')));
        this.child.on('exit', (code, signal) => { if (!this.closed) this.fail(Error(`Codex操作接続が終了しました（${code ?? signal}）。途中成果を保持しています。`)); });
        createInterface({ input: this.child.stdout }).on('line', line => {
            if (line.length > 8_000_000) { this.fail(Error('Codex応答が受信上限を超えました。途中成果を保持しています。')); return; }
            try { this.receive(JSON.parse(line)); }
            catch (_) { this.fail(Error('Codex応答を解釈できません。途中成果を保持しています。')); }
        });
    }
    write(message) { if (this.closed || this.child.stdin.destroyed) throw Error('Codex接続は終了しています。'); this.child.stdin.write(`${JSON.stringify(message)}\n`); }
    rpc(method, params = {}, timeoutMs = this.timeoutMs) {
        return new Promise((resolve, reject) => {
            const id = ++this.sequence;
            const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`${method}の応答がありません。`)); }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try { this.write({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
        });
    }
    receive(message) {
        if (message.id !== undefined && !message.method) {
            const item = this.pending.get(message.id); if (!item) return;
            this.pending.delete(message.id); clearTimeout(item.timer);
            if (message.error) item.reject(Error(`Codex request rejected (${message.error.code ?? 'unknown'})`)); else item.resolve(message.result || {});
            return;
        }
        Promise.resolve(this.onEvent?.(message)).catch(error => this.fail(error));
    }
    fail(error) {
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
        this.pending.clear(); this.onFailure?.(error);
    }
    close() {
        if (this.closePromise) return this.closePromise;
        this.closed = true;
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Codex接続を終了しました。')); }
        this.pending.clear();
        const pid = this.child.pid;
        try { process.kill(-pid, 'SIGTERM'); } catch (_) {}
        this.closePromise = new Promise(resolve => {
            if (!pid) { resolve(); return; }
            const started = Date.now();
            const poll = setInterval(() => {
                let alive = true; try { process.kill(-pid, 0); } catch (e) { alive = e.code !== 'ESRCH'; }
                if (alive && Date.now() - started < 1500) return;
                if (alive) { try { process.kill(-pid, 'SIGKILL'); } catch (_) {} }
                clearInterval(poll); resolve();
            }, 50);
        });
        return this.closePromise;
    }
}
module.exports = { AppServer, browserConfig };
