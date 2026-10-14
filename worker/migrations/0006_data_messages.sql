-- Messages that carry no tokens, per day. Every row here was written by rollupDay, whose token_messages counts the same
-- day's messages with token_count > 0, so the rest are exactly its data messages: one pass over daily_totals, about
-- 1,200 rows, instead of reading every message in the deploy's migration.
ALTER TABLE daily_totals ADD COLUMN data_messages INTEGER;
UPDATE daily_totals SET data_messages = messages - token_messages;
