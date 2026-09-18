'use client';
import { use, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { applyMessageProposal, parseMessageHints } from '@/components/customer/parse-hints';
import {
  emptyPreferences,
  sizeLabels,
  styleLabels,
  type Consultation,
  type SessionData,
  type Preferences,
  type Quote,
  type Order,
  type Size,
  type Style,
} from '@/contracts';
import { ErrorNotice, money, dateTime } from '@/components/customer/shell';
export default function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [draft, setDraft] = useState<Preferences>({ ...emptyPreferences });
  const [message, setMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pendingMessage = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    api<SessionData>('/api/session')
      .then((session) => {
        if (active && session.viewer && !session.viewer.isAnonymous) {
          setContactEmail(session.viewer.email ?? '');
        }
      })
      .catch(() => {});
    api<Consultation>(`/api/consultations/${id}`)
      .then((c) => {
        if (active) {
          setConsultation(c);
          setDraft(c.preferences);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [id]);
  async function refresh() {
    const c = await api<Consultation>(`/api/consultations/${id}`);
    setConsultation(c);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      setQuote(null);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!message.trim() || !consultation || busy) return;
    if (pendingMessage.current?.body !== message)
      pendingMessage.current = { body: message, id: crypto.randomUUID() };
    await run(async () => {
      const c = await api<Consultation>(`/api/consultations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          clientMessageId: pendingMessage.current!.id,
          expectedRevision: consultation.revision,
        }),
      });
      setConsultation(c);
      pendingMessage.current = null;
      setMessage('');
      setQuote(null);
    });
  }
  async function save(preferences: Preferences = draft) {
    if (!consultation) return;
    await run(async () => {
      const c = await api<Consultation>(`/api/consultations/${id}/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ preferences, expectedRevision: consultation.revision }),
      });
      setConsultation(c);
      setDraft(c.preferences);
      setQuote(null);
      setNotice('ご希望を保存しました。');
    });
  }
  function edit<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setDraft((p) => ({ ...p, [key]: value }));
    setQuote(null);
  }
  const dirty = consultation
    ? JSON.stringify(draft) !== JSON.stringify(consultation.preferences)
    : false;
  if (!consultation)
    return (
      <section className="page-heading">
        <h1>絵の相談</h1>
        <ErrorNotice message={error} />
        {!error ? (
          <p role="status">相談を読み込み中…</p>
        ) : (
          <Link href="/">トップから新しい相談を始める</Link>
        )}
      </section>
    );
  const latestMessage =
    [...consultation.messages].reverse().find((m) => m.sender === 'customer')?.body ?? '';
  const hints = parseMessageHints(latestMessage);
  const ordered = consultation.status === 'ordered';
  const ready = draft.size && draft.style && draft.budgetAnswered && draft.desiredDateAnswered;
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">YOUR PERSONAL CANVAS</p>
        <h1>絵の相談</h1>
        <p>想いを聞かせてください。一緒に条件を整えていきます。</p>
      </section>
      <ErrorNotice message={error} />
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {ordered && (
        <div className="notice">
          制作依頼を受け付けました。
          {consultation.orderId ? (
            <Link href={`/orders/${consultation.orderId}`}>注文内容を見る →</Link>
          ) : (
            <Link href="/orders">注文一覧へ →</Link>
          )}
        </div>
      )}
      <div className="consultation-grid">
        <section className="chat-panel card" aria-label="相談チャット">
          <div className="chat-heading">
            <span className="atelier-avatar" aria-hidden="true">
              A
            </span>
            <div>
              <strong>Atelierの相談窓口</strong>
              <p>あなたのペースで、お話しください。</p>
            </div>
          </div>
          <div className="messages" role="log" aria-label="相談メッセージ" aria-live="polite">
            {consultation.messages.length === 0 && (
              <div className="message assistant">
                <small>Atelier</small>
                <p>どんな絵をご希望ですか？ 飾る場所や好きな色を教えてください。</p>
              </div>
            )}
            {consultation.messages.map((m) => (
              <div key={m.id} className={`message ${m.sender}`}>
                <small>{m.sender === 'customer' ? 'あなた' : 'Atelier'}</small>
                <p>{m.body}</p>
              </div>
            ))}
          </div>
          {latestMessage && !ordered && (
            <div className="candidate-box">
              <strong>ご希望の候補</strong>
              <p>下記を条件欄に反映し、確認してから「条件を保存する」を押してください。</p>
              <ul>
                {consultation.candidate?.size.value && (
                  <li>サイズ：{sizeLabels[consultation.candidate.size.value]}</li>
                )}
                {consultation.candidate?.style.value && (
                  <li>テイスト：{styleLabels[consultation.candidate.style.value]}</li>
                )}
                {hints.budgetJpy !== undefined && <li>ご予算：{money(hints.budgetJpy)}</li>}
                {hints.desiredDate && <li>希望日：{hints.desiredDate}（未確約）</li>}
                <li>補足に追加する原文：{latestMessage}</li>
              </ul>
              <button
                className="chip"
                disabled={busy}
                onClick={() => {
                  setDraft((p) => applyMessageProposal(p, consultation.candidate, latestMessage));
                  setQuote(null);
                  setNotice(
                    '候補を条件欄に反映しました。内容を確認して「条件を保存する」を押してください。',
                  );
                }}
              >
                候補をまとめて条件に反映
              </button>
              {consultation.candidate?.needsReview && (
                <p className="microcopy">
                  確認が必要なご希望があります。条件欄で修正してください。
                </p>
              )}
            </div>
          )}
          {!ordered && (
            <form onSubmit={send} className="chat-compose">
              <label htmlFor="message">ご希望を入力</label>
              <div>
                <textarea
                  id="message"
                  value={message}
                  maxLength={2000}
                  disabled={busy}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.metaKey || e.ctrlKey) &&
                      e.key === 'Enter' &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="リビングに飾る、青系の抽象画がほしいです。"
                  rows={3}
                />
                <button className="button primary" disabled={busy || !message.trim()}>
                  {busy ? '処理中…' : '送信'}
                </button>
              </div>
              <small>Enterで改行 · ⌘ / Ctrl + Enterで送信</small>
            </form>
          )}
        </section>
        <aside className="preferences-card card">
          <p className="eyebrow">YOUR PREFERENCES</p>
          <h2>ご希望の一枚</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="form-stack"
          >
            <fieldset disabled={busy || ordered}>
              <legend>サイズ</legend>
              <div className="size-options">
                {(Object.keys(sizeLabels) as Size[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`choice ${draft.size === s ? 'selected' : ''}`}
                    aria-pressed={draft.size === s}
                    onClick={() => edit('size', s)}
                  >
                    {sizeLabels[s]}
                    <small>
                      {s === 'custom'
                        ? '個別相談'
                        : `${money({ S: 10000, M: 20000, L: 35000 }[s])}（デモ）`}
                    </small>
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              テイスト
              <select
                value={draft.style ?? ''}
                disabled={busy || ordered}
                onChange={(e) => edit('style', (e.target.value || null) as Style | null)}
              >
                <option value="">選んでください</option>
                {Object.entries(styleLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ご予算（円）
              <input
                type="number"
                min={0}
                step={1000}
                disabled={busy || ordered}
                value={draft.budgetJpy ?? ''}
                placeholder="例：20000"
                onChange={(e) => {
                  setDraft((p) => ({
                    ...p,
                    budgetJpy: e.target.value === '' ? null : Number(e.target.value),
                    budgetAnswered: e.target.value !== '',
                  }));
                  setQuote(null);
                }}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                disabled={busy || ordered}
                checked={draft.budgetAnswered && draft.budgetJpy === null}
                onChange={(e) => {
                  setDraft((p) => ({ ...p, budgetAnswered: e.target.checked, budgetJpy: null }));
                  setQuote(null);
                }}
              />
              予算の指定なし
            </label>
            <label>
              希望日（納期は未確約）
              <input
                type="date"
                disabled={busy || ordered}
                value={draft.desiredDate ?? ''}
                onChange={(e) => {
                  setDraft((p) => ({
                    ...p,
                    desiredDate: e.target.value || null,
                    desiredDateAnswered: !!e.target.value,
                  }));
                  setQuote(null);
                }}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                disabled={busy || ordered}
                checked={draft.desiredDateAnswered && draft.desiredDate === null}
                onChange={(e) => {
                  setDraft((p) => ({
                    ...p,
                    desiredDateAnswered: e.target.checked,
                    desiredDate: null,
                  }));
                  setQuote(null);
                }}
              />
              希望日の指定なし
            </label>
            <label>
              色・用途・そのほかのご希望
              <textarea
                rows={3}
                maxLength={2000}
                disabled={busy || ordered}
                value={draft.notes}
                onChange={(e) => edit('notes', e.target.value)}
              />
            </label>
            {(draft.size === 'custom' || draft.style === 'other') && (
              <p className="notice">
                個別相談が必要です。標準のサイズ・テイストでの依頼のみ、この画面で確定できます。
              </p>
            )}
            {!ordered && (
              <>
                <button className="button secondary" disabled={busy || !dirty}>
                  条件を保存する
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={
                    busy || dirty || !ready || draft.size === 'custom' || draft.style === 'other'
                  }
                  onClick={() =>
                    void run(async () => {
                      const q = await api<Quote>(`/api/consultations/${id}/quotes`, {
                        method: 'POST',
                        body: JSON.stringify({ expectedRevision: consultation.revision }),
                      });
                      setQuote(q);
                    })
                  }
                >
                  見積もりを確認
                </button>
                <small>
                  {dirty
                    ? '変更した条件を保存してください。'
                    : 'サイズ・テイスト・予算・希望日の回答後に確認できます。'}
                </small>
              </>
            )}
          </form>
        </aside>
      </div>
      {quote && !ordered && (
        <section className="quote-card card" aria-label="注文の最終確認">
          <p className="eyebrow">FINAL CONFIRMATION</p>
          <h2>内容をご確認ください</h2>
          <dl className="spec-list">
            <div>
              <dt>サイズ</dt>
              <dd>{quote.spec.size && sizeLabels[quote.spec.size]}</dd>
            </div>
            <div>
              <dt>テイスト</dt>
              <dd>{quote.spec.style && styleLabels[quote.spec.style]}</dd>
            </div>
            <div>
              <dt>補足</dt>
              <dd>{quote.spec.notes || '指定なし'}</dd>
            </div>
            <div>
              <dt>希望日（未確約）</dt>
              <dd>{quote.spec.desiredDate || '指定なし'}</dd>
            </div>
            <div>
              <dt>制作価格（デモ料金）</dt>
              <dd className="quote-price">{money(quote.amountJpy)}</dd>
            </div>
            <div>
              <dt>見積もり有効期限</dt>
              <dd>{dateTime(quote.expiresAt)}</dd>
            </div>
          </dl>
          <p>希望日は納期の確約ではありません。制作依頼の受付です。決済は行いません。</p>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || dirty) return;
              void run(async () => {
                const o = await api<Order>('/api/orders', {
                  method: 'POST',
                  body: JSON.stringify({
                    quoteId: quote.id,
                    expectedRevision: quote.revision,
                    idempotencyKey: quote.id,
                    contactEmail: contactEmail.trim(),
                  }),
                });
                router.push(`/orders/${o.id}`);
              });
            }}
          >
            <label>
              連絡用メールアドレス
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={contactEmail}
                disabled={busy}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <p className="microcopy">
              制作依頼の連絡先として保存します。アカウント登録やパスワードは不要です。
              注文の確認はこのブラウザで行えます。別の端末やブラウザでは参照できません。
            </p>
            <div className="action-row">
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setQuote(null);
                  setNotice('条件カードからご希望を修正してください。');
                }}
              >
                内容を修正
              </button>
              <button className="button primary" disabled={busy || dirty} type="submit">
                {busy ? '受付中…' : 'この内容で注文する'}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
