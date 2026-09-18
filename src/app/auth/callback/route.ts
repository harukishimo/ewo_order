import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requestOrigin } from '@/server/http';
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (code) {
    const db = await supabase();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/orders', requestOrigin(req)));
  }
  return NextResponse.redirect(new URL('/login?confirmation=failed', requestOrigin(req)));
}
