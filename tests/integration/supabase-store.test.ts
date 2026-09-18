import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Viewer } from '@/contracts';

const clients = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({
  supabase: async () => clients.current,
  privilegedSupabase: () => clients.current,
}));
import { supabaseStore } from '@/server/services/supabase-store';

const viewer: Viewer = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'test@example.invalid',
  role: 'customer',
  mode: 'supabase',
};
const preferences = {
  size: 'M',
  style: 'abstract',
  budgetJpy: 20000,
  budgetAnswered: true,
  desiredDate: null,
  desiredDateAnswered: true,
  notes: '青色',
};
const consultation = {
  id: 'c-1',
  customer_id: viewer.id,
  status: 'collecting',
  confirmed_preferences: preferences,
  revision: 2,
  candidates: null,
  created_at: '2026-09-18T00:00:00Z',
};
const quote = {
  id: 'q-1',
  consultation_id: 'c-1',
  revision: 2,
  spec_snapshot: preferences,
  amount_jpy: 20000,
  expires_at: '2026-09-19T00:00:00Z',
};
const order = {
  id: 'o-1',
  order_number: 'ART-00000001',
  customer_id: viewer.id,
  consultation_id: 'c-1',
  quote_id: 'q-1',
  spec_snapshot: preferences,
  amount_jpy: 20000,
  desired_date: null,
  approved_at: '2026-09-18T00:00:00Z',
  status: 'accepted',
};
const task = {
  id: 't-1',
  order_id: 'o-1',
  status: 'queued',
  version: 0,
  evaluation_status: 'pending',
  manual_priority: null,
  override_reason: null,
  created_at: '2026-09-18T00:00:00Z',
};
let requests: { path: string; accept: string | null; body: Record<string, unknown> }[];
let mode: 'consultation' | 'quote' | 'confirm' | 'evaluation' | 'budget';
beforeEach(() => {
  requests = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = new Headers(init?.headers);
    const accept = headers.get('accept');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path: url.pathname, accept, body });
    let result: unknown;
    const rpc = url.pathname.split('/rpc/')[1];
    if (rpc === 'create_quote' && mode === 'budget')
      return Response.json({ message: 'needs_review', code: 'P0001' }, { status: 400 });
    if (rpc) {
      if (rpc === 'confirm_order') result = { order, task };
      else {
        const row =
          rpc === 'create_consultation'
            ? consultation
            : rpc === 'create_quote'
              ? quote
              : {
                  ...task,
                  version: 1,
                  evaluation_status: 'succeeded',
                  urgency: 0.5,
                  complexity: 0.25,
                  confidence: 0.8,
                  provider: 'jev',
                  question_version: 'painting-v1',
                };
        // Actual PostgREST contract: table-returning RPC is plural unless singular Accept is requested.
        result = accept === 'application/vnd.pgrst.object+json' ? row : [row];
      }
    } else if (url.pathname.endsWith('/consultations')) result = [{ ...consultation, confirmed_preferences: mode === 'budget' ? { ...preferences, size: 'L' } : preferences }];
    else if (url.pathname.endsWith('/messages')) result = [];
    else if (url.pathname.endsWith('/orders')) result = mode === 'consultation' ? [] : [order];
    else if (url.pathname.endsWith('/production_tasks')) result = [task];
    else throw new Error(`Unexpected HTTP request: ${url.pathname}`);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  clients.current = createClient('https://supabase.example.invalid', 'test-public-key', {
    global: { fetch: fetcher },
    auth: { persistSession: false, autoRefreshToken: false },
  });
});
describe('Supabase store through real SDK HTTP serialization', () => {
  it('explains the actual budget mismatch instead of the generic DB error', async () => {
    mode = 'budget';
    await expect(supabaseStore.createQuote(viewer, 'c-1', 2)).rejects.toMatchObject({
      code: 'NEEDS_REVIEW',
      message: expect.stringContaining('20,000円を15,000円超えています'),
    });
  });
  it('requests a singular composite consultation and maps its fields', async () => {
    mode = 'consultation';
    const result = await supabaseStore.createConsultation(viewer);
    expect(requests.find((r) => r.path.endsWith('/rpc/create_consultation'))?.accept).toBe(
      'application/vnd.pgrst.object+json',
    );
    expect(result.id).toBe('c-1');
    expect(result.customerId).toBe(viewer.id);
    expect(result.preferences).toEqual(preferences);
    expect(requests.find((r) => r.path.endsWith('/consultations'))).toBeDefined();
  });
  it('requests a singular quote and maps price and revision', async () => {
    mode = 'quote';
    const result = await supabaseStore.createQuote(viewer, 'c-1', 2);
    expect(requests[0].accept).toBe('application/vnd.pgrst.object+json');
    expect(requests[0].body).toEqual({ p_consultation_id: 'c-1', p_expected_revision: 2 });
    expect(result).toMatchObject({
      id: 'q-1',
      amountJpy: 20000,
      revision: 2,
      consultationId: 'c-1',
    });
  });
  it('keeps JSONB confirm_order scalar response and maps nested order/task', async () => {
    mode = 'confirm';
    const result = await supabaseStore.confirmOrder(viewer, {
      quoteId: 'q-1',
      expectedRevision: 2,
      contactEmail: 'customer@example.com',
      idempotencyKey: 'retry-key',
    });
    expect(requests[0].body.p_contact_email).toBe('customer@example.com');
    expect(requests[0].accept).not.toBe('application/vnd.pgrst.object+json');
    expect(result).toMatchObject({
      id: 'o-1',
      orderNumber: 'ART-00000001',
      amountJpy: 20000,
      task: { id: 't-1', orderId: 'o-1' },
    });
  });
  it('requests a singular saved evaluation and maps its scores', async () => {
    mode = 'evaluation';
    const result = await supabaseStore.saveEvaluation(viewer, 't-1', 0, {
      provider: 'jev',
      urgency: 0.5,
      complexity: 0.25,
      confidence: 0.8,
      questionVersion: 'painting-v1',
    });
    const rpc = requests.find((r) => r.path.endsWith('/rpc/save_priority_evaluation'));
    expect(rpc?.accept).toBe('application/vnd.pgrst.object+json');
    expect(rpc?.body.p_actor_id).toBe(viewer.id);
    expect(result).toMatchObject({
      id: 't-1',
      version: 1,
      evaluationStatus: 'succeeded',
      evaluation: { urgency: 0.5, confidence: 0.8, questionVersion: 'painting-v1' },
    });
  });
});
