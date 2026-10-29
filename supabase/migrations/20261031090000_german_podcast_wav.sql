-- German app podcast: episodes are now WAV (Gemini TTS returns raw PCM, and
-- edge functions get too little CPU to encode mp3; see
-- supabase/functions/_shared/wav.ts), at "<user id>/podcast/<id>.wav" and
-- about 17 MB for six minutes, so the german-audio bucket takes audio/wav
-- too, up to 50 MB.

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['audio/mpeg', 'audio/wav']
where id = 'german-audio';
