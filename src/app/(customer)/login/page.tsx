'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Consultation, SessionData } from '@/contracts';
import { ErrorNotice } from '@/components/customer/shell';
export default function Login() {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [signup, setSignup] = useState(false);
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
      await api(`/api/auth/${signup ? 'signup' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (signup) {
        setInfo('登録を受け付けました。確認メールが届いた場合は認証後にログインしてください。');
        setSignup(false);
      } else await start();
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
      <h1>
        相談のつづきを、
        <br />
        ここから。
      </h1>
      <p>ログインして、ご希望の一枚を相談しましょう。</p>
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
            autoComplete={signup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? '処理中…' : signup ? 'アカウントを作成' : 'ログインして相談する'}
        </button>
      </form>
      <button className="text-button" disabled={busy} onClick={() => setSignup(!signup)}>
        {signup ? 'ログインに戻る' : 'はじめての方：アカウントを作成'}
      </button>
      <ErrorNotice message={error} />
      {info && (
        <p className="notice" role="status">
          {info}
        </p>
      )}
      {session?.viewer && (
        <button className="button secondary" disabled={busy} onClick={() => void start()}>
          ログイン中のアカウントで相談を始める
        </button>
      )}
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
