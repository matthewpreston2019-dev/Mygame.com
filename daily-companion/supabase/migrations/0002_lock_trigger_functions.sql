-- Trigger functions are only ever run by triggers; make sure nobody can call
-- them through the API (keeps the Supabase security advisor clean).
revoke execute on function public.guard_signup() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
