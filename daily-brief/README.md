# daily-brief — 予約の要約 & ポッドキャスト生成ミニアプリ

日付を入れて「作成」ボタンを押すと、その日(JST)の予約を Firestore から取得し、
検査内容(`services`)・Claim詳細(`claimDetail`)・メモ(`notes`)を判定ルールに沿って要約。
日本語テキストのブリーフと、**二人対話形式のポッドキャスト音声(約1.4倍速)**を生成し、
ブラウザ上で表示・再生できます。

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
> SOSList Localの手動作成・定時作成、手動取り込み用プロンプト、API生成・台本再生成に共通のルールです。作成済みサマリーに反映するには、対象日を指定して再作成してください。
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

既定の要約モデルは Anthropic の `claude-sonnet-5` です。
必要に応じて `.env` で `LLM_PROVIDER`、`PODCAST_MODEL`、`PODCAST_FALLBACK_MODEL` を上書きできます。

---

## 使い方(ミニアプリ)

```bash
bash run-app.sh             # ローカルサーバ起動 (npm run serve でも可)
```

ブラウザで **http://127.0.0.1:8790/** を開く → 日付を選んで「作成」。
生成後、画面で要約が表示され、音声プレーヤーで再生できます(右クリックで保存可)。

mp3 が完成すると Firebase Storage に `daily-brief/<YYYY-MM-DD>/podcast.mp3` としてアップロードされます。
Storage には対象日が新しい2件だけを残し、cloud viewer の Summary からログイン済みユーザーが再生できます。

- 「音声なし」にチェックするとテキストのみを高速生成。
- 「サンプルデータで試す」で Firestore に接続せず動作確認。
- 終了は Ctrl+C。

> 定期(自動)実行は行いません。必要なときに作成ボタンで生成する方式です。

---

## 出力

`output/<YYYY-MM-DD>/` に保存されます。

| ファイル | 内容 |
|---|---|
| `brief.md` | 日本語テキストの要約(時刻順・分類・IMO要否・確認項目) |
| `podcast.mp3` / `podcast.wav` | 二人対話のポッドキャスト音声(約1.4倍速) |
| `podcast-script.txt` | 読み上げ台本(テキスト) |
| `dialogue.json` | 台本の構造化データ |
| `podcast-speech.txt` | Codexで読みを補正したAivisSpeech専用の台本 |
| `podcast-speech.json` | 読みの置換内容・検証結果・元台本に紐づくキャッシュ |

### AivisSpeechの読み補正

AivisSpeechで音声を作る前に、ChatGPT認証のCodex CLIが、一般語・医学用語・英語・略語・単位記号の読みを文脈に合わせて仮名に変換します。手動・定時・取り込み・API生成の共通音声処理に適用されます。`--no-audio` では呼び出しません。

全文を書き直させず、元の発話に一致する語句の読みだけを置換します。数字、左右、否定・陰性・陽性・未確認・疑いなどの保護対象と重なる置換、不正な位置、重複する置換は採用せず、その部分の原文を残します。`brief.md`、`podcast-script.txt`、`dialogue.json` は変更しません。これは内容変更を抑える検証であり、読みの正しさを完全に保証するものではありません。

同じ台本・設定の再生成では変換結果を再利用します。台本やモデルを変えると再変換します。読みを再試行したい場合は対象日の `podcast-speech.json` を削除します。Codexの起動・認証・接続・タイムアウトなどで変換できない場合は処理をエラーで止め、既存音声は削除しません。過去のMP3は自動的には変更されません。

既定モデルは `gpt-6-sol`、待ち時間の上限は5分です。`PODCAST_SPEECH_MODEL`、`PODCAST_SPEECH_TIMEOUT_MS`、`PODCAST_SPEECH_CODEX_BIN` で変更できます。APIキーは渡さず、既存のCodexログインを使います。台本は標準入力で渡し、作業用ディレクトリは処理後に削除します。

CLI連携は [Codex公式の非対話モード・構造化出力仕様](https://developers.openai.com/codex/noninteractive/) に基づきます。

---

## コマンドライン(任意)

```bash
node generate-brief.js                  # 翌日分
node generate-brief.js --date 2026-06-05  # 指定日
node generate-brief.js --no-audio       # テキストのみ
node generate-brief.js --sample         # 擬似データ
node generate-brief.js --finalize-manual --date 2026-06-05
npm run sync-audio                       # 既存mp3のうち新しい2件をFirebase Storageへ同期
```

- `--finalize-manual` は、`output/<YYYY-MM-DD>/brief.md` と `podcast-script.txt` を前提に、mp3 作成・Firestore 保存を行います。
- `sync-audio` はローカルの出力先から日付が新しい `podcast.mp3` を2件だけ選び、Firebase Storageへアップロードします。Storage 上も最新2件以外の音声を削除します。

主な環境変数(`.env`):
`ANTHROPIC_API_KEY`(必須) / `OPENAI_API_KEY`(OpenAIモデルまたはOpenAI TTS使用時) / `GOOGLE_APPLICATION_CREDENTIALS`(必須) /
`PODCAST_SPEED`(再生速度・既定 1.4) / `PODCAST_MINUTES`(台本の目安尺・既定 12) /
`PODCAST_AUDIO_ENGINE`(既定 `aivis`) / `AIVIS_ENGINE_URL`(既定 `http://127.0.0.1:10101`) /
`AIVIS_STYLE_ID_A`(既定 `1937616896`, にせ) / `AIVIS_STYLE_ID_B`(既定 `1388823424`, 凛音エル) /
`SAY_VOICE_A`(say 利用時。既定 `Kyoko`) / `SAY_VOICE_B`(say 利用時。既定 `Reed (日本語（日本）)`) /
`TTS_MODEL` `TTS_VOICE_A` `TTS_VOICE_B`(OpenAI TTS に戻す場合) /
`LLM_PROVIDER`(既定 `anthropic`) / `PODCAST_MODEL`(既定 `claude-sonnet-5`) / `PODCAST_FALLBACK_MODEL` / `ANTHROPIC_EFFORT`(既定 `medium`) / `PODCAST_GENERATION_MAX_ATTEMPTS`(既定 `1`) / `FIREBASE_STORAGE_BUCKET` / `PORT`(既定 8790)。

> ヒント: 1.4倍速だと再生時間は台本尺の約7割になります。長めにしたい場合は `PODCAST_MINUTES` を増やしてください。
