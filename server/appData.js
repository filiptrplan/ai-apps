// The only module that reads or writes public.app_data (and its daily
// backups). Every query is scoped to a user id passed in by the caller,
// which takes it from the session, never from the request.
//
// updated_at is returned as text, in the same format PostgREST used
// ("2026-10-30T11:03:41.123456+00:00"), not as a Date: a Date drops the
// microseconds, and clients send the value back as `ifUpdatedAt`, which
// must match exactly. Old sync markers in the apps' localStorage keep
// matching too.

const RETENTION_DAYS = 7;

export class ConflictError extends Error {
  constructor() {
    super("The value changed since it was read");
    this.status = 409;
  }
}

export function createAppDataStore(sql) {
  // Returns { value, updated_at } or null.
  async function get(userId, appId, key) {
    const [row] = await sql`
      select value, to_json(updated_at) #>> '{}' as updated_at
      from public.app_data
      where user_id = ${userId} and app_id = ${appId} and key = ${key}
    `;
    return row ?? null;
  }

  // Writes the value and returns the new updated_at. `ifUpdatedAt`:
  //   undefined: no guard, insert or overwrite.
  //   null: only if the row doesn't exist yet.
  //   a timestamp: only if the row still has that updated_at.
  // A failed guard throws ConflictError.
  async function put(userId, appId, key, value, ifUpdatedAt) {
    const json = JSON.stringify(value);
    let rows;
    if (ifUpdatedAt === undefined) {
      rows = await sql`
        insert into public.app_data (user_id, app_id, key, value)
        values (${userId}, ${appId}, ${key}, ${json}::text::jsonb)
        on conflict (user_id, app_id, key) do update set value = excluded.value
        returning to_json(updated_at) #>> '{}' as updated_at
      `;
    } else if (ifUpdatedAt === null) {
      rows = await sql`
        insert into public.app_data (user_id, app_id, key, value)
        values (${userId}, ${appId}, ${key}, ${json}::text::jsonb)
        on conflict (user_id, app_id, key) do nothing
        returning to_json(updated_at) #>> '{}' as updated_at
      `;
    } else {
      rows = await sql`
        update public.app_data set value = ${json}::text::jsonb
        where user_id = ${userId} and app_id = ${appId} and key = ${key}
          and updated_at = ${ifUpdatedAt}::timestamptz
        returning to_json(updated_at) #>> '{}' as updated_at
      `;
    }
    if (rows.length === 0) throw new ConflictError();
    return rows[0].updated_at;
  }

  // The users who have a row under this app and key, for jobs that look at
  // everyone's (e.g. the podcast's restart recovery).
  async function usersWith(appId, key) {
    const rows = await sql`select user_id from public.app_data where app_id = ${appId} and key = ${key}`;
    return rows.map((r) => r.user_id);
  }

  // Newest first.
  async function listBackups(userId) {
    return sql`
      select to_char(backup_date, 'YYYY-MM-DD') as backup_date, created_at
      from public.app_data_backups
      where user_id = ${userId}
      order by backup_date desc
    `;
  }

  // Writes every row of that day's backup back into app_data, overwriting
  // current values; rows created since are left alone. Returns false if
  // there is no such backup.
  async function restoreBackup(userId, backupDate) {
    const [backup] = await sql`
      select 1 from public.app_data_backups
      where user_id = ${userId} and backup_date = ${backupDate}::date
    `;
    if (!backup) return false;
    await sql`
      insert into public.app_data (user_id, app_id, key, value)
      select b.user_id, r ->> 'app_id', r ->> 'key', r -> 'value'
      from public.app_data_backups b, jsonb_array_elements(b.data) r
      where b.user_id = ${userId} and b.backup_date = ${backupDate}::date
      on conflict (user_id, app_id, key) do update set value = excluded.value
    `;
    return true;
  }

  // Snapshots every user's app_data for `today` (a UTC "YYYY-MM-DD"), once:
  // a second run on the same day keeps the first snapshot. Then deletes
  // backups older than RETENTION_DAYS. Returns the number of new snapshots.
  async function snapshotAll(today) {
    const created = await sql`
      insert into public.app_data_backups (user_id, backup_date, data)
      select user_id, ${today}::date,
        jsonb_agg(jsonb_build_object('app_id', app_id, 'key', key, 'value', value) order by app_id, key)
      from public.app_data
      group by user_id
      on conflict (user_id, backup_date) do nothing
      returning user_id
    `;
    await sql`
      delete from public.app_data_backups
      where backup_date < ${today}::date - ${RETENTION_DAYS - 1}::int
    `;
    return created.length;
  }

  return { get, put, usersWith, listBackups, restoreBackup, snapshotAll };
}
