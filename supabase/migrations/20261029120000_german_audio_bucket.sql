-- German app audio: example sentences spoken by OpenAI TTS (the german-tts
-- edge function uploads them with the user's own token). Private bucket, read
-- back by the app; objects live under "<user id>/<hash>.mp3", and each
-- user may only touch their own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('german-audio', 'german-audio', false, 1048576, array['audio/mpeg']);

create policy "users read their own german audio"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'german-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users upload their own german audio"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'german-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users update their own german audio"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'german-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'german-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users delete their own german audio"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'german-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
