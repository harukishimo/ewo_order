-- Proposals are separate from confirmed conditions and expire on any intervening revision.
alter table public.consultations add column pending_proposal jsonb;
create function public.expire_chat_proposal() returns trigger language plpgsql set search_path='' as $$
begin
 if new.pending_proposal is not null and
   ((new.pending_proposal->>'revision')::int is distinct from new.revision or new.status='ordered') then
   new.pending_proposal := null;
 end if;
 return new;
end $$;
create trigger expire_chat_proposal before update on public.consultations for each row execute function public.expire_chat_proposal();

create function public.save_chat_turn(
 p_customer_id uuid,p_consultation_id uuid,p_expected_revision int,p_client_message_id uuid,
 p_message text,p_replies jsonb,p_candidates jsonb,p_proposal jsonb,p_accept_proposal_id uuid,p_model text
) returns public.consultations language plpgsql security definer set search_path='' as $$
declare c public.consultations; r jsonb; i int:=0; p jsonb;
begin
 select * into c from public.consultations where id=p_consultation_id and customer_id=p_customer_id for update;
 if not found then raise exception 'not_found'; end if;
 if exists(select 1 from public.messages where consultation_id=c.id and client_message_id=p_client_message_id and sender='customer') then
  if not exists(select 1 from public.messages where consultation_id=c.id and client_message_id=p_client_message_id and sender='customer' and body=p_message) then raise exception 'idempotency_conflict'; end if;
  return c;
 end if;
 if p_expected_revision is null or c.revision<>p_expected_revision or c.status='ordered' then raise exception 'revision_conflict'; end if;
 if p_replies is null or jsonb_typeof(p_replies)<>'array' or jsonb_array_length(p_replies) not between 1 and 2 then raise exception 'invalid_replies'; end if;
 p := c.confirmed_preferences;
 if p_accept_proposal_id is not null then
  if c.pending_proposal is null or c.pending_proposal->>'id' is distinct from p_accept_proposal_id::text or (c.pending_proposal->>'revision')::int is distinct from c.revision then raise exception 'revision_conflict'; end if;
  if regexp_replace(trim(p_message),'[。！![:space:]]','','g') !~ '^(はい|お願いします|それでお願いします|それで大丈夫です|それでいいです|その内容でお願いします|はいお願いします|はいそれでお願いします)$' then raise exception 'invalid_acceptance'; end if;
  p := p || (c.pending_proposal->'patch');
 end if;
 if p_proposal is not null and (jsonb_typeof(p_proposal)<>'object' or (p_proposal->>'revision')::int is distinct from c.revision+1 or jsonb_typeof(p_proposal->'patch') is distinct from 'object') then raise exception 'invalid_proposal'; end if;
 insert into public.messages(consultation_id,sender,body,client_message_id,created_at) values(c.id,'customer',p_message,p_client_message_id,statement_timestamp());
 for r in select value from jsonb_array_elements(p_replies) loop
  i:=i+1;
  insert into public.messages(id,consultation_id,sender,body,client_message_id,created_at)
   values((r->>'id')::uuid,c.id,'assistant',r->>'body',case when i=1 then p_client_message_id else (r->>'id')::uuid end,statement_timestamp()+i*interval '1 microsecond');
 end loop;
 insert into public.jev_evaluations(consultation_id,input_revision,purpose,model,question_version,answers,status)
 values(c.id,c.revision,'consultation',p_model,coalesce(p_candidates->>'questionVersion','unavailable'),coalesce(p_candidates,'{}'),case when p_candidates is null then 'failed' else 'succeeded' end);
 update public.consultations set confirmed_preferences=p,candidates=p_candidates,pending_proposal=p_proposal,revision=revision+1,
 status=case when p->>'size'='custom' or p->>'style'='other' then 'needs_review' else 'collecting' end,updated_at=now()
 where id=c.id returning * into c;
 return c;
end $$;
revoke execute on function public.save_chat_turn(uuid,uuid,int,uuid,text,jsonb,jsonb,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.save_chat_turn(uuid,uuid,int,uuid,text,jsonb,jsonb,jsonb,uuid,text) to service_role;
