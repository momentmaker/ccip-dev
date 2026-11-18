-- The hourly re-check of holders whose classification is 30 days old reads only the rows due.
CREATE INDEX staking_holders_checked_at ON staking_holders (checked_at);
