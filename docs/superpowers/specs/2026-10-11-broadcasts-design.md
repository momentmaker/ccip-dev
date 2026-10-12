# ccip.dev: broadcasts (3a, the core)

**Status:** Draft for owner review · **Date:** 2026-10-11

Broadcasts are the backlog's fee sub-project 3, split into three projects:
- **3a, broadcast core (this spec):** the pipeline, four card types, copy and tagging, Telegram posting and X drafts.
- **3b, moments and community:** "Welcome to CCIP" arrivals, leaderboard movers, milestone countdowns, a weekly chain spotlight and a weekly Telegram prediction poll.
- **3c, monthly video:** the replay recorder run headlessly in GitHub Actions for last month, posted as a video.

3b and 3c build on 3a. The design was approved in conversation on 2026-10-11. The chosen card mockups are in `docs/superpowers/specs/assets/2026-10-11-broadcasts/`.

## 1. Goal

Every day, week, record and Reserve deposit becomes a well-designed image post:
- posted automatically to the Telegram channel `@ccipdev`;
- sent to the owner as a ready-to-paste X draft;
- built so an X API output can be added later with no other change.

Each post tags the projects and chains it features, so they reshare it.

**Owner decisions (2026-10-11):**
- **Approach:** a broadcast step inside the data Worker, run right after finalize publishes. The Reserve job does the same for deposits.
- **Finalize time:** 00:07 UTC, moved from 00:10.
- **Outputs:**
  - Telegram is automatic.
  - X goes out as drafts to the owner for now.
  - A later X API output (pay-as-you-go) is added as one more output.
- **Every post has an image. No post contains a link,** on X or Telegram.
- **Broadcast types:** daily report, weekly report (Mondays), record alerts and Reserve deposits.
- **Card style:** "C2 · Orbit hub" (§7): a deep-space sky with real lanes, chain coins cropped to circles, faint orbits around the hub, a stats glass panel and a bottom strip.
- **Bottom strip:**
  - The left half is the day's insight.
  - The right half is a rotating call to action, chosen by date.
  - "Be The Oracle" joins the rotation only after the game launches, behind a flag. For its first month it takes every other day.
- **Tags:**
  - Players are tagged with verified @handles: the top sender, the top token's project, and the chains behind the busiest lane and the top fee chain.
  - @handles stay in API posts too; the switch exists only as a safety valve.
  - @chainlink goes on records, milestones and Reserve deposits.
  - Daily and weekly posts carry `#CCIP #Chainlink $LINK`.
- The bot is already an admin of `@ccipdev`.

## 2. Success criteria

1. **Daily:** after the 00:07 UTC finalize, yesterday's daily broadcast reaches every enabled output once, with a 1200×675 card. In `drafts` mode it goes to the owner only.
2. **Weekly:** on Mondays, a weekly broadcast for the Monday–Sunday week that just ended.
3. **Records:** a record alert for each record or milestone a newly finalized live day sets. Backfill, rewinds and the first run never post old records.
4. **Reserve:** a Reserve broadcast for each new deposit, once.
5. **No duplicates:** no broadcast is posted twice, whatever re-runs, retries or rewinds happen.
6. **X text:** at most 280 characters, never contains a URL, and the headline numbers always survive.
7. **Telegram captions:** at most 1,024 characters, valid HTML, with names in place of @handles.
8. **Tags:** only verified handles are used; anything unverified appears as a plain name.
9. **Images:** cards render from public data only, so any card can be re-rendered later. If a card fails to render, nothing is posted.
10. **No new data sources and no paid services.** Telegram's Bot API and the existing renderer cover everything.

## 3. Scope

**In scope:**
- the finalize cron move;
- the broadcast pipeline, dedup and mode;
- facts for the four broadcast types;
- record detection, using record logic shared with the site;
- token → project and chain → handle tables in `labels/`;
- copy for X and Telegram;
- four card renderers in the site's card Worker;
- the Telegram channel output and the owner X-draft output;
- docs.

**Out of scope:**
- everything in 3b and 3c;
- the X API output itself (only its interface is built here);
- Be The Oracle and username onboarding (a separate project; only the call-to-action flag is reserved here).

## 4. Pipeline

### 4.1 Timing
- The early finalize cron moves to `7 0 * * *`.
- Every "00:10" in the code comments, the runbook and the methodology becomes "00:07".
- The upload tool's finalize window (23:55–00:30) is unchanged; it already covers 00:07.

### 4.2 Where broadcasts run
- **Finalize (early run):**
  1. after `publishHistoryFiles` succeeds and the site build is triggered, `runBroadcasts(c, { kind: 'finalize', days })` runs;
  2. it builds the daily broadcast for yesterday, if yesterday is among the finalized days;
  3. it builds the weekly broadcast if yesterday is a Sunday (UTC);
  4. it builds the record broadcasts for the finalized days, live days only.
- **The late 06:00 run never broadcasts.**
- **Reserve job:** when it records a new inbound **deposit** (the same definition `reserveStats` counts as deposits), it first publishes `reserve.json`, then runs `runBroadcasts(c, { kind: 'reserve', tx })`.

### 4.3 Dedup
- Each broadcast has a key in D1 `meta`:
  - `broadcast:daily:<day>`
  - `broadcast:weekly:<monday>`
  - `broadcast:record:<kind>:<day>`
  - `broadcast:milestone:<metric>:<threshold>`
  - `broadcast:reserve:<tx>`
- The key is claimed atomically before sending, the same claim pattern alerts use.
- If every enabled output fails, the claim is released, so the next run retries. If at least one succeeds, it is kept.
- **First run:** without `meta.broadcast:records:seeded`, the step marks every current record and passed milestone as announced, without posting, then sets the seed key.

### 4.4 Mode
- `BROADCASTS` (a Worker var) is `off`, `drafts` or `on`. The default is `off`.
  - **drafts:** only the owner-draft output receives broadcasts.
  - **on:** all enabled outputs.
- **Other settings:**
  - `TELEGRAM_CHANNEL_ID` (a var, `@ccipdev`).
  - `TELEGRAM_DRAFTS_CHAT_ID` (optional; it defaults to `TELEGRAM_ALERT_CHAT_ID`).

## 5. Broadcast content

### 5.1 Facts
Facts are computed in the Worker from D1 (the authoritative, just-finalized data). The cards read the same facts back from public files.
- **Daily (day D):**
  - messages, value moved and fees, each with its percent change against the mean of the 7 days before D;
  - fees paid in LINK (USD and the LINK amount) and its share;
  - **top token** by value (`daily_breakdown` dim `token`, with its symbol and project);
  - **top sender** by messages (dim `sender`, with its label);
  - **busiest lane** by value (dim `lane`);
  - **top fee chain** (dim `src_chain` by `fee_usd`);
  - any record D set (it shows as a badge on the card).
- **Weekly (Mon–Sun):**
  - totals against the previous week;
  - fees by day (7 values);
  - LINK share;
  - the top 3 fee chains, top token, top sender and busiest lane over the week.
- **Record:**
  - **Kinds:**
    - most messages in a day, most value in a day, most fees in a day;
    - largest single fee;
    - highest LINK share in a day, among days with at least 100 messages;
    - milestones: all-time fees, messages and value crossing the thresholds the Records page uses.
  - **Shared logic:** the record and milestone logic moves from `site/src/lib/records.ts` into `packages/core/src/records.ts`. The site and the Worker both use it, so they always agree.
  - **Each record broadcast carries:** the new value, the previous value and its day, how many days it stood, and what drove it. For fees, that is the top fee lane and its message count; for messages and value, the busiest lane; for the largest fee, its route and token.
- **Reserve:**
  - the deposit in LINK, its USD at deposit and its value today;
  - the new balance;
  - the weekly deposit streak;
  - the 4-week average;
  - the projection to the next milestone (from `reserveStats.pace`);
  - LINK added per week for the last 11 weeks.

### 5.2 Tagging data (`labels/`)
- **Senders:** the existing `labels/projects/*.toml` handles (51 today).
- **New: token → project.**
  - A project TOML gains `[[tokens]]` entries (`chain`, `address`), each with a `source` URL.
  - A token matches by its CCIP registry token group, so one entry covers every chain the token moves on.
- **New: chain → handle.** `labels/chain-x.json` maps a chain name to `{ x, source }`.
- **Verification:**
  - Every handle needs a `source`: the project's or chain's own website or docs, linking to the account.
  - The weekly `label-candidates` research job proposes token and chain handles alongside senders, for owner review in its pull request.
- **Fallback:** a player without a verified handle is written as its plain name.

### 5.3 Copy
No copy contains a URL.

- **X, daily:**
  ```
  #CCIP · Sat, Oct 11
  1,313 messages · $17.1M moved
  $739 in fees · 0.5% paid in $LINK
  Top token: $syrupUSDC @maplefinance · $6.1M (35%)
  Top sender: @xStocksFi · 97 messages
  Busiest lane: @ethereum → @arc · $5.2M
  #Chainlink
  ```
- **X, weekly:** the same shape, with "this week" and ▲/▼ against last week, plus `Top fee chains: @base · @BNBCHAIN · @ethereum`.
- **X, record:**
  ```
  🚨 New all-time high for #CCIP: $57.3K in fees in one day
  Previous record: $47.8K (Mar 1), held for 130 days
  Driven by @ADIChain → @ethereum · 5,712 messages
  @chainlink $LINK
  ```
- **X, Reserve:**
  ```
  The Chainlink Reserve just added 82,480 $LINK ($1.03M)
  Now 6.20M LINK · 62 weekly deposits in a row · on pace for 7M around Dec 16
  @chainlink #CCIP
  ```
- **X over 280 characters,** counted the way X counts. Lines drop in this order until it fits:
  1. busiest lane;
  2. top sender;
  3. top token;
  4. the closing hashtag.

  The headline numbers never drop.
- **Telegram:**
  - The same facts, more fully worded, as HTML (`<b>` and line breaks), with names in place of @handles (e.g. "syrupUSDC (Maple)").
  - Escaped, at most 1,024 characters.
- **Numbers:** formatted with the site's formatters (`formatUsd`, `formatCount`, `formatFee`, `formatShare`), so posts and site always match.

## 6. Outputs

- **Interface:** `interface BroadcastOutput { name: string; send(b: Broadcast): Promise<'sent' | 'failed'> }`. A `Broadcast` is `{ key, kind, imageUrl, facts, xText, telegramHtml }`.
- **Telegram channel:**
  - `sendPhoto` to `TELEGRAM_CHANNEL_ID` with `photo` = the card URL and `caption` = `telegramHtml` (`parse_mode: HTML`).
  - On a `429`, it retries once after Telegram's `retry_after`, capped at 30 s.
- **Owner X draft:** `sendPhoto` to the drafts chat with the same image and caption = `xText`. Telegram's 1,024 limit easily fits X's 280.
- **Later, X API:** a new output that uploads the image and creates the post. Its tag switch is `X_KEEP_HANDLES` (default `true`). It is not built in 3a.
- **Failures:**
  - Each output's failure sends one alert, `broadcast-<output>:<key>`.
  - One failure doesn't stop the other outputs.
- **Image first:** before any output runs, the step requests the card URL (a `GET`, with a timeout).
  - A non-200 response or a timeout means no post, and an alert `broadcast-image:<key>`. The dedup claim is released.
  - This also warms Cloudflare's cache before Telegram fetches the image.

## 7. Cards

### 7.1 Routes and size
- **Routes** (in the site's card Worker):
  - `/og/broadcast/daily/<day>.png`
  - `/og/broadcast/weekly/<monday>.png`
  - `/og/broadcast/record/<kind>/<day>.png`
  - `/og/broadcast/milestone/<metric>/<threshold>.png`
  - `/og/broadcast/reserve/<tx>.png`
- **Validation:** `parseCardPath` and `cardPathOf` accept and round-trip them. Unknown kinds answer 404.
- **Size:** 1200×675. `renderPng` gains a size argument, and the other cards stay 1200×630.
- **Data:** cards read only published files: `history.json`, `replay.json`, `top/*.json`, `reserve.json` and `chains.json`.
  - The daily and weekly lane skies come from `replay.json` `days[].lanes`.
  - The top token, top sender and top fee chain for a day come from a new small per-day file, §7.4.

### 7.2 The C2 orbit-hub style
- **Background:** `#070a10`, with two radial nebula glows (blue `#1d3b8a` at the upper right, violet `#5b2a86` at the lower right) and about 170 stars of seeded random size and opacity.
- **Sky:**
  - The day's or week's top chains by value (up to 11) are coins sized by √value, placed on a fixed layout around the **hub** (the chain with the most value).
  - Faint dashed orbit rings circle the hub.
  - The top lanes by value are gradient arcs, `#4a7ff0`→`#7de3ff` or `#7a5cff`→`#4a7ff0`, thickened by value.
  - Coins at least 22 px across get a name label.
- **Coins:** the chain icon from `site/public/chains/<name>.svg`, embedded as a data URI.
  - It is scaled to fill and **clipped to a circle**, with a soft halo behind it and a thin white rim at 28% opacity.
  - A chain without an icon falls back to the site's lettermark coin.
- **Top bar:** `ccip.dev` (blue `#4a7ff0`, 800 weight) on the left, and an uppercase eyebrow with the broadcast name and date on the right.
- **Panel:** a glass panel at the left (`rgba(10,13,19,.8)`, border `#233047`, radius 22), with a 2×2 stat grid. Labels are uppercase tracked; values are mono, 800 weight; deltas are green `#7fd4a0` or red `#e58a8a`.
- **Bottom strip:** 64 px tall, with a gradient from `#13244d` to `#0f1a33`. The left half is the insight; the right half is the call to action ("▶ …").
- **Rotation:** the call to action rotates by UTC day number through a list:
  - replay;
  - cost picker;
  - top chains by fees;
  - records;
  - Reserve;
  - Be The Oracle, behind a flag that is off until launch.
- **Type-specific calls to action:** record cards point to records, and Reserve cards to the Reserve page.
- **Implementation:** the sky is one SVG string (stars, nebulas, rings, lanes, coins and clip paths) embedded as an image in the card tree. The renderer (Satori and resvg through `@cf-wasm/og`) handles SVG filters and clip paths inside images.

### 7.3 Per type
These follow the mockups in the assets folder.
- **Daily:**
  - The panel holds messages, value, fees and % paid in LINK, each with its delta against the 7-day average; LINK's sub-line is the LINK amount.
  - The strip's insight is the busiest lane, or "★ New record: …" when the day set one.
- **Weekly:**
  - The panel holds four week totals with ▲/▼ against last week, plus a 7-bar fees-by-day row.
  - The strip lists the top 3 fee chains.
- **Record:**
  - The sky is dimmed to 45%, with the chain that drove the record lit in gold.
  - A "★ NEW RECORD" pill, the eyebrow (e.g. "Most fees paid to CCIP in a day") and the value at 132 px.
  - "Previous record … · stood N days", and the driver line.
  - The strip shows the relevant all-time total.
- **Milestone:** the record layout, with "MILESTONE", the threshold value and the day it was crossed.
- **Reserve:**
  - "+82,480 LINK" on one line (the number at 104 px, LINK at 52 px), then USD at deposit and today with the percent change.
  - A stat row: LINK held · weeks in a row · next-milestone date.
  - The Chainlink hexagon mark (stroke `#375BD2`) glows at the right, with three inflow streams with comets, two dashed orbits, and an 11-week LINK-added bar chart below it.
  - The strip shows the 4-week average.

### 7.4 Per-day leaders file
- The Worker publishes `day-leaders.json`: for each of the last 400 days, the top token, top sender and top fee chain, each with its key, label or symbol and value.
- It is built from `daily_breakdown` at each finalize. Days whose top-N rows don't change are carried over.
- A schema is added to `packages/core/src/public.ts`, and a failure alerts as `day-leaders-publish`.
- The daily card, and day pages later, read it.

## 8. Docs
- **Runbook:**
  - "Broadcasts": the modes, how to test with `drafts`, the dedup keys and how to re-post one (delete its key), and the alerts.
  - The token and chain handle tables and how to verify a handle.
  - The 00:07 change.
- **Methodology:** a short "Broadcasts" note. Posts use the same numbers as the site, tags are verified handles, and records follow the Records page's rules.

## 9. Testing
- **Facts:** deltas against the 7-day average; weekly against the previous week; top token, sender, lane and fee chain from `daily_breakdown` fixtures.
- **Records:**
  - detection on a newly finalized day;
  - never for backfill days or rewinds;
  - first-run seeding posts nothing.
- **Dedup:** a re-run doesn't post again; a total failure releases the claim; a partial success keeps it.
- **Mode:** `drafts` reaches only the drafts output, and `off` sends nothing.
- **Copy:**
  - X stays within 280 characters, counted the way X counts (emoji count double);
  - lines drop in the defined order;
  - no URL anywhere;
  - Telegram stays within 1,024 characters and is escaped;
  - unverified handles become plain names.
- **Cards:** each card type renders at 1200×675 from fixture files, with coins clipped and the fallback lettermark; the routes round-trip.
- **Image first:** a 500 response or a timeout means no post and an alert.
- **Worker run:** with fake outputs, a finalize posts daily, weekly (on a Monday) and record broadcasts once each; a Reserve deposit posts once.

## 10. Rollout
1. **Handles:** a one-time research pass fills `chain-x.json` and the token entries for the projects behind the current top tokens. The owner reviews it in one pull request.
2. **Deploy with `BROADCASTS=drafts`.** The owner gets the real daily (and Monday's weekly) for a few days and checks images and copy.
3. **Switch to `BROADCASTS=on`.** The channel starts posting.

## 10a. Risks

| Risk | Mitigation |
|---|---|
| A wrong @handle tags the wrong project. | Every handle needs a source and owner review; anything unverified is a plain name. |
| A wrong number goes out publicly. | The same data and formatters as the site; drafts mode first; dedup keys can be removed to re-post a corrected version manually. |
| A record storm after a backfill or rewind. | Live days only; first-run seeding; per-record keys. |
| Telegram can't fetch a cold or slow card. | The image-first warm-up and check. |
| SVG filters are too slow to render at the edge. | Seeded stars, at most 11 coins and 12 lanes; measure render time in tests and fall back to no blur if needed. |

## 11. Settled during planning (2026-10-11)

These were found while planning, partly by rendering cards. They override the sections above where they differ.

**Rendering:**
- Inside the sky SVG image, gradients, blur filters, clip paths and dashed strokes render. Nested `<image>` icons and `<text>` do not.
  - The sky SVG holds only shapes and gradients.
  - Coins are card elements: a round box with `overflow: hidden` around the icon at 125% clips it to a circle (pixel-checked).
  - Name labels are card elements too.
- Lane gradients use user-space coordinates; bounding-box gradients draw nothing on straight strokes.
- **Glyphs:** the card font has no `→ ▲ ▼ ★ ▶ ≈`. They are drawn as small SVGs, and "≈ 7M LINK" reads "ON PACE FOR 7M".
- **Fonts:** Inter 800 and JetBrains Mono 800 are embedded; both are already site dependencies.
- **Render time:** sky cards take about 1 s to render.

**Card routes:**
- A broadcast card never falls back to `og-default.png`. It answers 404 when the data doesn't exist and 500 on failure, so the image check can't pass a fallback.
- Broadcast routes read their data with `cache: 'no-store'`.
- The photo URL sent to Telegram carries `?v=<claim time>`, so a re-post isn't served from Telegram's cache; the card Worker ignores the query.

**`day-leaders.json`:**
- It also carries each day's busiest lane by value and top fee lane, and `weeks[].fee_chains` for the last 8 weeks.
- It is rebuilt in full at each finalize with window-function queries, about 1.5M D1 rows read a day.
- The daily card shows the leaders in a row under the 2×2 stats.

**Retries and safety:**
- The hourly job re-runs yesterday's broadcasts; claims prevent duplicates. A failed post is retried within an hour, and deleting a key re-posts it.
- Records come only from live days in the last 3 days, so a rewind can't post old records.
- **Reserve:**
  - The first run sets a watermark (`broadcast:reserve:since`), so old deposits never post.
  - Nothing posts before the transfer scan has caught up.
  - An unpriced deposit waits for its price.
  - Facts are taken as of the deposit.
  - The call is `{ kind: 'reserve', reserve }`.
- A deposit is `direction === 'in'` and at least 1,000 LINK, the same rule as `reserveStats`.

**Copy:**
- X is counted with a dependency-free counter based on twitter-text's v3 weights: emoji and code points outside the Latin ranges count 2. Text is normalized to NFC.
- **Drop order, extended:** a record's driver line drops first, and the weekly fee-chains line drops before the closing hashtag.
- A name that reads as a domain (e.g. "pump.fun") has its dots replaced with U+2024, so no platform turns it into a link.
- Numbers use the site's formatters, so they can differ slightly from the examples above (e.g. "$1.0M"). LINK amounts under 100 get two decimals (`formatLinkAmount`).
- Telegram's 1,024 limit is checked on the raw HTML, tags included.
- In `on` mode the owner X draft is still sent, until the X API output exists.

**Calls to action:**
- Be The Oracle's entry is `null` until the game has a URL.
- The weekly strip shows only the call-to-action address, as its mockup does.

**Labels:**
- A project's `[[tokens]]` entries are `{ chain, address, source }`.
- A token tags its project only when the project is `verified = true` and has an `x`.
- The weekly label job lists handle gaps in its pull request (`labels/handle-gaps.md`); it doesn't invent handles.
- The handles themselves come from a research pull request for owner review (plan Task 12). The implementer never merges it.

**Coins:** coins with a radius of 22 px or more get a name label, as in the mockup.
