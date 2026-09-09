"""Shared local image extraction through ChatGPT-authenticated Codex."""

import base64
import binascii
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

MAX_REQUEST_BYTES = 80 * 1024 * 1024
MAX_IMAGE_COUNT = 12
TIMEOUT_SECONDS = 240
CODEX_BIN = '/Applications/ChatGPT.app/Contents/Resources/codex'
REPORT_SLOTS = threading.BoundedSemaphore(2)
IMAGE_SUFFIXES = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
    'image/webp': '.webp', 'image/gif': '.gif',
}


class ReportError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def decode_images(payload, max_count=MAX_IMAGE_COUNT):
    if not isinstance(payload, dict):
        raise ReportError(400, '画像データの形式が不正です。')
    urls = payload.get('imageDataUrls', [payload.get('imageDataUrl')])
    if not isinstance(urls, list) or not urls:
        raise ReportError(400, '画像データがありません。')
    if len(urls) > max_count:
        raise ReportError(400, f'画像は最大{max_count}枚までです。')
    images = []
    for url in urls:
        if not isinstance(url, str) or not url.startswith('data:'):
            raise ReportError(400, '画像データの形式が不正です。')
        header, separator, encoded = url.partition(';base64,')
        suffix = IMAGE_SUFFIXES.get(header[5:])
        if not separator or not suffix:
            raise ReportError(400, 'PNG・JPEG・WebP・GIF画像を使用してください。')
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise ReportError(400, '画像データの形式が不正です。') from None
        if not decoded:
            raise ReportError(400, '画像データが空です。')
        images.append((suffix, decoded))
    return images


def run_image_report(images, *, prompt, schema, model, executable=CODEX_BIN):
    if not os.path.isfile(executable) or not os.access(executable, os.X_OK):
        raise ReportError(503, 'Codex CLIが見つかりません。ChatGPTアプリを確認してください。')
    if not REPORT_SLOTS.acquire(blocking=False):
        raise ReportError(429, '別の画像を処理中です。少し待ってから再試行してください。')
    try:
        with tempfile.TemporaryDirectory(prefix='soslist-images-') as directory:
            workdir = Path(directory)
            schema_file = workdir / 'schema.json'
            output_file = workdir / 'report.json'
            schema_file.write_text(json.dumps(schema), encoding='utf-8')
            command = [
                executable, 'exec', '--ephemeral', '--ignore-user-config',
                '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', directory,
                '-c', 'approval_policy="never"', '-c', 'forced_login_method="chatgpt"',
                '-c', 'web_search="disabled"', '-c', 'features.shell_tool=false',
                '-c', 'project_doc_max_bytes=0',
                '-c', 'model_reasoning_effort="high"',
                '--model', model,
                '--output-schema', str(schema_file), '--output-last-message', str(output_file),
            ]
            for index, (suffix, content) in enumerate(images, start=1):
                image_file = workdir / f'image-{index:02d}{suffix}'
                image_file.write_bytes(content)
                command.extend(['--image', str(image_file)])
            command.append('-')
            # Preserve CLI login discovery without inheriting the server's API keys.
            environment = {key: value for key, value in os.environ.items() if key in (
                'HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'CODEX_HOME',
            )}
            try:
                result = subprocess.run(
                    command, input=prompt, text=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                    cwd=directory, env=environment, timeout=TIMEOUT_SECONDS, check=False,
                )
            except subprocess.TimeoutExpired:
                raise ReportError(504, 'Codex画像解析が時間内に完了しませんでした。再試行してください。') from None
            if result.returncode:
                detail = result.stderr.lower()
                if any(term in detail for term in ('usage limit', 'rate limit', 'quota')):
                    raise ReportError(429, 'Codexの利用上限に達しました。利用状況を確認してください。')
                raise ReportError(502, 'Codex画像解析に失敗しました。Codexのログイン状態・利用上限・接続を確認してください。')
            try:
                report = json.loads(output_file.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                raise ReportError(502, 'Codexの画像解析結果を解析できませんでした。') from None
            return report
    finally:
        REPORT_SLOTS.release()


def serve_report(handler, generate_report):
    try:
        try:
            content_length = int(handler.headers.get('Content-Length', '0'))
        except ValueError:
            raise ReportError(400, 'リクエストの形式が不正です。') from None
        if not 0 < content_length <= MAX_REQUEST_BYTES:
            raise ReportError(413, '画像データが大きすぎます。')
        try:
            payload = json.loads(handler.rfile.read(content_length))
        except (ValueError, UnicodeDecodeError):
            raise ReportError(400, 'リクエストの形式が不正です。') from None
        report = generate_report(payload)
    except ReportError as error:
        handler._respond_json(error.status, {'error': str(error)})
    except Exception:
        handler._respond_json(500, {'error': 'Codex画像解析処理に失敗しました。'})
    else:
        handler._respond_json(200, report)
