-- Shared across Vercel instances; never a client-supplied actor.
create table public.request_rate_limits(
 actor_id uuid not null references auth.users on delete cascade,
 bucket text not null check(bucket in ('write','jev')),
 window_start timestamptz not null,
 request_count integer not null check(request_count>0),
 primary key(actor_id,bucket)
);
alter table public.request_rate_limits enable row level security;
revoke all on public.request_rate_limits from public,anon,authenticated;
create function public.consume_rate_limit(p_actor_id uuid,p_bucket text default 'write') returns boolean
language plpgsql security definer set search_path='' as $$
declare n int; lim int; begin
 if p_actor_id is null or p_bucket not in ('write','jev') or p_bucket is null then raise exception 'invalid_rate_limit'; end if;
 lim:=case when p_bucket='jev' then 15 else 30 end;
 insert into public.request_rate_limits(actor_id,bucket,window_start,request_count) values(p_actor_id,p_bucket,now(),1)
 on conflict(actor_id,bucket) do update set
 request_count=case when public.request_rate_limits.window_start<=now()-interval '1 minute' then 1 else least(public.request_rate_limits.request_count+1,31) end,
 window_start=case when public.request_rate_limits.window_start<=now()-interval '1 minute' then now() else public.request_rate_limits.window_start end
 returning request_count into n;
 return n<=lim;
end $$;
revoke execute on function public.consume_rate_limit(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(uuid,text) to service_role;
