-- Token lookups match lower(address), which the (chain, address) key can't serve, so each match read every token on
-- its chain; an index on the same expression serves it directly.
CREATE INDEX tokens_chain_lower_address ON tokens (chain, lower(address));
