'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Consultation, SessionData } from '@/contracts';
import { ErrorNotice } from './shell';
export function StartButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div>
      <button
        className="button primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const session = await api<SessionData>('/api/session');
            if (!session.viewer) return router.push('/login');
            const c = await api<Consultation>('/api/consultations', { method: 'POST', body: '{}' });
            router.push(`/consultations/${c.id}`);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '相談を準備中…' : '絵を相談する'} <span aria-hidden>↗</span>
      </button>
      <ErrorNotice message={error} />
    </div>
  );
}
