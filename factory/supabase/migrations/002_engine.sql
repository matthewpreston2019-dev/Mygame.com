-- ─────────────────────────────────────────────────────────
-- The engine room: small SQL functions the Edge Function and the
-- scheduler call. Only the server (service role) may run them.
-- ─────────────────────────────────────────────────────────

-- When should a schedule run next? Calculated in the owner's time zone.
create or replace function public.compute_next_run(p_every text, p_at text, p_weekday int, p_tz text, p_from timestamptz default now())
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  local_from timestamp := p_from at time zone p_tz;
  candidate timestamp;
begin
  if p_every = 'hourly' then
    return p_from + interval '1 hour';
  end if;
  candidate := date_trunc('day', local_from) + p_at::time;
  if candidate <= local_from then
    candidate := candidate + interval '1 day';
  end if;
  if p_every = 'weekly' then
    while extract(dow from candidate) <> p_weekday loop
      candidate := candidate + interval '1 day';
    end loop;
  end if;
  return candidate at time zone p_tz;
end $$;

-- Keep next_run correct whenever a schedule is created or edited.
create or replace function public.schedules_set_next_run() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.every is distinct from old.every or new.at is distinct from old.at
     or new.weekday is distinct from old.weekday or (new.enabled and not old.enabled) then
    new.next_run := public.compute_next_run(new.every, new.at, new.weekday, (select timezone from public.settings where id = 1));
  end if;
  return new;
end $$;
create trigger schedules_next_run before insert or update on public.schedules
  for each row execute function public.schedules_set_next_run();

-- Pick the tasks that may start now, without exceeding the parallel limit.
-- Independent tasks start together; a task with dependencies waits until they are done.
-- An advisory lock makes concurrent callers take turns, so the limit is never overshot.
create or replace function public.claim_tasks() returns setof public.tasks
language plpgsql set search_path = public as $$
declare slots int;
begin
  perform pg_advisory_xact_lock(4242);

  update tasks t set status = 'failed', stage = 'Failed', error = 'A task it depends on did not finish.', finished_at = now()
  where t.status in ('queued', 'waiting')
    and exists (select 1 from tasks d where d.id = any(t.depends_on) and d.status in ('failed', 'cancelled'));

  update tasks t set status = 'waiting',
    stage = 'Waiting for ' || (select string_agg(d.title, ', ') from tasks d where d.id = any(t.depends_on) and d.status <> 'done')
  where t.status = 'queued'
    and exists (select 1 from tasks d where d.id = any(t.depends_on) and d.status <> 'done');

  update tasks t set status = 'queued', stage = 'Queued'
  where t.status = 'waiting'
    and not exists (select 1 from tasks d where d.id = any(t.depends_on) and d.status <> 'done');

  select s.max_parallel - (select count(*) from tasks where status = 'running') into slots from settings s where id = 1;
  if slots <= 0 then
    return;
  end if;

  return query
  update tasks set status = 'running', stage = 'Starting', progress = 5, attempts = attempts + 1,
    started_at = now(), heartbeat_at = now(), error = null, not_before = null
  where id in (
    select id from tasks
    where status = 'queued' and (not_before is null or not_before <= now())
    order by created_at
    limit slots
    for update skip locked
  )
  returning *;
end $$;

-- Count free Gemini requests per day. Returns false when today's allowance is used up.
create or replace function public.use_requests(n int default 1) returns boolean
language plpgsql set search_path = public as $$
declare ok boolean;
begin
  update settings
  set requests_today = (case when requests_day = current_date then requests_today else 0 end) + n,
      requests_day = current_date
  where id = 1
    and (case when requests_day = current_date then requests_today else 0 end) + n <= daily_request_limit
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- Schedules that are due: mark them as run and move them to their next time.
create or replace function public.take_due_schedules() returns setof public.schedules
language plpgsql set search_path = public as $$
begin
  return query
  update schedules
  set last_run = now(),
      next_run = public.compute_next_run(every, at, weekday, (select timezone from settings where id = 1))
  where enabled and next_run <= now()
  returning *;
end $$;

-- Runs every 5 minutes (pg_cron). Cheap SQL housekeeping; it only wakes the
-- Edge Function when there is actually work to start.
create or replace function public.factory_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  has_work boolean;
  fn_url text;
  fn_key text;
begin
  update settings set last_tick_at = now() where id = 1;

  -- A new day: work paused by the daily AI allowance continues.
  update tasks set status = 'queued', stage = 'Queued', error = null
  where status = 'blocked' and (select requests_day from settings where id = 1) < current_date;

  -- A worker that stopped mid-task (e.g. hit the time limit) is retried, at most 3 attempts.
  update tasks
  set status = case when attempts >= 3 then 'failed' else 'queued' end,
      stage = case when attempts >= 3 then 'Failed' else 'Retrying after an interrupted run' end,
      error = case when attempts >= 3 then 'The worker stopped unexpectedly three times.' else error end,
      finished_at = case when attempts >= 3 then now() else null end
  where status = 'running' and heartbeat_at < now() - interval '4 minutes';

  select exists (select 1 from schedules where enabled and next_run <= now())
      or exists (
        select 1 from tasks t
        where t.status in ('queued', 'waiting') and (t.not_before is null or t.not_before <= now())
          and not exists (select 1 from tasks d where d.id = any(t.depends_on) and d.status not in ('done', 'failed', 'cancelled'))
      )
    into has_work;

  if has_work then
    select value into fn_url from app_secrets where key = 'functions_url';
    select value into fn_key from app_secrets where key = 'internal_key';
    perform net.http_post(
      url := fn_url || '/tick',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-factory-key', fn_key),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  end if;
end $$;

-- One-time setup code that lets the owner choose a password (also used to reset it).
create or replace function public.issue_setup_code() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare code text := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
begin
  insert into app_secrets (key, value) values ('setup_code', encode(digest(code, 'sha256'), 'hex') || '|' || (now() + interval '7 days')::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return code;
end $$;

-- Only the server may call these.
revoke execute on function public.claim_tasks(), public.use_requests(int), public.take_due_schedules(),
  public.factory_tick(), public.issue_setup_code() from public, anon, authenticated;
grant execute on function public.claim_tasks(), public.use_requests(int), public.take_due_schedules(),
  public.issue_setup_code() to service_role;

select cron.schedule('factory-tick', '*/5 * * * *', 'select public.factory_tick()');
