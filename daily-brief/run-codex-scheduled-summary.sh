#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/shungohiroyasu/Documents/GitHub/soslist"
RUNNER="$ROOT_DIR/daily-brief/run-codex-summary.sh"
LOG_DIR="$ROOT_DIR/daily-brief/logs"
LOCK_DIR="/tmp/soslist-codex-scheduled-summary.lock"

cleanup() {
  rm -f "$LOCK_DIR/pid"
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

if [[ ! -x "$RUNNER" ]]; then
  print "[$(date -Iseconds)] Codex Summary runner が見つかりません。"
  exit 1
fi

print "[$(date -Iseconds)] Codex定時Summary処理を開始します。"
"$RUNNER" --scheduled
print "[$(date -Iseconds)] Codex定時Summary処理を終了しました。"
