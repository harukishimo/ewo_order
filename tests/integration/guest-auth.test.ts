import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInAnonymously: vi.fn(),
  maybeSingle: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabase: async () => ({
    auth: { getUser: mocks.getUser, signInAnonymously: mocks.signInAnonymously },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }),
}));
import { guestLogin, requireViewer } from '@/server/auth';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_MODE', 'supabase');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test');
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.maybeSingle.mockResolvedValue({ data: { role: 'customer' } });
});
it('starts a guest session with no email or password', async () => {
  mocks.signInAnonymously.mockResolvedValue({ data: { user: { id: 'guest-1' } }, error: null });
  expect(await guestLogin()).toMatchObject({
    id: 'guest-1',
    isAnonymous: true,
    email: '',
    role: 'customer',
  });
  expect(mocks.signInAnonymously).toHaveBeenCalledWith();
});
it('reuses existing customer or admin session without replacing it', async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'admin-1', email: 'admin@example.com', is_anonymous: false } },
  });
  mocks.maybeSingle.mockResolvedValue({ data: { role: 'admin' } });
  expect(await guestLogin()).toMatchObject({ id: 'admin-1', role: 'admin' });
  expect(mocks.signInAnonymously).not.toHaveBeenCalled();
});
it('does not grant anonymous users admin access even if role is accidentally assigned', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } } });
  mocks.maybeSingle.mockResolvedValue({ data: { role: 'admin' } });
  await expect(requireViewer(true)).rejects.toMatchObject({ status: 403 });
});
it('reports unavailable anonymous auth without creating a fallback identity', async () => {
  mocks.signInAnonymously.mockResolvedValue({
    data: { user: null },
    error: { message: 'disabled' },
  });
  await expect(guestLogin()).rejects.toMatchObject({ status: 503, code: 'GUEST_UNAVAILABLE' });
});
