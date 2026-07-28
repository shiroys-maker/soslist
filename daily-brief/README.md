# daily-brief — 予約の要約 & ポッドキャスト生成ミニアプリ

日付を入れて「作成」ボタンを押すと、その日(JST)の予約を Firestore から取得し、
検査内容(`services`)とメモ(`notes`)を判定ルールに沿って要約。
日本語テキストのブリーフと、**二人対話形式のポッドキャスト音声(約1.4倍速)**を生成し、
ブラウザ上で表示・再生できます。

データは Firebase(Firestore)にあるため、この処理は **あなたの Mac 上の Node**で動かします
(`openai-processor` と同じ構成・同じ認証情報)。

---

## 判定ルール(スクリプトに内蔵)

1. **Audiology**(検査内容に Audiologist Examination 等): メモに特記が無ければ詳細不要。
2. **Audiology 以外**
   - **SHA**(検査内容に「SHA / 退役前検査」= 現役 veteran): 初回検査・**IMO不要**。
   - **SHA 以外**
     - **Service connected の follow up**: **IMO不要**。前回からの診断(評価)変化=悪化/改善が焦点。
     - **それ以外**(過去に reject / 初回 claim): **IMO必要**。

> claim 内容と IMO の要否は「予約詳細」の**メモ欄の先頭**に書かれている前提で、notes を最優先の根拠にします。
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
