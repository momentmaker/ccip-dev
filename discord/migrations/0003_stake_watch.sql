-- Claim-window reminders on Telegram: a private chat watching a staking address. opened_for and closing_for hold the
-- unbonding start each reminder was last sent for, so a reminder goes out once per unbonding.
CREATE TABLE stake_watch (
  chat_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  opened_for TEXT,
  closing_for TEXT,
  PRIMARY KEY (chat_id, address)
);
