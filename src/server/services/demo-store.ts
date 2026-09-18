import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  emptyPreferences,
  type AdminTask,
  type Consultation,
  type ConsultationEvaluation,
  type Order,
  type Preferences,
  type PriorityEvaluation,
  type Quote,
  type TaskStatus,
  type Viewer,
} from '@/contracts';
import { calculatePriority, canTransition, priceForSize, validateReady } from '@/domain';
import { AppError } from '@/server/errors';
type State = {
  consultations: Map<string, Consultation>;
  quotes: Map<string, Quote>;
  orders: Map<string, Order>;
  tasks: Map<string, AdminTask>;
  keys: Map<string, string>;
  messages: Set<string>;
};
const globalStore = globalThis as typeof globalThis & { atelierStore?: State };
const state = (globalStore.atelierStore ??= {
  consultations: new Map(),
  quotes: new Map(),
  orders: new Map(),
  tasks: new Map(),
  keys: new Map(),
  messages: new Set(),
});
globalStore.atelierStore = state;
const copy = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();
function conflict() {
  throw new AppError(409, 'CONFLICT', '内容が更新されています。最新の内容を確認してください。');
}
function findConsultation(v: Viewer, id: string) {
  const c = state.consultations.get(id);
  if (!c || c.customerId !== v.id) throw new AppError(404, 'NOT_FOUND', '相談が見つかりません。');
  return c;
}
function admin(v: Viewer) {
  if (v.role !== 'admin' || v.isAnonymous)
    throw new AppError(403, 'FORBIDDEN', '管理者のみ利用できます。');
}
function decorated(t: AdminTask) {
  const result = copy(t);
  result.priorityScore = calculatePriority({
    urgency: t.evaluation?.urgency ?? 0,
    desiredDate: t.order.desiredDate,
    createdAt: t.createdAt,
    manualPriority: t.manualPriority,
  });
  return result;
}
function event(t: AdminTask, v: Viewer, eventType: string, details: string) {
  t.events.push({ id: randomUUID(), actorId: v.id, eventType, details, createdAt: now() });
}
export const demoStore = {
  async createConsultation(v: Viewer) {
    const c: Consultation = {
      id: randomUUID(),
      customerId: v.id,
      status: 'collecting',
      preferences: copy(emptyPreferences),
      revision: 0,
      messages: [
        {
          id: randomUUID(),
          sender: 'assistant',
          body: 'どんな絵をご希望ですか？ 飾る場所やお好きな雰囲気をお聞かせください。',
          createdAt: now(),
        },
      ],
      candidate: null,
      createdAt: now(),
    };
    state.consultations.set(c.id, c);
    return copy(c);
  },
  async getConsultation(v: Viewer, id: string) {
    return copy(findConsultation(v, id));
  },
  async saveMessage(
    v: Viewer,
    id: string,
    input: {
      expectedRevision: number;
      clientMessageId: string;
      message: string;
      reply: string;
      candidate: ConsultationEvaluation | null;
    },
  ) {
    const c = findConsultation(v, id);
    const key = `${id}:${input.clientMessageId}`;
    if (state.messages.has(key)) return copy(c);
    if (c.revision !== input.expectedRevision || c.status === 'ordered') conflict();
    const time = now();
    c.messages.push(
      {
        id: randomUUID(),
        sender: 'customer',
        body: input.message,
        createdAt: time,
        clientMessageId: input.clientMessageId,
      },
      { id: randomUUID(), sender: 'assistant', body: input.reply, createdAt: time },
    );
    c.candidate = input.candidate;
    c.revision++;
    c.status = 'collecting';
    state.messages.add(key);
    return copy(c);
  },
  async updatePreferences(v: Viewer, id: string, p: Preferences, revision: number) {
    const c = findConsultation(v, id);
    if (c.revision !== revision || c.status === 'ordered') conflict();
    c.preferences = copy(p);
    c.revision++;
    c.status = p.size === 'custom' || p.style === 'other' ? 'needs_review' : 'collecting';
    c.candidate = null;
    return copy(c);
  },
  async createQuote(v: Viewer, id: string, revision: number) {
    const c = findConsultation(v, id);
    if (c.revision !== revision || c.status === 'ordered') conflict();
    const check = validateReady(c.preferences);
    if (!check.ready) throw new AppError(422, 'NEEDS_REVIEW', check.issues.join(' '));
    const q: Quote = {
      id: randomUUID(),
      consultationId: id,
      revision,
      spec: copy(c.preferences),
      amountJpy: priceForSize(c.preferences.size)!,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    state.quotes.set(q.id, q);
    c.status = 'ready_for_review';
    return copy(q);
  },
  async confirmOrder(
    v: Viewer,
    input: {
      quoteId: string;
      expectedRevision: number;
      idempotencyKey: string;
      contactEmail: string;
    },
  ) {
    const q = state.quotes.get(input.quoteId);
    if (!q) throw new AppError(404, 'NOT_FOUND', '見積もりが見つかりません。');
    const c = findConsultation(v, q.consultationId);
    const used = state.keys.get(`${v.id}:${input.idempotencyKey}`);
    if (used && used !== q.id) conflict();
    if (q.revision !== input.expectedRevision) conflict();
    if (c.orderId) {
      const existing = state.orders.get(c.orderId)!;
      if (existing.quoteId !== q.id || existing.contactEmail !== input.contactEmail) conflict();
      return this.getOrder(v, existing.id);
    }
    if (c.revision !== input.expectedRevision || c.status !== 'ready_for_review') conflict();
    if (new Date(q.expiresAt).getTime() <= Date.now())
      throw new AppError(
        409,
        'EXPIRED',
        '見積もりの有効期限が切れています。再度お見積もりください。',
      );
    const o: Order = {
      id: randomUUID(),
      orderNumber: `ART-${String(state.orders.size + 1).padStart(8, '0')}`,
      customerId: v.id,
      contactEmail: input.contactEmail,
      consultationId: c.id,
      quoteId: q.id,
      spec: copy(q.spec),
      amountJpy: q.amountJpy,
      desiredDate: q.spec.desiredDate,
      approvedAt: now(),
      status: 'accepted',
      task: null,
    };
    const { task: unused, ...order } = o;
    void unused;
    const t: AdminTask = {
      id: randomUUID(),
      orderId: o.id,
      status: 'queued',
      version: 0,
      evaluationStatus: 'pending',
      evaluation: null,
      priorityScore: 0,
      manualPriority: null,
      overrideReason: null,
      createdAt: now(),
      order,
      events: [],
    };
    event(t, v, 'created', '制作依頼を受け付けました');
    state.orders.set(o.id, o);
    state.tasks.set(t.id, t);
    state.keys.set(`${v.id}:${input.idempotencyKey}`, q.id);
    c.status = 'ordered';
    c.orderId = o.id;
    return this.getOrder(v, o.id);
  },
  async listOrders(v: Viewer) {
    return Promise.all(
      [...state.orders.values()]
        .filter((o) => o.customerId === v.id)
        .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))
        .map((o) => this.getOrder(v, o.id)),
    );
  },
  async getOrder(v: Viewer, id: string) {
    const o = state.orders.get(id);
    if (!o || (o.customerId !== v.id && (v.role !== 'admin' || v.isAnonymous)))
      throw new AppError(404, 'NOT_FOUND', '注文が見つかりません。');
    const t = [...state.tasks.values()].find((t) => t.orderId === id);
    const result = copy(o);
    if (t) {
      const { order: unused, events: unusedEvents, ...task } = decorated(t);
      void unused;
      void unusedEvents;
      result.task = task;
    }
    return result;
  },
  async listTasks(v: Viewer) {
    admin(v);
    return [...state.tasks.values()]
      .map(decorated)
      .sort((a, b) => b.priorityScore - a.priorityScore || a.createdAt.localeCompare(b.createdAt));
  },
  async getTask(v: Viewer, id: string) {
    admin(v);
    const t = state.tasks.get(id);
    if (!t) throw new AppError(404, 'NOT_FOUND', '制作タスクが見つかりません。');
    return decorated(t);
  },
  async updateTask(
    v: Viewer,
    id: string,
    input: {
      expectedVersion: number;
      status?: TaskStatus;
      manualPriority?: number | null;
      overrideReason?: string;
    },
  ) {
    admin(v);
    const t = state.tasks.get(id);
    if (!t) throw new AppError(404, 'NOT_FOUND', '制作タスクが見つかりません。');
    if (t.version !== input.expectedVersion) conflict();
    if (input.status && input.status !== t.status) {
      if (!canTransition(t.status, input.status))
        throw new AppError(422, 'INVALID_TRANSITION', 'この状態へは変更できません。');
      t.status = input.status;
      if (t.status === 'cancelled') {
        t.order.status = 'cancelled';
        state.orders.get(t.orderId)!.status = 'cancelled';
      }
    }
    if (input.manualPriority !== undefined) {
      if (input.manualPriority !== null && !input.overrideReason?.trim())
        throw new AppError(422, 'REASON_REQUIRED', '変更理由を入力してください。');
      t.manualPriority = input.manualPriority;
      t.overrideReason = input.manualPriority === null ? null : input.overrideReason!;
    }
    t.version++;
    event(t, v, 'updated', input.overrideReason || `制作状態：${t.status}`);
    return decorated(t);
  },
  async saveEvaluation(
    v: Viewer,
    id: string,
    version: number,
    evaluation: PriorityEvaluation | null,
  ) {
    const t = state.tasks.get(id);
    if (!t || (v.role !== 'admin' && t.order.customerId !== v.id))
      throw new AppError(404, 'NOT_FOUND', '制作タスクが見つかりません。');
    if (t.version !== version) conflict();
    t.evaluation = evaluation;
    if (evaluation && evaluation.confidence < 0.5 && t.status === 'queued')
      t.status = 'needs_review';
    t.evaluationStatus = evaluation ? 'succeeded' : 'failed';
    t.version++;
    event(
      t,
      v,
      'evaluated',
      evaluation ? '優先度を評価しました' : '優先度の評価を再試行してください',
    );
    return decorated(t);
  },
};
