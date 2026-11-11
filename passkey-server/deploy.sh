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
# 作成直後はGoogle側への反映に数十秒かかるため、成功するまで再試行する
for role in roles/datastore.user roles/firebaseauth.viewer; do
  for i in {1..12}; do
    gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$role" --condition None >/dev/null 2>&1 && break
    [[ $i == 12 ]] && { echo "権限の付与に失敗しました: $role"; exit 1; }
    echo "サービスアカウントの反映待ち… ($i)"; sleep 10
  done
done
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/iam.serviceAccountTokenCreator >/dev/null

# 1b. パスキー登録時のGoogle本人確認を soslist.niraissc.jp から行えるようにする（承認済みドメインに追加）
python3 - "$PROJECT" "$(gcloud auth print-access-token)" <<'PY'
import json, sys, urllib.request
p, t = sys.argv[1], sys.argv[2]
h = {"Authorization": "Bearer " + t, "x-goog-user-project": p, "content-type": "application/json"}
url = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{p}/config"
doms = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=h)))["authorizedDomains"]
if "soslist.niraissc.jp" not in doms:
    body = json.dumps({"authorizedDomains": doms + ["soslist.niraissc.jp"]}).encode()
    urllib.request.urlopen(urllib.request.Request(url + "?updateMask=authorizedDomains", data=body, headers=h, method="PATCH"))
    print("承認済みドメインに soslist.niraissc.jp を追加しました")
PY

# 2. 使い終わったチャレンジを自動削除（TTL）
gcloud firestore fields ttls update expireAt --collection-group passkeyChallenges --enable-ttl --project "$PROJECT" --async >/dev/null 2>&1 || true

# 3. デプロイ（ログイン前に呼ぶため公開エンドポイント。CORSで soslist.niraissc.jp のみ許可）
gcloud run deploy sos-passkey --project "$PROJECT" --region "$REGION" --source . \
  --service-account "$SA" --allow-unauthenticated \
  --memory 256Mi --cpu 1 --max-instances 2 --concurrency 20 --timeout 30 \
  --set-env-vars RP_ID=soslist.niraissc.jp,ORIGINS=https://soslist.niraissc.jp

# 注: Cloud Run は末尾が z のパス(/healthz)を予約しているため login/options で確認する
curl -fsS -X POST -H "Origin: https://soslist.niraissc.jp" "https://sos-passkey-455081821929.asia-northeast1.run.app/login/options" >/dev/null && echo "OK"
