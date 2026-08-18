#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/shungohiroyasu/Documents/GitHub/soslist"
CODEX_BIN="/Applications/ChatGPT.app/Contents/Resources/codex"
NODE_BIN="/Users/shungohiroyasu/.nvm/versions/node/v22.14.0/bin/node"
DAILY_BRIEF_DIR="$ROOT_DIR/daily-brief"
RUNTIME_DIR="$DAILY_BRIEF_DIR/.runtime"
LOG_DIR="$DAILY_BRIEF_DIR/logs"
MODE="manual"
TARGET_DATE=""

while (( $# > 0 )); do
  case "$1" in
    --scheduled) MODE="scheduled" ;;
    --date)
      (( $# >= 2 )) || { print -u2 "--date requires YYYY-MM-DD"; exit 2; }
      TARGET_DATE="$2"
      shift
      ;;
    *) print -u2 "unknown argument: $1"; exit 2 ;;
  esac
  shift
done

if [[ "$MODE" == "manual" && ! "$TARGET_DATE" =~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' ]]; then
  print -u2 "manual mode requires --date YYYY-MM-DD"
  exit 2
fi

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
CONTEXT_FILE="$RUNTIME_DIR/codex-summary-${MODE}-${TARGET_DATE:-next}-$$.json"

cleanup() {
  rm -f "$CONTEXT_FILE"
}
trap cleanup EXIT

if [[ ! -x "$NODE_BIN" || ! -x "$CODEX_BIN" ]]; then
  print -u2 "Node または Codex CLI が見つかりません。"
  exit 1
fi

if [[ "$MODE" == "scheduled" ]]; then
  context_json=$(cd "$DAILY_BRIEF_DIR" && source .env && "$NODE_BIN" generate-brief.js --scheduled-context)
else
  context_json=$(cd "$DAILY_BRIEF_DIR" && source .env && "$NODE_BIN" generate-brief.js --codex-context --date "$TARGET_DATE")
fi
print -r -- "$context_json" > "$CONTEXT_FILE"

action=$("$NODE_BIN" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).action)' "$CONTEXT_FILE")
ymd=$("$NODE_BIN" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).ymd || "")' "$CONTEXT_FILE")
out_dir=$("$NODE_BIN" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).outDir || "")' "$CONTEXT_FILE")

if [[ "$action" == "skip" ]]; then
  print "[$(date -Iseconds)] ${ymd:-対象日なし}: $($NODE_BIN -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).reason || "skip")' "$CONTEXT_FILE")"
  exit 0
fi

if [[ "$action" == "finalize" ]]; then
  (cd "$DAILY_BRIEF_DIR" && source .env && "$NODE_BIN" generate-brief.js --finalize-prepared --date "$ymd")
  osascript -e 'tell application "AivisSpeech" to quit' || true
  print "[$(date -Iseconds)] ${ymd}: 後段処理を完了しました。"
  exit 0
fi

if [[ "$action" != "generate" || -z "$ymd" || -z "$out_dir" ]]; then
  print -u2 "Codex Summary のコンテキストが不正です。"
  exit 1
fi

mkdir -p "$out_dir"
print "[$(date -Iseconds)] ${ymd}: Codex Summary 原稿を生成します。"
last_message_file="$LOG_DIR/codex-summary-last-message.txt"
prompt="入力として読むファイルは ${CONTEXT_FILE} だけ。メモリ、リポジトリ、その他のファイルを調査しない。外部LLM API、ブラウザ、デスクトップLLMアプリ、Gitは使わない。JSON の prompt を内容仕様の唯一の根拠として使い、JSON 内の briefPath と scriptPath に UTF-8 で日本語の brief.md と podcast-script.txt を保存する。予約情報にない事実を補わない。podcast-script.txt の各発話は必ず 進行役: または 専門役: で始める。${CONTEXT_FILE} の読み取りと briefPath/scriptPath への保存に限り、利用可能なファイル操作ツールまたはシェルコマンドを使ってよい。保存後、実施日・対象日・結果だけを短く報告する。"

"$CODEX_BIN" exec \
  --ephemeral \
  --sandbox workspace-write \
  --cd "$ROOT_DIR" \
  --add-dir "$out_dir" \
  --output-last-message "$last_message_file" \
  "$prompt"

if [[ ! -s "$out_dir/brief.md" || ! -s "$out_dir/podcast-script.txt" ]]; then
  print -u2 "Codex Summary 原稿生成に失敗しました。brief.md または podcast-script.txt が保存されていません。"
  if [[ -s "$last_message_file" ]]; then
    print -u2 "Codex last message:"
    sed -n '1,120p' "$last_message_file" >&2
  fi
  exit 1
fi

(cd "$DAILY_BRIEF_DIR" && source .env && "$NODE_BIN" generate-brief.js --finalize-prepared --date "$ymd")
osascript -e 'tell application "AivisSpeech" to quit' || true
print "[$(date -Iseconds)] ${ymd}: Codex Summary の後段処理を完了しました。"
