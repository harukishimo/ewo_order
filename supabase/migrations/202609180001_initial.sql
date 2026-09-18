create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users on delete cascade, display_name text not null default '', created_at timestamptz not null default now());
create table public.user_roles(user_id uuid primary key references auth.users on delete cascade, role text not null default 'customer' check(role in ('customer','admin')));
create table public.catalog_options(id uuid primary key default gen_random_uuid(), size_code text unique not null check(size_code in ('S','M','L')), width_cm int not null check(width_cm>0), height_cm int not null check(height_cm>0), price_jpy int not null check(price_jpy>=0), active boolean not null default true, version int not null default 1 check(version>0));
create table public.consultations(id uuid primary key default gen_random_uuid(), customer_id uuid not null references auth.users, status text not null default 'collecting' check(status in ('collecting','ready_for_review','ordered','needs_review')), confirmed_preferences jsonb not null default '{"size":null,"style":null,"budgetJpy":null,"budgetAnswered":false,"desiredDate":null,"desiredDateAnswered":false,"notes":""}', candidates jsonb, revision int not null default 0 check(revision>=0), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.messages(id uuid primary key default gen_random_uuid(), consultation_id uuid not null references public.consultations on delete cascade, sender text not null check(sender in ('customer','assistant')), body text not null check(length(body) between 1 and 4000), client_message_id uuid not null, created_at timestamptz not null default now(), unique(consultation_id,client_message_id,sender));
create table public.quotes(id uuid primary key default gen_random_uuid(), consultation_id uuid not null references public.consultations, revision int not null, spec_snapshot jsonb not null, amount_jpy int not null check(amount_jpy>=0), catalog_version int not null, expires_at timestamptz not null default now()+interval '24 hours', created_at timestamptz not null default now());
create sequence public.order_number_seq;
create table public.orders(id uuid primary key default gen_random_uuid(), order_number text not null unique default ('ART-'||lpad(nextval('public.order_number_seq')::text,8,'0')), customer_id uuid not null references auth.users, consultation_id uuid not null unique references public.consultations, quote_id uuid not null unique references public.quotes, idempotency_key uuid not null, spec_snapshot jsonb not null, amount_jpy int not null check(amount_jpy>=0), desired_date date, approved_at timestamptz not null default now(), status text not null default 'accepted' check(status in ('accepted','cancelled')), unique(customer_id,idempotency_key));
create table public.production_tasks(id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders, status text not null default 'queued' check(status in ('queued','needs_review','in_progress','completed','cancelled')), assigned_to uuid references auth.users, evaluation_status text not null default 'pending' check(evaluation_status in ('pending','succeeded','failed')), urgency double precision check(urgency between 0 and 1), complexity double precision check(complexity between 0 and 1), confidence double precision check(confidence between 0 and 1), provider text check(provider in ('mock','jev')), question_version text, manual_priority double precision check(manual_priority between 0 and 100), override_reason text, version int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(manual_priority is null or length(trim(override_reason))>0));
create table public.jev_evaluations(id uuid primary key default gen_random_uuid(), consultation_id uuid references public.consultations, order_id uuid references public.orders, input_revision int not null, purpose text not null check(purpose in ('consultation','priority')), model text not null, question_version text not null, answers jsonb not null, latency_ms int check(latency_ms>=0), status text not null check(status in ('succeeded','failed')), created_at timestamptz not null default now(), check(num_nonnulls(consultation_id,order_id)=1));
create table public.task_events(id uuid primary key default gen_random_uuid(), task_id uuid not null references public.production_tasks, actor_id uuid references auth.users, event_type text not null, old_values jsonb, new_values jsonb, created_at timestamptz not null default now());
create index on public.consultations(customer_id,created_at);
create index on public.messages(consultation_id,created_at);
create index on public.quotes(consultation_id);
create index on public.orders(customer_id,approved_at);
create index on public.production_tasks(status,created_at);
create index on public.task_events(task_id,created_at);
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin') $$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id) values(new.id); insert into public.user_roles(user_id) values(new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
-- Read access is RLS-scoped. All writes go through narrowly-scoped RPCs.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.catalog_options enable row level security;
alter table public.consultations enable row level security;
alter table public.messages enable row level security;
alter table public.quotes enable row level security;
alter table public.orders enable row level security;
alter table public.production_tasks enable row level security;
alter table public.jev_evaluations enable row level security;
alter table public.task_events enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy roles_read on public.user_roles for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy catalog_read on public.catalog_options for select to anon,authenticated using(active);
create policy consultation_read on public.consultations for select to authenticated using(customer_id=auth.uid() or public.is_admin());
create policy messages_read on public.messages for select to authenticated using(exists(select 1 from public.consultations c where c.id=consultation_id and (c.customer_id=auth.uid() or public.is_admin())));
create policy quotes_read on public.quotes for select to authenticated using(exists(select 1 from public.consultations c where c.id=consultation_id and (c.customer_id=auth.uid() or public.is_admin())));
create policy orders_read on public.orders for select to authenticated using(customer_id=auth.uid() or public.is_admin());
create policy tasks_read on public.production_tasks for select to authenticated using(public.is_admin() or exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid()));
create policy evaluations_read on public.jev_evaluations for select to authenticated using(public.is_admin());
create policy events_read on public.task_events for select to authenticated using(public.is_admin());
revoke all on all tables in schema public from anon,authenticated;
grant select on public.catalog_options to anon;
grant select on public.profiles,public.user_roles,public.catalog_options,public.consultations,public.messages,public.quotes,public.orders,public.production_tasks,public.jev_evaluations,public.task_events to authenticated;
create function public.create_consultation() returns public.consultations language plpgsql security definer set search_path='' as $$ declare c public.consultations; begin if auth.uid() is null then raise exception 'unauthorized'; end if; insert into public.consultations(customer_id) values(auth.uid()) returning * into c; return c; end $$;
create function public.update_preferences(p_consultation_id uuid,p_expected_revision int,p_preferences jsonb) returns public.consultations language plpgsql security definer set search_path='' as $$
declare c public.consultations; begin
 select * into c from public.consultations where id=p_consultation_id and customer_id=auth.uid() for update;
 if not found then raise exception 'not_found'; end if;
 if p_expected_revision is null or c.revision<>p_expected_revision or c.status='ordered' then raise exception 'revision_conflict'; end if;
 if p_preferences is null or jsonb_typeof(p_preferences)<>'object' or not (p_preferences ?& array['size','style','budgetJpy','budgetAnswered','desiredDate','desiredDateAnswered','notes']) or (p_preferences - array['size','style','budgetJpy','budgetAnswered','desiredDate','desiredDateAnswered','notes']) <> '{}'::jsonb then raise exception 'invalid_preferences'; end if;
 if (jsonb_typeof(p_preferences->'size') not in ('null','string')) or (jsonb_typeof(p_preferences->'style') not in ('null','string')) or (p_preferences->>'size' is not null and p_preferences->>'size' not in ('S','M','L','custom')) or (p_preferences->>'style' is not null and p_preferences->>'style' not in ('abstract','landscape','botanical','other')) or jsonb_typeof(p_preferences->'budgetAnswered') <> 'boolean' or jsonb_typeof(p_preferences->'desiredDateAnswered') <> 'boolean' or jsonb_typeof(p_preferences->'notes') <> 'string' or length(p_preferences->>'notes')>4000 then raise exception 'invalid_preferences'; end if;
 if jsonb_typeof(p_preferences->'budgetJpy') not in ('null','number') then raise exception 'invalid_budget'; end if;
 if (p_preferences->>'budgetJpy') is not null and ((p_preferences->>'budgetJpy')::numeric not between 0 and 100000000 or (p_preferences->>'budgetJpy')::numeric<>trunc((p_preferences->>'budgetJpy')::numeric)) then raise exception 'invalid_budget'; end if;
 if jsonb_typeof(p_preferences->'desiredDate') not in ('null','string') then raise exception 'invalid_date'; end if;
 if (p_preferences->>'desiredDate') is not null then
  if p_preferences->>'desiredDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_date'; end if;
  begin perform (p_preferences->>'desiredDate')::date; exception when others then raise exception 'invalid_date'; end;
 end if;
 update public.consultations set confirmed_preferences=p_preferences, revision=revision+1,status='collecting',updated_at=now() where id=c.id returning * into c;
 return c; end $$;
create function public.create_quote(p_consultation_id uuid,p_expected_revision int) returns public.quotes language plpgsql security definer set search_path='' as $$
declare c public.consultations; cat public.catalog_options; q public.quotes; p jsonb; begin
 select * into c from public.consultations where id=p_consultation_id and customer_id=auth.uid() for update;
 if not found then raise exception 'not_found'; end if;
 if p_expected_revision is null or c.revision<>p_expected_revision or c.status='ordered' then raise exception 'revision_conflict'; end if;
 p:=c.confirmed_preferences;
 if coalesce(p->>'style','') not in ('abstract','landscape','botanical') or p->>'budgetAnswered' is distinct from 'true' or p->>'desiredDateAnswered' is distinct from 'true' then raise exception 'needs_review'; end if;
 select * into cat from public.catalog_options where size_code=p->>'size' and active;
 if not found or ((p->>'budgetJpy') is not null and (p->>'budgetJpy')::numeric<cat.price_jpy) then raise exception 'needs_review'; end if;
 insert into public.quotes(consultation_id,revision,spec_snapshot,amount_jpy,catalog_version) values(c.id,c.revision,p,cat.price_jpy,cat.version) returning * into q;
 update public.consultations set status='ready_for_review',updated_at=now() where id=c.id; return q;
end $$;
create function public.confirm_order(p_quote_id uuid,p_expected_revision int,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes; c public.consultations; o public.orders; t public.production_tasks; cat public.catalog_options; begin
 if auth.uid() is null then raise exception 'unauthorized'; end if;
 if p_idempotency_key is null then raise exception 'invalid_idempotency_key'; end if;
 -- Per-customer lock serializes both same-consultation and cross-consultation key reuse.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into o from public.orders where customer_id=auth.uid() and idempotency_key=p_idempotency_key;
 if found then
  if o.quote_id<>p_quote_id or p_expected_revision is null or not exists(select 1 from public.quotes where id=o.quote_id and revision=p_expected_revision) then raise exception 'idempotency_conflict'; end if;
  select * into t from public.production_tasks where order_id=o.id;
  return jsonb_build_object('order',to_jsonb(o),'task',to_jsonb(t));
 end if;
 select * into q from public.quotes where id=p_quote_id;
 if not found then raise exception 'not_found'; end if;
 select * into c from public.consultations where id=q.consultation_id and customer_id=auth.uid() for update;
 if not found then raise exception 'not_found'; end if;
 select * into o from public.orders where consultation_id=c.id;
 if found then
  if o.quote_id<>q.id or p_expected_revision is null or q.revision<>p_expected_revision then raise exception 'revision_conflict'; end if;
  select * into t from public.production_tasks where order_id=o.id;
  return jsonb_build_object('order',to_jsonb(o),'task',to_jsonb(t));
 end if;
 if p_expected_revision is null or q.revision<>p_expected_revision or c.revision<>p_expected_revision or c.status<>'ready_for_review' or q.spec_snapshot<>c.confirmed_preferences then raise exception 'revision_conflict'; end if;
 if q.expires_at<=now() then raise exception 'quote_expired'; end if;
 select * into cat from public.catalog_options where size_code=q.spec_snapshot->>'size' and active;
 if not found or cat.price_jpy<>q.amount_jpy or cat.version<>q.catalog_version then raise exception 'price_changed'; end if;
 insert into public.orders(customer_id,consultation_id,quote_id,idempotency_key,spec_snapshot,amount_jpy,desired_date) values(auth.uid(),c.id,q.id,p_idempotency_key,q.spec_snapshot,q.amount_jpy,(q.spec_snapshot->>'desiredDate')::date) returning * into o;
 insert into public.production_tasks(order_id) values(o.id) returning * into t;
 insert into public.task_events(task_id,actor_id,event_type,new_values) values(t.id,auth.uid(),'created',to_jsonb(t));
 update public.consultations set status='ordered',updated_at=now() where id=c.id;
 return jsonb_build_object('order',to_jsonb(o),'task',to_jsonb(t)); end $$;
create function public.update_task(p_task_id uuid,p_expected_version int,p_status text default null,p_manual_priority double precision default null,p_override_reason text default null,p_change_priority boolean default false) returns public.production_tasks language plpgsql security definer set search_path='' as $$
declare t public.production_tasks; old_t public.production_tasks; begin
 if not public.is_admin() then raise exception 'forbidden'; end if;
 select * into t from public.production_tasks where id=p_task_id for update;
 if not found then raise exception 'not_found'; end if;
 if p_expected_version is null or t.version<>p_expected_version then raise exception 'version_conflict'; end if;
 old_t:=t;
 if p_status is not null and p_status<>t.status then
  if not ((t.status='queued' and p_status in ('in_progress','needs_review','cancelled')) or (t.status='in_progress' and p_status in ('completed','needs_review','cancelled')) or (t.status='needs_review' and p_status in ('queued','cancelled'))) then raise exception 'invalid_transition'; end if;
  t.status:=p_status;
 end if;
 if p_change_priority then
  if p_manual_priority is not null and (p_manual_priority not between 0 and 100 or coalesce(length(trim(p_override_reason)),0)=0 or length(p_override_reason)>1000) then raise exception 'invalid_priority'; end if;
  t.manual_priority:=p_manual_priority; t.override_reason:=case when p_manual_priority is null then null else p_override_reason end;
 end if;
 update public.production_tasks set status=t.status,manual_priority=t.manual_priority,override_reason=t.override_reason,version=version+1,updated_at=now() where id=t.id returning * into t;
 if t.status='cancelled' then update public.orders set status='cancelled' where id=t.order_id; end if;
 insert into public.task_events(task_id,actor_id,event_type,old_values,new_values) values(t.id,auth.uid(),'updated',to_jsonb(old_t),to_jsonb(t)); return t;
end $$;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin(),public.create_consultation(),public.update_preferences(uuid,int,jsonb),public.create_quote(uuid,int),public.confirm_order(uuid,int,uuid),public.update_task(uuid,int,text,double precision,text,boolean) to authenticated;
