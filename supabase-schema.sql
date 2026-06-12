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

-- Shared fund holdings table (admin writes, everyone reads)
create table if not exists public.fund_holdings (
  fund_ticker  text        primary key,
  fund_name    text,
  as_at        text,
  uploaded_at  timestamptz not null default now(),
  holdings     jsonb       not null default '[]'::jsonb
);

alter table public.fund_holdings enable row level security;

-- All authenticated users can read
create policy "Authenticated users can read fund holdings"
  on public.fund_holdings for select
  to authenticated
  using (true);

-- Only the admin email can write (set VITE_ADMIN_EMAIL in your env)
create policy "Admin can insert fund holdings"
  on public.fund_holdings for insert
  to authenticated
  with check ((select email from auth.users where id = auth.uid()) = current_setting('app.admin_email', true));

create policy "Admin can update fund holdings"
  on public.fund_holdings for update
  to authenticated
  using ((select email from auth.users where id = auth.uid()) = current_setting('app.admin_email', true));

create policy "Admin can delete fund holdings"
  on public.fund_holdings for delete
  to authenticated
  using ((select email from auth.users where id = auth.uid()) = current_setting('app.admin_email', true));
