-- Called only by the trusted Next.js server after authenticating the request.
create function public.save_messages(p_customer_id uuid,p_consultation_id uuid,p_expected_revision int,p_client_message_id uuid,p_message text,p_reply text,p_candidates jsonb default null,p_model text default 'jev-latest') returns public.consultations language plpgsql security definer set search_path='' as $$
declare c public.consultations; begin
 select * into c from public.consultations where id=p_consultation_id and customer_id=p_customer_id for update;
 if not found then raise exception 'not_found'; end if;
 if exists(select 1 from public.messages where consultation_id=c.id and client_message_id=p_client_message_id and sender='customer') then
  if not exists(select 1 from public.messages where consultation_id=c.id and client_message_id=p_client_message_id and sender='customer' and body=p_message) then raise exception 'idempotency_conflict'; end if;
  return c;
 end if;
 if p_expected_revision is null or c.revision<>p_expected_revision or c.status='ordered' then raise exception 'revision_conflict'; end if;
 insert into public.messages(consultation_id,sender,body,client_message_id) values(c.id,'customer',p_message,p_client_message_id),(c.id,'assistant',p_reply,p_client_message_id);
 insert into public.jev_evaluations(consultation_id,input_revision,purpose,model,question_version,answers,status) values(c.id,c.revision,'consultation',p_model,coalesce(p_candidates->>'questionVersion','unavailable'),coalesce(p_candidates,'{}'::jsonb),case when p_candidates is null then 'failed' else 'succeeded' end);
 update public.consultations set candidates=p_candidates,revision=revision+1,status='collecting',updated_at=now() where id=c.id returning * into c;
 return c;
end $$;
create function public.save_priority_evaluation(p_actor_id uuid,p_task_id uuid,p_expected_version int,p_status text,p_urgency double precision default null,p_complexity double precision default null,p_confidence double precision default null,p_provider text default null,p_question_version text default null,p_answers jsonb default '{}'::jsonb,p_model text default 'jev-latest',p_latency_ms int default null) returns public.production_tasks language plpgsql security definer set search_path='' as $$
declare t public.production_tasks; old_t public.production_tasks; o public.orders; q public.quotes; begin
 select * into t from public.production_tasks where id=p_task_id for update;
 if not found then raise exception 'not_found'; end if;
 select * into o from public.orders where id=t.order_id;
 if p_actor_id is null or not (o.customer_id=p_actor_id or exists(select 1 from public.user_roles where user_id=p_actor_id and role='admin')) then raise exception 'forbidden'; end if;
 if p_expected_version is null or t.version<>p_expected_version then raise exception 'version_conflict'; end if;
 if p_status is null or p_status not in ('succeeded','failed') or (p_status='succeeded' and (p_urgency is null or p_complexity is null or p_confidence is null or p_provider is null or p_question_version is null)) then raise exception 'invalid_evaluation'; end if;
 old_t:=t;
 update public.production_tasks set status=case when status='queued' and p_status='succeeded' and p_confidence<0.5 then 'needs_review' else status end,evaluation_status=p_status,urgency=case when p_status='succeeded' then p_urgency end,complexity=case when p_status='succeeded' then p_complexity end,confidence=case when p_status='succeeded' then p_confidence end,provider=p_provider,question_version=p_question_version,version=version+1,updated_at=now() where id=t.id returning * into t;
 select * into q from public.quotes where id=o.quote_id;
 insert into public.jev_evaluations(order_id,input_revision,purpose,model,question_version,answers,latency_ms,status) values(o.id,q.revision,'priority',p_model,coalesce(p_question_version,'unknown'),p_answers,p_latency_ms,p_status);
 insert into public.task_events(task_id,actor_id,event_type,old_values,new_values) values(t.id,p_actor_id,'evaluated',to_jsonb(old_t),to_jsonb(t));
 return t;
end $$;
revoke execute on function public.save_messages(uuid,uuid,int,uuid,text,text,jsonb,text), public.save_priority_evaluation(uuid,uuid,int,text,double precision,double precision,double precision,text,text,jsonb,text,int) from public,anon,authenticated;
grant execute on function public.save_messages(uuid,uuid,int,uuid,text,text,jsonb,text), public.save_priority_evaluation(uuid,uuid,int,text,double precision,double precision,double precision,text,text,jsonb,text,int) to service_role;
