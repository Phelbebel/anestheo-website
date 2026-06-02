-- ============================================================
-- ANESTHEO V2 — profiles table for /v2 app
-- Run in Supabase SQL Editor
-- ============================================================

create table if not exists profiles (
  id                     uuid references auth.users(id) on delete cascade primary key,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  email                  text,
  full_name              text,
  role                   text default 'pending',   -- pending | doctor | patient | admin
  specialty              text,
  hospital               text,
  phone                  text,
  country                text,
  verification_status    text default 'not_required',
  is_admin               boolean default false
);

-- RLS: users can read/write their own row; service role bypasses
alter table profiles enable row level security;

drop policy if exists "profiles_select_own" on profiles;
drop policy if exists "profiles_insert_own" on profiles;
drop policy if exists "profiles_update_own" on profiles;

create policy "profiles_select_own" on profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

-- Auto-create profile row when a new auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role, verification_status)
  values (new.id, new.email, 'pending', 'not_required')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Set admin
update profiles set role = 'admin', is_admin = true
where email = 'drgiga@anestheo.com';

select id, email, role, full_name from profiles order by created_at desc limit 20;
