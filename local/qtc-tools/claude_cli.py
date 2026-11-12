"""Bounded Claude Code CLI JSON generation with the user's Claude subscription. No tools, MCP, hooks or memory."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile

EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')
MEDIA_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'}


class ClaudeError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def resolve_claude_path(override=None, *, home=None, search_path=None):
    home = str(home or Path.home())
    override = override or os.environ.get('SOSLIST_CLAUDE_BIN')
    search_path = os.environ.get('PATH', '') if search_path is None else search_path
    candidates = [override] if override else (
        [str(Path(home) / '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
        + [str(Path(p) / 'claude') for p in search_path.split(os.pathsep) if p])
    for candidate in candidates:
        if os.path.isabs(candidate) and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise ValueError('Claude Code CLIが見つかりません。Claude Codeの配置・CLIパス設定を確認してください。')


def run_claude_json(prompt, *, schema, model, effort, images=(), system_prompt, timeout, executable=None):
    """Return the schema-validated structured output. images: [(suffix, bytes)]."""
    if not isinstance(model, str) or not model or effort not in EFFORTS:
        raise ClaudeError(400, 'Claude Codeのモデル・effort設定を確認してください。')
    try:
        executable = resolve_claude_path(executable)
    except ValueError as error:
        raise ClaudeError(503, str(error)) from None
    content = [{'type': 'image', 'source': {'type': 'base64', 'media_type': MEDIA_TYPES[suffix],
                                             'data': base64.b64encode(data).decode('ascii')}}
               for suffix, data in images]
    content.append({'type': 'text', 'text': prompt})
    message = json.dumps({'type': 'user', 'message': {'role': 'user', 'content': content}}) + '\n'
    command = [
        executable, '--safe-mode', '--setting-sources', '',
        '--settings', json.dumps({'forceLoginMethod': 'claudeai', 'disableAllHooks': True}),
        '-p', '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config',
        '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-session-persistence',
        '--permission-mode', 'dontAsk', '--model', model, '--effort', effort,
        '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--json-schema', json.dumps(schema), '--system-prompt', system_prompt,
    ]
    # Subscription login only: API keys from the server environment are not inherited.
    environment = {key: value for key, value in os.environ.items() if key in (
        'HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL')}
    with tempfile.TemporaryDirectory(prefix='soslist-claude-') as directory:
        try:
            result = subprocess.run(command, input=message, text=True, capture_output=True,
                                    cwd=directory, env=environment, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            raise ClaudeError(504, 'Claude Codeの処理が時間内に完了しませんでした。再試行してください。') from None
        except OSError:
            raise ClaudeError(503, 'Claude Codeを起動できません。') from None
    final = None
    for line in result.stdout.splitlines():
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict) and item.get('type') == 'result':
            final = item
    if result.returncode or not final or final.get('is_error') or final.get('subtype') != 'success':
        detail = (result.stderr + json.dumps(final or {})).lower()
        if any(term in detail for term in ('usage limit', 'rate limit', 'quota')):
            raise ClaudeError(429, 'Claude Codeの利用上限に達しました。利用状況を確認してください。')
        raise ClaudeError(502, 'Claude Codeの処理に失敗しました。Claudeサブスクリプションのログイン・モデル・利用上限を確認してください。')
    output = final.get('structured_output')
    if not isinstance(output, dict):
        raise ClaudeError(502, 'Claude Codeの結果を解析できませんでした。')
    return output
