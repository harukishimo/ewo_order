import type { Preferences, Size, TaskStatus } from '../contracts';

export const catalog = {
  S: { widthCm: 20, heightCm: 20, priceJpy: 10000 },
  M: { widthCm: 30, heightCm: 40, priceJpy: 20000 },
  L: { widthCm: 50, heightCm: 60, priceJpy: 35000 },
} as const;
export const CATALOG_VERSION = 'demo-2026-09-v1';
export const QUESTION_VERSION = 'painting-v1';
export const CONFIDENCE_THRESHOLD = 0.75;
export function priceForSize(size: Size | null): number | null {
  return size && size !== 'custom' ? catalog[size].priceJpy : null;
}
export function validateReady(p: Preferences): { ready: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!p.size) issues.push('サイズを選んでください。');
  if (!p.style) issues.push('テイストを選んでください。');
  if (!p.budgetAnswered) issues.push('ご予算を入力するか、予算指定なしを選んでください。');
  if (!p.desiredDateAnswered) issues.push('希望日を入力するか、希望日なしを選んでください。');
  if (p.size === 'custom' || p.style === 'other')
    issues.push('カタログ外の条件は個別相談が必要です。');
  const price = priceForSize(p.size);
  if (price !== null && p.budgetJpy !== null && price > p.budgetJpy)
    issues.push('デモ料金がご予算を超えています。サイズまたは予算をご確認ください。');
  return { ready: issues.length === 0, issues };
}
const DAY = 86400000;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function japanDay(date: Date): number {
  return Math.floor((date.getTime() + 9 * 3600000) / DAY);
}
export function calculatePriority(input: {
  urgency: number;
  desiredDate: string | null;
  createdAt: string;
  manualPriority?: number | null;
  now?: Date;
}): number {
  if (input.manualPriority != null) return Math.max(0, Math.min(100, input.manualPriority));
  const now = input.now ?? new Date();
  const d = input.desiredDate
    ? japanDay(new Date(`${input.desiredDate}T00:00:00+09:00`)) - japanDay(now)
    : 14;
  const deadlinePressure = clamp((14 - d) / 14);
  const waitingAge = clamp((now.getTime() - new Date(input.createdAt).getTime()) / DAY / 14);
  return (
    Math.round((60 * clamp(input.urgency) + 25 * deadlinePressure + 15 * waitingAge) * 100) / 100
  );
}
const transitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ['in_progress', 'needs_review', 'cancelled'],
  in_progress: ['completed', 'needs_review', 'cancelled'],
  needs_review: ['queued', 'cancelled'],
  completed: [],
  cancelled: [],
};
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}
export function nextQuestion(p: Preferences): string {
  if (!p.size) return '飾る場所に合うサイズを選んでください。S・M・Lから選べます。';
  if (!p.style) return 'どんなテイストがお好みですか？ 抽象画・風景画・植物から選んでください。';
  if (!p.budgetAnswered)
    return 'ご予算はいくらですか？ 条件カードで入力するか、予算指定なしを選んでください。';
  if (!p.desiredDateAnswered)
    return '希望日はありますか？ 希望日は納期の確約ではありません。条件カードから指定できます。';
  const check = validateReady(p);
  if (!check.ready) return check.issues[0];
  return '条件がそろいました。見積もりを確認してください。「この内容で注文する」を押すまで注文されません。';
}
