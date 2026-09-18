import type { NextRequest } from 'next/server';
export function requestOrigin(req: NextRequest): string {
  return process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : `${req.nextUrl.protocol}//${req.headers.get('host')}`;
}
