import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent, ConsultationEvaluation, Viewer } from '@/contracts';
import { emptyPreferences } from '@/contracts';
import { demoStore } from '@/server/services/demo-store';
import { acceptedProposal, proposalFor } from '@/server/chat/proposals';
const mocks = vi.hoisted(() => ({ classify: vi.fn(), reply: vi.fn() }));
vi.mock('@/server/jev', () => ({ evaluateConsultation: mocks.classify }));
vi.mock('@/server/chat/gemini', () => ({ chatMode: () => 'demo', streamReply: mocks.reply }));
import { chatResponse } from '@/server/chat/stream';
const viewer: Viewer = { id: randomUUID(), email: '', role: 'customer', mode: 'demo' };
const candidate: ConsultationEvaluation = {
  provider: 'mock',
  size: { value: 'M', confidence: 0.9 },
  style: { value: 'abstract', confidence: 0.9 },
  needsReview: false,
  changeRequested: false,
  questionVersion: 'test',
};
const input = (message: string, expectedRevision: number) => ({
  message,
  expectedRevision,
  clientMessageId: randomUUID(),
});
async function events(response: Response): Promise<ChatStreamEvent[]> {
  return (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
beforeEach(() => {
  mocks.classify.mockResolvedValue(candidate);
  mocks.reply.mockImplementation(async (_c, _m, _a, emit) => {
    emit('お部屋に合う絵を考えましょう。');
  });
});
afterEach(() => vi.clearAllMocks());
describe('streaming consultation', () => {
  it('emits first chat token before the Jev result arrives, then persists followup and explicit acceptance', async () => {
    let resolve!: (value: ConsultationEvaluation) => void;
    mocks.classify.mockReturnValueOnce(
      new Promise<ConsultationEvaluation>((r) => {
        resolve = r;
      }),
    );
    const c = await demoStore.createConsultation(viewer);
    const response = await chatResponse(
      demoStore,
      viewer,
      c.id,
      input('Mサイズの抽象画が希望です', 0),
    );
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"start"');
    expect(second).toContain('"delta"');
    expect((await demoStore.getConsultation(viewer, c.id)).revision).toBe(0);
    resolve(candidate);
    let rest = '';
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      rest += new TextDecoder().decode(part.value);
    }
    expect(rest).toContain('"followup"');
    const proposed = await demoStore.getConsultation(viewer, c.id);
    expect(proposed.preferences.size).toBeNull();
    expect(proposed.pendingProposal?.patch.size).toBe('M');
    await events(await chatResponse(demoStore, viewer, c.id, input('それでお願いします', 1)));
    const accepted = await demoStore.getConsultation(viewer, c.id);
    expect(accepted.preferences).toMatchObject({ size: 'M', style: 'abstract' });
    expect(accepted.pendingProposal).toBeNull();
    expect(accepted.orderId).toBeUndefined();
  });
  it('retries are idempotent and a duplicate key cannot change content', async () => {
    const c = await demoStore.createConsultation(viewer);
    const turn = input('Mサイズ', 0);
    await events(await chatResponse(demoStore, viewer, c.id, turn));
    const retry = await events(await chatResponse(demoStore, viewer, c.id, turn));
    expect(retry.map((e) => e.type)).toEqual(['done']);
    expect(mocks.classify).toHaveBeenCalledTimes(1);
    await expect(
      chatResponse(demoStore, viewer, c.id, { ...turn, message: 'Lサイズ' }),
    ).rejects.toThrow();
    expect((await demoStore.getConsultation(viewer, c.id)).messages).toHaveLength(4);
  });
  it('manual edits invalidate a pending proposal and stale saves fail', async () => {
    const c = await demoStore.createConsultation(viewer);
    await events(await chatResponse(demoStore, viewer, c.id, input('Mサイズ', 0)));
    const changed = await demoStore.updatePreferences(
      viewer,
      c.id,
      { ...emptyPreferences, size: 'L' },
      1,
    );
    expect(changed.pendingProposal).toBeNull();
    expect(acceptedProposal(changed, 'それでお願いします')).toBeNull();
    await expect(
      chatResponse(demoStore, viewer, c.id, input('それでお願いします', 1)),
    ).rejects.toThrow();
  });
  it('only one competing turn commits', async () => {
    const c = await demoStore.createConsultation(viewer);
    const first = input('Mサイズ', 0),
      second = input('別の話', 0);
    const results = await Promise.all([
      chatResponse(demoStore, viewer, c.id, first),
      chatResponse(demoStore, viewer, c.id, second),
    ]);
    const all = await Promise.all(results.map(events));
    expect(all.flat().filter((e) => e.type === 'done')).toHaveLength(1);
    expect(all.flat().filter((e) => e.type === 'error')).toHaveLength(1);
    expect((await demoStore.getConsultation(viewer, c.id)).revision).toBe(1);
  });
  it('a cancelled reader does not create a partial turn and a retry returns the saved result', async () => {
    let resolve!: (value: ConsultationEvaluation) => void;
    mocks.classify.mockReturnValueOnce(
      new Promise<ConsultationEvaluation>((r) => {
        resolve = r;
      }),
    );
    const c = await demoStore.createConsultation(viewer);
    const turn = input('Mサイズ', 0);
    const response = await chatResponse(demoStore, viewer, c.id, turn);
    await response.body!.cancel();
    resolve(candidate);
    await vi.waitFor(async () =>
      expect((await demoStore.getConsultation(viewer, c.id)).revision).toBe(1),
    );
    expect(
      (await events(await chatResponse(demoStore, viewer, c.id, turn))).map((e) => e.type),
    ).toEqual(['done']);
  });
  it('provider errors preserve a readable fallback and Jev proposal', async () => {
    mocks.reply.mockRejectedValueOnce(new Error('secret-provider-error'));
    const c = await demoStore.createConsultation(viewer);
    const result = await events(await chatResponse(demoStore, viewer, c.id, input('Mサイズ', 0)));
    expect(JSON.stringify(result)).not.toContain('secret-provider-error');
    expect(result.some((e) => e.type === 'delta')).toBe(true);
    expect(result.some((e) => e.type === 'followup')).toBe(true);
    expect(result.at(-1)?.type).toBe('done');
  });
  it('negation, stale proposal, vague response and duplicate proposal never auto-apply', async () => {
    const c = await demoStore.createConsultation(viewer);
    const proposal = proposalFor(c, 'Mサイズで抽象画', candidate)!;
    const withProposal = { ...c, revision: 1, pendingProposal: proposal };
    for (const reply of [
      'いいえ',
      'はい、でもLに変更',
      'それでお願いしますか？',
      '他には？',
      'お願いしますが変更もしたい',
    ])
      expect(acceptedProposal(withProposal, reply)).toBeNull();
    expect(acceptedProposal({ ...withProposal, revision: 2 }, 'はい')).toBeNull();
    expect(proposalFor(withProposal, '他には？', candidate)).toBeNull();
    expect(proposalFor(withProposal, 'Mサイズで抽象画', candidate)).toBeNull();
  });
});
