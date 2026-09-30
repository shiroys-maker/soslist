# SOSList Local: Mac miniからMacBookへの例外同期

2026-09-30、Mac miniで更新されたSOSList関連のソースをMacBookへ取り込んだ。
以後の更新元はMacBook。既存のMacBook → Mac miniの一方向同期を維持する。
AppSyncのsender/receiver設定は変更しない。

## 取り込み範囲

- Mac miniのコミット `165491c` までの履歴（Evidence Reviewの復旧・同じsessionでの再開・追加指示・予約行の再開操作）。
- 同機の未コミット更新（AUD、音声の読み変換、氏名カナ変換、旧API生成・非Gemini音声・旧watcherの整理）。
- 実稼働Importer `~/soslist/openai-processor` の抽出・再分類モデル変更。
- `~/bin` のヘルパーとQTCサーバー、`~/Documents/QTC_server` のImageReport更新・旧紹介状HTML廃止。

| 処理 | モデル | reasoning |
|---|---|---|
| Evidence Review / XR・CD / Summaryと台本 | gpt-6-astra | high |
| AUD | gpt-6.1-sol | high |
| PDF抽出・再分類 / 音声用読み変換 | gpt-6.1-sol | medium |
| 氏名カナ変換 | gpt-6-luna | low |
| 音声合成 | gemini-3.8-flash-tts | Gemini設定 |

## 端末固有の反映

MacBookのChatGPT同梱CLIは
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`。
旧配置とMac miniの `~/.local/bin/codex` の両方を検出候補に含める。
認証情報・患者ファイル・Evidence Review復旧状態は同期しない。
QTC HTMLはMac miniから丸ごとコピーせず、既存のMacBookファイルに管理済みinstallerを適用する。

ソースとアプリの復元には今回以前のGitコミットとCodeBackupの既存世代を利用する。
QTC実配置の直前コピーはMacBook内の `/private/tmp/soslist-macbook-before-sync` に保存した。
これは一時的なローカル補助コピーであり、恒久バックアップとして扱わない。

検証は合成データを用いる。実患者のEvidence Review・Summary生成を実行して確認したという意味ではない。
