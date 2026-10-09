# ccip.dev: who pays and what it costs

**Status:** Draft for owner review · **Date:** 2026-10-09

This is the second of three fee sub-projects:
- The first, fee revenue (`2026-10-09-fee-revenue-design.md`), shipped on 2026-10-09.
- The third, broadcasts (report cards, Telegram posts and the replay fee counter), is in the backlog.

The design was approved in conversation on 2026-10-09.

## 1. Context and goal

Fees already appear in some places:
- the home hero;
- Records;
- Reserve's LINK demand section;
- a Fees column on the Top pages;
- a Fees tile on day pages.

Four questions remain unanswered:
1. **Who pays CCIP the most?** The Top lists rank by value moved, so a big fee payer that moves little value never makes the top 100, and chains aren't ranked at all.
2. **What does a CCIP message cost on a given route?**
3. **How much of a day's fees were paid in LINK, and in what mix?** Each day page should say.
4. **What does CCIP earn on the value it moves?** This is the take rate.

**Owner decisions (2026-10-09):**
- **Cost to send:** a picker on the Flow page, giving each route's typical fee over the last 30 days. Each route has a shareable link, and Top lanes gains a "Typical fee" column.
- **Fee rankings:** a "Value | Fees" switch on the Top pages, each ranking at its own address, plus a new Chains tab that ranks source chains.
- **Fee basis:** always the overall typical fee. Show LINK against gas tokens only when a route had at least 20 LINK-paid messages in the window.

## 2. Success criteria

1. **Flow picker:**
   - Choosing From and To shows the median fee, the 10th–90th percentile range and the message count for the last 30 days. It adds LINK and gas-token medians when the route qualifies.
   - `/flow/<window>/?from=<chain>&to=<chain>` opens with that route selected.
   - A route without enough data says so.
2. **Fee rankings:**
   - `/top/{lane,sender,chain}/{7d,30d,all}/fees/` list the top 100 by fees, each with its own share card. Tokens have no fees ranking: a message's fee is not split across its tokens, so token rows never carry fees.
   - The value pages stay at their current addresses, and the Chains tab exists for both rankings.
3. **Top lanes:** a "Typical fee (30d)" column.
4. **Day pages:**
   - The Fees tile reads "$X per message · Y% paid in LINK".
   - A Take rate tile.
   - A fee-mix bar when the day has group data.
5. **History:** a Take rate chart, with daily basis points.
6. **No new data sources and no migration.** The fee backfill is unchanged.
7. **Budgets hold:** home JavaScript stays ≤ 150 KB gzipped and Flow's within the site's existing budget checks. Lighthouse mobile accessibility stays ≥ 95. There is no horizontal scroll at 390 px.

## 3. Scope

**In scope:**
- the Worker's publish changes: fee-ranked top lists and `cost.json`;
- the public schema;
- the site changes on Flow, Top, day pages and History;
- methodology updates.

**Out of scope:**
- report cards, Telegram posts and the replay fee counter (sub-project 3);
- per-sender cost;
- any change to how fees are priced or stored.

## 4. Data

### 4.1 Fee-ranked top lists
- `store.topBetween` gains an `order: 'value' | 'fees'` argument.
  - **value:** today's `ORDER BY usd_value DESC, messages DESC`.
  - **fees:** `ORDER BY fee_usd DESC, usd_value DESC`, skipping keys whose `fee_usd` is null.
- **Publishing:** each `top/{dim}.json` except `token` keeps `windows` (by value) and gains `by_fees: { '7d', '30d', all }`, top 100 each, with the same entry fields.
- **Which files:** the dims published today are `src_chain`, `dst_chain`, `lane`, `token` and `sender`. The site uses `lane`, `token`, `sender`, and now `src_chain` for the Chains tab.
- **Schema:** `TopFileSchema` gains `by_fees` as optional, so the site still builds against an older file. A fees page with no `by_fees` data renders its empty state.

### 4.2 `cost.json`
- **When:** published in `publishHistoryFiles` (each finalize run), next to `history.json`.
- **Window:** the last 30 complete days (`today − 30 … yesterday`), over messages with `fee_usd IS NOT NULL`.
- **Query:** one D1 query per publish using window functions.
  - `ROW_NUMBER() OVER (PARTITION BY src_chain, dst_chain ORDER BY fee_usd)` and `COUNT(*) OVER (PARTITION BY src_chain, dst_chain)`.
  - It keeps only the rows at the 10th, 50th and 90th percentile ranks (nearest-rank).
  - It returns a few rows per route, so no message rows pass through the Worker.
  - The same is done for LINK-paid and gas-token-paid fees, splitting on the LINK fee-token list (`store.linkFeeTokens`). The list is inlined into the SQL as sanitized literals, because D1 caps bound parameters.
- **Shape:** `{ from: day, to: day, lanes: [{ src, dst, messages, median_usd, p10_usd, p90_usd, link?: { messages, median_usd }, gas?: { messages, median_usd } }] }`.
  - `src` and `dst` are chain selectors.
  - The `link` and `gas` fields appear only when the route had at least 20 LINK-paid messages in the window. `gas` is every non-LINK fee.
- **Thresholds:** routes with fewer than 5 priced fees are left out. Constants: `COST_WINDOW_DAYS = 30`, `COST_MIN_MESSAGES = 5`, `COST_LINK_MIN_MESSAGES = 20`.
- **Schema:** a new `CostFileSchema` in `packages/core/src/public.ts`, and `cost.json` joins the public file names. Each route comes back from SQL as one row. USD values keep four decimals, because typical fees are well under a dollar.
- **Before the first publish:** `cost.json` is a new file, so the site build reads it with a helper that returns null on HTTP 404 only. The Top lanes column then shows "—" and the picker says the data isn't available yet.
- **Cost of the query:** about 300k rows scanned twice a day, through the `messages_day` index. A failure alerts as `cost-publish` and doesn't stop the other history files, the same pattern as `replay.json`.

### 4.3 Computed in the browser
- **Take rate:** a day's `fee_usd / usd_value × 10,000`, in basis points. It is null when either value is null or zero. Typical days are under 1 bps, so it shows two decimals below 1 bps. Fees under a cent show as "<$0.01".
- **Fee per message:** `fee_usd / messages`.
- **Day LINK share:** `fee_link_usd / fee_usd`.
- **Day fee mix:** from the group columns in `history.json`. "Other" is clamped at 0, as on Reserve.

## 5. Site

### 5.1 Flow: the cost picker
- **Component:** `CostPicker`, a React island on `/flow/<window>/`, below the page head. It is titled "What does a message cost?".
- **Selects:** From lists the source chains that appear in `cost.json`. To lists only the destinations with data for the chosen source. Names and icons come from the chain map.
- **Output:**
  - **Typical fee:** the median, in large type.
  - **Range:** "most between $p10 and $p90".
  - **Basis:** "based on N messages, <from>–<to>".
  - **Split**, when present: "Paid in LINK: $X · in gas tokens: $Y".
- **URL:**
  - `?from=<chain name>&to=<chain name>` updates with `history.replaceState` as the selection changes, and is read on load.
  - Unknown names fall back to the default: the route with the most messages.
  - A known route that's missing from `cost.json` shows "Not enough messages in the last 30 days to say."
- **Data:** it fetches `cost.json` with `fetchPublic` on load, and shows a skeleton until it arrives. It loads only on Flow pages.

### 5.2 Top pages
- **Routes:** `getStaticPaths` adds an `order` dimension. Value stays at `/top/{dim}/{window}/`, and fees is `/top/{dim}/{window}/fees/`. Both are static pages.
- **Switch:** a "Value | Fees" tab row sits next to the existing dimension and window tabs.
  - The fees page title and label read "by fees". Its description is "The 100 CCIP {dim}s that paid the most in fees, {scope}." Its table leads with the Fees column.
- **Chains tab:** `TOP_DIMS` gains `chain`, which reads `top/src_chain.json`. Its rows show the chain icon and name.
- **Share cards:** the OG card paths gain the fees variants, `/og/top/{dim}/{window}/fees.png`, using the same template with the fee ranking.
- **Top lanes:** a "Typical fee (30d)" column is filled from `cost.json` at build time (`buildData('cost.json')`), with "—" for lanes it doesn't list. It appears on value and fees pages for every window, and the header says "30d".

### 5.3 Day pages
- **Fees tile:** a sub-line, "$X per message · Y% paid in LINK". The LINK part appears only when `fee_link_usd` is known.
- **Take rate tile:** "N bps", with the sub-line "of value moved" and an info link to the methodology.
- **Fee-mix bar:** a thin horizontal stacked bar under the tiles with a legend, using the same colors and labels as Reserve's fee-mix chart. It appears only when the day has `fee_native_usd` and `fee_stable_usd`.

### 5.4 History
- A Take rate chart sits next to the fees chart: daily basis points, with the same ranges and style.
- Days without fees, or with zero value, are gaps.
- It has an `aria-label` summary like the other History charts.

### 5.5 Accessibility and layout
- Every new element works at 390 px. The picker's selects stack, the tab rows wrap, and the mix bar legend wraps.
- The selects have labels, and the picker result is announced through `aria-live="polite"`.

## 6. Docs
- **Methodology:** define the take rate, the typical fee (median over 30 days, the 10th–90th range, nearest-rank), the LINK and gas-token split threshold, and the fee rankings.
- **Runbook:** add the `cost-publish` alert.

## 7. Rollout
1. Implement and review. A push deploys the Worker and the site; no migration.
2. The next finalize publish writes `by_fees` and `cost.json`. Until then, the fees pages show their empty state and the picker says data is loading or not available. The site builds against the older files because the new fields are optional.

## 8. Testing
- **Worker:**
  - `cost.json` percentiles on a fixture with hand-computed nearest-rank values;
  - the 5-message cutoff and the 20-message LINK threshold;
  - the LINK and gas split against the LINK fee-token list;
  - the window bounds;
  - `topBetween` by fees, including null fees skipped;
  - `top/{dim}.json` carries `by_fees`;
  - a failure in the cost query alerts and still publishes `history.json`.
- **Core:** `TopFileSchema` and `CostFileSchema` parse files with and without the new fields.
- **Site:**
  - the picker with a URL route, an unknown name, a missing route and the default route;
  - the fees pages, the Chains tab and the fees share-card paths;
  - the Top lanes typical-fee column;
  - the day-page sub-line, take rate and mix bar, including old days without groups;
  - the History take-rate series, including gaps;
  - no 390 px overflow and the a11y checks on Flow, Top and a day page.

## 9. Risks

| Risk | Mitigation |
|---|---|
| The window-function query is slow on D1. | It uses the day index over 30 days, and is checked with `EXPLAIN QUERY PLAN` in the Worker test. A failure alerts and is skipped without blocking the other files. |
| Medians mislead on thin routes. | The 5-message cutoff, the shown message count, and the 20-message bar for the LINK split. |
| Adding the fees variant to every Top page doubles the page count. | About 24 more static pages and 24 cards, a small addition to the 1,300 pages built today. |
| The take rate reads as a profit margin. | The copy says "fees as basis points of value moved", and the methodology defines it. |
