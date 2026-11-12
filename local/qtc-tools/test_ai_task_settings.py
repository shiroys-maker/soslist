import json
import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from ai_task_settings import choice
import xray_codex as xr

class TaskSettingsTests(unittest.TestCase):
    def test_resident_runner_rereads_settings_at_each_invocation(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {'SOSLIST_AI_SETTINGS_FILE': str(Path(d) / 'tasks.json')}):
            self.assertEqual(choice('xray', 'legacy', 'high'), ('legacy', 'high'))
            file = Path(d) / 'tasks.json'
            file.write_text(json.dumps({'xray': {'model': 'synthetic-first', 'effort': 'medium'}}))
            with patch.object(xr, 'run_image_report', return_value={'findings': 'synthetic', 'impression': 'synthetic'}) as run:
                xr.generate_report({'imageDataUrl': 'data:image/png;base64,c3ludGhldGlj'})
                self.assertEqual(run.call_args.kwargs['model'], 'synthetic-first')
                self.assertEqual(run.call_args.kwargs['effort'], 'medium')
                file.write_text(json.dumps({'xray': {'model': 'synthetic-second', 'effort': 'low'}}))
                xr.generate_report({'imageDataUrl': 'data:image/png;base64,c3ludGhldGlj'})
                self.assertEqual(run.call_args.kwargs['model'], 'synthetic-second')
                self.assertEqual(run.call_args.kwargs['effort'], 'low')
