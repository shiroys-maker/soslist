#!/usr/bin/env python3
"""deploy.sh の補助（Firestore / Rules REST API）。使い方: rest.py <rules|copy|cleanup|verify> PROJECT TOKEN DB"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

COLLECTIONS = ("passkeyCredentials", "passkeyChallenges")
DENY_ALL = """rules_version = '2';
// SOSList passkey database: server (Admin SDK) only. Browsers may never read or write.
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
"""


def req(method, url, token, project, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token, "x-goog-user-project": project, "content-type": "application/json"})
    with urllib.request.urlopen(r) as res:
        raw = res.read()
        return json.loads(raw) if raw else {}


def docs_url(project, db):
    return f"https://firestore.googleapis.com/v1/projects/{project}/databases/{urllib.parse.quote(db)}/documents"


def list_docs(project, token, db, coll):
    out, page = [], ""
    while True:
        q = f"{docs_url(project, db)}/{coll}?pageSize=300" + (f"&pageToken={page}" if page else "")
        d = req("GET", q, token, project)
        out += d.get("documents", [])
        page = d.get("nextPageToken")
        if not page:
            return out


def rules(project, token, db):
    rs = req("POST", f"https://firebaserules.googleapis.com/v1/projects/{project}/rulesets", token, project,
             {"source": {"files": [{"name": "passkey-db.rules", "content": DENY_ALL}]}})
    rel = f"projects/{project}/releases/cloud.firestore/{db}"
    body = {"release": {"name": rel, "rulesetName": rs["name"]}}
    try:
        req("PATCH", f"https://firebaserules.googleapis.com/v1/{rel}", token, project, body)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        req("POST", f"https://firebaserules.googleapis.com/v1/projects/{project}/releases", token, project, body["release"])
    print(f"{db}: ブラウザからのアクセスを全面拒否するルールを適用しました")


def copy(project, token, db):
    n = 0
    for d in list_docs(project, token, "(default)", "passkeyCredentials"):
        doc_id = d["name"].rsplit("/", 1)[1]
        try:
            req("POST", f"{docs_url(project, db)}/passkeyCredentials?documentId={urllib.parse.quote(doc_id)}",
                token, project, {"fields": d.get("fields", {})})
            n += 1
        except urllib.error.HTTPError as e:
            if e.code != 409:  # 409 = 既にコピー済み
                raise
    print(f"パスキー {n} 件を専用DBへコピーしました")


def cleanup(project, token, db):
    target = {d["name"].rsplit("/", 1)[1] for d in list_docs(project, token, db, "passkeyCredentials")}
    n = 0
    for coll in COLLECTIONS:
        for d in list_docs(project, token, "(default)", coll):
            doc_id = d["name"].rsplit("/", 1)[1]
            if coll == "passkeyCredentials" and doc_id not in target:
                print(f"未コピーのため削除しません: {doc_id[:12]}…")
                continue
            req("DELETE", "https://firestore.googleapis.com/v1/" + d["name"], token, project)
            n += 1
    print(f"旧置き場 (default) からパスキー関連 {n} 件を削除しました")


def verify(project, token, db):
    if not token:
        print("確認: サーバー権限での確認はスキップしました（なりすまし権限なし）。動作は画面で確認してください。")
        return

    def can_read(database):
        try:
            req("GET", f"{docs_url(project, database)}/appointments?pageSize=1&mask.fieldPaths=__name__", token, project)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 403:
                return False
            raise

    ok_own, ok_patient = can_read(db), can_read("(default)")
    print(f"確認: 専用DB 読み取り {'可' if ok_own else '不可'} / 患者DB 読み取り {'可' if ok_patient else '不可'}")
    if not ok_own or ok_patient:
        print("想定と違います（期待: 専用DB=可, 患者DB=不可）。IAM の反映に数分かかることがあります。少し待って再実行してください。")
        sys.exit(1)
    print("OK: パスキーサーバーは患者データを読めません")


if __name__ == "__main__":
    action, project, token, db = sys.argv[1:5]
    {"rules": rules, "copy": copy, "cleanup": cleanup, "verify": verify}[action](project, token, db)
