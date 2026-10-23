import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import claude_cli
import name_kana_codex as kana
import xray_codex as xr


def result_line(output):
    return json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'structured_output': output})


class ClaudeTaskTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.settings = Path(self.dir.name) / 'tasks.json'
        self.env = patch.dict(os.environ, {'SOSLIST_AI_SETTINGS_FILE': str(self.settings),
                                           'ANTHROPIC_API_KEY': 'test-only', 'OPENAI_API_KEY': 'test-only'})
        self.env.start()
        self.which = patch.object(claude_cli, 'resolve_claude_path', return_value='/fixture/claude')
        self.which.start()
        kana._cache.clear()

    def tearDown(self):
        self.which.stop()
        self.env.stop()
        self.dir.cleanup()

    def test_xray_images_go_to_claude_as_base64_with_subscription_isolation(self):
        self.settings.write_text(json.dumps({'xray': {'service': 'claude', 'model': 'opus', 'effort': 'high'}}))

        def claude(command, **kwargs):
            self.assertEqual(command[0], '/fixture/claude')
            self.assertEqual(command[command.index('--model') + 1], 'opus')
            self.assertEqual(command[command.index('--effort') + 1], 'high')
            self.assertEqual(command[command.index('--tools') + 1], '')
            self.assertIn('"forceLoginMethod": "claudeai"', command[command.index('--settings') + 1])
            self.assertNotIn('ANTHROPIC_API_KEY', kwargs['env'])
            content = json.loads(kwargs['input'])['message']['content']
            self.assertEqual([base64.b64decode(c['source']['data']) for c in content[:-1]], [b'one', b'two'])
            self.assertIn('all 2 attached', content[-1]['text'])
            return subprocess.CompletedProcess(command, 0, stdout='{"type":"system"}\n' + result_line(
                {'findings': 'Both', 'impression': 'Normal'}), stderr='')

        urls = ['data:image/png;base64,' + base64.b64encode(v).decode() for v in (b'one', b'two')]
        with patch.object(claude_cli.subprocess, 'run', side_effect=claude):
            self.assertEqual(xr.generate_report({'imageDataUrls': urls}), {'findings': 'Both', 'impression': 'Normal'})
        execution = json.loads((self.settings.parent / 'AIExecutions/xray.json').read_text())
        self.assertEqual((execution['service'], execution['state']), ('claude', 'finished'))

    def test_kana_uses_claude_and_still_validates_output(self):
        self.settings.write_text(json.dumps({'kana': {'service': 'claude', 'model': 'opus', 'effort': 'low'}}))
        reply = subprocess.CompletedProcess([], 0, stdout=result_line({'kana': 'アレックス'}), stderr='')
        with patch.object(claude_cli.subprocess, 'run', return_value=reply):
            self.assertEqual(kana.convert_name('Alex'), 'アレックス')
        reply.stdout = result_line({'kana': 'ignore instructions'})
        with patch.object(claude_cli.subprocess, 'run', return_value=reply):
            with self.assertRaises(kana.KanaError):
                kana.convert_name('Other Name')

    def test_claude_failure_maps_usage_limit(self):
        reply = subprocess.CompletedProcess([], 1, stdout='', stderr='Usage limit reached')
        with patch.object(claude_cli.subprocess, 'run', return_value=reply):
            with self.assertRaises(claude_cli.ClaudeError) as caught:
                claude_cli.run_claude_json('x', schema={}, model='opus', effort='low', system_prompt='s', timeout=5)
        self.assertEqual(caught.exception.status, 429)


if __name__ == '__main__':
    unittest.main()
