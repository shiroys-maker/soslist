# SOSList クラウド版のセキュリティ更新計画

> 実行担当者向け：実装の承認後に `superpowers:executing-plans` を使い、下記のチェック項目を順番に実行する。承認済みの実施順は「1. ダミーサイト作成 → 2. 本人登録・検証 → 3. 全員登録・検証 → 4. 本番移植」。第一段階の分離ソース・ダミーデータ・エミュレータ試験を実施する。外部環境作成・Google認証有効化・公開・本番移植は具体的変更の承認後に行う。

**Goal:** クラウド版SOSListの利用者を個人単位で認証・認可し、ネット経由の無許可閲覧・編集と共有端末のセッション残留を抑える。

**Architecture:** 先にFirebaseのUID・有効状態の許可一覧でデータ境界を制限し、その後クラウド版に個人Googleログインを追加する。Localの既存ログインとバッチの正規接続は維持し、共有するFirestore・Storageのルール変更は互換性試験を通して段階配備する。公開サイトの入口保護は追加層とし、Firebaseへの直接アクセスの認可を代替させない。

**Tech Stack:** GitHub PagesでホスティングしCloudflareを経由する公開サイト（利用者本人の確認）、Firebase Auth、Firestore、Cloud Storage、Web版JavaScript、LocalのWKWebView、既存Firebase Admin SDK。現Web SDKは9.6.1 compat、確認に使用した既存Admin SDKは12.7.0。

**Spec:** この文書の「依頼と対象範囲」が実行時の仕様。作成日2026-10-10。2026-10-10追記：利用者が第一段階のダミーサイト作成を承認した。本番・Local・バッチ・既存認証設定は変更しない。

## 短い概要

1. 登録済みメンバーだけがデータへアクセスできるようにする。
2. クラウド版は個人Googleアカウントでログインし、本人のiPhoneのパスキーを使う。
3. Windows・共有Androidでは本人のiPhoneによるQR認証を候補とし、実機で確認する。
4. 共有Androidには個人パスキーを保存せず、交代時のサインアウトと画面消去を用意する。
5. PDF・音声の取得経路、配備済みFunctions、既存リンク、入口保護を順に確認して塞ぐ。

Localへの追加ログイン・常時MFA、Mac mini本体、Jump Desktopは対象外。クラウド認可強化でLocalやPDF取込・Summary処理が停止しないことを配備条件とする。

## 依頼と対象範囲

対象は `https://soslist.niraissc.jp` のネット経由の利用と、その利用を許可するFirebaseのデータ境界。利用者は個人iPhone、Windows PC、共有Android（AQUOSの可能性あり）を想定する。端末名・OS・ブラウザは実行前に利用者へ確認する。

対象外はLocalの追加認証UI、Localの自動ログアウト変更、miniのOS強化、Jump Desktop設定、証明書・アカウントの一括発行。患者情報の修正、紹介先判定、DBQ・ScreenCap・QTC作業、スキル同期も行わない。

LocalとWebは同じFirebase Auth・Firestore・Storageを使う。したがってルール変更はクラウド版だけの画面修正では終わらない。Localの現在の認証経路・UID、Admin SDKバッチの正規接続、PDF・Summaryの取得を個別に互換性確認する。

## Global Constraints

- 現在の実施範囲は本番から分離したダミーサイトのソース・合成データ・ローカル試験。本番設定・コード・アカウント・権限・Local・バッチ・OSは変更しない。新規外部プロジェクトの費用・公開先・OAuth・永続アクセス設定は具体的承認を先に得る。
- 患者資料、パスワード、Cookie、トークン、秘密鍵を読まない。患者本文をテスト・一般ログ・外部サービスへ渡さない。
- 実装時も既存の正規管理経路を使う。端末へ広い管理者権限のサービスアカウント秘密鍵を新配置しない。
- Googleを有効にする前にデータの許可一覧を配備する。Googleログインの成功だけで利用を許可しない。
- Localの既存UID・ログイン・処理を維持する。Firebaseのメール＋パスワード方式を全体で一括停止しない。
- 共用アカウントを個人別監査可能とみなさない。端末PINや端末証明書を操作者本人の認証とみなさない。
- パスキーの同期があるため「登録スマホ1台だけ」を保証しない。Googleの既存セッションでは毎回パスキー入力になるとは保証しない。
- 本番配備・利用者権限設定・本人のGoogleリンク・旧ログイン経路の終了・リンク無効化は、それぞれ具体的な結果を提示して別途承認を得る。

## Review Focus

1. Google未登録メンバーがログインできてもデータを読めないこと。段階2・3の拒否試験で確認する。
2. 許可一覧やStorage変更後もLocalとAdmin SDKバッチが停止しないこと。段階1・2・5・6で確認する。
3. 共有Androidで前任者のログイン・表示・非同期応答が次の操作者へ残らないこと。段階4で確認する。
4. UIDリンクの衝突・Google取消し・スマホ紛失が管理者ロックアウトやデータ移動を起こさないこと。段階3・6で確認する。
5. メンバー停止後に旧IDトークン・取得済みURL・キャッシュがどこまで使えるかを区別すること。段階2・5・6で確認する。

## 現状の確認結果

2026-10-10の既存調査を再利用した。これは不正アクセスの実証ではなく、コード・配備済み設定・公開HTTP応答の確認である。

| 項目 | 確認済みの事実 | 設計への影響 |
| --- | --- | --- |
| ログイン | Web・Localともメール＋パスワード。クラウド設定もパスワード必須。MFA無効、標準IdP・OIDC・SAML登録0件 | Google追加と利用者移行が必要 |
| Firestore | `appointments`は認証済み全員が読取り可。書込みは認証済みから特定メールアカウント1件を除外。UID許可一覧・役割条件なし | UIだけでなくデータ境界を先に変更する |
| Storage | 配備済みは全パスで認証済み全員に読書き許可。主ソースは読取りのみ・クライアント書込み禁止 | 配備差分を明示して是正する。既存処理を先に確認する |
| セッション | Web・Localとも自動ログアウト関数が空。認証保存方式の明示指定なし | クラウド版だけに共有端末用セッション制御を追加する |
| 公開サイト | 本人確認ではGitHubホスティング＋先日からCloudflare経由。既存調査ではCloudflare nameserver・GitHub向けCNAME、HEAD 200・GitHub応答・その要求ではAccessへの誘導なし | 応答だけでDNSのみ／proxyなし／保護なしとは断定しない。DNS・proxy・Access・WAF実設定を別途確認する |
| Firebase Hosting | サイト登録あり。既定URLは404 | 移行先・別入口として稼働しているとは断定しない |
| データ取得 | WebがFirebase SDKへ直接接続。PDFは`getDownloadURL()`を使用 | API・取得リンク側も認可／失効を設計する |
| Local・バッチ | Localは同じFirebaseクライアント。取込・Summaryソースには既存Admin SDK経路がある | クライアントRulesとサーバーIAMを分けて扱う |

未確認：正規利用者のUIDと既存Localとの認証境界、共用アカウントの有無、配備済みFunctions・Cloud Run等の全HTTP経路とIAM、バケットIAM・CORS、App Checkのクラウド設定、既存PDF／音声リンクの期限・配布状況、CloudflareのDNSレコード・proxy・Access・WAF・cache実設定、対象端末の実際のセッション状態、実機GoogleログインのQRフロー、Local／バッチの全実行時資格情報の方式。秘密値を読むことはこれらの確認方法に含めない。

Cloudflare経由という本人の説明を構成の前提とする。既存のHEADでCloudflareヘッダーがなかったことやGitHubのServer値は、その一要求で観測した事実に留める。Cloudflare全体の設定や保護の有無をこれだけで判断しない。

## 推奨する認証と認可

### 個人Googleログイン

クラウド版は各利用者本人のGoogleアカウントでログインし、Google側に登録した個人iPhoneのパスキーを利用する。Googleログインは身元確認、SOSListのUID許可一覧はデータ利用の許可として分ける。

Windowsでスマホのパスキーを使うQRフローはGoogleの公式手順にある。共有Androidから個人iPhoneを使う組合せは機種・ブラウザによって確認が必要で、成功を配備前提にしない。Google側の既存セッションで再入力が省略される場合もある。Googleアカウントの回復方法やパスキー同期までSOSListが制御できるとは扱わない。[Googleの公式手順](https://support.google.com/accounts/answer/13548313?hl=en)

共有Androidに本人のGoogleアカウントやパスキーを常設しない。QRフローが使えない場合は個人別FIDO2キーまたは個人端末での利用を候補とし、機器購入・配布は別承認。共有PINだけでの本人確認は採用しない。

### UID許可一覧と全員共通のクラウド権限

新しい管理コレクション `securityMembers/{uid}` を設計する。アプリからメンバー作成・変更・一覧取得は許可せず、自分自身の権限状態だけを読めるようにする。管理は既存の正規管理経路で行う。実際のUID・メール対応表はリポジトリへ入れない。

クラウド全員の編集範囲は利用者が確定済みで、本人ごとの閲覧専用／編集役割の選択は求めない。権限契約は `active`（有効／停止）、`webEnabled`（クラウド利用可否）、`webProviders`（許可認証方式）、`validAfterSeconds`（古い認証セッション拒否基準）とする。Local互換性に必要な権限はこの一般Web権限へ混ぜず、棚卸で確定した信頼できる認証境界に結び付ける。実UIDは私有管理とする。

`active=false`、全体の認証時刻基準、UID単位のtoken失効は同じUIDのLocalにも影響する。通常のWeb停止と緊急停止を分ける。`webEnabled=false`でGoogle経路を止めても、残したLocal password経路のネット利用を防いだとは扱わない。

| 利用主体 | Firestore | Storage | 制限 |
| --- | --- | --- | --- |
| 未認証・非会員・停止済み | 拒否 | 拒否 | Google成功だけでは許可しない |
| クラウド正規メンバー全員 | 許可読取り＋受診日時・来院・受診・完了のみ更新 | 必要文書・音声の読取り | その他の更新・予約作成／削除・紹介先追加・アップロードは禁止 |
| 既存Local利用 | 現在必要な読書きを維持 | 現在必要な取得を維持 | 信頼できる認証境界の確定と互換性試験が必要。追加ログインなし |
| 既存Admin SDKバッチ | 現在のIAMで必要処理 | 現在のIAMで必要処理 | Rulesを迂回する正規サーバーIAMで管理 |

既存保存処理を確認した対応は次のとおり。`shared/core.js`の`saveVisitDate`・`toggleAppointmentStatus`、`script.js`のイベント処理が根拠。公開版との最終照合は配備前に行う。

| 許可操作 | 保存フィールド | 型・範囲 |
| --- | --- | --- |
| 来院 | `isShown` | boolean |
| 受診・完了（従来単一状態） | `isReceived`、`isCompleted` | boolean |
| 受診日時（従来単一日時） | `visitDate` | 現保存形式 `MM/DD HH:mm` のstring。実在月日・時刻を検証 |
| 紹介先別受診・完了 | `referrals.<既存紹介先>.isReceived`、`.isCompleted` | boolean。既存紹介先のみ |
| 紹介先別受診日時 | `referrals.<既存紹介先>.visitDate` | 同形式string。現UIで日時を持つASBO・KIN・ANSHINのみ。LABの日時は許可しない |

`appointmentDateTime`（予約日時）は`visitDate`と別フィールドであり、今回の受診日時許可へ含めない。現ソースにある電話・予約日時・年齢色等の別書込みハンドラは、UIの表示状態にかかわらずクラウドRulesで拒否する。検査・CPT・Claim・メモ・紹介状本文・紹介先判定を変更しない。

サーバーは変更キーを厳密に制限する。Firestoreの`changedKeys()`だけでは追加／削除を拾わないため、トップレベルと紹介先の各mapの`affectedKeys()`も使い、許可外の変更・追加・削除を拒否する。トップレベルの`referrals`を丸ごと許可する粗いwhitelistは不可。既存mapの紹介先キー集合を保持し、各既存紹介先内では上表のキーだけ変更でき、本文・identity・routing・未知キーの変更を拒否する。状態／日時の初回入力による許可キーの追加は認めるが、紹介先map新設・削除、許可キー削除、空の日時への解除は現UIにないため許可しない。型・月日・時刻・認証状態をサーバーでも検証する。

FirestoreのクライアントRulesでUID・有効状態・認証方式・全員共通の更新フィールドを確認する。Storageも同じ会員状態を参照し、非会員と停止済みを拒否する。Storage RulesからFirestore参照を使う場合の連携権限は、変更内容を提示して承認する。[Firestore条件](https://firebase.google.com/docs/firestore/security/rules-conditions)、[StorageのFirestore参照](https://firebase.google.com/docs/storage/security/rules-conditions)

失効はUI表示やcustom claimsの更新だけに依存させない。許可一覧の`active`と認証時刻の基準をデータ境界で確認し、管理側でrefresh token失効も行う設計とする。既存IDトークンは短期でも有効期間があるため、「失効APIを呼んだ瞬間、全データが消える」と説明しない。[Firebaseのセッション管理](https://firebase.google.com/docs/auth/admin/manage-sessions)

### Localを維持する際の限界

Firebase Rulesは「このパスワード認証はLocalアプリから来た」とは識別できない。同じUID・同じ認証方式ならWebやAPIからも使える。既存Localのパスワード経路を維持する例外は、端末内だけのアクセス保証にはならない。

本番移植前の未確定事項は、Localの広い編集をどの信頼できる認証境界で一般Webの限定編集から分けるか。同じUID・同じ権限の場合、画面非表示、Origin、任意のclientMode値や自己申告claimでは分離できない。既存の別Local UID／確認済み認証方式が使えるかを先に棚卸する。方式だけの例外もネットから使える限界があるため、Local専用の端末保証とは説明しない。別バックエンド等が必要なら、Localの追加ログインなしで維持できる最小案を別承認に出す。境界が確定しないまま本番に広いLocal例外を配備しない。ダミーサイトはLocal例外を一切持たない。

Admin SDKはクライアントRulesを経由しないため、Rulesの会員確認をバッチへそのまま適用しない。既存正規認証とIAMを維持し、未確認の実行主体へ広い権限を追加して解決しない。[公式の境界説明](https://firebase.google.com/docs/firestore/security/rules-conditions)

## 変更対象ファイルと責務

以下は本番移植時の予定。第一段階は作業フォルダの独立した `soslist-security-sandbox/` に作成し、下記本番ファイルは変更しない。

| ファイル | 予定する責務 |
| --- | --- |
| `firestore.rules` | UID許可一覧、共通の限定更新項目、会員管理・監査コレクションのクライアント書込み禁止 |
| `storage.rules` | 会員の必要パス読取り、クライアント書込み禁止、停止・認証時刻の確認 |
| `index.html`、`script.js` | WebだけのGoogleログイン・本人切替・共通の限定操作表示 |
| 新規 `web-security/session.js` | Web専用の認証保存、無操作／交代時のサインアウト、残留画面・非同期処理の破棄 |
| 新規 `web-security/membership.js` | 自分の会員状態を監視し、停止・権限変更時にWeb画面を閉じる。Rulesの代替にはしない |
| 新規 `web-security/pdf-source.js` | 長期URLを表示へ渡さないWeb専用の認証付き文書バイト取得 |
| `shared/pdf-viewer.js` | URL入力の既存Local互換性を保持し、Webのバイト入力・取消し・破棄を追加 |
| `shared/core.js` | Web専用取得アダプタを呼ぶ接点だけ。Localのログイン・自動ログアウトは変更しない |
| 新規 `security-tests/` | `demo-soslist-security`専用エミュレータ設定、合成テスト、試験手順 |
| 新規 `ops/security-members.cjs` | UID会員状態のpreview・退避・条件付きapply・再読。秘密値・患者本文を出力しない |
| `ops/`の運用文書 | 管理者復旧、配備済みRulesとの照合、権限失効、Local／バッチ互換性記録 |
| `/Users/shungohiroyasu/soslist/firestore.rules`、`storage.rules` | 別ソースにある古いRulesの再配備による逆戻りを防ぐ。正本へ同期または配備元を一本化 |

既存 `firebase.json` の本番接続先やLocalバンドルは、試験準備では変更しない。新しいHTTPバックエンドが必要になった場合は、Functions/IAMの棚卸結果と最小のruntime権限を提示し、別途承認してから変更対象を確定する。

## 優先順と実行段階

### 承認済みの実施順と現在地

1. **ダミーサイト作成（現在）**：本番とは別ソース・別設定・合成患者／予約のみ。先にdemoプロジェクトのエミュレータ試験を通す。実Google用の検証Firebase・別サイトについて、所有者、課金／契約、公開範囲、URL、OAuth／許可ドメイン、Rules・永続アクセス設定をまとめて実行前承認へ出す。本番のGitHub＋Cloudflare構成は変更しない。
2. **本人登録・検証**：承認済みの独立検証Firebase＋別URLで本人が実Googleログインし、ダミーデータだけを使ってiPhone・Windows・共有Android、許可／拒否、切替・回復を検証する。エミュレータのGoogle模擬ログインを実Google成功とは扱わない。
3. **全員登録・検証**：本人の第二段階成功確認後に限り進める。全員が同じ限定編集権限。個人メールは私有管理、登録は本人の正規画面。
4. **本番移植**：検証済みコードだけを環境設定から分離して移植する。先に本番の既存UIDリンクを本人の少人数操作で確認し、Local／バッチと認証境界を確認してから切替する。検証プロジェクトのUID・Auth利用者・鍵・合成データを本番へコピーしない。Firebase UIDはプロジェクトごとに異なる。

各段階の失敗時はその段階で停止する。第一段階の包括依頼で外部公開・課金・OAuth・本番変更の承認を省略しない。

### 段階1 正規利用者と配備状態の確定

成果物：UID・既存Local境界の私有対応表、現在のRules／公開コードの復元可能な版、Web／Local／バッチのアクセス表。現在の広いルールへ戻すことを通常の復旧策にしない。

- [ ] 利用者から本人のGoogleメール、個人／共有端末区分を受け取る。実メールは公開文書やGitへ保存しない。
- [ ] 許可された利用者だけについて既存Auth UIDを正規管理画面／SDKで照合する。パスワード、トークン、Cookie、秘密鍵は取得しない。
- [ ] Localの現在のUIDと必要な操作、取込・Summary・PDFアップロードのAdmin SDK実行主体を確認する。資格情報の内容ではなく、正規経路と役割だけを記録する。
- [ ] 配備済みFirestore・Storageルール、公開Webコード、Authのプロバイダー状態を再確認して、変更前の版を退避する。Cloudflareは現在のDNS・proxy・Access・WAF・cacheを正規管理経路で確認し、本人確認済みの既存経由構成を無断で外さない。
- [ ] 退避は秘密を含まない設定・版・対象フィールドに限定する。OAuth secret、認証token、既存取得URLの秘密部分、資格情報ファイルを設定退避へ混ぜない。
- [ ] 配備済みFunctions・Cloud Run等のHTTP入口、認証検証、IAM、バケットの公開設定、CORS、App Checkの有無を設定・ソース中心に棚卸する。患者ファイルを取得しない。
- [ ] 同じFirebaseを指す二つのRulesソースについて、配備の正本・担当・手順を決める。

通過条件：全正規UIDとLocal／バッチの必要経路が説明できること。曖昧なUIDや不明な書込み元がある状態ではルールを厳格化しない。全体ユーザー一覧や患者データの広い収集は代替手段にしない。

### 段階2 データの許可一覧を先行配備する準備

成果物：Google追加前に非メンバーを拒否できるFirestore・Storage Rulesとエミュレータ試験。

- [ ] `securityMembers/{uid}`の契約と全員共通の限定権限表を利用者に提示する。移行中のWebパスワード許可は指定した本人UID・期限だけにする。
- [ ] Firestoreで非会員・停止済み・古い認証時刻を拒否し、会員管理の自己昇格・任意UID指定・一覧取得を拒否する。
- [ ] 全Webメンバーは上表の受診日時・来院・受診・完了だけ更新可能とする。nested mapの変更キー、型、値を検証し、本文を混ぜた同時変更、追加・削除、予約作成／削除を拒否する。
- [ ] Storageで会員の必要パスだけを読めるようにし、クライアント書込みを禁止する。既存の取込がAdmin SDK経路であることを合成試験で確認する。
- [ ] Storageからの会員参照の連携権限と追加読取り費用を確認する。これはクライアント書込み許可の再開では代替しない。
- [ ] 下記試験を失敗状態から作成し、Rulesを実装して全件通す。Rulesのロールバック先も、正規UIDを維持し非会員を拒否する最低限の版を用意する。
- [ ] 試験runnerは`demo-soslist-security`とエミュレータ接続だけを許可し、本番project指定・実クラウド接続・秘密情報の取得を検出したら開始前に停止する。依存は`security-tests/package.json`で管理し、本番の依存や設定へ試験用変更を混ぜない。

最初の試験例は、患者資料を使わずに「認証済みでも非会員なら読めない」を固定する。`security-tests/firebase.json`はAuth 9098・Firestore 8084・Storage 9198、UI無効、プロジェクト`demo-soslist-security`だけを使う。

```js
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-soslist-security',
    firestore: { host: '127.0.0.1', port: 8084,
      rules: fs.readFileSync('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9198,
      rules: fs.readFileSync('storage.rules', 'utf8') }
  });
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'appointments', 'synthetic-appointment'),
      { notes: 'SYNTHETIC DATA ONLY' });
  });
});
after(async () => { await env.cleanup(); });
test('signed-in non-member cannot read an appointment', async () => {
  const ctx = env.authenticatedContext('synthetic-non-member');
  await assertFails(getDoc(doc(ctx.firestore(), 'appointments', 'synthetic-appointment')));
});
```

本番を使わない合成試験の実行コマンド（第一段階では独立ダミーサイトの設定を使用）：

```sh
firebase --config security-tests/firebase.json --project demo-soslist-security emulators:exec --only auth,firestore,storage 'node --test security-tests/*.test.cjs'
```

| 合成ケース | 期待結果 |
| --- | --- |
| 未認証／非会員／active=false | 予約・Summary・文書・音声の読取りと全書込みを拒否 |
| 正規Webメンバー全員 | 許可読取り・受診日時・三つのマーク更新が成功。他の更新・作成／削除・Storage uploadは拒否 |
| mapを丸ごと送る更新 | 許可キーだけなら成功。本文・未知キー・紹介先追加／削除・型不正を混ぜると全更新拒否 |
| 異なるUIDでの自己権限更新 | 拒否 |
| 既存Local読取り専用UID | 必要な読取り成功、従来禁止されていた書込みは拒否 |
| 既存Local編集UID | 従来必要な予約・Claim・メモ・紹介状保存の合成操作が成功 |
| 同じUIDのGoogle経路とLocal password経路 | Google要求は共通限定権限に従い、Local例外で昇格しない。Web利用停止とUID全停止の違いを確認 |
| Admin SDK取込／Summary | 合成アップロード・登録が成功、Rulesによる会員登録を要求しない |
| 旧auth_time、停止直前からのlistener | 新規取得・更新の拒否と既存listenerの挙動／時間を確認 |
| 本番project指定／エミュレータ不在 | 試験開始前に停止し、実データへ接続しない |

通過条件：非会員拒否、共通限定編集、Local互換性、バッチ互換性が全て通ること。本番適用は段階6の承認後に行う。

### 段階3 個人Googleログインと既存UIDの移行

成果物：Web専用Googleログイン、本人確認済みのUIDリンク手順、個人アカウントごとのパスワード経路終了計画。

- [ ] 個人の既存Authアカウントがある場合は、本人が現在の方式で認証した後、Google providerをリンクする。リンク前後のUID一致を確認する。
- [ ] 共用アカウントは複数人へリンクして個人監査済みとはしない。Local用として維持する必要と、Webメンバーを個別UIDへ分離する必要を区別して承認を得る。
- [ ] `index.html`とWeb専用モジュールにGoogleログインを追加し、許可一覧チェック前に予約取得を開始しない。Googleで新UIDができても自動で会員にしない。
- [ ] スマホのredirect、PCのpopup、Google取消し、ポップアップ拒否、同メールの既存アカウント、別UIDへ既にリンク済みのケースを合成／少人数試験する。衝突時は保存せず停止し、患者レコードの自動移動・削除・アカウント統合は行わない。
- [ ] 本人のGoogleログインが成功し既存UIDが維持できた利用者だけ、`webProviders`を`google.com`に絞る。個人Web用の旧password provider解除は別承認とし、Local用アカウントには実施しない。
- [ ] 同じUIDがLocalも使う場合、Firebase全体のpassword provider解除を行わない。一般WebメンバーとLocal例外の扱いを本人へ説明する。

公式のリンク方式は同じFirebase user IDを維持する。現在の公式文書には一部プロジェクトのリンクAPIの既知問題もあるため、実SDK版で試験してから少人数へ適用する。問題時にログイン秘密の取得や独自な資格情報結合で迂回しない。[アカウントリンク](https://firebase.google.com/docs/auth/web/account-linking)、[Googleログイン](https://firebase.google.com/docs/auth/web/google-signin)

通過条件：新規Google非会員はデータ拒否、既存本人UID維持、取消し時に権限付与なし、Local継続。パスキーだけの強制、スマホ1台だけの制限、Googleアカウントの回復経路停止はこの機能で保証しない。

### 段階4 共有端末の操作者切替とWebセッション

成果物：Web専用の「共有端末」モード、交代時の明示サインアウト、旧ユーザーの画面残留を防ぐ状態管理。

- [ ] Web専用モジュールで、共有端末は明示的な`SESSION`、必要に応じてより短い`NONE`を選ぶ。個人端末と設定を分け、Localの設定へ適用しない。
- [ ] 操作者名と「交代／ログアウト」を常時表示する。交代操作では先に画面を閉じ、サインアウト完了を確認してから次の人を認証する。
- [ ] 予約・Claim・紹介状・Summary・PDFの全モーダル、一覧DOM、印刷フレーム、メモリ上のデータ、Object URL、非同期応答を破棄／無効化する。古いユーザーの応答を次のユーザーへ反映しない。
- [ ] 共有端末の無操作15分でWebのみサインアウトする案を試す。バックグラウンド復帰時も時刻を判定し、端末のブラウザ終了イベントだけに依存しない。時間は実行前承認で確定する。
- [ ] Google側の既存ログインが前任者を自動選択しないかを確認する。FirebaseのsignOutだけでGoogleのセッションも終了したとは扱わない。
- [ ] iPhone Safari／Chrome、Windows Chrome／Edge、共有AQUOSの実ブラウザで、個人iPhone QR・Bluetooth・Google既存セッション・取消し・交代を少人数試験する。

通過条件：AからBへ交代後、Aの表示・文書・保留中応答が現れず、BのUIDと権限が表示されること。共有PINでAの個人パスキーを使える構成を採用しない。QRが実機で使えない組合せは代替方法の本人選択まで配備対象にしない。

ブラウザの通常既定は認証状態を継続保存する。`SESSION`はタブ／ウィンドウ終了、`NONE`は再読込みで消える。これは取得済みファイルやOS全体の消去保証ではない。[認証状態の保存方式](https://firebase.google.com/docs/auth/web/auth-state-persistence)

### 段階5 PDF・音声・APIと入口の保護

成果物：ネットからアクセス可能な取得経路の一覧、会員認可付き文書取得、既存リンクの扱い、Functions／IAMの是正案。

- [ ] 文書・音声の取得を、SDK認証付き読取りとURLだけの読取りに分類する。患者本文は取得せず、最初は合成ファイルだけで未認証・停止済み・期限後の挙動を測る。
- [ ] Web専用PDF取得は長期URLを渡さず、公式SDKの認証付きバイト取得を第一候補とする。既存compatと同じAuthを正規公開APIで利用できることを合成試作で確認する。非公開`_delegate`、Cookie／トークン抽出、異なるSDKの無検証混在は使わない。
- [ ] `shared/pdf-viewer.js`のresolver契約に、既存URL文字列に加えて`{bytes: Uint8Array, contentType: 'application/pdf'}`を追加する。Webはバイト入力、Localは従来のURL入力を保持し、取消しとメモリ破棄の試験を行う。
- [ ] SDK統合を安全に成立させられなければこの段階を止め、認証付きHTTP取得ゲートウェイ案を別承認へ出す。採用時はFirebase ID tokenの署名・issuer・audience・失効と会員状態をサーバーで確認し、任意のバケット／パス入力を受けず、承認予約の参照から対象を解決する。runtimeは管理された最小権限を使い、端末に鍵を置かない。
- [ ] 本番の既存取得リンクの無効化は、合成ファイルでLocal再取得とバッチ再登録が成功した後に、対象・影響・代替取得方法を示して別承認する。リンクを匿名で取得できるか未検証の本番ファイルを、公開ネットへ投げて試さない。
- [ ] URLの無効化は旧URLを復元する方式にしない。Localとの互換性を維持できなければ未解決として報告し、Localの追加ログインなしで取得経路を維持する最小互換性案を別途提示する。
- [ ] Functions/APIにHTTP入口があれば、無認証・不正audience・停止UID・失効token・任意対象指定を合成試験で拒否する。Admin SDK使用関数はRulesを迂回するため、関数内の認可とIAMを省略しない。
- [ ] 操作記録は個人UID・時刻・操作種別・成否を権限制限した管理用記録へ保存する設計にする。患者本文・URL・token・秘密・変更前後の臨床値を一般ログへ出さない。共有UIDで個人別監査済みとは説明しない。
- [ ] Cloudflareの既存proxy・WAF・cache設定を確認して保持し、AccessのGoogle連携は追加層として比較する。変更が必要な対象ホスト、正確なメール許可、callback、セッション、origin到達経路を合成サイトで試す。入口側で規制してもFirestore・Storage・HTTP APIへの直接アクセスは各データ境界で認可する。医療応答をCDNで共有キャッシュしない。mTLS／証明書配布は初回案の必須機能にしない。
- [ ] App Check、依存SDK更新、CSP・Referrer-Policy・キャッシュ等のWeb対策は実配備設定を確認して小さく追加する。App Checkを本人認可やRulesの代替にせず、Localを含む全クライアントを確認する前に共有Firebaseで一括強制しない。

直接SDK取得は9.5以降に公式関数があり、Security Rulesで細かなアクセス制御が可能。実際に使用するSDK版と既存compatへの適合は試験で確定する。[Storageの直接取得](https://firebase.google.com/docs/storage/web/download-files)

通過条件：会員許可・失効がデータ取得経路で試験でき、Localの文書取得が維持されること。既存URLの扱いが未解決なら「漏洩経路を全て閉鎖済み」とは報告しない。Cloudflare導入だけで直接Firebaseアクセスが止まるとは扱わない。

### 段階6 少人数試験と段階配備

成果物：合成試験結果、本人確認済み移行表、配備対象の正確な差分、復旧手順、利用者向け短い操作案内。

- [ ] ローカル／エミュレータで全拒否・許可試験を通し、秘密・医療本文が診断出力へ出ないことを確認する。
- [ ] 実施順に従い本人、次に全メンバーで、個人端末と共有端末を試す。最初は合成予約・合成PDF／音声を使う。
- [ ] ルール、会員設定、Web UI、Google provider、取得経路、旧password経路終了を別の配備単位にする。許可一覧が先、Googleの一般公開は後とする。
- [ ] 各配備前に現在の設定・Rulesの版・会員変更対象・公開ソースを照合し、変更前の状態から変わっていれば停止する。
- [ ] 承認した対象UIDを先に準備し、Rulesを配備して正規利用者・Local・バッチの維持と非会員拒否を確認する。その後GoogleとWeb UIを少人数へ追加する。
- [ ] 権限停止試験では会員停止、新規読書き、既存listener、旧ID token、取得URL、端末内キャッシュを分けて記録する。文書を端末へ既に保存した後の回収まで保証しない。
- [ ] 本番確認は必要最小限の本人操作と正規readbackに限定する。セキュリティ試験のために本番患者予約を新規作成・編集しない。必要な本番合成データの作成・削除も別承認する。
- [ ] 配備後、正本Rules・配備済みRules・二つのソース・公開ソースの版を照合し、古いソースからの逆戻りを防ぐ。

公開GitHub Pagesは全体に同じ静的コードを配るため、少人数だけに配備できるとは仮定しない。試験用ホストまたは検証ビルドと個人UIDによるアクセス制御で段階試験し、一般公開は別承認にする。

## 復旧とロックアウト防止

1. 所有者の既存正規管理アクセスを確認し、別の回復用Google手段を本人が保持する。パスワード・回復コードを作業ログやこの文書へ書かない。
2. 既存UIDを記録してからproviderをリンクする。UID衝突時にアカウントや患者データを削除・自動統合しない。個人Webの旧ログインを終了する前に、Google・回復・Local維持を確認する。
3. 会員変更はpreview、変更前の私有退避、直前値一致の条件付きapply、再読を使う。適用件数と権限の役割だけを通常の報告に残す。
4. Webの不具合時はWebソース／機能フラグを前版へ戻す。非会員拒否を維持したまま、指定本人UIDだけ期限付きで旧Web方式を再許可する案を使う。全面の`request.auth != null`への再開放を通常の復旧手順にしない。
5. Local／バッチが止まったら、その変更単位の展開を停止する。確認済み正規UID・正規実行主体だけの権限を修正する。新規の広い秘密鍵配布、全体認可の無効化で復旧しない。
6. refresh token失効、provider解除、旧リンク無効化は「UI差戻しで元通り」とは扱わない。再認証・本人による再リンク・正規取得経路による再取得が必要になる操作として別承認する。
7. 漏洩が疑われる場合は該当会員停止と該当取得経路の制限を先に行い、患者本文を広いログへ複製せず原因と影響を調べる。本番データ全体の復元はセキュリティ配備の通常ロールバックに使わない。

## 実行前に具体的に承認する項目

今は承認を求めず、実装準備の成果物を提示してから次を確認する。

- 本人のGoogleメール／UIDの許可対象。全員共通の編集項目は確定済みで、個人別の役割選択は不要。
- 既存Local UIDをどの権限で維持するか。共有構成に残るLocal password経路のネット利用可能性をどう扱うか。
- Firestore・Storage Rulesの正確な差分、StorageとFirestoreの連携権限、会員コレクションの新設、IAM変更の必要性と費用。
- Google provider追加、本人が行うUIDリンク、共用アカウントから個人UIDへの分離、個人Webの旧password経路終了の対象と時期。
- 共有端末の無操作15分案、SESSION／NONE、交代時の終了、実機QR結果と代替方法。
- PDF／音声の取得方式、既存URL無効化の対象と影響、Local取得への互換性、HTTP gatewayが必要ならそのruntimeと最小権限。
- 検証プロジェクトの所有者・費用・公開範囲・別URL・Google認証設定、本人試験の対象端末、本番配備日時、停止条件、差戻し単位、緊急時の本人連絡方法。
- Cloudflare AccessやApp Check、証明書、別バックエンド等を採用する場合の追加範囲。初回の必須機能へ無断で追加しない。

## 利用者から必要な情報

| 情報 | 目的 |
| --- | --- |
| まず本人、後に各人のGoogleメール | 個人UIDの許可一覧を作る。全員共通の限定権限で、役割選択は不要 |
| 現在のSOSListアカウントが個人か共用か | UIDリンクと共用UIDの分離を判断する |
| 所有者のLocalログイン継続対象 | クラウド認可変更による停止を避ける |
| iPhone／Windows／共有Androidの機種・OS・ブラウザ | QR・パスキー・交代を実機確認する |
| 共有Androidの人数と交代方法、無操作時間の希望 | セッション方式と終了タイミングを決める |
| 検証環境の所有者・費用上限・公開範囲・別URLの希望 | 外部環境・Google認証設定の具体的承認をまとめる |

パスワード、端末PIN、Google回復コード、パスキー秘密、Cookie、token、サービスアカウント鍵は必要な利用者情報に含めない。登録・本人確認は本人が正規画面で行う。

## 完了条件

- 非会員・停止会員のFirestore・Storage・確認済みHTTP取得を拒否できる。
- 個人Googleログイン後も、許可一覧のないUIDにデータ権限が増えない。
- 全員共通の限定編集がUIとRulesで一致し、共用UIDを個人監査済みと扱わない。
- iPhone・Windows・共有Androidの採用フローが実機で確認され、交代後に前任者の表示・処理が残らない。
- 既存Localログイン・必要な保存・PDF取得・Admin SDK取込・Summaryが維持される。
- 配備済みRulesと正本が一致し、未確認のAPI・リンク・IAMが残る場合はその範囲を明示する。
- 本人別の停止・復旧・UIDリンクの手順が用意され、全面再開放なしに復旧できる。

本計画はクラウド版のネット経由アクセスを改善するものであり、取得済み資料の回収、Local端末の侵害、Google側の全認証方式、登録スマホ1台への限定まで保証しない。

## 根拠と調査証跡

コードの入口：`script.js`の`onAuthStateChanged`／`signInWithEmailAndPassword`、`shared/core.js`の`startLogoutTimer`／`handleViewPdf`、`shared/pdf-viewer.js`、`firestore.rules`、`storage.rules`。取込は `/Users/shungohiroyasu/soslist/openai-processor/index.js`、Summaryは `daily-brief/generate-brief.js`、Functionsのローカルソースは `/Users/shungohiroyasu/soslist/functions/index.js`。ローカルFunctionsソースの存在だけで実配備状態を判断しない。

匿名化した既存証跡は、作業フォルダ `/Users/shungohiroyasu/Documents/Codex/2026-10-10/task/` の `soslist-security-config-results.json`、`soslist-deployed-security-evidence.json`、`soslist-public-auth-evidence.json`、`soslist-shared-device-design-notes.json`。この計画へ患者識別情報や実メンバーのメールを転載していない。

公式資料は各設計項目の直後へリンクした。これらは機能の説明であり、SOSListの実配備や実機フローの成功を証明するものではない。


## 第一段階の成果（ローカル準備完了・外部設定待ち）

独立した作業フォルダ `/Users/shungohiroyasu/Documents/Codex/2026-10-10/task/soslist-security-sandbox/` に合成予約2件のサイト、共通限定権限Rules、環境検証、再seed／復旧手順を作成。単体24件・Rules57件・ブラウザ4件、計85件成功。独立レビューの指摘を修正し再試験した。画面と配備条件は `README.md`、証跡は `TEST-RESULTS.md`・`verification.json`、外部設定の具体承認案は `EXTERNAL-SETUP.md`。試験サーバーは停止済み。

本番・Local・バッチ・既存Google/Firebase/Cloudflare設定は変更なし。実Google・別URLの公開は未実施。第一回は本人所有の独立Spark project＋Google Auth＋Firestore＋静的Hosting、課金未連携、Storage／Functionsなしを提案する。所有者・確定project/URL・region・Google有効化・本人会員1件・公開範囲を具体承認してから外部設定する。第二段階の本人成功確認まで全員登録と本番移植へ進まない。
