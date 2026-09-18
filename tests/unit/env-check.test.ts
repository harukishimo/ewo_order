import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/check-env.mjs', import.meta.url));

function check(databaseUrl: string) {
  // Do not inherit local credentials or load .env.local in these subprocesses.
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      APP_MODE: 'supabase',
      JEV_MODE: 'jev',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
      SUPABASE_SECRET_KEY: 'test-secret',
      TYPESAFE_API_KEY: 'test-typesafe',
      SUPABASE_DB_URL: databaseUrl,
    },
  });
}

describe('deployment environment validation', () => {
  it.each([
    'not-a-url',
    'postgresql://postgres:fake-password',
    'postgresql://postgres:fake#password@db.example.com:5432/postgres',
    'postgresql://postgres:[YOUR-PASSWORD]@db.example.com:5432/postgres',
    'postgresql://postgres:%5BYOUR-PASSWORD%5D@db.example.com:5432/postgres',
    'https://postgres:fake-password@db.example.com/postgres',
    'postgresql://:fake-password@db.example.com:5432/postgres',
    'postgresql://postgres@db.example.com:5432/postgres',
    'postgresql://postgres:fake-password@db.example.com:5432',
    'postgresql://postgres:fake-password@db.example.com:5432/',
  ])('rejects an incomplete or invalid DB URI without exposing it (%#)', (databaseUrl) => {
    const result = check(databaseUrl);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid SUPABASE_DB_URL');
    expect(result.stderr).toContain('URL-encode the password');
    expect(result.stderr).toContain('Vercel');
    expect(result.stderr).not.toContain(databaseUrl);
    expect(result.stderr).not.toContain('fake-password');
    expect(result.stdout).toBe('');
  });

  it.each(['postgres:', 'postgresql:'])('accepts %s with encoded credentials', (protocol) => {
    const result = check(
      `${protocol}//postgres.project:fake%23password%40%3A%2F%25@pooler.example.com:5432/postgres`,
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Service connectivity is not tested');
    expect(result.stdout).not.toContain('fake');
  });
});
