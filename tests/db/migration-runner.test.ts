import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { applyMigrations } from '../../scripts/migration-runner.mjs';

it('deployment migrations apply once, detect edits and roll back failed batches', async () => {
  const db = new PGlite();
  const adapter = {
    execute: (sql: string) => db.exec(sql),
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
  };
  const first = {
    name: '001.sql',
    sql: 'create table public.example(id int primary key); insert into public.example values(1);',
  };
  try {
    await applyMigrations(adapter, [first], () => {});
    await applyMigrations(adapter, [first], () => {});
    expect((await db.query('select * from public.example')).rows).toHaveLength(1);
    await expect(
      applyMigrations(adapter, [{ ...first, sql: 'select 1' }], () => {}),
    ).rejects.toThrow('Applied migration changed');
    await expect(
      applyMigrations(
        adapter,
        [
          first,
          {
            name: '002.sql',
            sql: 'create table public.rollback_check(id int); select missing_column from public.example;',
          },
        ],
        () => {},
      ),
    ).rejects.toThrow();
    expect(
      (await db.query("select to_regclass('public.rollback_check') as relation")).rows,
    ).toEqual([{ relation: null }]);
    expect((await db.query('select * from atelier_meta.schema_migrations')).rows).toHaveLength(1);
  } finally {
    await db.close();
  }
}, 15000);
