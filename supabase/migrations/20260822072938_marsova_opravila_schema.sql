-- Marsova opravila: chores/rewards/points schema for a single-household,
-- link-only app. No per-row user_id (there's exactly one household) and no
-- Supabase Auth - the user side is protected only by an unadvertised URL,
-- the admin side by a PIN validated entirely inside these functions via
-- mo_admin_sessions tokens, never in frontend code. All point-changing
-- operations are single Postgres functions (atomic by construction) rather
-- than direct table writes from the client.

-- ── content tables ──────────────────────────────────────────────────────

create table public.mo_categories (
  id          uuid primary key default gen_random_uuid(),
  emoji       text not null,
  name        text not null,
  color       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.mo_chores (
  id            uuid primary key default gen_random_uuid(),
  emoji         text not null,
  title         text not null,
  description   text,
  category_id   uuid references public.mo_categories(id) on delete set null,
  points        int not null check (points > 0),
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create table public.mo_rewards (
  id            uuid primary key default gen_random_uuid(),
  emoji         text not null,
  title         text not null,
  description   text,
  cost          int not null check (cost > 0),
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create table public.mo_reward_requests (
  id            uuid primary key default gen_random_uuid(),
  reward_id     uuid references public.mo_rewards(id) on delete set null,
  emoji         text not null,
  title         text not null,
  cost          int not null check (cost > 0),
  status        text not null default 'pending'
                  check (status in ('pending','approved','declined','cancelled','fulfilled')),
  admin_message text,
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  fulfilled_at  timestamptz
);

-- Append-only activity feed for "Dogajanje". Rows are never mutated after
-- insert, so past history always reads back exactly as it happened - later
-- edits to a chore/reward or further lifecycle transitions can't rewrite
-- what an earlier entry shows. Kind-specific reads (e.g. "is this chore
-- completion still undoable") are done by checking for a later row that
-- references this one via ref_id, never by mutating the original.
create table public.mo_activity_log (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in (
                       'chore_completed', 'chore_undone',
                       'reward_requested', 'reward_cancelled', 'reward_approved',
                       'reward_declined', 'reward_fulfilled',
                       'point_adjustment'
                     )),
  emoji              text not null,
  title              text not null,
  delta              int not null default 0,
  ref_id             uuid,
  admin_message      text,
  created_at         timestamptz not null default now()
);

create index mo_activity_log_created_at_idx on public.mo_activity_log (created_at desc);
create index mo_activity_log_ref_id_idx on public.mo_activity_log (ref_id) where ref_id is not null;
create index mo_chores_category_id_idx on public.mo_chores (category_id);
create index mo_reward_requests_status_idx on public.mo_reward_requests (status);

-- ── admin auth (never exposed to the Data API) ──────────────────────────

create table public.mo_admin_pin (
  id        boolean primary key default true check (id),
  pin_hash  text
);
insert into public.mo_admin_pin (id, pin_hash) values (true, null);

create table public.mo_admin_sessions (
  token       uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index mo_admin_sessions_expires_at_idx on public.mo_admin_sessions (expires_at);

create table public.mo_admin_pin_attempts (
  id            boolean primary key default true check (id),
  fail_count    int not null default 0,
  locked_until  timestamptz
);
insert into public.mo_admin_pin_attempts (id) values (true);

-- ── row level security ──────────────────────────────────────────────────
-- Content tables: readable by anyone holding the (unadvertised) app link,
-- consistent with the product's link-only privacy model - nothing in them
-- is a secret. All writes go through the security-definer functions below,
-- never through direct table grants.
alter table public.mo_categories enable row level security;
alter table public.mo_chores enable row level security;
alter table public.mo_rewards enable row level security;
alter table public.mo_reward_requests enable row level security;
alter table public.mo_activity_log enable row level security;

create policy "anyone can read categories" on public.mo_categories for select using (true);
create policy "anyone can read chores" on public.mo_chores for select using (true);
create policy "anyone can read rewards" on public.mo_rewards for select using (true);
create policy "anyone can read reward requests" on public.mo_reward_requests for select using (true);
create policy "anyone can read activity log" on public.mo_activity_log for select using (true);

grant usage on schema public to anon, authenticated;
grant select on public.mo_categories, public.mo_chores, public.mo_rewards,
  public.mo_reward_requests, public.mo_activity_log to anon, authenticated;

-- Admin-auth tables: RLS enabled, no policies, no grants at all - reachable
-- only from inside SECURITY DEFINER functions, never through the Data API.
alter table public.mo_admin_pin enable row level security;
alter table public.mo_admin_sessions enable row level security;
alter table public.mo_admin_pin_attempts enable row level security;

-- ── realtime ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.mo_categories, public.mo_chores, public.mo_rewards,
  public.mo_reward_requests, public.mo_activity_log;

-- ── points math ──────────────────────────────────────────────────────────
-- current  = lifetime earned + adjustments - permanently spent (approved/fulfilled)
-- reserved = cost of pending requests
-- available = current - reserved
-- lifetime = gross chore points from completions that have not been undone
create or replace function public.mo_points_summary()
returns table (current_balance int, reserved int, available int, lifetime int)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(l.total, 0) + coalesce(a.total, 0) - coalesce(sp.total, 0) as current_balance,
    coalesce(p.total, 0) as reserved,
    coalesce(l.total, 0) + coalesce(a.total, 0) - coalesce(sp.total, 0) - coalesce(p.total, 0) as available,
    coalesce(l.total, 0) as lifetime
  from
    (select sum(al.delta) as total from public.mo_activity_log al
      where al.kind = 'chore_completed'
        and not exists (
          select 1 from public.mo_activity_log u
          where u.kind = 'chore_undone' and u.ref_id = al.id
        )
    ) l,
    (select sum(delta) as total from public.mo_activity_log where kind = 'point_adjustment') a,
    (select sum(cost) as total from public.mo_reward_requests where status in ('approved', 'fulfilled')) sp,
    (select sum(cost) as total from public.mo_reward_requests where status = 'pending') p;
$$;

grant execute on function public.mo_points_summary() to anon, authenticated;

-- ── admin auth functions ────────────────────────────────────────────────
create or replace function public.mo_assert_admin(p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or not exists (
    select 1 from public.mo_admin_sessions
    where token = p_token and expires_at > now()
  ) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end;
$$;

-- First-run only: sets the admin PIN if (and only if) none has been set
-- yet, and returns a fresh 30-day session. Once a PIN exists this always
-- fails, so it can never be used to take over an already-configured admin.
create or replace function public.mo_admin_bootstrap_pin(p_pin text)
returns table (token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
  v_expires timestamptz;
begin
  if p_pin is null or length(p_pin) < 4 then
    raise exception 'pin_too_short';
  end if;

  update public.mo_admin_pin
    set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
    where id = true and pin_hash is null;

  if not found then
    raise exception 'already_configured';
  end if;

  v_expires := now() + interval '30 days';
  insert into public.mo_admin_sessions (expires_at) values (v_expires)
    returning mo_admin_sessions.token into v_token;
  return query select v_token, v_expires;
end;
$$;

create or replace function public.mo_admin_pin_status()
returns table (configured boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select (pin_hash is not null) from public.mo_admin_pin where id = true;
$$;

create or replace function public.mo_admin_login(p_pin text)
returns table (token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_locked_until timestamptz;
  v_fail_count int;
  v_token uuid;
  v_expires timestamptz;
begin
  select locked_until, fail_count into v_locked_until, v_fail_count
    from public.mo_admin_pin_attempts where id = true for update;

  if v_locked_until is not null and v_locked_until > now() then
    raise exception 'rate_limited';
  end if;

  select pin_hash into v_hash from public.mo_admin_pin where id = true;
  if v_hash is null then
    raise exception 'not_configured';
  end if;

  if extensions.crypt(p_pin, v_hash) = v_hash then
    update public.mo_admin_pin_attempts set fail_count = 0, locked_until = null where id = true;
    v_expires := now() + interval '30 days';
    insert into public.mo_admin_sessions (expires_at) values (v_expires)
      returning mo_admin_sessions.token into v_token;
    return query select v_token, v_expires;
  else
    v_fail_count := v_fail_count + 1;
    if v_fail_count >= 5 then
      update public.mo_admin_pin_attempts set fail_count = 0, locked_until = now() + interval '5 minutes' where id = true;
    else
      update public.mo_admin_pin_attempts set fail_count = v_fail_count where id = true;
    end if;
    raise exception 'invalid_pin';
  end if;
end;
$$;

create or replace function public.mo_admin_session_valid(p_token uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mo_admin_sessions where token = p_token and expires_at > now()
  );
$$;

create or replace function public.mo_admin_logout(p_token uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.mo_admin_sessions where token = p_token;
$$;

-- ── category admin ──────────────────────────────────────────────────────
create or replace function public.mo_admin_create_category(p_token uuid, p_emoji text, p_name text, p_color text)
returns public.mo_categories
language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_categories;
begin
  perform public.mo_assert_admin(p_token);
  insert into public.mo_categories (emoji, name, color, sort_order)
    values (p_emoji, p_name, nullif(p_color, ''), coalesce((select max(sort_order) + 1 from public.mo_categories), 0))
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.mo_admin_update_category(p_token uuid, p_id uuid, p_emoji text, p_name text, p_color text)
returns public.mo_categories
language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_categories;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_categories set emoji = p_emoji, name = p_name, color = nullif(p_color, '')
    where id = p_id returning * into v_row;
  if not found then raise exception 'not_found'; end if;
  return v_row;
end;
$$;

create or replace function public.mo_admin_reorder_categories(p_token uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare i int;
begin
  perform public.mo_assert_admin(p_token);
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.mo_categories set sort_order = i - 1 where id = p_ids[i];
  end loop;
end;
$$;

create or replace function public.mo_admin_delete_category(p_token uuid, p_id uuid, p_reassign_to uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_in_use boolean;
begin
  perform public.mo_assert_admin(p_token);
  select exists(select 1 from public.mo_chores where category_id = p_id) into v_in_use;
  if v_in_use then
    if p_reassign_to is null then
      raise exception 'category_in_use';
    end if;
    update public.mo_chores set category_id = p_reassign_to where category_id = p_id;
  end if;
  delete from public.mo_categories where id = p_id;
end;
$$;

-- ── chore admin ──────────────────────────────────────────────────────────
create or replace function public.mo_admin_create_chore(p_token uuid, p_emoji text, p_title text, p_description text, p_category_id uuid, p_points int)
returns public.mo_chores language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_chores;
begin
  perform public.mo_assert_admin(p_token);
  if p_points is null or p_points <= 0 then raise exception 'invalid_points'; end if;
  insert into public.mo_chores (emoji, title, description, category_id, points, sort_order)
    values (p_emoji, p_title, nullif(p_description, ''), p_category_id, p_points,
      coalesce((select max(sort_order) + 1 from public.mo_chores), 0))
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.mo_admin_update_chore(p_token uuid, p_id uuid, p_emoji text, p_title text, p_description text, p_category_id uuid, p_points int)
returns public.mo_chores language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_chores;
begin
  perform public.mo_assert_admin(p_token);
  if p_points is null or p_points <= 0 then raise exception 'invalid_points'; end if;
  update public.mo_chores set emoji = p_emoji, title = p_title, description = nullif(p_description, ''),
      category_id = p_category_id, points = p_points
    where id = p_id returning * into v_row;
  if not found then raise exception 'not_found'; end if;
  return v_row;
end;
$$;

create or replace function public.mo_admin_set_chore_active(p_token uuid, p_id uuid, p_active boolean)
returns public.mo_chores language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_chores;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_chores set active = p_active where id = p_id returning * into v_row;
  if not found then raise exception 'not_found'; end if;
  return v_row;
end;
$$;

create or replace function public.mo_admin_reorder_chores(p_token uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare i int;
begin
  perform public.mo_assert_admin(p_token);
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.mo_chores set sort_order = i - 1 where id = p_ids[i];
  end loop;
end;
$$;

-- ── reward admin ─────────────────────────────────────────────────────────
create or replace function public.mo_admin_create_reward(p_token uuid, p_emoji text, p_title text, p_description text, p_cost int)
returns public.mo_rewards language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_rewards;
begin
  perform public.mo_assert_admin(p_token);
  if p_cost is null or p_cost <= 0 then raise exception 'invalid_cost'; end if;
  insert into public.mo_rewards (emoji, title, description, cost, sort_order)
    values (p_emoji, p_title, nullif(p_description, ''), p_cost,
      coalesce((select max(sort_order) + 1 from public.mo_rewards), 0))
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.mo_admin_update_reward(p_token uuid, p_id uuid, p_emoji text, p_title text, p_description text, p_cost int)
returns public.mo_rewards language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_rewards;
begin
  perform public.mo_assert_admin(p_token);
  if p_cost is null or p_cost <= 0 then raise exception 'invalid_cost'; end if;
  update public.mo_rewards set emoji = p_emoji, title = p_title, description = nullif(p_description, ''), cost = p_cost
    where id = p_id returning * into v_row;
  if not found then raise exception 'not_found'; end if;
  return v_row;
end;
$$;

create or replace function public.mo_admin_set_reward_active(p_token uuid, p_id uuid, p_active boolean)
returns public.mo_rewards language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_rewards;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_rewards set active = p_active where id = p_id returning * into v_row;
  if not found then raise exception 'not_found'; end if;
  return v_row;
end;
$$;

create or replace function public.mo_admin_reorder_rewards(p_token uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare i int;
begin
  perform public.mo_assert_admin(p_token);
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.mo_rewards set sort_order = i - 1 where id = p_ids[i];
  end loop;
end;
$$;

-- ── user-side actions (no admin token - link access only) ──────────────
create or replace function public.mo_complete_chore(p_chore_id uuid)
returns public.mo_activity_log language plpgsql security definer set search_path = '' as $$
declare v_chore public.mo_chores; v_row public.mo_activity_log;
begin
  select * into v_chore from public.mo_chores where id = p_chore_id and active = true;
  if not found then raise exception 'chore_not_found'; end if;
  insert into public.mo_activity_log (kind, emoji, title, delta)
    values ('chore_completed', v_chore.emoji, v_chore.title, v_chore.points)
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.mo_undo_chore_completion(p_log_id uuid)
returns public.mo_activity_log language plpgsql security definer set search_path = '' as $$
declare v_entry public.mo_activity_log; v_available int; v_row public.mo_activity_log;
begin
  select * into v_entry from public.mo_activity_log where id = p_log_id and kind = 'chore_completed';
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.mo_activity_log where kind = 'chore_undone' and ref_id = v_entry.id) then
    raise exception 'already_undone';
  end if;
  select available into v_available from public.mo_points_summary();
  if v_available - v_entry.delta < 0 then
    raise exception 'insufficient_available';
  end if;
  insert into public.mo_activity_log (kind, emoji, title, delta, ref_id)
    values ('chore_undone', v_entry.emoji, v_entry.title, -v_entry.delta, v_entry.id)
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.mo_request_reward(p_reward_id uuid)
returns public.mo_reward_requests language plpgsql security definer set search_path = '' as $$
declare v_reward public.mo_rewards; v_available int; v_row public.mo_reward_requests;
begin
  select * into v_reward from public.mo_rewards where id = p_reward_id and active = true;
  if not found then raise exception 'reward_not_found'; end if;
  select available into v_available from public.mo_points_summary();
  if v_available < v_reward.cost then
    raise exception 'insufficient_points';
  end if;
  insert into public.mo_reward_requests (reward_id, emoji, title, cost)
    values (v_reward.id, v_reward.emoji, v_reward.title, v_reward.cost)
    returning * into v_row;
  insert into public.mo_activity_log (kind, emoji, title, delta, ref_id)
    values ('reward_requested', v_row.emoji, v_row.title, -v_row.cost, v_row.id);
  return v_row;
end;
$$;

create or replace function public.mo_cancel_reward_request(p_id uuid)
returns public.mo_reward_requests language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_reward_requests;
begin
  update public.mo_reward_requests set status = 'cancelled', decided_at = now()
    where id = p_id and status = 'pending'
    returning * into v_row;
  if not found then raise exception 'not_pending'; end if;
  insert into public.mo_activity_log (kind, emoji, title, delta, ref_id)
    values ('reward_cancelled', v_row.emoji, v_row.title, 0, v_row.id);
  return v_row;
end;
$$;

-- ── admin reward-request actions ────────────────────────────────────────
create or replace function public.mo_admin_approve_request(p_token uuid, p_id uuid, p_message text)
returns public.mo_reward_requests language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_reward_requests;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_reward_requests set status = 'approved', decided_at = now(), admin_message = nullif(p_message, '')
    where id = p_id and status = 'pending'
    returning * into v_row;
  if not found then raise exception 'not_pending'; end if;
  insert into public.mo_activity_log (kind, emoji, title, delta, ref_id, admin_message)
    values ('reward_approved', v_row.emoji, v_row.title, 0, v_row.id, v_row.admin_message);
  return v_row;
end;
$$;

create or replace function public.mo_admin_decline_request(p_token uuid, p_id uuid, p_message text)
returns public.mo_reward_requests language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_reward_requests;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_reward_requests set status = 'declined', decided_at = now(), admin_message = nullif(p_message, '')
    where id = p_id and status = 'pending'
    returning * into v_row;
  if not found then raise exception 'not_pending'; end if;
  insert into public.mo_activity_log (kind, emoji, title, delta, ref_id, admin_message)
    values ('reward_declined', v_row.emoji, v_row.title, 0, v_row.id, v_row.admin_message);
  return v_row;
end;
$$;

create or replace function public.mo_admin_fulfill_request(p_token uuid, p_id uuid)
returns public.mo_reward_requests language plpgsql security definer set search_path = '' as $$
declare v_row public.mo_reward_requests;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_reward_requests set status = 'fulfilled', fulfilled_at = now()
    where id = p_id and status = 'approved'
    returning * into v_row;
  if not found then raise exception 'not_approved'; end if;
  insert into public.mo_activity_log (kind, emoji, title, delta, ref_id)
    values ('reward_fulfilled', v_row.emoji, v_row.title, 0, v_row.id);
  return v_row;
end;
$$;

create or replace function public.mo_admin_adjust_points(p_token uuid, p_delta int)
returns public.mo_activity_log language plpgsql security definer set search_path = '' as $$
declare v_available int; v_row public.mo_activity_log;
begin
  perform public.mo_assert_admin(p_token);
  if p_delta is null or p_delta = 0 then raise exception 'invalid_delta'; end if;
  select available into v_available from public.mo_points_summary();
  if v_available + p_delta < 0 then raise exception 'would_go_negative'; end if;
  insert into public.mo_activity_log (kind, emoji, title, delta)
    values ('point_adjustment', '✨', 'Prilagoditev točk', p_delta)
    returning * into v_row;
  return v_row;
end;
$$;

-- ── grants ───────────────────────────────────────────────────────────────
grant execute on function
  public.mo_admin_bootstrap_pin(text),
  public.mo_admin_pin_status(),
  public.mo_admin_login(text),
  public.mo_admin_session_valid(uuid),
  public.mo_admin_logout(uuid),
  public.mo_admin_create_category(uuid, text, text, text),
  public.mo_admin_update_category(uuid, uuid, text, text, text),
  public.mo_admin_reorder_categories(uuid, uuid[]),
  public.mo_admin_delete_category(uuid, uuid, uuid),
  public.mo_admin_create_chore(uuid, text, text, text, uuid, int),
  public.mo_admin_update_chore(uuid, uuid, text, text, text, uuid, int),
  public.mo_admin_set_chore_active(uuid, uuid, boolean),
  public.mo_admin_reorder_chores(uuid, uuid[]),
  public.mo_admin_create_reward(uuid, text, text, text, int),
  public.mo_admin_update_reward(uuid, uuid, text, text, text, int),
  public.mo_admin_set_reward_active(uuid, uuid, boolean),
  public.mo_admin_reorder_rewards(uuid, uuid[]),
  public.mo_complete_chore(uuid),
  public.mo_undo_chore_completion(uuid),
  public.mo_request_reward(uuid),
  public.mo_cancel_reward_request(uuid),
  public.mo_admin_approve_request(uuid, uuid, text),
  public.mo_admin_decline_request(uuid, uuid, text),
  public.mo_admin_fulfill_request(uuid, uuid),
  public.mo_admin_adjust_points(uuid, int)
  to anon, authenticated;
