import { describe, expect, it } from 'vitest';
import { emptyPreferences } from '../../../src/contracts';
import { calculatePriority, canTransition, priceForSize, validateReady } from '../../../src/domain';
describe('business rules', () => {
  it('prices only supported catalog sizes and flags budget mismatch', () => {
    expect(priceForSize('M')).toBe(20000);
    expect(priceForSize('custom')).toBeNull();
    const p = {
      ...emptyPreferences,
      size: 'M' as const,
      style: 'abstract' as const,
      budgetAnswered: true,
      desiredDateAnswered: true,
      budgetJpy: 10000,
    };
    expect(validateReady(p).ready).toBe(false);
    const mismatch = validateReady({ ...p, size: 'L', budgetJpy: 20000 });
    expect(mismatch.issues.join(' ')).toContain('35,000円');
    expect(mismatch.issues.join(' ')).toContain('20,000円を15,000円超え');
    expect(validateReady({ ...p, budgetJpy: 20000 }).ready).toBe(true);
    expect(validateReady({ ...p, size: 'custom' }).ready).toBe(false);
  });
  it('requires explicit answers and prevents terminal reopening', () => {
    expect(validateReady(emptyPreferences).issues).toHaveLength(4);
    expect(canTransition('queued', 'completed')).toBe(false);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('completed', 'queued')).toBe(false);
  });
  it('uses Japanese date boundaries, waiting age and manual override', () => {
    const now = new Date('2026-09-18T15:00:00Z');
    expect(
      calculatePriority({
        urgency: 1,
        desiredDate: '2026-09-19',
        createdAt: '2026-09-04T15:00:00Z',
        now,
      }),
    ).toBe(100);
    expect(
      calculatePriority({ urgency: 0, desiredDate: null, createdAt: now.toISOString(), now }),
    ).toBe(0);
    expect(
      calculatePriority({
        urgency: 1,
        desiredDate: null,
        createdAt: now.toISOString(),
        now,
        manualPriority: 12,
      }),
    ).toBe(12);
  });
});
