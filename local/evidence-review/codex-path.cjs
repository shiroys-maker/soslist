'use strict';
// Shared SOSList CLI discovery policy. No shell, authentication, or CLI execution during discovery.
function resolveCodexPath(override, options = {}) {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const home = options.home || os.homedir();
  const apps = options.apps || '/Applications';
  const systemBins = options.systemBins || ['/opt/homebrew/bin', '/usr/local/bin'];
  const current = ['ChatGPT.app', 'Codex.app'].map(app => path.join(apps, app, 'Contents/Resources/codex-cli/bin/codex'));
  const stable = [path.join(home, '.local/bin/codex'), ...systemBins.map(bin => path.join(bin, 'codex'))];
  const retired = ['ChatGPT.app', 'Codex.app'].flatMap(app => [path.join(apps, app, 'Contents/Resources/codex'), path.join(apps, app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')]);
  const usable = file => {
    try { return path.isAbsolute(file) && fs.statSync(file).isFile() && (fs.accessSync(file, fs.constants.X_OK), true); }
    catch { return false; }
  };
  if (override) {
    if (usable(override)) return override;
    if (![...current, ...stable, ...retired].includes(override)) throw new Error('指定されたCodex CLIが存在しないか実行できません。CLIパス設定を確認してください。');
  }
  const candidates = [...current, ...stable, ...(options.searchPath ?? process.env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute).map(bin => path.join(bin, 'codex'))];
  const found = candidates.find(file => !retired.includes(file) && usable(file));
  if (!found) throw new Error('Codex CLIが見つかりません。ChatGPT/CodexアプリまたはCLIの配置を確認してください。');
  return found;
}
module.exports = { resolveCodexPath };
if (require.main === module) {
  try { process.stdout.write(resolveCodexPath(process.argv[2]) + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
