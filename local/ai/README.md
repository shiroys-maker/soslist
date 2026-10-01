# AI task settings

SOSList Local 1.1.0 adds a native settings button. User settings are private JSON in `~/Library/Application Support/SOSList Local/ai-tasks.json`; never synchronize this file or credentials. Each invocation reads its task once, and running settings remain distinct from the next saved settings. Missing task settings preserve the previous hardcoded or environment model and effort. The catalog uses Codex `model/list` with pagination and cache, plus Gemini TTS models if a configured API key is present; custom IDs remain unchanged when catalogs refresh. Services are restricted to those implemented by each existing runner.

| Task | Consumer / shared scope | Prior default |
| --- | --- | --- |
| bill | External `~/soslist/openai-processor/codex-extract.js`; manual and Evidence Review import | Codex gpt-6.1-sol / medium |
| evidence | `local/evidence-review/runner.cjs`; single, batch, resume, SHA edits/referrals in the same turn | Codex gpt-6-astra / high |
| xray | `xray_codex.py` via `codex_images.py`; upload and CD | Codex gpt-6-astra / high |
| audiogram | `audiogram_codex.py` via `codex_images.py` | Codex gpt-6.1-sol / high |
| kana | `name_kana_codex.py`; cache includes model and effort | Codex gpt-6-luna / low |
| summary | `daily-brief/run-codex-summary.sh`; Summary + Podcast scripts, manual + scheduled | Codex gpt-6-astra / high |
| speech | `daily-brief/prepare-speech.js`; cache includes model and effort | Codex gpt-6.1-sol / medium |
| tts | `daily-brief/gemini-tts.js`; same model for all audio chunks | Gemini gemini-3.8-flash-tts / unsupported |

QTC Python helpers installed in `~/bin` need `ai_task_settings.py` alongside the managed runners. Updating these files requires restarting an idle resident QTC HTTP server to reload Python modules; subsequent settings changes need no restart. The external bill importer has its own self-contained reader and reads the same setting file.

`AIExecutions/*.json` contains only execution model, effort, PID and state; no prompts or patient details. A dead PID is reported as interrupted. Settings tests use isolated temporary files. The app's `--ai-settings-smoke` mode refuses paths outside `/private/tmp/` and opens only a settings test page without Firebase or patient data.
