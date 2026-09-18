import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
const admin = '10000000-0000-4000-8000-000000000003';
const mid = '20000000-0000-4000-8000-000000000001';
const key = '30000000-0000-4000-8000-000000000001';
let cid: string, qid: string, taskId: string;
async function user(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;`,
  );
  for (const file of readdirSync(resolve('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    // PGlite has gen_random_uuid built in, but doesn't bundle pgcrypto's optional extension.
    await db.exec(
      readFileSync(resolve('supabase/migrations', file), 'utf8').replace(
        'create extension if not exists pgcrypto;',
        '',
      ),
    );
  }
  await db.exec(
    `insert into auth.users(id) values('${alice}'),('${bob}'),('${admin}'); update public.user_roles set role='admin' where user_id='${admin}';`,
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Postgres migrations, RLS, atomic ordering', () => {
  it('all application tables enable RLS and clients cannot self-promote', async () => {
    const rows = await query<{ relname: string }>(
      `select relname from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='public' and relkind='r' and not relrowsecurity`,
    );
    expect(rows).toEqual([]);
    await user(alice);
    await expect(
      db.exec(`update public.user_roles set role='admin' where user_id='${alice}'`),
    ).rejects.toThrow();
    expect((await query<{ is_admin: boolean }>('select public.is_admin()'))[0].is_admin).toBe(
      false,
    );
  });
  it('creates owner consultation and prevents foreign reads and mutations', async () => {
    cid = (await query<{ id: string }>('select * from public.create_consultation()'))[0].id;
    await user(bob);
    expect(await query('select * from public.consultations where id=$1', [cid])).toHaveLength(0);
    await expect(db.query('select public.create_quote($1,0)', [cid])).rejects.toThrow('not_found');
    await user(alice);
  });
  it('server messages are idempotent and inaccessible to authenticated clients', async () => {
    await expect(
      db.query('select public.save_messages($1,$2,0,$3,$4,$5,null)', [
        alice,
        cid,
        mid,
        '青い絵',
        'サイズを選んでください',
      ]),
    ).rejects.toThrow();
    await db.exec('reset role; set role service_role;');
    await db.query('select public.save_messages($1,$2,0,$3,$4,$5,null)', [
      alice,
      cid,
      mid,
      '青い絵',
      'サイズを選んでください',
    ]);
    await db.query('select public.save_messages($1,$2,0,$3,$4,$5,null)', [
      alice,
      cid,
      mid,
      '青い絵',
      'サイズを選んでください',
    ]);
    await expect(
      db.query('select public.save_messages($1,$2,0,$3,$4,$5,null)', [
        alice,
        cid,
        mid,
        '別の内容',
        '別の返信',
      ]),
    ).rejects.toThrow('idempotency_conflict');
    await user(alice);
    expect(
      await query('select * from public.messages where consultation_id=$1', [cid]),
    ).toHaveLength(2);
  });
  it('rejects malformed preferences through direct RPC and prevents foreign writes', async () => {
    const p = {
      size: 'M',
      style: 'abstract',
      budgetJpy: 20000,
      budgetAnswered: true,
      desiredDate: null,
      desiredDateAnswered: true,
      notes: '青色',
    };
    for (const bad of [
      null,
      {},
      { ...p, budgetJpy: '20000' },
      { ...p, size: 25 },
      { ...p, desiredDate: 'infinity' },
      { ...p, desiredDate: '2026-02-30' },
      { ...p, amountJpy: 0 },
      { ...p, budgetJpy: 100000001 },
      { ...p, budgetAnswered: null },
    ]) {
      await expect(
        db.query('select public.update_preferences($1,1,$2)', [cid, JSON.stringify(bad)]),
      ).rejects.toThrow('invalid_');
    }
    await user(bob);
    await expect(
      db.query('select public.update_preferences($1,1,$2)', [cid, JSON.stringify(p)]),
    ).rejects.toThrow('not_found');
    expect(await query('select * from public.messages')).toHaveLength(0);
    await user(alice);
  });
  it('prices from catalog, rejects stale quotes and direct price tampering', async () => {
    const p = {
      size: 'M',
      style: 'abstract',
      budgetJpy: 20000,
      budgetAnswered: true,
      desiredDate: null,
      desiredDateAnswered: true,
      notes: '青色',
    };
    await db.query('select public.update_preferences($1,1,$2)', [cid, JSON.stringify(p)]);
    const q = (
      await query<{ id: string; amount_jpy: number }>('select * from public.create_quote($1,2)', [
        cid,
      ])
    )[0];
    expect(q.amount_jpy).toBe(20000);
    await expect(
      db.query('update public.quotes set amount_jpy=0 where id=$1', [q.id]),
    ).rejects.toThrow();
    await db.query('select public.update_preferences($1,2,$2)', [
      cid,
      JSON.stringify({ ...p, notes: '青と白' }),
    ]);
    await expect(
      db.query("select public.confirm_order($1,2,$2,'customer@example.com')", [q.id, key]),
    ).rejects.toThrow('revision_conflict');
    qid = (await query<{ id: string }>('select * from public.create_quote($1,3)', [cid]))[0].id;
  });
  it('rejects expired quotes and nullable concurrency tokens without creating orders', async () => {
    await db.exec('reset role;');
    await db.query("update public.quotes set expires_at=now()-interval '1 second' where id=$1", [
      qid,
    ]);
    await user(alice);
    await expect(
      db.query("select public.confirm_order($1,3,$2,'customer@example.com')", [qid, key]),
    ).rejects.toThrow('quote_expired');
    await expect(
      db.query("select public.confirm_order($1,null,$2,'customer@example.com')", [qid, key]),
    ).rejects.toThrow('revision_conflict');
    expect(await query('select * from public.orders')).toHaveLength(0);
    expect(await query('select * from public.production_tasks')).toHaveLength(0);
    await db.exec('reset role;');
    await db.query("update public.quotes set expires_at=now()+interval '1 day' where id=$1", [qid]);
    await user(alice);
  });
  it('commits one order and one task despite repeated confirmations', async () => {
    await user(bob);
    await expect(
      db.query("select public.confirm_order($1,3,$2,'customer@example.com')", [qid, key]),
    ).rejects.toThrow('not_found');
    await user(alice);
    const first = (
      await query<{ result: { order: { id: string }; task: { id: string } } }>(
        "select public.confirm_order($1,3,$2,'customer@example.com') result",
        [qid, key],
      )
    )[0].result;
    const second = (
      await query<{ result: { order: { id: string } } }>(
        "select public.confirm_order($1,3,$2,'customer@example.com') result",
        [qid, key],
      )
    )[0].result;
    expect(first.order.id).toBe(second.order.id);
    taskId = first.task.id;
    expect(await query('select * from public.orders')).toHaveLength(1);
    expect(await query('select * from public.production_tasks')).toHaveLength(1);
    await expect(
      db.query('select public.update_task($1,0,$2)', [taskId, 'in_progress']),
    ).rejects.toThrow('forbidden');
  });
  it('rejects conflicting confirmation keys and exposes no foreign orders', async () => {
    await expect(
      db.query("select public.confirm_order($1,2,$2,'customer@example.com')", [qid, key]),
    ).rejects.toThrow('idempotency_conflict');
    await user(bob);
    expect(await query('select * from public.orders')).toHaveLength(0);
    expect(await query('select * from public.production_tasks')).toHaveLength(0);
    await expect(
      db.query('select public.save_priority_evaluation($1,$2,0,$3)', [bob, taskId, 'failed']),
    ).rejects.toThrow();
    await db.exec('reset role; set role service_role;');
    await expect(
      db.query('select public.save_priority_evaluation($1,$2,0,$3)', [bob, taskId, 'failed']),
    ).rejects.toThrow('forbidden');
    await user(alice);
  });
  it('uses persistent per-user rate limits with restricted grants', async () => {
    await expect(
      db.query('select public.consume_rate_limit($1,$2)', [alice, 'jev']),
    ).rejects.toThrow();
    await db.exec('reset role; set role service_role;');
    for (let n = 0; n < 15; n++)
      expect(
        (
          await query<{ allowed: boolean }>('select public.consume_rate_limit($1,$2) allowed', [
            alice,
            'jev',
          ])
        )[0].allowed,
      ).toBe(true);
    expect(
      (
        await query<{ allowed: boolean }>('select public.consume_rate_limit($1,$2) allowed', [
          alice,
          'jev',
        ])
      )[0].allowed,
    ).toBe(false);
    expect(
      (
        await query<{ allowed: boolean }>('select public.consume_rate_limit($1,$2) allowed', [
          bob,
          'jev',
        ])
      )[0].allowed,
    ).toBe(true);
  });
  it('enforces task transitions/version and atomically records cancellation', async () => {
    await user(admin);
    await expect(
      db.query('select public.update_task($1,0,$2)', [taskId, 'completed']),
    ).rejects.toThrow('invalid_transition');
    await db.query('select public.update_task($1,0,$2)', [taskId, 'in_progress']);
    await expect(
      db.query('select public.update_task($1,0,$2)', [taskId, 'completed']),
    ).rejects.toThrow('version_conflict');
    await db.query('select public.update_task($1,1,$2)', [taskId, 'cancelled']);
    expect((await query<{ status: string }>('select status from public.orders'))[0].status).toBe(
      'cancelled',
    );
    expect(await query('select * from public.task_events')).toHaveLength(3);
    await expect(
      db.query('select public.update_task($1,2,$2)', [taskId, 'queued']),
    ).rejects.toThrow('invalid_transition');
  });
  it('logs consultation outcomes once and routes low-confidence queued work to review', async () => {
    await user(admin);
    const prior = await query<{ status: string }>(
      'select status from public.jev_evaluations where consultation_id=$1',
      [cid],
    );
    expect(prior).toEqual([{ status: 'failed' }]);
    await user(alice);
    const c = (await query<{ id: string }>('select * from public.create_consultation()'))[0].id;
    const candidate = {
      provider: 'mock',
      questionVersion: 'painting-v1',
      size: { value: 'M', confidence: 0.9 },
      style: { value: 'abstract', confidence: 0.9 },
      needsReview: false,
      changeRequested: false,
    };
    await db.exec('reset role; set role service_role;');
    await db.query('select public.save_messages($1,$2,0,$3,$4,$5,$6,$7)', [
      alice,
      c,
      mid,
      '抽象画',
      '候補を確認してください',
      JSON.stringify(candidate),
      'mock',
    ]);
    await user(admin);
    const log = (
      await query<{ model: string; input_revision: number; status: string }>(
        'select model,input_revision,status from public.jev_evaluations where consultation_id=$1',
        [c],
      )
    )[0];
    expect(log).toEqual({ model: 'mock', input_revision: 0, status: 'succeeded' });
    await user(alice);
    await db.query('select public.update_preferences($1,1,$2)', [
      c,
      JSON.stringify({
        size: 'M',
        style: 'abstract',
        budgetJpy: null,
        budgetAnswered: true,
        desiredDate: null,
        desiredDateAnswered: true,
        notes: '',
      }),
    ]);
    const q = (await query<{ id: string }>('select * from public.create_quote($1,2)', [c]))[0].id;
    const confirmed = (
      await query<{ result: { task: { id: string } } }>(
        "select public.confirm_order($1,2,$2,'customer@example.com') result",
        [q, '30000000-0000-4000-8000-000000000002'],
      )
    )[0].result;
    await db.exec('reset role; set role service_role;');
    const t = (
      await query<{ status: string; version: number }>(
        'select * from public.save_priority_evaluation($1,$2,0,$3,0.5,0.5,0.2,$4,$5)',
        [alice, confirmed.task.id, 'succeeded', 'mock', 'painting-v1'],
      )
    )[0];
    expect(t.status).toBe('needs_review');
    expect(t.version).toBe(1);
    await user(admin);
    expect(
      await query('select * from public.task_events where task_id=$1', [confirmed.task.id]),
    ).toHaveLength(2);
  });
  it('requires checkout email, preserves ownership and prevents changing the email on retry', async () => {
    await user(alice);
    await expect(
      db.query('select public.confirm_order($1,3,$2,$3)', [qid, key, 'invalid']),
    ).rejects.toThrow('invalid_contact_email');
    await expect(
      db.query('select public.confirm_order($1,3,$2,$3)', [qid, key, 'another@example.com']),
    ).rejects.toThrow('idempotency_conflict');
    const rows = await query<{ contact_email: string }>(
      'select contact_email from public.orders where quote_id=$1',
      [qid],
    );
    expect(rows[0].contact_email).toBe('customer@example.com');
    await user(bob);
    expect(await query('select * from public.orders where quote_id=$1', [qid])).toHaveLength(0);
    await expect(
      db.query('select public.confirm_order($1,3,$2,$3)', [qid, key, 'customer@example.com']),
    ).rejects.toThrow('not_found');
  });
  it('anonymous sessions cannot use an accidentally granted admin role', async () => {
    await user(admin);
    await db.exec(`select set_config('request.jwt.claims','{"is_anonymous":true}',false)`);
    expect((await query<{ is_admin: boolean }>('select public.is_admin()'))[0].is_admin).toBe(
      false,
    );
    await db.exec(`select set_config('request.jwt.claims','{}',false)`);
  });
  it('guest throttle is persistent and only callable by the server', async () => {
    await user(alice);
    await expect(
      db.query('select public.consume_guest_rate_limit($1)', ['a'.repeat(64)]),
    ).rejects.toThrow();
    await db.exec('reset role; set role service_role;');
    for (let n = 0; n < 10; n++)
      expect(
        (
          await query<{ ok: boolean }>('select public.consume_guest_rate_limit($1) ok', [
            'a'.repeat(64),
          ])
        )[0].ok,
      ).toBe(true);
    expect(
      (
        await query<{ ok: boolean }>('select public.consume_guest_rate_limit($1) ok', [
          'a'.repeat(64),
        ])
      )[0].ok,
    ).toBe(false);
  });
  it('streamed turns commit atomically, preserve proposal order and accept only the latest explicit proposal', async () => {
    await user(alice);
    const c = (await query<{ id: string }>('select * from public.create_consultation()'))[0].id;
    const proposalId = '90000000-0000-4000-8000-000000000001';
    const replies = [
      { id: '90000000-0000-4000-8000-000000000002', body: 'お部屋に合う絵を考えましょう。' },
      { id: proposalId, body: 'Mサイズを条件に反映しますか？' },
    ];
    const proposal = {
      id: proposalId,
      revision: 1,
      patch: { size: 'M' },
      message: replies[1].body,
    };
    const saveSql = 'select * from public.save_chat_turn($1,$2,$3,$4,$5,$6,null,$7,$8,$9)';
    const args = [
      alice,
      c,
      0,
      mid,
      'Mサイズ',
      JSON.stringify(replies),
      JSON.stringify(proposal),
      null,
      'mock',
    ];
    await expect(db.query(saveSql, args)).rejects.toThrow();
    await db.exec('reset role; set role service_role;');
    await db.query(saveSql, args);
    await db.query(saveSql, args);
    await expect(
      db.query(saveSql, [...args.slice(0, 4), '別の内容', ...args.slice(5)]),
    ).rejects.toThrow('idempotency_conflict');
    await user(alice);
    const messages = await query<{ body: string }>(
      'select body from public.messages where consultation_id=$1 order by created_at',
      [c],
    );
    expect(messages.map((m) => m.body)).toEqual(['Mサイズ', ...replies.map((r) => r.body)]);
    const before = (
      await query<{ confirmed_preferences: { size: string | null }; pending_proposal: unknown }>(
        'select * from public.consultations where id=$1',
        [c],
      )
    )[0];
    expect(before.confirmed_preferences.size).toBeNull();
    expect(before.pending_proposal).toEqual(proposal);
    await db.exec('reset role; set role service_role;');
    const acceptArgs = [
      alice,
      c,
      1,
      '90000000-0000-4000-8000-000000000003',
      'いいえ',
      JSON.stringify([{ id: '90000000-0000-4000-8000-000000000004', body: '反映します。' }]),
      null,
      proposalId,
      'mock',
    ];
    await expect(db.query(saveSql, acceptArgs)).rejects.toThrow('invalid_acceptance');
    acceptArgs[4] = 'それでお願いします';
    const accepted = (
      await query<{
        confirmed_preferences: { size: string };
        pending_proposal: unknown;
        revision: number;
      }>(saveSql, acceptArgs)
    )[0];
    expect(accepted.confirmed_preferences.size).toBe('M');
    expect(accepted.pending_proposal).toBeNull();
    expect(accepted.revision).toBe(2);
    await expect(
      db.query(saveSql, [
        alice,
        c,
        1,
        '90000000-0000-4000-8000-000000000005',
        '別の話',
        acceptArgs[5],
        null,
        null,
        'mock',
      ]),
    ).rejects.toThrow('revision_conflict');
    await user(alice);
    expect(await query('select * from public.orders where consultation_id=$1', [c])).toHaveLength(
      0,
    );
    // A manual change expires a newer proposal without changing the RPC signature.
    await db.exec('reset role; set role service_role;');
    await db.query(saveSql, [
      alice,
      c,
      2,
      '90000000-0000-4000-8000-000000000006',
      'Lサイズ',
      JSON.stringify([{ id: '90000000-0000-4000-8000-000000000007', body: 'Lサイズですか？' }]),
      JSON.stringify({ ...proposal, revision: 3, patch: { size: 'L' } }),
      null,
      'mock',
    ]);
    await user(alice);
    const current = (
      await query<{ confirmed_preferences: unknown }>(
        'select confirmed_preferences from public.consultations where id=$1',
        [c],
      )
    )[0];
    await db.query('select public.update_preferences($1,3,$2)', [
      c,
      JSON.stringify(current.confirmed_preferences),
    ]);
    expect(
      (
        await query<{ pending_proposal: unknown }>(
          'select pending_proposal from public.consultations where id=$1',
          [c],
        )
      )[0].pending_proposal,
    ).toBeNull();
  });
});
