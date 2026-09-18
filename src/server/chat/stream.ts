import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ChatStreamEvent, Consultation, Message, Viewer } from '@/contracts';
import { evaluateConsultation } from '@/server/jev';
import { AppError } from '@/server/errors';
import { preferencesSchema } from '@/server/validation';
import { acceptedProposal, proposalFor } from './proposals';
import { chatMode, streamReply } from './gemini';
import type { ChatStore } from './types';

export async function chatResponse(
  store: ChatStore,
  viewer: Viewer,
  id: string,
  input: { message: string; clientMessageId: string; expectedRevision: number },
) {
  const c = await store.getConsultation(viewer, id);
  const previous = c.messages.find(
    (m) => m.sender === 'customer' && m.clientMessageId === input.clientMessageId,
  );
  if (previous && previous.body !== input.message)
    throw new AppError(409, 'CONFLICT', '同じ送信キーで内容を変更できません。');
  if (!previous && (c.revision !== input.expectedRevision || c.status === 'ordered'))
    throw new AppError(
      409,
      'CONFLICT',
      '内容が更新されています。最新の希望条件を確認してください。',
    );
  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatStreamEvent) => {
        if (!disconnected) {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          } catch {
            disconnected = true;
          }
        }
      };
      const started = performance.now();
      let firstTokenMs: number | null = null;
      let classificationMs: number | null = null;
      try {
        if (previous) {
          emit({ type: 'done', consultation: c });
          return;
        }
        const accepted = acceptedProposal(c, input.message);
        const effective: Consultation = accepted
          ? { ...c, preferences: preferencesSchema.parse({ ...c.preferences, ...accepted.patch }) }
          : c;
        // Start classification before consuming chat tokens. Neither provider waits for the other.
        const classification = evaluateConsultation({
          message: input.message,
          preferences: effective.preferences,
          revision: c.revision,
          history: c.messages,
        })
          .catch(() => null)
          .finally(() => {
            classificationMs = Math.round(performance.now() - started);
          });
        const messageId = randomUUID();
        emit({ type: 'start', messageId, mode: chatMode() });
        let reply = '';
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 22000);
        try {
          await streamReply(
            effective,
            input.message,
            Boolean(accepted),
            (text) => {
              firstTokenMs ??= Math.round(performance.now() - started);
              reply += text;
              emit({ type: 'delta', text });
            },
            abort.signal,
          );
        } catch {
          const fallback = reply
            ? '\n返答の接続が途切れました。受け取ったご希望の確認は続けます。'
            : '会話AIに一時的につながりません。ご希望は受け取りました。読み取れた条件は続けて確認します。';
          reply += fallback;
          emit({ type: 'delta', text: fallback });
        } finally {
          clearTimeout(timer);
          abort.abort();
        }
        const candidate = await classification;
        const proposal = accepted ? null : proposalFor(c, input.message, candidate);
        const replies: Message[] = [
          { id: messageId, sender: 'assistant', body: reply, createdAt: new Date().toISOString() },
        ];
        if (proposal)
          replies.push({
            id: proposal.id,
            sender: 'assistant',
            body: proposal.message,
            createdAt: new Date().toISOString(),
          });
        // Only a committed turn is shown as an actionable follow-up. CAS protects against edits/tabs.
        const saved = await store.saveChatTurn(viewer, id, {
          ...input,
          replies,
          candidate,
          pendingProposal: proposal,
          acceptedProposalId: accepted?.id ?? null,
        });
        if (proposal) {
          const persisted = saved.messages.find((m) => m.id === proposal.id);
          if (persisted) emit({ type: 'followup', message: persisted });
        }
        emit({ type: 'done', consultation: saved });
        if (process.env.NODE_ENV !== 'test')
          console.info('chat_timing', {
            mode: chatMode(),
            firstTokenMs,
            classificationMs,
            totalMs: Math.round(performance.now() - started),
          });
      } catch (error) {
        emit({
          type: 'error',
          message:
            error instanceof AppError
              ? error.message
              : '会話を保存できませんでした。同じ内容で再試行してください。',
          retryable: !(error instanceof AppError) || error.status >= 500,
        });
      } finally {
        if (!disconnected) {
          try {
            controller.close();
          } catch {}
        }
      }
    },
    cancel() {
      disconnected = true;
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
