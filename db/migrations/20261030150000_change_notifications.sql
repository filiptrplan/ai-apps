-- migrate:up

-- Live updates (replacing Supabase Realtime): every change to app_data and
-- the Marsova tables sends a notification on the "changes" channel, and
-- server/events.js passes it on to the open pages over Server-Sent Events.
-- Notifications go out when the transaction commits.

-- {table, user_id, app_id, key, updated_at} for each written row. The value
-- isn't included (a notification holds at most 8000 bytes); pages read it
-- with GET /api/data. updated_at has the same format as the data API's
-- (see server/appData.js), whatever the writer's time zone, so pages can
-- recognise the echo of their own write.
create function public.notify_app_data_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_notify('changes', json_build_object(
    'table', 'app_data',
    'user_id', new.user_id,
    'app_id', new.app_id,
    'key', new.key,
    'updated_at', (to_json(new.updated_at at time zone 'UTC') #>> '{}') || '+00:00'
  )::text);
  return null;
end;
$$;

create trigger app_data_notify_change
  after insert or update on public.app_data
  for each row execute function public.notify_app_data_change();

-- {table} once per statement: the Marsova app refetches the whole table,
-- so which rows changed doesn't matter.
create function public.notify_mo_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_notify('changes', json_build_object('table', tg_table_name)::text);
  return null;
end;
$$;

create trigger mo_categories_notify_change
  after insert or update or delete on public.mo_categories
  for each statement execute function public.notify_mo_change();
create trigger mo_chores_notify_change
  after insert or update or delete on public.mo_chores
  for each statement execute function public.notify_mo_change();
create trigger mo_rewards_notify_change
  after insert or update or delete on public.mo_rewards
  for each statement execute function public.notify_mo_change();
create trigger mo_reward_requests_notify_change
  after insert or update or delete on public.mo_reward_requests
  for each statement execute function public.notify_mo_change();
create trigger mo_activity_log_notify_change
  after insert or update or delete on public.mo_activity_log
  for each statement execute function public.notify_mo_change();
create trigger mo_settings_notify_change
  after insert or update or delete on public.mo_settings
  for each statement execute function public.notify_mo_change();

-- migrate:down

drop trigger mo_settings_notify_change on public.mo_settings;
drop trigger mo_activity_log_notify_change on public.mo_activity_log;
drop trigger mo_reward_requests_notify_change on public.mo_reward_requests;
drop trigger mo_rewards_notify_change on public.mo_rewards;
drop trigger mo_chores_notify_change on public.mo_chores;
drop trigger mo_categories_notify_change on public.mo_categories;
drop function public.notify_mo_change();
drop trigger app_data_notify_change on public.app_data;
drop function public.notify_app_data_change();
