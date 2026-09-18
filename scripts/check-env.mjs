const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'TYPESAFE_API_KEY',
  'SUPABASE_DB_URL',
];
const missing = required.filter((k) => !process.env[k]);
if (process.env.APP_MODE === 'demo' || process.env.JEV_MODE === 'mock') {
  console.error('Live deployment requires APP_MODE=supabase and JEV_MODE=jev.');
  process.exitCode = 1;
} else if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
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
