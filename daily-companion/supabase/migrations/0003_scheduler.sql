-- =============================================================================
-- The coach's clock: pg_cron calls the coach-tick Edge Function every minute.
-- The function decides (per user, in their time zone) which messages are due.
--
-- PROJECT-SPECIFIC: the functions URL below contains this project's ref
-- (igyygavrabnrmrkxtyni). If you ever move to a new Supabase project, change it.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- A random secret that only the database and the Edge Function know.
insert into public.app_secrets (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

insert into public.app_secrets (key, value)
values ('functions_url', 'https://igyygavrabnrmrkxtyni.supabase.co/functions/v1')
on conflict (key) do update set value = excluded.value;

-- Every minute (scheduling by name replaces an existing job of the same name).
select cron.schedule(
  'coach-tick',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select value from public.app_secrets where key = 'functions_url') || '/coach-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);

-- Keep the free-tier database small: forget scheduler run history after 3 days.
select cron.schedule(
  'cleanup-cron-history',
  '17 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '3 days'; $job$
);
