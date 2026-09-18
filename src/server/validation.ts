import { z } from 'zod';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, '有効な日付を入力してください');
export const preferencesSchema = z
  .object({
    size: z.enum(['S', 'M', 'L', 'custom']).nullable(),
    style: z.enum(['abstract', 'landscape', 'botanical', 'other']).nullable(),
    budgetJpy: z.number().int().min(0).max(100000000).nullable(),
    budgetAnswered: z.boolean(),
    desiredDate: date.nullable(),
    desiredDateAnswered: z.boolean(),
    notes: z.string().max(4000),
  })
  .strict();
export const revisionSchema = z.number().int().min(0);
export const messageSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    clientMessageId: z.uuid(),
    expectedRevision: revisionSchema,
  })
  .strict();
export const updateSchema = z
  .object({ preferences: preferencesSchema, expectedRevision: revisionSchema })
  .strict();
export const orderSchema = z
  .object({
    quoteId: z.uuid(),
    expectedRevision: revisionSchema,
    idempotencyKey: z.uuid(),
    contactEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  })
  .strict();
export const taskSchema = z
  .object({
    expectedVersion: revisionSchema,
    status: z.enum(['queued', 'needs_review', 'in_progress', 'completed', 'cancelled']).optional(),
    manualPriority: z.number().min(0).max(100).nullable().optional(),
    overrideReason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (v) => v.status !== undefined || v.manualPriority !== undefined,
    '変更する項目がありません',
  )
  .refine(
    (v) => v.manualPriority == null || Boolean(v.overrideReason),
    '優先度変更の理由を入力してください',
  );
