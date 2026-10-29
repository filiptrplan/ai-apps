-- German app podcast: whole episodes (about six minutes of WAV, roughly
-- 17 MB; see supabase/functions/_shared/wav.ts for why not mp3) go in the
-- german-audio bucket next to the spoken sentences, at
-- "<user id>/podcast/<episode id>.wav", so it takes WAV too and its size
-- limit grows from 1 MB.

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['audio/mpeg', 'audio/wav']
where id = 'german-audio';
