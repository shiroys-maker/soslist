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
