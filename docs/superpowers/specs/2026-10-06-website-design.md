# ccip.dev — Sub-project 2a: Website

**Status:** Draft for owner review · **Date:** 2026-10-06 · **Target:** ready by 2026-10-20 for the 2026-10-28 launch

Reads from the data core (`2026-10-05-data-core-design.md`, §6.3 public files) and the Reserve design
(`2026-10-06-reserve-and-link-metrics-design.md`, §5). Design study and owner-approved concepts:
`docs/research/2026-10-06-website-design-reference.md`.

## 1. Context

Sub-project 2, "Publishing", is split into separate specs (owner decision, 2026-10-06):

- **2a. Website**: this spec. It includes a sponsor slot in the layout and Umami events.
- **2b. Posts:** X, Telegram and Discord.
- **2c. Sponsor system:** sales and rotation.

The owner wants the site to look "super legit", close to chainlinkme.me (source in `../chainlinkmeme`). It should wow visitors enough that they share it.

**Audience:**
- Primary: LINK holders and the Chainlink community on X, mostly on phones.
- Secondary: builders and press checking CCIP adoption.

## 2. Goal and success criteria

The goal is a fast, trustworthy, shareable live view of CCIP at `ccip.dev`.

The site is done when:
1. **Live:** `ccip.dev` serves every launch page in §6, and `www.ccip.dev` redirects to it.
2. **Freshness:** a message that appears in `live.json` starts its comet within 60 s of the file update while the page is open (one 30 s poll plus the 30 s spread of §7.3).
3. **Share cards:** every page has its own `og:image`, and that URL returns a 1200×630 PNG.
4. **Replay:**
   - `/replay/` plays from 2023-07-06 to the latest finalized day in 60 s without visible stutter on a recent iPhone and MacBook.
   - Chrome and Safari record an MP4 that X accepts. The owner checks this with one real upload.
5. **Budgets** (§14):
   - home page JavaScript ≤ 150 KB gzipped;
   - Lighthouse mobile performance ≥ 85 on `/` and accessibility ≥ 95 on every page;
   - no horizontal scrolling at 390 px.
6. **Resilience:** with `data.ccip.dev` unreachable, every page still shows its build-time numbers and a "Live data paused" note.
7. **Free only:** no new paid services. The Cloudflare Workers Paid plan is already in place for the data core.

## 3. Scope

**At launch:**
- **The core:**
  - home with the live Constellation and feed
  - history
  - top lanes, tokens and senders
  - chains and tokens
  - methodology, status, about, and sponsor pages
- **Reserve vault.**
- **Share cards,** plus the daily card.
- **Time-lapse replay** with MP4 recording.
- **Extras:**
  - live delights
  - records and milestones
  - the lane flow map

**Right after launch** (each needs its own small design pass):
- the embed widget;
- TV mode;
- chain and project pages (the data exists in D1 as the `src_chain`, `dst_chain` and `sender` breakdowns).

**Not doing:**
- in-browser SQL (declined by the owner);
- a light theme at launch;
- GIF export;
- message lookup (CCIP Explorer already does this);
- personal wallet stats (these fit the Mini App, sub-project 3).

## 4. Facts this design relies on (measured 2026-10-06)

- **Public files:**
  - All §6.3 files are live at `https://data.ccip.dev/v1/`.
  - `access-control-allow-origin: *` is set.
  - `Cache-Control` is 30 s for live, today and status; 5 min for history, top and reserve; 1 h for chains and tokens.
  - The top dimensions are `lane`, `token` and `sender`. There is no `top/chain.json`.
- **Registry and history:**
  - 95 chains across six families: EVM, SVM, SUI, APTOS, TON and CANTON.
  - D1 `daily_breakdown` holds 83,409 `lane` rows over 1,184 days (927 distinct lanes, at most 373 in one day).
  - `history.json` has 1,184 days since 2023-07-06.
- **Hosting:**
  - `ccip.dev` and `www.ccip.dev` serve nothing yet. The zone is on Cloudflare, because `data.ccip.dev` is an R2 custom domain.
  - The existing `deploy.yml` deploys Workers with the `CF_DEPLOY_TOKEN` Actions secret.
  - wrangler 4.x supports `assets.run_worker_first` as an array of route patterns.
- **Versions:**
  - Astro 7.3.6, which requires Node ≥ 22.12.
  - `@astrojs/react` 7, which supports React 17–19.
  - Licenses:
    - satori and `@resvg/resvg-wasm`: MPL-2.0
    - mediabunny (the MP4 muxer that supersedes the deprecated `mp4-muxer`): MPL-2.0
    - Inter and JetBrains Mono via `@fontsource`: OFL-1.1

  MPL-2.0 libraries are used unmodified, which is compatible with the repo's MIT license.
- **Analytics:** chainlinkme.me sends analytics to the owner's self-hosted Umami at `https://analytics.jivx.com`.

## 5. Architecture

### 5.1 Units

| Unit | Purpose | Depends on |
|---|---|---|
| `packages/core/src/public.ts` | zod schemas and types for every public file, including `replay.json` | zod |
| Data Worker additions (`worker/src/publish.ts`) | Write `replay.json` at finalize; validate every published file against `public.ts` in tests | D1, `public.ts` |
| `site/` (Astro app) | Static pages, React islands, build-time data fetch | `public.ts`, `data.ccip.dev` |
| `site/src/sky/` | Spiral layout, WebGL2 renderer, Canvas 2D fallback, static SVG sky | none |
| `site/src/replay/` | Replay timeline, player, MP4 recorder | `sky/`, mediabunny |
| `site/src/lib/` | Data client (fetch, parse, poll, back off), records and milestones, formatters, live scheduler | `public.ts` |
| `site/worker/` (Worker `ccip-dev-site`) | Serves static assets; renders `/og/*` share cards | ASSETS binding, `data.ccip.dev`, `sponsor.json` (bundled), satori, resvg-wasm |

The site imports the schemas through a subpath export, `@ccip-dev/core/public`. That keeps the rest of core, which contains Worker and Node code, out of the browser bundle.

### 5.2 Data flow

- **Build time** (GitHub Actions):
  - Astro fetches status, today, history, top/*, chains, tokens, reserve and replay, and parses each with `public.ts`.
  - It pre-renders every page with real numbers.
  - It emits `layout.json`, the chain positions (§7.1), as a static asset.
  - If any fetch or parse fails, the build fails and the previous deploy stays live.
- **Browser:**
  - Each React island starts from the build-time values.
  - `live.json`, `today.json` and `status.json` are polled every 30 s while `document.visibilityState === 'visible'`.
  - Other files are fetched once per page view.
- **Cards:** `/og/*` reads `layout.json` from the ASSETS binding and the public JSON from `data.ccip.dev`, then renders a PNG and caches it (§9).

### 5.3 Deploy

- **Workflow:** `.github/workflows/site.yml` runs `pnpm install --frozen-lockfile`, `pnpm --filter @ccip-dev/site build` and `wrangler deploy`, with `CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}`.
- **Triggers:**
  - a push to `main` touching `site/**`, `packages/core/**` or `docs/methodology.md`;
  - a schedule at `25 0 * * *` and `25 6 * * *`, after each finalize run;
  - `workflow_dispatch`.
- **`site/wrangler.toml`:**
  - name `ccip-dev-site`;
  - `assets = { directory = "./dist", binding = "ASSETS", run_worker_first = ["/og/*"] }`;
  - a custom-domain route for `ccip.dev`.
- **www:** `www.ccip.dev` redirects to `https://ccip.dev` through a Cloudflare redirect rule. That's an owner step (§15).

### 5.4 Repository layout

```
site/
  package.json            @ccip-dev/site
  astro.config.mjs
  wrangler.toml
  sponsor.json            {} or { name, url, logo, tagline }
  src/
    pages/                §6
    layouts/Base.astro    head, header, footer, theme tokens, Umami
    components/           Astro components and React islands
    sky/                  layout.ts, renderer-gl.ts, renderer-2d.ts, svg.ts
    replay/               timeline.ts, player.tsx, recorder.ts
    lib/                  data.ts, records.ts, format.ts, live-scheduler.ts, sound.ts
    styles/               tokens.css, base.css
  worker/                 index.ts, cards/*.tsx, fonts/
  public/                 favicons, og-default.png, fonts
  test/
```

### 5.5 Data-core addition: `replay.json`

`publishHistoryFiles` writes `replay.json` at each finalize, with the same TTL as `history.json` (5 min):

```json
{
  "schema_version": 1,
  "updated_at": "…",
  "attribution": "Data: Chainlink CCIP API, DefiLlama",
  "since": "2023-07-06",
  "chains": [{ "selector": "5009297550715157269", "name": "ethereum-mainnet", "display_name": "Ethereum", "first_day": "2023-07-06" }],
  "lanes": [[0, 1]],
  "days": [{ "day": "2023-07-06", "lanes": [[0, 2, 0]] }]
}
```

- **`chains`:** every selector that appears in any `lane` row of `daily_breakdown`.
  - `first_day` is the first day the chain appears as a source or destination.
  - `name` and `display_name` come from `chains`, or are null when the selector is unknown.
  - Sorted by `first_day`, then selector.
- **`lanes`:** `[srcChainIndex, dstChainIndex]` pairs, indexing `chains`.
- **`days`:** one entry per day that has lane rows, ascending. Each entry's `lanes` holds `[laneIndex, messages, usdRounded]`, with USD rounded to whole dollars.
- **Size:** the expected size is under 2 MB raw, about 0.5 MB compressed. Cloudflare compresses JSON at the edge. The implementation measures the real size and records it in the plan's report.

## 6. Pages

Every filter combination is a path, not a query string, so each has its own static HTML and share card. Each page's `og:image` is `https://ccip.dev/og/<page path>.png?v=<build date>`.

| Path | Content | Card |
|---|---|---|
| `/` | Constellation hero (§7) and the headline card. Below the hero: live feed, "since you arrived", today's tiles, Reserve teaser, records strip and sponsor card | `/og/home.png` |
| `/history/{30d,90d,1y,all}/` | Daily charts of messages, value, fees, unique senders and delivery time; cumulative toggle | `/og/history/<range>.png` |
| `/top/{lane,token,sender}/{7d,30d,all}/` | Ranked tables (top 100) | `/og/top/<dim>/<window>.png` |
| `/flow/{7d,30d,all}/` | Lane flow map (§10.3) | `/og/flow/<window>.png` |
| `/reserve/` | Reserve vault (§6.1) | `/og/reserve.png` |
| `/replay/` | Replay player and recorder (§8) | `/og/replay.png` |
| `/records/` | Records and milestone timeline (§10) | `/og/records.png` |
| `/day/YYYY-MM-DD/` | One page per day in `history.json` (§6.2) | `/og/day/<date>.png` |
| `/chains/` | Chains and tokens with first-seen dates; "new" badge for anything first seen in the last 14 days | `/og-default.png` |
| `/methodology/` | Rendered from `docs/methodology.md` | `/og-default.png` |
| `/status/` | Ingest lag, `last_ingest_ok_at`, `last_finalize_day`, `coverage_from`, data sources | `/og-default.png` |
| `/about/` | What ccip.dev is; "Unofficial — not affiliated with Chainlink Labs"; source on GitHub; X @ccipdev; Telegram t.me/ccipdev | `/og-default.png` |
| `/sponsor/` | The placements (hero card, footer line, share-card footer), the audience, and contact by X DM to @ccipdev | `/og-default.png` |
| `404` | Hex-themed not-found page with links home | none |

**Headline card** (home):
- today's messages and value so far (UTC day, from `today.json`), counting up on load;
- yesterday's final totals beneath, from `history.json`.

**Header:**
- wordmark "ccip.dev" in brand blue with a hex glyph;
- the tagline "Live Chainlink CCIP stats · unofficial";
- the status light (§12.1);
- hex icon buttons: Live, History, Top, Reserve and Replay;
- a "more" menu: Records, Flow, Chains and Methodology.

**Footer:**
- `Data: Chainlink CCIP API, DefiLlama`
- Methodology, Status, About and "Source on GitHub" links
- the sponsor line

**Chain and lane names:** chains show their `display_name`. A lane reads "Ethereum → Base". Selectors appear only when a chain is missing from `chains.json`.

### 6.1 Reserve vault (`/reserve/`)

All figures come from `reserve.json`.

- **The vault:** an illustration that fills to `latest.link` against the next round million. Each deposit in `weekly` drops in as a coin when the page loads, newest last.
- **Cost basis vs now:**
  - `cost_usd`, `value_usd`, `change_usd` and `change_pct`;
  - `avg_deposit_price_usd` against `link_price_usd`.
- **Cadence:**
  - `avg_days_between_deposits`.
  - A live countdown to `next_expected_deposit`. When it is past, it reads "Deposit expected — watching". When `deposit_overdue` is true, it reads "Overdue by N h".
  - `deposit_streak`.
- **Pace:** `avg_weekly_link_4w`, `annualized_link`, `supply_share_pct`, and `next_milestone` with its ETA.
- **Performance:** the best and worst deposits by price, and how many deposits are above and below today's price.
- **Transfers:** a table of `transfers`, newest first: time, direction, LINK, price then, USD then, value now, change, and an Etherscan link per transaction.

**Home teaser:** the balance, the change percentage, and the countdown.

### 6.2 Day pages (`/day/YYYY-MM-DD/`)

- **Totals:** that day's `history.json` row: messages, token messages, value, fees, unique senders and median delivery.
- **Deltas:** vs the previous day and vs the trailing 7-day average.
- **Records:** any record or milestone set that day.
- **Sky:** that day's constellation as a static SVG built from `replay.json`, with no JavaScript.
- **Navigation:** previous and next links.

Days with no messages, which have no row, have no page. `/og/daily.png` renders the card for `status.last_finalize_day`.

## 7. Constellation and live experience

### 7.1 Layout (`sky/layout.ts`)

- **Order:** chains are ordered by `first_day` from `replay.json` (§5.5), then by selector.
- **Position:** chain *i* sits at radius `r = 1 · √(i + 1)` and angle `θ = i × 137.5078°`, in abstract units.
- **Stability:** a chain's position depends only on its index, so adding chains never moves existing stars. The viewport scales to fit the largest radius.
- **New chains:** a chain seen live but absent from the layout takes the next index.
- **Size and labels:** star radius scales with the square root of the chain's 30-day value. The 12 largest are labeled, and 6 on screens narrower than 640 px.
- **Lanes:** faint quadratic arcs between their two stars, with opacity by 30-day value.
- **Phones:** below 640 px the layout rotates to fit a portrait frame.
- **Output:** the build writes `layout.json`, `[{ selector, x, y }]` normalized to [-1, 1]. The renderers, the replay, day-page SVGs and share cards all use it.

### 7.2 Rendering

- **`renderer-gl.ts`:**
  - Hand-written WebGL2 with instanced quads for stars and comets, additive blending, a glow sprite and a short trail per comet. No 3D library.
  - It handles `webglcontextlost` by re-initializing.
  - On a second loss within 60 s it switches to `renderer-2d.ts`, which draws the same scene with Canvas 2D and is also used when WebGL2 is unavailable.
- **`svg.ts`:** renders a static sky (stars, lanes, optional per-lane weights) as an SVG string. Day pages and share cards use it.
- **Comets:**
  - A comet travels its lane in 2.4 s.
  - Size is `clamp(log10(usd + 1) / 7, 0.15, 1)`.
  - Token transfers (`usd > 0` or `token != null`) are brand blue `#4a7ff0`. Data-only messages are pale `#c9d6f5`.
  - At `usd ≥ 1,000,000` the comet is gold `#f5c451`. Its destination star emits a shockwave ring, and a caption fades in for 4 s: "$4.2M USDC · Ethereum → Base".
- **Limits:**
  - Device pixel ratio is capped at 2.
  - At most 400 live comets. When over, the oldest are dropped first.
  - The animation loop stops when `document.hidden` is true or when the hero is out of view (IntersectionObserver).

### 7.3 Live scheduler (`lib/live-scheduler.ts`)

- **Each poll:**
  - Messages are deduplicated by `id` against those already seen.
  - New messages are sorted by `send_ts` and spread over the next 30 s. Their relative spacing is kept, compressed to fit.
- **First load:** messages from the last 2 minutes of `live.json` play over the first 10 s, so the sky is never empty. Older messages appear only in the text feed.
- **Feed:**
  - A list of the 20 newest messages beside the sky: time, lane, token, USD, and the sender label with a verified check.
  - It is an `aria-live="polite"` region, announcing at most one message every 5 s.

### 7.4 Live delights

- **"Since you arrived":** the count and USD sum of new message ids seen since the page loaded.
- **Tab title:** `"{today's messages} today · ccip.dev"`, updated each poll.
- **Sound mode (`lib/sound.ts`):**
  - WebAudio; off by default; a toggle in the hero; the choice is saved in `localStorage`.
  - Each comet plays a short sine note on the C-major pentatonic scale, pitched by `log10(usd + 1)`.
  - Data-only messages play the lowest note. Gold messages add a soft chord.
  - At most 6 notes per second. Muted while the tab is hidden.

### 7.5 Reduced motion

With `prefers-reduced-motion: reduce`:
- the sky is static;
- each message briefly brightens its source and destination stars instead of sending a comet;
- count-ups, staggered entrances and the vault animation are skipped.

## 8. Time-lapse replay (`/replay/`)

### 8.1 Timeline (`replay/timeline.ts`)

- **Range:** from `replay.since` to the last day in `replay.days`.
- **Pace:** a run of length *L* seconds (30, 60 or 120; default 60) spends `L / dayCount` seconds on each day.
- **Each day:**
  - chains whose `first_day` is that day ignite at their spiral positions, with a flash and a growing ring;
  - lanes glow by that day's USD;
  - `min(messages, round(4 × log2(messages + 1)))` comets spawn, spread across the day's time slice, with lanes picked in proportion to their message counts.
- **Determinism:** a seeded PRNG (mulberry32, seed = the day index) picks the lanes, so every run and every recording is identical.
- **Overlay:**
  - date
  - cumulative messages and value, from `history.json`
  - active chain count
  - milestone captions from §10.2 (for example "Solana joins", "First $100M day"), each shown for 2 s
- **End card:** the last 2 s of the run show all-time totals and "ccip.dev".

### 8.2 Player (`replay/player.tsx`)

- **Controls:**
  - play/pause
  - a scrub bar
  - length (30, 60 or 120 s)
  - aspect: 16:9 (1920×1080), 1:1 (1080×1080) or 9:16 (1080×1920)
- **Playback:** the canvas renders the same frames the recorder renders, in real time with `requestAnimationFrame`.
- **Reduced motion:** the player starts paused on the end card.

### 8.3 Recorder (`replay/recorder.ts`)

- **Loading:** loaded with a dynamic `import()` only when Record is pressed. mediabunny and the encoder code stay out of every other page's bundle.
- **Feature check:** when the page loads, `VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width, height, framerate: 30 })` decides whether to show the button. When unsupported, the page shows "Recording works in Chrome, Edge and Safari".
- **Encoding:**
  - Frames are rendered offline: for each frame *f* in `0..30·L + 60`, the timeline is drawn at `t = f / 30` onto an `OffscreenCanvas` and wrapped in a `VideoFrame`.
  - Frames are encoded with H.264 at 8 Mbps and muxed into an MP4 with mediabunny.
  - The extra 60 frames are the 2 s end card.
- **Watermark:** a corner mark, "ccip.dev · 2023-07-06 → <last day>", on every frame.
- **Progress:** a progress bar with Cancel. The finished file downloads as `ccip-replay-<last day>-<aspect>.mp4`.
- **Analytics:** `replay_record` is sent with `{ aspect, length }`.

## 9. Share cards (`site/worker/`)

### 9.1 Routes

The Worker handles only `/og/*`; everything else is a static asset.

Accepted patterns, each `.png`, optionally with `?v=…`:
- `home`
- `daily`
- `day/YYYY-MM-DD` (the date must be a row in `history.json`)
- `history/(30d|90d|1y|all)`
- `top/(lane|token|sender)/(7d|30d|all)`
- `flow/(7d|30d|all)`
- `reserve`
- `replay`
- `records`

Anything else returns 404 with no render.

### 9.2 Rendering

- **Pipeline:** satori turns JSX into SVG, and resvg-wasm turns that into a 1200×630 PNG. Inter Regular and Bold are bundled in `worker/fonts/`.
- **Layout:**
  - `#0c0f14` ground with the hex lattice;
  - the sky from `svg.ts` in silhouette on the right;
  - an eyebrow (11 px uppercase tracked), then one big number, its label and the date;
  - bottom row: "ccip.dev", `Data: Chainlink CCIP API, DefiLlama`, and the sponsor line when `sponsor.json` has a name.
- **Content per card:**

  | Card | Content |
  |---|---|
  | home | Today's messages and value |
  | daily, day | That day's messages and value, with the change vs the previous day |
  | history | Range total messages and value, with a sparkline |
  | top | The #1 entry and the top 3 |
  | flow | The window's largest lane |
  | reserve | LINK balance, change % and next deposit |
  | replay | All-time totals |
  | records | Busiest and biggest days |

### 9.3 Caching

Rendered PNGs are stored with the Cache API, keyed by path without `?v`, using the TTL below.

| Card | `Cache-Control: public, max-age=` |
|---|---|
| home | 300 |
| day older than `last_finalize_day − 1` | 604800 |
| other days, `daily` | 600 |
| history, top, flow, records, replay | 1800 |
| reserve | 900 |

### 9.4 Failure

- **When a JSON fetch fails, the JSON has the wrong shape, or rendering throws:**
  - serve `/og-default.png` from ASSETS with `max-age=60`;
  - never return a 5xx.
- **404s:** only for unknown patterns.

### 9.5 Share button

Every page with a card has a share button:
- **Phones:** `navigator.share({ url, text })` when available.
- **Otherwise,** a menu:
  - "Post on X": `https://x.com/intent/post?text=<text>&url=<url>`, where the text is the card's headline plus "via @ccipdev";
  - "Copy link";
  - "Download card", which fetches the PNG.
- **Analytics:** `share` is sent with `{ view, channel }`.

## 10. Records, milestones and the flow map

### 10.1 Records (`lib/records.ts`, computed from `history.json`)

| Record | Rule |
|---|---|
| Busiest day | max `messages` |
| Biggest day | max `usd_value` |
| Most senders | max `unique_senders` |
| Highest fees | max `fee_usd`. Labeled "since 2026-10-05", because fees start with live ingest |
| Fastest delivery | min `median_delivery_s` among days with `messages ≥ 100` |

Ties go to the earliest day.

### 10.2 Milestones

Each milestone is the first day a cumulative figure reaches a threshold:
- **Messages:** 1, 2 and 5 × 10ⁿ, starting at 1,000.
- **Value:** $1B, $2.5B, $5B, $10B, $25B, $50B, $100B and so on (×10 per cycle).
- **Chain count:** every multiple of 25, from `replay.chains[].first_day`.
- **Joins:** "<display_name> joins" for every chain, used only as replay captions.

### 10.3 Live record banner

On `/`, today's running `messages`, `usd_value` and `unique_senders` are compared with the records over all days before today. When one is exceeded, a banner appears ("New record: busiest day ever — 5,212 messages and counting") with a share button for `/og/home.png`.

### 10.4 Flow map (`/flow/{window}/`)

- **Data:** at build time, the lanes in `replay.json` are summed over the window: the last 7 days, the last 30 days, or all days.
- **Diagram:** a D3 chord diagram (`d3-chord`, `d3-shape`) of the 20 chains with the most value in the window, plus one "Other" group for the rest.
- **Interaction:**
  - toggle between messages and USD;
  - hovering or tapping a chain isolates its chords;
  - a table of the top 20 lanes below serves screen readers and gives exact figures.

## 11. Visual system

- **Tokens** (`styles/tokens.css`):

  | Token | Value |
  |---|---|
  | `--bg` | `#0c0f14` |
  | `--card` | `#161b23` |
  | `--border` | `rgba(47,98,223,.30)` |
  | `--fg` | `#e8eaed` |
  | `--muted` | `#8892a0` |
  | `--blue` | `#2f62df` |
  | `--blue-2` | `#4a7ff0` |
  | `--gold` | `#f5c451` |
  | `--up` | `#3ccf8e` |
  | `--down` | `#f06a6a` |
  | `--warn` | `#f2b84b` |

  Gold is used only for $1M+ moments. Green, red and amber are used only for status and deltas.
- **Ground:** a fixed `::before` layer with the hex-lattice SVG tile (56×98, `#4a8eff` at 9%) and `radial-gradient(ellipse at top, rgba(47,98,223,.08), transparent 60%)`. It does not use `background-attachment: fixed`, which judders on iOS.
- **Type:**
  - Inter 400/600/800 for text, and JetBrains Mono 400/600 with `font-variant-numeric: tabular-nums` for numbers, hashes and times.
  - Both are self-hosted from `@fontsource` with `font-display: swap`.
  - Section labels are 11 px, 700 weight, uppercase, with letter spacing 0.14em.
- **Shape:**
  - card radius 8 px, hero 12 px, pills 999 px;
  - hex icon buttons 40×46, with a `clip-path` taken from chainlinkme.me;
  - focus ring `0 0 0 6px rgba(47,98,223,.2)`.
- **Motion:**
  - staggered card entrance (opacity, 12 px rise, 14 ms per index, `cubic-bezier(.2,.8,.2,1)`);
  - a 2 px hover lift;
  - count-up on headline numbers;
  - a pulsing ring on the status light.

  There is no 3D tilt on data tiles.
- **Theme:** dark only. `<meta name="theme-color" content="#2f62df">`, and SVG, ICO and Apple touch favicons using the hex glyph.
- **Layout:** a 1280 px max-width column. Mobile-first, with breakpoints at 640 px and 1024 px.

## 12. Trust, sponsor slot and analytics

### 12.1 Trust signals

- **Status light:**
  - from `status.lag_seconds`: green under 120 s, amber under 600 s, red at 600 s or more;
  - also red when `status.json` has failed for 3 polls in a row;
  - it links to `/status/`.
- **All-time figures:** every one shows "since {since}".
- **ⓘ links:** every metric label has one pointing to its anchor in `/methodology/`. `site/src/lib/metric-anchors.ts` maps metric keys to anchors, and a test checks that every anchor exists in the rendered methodology.
- **Sender labels:** a verified check on every labeled sender. Public files carry only verified labels.
- **Live widgets:** "Updated N s ago", computed from `updated_at`.

### 12.2 Sponsor slot

- **Data:** `site/sponsor.json` is either `{}` or `{ name, url, logo, tagline }`. `logo` is a path under `site/public/sponsor/`.
- **With a sponsor:**
  - a card below the hero with "Sponsor", the logo, the name and tagline, and a `rel="sponsored noopener"` link;
  - a footer line "Sponsored by <name>";
  - the name in the share-card footer.
- **With no sponsor:**
  - the card reads "Your project here — sponsor ccip.dev. Reach the people watching CCIP live." and links to `/sponsor/`;
  - the footer line reads "Sponsor ccip.dev";
  - cards show no sponsor line.

### 12.3 Analytics

- **Script:** Umami from `https://analytics.jivx.com/script.js` on every page, with `data-website-id` from `site/src/config.ts`. The owner creates the site entry (§15).
- **Events:**

  | Event | Data |
  |---|---|
  | `share` | `{ view, channel }` |
  | `card_download` | `{ view }` |
  | `replay_play` | `{ length, aspect }` |
  | `replay_record` | `{ length, aspect }` |
  | `sound_toggle` | `{ on }` |
  | `data_error` | `{ file }`, at most once per file per page view |

## 13. Error handling

- **Data client (`lib/data.ts`):**
  - Every fetch is parsed with its `public.ts` schema. Unknown fields are ignored, so additive data-core changes never break the site. A missing required field counts as a failed fetch.
  - On failure, the island keeps its last good values: the build-time snapshot or the previous poll.
  - It shows "Live data paused — retrying" in muted text, with the age of the data, and sends `data_error`.
  - Polling backs off 30 s → 60 s → 120 s → 300 s (cap), and returns to 30 s after a success.
- **Build:** any fetch or schema failure fails the build (§5.2). The workflow's failure email is the alert.
- **Renderer:** WebGL context loss is handled as in §7.2. If initializing either renderer throws, the hero shows the static SVG sky.
- **Recorder:**
  - an encoder error stops recording;
  - it shows "Recording failed — try again or use Chrome";
  - it releases every `VideoFrame`.
- **Cards:** see §9.4.

## 14. Testing and budgets

- **Site unit tests** (Vitest, Node):
  - `records.ts`: each record; ties; the 100-message delivery floor; milestone thresholds; days with no row.
  - `layout.ts`: deterministic positions; adding a chain never moves earlier ones; new-chain index.
  - `timeline.ts`: day-to-time mapping for 30, 60 and 120 s; the seeded spawn sequence is stable; the comet-count formula.
  - `live-scheduler.ts`: deduplication; spacing compressed into 30 s; the first-load 2-minute window.
  - `data.ts`: parses real captured files (fixtures in `site/test/fixtures/`); ignores unknown fields; fails on a missing field; the back-off sequence.
  - `format.ts`: compact USD ($1.2M, $25.3B), durations and dates.
  - `metric-anchors.ts`: every anchor exists in the rendered methodology.
- **Card Worker tests** (Vitest on workerd, as in `worker/`):
  - each route pattern returns `image/png` with the §9.3 `Cache-Control`;
  - an unknown pattern returns 404;
  - an upstream 500 or a malformed body returns the fallback card with `max-age=60`.
- **Data core:**
  - `replay.json`: chain order and `first_day`, lane indexing, USD rounding;
  - every file written by `publish` validates against its `public.ts` schema.
- **Build check:** CI runs `pnpm --filter @ccip-dev/site build` against live data. A script then asserts that every built HTML page has a unique `<title>`, an `og:image` with an allowed card pattern, and a canonical URL.
- **Before launch** (manual, by Claude with chrome-devtools):
  - screenshots at 1440 px and 390 px of every page type;
  - Lighthouse mobile on `/`, `/reserve/`, `/top/token/7d/` and one day page;
  - a replay recording in Chrome, with the MP4 checked by the owner's upload to X.
- **Budgets:**
  - home page JavaScript ≤ 150 KB gzipped;
  - `/replay/` before Record is pressed ≤ 200 KB gzipped;
  - Lighthouse mobile performance ≥ 85 on `/`, accessibility ≥ 95 on every audited page;
  - LCP ≤ 2.5 s on Lighthouse's mobile profile.

## 15. Owner steps

The plan gives the exact commands. No secret is ever pasted into the chat.

1. **Umami:** create a website entry "ccip.dev" at `analytics.jivx.com` and share its website ID. The ID is public, since it appears in page HTML.
2. **Domain:** the first deploy runs from the owner's Mac with `wrangler deploy`, which attaches `ccip.dev` as a custom domain. If the CI deploy later fails on the domain, add the "Zone → Workers Routes: Edit" permission for `ccip.dev` to `CF_DEPLOY_TOKEN`.
3. **www:** add a redirect rule in the dashboard: `www.ccip.dev/*` → `https://ccip.dev/${1}`, 301.
4. **Recording check:** upload one recorded MP4 to X, as a draft or a post, to confirm X accepts it.

## 16. Follow-ups after launch

- Embed widget
- TV mode
- Chain and project pages
- Light theme
- Post integration (2b reads `/og/daily.png` and the day pages)
- The sponsor system (2c)
