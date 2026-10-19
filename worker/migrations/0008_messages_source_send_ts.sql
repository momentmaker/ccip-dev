-- The ingest job asks for the newest live message every minute. With only messages_send_ts, SQLite scanned and sorted
-- every message for it (about 2.2B rows read a day); this index answers it from one entry.
CREATE INDEX messages_source_send_ts ON messages (source, send_ts);
