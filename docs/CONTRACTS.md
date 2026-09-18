# 共有契約 v0.1（実装開始用）

P1でオーケストレーターがTypeScript/Zod等の型に落とし込む。変更は影響担当へ通知する。

## 共通

- IDはUUID。価格は整数JPY。日時はISO 8601 UTC、希望日は日本時間のYYYY-MM-DD。
- 成功は`{data: ...}`、失敗は`{error: {code, message, retryable}}`。
- 401未認証、403権限不足、404対象なし、409revision競合、422入力不備、429制限、503一時障害。
- クライアントから送られたcustomer_id、role、価格は信用せず、本人と料金をサーバーで決定する。
- すべての変更APIは認証・権限・入力検証・CSRF対策を行う。

## 希望条件

`size`: S/M/L/custom/null、`style`: abstract/landscape/botanical/other/null。
`budgetJpy`: 非負整数またはnull、`budgetAnswered`: boolean。`desiredDate`: 日付またはnull、`desiredDateAnswered`: boolean。
`notes`: 原文の補足。希望条件の候補と確認済みの値を区別する。
必要項目はsize、style、budgetへの回答、希望日への回答。予算なしは明示回答として扱う。
custom/otherや予算不一致は要相談にし、自動で価格を確定しない。

## 相談と見積もり

- 相談：collecting / ready_for_review / ordered / needs_review。
- revisionは条件変更のたびに増やす。メッセージIDの重複を防止する。
- メッセージ：customer / assistant。assistantはアプリのテンプレートによる文。
- 見積もりにはquoteId、revision、仕様スナップショット、amountJpy、expiresAtを含む。
- 見積もり生成はサーバーのみ。未確認候補では生成しない。
- 条件変更時はcollectingへ戻して見積もりを無効化する。ready_for_reviewは有効な見積もりを表示して明示承認を待つ状態。

## HTTP APIの予定

| メソッド・パス | 入力 | 結果 |
|---|---|---|
| POST /api/consultations | 空 | 相談 |
| GET /api/consultations/:id | なし | 会話・条件・revision |
| POST /api/consultations/:id/messages | message、clientMessageId、expectedRevision | 会話・判定候補・次の質問 |
| PATCH /api/consultations/:id/preferences | 明示選択値、expectedRevision | 最新条件とrevision |
| POST /api/consultations/:id/quotes | expectedRevision | 見積もり |
| POST /api/orders | quoteId、expectedRevision、idempotencyKey、contactEmail | 注文と制作タスクID |
| GET /api/orders | なし | 本人の注文一覧 |
| GET /api/orders/:id | なし | 本人の注文と進捗 |
| GET /api/admin/tasks | 状態フィルター | 優先度付き一覧 |
| GET /api/admin/tasks/:id | なし | 管理者向け詳細 |
| PATCH /api/admin/tasks/:id | statusまたはmanualPriorityと理由、expectedVersion | 更新後タスク |
| POST /api/admin/tasks/:id/evaluate | expectedVersion | 更新後評価状態 |

注文確定は顧客の確認ボタンだけから呼ぶ。同じ相談の再送は既存注文を返す。異なる内容で同じ冪等キーを使った場合は409。
DB内で所有権・revision・有効期限を検証して注文とタスクを原子的に作成する。

## Jevアダプター

`evaluateConsultation(input)`は選択候補・確信度・要確認フラグを返す。
`evaluatePriority(input)`は正規化したurgency/complexity、確信度、質問バージョンを返す。
いずれもprovider: mock/jevを返す。自由生成テキストやDB書き込みは行わない。
不正な応答は検証で拒否する。古いinputRevisionの結果を現在の状態へ適用しない。
顧客がボタンやフォームで確認した値をAI推測だけで上書きしない。変更意図を検出したら新しい候補として再確認する。
Scoreは0〜4の5段階基準を定義し、返却scoreを4で割って0〜1に正規化する。範囲外は不正応答として扱う。

## タスクと優先度

タスク：queued / needs_review / in_progress / completed / cancelled。
queued→in_progress、in_progress→completed、queued/in_progress→needs_review、needs_review→queuedを許可。
cancelledへの変更はcompleted以外から可能。終端状態の再開はMVP対象外。
評価：pending / succeeded / failed。状態変更履歴はDB更新と同じトランザクション。
優先度はPROJECT.mdの式を採用。manualPriorityは0〜100で理由必須、解除可能。
未評価は評価待ちの別一覧、要確認は別一覧。制作可能一覧では完了・取消を除く。
注文画面の制作状態はタスクを正とし、orders.statusは受付/取消の状態とする。取消時は注文とタスクを同じトランザクションで更新する。
注文とタスクのコミット後に優先度を評価する。応答時間内に評価できなければpending/failedを保存して注文受付は成功として返す。
Vercelのレスポンス後に未保証の非同期処理を放置しない。MVPでは管理者の再評価APIを確実な再実行経路とする。
評価成功時でもconfidenceが0.5未満で制作待ちならneeds_reviewへ移す。これは初期仮閾値であり、正解率の保証ではない。着手済み・終了済みタスクは評価だけで状態変更しない。

## 2026-09-18 ゲスト相談の改訂

- POST /api/auth/guest: 既存セッションを維持し、未認証ならSupabase匿名セッションを発行。顧客にログインを要求しない。
- Viewer.isAnonymousでゲストを識別。匿名ユーザーにも従来の所有権RLSを適用する。
- 注文確定時にcontactEmailを必須として注文に保存する。メールは連絡先であり、本人確認や既存アカウントへの関連付けには使わない。
- 注文履歴は同じブラウザのセッションで閲覧。別端末でのメール認証による復旧は未実装。
- 管理者はSupabase Authのメール・パスワードでログインし、user_rolesで権限を管理する。
