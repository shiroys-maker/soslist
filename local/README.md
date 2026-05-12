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

Build and run:

```bash
cd local/mac-app
./script/build_and_run.sh
```
