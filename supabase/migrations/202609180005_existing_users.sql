-- A Supabase project may already contain Auth accounts before this app is installed.
-- Preserve any explicitly granted administrator role; never trust user metadata.
insert into public.profiles(id) select id from auth.users on conflict(id) do nothing;
insert into public.user_roles(user_id,role) select id,'customer' from auth.users on conflict(user_id) do nothing;
