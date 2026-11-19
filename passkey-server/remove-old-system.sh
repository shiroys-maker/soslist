#!/bin/zsh
# 旧パスキー方式（Codex版ブリッジ）の残骸を削除する。元に戻せません。
# 現在のパスキー (sos-passkey / データベース soslist-passkey) と患者データ (default) には触れません。
# 削除するもの:
#   Cloud Run: sos-access, sos-patient, sos-enrollment（とそのイメージ置き場）
#   Firebase Hosting: auth.soslist.niraissc.jp, access.soslist.niraissc.jp（サイト sos-list-4d150-auth / -access）
#   Firestore データベース: soslist-access, soslist-auth（旧方式のログイン記録のみ。患者データではない）
#   サービスアカウント: 旧方式用の7つ
#   Firebase Auth の承認済みドメインから auth.soslist.niraissc.jp
set -uo pipefail
P=sos-list-4d150
R=asia-northeast1
echo "旧パスキー方式の Cloud Run 3つ・サイト2つ・データベース2つ・サービスアカウント7つを削除します（元に戻せません）。"
read -r "ans?よろしいですか？ [y/N] "
[[ "$ans" == [yY] ]] || { echo "中止しました"; exit 0; }
T=$(gcloud auth print-access-token)
api() { curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "content-type: application/json" "$@"; }
FAIL=0
step() { echo "• $1"; }
ok() { [[ "$1" == 2* || "$1" == 404 ]] && echo "  OK" || { echo "  失敗 (HTTP $1)"; FAIL=1; }; }

for s in sos-access sos-patient sos-enrollment; do
  step "Cloud Run $s"
  gcloud run services delete $s --region $R --project $P --quiet >/dev/null 2>&1 && echo "  OK" || { gcloud run services describe $s --region $R --project $P >/dev/null 2>&1 && { echo "  失敗"; FAIL=1; } || echo "  OK（既に無し）"; }
done
for r in sos-access sos-patient sos-enrollment; do
  step "イメージ置き場 $r"
  gcloud artifacts repositories delete $r --location $R --project $P --quiet >/dev/null 2>&1 && echo "  OK" || echo "  OK（既に無し、または削除済み）"
done

for pair in "sos-list-4d150-auth auth.soslist.niraissc.jp" "sos-list-4d150-access access.soslist.niraissc.jp"; do
  site=${pair%% *}; dom=${pair##* }
  step "ドメイン $dom"
  ok "$(api -X DELETE "https://firebasehosting.googleapis.com/v1beta1/projects/$P/sites/$site/customDomains/$dom")"
  step "サイト $site"
  ok "$(api -X DELETE "https://firebasehosting.googleapis.com/v1beta1/projects/$P/sites/$site")"
done

for db in soslist-access soslist-auth; do
  step "データベース $db（削除保護を解除して削除）"
  gcloud firestore databases update --database=$db --no-delete-protection --project $P --quiet >/dev/null 2>&1
  gcloud firestore databases delete --database=$db --project $P --quiet >/dev/null 2>&1 && echo "  OK" || { gcloud firestore databases describe --database=$db --project $P >/dev/null 2>&1 && { echo "  失敗"; FAIL=1; } || echo "  OK（既に無し）"; }
done

for sa in sos-access-runtime sos-access-build sos-patient-runtime sos-patient-build sos-enroll-runtime sos-enroll-build sos-bridge-signer; do
  step "サービスアカウント $sa"
  gcloud iam service-accounts delete "$sa@$P.iam.gserviceaccount.com" --project $P --quiet >/dev/null 2>&1 && echo "  OK" || echo "  OK（既に無し）"
done

step "承認済みドメインから auth.soslist.niraissc.jp / access.soslist.niraissc.jp を外す"
python3 - "$P" "$T" <<'PY' || FAIL=1
import json, sys, urllib.request
p, t = sys.argv[1:3]
h = {"Authorization": "Bearer " + t, "x-goog-user-project": p, "content-type": "application/json"}
u = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{p}/config"
cur = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=h)))["authorizedDomains"]
new = [d for d in cur if d not in ("auth.soslist.niraissc.jp", "access.soslist.niraissc.jp")]
if new != cur:
    req = urllib.request.Request(u + "?updateMask=authorizedDomains", data=json.dumps({"authorizedDomains": new}).encode(), headers=h, method="PATCH")
    urllib.request.urlopen(req)
print("  OK:", new)
PY

echo
if [[ $FAIL == 0 ]]; then
  echo "完了。最後に、ドメイン管理画面（niraissc.jp の DNS）で auth.soslist と access.soslist の CNAME を削除してください。"
  echo "Claude に「done」と伝えてください。"
else
  echo "一部失敗しました。この画面の内容を Claude に貼り付けてください。"
fi
