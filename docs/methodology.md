# ccip.dev methodology

## What is counted
- **Message:** one mainnet CCIP message from `api.ccip.chain.link/v2` (`environment=mainnet`). Testnets are excluded.
- **Day:** the UTC date of the message's send time.
- **Value transferred:** Σ over a message's tokens of `amount / 10^decimals × USD price`.
  - Live data uses the latest DefiLlama price when the message is first valued. A live message that is still unpriced
    is valued again when its day is finalized (00:10 UTC, and again at 06:00 UTC, the next day).
  - History uses DefiLlama's daily price for the send day.
  - Data-only messages add $0.
- **Price lookup:** live data and history use the same order.
  1. DefiLlama's price for the token's own chain and address.
  2. The same token on another CCIP chain, from the same CCIP token group. Siblings on Ethereum, Base, Arbitrum,
     Optimism, Polygon, BSC, Avalanche and Solana are preferred, and the token's own decimals are used.
  3. DefiLlama's `coingecko:<id>` price. The CoinGecko id comes from CoinGecko's free coin list (platform plus
     contract address). CoinGecko is used only to map ids; no CoinGecko price is stored.
  4. Otherwise the token is unpriced.
- **Price guards:**
  - A single token transfer valued above $10 billion is treated as a bad price and counted as unpriced.
  - History only: a missing daily price is filled from the nearest day within ±2 days. The fill happens only when
    the price series has points on both sides of the day; when two days are equally near, the earlier one is used.
  - History only: a daily price more than 20× or less than 1/20 of the median of the token's other prices within
    ±7 days (or of its nearest 3 prices) is dropped as a glitch. The final history build dropped 107 such prices.
    For example, DefiLlama lists elizaOS at $125,176 on its launch day, 2025-11-07. Without the guard that day
    totals $18.8 trillion; with it, $74.7 million.
- **Unpriced:** a token none of the steps can price adds $0. The message is still counted, and it is reported in
  `unpriced_messages`. Since 2023-07-06, 68,893 of 1,565,729 messages (4.4%) are unpriced.
- **Fees:** the message's fixed fee, in USD. Fees come from each message's detail. Live messages have them from
  2026-10-05, valued at the fee token's latest price; earlier days get them from the fee backfill, which values each
  fee at its send day's price. The site shows fees from the first day that has them. A live fee that couldn't be priced
  when its detail was fetched is priced again, at the latest price, when its day is finalized.
  - Some fee tokens have no market price of their own. When such a token is a chain's wrapped gas token (WBTC on
    Bitlayer, WTAO on Bittensor EVM) or the same token as a priced one (LINK on BNB Chain and Polygon), its fee is
    valued at the coin it wraps or matches, through DefiLlama's `coingecko:<id>` price, at the token's own decimals.
    Each such token's decimals were read on chain.
  - Canton's fees are valued as CC (Canton Coin), its only CCIP fee token with a known identity, at CC's 10 decimals.
  - For a coin DefiLlama has no history for, the fee backfill uses CoinGecko's free public daily history (at most 365
    days back; credit: CoinGecko). Today that applies to Mova's MOVA, whose price data ends 2026-09-07 when it was
    delisted; later Mova fees stay unpriced. The live Worker uses DefiLlama only.
  - A fee of 0 and a fee paid in one of four test "LINK" tokens (total supply 100, not LINK; two on Ethereum and two
    on Morph) count as $0.
  - A fee paid before its token first traded is valued at the token's first market price: Pharos, Monad, 0G and
    Plasma. Sonic uses FTM's price on that day instead, since FTM converted 1:1 into S. Fees after a token's first price
    are never filled this way.
  - BTC-backed gas tokens (WBTCN on Corn, PBTC on Botanix) are valued as BTC.
  - Fee tokens of chains that have left the CCIP docs (such as Mind and Everclear) were identified from the docs' git
    history, and their decimals read on chain where the chain still answers.
  - A few fees still have no free price: Mova fees after 2026-09-07 and about 8 fees whose token can't be identified
    (one on Tron, Base zunETH and one rarely used Canton token). They are left out of the fee totals.
- **Fees paid in LINK:** the part of a day's fees whose fee token is LINK. That is LINK in CCIP's LINK token group
  (LINK on the chains where it moves through CCIP), plus LINK on the 14 chains where LINK is a fee token but is not
  in that group: OP, BNB Chain, Gnosis, Polygon, Arbitrum, Avalanche, Cronos zkEVM, Bittensor EVM, HyperEVM, Kaia,
  Hedera, Etherlink, Nexon Henesys and Memento. Available for every day that has fees.
- **Fee groups:** each fee counts in one of four groups, by its fee token.
  - **LINK:** the LINK tokens above.
  - **Gas tokens:** a chain's gas token or its wrapped form, such as WETH, WBNB, WPOL, WAVAX, wSOL, WHYPE, APT, CC and GRAM.
  - **Stablecoins:** GHO, pathUSD and other USD stablecoins, plus gas tokens that are stablecoins: USDT0 and gUSDT on Stable, xDAI on Gnosis, GHO on Lens and USDC on Arc.
  - **Other:** every other fee token, such as the test tokens above and the few tokens that can't be identified. Other is a day's fees minus the three groups above.

  A token's group comes from the CCIP docs: each chain's listed fee tokens, grouped by symbol (a fixed list of stablecoin
  symbols; every other symbol is a gas token). Fee tokens the API reports that the docs list under another address, or not
  at all, were checked on chain and added by hand. A token in the wrong group would move USD between groups, but never
  changes total fees.
- **LINK paid:** each LINK fee's amount, `amount / 10^decimals`, counted whether or not the fee has a USD price. The
  decimals come from the CCIP token registry, are 18 for Ethereum LINK, and were read on chain for the 13 chains above.
- **All-time fees** (home page): every day in history plus today so far, from the first day with fees. Until fee data
  reaches back to 2023-07-06, the line reads "Fees since <day>" instead of "All-time fees".
- **Run-rate:** the fees of the last 30 complete days × 365 / 30. It is shown once all 30 of those days have fees.
- **Fee rankings** (Top pages, "Fees"): lanes, senders and source chains ranked by the fees their messages paid in the
  window, largest first, with value moved breaking ties. One with no fee data in the window is left out. Tokens have no
  fee ranking: a fee is paid per message and is not split across a message's tokens. On a fee ranking, Share is of the
  fees of the top 100.
- **Typical fee** (Flow and Top lanes): the median of a route's priced fees over the last 30 complete UTC days, with
  the range from the 10th to the 90th percentile. Percentiles use the nearest rank: of a route's n fees in ascending
  order, the p-th percentile is the fee at rank ⌈p × n / 100⌉. A route needs at least 5 priced fees in the window. When
  at least 20 of them were paid in LINK, the LINK fees and the other fees (gas tokens, plus the few paid in stablecoins
  or other tokens) each get their own median. The figures come from `cost.json`, rebuilt at each finalize run (00:10 and 06:00 UTC).
- **Take rate** (day pages and History): a day's fees as basis points of the value its messages moved,
  `fee_usd / usd_value × 10,000`; one basis point is 0.01%. A day without fee data, without fees or without value
  moved has none. It is not a profit margin: it compares what senders paid in fees with the value their messages carried.
- **Fee per message** (day pages): a day's fees divided by its messages, data-only messages included. Messages whose fee has no price still count in the divisor, so
  fee per message reads low on routes like Ronin.
- **Delivery time:** receipt minus send, for `SUCCESS` messages. The median is reported per day.

## Coverage
History starts on **2023-07-06**. This is the first CCIP mainnet message (2023-07-06 22:34:59 UTC). All-time
figures are labeled "since 2023-07-06".

How the history was collected:
- The API's unfiltered message list cannot be crawled back to the start. The January 2026 depth wall was the Sui
  poison message (2026-01-15 01:28:06 UTC). The unfiltered list's 30-second timeouts also start somewhere between
  September and December 2025. History is therefore crawled one source chain at a time, using the API's
  `sourceChainSelector` filter, which avoids both.
- All 95 source chains were crawled to their first message, and none stopped early. The source list is the CCIP chain
  registry plus every chain seen in a message, so chains that only receive were checked as well.
- Three list pages fail with HTTP 500 whenever they contain one particular message. The crawler skipped past each
  such message and recorded the window after it. For each window, every lane was then queried to the window's end:
  no message other than the skipped one is missing. The skipped messages are not counted.

| Source chain | Send time (UTC) | Message id | Window checked to |
|---|---|---|---|
| sui-mainnet | 2026-01-15 01:28:06 | `0xc8cc7f57a25e6e96e6be7bcd606a1a8d59d85d757d08e7e045e87a8cfe0bcbc7` | 2026-01-15 07:08:08 |
| aptos-mainnet | 2025-09-01 15:51:44 | `0xb3a18e5747c5083dc41b3e751482a2d0b30f62379f5d863df937b70edb175212` | 2025-09-02 02:30:29 |
| aptos-mainnet | 2025-09-01 14:43:49 | `0xb3a18e5747c5083dc41b3e751482a2d0b30f62379f5d863df937b70edb175212` | 2025-09-01 15:19:01 |

The two Aptos records share a message id but have different send times, so both are listed. The detail endpoint
returns 404 for the Sui message.

Days with no messages (2023-08-03 to 2023-08-06 and 2023-08-31) have no row in `history.json`.

Live ingest started on 2026-10-05. For that day, the API lists exactly 2,487 mainnet messages, and their ids match
the stored ids one for one.

## Known limitations
- Before 2026-10-05, a message carrying more than one token counts only its first token, because the list endpoint
  exposes one token per message. Since 2026-10-05, none of 2,360 token-carrying messages has carried more than one
  token, so the effect is expected to be small.
- Live data and history use different price methods (latest versus daily), so their values can differ slightly.
- History's group fallback (step 2) uses today's CCIP token registry. A token that has since left the registry has
  no sibling fallback in history.
- Our cumulative value is 7.2% below Chainlink's official figure (see the Chainlink metrics table below). The gap was
  already there by 2026-05, and recent months match within 0.7%, so it comes from older history. Its causes are not
  yet measured. Candidates are multi-token messages before 2026-10-05, unpriced long-tail tokens, and Chainlink's
  own outlier handling.
- History statuses are as of crawl time, so a message still in flight when crawled keeps that status. Live messages
  update until final.
- Some tokens are not in CCIP's public token list. They are priced and named from DefiLlama where it knows them;
  otherwise they show only their address.
- The CCIP API publishes no rate limits or terms. We keep to 1 request per second per job and credit the source in
  every file.

## Data sources
All data sources are free:
- **CCIP API** (`api.ccip.chain.link/v2`): messages, chains and the token registry.
- **DefiLlama coins API**: latest and daily token prices, with no API key.
- **CoinGecko public API**: coin-id mapping, and the fee backfill's daily price history for a coin DefiLlama has none for (MOVA), with no API key.
- **Public Ethereum RPC endpoints** (keyless, e.g. rpc.mevblocker.io and 0xrpc.io): the Reserve's LINK balance and
  transfer logs.
- **Chainlist** (`chainlist.org/rpcs.json`, from DefiLlama/chainlist): the source of the keyless RPC and Blockscout
  endpoint lists in `config/endpoints.json`. Only the data is used. Every entry is checked live before it is written.

### Using this data
The numbers on ccip.dev, and the JSON files behind them at `https://data.ccip.dev/v1/`, are free to use with credit: "Source: ccip.dev".
- **Freshness:** the files update every few minutes, so fetch each at most once a minute.
- **Limits:** requests to `/v1/` are rate-limited per IP.

## Chainlink Reserve
- **Balance:** read every hour with `balanceOf` on the LINK token for the Reserve, `0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6`.
- **Transfers:** every LINK `Transfer` into or out of the Reserve since its first transfer (block 23,039,541,
  2025-07-31). They come from Ethereum logs through free public RPC endpoints, 12 blocks behind the chain head.
  Each run checks that transfers in minus transfers out equal the balance at the last block scanned, and alerts if
  they differ.
- **Price at transfer:** DefiLlama's LINK price at the transfer's block time, within 10 minutes. This is the market
  price when the LINK arrived, not the price Chainlink paid for it.
- **Cost basis:** every inbound transfer at its own time price, minus every outbound transfer at its own time price.
  **Value now** is the net LINK at DefiLlama's current price. A transfer DefiLlama has not priced yet counts as $0 in the USD totals (cost basis and weekly USD) until it is priced, which is retried every hour; `cost_basis.unpriced_transfers` says how many are waiting.
- **Deposits:** inbound transfers of at least 1,000 LINK. Smaller inbound transfers (a 1-LINK test and gifts of up
  to 7 LINK) count toward the balance and the cost basis, but not toward pace, weekly deposits or performance.
- **Weekly:** UTC weeks starting Monday. The weekly USD is the deposit-time value of the LINK deposited, not
  Chainlink's revenue.
- **LINK demand:** LINK paid in fees is the LINK amount of each day's LINK fees (see Fees). The weekly fee mix, and the
  weekly fees beside the Reserve's deposits, use the same Monday UTC weeks as the weekly deposits, and leave out any week
  that fee data covers only in part. Fees and deposits are shown side by side only: the Reserve does not publish which
  revenue each deposit came from.
- **Pace:** the 4-week figures average the last four complete weeks. The milestone date assumes that pace continues.
- **Cadence:** the average gap between deposits; the next deposit is expected at the last deposit plus the median gap, and is flagged overdue 24 hours after that; the streak counts consecutive deposits no more than 8 days apart.

## Cross-check
@CCIPMetrics posts its "#CCIP today" totals just after midnight UTC. Each post is dated the day it is posted and
covers the previous UTC day: on every day below, its transaction count equals our message count for the previous
UTC day. Chainlink's metrics site (metrics.chain.link) publishes only a monthly cumulative CCIP volume, with no daily
figures, so it is compared by month in a separate table.

| Day (UTC) | ccip.dev messages | ccip.dev USD | CCIPMetrics messages | CCIPMetrics USD | Gap and reason |
|---|---|---|---|---|---|
| 2026-10-05 | 2,487 | 22,954,922 | 2,488 | 22,921,006.7 | Messages −1: the API lists exactly 2,487 mainnet messages for the day, matching our ids one for one. USD +0.15% after the 2026-10-07 finalize re-valued the 101 messages first valued before the pricing fallbacks were deployed (24 remain unpriced). Fees: ours $1,245.29, CCIPMetrics $1,252.4 (−0.57%). |
| 2026-10-04 | 1,121 | 17,405,830 | 1,121 | 17,335,113.8 | +0.41% |
| 2026-10-03 | 1,178 | 50,942,816 | 1,178 | 51,231,459.2 | −0.56% |
| 2026-10-02 | 1,977 | 74,446,837 | 1,977 | 74,349,254.0 | +0.13% |
| 2026-10-01 | 2,158 | 49,675,344 | 2,158 | 50,029,455.9 | −0.71% |
| 2026-09-27 | 1,031 | 14,521,483 | 1,031 | 13,512,588.1 | +7.47%. Without PRIME on Tempo ($906,683): +0.76% |
| 2026-09-26 | 1,083 | 12,213,602 | 1,083 | 10,004,805.9 | +22.08%. Without PRIME on Tempo ($2,113,332): +0.95% |
| 2026-09-25 | 1,889 | 40,894,816 | 1,889 | 39,809,129.0 | +2.73%. Without PRIME on Tempo ($904,538): +0.46% |
| 2026-09-24 | 2,309 | 41,650,681 | 2,309 | 38,846,952.5 | +7.22%. Without PRIME on Tempo ($2,709,166): +0.24% |

Notes on the table:
- **2026-10-01 to 10-05:** the CCIPMetrics posts were read on x.com:
  [10-05](https://x.com/CCIPMetrics/status/2107271553108889920), [10-04](https://x.com/CCIPMetrics/status/2106920365444243678),
  [10-03](https://x.com/CCIPMetrics/status/2106539357058552250), [10-02](https://x.com/CCIPMetrics/status/2106179892316663896),
  [10-01](https://x.com/CCIPMetrics/status/2105817691827134751).
- **2026-09-24 to 09-27:** these figures come from search-engine copies of the posts, not from the posts themselves.
- **PRIME on Tempo:** token `0x20c00000000000000000000058d0b8b2cfdb358c`. It is not in CCIP's token list, and
  DefiLlama prices it at about $1.06. Until late September, CCIPMetrics appears to have valued it at $0. With it
  excluded, those days match within 1%. From 2026-10-01 our totals match CCIPMetrics with PRIME included.

| Month | ccip.dev month USD | Chainlink month USD | Gap |
|---|---|---|---|
| 2026-06 | 1,095,606,149 | 1,130,622,176 | −3.10% |
| 2026-07 | 1,319,783,375 | 1,327,119,940 | −0.55% |
| 2026-08 | 1,221,665,054 | 1,213,506,818 | +0.67% |
| Cumulative to 2026-08-31 | 22,381,511,846 | 24,117,366,970 | −7.20% (see Known limitations) |

Chainlink's figures come from https://metrics.chain.link/api/metrics/latest (`ccipVolume`, generated 2026-09-25).
That page notes that "some outliers and anomalous data have been removed".
