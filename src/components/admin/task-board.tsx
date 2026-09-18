'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AdminTask, TaskStatus } from '@/contracts';
import { sizeLabels, styleLabels, statusLabels } from '@/contracts';
import { api } from '@/lib/api';
export function TaskBoard() {
  const [tasks, setTasks] = useState<AdminTask[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('active');
  async function load() {
    try {
      setError('');
      setTasks(await api<AdminTask[]>('/api/admin/tasks'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得できませんでした。');
    }
  }
  useEffect(() => {
    let active = true;
    api<AdminTask[]>('/api/admin/tasks')
      .then((v) => {
        if (active) setTasks(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const terminal = (t: AdminTask) => t.status === 'completed' || t.status === 'cancelled';
  const filtered = (tasks ?? []).filter(
    (t) => filter === 'all' || (filter === 'active' ? !terminal(t) : t.status === filter),
  );
  const review = filtered.filter((t) => t.status === 'needs_review');
  const pending = filtered.filter(
    (t) => !terminal(t) && t.status !== 'needs_review' && t.evaluationStatus !== 'succeeded',
  );
  const ready = filtered
    .filter(
      (t) => t.status !== 'needs_review' && (terminal(t) || t.evaluationStatus === 'succeeded'),
    )
    .sort((a, b) => b.priorityScore - a.priorityScore || a.createdAt.localeCompare(b.createdAt));
  return (
    <main className="admin-main">
      <div className="admin-eyebrow">ATELIER / PRODUCTION</div>
      <div className="admin-heading">
        <div>
          <h1>制作ボード</h1>
          <p>次に描く一枚を、ここから。</p>
        </div>
        <Link href="/">顧客画面へ ↗</Link>
      </div>
      {error && (
        <div role="alert" className="admin-error">
          {error} <button onClick={load}>再読み込み</button> <Link href="/login">ログインへ</Link>
        </div>
      )}
      {!tasks && !error && <p role="status">制作タスクを読み込み中…</p>}
      {tasks && (
        <>
          {tasks.some((t) => t.evaluation?.provider === 'mock') && (
            <p className="admin-notice">デモ判定 · 実際のJevには接続していません</p>
          )}
          <div className="admin-stats">
            {[
              ['制作待ち', tasks.filter((t) => t.status === 'queued').length],
              ['制作中', tasks.filter((t) => t.status === 'in_progress').length],
              ['要確認', tasks.filter((t) => t.status === 'needs_review').length],
              [
                '評価待ち',
                tasks.filter((t) => !terminal(t) && t.evaluationStatus !== 'succeeded').length,
              ],
            ].map(([label, count]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
          <div className="admin-filter">
            <label htmlFor="task-filter">表示する状態</label>
            <select id="task-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="active">対応中のすべて</option>
              <option value="all">すべて（完了・取消を含む）</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <button onClick={load}>更新</button>
          </div>
          <TaskSection
            title="要確認"
            description="条件や制作内容を確認し、制作待ちへ戻してください。"
            tasks={review}
            kind="review"
          />
          <TaskSection
            title="評価待ち"
            description="評価に失敗した依頼もここに表示します。詳細から再評価できます。"
            tasks={pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt))}
            kind="pending"
          />
          <TaskSection
            title={filter === 'completed' || filter === 'cancelled' ? '制作履歴' : '制作キュー'}
            description="優先度の高い順。同点の場合は受付の古い順です。"
            tasks={ready}
            kind="ready"
          />
        </>
      )}
    </main>
  );
}
function TaskSection({
  title,
  description,
  tasks,
  kind,
}: {
  title: string;
  description: string;
  tasks: AdminTask[];
  kind: string;
}) {
  return (
    <section className={`admin-section admin-section-${kind}`}>
      <div className="admin-section-heading">
        <h2>
          {title} <span>{tasks.length}件</span>
        </h2>
        <p>{description}</p>
      </div>
      {tasks.length === 0 ? (
        <p className="admin-empty">この条件の制作タスクはありません。</p>
      ) : (
        <div className="admin-task-list">
          {tasks.map((t) => (
            <article key={t.id} className="admin-task-row">
              <div>
                <span className="admin-field-label">優先度</span>
                <strong className="admin-score">
                  {t.evaluationStatus === 'succeeded' || t.manualPriority !== null
                    ? t.priorityScore.toFixed(1)
                    : '—'}
                </strong>
                <small>
                  {t.manualPriority !== null
                    ? '手動設定'
                    : t.evaluationStatus === 'failed'
                      ? '評価失敗・再評価が必要'
                      : t.evaluationStatus === 'pending'
                        ? '評価待ち'
                        : '自動算出'}
                </small>
              </div>
              <div>
                <span className="admin-field-label">注文・作品条件</span>
                <strong>{t.order.orderNumber}</strong>
                <p>
                  {t.order.spec.size ? sizeLabels[t.order.spec.size] : '未指定'} /{' '}
                  {t.order.spec.style ? styleLabels[t.order.spec.style] : '未指定'}
                </p>
                <small>
                  受付{' '}
                  {new Date(t.createdAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                </small>
              </div>
              <div>
                <span className="admin-field-label">希望日（未確約）</span>
                <span>{t.order.desiredDate ?? '希望日なし'}</span>
              </div>
              <div>
                <span className="admin-field-label">状態</span>
                <StatusBadge status={t.status} />
              </div>
              <Link
                className="admin-detail-link"
                href={`/admin/tasks/${t.id}`}
                aria-label={`${t.order.orderNumber}の制作詳細`}
              >
                詳細を見る →
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`admin-badge admin-badge-${status}`}>{statusLabels[status]}</span>;
}
