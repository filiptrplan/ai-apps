-- Daily snapshots of a user's app_data, so accidental deletes/overwrites can
-- be undone from the main page. One row per (user, calendar day); the `data`
-- column holds the full set of app_data rows for that user at backup time.
create table public.app_data_backups (
  user_id     uuid not null references auth.users(id) on delete cascade,
  backup_date date not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, backup_date)
);

alter table public.app_data_backups enable row level security;

create policy "individuals manage their own app_data_backups"
  on public.app_data_backups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
