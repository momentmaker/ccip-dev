-- Classification before this fix read an owner() that an RPC endpoint failed or rate-limited as "no owner", so stake.link
-- vaults were stored as plain contracts. Dropping the contract rows makes the next staking run check them again; the
-- staking files wait until it has.
DELETE FROM staking_holders WHERE kind = 'contract';
