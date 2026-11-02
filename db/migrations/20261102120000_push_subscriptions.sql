-- migrate:up

-- Web Push subscriptions (see server/push.js): one row per app per browser.
-- Each app's service worker has its own scope, so the same phone has a
-- separate subscription for every app it turned notifications on in.
-- `endpoint` is the push service's URL for that subscription; p256dh and
-- auth are the keys its messages are encrypted with. Rows whose endpoint the
-- push service reports as gone are deleted when a send finds out.
create table public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  app_id      text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_app_idx on public.push_subscriptions (user_id, app_id);

-- Pushes an app asked to send later (e.g. "Rest over" when a rest ends),
-- one per (user, app, id); setting the same id again replaces it. The
-- server's scheduler deletes each row as it sends it. `ttl` (seconds) is how
-- late it may still go out, e.g. after a restart.
create table public.push_scheduled (
  user_id     uuid not null references public.users(id) on delete cascade,
  app_id      text not null,
  id          text not null,
  send_at     timestamptz not null,
  payload     jsonb not null,
  ttl         integer not null,
  urgency     text not null,
  primary key (user_id, app_id, id)
);
create index push_scheduled_send_at_idx on public.push_scheduled (send_at);

-- Which daily reminders went out (server/reminders.js), so each is sent at
-- most once per local day, across restarts. Kept for a week.
create table public.push_reminders_sent (
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null,
  day         date not null,
  primary key (user_id, kind, day)
);

-- migrate:down

drop table public.push_reminders_sent;
drop table public.push_scheduled;
drop table public.push_subscriptions;
