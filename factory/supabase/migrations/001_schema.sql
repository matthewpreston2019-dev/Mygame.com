-- ─────────────────────────────────────────────────────────
-- AI Worker Factory — database schema
--
-- The browser READS these tables directly (only the owner, via RLS) and gets
-- live changes through Realtime. All WRITES go through the `factory` Edge
-- Function, which validates them and uses the service role.
-- ─────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── Settings: exactly one row ───────────────────────────
create table public.settings (
  id int primary key default 1 check (id = 1),
  owner_email text not null,
  app_url text,
  timezone text not null default 'Europe/London',
  max_parallel int not null default 2 check (max_parallel between 1 and 6),
  daily_request_limit int not null default 40 check (daily_request_limit between 1 and 2000),
  requests_day date not null default current_date,
  requests_today int not null default 0,
  verify_results boolean not null default true,
  email_briefings boolean not null default true,
  demo boolean not null default false,
  ai_ready boolean not null default false,          -- a Gemini key is saved
  models jsonb not null default '{}',               -- Gemini models chosen automatically
  google jsonb not null default '{"connected": false}',
  obsidian jsonb not null default '{"connected": false}',
  last_tick_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Server-only secrets (API keys, tokens). RLS on and no policies: the browser can never read it.
create table public.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ── The world ───────────────────────────────────────────
create table public.clouds (
  id text primary key,
  name text not null,
  color text not null,
  blurb text not null,
  workers text[] not null,
  position float8[] not null,
  sort int not null
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  cloud_id text not null references public.clouds on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index projects_unique_name on public.projects (cloud_id, lower(name));

-- ── Work ────────────────────────────────────────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid,
  schedule_id uuid,
  cloud_id text not null references public.clouds,
  project_id uuid references public.projects on delete cascade,
  worker text not null,
  title text not null,
  instruction text not null,
  tier text not null default 'standard',
  skill_hint text not null default '',
  depends_on uuid[] not null default '{}',
  status text not null default 'queued'
    check (status in ('queued', 'waiting', 'running', 'blocked', 'done', 'failed', 'cancelled')),
  progress int not null default 0,
  stage text not null default 'Queued',
  attempts int not null default 0,
  not_before timestamptz,
  error text,
  result text,                                      -- the finished work (Markdown), stored once
  summary text not null default '',
  verified boolean,
  issues text[] not null default '{}',
  reused_from uuid,                                 -- points at an identical earlier result instead of copying it
  skill_ids text[] not null default '{}',
  sources jsonb not null default '[]',
  model text,
  requests int not null default 0,
  note_path text,                                   -- where it was saved in the Obsidian vault
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz
);
create index tasks_status on public.tasks (status);
create index tasks_project on public.tasks (project_id);
create index tasks_created on public.tasks (created_at desc);

create table public.chat (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'manager')),
  text text not null,
  task_ids uuid[] not null default '{}',
  schedule_ids uuid[] not null default '{}',
  error boolean not null default false,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks on delete set null,
  cloud_id text,
  kind text not null check (kind in ('message', 'publish', 'spend', 'delete', 'other')),
  summary text not null,
  details text not null default '',
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'task' check (kind in ('task', 'briefing')),
  name text not null,
  cloud_id text not null references public.clouds,
  project_id uuid references public.projects on delete set null,
  worker text not null,
  instruction text not null,
  every text not null check (every in ('daily', 'weekly', 'hourly')),
  at text not null default '08:00' check (at ~ '^\d{1,2}:\d{2}$'),
  weekday int not null default 1 check (weekday between 0 and 6),
  enabled boolean not null default true,
  last_run timestamptz,
  next_run timestamptz,
  created_at timestamptz not null default now()
);

create table public.skills (
  id text primary key,
  name text not null,
  description text not null,
  tags text[] not null default '{}',
  workers text[] not null default '{}',
  source text not null check (source in ('builtin', 'learned', 'imported')),
  origin text,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  level text not null,
  event text not null,
  data jsonb not null default '{}'
);
create index logs_at on public.logs (at desc);

-- ── Security: only the owner can read; nobody but the server can write ──
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() ->> 'email') = (select owner_email from public.settings where id = 1), false)
$$;

do $$
declare t text;
begin
  foreach t in array array['settings', 'app_secrets', 'clouds', 'projects', 'tasks', 'chat', 'approvals', 'schedules', 'skills', 'logs'] loop
    execute format('alter table public.%I enable row level security', t);
    if t <> 'app_secrets' then
      execute format('create policy owner_reads on public.%I for select to authenticated using (public.is_owner())', t);
    end if;
  end loop;
end $$;

revoke all on public.app_secrets from anon, authenticated;

-- Live updates for the interface
alter publication supabase_realtime add table
  public.settings, public.projects, public.tasks, public.chat, public.approvals, public.schedules, public.skills;
