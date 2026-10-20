-- =============================================================================
-- Daily Companion 2.0 — database schema
-- -----------------------------------------------------------------------------
-- Every user-owned table follows the same pattern so the app's offline sync
-- engine (web/js/lib/store.js) can treat them all the same way:
--   * user_id     – owner, defaults to the signed-in user
--   * updated_at  – set by the server on every write (used for "give me what
--                   changed since my last sync")
--   * deleted     – soft delete flag, so deletions also sync between devices
-- Row Level Security (RLS) makes sure a user can only ever see their own rows.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Sets updated_at to the server time on every insert/update.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Profile: one row per user. All preferences live in the `settings` JSON so new
-- settings can be added without migrations (the app merges in defaults).
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  -- Secret used by the iOS Shortcut to send steps without signing in.
  steps_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

-- -----------------------------------------------------------------------------
-- Quests. Built-in quests have a `key` (the app shows a translated title);
-- custom quests use `title`. `kind` decides how a quest completes:
--   manual  – you tick it
--   study   – auto when today's study minutes reach the day's goal
--   steps   – auto when steps reach the daily goal
--   workout – auto when a workout is logged today
--   protein – auto when protein reaches the daily target
-- `days` uses JavaScript weekday numbers: 0 = Sunday … 6 = Saturday.
-- -----------------------------------------------------------------------------
create table public.quests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key        text,
  title      text check (title is null or char_length(title) <= 80),
  emoji      text not null default '⭐',
  xp         int  not null default 10 check (xp between 0 and 500),
  kind       text not null default 'manual' check (kind in ('manual','study','steps','workout','protein')),
  days       smallint[] not null default '{0,1,2,3,4,5,6}',
  sort       int  not null default 0,
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

-- One row per quest per day it was completed. Un-ticking sets deleted = true.
create table public.quest_log (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  quest_id   uuid not null,
  date       date not null,
  xp         int  not null default 0,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, quest_id, date)
);

-- -----------------------------------------------------------------------------
-- Steps: one number per day (manual entry or the iOS Shortcut).
-- -----------------------------------------------------------------------------
create table public.steps (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  steps      int  not null check (steps between 0 and 200000),
  source     text not null default 'manual' check (source in ('manual','shortcut')),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, date)
);

-- -----------------------------------------------------------------------------
-- Food log + favorites
-- -----------------------------------------------------------------------------
create table public.foods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  eaten_at   timestamptz not null default now(),
  name       text not null check (char_length(name) between 1 and 80),
  kcal       int  not null check (kcal between 0 and 10000),
  protein    numeric(6,1) not null default 0 check (protein between 0 and 1000),
  meal       text not null default 'snack' check (meal in ('breakfast','lunch','dinner','snack')),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table public.food_favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  kcal       int  not null check (kcal between 0 and 10000),
  protein    numeric(6,1) not null default 0 check (protein between 0 and 1000),
  use_count  int  not null default 0,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

-- Body weight log (goal weight lives in settings.targets.goalWeight).
create table public.weights (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  kg         numeric(5,2) not null check (kg between 20 and 400),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, date)
);

-- -----------------------------------------------------------------------------
-- Workouts. Templates hold an ordered exercise list as JSON:
--   [{ "id": "bench", "sets": 3, "reps": "6-8" }, { "id": "c:cable-fly", "name": "Cable fly", ... }]
-- Built-in exercise ids are translated by the app; custom ones carry a name.
-- workout_sets intentionally has no foreign key to workouts so offline-queued
-- writes can never fail because of ordering.
-- -----------------------------------------------------------------------------
create table public.workout_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key        text,                       -- 'upper' / 'lower' for the built-ins
  name       text check (name is null or char_length(name) <= 40),
  exercises  jsonb not null default '[]'::jsonb,
  sort       int  not null default 0,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table public.workouts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  template_id uuid,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  notes       text check (notes is null or char_length(notes) <= 500),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create table public.workout_sets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_id uuid not null,
  exercise   text not null,
  set_index  int  not null check (set_index between 0 and 50),
  reps       int  check (reps between 0 and 1000),
  weight     numeric(6,2) check (weight between 0 and 1000),
  done       boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

-- -----------------------------------------------------------------------------
-- Study sessions (timer, manual entry, or answered in the 21:00 check-in)
-- -----------------------------------------------------------------------------
create table public.study_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  started_at timestamptz,
  minutes    int not null check (minutes between 1 and 960),
  subject    text check (subject is null or char_length(subject) <= 60),
  source     text not null default 'manual' check (source in ('timer','manual','checkin')),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

-- -----------------------------------------------------------------------------
-- Calendar events
-- -----------------------------------------------------------------------------
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  kind       text not null default 'custom' check (kind in ('school','study','gym','exam','custom')),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  notes      text check (notes is null or char_length(notes) <= 500),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  check (ends_at > starts_at)
);

-- -----------------------------------------------------------------------------
-- Day planner overrides ("tomorrow planner"). Absent row = normal day.
--   day_type  – null (use weekday), 'short', 'long', 'weekend' (free day), 'rest'
--   free_from – 'HH:MM' override of when school ends
--   exam      – { "subject": "Math", "time": "09:00" }
-- -----------------------------------------------------------------------------
create table public.day_plans (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  day_type   text check (day_type in ('short','long','weekend','rest')),
  free_from  text check (free_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  exam       jsonb,
  skip_gym   boolean not null default false,
  skip_study boolean not null default false,
  note       text check (note is null or char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, date)
);

-- Sleep log. `date` is the morning you woke up.
create table public.sleep_logs (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  slept_at   timestamptz not null,
  woke_at    timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, date),
  check (woke_at > slept_at and woke_at - slept_at < interval '20 hours')
);

-- 21:00 check-in answers
create table public.checkins (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  studied    boolean,
  trained    boolean,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, date)
);

-- -----------------------------------------------------------------------------
-- Coach feed. The scheduler (coach-tick Edge Function) writes coach messages;
-- the app writes your replies. (user_id, date, key) is unique so a scheduled
-- message can never be sent twice, even if the scheduler runs twice.
--   kind: 'coach' | 'me'
--   data: extra info, e.g. { "type": "checkin", "studied": true }
-- -----------------------------------------------------------------------------
create table public.coach_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  key        text not null,
  kind       text not null default 'coach' check (kind in ('coach','me')),
  body       text not null check (char_length(body) <= 4000),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  unique (user_id, date, key)
);

-- Web Push subscriptions (one per installed device)
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  failures   int  not null default 0,
  last_ok_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

-- -----------------------------------------------------------------------------
-- Server-only key/value store (VAPID keys, scheduler secret, function URL).
-- RLS is on with NO policies, so only the service role (Edge Functions and
-- pg_cron) can read it. The app can never see these values.
-- -----------------------------------------------------------------------------
create table public.app_secrets (
  key   text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Apply the shared pattern (RLS policy, updated_at trigger, sync index) to
-- every user-owned table.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','quests','quest_log','steps','foods','food_favorites','weights',
    'workout_templates','workouts','workout_sets','study_sessions','events',
    'day_plans','sleep_logs','checkins','coach_messages','push_subscriptions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner_all" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format(
      'create trigger touch before insert or update on public.%I
         for each row execute function public.touch_updated_at()', t);
    execute format('create index %I on public.%I (user_id, updated_at)', t || '_sync_idx', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Extra indexes for common date lookups
create index foods_user_date_idx          on public.foods (user_id, date);
create index workouts_user_date_idx       on public.workouts (user_id, date);
create index workout_sets_workout_idx     on public.workout_sets (workout_id);
create index study_user_date_idx          on public.study_sessions (user_id, date);
create index events_user_start_idx        on public.events (user_id, starts_at);
create index coach_user_created_idx       on public.coach_messages (user_id, created_at);
create index push_user_idx                on public.push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- Single-owner lock: once one account exists, new sign-ups are refused unless
-- app_secrets has allow_signups = 'true'. This keeps strangers out of your app.
-- -----------------------------------------------------------------------------
create or replace function public.guard_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users)
     and coalesce((select value from public.app_secrets where key = 'allow_signups'), 'false') <> 'true' then
    raise exception 'signups_closed';
  end if;
  return new;
end $$;

create trigger guard_signup before insert on auth.users
  for each row execute function public.guard_signup();

-- -----------------------------------------------------------------------------
-- New user setup: profile + starter quests + Upper/Lower templates.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id);

  insert into public.quests (user_id, key, emoji, xp, kind, days, sort) values
    (new.id, 'pushups', '💪', 10, 'manual',  '{0,1,2,3,4,5,6}', 1),
    (new.id, 'study',   '📚', 30, 'study',   '{0,1,2,3,4,5,6}', 2),
    (new.id, 'steps',   '👟', 20, 'steps',   '{0,1,2,3,4,5,6}', 3),
    (new.id, 'gym',     '🏋️', 40, 'workout', '{1,3,5}',         4),
    (new.id, 'protein', '🥩', 15, 'protein', '{0,1,2,3,4,5,6}', 5);

  insert into public.workout_templates (user_id, key, exercises, sort) values
    (new.id, 'upper', '[
      {"id":"bench","sets":3,"reps":"6-8"},
      {"id":"row","sets":3,"reps":"8-10"},
      {"id":"ohp","sets":3,"reps":"8-10"},
      {"id":"pulldown","sets":3,"reps":"10-12"},
      {"id":"curl","sets":2,"reps":"10-12"},
      {"id":"pushdown","sets":2,"reps":"10-12"}
    ]'::jsonb, 1),
    (new.id, 'lower', '[
      {"id":"squat","sets":3,"reps":"6-8"},
      {"id":"rdl","sets":3,"reps":"8-10"},
      {"id":"legpress","sets":3,"reps":"10-12"},
      {"id":"legcurl","sets":3,"reps":"10-12"},
      {"id":"calf","sets":3,"reps":"12-15"},
      {"id":"legraise","sets":3,"reps":"10-12"}
    ]'::jsonb, 2);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- New random token for the steps Shortcut (Settings → Steps → "New link").
create or replace function public.regenerate_steps_token()
returns text language sql security invoker set search_path = '' as $$
  update public.profiles
     set steps_token = encode(extensions.gen_random_bytes(16), 'hex')
   where user_id = (select auth.uid())
  returning steps_token;
$$;
revoke execute on function public.regenerate_steps_token() from public, anon;
grant execute on function public.regenerate_steps_token() to authenticated;
