import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { AppError } from '@/server/errors';
function settings() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new AppError(
      503,
      'NOT_CONFIGURED',
      '接続設定がまだ完了していません。管理者にお問い合わせください。',
    );
  return { url, key };
}
export async function supabase() {
  const { url, key } = settings();
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) => items.forEach(({ name, value, options }) => jar.set(name, value, options)),
    },
  });
}
export function privilegedSupabase() {
  const { url } = settings();
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new AppError(503, 'NOT_CONFIGURED', 'サーバーの接続設定が必要です。');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
