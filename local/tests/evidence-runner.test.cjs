const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runJob } = require('../evidence-review/runner.cjs');

function fixture(t, script) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sos-evidence-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const codexPath = path.join(root, 'fake-codex');
    fs.writeFileSync(codexPath, `#!${process.execPath}\n${script}`, { mode: 0o700 });
    const skillPath = path.join(root, 'SKILL.md'), importerPath = path.join(root, 'import.sh'), sosPdfDir = path.join(root, 'SOSPDF');
    fs.writeFileSync(skillPath, '# synthetic skill'); fs.writeFileSync(importerPath, '# synthetic importer'); fs.mkdirSync(sosPdfDir);
    return { codexPath, skillPath, importerPath, sosPdfDir, runRoot: path.join(root, 'jobs'), root };
}
const empty = { outcome: 'no_records', found: 0, completed: 0, skipped: 0, incomplete: 0,
    enumerationComplete: true, summary: 'Data Entryは0件です。', appointments: [] };

test('the real runner launches CLI with scoped sandbox and rejects inherited API credentials', async t => {
    const f = fixture(t, `
      const fs = require('node:fs'); const args = process.argv.slice(2);
      fs.writeFileSync(require('path').join(__dirname, 'capture.json'), JSON.stringify({args, apiKey: process.env.OPENAI_API_KEY || null}));
      let prompt = ''; process.stdin.on('data', d => prompt += d); process.stdin.on('end', () => {
        if (!prompt.includes('QTC Evidence Review') || !prompt.includes('"mode": "batch"')) process.exit(9);
        fs.writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify(${JSON.stringify(empty)}));
        console.log(JSON.stringify({type:'turn.completed'}));
      });
    `);
    const events = [];
    const final = await runJob({ mode: 'batch' }, { ...f, environment: { ...process.env, OPENAI_API_KEY: 'synthetic-secret' }, onEvent: e => events.push(e) });
    const capture = JSON.parse(fs.readFileSync(path.join(f.root, 'capture.json')));
    assert.equal(capture.apiKey, null);
    assert.ok(capture.args.includes('--approve-for-me'));
    assert.ok(capture.args.includes('--ephemeral'));
    assert.ok(!capture.args.some(a => a.includes('dangerously-bypass')));
    assert.equal(capture.args[capture.args.indexOf('--add-dir') + 1], f.sosPdfDir);
    assert.equal(final.outcome, 'no_records');
    assert.equal(events.at(-1).state, 'completed');
    assert.match(events.at(-1).message, /0件/);
    assert.deepEqual(fs.readdirSync(f.sosPdfDir), []);
    assert.ok(!fs.existsSync(path.join(f.runRoot, 'active.lock')));
});

test('nonzero CLI exit and absent or invalid final output never become success', async t => {
    for (const script of ['process.exit(7)', 'process.stdin.resume()', `const fs=require('fs'),a=process.argv;fs.writeFileSync(a[a.indexOf('--output-last-message')+1],'{}');`]) {
        const f = fixture(t, script), events = [];
        await assert.rejects(runJob({ mode: 'batch' }, { ...f, onEvent: e => events.push(e) }));
        assert.ok(!events.some(e => e.state === 'completed'));
        assert.ok(!fs.existsSync(path.join(f.runRoot, 'active.lock')));
    }
});

test('a second app instance cannot start a concurrent portal job', async t => {
    const f = fixture(t, 'process.exit(99)');
    fs.mkdirSync(f.runRoot); fs.writeFileSync(path.join(f.runRoot, 'active.lock'), String(process.pid));
    await assert.rejects(runJob({ mode: 'batch' }, f), /実行中/);
    assert.equal(fs.readFileSync(path.join(f.runRoot, 'active.lock'), 'utf8'), String(process.pid));
});

test('cancellation kills a surviving helper before releasing the portal lock', async t => {
    const f = fixture(t, `
      const fs=require('fs'), p=require('path'), {spawn}=require('child_process');
      const helper=spawn(process.execPath,['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
      setTimeout(()=>fs.writeFileSync(p.join(__dirname,'helper.pid'),String(helper.pid)),150);
      process.on('SIGTERM',()=>process.exit(0)); process.stdin.resume(); setInterval(()=>{},1000);
    `);
    const events = [], job = runJob({ mode: 'batch' }, { ...f, onEvent: e => events.push(e) });
    const pidFile = path.join(f.root, 'helper.pid');
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise(r => setTimeout(r, 20));
    const helperPid = Number(fs.readFileSync(pidFile, 'utf8'));
    t.after(() => { try { process.kill(helperPid, 'SIGKILL'); } catch (_) {} });
    process.emit('SIGTERM');
    process.emit('SIGTERM'); // Stop followed by quitting must not bypass cleanup.
    assert.equal(await job, null);
    await new Promise(r => setTimeout(r, 100));
    assert.throws(() => process.kill(helperPid, 0), { code: 'ESRCH' });
    assert.equal(events.at(-1).state, 'cancelled');
    assert.ok(!fs.existsSync(path.join(f.runRoot, 'active.lock')));
});
