-- Recipes app photos. Private bucket: images are compressed in the browser
-- before upload and read back through signed URLs, so only signed-in users
-- ever see their own photos. Objects live under "<user id>/<file>", and each
-- user may only touch their own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', false, 2097152, array['image/webp', 'image/jpeg']);

create policy "users read their own recipe photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recipe-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users upload their own recipe photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recipe-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users update their own recipe photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'recipe-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'recipe-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users delete their own recipe photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recipe-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
