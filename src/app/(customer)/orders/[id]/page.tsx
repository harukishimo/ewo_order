'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { type Order, sizeLabels, styleLabels, statusLabels } from '@/contracts';
import { ErrorNotice, money, dateTime } from '@/components/customer/shell';
export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  async function load() {
    setError('');
    try {
      setOrder(await api<Order>(`/api/orders/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    api<Order>(`/api/orders/${id}`)
      .then((o) => {
        if (active) setOrder(o);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [id]);
  const state = order?.task?.status;
  return (
    <>
      <Link className="back-link" href="/orders">
        ← 注文一覧
      </Link>
      <section className="page-heading">
        <p className="eyebrow">YOUR PAINTING</p>
        <h1>ご依頼の一枚</h1>
        <p>{order?.orderNumber ?? '注文詳細'}</p>
      </section>
      <ErrorNotice message={error} />
      {error && (
        <button className="button secondary" onClick={() => void load()}>
          再読み込み
        </button>
      )}
      {!order && !error && <p role="status">注文を読み込み中…</p>}
      {order && (
        <div className="order-detail card">
          <div className="order-topline">
            <h2>{state ? statusLabels[state] : '受付済み'}</h2>
            <button className="text-button" onClick={() => void load()}>
              進捗を更新
            </button>
          </div>
          {state === 'needs_review' ? (
            <p className="notice">制作条件を確認しています。</p>
          ) : state === 'cancelled' ? (
            <p className="notice">この制作依頼はキャンセルされています。</p>
          ) : (
            <ol className="progress-steps">
              {['受付済み', '制作中', '制作完了'].map((s, i) => (
                <li
                  key={s}
                  className={
                    (state === 'completed' ? 2 : state === 'in_progress' ? 1 : 0) >= i
                      ? 'active'
                      : ''
                  }
                >
                  <span>{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          )}
          <dl className="spec-list">
            <div>
              <dt>サイズ</dt>
              <dd>{order.spec.size && sizeLabels[order.spec.size]}</dd>
            </div>
            <div>
              <dt>テイスト</dt>
              <dd>{order.spec.style && styleLabels[order.spec.style]}</dd>
            </div>
            <div>
              <dt>ご予算</dt>
              <dd>{order.spec.budgetJpy === null ? '指定なし' : money(order.spec.budgetJpy)}</dd>
            </div>
            <div>
              <dt>希望日（未確約）</dt>
              <dd>{order.desiredDate || '指定なし'}</dd>
            </div>
            <div>
              <dt>補足</dt>
              <dd>{order.spec.notes || '指定なし'}</dd>
            </div>
            <div>
              <dt>制作価格（デモ料金）</dt>
              <dd className="quote-price">{money(order.amountJpy)}</dd>
            </div>
            <div>
              <dt>連絡用メールアドレス</dt>
              <dd>{order.contactEmail || '未登録'}</dd>
            </div>
            <div>
              <dt>受付日時</dt>
              <dd>{dateTime(order.approvedAt)}</dd>
            </div>
          </dl>
          <p className="microcopy">
            制作依頼を受け付けました。決済は行っていません。希望日は納期の確約ではありません。
            注文の確認には、このブラウザをお使いください。ブラウザのデータを削除すると参照できなくなります。
          </p>
        </div>
      )}
    </>
  );
}
