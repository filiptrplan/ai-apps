-- German app podcast: whole episodes (about six minutes of mp3) go in the
-- german-audio bucket next to the spoken sentences, at
-- "<user id>/podcast/<episode id>.mp3", so its size limit grows from 1 MB.

update storage.buckets
set file_size_limit = 20971520
where id = 'german-audio';
