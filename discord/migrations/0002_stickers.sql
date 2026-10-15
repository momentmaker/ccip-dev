-- Each Marine's sticker: the pack it is in, and its file id there. Both stay NULL until the sticker job adds it;
-- the job does the backfill, so this migration changes no rows.
ALTER TABLE marines ADD COLUMN sticker_set TEXT;
ALTER TABLE marines ADD COLUMN sticker_file_id TEXT;
