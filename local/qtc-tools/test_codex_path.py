import tempfile
import unittest
from pathlib import Path
from codex_path import resolve_codex_path

class DiscoveryTests(unittest.TestCase):
    def test_wrapper_priority_and_stale_override_without_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            options = dict(home=root/'home', apps=root/'apps', system_bins=[], search_path='')
            wrapper = root/'apps/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'
            stable = root/'home/.local/bin/codex'
            retired = root/'apps/ChatGPT.app/Contents/Resources/codex'
            marker = root/'executed'
            def executable(file):
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(f"#!/bin/sh\ntouch '{marker}'\n")
                file.chmod(0o700)
            executable(retired)
            with self.assertRaises(ValueError):
                resolve_codex_path(**options)
            executable(stable)
            executable(wrapper)
            self.assertEqual(resolve_codex_path(**options), str(wrapper))
            self.assertEqual(resolve_codex_path(str(stable), **options), str(stable))
            with self.assertRaises(ValueError):
                resolve_codex_path(str(root/'custom-missing'), **options)
            wrapper.unlink()
            self.assertEqual(resolve_codex_path(str(wrapper), **options), str(stable))
            stable.chmod(0o600)
            with self.assertRaises(ValueError):
                resolve_codex_path(**options)
            self.assertFalse(marker.exists())

if __name__ == '__main__':
    unittest.main()
