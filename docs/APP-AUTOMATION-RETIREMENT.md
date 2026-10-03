# SOSList Local収集UIの撤去と復元（2026-10-03、隔離実装）

本変更はMacBookの現行ソース（1c81209）を複製した隔離ブランチ上の実装です。本番ソース、インストール済みアプリ、Mini、Portalには反映していません。

## 比較と採用案

| 案 | 実行経路 | 復帰作業 | 評価 |
| --- | --- | --- | --- |
| UIを隠すだけ | ネイティブ呼出・runnerが残る | 表示を戻す程度 | 偶発起動が残り、採用しない |
| UIと起動経路を撤去、専用コードをLegacy保持 | 本アプリから開始・再開できない | 撤去commitを逆適用し、再ビルド・mock確認 | 採用。コードと未commit監視差分を保持 |
| 専用コードを完全撤去 | 本アプリから開始・再開できない | Git/bundleから復元し、UI・ネイティブ・同梱配線の再検証 | 開発木は小さくなるが、将来復帰は履歴に依存 |

## 撤去・保持

- 撤去: QTC取得・再開・停止、追加指示・進捗、予約行取得/再開、収集AI設定の表示、controller・クリック・timer・MutationObserver・起動時状態取得、WKScriptMessageHandler登録とdispatch、専用Processの生成/起動/終了配線。
- 専用コードと旧テストは `Legacy/evidence-review/` に元の相対階層で保存。移動前のrunner未commit差分と未追跡匿名reporterも同じ内容で保存。
- `local/evidence-review/app-server.cjs` と `codex-path.cjs` はAI設定モデル一覧の共有依存。フォルダ全体ではなくこの2本だけを同梱。これらは旧収集runnerを起動しない。
- 保持: 予約一覧・再接続・検索・結果待ち、PDF/資料閲覧、手動Claim詳細・メモ保存、紹介状作成/保存/印刷、手動DBQ受渡し、Invoice、Summary、XR/CD、Audiogram、カナ、音声/TTS等。CD自動取込は要求外の既存機能として保持し、この検証では本番アプリを起動しない。
- `~/.codex/skills/qtc-evidence-review`、`qtc-dbq-entry`、共有chat protocol/checkpoint helperは保持。EvidenceReviewの患者記録・旧checkpoint・設定・認証はアクセス/削除/移行しない。

## 再現・復元

撤去前の追跡ソースは `1c81209`。移動前の既存差分を隔離repoの `8865da4` に保存。本作業の成果commitだけを `git revert <retirement-commit>` すればWIPを含む収集コード・元の配線が戻る。現行repoをreset/cleanしない。

復元用bundle（作業フォルダ `backups/soslist-before.bundle`）と、既存差分patch/匿名reporterコピーを保存し `git bundle verify` 済み。成果bundleにもWIPと撤去commitを含める。Legacyはそのまま実行するための別runnerではなく復元資料。共有依存は元の場所にあり、Legacyのテストは復元してから元のテスト経路で実行する。

本番ソースへの適用は差分の `git apply --check` を先に実行し、変更が増えていれば再照合する。アプリ配布/導入/Mini反映は別工程。旧アプリの実行途中のtaskを停止・移行する工程は含まない。

検証の実結果と環境制限は作業フォルダ `RETIREMENT-REPORT.md` と `validation/` のログを参照。

## Claim詳細の通常AX改善（追加依頼）

Claimモーダルにdialog/titleのARIA属性と「Claim詳細本文」の通常ラベルを付け、開くと本文へフォーカス、閉じる/保存すると接続中の元要素へ戻す。本文は既存textarea.valueのままで、隠れた取得API、テキスト複製、clipboard/TextEdit依存は追加しない。

実コードのモーダルと開閉/保存関数だけを非永続WKWebViewへ載せた、ネットワーク・本番native bridgeのない合成GUIで確認。改善前後とも長いUnicode全文の通常AX取得・編集・選択・保存再表示は一致した。改善後はラベル、開いた直後の本文フォーカス、保存後の元要素フォーカスも確認。保存先は合成in-memory transactionであり、患者データ/Firebaseや既存CUA toolのsnapshot取得を検証したものではない。元の「Claim全文が取れない」症状はこの隔離環境では再現せず、全面的解消を主張しない。
