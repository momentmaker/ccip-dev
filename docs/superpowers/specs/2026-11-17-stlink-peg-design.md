# ccip.dev: the stLINK/LINK peg

**Status:** Implemented · **Date:** 2026-11-17

stLINK is stake.link's rebasing liquid-staking token: 1 stLINK is always redeemable for 1 LINK through stake.link, in
time. On Curve it trades freely, and sometimes away from 1:1. When it does, there is a trade: buy the cheap side on Curve
and close the loop through stake.link at 1:1. Whether that trade is open right now depends on stake.link's queues, which
nobody shows. This adds the stLINK/LINK peg to /staking, with history, depth, the state of both routes, and Telegram
alerts when the gap opens.

The owner approved on 2026-11-17:
- **Everything in one design:** live peg, hourly history, Curve depth, route state, episodes and alerts, staking-event
  markers, records, a share card.
- **Alerts:** private (alert chat) at a low threshold, public (TG channel only, no X) at a higher one.

## Findings behind the design (probed 2026-11-17/18)

**The market.** The main pool is Curve's stableswap-ng `stLINK/LINK-ng` at
`0x7E13876B92F1a62C599C231f783f682E96B91761` (about $3.9M; `coins(0)` = LINK, `coins(1)` = stLINK; stLINK registered as
a rebasing asset). The older factory pool `0x1c899dED01954d0959E034b62a728e7fEbE593b0` holds about $278k and is left out.

**History is free.** `https://prices.curve.finance/v1/ohlc/ethereum/{pool}?main_token={stLINK}&reference_token={LINK}&agg_number=1&agg_units=hour&start&end`
returns hourly OHLC of stLINK in LINK, keyless. A request is capped at roughly 200–250 bars (9 days of hours is safe);
history starts 2025-04-19. Hours without swaps repeat the last price.

**The year so far (Nov 2025 – Nov 2026, hourly closes).** Since March the price has mostly sat within 0.1% of 1:1.
January 2026 sat at a steady discount (median 0.9948 for the month). 23–26 Sep 2026: about −0.9% for two days, then a
premium to +5.64% from 20:00 UTC on the 25th, gone in about 4 hours. 451 hours closed 0.5% or more off 1:1; 4 closed 1%
or more off. At 16:00 UTC on 23 Sep, 80 stake.link vaults began unbonding in the same hour (77 community, 3 operator),
the afternoon the discount deepened. That is coincidence in time, not shown cause; the premium two days later has no
matching staking event.

**stake.link's two routes** (verified against the deployed implementations' exact-match source on Sourcify and live
`eth_call`s, 2026-11-18 01:31 UTC):

| Contract | Address |
|---|---|
| StakingPool / stLINK | `0xb8b295df2cd735b15BE5Eb419517Aa626fc43cD5` |
| PriorityPool | `0xDdC796a66E8b83d0BcCD97dF33A6CcFBA8fd60eA` |
| WithdrawalPool | `0xa60B5146E44ff755e32BD51532842ceB41D0C248` |
| FundFlowController | `0xd2e7381d8d3FcC97C1b4d88761bDBc8Dd26a0200` |

- **Mint (LINK → stLINK).** `PriorityPool` deposits instantly only while `totalQueued() == 0`: first into the
  WithdrawalPool's queue (the depositor gets stLINK at once), then up to `StakingPool.canDeposit()`. With anything
  queued, a deposit queues too, and the stLINK is claimed later with a merkle proof. Blocked unless
  `poolStatus() == 0` (OPEN).
- **Redeem (stLINK → LINK).** `PriorityPool` withdrawals match queued LINK first (instant), then, only if
  `allowInstantWithdrawals()` and the WithdrawalPool queue is empty, draw from `StakingPool.canWithdraw()`. The rest
  queues in the WithdrawalPool (FIFO, at least 5 stLINK), paid out at most every `minTimeBetweenWithdrawals()` (3 days)
  and only while `FundFlowController.claimPeriodActive()`. Blocked when `poolStatus() == 2` (CLOSED).
- **No fees** on either route; fees apply to rewards only.
- **On the night of the probe both routes were shut for size:** `totalQueued` 17.88 LINK, `canDeposit` 0,
  `allowInstantWithdrawals` false, WithdrawalPool queue 0. A persistent gap is what you'd expect when neither route is
  instant, which likely explains January's 19-day discount.

## 1. Data

### Migration `0015_peg.sql`

```sql
CREATE TABLE peg_hours (
  hour TEXT PRIMARY KEY,           -- ISO hour, '2026-09-25T20:00:00Z'
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL
);

CREATE TABLE peg_episodes (       -- the live alert log, one row per episode seen by the 5-minute checks
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  side TEXT NOT NULL CHECK (side IN ('discount', 'premium')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  peak_gap REAL NOT NULL,          -- signed, e.g. -0.0091
  peak_at TEXT NOT NULL,
  best_size REAL,                  -- largest profitable Curve size seen, LINK
  best_profit REAL,                -- LINK profit at best_size
  tier INTEGER NOT NULL DEFAULT 0, -- highest private tier announced (1%, 2%, 5% → 1, 2, 3)
  public INTEGER NOT NULL DEFAULT 0,
  public_at TEXT                   -- when it crossed the public line; times the card wait for its post
);
CREATE INDEX peg_episodes_open ON peg_episodes (closed_at) WHERE closed_at IS NULL;

CREATE TABLE peg_markers (        -- staking events worth a pin on the peg chart
  hour TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('stakelink_unbonding', 'stakelink_deposit')),
  vaults INTEGER NOT NULL,
  link REAL,
  PRIMARY KEY (hour, kind)
);
```

The table is created empty; no backfill in the migration (see the D1 migration lesson). About 14k `peg_hours` rows
today, 8.7k a year after.

### Hourly: history (`0 * * * *`, new `peg-history` job after `staking`)

1. **Backfill**, cursor `meta.peg_backfill_before` (unset = now): page backwards 9 days per request, at most 10
   requests per run, upserting bars. Stops for good when a page returns no bars before 2025-04-19
   (`meta.peg_backfill_done = 1`). About six runs.
2. **Refresh** the last 6 hours every run, upserting, so late or corrected bars land.
3. **Markers**, cursor `meta.peg_marker_block`: read `staking_events` joined to `staking_holders` where
   `block_number > cursor` (primary-key range, never a `ts` scan). Per hour: stake.link vaults (holder kind
   `stakelink`) that began unbonding, kept when 10 or more; LINK staked by stake.link vaults, kept when 10,000 or more.
   Upsert into `peg_markers`. First run walks all events once.
4. **Publish** `peg-history.json` (§3).

### Every 5 minutes: live state (`*/5 * * * *`, new `peg` job after `prices`)

One JSON-RPC batch (`ethRpcBatch` through `onFirstEndpoint`, over the `balanceRpcUrls` list):

| Read | Call |
|---|---|
| Spot | Curve `get_p(0)`: stLINK in LINK |
| EMA | Curve `price_oracle(0)` |
| Ladder | Curve `get_dy(0,1,x)` and `get_dy(1,0,x)` for x in 1k, 5k, 10k, 25k, 50k, 100k, 250k |
| Mint route | PriorityPool `poolStatus()`, `totalQueued()`; StakingPool `canDeposit()`, `getStrategyDepositRoom()`, `getUnusedDeposits()`, `unusedDepositLimit()` |
| Redeem route | PriorityPool `allowInstantWithdrawals()`; StakingPool `canWithdraw()`; WithdrawalPool `getTotalQueuedWithdrawals()`, `timeOfLastWithdrawal()`, `minTimeBetweenWithdrawals()`; FundFlowController `claimPeriodActive()` |

About 26 calls in one request. The job reads `meta` and the open episode by index, writes `meta` and at most one
episode row, and publishes `peg.json`.

A sample with a spot outside 0.5–1.5 is treated as a bad read: dropped, not stored, alert `peg-bad-read`. RPC failures
count in `meta.peg_failures`; alert `peg-rpc` after 3 in a row. A dropped sample leaves the episode state as it was.

## 2. Metrics (pure functions in `packages/core/src/peg.ts`)

- **Gap** = spot − 1. Negative is a discount (stLINK cheap), positive a premium.
- **Curve depth to 1:1.** Discount: buy stLINK with LINK, profit = `get_dy(0,1,x) − x` (redeemed later at 1:1).
  Premium: mint x stLINK at 1:1 and sell, profit = `get_dy(1,0,x) − x`. **Depth** is the largest ladder size with
  profit > 0, and its profit; none when even 1k is unprofitable. Pool fees (base 0.01%, 5× off-peg multiplier) are
  inside `get_dy`, so depth is net of them. Gas is not.
- **Instant capacity** (agent-verified formulas):
  - Redeem: `poolStatus != 2 ? totalQueued + (allowInstantWithdrawals && queuedWithdrawals == 0 ? canWithdraw : 0) : 0`.
  - Mint: `poolStatus == 0 && totalQueued == 0 ? queuedWithdrawals + min(canDeposit, strategyDepositRoom + max(0, unusedDepositLimit − unusedDeposits)) : 0`.
    The `min(...)` cap comes from reading `StakingPool.deposit`'s `InvalidDeposit` check, not from a simulation (it
    was 0 at the probe). The first time `canDeposit > 0` is seen, the job alerts once (`peg-mint-check`) and the runbook's simulation decides
    whether the formula needs fixing.
- **Queue state.**
  - Redeem: queued withdrawals ahead (LINK), next payout earliest at `timeOfLastWithdrawal + minTimeBetweenWithdrawals`,
    and whether a claim window is open now.
  - Mint: LINK queued ahead (`totalQueued`). No ETA: it mints when the pool has room.
- **Tradeable now** = min(depth, instant capacity of the route the gap calls for). Profit at that size comes from the
  ladder, interpolated linearly between rungs.

## 3. Published data (R2 `PUBLIC`, schemas in `packages/core/src/public.ts`)

**`peg.json`**, every 5 minutes, short TTL (values illustrative):

```json
{
  "schema_version": 1, "updated_at": "…", "attribution": "…",
  "pool": "0x7e13…1761",
  "spot": 0.999744, "ema": 0.999734, "gap": -0.000256,
  "ladder": [{ "size": 1000, "buy_st": 1000.146, "sell_st": 999.634 }],
  "discount": { "depth": 25000, "profit": 6.1, "instant": 17.88, "tradeable": 17.88,
                "queued_ahead": 0, "next_payout_after": "2026-11-18T15:50:00Z", "claim_window_open": true },
  "premium": { "depth": null, "profit": null, "instant": 0, "tradeable": 0, "queued_ahead": 17.88 },
  "routes": { "pool_status": "open", "instant_withdrawals": false },
  "episode": null
}
```

`episode` is the open episode, if any. `recent_episodes` lists the last 10 (id, side, opened_at, closed_at, peak_gap, peak_at, best_size, best_profit, public, public_at), so a card can draw a closed episode's recap. Both files carry `thresholds`, for the chart's bands.

**`peg-history.json`**, hourly:

- `hours`: the last 90 days of bars `[hour, open, high, low, close]`.
- `days`: daily bars all-time, built from `peg_hours`.
- `markers`: all of `peg_markers`.
- `episodes`: from the hourly closes with the private threshold and the same open/close rule (one bar confirms).
  Each has side, start, end, peak gap, peak hour and hours.
- `records`: deepest discount (lowest `low`), highest premium (highest `high`), longest episode, last episode end.

Records and the episode list come from hourly bars, so they cover history before launch; alerts come from 5-minute
checks. The methodology says so, since the two can differ slightly.

## 4. Episodes and alerts

**State machine** (`peg.ts`, pure: `(state, sample, thresholds) → (state, events)`), run on each good 5-minute sample:

- **Open:** two consecutive samples with |gap| ≥ T_private on the same side. Opened at the first of the two.
- **Peak:** the most extreme gap while open, with its time; best size and profit are tracked too.
- **Close:** two consecutive samples where |gap| < T_private / 2 or the gap has the other sign. A side flip therefore
  closes the episode, and the other side opens by the normal rule.
- **Tiers:** private follow-ups when two consecutive samples cross 1%, 2% and 5% (each once per episode).
- **Public:** an open episode goes public when two consecutive samples reach T_public. A public episode gets a public
  recap when it closes.

Events: `opened`, `tier`, `went_public`, `closed`. The worker turns them into messages; the state lives in `meta.peg_state`
(pending confirm counts) and `peg_episodes`.

**Thresholds** are wrangler vars: `PEG_ALERT_PRIVATE_PCT = "0.3"`, `PEG_ALERT_PUBLIC_PCT = "0.75"`. Replayed over the
past year these would have given about 3–4 private episodes and 2 public ones (the September discount and the
September premium).

**Private** (alert chat, via a new sender beside `createAlerter`, which suppresses by the hour and is wrong for this;
dedupe is the episode row's own state). Plain text, numbers illustrative:

```
stLINK at a 0.84% discount (1 stLINK = 0.9916 LINK)
Curve: buy up to 38,000 LINK of stLINK under 1:1, +212 LINK at that size
Redeem route: 17.9 LINK instant; the rest queues (0 ahead, next payout after Nov 18 15:50 UTC, claim window open)
https://ccip.dev/staking/#peg
```

Closed: side, peak and when, duration, best size seen. Tiers: the new peak and current route state.

**Public** (TG channel only): a new broadcast target `{ kind: 'peg'; episode: number; phase: 'open' | 'close' }`,
planned by the `peg` job and sent through `broadcastSafely`, whose broadcast keys already send a target once. `peg` stays out of
`X_KINDS`, so no X post or X draft. The open post carries the share card and copy in the voice of the staking posts.
The close post is a recap. Every post ends with `Not financial advice.` Public posting is gated by
`PEG_PUBLIC = "on"` and ships `"off"`.

## 5. Site

**/staking gets a "stLINK peg" section** (`id="peg"`, in the jump nav, after the exit queue, since the redeem route is
the same queue story). The page builds with `peg.json` and `peg-history.json` (`buildDataIfPublished`) and polls
`peg.json` every minute, as it does `staking.json`.

- **Readout:** `1 stLINK = 0.99974 LINK`, the gap as a signed percent, the open episode if any, freshness note.
- **Route cards:** Discount route (buy stLINK on Curve → redeem at 1:1) and Premium route (mint at 1:1 → sell on
  Curve). The card the current gap calls for is lit. Each shows Curve depth and profit, instant capacity, tradeable
  now, and queue state in plain words ("Redeems queue: next payout after Nov 18, 15:50 UTC").
- **Gap chart:** gap in percent, ranges 7D / 30D / 1Y / All (hours for ≤ 90 days, days beyond), dashed bands at
  ±T_private and ±T_public, a zero line, hover readout (time, close, low/high), episode spans shaded, marker pins with
  their words ("80 stake.link vaults began unbonding"). Built like the home CRE chart (`site/src/lib/cre.ts` geometry,
  tested in isolation).
- **Records:** deepest discount, highest premium, longest episode, days since the last one, and the episode list.
- **Share card** `og/peg.png` (site worker cards, the staking card's look): the peg readout, a 30-day gap sparkline,
  and the open episode or the days since the last one. The public posts use it.

## 6. Docs

- `docs/methodology.md`: "stLINK peg": sources, the gap, depth and its assumptions (gas excluded, the 1:1 leg queued
  unless instant), instant capacity, episodes (5-minute live vs hourly history), markers are timing, not cause.
- `docs/runbook.md`: thresholds and `PEG_PUBLIC`, resetting the backfill cursor, what `peg-rpc` / `peg-bad-read` mean.

## 7. Testing

- **core `peg.ts`:** gap; ladder depth and interpolation (profitable, none, all rungs profitable); both capacity
  formulas, each switch (pool status, queue, instant flag) on its own; the state machine: open needs two samples, one
  spike does not open, close on half-threshold, side flip closes, tiers fire once, public fires once, a dropped sample
  changes nothing; **a replay of the real 22–26 Sep 2026 hours** gives a discount episode, then a premium episode that
  goes public.
- **core history:** Curve OHLC parsing, the 9-day paging, hourly episodes and records from bars.
- **worker `jobs/peg.ts`, `jobs/peg-history.ts`:** mocked fetch in the existing job-test style: backfill advances the
  cursor and stops; refresh upserts; markers read by block cursor; bad read and RPC failures alert after the limits;
  private messages on open and close; a public broadcast planned only with `PEG_PUBLIC = "on"`.
- **site:** `peg-view.ts` (route card text, range selection, hourly vs daily), chart geometry, card render test like
  `staking-cards.test.ts`.

## 8. Rollout (each stage its own PR)

1. **History:** migration, Curve client, backfill and refresh, `peg-history.json` (hours, days).
2. **Live state:** the 5-minute batch, metrics, `peg.json`; the deposit simulation check.
3. **Episodes and private alerts:** state machine, `peg_episodes`, private messages.
4. **Page:** the /staking section, readout, route cards, chart.
5. **Markers, records, card and public posts:** `peg_markers`, records, `og/peg.png`, the `peg` broadcast target;
   `PEG_PUBLIC` switched on after the owner has seen the private alerts behave.

## Not in this version

- The older Curve pool, wstLINK pools on other chains, and other venues (Uniswap, Balancer).
- Gas cost in profit.
- An ETA for queued mints, and the claim-window calendar for queued redeems.
- X posts, and the peg on the home page.
- Executing trades, or any wallet connection.
