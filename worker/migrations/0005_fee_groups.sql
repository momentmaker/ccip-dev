ALTER TABLE daily_totals ADD COLUMN fee_native_usd REAL;
ALTER TABLE daily_totals ADD COLUMN fee_stable_usd REAL;
ALTER TABLE daily_totals ADD COLUMN fee_link_amount REAL;
CREATE INDEX idx_messages_fee_usd ON messages (fee_usd) WHERE fee_usd IS NOT NULL;
