#!/bin/zsh
# SOSList Local のパスワード不要ログインを、この Mac で使えるようにする（Mac ごとに1回）。
# 何度実行しても安全。
#  1. 署名専用サービスアカウント sos-local-signer を作成（権限は何も持たない）
#  2. この Mac の Google Cloud アカウントに、そのアカウントで署名する権限を付与
#  3. この Mac 専用のログイン鍵を macOS キーチェーンに作成
#  4. 鍵のハッシュ（鍵そのものは復元できない値）を local/login/key-hashes.txt に追記
#     → データベースの規則に登録すると、この Mac からのログインが有効になる
set -euo pipefail
PROJECT=sos-list-4d150
SA_NAME=sos-local-signer
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
SERVICE=soslist-local-login
HERE="${0:A:h}"
ME=$(gcloud config get-value account 2>/dev/null)
[[ -n "$ME" ]] || { echo "gcloud にログインしていません（gcloud auth login）"; exit 1; }

gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name "SOSList Local login signer (no roles)"
for i in {1..12}; do
  gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" \
    --member "user:$ME" --role roles/iam.serviceAccountTokenCreator >/dev/null 2>&1 && break
  [[ $i == 12 ]] && { echo "署名権限の付与に失敗しました"; exit 1; }
  echo "サービスアカウントの反映待ち… ($i)"; sleep 10
done
echo "署名権限: $ME → $SA"

[[ -f "$HOME/.config/gcloud/application_default_credentials.json" ]] \
  || { echo "この Mac の Google Cloud 認証(ADC)がありません。gcloud auth application-default login を実行してください"; exit 1; }

if ! /usr/bin/security find-generic-password -s "$SERVICE" -a "$USER" >/dev/null 2>&1; then
  /usr/bin/security add-generic-password -s "$SERVICE" -a "$USER" -l "SOSList Local login key" \
    -w "$(openssl rand -hex 32)"
  echo "この Mac 用のログイン鍵を作成しました"
fi
HASH=$(/usr/bin/security find-generic-password -s "$SERVICE" -a "$USER" -w | tr -d '\n' | shasum -a 256 | cut -d' ' -f1)
LINE="$HASH $(scutil --get ComputerName 2>/dev/null || hostname)"
touch "$HERE/key-hashes.txt"
grep -q "^$HASH " "$HERE/key-hashes.txt" || echo "$LINE" >> "$HERE/key-hashes.txt"
echo "鍵のハッシュを登録用ファイルに記録しました: $LINE"
echo "完了。Claude に「setup done」と伝えてください。"
