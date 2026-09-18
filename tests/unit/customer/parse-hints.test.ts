import { describe, expect, it } from 'vitest';
import {
  parseMessageHints,
  applyMessageProposal,
} from '../../../src/components/customer/parse-hints';
import { emptyPreferences } from '../../../src/contracts';
describe('customer message proposals', () => {
  it('extracts explicit yen, ten-thousand yen and ISO dates', () => {
    expect(parseMessageHints('予算2万円、希望日は2026-10-01です')).toEqual({
      budgetJpy: 20000,
      desiredDate: '2026-10-01',
    });
    expect(parseMessageHints('予算20000円')).toEqual({ budgetJpy: 20000 });
    expect(parseMessageHints('予算は20,000円')).toEqual({ budgetJpy: 20000 });
  });
  it('does not guess relative dates, unspecified numbers, alternatives, negation or invalid dates', () => {
    for (const input of [
      '2万円',
      '予算は2万円か3万円',
      '予算2万円ではなく3万円',
      '予算2万円以内',
      '来月ほしい',
      '2026-02-30',
      '2026-10-01か2026-10-02',
    ])
      expect(parseMessageHints(input)).toEqual({});
  });
  it('preserves confirmed fields and carries the source request without duplicate notes', () => {
    const p = {
      ...emptyPreferences,
      size: 'M' as const,
      style: 'abstract' as const,
      notes: '青系',
    };
    const result = applyMessageProposal(p, null, 'リビング用。予算2万円');
    expect(result).toMatchObject({
      size: 'M',
      style: 'abstract',
      budgetJpy: 20000,
      budgetAnswered: true,
      notes: '青系\nリビング用。予算2万円',
    });
    expect(applyMessageProposal(result, null, 'リビング用。予算2万円').notes).toBe(result.notes);
  });
});
