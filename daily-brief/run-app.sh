#!/bin/bash
# ミニアプリ(ローカルサーバ)を起動する。.env を読み込んでから server.js を実行。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ -f "$DIR/.env" ]; then
  # shellcheck disable=SC1091
  source "$DIR/.env"
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "ブラウザで http://127.0.0.1:${PORT:-8790}/ を開いてください。(終了は Ctrl+C)"
exec node "$DIR/server.js"
