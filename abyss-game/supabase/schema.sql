-- ABYSS optional online backend (Supabase / Postgres).
-- Run this once in the Supabase SQL editor, then enable
-- Authentication → Providers → "Anonymous sign-ins".

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  player_name text not null check (char_length(player_name) between 1 and 20),
  mode        text not null check (mode in ('standard', 'daily', 'endless')),
  score       integer not null check (score >= 0),
  correct     integer not null check (correct >= 0),
  total       integer not null check (total > 0 and correct <= total),
  daily_key   text check (daily_key ~ '^\d{4}-\d{2}-\d{2}$'),
  created_at  timestamptz not null default now(),
  -- Sanity bound: 100 points max per question.
  constraint score_bound check (score <= total * 100),
  constraint standard_len check (mode = 'endless' or total = 7)
);

create index if not exists scores_mode_score_idx on public.scores (mode, score desc);
create index if not exists scores_daily_idx on public.scores (daily_key, score desc) where mode = 'daily';
-- One daily submission per user per day.
create unique index if not exists scores_one_daily_per_user on public.scores (user_id, daily_key) where mode = 'daily';

alter table public.scores enable row level security;

create policy "scores are public" on public.scores
  for select using (true);

create policy "users insert their own scores" on public.scores
  for insert to authenticated with check (auth.uid() = user_id);

-- Cloud save: one JSON blob per (anonymous) user.
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "users read own profile" on public.profiles
  for select to authenticated using (auth.uid() = user_id);
create policy "users insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);
create policy "users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
