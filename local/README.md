ローカル専用版です。

- 公開中のルート版 `index.html` / `script.js` / `style.css` とは分離しています。
- 今後ローカル専用機能を追加する場合は、この `local/` 配下だけ変更してください。
- 起動用 AppleScript は `local/launch-local.applescript` です。
- local 版は cloud 版と Chrome 上で分離するため `http://127.0.0.1:8787/local/index.html` を使います。
- アプリ化する場合はこれを `.app` にして `http://127.0.0.1:8787/local/index.html` を Chrome の app モードで開きます。
- Claude APIキーは `local/config.js` を使います。
## macOS app

`local/mac-app/` contains a standalone macOS wrapper app for the local-only UI.
It opens `http://localhost:8787/local/index.html` in a native `WKWebView`, so it
appears as its own app in Dock/u-Bar instead of as a Chrome window.

### Summary flow

- `作成` is handled only by the native app.
- The app runs `daily-brief/generate-brief.js` directly for the selected date.
- `brief.md` and `podcast-script.txt` are generated through the API flow already used by `daily-brief`.
- Audio is synthesized automatically through the configured local engine, currently AivisSpeech.
- Progress is pushed back to the main local viewer while the job runs.
- `表示` still opens the existing Summary only.

Build and run:

```bash
cd local/mac-app
./script/build_and_run.sh
```
