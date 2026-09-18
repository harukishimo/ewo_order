import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyPreferences } from '@/contracts';
import { POST, PATCH, GET } from '@/app/api/[...path]/route';

vi.mock('@/server/auth', () => ({
  isDemo: () => true,
  viewer: async () => null,
  requireViewer: async () => ({
    id: '80000000-0000-4000-8000-000000000001',
    email: 'test@example.invalid',
    role: 'customer',
    mode: 'demo',
  }),
  demoLogin: vi.fn(),
  logout: vi.fn(),
}));
afterEach(() => vi.unstubAllEnvs());

it('Jev unavailable preserves messages, accepts explicit order, and records evaluation failure', async () => {
  vi.stubEnv('JEV_MODE', 'jev');
  vi.stubEnv('TYPESAFE_API_KEY', undefined);
  async function request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) {
    const req = new NextRequest(`http://localhost/api/${path}`, {
      method,
      headers: { 'content-type': 'application/json', host: 'localhost' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const response = await { GET, POST, PATCH }[method](req, {
      params: Promise.resolve({ path: path.split('/') }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).data;
  }
  const consultation = await request('POST', 'consultations', {});
  const conversation = await request('POST', `consultations/${consultation.id}/messages`, {
    message: '青い抽象画を希望します',
    expectedRevision: 0,
    clientMessageId: crypto.randomUUID(),
  });
  expect(conversation.messages.at(-1).body).toContain('判定を利用できません');
  expect(
    conversation.messages.some((m: { body: string }) => m.body === '青い抽象画を希望します'),
  ).toBe(true);
  expect(conversation.candidate).toBeNull();
  const updated = await request('PATCH', `consultations/${consultation.id}/preferences`, {
    expectedRevision: conversation.revision,
    preferences: {
      ...emptyPreferences,
      size: 'M',
      style: 'abstract',
      budgetAnswered: true,
      desiredDateAnswered: true,
    },
  });
  const quote = await request('POST', `consultations/${consultation.id}/quotes`, {
    expectedRevision: updated.revision,
  });
  const order = await request('POST', 'orders', {
    quoteId: quote.id,
    expectedRevision: quote.revision,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(order.amountJpy).toBe(20000);
  expect(order.task.evaluationStatus).toBe('failed');
  expect(order.status).toBe('accepted');
  const persisted = await request('GET', `orders/${order.id}`);
  expect(persisted.id).toBe(order.id);
});
