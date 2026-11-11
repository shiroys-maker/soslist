#!/bin/zsh
# SOSList パスキーサーバーを Cloud Run (sos-passkey) にデプロイする。
# 何度実行しても安全（既に存在するものはそのまま）。
set -euo pipefail
PROJECT=sos-list-4d150
REGION=asia-northeast1
SA_NAME=sos-passkey-runtime
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
DB=soslist-passkey   # パスキー専用DB。患者データ (default) とは分離し、サーバーはこのDBにしか権限を持たない
DB_CONDITION="expression=resource.name==\"projects/${PROJECT}/databases/${DB}\",title=passkey-db-only,description=sos-passkey can only access the soslist-passkey database"
cd "${0:A:h}"
TOKEN=$(gcloud auth print-access-token)

# 0. パスキー専用データベース（なければ作成）＋ ブラウザからのアクセスを全面拒否するルール
gcloud firestore databases describe --database "$DB" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud firestore databases create --database "$DB" --location asia-northeast1 --type firestore-native \
       --delete-protection --project "$PROJECT"
python3 rest.py rules "$PROJECT" "$TOKEN" "$DB"

# 1. 専用サービスアカウント（パスキー専用DBの読み書き + Firebaseユーザー参照 + ログイン用トークン署名のみ）
gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name "SOSList passkey server"
# 作成直後はGoogle側への反映に数十秒かかるため、成功するまで再試行する
# Firestore はパスキー専用DBに限定（IAM条件）。Firebase Auth は参照のみ。
for spec in "roles/datastore.user|$DB_CONDITION" "roles/firebaseauth.viewer|None"; do
  role=${spec%%|*}; cond=${spec#*|}
  for i in {1..12}; do
    gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$role" --condition "$cond" >/dev/null 2>&1 && break
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
gcloud firestore fields ttls update expireAt --collection-group passkeyChallenges --enable-ttl --database "$DB" --project "$PROJECT" --async >/dev/null 2>&1 || true

# 2b. 旧置き場 (default) にあるパスキーを専用DBへコピー（既にあれば上書きしない）
python3 rest.py copy "$PROJECT" "$TOKEN" "$DB"

# 3. デプロイ（ログイン前に呼ぶため公開エンドポイント。CORSで soslist.niraissc.jp のみ許可）
gcloud run deploy sos-passkey --project "$PROJECT" --region "$REGION" --source . \
  --service-account "$SA" --allow-unauthenticated \
  --memory 256Mi --cpu 1 --max-instances 2 --concurrency 20 --timeout 30 \
  --set-env-vars RP_ID=soslist.niraissc.jp,ORIGINS=https://soslist.niraissc.jp,FIRESTORE_DB=$DB

# 注: Cloud Run は末尾が z のパス(/healthz)を予約しているため login/options で確認する
curl -fsS -X POST -H "Origin: https://soslist.niraissc.jp" "https://sos-passkey-455081821929.asia-northeast1.run.app/login/options" >/dev/null && echo "サーバー応答 OK"

# 4. 新サーバーが専用DBで動き出した後: プロジェクト全体への Firestore 権限（条件なし）を外し、旧置き場のパスキーを削除
gcloud projects remove-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role roles/datastore.user --condition None >/dev/null 2>&1 \
  && echo "プロジェクト全体の Firestore 権限を外しました" || true
python3 rest.py cleanup "$PROJECT" "$TOKEN" "$DB"

# 5. 確認: サーバーの権限で、専用DBは読めて患者データ (default) は読めないこと
python3 rest.py verify "$PROJECT" "$(gcloud auth print-access-token --impersonate-service-account "$SA" 2>/dev/null || true)" "$DB"
