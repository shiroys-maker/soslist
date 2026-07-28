#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/shungohiroyasu/Documents/GitHub/soslist"
CODEX_BIN="/Applications/ChatGPT.app/Contents/Resources/codex"
NODE_BIN="/Users/shungohiroyasu/.nvm/versions/node/v22.14.0/bin/node"
PROMPT_FILE="$ROOT_DIR/daily-brief/codex-scheduled-summary-prompt.md"
LOG_DIR="$ROOT_DIR/daily-brief/logs"
LOCK_DIR="/tmp/soslist-codex-scheduled-summary.lock"
CONTEXT_FILE="/tmp/soslist-codex-scheduled-summary-context.json"

cleanup() {
  rm -f "$CONTEXT_FILE" "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

mkdir -p "$LOG_DIR"
exec >> "$LOG_DIR/codex-scheduled-summary.log" 2>&1

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -r "$LOCK_DIR/pid" ]] && kill -0 "$(<"$LOCK_DIR/pid")" 2>/dev/null; then
    print "[$(date -Iseconds)] 前回の定時Summary処理が実行中のためスキップします。"
    exit 0
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || exit 1
  mkdir "$LOCK_DIR"
fi
trap cleanup EXIT
print $$ > "$LOCK_DIR/pid"

if [[ ! -x "$NODE_BIN" || ! -x "$CODEX_BIN" ]]; then
  print "[$(date -Iseconds)] NodeまたはCodex CLIが見つかりません。"
  exit 1
fi

print "[$(date -Iseconds)] Codex定時Summary処理を開始します。"
context_json=$(cd "$ROOT_DIR/daily-brief" && source .env && "$NODE_BIN" generate-brief.js --scheduled-context)
print -r -- "$context_json" > "$CONTEXT_FILE"
action=$("$NODE_BIN" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).action)' "$CONTEXT_FILE")
ymd=$("$NODE_BIN" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).ymd || "")' "$CONTEXT_FILE")

if [[ "$action" == "skip" ]]; then
  print "[$(date -Iseconds)] ${ymd:-対象日なし}: $("$NODE_BIN" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).reason || "skip")' "$CONTEXT_FILE")"
  exit 0
fi

if [[ "$action" == "finalize" ]]; then
  (cd "$ROOT_DIR/daily-brief" && source .env && "$NODE_BIN" generate-brief.js --finalize-prepared --date "$ymd")
  osascript -e 'tell application "AivisSpeech" to quit' || true
  print "[$(date -Iseconds)] ${ymd}: 後段処理を完了しました。"
  exit 0
fi

if [[ "$action" != "generate" ]]; then
  print "[$(date -Iseconds)] 未知の定時Summary処理 action: $action"
  exit 1
fi

"$CODEX_BIN" exec \
  --ephemeral \
  --dangerously-bypass-approvals-and-sandbox \
  --cd "$ROOT_DIR" \
  --output-last-message "$LOG_DIR/codex-scheduled-summary-last-message.txt" \
  < "$PROMPT_FILE"
osascript -e 'tell application "AivisSpeech" to quit' || true
print "[$(date -Iseconds)] Codex定時Summary処理を終了しました。"
