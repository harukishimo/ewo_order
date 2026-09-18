# 実装エージェントへの指示

このディレクトリをプロジェクトルートとして作業する。

1. `PROJECT.md`で要件を読む。
2. `ORCHESTRATION.md`で役割・所有範囲・依存関係を確認する。
3. `docs/CONTRACTS.md`で共有契約、`IMPLEMENTATION_STATUS.md`で進捗を確認する。
4. オーケストレーターが担当ファイルを割り当ててから実装する。複数エージェントによる並行実装を使用する。

全員が同じ作業ツリーを共有している。他者の変更を取り消さず、担当外の変更はオーケストレーターへ提案する。共有契約の変更を独断で行わない。

ユーザーの新しい指示を優先する。仕様書の仮設定は確定したユーザー要件と区別する。
APIキーを出力・コミットしない。Jevを文章生成・注文実行主体として扱わない。
未実施のテスト、実API接続、デプロイを成功したと報告しない。
完了時は変更ファイル・実施した検証・残課題を報告する。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
