# Atelier — 絵画のオーダー受付

Next.js / TypeScript / Supabase / TypeSafe Jevで、相談から明示承認、制作管理までを扱う日本語アプリです。開発の入口は`AGENTS.md`、仕様は`PROJECT.md`、役割とチケットは`ORCHESTRATION.md`と`docs/TICKETS.md`です。

## 実装される役割分担

顧客はチャットで希望を伝え、Jevがサイズ・テイスト等を判定します。アプリが候補と定型の返答を表示し、顧客が確認して保存します。明確な金額・ISO日付は候補として扱い、色や用途の原文は補足へ引き継げます。

価格はサーバーのカタログから計算します。顧客の「この内容で注文する」操作でのみ注文と制作タスクを作成します。Jevの緊急性評価・希望日・待機期間を組み合わせて優先度を算出し、管理者が着手・完了や手動調整を行います。

Jevは文章生成、DB更新、注文送信を行いません。GPT APIは不要です。現時点の価格はデモ料金、決済・発送・画像生成は対象外です。

## ローカルで体験

Node.js 22.12以降（22系または24系）とnpmを用意してください。

```sh
npm ci
npm run dev:demo
```

表示されたlocalhostを開き、「絵を相談する」→「顧客として試す」から開始します。別のブラウザプロファイルまたはシークレットウィンドウで「管理者として試す」を使うと、顧客と管理者を同時に確認できます。

デモでは認証・DB保存・Jev判定をローカルのデモ実装に置き換えます。再起動でデータは消え、複数のサーバープロセス間で共有されません。デモ管理者はデモの注文を閲覧できます。実データを入力しないでください。本番運用は必ずSupabaseモードを使います。

## 本番接続の準備

### 1. Supabaseの初期設定

新規Supabaseプロジェクトを用意します。標準構成では、デプロイ時に `npm run deploy:build` がDBを初期化します。**環境変数を設定してデプロイすれば、テーブル・RLS・RPC・料金表が自動で作成されます。** 適用履歴とチェックサムを保存し、再デプロイ時は適用済みのmigrationをスキップします。失敗時は一括ロールバックします。

SupabaseダッシュボードのConnectからDB接続URIを取得し、`SUPABASE_DB_URL`へ設定します。Direct接続を基本とし、IPv4が必要な環境ではSession pooler（ポート5432）を使ってください。パスワード中の特殊文字はURIエンコードが必要です。TLS証明書検証は有効です。プロジェクトのCAが必要な場合は`SUPABASE_DB_CA`へ公式CAのPEMを設定します。[Supabaseの接続方法](https://supabase.com/docs/guides/database/connecting-to-postgres)

PreviewとProductionには別のDBを推奨します。migrationのためにPreviewからProduction DBへ接続しないでください。

手動初期化を選ぶ場合のみ、`supabase/bootstrap.sql`を新規DBのSQL Editorで一度実行するか、Supabase CLIでmigrationを適用できます。その場合はVercelのBuild Commandを`npm run build`へ変更し、自動migrationと混在させないでください。既に適用済みのDBへ履歴なしで自動migrationを実行すると失敗します。通常の自動方式では適用済みSQLを編集せず、新しいmigrationファイルを追加します。

AuthはEmail/Passwordを使用します。Supabase AuthのSite URLを公開URLにし、Redirect URLsへ`https://YOUR_DOMAIN/auth/callback`（ローカルは`http://localhost:3000/auth/callback`）を登録します。確認メールのリンクを開くとアプリがコードを交換します。メール確認を有効にする場合はSMTPも設定し、公開前に実メールで登録を確認してください。

### 2. 環境変数

ローカルは`.env.example`を`.env.local`へコピーして値を入力します。VercelはProject Settings → Environment Variablesへ同じ値を設定します。

| 変数 | 値 / 用途 |
|---|---|
| APP_MODE | `supabase`（本番） |
| NEXT_PUBLIC_SUPABASE_URL | SupabaseのプロジェクトURL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Supabaseの公開キー（従来のanonキーも対応） |
| SUPABASE_SECRET_KEY | Supabaseサーバー用secretキー（従来のservice_roleキーも対応）。判定保存とレート制限RPC専用 |
| SUPABASE_DB_URL | DB管理者の接続URI。デプロイ時のmigrationに使用 |
| SUPABASE_DB_CA | 任意。DBのTLS検証に必要なCA PEM |
| ATELIER_ADMIN_USER_ID | 任意。既存Supabase AuthユーザーのUUID。デプロイ時に管理者権限を付与 |
| TYPESAFE_API_KEY | [TypeSafe API Keys](https://console.typesafe.ai/keys)で発行 |
| TYPESAFE_MODEL | `jev-latest` |
| JEV_MODE | `jev`（実API）、`mock`は明示的なテスト用 |
| APP_URL | 任意。固定した公開origin例`https://art.example.com`。動的Previewでは未設定にする |

秘密キーに`NEXT_PUBLIC_`を付けないでください。`APP_URL`を設定した場合、そのoriginと異なる画面からの更新は拒否します。

設定後、値を表示せず必須変数だけ検査できます。

```sh
npm run env:check
```

`SUPABASE_DB_URL` のパスワードに `#` などを含む場合は、パスワード部分だけをURLエンコードしてください（例：`#` → `%23`、`@` → `%40`）。未エンコードの `#` は `.env` インポート時にコメント扱いされ、接続文字列が途中で切れます。ローカルを直してもVercel側の値は更新されないため、Environment Variablesでも修正し、再デプロイしてください。

このチェックは疎通確認ではありません。キーが間違っている場合、画面に接続エラーが出ます。

### 3. 管理者を設定

Supabase AuthのUsersで管理者用ユーザーを事前作成し、そのUUIDを`ATELIER_ADMIN_USER_ID`へ設定すると、デプロイ時に権限を設定できます。

アプリから登録したユーザーを後から管理者にする場合も、この変数を設定して再デプロイできます。手動設定する場合はSQL Editorで以下を実行します。

```sql
update public.user_roles
set role = 'admin'
where user_id = '管理者として使うユーザーのUUID';
```

一般ユーザーは画面やAPIから管理者に昇格できません。権限変更後に再ログインし、`/admin/tasks`を開いてください。

### 4. Vercelへデプロイ

このディレクトリをGitリポジトリとして登録しVercelへImportするか、Vercel CLIでこのディレクトリからデプロイします。

```sh
npm run check
vercel
```

Framework PresetはNext.js、Node.jsは22系以降、Build Commandは`vercel.json`に設定済みの`npm run deploy:build`です。必須環境変数チェック→DB migration→Next.jsビルドの順に実行します。Preview/Productionそれぞれに環境変数を設定し、Previewで登録・相談・注文・管理者更新を確認してから本番へ反映します。

```sh
vercel --prod
```

外部アカウント・キーはコードに含めません。実サービスへの接続と公開は、環境変数の設定後に利用者の環境で行います。DB migrationは標準デプロイ処理に含まれます。

## 検証

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

E2Eはポート3100でdemo/mockサーバーを起動します。ブラウザが未導入なら`npx playwright install chromium`を実行してください。自分の実データがあるサーバーを3100で起動しないでください。

DBテストはPGliteのPostgreSQLで実行し、Supabase Authのユーザー/ロール/JWT関数だけを模擬します。migration SQL・RLS・権限・冪等性を検証できますが、Supabaseの実際のメール配送・HTTPゲートウェイ・本番ネットワークは検証対象外です。

## 障害と運用

- Jevはタイムアウトと有限回のリトライを持ちます。失敗時に黙ってモックへ切り替えません。
- 判定失敗時は選択入力を継続できます。注文確定後の優先度評価失敗で注文を取り消しません。
- 管理者の「評価待ち」から再評価できます。未保証のレスポンス後処理に頼りません。
- 低確信度の制作評価は「要確認」とし、管理者が確認して制作待ちへ戻します。
- 価格変更時は`catalog_options.price_jpy`と`version`を更新します。以前の見積もりは注文時に拒否され、再見積もりが必要です。UIの参考価格も同時に更新してください。
- 希望日は未確約です。制作可能日を自動で約束しません。

実装・検証状況は`IMPLEMENTATION_STATUS.md`、E2E結果は`docs/QA_REPORT.md`、デザインレビューは`docs/DESIGN_REVIEW.md`を参照してください。
