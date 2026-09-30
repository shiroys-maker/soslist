'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
for (const modulePath of ['../evidence-review/codex-path.cjs', '../../daily-brief/codex-path.cjs']) {
  const { resolveCodexPath } = require(modulePath);
  test(`${modulePath}: wrapper priority, stale layout, explicit override and no execution`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sos-cli-discovery-'));
    const opts = { home: path.join(root, 'home'), apps: path.join(root, 'apps'), systemBins: [], searchPath: '' };
    const wrapper = path.join(opts.apps, 'ChatGPT.app/Contents/Resources/codex-cli/bin/codex');
    const stable = path.join(opts.home, '.local/bin/codex');
    const retired = path.join(opts.apps, 'ChatGPT.app/Contents/Resources/codex');
    const marker = path.join(root, 'executed');
    const executable = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 }); };
    try {
      executable(retired);
      assert.throws(() => resolveCodexPath(undefined, opts), /見つかりません/);
      executable(stable); executable(wrapper);
      assert.equal(resolveCodexPath(undefined, opts), wrapper);
      assert.equal(resolveCodexPath(stable, opts), stable);
      assert.throws(() => resolveCodexPath(path.join(root, 'custom-missing'), opts), /指定された/);
      fs.unlinkSync(wrapper);
      assert.equal(resolveCodexPath(wrapper, opts), stable);
      fs.chmodSync(stable, 0o600);
      assert.throws(() => resolveCodexPath(undefined, opts), /見つかりません/);
      assert.equal(fs.existsSync(marker), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
