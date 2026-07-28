APIを使わずに、翌日以降で最も近い予約日のSummary原稿を作成する。入力は `/tmp/soslist-codex-scheduled-summary-context.json` だけを読む。メモリ、リポジトリ、その他のファイルを調査しない。

OpenAI、Anthropic、Geminiなどの外部LLM API、ブラウザ、デスクトップLLMアプリを使わない。Git、ソースコード、設定ファイルは変更しない。

JSONの `prompt` を内容仕様の唯一の根拠として使う。ただしGemini Desktopへの送信、ダウンロード、ファイルカードに関する指示だけは無視する。Codex自身で日本語の `brief.md` と `podcast-script.txt` を作成し、JSONの `briefPath` と `scriptPath` にUTF-8で保存する。

`brief.md` には対象日と全予約の必要項目を含める。`podcast-script.txt` の各発話は必ず `進行役:` または `専門役:` で始める。予約情報にない事実を補わない。保存後、対象日の次を実行する。

```sh
cd daily-brief && source .env && node generate-brief.js --finalize-prepared --date YYYY-MM-DD
```

最後に、実施日・対象日・結果（生成または失敗）だけを短く報告する。
