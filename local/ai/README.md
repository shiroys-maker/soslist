# AI task settings

SOSList Local 1.1.0 adds a native settings button. User settings are private JSON in `~/Library/Application Support/SOSList Local/ai-tasks.json`; never synchronize this file or credentials. Each invocation reads its task once, and running settings remain distinct from the next saved settings. Missing task settings preserve the previous hardcoded or environment model and effort. The catalog uses Codex `model/list` with pagination and cache, plus Gemini TTS models if a configured API key is present; custom IDs remain unchanged when catalogs refresh. Summary supports Codex and Claude Code (Claude subscription). Other services remain restricted to their implemented runners. Summary keeps separate model/effort selections for each service; Claude defaults to the latest Opus alias with high effort. Its CLI receives only the generation prompt, uses no tools, and returns structured Summary/Podcast text for host-side validation and saving. Manual and scheduled generation use the same saved choice, read once at generation start.

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

`AIExecutions/*.json` contains only execution service, model, effort, PID and state; no prompts or patient details. A dead PID is reported as interrupted. Settings tests use isolated temporary files. The app's `--ai-settings-smoke` mode refuses paths outside `/private/tmp/` and opens only a settings test page without Firebase or patient data.

「モデル一覧を更新」はCodexのmodel/listとClaude Codeの初期化応答を取得します。
Claudeはログイン済みサブスクリプションのCLIを使い、モデル生成のプロンプトは送信しません。
Claudeの別名（例: Opus）に対応するresolvedModelも版指定の候補（例: Opus 5.5）として表示します。
サービスごとに更新し、取得失敗時はそのサービスの前回の一覧を残して画面に知らせます。
更新中も未保存のサービス・モデル・effort選択を保持します。
