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

-- migrate:down

drop table public.push_subscriptions;
