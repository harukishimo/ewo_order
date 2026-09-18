# 実装・検証状況

更新日：2026-09-18。ゲスト相談は本番公開済み。以下の初期MVP記録は当時の履歴で、最新の変更は末尾のGemini会話改訂を参照。

## 完成した範囲

| 項目 | 現在の証拠 |
|---|---|
| チケット単位のオーケストレーション | docs/TICKETS.md。V/D/J/U/B/A/Qの役割で割り当て、統合修正を追加チケット化 |
| Next.js基盤・公開構成 | package.json/lock、vercel.json、本番build成功 |
| 顧客相談 | customerページ、チャットAPI、Jev実/モックアダプター、候補を明示確認するUI |
| サイズ・テイスト・予算・希望日・補足 | 共有型、候補抽出テスト、UI E2Eで注文へ保持 |
| 顧客承認と注文 | 最終確認ボタン、サーバー料金計算、DB confirm_order RPC。承認前は注文ゼロをE2Eで確認 |
| 冪等性・競合・権限 | DB11テストとAPI E2Eで二重注文/古いrevision/価格改ざん/他人のデータを検証 |
| 優先度・制作管理 | 優先度算式、低確信度要確認、評価待ち、管理者の着手/完了/上書き/履歴 |
| デザイン | docs/DESIGN.md、DESIGN_REVIEW.md。4画面の1280/375px画像、指摘2件を修正確認 |
| Jev障害への対応 | 有限リトライ、応答検証、入力継続、注文成立後は評価待ち・管理者再評価 |
| Supabase接続実装 | SDK境界4テスト（fake HTTPでAcceptと単体返却・camelCase変換） |
| デプロイ時のDB初期化 | scripts/migrate.mjs、migration-runner.mjs。履歴・編集検出・失敗ロールバックのSQLテスト |
| 設定・公開手順 | README.md、.env.example。env:checkは未設定キーを検出し値を出力しない |

## 最終検証

- npm run check：成功（lint、typecheck、30テスト、本番build）。
- npm run test:e2e：Chromium1243で6件成功（顧客→注文→管理者→顧客進捗1件、HTTP不変条件5件）。
- DB：PGliteのPostgreSQL上で実migration/RLS/RPCを検証。Supabase Authだけ模擬。
- ブラウザ：ページ表示・ナビゲーション、相談/注文/制作の操作、デスクトップとモバイルの見た目を確認。
- npm run env:check：実キー未設定のため期待どおり不足変数を表示して停止。

## ユーザー環境で残る作業

1. SupabaseプロジェクトとTypeSafe APIキーを用意し、READMEの環境変数を設定。
2. Supabase Authの公開URL・メール設定と、管理者用ユーザーを設定。
3. Vercelへデプロイ。標準buildは必須設定チェック→DB migration→Next.jsビルド。
4. 実サービスで登録メール・実Jev判定・注文・管理者操作を最終確認。

実Jev通信、実Supabase HTTP/認証メール、Vercel上の公開動作はキー未提供のため未検証。デプロイ済み・実接続済みとは報告しない。これらは環境設定後の確認であり、コード内に秘密値は含まれない。

## 実装時の判断

- 会話はアプリの定型文。Jevは分類・採点だけを担当し、GPT APIは追加しない。
- デモはメモリ保存を明示。本番はSupabaseが永続化を担当する。
- 低確信度の制作評価を要確認へ移す閾値0.5、料金、優先度重みは初期仮設定。
- Dockerが起動していなかったため、DB検証にPGliteを採用した。
- npm依存解決の不具合を避けるため.npmrcにlegacy-peer-depsを固定。lockfileを保存しnpm ciで再現する。

## ゲスト相談の改訂（2026-09-18）

- ログイン不要の相談開始。Supabase匿名セッションで所有権を維持。
- 注文確定時に連絡先メール必須、注文スナップショットに保存。メールによる本人認証・アカウント連携は行わない。
- 管理者詳細に連絡先を表示。管理者ログイン専用の案内へ変更。
- 型検査・lint・49テスト、E2E 8件、本番ビルド（Webpack）成功。改訂版の本番公開を確認中。
- Supabase匿名サインインは有効化済み。初回本番公開時にmigration001〜005適用済み。006は改訂版デプロイ時に適用。
- 管理者作成用scripts/create-admin.mjsを用意。指定メールでアカウント作成し、パスワードはSupabase Authがハッシュ管理。引き渡し用情報はGit除外の.env.admin.localへ保存。


## Gemini会話・3Dアシスタント改訂（2026-09-18）

- Geminiの文章生成とJev分類を並列開始。GeminiトークンをNDJSONで逐次表示。
- Jev候補はチャット内追加メッセージで確認し、最新の明確な承諾で希望条件に反映。候補カードを撤去。
- 相談revision、原子的な会話保存、同一送信IDによる再送、手動変更後の提案失効を実装。
- 注文確定はメールと見積もり確認ボタンを維持。チャットの「はい」から注文を作らない。
- Three.jsの立体アシスタントを作成。待機・考え中・返答中・エラー状態、音声なし。
- デスクトップ1280px・モバイル375pxでWebGL表示、横溢れなし、JavaScriptエラーなし。動作軽減とWebGL喪失時の代替表示を確認。
- Lint・型検査・60件のunit/DB/integrationテスト・Webpack production build成功。全Playwright E2E 9件成功（会話→承諾→見積もり→メール付き注文→制作完了を含む）。
- Geminiキーは入力待ち。実Geminiの応答品質・レイテンシーは未検証。キー未設定時は会話AI未接続を明示し、条件入力とJevの確認を継続する。
