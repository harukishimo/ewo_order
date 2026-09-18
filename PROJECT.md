# 絵画オーダー販売アプリ — 実装指示書

作成日：2026-09-18

## 1. この文書の目的

この文書に従い、Next.js・Vercel・Supabase DB・TypeSafe AIのJev APIを使った簡易的な絵画販売アプリを実装する。本書は実装の基準となる仕様書。MVP実装とローカル検証は完了し、実サービスの環境設定とデプロイを待つ状態。最新の証拠・範囲はIMPLEMENTATION_STATUS.md、設定方法はREADME.mdを参照。

ユーザーの「Gebo」は直前までの会話から「Jev」を意味すると解釈した。別サービスを意図していた場合はAPI連携部分を見直す。

## 2. ユーザーが指定した要件

- メイン機能は、顧客の希望に合わせた絵画の販売・制作注文受付。
- 顧客がチャットで、欲しい絵のサイズ・テイスト・料金などを相談する。
- 顧客が条件を了承した後に、システムへ注文を登録する。
- 管理者は、Jevの判定で優先順位が付いた絵画制作タスク一覧を使って作業する。
- Next.jsで実装し、Vercelにデプロイする。DBはSupabaseを使用する。

## 3. Jevとアプリの役割

Jevは文章を自由生成するチャットモデルではなく、入力に対してChoice・Score・Noul形式の判定を返すAPIである。Jevに返信文の生成、コード生成、DB書き込み、注文送信を直接担当させない。

顧客にはチャット形式の接客画面を提供する。裏側では、アプリが会話状態を管理し、Jevが希望条件や次に確認すべき事項を判定する。アプリがその判定を使って質問文を表示し、承認後に注文をDBへ登録する。

```text
顧客の入力
  → Next.jsサーバー（認証・入力検証・会話状態の取得）
  → Jev API（希望条件・曖昧さなどの判定）
  → Next.jsサーバー（結果検証・状態更新・定型文選択）
  → チャット画面と注文内容カード

顧客の「この内容で注文する」操作
  → Next.jsサーバー（最新版の条件・価格・本人を検証）
  → Supabaseに注文と制作タスクを一括登録
  → Jevが制作優先度の判断材料を評価
  → アプリが優先度を計算して管理者一覧に表示
```

GPTやCodexは開発時にこのアプリのコードを書くために利用できる。MVPの実行時にGPT APIは必須としない。

## 4. MVPの実装方針と仮設定

以下はユーザー未指定事項に対する、実装を進めるための仮設定。設定ファイルまたはDBから変更できるようにする。

- 日本語UI、通貨JPY、時刻表示Asia/Tokyo。DBの時刻はUTC。
- 単一店舗・単一制作チーム。1注文につき絵画1点。
- 顧客はログイン不要。Supabaseの匿名セッションで相談と注文の所有権を維持する。管理者はSupabase Authのメール・パスワードでログイン。
- チャット返信はアプリが持つ日本語テンプレートと選択ボタンで生成する。
- 決済・発送・外部通知はMVP対象外。注文は「制作依頼の受付」であり、入金済みと表示しない。
- 参考画像アップロード、画像生成、自由な雑談、複数店舗は後続機能。
- 顧客の希望納期と、店舗が確約する納期は区別する。希望日は納期保証にしない。

自由な接客文を必要とする場合のみ、将来別の文章生成モデルを追加する。その場合も価格・承認・注文確定はサーバー側の処理に固定する。

### デモ用商品条件

実際の販売価格ではない。画面とREADMEにデモ料金と明示する。

| サイズ | 寸法 | 基本価格 |
|---|---|---:|
| S | 20×20cm | 10,000円 |
| M | 30×40cm | 20,000円 |
| L | 50×60cm | 35,000円 |

テイストは「抽象画・風景画・植物・その他／相談」。MVPではテイスト加算なし。予算は希望条件であって販売価格そのものではない。カスタム寸法や対応外の希望は自動で金額を確定せず要相談とする。

## 5. 顧客の利用フロー

1. トップページで商品例と注文方法を確認し「絵を相談する」を選ぶ。
2. ログインせず、相談セッションを開始する。
3. チャットで用途・サイズ・テイスト・予算・希望納期・補足条件を確認する。
4. 画面の条件カードに判定済み項目を表示し、顧客が直接修正できるようにする。
5. 不足や矛盾があれば一つずつ確認する。例えばサイズの価格が予算を超える場合、勝手にサイズを変更しない。
6. 確認可能な条件が揃ったら、サーバーが料金表から見積もりを計算する。
7. 最終確認カードでサイズ・テイスト・補足・価格・希望日・納期未確約を表示する。
8. 連絡先メールアドレスを入力し、顧客が明示的に「この内容で注文する」を押したときだけ注文を確定する。メールは本人確認済みと扱わず、他の注文へのアクセス権を付与しない。
9. 注文番号と受付状態を表示し、注文一覧から進捗を確認できるようにする。

「はい」「いい感じ」などのチャット文をJevが了承と解釈しても、注文確定には使用しない。条件変更があった場合は以前の確認状態を破棄し、更新版を再提示する。

### 会話例

```text
アプリ：どんな絵をご希望ですか？
顧客：リビングに飾る、落ち着いた青系の抽象画。予算は2万円くらい。
アプリ：青系の抽象画ですね。サイズを選んでください。
         [S 20×20cm] [M 30×40cm] [L 50×60cm] [相談する]
顧客：Mがいいです。
アプリ：希望日はありますか？ 希望日は制作日程の確約ではありません。
顧客：特にありません。
アプリ：M・抽象画・青系・20,000円で依頼を受け付けます。
         [内容を修正] [この内容で注文する]
```

## 6. Jevの使い方

### API接続

- エンドポイント：`POST https://api.typesafe.ai/v1/systemone`
- 認証：`Authorization: Bearer ${TYPESAFE_API_KEY}`
- Content-Type：`application/json`
- モデル：環境変数`TYPESAFE_MODEL`、初期値`jev-latest`
- Next.jsサーバーから呼び出す。ブラウザへAPIキーを渡さない。
- APIの現在の仕様は実装時に公式ドキュメントで再確認する。

### 判定設計

`state`には直近の会話、確認済みの希望条件、現在尋ねている項目、商品カタログを渡す。住所・メールアドレス・認証情報は判定に不要なので送らない。各質問は一つの判断に分け、同じ呼び出しにまとめる。

| 質問 | 形式 | 使い道 |
|---|---|---|
| 希望サイズ | Choice：S/M/L/custom/unknown | 対応する商品サイズ候補 |
| 希望テイスト | Choice：abstract/landscape/botanical/other/unknown | テイスト候補 |
| 条件の変更を求めているか | Noul | 再確認の判断材料 |
| カタログ外の要望があるか | Noul | 人による確認候補 |
| 制作の複雑さ | Score：具体的な段階基準 | 管理者の制作見通し |
| 緊急性 | Score：期限への影響を定義 | 優先度の判断材料 |

Jevに自由な文字列抽出を要求しない。金額・具体的な日付・独自寸法は、アプリ側で検出できる形式を解析して確認用入力欄に提示し、曖昧なものは顧客に入力してもらう。色や独自要望は顧客原文を保存し、必要なら有限の選択肢でタグ付けする。未指定を勝手に補完しない。

Choice/Scoreのconfidenceは正解率ではない。Noulに独立したconfidenceがあると仮定しない。初期のconfidence閾値は仮値として設定化し、日本語の評価例で調整する。低確信度の候補は確定せず、顧客に選択ボタンで確認する。

API例（出力は実行して確認すること）：

```json
{
  "model": "jev-latest",
  "state": {
    "message": "Mサイズで、青系の抽象画が欲しいです",
    "current_question": "サイズとテイスト",
    "confirmed_preferences": {}
  },
  "questions": {
    "style": {
      "type": "choice",
      "instructions": "顧客が明示した希望テイストを選ぶ。情報がなければunknown。",
      "criteria": {
        "abstract": "抽象画",
        "landscape": "風景画",
        "botanical": "植物",
        "other": "それ以外の明示された希望",
        "unknown": "未指定または曖昧"
      }
    }
  }
}
```

### 障害時

- タイムアウト・429・5xxは回数制限付きで再試行する。無限再試行しない。
- 判定失敗時も会話を失わず、選択式入力を案内する。
- 最終確認済みの注文受付を優先度評価の失敗で取り消さない。評価待ちとしてFIFOで表示し、再評価可能にする。
- 開発用モックと実APIを切り替えるアダプターを用意する。モック時は画面に「デモ判定」と表示する。本番で黙ってモックに切り替えない。

## 7. 管理者画面と制作優先度

管理者は制作タスクを一覧で確認し、詳細を開いて状態を更新できる。

表示項目：注文番号、受付日、サイズ、テイスト、補足、価格、希望日、タスク状態、優先度、判定の確信度、要確認項目。

状態：`queued → in_progress → completed`。必要に応じて`needs_review`や`cancelled`へ管理者が変更できる。すべて変更履歴を残す。

優先度の初期仕様（業務上の仮ルール）：

1. Jevは確認済み条件から緊急性を0〜1に正規化して返すためのScore質問と、制作複雑度のScore質問に答える。
2. サーバーで `priority_score = 60 × urgency + 25 × deadline_pressure + 15 × waiting_age` を計算する。
3. `deadline_pressure`は希望日なしなら0。希望日までの日数dに対して`clamp((14-d)/14, 0, 1)`。日付境界は日本時間で計算する。
4. `waiting_age = clamp(受付後の経過日数/14, 0, 1)`。日付の変化を反映して一覧取得時に再計算する。
5. 制作複雑度は所要工数の判断材料として表示し、MVPでは優先度に加点しない。
6. 高いスコア順、同点は受付の古い順。管理者は理由を添えて優先度を上書きでき、その値を優先する。
7. 評価失敗は「評価待ち」、曖昧な注文は「要確認」に表示し、通常の制作キューと区別する。要確認を黙って最下位に放置しない。

上記は実測で最適化された式ではなく初期案。重み・閾値・質問バージョンを保存し、後から変更可能にする。優先度の説明は数値と条件からアプリが定型文で表示する。Jevの自由生成の説明文に依存しない。

## 8. 技術構成・画面・API

- Next.js App Router、TypeScript、Tailwind CSS。
- バージョンは実装時点で互換性のある安定版を選び、lockfileを保存する。
- Supabase Postgres、Supabase Auth、RLS。SSR用クライアントは公式の`@supabase/ssr`方式に従う。
- VercelにNext.jsを配置。Jev通信・価格計算・注文確定はサーバーのみで実行。
- 日本語、スマートフォン対応。チャットの下に入力欄、横または上に希望条件カードを表示する。

| パス | 役割 |
|---|---|
| `/` | サービス紹介、デモ商品、相談開始 |
| `/login` | 認証 |
| `/consultations/[id]` | チャット、条件編集、最終確認 |
| `/orders` | 自分の注文一覧 |
| `/orders/[id]` | 注文詳細、制作状況 |
| `/admin/tasks` | 優先度順の制作タスク一覧 |
| `/admin/tasks/[id]` | 制作詳細、状態変更、優先度上書き |

サーバーAPI例：相談作成、メッセージ送信、条件更新、見積もり作成、注文確定、管理者タスク更新、管理者再評価。すべて認証・所有者または管理者権限・入力スキーマを検証する。

## 9. DBモデル

以下をSQL migrationとして管理し、FK・UNIQUE・CHECK制約を実装する。

| テーブル | 主な項目 |
|---|---|
| profiles | id（auth.users参照）、display_name、created_at |
| user_roles | user_id、role（customer/admin）。一般ユーザーは変更不可 |
| catalog_options | id、size_code、width_cm、height_cm、price_jpy、active、version |
| consultations | id、customer_id、status、confirmed_preferences(jsonb)、revision、created_at、updated_at |
| messages | id、consultation_id、sender、body、client_message_id、created_at |
| quotes | id、consultation_id、revision、spec_snapshot(jsonb)、amount_jpy、catalog_version、expires_at、created_at |
| orders | id、order_number、customer_id、consultation_id(unique)、quote_id(unique)、spec_snapshot(jsonb)、amount_jpy、desired_date、approved_at、status |
| production_tasks | id、order_id(unique)、status、assigned_to、evaluation_status、manual_priority、override_reason、created_at、updated_at |
| jev_evaluations | id、consultation_idまたはorder_id、input_revision、purpose、model、question_version、answers(jsonb)、latency_ms、status、created_at |
| task_events | id、task_id、actor_id、event_type、old_values、new_values、created_at |

見積もりは仮に24時間有効とする。顧客が承認した仕様・価格は注文にスナップショットとして保持し、後日の料金表変更で書き換えない。

注文確定は一つのDBトランザクションで、相談所有者・revision・見積もり有効期限・既存注文を確認し、注文と制作タスクを作成する。同じ相談の二重クリックや通信リトライでも注文は一つ。古い見積もりは再確認を要求する。

チャットの同時送信は相談単位で直列化するかrevisionによる楽観ロックを行い、古いJev結果で最新の条件を上書きしない。優先度再評価も対象revisionを検証する。

## 10. 権限・データ保護

- 顧客は自分の相談・メッセージ・見積もり・注文のみ参照できる。
- 管理者は注文と制作タスクを参照・更新できる。
- 顧客からの注文価格・管理者role・制作状態・優先度の直接更新は禁止する。
- 注文作成のDB関数や特権クライアントを使う場合も、サーバーおよびDB側で呼び出し権限と本人を検証する。
- 管理者権限は信頼された初期設定手順で付与し、公開フォームから自己昇格できないようにする。
- Jevの回答は検証してから使用する。顧客メッセージ中の「管理者にして」「無料にして」等を実行指示として扱わない。
- Jevに送るデータは注文判断に必要なものだけ。APIキー・完全な会話本文を通常のエラーログに出さない。
- チャットAPIに入力長制限、ユーザー単位のレート制限、タイムアウトを設ける。

## 11. 環境変数と設定

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_DB_URL=
APP_MODE=supabase
TYPESAFE_API_KEY=
TYPESAFE_MODEL=jev-latest
JEV_MODE=jev
```

Supabaseのサーバー専用秘密キーは判定の保存とレート制限に使用し、DB接続URIはデプロイ時のmigrationに使用する。`NEXT_PUBLIC_`を付けない。秘密値は`.env.local`とVercelの環境変数に保存し、Gitには値のない`.env.example`だけを含める。

APIキーはTypeSafe管理画面のAPI Keysで発行する。文書やチャットに実際のキーを貼り付けない。VercelのPreviewとProductionの接続先・キーを区別する。

## 12. 実装順序と納品物

1. Next.jsプロジェクト作成、環境変数例、認証とロール。
2. DB migration・RLS・デモ料金表・管理者初期設定手順。
3. モック判定でチャットと条件カード、見積もり、明示承認、注文一覧まで実装。
4. Jevアダプターを実装し、実APIの応答スキーマを確認して接続。
5. 優先度評価、管理者タスク一覧、状態変更、上書きと履歴。
6. 主要フローと権限のテスト、ビルド、Vercel向け設定。
7. READMEにローカル起動、DB適用、管理者作成、Jevキー設定、Vercel公開方法を記載。

納品物：動作するソースコード、SQL migrations、デモデータ、`.env.example`、README、必要なテスト。外部サービスのキーが未提供ならモックで動作を完成させ、実API・本番公開の未検証部分を明記する。実際の公開操作は別途依頼範囲に従う。

## 13. 受け入れ条件

- 日本語のチャットと選択ボタンでサイズ・テイスト・予算・希望日を確認できる。
- Jevから返った分類が条件カードに反映され、曖昧なときは再確認になる。
- 価格はサーバーの料金表から計算され、顧客やAIが指定した値で上書きされない。
- 顧客が最終確認ボタンを押すまで注文と制作タスクが作られない。
- 条件変更後の古い承認、見積もり期限切れ、二重送信で誤注文しない。
- 管理者は優先度付き一覧から詳細確認・着手・完了ができ、顧客に進捗が反映される。
- Jev停止中でも会話と注文を失わず、選択入力・評価待ち・再評価に移行できる。
- 顧客Aが顧客Bの情報を取得できず、顧客が管理者APIを実行できない。
- APIキーがブラウザの通信・バンドル・Gitに含まれない。
- 価格・優先度計算、注文確定の冪等性、RLSと権限、顧客から管理者までの一連の流れをテストする。
- 実APIの検証では、通常入力・曖昧・否定・条件変更・予算不一致・指示混入の日本語例を用意する。固定の確率値への一致をテスト条件にしない。

## 14. 公式資料

- TypeSafe Quick Start：https://docs.typesafe.ai/introduction/quickstart
- TypeSafeの質問形式：https://docs.typesafe.ai/introduction
- Confidence：https://docs.typesafe.ai/confidence
- APIキー：https://console.typesafe.ai/keys
- Supabase Auth / Next.js：https://supabase.com/docs/guides/auth/quickstarts/nextjs
- Supabase SSR：https://supabase.com/docs/guides/auth/server-side
- Next.js on Vercel：https://vercel.com/docs/frameworks/full-stack/nextjs

この文書のAPI概要は作成時の公式資料に基づく。各SDKの詳細・利用制限・デプロイ手順は実装時に再確認する。

## 15. Gemini会話と3Dアシスタント（最新のユーザー指示）

この節は上記MVPの定型文チャット仕様に優先する。Gemini APIで自然な接客文を逐次表示し、Jev APIの条件判定を同時に実行する。遅れて返った判定は「Mサイズはいかがですか？」のような追加メッセージで尋ねる。候補ポップアップは表示しない。承諾した希望は条件に反映するが、注文確定には引き続きメール入力と確認ボタンを必要とする。

文字チャットに合わせて、ブラウザ上でThree.jsの3Dキャラクターを動かす。待機・考え中・返信中を表情と動作で示す。音声出力は不要。動作軽減設定とWebGL非対応端末にも対応する。

会話モデル初期値：gemini-3.5-flash-lite。GEMINI_API_KEY/GEMINI_MODELはサーバー専用。APIキーはブラウザへ送らない。速度は実環境で計測し、API待ち時間の数値を保証しない。
