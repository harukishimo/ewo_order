import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// Usage: node --env-file=.env.local scripts/create-admin.mjs EMAIL
// Passwords are stored only in a gitignored local handoff file, never printed.
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Provide a valid administrator email address.');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Supabase settings are required.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const password = randomBytes(24).toString('base64url') + '!aA7';
const file = new URL('../.env.admin.local', import.meta.url);
await writeFile(file, `ADMIN_EMAIL=${email}\nADMIN_PASSWORD=${password}\n`, { mode: 0o600, flag: 'wx' });
const { data, error } = await db.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (error || !data.user) {
  console.error('Administrator creation failed. Existing accounts are not modified.');
  process.exit(1);
}
await writeFile(file, `ADMIN_EMAIL=${email}\nADMIN_PASSWORD=${password}\nADMIN_USER_ID=${data.user.id}\n`, { mode: 0o600 });
const role = await db.from('user_roles').upsert({ user_id: data.user.id, role: 'admin' });
if (role.error) {
  console.error('User created; administrator role assignment failed. Credentials saved locally.');
  process.exit(1);
}
console.log('Administrator created. Credentials saved in gitignored .env.admin.local; no password printed.');
