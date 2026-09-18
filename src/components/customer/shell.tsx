'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { SessionData } from '@/contracts';
export function CustomerShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionData | null>(null);
  useEffect(() => {
    api<SessionData>('/api/session')
      .then(setSession)
      .catch(() => {});
  }, [pathname]);
  return (
    <>
      <header className="atelier-header">
        <Link href="/" className="atelier-logo">
          Atelier<span>オーダーペインティング</span>
        </Link>
        <nav aria-label="メインメニュー">
          <Link href="/orders">注文一覧</Link>
          {session?.viewer?.role === 'admin' && <Link href="/admin/tasks">制作管理</Link>}
          {session?.viewer ? (
            <button
              className="text-button"
              onClick={async () => {
                await api('/api/auth/logout', { method: 'POST' });
                setSession((s) => (s ? { ...s, viewer: null } : s));
                router.push('/');
                router.refresh();
              }}
            >
              ログアウト
            </button>
          ) : (
            <Link href="/login">ログイン</Link>
          )}
        </nav>
      </header>
      {session &&
        (session.jevMode === 'mock' ||
          session.demoAvailable ||
          session.viewer?.mode === 'demo') && (
          <div className="demo-banner">
            {session.jevMode === 'mock' && 'デモ判定 · 実際のJevには接続していません'}
            {(session.demoAvailable || session.viewer?.mode === 'demo') && (
              <span>
                {session.jevMode === 'mock' ? ' ／ ' : ''}デモ環境 ·
                データはこの開発サーバー内に一時保存されます
              </span>
            )}
          </div>
        )}
      <main className="atelier-main" id="main-content">
        {children}
      </main>
      <footer className="atelier-footer">
        Atelier <span>ひとつの想いを、一枚の絵に。</span>
        <small>デモ料金での制作依頼受付です。決済は行いません。</small>
      </footer>
    </>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <p className="notice error" role="alert">
      {message}
    </p>
  ) : null;
}
export const money = (value: number) => `${value.toLocaleString('ja-JP')}円`;
export const dateTime = (value: string) =>
  new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
