'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Consultation, SessionData } from '@/contracts';
import { StartButton } from '@/components/customer/start-button';
import { ErrorNotice } from '@/components/customer/shell';
export default function Login() {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<SessionData>('/api/session')
      .then(setSession)
      .catch((e) => setError(e.message));
  }, []);
  async function start() {
    const c = await api<Consultation>('/api/consultations', { method: 'POST', body: '{}' });
    router.push(`/consultations/${c.id}`);
    router.refresh();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const current = await api<SessionData>('/api/session');
      router.push(current.viewer?.role === 'admin' ? '/admin/tasks' : '/orders');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function demo(role: 'customer' | 'admin') {
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role }) });
      if (role === 'admin') {
        router.push('/admin/tasks');
        router.refresh();
      } else await start();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="login-card card">
      <p className="eyebrow">WELCOME TO ATELIER</p>
      <h1>管理者ログイン</h1>
      <p>制作管理を利用する方はこちら。絵の相談・注文にログインは不要です。</p>
      <StartButton />
      <form onSubmit={submit} className="form-stack">
        <label>
          メールアドレス
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            minLength={8}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? '処理中…' : 'ログイン'}
        </button>
      </form>
      <ErrorNotice message={error} />
      {session?.demoAvailable && (
        <div className="demo-login">
          <h2>デモを体験する</h2>
          <p>登録不要。データは開発サーバーに一時保存されます。</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void demo('customer')}
          >
            顧客として試す
          </button>
          <button className="text-button" disabled={busy} onClick={() => void demo('admin')}>
            管理者として試す
          </button>
        </div>
      )}
    </section>
  );
}
