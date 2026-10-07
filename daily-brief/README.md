# daily-brief — 予約の要約 & ポッドキャスト生成ミニアプリ

日付を入れて「作成」ボタンを押すと、その日(JST)の予約を Firestore から取得し、
検査内容(`services`)・Claim詳細(`claimDetail`)・メモ(`notes`)を判定ルールに沿って要約。
日本語テキストのブリーフと、**二人対話形式のポッドキャスト音声(約1.3倍速)**を生成し、
ブラウザ上で表示・再生できます。

Summaryの前段で、設定済みSummary AIを使って予約メモから英語のEvidence Reviewを生成し、Claim詳細へ保存します。今後の生成本文はPlain Textとし、見出しは `Evidence Review` の文字のみ、本文は空行で区切った段落にします。Markdown見出し・太字・斜体・コード・箇条書き・表・Markdownリンク・HTMLは使用しません。出典URLは通常の文字列で保持します。Markdown等が返った場合は保存せず、書式だけを修正するAI再試行を最大1回行います。対象は見出し、太字・斜体、コードの囲み・字下げのみです。修正後もPlain Text検証を通し、書式用の囲みと空白以外の全文字列が元の生成本文と同じ順序で一致することを確認してから、AIが返した本文を採用します。アプリがMarkdownを自動除去して保存することはありません。数値・否定・左右・出典・URLなどの変更や削除、表・箇条書き・番号付き一覧・取消線・リンク・HTMLなどの曖昧な構造は、全件の保存前に停止し、後続Summaryにも進みません。待ち時間は初回と再試行を合わせて従来の上限20分です。ログには固定の書式分類と再試行回数のみを出し、失敗本文やメモは出しません。JSON解析エラーにも本文を含めません。これは内容を変えずに単純な書式違反から復帰するための保守的な検証です。

Claimリスト、元メモ、ER以外のClaim詳細は既存の扱いを維持します。ERの管理境界・SHA-256照合・保存後の再読取も継続し、管理用コメントは内部メタデータとして保持します。既存の管理済み `## Evidence Review` も読取可能です。既保存ERの一括書換えや自動再生成は行いません。

データは Firebase(Firestore)にあるため、この処理は **あなたの Mac 上の Node**で動かします
(`openai-processor` と同じ構成・同じ認証情報)。

---

## 判定ルール(スクリプトに内蔵)

1. **Audiology**(検査内容に Audiologist Examination 等): Claim詳細・メモのどちらにもIMO依頼や注意点が無ければ詳細不要。
2. **Audiology 以外**
   - **SHA**(検査内容に「SHA / 退役前検査」= 現役 veteran): 初回検査・**IMO不要**。
   - **SHA 以外**
     - **Service connected の follow up**: **IMO不要**。前回からの診断(評価)変化=悪化/改善が焦点。
     - **それ以外**(過去に reject / 初回 claim): **IMO必要**。

> claim・対象部位・左右・DBQ・IMO依頼は **Claim詳細** を主な情報源にし、**メモ**の病歴・補足情報と合わせてサマリーと台本に反映します。Claim詳細が空の従来予約はメモを参照し、メモが空でもClaim詳細を取り込みます。
> 重複するclaimは一つにまとめ、相違は情報源を添えて要確認とします。明記されたIMO依頼を一般的な分類ルールより優先し、未記載だけで「IMO不要」と断定しません。
> SOSList Localの手動作成・定時作成、手動取り込み用プロンプト、Codex生成に共通のルールです。作成済みサマリーに反映するには、対象日を指定して再作成してください。
> 聞き手は専門家(本人)なので、用語の基礎説明は台本に入れません。

---

## セットアップ(初回のみ)

```bash
cd /Users/shungohiroyasu/Documents/GitHub/soslist/daily-brief

npm install                 # 依存をインストール
cp .env.example .env        # ANTHROPIC_API_KEY と GOOGLE_APPLICATION_CREDENTIALS を記入
                            # (GOOGLE_APPLICATION_CREDENTIALS は openai-processor と同じ鍵でOK)
```

`ffmpeg` 推奨(mp3化と速度変更に使用): `brew install ffmpeg`

SOSList Localの手動・定時Summaryは `run-codex-summary.sh` からCodex CLIを呼び、`gpt-6-astra` / `high` を起動引数で指定します。`brief.md` と `podcast-script.txt` は同じ呼び出しで生成し、Codex共通設定の変更に影響されません。

## 閲覧サーバー

`bash run-app.sh` または `npm start` で起動し、http://127.0.0.1:8790/ から日付を選んで既存Summaryと音声を表示します。
ブラウザの作成・再生成、POST /api/generate、直接LLM API生成は廃止しました。
新規作成はSOSList Localアプリの手動・定時Codex経路のみです。表示時の既存Brief同期と音声配信は維持しています。

## 出力

`output/<YYYY-MM-DD>/` に保存されます。

| ファイル | 内容 |
|---|---|
| `brief.md` | 日本語テキストの要約(時刻順・分類・IMO要否・確認項目) |
| `podcast.mp3` / `podcast.wav` | 二人対話のポッドキャスト音声(約1.3倍速) |
| `podcast-script.txt` | 読み上げ台本(テキスト) |
| `dialogue.json` | 台本の構造化データ |
| `podcast-speech.txt` | Codexで読みを補正した音声専用の台本 |
| `podcast-speech.json` | 読みの置換内容・検証結果・元台本に紐づくキャッシュ |

Summaryは完成済み原稿の日付を確認してFirestoreへ先に保存し、本文・件数・音声状態を独立再読取で照合してから、読み変換・TTS・音声アップロードへ進みます。音声失敗時も先行保存したSummaryを保持し、以前の有効な音声メタデータは上書きしません。音声成功後に音声メタデータを保存・再読取し、最後に保持数整理を行います。

`--no-audio` は既存原稿のSummary保存だけを行い、読み変換・TTS・既存音声のupload・保持数整理を呼びません。対象日・保存済み原稿を維持した復旧には `--finalize-prepared --date YYYY-MM-DD --no-audio --skip-prune` を使用します。`--count N` で予約件数を渡せます。件数が指定されない後段再試行では保存済み件数を保持します。CLIの成功出力は日付・件数・保存状態などのメタデータのみで、Summary本文は出しません。

TTSの失敗ログはHTTP状態と固定許可リストにあるAPIエラーコード・正規化したフィールド名・理由だけを出します。キー、患者本文、生API応答、エラーmessageや任意の値はログへ出しません。JSONでない応答や未知のコードは `unclassified` とし、HTTP 400を自動再試行しません。モデル・声・台本を自動変更しません。

Googleのエラーが配列で包まれて返る形式も、同じ許可リストで診断します。HTTP 400でも理由が `API_KEY_INVALID` など既知のAPIキー関連コードの場合は、APIキー・利用権限の確認を案内します。認証情報や課金・権限設定を自動変更することはありません。

### Gemini 3.8 Flash TTS（既定）

音声は `gemini-3.8-flash-tts` で生成します。`GEMINI_API_KEY`（または `GOOGLE_API_KEY`）を `.env` に設定してください。進行役は女性の `Kore`、専門役は男性の `Alnilam`。話者と「自然で落ち着いた日本語の会話。明瞭に。」という話し方の指定を `speech_metadata` に付け、台本本文とは分けて送ります。本文の書き換えや追加説明は行いません。

二人の発話をまとめて生成し、長い台本は最大1200文字のまとまりに分割します。生成したWAVを結合して、ffmpegで1.3倍速のMP3へ変換します。Geminiでの速度変更は `PODCAST_SPEED`（0.5〜2、既定1.3）です。全区間の生成・MP3変換に成功してから音声を入れ替えるため、APIエラー時も既存音声を維持します。他モデルへの自動フォールバックはしません。

`GEMINI_TTS_MODEL`、`GEMINI_TTS_VOICE_A`、`GEMINI_TTS_VOICE_B`、`GEMINI_TTS_STYLE`、`GEMINI_TTS_TIMEOUT_MS`（区間ごと、既定240000）で調整できます。音声エンジンはGeminiのみです。旧AivisSpeech・macOS say・OpenAI TTS分岐は削除しました。

APIは [Google公式のGemini 3.8 TTS仕様](https://ai.google.dev/gemini-api/docs/speech-generation) に合わせ、Interactions APIの二話者設定・WAV出力を使用しています。キーはHTTPヘッダーに渡し、リクエストは `store: false` です。APIキー、台本、音声の生成物はGitに含めません。

### Geminiの読み補正

Geminiで音声を作る前に、ChatGPT認証のCodex CLIが、一般語・医学用語・英語・略語・単位記号の読みを文脈に合わせて仮名に変換します。手動・定時・取り込みの共通音声処理に適用されます。`--no-audio` では呼び出しません。

全文を書き直させず、元の発話に一致する語句の読みだけを置換します。数字、左右、否定・陰性・陽性・未確認・疑いなどの保護対象と重なる置換、不正な位置、重複する置換は採用せず、その部分の原文を残します。`brief.md`、`podcast-script.txt`、`dialogue.json` は変更しません。これは内容変更を抑える検証であり、読みの正しさを完全に保証するものではありません。

同じ台本・設定の再生成では変換結果を再利用します。台本やモデルを変えると再変換します。読みを再試行したい場合は対象日の `podcast-speech.json` を削除します。Codexの起動・認証・接続・タイムアウトなどで変換できない場合は処理をエラーで止め、既存音声は削除しません。過去のMP3は自動的には変更されません。

既定モデルは `gpt-6.1-sol`、待ち時間の上限は5分です。`PODCAST_SPEECH_MODEL`、`PODCAST_SPEECH_TIMEOUT_MS`、`PODCAST_SPEECH_CODEX_BIN` で変更できます。APIキーは渡さず、既存のCodexログインを使います。台本は標準入力で渡し、作業用ディレクトリは処理後に削除します。

CLI連携は [Codex公式の非対話モード・構造化出力仕様](https://developers.openai.com/codex/noninteractive/) に基づきます。

---

## コマンドライン

- `node generate-brief.js --codex-context --date YYYY-MM-DD`：手動Codex生成の入力を準備。
- `node generate-brief.js --scheduled-context`：定時Codex生成の入力を準備。
- `node generate-brief.js --finalize-prepared --date YYYY-MM-DD`：保存済み原稿からGemini音声を作成し保存・同期。
- `--finalize-manual` は同じ後段処理の互換入口。`--no-audio` はこの後段処理でSummary保存だけを行い、音声関連処理を呼びません。
- `npm run sync-audio`：既存音声の同期。
- Storageの古い音声を削除せず処理する場合は `run-codex-summary.sh --date YYYY-MM-DD --skip-prune`。Summary／Evidence Review保存／Podcast／Gemini音声／Storage uploadは通常どおり実行し、Storageの保持数整理だけを省略します。`--finalize-prepared`、`--finalize-manual`、`--no-audio`併用（音声関連処理を省略）、`node generate-brief.js --sync-audio --skip-prune`、`npm run sync-audio -- --skip-prune`でも利用できます。定時wrapperへの明示指定も後段へ引き継ぎます。flagなしの保持数2件は変更しません。対象日の既存音声へのuploadは通常どおり上書きするため、再生成前のbackupは必要です。
- 引数なし／旧API生成オプションのみではエラー終了し、生成しません。

必要な設定はFirebase認証、Gemini音声設定、Codex読み変換設定です。
`PODCAST_MINUTES`、`PODCAST_SPEED`、`OUTPUT_DIR`、`PORT` は引き続き使用します。
旧provider・API生成モデル・fallback設定は読み取りません。既存の秘密値を含む `.env` は変更していません。
