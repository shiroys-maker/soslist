#!/bin/zsh
# SOSList パスキーサーバーを Cloud Run (sos-passkey) にデプロイする。
# 何度実行しても安全（既に存在するものはそのまま）。
set -euo pipefail
PROJECT=sos-list-4d150
REGION=asia-northeast1
SA_NAME=sos-passkey-runtime
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
cd "${0:A:h}"

# 1. 専用サービスアカウント（Firestore読み書き + Firebaseユーザー参照 + ログイン用トークン署名のみ）
gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name "SOSList passkey server"
for role in roles/datastore.user roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$role" --condition None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/iam.serviceAccountTokenCreator >/dev/null

# 2. 使い終わったチャレンジを自動削除（TTL）
gcloud firestore fields ttls update expireAt --collection-group passkeyChallenges --enable-ttl --project "$PROJECT" --async >/dev/null 2>&1 || true

# 3. デプロイ（ログイン前に呼ぶため公開エンドポイント。CORSで soslist.niraissc.jp のみ許可）
gcloud run deploy sos-passkey --project "$PROJECT" --region "$REGION" --source . \
  --service-account "$SA" --allow-unauthenticated \
  --memory 256Mi --cpu 1 --max-instances 2 --concurrency 20 --timeout 30 \
  --set-env-vars RP_ID=soslist.niraissc.jp,ORIGINS=https://soslist.niraissc.jp

curl -fsS "https://sos-passkey-455081821929.asia-northeast1.run.app/healthz" && echo " ← OK"
