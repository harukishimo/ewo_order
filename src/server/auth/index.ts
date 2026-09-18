import 'server-only';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Viewer } from '@/contracts';
import { supabase } from '@/lib/supabase/server';
import { AppError } from '@/server/errors';
export const isDemo = () => process.env.APP_MODE === 'demo';
const cookieName = 'atelier-demo';
function secret() {
  const value = process.env.DEMO_AUTH_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== 'production') return 'local-only-atelier-demo-secret-do-not-deploy';
  throw new AppError(503, 'NOT_CONFIGURED', 'デモ環境の署名キーを設定してください。');
}
export async function demoLogin(role: 'customer' | 'admin'): Promise<Viewer> {
  if (!isDemo()) throw new AppError(403, 'FORBIDDEN', 'デモログインは無効です。');
  const viewer: Viewer = {
    id: randomUUID(),
    email: `demo-${role}@example.invalid`,
    role,
    mode: 'demo',
  };
  const raw = Buffer.from(JSON.stringify({ ...viewer, exp: Date.now() + 86400000 })).toString(
    'base64url',
  );
  const sig = createHmac('sha256', secret()).update(raw).digest('base64url');
  (await cookies()).set(cookieName, `${raw}.${sig}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 86400,
  });
  return viewer;
}
export async function viewer(): Promise<Viewer | null> {
  if (isDemo()) {
    const value = (await cookies()).get(cookieName)?.value;
    if (!value) return null;
    const [raw, sig] = value.split('.');
    if (!raw || !sig) return null;
    const expected = createHmac('sha256', secret()).update(raw).digest('base64url');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;
    try {
      const v = JSON.parse(Buffer.from(raw, 'base64url').toString());
      return v.exp > Date.now() ? { id: v.id, email: v.email, role: v.role, mode: 'demo' } : null;
    } catch {
      return null;
    }
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    return null;
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
  return {
    id: user.id,
    email: user.email ?? '',
    role: data?.role === 'admin' ? 'admin' : 'customer',
    mode: 'supabase',
  };
}
export async function requireViewer(admin = false) {
  const v = await viewer();
  if (!v) throw new AppError(401, 'UNAUTHENTICATED', 'ログインしてください。');
  if (admin && v.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '管理者のみ利用できます。');
  return v;
}
export async function logout() {
  (await cookies()).delete(cookieName);
  if (!isDemo() && process.env.NEXT_PUBLIC_SUPABASE_URL) await (await supabase()).auth.signOut();
}
