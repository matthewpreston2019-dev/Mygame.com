-- =============================================================================
-- Quest history: when a quest was added and when it was switched off, so past
-- days are judged by the quests you had on that day (see questLiveOn in
-- web/js/shared/stats.js). Both columns are optional for the app.
-- =============================================================================

-- Two steps on purpose: adding the column with a default in one statement
-- would stamp every existing quest with "now", and those quests would stop
-- counting on all past days. Existing quests stay null = "always existed".
alter table public.quests add column if not exists created_at timestamptz;
alter table public.quests alter column created_at set default now();

-- The day (Europe/Berlin date) a quest was switched off; null while it's on.
alter table public.quests add column if not exists inactive_since date;
