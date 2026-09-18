const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'TYPESAFE_API_KEY',
  'SUPABASE_DB_URL',
];
const missing = required.filter((k) => !process.env[k]);
function validDatabaseUrl(value) {
  try {
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      Boolean(url.hostname && url.username && url.password) &&
      !value.includes('#') &&
      !decodeURIComponent(value).includes('[YOUR-PASSWORD]') &&
      /^\/[^/]+$/.test(url.pathname) &&
      !/\s/.test(value)
    );
  } catch {
    return false;
  }
}
if (process.env.APP_MODE === 'demo' || process.env.JEV_MODE === 'mock') {
  console.error('Live deployment requires APP_MODE=supabase and JEV_MODE=jev.');
  process.exitCode = 1;
} else if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exitCode = 1;
} else if (!validDatabaseUrl(process.env.SUPABASE_DB_URL)) {
  console.error(
    'Invalid SUPABASE_DB_URL. Copy the complete PostgreSQL URI from Supabase Connect, including username, password, hostname and database path. Replace [YOUR-PASSWORD] and URL-encode the password (for example, # becomes %23). A raw # can truncate a dotenv import. Update this variable in Vercel and redeploy. The value was not printed.',
  );
  process.exitCode = 1;
} else {
  try {
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (process.env.APP_URL) new URL(process.env.APP_URL);
    console.log(
      'Required live environment variables are present. Values were not printed. Service connectivity is not tested.',
    );
  } catch {
    console.error('Invalid SUPABASE URL or APP_URL.');
    process.exitCode = 1;
  }
}
