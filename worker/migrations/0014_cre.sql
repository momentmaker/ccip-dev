-- CCIP messages sent by Chainlink CRE workflows: the source transaction's signer (origin) is a CRE node key on the source
-- chain (config/cre-keys.json). ADD COLUMN with a constant default does not rewrite the table, so this is cheap on the
-- ~1.6M-row messages table. No index and no backfill here: retagCre (worker/src/cre-retag.ts) back-tags history from the
-- Worker one day per batch, as the 7429 rule requires.
ALTER TABLE messages ADD COLUMN cre INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_totals ADD COLUMN cre_messages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_totals ADD COLUMN cre_usd REAL NOT NULL DEFAULT 0;
