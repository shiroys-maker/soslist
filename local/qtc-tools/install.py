"""Install the managed XR and AUD components into the existing local QTC runtime."""

from pathlib import Path
import shutil

SOURCE = Path(__file__).resolve().parent
BIN = Path.home() / 'bin'
QTC = Path.home() / 'Documents/QTC_server'


def update_server(text):
    import_line = 'from xray_codex import handle_xray_report\n'
    if import_line not in text:
        text = text.replace('import http.server\n', 'import http.server\n' + import_line, 1)
    start = text.index('    def _handle_xray_report(self):\n')
    end = text.index('    def _handle_request(self, send_body=True):\n', start)
    text = text[:start] + (
        '    def _handle_xray_report(self):\n'
        '        handle_xray_report(self)\n\n'
    ) + text[end:]
    text = text.replace('class ReusableHTTPServer(http.server.HTTPServer):',
                        'class ReusableHTTPServer(http.server.ThreadingHTTPServer):')
    return text


def update_page(text):
    script = '    <script src="/xray-upload.js?v=codex-1"></script>\n'
    if script not in text:
        text = text.replace('    <script>\n', script + '    <script>\n', 1)
    old_state = '        const uploadedXrayFiles = [];\n'
    new_state = (
        '        const xrayUploader = createXrayUploader({\n'
        '            parseImages, toDataUrl, document, alert, loader\n'
        '        });\n'
    )
    if old_state in text:
        text = text.replace(old_state, new_state, 1)
    elif new_state not in text:
        raise ValueError('Unrecognized ImageReport upload state; no changes written.')
    start = text.index('        async function handleImages(files) {\n')
    end = text.index('        function handlePasteImage(event) {\n', start)
    text = text[:start] + (
        '        async function handleImages(files) {\n'
        '            return xrayUploader(files);\n'
        '        }\n\n'
    ) + text[end:]
    # Auto-loaded images may finish their request while a newer drop is queued.
    text = text.replace("                loader.style.display = 'none';",
                        "                if (loader.dataset.xrayBusy !== 'true') loader.style.display = 'none';")
    return text


def update_audiogram_server(text):
    import_line = 'from audiogram_codex import handle_audiogram_report\n'
    if import_line not in text:
        text = text.replace('import http.server\n', 'import http.server\n' + import_line, 1)
    route = (
        "        if parsed.path == '/api/audiogram-report':\n"
        '            handle_audiogram_report(self)\n'
        '            return\n'
    )
    if route not in text:
        anchor = "        if parsed.path == '/api/xray-report':\n"
        if text.count(anchor) != 1:
            raise ValueError('Unrecognized QTC route; no changes written.')
        text = text.replace(anchor, route + anchor, 1)
    return text


def update_audiogram_page(text):
    # The runtime page contains credentials; never copy it into the repository.
    text = ''.join(line for line in text.splitlines(keepends=True)
                   if not line.strip().startswith('const API_KEY ='))
    start = text.index('    async function parseImage(file) {\n')
    end = text.index('    function fillFromFirebase(record) {\n', start)
    return text[:start] + (
        '    async function parseImage(file) {\n'
        '        const base64 = await toBase64(file);\n'
        "        const res = await fetch('/api/audiogram-report', {\n"
        "            method: 'POST',\n"
        "            headers: { 'Content-Type': 'application/json' },\n"
        '            body: JSON.stringify({ imageDataUrl: `data:${file.type};base64,${base64}` })\n'
        '        });\n'
        '        const json = await res.json();\n'
        "        if (!res.ok || json.error) throw new Error(json.error || '聴力解析結果を取得できませんでした。');\n"
        '        return json;\n'
        '    }\n\n'
    ) + text[end:]


def main():
    server = BIN / 'sospdf_server.py'
    page = QTC / 'ImageReport.html'
    audiogram = QTC / 'audiogram.html'
    server_text = update_audiogram_server(update_server(server.read_text(encoding='utf-8')))
    page_text = update_page(page.read_text(encoding='utf-8'))
    audiogram_text = update_audiogram_page(audiogram.read_text(encoding='utf-8'))
    compile(server_text, str(server), 'exec')
    for target in (server, page, audiogram):
        backup = target.with_name(target.name + '.before-audiogram-codex')
        if not backup.exists():
            shutil.copy2(target, backup)
    for filename in ('codex_images.py', 'xray_codex.py', 'audiogram_codex.py'):
        shutil.copy2(SOURCE / filename, BIN / filename)
    shutil.copy2(SOURCE / 'xray-upload.js', QTC / 'xray-upload.js')
    server.write_text(server_text, encoding='utf-8')
    page.write_text(page_text, encoding='utf-8')
    audiogram.write_text(audiogram_text, encoding='utf-8')
    print('Installed local XR/AUD Codex integration. Restart com.va.sospdf.server to activate.')


if __name__ == '__main__':
    main()
