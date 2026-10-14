# ccip.dev: who sends on CCIP (sender attribution, projects and coverage)

**Status:** Draft for owner review · **Date:** 2026-10-14

On 2026-10-13 the daily named `A8JP…in3u · 149 messages` as the top sender. CCIPMetrics named `@xStocksFi · 319 messages (20.3%)`. Both were right about xStocks, but we counted it wrong:
- **We rank senders per source chain and address,** so xStocks's xBridge (one address on nine EVM chains) was split five ways that day. The biggest piece had 81 messages, behind its own Solana sender's 149.
- **xStocks had no label.** The weekly label-candidates job missed it for two reasons:
  - it skips wallet-like senders, and xStocks's Solana sender is a system-owned account;
  - it keeps only the top 200 (chain, address) pairs by dollar value, and xStocks's messages carry no tokens.

The xStocks label shipped on 2026-10-14 (9efc861), verified from xStocks's public bridges API and a send transaction. This spec covers everything else the owner approved on 2026-10-14: the five fixes and seven additions.

## 1. Goal

Credit CCIP activity to the projects behind it, rank them fairly, make the coverage of our labels visible and improvable, and turn projects into first-class pages and stories.

**Owner decisions (2026-10-14):**
- Rank senders by project.
- Fix the candidates job's blind spots.
- Spread a label to the same address on other chains.
- Measure label coverage.
- Label xStocks (done).
- Add project pages, a share in the post, X handles, a "new on CCIP" moment, a data versus token split, "Suggest a label" and a coverage line on the status page.

**Mentions policy (owner decision 2026-10-12, still binding):** an automated post tags only its subject, because X's automation rules ban unsolicited @mentions. The daily's top sender stays a plain name. A project is tagged with its verified `x` handle only in posts where it is the subject: the "new on CCIP" moment (§7) and the weekly project spotlight (§7).

## 2. Success criteria

- **Fair:** the top sender is the project, or the unlabeled address, with the most messages summed across all its labeled addresses and chains. On 2026-10-13 that is xStocks, with 319 messages (20.3%).
- **Honest about gaps:** every surface that ranks senders can say how much of the activity is labeled. The status page shows it.
- **Self-improving:** a project like xStocks shows up in the weekly candidates PR within a week of becoming significant, whether it is a wallet, carries no tokens, or is spread across chains.
- **No broken consumers:** the bot, the cards and the site keep working through the change. Older sender keys still resolve.

## 3. Identity: who a sender is

A message's **sender identity** is resolved from its source chain and sender address:
1. If the (chain, address) pair has a verified label, the identity is that **project**: `project:<slug>`, where slug is the label file's name, e.g. `xstocks`.
2. **Label spread (fix 3):** for an EVM address with no label on this chain, if the same address has a verified label on any other EVM chain, the identity is that project too, marked `inferred`.
   - It never spreads across chain families.
   - Solana and other non-EVM addresses never spread.
3. Otherwise the identity is the **address** across chains: `address:<normalized address>` (EVM lowercased; others as-is). The same EVM address on several chains is one identity.

This lives in one place: `packages/core`, beside `labelKey`, with the label index from `worker/src/generated/labels.json`. Every ranking consumer goes through it. The label build also emits a slug for each project, and the project's `x` and `kind`.

## 4. Ranking by identity (fix 1, extra 2)

**Storage is unchanged.** Ranking happens at publish time:
- `daily_breakdown` keeps `dim = 'sender'` rows keyed `<selector>:<address>`. The day's rollup, finalize and backfill are unchanged.
- A new store query sums sender rows over a window **grouped by address across chains** (`substr(key, instr(key, ':') + 1)`), plus the per-chain breakdown for the top N.
- A second query sums every **labeled** key exactly, so no project is truncated by a LIMIT before its addresses are merged.
- Merging in the Worker gives the identity totals: messages, usd, fee_usd, chains and address count.

**Consumers:**
- **`top/sender.json`:**
  - Entries become identities: `key` is `project:<slug>` or `address:<addr>`.
  - Added fields: `label`, `x` (verified projects only), `kind`, `inferred`, `chains` (selectors), `addresses` (count), `share_pct` (share of all messages in the window).
  - The schema in `packages/core/src/public.ts` is updated, and a schema version bump is documented in the methodology.
- **`day-leaders.json` and the weekly leaders:** the daily and weekly top sender is the top identity by messages, with the same fields.
- **`today.json`** `top.sender`: the same, computed in memory from today's rows.
- **The daily and weekly copy (extra 2):**
  - X: `Top sender: xStocks · 319 messages (20%)`. Telegram: `Top sender: xStocks · 319 messages, 20% of the day's`.
  - The name is the label, or a short address.
  - No `@`, per the mentions policy.
- **The daily card's TOP SENDER cell:** the label or short address, `319 msgs · 20%`.
- **The site's Top › Senders:**
  - A row shows the project name with ✓ (or an "inferred" mark), its chains as small chain icons, and an address count for projects.
  - An unlabeled address shows its short address with its chains.
  - Rows link to the project page (§6) or to an explorer for addresses.
  - "Suggest a label" sits on unlabeled rows (§8).
- **`unique_senders` in `daily_totals`** keeps its meaning: distinct (chain, address) pairs. The methodology says so explicitly.

## 5. Data messages and token transfers (extra 5)

A message is a **data message** when its `token_count` is 0.
- A migration adds `daily_totals.data_messages INTEGER`. The rollup fills it at finalize, and `today.json` computes it live.
- The same migration backfills every day from `messages` (`token_count = 0`, grouped by day). The deploy workflow applies migrations, so no owner step is needed.
- Surfaces:
  - the daily card: a muted stat, "62% data";
  - `history.json` and the history page: a series and a tile;
  - the methodology: the definition.

## 6. Project pages (extra 1)

**`/projects/`** lists every verified project:
- name, kind and X handle link;
- 7-day messages and share;
- 30-day value;
- chains;
- sorted by 7-day messages.

**`/projects/<slug>/`** has one page per project:
- a header with the name, ✓, kind, website and X link;
- tiles: messages, value, fees and share, for the last 7 and 30 days;
- a 30-day messages chart;
- its chains (as source) and its top destination lanes;
- the data versus token split;
- its known addresses, each with its chain and an explorer link, and "inferred" ones marked;
- the label's source line;
- a share card at `/og/project/<slug>.png`.

**Data:** a new public file, `projects.json`, published at finalize in `publishHistoryFiles` before the site build. Per verified project it holds:
- totals for 7, 30 and all days;
- a 30-day daily messages series;
- source chains;
- the top 5 lanes over 30 days (from `messages`, joined on the project's (chain, address) pairs);
- the data and token message counts;
- its addresses.

The file is validated by a schema in `public.ts`. Pages are built statically with `getStaticPaths`, like the per-chain replay pages, and load through `buildDataIfPublished` while the file is new.

**Links in:** top-sender mentions on the site and cards link to the project page. Add "Projects" to the header menu and footer.

## 7. Stories (extras 3 and 4)

### "New on CCIP" moment
**When:** an identity that never sent a message before the last 30 days enters the day's top 10 senders by messages, with at least 20 messages that day. Its first-seen day comes from `MIN(day)` over its (chain, address) pairs in `messages`.
- An `arrivals` row of kind `sender`, via a migration that widens the CHECK, records it once.
- The moment follows the existing moment pipeline (planning budget, card, copy).

**Copy:** "New on #CCIP: xStocks sent 319 messages in its first week…". The subject is tagged with `@x` only when the project is labeled, verified and has a handle. An unlabeled address is named by its short address, and its candidate is fast-tracked into the next candidates PR.

### Weekly project spotlight
**When:** in the weekly moments slot, the labeled project with the largest week-over-week growth in messages, at least 50 messages this week.

**Copy:** what it does (from `kind`), its chains and its numbers. The subject is tagged with its verified handle.

## 8. Label coverage and growth (fixes 2 and 4, extras 6 and 7)

**Coverage (fix 4, extra 7):**
- Finalize computes the share of the last 7 days' messages, value and fees that came from labeled identities (verified plus inferred).
- `status.json` gains `label_coverage: { messages_pct, usd_pct, fees_pct, window: '7d' }`.
- The status page shows a line: "Labeled senders: 81% of messages, 94% of value (last 7 days)", linking to `/projects/`.
- The weekly candidates PR body leads with the same numbers and their change from last week.

**The candidates job (fix 2):** `scripts/label-candidates.ts` changes:
- **Rank by identity** (address across chains), by messages **and** by value. Take the top 100 of each, deduplicated.
- **Keep busy wallets.** A wallet sending at least 100 messages in 7 days is an operator, not a user, so it stays a candidate.
- **Explain Solana senders.** For a system-owned Solana sender, read one send transaction and record which program it invoked ("sends via program F2ZY…"). That's how xStocks was confirmed.
- **Pair detection.** Flag two candidates that message each other ("pairs with 0x9eC0…").
- **New columns:** chains, messages, value, data share, and pair/program hints.
- **Label spread report.** List labeled EVM addresses whose spread (§3) attributed activity on other chains this week, so the owner can confirm or block it.

**Blocking a spread:** a label file can set `spread = false` to turn spreading off for that project.

**Suggest a label (extra 6):**
- Unlabeled rows on Top › Senders, and unlabeled top senders on day pages, get a "Suggest a label" link.
- It opens a prefilled GitHub issue (`.github/ISSUE_TEMPLATE/label.yml`: chain, address, project name, X handle, source URL).
- The runbook says how to turn an issue into a label file.

## 9. Testing

- **Core:**
  - identity resolution: a label, a spread across EVM chains, no spread to non-EVM chains, `spread = false`, and the address fallback;
  - ranking merges: the 2026-10-13 xStocks case from fixture rows gives 319 messages and 20.3%;
  - the coverage maths;
  - the "new on CCIP" selection;
  - the spotlight selection.
- **Worker:**
  - the store queries return exact project sums with no LIMIT truncation;
  - publish writes the new fields and files, validated by their schemas;
  - the migration backfill counts data messages;
  - the copy with share percentages and the subject-only tagging (the existing "tags nobody" test still holds for the daily);
  - the moment planning.
- **Site:**
  - Top › Senders rows (project, inferred, address, suggest link);
  - the project pages build from a fixture;
  - the status coverage line;
  - the card cells.
- **Script:** the candidates query by identity and messages, busy wallets kept, the Solana program hint, and pair detection, with fixtures.

## 10. Shipping

- **Migrations:** `data_messages` with its backfill, and the `arrivals` kind `sender`.
- **Ordering:** the Worker ships first, publishing the new fields while keeping the old ones, then the site. Old keys in cached files still render.
- **No owner step.**

## 11. Out of scope

- Re-keying `daily_breakdown`.
- Tagging projects outside posts where they are the subject.
- Automatic labels without a public source. A spread label is inferred from a verified one and reported, never invented.
- An LLM research step in the candidates job.
