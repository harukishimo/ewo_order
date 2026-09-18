import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { applyMigrations } from './migration-runner.mjs';

let client;
try {
  if (!process.env.SUPABASE_DB_URL)
    throw new Error('SUPABASE_DB_URL is required for automatic database setup.');
  const url = new URL(process.env.SUPABASE_DB_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('SUPABASE_DB_URL must be a PostgreSQL connection URL.');
  // Explicit TLS verification; avoid sslmode parameters overriding the secure options below.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  client = new pg.Client({
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.SUPABASE_DB_CA
        ? { ca: process.env.SUPABASE_DB_CA.replace(/\\n/g, '\n') }
        : {}),
    },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  await client.query("set statement_timeout = '60s'");
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort();
  const migrations = await Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(new URL(name, directory), 'utf8') })),
  );
  await applyMigrations(
    { query: (sql, values) => client.query(sql, values), execute: (sql) => client.query(sql) },
    migrations,
  );
  if (process.env.ATELIER_ADMIN_USER_ID) {
    const result = await client.query(
      "insert into public.user_roles(user_id,role) select id,'admin' from auth.users where id=$1::uuid on conflict(user_id) do update set role='admin' returning user_id",
      [process.env.ATELIER_ADMIN_USER_ID],
    );
    if (!result.rowCount) throw new Error('Configured administrator user does not exist.');
    console.log('Configured administrator role is ready.');
  }
  console.log('Database migrations are up to date.');
} catch (error) {
  // Never log driver objects/connection URLs, which may contain database credentials.
  const code = typeof error?.code === 'string' ? error.code : 'SETUP_FAILED';
  console.error(
    `Database setup failed (${code}). Check SUPABASE_DB_URL, certificate, network access and migration history. No connection values were printed.`,
  );
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
