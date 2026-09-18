'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AdminTask, TaskStatus } from '@/contracts';
import { sizeLabels, styleLabels } from '@/contracts';
import { api } from '@/lib/api';
import { StatusBadge } from './task-board';
export function TaskDetail({ id }: { id: string }) {
  const [task, setTask] = useState<AdminTask | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [priority, setPriority] = useState('50');
  const [reason, setReason] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const path = `/api/admin/tasks/${id}`;
  async function load() {
    try {
      const data = await api<AdminTask>(path);
      setTask(data);
      setLoadedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得できませんでした。');
    }
  }
  useEffect(() => {
    let active = true;
    api<AdminTask>(path)
      .then((t) => {
        if (active) {
          setTask(t);
          setLoadedAt(Date.now());
          setPriority(String(t.manualPriority ?? 50));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function change(payload: Record<string, unknown>, evaluate = false) {
    if (!task) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api<AdminTask>(`${path}${evaluate ? '/evaluate' : ''}`, {
        method: evaluate ? 'POST' : 'PATCH',
        body: JSON.stringify({ expectedVersion: task.version, ...payload }),
      });
      setTask(updated);
      setLoadedAt(Date.now());
      setNotice('更新しました。');
      setCancelConfirm(false);
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : '更新に失敗しました。'} 最新の内容を再取得しました。確認してから再操作してください。`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  const setStatus = (status: TaskStatus) => change({ status });
  const terminal = task?.status === 'completed' || task?.status === 'cancelled';
  return (
    <main className="admin-main">
      <Link href="/admin/tasks">← 制作ボードに戻る</Link>
      <div className="admin-heading">
        <div>
          <div className="admin-eyebrow">PRODUCTION DETAIL</div>
          <h1>{task?.order.orderNumber ?? '制作の詳細'}</h1>
        </div>
        {task && <StatusBadge status={task.status} />}
      </div>
      {error && (
        <div className="admin-error" role="alert">
          {error} <button onClick={load}>再読み込み</button> <Link href="/login">ログインへ</Link>
        </div>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
      {!task && !error && <p role="status">制作詳細を読み込み中…</p>}
      {task && (
        <>
          {task.evaluation?.provider === 'mock' && (
            <p className="admin-notice">デモ判定 · 実際のJevには接続していません</p>
          )}
          <div className="admin-detail-grid">
            <section className="admin-panel">
              <h2>ご依頼の一枚</h2>
              <dl className="admin-spec">
                <div>
                  <dt>サイズ</dt>
                  <dd>{task.order.spec.size ? sizeLabels[task.order.spec.size] : '未指定'}</dd>
                </div>
                <div>
                  <dt>テイスト</dt>
                  <dd>{task.order.spec.style ? styleLabels[task.order.spec.style] : '未指定'}</dd>
                </div>
                <div>
                  <dt>受付価格（デモ料金）</dt>
                  <dd>¥{task.order.amountJpy.toLocaleString('ja-JP')}</dd>
                </div>
                <div>
                  <dt>ご予算</dt>
                  <dd>
                    {task.order.spec.budgetJpy === null
                      ? '予算指定なし'
                      : `¥${task.order.spec.budgetJpy.toLocaleString('ja-JP')}`}
                  </dd>
                </div>
                <div>
                  <dt>希望日（未確約）</dt>
                  <dd>{task.order.desiredDate ?? '希望日なし'}</dd>
                </div>
                <div>
                  <dt>受付日時</dt>
                  <dd>{formatDate(task.createdAt)}</dd>
                </div>
              </dl>
              <h3>補足・ご希望</h3>
              <p className="admin-notes">{task.order.spec.notes || '補足はありません。'}</p>
              <p className="admin-caption">
                制作依頼の受付です。決済・発送はこのアプリでは行いません。
              </p>
            </section>
            <section className="admin-panel">
              <h2>制作を進める</h2>
              <p>
                現在の状態：
                <StatusBadge status={task.status} />
              </p>
              <div className="admin-actions">
                {task.status === 'queued' && (
                  <button
                    className="admin-primary"
                    disabled={busy}
                    onClick={() => setStatus('in_progress')}
                  >
                    制作を開始
                  </button>
                )}
                {task.status === 'in_progress' && (
                  <button
                    className="admin-primary"
                    disabled={busy}
                    onClick={() => setStatus('completed')}
                  >
                    制作を完了
                  </button>
                )}
                {task.status === 'needs_review' && (
                  <button
                    className="admin-primary"
                    disabled={busy}
                    onClick={() => setStatus('queued')}
                  >
                    確認済み・制作待ちに戻す
                  </button>
                )}
                {(task.status === 'queued' || task.status === 'in_progress') && (
                  <button disabled={busy} onClick={() => setStatus('needs_review')}>
                    要確認にする
                  </button>
                )}
                {terminal && <p>この制作タスクは終了しています。</p>}
              </div>
              {!terminal && (
                <details className="admin-cancel">
                  <summary>注文のキャンセル</summary>
                  <p>
                    注文 {task.order.orderNumber}{' '}
                    の制作依頼を取り消します。この操作後は制作を再開できません。
                  </p>
                  <label className="admin-checkbox">
                    <input
                      type="checkbox"
                      checked={cancelConfirm}
                      onChange={(e) => setCancelConfirm(e.target.checked)}
                    />
                    対象の注文番号と取消内容を確認しました
                  </label>
                  <button
                    className="admin-danger"
                    disabled={busy || !cancelConfirm}
                    onClick={() => setStatus('cancelled')}
                  >
                    この注文をキャンセル
                  </button>
                </details>
              )}
            </section>
          </div>
          <section className="admin-panel admin-priority">
            <h2>制作優先度</h2>
            <div className="admin-priority-top">
              <strong className="admin-score">
                {task.evaluationStatus === 'succeeded' || task.manualPriority !== null
                  ? task.priorityScore.toFixed(1)
                  : '—'}
                <small> / 100</small>
              </strong>
              <span>
                {task.manualPriority !== null
                  ? '手動設定'
                  : task.evaluationStatus === 'succeeded'
                    ? '自動算出'
                    : task.evaluationStatus === 'failed'
                      ? '評価失敗'
                      : '評価待ち'}
              </span>
            </div>
            <p>緊急性 × 60 ＋ 希望日の近さ × 25 ＋ 待機期間 × 15。複雑度は優先度に加算しません。</p>
            {task.evaluation ? (
              <dl className="admin-score-grid">
                <div>
                  <dt>緊急性</dt>
                  <dd>{Math.round(task.evaluation.urgency * 100)}%</dd>
                </div>
                <div>
                  <dt>希望日の近さ</dt>
                  <dd>{Math.round(deadlinePressure(task.order.desiredDate, loadedAt) * 100)}%</dd>
                </div>
                <div>
                  <dt>待機期間</dt>
                  <dd>
                    {Math.max(
                      0,
                      Math.floor((loadedAt - new Date(task.createdAt).getTime()) / 86400000),
                    )}
                    日
                  </dd>
                </div>
                <div>
                  <dt>制作複雑度</dt>
                  <dd>{Math.round(task.evaluation.complexity * 100)}%</dd>
                </div>
                <div>
                  <dt>モデルの確信度</dt>
                  <dd>{Math.round(task.evaluation.confidence * 100)}%</dd>
                </div>
              </dl>
            ) : (
              <p>優先度の判定結果はまだありません。再評価してください。</p>
            )}
            <p className="admin-caption">
              確信度はモデルの判断の確かさを表す指標で、正解率ではありません。
            </p>
            <button disabled={busy} onClick={() => change({}, true)}>
              {busy ? '更新中…' : '再評価する'}
            </button>
            <form
              className="admin-override"
              onSubmit={(e) => {
                e.preventDefault();
                change({ manualPriority: Number(priority), overrideReason: reason });
              }}
            >
              <h3>優先度を変更</h3>
              <label htmlFor="priority">手動優先度（0〜100）</label>
              <input
                id="priority"
                type="number"
                min="0"
                max="100"
                step="1"
                required
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
              <label htmlFor="override-reason">変更・解除の理由</label>
              <textarea
                id="override-reason"
                required
                maxLength={500}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例：展示日が確定したため先に制作"
              />
              <div className="admin-actions">
                <button disabled={busy || !reason.trim() || priority === ''} type="submit">
                  理由を記録して変更
                </button>
                {task.manualPriority !== null && (
                  <button
                    type="button"
                    disabled={busy || !reason.trim()}
                    onClick={() => change({ manualPriority: null, overrideReason: reason })}
                  >
                    手動設定を解除
                  </button>
                )}
              </div>
              {task.overrideReason && <p>現在の設定理由：{task.overrideReason}</p>}
            </form>
          </section>
          <section className="admin-panel">
            <h2>変更履歴</h2>
            {task.events.length === 0 ? (
              <p>変更履歴はありません。</p>
            ) : (
              <ol className="admin-history">
                {[...task.events]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((event) => (
                    <li key={event.id}>
                      <time>{formatDate(event.createdAt)}</time>
                      <strong>{eventLabel(event.eventType)}</strong>
                      <p>{event.details}</p>
                      <small>変更者：{event.actorId}</small>
                    </li>
                  ))}
              </ol>
            )}
          </section>
        </>
      )}
    </main>
  );
}
function formatDate(date: string) {
  return new Date(date).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}
function deadlinePressure(date: string | null, now: number) {
  if (!date) return 0;
  const today = Math.floor((now + 9 * 3600000) / 86400000);
  const target = Math.floor(
    (new Date(`${date}T00:00:00+09:00`).getTime() + 9 * 3600000) / 86400000,
  );
  return Math.max(0, Math.min(1, (14 - (target - today)) / 14));
}
function eventLabel(type: string) {
  return (
    (
      {
        status_changed: '制作状態を変更',
        priority_overridden: '優先度を変更',
        priority_updated: '優先度を変更',
        evaluated: '優先度を評価',
        created: '制作依頼を受付',
      } as Record<string, string>
    )[type] ?? type
  );
}
