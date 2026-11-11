#!/bin/zsh
# firestore.rules / storage.rules を本番へ反映する（firebase CLI不要、gcloudの認証を使用）
set -euo pipefail
cd "${0:A:h}/.."
P=sos-list-4d150
T=$(gcloud auth print-access-token)
api() { curl -fsS -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "content-type: application/json" "$@"; }
deploy() { # $1=rules file, $2=release name
  local body name
  body=$(python3 -c 'import json,sys;print(json.dumps({"source":{"files":[{"name":sys.argv[1],"content":open(sys.argv[1]).read()}]}}))' "$1")
  name=$(api -X POST "https://firebaserules.googleapis.com/v1/projects/$P/rulesets" -d "$body" | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])')
  api -X PATCH "https://firebaserules.googleapis.com/v1/projects/$P/releases/$2" \
    -d "{\"release\":{\"name\":\"projects/$P/releases/$2\",\"rulesetName\":\"$name\"}}" >/dev/null
  echo "$2 -> $name"
}
deploy firestore.rules cloud.firestore
deploy storage.rules firebase.storage/sos-list-4d150.firebasestorage.app
