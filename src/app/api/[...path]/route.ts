import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { demoLogin, isDemo, logout, requireViewer, viewer } from '@/server/auth';
import { demoStore } from '@/server/services/demo-store';
import { supabaseStore } from '@/server/services/supabase-store';
import { AppError } from '@/server/errors';
import { requestOrigin } from '@/server/http';
import { supabase, privilegedSupabase } from '@/lib/supabase/server';
import { evaluateConsultation, evaluatePriority } from '@/server/jev';
import { nextQuestion } from '@/domain';
import {
  messageSchema,
  orderSchema,
  revisionSchema,
  taskSchema,
  updateSchema,
} from '@/server/validation';
import type { Consultation, ConsultationEvaluation, PriorityEvaluation } from '@/contracts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const rate = new Map<string, { count: number; reset: number }>();
function limit(key: string, max = 30) {
  const time = Date.now();
  const item = rate.get(key);
  if (!item || item.reset < time) {
    rate.set(key, { count: 1, reset: time + 60000 });
    if (rate.size > 5000) for (const [k, v] of rate) if (v.reset < time) rate.delete(k);
    return;
  }
  if (item.count >= max)
    throw new AppError(429, 'RATE_LIMIT', '少し時間をおいてからお試しください。');
  item.count++;
}
async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await params).path;
    const method = req.method;
    const key = path.join('/');
    const store = isDemo() ? demoStore : supabaseStore;
    let body: unknown = {};
    if (method !== 'GET') {
      const origin = req.headers.get('origin');
      const expectedOrigin = requestOrigin(req);
      if (origin && origin !== expectedOrigin)
        throw new AppError(403, 'ORIGIN', 'この送信元からは操作できません。');
      if (req.headers.get('sec-fetch-site') === 'cross-site')
        throw new AppError(403, 'ORIGIN', 'この送信元からは操作できません。');
      if (!req.headers.get('content-type')?.startsWith('application/json'))
        throw new AppError(415, 'CONTENT_TYPE', 'JSONで送信してください。');
      const text = await req.text();
      if (text.length > 20000) throw new AppError(413, 'TOO_LARGE', '入力が長すぎます。');
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new AppError(422, 'INVALID_JSON', '入力内容を確認してください。');
      }
    }
    const ok = (data: unknown) =>
      NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    if (key === 'session' && method === 'GET')
      return ok({
        viewer: await viewer(),
        demoAvailable: isDemo(),
        jevMode: process.env.JEV_MODE ?? (isDemo() ? 'mock' : 'jev'),
      });
    if (key === 'auth/demo' && method === 'POST') {
      const input = z.object({ role: z.enum(['customer', 'admin']) }).parse(body);
      return ok(await demoLogin(input.role));
    }
    if (key === 'auth/logout' && method === 'POST') {
      await logout();
      return ok({ success: true });
    }
    if ((key === 'auth/login' || key === 'auth/signup') && method === 'POST') {
      limit(`auth:${req.headers.get('x-forwarded-for') ?? 'local'}`, 10);
      if (isDemo()) throw new AppError(422, 'DEMO', 'デモログインをご利用ください。');
      const input = z
        .object({ email: z.email(), password: z.string().min(8).max(128) })
        .parse(body);
      const db = await supabase();
      const result =
        key === 'auth/signup'
          ? await db.auth.signUp({
              ...input,
              options: { emailRedirectTo: `${requestOrigin(req)}/auth/callback` },
            })
          : await db.auth.signInWithPassword(input);
      if (result.error)
        throw new AppError(
          422,
          'AUTH_ERROR',
          key === 'auth/login'
            ? 'メールアドレスまたはパスワードを確認してください。'
            : '登録できませんでした。入力内容と認証設定を確認してください。',
        );
      return ok({
        viewer: await viewer(),
        message:
          key === 'auth/signup' && !result.data.session
            ? '確認メールを送りました。メールのリンクを開いてからログインしてください。'
            : 'ログインしました。',
      });
    }
    const v = await requireViewer(path[0] === 'admin');
    if (method !== 'GET') {
      if (isDemo()) limit(v.id);
      else {
        const result = await privilegedSupabase().rpc('consume_rate_limit', {
          p_actor_id: v.id,
          p_bucket: 'write',
        });
        if (result.error)
          throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', '一時的に操作を受け付けられません。');
        if (!result.data)
          throw new AppError(429, 'RATE_LIMIT', '少し時間をおいてからお試しください。');
      }
    }
    if (key === 'consultations' && method === 'POST') return ok(await store.createConsultation(v));
    if (path[0] === 'consultations' && path[1]) {
      const id = z.uuid().parse(path[1]);
      if (path.length === 2 && method === 'GET') return ok(await store.getConsultation(v, id));
      if (path[2] === 'preferences' && method === 'PATCH') {
        const input = updateSchema.parse(body);
        return ok(await store.updatePreferences(v, id, input.preferences, input.expectedRevision));
      }
      if (path[2] === 'quotes' && method === 'POST') {
        const { expectedRevision } = z.object({ expectedRevision: revisionSchema }).parse(body);
        return ok(await store.createQuote(v, id, expectedRevision));
      }
      if (path[2] === 'messages' && method === 'POST') {
        const input = messageSchema.parse(body);
        const c: Consultation = await store.getConsultation(v, id);
        const previous = c.messages.find(
          (m) => m.sender === 'customer' && m.clientMessageId === input.clientMessageId,
        );
        if (previous) {
          if (previous.body !== input.message)
            throw new AppError(409, 'CONFLICT', '同じ送信キーで内容を変更することはできません。');
          return ok(c);
        }
        if (c.revision !== input.expectedRevision || c.status === 'ordered')
          throw new AppError(
            409,
            'CONFLICT',
            '内容が更新されています。最新の条件を確認してください。',
          );
        let candidate: ConsultationEvaluation | null = null;
        let reply = '';
        try {
          candidate = await evaluateConsultation({
            message: input.message,
            preferences: c.preferences,
            revision: c.revision,
          });
          reply =
            candidate.size.value || candidate.style.value
              ? 'ご希望の候補を読み取りました。候補を確認して条件に反映してください。'
              : nextQuestion(c.preferences);
          if (candidate.needsReview)
            reply += ' 個別相談が必要な内容が含まれています。補足欄にもご希望を残してください。';
        } catch {
          reply = '判定を利用できません。条件カードの項目を選んで相談を続けられます。';
        }
        return ok(await store.saveMessage(v, id, { ...input, reply, candidate }));
      }
    }
    if (key === 'orders' && method === 'POST') {
      const input = orderSchema.parse(body);
      let order = await store.confirmOrder(v, input);
      if (order.task?.evaluationStatus === 'pending') {
        let evaluation: PriorityEvaluation | null = null;
        try {
          evaluation = await evaluatePriority({
            preferences: order.spec,
            createdAt: order.approvedAt,
          });
        } catch {}
        try {
          await store.saveEvaluation(v, order.task.id, order.task.version, evaluation);
        } catch {
          /* Order already committed. Keep it visible for retry. */
        }
        order = await store.getOrder(v, order.id);
      }
      return ok(order);
    }
    if (key === 'orders' && method === 'GET') return ok(await store.listOrders(v));
    if (path[0] === 'orders' && path.length === 2 && method === 'GET')
      return ok(await store.getOrder(v, z.uuid().parse(path[1])));
    if (key === 'admin/tasks' && method === 'GET') return ok(await store.listTasks(v));
    if (path[0] === 'admin' && path[1] === 'tasks' && path[2]) {
      const id = z.uuid().parse(path[2]);
      if (path.length === 3 && method === 'GET') return ok(await store.getTask(v, id));
      if (path.length === 3 && method === 'PATCH')
        return ok(await store.updateTask(v, id, taskSchema.parse(body)));
      if (path[3] === 'evaluate' && method === 'POST') {
        const { expectedVersion } = z.object({ expectedVersion: revisionSchema }).parse(body);
        const t = await store.getTask(v, id);
        if (t.version !== expectedVersion)
          throw new AppError(409, 'CONFLICT', '最新の制作状態を確認してください。');
        let evaluation: PriorityEvaluation | null = null;
        try {
          evaluation = await evaluatePriority({
            preferences: t.order.spec,
            createdAt: t.createdAt,
          });
        } catch {}
        await store.saveEvaluation(v, id, expectedVersion, evaluation);
        return ok(await store.getTask(v, id));
      }
    }
    throw new AppError(404, 'NOT_FOUND', '対象が見つかりません。');
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION',
            message: '入力内容を確認してください。日付・必須項目・文字数に誤りがあります。',
            retryable: false,
          },
        },
        { status: 422 },
      );
    if (error instanceof AppError)
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            retryable: error.status === 429 || error.status === 503,
          },
        },
        { status: error.status },
      );
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL',
          message: '処理に失敗しました。時間をおいて再試行してください。',
          retryable: true,
        },
      },
      { status: 500 },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH };
