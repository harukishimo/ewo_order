'use client';
import { use, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { readChatStream } from '@/components/customer/chat-stream';
import { AssistantAvatar } from '@/components/customer/assistant-avatar';
import {
  emptyPreferences,
  sizeLabels,
  styleLabels,
  type Consultation,
  type SessionData,
  type Preferences,
  type Quote,
  type Order,
  type Message,
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
  const [streamText, setStreamText] = useState('');
  const [outgoing, setOutgoing] = useState<{ body: string; id: string } | null>(null);
  const [followups, setFollowups] = useState<Message[]>([]);
  const [chatMode, setChatMode] = useState<'gemini' | 'demo' | 'unavailable' | null>(null);
  const [chatStatus, setChatStatus] = useState<'idle' | 'thinking' | 'speaking' | 'error'>('idle');
  const messagesRef = useRef<HTMLDivElement>(null);
  const followScroll = useRef(true);
  const streamAbort = useRef<AbortController | null>(null);
  const speakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const panel = messagesRef.current;
    if (panel && followScroll.current) panel.scrollTop = panel.scrollHeight;
  }, [streamText, followups, outgoing, consultation]);
  useEffect(
    () => () => {
      streamAbort.current?.abort();
      if (speakingTimer.current) clearTimeout(speakingTimer.current);
    },
    [id],
  );
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
    if (!message.trim() || !consultation || busy || streamAbort.current) return;
    if (pendingMessage.current?.body !== message)
      pendingMessage.current = { body: message, id: crypto.randomUUID() };
    const sent = pendingMessage.current!;
    setBusy(true);
    setError('');
    setNotice('');
    setQuote(null);
    setOutgoing(sent);
    setStreamText('');
    setFollowups([]);
    if (speakingTimer.current) clearTimeout(speakingTimer.current);
    setChatStatus('thinking');
    followScroll.current = true;
    const controller = new AbortController();
    streamAbort.current = controller;
    try {
      const response = await fetch(`/api/consultations/${id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: sent.body,
          clientMessageId: sent.id,
          expectedRevision: consultation.revision,
        }),
      });
      await readChatStream(response, (event) => {
        if (event.type === 'start') setChatMode(event.mode);
        if (event.type === 'delta') {
          setStreamText((text) => text + event.text);
          setChatStatus('speaking');
        }
        if (event.type === 'followup') {
          setFollowups((items) =>
            items.some((item) => item.id === event.message.id) ? items : [...items, event.message],
          );
          setChatStatus('speaking');
        }
        if (event.type === 'done') {
          setConsultation(event.consultation);
          setDraft((current) =>
            JSON.stringify(current) === JSON.stringify(consultation.preferences)
              ? event.consultation.preferences
              : current,
          );
          setOutgoing(null);
          setStreamText('');
          setFollowups([]);
          pendingMessage.current = null;
          setMessage('');
        }
      });
      // Let the avatar acknowledge a follow-up even when done arrives in the same chunk.
      speakingTimer.current = setTimeout(() => setChatStatus('idle'), 600);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError((failure as Error).message);
      setChatStatus('error');
      // A response can be lost after the transaction commits. Recover before retrying.
      const recovered = await api<Consultation>(`/api/consultations/${id}`).catch(() => null);
      if (recovered) {
        setConsultation(recovered);
        if (recovered.messages.some((item) => item.clientMessageId === sent.id)) {
          setDraft((current) =>
            JSON.stringify(current) === JSON.stringify(consultation.preferences)
              ? recovered.preferences
              : current,
          );
          pendingMessage.current = null;
          setMessage('');
          setNotice('送信済みの会話を復元しました。');
          setError('');
          setChatStatus('idle');
        }
      }
      setOutgoing(null);
      setStreamText('');
      setFollowups([]);
    } finally {
      setBusy(false);
      streamAbort.current = null;
    }
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
            <AssistantAvatar status={chatStatus} className="chat-avatar" />
            <div>
              <span className="eyebrow">YOUR ART COMPANION</span>
              <strong>Atelier アシスタント</strong>
              <p>あなたの部屋に、あなたらしい一枚を。</p>
              <span className="assistant-status" role="status">
                {chatStatus === 'thinking'
                  ? 'お話を読んでいます…'
                  : chatStatus === 'speaking'
                    ? 'お返事しています…'
                    : chatStatus === 'error'
                      ? '通信を確認してください'
                      : 'お話を聞かせてください'}
              </span>
            </div>
          </div>
          {chatMode === 'demo' && (
            <p className="chat-service-note">デモ会話です。実際のAIには接続していません。</p>
          )}
          {chatMode === 'unavailable' && (
            <p className="chat-service-note" role="status">
              AI会話は現在利用できません。右の条件欄からご希望を入力できます。
            </p>
          )}
          <div
            ref={messagesRef}
            onScroll={() => {
              const panel = messagesRef.current;
              if (panel)
                followScroll.current =
                  panel.scrollHeight - panel.scrollTop - panel.clientHeight < 100;
            }}
            className="messages"
            role="log"
            aria-label="相談メッセージ"
            aria-live="polite"
            aria-relevant="additions text"
          >
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
            {outgoing &&
              !consultation.messages.some((item) => item.clientMessageId === outgoing.id) && (
                <div className="message customer">
                  <small>あなた</small>
                  <p>{outgoing.body}</p>
                </div>
              )}
            {streamText && (
              <div className="message assistant streaming">
                <small>Atelier</small>
                <p>{streamText}</p>
              </div>
            )}
            {followups
              .filter((item) => !consultation.messages.some((saved) => saved.id === item.id))
              .map((item) => (
                <div key={item.id} className="message assistant">
                  <small>Atelier</small>
                  <p>{item.body}</p>
                </div>
              ))}
            {chatStatus === 'thinking' && (
              <div className="message assistant thinking" aria-label="返答を準備中">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
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
          <p className="preferences-help">
            会話で確認した条件がここにまとまります。直接編集することもできます。
          </p>
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
