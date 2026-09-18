-- Email is a contact snapshot only, never account identity or authorization.
alter table public.orders add column contact_email text;
alter table public.orders add constraint orders_contact_email_valid check(contact_email is null or (length(contact_email)<=254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
-- Remove the old RPC so authenticated clients cannot bypass the required email.
drop function public.confirm_order(uuid,int,uuid);
create function public.confirm_order(p_quote_id uuid,p_expected_revision int,p_idempotency_key uuid,p_contact_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes; c public.consultations; o public.orders; t public.production_tasks; cat public.catalog_options; begin
 if auth.uid() is null then raise exception 'unauthorized'; end if;
 p_contact_email:=lower(btrim(p_contact_email));
 if p_contact_email is null or length(p_contact_email)>254 or p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_contact_email'; end if;
 if p_idempotency_key is null then raise exception 'invalid_idempotency_key'; end if;
 -- Per-customer lock serializes both same-consultation and cross-consultation key reuse.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into o from public.orders where customer_id=auth.uid() and idempotency_key=p_idempotency_key;
 if found then
  if o.contact_email is distinct from p_contact_email or o.quote_id<>p_quote_id or p_expected_revision is null or not exists(select 1 from public.quotes where id=o.quote_id and revision=p_expected_revision) then raise exception 'idempotency_conflict'; end if;
  select * into t from public.production_tasks where order_id=o.id;
  return jsonb_build_object('order',to_jsonb(o),'task',to_jsonb(t));
 end if;
 select * into q from public.quotes where id=p_quote_id;
 if not found then raise exception 'not_found'; end if;
 select * into c from public.consultations where id=q.consultation_id and customer_id=auth.uid() for update;
 if not found then raise exception 'not_found'; end if;
 select * into o from public.orders where consultation_id=c.id;
 if found then
  if o.contact_email is distinct from p_contact_email then raise exception 'idempotency_conflict'; end if;
  if o.quote_id<>q.id or p_expected_revision is null or q.revision<>p_expected_revision then raise exception 'revision_conflict'; end if;
  select * into t from public.production_tasks where order_id=o.id;
  return jsonb_build_object('order',to_jsonb(o),'task',to_jsonb(t));
 end if;
 if p_expected_revision is null or q.revision<>p_expected_revision or c.revision<>p_expected_revision or c.status<>'ready_for_review' or q.spec_snapshot<>c.confirmed_preferences then raise exception 'revision_conflict'; end if;
 if q.expires_at<=now() then raise exception 'quote_expired'; end if;
 select * into cat from public.catalog_options where size_code=q.spec_snapshot->>'size' and active;
 if not found or cat.price_jpy<>q.amount_jpy or cat.version<>q.catalog_version then raise exception 'price_changed'; end if;
 insert into public.orders(customer_id,consultation_id,quote_id,idempotency_key,spec_snapshot,amount_jpy,desired_date,contact_email) values(auth.uid(),c.id,q.id,p_idempotency_key,q.spec_snapshot,q.amount_jpy,(q.spec_snapshot->>'desiredDate')::date,p_contact_email) returning * into o;
 insert into public.production_tasks(order_id) values(o.id) returning * into t;
 insert into public.task_events(task_id,actor_id,event_type,new_values) values(t.id,auth.uid(),'created',to_jsonb(t));
 update public.consultations set status='ordered',updated_at=now() where id=c.id;
 return jsonb_build_object('order',to_jsonb(o),'task',to_jsonb(t)); end $$;

revoke execute on function public.confirm_order(uuid,int,uuid,text) from public,anon;
grant execute on function public.confirm_order(uuid,int,uuid,text) to authenticated;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false and exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin')
$$;
-- Persistent pre-auth throttle shared across serverless instances; no raw IPs stored.
create table public.guest_rate_limits (
 ip_hash text primary key check(ip_hash ~ '^[a-f0-9]{64}$'),
 window_start timestamptz not null,
 request_count integer not null
);
alter table public.guest_rate_limits enable row level security;
revoke all on public.guest_rate_limits from public,anon,authenticated;
create function public.consume_guest_rate_limit(p_ip_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int; begin
 if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_rate_limit'; end if;
 delete from public.guest_rate_limits where window_start < now()-interval '1 day';
 insert into public.guest_rate_limits values(p_ip_hash,now(),1)
 on conflict(ip_hash) do update set
 request_count=case when public.guest_rate_limits.window_start<=now()-interval '1 hour' then 1 else least(public.guest_rate_limits.request_count+1,11) end,
 window_start=case when public.guest_rate_limits.window_start<=now()-interval '1 hour' then now() else public.guest_rate_limits.window_start end
 returning request_count into n;
 return n<=10;
end $$;
revoke execute on function public.consume_guest_rate_limit(text) from public,anon,authenticated;
grant execute on function public.consume_guest_rate_limit(text) to service_role;
