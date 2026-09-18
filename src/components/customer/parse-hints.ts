import type { Preferences, ConsultationEvaluation } from '@/contracts';
export interface MessageHints {
  budgetJpy?: number;
  desiredDate?: string;
}
/** Deterministic hints only. Values remain proposals until explicitly saved by the customer. */
export function parseMessageHints(message: string): MessageHints {
  const hints: MessageHints = {};
  const budgets = [
    ...message.matchAll(/予算(?:は|が|を|：|:|\s)*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(万)?円/g),
  ];
  const allAmounts = [...message.matchAll(/[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?\s*(?:万)?円/g)];
  if (
    budgets.length === 1 &&
    allAmounts.length === 1 &&
    !/(?:かも|未定|ではなく|じゃなく|以外|以内|以上|以下|から|〜|～)/.test(message)
  ) {
    const value = Number(budgets[0][1].replaceAll(',', '')) * (budgets[0][2] ? 10000 : 1);
    if (Number.isSafeInteger(value) && value >= 0) hints.budgetJpy = value;
  }
  const dates = [...message.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)];
  if (dates.length === 1 && !/(?:かも|未定|ではなく|じゃなく|以外|〜|～)/.test(message)) {
    const value = dates[0][1];
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value)
      hints.desiredDate = value;
  }
  return hints;
}
export function applyMessageProposal(
  current: Preferences,
  candidate: ConsultationEvaluation | null,
  message: string,
): Preferences {
  const hints = parseMessageHints(message);
  return {
    ...current,
    size: candidate?.size.value ?? current.size,
    style: candidate?.style.value ?? current.style,
    ...(hints.budgetJpy !== undefined ? { budgetJpy: hints.budgetJpy, budgetAnswered: true } : {}),
    ...(hints.desiredDate ? { desiredDate: hints.desiredDate, desiredDateAnswered: true } : {}),
    notes:
      message.trim() && !current.notes.includes(message.trim())
        ? [current.notes, message.trim()].filter(Boolean).join('\n')
        : current.notes,
  };
}
