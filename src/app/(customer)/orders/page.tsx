'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { type Order, type SessionData, sizeLabels, styleLabels, statusLabels } from '@/contracts';
import { ErrorNotice, money, dateTime } from '@/components/customer/shell';
import { StartButton } from '@/components/customer/start-button';
export default function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<SessionData>('/api/session')
      .then((session) => (session.viewer ? api<Order[]>('/api/orders') : []))
      .then(setOrders)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">YOUR COLLECTION</p>
        <h1>注文一覧</h1>
        <p>このブラウザでご依頼いただいた一枚の、制作の進み具合をご確認いただけます。</p>
      </section>
      <ErrorNotice message={error} />

      {!orders && !error && <p role="status">注文を読み込み中…</p>}
      {orders?.length === 0 && (
        <div className="empty-state card">
          <h2>まだ注文はありません</h2>
          <p>好きな色や飾る場所から、一枚の絵を相談してみませんか。</p>
          <StartButton />
        </div>
      )}
      <div className="order-grid">
        {orders?.map((o) => (
          <Link key={o.id} href={`/orders/${o.id}`} className="order-card card">
            <div className="order-topline">
              <small>{o.orderNumber}</small>
              <span className="badge">{o.task ? statusLabels[o.task.status] : '受付済み'}</span>
            </div>
            <h2>{o.spec.style ? styleLabels[o.spec.style] : '絵画の制作依頼'}</h2>
            <p>{o.spec.size && sizeLabels[o.spec.size]}</p>
            <strong>
              {money(o.amountJpy)} <small>デモ料金</small>
            </strong>
            <p className="microcopy">受付：{dateTime(o.approvedAt)}</p>
            <span>制作状況を見る →</span>
          </Link>
        ))}
      </div>
    </>
  );
}
