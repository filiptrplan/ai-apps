\restrict dbmate

-- Dumped from database version 17.11
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: mo_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    emoji text NOT NULL,
    title text NOT NULL,
    delta integer DEFAULT 0 NOT NULL,
    ref_id uuid,
    admin_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mo_activity_log_kind_check CHECK ((kind = ANY (ARRAY['chore_completed'::text, 'chore_undone'::text, 'reward_requested'::text, 'reward_cancelled'::text, 'reward_approved'::text, 'reward_declined'::text, 'reward_fulfilled'::text, 'point_adjustment'::text])))
);


--
-- Name: mo_admin_adjust_points(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_adjust_points(p_token uuid, p_delta integer) RETURNS public.mo_activity_log
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_reward_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_reward_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reward_id uuid,
    emoji text NOT NULL,
    title text NOT NULL,
    cost integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_message text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    fulfilled_at timestamp with time zone,
    CONSTRAINT mo_reward_requests_cost_check CHECK ((cost > 0)),
    CONSTRAINT mo_reward_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'cancelled'::text, 'fulfilled'::text])))
);


--
-- Name: mo_admin_approve_request(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_approve_request(p_token uuid, p_id uuid, p_message text) RETURNS public.mo_reward_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_admin_bootstrap_pin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_bootstrap_pin(p_pin text) RETURNS TABLE(token uuid, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    emoji text NOT NULL,
    name text NOT NULL,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mo_admin_create_category(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_create_category(p_token uuid, p_emoji text, p_name text, p_color text) RETURNS public.mo_categories
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_row public.mo_categories;
begin
  perform public.mo_assert_admin(p_token);
  insert into public.mo_categories (emoji, name, color, sort_order)
    values (p_emoji, p_name, nullif(p_color, ''), coalesce((select max(sort_order) + 1 from public.mo_categories), 0))
    returning * into v_row;
  return v_row;
end;
$$;


--
-- Name: mo_chores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_chores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    emoji text NOT NULL,
    title text NOT NULL,
    description text,
    category_id uuid,
    points integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mo_chores_points_check CHECK ((points > 0))
);


--
-- Name: mo_admin_create_chore(uuid, text, text, text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_create_chore(p_token uuid, p_emoji text, p_title text, p_description text, p_category_id uuid, p_points integer) RETURNS public.mo_chores
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_rewards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    emoji text NOT NULL,
    title text NOT NULL,
    description text,
    cost integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mo_rewards_cost_check CHECK ((cost > 0))
);


--
-- Name: mo_admin_create_reward(uuid, text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_create_reward(p_token uuid, p_emoji text, p_title text, p_description text, p_cost integer) RETURNS public.mo_rewards
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_admin_decline_request(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_decline_request(p_token uuid, p_id uuid, p_message text) RETURNS public.mo_reward_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_admin_delete_category(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_delete_category(p_token uuid, p_id uuid, p_reassign_to uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_admin_fulfill_request(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_fulfill_request(p_token uuid, p_id uuid) RETURNS public.mo_reward_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_admin_login(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_login(p_pin text) RETURNS TABLE(token uuid, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_admin_logout(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_logout(p_token uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  delete from public.mo_admin_sessions where token = p_token;
$$;


--
-- Name: mo_admin_pin_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_pin_status() RETURNS TABLE(configured boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select (pin_hash is not null) from public.mo_admin_pin where id = true;
$$;


--
-- Name: mo_admin_reorder_categories(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_reorder_categories(p_token uuid, p_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare i int;
begin
  perform public.mo_assert_admin(p_token);
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.mo_categories set sort_order = i - 1 where id = p_ids[i];
  end loop;
end;
$$;


--
-- Name: mo_admin_reorder_chores(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_reorder_chores(p_token uuid, p_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare i int;
begin
  perform public.mo_assert_admin(p_token);
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.mo_chores set sort_order = i - 1 where id = p_ids[i];
  end loop;
end;
$$;


--
-- Name: mo_admin_reorder_rewards(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_reorder_rewards(p_token uuid, p_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare i int;
begin
  perform public.mo_assert_admin(p_token);
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.mo_rewards set sort_order = i - 1 where id = p_ids[i];
  end loop;
end;
$$;


--
-- Name: mo_admin_session_valid(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_session_valid(p_token uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.mo_admin_sessions where token = p_token and expires_at > now()
  );
$$;


--
-- Name: mo_admin_set_chore_active(uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_set_chore_active(p_token uuid, p_id uuid, p_active boolean) RETURNS public.mo_chores
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_row public.mo_chores;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_chores set active = p_active where id = p_id returning * into v_row;
  if not found then raise exception 'not_found'; end if;
  return v_row;
end;
$$;


--
-- Name: mo_admin_set_reward_active(uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_set_reward_active(p_token uuid, p_id uuid, p_active boolean) RETURNS public.mo_rewards
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_row public.mo_rewards;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_rewards set active = p_active where id = p_id returning * into v_row;
  if not found then raise exception 'not_found'; end if;
  return v_row;
end;
$$;


--
-- Name: mo_admin_update_category(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_update_category(p_token uuid, p_id uuid, p_emoji text, p_name text, p_color text) RETURNS public.mo_categories
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_row public.mo_categories;
begin
  perform public.mo_assert_admin(p_token);
  update public.mo_categories set emoji = p_emoji, name = p_name, color = nullif(p_color, '')
    where id = p_id returning * into v_row;
  if not found then raise exception 'not_found'; end if;
  return v_row;
end;
$$;


--
-- Name: mo_admin_update_chore(uuid, uuid, text, text, text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_update_chore(p_token uuid, p_id uuid, p_emoji text, p_title text, p_description text, p_category_id uuid, p_points integer) RETURNS public.mo_chores
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_admin_update_reward(uuid, uuid, text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_update_reward(p_token uuid, p_id uuid, p_emoji text, p_title text, p_description text, p_cost integer) RETURNS public.mo_rewards
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_settings (
    id boolean DEFAULT true NOT NULL,
    display_name text DEFAULT 'Klara'::text NOT NULL,
    CONSTRAINT mo_settings_id_check CHECK (id)
);


--
-- Name: mo_admin_update_settings(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_admin_update_settings(p_token uuid, p_display_name text) RETURNS public.mo_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_assert_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_assert_admin(p_token uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_token is null or not exists (
    select 1 from public.mo_admin_sessions
    where token = p_token and expires_at > now()
  ) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end;
$$;


--
-- Name: mo_cancel_reward_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_cancel_reward_request(p_id uuid) RETURNS public.mo_reward_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_complete_chore(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_complete_chore(p_chore_id uuid) RETURNS public.mo_activity_log
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_points_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_points_summary() RETURNS TABLE(current_balance integer, reserved integer, available integer, lifetime integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_request_reward(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_request_reward(p_reward_id uuid) RETURNS public.mo_reward_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: mo_undo_chore_completion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mo_undo_chore_completion(p_log_id uuid) RETURNS public.mo_activity_log
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: notify_app_data_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_app_data_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: notify_mo_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_mo_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  perform pg_notify('changes', json_build_object('table', tg_table_name)::text);
  return null;
end;
$$;


--
-- Name: set_app_data_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_app_data_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: app_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_data (
    user_id uuid NOT NULL,
    app_id text NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_data_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_data_backups (
    user_id uuid NOT NULL,
    backup_date date NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mo_admin_pin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_admin_pin (
    id boolean DEFAULT true NOT NULL,
    pin_hash text,
    CONSTRAINT mo_admin_pin_id_check CHECK (id)
);


--
-- Name: mo_admin_pin_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_admin_pin_attempts (
    id boolean DEFAULT true NOT NULL,
    fail_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    CONSTRAINT mo_admin_pin_attempts_id_check CHECK (id)
);


--
-- Name: mo_admin_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mo_admin_sessions (
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token_hash bytea NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    oidc_sub text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_email_check CHECK ((email = lower(email)))
);


--
-- Name: app_data_backups app_data_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_data_backups
    ADD CONSTRAINT app_data_backups_pkey PRIMARY KEY (user_id, backup_date);


--
-- Name: app_data app_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_data
    ADD CONSTRAINT app_data_pkey PRIMARY KEY (user_id, app_id, key);


--
-- Name: mo_activity_log mo_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_activity_log
    ADD CONSTRAINT mo_activity_log_pkey PRIMARY KEY (id);


--
-- Name: mo_admin_pin_attempts mo_admin_pin_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_admin_pin_attempts
    ADD CONSTRAINT mo_admin_pin_attempts_pkey PRIMARY KEY (id);


--
-- Name: mo_admin_pin mo_admin_pin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_admin_pin
    ADD CONSTRAINT mo_admin_pin_pkey PRIMARY KEY (id);


--
-- Name: mo_admin_sessions mo_admin_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_admin_sessions
    ADD CONSTRAINT mo_admin_sessions_pkey PRIMARY KEY (token);


--
-- Name: mo_categories mo_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_categories
    ADD CONSTRAINT mo_categories_pkey PRIMARY KEY (id);


--
-- Name: mo_chores mo_chores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_chores
    ADD CONSTRAINT mo_chores_pkey PRIMARY KEY (id);


--
-- Name: mo_reward_requests mo_reward_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_reward_requests
    ADD CONSTRAINT mo_reward_requests_pkey PRIMARY KEY (id);


--
-- Name: mo_rewards mo_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_rewards
    ADD CONSTRAINT mo_rewards_pkey PRIMARY KEY (id);


--
-- Name: mo_settings mo_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_settings
    ADD CONSTRAINT mo_settings_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_oidc_sub_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_oidc_sub_key UNIQUE (oidc_sub);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: mo_activity_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_activity_log_created_at_idx ON public.mo_activity_log USING btree (created_at DESC);


--
-- Name: mo_activity_log_ref_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_activity_log_ref_id_idx ON public.mo_activity_log USING btree (ref_id) WHERE (ref_id IS NOT NULL);


--
-- Name: mo_admin_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_admin_sessions_expires_at_idx ON public.mo_admin_sessions USING btree (expires_at);


--
-- Name: mo_chores_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_chores_category_id_idx ON public.mo_chores USING btree (category_id);


--
-- Name: mo_reward_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_reward_requests_status_idx ON public.mo_reward_requests USING btree (status);


--
-- Name: sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: app_data app_data_notify_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_data_notify_change AFTER INSERT OR UPDATE ON public.app_data FOR EACH ROW EXECUTE FUNCTION public.notify_app_data_change();


--
-- Name: app_data app_data_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_data_set_updated_at BEFORE UPDATE ON public.app_data FOR EACH ROW EXECUTE FUNCTION public.set_app_data_updated_at();


--
-- Name: mo_activity_log mo_activity_log_notify_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mo_activity_log_notify_change AFTER INSERT OR DELETE OR UPDATE ON public.mo_activity_log FOR EACH STATEMENT EXECUTE FUNCTION public.notify_mo_change();


--
-- Name: mo_categories mo_categories_notify_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mo_categories_notify_change AFTER INSERT OR DELETE OR UPDATE ON public.mo_categories FOR EACH STATEMENT EXECUTE FUNCTION public.notify_mo_change();


--
-- Name: mo_chores mo_chores_notify_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mo_chores_notify_change AFTER INSERT OR DELETE OR UPDATE ON public.mo_chores FOR EACH STATEMENT EXECUTE FUNCTION public.notify_mo_change();


--
-- Name: mo_reward_requests mo_reward_requests_notify_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mo_reward_requests_notify_change AFTER INSERT OR DELETE OR UPDATE ON public.mo_reward_requests FOR EACH STATEMENT EXECUTE FUNCTION public.notify_mo_change();


--
-- Name: mo_rewards mo_rewards_notify_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mo_rewards_notify_change AFTER INSERT OR DELETE OR UPDATE ON public.mo_rewards FOR EACH STATEMENT EXECUTE FUNCTION public.notify_mo_change();


--
-- Name: mo_settings mo_settings_notify_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mo_settings_notify_change AFTER INSERT OR DELETE OR UPDATE ON public.mo_settings FOR EACH STATEMENT EXECUTE FUNCTION public.notify_mo_change();


--
-- Name: app_data_backups app_data_backups_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_data_backups
    ADD CONSTRAINT app_data_backups_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: app_data app_data_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_data
    ADD CONSTRAINT app_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mo_chores mo_chores_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_chores
    ADD CONSTRAINT mo_chores_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.mo_categories(id) ON DELETE SET NULL;


--
-- Name: mo_reward_requests mo_reward_requests_reward_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mo_reward_requests
    ADD CONSTRAINT mo_reward_requests_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES public.mo_rewards(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261030130000'),
    ('20261030150000');
