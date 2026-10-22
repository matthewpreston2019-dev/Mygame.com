-- =============================================================================
-- Frozen days: which quests counted on each finished day. The app writes one
-- row per day (for the last week, once it's over), so changing gym days,
-- quest days, targets or the quest list later doesn't rewrite past streaks.
-- "Done" still comes from quest_log, so a late log still counts.
-- Apply this BEFORE the app version that syncs day_scores goes live.
-- =============================================================================

create table if not exists public.day_scores (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  quest_ids  uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, date)
);

-- Same pattern as every other user table (see 0001_schema.sql).
alter table public.day_scores enable row level security;
create policy "owner_all" on public.day_scores for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create trigger touch before insert or update on public.day_scores
  for each row execute function public.touch_updated_at();
create index day_scores_sync_idx on public.day_scores (user_id, updated_at);
revoke all on public.day_scores from anon;
