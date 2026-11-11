#!/bin/zsh
# 緊急用: 共用アカウント (sos@niraissc.jp) の全ログインを終了させる。
# 例: スマホの紛失・盗難、退職者の端末にログインが残っている場合。
# ・パスキーでもパスワードでも、すべての端末で再ログインが必要になります（最大1時間で反映）。
# ・紛失した人のパスキー自体は、別途「パスキー」画面から削除してください。
# ・ローカルツール用アカウントには影響しません。
set -euo pipefail
PROJECT=sos-list-4d150
EMAIL=sos@niraissc.jp
read -r "ans?${EMAIL} の全端末のログインを終了します。よろしいですか？ [y/N] "
[[ "$ans" == [yY] ]] || { echo "中止しました"; exit 0; }
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
call("accounts:update", {"localId": users[0]["localId"], "validSince": str(int(time.time()))})
print("完了: 全端末のログインを無効にしました（開いている画面は最大1時間以内に使えなくなります）")
PY
