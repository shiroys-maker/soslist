import base64
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import install
import xray_codex as xr


def data_url(value):
    return 'data:image/png;base64,' + base64.b64encode(value).decode('ascii')


class XrayTests(unittest.TestCase):
    def test_all_images_attached_and_chatgpt_auth_isolated(self):
        directories = []

        def codex(command, **kwargs):
            directories.append(kwargs['cwd'])
            attachments = [Path(command[i + 1]) for i, item in enumerate(command) if item == '--image']
            self.assertEqual([item.read_bytes() for item in attachments], [b'view-one', b'view-two'])
            self.assertIn('forced_login_method="chatgpt"', command)
            self.assertIn('--ephemeral', command)
            self.assertEqual(command[command.index('--sandbox') + 1], 'read-only')
            self.assertNotIn('OPENAI_API_KEY', kwargs['env'])
            self.assertNotIn('CODEX_API_KEY', kwargs['env'])
            self.assertIn('all 2 attached', kwargs['input'])
            output = Path(command[command.index('--output-last-message') + 1])
            output.write_text(json.dumps({'findings': 'Both views', 'impression': 'Integrated'}))
            return subprocess.CompletedProcess(command, 0, stderr='')

        with patch.dict(xr.os.environ, {'OPENAI_API_KEY': 'test-only', 'CODEX_API_KEY': 'test-only'}):
            with patch.object(xr.subprocess, 'run', side_effect=codex):
                result = xr.generate_report({'imageDataUrls': [data_url(b'view-one'), data_url(b'view-two')]})
        self.assertEqual(result['findings'], 'Both views')
        self.assertFalse(Path(directories[0]).exists())

    def test_single_image_compatibility_and_invalid_inputs(self):
        self.assertEqual(xr.decode_images({'imageDataUrl': data_url(b'old-client')}), [('.png', b'old-client')])
        for payload in ([], {}, {'imageDataUrls': []}, {'imageDataUrls': ['bad']},
                        {'imageDataUrls': ['data:image/png;base64,???']},
                        {'imageDataUrls': [data_url(b'a')] * 13}):
            with self.subTest(payload=payload), self.assertRaises(xr.ReportError) as caught:
                xr.generate_report(payload)
            self.assertEqual(caught.exception.status, 400)

    def test_timeout_cleanup_and_slot_release(self):
        directories = []

        def timeout(command, **kwargs):
            directories.append(kwargs['cwd'])
            raise subprocess.TimeoutExpired(command, 240)

        with patch.object(xr.subprocess, 'run', side_effect=timeout):
            for _ in range(3):
                with self.assertRaises(xr.ReportError) as caught:
                    xr.generate_report({'imageDataUrls': [data_url(b'a')]})
                self.assertEqual(caught.exception.status, 504)
        self.assertTrue(all(not Path(directory).exists() for directory in directories))

    def test_invalid_output_and_failure_do_not_become_reports(self):
        for report, returncode in (({}, 0), ({'findings': 'x', 'impression': ''}, 0), (None, 1)):
            def codex(command, **kwargs):
                output = Path(command[command.index('--output-last-message') + 1])
                output.write_text(json.dumps(report))
                return subprocess.CompletedProcess(command, returncode, stderr='test failure')

            with self.subTest(report=report), patch.object(xr.subprocess, 'run', side_effect=codex):
                with self.assertRaises(xr.ReportError) as caught:
                    xr.generate_report({'imageDataUrls': [data_url(b'a')]})
                self.assertEqual(caught.exception.status, 502)

    def test_http_validation(self):
        class Handler:
            headers = {'Content-Length': '2'}
            rfile = io.BytesIO(b'{}')

            def _respond_json(self, status, body):
                self.status, self.body = status, body

        handler = Handler()
        xr.handle_xray_report(handler)
        self.assertEqual(handler.status, 400)
        self.assertIn('error', handler.body)

    def test_install_is_idempotent_and_preserves_other_routes(self):
        server = ('import http.server\nclass ReusableHTTPServer(http.server.HTTPServer):\n'
                  '    pass\nclass Handler:\n    def _handle_xray_report(self):\n        old()\n'
                  '    def _handle_request(self, send_body=True):\n        unchanged()\n')
        updated = install.update_server(server)
        self.assertEqual(install.update_server(updated), updated)
        self.assertIn('unchanged()', updated)
        compile(updated, '<server>', 'exec')
        page = ('    <script>\n        const uploadedXrayFiles = [];\n'
                '        async function handleImages(files) {\n old();\n }\n'
                '        function handlePasteImage(event) {\n keep();\n }\n</script>')
        updated = install.update_page(page)
        self.assertEqual(install.update_page(updated), updated)
        self.assertIn('keep()', updated)


if __name__ == '__main__':
    unittest.main()
