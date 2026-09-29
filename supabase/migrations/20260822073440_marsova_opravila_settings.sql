-- Single-row settings for Marsova opravila: currently just the display name
-- used in the header greeting. Readable by anyone with the link (needed to
-- render the greeting); writable only through the admin-gated RPC below.
create table public.mo_settings (
  id            boolean primary key default true check (id),
  display_name  text not null default 'Klara'
);
insert into public.mo_settings (id, display_name) values (true, 'Klara');

alter table public.mo_settings enable row level security;
create policy "anyone can read settings" on public.mo_settings for select using (true);
grant select on public.mo_settings to anon, authenticated;

create or replace function public.mo_admin_update_settings(p_token uuid, p_display_name text)
returns public.mo_settings
language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_settings;
begin
  perform public.mo_assert_admin(p_token);
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'invalid_name';
  end if;
  update public.mo_settings set display_name = trim(p_display_name) where id = true returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.mo_admin_update_settings(uuid, text) to anon, authenticated;
