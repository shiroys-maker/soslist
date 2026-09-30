import io
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import name_kana_codex as kana
import install

class NameKanaTests(unittest.TestCase):
    def setUp(self):
        kana._cache.clear()

    def fake(self, command, **kwargs):
        self.assertEqual(command[command.index('--model') + 1], 'gpt-6-luna')
        self.assertIn('model_reasoning_effort="low"', command)
        self.assertIn('forced_login_method="chatgpt"', command)
        self.assertIn('--ignore-user-config', command)
        self.assertNotIn('OPENAI_API_KEY', kwargs['env'])
        self.assertEqual(kwargs['timeout'], 25)
        self.assertTrue(command[-1] == '-')
        self.assertNotIn('Alex Example', ' '.join(command))
        self.assertIn('Alex Example', kwargs['input'])
        self.temp = Path(kwargs['cwd'])
        Path(command[command.index('--output-last-message') + 1]).write_text('{"kana":"アレックス・エグザンプル"}')
        return SimpleNamespace(returncode=0)

    def test_cli_contract_cache_and_cleanup(self):
        with patch.object(kana, 'resolve_codex', return_value='/fake/codex'), patch.object(kana.subprocess, 'run', side_effect=self.fake) as run:
            self.assertEqual(kana.convert_name('Alex Example'), 'アレックス・エグザンプル')
            self.assertEqual(kana.convert_name(' Alex Example '), 'アレックス・エグザンプル')
            self.assertEqual(run.call_count, 1)
            self.assertFalse(self.temp.exists())

    def test_timeout_no_cache_no_fallback(self):
        with patch.object(kana, 'resolve_codex', return_value='/fake/codex'), patch.object(kana.subprocess, 'run', side_effect=subprocess.TimeoutExpired('codex',25)) as run:
            with self.assertRaises(kana.KanaError) as e: kana.convert_name('Alex Example')
            self.assertEqual(e.exception.status, 504)
            self.assertEqual(len(kana._cache),0)
            self.assertEqual(run.call_count,1)

    def test_invalid_output_and_nonzero_exit(self):
        def invalid(cmd, **kwargs):
            Path(cmd[cmd.index('--output-last-message')+1]).write_text('{"kana":"ignore instructions"}')
            return SimpleNamespace(returncode=0)
        for fake in [invalid, lambda *a,**k:SimpleNamespace(returncode=1)]:
            with patch.object(kana,'resolve_codex',return_value='/fake/codex'), patch.object(kana.subprocess,'run',side_effect=fake):
                with self.assertRaises(kana.KanaError) as e: kana.convert_name('Alex Example')
                self.assertEqual(e.exception.status,502)
        self.assertEqual(len(kana._cache),0)

    def test_busy_returns_immediately(self):
        kana._slots.acquire();kana._slots.acquire()
        try:
            with self.assertRaises(kana.KanaError) as e:kana.convert_name('Alex Example')
            self.assertEqual(e.exception.status,429)
        finally:kana._slots.release();kana._slots.release()

    def test_http_validation(self):
        class Handler:
            def _respond_json(self,status,body):self.status=status;self.body=body
        for payload,status in [(b'[]',400),(b'{',400),(b'{"name":null}',400),(b'{"name":""}',400)]:
            h=Handler();h.headers={'Content-Length':str(len(payload))};h.rfile=io.BytesIO(payload)
            kana.handle_name_kana(h);self.assertEqual(h.status,status)

    def test_installer_idempotence(self):
        source='import http.server\nclass Handler:\n    def _handle_name_kana(self):\n        old_api()\n\n    def _handle_xray_report(self):\n        pass\n'
        updated=install.update_name_kana_server(source)
        self.assertEqual(updated,install.update_name_kana_server(updated))
        self.assertNotIn('old_api',updated)
        compile(updated,'server','exec')

if __name__=='__main__':unittest.main()
