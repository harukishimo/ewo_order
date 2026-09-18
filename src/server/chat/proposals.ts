import { randomUUID } from 'node:crypto';
import type { Consultation, ConsultationEvaluation, Preferences } from '@/contracts';
import { parseMessageHints } from '@/components/customer/parse-hints';

export function acceptedProposal(c: Consultation, message: string) {
  const proposal = c.pendingProposal;
  const normalized = message.trim().replace(/[。！!\s]/g, '');
  if (
    !proposal ||
    proposal.revision !== c.revision ||
    !/^(はい|お願いします|それでお願いします|それで大丈夫です|それでいいです|その内容でお願いします|はいお願いします|はいそれでお願いします)$/.test(
      normalized,
    )
  )
    return null;
  return proposal;
}
export function proposalFor(
  c: Consultation,
  message: string,
  candidate: ConsultationEvaluation | null,
) {
  // Do not resurrect the last proposal when the user declines or asks an unrelated question.
  if (/^(いいえ|違います|やめます|やめて|結構です|他には[？?]?)$/.test(message.trim())) return null;
  const patch: Partial<Preferences> = {};
  const labels: string[] = [];
  const size = candidate?.size;
  const style = candidate?.style;
  if (size?.value && size.confidence >= 0.7 && size.value !== c.preferences.size) {
    patch.size = size.value;
    labels.push(size.value === 'custom' ? '特注サイズ（個別相談）' : `${size.value}サイズ`);
  }
  if (style?.value && style.confidence >= 0.7 && style.value !== c.preferences.style) {
    patch.style = style.value;
    labels.push(
      {
        abstract: '抽象画',
        landscape: '風景画',
        botanical: '植物の絵',
        other: 'その他のテイスト（個別相談）',
      }[style.value],
    );
  }
  const hints = parseMessageHints(message);
  if (
    hints.budgetJpy !== undefined &&
    hints.budgetJpy <= 100000000 &&
    (!c.preferences.budgetAnswered || hints.budgetJpy !== c.preferences.budgetJpy)
  ) {
    patch.budgetJpy = hints.budgetJpy;
    patch.budgetAnswered = true;
    labels.push(`ご予算${hints.budgetJpy.toLocaleString('ja-JP')}円`);
  }
  if (hints.desiredDate && hints.desiredDate !== c.preferences.desiredDate) {
    patch.desiredDate = hints.desiredDate;
    patch.desiredDateAnswered = true;
    labels.push(`希望日${hints.desiredDate}（納期は別途確認）`);
  }
  if (!labels.length) return null;
  if (
    c.pendingProposal &&
    Object.entries(patch).every(
      ([key, value]) => c.pendingProposal?.patch[key as keyof Preferences] === value,
    )
  )
    return null;
  const notes = [c.preferences.notes, message.trim()].filter(Boolean).join('\n');
  if (notes.length <= 4000 && !c.preferences.notes.includes(message.trim())) patch.notes = notes;
  return {
    id: randomUUID(),
    revision: c.revision + 1,
    patch,
    message: `お話から、${labels.join('・')}がご希望に近そうです。この内容を希望条件に反映してもよいですか？ よければ「それでお願いします」とお伝えください。まだ注文は確定しません。`,
  };
}
