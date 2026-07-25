# openai-processor — PDF取り込みウォッチャー

Dropboxの `~/Library/CloudStorage/Dropbox/VA/SOSPDF` を監視し、
新しい予約PDFを `pdf-parse` + GPT-4o で解析して Firestore の
`appointments` コレクションに登録、PDF本体を Cloud Storage の
`uploads/<ファイル名>` にアップロードする常駐プロセス。

## セットアップ

```bash
cd openai-processor
npm install
cp .env.example .env   # OPENAI_API_KEY と GOOGLE_APPLICATION_CREDENTIALS を設定
```

## 常駐起動（launchd）

```bash
cp ../ops/launchd/jp.niraissc.soslist.openai-processor.plist ~/Library/LaunchAgents/
mkdir -p ~/Library/Logs/soslist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.niraissc.soslist.openai-processor.plist
```

- node のパスは plist 内にハードコードされている。nvm で node を更新したら
  plist の `ProgramArguments` も更新して `launchctl kickstart -k gui/$(id -u)/jp.niraissc.soslist.openai-processor` する。
- ログ: `~/Library/Logs/soslist/openai-processor.log` / `.error.log`
- 手動起動する場合: `npm start`

## エラー処理

- OpenAI呼び出しとStorageアップロードは3回まで指数バックオフで再試行。
- それでも失敗したファイルは `failed.log`（JSON行、git管理外）に記録され、
  監視は継続する。記録されたファイルはフォルダから一度出して戻せば再処理される。
- テキストが取れないPDF（スキャン画像のみ）はAPIを呼ばずに failed.log へ。
- 抽出結果は必須フィールド（claimantName / contractNumber / appointmentDate）と
  日付の妥当性を検証してから Firestore に書き込む。

## 補助スクリプト

- `npm run repair-pdfs` — Firestoreレコードはあるのに Storage にPDFが無い
  もの（orphan）を探し、ローカルディスクから再アップロードする。
  デフォルトはdry-run、実行は `--upload`。
