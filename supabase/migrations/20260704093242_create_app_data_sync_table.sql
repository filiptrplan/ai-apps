-- Generic cross-app sync store: one row per (user, app, key), value is an
-- opaque JSON blob. New apps reuse this table by picking their own app_id/key
-- instead of getting a dedicated table.
create table public.app_data (
  user_id     uuid not null references auth.users(id) on delete cascade,
  app_id      text not null,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, app_id, key)
);

alter table public.app_data enable row level security;

create policy "individuals manage their own app_data"
  on public.app_data for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create function public.set_app_data_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_data_set_updated_at
  before update on public.app_data
  for each row execute function public.set_app_data_updated_at();
