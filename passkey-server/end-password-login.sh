#!/bin/zsh
# 共用アカウント sos@niraissc.jp のパスワードログインを終了する（2026-11-19、スタッフ全員のパスキー登録後）。
#  1. データベースの規則を反映（sos@ のパスワードログインではデータを読み書きできなくなる。
#     読み取り専用の local@ は QTC ローカルツール用にパスワードのまま残す）
#  2. sos@ からパスワード自体を削除（パスキーと SOSList Local の自動ログインはそのまま使える）
#  3. 全端末のログインを終了（全員「パスキーでログイン」からログインし直す）
# 元に戻す場合: firestore.rules / storage.rules を前の版に戻して deploy-rules.sh、
#   Firebase コンソールで sos@ にパスワードを再設定。
set -euo pipefail
HERE="${0:A:h}"
PROJECT=sos-list-4d150
EMAIL=sos@niraissc.jp
read -r "ans?${EMAIL} のパスワードログインを終了し、全端末をログアウトさせます。よろしいですか？ [y/N] "
[[ "$ans" == [yY] ]] || { echo "中止しました"; exit 0; }

echo "1/3 データベースの規則を反映…"
"$HERE/deploy-rules.sh"

echo "2/3 sos@ のパスワードを削除、3/3 全端末のログインを終了…"
python3 - "$PROJECT" "$(gcloud auth print-access-token)" "$EMAIL" <<'PY'
import json, sys, time, urllib.request
p, t, email = sys.argv[1:4]
h = {"Authorization": "Bearer " + t, "x-goog-user-project": p, "content-type": "application/json"}
def call(path, body):
    r = urllib.request.Request(f"https://identitytoolkit.googleapis.com/v1/projects/{p}/{path}", data=json.dumps(body).encode(), headers=h)
    return json.load(urllib.request.urlopen(r))
users = call("accounts:lookup", {"email": [email]}).get("users", [])
if len(users) != 1:
    sys.exit("アカウントが見つかりません")
uid = users[0]["localId"]
call("accounts:update", {"localId": uid, "deleteProvider": ["password"], "validSince": str(int(time.time()))})
u = call("accounts:lookup", {"localId": [uid]})["users"][0]
providers = [x.get("providerId") for x in u.get("providerUserInfo", [])]
print("確認: sos@ のログイン方法 =", providers or "なし（パスワード削除済み）")
if "password" in providers:
    sys.exit("パスワードが残っています。Claude に伝えてください。")
PY
echo "完了。開いている画面は最大1時間以内にログイン画面に戻ります。Claude に「done」と伝えてください。"
