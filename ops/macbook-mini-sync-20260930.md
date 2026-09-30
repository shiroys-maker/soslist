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

両端末ともChatGPT同梱CLIのラッパー
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` を優先する。
取得・Summary・読み変換・PDF取り込み・画像読影・氏名変換で共通の検出規則を使い、
実行可能な明示overrideは保持する。既定の旧配置が消えた場合は現配置へ再検出する。
認証情報・患者ファイル・Evidence Review復旧状態は同期しない。
QTC HTMLはMac miniから丸ごとコピーせず、既存のMacBookファイルに管理済みinstallerを適用する。

ソースとアプリの復元には今回以前のGitコミットとCodeBackupの既存世代を利用する。
QTC実配置の直前コピーはMacBook内の `/private/tmp/soslist-macbook-before-sync` に保存した。
これは一時的なローカル補助コピーであり、恒久バックアップとして扱わない。

検証は合成データを用いる。実患者のEvidence Review・Summary生成を実行して確認したという意味ではない。

## Mac miniの更新

利用者の指示により、Mac miniの未コミット変更はAppSyncのmanual-backupsへGit bundleとstashで退避してから、SOSList関連4リポジトリをMacBookの管理済みコミットへ揃える。他のアプリの未コミット変更には適用しない。以後は通常の一方向同期を継続する。
