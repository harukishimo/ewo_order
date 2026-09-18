import { createHash } from 'node:crypto';

// execute accepts a SQL batch; query returns { rows }. Separate methods also allow real SQL tests.
export async function applyMigrations(db, migrations, log = console.log) {
  await db.execute('begin');
  try {
    await db.query("select pg_advisory_xact_lock(hashtextextended('atelier-migrations', 0))");
    await db.execute(`create schema if not exists atelier_meta;
      revoke all on schema atelier_meta from public;
      create table if not exists atelier_meta.schema_migrations (
        name text primary key, checksum text not null, applied_at timestamptz not null default now()
      );`);
    const applied = new Map(
      (await db.query('select name, checksum from atelier_meta.schema_migrations')).rows.map(
        (r) => [r.name, r.checksum],
      ),
    );
    for (const migration of migrations) {
      const checksum = createHash('sha256').update(migration.sql).digest('hex');
      if (applied.has(migration.name)) {
        if (applied.get(migration.name) !== checksum)
          throw new Error(
            `Applied migration changed: ${migration.name}. Add a new migration instead.`,
          );
        continue;
      }
      await db.execute(migration.sql);
      await db.query('insert into atelier_meta.schema_migrations(name,checksum) values($1,$2)', [
        migration.name,
        checksum,
      ]);
      log(`Applied ${migration.name}`);
    }
    await db.execute('commit');
  } catch (error) {
    await db.execute('rollback');
    throw error;
  }
}
