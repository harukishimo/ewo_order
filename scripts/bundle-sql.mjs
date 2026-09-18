import { readdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const names = (await readdir(new URL('supabase/migrations/', root)))
  .filter((n) => n.endsWith('.sql'))
  .sort();
const sections = await Promise.all(
  names.map(
    async (n) => `-- ${n}\n${await readFile(new URL(`supabase/migrations/${n}`, root), 'utf8')}`,
  ),
);
await writeFile(
  new URL('supabase/bootstrap.sql', root),
  `-- Fresh Supabase project only. Run once in SQL Editor.\n-- For existing databases, use supabase db push with migration history.\nbegin;\n${sections.join('\n\n')}\ncommit;\n`,
);
console.log(`Bundled ${names.length} migrations into supabase/bootstrap.sql`);
