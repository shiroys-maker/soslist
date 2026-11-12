"""Shared SOSList CLI discovery policy; never runs the CLI during discovery."""
import os
from pathlib import Path


def resolve_codex_path(override=None, *, home=None, apps='/Applications', system_bins=None, search_path=None):
    home = str(home or Path.home())
    system_bins = ['/opt/homebrew/bin', '/usr/local/bin'] if system_bins is None else system_bins
    current = [str(Path(apps) / app / 'Contents/Resources/codex-cli/bin/codex') for app in ('ChatGPT.app', 'Codex.app')]
    stable = [str(Path(home) / '.local/bin/codex')] + [str(Path(p) / 'codex') for p in system_bins]
    retired = [str(Path(apps) / app / suffix) for app in ('ChatGPT.app', 'Codex.app') for suffix in ('Contents/Resources/codex', 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')]
    def usable(p):
        return os.path.isabs(p) and os.path.isfile(p) and os.access(p, os.X_OK)
    if override:
        if usable(override):
            return override
        if override not in current + stable + retired:
            raise ValueError('指定されたCodex CLIが存在しないか実行できません。CLIパス設定を確認してください。')
    search_path = os.environ.get('PATH', '') if search_path is None else search_path
    candidates = current + stable + [str(Path(p) / 'codex') for p in search_path.split(os.pathsep) if os.path.isabs(p)]
    for p in candidates:
        if p not in retired and usable(p):
            return p
    raise ValueError('Codex CLIが見つかりません。ChatGPT/CodexアプリまたはCLIの配置を確認してください。')
