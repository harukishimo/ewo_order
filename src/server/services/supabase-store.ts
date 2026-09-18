import 'server-only';
import type {
  AdminTask,
  Consultation,
  ConsultationEvaluation,
  Message,
  Order,
  Preferences,
  PriorityEvaluation,
  Quote,
  Task,
  TaskEvent,
  TaskStatus,
  Viewer,
} from '@/contracts';
import { calculatePriority, validateReady } from '@/domain';
import { supabase, privilegedSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/errors';
import type { ChatTurn } from '@/server/chat/types';

type Row = Record<string, unknown>;
function fail(error: { message: string } | null) {
  if (!error) return;
  const text = error.message;
  const errors: [string, number, string][] = [
    ['not_found', 404, '対象が見つかりません。'],
    ['unauthorized', 401, 'ログインしてください。'],
    ['forbidden', 403, 'この操作の権限がありません。'],
    ['revision_conflict', 409, '内容が更新されています。読み直してから確認してください。'],
    ['version_conflict', 409, 'タスクが更新されています。読み直してください。'],
    ['idempotency_conflict', 409, '同じ送信キーで異なる注文は確定できません。'],
    ['quote_expired', 409, '見積もりの有効期限が切れました。再度見積もりを作成してください。'],
    ['price_changed', 409, '料金が変更されました。新しい見積もりをご確認ください。'],
    ['needs_review', 422, '条件を確認してください。対応外の内容や予算不一致は個別相談が必要です。'],
    ['invalid_', 422, '入力内容または状態の変更を確認してください。'],
  ];
  const match = errors.find(([code]) => text.includes(code));
  if (match) throw new AppError(match[1], match[0].toUpperCase(), match[2]);
  throw new AppError(
    503,
    'DATABASE_ERROR',
    'データを保存・取得できませんでした。時間をおいて再試行してください。',
  );
}
function required<T>(data: T | null): T {
  if (!data) throw new AppError(404, 'NOT_FOUND', '対象が見つかりません。');
  return data;
}
function admin(viewer: Viewer) {
  if (viewer.role !== 'admin' || viewer.isAnonymous)
    throw new AppError(403, 'FORBIDDEN', '管理者権限が必要です。');
}
function mapQuote(r: Row): Quote {
  return {
    id: r.id as string,
    consultationId: r.consultation_id as string,
    revision: r.revision as number,
    spec: r.spec_snapshot as Preferences,
    amountJpy: r.amount_jpy as number,
    expiresAt: r.expires_at as string,
  };
}
function mapTask(r: Row, desiredDate: string | null): Task {
  const evaluation: PriorityEvaluation | null =
    r.evaluation_status === 'succeeded'
      ? {
          provider: r.provider as 'mock' | 'jev',
          urgency: r.urgency as number,
          complexity: r.complexity as number,
          confidence: r.confidence as number,
          questionVersion: r.question_version as string,
        }
      : null;
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    status: r.status as TaskStatus,
    version: r.version as number,
    evaluationStatus: r.evaluation_status as Task['evaluationStatus'],
    evaluation,
    manualPriority: r.manual_priority as number | null,
    overrideReason: r.override_reason as string | null,
    createdAt: r.created_at as string,
    priorityScore: calculatePriority({
      urgency: evaluation?.urgency ?? 0,
      desiredDate,
      createdAt: r.created_at as string,
      manualPriority: r.manual_priority as number | null,
    }),
  };
}
function mapOrder(r: Row, task: Row | null): Order {
  return {
    id: r.id as string,
    orderNumber: r.order_number as string,
    customerId: r.customer_id as string,
    contactEmail: (r.contact_email as string | null) ?? null,
    consultationId: r.consultation_id as string,
    quoteId: r.quote_id as string,
    spec: r.spec_snapshot as Preferences,
    amountJpy: r.amount_jpy as number,
    desiredDate: r.desired_date as string | null,
    approvedAt: r.approved_at as string,
    status: r.status as Order['status'],
    task: task ? mapTask(task, r.desired_date as string | null) : null,
  };
}
function mapEvent(r: Row): TaskEvent {
  const old = (r.old_values ?? {}) as Row,
    next = (r.new_values ?? {}) as Row;
  let details = '制作依頼を受け付けました。';
  if (r.event_type === 'evaluated')
    details = `優先度評価：${next.evaluation_status === 'succeeded' ? '完了' : '再評価待ち'}`;
  else if (r.event_type === 'updated') {
    const parts: string[] = [];
    if (old.status !== next.status) parts.push(`状態：${old.status} → ${next.status}`);
    if (
      old.manual_priority !== next.manual_priority ||
      old.override_reason !== next.override_reason
    )
      parts.push(
        next.manual_priority === null
          ? '優先度上書きを解除'
          : `優先度を${next.manual_priority}に変更（${next.override_reason}）`,
      );
    details = parts.join(' / ') || 'タスクを更新しました。';
  }
  return {
    id: r.id as string,
    eventType: r.event_type as string,
    createdAt: r.created_at as string,
    actorId: r.actor_id as string,
    details,
  };
}
async function getConsultation(viewer: Viewer, id: string): Promise<Consultation> {
  const db = await supabase();
  const result = await db
    .from('consultations')
    .select('*')
    .eq('id', id)
    .eq('customer_id', viewer.id)
    .maybeSingle();
  fail(result.error);
  const r = required(result.data) as Row;
  const [messages, orders] = await Promise.all([
    db
      .from('messages')
      .select('*')
      .eq('consultation_id', id)
      .order('created_at')
      .order('sender', { ascending: false }),
    db.from('orders').select('id').eq('consultation_id', id).maybeSingle(),
  ]);
  fail(messages.error);
  fail(orders.error);
  const mapped: Message[] = (messages.data ?? []).map((m: Row) => ({
    id: m.id as string,
    sender: m.sender as Message['sender'],
    body: m.body as string,
    createdAt: m.created_at as string,
    clientMessageId: m.client_message_id as string,
  }));
  if (!mapped.length)
    mapped.push({
      id: `welcome-${id}`,
      sender: 'assistant',
      body: 'どんな絵をお探しですか？ 飾る場所や、お好きな色・雰囲気を教えてください。',
      createdAt: r.created_at as string,
    });
  return {
    id: r.id as string,
    customerId: r.customer_id as string,
    status: r.status as Consultation['status'],
    preferences: r.confirmed_preferences as Preferences,
    revision: r.revision as number,
    messages: mapped,
    candidate: r.candidates as ConsultationEvaluation | null,
    pendingProposal: (r.pending_proposal ?? null) as Consultation['pendingProposal'],
    createdAt: r.created_at as string,
    ...(orders.data ? { orderId: orders.data.id as string } : {}),
  };
}
async function getOrder(viewer: Viewer, id: string): Promise<Order> {
  const db = await supabase();
  const q = db.from('orders').select('*').eq('id', id);
  if (viewer.role !== 'admin' || viewer.isAnonymous) q.eq('customer_id', viewer.id);
  const result = await q.maybeSingle();
  fail(result.error);
  const r = required(result.data) as Row;
  const t = await db.from('production_tasks').select('*').eq('order_id', id).maybeSingle();
  fail(t.error);
  return mapOrder(r, t.data as Row | null);
}
async function getTask(viewer: Viewer, id: string): Promise<AdminTask> {
  admin(viewer);
  const db = await supabase();
  const result = await db.from('production_tasks').select('*').eq('id', id).maybeSingle();
  fail(result.error);
  const r = required(result.data) as Row;
  const [order, events] = await Promise.all([
    db.from('orders').select('*').eq('id', r.order_id).single(),
    db.from('task_events').select('*').eq('task_id', id).order('created_at', { ascending: false }),
  ]);
  fail(order.error);
  fail(events.error);
  const o = mapOrder(required(order.data) as Row, null);
  const { task: _task, ...base } = o;
  void _task;
  return { ...mapTask(r, o.desiredDate), order: base, events: (events.data ?? []).map(mapEvent) };
}
export const supabaseStore = {
  async createConsultation(viewer: Viewer): Promise<Consultation> {
    const db = await supabase();
    const r = await db.rpc('create_consultation').single();
    fail(r.error);
    return getConsultation(viewer, (required(r.data) as Row).id as string);
  },
  getConsultation,
  async saveMessage(
    viewer: Viewer,
    id: string,
    input: {
      expectedRevision: number;
      clientMessageId: string;
      message: string;
      reply: string;
      candidate: ConsultationEvaluation | null;
    },
  ): Promise<Consultation> {
    await getConsultation(viewer, id);
    const r = await privilegedSupabase().rpc('save_messages', {
      p_customer_id: viewer.id,
      p_consultation_id: id,
      p_expected_revision: input.expectedRevision,
      p_client_message_id: input.clientMessageId,
      p_message: input.message,
      p_reply: input.reply,
      p_candidates: input.candidate,
      p_model:
        input.candidate?.provider === 'mock'
          ? 'mock'
          : (process.env.TYPESAFE_MODEL ?? 'jev-latest'),
    });
    fail(r.error);
    return getConsultation(viewer, id);
  },
  async saveChatTurn(viewer: Viewer, id: string, input: ChatTurn): Promise<Consultation> {
    const r = await privilegedSupabase().rpc('save_chat_turn', {
      p_customer_id: viewer.id,
      p_consultation_id: id,
      p_expected_revision: input.expectedRevision,
      p_client_message_id: input.clientMessageId,
      p_message: input.message,
      p_replies: input.replies,
      p_candidates: input.candidate,
      p_proposal: input.pendingProposal,
      p_accept_proposal_id: input.acceptedProposalId,
      p_model:
        input.candidate?.provider === 'mock'
          ? 'mock'
          : (process.env.TYPESAFE_MODEL ?? 'jev-latest'),
    });
    fail(r.error);
    return getConsultation(viewer, id);
  },
  async updatePreferences(
    viewer: Viewer,
    id: string,
    preferences: Preferences,
    expectedRevision: number,
  ): Promise<Consultation> {
    const db = await supabase();
    const r = await db.rpc('update_preferences', {
      p_consultation_id: id,
      p_expected_revision: expectedRevision,
      p_preferences: preferences,
    });
    fail(r.error);
    return getConsultation(viewer, id);
  },
  async createQuote(viewer: Viewer, id: string, expectedRevision: number): Promise<Quote> {
    const db = await supabase();
    const r = await db
      .rpc('create_quote', {
        p_consultation_id: id,
        p_expected_revision: expectedRevision,
      })
      .single();
    if (r.error?.message.includes('needs_review')) {
      const consultation = await getConsultation(viewer, id);
      const readiness = validateReady(consultation.preferences);
      if (!readiness.ready)
        throw new AppError(422, 'NEEDS_REVIEW', readiness.issues.join(' '));
    }
    fail(r.error);
    return mapQuote(required(r.data) as Row);
  },
  async confirmOrder(
    viewer: Viewer,
    input: {
      quoteId: string;
      expectedRevision: number;
      idempotencyKey: string;
      contactEmail: string;
    },
  ): Promise<Order> {
    const db = await supabase();
    const r = await db.rpc('confirm_order', {
      p_quote_id: input.quoteId,
      p_expected_revision: input.expectedRevision,
      p_idempotency_key: input.idempotencyKey,
      p_contact_email: input.contactEmail,
    });
    fail(r.error);
    const data = required(r.data) as { order: Row; task: Row };
    return mapOrder(data.order, data.task);
  },
  async listOrders(viewer: Viewer): Promise<Order[]> {
    const db = await supabase();
    const r = await db
      .from('orders')
      .select('*')
      .eq('customer_id', viewer.id)
      .order('approved_at', { ascending: false });
    fail(r.error);
    if (!r.data?.length) return [];
    const tasks = await db
      .from('production_tasks')
      .select('*')
      .in(
        'order_id',
        r.data.map((o) => o.id),
      );
    fail(tasks.error);
    return r.data.map((o) =>
      mapOrder(o, (tasks.data ?? []).find((t) => t.order_id === o.id) ?? null),
    );
  },
  getOrder,
  async listTasks(viewer: Viewer): Promise<AdminTask[]> {
    admin(viewer);
    const db = await supabase();
    const r = await db.from('production_tasks').select('id').order('created_at');
    fail(r.error);
    const tasks = await Promise.all((r.data ?? []).map((t) => getTask(viewer, t.id)));
    return tasks.sort(
      (a, b) => b.priorityScore - a.priorityScore || a.createdAt.localeCompare(b.createdAt),
    );
  },
  getTask,
  async updateTask(
    viewer: Viewer,
    id: string,
    input: {
      expectedVersion: number;
      status?: TaskStatus;
      manualPriority?: number | null;
      overrideReason?: string | null;
    },
  ): Promise<AdminTask> {
    admin(viewer);
    const db = await supabase();
    const r = await db.rpc('update_task', {
      p_task_id: id,
      p_expected_version: input.expectedVersion,
      p_status: input.status ?? null,
      p_manual_priority: input.manualPriority ?? null,
      p_override_reason: input.overrideReason ?? null,
      p_change_priority: Object.hasOwn(input, 'manualPriority'),
    });
    fail(r.error);
    return getTask(viewer, id);
  },
  async saveEvaluation(
    viewer: Viewer,
    id: string,
    expectedVersion: number,
    evaluation: PriorityEvaluation | null,
  ): Promise<Task> {
    const db = await supabase();
    const existing = await db
      .from('production_tasks')
      .select('order_id')
      .eq('id', id)
      .maybeSingle();
    fail(existing.error);
    const task = required(existing.data);
    const order = await getOrder(viewer, task.order_id);
    const r = await privilegedSupabase()
      .rpc('save_priority_evaluation', {
        p_actor_id: viewer.id,
        p_task_id: id,
        p_expected_version: expectedVersion,
        p_status: evaluation ? 'succeeded' : 'failed',
        p_urgency: evaluation?.urgency ?? null,
        p_complexity: evaluation?.complexity ?? null,
        p_confidence: evaluation?.confidence ?? null,
        p_provider: evaluation?.provider ?? null,
        p_question_version: evaluation?.questionVersion ?? null,
        p_answers: evaluation ?? {},
        p_model:
          evaluation?.provider === 'mock' ? 'mock' : (process.env.TYPESAFE_MODEL ?? 'jev-latest'),
      })
      .single();
    fail(r.error);
    return mapTask(required(r.data) as Row, order.desiredDate);
  },
};
