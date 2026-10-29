-- Follow-ups from Supabase's security and performance advisors.

-- Visitors who aren't signed in never need the ownership check (signed-in users do: the read rules use it).
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- Indexes for foreign keys that are looked up or cascaded.
create index if not exists approvals_task on public.approvals (task_id);
create index if not exists schedules_project on public.schedules (project_id);
create index if not exists tasks_cloud on public.tasks (cloud_id);
