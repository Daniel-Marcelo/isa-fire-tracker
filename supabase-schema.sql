-- Run this in the Supabase SQL editor (supabase.com → your project → SQL Editor)

create table if not exists public.user_data (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  data     jsonb        not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Only the owner can read/write their own row
alter table public.user_data enable row level security;

create policy "Users can read own data"
  on public.user_data for select
  using (auth.uid() = user_id);

create policy "Users can upsert own data"
  on public.user_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on public.user_data for update
  using (auth.uid() = user_id);
