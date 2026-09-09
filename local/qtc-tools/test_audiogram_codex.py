import copy
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import audiogram_codex as aud
import codex_images as runner
import install


def report_fixture():
    return {
        'exam_date': '2026/09/09', 'make': 'GeoAxon', 'model': 'KuduWave Pro',
        'calibration_date': '2026/01/15', 'tinnitus': 'No',
        'right_ear': dict(zip(aud.FREQUENCIES, [0, 5, 10, 15, 20, 25, None])),
        'left_ear': dict(zip(aud.FREQUENCIES, [-5, 0, 5, 10, 15, 20, 25])),
    }


class AudiogramTests(unittest.TestCase):
    def test_one_image_uses_chatgpt_codex_and_preserves_extracted_values(self):
        directories = []

        def codex(command, **kwargs):
            attachments = [Path(command[i + 1]) for i, value in enumerate(command) if value == '--image']
            self.assertEqual(len(attachments), 1)
            self.assertEqual(attachments[0].read_bytes(), b'synthetic')
            self.assertIn('forced_login_method="chatgpt"', command)
            self.assertNotIn('OPENAI_API_KEY', kwargs['env'])
            self.assertNotIn('CODEX_API_KEY', kwargs['env'])
            self.assertIn('single attached screenshot', kwargs['input'])
            schema = Path(command[command.index('--output-schema') + 1])
            self.assertEqual(json.loads(schema.read_text()), aud.REPORT_SCHEMA)
            output = Path(command[command.index('--output-last-message') + 1])
            directories.append(output.parent)
            output.write_text(json.dumps(report_fixture()), encoding='utf-8')
            return subprocess.CompletedProcess(command, 0, stderr='')

        with patch.dict(runner.os.environ, {'OPENAI_API_KEY': 'test-only', 'CODEX_API_KEY': 'test-only'}):
            with patch.object(runner.subprocess, 'run', side_effect=codex):
                report = aud.generate_report({'imageDataUrl': 'data:image/png;base64,c3ludGhldGlj'})
        self.assertEqual(report, report_fixture())
        self.assertFalse(directories[0].exists())

    def test_reject_multiple_images_before_starting_codex(self):
        with patch.object(runner.subprocess, 'run') as run:
            with self.assertRaises(aud.ReportError) as caught:
                aud.generate_report({'imageDataUrls': ['data:image/png;base64,YQ=='] * 2})
            self.assertEqual(caught.exception.status, 400)
            run.assert_not_called()

    def test_malformed_output_is_not_silently_applied(self):
        for invalid in ('25', True, float('nan'), float('inf')):
            report = report_fixture()
            report['right_ear']['500'] = invalid
            with self.subTest(value=invalid), self.assertRaises(aud.ReportError):
                aud.validate_report(report)
        for field, invalid in (('tinnitus', 'Unknown'), ('left_ear', {}), ('make', 123)):
            report = report_fixture()
            report[field] = invalid
            with self.subTest(field=field), self.assertRaises(aud.ReportError):
                aud.validate_report(report)

    def test_missing_values_remain_null(self):
        report = report_fixture()
        for ear in ('right_ear', 'left_ear'):
            report[ear] = dict.fromkeys(aud.FREQUENCIES)
        for field in (*aud.TEXT_FIELDS, 'tinnitus'):
            report[field] = None
        self.assertEqual(aud.validate_report(copy.deepcopy(report)), report)

    def test_http_invalid_json(self):
        class Handler:
            headers = {'Content-Length': '1'}
            rfile = io.BytesIO(b'{')

            def _respond_json(self, status, body):
                self.status, self.body = status, body

        handler = Handler()
        aud.handle_audiogram_report(handler)
        self.assertEqual(handler.status, 400)

    def test_installer_only_changes_aud_ai_call(self):
        page = ('<script>\n    const API_KEY = "test-only";\n'
                '    async function handleImages(files) {\n        keepSingleImage();\n    }\n'
                '    async function parseImage(file) {\n        oldApiCall();\n    }\n'
                '    function fillFromFirebase(record) {\n        keepPatientFields();\n    }\n'
                '    function fillAudioData(a) { keepReportLayout(); }\n</script>')
        updated = install.update_audiogram_page(page)
        self.assertEqual(install.update_audiogram_page(updated), updated)
        self.assertNotIn('API_KEY', updated)
        self.assertNotIn('oldApiCall', updated)
        self.assertIn('keepSingleImage()', updated)
        self.assertIn('imageDataUrl:', updated)
        self.assertNotIn('imageDataUrls:', updated)
        suffix = page[page.index('    function fillFromFirebase'):]
        self.assertTrue(updated.endswith(suffix))
        server = ('import http.server\nclass Handler:\n    def do_POST(self):\n'
                  "        if parsed.path == '/api/xray-report':\n"
                  '            self._handle_xray_report()\n            return\n')
        updated_server = install.update_audiogram_server(server)
        self.assertEqual(install.update_audiogram_server(updated_server), updated_server)
        self.assertIn('self._handle_xray_report()', updated_server)
        compile(updated_server, '<server>', 'exec')


if __name__ == '__main__':
    unittest.main()
