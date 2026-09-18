import type { ApiResponse } from '@/contracts';
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = (await res.json()) as ApiResponse<T>;
  if ('error' in body) throw new Error(body.error.message);
  if (!res.ok) throw new Error('処理に失敗しました。もう一度お試しください。');
  return body.data;
}
