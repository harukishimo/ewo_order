'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { SessionData } from '@/contracts';
export function SiteSession() {
  const [session, setSession] = useState<SessionData | null>(null);
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    api<SessionData>('/api/session')
      .then((s) => {
        if (alive) setSession(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  return (
    <span className="session-actions">
      {session?.viewer?.role === 'admin' && !path.startsWith('/admin') && (
        <Link href="/admin/tasks">制作管理</Link>
      )}
      {session?.viewer && !session.viewer.isAnonymous ? (
        <>
          <span className="badge">
            {session.viewer.mode === 'demo' ? 'デモ利用中' : 'ログイン中'}
          </span>
          <button
            onClick={async () => {
              await api('/api/auth/logout', { method: 'POST' });
              setSession(null);
              router.push('/');
              router.refresh();
            }}
          >
            ログアウト
          </button>
        </>
      ) : (
        <Link href="/login">管理者ログイン</Link>
      )}
    </span>
  );
}
