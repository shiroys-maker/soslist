# local/ — ローカル専用版

Web版（公開サイト `soslist.niraissc.jp` = ルートの `index.html` / `script.js`）とは別の、
編集機能つきローカル専用UI。共通ロジックは `../shared/core.js` にあり、
ここには ローカル固有のUI・ネイティブブリッジ・編集機能だけを置く。

- 通常の使い方は `SOSList Local.app`（下記のmacOSアプリ）。ブラウザで使う場合は
  リポジトリルートから `python3 -m http.server 8123` などで配信し
  `http://127.0.0.1:8123/local/index.html` を開く（`file://` 直開きはFirebase認証不可）。
- `details.html` / `details.js` は予約詳細の別ウィンドウ。ネイティブアプリでは
  `saveDetails` ブリッジ経由で保存し、ブラウザ配信時は localStorage の
  storageイベントでメインウィンドウに保存を依頼する。

## macOS app（SOSList Local.app）

`local/mac-app/` がラッパーアプリ本体。バンドル内にコピーした
`local/` + `shared/` を `file://` の WKWebView で表示する（サーバー不要）。

ビルドとインストール:

```bash
cd local/mac-app
./script/build_and_run.sh            # ビルドして起動（build/dist/ 内）
./script/build_and_run.sh --install  # /Applications へ入れ替え
```

- バンドルは**ビルド時のスナップショット**。`local/` や `shared/` を変更したら
  `--install` で再ビルドしないとアプリに反映されない。
- ビルドSHAは Info.plist の `SOSListBuildSHA` に刻印される
  （`/usr/libexec/PlistBuddy -c "Print :SOSListBuildSHA" "/Applications/SOSList Local.app/Contents/Info.plist"` で確認）。

### Summary flow

- `作成` is handled only by the native app.
- The app runs `daily-brief/generate-brief.js` directly for the selected date.
- `brief.md` and `podcast-script.txt` are generated through the API flow already used by `daily-brief`.
- Audio is synthesized automatically through the configured local engine, currently AivisSpeech.
- Progress is pushed back to the main local viewer while the job runs.
- `表示` still opens the existing Summary only.

### Connection recovery

Local-only `connection.js` displays server/cache/offline state and last server receipt time. Startup date lookup falls back to today after 8 seconds; a late result cannot replace the selected date. A listener waiting 15 seconds retries with exponential backoff (at most five automatic retries). Terminal permission/auth/query errors require user action. Online/foreground return and the Reconnect button recreate the listener without reloading the page or discarding detail edits. An idle listener is not considered broken merely because no appointments changed.

The diagnostic log stores at most 200 timestamp/event/error-code entries in localStorage, without appointment data or raw error messages. “診断ログ保存” exports JSON using the native save panel. These changes do not address a blocked WebKit UI thread.

Run recovery regression checks: `node --test local/tests/connection.test.cjs`.

### Claim詳細

検査内容の文字または「Claim詳細」をクリックすると、大きなClaim detail編集画面が開く。
`appointments.claimDetail` は改行を保持した文字列。検査内容 `services` はService Bill由来の表示専用で、ここでは変更しない。
保存はトランザクションで同時編集を検出し、失敗時は入力を保持する。メモ `notes` は従来どおり独立。

既存データの移行は `ops/migrate-claim-detail.cjs` を使用する（既定対象: 予約日2026-09-15 JST以降）。
`--preview PRIVATE_PLAN_PATH FIREBASE_ADMIN_MODULE_PATH` で私有領域へ変更前全データと計画を保存し、
同じ引数の `--apply` で対象不変確認・原子的更新・全件再読込検証を実行する。
検査名の括弧は維持し、DBQ/Opinionラベルの直後にある末尾のClaim括弧のみ移す。
計画・バックアップには個人情報を含むためリポジトリに置かない。
