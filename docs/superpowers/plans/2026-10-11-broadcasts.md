# Broadcasts (3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every finalized day, Monday week, record, milestone and Reserve deposit into an image post: automatic on the Telegram channel `@ccipdev`, a ready-to-paste X draft to the owner, with verified @handles and no links.

**Architecture:** Shared, pure fact logic lives in `@ccip-dev/core` (records, deltas, Reserve deposit facts, broadcast keys and card paths), together with the site's formatters and chain names, so the Worker's captions and the site's cards compute the same numbers. The data Worker publishes a new `day-leaders.json`, then, after finalize (00:07 UTC) and each hourly run, builds facts from D1, writes X and Telegram copy, claims a dedup key in `meta`, checks the card, and sends it through pluggable outputs (Telegram channel, owner X draft). The site's card Worker renders five new 1200×675 cards in the "C2 · Orbit hub" style from public files only.

**Tech Stack:** TypeScript (ESM), Vitest 4, Cloudflare Workers with D1, R2 and crons (`@cloudflare/vitest-plugin`), zod 4, Astro 7 and React 19 (unchanged pages), `@cf-wasm/og` 0.5.0 (Satori 0.32 and resvg-wasm 2.4.1), the Telegram Bot API. No new dependencies: JetBrains Mono and Inter 800 come from `@fontsource/*`, already site dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-broadcasts-design.md`, with the chosen mockups in `docs/superpowers/specs/assets/2026-10-11-broadcasts/`.

## Global Constraints

- **Finalize time:** "The early finalize cron moves to `7 0 * * *`." "Every "00:10" in the code comments, the runbook and the methodology becomes "00:07"." "The upload tool's finalize window (23:55–00:30) is unchanged."
- **Where broadcasts run:** after `publishHistoryFiles` and the site build trigger in the early finalize; "The late 06:00 run never broadcasts." The Reserve broadcast follows the publish of `reserve.json`.
- **Mode:** "`BROADCASTS` (a Worker var) is `off`, `drafts` or `on`. The default is `off`." "drafts: only the owner-draft output receives broadcasts." "on: all enabled outputs." "`TELEGRAM_CHANNEL_ID` (a var, `@ccipdev`)." "`TELEGRAM_DRAFTS_CHAT_ID` (optional; it defaults to `TELEGRAM_ALERT_CHAT_ID`)."
- **Dedup keys, verbatim:** `broadcast:daily:<day>`, `broadcast:weekly:<monday>`, `broadcast:record:<kind>:<day>`, `broadcast:milestone:<metric>:<threshold>`, `broadcast:reserve:<tx>`. "The key is claimed atomically before sending, the same claim pattern alerts use." "If every enabled output fails, the claim is released … If at least one succeeds, it is kept." First run: "without `meta.broadcast:records:seeded`, the step marks every current record and passed milestone as announced, without posting, then sets the seed key."
- **Posts:** "Every post has an image. No post contains a link, on X or Telegram."
- **X text:** "at most 280 characters, never contains a URL, and the headline numbers always survive", counted the way X counts. Lines drop in this order: "1. busiest lane; 2. top sender; 3. top token; 4. the closing hashtag."
- **Telegram captions:** "at most 1,024 characters, valid HTML, with names in place of @handles" (`<b>` and line breaks), escaped.
- **Tags:** "only verified handles are used; anything unverified appears as a plain name." "@chainlink goes on records, milestones and Reserve deposits." "Daily and weekly posts carry `#CCIP #Chainlink $LINK`."
- **Numbers:** "formatted with the site's formatters (`formatUsd`, `formatCount`, `formatFee`, `formatShare`), so posts and site always match."
- **Outputs, verbatim:** "`interface BroadcastOutput { name: string; send(b: Broadcast): Promise<'sent' | 'failed'> }`. A `Broadcast` is `{ key, kind, imageUrl, facts, xText, telegramHtml }`." Telegram: "`sendPhoto` … On a `429`, it retries once after Telegram's `retry_after`, capped at 30 s." Alerts: "`broadcast-<output>:<key>`", "`broadcast-image:<key>`", "`day-leaders-publish`". Image first: "a `GET`, with a timeout … A non-200 response or a timeout means no post … The dedup claim is released."
- **Cards:** routes `/og/broadcast/daily/<day>.png`, `/og/broadcast/weekly/<monday>.png`, `/og/broadcast/record/<kind>/<day>.png`, `/og/broadcast/milestone/<metric>/<threshold>.png`, `/og/broadcast/reserve/<tx>.png`. "`parseCardPath` and `cardPathOf` accept and round-trip them. Unknown kinds answer 404." "Size: 1200×675 … the other cards stay 1200×630." "Cards render from public data only."
- **C2 values, verbatim:** background `#070a10`; nebulas blue `#1d3b8a` upper right and violet `#5b2a86` lower right; "about 170 stars of seeded random size and opacity"; "up to 11" coins "sized by √value" around the hub; dashed orbit rings; lane gradients "`#4a7ff0`→`#7de3ff` or `#7a5cff`→`#4a7ff0`, thickened by value"; coins "clipped to a circle, with a soft halo behind it and a thin white rim at 28% opacity"; brand "`ccip.dev` (blue `#4a7ff0`, 800 weight)"; panel "`rgba(10,13,19,.8)`, border `#233047`, radius 22"; deltas "green `#7fd4a0` or red `#e58a8a`"; strip "64 px tall, with a gradient from `#13244d` to `#0f1a33`"; record value "at 132 px"; Reserve "the number at 104 px, LINK at 52 px", hexagon "stroke `#375BD2`".
- **`day-leaders.json`:** "for each of the last 400 days, the top token, top sender and top fee chain, each with its key, label or symbol and value", schema in `packages/core/src/public.ts`.
- **No new data sources, no paid services, no new dependencies.** The Workers Paid plan is already in place (website spec §2.7), so a card's CPU time is not capped at 10 ms.
- **`.backfill/` is the owner's.** Never write to it.
- **Remote operations are owner steps.** Never run a `wrangler … --remote` command. A push to `main` deploys the Worker and the site; the deploy keeps `BROADCASTS = "off"` until the owner changes it.
- **Commits:** conventional subjects (`feat(worker): …`, `feat(site): …`, `feat(core): …`, `docs: …`). Stage explicit paths only; never `git add -A`, `git add .` or `git commit -a`. End each message with the implementer's `Co-Authored-By` trailer.
- **Tests:**
  - Core: `pnpm --filter @ccip-dev/core test`.
  - Worker: `pnpm --filter @ccip-dev/worker test`.
  - Site: `pnpm --filter @ccip-dev/site test` (both the node and the workerd configs).
  - Scripts: `pnpm exec vitest run scripts/test/<file>` from the repo root.
  - Types: `pnpm typecheck`. Labels: `pnpm labels:check`.
  - New tests use the BDD comments `// #given`, `// #when` and `// #then`.
- **Comments:** only where the why is not obvious from the code.

## Review Focus

1. **A stale `history.json` or `reserve.json` at the edge.** `data.ccip.dev` caches those files for up to 300 s (Cache Rule "use cache-control"). Finalize publishes and then asks for the card within seconds, so a card read through the cache can miss the new day or deposit. It then answers 404, and that day would never be posted. Broadcast cards must read their data with `cache: 'no-store'`, and the hourly run retries yesterday's unsent broadcasts.
   - Tests: Task 10 "renders the daily broadcast card at 1200×675, reading each data file with no-store, cached for 15 minutes"; Task 8 "posts yesterday's daily from the hourly run when the 00:07 attempt could not".
2. **A name that reads as a domain.** A label or token symbol such as `pump.fun` or `xStocks.fi` is auto-linked by X and Telegram, which breaks "No post contains a link".
   - Test: Task 7 "never writes a domain-looking name as a link, on X or Telegram".
3. **The first Reserve run.** On the first hourly run in `drafts` or `on`, the Reserve already has about 94 deposits. Before the scan has caught up, `reserve.json` lists no transfers. Neither case may post old deposits or seed an empty watermark that later floods the channel.
   - Tests: Task 8 "seeds the Reserve watermark on its first run and posts nothing" and "neither posts nor seeds before the Reserve scan has caught up".
4. **Glyphs the card font lacks.** Inter's latin subset has no `→ ▲ ▼ ★ ▶ ≈`. A throwaway render on 2026-10-11 showed each as a "NO GLYPH" box. The mockups use them in deltas, lanes, the record pill and the strip.
   - Test: Task 10 "writes no glyph the card fonts lack", and the same check in Task 11.
5. **A broadcast card that fails to render.** The classic cards serve `og-default.png` with HTTP 200 on any error. A broadcast card doing the same would pass the image-first check and post the default image.
   - Test: Task 10 "answers 500, not the fallback card, when a broadcast card fails".

## Decisions the spec leaves open or gets wrong

- **What the renderer draws inside an SVG image** (settled on 2026-10-11 with a throwaway render, through `@cf-wasm/og/node` and in the site's workerd test environment):
  - Inside the sky SVG, which Satori embeds as an `<img>` data URI, these render: radial and linear gradients, `feGaussianBlur`, `clipPath`, dashed strokes and opacity.
  - Nested `<image href="data:…">` icons (SVG or PNG) do **not** render: resvg skips images inside an image. `<text>` does not render either, because resvg-wasm 2.4.1 has no fonts. An `objectBoundingBox` gradient on a straight stroke draws nothing.
  - So the sky SVG holds only the background, nebulas, stars, rings, lanes (with `userSpaceOnUse` gradients) and halos. Coins and their labels are Satori elements: a `borderRadius` box with `overflow: hidden` around the icon at 125% (the mockup's 2.5 r), which clips to a true circle (the pixel test proved it). The rim is a `boxShadow`.
  - Render time: a bare sky probe took 0.4–0.8 s, in node and workerd alike. Prototypes of this plan's finished cards took 0.9–1.4 s in node (the Reserve card 0.5 s). The nested full-size image costs about 0.2 s, and the blur is negligible, so there is no need to drop the blur. Task 9 asserts a generous ceiling.
- **Missing glyphs.** `→ ▲ ▼ ★ ▶` are drawn as small inline SVG images (`glyphs.ts`). The Reserve card's "≈ 7M LINK" label reads "ON PACE FOR 7M".
- **Fonts.** "Values are mono, 800 weight", and the brand is 800. The card Worker embeds Inter 800 and JetBrains Mono 800 (latin, OFL) next to Inter 400 and 700.
- **Broadcast cards never fall back.**
  - A broadcast route answers 404 when its data has no such day, record or deposit, and 500 when anything throws. Neither is cached.
  - It reads data with `cache: 'no-store'` (Review Focus 1).
  - The rendered PNG is cached for 900 s.
- **`day-leaders.json` carries more than §7.4 lists**, so that captions and cards agree exactly and stay re-renderable:
  - Per day: `lane` (busiest by value) and `fee_lane` (top lane by fees). These are the strip's busiest lane and the record drivers.
  - `weeks[]`: each of the last 8 complete weeks' top 3 fee chains, for the weekly strip. `top/src_chain.json`'s `7d` window moves daily, so it cannot re-render an old week.
  - It is rebuilt in full at each finalize with one window-function query per leader. That replaces "days whose top-N rows don't change are carried over": it costs about 1.5 M D1 rows read a day (Paid plan: 25 billion a month), and it also picks up backfill re-uploads that carry-over would miss.
- **The daily card shows the leaders.** §7.1 says the daily card reads the top token, sender and fee chain from `day-leaders.json`, but §7.3's panel has no slot for them. They go in a row under the 2×2 grid, as the weekly panel carries its fee bars.
- **The hourly run retries.** "If every enabled output fails, the claim is released, so the next run retries", but no later run handles yesterday's daily. Each hourly run therefore re-runs yesterday's finalize broadcasts once `last_finalize_day` is yesterday. That is also how a deleted key re-posts.
- **Records only come from recent live days.** Record days are finalized days on or after `live_start_day` and within the last 3 days (finalize's catch-up window), so a rewind never posts old records.
  - The drivers: fees use the day's top lane by fees, and messages and value use the busiest lane by value (the spec's "busiest lane"). The largest fee uses its own route and token. The LINK share has no driver line.
- **The Reserve:**
  - A deposit is exactly `reserveStats`'s rule: `direction === 'in'` and at least `DEPOSIT_MIN_LINK` (1,000 LINK) at full precision. `reserveStats` now writes it as `deposit` on each published transfer, so the Worker and the card never re-derive it from a rounded amount.
  - The Reserve job learns of a transfer when `scanReserveTransfers` inserts its row. The pricing pass prices it in the same hourly run, and `publishRegistryFiles` publishes it. The broadcast then reads that published body.
  - The first run records a watermark, `broadcast:reserve:since`: the latest deposit's time. Only deposits after it are new. An unpriced deposit waits for its price.
  - Facts are taken as of the deposit (the balance after it, the streak ending at it, the 4 weeks before its week, the milestone from its time), so a card re-renders the same later. It uses the helpers `reserveStats` now shares.
  - `runBroadcasts(c, { kind: 'reserve', reserve })` takes the published body and finds the new deposits itself, in place of the spec's `{ kind: 'reserve', tx }`.
- **Coin labels:** "coins at least 22 px across get a name label", but the chosen mockup labels coins of radius 22 and over (44 px across) and leaves the 34–42 px coins near the strip unlabeled. The plan follows the mockup: radius ≥ 22.
- **Copy:**
  - The daily X post follows the spec's example, which has no fee-chain line. The top fee chain appears in the Telegram caption and on the card, and is tagged in the weekly "Top fee chains" line.
  - The weekly fee-chains line drops after the top token and before the closing hashtag. A record's driver line drops first.
  - `formatShare` rounds as the site does, so the example's "35%" for 35.7% prints "36%", and Reserve USD prints `formatUsd`'s "$1.0M" for "$1.03M".
  - LINK amounts under 100 keep two decimals through a new shared `formatLinkAmount` ("0.29 LINK"), where `formatLink` would print "0 LINK".
- **URL safety:** names that read as domains have their dots replaced by U+2024 (one-dot leader) on X and Telegram.
- **Telegram's 1,024** is measured on the raw HTML in UTF-16 units, tags included, which is stricter than Telegram's own count.
- **Claims:**
  - `pending:<iso>` while sending; a pending claim older than an hour can be taken again.
  - `sent:<iso>` once one output succeeds; `seeded:<iso>` for a first-run mark. Both sort after `pending:`, so they are never reclaimed.
- **`on` also sends the X draft,** because the X API output is not built in 3a.
- **The card URL sent to Telegram carries `?v=<claim time>`,** so a re-post after a deleted key is fetched fresh. The card Worker ignores the query.
- **Calls to action:**
  - The rotation's texts are "Watch every lane: ccip.dev/replay", "What does a message cost? ccip.dev/flow/30d", "Who pays the most: ccip.dev/top/chain/7d/fees", "Every record: ccip.dev/records" and "Track the Reserve: ccip.dev/reserve".
  - Be The Oracle is `ORACLE = null` in `site/worker/cards/cta.ts` until launch, when it gets its launch day and text. No URL is invented here.
  - The weekly strip shows its call to action as the address alone, as the weekly mockup does, because the three fee chains fill the strip. Every strip piece keeps its width, so an overlong insight is clipped rather than overlapping.
- **Handles:**
  - `labels/projects/*.toml`'s unused `tokens = [{ group }]` field becomes `[[tokens]] chain, address, source`.
  - A token tags its project only when the project has `verified = true` and an `x`.
  - Both tables compile into `worker/src/generated/handles.json`.
  - The weekly job cannot discover handles. It lists the gaps (busiest tokens with no project, busiest chains with no handle) in `labels/handle-gaps.md` and its PR body.
- **Docs are folded into the tasks that need them** (the 00:07 strings in Task 1, labels in Task 3, `day-leaders-publish` in Task 5, Broadcasts in Task 8), so there is no separate docs task.

## File map

| File | Task | Responsibility |
|---|---|---|
| `worker/wrangler.toml`, `worker/src/index.ts`, `docs/runbook.md`, `docs/methodology.md` | 1, 3, 5, 8 | 00:07 cron; `BROADCASTS` and `TELEGRAM_CHANNEL_ID` vars; runbook and methodology |
| `packages/core/src/{format,names,records}.ts` | 2, 4 | Moved from `site/src/lib/`; `formatLinkAmount`; records and milestones set on a day |
| `site/src/lib/{format,names,records}.ts` | 2 | Re-exports of the core modules |
| `packages/core/src/labels.ts`, `scripts/build-labels.ts`, `labels/chain-x.json`, `worker/src/handles.ts`, `worker/src/generated/handles.json` | 3 | Token → project and chain → handle tables, validation and compilation |
| `scripts/label-candidates.ts`, `.github/workflows/label-candidates.yml`, `labels/handle-gaps.md` | 3 | Weekly handle gaps |
| `packages/core/src/{reserve-pace,broadcasts,time,public,reserve-stats}.ts` | 4, 5 | Deposit rule and pace helpers; broadcast keys, card paths, deltas and deposit facts; `isDay`; schemas |
| `worker/src/store.ts`, `worker/src/publish.ts` | 5, 6, 8 | `dailyLeaders`, ordered `topBetween`, `tokenGroupIds`, `markMeta`; `day-leaders.json`; shared history and leader rows |
| `worker/src/broadcasts/{tags,facts,x-length,copy,outputs,run}.ts`, `worker/src/telegram.ts` | 6, 7, 8 | Tags, facts, copy, outputs and the pipeline |
| `worker/src/jobs/{finalize,hourly}.ts`, `worker/src/{env,context}.ts` | 3, 8 | Wiring and configuration |
| `site/worker/{render,index,og,fonts,cache,h}.ts`, `site/scripts/embed-fonts.ts` | 9, 10 | Card size, fonts, broadcast routing |
| `site/worker/cards/{glyphs,orbit-sky,coin-icons,broadcast-frame,broadcast-cards,cta}.ts` | 9, 10, 11 | The C2 sky, frame and the five cards |
| `site/src/lib/{card-paths,chain-icons}.ts` | 9, 10 | Broadcast routes; the lettermark helpers |

## Local preview of the broadcast cards

Tasks 10 and 11 look at the real cards. Until Task 5 is deployed, `data.ccip.dev` has no `day-leaders.json`, so this script makes a rough one from the live top files. It is for looking only; never commit it.

1. Save this as `preview-cards.mts` in your scratch directory. Replace `<repo>` with the absolute repo path.

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { render } from '<repo>/site/node_modules/@cf-wasm/og/dist/node.js';
import { trackedMilestones, recordsSetOn } from '<repo>/packages/core/src/records.ts';
import { PUBLIC_SCHEMAS } from '<repo>/packages/core/src/public.ts';
import { iconHref } from '<repo>/site/src/lib/chain-icons.ts';
import { broadcastTree } from '<repo>/site/worker/cards/broadcast-cards.ts';
import { CARD_FONTS } from '<repo>/site/worker/fonts.ts';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: tsx preview-cards.mts <out dir>');
const get = async (name: string) => {
  const res = await fetch(`https://data.ccip.dev/v1/${name}`, { headers: { 'user-agent': 'curl/8.7.1' } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
};
const names = ['history.json', 'replay.json', 'chains.json', 'reserve.json', 'top/token.json', 'top/sender.json', 'top/src_chain.json'];
const files: Record<string, any> = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await get(n)])));
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const days = files['history.json'].days as { day: string; fee_usd: number | null }[];
const lastDay = days.at(-1)!.day;
const laneKey = (i: number) => {
  const [a, b] = files['replay.json'].lanes[i];
  return `${files['replay.json'].chains[a].selector}>${files['replay.json'].chains[b].selector}`;
};
const busiest = (day: string) => {
  const lanes = [...(files['replay.json'].days.find((d: { day: string }) => d.day === day)?.lanes ?? [])].sort((x: number[], y: number[]) => y[2]! - x[2]!);
  const top = lanes[0];
  return top ? { key: laneKey(top[0]), label: null, messages: top[1], usd: top[2], fee_usd: null } : null;
};
const entry = (e: any, label: string | null) => (e ? { key: e.key, label, messages: e.messages, usd: e.usd, fee_usd: e.fee_usd ?? null } : null);
const fees7d = files['top/src_chain.json'].by_fees?.['7d'] ?? [];
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const lastMonday = addDays(mondayOf(addDays(lastDay, 1)), -7);
files['day-leaders.json'] = await get('day-leaders.json').catch(() => ({
  schema_version: 1,
  updated_at: files['history.json'].updated_at,
  attribution: files['history.json'].attribution,
  days: days.slice(-30).map((d) => ({
    day: d.day,
    token: entry(files['top/token.json'].windows['7d'][0], files['top/token.json'].windows['7d'][0]?.symbol ?? null),
    sender: entry(files['top/sender.json'].windows['7d'][0], files['top/sender.json'].windows['7d'][0]?.label ?? null),
    lane: busiest(d.day),
    fee_lane: busiest(d.day) && { ...busiest(d.day)!, fee_usd: Math.round((d.fee_usd ?? 0) * 30) / 100 },
    fee_chain: entry(fees7d[0], null),
  })),
  weeks: [{ week: lastMonday, fee_chains: fees7d.slice(0, 3).map((e: any) => entry(e, null)) }],
}));
const load = async (name: keyof typeof PUBLIC_SCHEMAS) => (PUBLIC_SCHEMAS[name] as any).parse(files[name]);
const icon = async (selector: string) => {
  const href = iconHref(selector);
  if (!href) return null;
  const bytes = await readFile(path.join('<repo>/site/public', href));
  return `data:${href.endsWith('.png') ? 'image/png' : 'image/svg+xml'};base64,${bytes.toString('base64')}`;
};
const history = await load('history.json');
const recordDay = [...history.days].reverse().find((d: { day: string }) => recordsSetOn(history.days, history.largest_fees ?? [], d.day).length > 0)?.day;
const record = recordDay ? recordsSetOn(history.days, history.largest_fees ?? [], recordDay)[0] : null;
const milestone = trackedMilestones(history.days).at(-1);
const deposit = [...files['reserve.json'].transfers].reverse().find((t: any) => t.direction === 'in' && t.link >= 1000);
const monday = files['day-leaders.json'].weeks.at(-1).week;
const targets: [string, any][] = [
  ['daily', { kind: 'daily', day: lastDay }],
  ['weekly', { kind: 'weekly', monday }],
  ...(record ? [['record', { kind: 'record', record: record.kind, day: record.day }] as [string, any]] : []),
  ...(milestone ? [['milestone', { kind: 'milestone', metric: milestone.metric, threshold: milestone.threshold }] as [string, any]] : []),
  ...(deposit ? [['reserve', { kind: 'reserve', tx: deposit.tx }] as [string, any]] : []),
];
await mkdir(OUT, { recursive: true });
for (const [name, target] of targets) {
  const started = performance.now();
  const tree = await broadcastTree(target, { load: load as any, icon });
  if (!tree) {
    console.log(`${name}: no card (404)`);
    continue;
  }
  const png = await render(tree as never, { width: 1200, height: 675, fonts: CARD_FONTS as never, loadAdditionalAsset: async () => [] }).asPng();
  await writeFile(path.join(OUT, `${name}.png`), png.image);
  console.log(`${name}: ${path.join(OUT, `${name}.png`)} in ${Math.round(performance.now() - started)} ms`);
}
```

2. From `site/`, run `../node_modules/.bin/tsx <scratch>/preview-cards.mts <scratch>/cards`. Expected: one line per card with its path and render time.
3. Open each PNG with the Read tool and compare it with the mockup the task names (`fixes-coins-reserve.html` for daily and Reserve, `cards-weekly-record-reserve.html` for weekly and record). Describe what differs in the task report.

---

### Task 1: Finalize at 00:07 UTC

**Files:**
- Modify: `worker/wrangler.toml` (`[triggers] crons`)
- Modify: `worker/src/index.ts` (the `JOBS` key)
- Modify: `worker/src/jobs/finalize.ts` (the `RETRY_WINDOW_MS` comment)
- Modify: `scripts/backfill/fees/upload.ts` (the `inFinalizeWindow` comment)
- Modify: `docs/runbook.md`, `docs/methodology.md` (every "00:10")
- Test: `worker/test/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `JOBS['7 0 * * *']` runs `runFinalize(c, 'early')`; `JOBS['10 0 * * *']` no longer exists.

- [ ] **Step 1: Write the failing test.** In `worker/test/index.test.ts`, change the last test to:

```ts
  it('has jobs for exactly the crons declared in wrangler.toml, with the early finalize at 00:07', () => {
    // #when
    const crons = Object.keys(JOBS).sort();
    // #then
    expect(crons).toEqual(['* * * * *', '*/5 * * * *', '0 * * * *', '0 6 * * *', '7 0 * * *']);
  });
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @ccip-dev/worker exec vitest run test/index.test.ts`. Expected: FAIL, the keys still hold `'10 0 * * *'`.

- [ ] **Step 3: Move the cron.**
  - In `worker/wrangler.toml`, change the crons line to `crons = ["* * * * *", "*/5 * * * *", "0 * * * *", "7 0 * * *", "0 6 * * *"]`.
  - In `worker/src/index.ts`, change `'10 0 * * *': [['finalize', (c) => runFinalize(c, 'early')]],` to `'7 0 * * *': [['finalize', (c) => runFinalize(c, 'early')]],`.
  - In `worker/src/jobs/finalize.ts`, in the `RETRY_WINDOW_MS` comment, change "a day held past D+3 00:10" to "a day held past D+3 00:07".
  - In `scripts/backfill/fees/upload.ts`, change the comment to `/** The Worker finalizes at 00:07 and 06:00 UTC; D1 is unavailable while a file imports, so no file starts near either run. */`. The window itself (23:55–00:30) stays.

- [ ] **Step 4: Change the docs.**
  - Run `grep -n "00:10" docs/runbook.md docs/methodology.md`. Expected: `methodology.md` lines 8 and 77, and `runbook.md` lines 97, 161, 162, 169, 173, 182, 184, 324 and 359.
  - Replace every "00:10" with "00:07" in both files.
  - In `docs/runbook.md` ("Re-finalize a day", Pacing), change "Yesterday's 00:07 finalize, which the 00:15 daily post reads, is late by about N/2 days." to "Yesterday's 00:07 finalize, which the daily broadcast follows, is late by about N/2 days."
  - Run `grep -rn "00:10" docs/runbook.md docs/methodology.md worker/src scripts/backfill`. Expected: no output.

- [ ] **Step 5: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/worker test && pnpm exec vitest run scripts/test/fees-upload.test.ts && pnpm typecheck`. Expected: all pass. The finalize tests call `runFinalize` directly, so the cron key does not affect them.

- [ ] **Step 6: Commit.**

```bash
git add worker/wrangler.toml worker/src/index.ts worker/src/jobs/finalize.ts worker/test/index.test.ts scripts/backfill/fees/upload.ts docs/runbook.md docs/methodology.md
git commit -m "feat(worker): finalize at 00:07 UTC, so the daily broadcast goes out earlier"
```

---

### Task 2: Formatters, chain names and records move to core

**Files:**
- Move: `site/src/lib/format.ts` → `packages/core/src/format.ts`
- Move: `site/src/lib/names.ts` → `packages/core/src/names.ts`
- Move: `site/src/lib/records.ts` → `packages/core/src/records.ts`, then fix its imports
- Create: `site/src/lib/format.ts`, `site/src/lib/names.ts`, `site/src/lib/records.ts` (re-exports)
- Modify: `packages/core/package.json` (`exports`)
- Move: `site/test/format.test.ts`, `site/test/names.test.ts`, `site/test/records.test.ts` → `packages/core/test/`, then fix their imports
- Create: `site/test/core-reexports.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `@ccip-dev/core/format`, `@ccip-dev/core/names` and `@ccip-dev/core/records`: the same exports the site files had, unchanged (`formatUsd`, `formatFee`, `formatFeeTotal`, `formatShare`, `formatCount`, `formatCompactCount`, `formatPct`, `formatLink`, `formatUtcDay`, `linkShareText`, …; `chainNameMap`, `chainName`, `laneLabel`, `shortAddress`, `shortChainName`, `type ChainNames`, …; `computeRecords`, `computeFeeRecords`, `computeMilestones`, `computeFeeMilestones`, `messageThresholds`, `valueThresholds`, `feeThresholds`, `formatThresholdUsd`, `LINK_SHARE_MIN_MESSAGES`, `type FeeDayStats`, `type MilestoneKind`, …).
  - The modules are subpath exports only, not in `@ccip-dev/core`'s index, because core's `replay.ts` already exports a different `ChainNames`.
  - `site/src/lib/{format,names,records}.ts` re-export them, so every site import keeps working.

- [ ] **Step 1: Move the tests and write the re-export test.**
  - Run `git mv site/test/format.test.ts packages/core/test/format.test.ts && git mv site/test/names.test.ts packages/core/test/names.test.ts && git mv site/test/records.test.ts packages/core/test/records.test.ts`.
  - In the three moved files, change the imports `'../src/lib/format'` → `'../src/format'`, `'../src/lib/names'` → `'../src/names'` and `'../src/lib/records'` → `'../src/records'`.
  - Create `site/test/core-reexports.test.ts`:

```ts
import * as coreFormat from '@ccip-dev/core/format';
import * as coreNames from '@ccip-dev/core/names';
import * as coreRecords from '@ccip-dev/core/records';
import { describe, expect, it } from 'vitest';
import * as format from '../src/lib/format';
import * as names from '../src/lib/names';
import * as records from '../src/lib/records';

describe('site re-exports of the core modules', () => {
  it('serves the very functions core exports, so posts and pages format alike', () => {
    // #when
    const same = [format.formatUsd === coreFormat.formatUsd, names.laneLabel === coreNames.laneLabel, records.computeRecords === coreRecords.computeRecords];
    // #then
    expect(same).toEqual([true, true, true]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**
  - Run `pnpm --filter @ccip-dev/core exec vitest run test/format.test.ts test/names.test.ts test/records.test.ts`. Expected: FAIL, the modules do not exist in core.
  - Run `pnpm --filter @ccip-dev/site exec vitest run test/core-reexports.test.ts`. Expected: FAIL, `@ccip-dev/core/format` cannot be resolved.

- [ ] **Step 3: Move the modules.**
  - Run `git mv site/src/lib/format.ts packages/core/src/format.ts && git mv site/src/lib/names.ts packages/core/src/names.ts && git mv site/src/lib/records.ts packages/core/src/records.ts`.
  - In `packages/core/src/records.ts`, replace the four import lines with:

```ts
import { formatCount, formatDuration, formatLink, formatUsd, linkShareText } from './format';
import { laneLabel, shortChainName, type ChainNames } from './names';
import type { DayTotals, LargestFee } from './public';
import { addDays } from './time';
```

  - In `packages/core/package.json`, change `exports` to:

```json
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing.ts",
    "./public": "./src/public.ts",
    "./time": "./src/time.ts",
    "./format": "./src/format.ts",
    "./names": "./src/names.ts",
    "./records": "./src/records.ts"
  },
```

  - Create `site/src/lib/format.ts` with `export * from '@ccip-dev/core/format';`, `site/src/lib/names.ts` with `export * from '@ccip-dev/core/names';` and `site/src/lib/records.ts` with `export * from '@ccip-dev/core/records';`.

- [ ] **Step 4: Run the tests, typecheck and build.** Run `pnpm --filter @ccip-dev/core test && pnpm --filter @ccip-dev/site test && pnpm typecheck && pnpm --filter @ccip-dev/site build`. Expected:
  - All pass, including the moved suites in core and every site suite that imports `../src/lib/{format,names,records}`.
  - `check-build` prints the same page count as before.
  - Home JavaScript is within 0.5 KB of before and under 150 KB.

- [ ] **Step 5: Commit.** The `git mv` commands already staged the moves.

```bash
git add packages/core/package.json packages/core/src/format.ts packages/core/src/names.ts packages/core/src/records.ts packages/core/test/format.test.ts packages/core/test/names.test.ts packages/core/test/records.test.ts site/src/lib/format.ts site/src/lib/names.ts site/src/lib/records.ts site/test/core-reexports.test.ts
git commit -m "refactor(core): move the formatters, chain names and record logic to core, so the Worker and the site share them"
```

---

### Task 3: Handle tables: token → project and chain → handle

**Files:**
- Modify: `packages/core/src/labels.ts` (`LabelProject.tokens`, `ChainHandles`, `validateChainHandles`, `Handles`, `buildHandles`, token checks in `validateRegistry`)
- Create: `labels/chain-x.json` (`{}` until the owner-reviewed research, Task 12)
- Modify: `scripts/build-labels.ts`
- Create: `worker/src/generated/handles.json` (written by `pnpm labels:build`)
- Create: `worker/src/handles.ts`
- Modify: `worker/src/context.ts`, `worker/test/helpers.ts` (`handles` in the run context)
- Modify: `scripts/label-candidates.ts`, `.github/workflows/label-candidates.yml`
- Create: `labels/handle-gaps.md` (written weekly by the job)
- Modify: `docs/runbook.md` (new section "Labels and handles")
- Test: `packages/core/test/labels.test.ts`, `scripts/test/label-candidates.test.ts`, `worker/test/handles.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - In core (`@ccip-dev/core`):
    - `LabelProject.tokens: { chain: string; address: string; source: string }[]`;
    - `ChainHandles = Record<string, { x: string; source: string }>`;
    - `validateChainHandles(text: string, chainNames: ReadonlySet<string>, file?: string): { handles: ChainHandles; errors: string[] }`;
    - `interface TokenHandle { chain: string; address: string; project: string; x: string }` and `interface Handles { chains: Record<string, string>; tokens: TokenHandle[] }`;
    - `buildHandles(projects: LabelProject[], chains: ChainHandles): Handles`.
  - `worker/src/handles.ts`: `bundledHandles: Handles`.
  - `RunContext.handles: Handles`; `createRunContext` overrides accept `handles`; `harness({ handles })` defaults to `{ chains: {}, tokens: [] }`.
  - `scripts/label-candidates.ts`:
    - `type TokenGap`, `type ChainGap`, `type HandleGroup`;
    - `tokenGapQuery(sinceDay, limit)`, `chainGapQuery(sinceDay, byValue, byFees)`, `handleGroupQuery(tokens)`;
    - `handleGaps(tokens, chains, handles, groups)` and `handleGapsMarkdown(gaps, weekOf)`.

- [ ] **Step 1: Write the failing core tests.** In `packages/core/test/labels.test.ts`, change the import to `import { buildHandles, buildLabelIndex, labelKey, toChecksumAddress, validateChainHandles, validateRegistry } from '../src/labels';` and add:

```ts
describe('token entries', () => {
  const SYRUP = '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b';
  const withToken = (source: string, address = SYRUP, chain = 'ethereum-mainnet') =>
    `${project(LINK)}\n[[tokens]]\nchain = "${chain}"\naddress = "${address}"\nsource = "${source}"\n`;

  it('accepts a token with an https source', () => {
    // #when
    const { errors, projects } = validateRegistry([{ file: 'maple.toml', text: withToken('https://docs.maple.finance/syrup') }], chains);
    // #then
    expect({ errors, tokens: projects[0]?.tokens }).toEqual({ errors: [], tokens: [{ chain: 'ethereum-mainnet', address: SYRUP, source: 'https://docs.maple.finance/syrup' }] });
  });

  it('rejects a token without an https source, on an unknown chain, or claimed by two projects', () => {
    // #when
    const http = validateRegistry([{ file: 'a.toml', text: withToken('http://maple.finance') }], chains).errors;
    const unknown = validateRegistry([{ file: 'b.toml', text: withToken('https://maple.finance', SYRUP, 'not-a-chain') }], chains).errors;
    const twice = validateRegistry(
      [
        { file: 'c.toml', text: withToken('https://maple.finance') },
        { file: 'd.toml', text: withToken('https://maple.finance', toChecksumAddress(SYRUP)).replace(LINK, '0x1111111111111111111111111111111111111111') },
      ],
      chains,
    ).errors;
    // #then the second claim is caught whatever the address's letter case
    expect({ http, unknown, twice }).toEqual({
      http: ['a.toml: tokens.0.source: must be an https URL'],
      unknown: ['b.toml: unknown CCIP chain "not-a-chain" for a token'],
      twice: [`d.toml: token ethereum-mainnet ${SYRUP} already belongs to c.toml`],
    });
  });
});

describe('validateChainHandles', () => {
  it('accepts handles with an https source on known chains', () => {
    // #when
    const result = validateChainHandles('{"ethereum-mainnet":{"x":"ethereum","source":"https://ethereum.org"}}', chains);
    // #then
    expect(result).toEqual({ handles: { 'ethereum-mainnet': { x: 'ethereum', source: 'https://ethereum.org' } }, errors: [] });
  });

  it('names the file and the problem for an unknown chain, a bad handle, a non-https source and broken JSON', () => {
    // #when
    const unknown = validateChainHandles('{"mars-mainnet":{"x":"mars","source":"https://mars.io"}}', chains).errors;
    const handle = validateChainHandles('{"ethereum-mainnet":{"x":"@ethereum","source":"https://ethereum.org"}}', chains).errors;
    const source = validateChainHandles('{"ethereum-mainnet":{"x":"ethereum","source":"http://ethereum.org"}}', chains).errors;
    const json = validateChainHandles('{', chains).errors;
    // #then
    expect({ unknown, handle, source, json: json.map((e) => e.startsWith('labels/chain-x.json: invalid JSON: ')) }).toEqual({
      unknown: ['labels/chain-x.json: unknown CCIP chain "mars-mainnet"'],
      handle: ['labels/chain-x.json: ethereum-mainnet.x: Invalid string: must match pattern /^[A-Za-z0-9_]{1,15}$/'],
      source: ['labels/chain-x.json: ethereum-mainnet.source: must be an https URL'],
      json: [true],
    });
  });
});

describe('buildHandles', () => {
  it('maps chains to handles and keeps tokens of verified projects with a handle, lowercased', () => {
    // #given a verified project with a checksummed token address, and a draft with a token
    const MIXED = toChecksumAddress('0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b');
    const token = (verified: boolean, address: string) =>
      `name = "Maple"\nx = "maplefinance"\nkind = "issuer"\nverified = ${verified}\n\n[[tokens]]\nchain = "ethereum-mainnet"\naddress = "${address}"\nsource = "https://maple.finance"\n`;
    const { projects } = validateRegistry([{ file: 'maple.toml', text: token(true, MIXED) }, { file: '_draft.toml', text: token(false, '0x2222222222222222222222222222222222222222') }], chains);
    // #when
    const handles = buildHandles(projects, { 'ethereum-mainnet-base-1': { x: 'base', source: 'https://base.org' } });
    // #then
    expect(handles).toEqual({
      chains: { 'ethereum-mainnet-base-1': 'base' },
      tokens: [{ chain: 'ethereum-mainnet', address: MIXED.toLowerCase(), project: 'Maple', x: 'maplefinance' }],
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @ccip-dev/core exec vitest run test/labels.test.ts`. Expected: FAIL. `validateChainHandles` and `buildHandles` are not exported, and `[[tokens]]` with `chain` is rejected by the strict `{ group }` schema.

- [ ] **Step 3: Implement the tables** in `packages/core/src/labels.ts`.
  - Replace the `LabelProject` definition with:

```ts
const XHandle = z.string().regex(/^[A-Za-z0-9_]{1,15}$/);
const Source = z.string().regex(/^https:\/\/\S+$/, 'must be an https URL');

export const LabelProject = z.strictObject({
  name: z.string().min(1).max(64),
  x: XHandle.optional(),
  url: z.url().optional(),
  kind: z.enum(['protocol', 'app', 'institution', 'exchange', 'issuer', 'unknown']),
  verified: z.boolean(),
  addresses: z
    .array(z.strictObject({ chain: z.string(), address: z.string(), note: z.string().max(120).optional() }))
    .default([]),
  /** Tokens the project issues. One entry covers every chain in the token's CCIP registry group. */
  tokens: z.array(z.strictObject({ chain: z.string(), address: z.string(), source: Source })).default([]),
});
export type LabelProject = z.output<typeof LabelProject>;

export const ChainHandles = z.record(z.string(), z.strictObject({ x: XHandle, source: Source }));
export type ChainHandles = z.output<typeof ChainHandles>;

export interface TokenHandle {
  chain: string;
  address: string;
  project: string;
  x: string;
}

export interface Handles {
  chains: Record<string, string>;
  tokens: TokenHandle[];
}
```

  - In `validateRegistry`, after `const claimedBy = new Map<string, string>();` add `const tokenClaimedBy = new Map<string, string>();`, and after the `for (const { chain, address } of result.data.addresses) { … }` loop add:

```ts
    for (const { chain, address } of result.data.tokens) {
      if (!chainNames.has(chain)) errors.push(`${file}: unknown CCIP chain "${chain}" for a token`);
      if (isAddressShape('EVM', address) && hasMixedCase(address) && toChecksumAddress(address) !== address) {
        errors.push(`${file}: bad EIP-55 checksum for token ${address}`);
      }
      const key = labelKey(chain, address);
      const owner = tokenClaimedBy.get(key);
      if (owner) errors.push(`${file}: token ${chain} ${normalizeAddress(address)} already belongs to ${owner}`);
      else tokenClaimedBy.set(key, file);
    }
```

  - After `buildLabelIndex`, add:

```ts
export function validateChainHandles(
  text: string,
  chainNames: ReadonlySet<string>,
  file = 'labels/chain-x.json',
): { handles: ChainHandles; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { handles: {}, errors: [`${file}: invalid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const result = ChainHandles.safeParse(data);
  if (!result.success) {
    return { handles: {}, errors: result.error.issues.map((i) => `${file}: ${i.path.map(String).join('.') || '(root)'}: ${i.message}`) };
  }
  const errors = Object.keys(result.data).filter((name) => !chainNames.has(name)).map((name) => `${file}: unknown CCIP chain "${name}"`);
  return { handles: result.data, errors };
}

/** Only a verified project with a handle tags its tokens; anything else is written as its plain name. */
export function buildHandles(projects: LabelProject[], chains: ChainHandles): Handles {
  return {
    chains: Object.fromEntries(Object.entries(chains).map(([name, handle]) => [name, handle.x])),
    tokens: projects.flatMap((p) => {
      const x = p.x;
      if (!p.verified || !x) return [];
      return p.tokens.map((t) => ({ chain: t.chain, address: normalizeAddress(t.address), project: p.name, x }));
    }),
  };
}
```

  If the zod message for the handle pattern differs from `Invalid string: must match pattern /^[A-Za-z0-9_]{1,15}$/` in your zod 4 version, update only that expected string in Step 1, to the exact message zod prints.

- [ ] **Step 4: Run the core tests.** Run `pnpm --filter @ccip-dev/core test`. Expected: PASS.

- [ ] **Step 5: Compile the tables.**
  - Create `labels/chain-x.json` containing `{}` and a final newline.
  - In `scripts/build-labels.ts`, change the core import to `import { buildHandles, buildLabelIndex, validateChainHandles, validateRegistry } from '@ccip-dev/core';`, and replace everything from `if (errors.length > 0) {` to the end with:

```ts
const chainFile = await readFile(path.join(ROOT, 'labels/chain-x.json'), 'utf8');
const { handles: chainHandles, errors: chainErrors } = validateChainHandles(chainFile, chainNames);
const allErrors = [...errors, ...chainErrors];

if (allErrors.length > 0) {
  for (const e of allErrors) console.error(e);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`labels ok: ${projects.length} project file(s), ${Object.keys(chainHandles).length} chain handle(s)`);
} else {
  const generated = path.join(ROOT, 'worker/src/generated');
  await mkdir(generated, { recursive: true });
  const index = buildLabelIndex(projects);
  await writeFile(path.join(generated, 'labels.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote ${Object.keys(index).length} verified address label(s) to worker/src/generated/labels.json`);
  const handles = buildHandles(projects, chainHandles);
  await writeFile(path.join(generated, 'handles.json'), `${JSON.stringify(handles, null, 2)}\n`);
  console.log(`wrote ${Object.keys(handles.chains).length} chain handle(s) and ${handles.tokens.length} token handle(s) to worker/src/generated/handles.json`);
}
```

  - Run `pnpm labels:check && pnpm labels:build`. Expected: `labels ok: 19 project file(s), 0 chain handle(s)`, then the two `wrote …` lines; `worker/src/generated/handles.json` is `{ "chains": {}, "tokens": [] }` and `labels.json` is unchanged (`git diff --stat worker/src/generated/labels.json` prints nothing).

- [ ] **Step 6: Write the failing Worker test.** Create `worker/test/handles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bundledHandles } from '../src/handles';
import { harness } from './helpers';

describe('handles in the run context', () => {
  it('bundles the compiled tables, and tests start from empty ones', () => {
    // #when
    const { c } = harness({ now: '2026-10-11T00:07:00.000Z' });
    // #then
    expect({ bundled: Object.keys(bundledHandles).sort(), test: c.handles }).toEqual({ bundled: ['chains', 'tokens'], test: { chains: {}, tokens: [] } });
  });
});
```

  Run `pnpm --filter @ccip-dev/worker exec vitest run test/handles.test.ts`. Expected: FAIL, `../src/handles` does not exist.

- [ ] **Step 7: Put the handles in the run context.**
  - Create `worker/src/handles.ts`:

```ts
import type { Handles } from '@ccip-dev/core';
import bundled from './generated/handles.json';

export const bundledHandles: Handles = bundled as Handles;
```

  - In `worker/src/context.ts`:
    - add `type Handles` to the `@ccip-dev/core` import and `import { bundledHandles } from './handles';`;
    - add `handles: Handles;` to `RunContext`;
    - change the overrides type to `Partial<Pick<RunContext, 'ccip' | 'prices' | 'coingecko' | 'alert' | 'labels' | 'handles'>>`;
    - add `handles: overrides.handles ?? bundledHandles,` after `labels`.
  - In `worker/test/helpers.ts`:
    - add `type Handles` to the `@ccip-dev/core` import;
    - add `handles?: Handles;` to the `harness` options;
    - pass `handles: opts.handles ?? { chains: {}, tokens: [] },` in the `createRunContext` overrides, after `labels`.

- [ ] **Step 8: Run the Worker tests.** Run `pnpm --filter @ccip-dev/worker test`. Expected: PASS.

- [ ] **Step 9: Write the failing label-candidates tests.** In `scripts/test/label-candidates.test.ts`, add `chainGapQuery, handleGaps, handleGapsMarkdown, handleGroupQuery, tokenGapQuery,` to the `../label-candidates` import, and add at the end:

```ts
describe('handle gaps', () => {
  const tables = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE daily_breakdown (day TEXT, dim TEXT, key TEXT, messages INTEGER, usd_value REAL, fee_usd REAL);
      CREATE TABLE tokens (chain TEXT, address TEXT, symbol TEXT, group_id TEXT);
      CREATE TABLE chains (selector TEXT, name TEXT);
    `);
    const breakdown = db.prepare('INSERT INTO daily_breakdown VALUES (?, ?, ?, 1, ?, ?)');
    return { db, breakdown };
  };

  it('lists the busiest tokens of the window with their symbol, group and chain', () => {
    // #given two tokens this week and a bigger one before the window
    const { db, breakdown } = tables();
    db.prepare('INSERT INTO chains VALUES (?, ?)').run('1', 'ethereum-mainnet');
    db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?)').run('1', '0xAbC', 'syrupUSDC', 'syrup');
    breakdown.run('2026-10-01', 'token', '1:0xabc', 600, null);
    breakdown.run('2026-10-02', 'token', '1:0xabc', 400, null);
    breakdown.run('2026-10-02', 'token', '1:0xdef', 900, null);
    breakdown.run('2026-09-01', 'token', '1:0x999', 5000, null);
    // #when
    const q = tokenGapQuery('2026-09-30', 10);
    const rows = db.prepare(q.sql).all(...q.params) as any[];
    // #then
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { key: '1:0xabc', usd: 1000, symbol: 'syrupUSDC', group_id: 'syrup', chain_name: 'ethereum-mainnet' },
      { key: '1:0xdef', usd: 900, symbol: null, group_id: null, chain_name: 'ethereum-mainnet' },
    ]);
  });

  it('lists the chains that move the most value or pay the most fees', () => {
    // #given chain 3 moves little value but pays the most fees
    const { db, breakdown } = tables();
    for (const [selector, name] of [['1', 'ethereum-mainnet'], ['2', 'ethereum-mainnet-base-1'], ['3', 'binance_smart_chain-mainnet']]) {
      db.prepare('INSERT INTO chains VALUES (?, ?)').run(selector, name);
    }
    breakdown.run('2026-10-01', 'src_chain', '1', 1000, 1);
    breakdown.run('2026-10-01', 'dst_chain', '2', 500, null);
    breakdown.run('2026-10-01', 'src_chain', '3', 10, 99);
    // #when
    const q = chainGapQuery('2026-09-30', 2, 1);
    const rows = db.prepare(q.sql).all(...q.params) as any[];
    // #then
    expect(rows.map((r) => r.chain_name)).toEqual(['binance_smart_chain-mainnet', 'ethereum-mainnet', 'ethereum-mainnet-base-1']);
  });

  it('reads the registry group of each token entry by chain name and address', () => {
    // #given
    const { db } = tables();
    db.prepare('INSERT INTO chains VALUES (?, ?)').run('1', 'ethereum-mainnet');
    db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?)').run('1', '0xAbC', 'syrupUSDC', 'syrup');
    // #when
    const q = handleGroupQuery([{ chain: 'ethereum-mainnet', address: '0xABC' }]);
    const rows = db.prepare(q.sql).all(...q.params) as any[];
    // #then
    expect(rows.map((r) => ({ ...r }))).toEqual([{ chain_name: 'ethereum-mainnet', address: '0xabc', group_id: 'syrup' }]);
  });

  it('keeps only the tokens no entry covers, by group or by address, and the chains with no handle', () => {
    // #given
    const token = (key: string, group: string | null) => ({ key, usd: 1, symbol: 'T', group_id: group, chain_name: 'ethereum-mainnet' });
    const handles = { chains: { 'ethereum-mainnet': 'ethereum' }, tokens: [{ chain: 'ethereum-mainnet', address: '0xbbb', project: 'B', x: 'b' }] };
    // #when
    const gaps = handleGaps(
      [token('1:0xaaa', 'syrup'), token('1:0xBBB', null), token('1:0xccc', null)],
      [{ selector: '1', chain_name: 'ethereum-mainnet' }, { selector: '2', chain_name: 'ethereum-mainnet-base-1' }, { selector: '9', chain_name: null }],
      handles,
      [{ chain_name: 'ethereum-mainnet', address: '0xbbb', group_id: 'syrup' }],
    );
    // #then
    expect({ tokens: gaps.tokens.map((t) => t.key), chains: gaps.chains.map((c) => c.selector) }).toEqual({ tokens: ['1:0xccc'], chains: ['2', '9'] });
  });

  it('writes the gaps for the pull request with escaped cells, and says when there are none', () => {
    // #when
    const some = handleGapsMarkdown(
      { tokens: [{ key: '1:0xccc', usd: 1234.5, symbol: 'T|X', group_id: null, chain_name: 'ethereum-mainnet' }], chains: [{ selector: '2', chain_name: 'ethereum-mainnet-base-1' }] },
      '2026-10-12',
    );
    const none = handleGapsMarkdown({ tokens: [], chains: [] }, '2026-10-12');
    // #then
    expect({
      heading: some.startsWith('## Handles to research'),
      token: some.includes('| T\\|X | ethereum-mainnet | 0xccc | - | 1,235 |'),
      chain: some.includes('| ethereum-mainnet-base-1 | 2 |'),
      none: none.includes('Nothing to research this week.'),
    }).toEqual({ heading: true, token: true, chain: true, none: true });
  });
});
```

  Run `pnpm exec vitest run scripts/test/label-candidates.test.ts`. Expected: FAIL, the five functions are not exported.

- [ ] **Step 10: Implement the gaps** in `scripts/label-candidates.ts`.
  - Change the core import to `import { addDays, buildHandles, dayOf, isAddressShape, labelKey, sanitize, validateChainHandles, validateRegistry, type Handles } from '@ccip-dev/core';`.
  - After `prBody`, add:

```ts
export interface TokenGap {
  key: string;
  usd: number;
  symbol: string | null;
  group_id: string | null;
  chain_name: string | null;
}

export interface ChainGap {
  selector: string;
  chain_name: string | null;
}

export interface HandleGroup {
  chain_name: string;
  address: string;
  group_id: string | null;
}

export const GAP_TOKENS = 10;
export const GAP_CHAINS_BY_VALUE = 12;
export const GAP_CHAINS_BY_FEES = 5;

export function tokenGapQuery(sinceDay: string, limit: number) {
  return {
    sql: `WITH top AS (
            SELECT key, SUM(usd_value) AS usd FROM daily_breakdown WHERE dim = 'token' AND day >= ?1 GROUP BY key ORDER BY usd DESC LIMIT ?2
          )
          SELECT top.key AS key, top.usd AS usd, t.symbol AS symbol, t.group_id AS group_id, c.name AS chain_name
          FROM top
          LEFT JOIN tokens t ON t.chain || ':' || lower(t.address) = lower(top.key)
          LEFT JOIN chains c ON c.selector = substr(top.key, 1, instr(top.key, ':') - 1)
          ORDER BY top.usd DESC`,
    params: [sinceDay, limit],
  };
}

export function chainGapQuery(sinceDay: string, byValue: number, byFees: number) {
  return {
    sql: `WITH by_value AS (
            SELECT key FROM daily_breakdown WHERE dim IN ('src_chain', 'dst_chain') AND day >= ?1
            GROUP BY key ORDER BY SUM(usd_value) DESC LIMIT ?2
          ), by_fees AS (
            SELECT key FROM daily_breakdown WHERE dim = 'src_chain' AND day >= ?1
            GROUP BY key HAVING SUM(fee_usd) IS NOT NULL ORDER BY SUM(fee_usd) DESC LIMIT ?3
          )
          SELECT k.key AS selector, c.name AS chain_name
          FROM (SELECT key FROM by_value UNION SELECT key FROM by_fees) k LEFT JOIN chains c ON c.selector = k.key
          ORDER BY c.name`,
    params: [sinceDay, byValue, byFees],
  };
}

export function handleGroupQuery(tokens: readonly { chain: string; address: string }[]) {
  return {
    sql: `SELECT c.name AS chain_name, lower(t.address) AS address, t.group_id AS group_id
          FROM tokens t JOIN chains c ON c.selector = t.chain
          WHERE c.name || ':' || lower(t.address) IN (SELECT value FROM json_each(?))`,
    params: [JSON.stringify(tokens.map((t) => `${t.chain}:${t.address.toLowerCase()}`))],
  };
}

/** A token is covered when an entry shares its registry group or its address; a chain when chain-x.json names it. */
export function handleGaps(
  tokens: readonly TokenGap[],
  chains: readonly ChainGap[],
  handles: Handles,
  groups: readonly HandleGroup[],
): { tokens: TokenGap[]; chains: ChainGap[] } {
  const coveredGroups = new Set(groups.flatMap((g) => (g.group_id === null ? [] : [g.group_id])));
  const coveredKeys = new Set(handles.tokens.map((t) => `${t.chain}:${t.address.toLowerCase()}`));
  const address = (key: string) => key.slice(key.indexOf(':') + 1).toLowerCase();
  return {
    tokens: tokens.filter((t) => !(t.group_id !== null && coveredGroups.has(t.group_id)) && !coveredKeys.has(`${t.chain_name}:${address(t.key)}`)),
    chains: chains.filter((c) => c.chain_name === null || !Object.hasOwn(handles.chains, c.chain_name)),
  };
}

export function handleGapsMarkdown(gaps: { tokens: readonly TokenGap[]; chains: readonly ChainGap[] }, weekOf: string): string {
  const intro = [
    '## Handles to research',
    '',
    `Week of ${weekOf}, regenerated by the weekly label-candidates job.`,
    '',
    "Add a handle only with a source: the project's or chain's own website or docs, on a page that links to the X account (for a token, a page that lists its address). Tokens go in the issuing project's file as `[[tokens]]` (`chain`, `address`, `source`); chains go in `labels/chain-x.json`. Leave out anything you cannot verify; it stays a plain name. See docs/runbook.md, \"Labels and handles\".",
    '',
  ];
  if (gaps.tokens.length === 0 && gaps.chains.length === 0) return [...intro, 'Nothing to research this week.', ''].join('\n');
  return [
    ...intro,
    '### Tokens without a project',
    '',
    '| Token | Chain | Address | Group | USD (7d) |',
    '|---|---|---|---|---|',
    ...gaps.tokens.map(
      (t) =>
        `| ${escapeMarkdownCell(t.symbol ?? '-')} | ${escapeMarkdownCell(t.chain_name ?? '-')} | ${escapeMarkdownCell(t.key.slice(t.key.indexOf(':') + 1))} | ` +
        `${escapeMarkdownCell(t.group_id ?? '-')} | ${Math.round(t.usd).toLocaleString('en-US')} |`,
    ),
    '',
    '### Chains without an X handle',
    '',
    '| Chain | Selector |',
    '|---|---|',
    ...gaps.chains.map((c) => `| ${escapeMarkdownCell(c.chain_name ?? '-')} | ${escapeMarkdownCell(c.selector)} |`),
    '',
  ].join('\n');
}
```

  - After `labeledKeys`, add:

```ts
async function currentHandles(): Promise<Handles> {
  const dir = path.join(ROOT, 'labels/projects');
  const files = await Promise.all(
    (await readdir(dir)).filter((f) => f.endsWith('.toml')).map(async (f) => ({ file: f, text: await readFile(path.join(dir, f), 'utf8') })),
  );
  const chains = new Set<string>(JSON.parse(await readFile(path.join(ROOT, 'labels/ccip-chains.json'), 'utf8')));
  const chainHandles = validateChainHandles(await readFile(path.join(ROOT, 'labels/chain-x.json'), 'utf8'), chains).handles;
  return buildHandles(validateRegistry(files, chains).projects, chainHandles);
}
```

  - In `main()`, replace the last two lines before the closing brace (`await writeFile(path.join(ROOT, 'pr-body.md'), prBody(rows, today));` and the `console.log`) with:

```ts
  const handles = await currentHandles();
  const tq = tokenGapQuery(since, GAP_TOKENS);
  const cq = chainGapQuery(since, GAP_CHAINS_BY_VALUE, GAP_CHAINS_BY_FEES);
  const gq = handleGroupQuery(handles.tokens);
  const gaps = handleGaps(
    await d1<TokenGap>(tq.sql, tq.params),
    await d1<ChainGap>(cq.sql, cq.params),
    handles,
    handles.tokens.length === 0 ? [] : await d1<HandleGroup>(gq.sql, gq.params),
  );
  const gapsMarkdown = handleGapsMarkdown(gaps, today);
  await writeFile(path.join(ROOT, 'labels/handle-gaps.md'), gapsMarkdown);
  await writeFile(path.join(ROOT, 'pr-body.md'), `${prBody(rows, today)}\n${gapsMarkdown}`);
  console.log(`${rows.length} candidate draft(s) written; ${gaps.tokens.length} token and ${gaps.chains.length} chain handle gap(s)`);
```

- [ ] **Step 11: Let the weekly PR carry the gaps.**
  - In `.github/workflows/label-candidates.yml`, in "Open or update the candidates PR", replace `git add labels/projects/_candidate-*.toml 2>/dev/null || true` with two lines:

```yaml
          git add labels/handle-gaps.md
          git add labels/projects/_candidate-*.toml 2>/dev/null || true
```

  - Create `labels/handle-gaps.md` with the output of `handleGapsMarkdown({ tokens: [], chains: [] }, '2026-10-11')`. That is the empty state; the job overwrites it weekly. Run:
    `pnpm exec tsx -e "import { handleGapsMarkdown } from './scripts/label-candidates.ts'; process.stdout.write(handleGapsMarkdown({ tokens: [], chains: [] }, '2026-10-11'))" > labels/handle-gaps.md`
  - Then run `head -3 labels/handle-gaps.md`. Expected: `## Handles to research`, a blank line, `Week of 2026-10-11, regenerated by the weekly label-candidates job.`

- [ ] **Step 12: Document it.** In `docs/runbook.md`, insert before `## Incidents and alerts`:

```markdown
## Labels and handles

Broadcasts tag the players they name with X handles kept in `labels/`. A player without a verified handle is written as its plain name.

- **Senders:** the `x` of a project with `verified = true` in `labels/projects/*.toml`.
- **Tokens:** a `[[tokens]]` entry (`chain`, `address`, `source`) in the issuing project's file. It covers every chain in the token's CCIP registry group. The project needs `verified = true` and an `x`; a project file may hold tokens and no addresses.
- **Chains:** `labels/chain-x.json` maps a CCIP chain name, as in `labels/ccip-chains.json`, to `{ "x": "<handle>", "source": "<https URL>" }`.
- **Verifying a handle:** the `source` must be the project's or chain's own website or docs, on a page that links to the X account. For a token, use a page of the project's that lists the token's address. Leave out anything you can't verify.
- **Check and build:** `pnpm labels:check` validates both tables (CI runs it); `pnpm labels:build` writes `worker/src/generated/labels.json` and `handles.json`. The deploy also runs it.
- **Weekly gaps:** the `label-candidates` job writes `labels/handle-gaps.md`, the busiest tokens with no project entry and the busiest chains with no handle, into its pull request. Research them there.
```

- [ ] **Step 13: Run everything.** Run `pnpm labels:check && pnpm --filter @ccip-dev/core test && pnpm --filter @ccip-dev/worker test && pnpm exec vitest run scripts/test/label-candidates.test.ts && pnpm typecheck`. Expected: all pass.

- [ ] **Step 14: Commit.**

```bash
git add packages/core/src/labels.ts packages/core/test/labels.test.ts labels/chain-x.json labels/handle-gaps.md scripts/build-labels.ts worker/src/generated/handles.json worker/src/handles.ts worker/src/context.ts worker/test/helpers.ts worker/test/handles.test.ts scripts/label-candidates.ts scripts/test/label-candidates.test.ts .github/workflows/label-candidates.yml docs/runbook.md
git commit -m "feat(labels): token and chain handle tables, compiled for the Worker, with weekly gaps for review"
```

---

### Task 4: Core broadcast logic

**Files:**
- Create: `packages/core/src/reserve-pace.ts`
- Modify: `packages/core/src/reserve-stats.ts` (use the pace helpers; `deposit` on each transfer view)
- Modify: `packages/core/src/public.ts` (`TransferViewSchema.deposit`)
- Modify: `packages/core/src/time.ts` (`isDay`)
- Modify: `packages/core/src/format.ts` (`formatLinkAmount`)
- Modify: `packages/core/src/records.ts` (record kinds, `recordValue`, `recordsSetOn`, `trackedMilestones`, `milestonesOn`)
- Create: `packages/core/src/broadcasts.ts`
- Modify: `packages/core/package.json` (`"./broadcasts"`)
- Test: `packages/core/test/broadcasts.test.ts`, `packages/core/test/records.test.ts`, `packages/core/test/reserve-stats.test.ts`, `packages/core/test/time.test.ts`, `packages/core/test/format.test.ts`

**Interfaces:**
- Consumes: the core modules from Task 2.
- Produces:
  - `reserve-pace.ts` (re-exported from `reserve-stats.ts`, so `@ccip-dev/core` has them):
    - `DEPOSIT_MIN_LINK`, `MILESTONE_STEP_LINK`, `DEPOSIT_STREAK_MAX_GAP_DAYS`;
    - `isDeposit(t: { direction: 'in' | 'out'; link: number }): boolean`;
    - `depositStreak(timestamps: readonly string[]): number`;
    - `nextMilestone(held: number, avgWeeklyLink: number | null, from: Date): { link: number; eta: string } | null`.
  - `reserveStats(…).transfers[i].deposit: boolean`; `TransferViewSchema.deposit` is optional.
  - `time.ts`: `isDay(value: string): boolean`.
  - `format.ts`: `formatLinkAmount(value: number | null | undefined): string`.
  - `records.ts`:
    - `RECORD_KINDS = ['messages', 'value', 'fees', 'largest_fee', 'link_share']` and `type RecordKind`;
    - `MILESTONE_METRICS = ['messages', 'value', 'fees']` and `type MilestoneMetric`;
    - `interface RecordValue { day: string; value: number }`;
    - `interface RecordSet { kind: RecordKind; day: string; value: number; previous: RecordValue; stoodDays: number }`;
    - `interface MilestoneSet { metric: MilestoneMetric; threshold: number; day: string; label: string }`;
    - `recordValue(kind, days: readonly FeeDayStats[], largest: readonly LargestFee[]): RecordValue | null`;
    - `recordsSetOn(days, largest, day: string): RecordSet[]`;
    - `trackedMilestones(days: readonly FeeDayStats[]): MilestoneSet[]` and `milestonesOn(days, day): MilestoneSet[]`.
  - `@ccip-dev/core/broadcasts`:
    - `type BroadcastTarget`, `broadcastKey(t)`, `broadcastCardPath(t)`, `parseBroadcastPath(parts)`;
    - `interface Delta { value: number | null; pct: number | null }`;
    - `DayTotalsFacts` and `dayTotalsFacts(days: readonly DayTotals[], day)`;
    - `WeekTotalsFacts` and `weekTotalsFacts(days, monday)`;
    - `recordValueText(kind, value): string`;
    - `interface RecordDriver { lane: string; messages: number; usd: number | null; feeUsd: number | null; symbol: string | null }` and `recordDriver(record, leaders: Pick<DayLeaders, 'lane' | 'fee_lane'> | null, largest): RecordDriver | null`;
    - `type TotalMetric = 'messages' | 'value' | 'fees' | 'link_amount'`, `RECORD_TOTAL: Record<RecordKind, TotalMetric>` and `allTimeTotal(metric, days, day): number`;
    - `isDepositTransfer(t: TransferView): boolean`;
    - `RESERVE_WEEKS_SHOWN = 11`, `ReserveDepositFacts` and `reserveDepositFacts(reserve: Pick<ReserveFile, 'transfers' | 'weekly'>, tx): ReserveDepositFacts | null`.
  - `DayLeaders` is defined in Task 5. Until then, `recordDriver` takes `{ lane: Leader | null; fee_lane: Leader | null }` with `Leader = { key: string; messages: number; usd: number | null; fee_usd: number | null }`, declared locally as `LeaderLike` so this task compiles on its own.

- [ ] **Step 1: Write the failing pace, deposit, day and format tests.**
  - In `packages/core/test/reserve-stats.test.ts`, in "lists every transfer oldest first, with now-values only for inflows", change the `toEqual` object for `stats.transfers[0]` to end with `change_pct: 50, deposit: true,`. Then add inside `describe('reserveStats', …)`:

```ts
  it('marks each transfer a deposit by the same rule pace counts', () => {
    // #when
    const marks = stats.transfers.map((t) => [t.tx, t.deposit]);
    // #then the 5-LINK gift and the outflow are not deposits
    expect(marks).toEqual([['0x01', true], ['0x02', false], ['0x03', true], ['0x04', false], ['0x05', true], ['0x06', true]]);
  });
```

  - Add to the same file:

```ts
import { depositStreak, isDeposit, nextMilestone } from '../src/reserve-pace';

describe('reserve pace helpers', () => {
  it('counts a deposit from 1,000 LINK in', () => {
    expect([isDeposit({ direction: 'in', link: 1_000 }), isDeposit({ direction: 'in', link: 999.99 }), isDeposit({ direction: 'out', link: 5_000 })]).toEqual([true, false, false]);
  });

  it('counts the streak back from the last deposit while gaps stay within 8 days', () => {
    // #given gaps of 14, 7 and 8 days
    const ts = ['2026-08-01T00:00:00Z', '2026-08-15T00:00:00Z', '2026-08-22T00:00:00Z', '2026-08-30T00:00:00Z'];
    // #then
    expect([depositStreak(ts), depositStreak([]), depositStreak(ts.slice(0, 1))]).toEqual([3, 0, 1]);
  });

  it('projects the next whole million from a given time, and nothing without a pace', () => {
    // #when 250,000 held at 250,000 a week reaches 1,000,000 three weeks later
    const eta = nextMilestone(250_000, 250_000, new Date('2026-10-01T00:00:00Z'));
    // #then
    expect({ eta, none: nextMilestone(250_000, null, new Date('2026-10-01T00:00:00Z')) }).toEqual({ eta: { link: 1_000_000, eta: '2026-10-22' }, none: null });
  });
});
```

  - In `packages/core/test/time.test.ts`, add `isDay` to the `../src/time` import and add:

```ts
describe('isDay', () => {
  it.each([['2026-10-11', true], ['2026-02-30', false], ['2026-10-1', false], ['../x', false]])('%s → %s', (value, ok) => {
    expect(isDay(value)).toBe(ok);
  });
});
```

  - In `packages/core/test/format.test.ts`, add `formatLinkAmount` to the import and add:

```ts
describe('formatLinkAmount', () => {
  it.each([[0.29, '0.29 LINK'], [12.346, '12.35 LINK'], [100, '100 LINK'], [82_480.4, '82,480 LINK'], [null, '—']])('%s → %s', (value, text) => {
    expect(formatLinkAmount(value)).toBe(text);
  });
});
```

- [ ] **Step 2: Write the failing records tests.** In `packages/core/test/records.test.ts`, add `milestonesOn, recordsSetOn, recordValue, trackedMilestones,` to the `../src/records` import and add at the end:

```ts
describe('records set on a day', () => {
  const stats = (day: string, messages: number, usd: number, fee: number | null, link: number | null): FeeDayStats => ({
    day, messages, usd_value: usd, unique_senders: 1, fee_usd: fee, median_delivery_s: null, fee_link_usd: link, fee_link_amount: null,
  });
  const A = '2026-03-01';
  const B = '2026-07-08';
  const C = '2026-07-09';
  // Each day pays 1% of its fees in LINK, so the LINK share ties and never sets a record.
  const days = [stats(A, 1000, 2e6, 47_800, 478), stats(B, 900, 1e6, 30_000, 300), stats(C, 1200, 1.5e6, 57_300, 573)];
  const fee = (day: string, fee_usd: number) => ({ message_id: `0x${day}`, day, src: '1', dst: '2', fee_usd, symbol: 'USDC' });
  const largest = [fee(C, 12_000), fee(A, 9_000)];

  it('finds each record a day sets, with the record it beat and how long that stood', () => {
    // #when
    const set = recordsSetOn(days, largest, C);
    // #then
    expect(set).toEqual([
      { kind: 'messages', day: C, value: 1200, previous: { day: A, value: 1000 }, stoodDays: 130 },
      { kind: 'fees', day: C, value: 57_300, previous: { day: A, value: 47_800 }, stoodDays: 130 },
      { kind: 'largest_fee', day: C, value: 12_000, previous: { day: A, value: 9_000 }, stoodDays: 130 },
    ]);
  });

  it('sets nothing on a day below the records, or on the first day there is', () => {
    expect({ b: recordsSetOn(days, largest, B), a: recordsSetOn(days, largest, A) }).toEqual({ b: [], a: [] });
  });

  it('keeps a tied record with the earlier day, as the Records page does', () => {
    expect(recordValue('link_share', days, largest)?.day).toBe(A);
  });

  it('counts the LINK share only on days with 100 or more messages', () => {
    // #given a 99-message day paid fully in LINK
    const quiet = [...days, stats('2026-07-10', 99, 1, 10, 10)];
    // #then
    expect(recordValue('link_share', quiet, largest)?.day).toBe(A);
  });
});

describe('milestones crossed on a day', () => {
  const day = (d: string, messages: number, fee: number): FeeDayStats => ({
    day: d, messages, usd_value: 0, unique_senders: 1, fee_usd: fee, median_delivery_s: null, fee_link_usd: null, fee_link_amount: null,
  });
  // Fee coverage must start at 2023-07-06 for fee milestones to count.
  const days = [day('2023-07-06', 600, 600_000), day('2023-07-07', 500, 500_000)];

  it('lists the all-time messages, value and fee thresholds a day crossed', () => {
    expect(milestonesOn(days, '2023-07-07')).toEqual([
      { metric: 'messages', threshold: 1000, day: '2023-07-07', label: '1,000 messages' },
      { metric: 'fees', threshold: 1_000_000, day: '2023-07-07', label: '$1M in fees' },
    ]);
  });

  it('leaves out the first-fee-day and chain milestones, and days that crossed nothing', () => {
    expect({ tracked: trackedMilestones(days).map((m) => m.metric), first: milestonesOn(days, '2023-07-06') }).toEqual({ tracked: ['messages', 'fees'], first: [] });
  });
});
```

- [ ] **Step 3: Write the failing broadcast tests.** Create `packages/core/test/broadcasts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  allTimeTotal, broadcastCardPath, broadcastKey, dayTotalsFacts, parseBroadcastPath, recordDriver, recordValueText, reserveDepositFacts, weekTotalsFacts, type BroadcastTarget,
} from '../src/broadcasts';
import type { DayTotals, TransferView } from '../src/public';
import type { RecordSet } from '../src/records';

const TX = `0x${'ab'.repeat(32)}`;
const totals = (day: string, messages: number, usd: number, fee: number | null, link: number | null = null, amount: number | null = null): DayTotals => ({
  day, messages, token_messages: 0, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: link, fee_link_amount: amount,
});

describe('broadcast keys and card paths', () => {
  const targets: [BroadcastTarget, string, string][] = [
    [{ kind: 'daily', day: '2026-10-10' }, 'broadcast:daily:2026-10-10', 'broadcast/daily/2026-10-10'],
    [{ kind: 'weekly', monday: '2026-10-05' }, 'broadcast:weekly:2026-10-05', 'broadcast/weekly/2026-10-05'],
    [{ kind: 'record', record: 'fees', day: '2026-07-09' }, 'broadcast:record:fees:2026-07-09', 'broadcast/record/fees/2026-07-09'],
    [{ kind: 'milestone', metric: 'value', threshold: 2_500_000_000 }, 'broadcast:milestone:value:2500000000', 'broadcast/milestone/value/2500000000'],
    [{ kind: 'reserve', tx: TX }, `broadcast:reserve:${TX}`, `broadcast/reserve/${TX}`],
  ];

  it.each(targets)('keys, prints and parses back %o', (target, key, path) => {
    // #when
    const parsed = parseBroadcastPath(path.split('/'));
    // #then
    expect({ key: broadcastKey(target), path: broadcastCardPath(target), parsed }).toEqual({ key, path, parsed: target });
  });

  it.each([
    'broadcast/monthly/2026-10-10', 'broadcast/weekly/2026-10-06', 'broadcast/daily/2026-02-30', 'broadcast/record/busiest/2026-07-09',
    'broadcast/record/fees/2026-07-09/x', 'broadcast/milestone/fees/0', 'broadcast/milestone/fees/1e6', 'broadcast/reserve/0xABC', 'daily/2026-10-10',
  ])('rejects %s', (path) => {
    expect(parseBroadcastPath(path.split('/'))).toBeNull();
  });
});

describe('dayTotalsFacts', () => {
  const prior = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((d) => totals(d, 200, 8e6, 4));

  it('compares the day with the mean of the 7 days before it, and gives its LINK share', () => {
    // #when
    const facts = dayTotalsFacts([totals('2026-10-02', 9_999, 9e9, 999), ...prior, totals('2026-10-10', 150, 2e6, 5, 1.25, 0.1)], '2026-10-10');
    // #then the day 8 days back is not in the mean
    expect(facts).toEqual({
      day: '2026-10-10',
      messages: { value: 150, pct: -25 },
      value: { value: 2e6, pct: -75 },
      fees: { value: 5, pct: 25 },
      linkSharePct: 25,
      linkUsd: 1.25,
      linkAmount: 0.1,
    });
  });

  it('averages over the days it has, and gives no change without any', () => {
    // #when
    const short = dayTotalsFacts([totals('2026-10-09', 100, 1e6, null), totals('2026-10-10', 150, 2e6, 5)], '2026-10-10');
    // #then the one earlier day has no fee data, so fees have no change
    expect({ messages: short?.messages, fees: short?.fees, missing: dayTotalsFacts(prior, '2026-10-10') }).toEqual({
      messages: { value: 150, pct: 50 },
      fees: { value: 5, pct: null },
      missing: null,
    });
  });
});

describe('weekTotalsFacts', () => {
  const MONDAY = '2026-10-05';
  const week = [0, 1, 2, 3, 4, 5, 6].map((i) => totals(`2026-10-${String(5 + i).padStart(2, '0')}`, 100, 1e6, i + 1, i === 0 ? 7 : 0, i === 0 ? 0.5 : 0));
  const before = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => totals(d, 50, 2e6, 4));

  it('totals Monday to Sunday against the week before, with fees by day', () => {
    // #when
    const facts = weekTotalsFacts([...before, ...week], MONDAY);
    // #then
    expect(facts).toEqual({
      monday: MONDAY,
      sunday: '2026-10-11',
      messages: { value: 700, pct: 100 },
      value: { value: 7e6, pct: -50 },
      fees: { value: 28, pct: 0 },
      linkSharePct: 25,
      linkUsd: 7,
      linkAmount: 0.5,
      feesByDay: [1, 2, 3, 4, 5, 6, 7],
    });
  });

  it('has nothing for a week with no day', () => {
    expect(weekTotalsFacts(week, '2026-10-12')).toBeNull();
  });
});

describe('record text, drivers and totals', () => {
  const record = (kind: RecordSet['kind']): RecordSet => ({ kind, day: '2026-07-09', value: 57_300, previous: { day: '2026-03-01', value: 47_800 }, stoodDays: 130 });
  const lane = { key: '1>2', messages: 400, usd: 5.2e6, fee_usd: 10 };
  const feeLane = { key: '3>1', messages: 5_712, usd: 1e6, fee_usd: 50_000 };

  it('writes each record value the way the Records page does', () => {
    expect(['messages', 'value', 'fees', 'largest_fee', 'link_share'].map((k) => recordValueText(k as RecordSet['kind'], 57_300))).toEqual([
      '57,300', '$57.3K', '$57.3K', '$57.3K', '57300%',
    ]);
  });

  it('takes the top fee lane for fees, the busiest lane for messages and value, the fee itself for the largest fee, and nothing for the LINK share', () => {
    // #given
    const leaders = { lane, fee_lane: feeLane };
    const largest = [{ message_id: '0x1', day: '2026-07-09', src: '5', dst: '6', fee_usd: 57_300, symbol: 'USDC' }];
    // #then
    expect([
      recordDriver(record('fees'), leaders, largest),
      recordDriver(record('value'), leaders, largest),
      recordDriver(record('largest_fee'), leaders, largest),
      recordDriver(record('link_share'), leaders, largest),
    ]).toEqual([
      { lane: '3>1', messages: 5_712, usd: 1e6, feeUsd: 50_000, symbol: null },
      { lane: '1>2', messages: 400, usd: 5.2e6, feeUsd: 10, symbol: null },
      { lane: '5>6', messages: 1, usd: null, feeUsd: 57_300, symbol: 'USDC' },
      null,
    ]);
  });

  it('sums an all-time total through the record day', () => {
    // #given
    const days = [totals('2026-07-08', 10, 100, 1, null, 0.5), totals('2026-07-09', 20, 200, null, null, 0.25), totals('2026-07-10', 40, 400, 4, null, 1)];
    // #then
    expect(['messages', 'value', 'fees', 'link_amount'].map((m) => allTimeTotal(m as 'messages', days, '2026-07-09'))).toEqual([30, 300, 1, 0.75]);
  });
});

describe('reserveDepositFacts', () => {
  const view = (ts: string, tx: string, direction: 'in' | 'out', link: number, extra: Partial<TransferView> = {}): TransferView => ({
    ts, tx, direction, counterparty: '0xd', link, price_usd: null, usd: null, value_now_usd: null, change_pct: null, deposit: direction === 'in' && link >= 1000, ...extra,
  });
  const reserve = {
    transfers: [
      view('2026-09-01T10:00:00.000Z', '0x01', 'in', 100_000),
      view('2026-09-02T12:00:00.000Z', '0x02', 'in', 5),
      view('2026-09-08T15:00:00.000Z', '0x03', 'in', 50_000),
      view('2026-09-10T09:00:00.000Z', '0x04', 'out', 1),
      view('2026-09-15T15:00:00.000Z', '0x05', 'in', 60_000, { price_usd: 12.5, usd: 750_000, value_now_usd: 900_000, change_pct: 20 }),
    ],
    weekly: [
      { week: '2026-08-31', deposits: 1, link: 100_000, usd: 1_000_000 },
      { week: '2026-09-07', deposits: 1, link: 50_000, usd: 600_000 },
      { week: '2026-09-14', deposits: 1, link: 60_000, usd: 750_000 },
    ],
  };

  it('describes a deposit as of its own time, so a later render reads the same', () => {
    // #when
    const facts = reserveDepositFacts(reserve, '0x05');
    // #then 210,004 LINK held; the 4 weeks before its week average 75,000 LINK; 789,996 LINK to go is 10.53 weeks
    expect(facts).toEqual({
      tx: '0x05', ts: '2026-09-15T15:00:00.000Z', link: 60_000, usdAtDeposit: 750_000, usdNow: 900_000, changePct: 20,
      balanceLink: 210_004, depositCount: 3, streak: 3, avgWeeklyLink: 75_000, avgWeeklyUsd: 800_000,
      nextMilestone: { link: 1_000_000, eta: '2026-11-28' },
      weeks: [{ week: '2026-08-31', link: 100_000 }, { week: '2026-09-07', link: 50_000 }, { week: '2026-09-14', link: 60_000 }],
    });
  });

  it('has nothing for a gift, an outflow or an unknown transaction', () => {
    expect([reserveDepositFacts(reserve, '0x02'), reserveDepositFacts(reserve, '0x04'), reserveDepositFacts(reserve, '0x99')]).toEqual([null, null, null]);
  });

  it('reads deposits from a file published before the deposit flag existed', () => {
    // #given the same transfers without the flag
    const old = { ...reserve, transfers: reserve.transfers.map(({ deposit: _flag, ...rest }) => rest) };
    // #then
    expect(reserveDepositFacts(old, '0x05')?.depositCount).toBe(3);
  });
});
```

- [ ] **Step 4: Run them and confirm they fail.** Run `pnpm --filter @ccip-dev/core test`. Expected: FAIL. `reserve-pace`, `isDay`, `formatLinkAmount`, `recordsSetOn` and `broadcasts` are missing, and the transfer views have no `deposit`.

- [ ] **Step 5: Add the pace helpers.** Create `packages/core/src/reserve-pace.ts`:

```ts
import { dayOf } from './time';

export const DEPOSIT_MIN_LINK = 1_000;
export const MILESTONE_STEP_LINK = 1_000_000;
export const DEPOSIT_STREAK_MAX_GAP_DAYS = 8;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Inbound transfers below DEPOSIT_MIN_LINK are tests and gifts, not deposits. */
export function isDeposit(t: { direction: 'in' | 'out'; link: number }): boolean {
  return t.direction === 'in' && t.link >= DEPOSIT_MIN_LINK;
}

/** Deposits in a row, counted back from the last, while each gap is at most DEPOSIT_STREAK_MAX_GAP_DAYS. `timestamps` are oldest first. */
export function depositStreak(timestamps: readonly string[]): number {
  if (timestamps.length === 0) return 0;
  let streak = 1;
  for (let i = timestamps.length - 1; i > 0; i--) {
    if ((Date.parse(timestamps[i]!) - Date.parse(timestamps[i - 1]!)) / DAY_MS > DEPOSIT_STREAK_MAX_GAP_DAYS) break;
    streak++;
  }
  return streak;
}

/** The next whole million above `held`, and the day the weekly pace reaches it, counting from `from`. */
export function nextMilestone(held: number, avgWeeklyLink: number | null, from: Date): { link: number; eta: string } | null {
  if (avgWeeklyLink === null || avgWeeklyLink <= 0) return null;
  const link = (Math.floor(held / MILESTONE_STEP_LINK) + 1) * MILESTONE_STEP_LINK;
  return { link, eta: dayOf(new Date(from.getTime() + ((link - held) / avgWeeklyLink) * WEEK_MS)) };
}
```

- [ ] **Step 6: Use them in `reserveStats`.** In `packages/core/src/reserve-stats.ts`:
  - Replace the lines `export const DEPOSIT_MIN_LINK = 1_000;`, `export const MILESTONE_STEP_LINK = 1_000_000;` and `export const DEPOSIT_STREAK_MAX_GAP_DAYS = 8;` with:

```ts
import { depositStreak, isDeposit, nextMilestone } from './reserve-pace';

export { DEPOSIT_MIN_LINK, DEPOSIT_STREAK_MAX_GAP_DAYS, MILESTONE_STEP_LINK, depositStreak, isDeposit, nextMilestone } from './reserve-pace';
```

  - Add `deposit: boolean;` as the last field of `interface TransferView`.
  - Replace `const deposits = inflows.filter((r) => r.link >= DEPOSIT_MIN_LINK);` with `const deposits = rows.filter(isDeposit);`.
  - Delete `const milestone = (Math.floor(net / MILESTONE_STEP_LINK) + 1) * MILESTONE_STEP_LINK;`.
  - Replace the whole `let streak = …` block (the `let` and its `for` loop) with `const streak = depositStreak(deposits.map((d) => d.ts));`.
  - In `pace`, replace the `next_milestone:` property with `next_milestone: nextMilestone(net, avgLink, now),`.
  - In `view`, add `deposit: isDeposit(r),` after `change_pct`.
  - In `packages/core/src/public.ts`, add `deposit: z.boolean().optional(),` as the last field of `TransferViewSchema`.

- [ ] **Step 7: Add `isDay` and `formatLinkAmount`.**
  - In `packages/core/src/time.ts`, after `dayStartIso`, add:

```ts
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const ms = Date.parse(dayStartIso(value));
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
```

  - In `packages/core/src/format.ts`, after `formatLink`, add:

```ts
/** A LINK amount; under 100 LINK it keeps two decimals, where formatLink would show a day's 0.29 LINK in fees as 0. */
export function formatLinkAmount(value: number | null | undefined): string {
  if (!usable(value)) return DASH;
  return Math.abs(value) < 100 ? `${value.toFixed(2)} LINK` : formatLink(value);
}
```

- [ ] **Step 8: Add record and milestone detection** in `packages/core/src/records.ts`.
  - Add `import { dayStartIso } from './time';` to the `./time` import (it becomes `import { addDays, dayStartIso } from './time';`).
  - Below `LINK_SHARE_MIN_MESSAGES`, add:

```ts
export const RECORD_KINDS = ['messages', 'value', 'fees', 'largest_fee', 'link_share'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export const MILESTONE_METRICS = ['messages', 'value', 'fees'] as const;
export type MilestoneMetric = (typeof MILESTONE_METRICS)[number];

export interface RecordValue {
  day: string;
  value: number;
}

export interface RecordSet {
  kind: RecordKind;
  day: string;
  value: number;
  previous: RecordValue;
  stoodDays: number;
}

export interface MilestoneSet {
  metric: MilestoneMetric;
  threshold: number;
  day: string;
  label: string;
}

const linkSharePct = (d: FeeDayStats): number | null =>
  d.messages >= LINK_SHARE_MIN_MESSAGES && d.fee_usd && d.fee_link_usd !== null ? (d.fee_link_usd / d.fee_usd) * 100 : null;

const DAY_PICKS: Record<Exclude<RecordKind, 'largest_fee'>, (d: FeeDayStats) => number | null> = {
  messages: (d) => d.messages,
  value: (d) => d.usd_value,
  fees: (d) => d.fee_usd,
  link_share: linkSharePct,
};
```

  - In `computeFeeRecords`, replace the `bestDay(sorted, (d) => (d.messages >= LINK_SHARE_MIN_MESSAGES && … : null))` argument with `bestDay(sorted, linkSharePct)`.
  - After `computeFeeMilestones`, add:

```ts
const DAY_MS = 86_400_000;

/** The record of `kind` among `days` (the largest single fee among `largest`), ties going to the earlier day as on the Records page. */
export function recordValue(kind: RecordKind, days: readonly FeeDayStats[], largest: readonly LargestFee[]): RecordValue | null {
  if (kind !== 'largest_fee') return bestDay([...days].sort(compareDay), DAY_PICKS[kind]);
  let best: RecordValue | null = null;
  for (const f of largest) {
    if (best === null || f.fee_usd > best.value || (f.fee_usd === best.value && f.day < best.day)) best = { day: f.day, value: f.fee_usd };
  }
  return best;
}

/** The records `day` set: it holds the record counting the days up to it, and some earlier day held one before. */
export function recordsSetOn(days: readonly FeeDayStats[], largest: readonly LargestFee[], day: string): RecordSet[] {
  const through = days.filter((d) => d.day <= day);
  const before = days.filter((d) => d.day < day);
  return RECORD_KINDS.flatMap((kind) => {
    const now = recordValue(kind, through, largest.filter((f) => f.day <= day));
    const previous = recordValue(kind, before, largest.filter((f) => f.day < day));
    if (now === null || previous === null || now.day !== day) return [];
    return [{ kind, day, value: now.value, previous, stoodDays: Math.round((Date.parse(dayStartIso(day)) - Date.parse(dayStartIso(previous.day))) / DAY_MS) }];
  });
}

const isMetric = (kind: MilestoneKind): kind is MilestoneMetric => (MILESTONE_METRICS as readonly string[]).includes(kind);

/** The all-time messages, value and fee crossings the Records page lists; first-fee-day and chain milestones are left out. */
export function trackedMilestones(days: readonly FeeDayStats[]): MilestoneSet[] {
  return [...computeMilestones(days, []), ...computeFeeMilestones(days)].flatMap((m) =>
    isMetric(m.kind) && m.threshold !== null ? [{ metric: m.kind, threshold: m.threshold, day: m.day, label: m.label }] : [],
  );
}

export function milestonesOn(days: readonly FeeDayStats[], day: string): MilestoneSet[] {
  return trackedMilestones(days.filter((d) => d.day <= day)).filter((m) => m.day === day);
}
```

- [ ] **Step 9: Add the broadcast module.** Create `packages/core/src/broadcasts.ts`:

```ts
import { formatCount, formatFee, formatFeeTotal, formatShare, formatUsd } from './format';
import type { DayTotals, LargestFee, ReserveFile, TransferView } from './public';
import { MILESTONE_METRICS, RECORD_KINDS, type MilestoneMetric, type RecordKind, type RecordSet } from './records';
import { DEPOSIT_MIN_LINK, depositStreak, nextMilestone } from './reserve-pace';
import { addDays, isDay, weekStart } from './time';

export type BroadcastTarget =
  | { kind: 'daily'; day: string }
  | { kind: 'weekly'; monday: string }
  | { kind: 'record'; record: RecordKind; day: string }
  | { kind: 'milestone'; metric: MilestoneMetric; threshold: number }
  | { kind: 'reserve'; tx: string };

export function broadcastKey(t: BroadcastTarget): string {
  switch (t.kind) {
    case 'daily':
      return `broadcast:daily:${t.day}`;
    case 'weekly':
      return `broadcast:weekly:${t.monday}`;
    case 'record':
      return `broadcast:record:${t.record}:${t.day}`;
    case 'milestone':
      return `broadcast:milestone:${t.metric}:${t.threshold}`;
    case 'reserve':
      return `broadcast:reserve:${t.tx}`;
  }
}

/** The card's path under /og/, without ".png". */
export function broadcastCardPath(t: BroadcastTarget): string {
  switch (t.kind) {
    case 'daily':
      return `broadcast/daily/${t.day}`;
    case 'weekly':
      return `broadcast/weekly/${t.monday}`;
    case 'record':
      return `broadcast/record/${t.record}/${t.day}`;
    case 'milestone':
      return `broadcast/milestone/${t.metric}/${t.threshold}`;
    case 'reserve':
      return `broadcast/reserve/${t.tx}`;
  }
}

const TX_RE = /^0x[0-9a-f]{64}$/;
const THRESHOLD_RE = /^[1-9]\d{0,15}$/;
const oneOf = <T extends string>(list: readonly T[], value: string | undefined): value is T => value !== undefined && (list as readonly string[]).includes(value);

/** `parts` is a card path split on "/", starting with "broadcast". */
export function parseBroadcastPath(parts: readonly string[]): BroadcastTarget | null {
  const [head, kind, a, b, ...rest] = parts;
  if (head !== 'broadcast' || rest.length > 0 || a === undefined) return null;
  if (kind === 'daily' && b === undefined && isDay(a)) return { kind: 'daily', day: a };
  if (kind === 'weekly' && b === undefined && isDay(a) && weekStart(a) === a) return { kind: 'weekly', monday: a };
  if (kind === 'record' && oneOf(RECORD_KINDS, a) && b !== undefined && isDay(b)) return { kind: 'record', record: a, day: b };
  if (kind === 'milestone' && oneOf(MILESTONE_METRICS, a) && b !== undefined && THRESHOLD_RE.test(b)) return { kind: 'milestone', metric: a, threshold: Number(b) };
  if (kind === 'reserve' && b === undefined && TX_RE.test(a)) return { kind: 'reserve', tx: a };
  return null;
}

export interface Delta {
  value: number | null;
  pct: number | null;
}

export interface DayTotalsFacts {
  day: string;
  messages: Delta;
  value: Delta;
  fees: Delta;
  linkSharePct: number | null;
  linkUsd: number | null;
  linkAmount: number | null;
}

export interface WeekTotalsFacts extends Omit<DayTotalsFacts, 'day'> {
  monday: string;
  sunday: string;
  /** Monday first; a day without fees counts 0. */
  feesByDay: number[];
}

type Figure = (d: DayTotals) => number | null;

const present = (rows: readonly DayTotals[], pick: Figure) => rows.flatMap((d) => {
  const v = pick(d);
  return v === null ? [] : [v];
});
const sumOf = (rows: readonly DayTotals[], pick: Figure) => {
  const values = present(rows, pick);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
};
const meanOf = (rows: readonly DayTotals[], pick: Figure) => {
  const values = present(rows, pick);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
};
const pctChange = (value: number | null, base: number | null) => (value === null || base === null || base === 0 ? null : ((value - base) / base) * 100);
const linkShare = (link: number | null, fees: number | null) => (link === null || fees === null || fees === 0 ? null : (link / fees) * 100);
const MESSAGES: Figure = (d) => d.messages;
const VALUE: Figure = (d) => d.usd_value;
const FEES: Figure = (d) => d.fee_usd;
const LINK_USD: Figure = (d) => d.fee_link_usd;
const LINK_AMOUNT: Figure = (d) => d.fee_link_amount ?? null;

/** A day's totals, each against the mean of the 7 days before it that have the figure. */
export function dayTotalsFacts(days: readonly DayTotals[], day: string): DayTotalsFacts | null {
  const row = days.find((d) => d.day === day);
  if (!row) return null;
  const prior = days.filter((d) => d.day >= addDays(day, -7) && d.day < day);
  const delta = (pick: Figure): Delta => ({ value: pick(row), pct: pctChange(pick(row), meanOf(prior, pick)) });
  return {
    day,
    messages: delta(MESSAGES),
    value: delta(VALUE),
    fees: delta(FEES),
    linkSharePct: linkShare(row.fee_link_usd, row.fee_usd),
    linkUsd: row.fee_link_usd,
    linkAmount: row.fee_link_amount ?? null,
  };
}

/** A Monday–Sunday week's totals against the week before. */
export function weekTotalsFacts(days: readonly DayTotals[], monday: string): WeekTotalsFacts | null {
  const sunday = addDays(monday, 6);
  const week = days.filter((d) => d.day >= monday && d.day <= sunday);
  if (week.length === 0) return null;
  const before = days.filter((d) => d.day >= addDays(monday, -7) && d.day < monday);
  const delta = (pick: Figure): Delta => ({ value: sumOf(week, pick), pct: pctChange(sumOf(week, pick), sumOf(before, pick)) });
  return {
    monday,
    sunday,
    messages: delta(MESSAGES),
    value: delta(VALUE),
    fees: delta(FEES),
    linkSharePct: linkShare(sumOf(week, LINK_USD), sumOf(week, FEES)),
    linkUsd: sumOf(week, LINK_USD),
    linkAmount: sumOf(week, LINK_AMOUNT),
    feesByDay: Array.from({ length: 7 }, (_, i) => week.find((d) => d.day === addDays(monday, i))?.fee_usd ?? 0),
  };
}

export function recordValueText(kind: RecordKind, value: number): string {
  switch (kind) {
    case 'messages':
      return formatCount(value);
    case 'value':
      return formatUsd(value);
    case 'fees':
      return formatFeeTotal(value);
    case 'largest_fee':
      return formatFee(value);
    case 'link_share':
      return formatShare(value);
  }
}

interface LeaderLike {
  key: string;
  messages: number;
  usd: number | null;
  fee_usd: number | null;
}

export interface RecordDriver {
  lane: string;
  messages: number;
  usd: number | null;
  feeUsd: number | null;
  symbol: string | null;
}

/** What drove a record: the day's top lane by fees for fees, its busiest lane for messages and value, the fee's own route for the largest fee. */
export function recordDriver(
  record: RecordSet,
  leaders: { lane: LeaderLike | null; fee_lane: LeaderLike | null } | null,
  largest: readonly LargestFee[],
): RecordDriver | null {
  if (record.kind === 'largest_fee') {
    const fee = largest.find((f) => f.day === record.day && f.fee_usd === record.value);
    return fee ? { lane: `${fee.src}>${fee.dst}`, messages: 1, usd: null, feeUsd: fee.fee_usd, symbol: fee.symbol } : null;
  }
  const lane = record.kind === 'fees' ? leaders?.fee_lane : record.kind === 'link_share' ? null : leaders?.lane;
  return lane ? { lane: lane.key, messages: lane.messages, usd: lane.usd, feeUsd: lane.fee_usd, symbol: null } : null;
}

export type TotalMetric = 'messages' | 'value' | 'fees' | 'link_amount';

export const RECORD_TOTAL: Record<RecordKind, TotalMetric> = { messages: 'messages', value: 'value', fees: 'fees', largest_fee: 'fees', link_share: 'link_amount' };

const TOTAL_PICKS: Record<TotalMetric, Figure> = { messages: MESSAGES, value: VALUE, fees: FEES, link_amount: LINK_AMOUNT };

export function allTimeTotal(metric: TotalMetric, days: readonly DayTotals[], day: string): number {
  return sumOf(days.filter((d) => d.day <= day), TOTAL_PICKS[metric]) ?? 0;
}

/** A file published before the deposit flag existed falls back to the same rule on the rounded amount. */
export function isDepositTransfer(t: TransferView): boolean {
  return t.deposit ?? (t.direction === 'in' && t.link >= DEPOSIT_MIN_LINK);
}

export const RESERVE_WEEKS_SHOWN = 11;
const AVERAGE_WEEKS = 4;
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface ReserveDepositFacts {
  tx: string;
  ts: string;
  link: number;
  usdAtDeposit: number | null;
  usdNow: number | null;
  changePct: number | null;
  balanceLink: number;
  depositCount: number;
  streak: number;
  avgWeeklyLink: number | null;
  avgWeeklyUsd: number | null;
  nextMilestone: { link: number; eta: string } | null;
  weeks: { week: string; link: number }[];
}

/** One deposit, as of its own time: the balance after it, the streak ending at it, the 4 weeks before its week and the milestone from then. */
export function reserveDepositFacts(reserve: Pick<ReserveFile, 'transfers' | 'weekly'>, tx: string): ReserveDepositFacts | null {
  const sorted = [...reserve.transfers].sort((a, b) => a.ts.localeCompare(b.ts));
  const at = sorted.findIndex((t) => t.tx === tx && isDepositTransfer(t));
  const deposit = sorted[at];
  if (at < 0 || deposit === undefined) return null;
  const upTo = sorted.slice(0, at + 1);
  const balance = round2(upTo.reduce((sum, t) => sum + (t.direction === 'in' ? t.link : -t.link), 0));
  const deposits = upTo.filter(isDepositTransfer);
  const week = weekStart(deposit.ts);
  const before = reserve.weekly.filter((w) => w.week < week).slice(-AVERAGE_WEEKS);
  const average = (pick: (w: ReserveFile['weekly'][number]) => number) =>
    before.length === 0 ? null : round2(before.reduce((sum, w) => sum + pick(w), 0) / before.length);
  const avgWeeklyLink = average((w) => w.link);
  return {
    tx,
    ts: deposit.ts,
    link: deposit.link,
    usdAtDeposit: deposit.usd,
    usdNow: deposit.value_now_usd,
    changePct: deposit.change_pct,
    balanceLink: balance,
    depositCount: deposits.length,
    streak: depositStreak(deposits.map((d) => d.ts)),
    avgWeeklyLink,
    avgWeeklyUsd: average((w) => w.usd),
    nextMilestone: nextMilestone(balance, avgWeeklyLink, new Date(deposit.ts)),
    weeks: reserve.weekly.filter((w) => w.week <= week).slice(-RESERVE_WEEKS_SHOWN).map((w) => ({ week: w.week, link: w.link })),
  };
}
```

  - In `packages/core/package.json`, add `"./broadcasts": "./src/broadcasts.ts"` to `exports`.

- [ ] **Step 10: Run the core tests and typecheck.** Run `pnpm --filter @ccip-dev/core test && pnpm typecheck`. Expected: all pass, including every existing `reserveStats` test (the helpers keep its results) and the moved records tests (`computeFeeRecords` keeps its LINK-share rule).

- [ ] **Step 11: Commit.**

```bash
git add packages/core/src/reserve-pace.ts packages/core/src/reserve-stats.ts packages/core/src/public.ts packages/core/src/time.ts packages/core/src/format.ts packages/core/src/records.ts packages/core/src/broadcasts.ts packages/core/package.json packages/core/test/broadcasts.test.ts packages/core/test/records.test.ts packages/core/test/reserve-stats.test.ts packages/core/test/time.test.ts packages/core/test/format.test.ts
git commit -m "feat(core): broadcast facts shared by the Worker and the cards: records set on a day, deltas, and Reserve deposits as of their time"
```

---

### Task 5: Worker `day-leaders.json`

**Files:**
- Modify: `packages/core/src/public.ts` (`LeaderSchema`, `DayLeadersSchema`, `WeekLeadersSchema`, `DayLeadersFileSchema`, `'day-leaders.json'` in `PUBLIC_SCHEMAS`, the types)
- Modify: `worker/src/store.ts` (`TopOrder` gains `messages`; every order ends on the key; `BreakdownRow`, `LeaderRow`, `dailyLeaders`)
- Modify: `worker/src/publish.ts` (`TTL.leaders`, `DAY_LEADERS_DAYS`, `LEADER_WEEKS`, `leader`, `dayLeaderEntries`, `lastCompleteMonday`, `weekFeeChains`, `publishDayLeaders`, the `day-leaders-publish` alert)
- Modify: `docs/runbook.md` (the alert table)
- Test: `packages/core/test/public.test.ts`, `worker/test/store.test.ts`, `worker/test/publish.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - In core: `Leader = { key: string; label: string | null; messages: number; usd: number | null; fee_usd: number | null }`; `DayLeaders = { day: string; token: Leader | null; sender: Leader | null; lane: Leader | null; fee_lane: Leader | null; fee_chain: Leader | null }`; `WeekLeaders = { week: string; fee_chains: Leader[] }`; `DayLeadersFile = { …envelope; days: DayLeaders[]; weeks: WeekLeaders[] }`; `PUBLIC_SCHEMAS['day-leaders.json']`.
  - In `store.ts`:
    - `type TopOrder = 'value' | 'fees' | 'messages'`;
    - `interface BreakdownRow { key: string; messages: number; usd_value: number; fee_usd: number | null }` and `interface LeaderRow extends BreakdownRow { day: string }`;
    - `topBetween(…): Promise<BreakdownRow[]>`;
    - `dailyLeaders(db: D1Database, dim: Dim, order: TopOrder, fromDay: string, toDay: string): Promise<LeaderRow[]>`.
  - In `publish.ts`:
    - `DAY_LEADERS_DAYS = 400` and `LEADER_WEEKS = 8`;
    - `leader(r: store.BreakdownRow, label: string | null): Leader`;
    - `dayLeaderEntries(c: RunContext, fromDay: string, toDay: string): Promise<DayLeaders[]>`;
    - `lastCompleteMonday(lastDay: string): string`;
    - `weekFeeChains(c: RunContext, monday: string): Promise<Leader[]>`;
    - `publishDayLeaders(c: RunContext, now: Date): Promise<void>`.
  - `v1/day-leaders.json`: `days` oldest first over the last 400 days through yesterday, and `weeks` oldest first over the last 8 complete Monday–Sunday weeks.
  - Leader rules:
    - token and lane by value (`usd_value DESC, messages DESC, key`);
    - sender by messages (`messages DESC, usd_value DESC, key`);
    - fee lane and fee chain by fees (`fee_usd DESC, usd_value DESC, key`, rows with fees only).

- [ ] **Step 1: Write the failing schema test.** In `packages/core/test/public.test.ts`, add `DayLeadersFileSchema` to the `../src/public` import, and add inside `describe('public file schemas', …)`:

```ts
  it('parses day-leaders.json and lists it among the public files', () => {
    // #given a day with every leader, a day without fees, and a week
    const leader = { key: '1>2', label: null, messages: 3, usd: 10, fee_usd: 1.5 };
    const doc = {
      ...envelope,
      days: [
        { day: '2026-10-10', token: { ...leader, key: '1:0xt', label: 'USDC', fee_usd: null }, sender: leader, lane: leader, fee_lane: leader, fee_chain: { ...leader, key: '1' } },
        { day: '2026-10-11', token: null, sender: null, lane: null, fee_lane: null, fee_chain: null },
      ],
      weeks: [{ week: '2026-10-05', fee_chains: [{ ...leader, key: '1' }] }],
    };
    // #when
    const parsed = DayLeadersFileSchema.parse(doc);
    // #then
    expect({ days: parsed.days.length, token: parsed.days[0]?.token?.label, week: parsed.weeks[0]?.week, listed: PUBLIC_SCHEMAS['day-leaders.json'] === DayLeadersFileSchema }).toEqual({
      days: 2, token: 'USDC', week: '2026-10-05', listed: true,
    });
  });
```

- [ ] **Step 2: Write the failing store tests.** In `worker/test/store.test.ts`, add at the end:

```ts
describe('dailyLeaders', () => {
  const D9 = '2026-10-09';
  const D10 = '2026-10-10';
  const totals = (day: string) => ({ day, messages: 1, token_messages: 0, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
  const lane = (day: string, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim: 'lane' as const, key, messages, usd_value, fee_usd });

  beforeEach(async () => {
    // #given on the 9th lane a and c tie on value, and on the 10th lanes a and b tie on everything
    await store.replaceDaily(env.DB, totals(D9), [lane(D9, 'a', 10, 100, 1), lane(D9, 'b', 20, 50, 5), lane(D9, 'c', 5, 100, null)], '2026-10-11T00:07:00.000Z');
    await store.replaceDaily(env.DB, totals(D10), [lane(D10, 'a', 1, 10, 2), lane(D10, 'b', 1, 10, 2)], '2026-10-11T00:07:00.000Z');
  });

  it('picks each day’s first lane by value, by messages and by fees, breaking full ties by key', async () => {
    // #when
    const pick = async (order: store.TopOrder) => (await store.dailyLeaders(env.DB, 'lane', order, D9, D10)).map((r) => `${r.day}:${r.key}`);
    // #then
    expect({ value: await pick('value'), messages: await pick('messages'), fees: await pick('fees') }).toEqual({
      value: [`${D9}:a`, `${D10}:a`],
      messages: [`${D9}:b`, `${D10}:a`],
      fees: [`${D9}:b`, `${D10}:a`],
    });
  });

  it('keeps to the days asked for', async () => {
    expect((await store.dailyLeaders(env.DB, 'lane', 'value', D10, D10)).map((r) => r.day)).toEqual([D10]);
  });

  it('ranks a window by messages', async () => {
    expect((await store.topBetween(env.DB, 'lane', D9, D10, 10, 'messages')).map((r) => r.key)).toEqual(['b', 'a', 'c']);
  });
});
```

- [ ] **Step 3: Write the failing publish tests.** In `worker/test/publish.test.ts`, change the `@ccip-dev/core` import to `import { buildLabelIndex, labelKey, LINK_PRICE_KEY, LINK_TOKEN, toChecksumAddress, type Dim, type MessageRow, type NetworkInfo } from '@ccip-dev/core';`, then add after `describe('top files ranked by fees', …)`:

```ts
describe('day-leaders.json', () => {
  const NOW = '2026-10-12T00:07:00.000Z';
  const DAY = '2026-10-11';
  const ETH = NETWORKS.ethereum.chainSelector;
  const OTHER = '0x9999999999999999999999999999999999999999';
  const totals = (day: string) => ({ day, messages: 1, token_messages: 0, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
  const row = (day: string, dim: Dim, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim, key, messages, usd_value, fee_usd });
  const labels = { [labelKey('ethereum-mainnet-base-1', SENDER)]: { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol' as const } };

  beforeEach(async () => {
    // #given one day with two of each: the leader by each rule is not the leader by the others
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chains VALUES (?, 'ethereum-mainnet-base-1', 'Base Mainnet', 'EVM', '8453', 'x', 'x')").bind(BASE),
      env.DB.prepare("INSERT INTO tokens VALUES (?, '0xtok', 'USDC', 'USD Coin', 6, NULL, 'x', 'x')").bind(BASE),
    ]);
    await store.replaceDaily(env.DB, totals(DAY), [
      row(DAY, 'token', `${BASE}:0xtok`, 3, 900, null),
      row(DAY, 'token', `${BASE}:0xother`, 9, 100, null),
      row(DAY, 'sender', `${BASE}:${SENDER}`, 7, 10, 1),
      row(DAY, 'sender', `${BASE}:${OTHER}`, 2, 999, 9),
      row(DAY, 'lane', `${ETH}>${BASE}`, 5, 800, 1),
      row(DAY, 'lane', `${BASE}>${ETH}`, 4, 200, 6),
      row(DAY, 'src_chain', BASE, 6, 999, 7),
      row(DAY, 'src_chain', ETH, 5, 800, 1),
    ], NOW);
  });

  it("publishes each day's top token and lane by value, top sender by messages, and top lane and source chain by fees", async () => {
    // #when
    await publishHistoryFiles(harness({ now: NOW, labels }).c);
    // #then
    expect((await readPublic('day-leaders.json')).days).toEqual([{
      day: DAY,
      token: { key: `${BASE}:0xtok`, label: 'USDC', messages: 3, usd: 900, fee_usd: null },
      sender: { key: `${BASE}:${SENDER}`, label: 'Maple Finance', messages: 7, usd: 10, fee_usd: 1 },
      lane: { key: `${ETH}>${BASE}`, label: null, messages: 5, usd: 800, fee_usd: 1 },
      fee_lane: { key: `${BASE}>${ETH}`, label: null, messages: 4, usd: 200, fee_usd: 6 },
      fee_chain: { key: BASE, label: null, messages: 6, usd: 999, fee_usd: 7 },
    }]);
  });

  it('covers the 400 days before today', async () => {
    // #given a lane on the first day of the window and on the day before it
    await store.replaceDaily(env.DB, totals('2025-09-07'), [row('2025-09-07', 'lane', `${ETH}>${BASE}`, 1, 1, null)], NOW);
    await store.replaceDaily(env.DB, totals('2025-09-06'), [row('2025-09-06', 'lane', `${ETH}>${BASE}`, 1, 1, null)], NOW);
    // #when
    await publishHistoryFiles(harness({ now: NOW }).c);
    // #then
    expect((await readPublic('day-leaders.json')).days.map((d: { day: string }) => d.day)).toEqual(['2025-09-07', DAY]);
  });

  it('raises one day-leaders-publish alert when its query fails, and still publishes the other history files', async () => {
    // #given
    vi.spyOn(store, 'dailyLeaders').mockRejectedValueOnce(new Error('D1 unavailable'));
    const { c, alerts } = harness({ now: NOW });
    // #when
    await publishHistoryFiles(c);
    // #then
    expect({ leaders: await env.PUBLIC.get('v1/day-leaders.json'), history: (await env.PUBLIC.get('v1/history.json')) !== null, alerts }).toEqual({
      leaders: null,
      history: true,
      alerts: [{ signature: 'day-leaders-publish', text: 'day-leaders.json was not published: D1 unavailable' }],
    });
  });
});

describe('day-leaders.json weeks', () => {
  it('lists the top 3 source chains by fees for each of the last 8 complete Monday–Sunday weeks', async () => {
    // #given the week of Oct 5–11 sums to B 7, A 5, D 2 and C 1
    const totals = (day: string) => ({ day, messages: 1, token_messages: 0, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
    const chain = (day: string, key: string, fee_usd: number) => ({ day, dim: 'src_chain' as const, key, messages: 1, usd_value: 1, fee_usd });
    await store.replaceDaily(env.DB, totals('2026-10-06'), [chain('2026-10-06', 'A', 5), chain('2026-10-06', 'B', 3)], '2026-10-12T00:07:00.000Z');
    await store.replaceDaily(env.DB, totals('2026-10-08'), [chain('2026-10-08', 'B', 4), chain('2026-10-08', 'C', 1), chain('2026-10-08', 'D', 2)], '2026-10-12T00:07:00.000Z');
    // #when on Monday the 12th and on Sunday the 11th
    await publishHistoryFiles(harness({ now: '2026-10-12T00:07:00.000Z' }).c);
    const monday = await readPublic('day-leaders.json');
    await publishHistoryFiles(harness({ now: '2026-10-11T00:07:00.000Z' }).c);
    const sunday = await readPublic('day-leaders.json');
    // #then the week is complete only once its Sunday is over
    expect({
      weeks: monday.weeks.map((w: { week: string }) => w.week),
      top: monday.weeks.at(-1).fee_chains.map((l: { key: string }) => l.key),
      sundayLast: sunday.weeks.at(-1).week,
    }).toEqual({
      weeks: ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'],
      top: ['B', 'A', 'D'],
      sundayLast: '2026-09-28',
    });
  });
});
```

- [ ] **Step 4: Run them and confirm they fail.**
  - Run `pnpm --filter @ccip-dev/core exec vitest run test/public.test.ts`. Expected: FAIL, `DayLeadersFileSchema` is undefined.
  - Run `pnpm --filter @ccip-dev/worker exec vitest run test/store.test.ts test/publish.test.ts`. Expected: FAIL. `store.dailyLeaders` is not a function, the `'messages'` order has no SQL, and `day-leaders.json` is not published.

- [ ] **Step 5: Add the schema.** In `packages/core/src/public.ts`, after `CostFileSchema`, add:

```ts
export const LeaderSchema = z.object({
  key: z.string(),
  label: z.string().nullable(),
  messages: z.number(),
  usd: z.number().nullable(),
  fee_usd: z.number().nullable(),
});

export const DayLeadersSchema = z.object({
  day: z.string(),
  token: LeaderSchema.nullable(),
  sender: LeaderSchema.nullable(),
  lane: LeaderSchema.nullable(),
  fee_lane: LeaderSchema.nullable(),
  fee_chain: LeaderSchema.nullable(),
});

export const WeekLeadersSchema = z.object({ week: z.string(), fee_chains: z.array(LeaderSchema) });

export const DayLeadersFileSchema = z.object({ ...envelope, days: z.array(DayLeadersSchema), weeks: z.array(WeekLeadersSchema) });
```

  - In `PUBLIC_SCHEMAS`, after `'cost.json': CostFileSchema,`, add `'day-leaders.json': DayLeadersFileSchema,`.
  - With the other types, add `export type Leader = z.infer<typeof LeaderSchema>;`, `export type DayLeaders = z.infer<typeof DayLeadersSchema>;`, `export type WeekLeaders = z.infer<typeof WeekLeadersSchema>;` and `export type DayLeadersFile = z.infer<typeof DayLeadersFileSchema>;`.

- [ ] **Step 6: Add the orders and the per-day query** in `worker/src/store.ts`. Replace everything from `export type TopOrder = 'value' | 'fees';` through the end of `topBetween` with:

```ts
export type TopOrder = 'value' | 'fees' | 'messages';

/** Each order ends on the key, so keys tied on every figure always rank the same way, per day and per window. */
const ORDER_COLUMNS: Record<TopOrder, string> = {
  value: 'usd_value DESC, messages DESC, key',
  fees: 'fee_usd DESC, usd_value DESC, key',
  messages: 'messages DESC, usd_value DESC, key',
};

/** By fees, a key with no fee data in the window has nothing to rank by, so it is left out. */
const TOP_ORDER_SQL: Record<TopOrder, string> = {
  value: `ORDER BY ${ORDER_COLUMNS.value}`,
  fees: `HAVING SUM(fee_usd) IS NOT NULL ORDER BY ${ORDER_COLUMNS.fees}`,
  messages: `ORDER BY ${ORDER_COLUMNS.messages}`,
};

export interface BreakdownRow {
  key: string;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

export interface LeaderRow extends BreakdownRow {
  day: string;
}

export async function topBetween(
  db: D1Database,
  dim: Dim,
  fromDay: string | null,
  toDay: string,
  limit: number,
  order: TopOrder,
): Promise<BreakdownRow[]> {
  const { results } = await db
    .prepare(
      `SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
       FROM daily_breakdown WHERE dim = ? AND day >= ? AND day <= ?
       GROUP BY key ${TOP_ORDER_SQL[order]} LIMIT ?`,
    )
    .bind(dim, fromDay ?? '0000-00-00', toDay, limit)
    .all<BreakdownRow>();
  return results;
}

/** Each day's first row of `dim` in `order` over [fromDay, toDay]: for one day, the same ranking topBetween gives. */
export async function dailyLeaders(db: D1Database, dim: Dim, order: TopOrder, fromDay: string, toDay: string): Promise<LeaderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT day, key, messages, usd_value, fee_usd FROM (
         SELECT day, key, messages, usd_value, fee_usd, ROW_NUMBER() OVER (PARTITION BY day ORDER BY ${ORDER_COLUMNS[order]}) AS rn
         FROM daily_breakdown WHERE dim = ?1 AND day >= ?2 AND day <= ?3${order === 'fees' ? ' AND fee_usd IS NOT NULL' : ''}
       ) WHERE rn = 1 ORDER BY day`,
    )
    .bind(dim, fromDay, toDay)
    .all<LeaderRow>();
  return results;
}
```

- [ ] **Step 7: Publish the file** in `worker/src/publish.ts`.
  - Add `weekStart` to the `@ccip-dev/core` import, and add `import type { DayLeaders, Leader } from '@ccip-dev/core/public';`.
  - Add `leaders: 300` to `TTL`: `{ live: 30, today: 30, status: 30, history: 300, top: 300, reserve: 300, replay: 300, cost: 300, leaders: 300, chains: 3600, tokens: 3600 }`.
  - After `publishCost`, add:

```ts
export const DAY_LEADERS_DAYS = 400;
export const LEADER_WEEKS = 8;

export function leader(r: store.BreakdownRow, label: string | null): Leader {
  return { key: r.key, label, messages: r.messages, usd: usd(r.usd_value), fee_usd: usd(r.fee_usd) };
}

/** Each day's leaders over [fromDay, toDay]: the top token and lane by value, the top sender by messages, and the top lane and source chain by fees. */
export async function dayLeaderEntries(c: RunContext, fromDay: string, toDay: string): Promise<DayLeaders[]> {
  const db = c.env.DB;
  const tokens = await store.dailyLeaders(db, 'token', 'value', fromDay, toDay);
  const senders = await store.dailyLeaders(db, 'sender', 'messages', fromDay, toDay);
  const lanes = await store.dailyLeaders(db, 'lane', 'value', fromDay, toDay);
  const feeLanes = await store.dailyLeaders(db, 'lane', 'fees', fromDay, toDay);
  const feeChains = await store.dailyLeaders(db, 'src_chain', 'fees', fromDay, toDay);
  const symbols = await store.tokenSymbols(db, tokens.map((r) => splitTokenKey(r.key)));
  const names = await store.chainNames(db);
  const byDay = (rows: store.LeaderRow[]) => new Map(rows.map((r) => [r.day, r]));
  const [token, sender, lane, feeLane, feeChain] = [tokens, senders, lanes, feeLanes, feeChains].map(byDay);
  const days = [...new Set([tokens, senders, lanes, feeLanes, feeChains].flat().map((r) => r.day))].sort();
  return days.map((day) => {
    const t = token!.get(day);
    const s = sender!.get(day);
    const l = lane!.get(day);
    const fl = feeLane!.get(day);
    const fc = feeChain!.get(day);
    return {
      day,
      token: t ? leader(t, symbolOf(symbols, t.key)) : null,
      sender: s ? leader(s, senderLabel(c, names, s.key)) : null,
      lane: l ? leader(l, null) : null,
      fee_lane: fl ? leader(fl, null) : null,
      fee_chain: fc ? leader(fc, null) : null,
    };
  });
}

/** The Monday of the last Monday–Sunday week that ends on or before `lastDay`. */
export function lastCompleteMonday(lastDay: string): string {
  return addDays(weekStart(addDays(lastDay, 1)), -7);
}

export async function weekFeeChains(c: RunContext, monday: string): Promise<Leader[]> {
  return (await store.topBetween(c.env.DB, 'src_chain', monday, addDays(monday, 6), 3, 'fees')).map((r) => leader(r, null));
}

export async function publishDayLeaders(c: RunContext, now: Date): Promise<void> {
  const today = dayOf(now);
  const lastDay = addDays(today, -1);
  const days = await dayLeaderEntries(c, addDays(today, -DAY_LEADERS_DAYS), lastDay);
  const latest = lastCompleteMonday(lastDay);
  const weeks: { week: string; fee_chains: Leader[] }[] = [];
  for (let i = LEADER_WEEKS - 1; i >= 0; i--) {
    const monday = addDays(latest, -7 * i);
    weeks.push({ week: monday, fee_chains: await weekFeeChains(c, monday) });
  }
  await putJson(c.env.PUBLIC, 'day-leaders.json', { days, weeks }, TTL.leaders, now);
}
```

  - In `publishHistoryFiles`, right after the `cost-publish` `try … catch`, add:

```ts
  try {
    await publishDayLeaders(c, now);
  } catch (err) {
    await c.alert('day-leaders-publish', `day-leaders.json was not published: ${err instanceof Error ? err.message : String(err)}`);
  }
```

  `splitTokenKey`, `symbolOf` and `senderLabel` are already in `publish.ts`; `splitTokenKey` and `symbolOf` are declared below `publishLiveFiles` as `function` declarations, so they are hoisted.

- [ ] **Step 8: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/core test && pnpm --filter @ccip-dev/worker test && pnpm typecheck`. Expected: all pass. That includes:
  - "public file contract", which now also validates `day-leaders.json`;
  - the `cost-publish` test, whose run raises no other alert;
  - the finalize tests, whose recorded output raises no alert.

- [ ] **Step 9: Add the alert to the runbook.** In `docs/runbook.md`, in the "Incidents and alerts" table, after the `cost-publish` row, add:

```markdown
| `day-leaders-publish` | `day-leaders.json` was not published; the other history files still were. The broadcast cards read it, so that finalize's daily and weekly cards answer 404 and are not posted (the hourly runs retry them once the next publish works). Read the error in the alert and the finalize logs. |
```

- [ ] **Step 10: Commit.**

```bash
git add packages/core/src/public.ts packages/core/test/public.test.ts worker/src/store.ts worker/src/publish.ts worker/test/store.test.ts worker/test/publish.test.ts docs/runbook.md
git commit -m "feat(worker): day-leaders.json, each day's and week's leaders for the broadcast cards"
```

---

### Task 6: Worker broadcast facts and tags

**Files:**
- Modify: `worker/src/publish.ts` (`historyDays`, `largestFeeEntries`, `LARGEST_FEES_LIMIT` exported, `WeekLeaderRows`, `weekLeaderRows`; `publishHistoryFiles` uses the first two)
- Modify: `worker/src/store.ts` (`tokenGroupIds`)
- Create: `worker/src/broadcasts/tags.ts`
- Create: `worker/src/broadcasts/facts.ts`
- Test: `worker/test/broadcast-facts.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `chainNameMap`, `shortAddress` from `@ccip-dev/core/names`.
  - Task 3: `RunContext.handles`, `Handles`, `lookupLabel`.
  - Task 4: `dayTotalsFacts`, `weekTotalsFacts`, `recordDriver`, `RECORD_TOTAL`, `allTimeTotal`, `reserveDepositFacts`, `recordsSetOn`, `type RecordSet`, `type MilestoneSet`.
  - Task 5: `dayLeaderEntries`, `weekFeeChains`, `leader`, `type DayLeaders`, `type Leader`.
- Produces:
  - In `publish.ts`:
    - `historyDays(c: RunContext): Promise<DayTotals[]>` (the rows `history.json` publishes);
    - `LARGEST_FEES_LIMIT = 10`;
    - `largestFeeEntries(c: RunContext, throughDay: string, limit: number, classify: FeeClassifier): Promise<LargestFee[]>`;
    - `interface WeekLeaderRows { token: Leader | null; sender: Leader | null; lane: Leader | null; feeChains: Leader[] }`;
    - `weekLeaderRows(c: RunContext, monday: string): Promise<WeekLeaderRows>`.
  - `store.tokenGroupIds(db: D1Database, tokens: { chain: string; address: string }[]): Promise<Map<string, string | null>>`, keyed `${chain}:${normalizeAddress(address)}`.
  - `tags.ts`:
    - `interface Player { name: string; x: string | null }`;
    - `interface Tagger { chain(selector: string): Player; sender(key: string): Player; tokenProject(key: string): Player | null }`;
    - `createTagger(c: RunContext, tokenKeys: readonly string[]): Promise<Tagger>`.
  - `facts.ts`:
    - the facts types `LaneFacts`, `TokenFacts`, `SenderFacts`, `ChainFeeFacts`, `LeaderFacts`, `DailyFacts`, `WeeklyFacts`, `RecordFacts`, `MilestoneFacts`, `ReserveFacts` and `type BroadcastFacts` (their fields are in Step 5);
    - `interface FactsSource { history: DayTotals[]; largest: LargestFee[]; leaders: ReadonlyMap<string, DayLeaders>; week: WeekLeaderRows | null; tags: Tagger }`;
    - `loadFactsSource(c: RunContext, o: { days: readonly string[]; monday: string | null }): Promise<FactsSource>`;
    - `dailyFacts(src, day): DailyFacts | null`, `weeklyFacts(src, monday): WeeklyFacts | null`, `recordFacts(src, record: RecordSet): RecordFacts`, `milestoneFacts(src, m: MilestoneSet): MilestoneFacts`, `reserveFacts(reserve: Pick<ReserveFile, 'transfers' | 'weekly'>, tx: string): ReserveFacts | null`.

- [ ] **Step 1: Write the failing tests.** Create `worker/test/broadcast-facts.test.ts`:

```ts
import { labelKey, type Dim } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { dailyFacts, loadFactsSource, recordFacts, weeklyFacts } from '../src/broadcasts/facts';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-11T00:07:00.000Z';
const DAY = '2026-10-10';
const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const SYRUP_ETH = '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b';
const SYRUP_BASE = '0x660975730059246a68521a3e2fbd4740173100f5';
const SENDER = '0x7af7632562b6063e52788607ad56f7a60f57ce09';
const OTHER = '0x1111111111111111111111111111111111111111';
const PRIOR = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const totals = (day: string, messages: number, usd: number, fee: number | null) => ({
  day, messages, token_messages: 0, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0,
});
const row = (day: string, dim: Dim, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim, key, messages, usd_value, fee_usd });
const HANDLES = {
  chains: { 'ethereum-mainnet': 'ethereum', 'ethereum-mainnet-base-1': 'base' },
  tokens: [{ chain: 'ethereum-mainnet', address: SYRUP_ETH, project: 'Maple', x: 'maplefinance' }],
};
const LABELS = { [labelKey('ethereum-mainnet', SENDER)]: { name: 'xStocks', x: 'xStocksFi', kind: 'issuer' as const } };

/** Seven days of 200 messages, $8M and $4 in fees, then a day of 150 messages, $2M and $5 with one of each leader. */
async function seedDay(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc], [
    { chainSelector: ETH, address: SYRUP_ETH, symbol: 'syrupUSDC', name: 'Syrup USDC', decimals: 6, groupId: 'syrup' },
    { chainSelector: BASE, address: SYRUP_BASE, symbol: 'syrupUSDC', name: 'Syrup USDC', decimals: 6, groupId: 'syrup' },
  ]);
  for (const day of PRIOR) await store.replaceDaily(env.DB, totals(day, 200, 8e6, 4), [], NOW);
  await store.replaceDaily(env.DB, totals(DAY, 150, 2e6, 5), [
    row(DAY, 'token', `${BASE}:${SYRUP_BASE}`, 40, 500_000, null),
    row(DAY, 'token', `${ETH}:0xother`, 10, 100_000, null),
    row(DAY, 'sender', `${ETH}:${SENDER}`, 97, 300_000, 1),
    row(DAY, 'sender', `${BASE}:${OTHER}`, 20, 1_500_000, 3),
    row(DAY, 'lane', `${ETH}>${BASE}`, 30, 1_200_000, 1),
    row(DAY, 'lane', `${BASE}>${BSC}`, 60, 800_000, 4),
    row(DAY, 'src_chain', ETH, 90, 1_200_000, 1),
    row(DAY, 'src_chain', BASE, 60, 800_000, 4),
  ], NOW);
  await store.setFeeGroupTotals(env.DB, DAY, { link_usd: 1.25, native_usd: 3.75, stable_usd: 0, link_amount: 0.1 });
}

describe('daily facts', () => {
  it("gives the day's totals and leaders, tagging a token's project through its registry group", async () => {
    // #given the project's token entry is on Ethereum and the day's top token is its copy on Base
    await seedDay();
    const { c } = harness({ now: NOW, labels: LABELS, handles: HANDLES });
    // #when
    const facts = dailyFacts(await loadFactsSource(c, { days: [DAY], monday: null }), DAY);
    // #then
    expect(facts).toEqual({
      kind: 'daily',
      day: DAY,
      totals: { day: DAY, messages: { value: 150, pct: -25 }, value: { value: 2e6, pct: -75 }, fees: { value: 5, pct: 25 }, linkSharePct: 25, linkUsd: 1.25, linkAmount: 0.1 },
      leaders: {
        token: { key: `${BASE}:${SYRUP_BASE}`, symbol: 'syrupUSDC', project: { name: 'Maple', x: 'maplefinance' }, usd: 500_000, sharePct: 25 },
        sender: { key: `${ETH}:${SENDER}`, player: { name: 'xStocks', x: 'xStocksFi' }, messages: 97 },
        lane: { key: `${ETH}>${BASE}`, src: { name: 'Ethereum', x: 'ethereum' }, dst: { name: 'Base', x: 'base' }, usd: 1_200_000, messages: 30, feeUsd: 1 },
      },
      feeChain: { key: BASE, player: { name: 'Base', x: 'base' }, feeUsd: 4 },
      records: [{ kind: 'fees', day: DAY, value: 5, previous: { day: '2026-10-03', value: 4 }, stoodDays: 7 }],
    });
  });

  it('writes an unlabeled sender as its short address, a chain without a handle by its name, and no project without an entry', async () => {
    // #given no labels and no handles
    await seedDay();
    const { c } = harness({ now: NOW });
    // #when
    const facts = dailyFacts(await loadFactsSource(c, { days: [DAY], monday: null }), DAY);
    // #then
    expect({ sender: facts?.leaders.sender?.player, src: facts?.leaders.lane?.src, project: facts?.leaders.token?.project }).toEqual({
      sender: { name: '0x7af7…ce09', x: null },
      src: { name: 'Ethereum', x: null },
      project: null,
    });
  });

  it('has nothing for a day without totals', async () => {
    await seedDay();
    const { c } = harness({ now: NOW });
    expect(dailyFacts(await loadFactsSource(c, { days: [DAY], monday: null }), '2026-10-01')).toBeNull();
  });
});

describe('weekly facts', () => {
  it('totals the Monday–Sunday week against the one before, with its top 3 fee chains', async () => {
    // #given fees by source chain over Oct 5–11: Base 4 + 6, BNB 2 and Ethereum 1; the week before has Oct 3 and 4
    await seedDay();
    await store.replaceDaily(env.DB, totals('2026-10-11', 10, 10, 9), [row('2026-10-11', 'src_chain', BASE, 1, 1, 6), row('2026-10-11', 'src_chain', BSC, 1, 1, 2)], NOW);
    const { c } = harness({ now: '2026-10-12T00:07:00.000Z', handles: HANDLES });
    // #when
    const facts = weeklyFacts(await loadFactsSource(c, { days: ['2026-10-11'], monday: '2026-10-05' }), '2026-10-05');
    // #then 5 × 200 + 150 + 10 = 1,160 messages against 400
    expect({ messages: facts?.totals.messages, chains: facts?.feeChains.map((f) => [f.player.name, f.feeUsd]), lane: facts?.leaders.lane?.key }).toEqual({
      messages: { value: 1_160, pct: 190 },
      chains: [['Base', 10], ['BNB Chain', 2], ['Ethereum', 1]],
      lane: `${ETH}>${BASE}`,
    });
  });
});

describe('record facts', () => {
  it("carries what drove a fees record: the day's top lane by fees and its messages, and the all-time fees", async () => {
    // #given
    await seedDay();
    const { c } = harness({ now: NOW, handles: HANDLES });
    const src = await loadFactsSource(c, { days: [DAY], monday: null });
    // #when
    const facts = recordFacts(src, dailyFacts(src, DAY)!.records[0]!);
    // #then 7 × $4 + $5
    expect({ driver: facts.driver, route: facts.route, allTime: facts.allTime }).toEqual({
      driver: { lane: `${BASE}>${BSC}`, messages: 60, usd: 800_000, feeUsd: 4, symbol: null },
      route: { src: { name: 'Base', x: 'base' }, dst: { name: 'BNB Chain', x: null } },
      allTime: 33,
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @ccip-dev/worker exec vitest run test/broadcast-facts.test.ts`. Expected: FAIL, `../src/broadcasts/facts` does not exist.

- [ ] **Step 3: Share the published rows** in `worker/src/publish.ts`.
  - Add `type FeeClassifier` to the `@ccip-dev/core` import, and change the public import to `import type { DayLeaders, DayTotals, LargestFee, Leader } from '@ccip-dev/core/public';`.
  - Change `const LARGEST_FEES_LIMIT = 10;` to `export const LARGEST_FEES_LIMIT = 10;`.
  - Before `publishHistoryFiles`, add:

```ts
/** history.json's day rows: the daily totals with their fee groups, rounded as published. */
export async function historyDays(c: RunContext): Promise<DayTotals[]> {
  const db = c.env.DB;
  const groups = await store.feeGroupsByDay(db);
  return (await store.dailyHistory(db)).map((d) => {
    const g = groups.get(d.day);
    return {
      ...d,
      usd_value: usd(d.usd_value) ?? 0,
      fee_usd: usd(d.fee_usd),
      fee_link_usd: usd(g?.link_usd ?? null),
      fee_native_usd: usd(g?.native_usd ?? null),
      fee_stable_usd: usd(g?.stable_usd ?? null),
      fee_link_amount: linkAmount(g?.link_amount ?? null),
    };
  });
}

export async function largestFeeEntries(c: RunContext, throughDay: string, limit: number, classify: FeeClassifier): Promise<LargestFee[]> {
  return (await store.largestFees(c.env.DB, throughDay, limit)).map((r) => ({
    message_id: r.message_id,
    day: r.day,
    src: r.src_chain,
    dst: r.dst_chain,
    fee_usd: usd(r.fee_usd) ?? 0,
    symbol: r.fee_token === null ? null : classify(r.src_chain, r.fee_token).symbol,
  }));
}

export interface WeekLeaderRows {
  token: Leader | null;
  sender: Leader | null;
  lane: Leader | null;
  feeChains: Leader[];
}

/** A Monday–Sunday week's top token and lane by value, top sender by messages and top 3 source chains by fees. */
export async function weekLeaderRows(c: RunContext, monday: string): Promise<WeekLeaderRows> {
  const db = c.env.DB;
  const sunday = addDays(monday, 6);
  const [token] = await store.topBetween(db, 'token', monday, sunday, 1, 'value');
  const [sender] = await store.topBetween(db, 'sender', monday, sunday, 1, 'messages');
  const [lane] = await store.topBetween(db, 'lane', monday, sunday, 1, 'value');
  const symbols = token ? await store.tokenSymbols(db, [splitTokenKey(token.key)]) : new Map<string, string>();
  const names = await store.chainNames(db);
  return {
    token: token ? leader(token, symbolOf(symbols, token.key)) : null,
    sender: sender ? leader(sender, senderLabel(c, names, sender.key)) : null,
    lane: lane ? leader(lane, null) : null,
    feeChains: await weekFeeChains(c, monday),
  };
}
```

  - In `publishHistoryFiles`, replace the lines from `const history = await store.dailyHistory(db);` through the `history.json` `putJson(…)` call with:

```ts
  const days = await historyDays(c);
  const linkTokens = await store.linkFeeTokens(db);
  const classify = feeClassifier(linkTokens);
  const since = (await store.getMeta(db, 'coverage_from')) ?? days[0]?.day ?? null;
  await putJson(
    c.env.PUBLIC,
    'history.json',
    { since, days, largest_fees: await largestFeeEntries(c, days.at(-1)?.day ?? '', LARGEST_FEES_LIMIT, classify) },
    TTL.history,
    now,
  );
```

  Run `pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts test/finalize.test.ts`. Expected: PASS; `history.json` is unchanged.

- [ ] **Step 4: Add the token-group lookup** in `worker/src/store.ts`, after `tokenSymbols`:

```ts
/** Registry token groups by `${chain}:${normalized address}`; null for a registry token without a group. */
export async function tokenGroupIds(db: D1Database, tokens: { chain: string; address: string }[]): Promise<Map<string, string | null>> {
  const groups = new Map<string, string | null>();
  const wanted = [...new Map(tokens.map((t) => [tokenKey(t.chain, t.address), t])).values()];
  for (const chunk of chunks(wanted, PARAM_CHUNK / 2)) {
    const { results } = await db
      .prepare(`SELECT chain, address, group_id FROM tokens WHERE ${chunk.map(() => '(chain = ? AND lower(address) = ?)').join(' OR ')}`)
      .bind(...chunk.flatMap((t) => [t.chain, t.address.toLowerCase()]))
      .all<{ chain: string; address: string; group_id: string | null }>();
    for (const r of results) groups.set(tokenKey(r.chain, r.address), r.group_id);
  }
  return groups;
}
```

- [ ] **Step 5: Write the tagger and the facts.**
  - Create `worker/src/broadcasts/tags.ts`:

```ts
import { normalizeAddress } from '@ccip-dev/core';
import { chainNameMap, shortAddress } from '@ccip-dev/core/names';
import type { RunContext } from '../context';
import { lookupLabel } from '../labels';
import * as store from '../store';

/** A project, sender or chain a post names: tagged as @x when it has a verified handle, otherwise written as its name. */
export interface Player {
  name: string;
  x: string | null;
}

export interface Tagger {
  chain(selector: string): Player;
  sender(key: string): Player;
  tokenProject(key: string): Player | null;
}

const splitKey = (key: string) => {
  const at = key.indexOf(':');
  return { chain: key.slice(0, at), address: key.slice(at + 1) };
};

/** `tokenKeys` are the `${selector}:${address}` tokens whose project a post may tag; their groups are read from D1 up front. */
export async function createTagger(c: RunContext, tokenKeys: readonly string[]): Promise<Tagger> {
  const db = c.env.DB;
  const display = await store.chainDisplayNames(db);
  const shortNames = chainNameMap([...display].map(([selector, n]) => ({ selector, name: n.name, display_name: n.display_name })));
  const selectorOf = new Map([...display].flatMap(([selector, n]) => (n.name ? [[n.name, selector] as const] : [])));
  const entries = c.handles.tokens.flatMap((e) => {
    const selector = selectorOf.get(e.chain);
    return selector ? [{ ...e, selector }] : [];
  });
  const groups = await store.tokenGroupIds(db, [...tokenKeys.map(splitKey), ...entries.map((e) => ({ chain: e.selector, address: e.address }))]);
  const groupOf = (chain: string, address: string) => groups.get(`${chain}:${normalizeAddress(address)}`) ?? null;
  const projects = new Map<string, Player>();
  for (const key of tokenKeys) {
    const { chain, address } = splitKey(key);
    const group = groupOf(chain, address);
    const match = entries.find(
      (e) => (group !== null && groupOf(e.selector, e.address) === group) || (e.selector === chain && e.address === normalizeAddress(address)),
    );
    if (match) projects.set(key, { name: match.project, x: match.x });
  }
  const chainHandle = (selector: string) => {
    const name = display.get(selector)?.name;
    return name && Object.hasOwn(c.handles.chains, name) ? c.handles.chains[name]! : null;
  };
  return {
    chain: (selector) => ({ name: shortNames.get(selector) ?? selector, x: chainHandle(selector) }),
    sender: (key) => {
      const { chain, address } = splitKey(key);
      const label = lookupLabel(c.labels, display.get(chain)?.name ?? undefined, address);
      return label ? { name: label.name, x: label.x ?? null } : { name: shortAddress(address), x: null };
    },
    tokenProject: (key) => projects.get(key) ?? null,
  };
}
```

  - Create `worker/src/broadcasts/facts.ts`:

```ts
import { feeClassifier } from '@ccip-dev/core';
import {
  allTimeTotal, dayTotalsFacts, RECORD_TOTAL, recordDriver, reserveDepositFacts, weekTotalsFacts,
  type DayTotalsFacts, type RecordDriver, type ReserveDepositFacts, type WeekTotalsFacts,
} from '@ccip-dev/core/broadcasts';
import { shortAddress } from '@ccip-dev/core/names';
import type { DayLeaders, DayTotals, LargestFee, Leader, ReserveFile } from '@ccip-dev/core/public';
import { recordsSetOn, type MilestoneSet, type RecordSet } from '@ccip-dev/core/records';
import type { RunContext } from '../context';
import { dayLeaderEntries, historyDays, LARGEST_FEES_LIMIT, largestFeeEntries, weekLeaderRows, type WeekLeaderRows } from '../publish';
import * as store from '../store';
import { createTagger, type Player, type Tagger } from './tags';

export interface LaneFacts {
  key: string;
  src: Player;
  dst: Player;
  usd: number | null;
  messages: number;
  feeUsd: number | null;
}

export interface TokenFacts {
  key: string;
  symbol: string;
  project: Player | null;
  usd: number | null;
  /** Share of the period's value moved. */
  sharePct: number | null;
}

export interface SenderFacts {
  key: string;
  player: Player;
  messages: number;
}

export interface ChainFeeFacts {
  key: string;
  player: Player;
  feeUsd: number | null;
}

export interface LeaderFacts {
  token: TokenFacts | null;
  sender: SenderFacts | null;
  lane: LaneFacts | null;
}

export interface DailyFacts {
  kind: 'daily';
  day: string;
  totals: DayTotalsFacts;
  leaders: LeaderFacts;
  feeChain: ChainFeeFacts | null;
  records: RecordSet[];
}

export interface WeeklyFacts {
  kind: 'weekly';
  monday: string;
  totals: WeekTotalsFacts;
  leaders: LeaderFacts;
  feeChains: ChainFeeFacts[];
}

export interface RecordFacts {
  kind: 'record';
  record: RecordSet;
  driver: RecordDriver | null;
  route: { src: Player; dst: Player } | null;
  allTime: number;
}

export interface MilestoneFacts {
  kind: 'milestone';
  milestone: MilestoneSet;
  allTime: number;
}

export interface ReserveFacts {
  kind: 'reserve';
  deposit: ReserveDepositFacts;
}

export type BroadcastFacts = DailyFacts | WeeklyFacts | RecordFacts | MilestoneFacts | ReserveFacts;

export interface FactsSource {
  history: DayTotals[];
  largest: LargestFee[];
  leaders: ReadonlyMap<string, DayLeaders>;
  week: WeekLeaderRows | null;
  tags: Tagger;
}

/**
 * Reads what the finalize broadcasts for `days` (and the week from `monday`) need from D1, through the functions that build
 * history.json and day-leaders.json, so a caption and its card show the same numbers.
 */
export async function loadFactsSource(c: RunContext, o: { days: readonly string[]; monday: string | null }): Promise<FactsSource> {
  const sorted = [...o.days].sort();
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const history = await historyDays(c);
  const largest = await largestFeeEntries(c, last, LARGEST_FEES_LIMIT, feeClassifier(await store.linkFeeTokens(c.env.DB)));
  const leaders = new Map((await dayLeaderEntries(c, first, last)).map((d) => [d.day, d]));
  const week = o.monday === null ? null : await weekLeaderRows(c, o.monday);
  const tokenKeys = [...[...leaders.values()].flatMap((d) => (d.token ? [d.token.key] : [])), ...(week?.token ? [week.token.key] : [])];
  return { history, largest, leaders, week, tags: await createTagger(c, tokenKeys) };
}

const laneEnds = (key: string): [string, string] => {
  const [src = '', dst = ''] = key.split('>');
  return [src, dst];
};

function laneFacts(tags: Tagger, l: Leader): LaneFacts {
  const [src, dst] = laneEnds(l.key);
  return { key: l.key, src: tags.chain(src), dst: tags.chain(dst), usd: l.usd, messages: l.messages, feeUsd: l.fee_usd };
}

function leaderFacts(tags: Tagger, token: Leader | null, sender: Leader | null, lane: Leader | null, periodValue: number | null): LeaderFacts {
  return {
    token: token
      ? {
          key: token.key,
          symbol: token.label ?? shortAddress(token.key.slice(token.key.indexOf(':') + 1)),
          project: tags.tokenProject(token.key),
          usd: token.usd,
          sharePct: token.usd === null || !periodValue ? null : (token.usd / periodValue) * 100,
        }
      : null,
    sender: sender ? { key: sender.key, player: tags.sender(sender.key), messages: sender.messages } : null,
    lane: lane ? laneFacts(tags, lane) : null,
  };
}

const chainFee = (tags: Tagger, l: Leader): ChainFeeFacts => ({ key: l.key, player: tags.chain(l.key), feeUsd: l.fee_usd });

export function dailyFacts(src: FactsSource, day: string): DailyFacts | null {
  const totals = dayTotalsFacts(src.history, day);
  if (totals === null) return null;
  const lead = src.leaders.get(day) ?? null;
  return {
    kind: 'daily',
    day,
    totals,
    leaders: leaderFacts(src.tags, lead?.token ?? null, lead?.sender ?? null, lead?.lane ?? null, totals.value.value),
    feeChain: lead?.fee_chain ? chainFee(src.tags, lead.fee_chain) : null,
    records: recordsSetOn(src.history, src.largest, day),
  };
}

export function weeklyFacts(src: FactsSource, monday: string): WeeklyFacts | null {
  const totals = weekTotalsFacts(src.history, monday);
  if (totals === null || src.week === null) return null;
  return {
    kind: 'weekly',
    monday,
    totals,
    leaders: leaderFacts(src.tags, src.week.token, src.week.sender, src.week.lane, totals.value.value),
    feeChains: src.week.feeChains.map((l) => chainFee(src.tags, l)),
  };
}

export function recordFacts(src: FactsSource, record: RecordSet): RecordFacts {
  const driver = recordDriver(record, src.leaders.get(record.day) ?? null, src.largest);
  const route = driver ? laneEnds(driver.lane) : null;
  return {
    kind: 'record',
    record,
    driver,
    route: route ? { src: src.tags.chain(route[0]), dst: src.tags.chain(route[1]) } : null,
    allTime: allTimeTotal(RECORD_TOTAL[record.kind], src.history, record.day),
  };
}

export function milestoneFacts(src: FactsSource, milestone: MilestoneSet): MilestoneFacts {
  return { kind: 'milestone', milestone, allTime: allTimeTotal(milestone.metric, src.history, milestone.day) };
}

export function reserveFacts(reserve: Pick<ReserveFile, 'transfers' | 'weekly'>, tx: string): ReserveFacts | null {
  const deposit = reserveDepositFacts(reserve, tx);
  return deposit ? { kind: 'reserve', deposit } : null;
}
```

  `allTimeTotal(milestone.metric, …)` type-checks because `MilestoneMetric` (`'messages' | 'value' | 'fees'`) is a subset of `TotalMetric`.

- [ ] **Step 6: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/worker test && pnpm typecheck`. Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add worker/src/publish.ts worker/src/store.ts worker/src/broadcasts/tags.ts worker/src/broadcasts/facts.ts worker/test/broadcast-facts.test.ts
git commit -m "feat(worker): broadcast facts from D1, tagged with verified handles"
```

---

### Task 7: X and Telegram copy

**Files:**
- Create: `worker/src/broadcasts/x-length.ts`
- Create: `worker/src/broadcasts/copy.ts`
- Test: `worker/test/broadcast-copy.test.ts`

**Interfaces:**
- Consumes: Task 4's `recordValueText` and the facts types from Task 6 (`BroadcastFacts` and its members, `Player`).
- Produces:
  - `xLength(text: string): number`.
  - `X_MAX = 280` and `TELEGRAM_CAPTION_MAX = 1024`.
  - `interface Line { text: string; drop?: number }`, `DROP = { lane: 1, sender: 2, token: 3, feeChains: 4, closing: 5 }` and `fitLines(lines: readonly Line[], fits: (text: string) => boolean): string`, which throws when even the undroppable lines do not fit.
  - `noLinks(name: string): string`; `postDay(day)`, for example "Sat, Oct 10"; `weekRange(monday)`, "Oct 5–11" or "Sep 28 – Oct 4".
  - `interface Copy { xText: string; telegramHtml: string }` and `composeCopy(facts: BroadcastFacts): Copy`.

**Facts behind the counter** (checked on 2026-10-11):
- The source is twitter-text's `config/v3.json`: `scale` 100, `defaultWeight` 200, `maxWeightedTweetLength` 280, `transformedURLLength` 23, and ranges of weight 100: U+0000–U+10FF, U+2000–U+200D, U+2010–U+201F and U+2032–U+2037.
- `parseTweet` normalizes to NFC, counts each emoji match (twemoji-parser) as 200, and counts every other code point by its range.
- So `·` and `—` count 1, while `→ ▲ ▼ ₮ …` and every CJK character count 2.
- The counter here follows that rule with `Intl.Segmenter` (workerd supports it): a grapheme holding an `Extended_Pictographic` or `Regional_Indicator` code point, or a keycap, counts 2.
- The prototype of this module gave 2 for 🚨, 👨‍👩‍👧, 🇺🇸, ❤️ and #️⃣, 6 for `USD₮0`, and 4 for `cafe` plus a combining acute accent.
- Posts never contain URLs, so the 23-character URL rule is not implemented.
- Why no package: `twitter-text` would add a large TLD table and `twemoji-parser` for one function, and the project prefers no new dependencies. The rule fits in 15 lines, pinned by the tests below.

- [ ] **Step 1: Write the failing tests.** Create `worker/test/broadcast-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composeCopy, fitLines, noLinks, TELEGRAM_CAPTION_MAX, X_MAX } from '../src/broadcasts/copy';
import type { DailyFacts, MilestoneFacts, RecordFacts, ReserveFacts, WeeklyFacts } from '../src/broadcasts/facts';
import { xLength } from '../src/broadcasts/x-length';

const p = (name: string, x: string | null = null) => ({ name, x });
const DAILY: DailyFacts = {
  kind: 'daily',
  day: '2026-10-10',
  totals: { day: '2026-10-10', messages: { value: 1313, pct: -34 }, value: { value: 17_100_000, pct: -64 }, fees: { value: 739, pct: -34 }, linkSharePct: 0.5, linkUsd: 3.7, linkAmount: 0.29 },
  leaders: {
    token: { key: 't', symbol: 'syrupUSDC', project: p('Maple', 'maplefinance'), usd: 6_100_000, sharePct: 35.67 },
    sender: { key: 's', player: p('xStocks', 'xStocksFi'), messages: 97 },
    lane: { key: 'l', src: p('Ethereum', 'ethereum'), dst: p('Arc', 'arc'), usd: 5_200_000, messages: 400, feeUsd: 10 },
  },
  feeChain: { key: 'c', player: p('Base', 'base'), feeUsd: 412 },
  records: [],
};
const WEEKLY: WeeklyFacts = {
  kind: 'weekly',
  monday: '2026-10-05',
  totals: {
    monday: '2026-10-05', sunday: '2026-10-11', messages: { value: 14_103, pct: 5 }, value: { value: 334e6, pct: 17 }, fees: { value: 7_970, pct: 6 },
    linkSharePct: 0.5, linkUsd: 41, linkAmount: 3.2, feesByDay: [1, 2, 3, 4, 5, 6, 7],
  },
  leaders: DAILY.leaders,
  feeChains: [{ key: 'b', player: p('Base', 'base'), feeUsd: 1_800 }, { key: 'n', player: p('BNB Chain', 'BNBCHAIN'), feeUsd: 1_600 }, { key: 'e', player: p('Ethereum'), feeUsd: 1_000 }],
};
const RECORD: RecordFacts = {
  kind: 'record',
  record: { kind: 'fees', day: '2026-07-09', value: 57_300, previous: { day: '2026-03-01', value: 47_800 }, stoodDays: 130 },
  driver: { lane: 'a>b', messages: 5_712, usd: 9e6, feeUsd: 50_000, symbol: null },
  route: { src: p('ADI', 'ADIChain'), dst: p('Ethereum', 'ethereum') },
  allTime: 2_140_000,
};
const MILESTONE: MilestoneFacts = { kind: 'milestone', milestone: { metric: 'fees', threshold: 2_500_000, day: '2026-10-10', label: '$2.5M in fees' }, allTime: 2_510_000 };
const RESERVE: ReserveFacts = {
  kind: 'reserve',
  deposit: {
    tx: `0x${'ab'.repeat(32)}`, ts: '2026-10-08T15:35:00.000Z', link: 82_480, usdAtDeposit: 1_030_000, usdNow: 1_100_000, changePct: 6.9, balanceLink: 6_200_000,
    depositCount: 94, streak: 62, avgWeeklyLink: 85_687, avgWeeklyUsd: 1_080_000, nextMilestone: { link: 7_000_000, eta: '2026-12-16' }, weeks: [],
  },
};
const withLeaders = (leaders: Partial<DailyFacts['leaders']>): DailyFacts => ({ ...DAILY, leaders: { ...DAILY.leaders, ...leaders } });
const long = (n: number, ch = 'N') => ch.repeat(n);
const LINKLIKE = /\b[a-z0-9-]+\.[a-z]{2,}\b/i;

describe('xLength', () => {
  it.each([
    ['hello', 5], ['🚨', 2], ['👨‍👩‍👧', 2], ['🇺🇸', 2], ['❤️', 2], ['日本', 4], ['USD₮0', 6], ['→', 2], ['·', 1], ['—', 1], ['café', 4],
  ])('counts %j as %i, as X does', (text, length) => {
    expect(xLength(text)).toBe(length);
  });
});

describe('X posts', () => {
  it('writes the daily post in the shape of the spec', () => {
    expect(composeCopy(DAILY).xText).toBe(
      [
        '#CCIP · Sat, Oct 10',
        '1,313 messages · $17.1M moved',
        '$739 in fees · 0.5% paid in $LINK',
        'Top token: $syrupUSDC @maplefinance · $6.1M (36%)',
        'Top sender: @xStocksFi · 97 messages',
        'Busiest lane: @ethereum → @arc · $5.2M',
        '#Chainlink',
      ].join('\n'),
    );
  });

  it('writes the weekly post with changes and the top fee chains, dropping the busiest lane first to fit', () => {
    // #when
    const text = composeCopy(WEEKLY).xText;
    // #then
    expect({ text, length: xLength(text) }).toEqual({
      text: [
        '#CCIP this week · Oct 5–11',
        '14,103 messages ▲ 5.0% · $334.0M moved ▲ 17%',
        '$8.0K in fees ▲ 6.0% · 0.5% paid in $LINK',
        'Top token: $syrupUSDC @maplefinance · $6.1M (36%)',
        'Top sender: @xStocksFi · 97 messages',
        'Top fee chains: @base · @BNBCHAIN · Ethereum',
        '#Chainlink',
      ].join('\n'),
      length: 259,
    });
  });

  it('writes the record post of the spec', () => {
    expect(composeCopy(RECORD).xText).toBe(
      [
        '🚨 New all-time high for #CCIP: $57.3K in fees in one day',
        'Previous record: $47.8K (Mar 1), held for 130 days',
        'Driven by @ADIChain → @ethereum · 5,712 messages',
        '@chainlink $LINK',
      ].join('\n'),
    );
  });

  it('writes the milestone and Reserve posts', () => {
    expect([composeCopy(MILESTONE).xText, composeCopy(RESERVE).xText]).toEqual([
      ['🏁 New milestone for #CCIP: $2.5M in fees all time', 'Reached on Sat, Oct 10', '@chainlink $LINK'].join('\n'),
      [
        'The Chainlink Reserve just added 82,480 $LINK ($1.0M)',
        'Now 6.2M LINK · 62 weekly deposits in a row · on pace for 7M around Dec 16',
        '@chainlink #CCIP',
      ].join('\n'),
    ]);
  });

  it('drops the busiest lane, then the top sender, then the top token until the post fits 280', () => {
    // #given ever longer plain names
    const lane = { ...DAILY.leaders.lane!, src: p(long(60)), dst: p(long(60)) };
    const sender = { key: 's', player: p(long(120)), messages: 97 };
    const token = { ...DAILY.leaders.token!, symbol: long(200, 'T') };
    // #when
    const first = composeCopy(withLeaders({ lane })).xText;
    const second = composeCopy(withLeaders({ lane, sender })).xText;
    const third = composeCopy(withLeaders({ lane, sender, token })).xText;
    const kept = (text: string) => text.split('\n').map((l) => l.split(':')[0]);
    // #then the headline lines and the closing hashtag stay
    expect({ first: kept(first), second: kept(second), third, lengths: [first, second, third].map(xLength).every((n) => n <= X_MAX) }).toEqual({
      first: ['#CCIP · Sat, Oct 10', '1,313 messages · $17.1M moved', '$739 in fees · 0.5% paid in $LINK', 'Top token', 'Top sender', '#Chainlink'],
      second: ['#CCIP · Sat, Oct 10', '1,313 messages · $17.1M moved', '$739 in fees · 0.5% paid in $LINK', 'Top token', '#Chainlink'],
      third: '#CCIP · Sat, Oct 10\n1,313 messages · $17.1M moved\n$739 in fees · 0.5% paid in $LINK\n#Chainlink',
      lengths: true,
    });
  });

  it('drops the closing hashtag last, and refuses a post whose headline alone is too long', () => {
    // #given
    const fits = (t: string) => xLength(t) <= X_MAX;
    // #then
    expect(fitLines([{ text: long(275, 'H') }, { text: '#Chainlink', drop: 5 }], fits)).toBe(long(275, 'H'));
    expect(() => fitLines([{ text: long(300, 'H') }], fits)).toThrow('does not fit');
  });
});

describe('links', () => {
  it('never writes a domain-looking name as a link, on X or Telegram', () => {
    // #given a sender, a token and a project whose names read as domains
    const facts = withLeaders({
      sender: { key: 's', player: p('pump.fun'), messages: 97 },
      token: { ...DAILY.leaders.token!, symbol: 'xStocks.fi', project: p('Ondo.finance') },
    });
    // #when
    const { xText, telegramHtml } = composeCopy(facts);
    // #then
    expect({ x: LINKLIKE.test(xText), tg: LINKLIKE.test(telegramHtml), shown: xText.includes('pump\u2024fun') && telegramHtml.includes('xStocks\u2024fi') }).toEqual({ x: false, tg: false, shown: true });
  });

  it('keeps names without a domain as they are', () => {
    expect([noLinks('St. Louis'), noLinks('$17.1M'), noLinks('Bungee (Socket)')]).toEqual(['St. Louis', '$17.1M', 'Bungee (Socket)']);
  });
});

describe('Telegram captions', () => {
  it('words the daily report in HTML with names in place of handles', () => {
    expect(composeCopy(DAILY).telegramHtml).toBe(
      [
        '<b>CCIP daily report · Sat, Oct 10, 2026</b>',
        '1,313 messages (▼ 34% vs the 7-day average)',
        '$17.1M moved (▼ 64%)',
        '$739 in fees (▼ 34%) · 0.5% paid in LINK ($4, 0.29 LINK)',
        '',
        'Top token: syrupUSDC (Maple) · $6.1M, 36% of the value moved',
        'Top sender: xStocks · 97 messages',
        'Busiest lane: Ethereum → Arc · $5.2M',
        'Top fee chain: Base · $412 in fees',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
    );
  });

  it('escapes names, and drops lines to stay within 1,024 characters', () => {
    // #given a sender name with HTML in it, and lane names too long for a caption
    const escaped = composeCopy(withLeaders({ sender: { key: 's', player: p('A<b>&C'), messages: 1 } })).telegramHtml;
    const longLane = composeCopy(withLeaders({ lane: { ...DAILY.leaders.lane!, src: p(long(400)), dst: p(long(400)) } })).telegramHtml;
    // #then
    expect({
      escaped: escaped.includes('Top sender: A&lt;b&gt;&amp;C · 1 message'),
      length: longLane.length <= TELEGRAM_CAPTION_MAX,
      lane: longLane.includes('Busiest lane'),
      sender: longLane.includes('Top sender'),
    }).toEqual({ escaped: true, length: true, lane: false, sender: true });
  });

  it('words the record, milestone and Reserve captions', () => {
    expect([composeCopy(RECORD).telegramHtml, composeCopy(MILESTONE).telegramHtml, composeCopy(RESERVE).telegramHtml]).toEqual([
      [
        '<b>New all-time high for CCIP</b>',
        '$57.3K in fees in one day, on Thu, Jul 9, 2026',
        'Previous record: $47.8K on Sun, Mar 1, 2026, held for 130 days',
        'Driven by ADI → Ethereum · 5,712 messages',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
      ['<b>New milestone for CCIP</b>', '$2.5M in fees all time, reached on Sat, Oct 10, 2026', '', '#CCIP #Chainlink $LINK'].join('\n'),
      [
        '<b>New deposit into the Chainlink Reserve</b>',
        '+82,480 LINK · $1.0M at deposit · $1.1M today (+6.9%)',
        'Now 6.2M LINK held · 62 weekly deposits in a row',
        '4-week average: 85,687 LINK a week ($1.1M)',
        'On pace for 7M LINK around Wed, Dec 16, 2026',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
    ]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @ccip-dev/worker exec vitest run test/broadcast-copy.test.ts`. Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write the counter.** Create `worker/src/broadcasts/x-length.ts`:

```ts
/** twitter-text v3 (config/v3.json): code points in these ranges weigh 1 and all others 2; an emoji sequence weighs 2 in all. */
const LIGHT: readonly [number, number][] = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

const weight = (codePoint: number) => (LIGHT.some(([lo, hi]) => codePoint >= lo && codePoint <= hi) ? 1 : 2);

/** The length X counts against its 280 limit. URLs (23 each) are not handled: posts never contain one. */
export function xLength(text: string): number {
  let length = 0;
  for (const { segment } of graphemes.segment(text.normalize('NFC'))) {
    length += EMOJI.test(segment) ? 2 : [...segment].reduce((sum, ch) => sum + weight(ch.codePointAt(0)!), 0);
  }
  return length;
}
```

- [ ] **Step 4: Write the copy.** Create `worker/src/broadcasts/copy.ts`:

```ts
import { addDays } from '@ccip-dev/core';
import { recordValueText } from '@ccip-dev/core/broadcasts';
import { formatCompactCount, formatCount, formatFeeTotal, formatLinkAmount, formatPct, formatShare, formatUsd } from '@ccip-dev/core/format';
import type { RecordKind } from '@ccip-dev/core/records';
import type { BroadcastFacts, DailyFacts, LeaderFacts, MilestoneFacts, RecordFacts, ReserveFacts, WeeklyFacts } from './facts';
import type { Player } from './tags';
import { xLength } from './x-length';

export const X_MAX = 280;
export const TELEGRAM_CAPTION_MAX = 1024;

/** A line of a post. When the post is too long, lines with a drop rank go, lowest rank first; the others always stay. */
export interface Line {
  text: string;
  drop?: number;
}

export const DROP = { lane: 1, sender: 2, token: 3, feeChains: 4, closing: 5 } as const;

export function fitLines(lines: readonly Line[], fits: (text: string) => boolean): string {
  const join = (kept: readonly Line[]) => kept.map((l) => l.text).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const ranks = [...new Set(lines.flatMap((l) => (l.drop === undefined ? [] : [l.drop])))].sort((a, b) => a - b);
  let kept = [...lines];
  if (fits(join(kept))) return join(kept);
  for (const rank of ranks) {
    kept = kept.filter((l) => l.drop !== rank);
    if (fits(join(kept))) return join(kept);
  }
  throw new Error(`the post does not fit even without its droppable lines: ${join(kept).slice(0, 60)}…`);
}

const DOMAIN = /[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

/** X and Telegram turn a name like "pump.fun" into a link; a one-dot leader (U+2024) looks the same and links nothing. */
export function noLinks(name: string): string {
  return name.replace(DOMAIN, (m) => m.replaceAll('.', '\u2024'));
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xName = (p: Player) => (p.x ? `@${p.x}` : noLinks(p.name));
const tgName = (p: Player) => escapeHtml(noLinks(p.name));
const tgText = (s: string) => escapeHtml(noLinks(s));

const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const WEEKDAY = utc({ weekday: 'short', month: 'short', day: 'numeric' });
const WEEKDAY_YEAR = utc({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const MONTH_DAY = utc({ month: 'short', day: 'numeric' });
const date = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
export const postDay = (day: string) => WEEKDAY.format(date(day));
const longDay = (day: string) => WEEKDAY_YEAR.format(date(day));
const shortDay = (day: string) => MONTH_DAY.format(date(day));

export function weekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  return monday.slice(0, 7) === sunday.slice(0, 7) ? `${shortDay(monday)}–${Number(sunday.slice(8))}` : `${shortDay(monday)} – ${shortDay(sunday)}`;
}

const arrow = (pct: number | null) => (pct === null ? null : `${pct >= 0 ? '▲' : '▼'} ${formatShare(Math.abs(pct))}`);
const words = (...parts: (string | null)[]) => parts.filter((p): p is string => p !== null && p !== '').join(' ');
const paren = (s: string | null) => (s === null ? '' : ` (${s})`);
const bold = (s: string) => `<b>${s}</b>`;
const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;
const millions = (link: number) => `${formatCount(link / 1_000_000)}M`;
const present = (parts: (string | null)[]) => parts.filter((s): s is string => s !== null);

function leaderLinesX(l: LeaderFacts): Line[] {
  const lines: Line[] = [];
  if (l.token) {
    const share = l.token.sharePct === null ? '' : ` (${formatShare(l.token.sharePct)})`;
    const project = l.token.project ? xName(l.token.project) : null;
    lines.push({ text: words(`Top token: $${noLinks(l.token.symbol)}`, project, `· ${formatUsd(l.token.usd)}${share}`), drop: DROP.token });
  }
  if (l.sender) lines.push({ text: `Top sender: ${xName(l.sender.player)} · ${plural(l.sender.messages, 'message')}`, drop: DROP.sender });
  if (l.lane) lines.push({ text: `Busiest lane: ${xName(l.lane.src)} → ${xName(l.lane.dst)} · ${formatUsd(l.lane.usd)}`, drop: DROP.lane });
  return lines;
}

function leaderLinesTg(l: LeaderFacts): Line[] {
  const lines: Line[] = [];
  if (l.token) {
    const project = l.token.project ? ` (${tgName(l.token.project)})` : '';
    const share = l.token.sharePct === null ? '' : `, ${formatShare(l.token.sharePct)} of the value moved`;
    lines.push({ text: `Top token: ${tgText(l.token.symbol)}${project} · ${formatUsd(l.token.usd)}${share}`, drop: DROP.token });
  }
  if (l.sender) lines.push({ text: `Top sender: ${tgName(l.sender.player)} · ${plural(l.sender.messages, 'message')}`, drop: DROP.sender });
  if (l.lane) lines.push({ text: `Busiest lane: ${tgName(l.lane.src)} → ${tgName(l.lane.dst)} · ${formatUsd(l.lane.usd)}`, drop: DROP.lane });
  return lines;
}

function feesX(fees: number | null, change: string | null, sharePct: number | null): Line[] {
  if (fees === null) return [];
  return [{ text: words(`${formatFeeTotal(fees)} in fees`, change, sharePct === null ? null : `· ${formatShare(sharePct)} paid in $LINK`) }];
}

function feesTg(fees: number | null, change: string | null, sharePct: number | null, linkUsd: number | null, amount: number | null): Line[] {
  if (fees === null) return [];
  const paid = present([linkUsd === null ? null : formatFeeTotal(linkUsd), amount === null ? null : formatLinkAmount(amount)]);
  const link = sharePct === null ? '' : ` · ${formatShare(sharePct)} paid in LINK${paid.length === 0 ? '' : ` (${paid.join(', ')})`}`;
  return [{ text: `${formatFeeTotal(fees)} in fees${paren(change)}${link}` }];
}

function dailyX(f: DailyFacts): Line[] {
  const t = f.totals;
  return [
    { text: `#CCIP · ${postDay(f.day)}` },
    { text: `${plural(t.messages.value ?? 0, 'message')} · ${formatUsd(t.value.value)} moved` },
    ...feesX(t.fees.value, null, t.linkSharePct),
    ...leaderLinesX(f.leaders),
    { text: '#Chainlink', drop: DROP.closing },
  ];
}

function dailyTg(f: DailyFacts): Line[] {
  const t = f.totals;
  const vsAverage = arrow(t.messages.pct);
  return [
    { text: bold(`CCIP daily report · ${longDay(f.day)}`) },
    { text: `${plural(t.messages.value ?? 0, 'message')}${paren(vsAverage === null ? null : `${vsAverage} vs the 7-day average`)}` },
    { text: `${formatUsd(t.value.value)} moved${paren(arrow(t.value.pct))}` },
    ...feesTg(t.fees.value, arrow(t.fees.pct), t.linkSharePct, t.linkUsd, t.linkAmount),
    { text: '' },
    ...leaderLinesTg(f.leaders),
    ...(f.feeChain ? [{ text: `Top fee chain: ${tgName(f.feeChain.player)} · ${formatFeeTotal(f.feeChain.feeUsd)} in fees`, drop: DROP.lane }] : []),
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

function weeklyX(f: WeeklyFacts): Line[] {
  const t = f.totals;
  return [
    { text: `#CCIP this week · ${weekRange(f.monday)}` },
    { text: words(plural(t.messages.value ?? 0, 'message'), arrow(t.messages.pct), `· ${formatUsd(t.value.value)} moved`, arrow(t.value.pct)) },
    ...feesX(t.fees.value, arrow(t.fees.pct), t.linkSharePct),
    ...leaderLinesX(f.leaders),
    ...(f.feeChains.length > 0 ? [{ text: `Top fee chains: ${f.feeChains.map((c) => xName(c.player)).join(' · ')}`, drop: DROP.feeChains }] : []),
    { text: '#Chainlink', drop: DROP.closing },
  ];
}

function weeklyTg(f: WeeklyFacts): Line[] {
  const t = f.totals;
  const vsLast = arrow(t.messages.pct);
  const chains = f.feeChains.map((c) => `${tgName(c.player)} ${formatFeeTotal(c.feeUsd)}`).join(' · ');
  return [
    { text: bold(`CCIP weekly report · ${weekRange(f.monday)}, ${t.sunday.slice(0, 4)}`) },
    { text: `${plural(t.messages.value ?? 0, 'message')}${paren(vsLast === null ? null : `${vsLast} vs last week`)}` },
    { text: `${formatUsd(t.value.value)} moved${paren(arrow(t.value.pct))}` },
    ...feesTg(t.fees.value, arrow(t.fees.pct), t.linkSharePct, t.linkUsd, t.linkAmount),
    { text: '' },
    ...leaderLinesTg(f.leaders),
    ...(f.feeChains.length > 0 ? [{ text: `Top fee chains: ${chains}`, drop: DROP.feeChains }] : []),
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

const HEADLINE: Record<RecordKind, (value: string, link: string) => string> = {
  messages: (v) => `${v} messages in one day`,
  value: (v) => `${v} moved in one day`,
  fees: (v) => `${v} in fees in one day`,
  largest_fee: (v) => `${v}, the largest single fee ever`,
  link_share: (v, link) => `${v} of fees paid in ${link} in one day`,
};

function driverLine(f: RecordFacts, name: (p: Player) => string, text: (s: string) => string): Line[] {
  if (!f.driver || !f.route) return [];
  const lane = `${name(f.route.src)} → ${name(f.route.dst)}`;
  const line =
    f.record.kind === 'value'
      ? `Driven by ${lane} · ${formatUsd(f.driver.usd)}`
      : f.record.kind === 'largest_fee'
        ? `Paid on ${lane}${f.driver.symbol ? ` in ${text(f.driver.symbol)}` : ''}`
        : `Driven by ${lane} · ${plural(f.driver.messages, 'message')}`;
  return [{ text: line, drop: DROP.lane }];
}

function recordX(f: RecordFacts): Line[] {
  const r = f.record;
  return [
    { text: `🚨 New all-time high for #CCIP: ${HEADLINE[r.kind](recordValueText(r.kind, r.value), '$LINK')}` },
    { text: `Previous record: ${recordValueText(r.kind, r.previous.value)} (${shortDay(r.previous.day)}), held for ${plural(r.stoodDays, 'day')}` },
    ...driverLine(f, xName, noLinks),
    { text: '@chainlink $LINK', drop: DROP.closing },
  ];
}

function recordTg(f: RecordFacts): Line[] {
  const r = f.record;
  return [
    { text: bold('New all-time high for CCIP') },
    { text: `${HEADLINE[r.kind](recordValueText(r.kind, r.value), 'LINK')}, on ${longDay(r.day)}` },
    { text: `Previous record: ${recordValueText(r.kind, r.previous.value)} on ${longDay(r.previous.day)}, held for ${plural(r.stoodDays, 'day')}` },
    ...driverLine(f, tgName, tgText),
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

function milestoneX(f: MilestoneFacts): Line[] {
  return [
    { text: `🏁 New milestone for #CCIP: ${f.milestone.label} all time` },
    { text: `Reached on ${postDay(f.milestone.day)}` },
    { text: '@chainlink $LINK', drop: DROP.closing },
  ];
}

function milestoneTg(f: MilestoneFacts): Line[] {
  return [
    { text: bold('New milestone for CCIP') },
    { text: `${escapeHtml(f.milestone.label)} all time, reached on ${longDay(f.milestone.day)}` },
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

function reserveX(f: ReserveFacts): Line[] {
  const d = f.deposit;
  const pace = present([
    `Now ${formatCompactCount(d.balanceLink)} LINK`,
    d.streak >= 2 ? `${formatCount(d.streak)} weekly deposits in a row` : null,
    d.nextMilestone ? `on pace for ${millions(d.nextMilestone.link)} around ${shortDay(d.nextMilestone.eta)}` : null,
  ]);
  return [
    { text: `The Chainlink Reserve just added ${formatCount(d.link)} $LINK${paren(d.usdAtDeposit === null ? null : formatUsd(d.usdAtDeposit))}` },
    { text: pace.join(' · ') },
    { text: '@chainlink #CCIP', drop: DROP.closing },
  ];
}

function reserveTg(f: ReserveFacts): Line[] {
  const d = f.deposit;
  const added = present([
    `+${formatCount(d.link)} LINK`,
    d.usdAtDeposit === null ? null : `${formatUsd(d.usdAtDeposit)} at deposit`,
    d.usdNow === null ? null : `${formatUsd(d.usdNow)} today${paren(d.changePct === null ? null : formatPct(d.changePct))}`,
  ]);
  return [
    { text: bold('New deposit into the Chainlink Reserve') },
    { text: added.join(' · ') },
    { text: `Now ${formatCompactCount(d.balanceLink)} LINK held${d.streak >= 2 ? ` · ${formatCount(d.streak)} weekly deposits in a row` : ''}` },
    ...(d.avgWeeklyLink === null ? [] : [{ text: `4-week average: ${formatCount(d.avgWeeklyLink)} LINK a week${paren(d.avgWeeklyUsd === null ? null : formatUsd(d.avgWeeklyUsd))}` }]),
    ...(d.nextMilestone ? [{ text: `On pace for ${millions(d.nextMilestone.link)} LINK around ${longDay(d.nextMilestone.eta)}` }] : []),
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

function xLines(f: BroadcastFacts): Line[] {
  switch (f.kind) {
    case 'daily':
      return dailyX(f);
    case 'weekly':
      return weeklyX(f);
    case 'record':
      return recordX(f);
    case 'milestone':
      return milestoneX(f);
    case 'reserve':
      return reserveX(f);
  }
}

function telegramLines(f: BroadcastFacts): Line[] {
  switch (f.kind) {
    case 'daily':
      return dailyTg(f);
    case 'weekly':
      return weeklyTg(f);
    case 'record':
      return recordTg(f);
    case 'milestone':
      return milestoneTg(f);
    case 'reserve':
      return reserveTg(f);
  }
}

export interface Copy {
  xText: string;
  telegramHtml: string;
}

/** Telegram counts its 1,024 after removing tags; measuring the raw HTML is stricter, so a caption that passes here always fits. */
export function composeCopy(facts: BroadcastFacts): Copy {
  return {
    xText: fitLines(xLines(facts), (t) => xLength(t) <= X_MAX),
    telegramHtml: fitLines(telegramLines(facts), (t) => t.length <= TELEGRAM_CAPTION_MAX),
  };
}
```

- [ ] **Step 5: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/worker exec vitest run test/broadcast-copy.test.ts && pnpm typecheck`. Expected: PASS, and the test file also proves `Intl.Segmenter` works in workerd.

- [ ] **Step 6: Commit.**

```bash
git add worker/src/broadcasts/x-length.ts worker/src/broadcasts/copy.ts worker/test/broadcast-copy.test.ts
git commit -m "feat(worker): X and Telegram copy for broadcasts, counted the way X counts and free of links"
```

---

### Task 8: Outputs, dedup, mode and the pipeline

**Files:**
- Modify: `worker/src/telegram.ts` (`sendTelegramPhoto`)
- Create: `worker/src/broadcasts/outputs.ts`
- Create: `worker/src/broadcasts/run.ts`
- Modify: `worker/src/store.ts` (`markMeta`)
- Modify: `worker/src/publish.ts` (`ReserveBody`; `publishRegistryFiles` returns the body it published)
- Modify: `worker/src/jobs/finalize.ts` (broadcast after the early run's publish)
- Modify: `worker/src/jobs/hourly.ts` (Reserve deposits and the retry)
- Modify: `worker/src/env.ts`, `worker/wrangler.toml` (`BROADCASTS`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_DRAFTS_CHAT_ID`)
- Modify: `docs/runbook.md` ("Broadcasts", the alert table), `docs/methodology.md` ("Broadcasts")
- Test: `worker/test/telegram.test.ts`, `worker/test/broadcasts.test.ts`, `worker/test/finalize.test.ts`, `worker/test/hourly.test.ts`

**Interfaces:**
- Consumes:
  - Task 4: `broadcastKey`, `broadcastCardPath`, `isDepositTransfer`, `recordValue`, `trackedMilestones`, `RECORD_KINDS`, `recordsSetOn`, `milestonesOn`.
  - Task 6: `loadFactsSource`, `dailyFacts`, `weeklyFacts`, `recordFacts`, `milestoneFacts`, `reserveFacts`, `type BroadcastFacts`.
  - Task 7: `composeCopy`.
- Produces:
  - `sendTelegramPhoto(deps: Pick<Deps, 'fetch' | 'sleep'>, config: TelegramConfig, photo: { photo: string; caption: string; parseMode?: 'HTML' }): Promise<string | null>` and `TELEGRAM_RETRY_CAP_S = 30`.
  - `outputs.ts`:
    - `interface Broadcast { key: string; kind: BroadcastTarget['kind']; imageUrl: string; facts: BroadcastFacts; xText: string; telegramHtml: string }`;
    - `interface BroadcastOutput { name: string; send(b: Broadcast): Promise<'sent' | 'failed'> }`;
    - `interface OutputSet { channel: BroadcastOutput[]; drafts: BroadcastOutput[] }`;
    - `type BroadcastMode = 'off' | 'drafts' | 'on'`, `broadcastMode(env)` and `selectOutputs(set, mode)`;
    - `telegramOutputs(c: RunContext): OutputSet`, whose outputs are named `telegram-channel` and `x-draft`.
  - `run.ts`:
    - `SITE_ORIGIN = 'https://ccip.dev'`, `IMAGE_TIMEOUT_MS = 20_000`, `RECORD_DAYS = 3`, `RECORDS_SEED_KEY = 'broadcast:records:seeded'` and `RESERVE_SINCE_KEY = 'broadcast:reserve:since'`;
    - `type BroadcastRequest = { kind: 'finalize'; days: readonly string[] } | { kind: 'reserve'; reserve: ReserveBody }`;
    - `runBroadcasts(c, request, outputs?: OutputSet): Promise<void>`, `broadcastSafely(c, request)` and `broadcastHourly(c, reserve: ReserveBody)`.
  - `store.markMeta(db: D1Database, keys: string[], value: string): Promise<void>`.
  - `publish.ts`: `type ReserveBody = Omit<ReserveFile, 'schema_version' | 'updated_at' | 'attribution'>`; `publishRegistryFiles(c): Promise<ReserveBody>`.
  - Env:
    - `BROADCASTS?: string` (`"off"` in `wrangler.toml`);
    - `TELEGRAM_CHANNEL_ID?: string` (`"@ccipdev"`);
    - `TELEGRAM_DRAFTS_CHAT_ID?: string` (unset, so the X drafts go to `TELEGRAM_ALERT_CHAT_ID`).
  - Meta values:
    - `pending:<iso>` while sending (reclaimable after an hour);
    - `sent:<iso>` once at least one output sent;
    - `seeded:<iso>` for first-run marks.

- [ ] **Step 1: Write the failing Telegram tests.** Create `worker/test/telegram.test.ts`:

```ts
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { sendTelegramPhoto } from '../src/telegram';

const CONFIG = { token: 'secret-token', chatId: '@ccipdev' };
const PHOTO = { photo: 'https://ccip.dev/og/broadcast/daily/2026-10-10.png?v=1', caption: '<b>hi</b>', parseMode: 'HTML' as const };

describe('sendTelegramPhoto', () => {
  it('posts the card by URL with its caption and parse mode', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: true, result: {} }));
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep: async () => {} }, CONFIG, PHOTO);
    // #then
    expect({ failure, url: fetch.calls[0]?.url, body: JSON.parse(String(fetch.calls[0]?.init?.body)) }).toEqual({
      failure: null,
      url: 'https://api.telegram.org/botsecret-token/sendPhoto',
      body: { chat_id: '@ccipdev', photo: PHOTO.photo, caption: '<b>hi</b>', parse_mode: 'HTML' },
    });
  });

  it("waits Telegram's retry_after after a 429 and tries once more", async () => {
    // #given
    let calls = 0;
    const fetch = fakeFetch(() => (++calls === 1 ? jsonResponse({ ok: false, error_code: 429, parameters: { retry_after: 5 } }, 429) : jsonResponse({ ok: true, result: {} })));
    const sleep = vi.fn(async () => {});
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep }, CONFIG, PHOTO);
    // #then
    expect({ failure, calls, waits: sleep.mock.calls }).toEqual({ failure: null, calls: 2, waits: [[5000]] });
  });

  it('caps the wait at 30 s and gives up after the one retry, naming the error but not the token', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: false, description: 'Too Many Requests: retry after 120', parameters: { retry_after: 120 } }, 429));
    const sleep = vi.fn(async () => {});
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep }, CONFIG, PHOTO);
    // #then
    expect({ failure, calls: fetch.calls.length, waits: sleep.mock.calls }).toEqual({
      failure: 'Telegram returned HTTP 429: Too Many Requests: retry after 120',
      calls: 2,
      waits: [[30_000]],
    });
  });

  it('reports a failed request without the token', async () => {
    // #given
    const fetch = fakeFetch(async () => {
      throw new TypeError('network down for secret-token');
    });
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep: async () => {} }, CONFIG, PHOTO);
    // #then
    expect(failure).toBe('Telegram request failed (TypeError)');
  });
});
```

- [ ] **Step 2: Write the failing pipeline tests.** Create `worker/test/broadcasts.test.ts`:

```ts
import type { Dim } from '@ccip-dev/core';
import { fakeFetch, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Broadcast, BroadcastOutput } from '../src/broadcasts/outputs';
import { RECORDS_SEED_KEY, RESERVE_SINCE_KEY, runBroadcasts } from '../src/broadcasts/run';
import type { ReserveBody } from '../src/publish';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const NOW = '2026-10-11T00:07:00.000Z';
const DAY = '2026-10-10';
const DAILY_KEY = 'broadcast:daily:2026-10-10';
const totals = (day: string, fee: number) => ({ day, messages: 200, token_messages: 0, usd_value: 8e6, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
const lane = (day: string): { day: string; dim: Dim; key: string; messages: number; usd_value: number; fee_usd: number } => ({ day, dim: 'lane', key: `${ETH}>${BASE}`, messages: 200, usd_value: 8e6, fee_usd: 4 });

/** Days from Oct 1 through `last`, each 200 messages, $8M and $4 in fees unless `fees` says otherwise. */
async function seedDays(last: string, fees: Record<string, number> = {}): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base], []);
  await store.setMeta(env.DB, 'live_start_day', '2026-10-01');
  for (let d = 1; `2026-10-${String(d).padStart(2, '0')}` <= last; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    await store.replaceDaily(env.DB, totals(day, fees[day] ?? 4), [lane(day)], NOW);
  }
}

function recorder(name: string, result: 'sent' | 'failed' = 'sent') {
  const sent: Broadcast[] = [];
  const output: BroadcastOutput = {
    name,
    send: async (b) => {
      sent.push(b);
      return result;
    },
  };
  return { output, sent };
}

const card = (status = 200) =>
  fakeFetch((url) => (url.startsWith('https://ccip.dev/og/') ? new Response(new Uint8Array([137, 80, 78, 71]), { status, headers: { 'content-type': 'image/png' } }) : undefined));

async function finalizeRun(o: { now?: string; days: string[]; mode?: string; channel?: 'sent' | 'failed'; drafts?: 'sent' | 'failed'; fetch?: typeof fetch }) {
  const channel = recorder('telegram-channel', o.channel);
  const drafts = recorder('x-draft', o.drafts);
  const h = harness({ now: o.now ?? NOW, fetch: o.fetch ?? card(), env: { BROADCASTS: o.mode ?? 'on' } });
  await runBroadcasts(h.c, { kind: 'finalize', days: o.days }, { channel: [channel.output], drafts: [drafts.output] });
  return { channel: channel.sent, drafts: drafts.sent, alerts: h.alerts };
}

const keys = (sent: Broadcast[]) => sent.map((b) => b.key);

describe('runBroadcasts after finalize', () => {
  it("posts yesterday's daily once to the channel and as an X draft, with the card and both texts", async () => {
    // #given
    await seedDays(DAY);
    // #when
    const { channel, drafts } = await finalizeRun({ days: [DAY] });
    // #then
    expect({
      channel: keys(channel),
      drafts: keys(drafts),
      image: /^https:\/\/ccip\.dev\/og\/broadcast\/daily\/2026-10-10\.png\?v=\d+$/.test(channel[0]?.imageUrl ?? ''),
      x: drafts[0]?.xText.startsWith('#CCIP · Sat, Oct 10'),
      html: channel[0]?.telegramHtml.startsWith('<b>CCIP daily report · Sat, Oct 10, 2026</b>'),
      claim: (await store.getMeta(env.DB, DAILY_KEY))?.startsWith('sent:'),
    }).toEqual({ channel: [DAILY_KEY], drafts: [DAILY_KEY], image: true, x: true, html: true, claim: true });
  });

  it('reaches only the X draft in drafts mode', async () => {
    await seedDays(DAY);
    const { channel, drafts } = await finalizeRun({ days: [DAY], mode: 'drafts' });
    expect({ channel: keys(channel), drafts: keys(drafts) }).toEqual({ channel: [], drafts: [DAILY_KEY] });
  });

  it('sends, claims and seeds nothing when off', async () => {
    // #given
    await seedDays(DAY);
    const fetch = card();
    // #when
    const { channel, drafts } = await finalizeRun({ days: [DAY], mode: 'off', fetch });
    // #then
    expect({ sent: channel.length + drafts.length, fetches: fetch.calls.length, claim: await store.getMeta(env.DB, DAILY_KEY), seed: await store.getMeta(env.DB, RECORDS_SEED_KEY) }).toEqual({
      sent: 0, fetches: 0, claim: null, seed: null,
    });
  });

  it('does not post again on a re-run', async () => {
    await seedDays(DAY);
    await finalizeRun({ days: [DAY] });
    const again = await finalizeRun({ days: [DAY] });
    expect(again.channel.length + again.drafts.length).toBe(0);
  });

  it('releases the claim when every output fails, alerting once per output, so the next run posts', async () => {
    // #given
    await seedDays(DAY);
    // #when
    const failed = await finalizeRun({ days: [DAY], channel: 'failed', drafts: 'failed' });
    const claim = await store.getMeta(env.DB, DAILY_KEY);
    const retried = await finalizeRun({ days: [DAY] });
    // #then
    expect({ alerts: failed.alerts.map((a) => a.signature), claim, retried: keys(retried.channel) }).toEqual({
      alerts: [`broadcast-telegram-channel:${DAILY_KEY}`, `broadcast-x-draft:${DAILY_KEY}`],
      claim: null,
      retried: [DAILY_KEY],
    });
  });

  it('keeps the claim when one output succeeds, alerting for the one that failed', async () => {
    await seedDays(DAY);
    const { alerts } = await finalizeRun({ days: [DAY], channel: 'failed' });
    expect({ alerts: alerts.map((a) => a.signature), sent: (await store.getMeta(env.DB, DAILY_KEY))?.startsWith('sent:') }).toEqual({
      alerts: [`broadcast-telegram-channel:${DAILY_KEY}`],
      sent: true,
    });
  });

  it('posts nothing and alerts when the card answers 500, or does not answer in time', async () => {
    // #given
    await seedDays(DAY);
    const timeout = fakeFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    // #when
    const broken = await finalizeRun({ days: [DAY], fetch: card(500) });
    const slow = await finalizeRun({ days: [DAY], fetch: timeout });
    // #then
    expect({
      sent: broken.channel.length + broken.drafts.length + slow.channel.length + slow.drafts.length,
      alerts: [...broken.alerts, ...slow.alerts].map((a) => a.signature),
      texts: [...broken.alerts, ...slow.alerts].map((a) => a.text.includes('/og/broadcast/daily/2026-10-10.png')),
      claim: await store.getMeta(env.DB, DAILY_KEY),
    }).toEqual({ sent: 0, alerts: [`broadcast-image:${DAILY_KEY}`, `broadcast-image:${DAILY_KEY}`], texts: [true, true], claim: null });
  });

  it('adds the weekly on a Monday, for the Monday–Sunday week that just ended', async () => {
    await seedDays('2026-10-11');
    const { channel } = await finalizeRun({ now: '2026-10-12T00:07:00.000Z', days: ['2026-10-11'] });
    expect(keys(channel)).toEqual(['broadcast:daily:2026-10-11', 'broadcast:weekly:2026-10-05']);
  });

  it('seeds the records it finds on its first run without posting them, then posts a later record', async () => {
    // #given the 10th beat the $4 fee days with $5, and later the 11th beats it with $6
    await seedDays(DAY, { [DAY]: 5 });
    // #when
    const first = await finalizeRun({ days: [DAY] });
    await store.replaceDaily(env.DB, totals('2026-10-11', 6), [lane('2026-10-11')], NOW);
    const second = await finalizeRun({ now: '2026-10-12T00:07:00.000Z', days: ['2026-10-11'] });
    // #then
    expect({
      first: keys(first.channel),
      seeded: (await store.getMeta(env.DB, 'broadcast:record:fees:2026-10-10'))?.startsWith('seeded:'),
      second: keys(second.channel),
    }).toEqual({
      first: [DAILY_KEY],
      seeded: true,
      second: ['broadcast:daily:2026-10-11', 'broadcast:weekly:2026-10-05', 'broadcast:record:fees:2026-10-11'],
    });
  });

  it('never posts a record for a day before live_start_day, or for a day a rewind finalizes again', async () => {
    // #given records were seeded already, and the 10th set a fees record
    await seedDays(DAY, { [DAY]: 5 });
    await store.setMeta(env.DB, RECORDS_SEED_KEY, 'seeded:2026-10-01T00:00:00.000Z');
    // #when the 10th is before the live start, and then a rewind finalizes it again on the 15th
    await store.setMeta(env.DB, 'live_start_day', '2026-10-11');
    const backfill = await finalizeRun({ days: [DAY] });
    await store.setMeta(env.DB, 'live_start_day', '2026-10-01');
    const rewind = await finalizeRun({ now: '2026-10-15T00:07:00.000Z', days: [DAY] });
    // #then
    expect({ backfill: keys(backfill.channel), rewind: keys(rewind.channel) }).toEqual({ backfill: [DAILY_KEY], rewind: [] });
  });
});

describe('runBroadcasts for the Reserve', () => {
  const TX1 = `0x${'01'.repeat(32)}`;
  const TX2 = `0x${'02'.repeat(32)}`;
  const view = (ts: string, tx: string, link: number, price: number | null) => ({
    ts, tx, direction: 'in' as const, counterparty: '0xd', link, price_usd: price, usd: price === null ? null : link * price,
    value_now_usd: link * 13, change_pct: null, deposit: true,
  });
  const body = (transfers: ReturnType<typeof view>[], caughtUp = true): ReserveBody => ({
    token: '0xlink', reserve: '0xreserve', latest: null, series: [], link_price_usd: 13,
    cost_basis: caughtUp ? { link_in: 0, link_out: 0, cost_usd: 0, value_usd: null, change_usd: null, change_pct: null, avg_deposit_price_usd: null, unpriced_transfers: 0 } : null,
    pace: null,
    weekly: [{ week: '2026-09-28', deposits: 1, link: 100_000, usd: 1.2e6 }, { week: '2026-10-05', deposits: 1, link: 82_480, usd: 1e6 }],
    performance: null, transfers, latest_transfer: null,
  });
  const FIRST = view('2026-10-01T15:35:00.000Z', TX1, 100_000, 12);
  const reserveRun = async (reserve: ReserveBody) => {
    const channel = recorder('telegram-channel');
    const h = harness({ now: '2026-10-08T17:00:00.000Z', fetch: card(), env: { BROADCASTS: 'on' } });
    await runBroadcasts(h.c, { kind: 'reserve', reserve }, { channel: [channel.output], drafts: [] });
    return keys(channel.sent);
  };

  it('seeds the Reserve watermark on its first run and posts nothing', async () => {
    expect({ sent: await reserveRun(body([FIRST])), since: await store.getMeta(env.DB, RESERVE_SINCE_KEY) }).toEqual({ sent: [], since: FIRST.ts });
  });

  it('posts a new priced deposit once', async () => {
    // #given
    await store.setMeta(env.DB, RESERVE_SINCE_KEY, FIRST.ts);
    const reserve = body([FIRST, view('2026-10-08T15:35:00.000Z', TX2, 82_480, 12.5)]);
    // #when
    const first = await reserveRun(reserve);
    const again = await reserveRun(reserve);
    // #then
    expect({ first, again }).toEqual({ first: [`broadcast:reserve:${TX2}`], again: [] });
  });

  it("waits for a deposit's price", async () => {
    // #given
    await store.setMeta(env.DB, RESERVE_SINCE_KEY, FIRST.ts);
    // #when
    const unpriced = await reserveRun(body([FIRST, view('2026-10-08T15:35:00.000Z', TX2, 82_480, null)]));
    const priced = await reserveRun(body([FIRST, view('2026-10-08T15:35:00.000Z', TX2, 82_480, 12.5)]));
    // #then
    expect({ unpriced, priced }).toEqual({ unpriced: [], priced: [`broadcast:reserve:${TX2}`] });
  });

  it('neither posts nor seeds before the Reserve scan has caught up', async () => {
    expect({ sent: await reserveRun(body([], false)), since: await store.getMeta(env.DB, RESERVE_SINCE_KEY) }).toEqual({ sent: [], since: null });
  });
});
```

- [ ] **Step 3: Write the failing integration tests.**
  - In `worker/test/finalize.test.ts`, add `fakeFetch, jsonResponse, type FakeFetch` to the `@ccip-dev/core/testing` import and `import { runBroadcasts } from '../src/broadcasts/run';`, then add at the end:

```ts
describe('broadcasts after finalize', () => {
  const ENV = { BROADCASTS: 'on', TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_ALERT_CHAT_ID: '42' };
  const net = () =>
    fakeFetch((url) => {
      if (url.startsWith('https://ccip.dev/og/')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
      if (url.startsWith('https://api.telegram.org/')) return jsonResponse({ ok: true, result: {} });
      return undefined;
    });
  const photos = (f: FakeFetch) =>
    f.calls.filter((c) => c.url.endsWith('/sendPhoto')).map((c) => JSON.parse(String(c.init?.body)) as { chat_id: string; photo: string; caption: string; parse_mode?: string });

  it("posts yesterday's daily to the channel and as an X draft once, after the early run publishes", async () => {
    // #given
    await seedMeta('2026-10-08', '2026-10-08');
    const f = net();
    const h = harness({ now: NOW, ccip: api(), fetch: f, env: ENV });
    // #when the early run finalizes the 9th, then the broadcasts run again
    await runFinalize(h.c, 'early');
    await runBroadcasts(h.c, { kind: 'finalize', days: ['2026-10-09'] });
    // #then
    const sent = photos(f);
    expect({
      chats: sent.map((p) => p.chat_id),
      photo: sent.every((p) => /^https:\/\/ccip\.dev\/og\/broadcast\/daily\/2026-10-09\.png\?v=\d+$/.test(p.photo)),
      channel: sent[0]?.caption.startsWith('<b>CCIP daily report · Fri, Oct 9, 2026</b>') && sent[0]?.parse_mode === 'HTML',
      draft: sent[1]?.caption.startsWith('#CCIP · Fri, Oct 9') && sent[1]?.parse_mode === undefined,
      history: (await readPublic('history.json')).days.at(-1).day,
    }).toEqual({ chats: ['@ccipdev', '42'], photo: true, channel: true, draft: true, history: '2026-10-09' });
  });

  it('never broadcasts from the 06:00 run', async () => {
    await seedMeta('2026-10-09', '2026-10-08');
    const f = net();
    await runFinalize(harness({ now: '2026-10-10T06:00:00.000Z', ccip: api(), fetch: f, env: ENV }).c, 'late');
    expect(photos(f)).toEqual([]);
  });
});
```

  - In `worker/test/hourly.test.ts`, add `LINK_PRICE_KEY, RESERVE_FIRST_BLOCK` to the `@ccip-dev/core` import, `fakeFetch, fakePrices, jsonResponse` to the `@ccip-dev/core/testing` import, and add inside `describe('runHourly', …)`:

```ts
  it('posts a new priced Reserve deposit once, after publishing reserve.json', async () => {
    // #given two priced deposits, the scan caught up, and the watermark at the first
    const D = '0x5680681ed3767b96914ce741a308155c7fb9171d';
    const TX1 = `0x${'01'.repeat(32)}`;
    const TX2 = `0x${'02'.repeat(32)}`;
    const raw = (link: bigint) => (link * 10n ** 18n).toString();
    await store.insertReserveTransfers(env.DB, [
      { txHash: TX1, logIndex: 0, blockNumber: 1, ts: '2026-10-01T09:35:00.000Z', direction: 'in', counterparty: D, amount: raw(100_000n) },
      { txHash: TX2, logIndex: 0, blockNumber: 2, ts: '2026-10-08T09:35:00.000Z', direction: 'in', counterparty: D, amount: raw(82_480n) },
    ]);
    await store.setReserveTransferPrices(env.DB, [{ txHash: TX1, logIndex: 0, linkUsd: 12 }, { txHash: TX2, logIndex: 0, linkUsd: 12.5 }]);
    await store.setMeta(env.DB, 'reserve_scan_caught_up', '1');
    await store.setMeta(env.DB, 'reserve_scan_block', String(RESERVE_FIRST_BLOCK));
    await store.setMeta(env.DB, 'broadcast:reserve:since', '2026-10-01T09:35:00.000Z');
    const rpc = rpcFake({ balanceLink: 182_480n, balanceAt: () => 182_480n * 10n ** 18n });
    const f = fakeFetch(
      (url) => {
        if (url.startsWith('https://ccip.dev/og/')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
        if (url.startsWith('https://api.telegram.org/')) return jsonResponse({ ok: true, result: {} });
        return undefined;
      },
      (url, init) => rpc(url, init),
    );
    const env_ = { BROADCASTS: 'on', TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_ALERT_CHAT_ID: '42' };
    const prices = fakePrices({ latest: { [LINK_PRICE_KEY]: { price: 13, decimals: 18 } } });
    const run = () => runHourly(harness({ now: NOW, ccip: fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] }), fetch: f, prices, env: env_ }).c);
    // #when two hourly runs
    await run();
    await run();
    // #then one broadcast, to the channel and the drafts chat
    const photos = f.calls.filter((c) => c.url.endsWith('/sendPhoto')).map((c) => JSON.parse(String(c.init?.body)).photo.split('?')[0]);
    expect(photos).toEqual([`https://ccip.dev/og/broadcast/reserve/${TX2}.png`, `https://ccip.dev/og/broadcast/reserve/${TX2}.png`]);
  });

  it("posts yesterday's daily from the hourly run when the 00:07 attempt could not", async () => {
    // #given yesterday is finalized, but its daily was never sent
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      await store.replaceDaily(env.DB, { day, messages: 1, token_messages: 0, usd_value: 1, fee_usd: 1, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 }, [], NOW);
    }
    await store.setMeta(env.DB, 'live_start_day', '2026-10-05');
    await store.setMeta(env.DB, 'last_finalize_day', '2026-10-07');
    const f = fakeFetch(
      (url) => {
        if (url.startsWith('https://ccip.dev/og/')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
        if (url.startsWith('https://api.telegram.org/')) return jsonResponse({ ok: true, result: {} });
        return undefined;
      },
      (url, init) => rpcFake({ balanceLink: 1n })(url, init),
    );
    const env_ = { BROADCASTS: 'drafts', TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_ALERT_CHAT_ID: '42' };
    // #when
    await runHourly(harness({ now: NOW, ccip: fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] }), fetch: f, env: env_ }).c);
    // #then
    const photos = f.calls.filter((c) => c.url.endsWith('/sendPhoto')).map((c) => JSON.parse(String(c.init?.body)).photo.split('?')[0]);
    expect(photos).toEqual(['https://ccip.dev/og/broadcast/daily/2026-10-07.png']);
  });
```

  `NOW` in `hourly.test.ts` is `2026-10-08T13:00:00.000Z`, so yesterday is the 7th. In the second test, `rpcFake` is created per call; that is fine because it keeps no state between calls.

- [ ] **Step 4: Run them and confirm they fail.** Run `pnpm --filter @ccip-dev/worker exec vitest run test/telegram.test.ts test/broadcasts.test.ts test/finalize.test.ts test/hourly.test.ts`. Expected: FAIL, `sendTelegramPhoto` and `../src/broadcasts/run` do not exist, and nothing calls broadcasts.

- [ ] **Step 5: Send photos.** In `worker/src/telegram.ts`, add `import type { Deps } from './deps';` at the top and append:

```ts
export const TELEGRAM_RETRY_CAP_S = 30;

export interface TelegramPhoto {
  photo: string;
  caption: string;
  parseMode?: 'HTML';
}

/** Sends a photo by URL. A 429 is retried once after Telegram's retry_after, at most 30 s. Returns null, or what went wrong. */
export async function sendTelegramPhoto(deps: Pick<Deps, 'fetch' | 'sleep'>, { token, chatId }: TelegramConfig, msg: TelegramPhoto): Promise<string | null> {
  const body = JSON.stringify({ chat_id: chatId, photo: msg.photo, caption: msg.caption, ...(msg.parseMode ? { parse_mode: msg.parseMode } : {}) });
  const post = () => deps.fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  try {
    let res = await post();
    if (res.status === 429) {
      await deps.sleep(Math.min(await retryAfter(res), TELEGRAM_RETRY_CAP_S) * 1000);
      res = await post();
    }
    return res.ok ? null : `Telegram returned HTTP ${res.status}${await description(res)}`;
  } catch (error) {
    return `Telegram request failed (${error instanceof Error ? error.name : 'unknown error'})`;
  }
}

async function retryAfter(res: Response): Promise<number> {
  try {
    const seconds = ((await res.json()) as { parameters?: { retry_after?: unknown } }).parameters?.retry_after;
    return typeof seconds === 'number' && seconds > 0 ? seconds : 1;
  } catch {
    return 1;
  }
}

async function description(res: Response): Promise<string> {
  try {
    const text = ((await res.json()) as { description?: unknown }).description;
    return typeof text === 'string' ? `: ${text.slice(0, 200)}` : '';
  } catch {
    return '';
  }
}
```

- [ ] **Step 6: Add the outputs.** Create `worker/src/broadcasts/outputs.ts`:

```ts
import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import type { RunContext } from '../context';
import type { Env } from '../env';
import { sendTelegramPhoto, type TelegramConfig } from '../telegram';
import type { BroadcastFacts } from './facts';

export interface Broadcast {
  key: string;
  kind: BroadcastTarget['kind'];
  imageUrl: string;
  facts: BroadcastFacts;
  xText: string;
  telegramHtml: string;
}

export interface BroadcastOutput {
  name: string;
  send(b: Broadcast): Promise<'sent' | 'failed'>;
}

/** `channel` outputs post publicly; `drafts` outputs reach only the owner. */
export interface OutputSet {
  channel: BroadcastOutput[];
  drafts: BroadcastOutput[];
}

export type BroadcastMode = 'off' | 'drafts' | 'on';

export function broadcastMode(env: Pick<Env, 'BROADCASTS'>): BroadcastMode {
  return env.BROADCASTS === 'drafts' || env.BROADCASTS === 'on' ? env.BROADCASTS : 'off';
}

export function selectOutputs(set: OutputSet, mode: Exclude<BroadcastMode, 'off'>): BroadcastOutput[] {
  return mode === 'on' ? [...set.channel, ...set.drafts] : set.drafts;
}

function photoOutput(c: RunContext, name: string, config: TelegramConfig, caption: (b: Broadcast) => { caption: string; parseMode?: 'HTML' }): BroadcastOutput {
  return {
    name,
    async send(b) {
      const failure = await sendTelegramPhoto(c.deps, config, { photo: b.imageUrl, ...caption(b) });
      if (failure === null) return 'sent';
      console.error(`[broadcast] ${name} failed for ${b.key}: ${failure}`);
      return 'failed';
    },
  };
}

/** The channel gets the card with the Telegram caption; the owner's drafts chat gets it with the X text, ready to paste. */
export function telegramOutputs(c: RunContext): OutputSet {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const channel = c.env.TELEGRAM_CHANNEL_ID;
  const drafts = c.env.TELEGRAM_DRAFTS_CHAT_ID ?? c.env.TELEGRAM_ALERT_CHAT_ID;
  return {
    channel: token && channel ? [photoOutput(c, 'telegram-channel', { token, chatId: channel }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    drafts: token && drafts ? [photoOutput(c, 'x-draft', { token, chatId: drafts }, (b) => ({ caption: b.xText }))] : [],
  };
}
```

  - In `worker/src/env.ts`, add after `TELEGRAM_ALERT_CHAT_ID?: string;`:

```ts
  BROADCASTS?: string;
  TELEGRAM_CHANNEL_ID?: string;
  TELEGRAM_DRAFTS_CHAT_ID?: string;
```

  - In `worker/wrangler.toml`, under `[vars]`, add `BROADCASTS = "off"` and `TELEGRAM_CHANNEL_ID = "@ccipdev"`.

- [ ] **Step 7: Mark many keys at once.** In `worker/src/store.ts`, after `releaseMeta`, add:

```ts
/** Writes `value` under each key that has none yet. */
export async function markMeta(db: D1Database, keys: string[], value: string): Promise<void> {
  const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  await runBatch(db, keys.map((key) => insert.bind(key, value)));
}
```

- [ ] **Step 8: Return the Reserve body.** In `worker/src/publish.ts`:
  - Add `ReserveFile` to the `@ccip-dev/core/public` type import, and add after the imports:

```ts
export type ReserveBody = Omit<ReserveFile, 'schema_version' | 'updated_at' | 'attribution'>;
```

  - In `publishRegistryFiles`, change the signature to `export async function publishRegistryFiles(c: RunContext): Promise<ReserveBody> {`, and replace the `reserve.json` `putJson(…)` call with:

```ts
  const reserve: ReserveBody = {
    token: LINK_TOKEN,
    reserve: LINK_RESERVE,
    latest: latest ? { ts: latest.ts, link: linkUnits(latest.link_balance) } : null,
    series: series.map((s) => ({ ts: s.ts, link: linkUnits(s.link_balance) })),
    link_price_usd: linkPriceUsd === null ? null : Math.round(linkPriceUsd * 10_000) / 10_000,
    cost_basis: stats?.cost_basis ?? null,
    pace: stats?.pace ?? null,
    weekly: stats?.weekly ?? [],
    performance: stats?.performance ?? null,
    transfers: stats?.transfers ?? [],
    latest_transfer: stats?.latest_transfer ?? null,
  };
  await putJson(c.env.PUBLIC, 'reserve.json', reserve, TTL.reserve, now);
```

  - Add `return reserve;` as the last line of the function, after the `tokens.json` `putJson`.

- [ ] **Step 9: Write the pipeline.** Create `worker/src/broadcasts/run.ts`:

```ts
import { addDays, dayOf, weekStart } from '@ccip-dev/core';
import { broadcastCardPath, broadcastKey, isDepositTransfer, type BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { milestonesOn, RECORD_KINDS, recordsSetOn, recordValue, trackedMilestones } from '@ccip-dev/core/records';
import type { RunContext } from '../context';
import type { ReserveBody } from '../publish';
import * as store from '../store';
import { composeCopy, type Copy } from './copy';
import { dailyFacts, loadFactsSource, milestoneFacts, recordFacts, reserveFacts, weeklyFacts, type BroadcastFacts, type FactsSource } from './facts';
import { broadcastMode, selectOutputs, telegramOutputs, type Broadcast, type BroadcastOutput, type OutputSet } from './outputs';

export const SITE_ORIGIN = 'https://ccip.dev';
export const IMAGE_TIMEOUT_MS = 20_000;
const CLAIM_STALE_MS = 3_600_000;
/** finalize's catch-up window; an older finalized day comes from a rewind and never posts a record. */
export const RECORD_DAYS = 3;
export const RECORDS_SEED_KEY = 'broadcast:records:seeded';
export const RESERVE_SINCE_KEY = 'broadcast:reserve:since';

export type BroadcastRequest = { kind: 'finalize'; days: readonly string[] } | { kind: 'reserve'; reserve: ReserveBody };

interface Planned {
  target: BroadcastTarget;
  facts: BroadcastFacts;
}

export async function runBroadcasts(c: RunContext, request: BroadcastRequest, outputs: OutputSet = telegramOutputs(c)): Promise<void> {
  const mode = broadcastMode(c.env);
  if (mode === 'off') return;
  const enabled = selectOutputs(outputs, mode);
  if (enabled.length === 0) {
    console.warn(`[broadcast] BROADCASTS is ${mode} but no output is configured`);
    return;
  }
  const planned = request.kind === 'finalize' ? await planFinalize(c, request.days) : await planReserve(c, request.reserve);
  for (const p of planned) await deliver(c, p, enabled);
}

/** Broadcasts never fail the job that runs them: a failure alerts, and the hourly run retries what was not sent. */
export async function broadcastSafely(c: RunContext, request: BroadcastRequest): Promise<void> {
  try {
    await runBroadcasts(c, request);
  } catch (err) {
    await c.alert('broadcast-run', `Broadcasts failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** New Reserve deposits, then yesterday's finalize broadcasts again: the ones already sent hold their keys, so only the rest go out. */
export async function broadcastHourly(c: RunContext, reserve: ReserveBody): Promise<void> {
  await broadcastSafely(c, { kind: 'reserve', reserve });
  const yesterday = addDays(dayOf(c.deps.now()), -1);
  if ((await store.getMeta(c.env.DB, 'last_finalize_day')) === yesterday) await broadcastSafely(c, { kind: 'finalize', days: [yesterday] });
}

async function planFinalize(c: RunContext, days: readonly string[]): Promise<Planned[]> {
  const liveStart = await store.getMeta(c.env.DB, 'live_start_day');
  const yesterday = addDays(dayOf(c.deps.now()), -1);
  const daily = days.includes(yesterday) ? yesterday : null;
  const monday = daily !== null && weekStart(daily) === addDays(daily, -6) ? addDays(daily, -6) : null;
  const oldest = addDays(yesterday, -(RECORD_DAYS - 1));
  const recordDays = [...new Set(days)].filter((d) => liveStart !== null && d >= liveStart && d >= oldest && d <= yesterday).sort();
  const wanted = [...new Set([...(daily === null ? [] : [daily]), ...recordDays])];
  if (wanted.length === 0) return [];
  const src = await loadFactsSource(c, { days: wanted, monday });
  const planned: Planned[] = [];
  const day = daily === null ? null : dailyFacts(src, daily);
  if (daily !== null && day !== null) planned.push({ target: { kind: 'daily', day: daily }, facts: day });
  const week = monday === null ? null : weeklyFacts(src, monday);
  if (monday !== null && week !== null) planned.push({ target: { kind: 'weekly', monday }, facts: week });
  if (await seedRecords(c, src)) return planned;
  for (const d of recordDays) {
    for (const record of recordsSetOn(src.history, src.largest, d)) {
      planned.push({ target: { kind: 'record', record: record.kind, day: d }, facts: recordFacts(src, record) });
    }
    for (const m of milestonesOn(src.history, d)) {
      planned.push({ target: { kind: 'milestone', metric: m.metric, threshold: m.threshold }, facts: milestoneFacts(src, m) });
    }
  }
  return planned;
}

/** The first run marks every current record and passed milestone as announced, so switching broadcasts on posts no old ones. */
async function seedRecords(c: RunContext, src: FactsSource): Promise<boolean> {
  const db = c.env.DB;
  if ((await store.getMeta(db, RECORDS_SEED_KEY)) !== null) return false;
  const value = `seeded:${c.deps.now().toISOString()}`;
  const records = RECORD_KINDS.flatMap((kind) => {
    const best = recordValue(kind, src.history, src.largest);
    return best === null ? [] : [broadcastKey({ kind: 'record', record: kind, day: best.day })];
  });
  const milestones = trackedMilestones(src.history).map((m) => broadcastKey({ kind: 'milestone', metric: m.metric, threshold: m.threshold }));
  await store.markMeta(db, [...records, ...milestones], value);
  await store.setMeta(db, RECORDS_SEED_KEY, value);
  return true;
}

async function planReserve(c: RunContext, reserve: ReserveBody): Promise<Planned[]> {
  // Before the scan catches up, reserve.json lists no transfers; a watermark set then would make every old deposit look new.
  if (reserve.cost_basis === null) return [];
  const db = c.env.DB;
  const deposits = reserve.transfers.filter(isDepositTransfer).sort((a, b) => a.ts.localeCompare(b.ts));
  const since = await store.getMeta(db, RESERVE_SINCE_KEY);
  if (since === null) {
    await store.setMeta(db, RESERVE_SINCE_KEY, deposits.at(-1)?.ts ?? '');
    return [];
  }
  return deposits
    .filter((d) => d.ts > since && d.price_usd !== null)
    .flatMap((d) => {
      const facts = reserveFacts(reserve, d.tx);
      return facts === null ? [] : [{ target: { kind: 'reserve' as const, tx: d.tx }, facts }];
    });
}

async function checkImage(c: RunContext, url: string): Promise<string | null> {
  try {
    const res = await c.deps.fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    if (!res.ok) return `answered HTTP ${res.status}`;
    if (!(res.headers.get('content-type') ?? '').startsWith('image/png')) return 'did not answer with a PNG';
    await res.arrayBuffer();
    return null;
  } catch (err) {
    return `did not answer (${err instanceof Error ? err.name : 'error'})`;
  }
}

/** Claims the key, checks the card, then sends to every output; the claim is kept once one output succeeds. */
async function deliver(c: RunContext, p: Planned, outputs: readonly BroadcastOutput[]): Promise<void> {
  const db = c.env.DB;
  const key = broadcastKey(p.target);
  let copy: Copy;
  try {
    copy = composeCopy(p.facts);
  } catch (err) {
    await c.alert(`broadcast-copy:${key}`, `${key} was not posted: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const now = c.deps.now();
  const claim = `pending:${now.toISOString()}`;
  if (!(await store.claimMeta(db, key, claim, `pending:${new Date(now.getTime() - CLAIM_STALE_MS).toISOString()}`))) return;
  const cardUrl = `${SITE_ORIGIN}/og/${broadcastCardPath(p.target)}.png`;
  const imageProblem = await checkImage(c, cardUrl);
  if (imageProblem !== null) {
    await c.alert(`broadcast-image:${key}`, `${key} was not posted: its card ${cardUrl} ${imageProblem}`);
    await store.releaseMeta(db, key, claim);
    return;
  }
  // The query makes Telegram fetch the card afresh after a re-post; the card Worker ignores it.
  const broadcast: Broadcast = { key, kind: p.target.kind, imageUrl: `${cardUrl}?v=${now.getTime()}`, facts: p.facts, ...copy };
  let sent = 0;
  for (const output of outputs) {
    const result = await output.send(broadcast).catch(() => 'failed' as const);
    if (result === 'sent') sent++;
    else await c.alert(`broadcast-${output.name}:${key}`, `${key} was not sent to ${output.name}; the Worker logs say why`);
  }
  if (sent > 0) await store.setMeta(db, key, `sent:${now.toISOString()}`);
  else await store.releaseMeta(db, key, claim);
}
```

- [ ] **Step 10: Wire it in.**
  - In `worker/src/jobs/finalize.ts`:
    - add `import { broadcastSafely } from '../broadcasts/run';`;
    - in `runFinalize`, add `const finalized: string[] = [];` before the `for (const day of days)` loop, and `finalized.push(day);` right after `const raw = await finalizeDay(c, day, shared);`;
    - after `await triggerSiteBuild(c);`, inside the same `if`, add `if (mode === 'early') await broadcastSafely(c, { kind: 'finalize', days: finalized });`.
  - In `worker/src/jobs/hourly.ts`:
    - add `import { broadcastHourly } from '../broadcasts/run';`;
    - replace `await publishRegistryFiles(c);` with `const reserve = await publishRegistryFiles(c);` followed by `await broadcastHourly(c, reserve);`.

- [ ] **Step 11: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/worker test && pnpm typecheck`. Expected: all pass. The earlier finalize, hourly and publish tests run with `BROADCASTS = "off"` from `wrangler.toml`, so they see no broadcast and no new alert.

- [ ] **Step 12: Document it.**
  - In `docs/runbook.md`, insert before `## Incidents and alerts` (after "Labels and handles"):

```markdown
## Broadcasts

The Worker posts yesterday's daily report after the 00:07 finalize, the weekly report on Mondays (the Monday–Sunday week just ended), a post for each record or milestone a new live day sets, and one for each new Reserve deposit. Each post is a card from the site (`https://ccip.dev/og/broadcast/…png`) with a caption and no link. Spec: `docs/superpowers/specs/2026-10-11-broadcasts-design.md`.

- **Mode** (`BROADCASTS` under `[vars]` in `worker/wrangler.toml`; change it and push):
  - `off` (the default): nothing is posted, claimed or seeded.
  - `drafts`: only the owner's X draft: the bot sends the card with the ready-to-paste X text to `TELEGRAM_DRAFTS_CHAT_ID`, or to `TELEGRAM_ALERT_CHAT_ID` when that is unset.
  - `on`: the Telegram channel post (`TELEGRAM_CHANNEL_ID`, `@ccipdev`; the bot is an admin there) and the X draft.
- **Testing with drafts:** set `drafts` and push. The next hourly run sends yesterday's daily to the drafts chat; the next 00:07 finalize sends the new one, and Monday's adds the weekly. Check the cards and the text for a few days, then set `on`.
- **First run:** the first run in `drafts` or `on` marks every current record and passed milestone as announced without posting them (`broadcast:records:seeded`), and notes the latest Reserve deposit (`broadcast:reserve:since`); only later deposits are posted.
- **When:**
  - The 00:07 run posts.
  - Each hourly run retries yesterday's daily, weekly and record broadcasts that are not sent yet, and posts each new deposit once it has a price.
  - The 06:00 run never posts.
  - Records only come from live days (from `live_start_day`) finalized within the last 3 days, so a rewind never posts old records.
- **Dedup keys** in D1 `meta`: `broadcast:daily:<day>`, `broadcast:weekly:<monday>`, `broadcast:record:<kind>:<day>`, `broadcast:milestone:<metric>:<threshold>`, `broadcast:reserve:<tx>`. A value of `pending:<time>` means a send is under way and can be retried an hour later; `sent:<time>` means at least one output took it; `seeded:<time>` marks a first-run record.
- **Re-post one** (say, after fixing a wrong number): delete its key, outside 23:55–00:30 UTC. The next hourly run posts it again if it is yesterday's daily, weekly or record, or a deposit after `broadcast:reserve:since`. Older ones are not re-posted.
  `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key = 'broadcast:daily:<day>'"`
- **A card:** open its URL, for example `https://ccip.dev/og/broadcast/daily/<day>.png`. Cards are cached for 15 minutes. One that has no data answers 404, and one that fails answers 500; neither is posted.
```

  - In the "Incidents and alerts" table, after the `day-leaders-publish` row, add:

```markdown
| `broadcast-image:<key>` | The broadcast's card answered an error or did not answer within 20 s, so nothing was posted and its key was released. Open the card URL in the alert; watch it with `pnpm --filter @ccip-dev/site exec wrangler tail ccip-dev-site --search "card"`. The hourly run retries yesterday's broadcasts. |
| `broadcast-telegram-channel:<key>` | The channel post failed. The Worker logs give Telegram's answer; a 400 "chat not found" or 403 means the bot lost its admin rights in `@ccipdev`. If the X draft was sent, the key is kept: delete it to post again (see "Broadcasts"). |
| `broadcast-x-draft:<key>` | The X draft did not reach the drafts chat; read the Worker logs. |
| `broadcast-copy:<key>` | The post could not be written within X's 280 or Telegram's 1,024 even with every droppable line gone. Nothing was posted; read the alert. |
| `broadcast-run` | The broadcast step itself failed (for example a D1 error while reading its facts). Finalize and the hourly job still finished; the next hourly run retries. |
```

  - In `docs/methodology.md`, before `## Coverage`, add:

```markdown
## Broadcasts

- **What is posted:** a daily report after each day is finalized, a weekly report on Mondays (Monday–Sunday, UTC), a post for each record or milestone a newly finalized day sets, and one for each Reserve deposit. They go to the Telegram channel @ccipdev and to X.
- **Same numbers as the site:** posts and their cards use the site's data and number formats. A daily change is against the mean of the 7 days before; a weekly change is against the week before.
- **Records** follow the Records page's rules: a tie keeps the earlier day, and the LINK share counts days with 100 or more messages. Milestones are the all-time message, value and fee thresholds the Records page lists.
- **Tags:** a project or chain is tagged only with an X handle its own website or docs link to; otherwise it is named.
```

- [ ] **Step 13: Run everything once more.** Run `pnpm --filter @ccip-dev/worker test && pnpm typecheck`. Expected: all pass.

- [ ] **Step 14: Commit.**

```bash
git add worker/src/telegram.ts worker/src/broadcasts/outputs.ts worker/src/broadcasts/run.ts worker/src/store.ts worker/src/publish.ts worker/src/jobs/finalize.ts worker/src/jobs/hourly.ts worker/src/env.ts worker/wrangler.toml worker/test/telegram.test.ts worker/test/broadcasts.test.ts worker/test/finalize.test.ts worker/test/hourly.test.ts docs/runbook.md docs/methodology.md
git commit -m "feat(worker): broadcast after finalize and each Reserve deposit, to the Telegram channel and as X drafts, once"
```

---

### Task 9: Card size, fonts, glyphs and the C2 orbit sky

**Files:**
- Modify: `site/scripts/embed-fonts.ts`; regenerate `site/worker/fonts.ts` (adds `INTER_800`, `MONO_800`, `CARD_FONTS`)
- Create: `site/worker/fonts/LICENSE-JetBrainsMono.txt`
- Create: `site/worker/render.ts`
- Modify: `site/worker/index.ts`, `site/worker/og.ts` (`renderPng` takes a size), `site/worker/cards/frame.ts` (`CardSize`, `CARD_SIZE`), `site/worker/h.ts` (export `Child`)
- Modify: `site/src/lib/chain-icons.ts` (`LETTERMARK_BG`, `lettermarkLetter`, moved from the script); `site/scripts/chain-icons/lettermark.ts` (re-exports them)
- Create: `site/worker/cards/glyphs.ts`, `site/worker/cards/orbit-sky.ts`, `site/worker/cards/coin-icons.ts`
- Test: `site/test/orbit-sky.test.ts`, `site/test/glyphs.test.ts`, `site/test/coin-icons.test.ts`, `site/test/og.test.ts`, `site/worker/test/render.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `fonts.ts`: `INTER_400`, `INTER_700`, `INTER_800`, `MONO_800`, and `CARD_FONTS` (Inter 400/700/800 and "JetBrains Mono" 800).
  - `frame.ts`: `interface CardSize { width: number; height: number }` and `CARD_SIZE = { width: 1200, height: 630 }`.
  - `render.ts`: `renderPng(tree: VNode, size: CardSize): Promise<Uint8Array>`.
  - `og.ts`: `OgDeps.renderPng: (tree: VNode, size: CardSize) => Promise<Uint8Array>`; the classic cards pass `CARD_SIZE`.
  - `h.ts`: `type Child = VNode | string | number | null | false | undefined`.
  - `chain-icons.ts`: `LETTERMARK_BG = '#2a3446'` and `lettermarkLetter(displayName: string): string`.
  - `glyphs.ts`:
    - `type GlyphName = 'up' | 'down' | 'right' | 'play' | 'star'`;
    - `glyph(name, size, color, margin?: { left?: number; right?: number }): VNode`;
    - `withArrows(text: string, size: number, color: string): Child[]`;
    - `MISSING_GLYPHS = /[→▲▼★▶≈]/`.
  - `orbit-sky.ts`:
    - `ORBIT_W = 1200`, `ORBIT_H = 675`, `STRIP_TOP = 611`, `HUB`, `SLOTS` (11 points), `COIN_R_MAX = 46`, `COIN_R_MIN = 17`, `LABEL_MIN_R = 22`, `MAX_LANES = 12`, `STAR_COUNT = 170`;
    - types `OrbitChain { selector; name; value }`, `OrbitLane { src; dst; usd }`, `OrbitCoin { selector; name; x; y; r; label; gold }`, `OrbitSky { svg; coins; dim }` and `OrbitOptions { chains; lanes; seed; dim?; gold? }`;
    - `seeded(seed)`, `starField(seed, count?)` and `skySvg(seed, defs, body)`;
    - `orbitSky(o: OrbitOptions): OrbitSky`, `skyNodes(sky, icons: ReadonlyMap<string, string | null>): VNode[]` and `svgDataUri(svg)`.
  - `coin-icons.ts`: `interface AssetFetcher { fetch(request: Request | string): Promise<Response> }`, `bytesToBase64(bytes)` and `coinIcon(assets, origin, selector): Promise<string | null>`.

- [ ] **Step 1: Write the failing node tests.**
  - Create `site/test/orbit-sky.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LETTERMARK_BG } from '../src/lib/chain-icons';
import type { VNode } from '../worker/h';
import { orbitSky, skyNodes, STAR_COUNT, starField } from '../worker/cards/orbit-sky';

const chain = (selector: string, value: number) => ({ selector, name: `Chain ${selector}`, value });
const style = (node: VNode) => node.props.style as Record<string, unknown>;

describe('orbitSky', () => {
  it('puts the biggest chain at the hub and sizes coins by the square root of value, labeling those of radius 22 or more', () => {
    // #when
    const sky = orbitSky({ chains: [chain('b', 25), chain('a', 100), chain('c', 4), chain('d', 1)], lanes: [], seed: 1 });
    // #then 17 + 29 × √(v / 100)
    expect(sky.coins.map((c) => [c.selector, c.x, c.y, c.r, c.label])).toEqual([
      ['a', 860, 300, 46, true],
      ['b', 1075, 205, 31.5, true],
      ['c', 1010, 470, 22.8, true],
      ['d', 715, 468, 19.9, false],
    ]);
  });

  it('places at most 11 coins and skips chains without value', () => {
    // #given 14 chains and one with no value
    const chains = [...Array.from({ length: 14 }, (_, i) => chain(`c${String(i).padStart(2, '0')}`, 14 - i)), chain('zero', 0)];
    // #then
    expect(orbitSky({ chains, lanes: [], seed: 1 }).coins.map((c) => c.selector)).toEqual(chains.slice(0, 11).map((c) => c.selector));
  });

  it('draws only lanes between placed coins, thickest for the busiest, each with a gradient along it', () => {
    // #given a lane to an unplaced chain and a lane from a chain to itself
    const lanes = [{ src: 'a', dst: 'b', usd: 50 }, { src: 'b', dst: 'c', usd: 10 }, { src: 'a', dst: 'z', usd: 99 }, { src: 'a', dst: 'a', usd: 5 }];
    // #when
    const sky = orbitSky({ chains: [chain('a', 100), chain('b', 50), chain('c', 10)], lanes, seed: 1 });
    // #then 1.6 + 4.4 × usd / 50
    expect({
      paths: [...sky.svg.matchAll(/stroke="url\(#lane(\d+)\)" stroke-width="([\d.]+)"/g)].map((m) => [m[1], m[2]]),
      userSpace: (sky.svg.match(/gradientUnits="userSpaceOnUse"/g) ?? []).length,
    }).toEqual({ paths: [['0', '6'], ['1', '2.5']], userSpace: 2 });
  });

  it('draws 170 seeded stars, the same ones for the same seed', () => {
    expect({ count: (starField(7).match(/<circle/g) ?? []).length, same: starField(7) === starField(7), differs: starField(7) !== starField(8) }).toEqual({
      count: STAR_COUNT,
      same: true,
      differs: true,
    });
  });

  it('dims the sky to 45% except the gold chain', () => {
    // #when
    const sky = orbitSky({ chains: [chain('a', 100), chain('b', 50)], lanes: [{ src: 'a', dst: 'b', usd: 1 }], seed: 1, dim: true, gold: 'b' });
    // #then
    expect({ gold: sky.coins.map((c) => c.gold), lane: sky.svg.includes('stroke-linecap="round" opacity="0.315"'), halo: sky.svg.includes('fill="url(#gold)" opacity="1"') }).toEqual({
      gold: [false, true],
      lane: true,
      halo: true,
    });
  });
});

describe('skyNodes', () => {
  it('draws coins as circle-clipped card elements over the SVG, a lettermark without an icon, and labels for the big ones', () => {
    // #given chain a has an icon and chain b has none
    const sky = orbitSky({ chains: [chain('a', 100), chain('b', 1)], lanes: [], seed: 1 });
    // #when
    const [svg, iconCoin, letterCoin, ...labels] = skyNodes(sky, new Map([['a', 'data:image/svg+xml;base64,AAAA'], ['b', null]]));
    // #then the icon is 1.25 × the coin, so its square corners fall outside the circle
    expect({
      svg: String(svg!.props.src).startsWith('data:image/svg+xml;base64,'),
      clip: [style(iconCoin!).borderRadius, style(iconCoin!).overflow, style(iconCoin!).width],
      icon: (iconCoin!.props.children as VNode).props.width,
      rim: style(iconCoin!).boxShadow,
      letter: [letterCoin!.props.children, style(letterCoin!).backgroundColor],
      labels: labels.map((l) => l.props.children),
    }).toEqual({
      svg: true,
      clip: [46, 'hidden', 92],
      icon: 115,
      rim: '0 0 0 2px rgba(255,255,255,0.28)',
      letter: ['C', LETTERMARK_BG],
      labels: ['Chain a'],
    });
  });
});
```

  - Create `site/test/glyphs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { glyph, MISSING_GLYPHS, withArrows } from '../worker/cards/glyphs';

describe('glyphs', () => {
  it('draws a glyph as an inline SVG in the given color', () => {
    // #when
    const svg = atob(String(glyph('up', 14, '#7fd4a0').props.src).split(',')[1]!);
    // #then
    expect(svg).toContain('fill="#7fd4a0"');
  });

  it('draws each " → " in a lane label as an arrow glyph', () => {
    // #when
    const parts = withArrows('Ethereum → Arc', 16, '#ffffff');
    // #then
    expect({ parts: parts.map((p) => (typeof p === 'string' ? p : 'arrow')), text: parts.some((p) => typeof p === 'string' && MISSING_GLYPHS.test(p)) }).toEqual({
      parts: ['Ethereum', 'arrow', 'Arc'],
      text: false,
    });
  });
});
```

  - Create `site/test/coin-icons.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bytesToBase64, coinIcon } from '../worker/cards/coin-icons';

const BASE = '15971525489660198786';
const ZORA = '3555797439612589184';

describe('coinIcon', () => {
  const assets = (files: Record<string, Uint8Array | string>) => ({
    fetch: async (req: Request | string) => {
      const path = new URL(typeof req === 'string' ? req : req.url).pathname;
      return path in files ? new Response(files[path]) : new Response('missing', { status: 404 });
    },
  });

  it("reads a chain's icon from the site's assets as a data URI, PNG or SVG", async () => {
    // #given
    const files = { '/chains/ethereum-mainnet-base-1.svg': '<svg/>', '/chains/zora-mainnet.png': new Uint8Array([137, 80, 78, 71]) };
    // #when
    const [svg, png] = await Promise.all([coinIcon(assets(files), 'https://ccip.dev', BASE), coinIcon(assets(files), 'https://ccip.dev', ZORA)]);
    // #then
    expect([svg, png]).toEqual([`data:image/svg+xml;base64,${btoa('<svg/>')}`, 'data:image/png;base64,iVBORw==']);
  });

  it('has no icon for a chain the manifest lacks or an asset that is missing', async () => {
    expect([await coinIcon(assets({}), 'https://ccip.dev', '1'), await coinIcon(assets({}), 'https://ccip.dev', BASE)]).toEqual([null, null]);
  });

  it('encodes more bytes than one call can spread', () => {
    const bytes = new Uint8Array(100_000).fill(65);
    expect(bytesToBase64(bytes)).toBe(btoa('A'.repeat(100_000)));
  });
});
```

  `ZORA` is the selector of the manifest's `zora-mainnet` entry, one of the four icons stored as PNG.

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @ccip-dev/site exec vitest run test/orbit-sky.test.ts test/glyphs.test.ts test/coin-icons.test.ts`. Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Move the lettermark helpers.**
  - In `site/src/lib/chain-icons.ts`, append:

```ts
export const LETTERMARK_BG = '#2a3446';

export function lettermarkLetter(displayName: string): string {
  return /[a-z0-9]/i.exec(displayName)?.[0]?.toUpperCase() ?? '?';
}
```

  - In `site/scripts/chain-icons/lettermark.ts`, delete the `LETTERMARK_BG` constant and the `lettermarkLetter` function, and add at the top:

```ts
import { LETTERMARK_BG, lettermarkLetter } from '../../src/lib/chain-icons';

export { LETTERMARK_BG, lettermarkLetter };
```

- [ ] **Step 4: Write the glyphs, the sky and the icons.**
  - In `site/worker/h.ts`, change `type Child = …` to `export type Child = …`.
  - Create `site/worker/cards/glyphs.ts`:

```ts
import { h, type Child, type VNode } from '../h';

export type GlyphName = 'up' | 'down' | 'right' | 'play' | 'star';

const PATHS: Record<GlyphName, string> = {
  up: 'M12 4 21 19H3z',
  down: 'M3 5h18l-9 15z',
  right: 'M3 10.5h13.4l-4.7-4.7 2.1-2.1 8.3 8.3-8.3 8.3-2.1-2.1 4.7-4.7H3z',
  play: 'M6 4 20 12 6 20z',
  star: 'M12 2.5l2.9 6.2 6.8.8-5 4.6 1.4 6.7L12 17.4l-6.1 3.4 1.4-6.7-5-4.6 6.8-.8z',
};

/** The embedded card fonts have none of these characters; card text must never contain them. */
export const MISSING_GLYPHS = /[→▲▼★▶≈]/;

export function glyph(name: GlyphName, size: number, color: string, margin: { left?: number; right?: number } = {}): VNode {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${PATHS[name]}" fill="${color}"/></svg>`;
  return h('img', {
    src: `data:image/svg+xml;base64,${btoa(svg)}`,
    width: size,
    height: size,
    style: { width: size, height: size, flexShrink: 0, marginLeft: margin.left ?? 0, marginRight: margin.right ?? 0 },
  });
}

export function withArrows(text: string, size: number, color: string): Child[] {
  return text.split(' → ').flatMap((part, i): Child[] => (i === 0 ? [part] : [glyph('right', size, color, { left: 8, right: 8 }), part]));
}
```

  - Create `site/worker/cards/orbit-sky.ts`:

```ts
import { LETTERMARK_BG, lettermarkLetter } from '../../src/lib/chain-icons';
import { laneControl, type Point } from '../../src/sky/geometry';
import { h, type VNode } from '../h';

export const ORBIT_W = 1200;
export const ORBIT_H = 675;
export const STRIP_TOP = 611;
export const HUB: Point = { x: 860, y: 300 };
/** Coin centers by rank, the hub first: the layout of the chosen mockup. */
export const SLOTS: readonly Point[] = [
  { x: 860, y: 300 }, { x: 1075, y: 205 }, { x: 1010, y: 470 }, { x: 715, y: 468 }, { x: 1118, y: 378 }, { x: 728, y: 150 },
  { x: 925, y: 118 }, { x: 650, y: 300 }, { x: 830, y: 560 }, { x: 1140, y: 545 }, { x: 655, y: 570 },
];
export const COIN_R_MAX = 46;
export const COIN_R_MIN = 17;
export const LABEL_MIN_R = 22;
export const MAX_LANES = 12;
export const STAR_COUNT = 170;

const ORBIT_RADII = [120, 210, 300];
/** The icon fills 125% of the coin, as in the mockup, so its rounded-square background covers the whole circle. */
const ICON_ZOOM = 1.25;
const DIM = 0.45;

export interface OrbitChain {
  selector: string;
  name: string;
  value: number;
}

export interface OrbitLane {
  src: string;
  dst: string;
  usd: number;
}

export interface OrbitCoin {
  selector: string;
  name: string;
  x: number;
  y: number;
  r: number;
  label: boolean;
  gold: boolean;
}

export interface OrbitSky {
  svg: string;
  coins: OrbitCoin[];
  dim: boolean;
}

export interface OrbitOptions {
  chains: readonly OrbitChain[];
  lanes: readonly OrbitLane[];
  seed: number;
  dim?: boolean;
  gold?: string | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** mulberry32: a small seeded generator, so a day's stars are the same on every render. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function starField(seed: number, count = STAR_COUNT): string {
  const rand = seeded(seed);
  const sizes = [1, 1, 1, 1.6, 2.4];
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = Math.round(rand() * ORBIT_W);
    const y = Math.round(rand() * STRIP_TOP);
    const r = sizes[Math.floor(rand() * sizes.length)]!;
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${(0.15 + rand() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

const BASE_DEFS = [
  '<radialGradient id="neb1" cx="72%" cy="42%" r="45%"><stop offset="0" stop-color="#1d3b8a" stop-opacity="0.55"/><stop offset="1" stop-color="#0c0f14" stop-opacity="0"/></radialGradient>',
  '<radialGradient id="neb2" cx="95%" cy="85%" r="35%"><stop offset="0" stop-color="#5b2a86" stop-opacity="0.35"/><stop offset="1" stop-color="#0c0f14" stop-opacity="0"/></radialGradient>',
  '<radialGradient id="halo"><stop offset="0" stop-color="#4a7ff0" stop-opacity="0.55"/><stop offset="1" stop-color="#4a7ff0" stop-opacity="0"/></radialGradient>',
  '<radialGradient id="gold"><stop offset="0" stop-color="#ffcf5a" stop-opacity="0.6"/><stop offset="1" stop-color="#ffcf5a" stop-opacity="0"/></radialGradient>',
].join('');

/** The night sky every broadcast card shares: the background, two nebulas and seeded stars, then `body`. */
export function skySvg(seed: number, defs: string, body: string): string {
  const rect = (fill: string) => `<rect width="${ORBIT_W}" height="${ORBIT_H}" fill="${fill}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ORBIT_W}" height="${ORBIT_H}" viewBox="0 0 ${ORBIT_W} ${ORBIT_H}">` +
    `<defs>${BASE_DEFS}${defs}</defs>${rect('#070a10')}${rect('url(#neb1)')}${rect('url(#neb2)')}${starField(seed)}${body}</svg>`
  );
}

export const svgDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/**
 * The sky's SVG holds only shapes and gradients: resvg draws no image or text nested inside an image, so coins and labels
 * are card elements (skyNodes). Lane gradients use user-space coordinates, because a bounding-box gradient on a straight
 * stroke draws nothing.
 */
export function orbitSky(o: OrbitOptions): OrbitSky {
  const ranked = o.chains
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value || (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0))
    .slice(0, SLOTS.length);
  const max = ranked[0]?.value ?? 0;
  const coins = ranked.map((c, i): OrbitCoin => {
    const r = r1(COIN_R_MIN + (COIN_R_MAX - COIN_R_MIN) * Math.sqrt(c.value / max));
    return { selector: c.selector, name: c.name, x: SLOTS[i]!.x, y: SLOTS[i]!.y, r, label: r >= LABEL_MIN_R, gold: c.selector === o.gold };
  });
  const at = new Map(coins.map((c) => [c.selector, c]));
  const lanes = o.lanes
    .filter((l) => l.usd > 0 && l.src !== l.dst && at.has(l.src) && at.has(l.dst))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, MAX_LANES);
  const maxLane = lanes[0]?.usd ?? 0;
  const fade = o.dim ? DIM : 1;
  const gradients = lanes
    .map((l, i) => {
      const a = at.get(l.src)!;
      const b = at.get(l.dst)!;
      const [from, to] = i % 2 === 0 ? ['#4a7ff0', '#7de3ff'] : ['#7a5cff', '#4a7ff0'];
      return `<linearGradient id="lane${i}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
    })
    .join('');
  const rings = ORBIT_RADII.map(
    (r) => `<circle cx="${HUB.x}" cy="${HUB.y}" r="${r}" fill="none" stroke="#4a7ff0" stroke-opacity="0.12" stroke-width="1.5" stroke-dasharray="3 9"/>`,
  ).join('');
  const paths = lanes
    .map((l, i) => {
      const a = at.get(l.src)!;
      const b = at.get(l.dst)!;
      const c = laneControl(a, b);
      return `<path d="M${a.x} ${a.y}Q${r1(c.x)} ${r1(c.y)} ${b.x} ${b.y}" stroke="url(#lane${i})" stroke-width="${r1(1.6 + 4.4 * (l.usd / maxLane))}" fill="none" stroke-linecap="round" opacity="${(0.7 * fade).toFixed(3)}"/>`;
    })
    .join('');
  const halos = coins
    .map((c) => `<circle cx="${c.x}" cy="${c.y}" r="${r1(c.r * 2)}" fill="url(#${c.gold ? 'gold' : 'halo'})" opacity="${c.gold ? '1' : (0.9 * fade).toFixed(3)}"/>`)
    .join('');
  return { svg: skySvg(o.seed, gradients, rings + paths + halos), coins, dim: Boolean(o.dim) };
}

function coinNode(c: OrbitCoin, src: string | null, dim: boolean): VNode {
  const d = r1(c.r * 2);
  const box = {
    position: 'absolute',
    left: r1(c.x - c.r),
    top: r1(c.y - c.r),
    width: d,
    height: d,
    borderRadius: c.r,
    overflow: 'hidden',
    display: 'flex',
    backgroundColor: src ? '#0c0f14' : LETTERMARK_BG,
    boxShadow: c.gold ? '0 0 0 2px rgba(255,207,90,0.9)' : '0 0 0 2px rgba(255,255,255,0.28)',
    opacity: dim && !c.gold ? DIM : 1,
  };
  if (!src) {
    return h('div', { style: { ...box, alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: Math.round(c.r), fontWeight: 700 } }, lettermarkLetter(c.name));
  }
  const zoomed = r1(d * ICON_ZOOM);
  const shift = r1((zoomed - d) / 2);
  return h('div', { style: box }, h('img', { src, width: zoomed, height: zoomed, style: { width: zoomed, height: zoomed, marginLeft: -shift, marginTop: -shift, flexShrink: 0 } }));
}

function labelNode(c: OrbitCoin, dim: boolean): VNode {
  return h(
    'div',
    {
      style: {
        position: 'absolute', left: c.x - 90, top: r1(c.y + c.r + 6), width: 180, display: 'flex', justifyContent: 'center', fontSize: 17, fontWeight: 700,
        color: '#c9d3e6', opacity: dim ? DIM : 1, whiteSpace: 'nowrap', overflow: 'hidden',
      },
    },
    c.name,
  );
}

export function skyNodes(sky: OrbitSky, icons: ReadonlyMap<string, string | null>): VNode[] {
  return [
    h('img', { src: svgDataUri(sky.svg), width: ORBIT_W, height: ORBIT_H, style: { position: 'absolute', left: 0, top: 0, width: ORBIT_W, height: ORBIT_H } }),
    ...sky.coins.map((c) => coinNode(c, icons.get(c.selector) ?? null, sky.dim)),
    ...sky.coins.filter((c) => c.label).map((c) => labelNode(c, sky.dim)),
  ];
}
```

  - Create `site/worker/cards/coin-icons.ts`:

```ts
import { iconHref } from '../../src/lib/chain-icons';

export interface AssetFetcher {
  fetch(request: Request | string): Promise<Response>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A chain's icon from the site's own static assets, as a data URI; null for a chain without one, which gets a lettermark. */
export async function coinIcon(assets: AssetFetcher, origin: string, selector: string): Promise<string | null> {
  const href = iconHref(selector);
  if (!href) return null;
  const res = await assets.fetch(new Request(`${origin}${href}`));
  if (!res.ok) return null;
  return `data:${href.endsWith('.png') ? 'image/png' : 'image/svg+xml'};base64,${bytesToBase64(new Uint8Array(await res.arrayBuffer()))}`;
}
```

- [ ] **Step 5: Run the node tests.** Run `pnpm --filter @ccip-dev/site exec vitest run test/orbit-sky.test.ts test/glyphs.test.ts test/coin-icons.test.ts test/chain-icons-lettermark.test.ts`. Expected: PASS.

- [ ] **Step 6: Embed the fonts.**
  - Run `cp site/node_modules/@fontsource/jetbrains-mono/LICENSE site/worker/fonts/LICENSE-JetBrainsMono.txt`.
  - Replace `site/scripts/embed-fonts.ts` with:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => join(require.resolve(`${pkg}/package.json`), '..', 'files', file);
const encode = async (path: string) => (await readFile(path)).toString('base64');
const inter = (weight: number) => encode(font('@fontsource/inter', `inter-latin-${weight}-normal.woff`));

const body = `// Generated by pnpm fonts:embed from @fontsource/inter and @fontsource/jetbrains-mono (SIL Open Font License 1.1; see fonts/LICENSE-*.txt).
const decode = (b64: string): ArrayBuffer => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

export const INTER_400 = decode('${await inter(400)}');
export const INTER_700 = decode('${await inter(700)}');
export const INTER_800 = decode('${await inter(800)}');
export const MONO_800 = decode('${await encode(font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-800-normal.woff'))}');

export const CARD_FONTS = [
  { name: 'Inter', data: INTER_400, weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: INTER_700, weight: 700 as const, style: 'normal' as const },
  { name: 'Inter', data: INTER_800, weight: 800 as const, style: 'normal' as const },
  { name: 'JetBrains Mono', data: MONO_800, weight: 800 as const, style: 'normal' as const },
];
`;
await writeFile(join(import.meta.dirname, '..', 'worker', 'fonts.ts'), body);
console.log('wrote worker/fonts.ts');
```

  - Run `pnpm --filter @ccip-dev/site fonts:embed`. Expected: `wrote worker/fonts.ts`. The file grows by about 80 KB of base64.

- [ ] **Step 7: Give the renderer a size.**
  - In `site/worker/cards/frame.ts`, after `export const CARD_H = 630;`, add:

```ts
export interface CardSize {
  width: number;
  height: number;
}

export const CARD_SIZE: CardSize = { width: CARD_W, height: CARD_H };
```

  - Create `site/worker/render.ts`:

```ts
import { render } from '@cf-wasm/og/workerd';
import type { CardSize } from './cards/frame';
import { CARD_FONTS } from './fonts';
import type { VNode } from './h';

export async function renderPng(tree: VNode, size: CardSize): Promise<Uint8Array> {
  return (await render(tree as never, { width: size.width, height: size.height, fonts: CARD_FONTS, loadAdditionalAsset: async () => [] }).asPng()).image;
}
```

  - Replace `site/worker/index.ts` with:

```ts
import { handleOg, type OgEnv } from './og';
import { renderPng } from './render';

export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/og/')) return env.ASSETS.fetch(request);
    return handleOg(request, env, ctx, { fetch: (input, init) => fetch(input, init), renderPng, cache: caches.default });
  },
} satisfies ExportedHandler<OgEnv & { ASSETS: Fetcher }>;
```

  - In `site/worker/og.ts`:
    - change the frame import to `import { CARD_SIZE, cardTree, SPARK_H, SPARK_W, sparkSvg, type CardSize } from './cards/frame';`;
    - change `renderPng: (tree: VNode) => Promise<Uint8Array>;` in `OgDeps` to `renderPng: (tree: VNode, size: CardSize) => Promise<Uint8Array>;`;
    - in `handleOg`, add `CARD_SIZE` as the second argument of `deps.renderPng(cardTree(…))`.
  - Run `rg -n "INTER_400|INTER_700" site/worker site/scripts`. Expected: `fonts.ts` and `scripts/chain-icons/lettermark.ts` only. The lettermark script keeps importing `INTER_700`.

- [ ] **Step 8: Write the failing render tests.**
  - In `site/test/og.test.ts`, add inside `describe('handleOg', …)`:

```ts
  it('renders the classic cards at 1200×630', async () => {
    const { get, renderPng } = setup();
    await get('/og/home.png');
    expect(renderPng.mock.calls[0]![1]).toEqual({ width: 1200, height: 630 });
  });
```

  - In `site/worker/test/render.test.ts`, add the imports `import { orbitSky, skyNodes } from '../cards/orbit-sky';`, `import { h } from '../h';` and `import { renderPng } from '../render';`, then add inside `describe('site Worker', …)`:

```ts
  it('renders the orbit sky at 1200×675 with a coin clipped to a circle and a lettermark coin, in well under the CPU limit', async () => {
    // #given a red square icon on the hub and no icon for the second chain
    const red = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>')}`;
    const sky = orbitSky({ chains: [{ selector: 'a', name: 'Alpha', value: 100 }, { selector: 'b', name: 'Beta', value: 100 }], lanes: [{ src: 'a', dst: 'b', usd: 1 }], seed: 3 });
    const tree = h('div', { style: { width: 1200, height: 675, display: 'flex', position: 'relative', backgroundColor: '#070a10', fontFamily: 'Inter' } }, ...skyNodes(sky, new Map([['a', red], ['b', null]])));
    // #when
    const started = Date.now();
    const png = await renderPng(tree, { width: 1200, height: 675 });
    const elapsed = Date.now() - started;
    // #then the hub (860, 300, r 46) is red inside and not at its square corner; Beta's coin is the lettermark color
    const [cr, cg] = await pngPixel(png, 860, 300);
    const [kr, kg] = await pngPixel(png, 816, 256);
    const [lr, lg, lb] = await pngPixel(png, 1045, 205);
    expect({
      height: new DataView(png.buffer).getUint32(20),
      center: cr > 200 && cg < 60,
      corner: kr < 200 || kg > 60,
      lettermark: Math.abs(lr - 0x2a) < 14 && Math.abs(lg - 0x34) < 14 && Math.abs(lb - 0x46) < 14,
      fast: elapsed < 10_000,
    }).toEqual({ height: 675, center: true, corner: true, lettermark: true, fast: true });
  });
```

- [ ] **Step 9: Run the site tests and typecheck.** Run `pnpm --filter @ccip-dev/site test && pnpm typecheck`. Expected: PASS. The workerd suite includes the new render test, and the classic card tests still render at 630.

- [ ] **Step 10: Commit.**

```bash
git add site/scripts/embed-fonts.ts site/worker/fonts.ts site/worker/fonts/LICENSE-JetBrainsMono.txt site/worker/render.ts site/worker/index.ts site/worker/og.ts site/worker/h.ts site/worker/cards/frame.ts site/worker/cards/glyphs.ts site/worker/cards/orbit-sky.ts site/worker/cards/coin-icons.ts site/src/lib/chain-icons.ts site/scripts/chain-icons/lettermark.ts site/test/orbit-sky.test.ts site/test/glyphs.test.ts site/test/coin-icons.test.ts site/test/og.test.ts site/worker/test/render.test.ts
git commit -m "feat(site): the orbit sky for broadcast cards, with clipped coins, glyphs, 800-weight fonts and a sized renderer"
```

---

### Task 10: Broadcast routes, and the daily and weekly cards

**Files:**
- Modify: `site/src/lib/card-paths.ts` (the `broadcast` route)
- Modify: `site/worker/cache.ts` (`BROADCAST_MAX_AGE`)
- Create: `site/worker/cards/cta.ts`
- Create: `site/worker/cards/broadcast-frame.ts`
- Create: `site/worker/cards/broadcast-cards.ts` (daily and weekly)
- Modify: `site/worker/og.ts` (broadcast routing: no-store data, 404 or 500, never the fallback)
- Create: `site/test/fixtures/broadcast.ts`
- Test: `site/test/card-paths.test.ts`, `site/test/card-content.test.ts`, `site/test/cta.test.ts`, `site/test/broadcast-cards.test.ts`, `site/test/og.test.ts`, `site/worker/test/render.test.ts`

**Interfaces:**
- Consumes:
  - Task 4: `parseBroadcastPath`, `broadcastCardPath`, `type BroadcastTarget`, `dayTotalsFacts`, `weekTotalsFacts`, `recordValueText`, `recordsSetOn`, `type RecordKind`, `formatLinkAmount`.
  - Task 5: `DayLeadersFile`, `Leader`.
  - Task 9: `orbitSky`, `skyNodes`, `glyph`, `withArrows`, `MISSING_GLYPHS`, `coinIcon`, `CardSize`, `Child`.
- Produces:
  - `card-paths.ts`: `CardRoute` gains `{ kind: 'broadcast'; target: BroadcastTarget }`.
  - `cache.ts`: `BROADCAST_MAX_AGE = 900`, so `cardMaxAge({ kind: 'broadcast', … })` is 900.
  - `cta.ts`:
    - `interface Cta { lead: string; path: string }`;
    - `CTA_ROTATION` (5 entries), `RECORDS_CTA`, `RESERVE_CTA`;
    - `ORACLE: { launch: string; cta: Cta } | null = null` and `ORACLE_ALTERNATE_DAYS = 30`;
    - `ctaFor(day: string, oracle = ORACLE): Cta`.
  - `broadcast-frame.ts`:
    - `BROADCAST_SIZE = { width: 1200, height: 675 }`, `STRIP_H = 64`, `COLORS`;
    - helpers `eyebrow(text, style?)`, `bold(text)`, `row(children, style?)`, `boldArrows(text, size?)`, and the date helpers `MONTH_DAY`, `date(day)`, `cardDay(day)` ("Sat, Oct 10, 2026") and `dayNumber(day)`;
    - `interface StatView { label; value; sub: Child[]; tone: 'up' | 'down' | 'muted' }`, `deltaStat(label, value, pct, suffix)`, `mutedStat(label, value, sub)`;
    - `statsPanel(title, stats, footer)` and `feeBars(values)`;
    - `interface FrameSpec { background: readonly VNode[]; eyebrow: string; body: VNode; insight: readonly Child[]; cta: Cta }` and `broadcastFrame(spec): VNode`.
  - `broadcast-cards.ts`:
    - `interface BroadcastInputs { load: <N extends PublicFileName>(name: N) => Promise<PublicFile<N>>; icon: (selector: string) => Promise<string | null> }`;
    - `RECORD_TITLES: Record<RecordKind, string>` and `cardWeek(monday)` ("Oct 5 – 11, 2026");
    - shared with Task 11's cards: `iconsFor(sky, icon)`, `namesOf(replay, chains)` and `skyFor(replay, names, from, to, extra?)`;
    - `broadcastTree(target: BroadcastTarget, inputs: BroadcastInputs): Promise<VNode | null>`. It builds daily and weekly here; record, milestone and Reserve answer null until Task 11.
  - Test fixtures (`site/test/fixtures/broadcast.ts`): `ETH`, `BASE`, `ARB`, `DAY`, `RECORD_DAY`, `MONDAY`, `SENDER`, `HISTORY`, `LEADERS`, `REPLAY`, `CHAINS`, `BROADCAST_FILES`, `loadFixture`, `texts(node)`.

- [ ] **Step 1: Write the fixtures.** Create `site/test/fixtures/broadcast.ts`:

```ts
import { PUBLIC_SCHEMAS, type ChainsFile, type DayLeadersFile, type HistoryFile, type PublicFile, type PublicFileName, type ReplayFile } from '@ccip-dev/core/public';

export const ETH = '5009297550715157269';
export const BASE = '15971525489660198786';
export const ARB = '4949039107694359620';
/** A quiet Saturday: fewer messages, value and fees than the days before, so it sets no record. */
export const DAY = '2026-10-10';
/** A record Sunday: the most messages, value and fees in a day, and the largest single fee. */
export const RECORD_DAY = '2026-10-11';
export const MONDAY = '2026-10-05';
export const SENDER = '0x7af7632562b6063e52788607ad56f7a60f57ce09';

const envelope = { schema_version: 1 as const, updated_at: '2026-10-12T00:07:00.000Z', attribution: 'Data: Chainlink CCIP API, DefiLlama' };
/** Sep 28 to Oct 11: two Monday–Sunday weeks. */
const DAYS = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10));

const figures = (day: string) =>
  day === DAY
    ? { messages: 150, usd: 2e6, fee: 3, link: 0.75, amount: 0.29 }
    : day === RECORD_DAY
      ? { messages: 300, usd: 9e6, fee: 6, link: 1.5, amount: 0.12 }
      : { messages: 200, usd: 8e6, fee: 4, link: 1, amount: 0.08 };

export const HISTORY: HistoryFile = {
  ...envelope,
  since: '2023-07-06',
  days: DAYS.map((day) => {
    const f = figures(day);
    return { day, messages: f.messages, token_messages: 0, usd_value: f.usd, fee_usd: f.fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: f.link, fee_link_amount: f.amount };
  }),
  largest_fees: [
    { message_id: '0x1', day: RECORD_DAY, src: ETH, dst: BASE, fee_usd: 120, symbol: 'LINK' },
    { message_id: '0x2', day: '2026-09-30', src: BASE, dst: ARB, fee_usd: 80, symbol: 'ETH' },
  ],
};

const leader = (key: string, label: string | null, messages: number, usd: number | null, fee: number | null) => ({ key, label, messages, usd, fee_usd: fee });
const dayLeaders = (day: string, feeLaneMessages: number) => ({
  day,
  token: leader(`${BASE}:0xtok`, 'syrupUSDC', 40, 500_000, null),
  sender: leader(`${ETH}:${SENDER}`, 'xStocks', 97, 300_000, 1),
  lane: leader(`${ETH}>${BASE}`, null, 30, 1_200_000, 1),
  fee_lane: leader(`${BASE}>${ARB}`, null, feeLaneMessages, 800_000, 2),
  fee_chain: leader(BASE, null, 60, 800_000, 2),
});

export const LEADERS: DayLeadersFile = {
  ...envelope,
  days: [dayLeaders(DAY, 60), dayLeaders(RECORD_DAY, 5_712)],
  weeks: [{ week: MONDAY, fee_chains: [leader(BASE, null, 1, 1, 1_800), leader(ETH, null, 1, 1, 1_600), leader(ARB, null, 1, 1, 1_000)] }],
};

export const REPLAY: ReplayFile = {
  ...envelope,
  since: '2023-07-06',
  chains: [
    { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', first_day: '2023-07-06' },
    { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet', first_day: '2023-11-03' },
    { selector: ARB, name: 'ethereum-mainnet-arbitrum-1', display_name: 'Arbitrum One', first_day: '2023-07-06' },
  ],
  lanes: [[0, 1], [1, 2]],
  days: DAYS.map((day) => ({ day, lanes: [[0, 30, 1_200_000], [1, 60, 800_000]] as [number, number, number][] })),
};

export const CHAINS: ChainsFile = {
  ...envelope,
  chains: REPLAY.chains.map((c) => ({ selector: c.selector, name: c.name!, display_name: c.display_name, family: 'EVM', chain_id: '1', first_seen: null })),
};

export const BROADCAST_FILES: Record<string, unknown> = {
  'history.json': HISTORY,
  'day-leaders.json': LEADERS,
  'replay.json': REPLAY,
  'chains.json': CHAINS,
};

export async function loadFixture<N extends PublicFileName>(name: N): Promise<PublicFile<N>> {
  if (!(name in BROADCAST_FILES)) throw new Error(`${name} is not a broadcast fixture`);
  return PUBLIC_SCHEMAS[name].parse(BROADCAST_FILES[name]) as PublicFile<N>;
}

/** Every text node of a card tree, in order. */
export function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (typeof node !== 'object' || node === null) return [];
  const children = (node as { props?: { children?: unknown } }).props?.children;
  return Array.isArray(children) ? children.flatMap(texts) : texts(children);
}
```

- [ ] **Step 2: Write the failing tests.**
  - In `site/test/card-paths.test.ts`, add to the first `it.each` list:

```ts
    ['broadcast/daily/2026-10-10', { kind: 'broadcast', target: { kind: 'daily', day: '2026-10-10' } }],
    ['broadcast/weekly/2026-10-05', { kind: 'broadcast', target: { kind: 'weekly', monday: '2026-10-05' } }],
    ['broadcast/record/fees/2026-07-09', { kind: 'broadcast', target: { kind: 'record', record: 'fees', day: '2026-07-09' } }],
    ['broadcast/milestone/messages/1000000', { kind: 'broadcast', target: { kind: 'milestone', metric: 'messages', threshold: 1_000_000 } }],
    [`broadcast/reserve/0x${'ab'.repeat(32)}`, { kind: 'broadcast', target: { kind: 'reserve', tx: `0x${'ab'.repeat(32)}` } }],
```

    and add `'broadcast', 'broadcast/monthly/2026-10-10', 'broadcast/weekly/2026-10-06'` to the rejects list.
  - In `site/test/card-content.test.ts`, add to the `cardMaxAge` table: `[{ kind: 'broadcast', target: { kind: 'daily', day: '2026-10-10' } }, null, 900],`.
  - Create `site/test/cta.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/days';
import { CTA_ROTATION, ctaFor } from '../worker/cards/cta';

const ORACLE = { launch: '2026-11-02', cta: { lead: 'Play Be The Oracle:', path: 'ccip.dev/oracle' } };
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('ctaFor', () => {
  it('rotates through the five calls to action by UTC day', () => {
    expect(new Set(days('2026-10-10', 5).map((d) => ctaFor(d, null).path)).size).toBe(CTA_ROTATION.length);
  });

  it('gives Be The Oracle every other day for its first 30 days, then one day in six', () => {
    // #when
    const first = days(ORACLE.launch, 30).map((d) => ctaFor(d, ORACLE) === ORACLE.cta);
    const later = days(addDays(ORACLE.launch, 30), 60).filter((d) => ctaFor(d, ORACLE) === ORACLE.cta).length;
    const before = days('2026-10-01', 30).some((d) => ctaFor(d, ORACLE) === ORACLE.cta);
    // #then
    expect({ alternates: first.every((isOracle, i) => isOracle === (i % 2 === 0)), later, before }).toEqual({ alternates: true, later: 10, before: false });
  });
});
```

  - Create `site/test/broadcast-cards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { VNode } from '../worker/h';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { ctaFor } from '../worker/cards/cta';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import { BASE, DAY, loadFixture, MONDAY, RECORD_DAY, texts } from './fixtures/broadcast';

const inputs = { load: loadFixture, icon: async (selector: string) => (selector === BASE ? 'data:image/svg+xml;base64,AAAA' : null) };
const tree = async (target: Parameters<typeof broadcastTree>[0]) => (await broadcastTree(target, inputs)) as VNode;

describe('daily broadcast card', () => {
  it('shows the day against its 7-day average, its leaders, and the busiest lane in the strip', async () => {
    // #when
    const words = texts(await tree({ kind: 'daily', day: DAY }));
    // #then 150 messages against 200, $2M against $8M, $3 against $4; $0.75 of $3 in LINK
    expect(words).toEqual(
      expect.arrayContaining([
        'ccip.dev', 'Daily report · Sat, Oct 10, 2026', 'Yesterday on CCIP',
        'Messages', '150', '25% vs 7d avg', 'Value moved', '$2.0M', '75%', 'Fees', '$3', 'Paid in LINK', '25%', '0.29 LINK',
        'Top token', 'syrupUSDC', '$500.0K', 'Top sender', 'xStocks', '97 msgs', 'Top fee chain', 'Base', '$2 fees',
        'Busiest lane: ', 'Ethereum', ' · $1.2M', `${ctaFor(DAY).lead} `, ctaFor(DAY).path,
      ]),
    );
  });

  it('shows the record a day set in the strip instead', async () => {
    const words = texts(await tree({ kind: 'daily', day: RECORD_DAY }));
    expect(words).toEqual(expect.arrayContaining(['New record: ', 'Most messages in a day', ' (300)']));
  });

  it('writes no glyph the card fonts lack', async () => {
    const words = [...texts(await tree({ kind: 'daily', day: DAY })), ...texts(await tree({ kind: 'weekly', monday: MONDAY }))];
    expect(words.filter((w) => MISSING_GLYPHS.test(w))).toEqual([]);
  });

  it('has no card for a day without totals or without leaders', async () => {
    expect([await broadcastTree({ kind: 'daily', day: '2026-09-01' }, inputs), await broadcastTree({ kind: 'daily', day: '2026-10-09' }, inputs)]).toEqual([null, null]);
  });
});

describe('weekly broadcast card', () => {
  it('shows the week against the one before, its fees by day, and the top 3 fee chains', async () => {
    // #when
    const card = await tree({ kind: 'weekly', monday: MONDAY });
    // #then 1,450 messages against 1,400; $51M against $56M; $29 against $28, $7.25 of it in LINK
    expect(texts(card)).toEqual(
      expect.arrayContaining([
        'Weekly report · Oct 5 – 11, 2026', 'This week on CCIP', '1,450', '3.6% vs last week', '$51.0M', '8.9%', '$29', '3.6%', '25%', '$7 in LINK', 'Fees by day',
        'Top fee chains: ', 'Base', ' $1.8K', ' · ', 'Ethereum', ' $1.6K', 'Arbitrum One', ' $1.0K',
      ]),
    );
    expect(JSON.stringify(card).match(/"backgroundColor":"#4a7ff0"/g)).toHaveLength(7);
  });

  it('has no card for a week day-leaders.json does not list', async () => {
    expect(await broadcastTree({ kind: 'weekly', monday: '2026-09-28' }, inputs)).toBeNull();
  });
});
```

  - In `site/test/og.test.ts`:
    - add `import { BROADCAST_FILES, DAY } from './fixtures/broadcast';`;
    - in `setup`, add `const dataInits: (RequestInit | undefined)[] = [];` next to `dataUrls`, change the fake fetch's signature to `async (url: string, init?: RequestInit)` and push `init` to `dataInits` beside `url`, and return `dataInits` from `setup` too;
    - add inside `describe('handleOg', …)`:

```ts
  it('renders the daily broadcast card at 1200×675, reading each data file with no-store, cached for 15 minutes', async () => {
    // #given
    const { get, renderPng, dataUrls, dataInits } = setup({}, [], { ...DATA, ...BROADCAST_FILES });
    // #when
    const res = await get(`/og/broadcast/daily/${DAY}.png`);
    // #then
    expect({
      status: res.status,
      size: renderPng.mock.calls[0]![1],
      read: dataUrls.map((u) => u.replace('https://data.ccip.dev/v1/', '')).sort(),
      noStore: dataInits.every((init) => init?.cache === 'no-store'),
      cache: res.headers.get('cache-control'),
    }).toEqual({
      status: 200,
      size: { width: 1200, height: 675 },
      read: ['chains.json', 'day-leaders.json', 'history.json', 'replay.json'],
      noStore: true,
      cache: 'public, max-age=900',
    });
  });

  it('answers 404 without rendering for a broadcast day without data, a week without leaders, or an unknown kind', async () => {
    // #given
    const { get, renderPng } = setup({}, [], { ...DATA, ...BROADCAST_FILES });
    // #when
    const statuses = [
      (await get('/og/broadcast/daily/2026-09-01.png')).status,
      (await get('/og/broadcast/weekly/2026-09-28.png')).status,
      (await get('/og/broadcast/monthly/2026-10-10.png')).status,
    ];
    // #then
    expect({ statuses, rendered: renderPng.mock.calls.length }).toEqual({ statuses: [404, 404, 404], rendered: 0 });
  });

  it('answers 500, not the fallback card, when a broadcast card fails', async () => {
    // #given rendering fails, and in a second Worker a data file is down
    const failing = setup({ renderPng: vi.fn(async () => { throw new Error('wasm trap'); }) }, [], { ...DATA, ...BROADCAST_FILES });
    const down = setup({}, ['history.json'], { ...DATA, ...BROADCAST_FILES });
    // #when
    const responses = [await failing.get(`/og/broadcast/daily/${DAY}.png`), await down.get(`/og/broadcast/daily/${DAY}.png`)];
    // #then
    expect(responses.map((r) => [r.status, r.headers.get('cache-control')])).toEqual([[500, 'no-store'], [500, 'no-store']]);
  });
```

  - In `site/worker/test/render.test.ts`:
    - add `import { BROADCAST_FILES, DAY } from '../../test/fixtures/broadcast';`;
    - in `afterEach`, add `delete assets['/chains/ethereum-mainnet-base-1.svg'];` and `await caches.default.delete(new Request(\`https://ccip.dev/og/broadcast/daily/${DAY}.png\`));`;
    - add inside `describe('site Worker', …)`:

```ts
  it('renders the daily broadcast card as a real 1200×675 PNG, its hub coin drawn from the site assets', async () => {
    // #given Base, the busiest chain, has a red icon
    assets['/chains/ethereum-mainnet-base-1.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>';
    stubData(BROADCAST_FILES);
    // #when
    const png = await renderCard(`/og/broadcast/daily/${DAY}.png`);
    // #then
    const [r, g] = await pngPixel(png, 860, 300);
    expect({ height: new DataView(png.buffer).getUint32(20), hub: r > 200 && g < 60 }).toEqual({ height: 675, hub: true });
  });
```

- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @ccip-dev/site exec vitest run test/card-paths.test.ts test/card-content.test.ts test/cta.test.ts test/broadcast-cards.test.ts test/og.test.ts`. Expected: FAIL, the broadcast route, the call to action and the card modules do not exist.

- [ ] **Step 4: Add the route and its cache age.**
  - In `site/src/lib/card-paths.ts`:
    - add `import { broadcastCardPath, parseBroadcastPath, type BroadcastTarget } from '@ccip-dev/core/broadcasts';`;
    - add `| { kind: 'broadcast'; target: BroadcastTarget }` to `CardRoute`;
    - in `parseCardPath`, before the final `return null;`, add:

```ts
  if (head === 'broadcast') {
    const target = parseBroadcastPath(parts);
    return target ? { kind: 'broadcast', target } : null;
  }
```

    - in `cardPathOf`, add the case `case 'broadcast': return broadcastCardPath(route.target);`.
  - In `site/worker/cache.ts`, add `export const BROADCAST_MAX_AGE = 900;` above `cardMaxAge`, and the case `case 'broadcast': return BROADCAST_MAX_AGE;` before `default`.

- [ ] **Step 5: Write the calls to action.** Create `site/worker/cards/cta.ts`:

```ts
import { addDays } from '../../src/lib/days';

export interface Cta {
  lead: string;
  path: string;
}

export const CTA_ROTATION: readonly Cta[] = [
  { lead: 'Watch every lane:', path: 'ccip.dev/replay' },
  { lead: 'What does a message cost?', path: 'ccip.dev/flow/30d' },
  { lead: 'Who pays the most:', path: 'ccip.dev/top/chain/7d/fees' },
  { lead: 'Every record:', path: 'ccip.dev/records' },
  { lead: 'Track the Reserve:', path: 'ccip.dev/reserve' },
];

export const RECORDS_CTA: Cta = { lead: 'Every record:', path: 'ccip.dev/records' };
export const RESERVE_CTA: Cta = { lead: 'Track it:', path: 'ccip.dev/reserve' };

/** Be The Oracle joins the rotation at its launch, set here with its call to action; until then it stays out. */
export const ORACLE: { launch: string; cta: Cta } | null = null;
export const ORACLE_ALTERNATE_DAYS = 30;

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 86_400_000);
const pick = (list: readonly Cta[], n: number) => list[((n % list.length) + list.length) % list.length]!;

export function ctaFor(day: string, oracle: { launch: string; cta: Cta } | null = ORACLE): Cta {
  const n = dayNumber(day);
  if (oracle === null || day < oracle.launch) return pick(CTA_ROTATION, n);
  if (day < addDays(oracle.launch, ORACLE_ALTERNATE_DAYS)) return (n - dayNumber(oracle.launch)) % 2 === 0 ? oracle.cta : pick(CTA_ROTATION, n);
  return pick([...CTA_ROTATION, oracle.cta], n);
}
```

- [ ] **Step 6: Write the frame.** Create `site/worker/cards/broadcast-frame.ts`:

```ts
import { formatShare } from '@ccip-dev/core/format';
import { h, type Child, type VNode } from '../h';
import type { Cta } from './cta';
import type { CardSize } from './frame';
import { glyph, withArrows } from './glyphs';

export const BROADCAST_SIZE: CardSize = { width: 1200, height: 675 };
export const STRIP_H = 64;
export const COLORS = { up: '#7fd4a0', down: '#e58a8a', muted: '#8892a0', strong: '#ffffff', soft: '#c9d3e6', brand: '#4a7ff0', gold: '#ffcf5a' } as const;

const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const CARD_DAY = utc({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const MONTH_DAY = utc({ month: 'short', day: 'numeric' });
export const date = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
/** "Sat, Oct 10, 2026" */
export const cardDay = (day: string) => CARD_DAY.format(date(day));
/** Days since 1970-01-01 (UTC): the stars' seed and the call to action's turn. */
export const dayNumber = (day: string) => Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`) / 86_400_000);

export function eyebrow(text: string, style: Record<string, unknown> = {}): VNode {
  return h('div', { style: { fontSize: 20, fontWeight: 700, letterSpacing: 4, color: COLORS.muted, textTransform: 'uppercase', ...style } }, text);
}

export function bold(text: string): VNode {
  return h('span', { style: { color: COLORS.strong, fontWeight: 700 } }, text);
}

/** A line of mixed text and glyphs; white-space is kept so the spaces between pieces survive. */
export function row(children: readonly Child[], style: Record<string, unknown> = {}): VNode {
  return h('div', { style: { display: 'flex', alignItems: 'center', whiteSpace: 'pre', ...style } }, ...children);
}

export function boldArrows(text: string, size = 16): VNode {
  return row(withArrows(text, size, COLORS.strong), { color: COLORS.strong, fontWeight: 700 });
}

export interface StatView {
  label: string;
  value: string;
  sub: Child[];
  tone: 'up' | 'down' | 'muted';
}

export function deltaStat(label: string, value: string, pct: number | null, suffix: string): StatView {
  if (pct === null) return { label, value, sub: [], tone: 'muted' };
  const up = pct >= 0;
  return { label, value, sub: [glyph(up ? 'up' : 'down', 14, up ? COLORS.up : COLORS.down, { right: 6 }), `${formatShare(Math.abs(pct))}${suffix}`], tone: up ? 'up' : 'down' };
}

export function mutedStat(label: string, value: string, sub: string): StatView {
  return { label, value, sub: [sub], tone: 'muted' };
}

function statNode(s: StatView): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: 230, marginTop: 14 } },
    h('div', { style: { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: COLORS.muted, textTransform: 'uppercase' } }, s.label),
    h('div', { style: { fontSize: 46, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: -1, marginTop: 6 } }, s.value),
    row(s.sub, { fontSize: 20, marginTop: 4, height: 26, color: COLORS[s.tone] }),
  );
}

export function statsPanel(title: string, stats: readonly StatView[], footer: VNode | null): VNode {
  return h(
    'div',
    {
      style: {
        position: 'absolute', left: 52, top: 112, width: 520, display: 'flex', flexDirection: 'column', padding: '26px 30px',
        backgroundColor: 'rgba(10,13,19,0.8)', border: '1px solid #233047', borderRadius: 22, boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
      },
    },
    eyebrow(title),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', width: 460 } }, ...stats.map(statNode)),
    footer,
  );
}

export function feeBars(values: readonly number[]): VNode {
  const max = Math.max(0, ...values);
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', marginTop: 18 } },
    h('div', { style: { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: COLORS.muted, textTransform: 'uppercase' } }, 'Fees by day'),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', height: 64, marginTop: 8 } },
      ...values.map((v, i) =>
        h('div', { style: { width: 56, height: max > 0 ? Math.max(2, Math.round((64 * v) / max)) : 2, marginLeft: i === 0 ? 0 : 11, backgroundColor: COLORS.brand, opacity: 0.85, borderRadius: '5px 5px 0 0' } }),
      ),
    ),
  );
}

function topBar(text: string): VNode {
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 44, width: 1088, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    h('div', { style: { fontSize: 34, fontWeight: 800, color: COLORS.brand, letterSpacing: -0.5 } }, 'ccip.dev'),
    eyebrow(text),
  );
}

/** Each piece keeps its width, so a long insight is clipped at the strip's middle rather than squeezed into its neighbours. */
function strip(insight: readonly Child[], cta: Cta): VNode {
  const pieces = insight.map((c) => (typeof c === 'string' ? h('span', { style: { flexShrink: 0 } }, c) : c));
  return h(
    'div',
    {
      style: {
        position: 'absolute', left: 0, top: BROADCAST_SIZE.height - STRIP_H, width: BROADCAST_SIZE.width, height: STRIP_H, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', padding: '0 56px', backgroundImage: 'linear-gradient(90deg, #13244d, #0f1a33)',
        fontSize: 22, color: COLORS.soft,
      },
    },
    row(pieces, { flexShrink: 1, minWidth: 0, overflow: 'hidden', marginRight: 24 }),
    row([glyph('play', 16, COLORS.soft, { right: 8 }), cta.lead ? `${cta.lead} ` : null, bold(cta.path)], { flexShrink: 0 }),
  );
}

export interface FrameSpec {
  background: readonly VNode[];
  eyebrow: string;
  body: VNode;
  insight: readonly Child[];
  cta: Cta;
}

export function broadcastFrame(spec: FrameSpec): VNode {
  return h(
    'div',
    { style: { width: BROADCAST_SIZE.width, height: BROADCAST_SIZE.height, display: 'flex', position: 'relative', backgroundColor: '#070a10', fontFamily: 'Inter', color: '#e8eaed' } },
    ...spec.background,
    topBar(spec.eyebrow),
    spec.body,
    strip(spec.insight, spec.cta),
  );
}
```

- [ ] **Step 7: Write the daily and weekly cards.** Create `site/worker/cards/broadcast-cards.ts`:

```ts
import { dayTotalsFacts, recordValueText, weekTotalsFacts, type BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { formatCount, formatFeeTotal, formatLinkAmount, formatShare, formatUsd } from '@ccip-dev/core/format';
import { chainName, chainNameMap, laneLabel, shortAddress, type ChainNames } from '@ccip-dev/core/names';
import type { DayLeaders, Leader, PublicFile, PublicFileName, ReplayFile } from '@ccip-dev/core/public';
import { recordsSetOn, type RecordKind, type RecordSet } from '@ccip-dev/core/records';
import { addDays } from '@ccip-dev/core/time';
import { windowWeights } from '../../src/sky/weights';
import { h, type Child, type VNode } from '../h';
import { bold, boldArrows, broadcastFrame, cardDay, COLORS, date, dayNumber, deltaStat, feeBars, MONTH_DAY, mutedStat, statsPanel } from './broadcast-frame';
import { ctaFor } from './cta';
import { glyph } from './glyphs';
import { orbitSky, skyNodes, type OrbitSky } from './orbit-sky';

export interface BroadcastInputs {
  load: <N extends PublicFileName>(name: N) => Promise<PublicFile<N>>;
  icon: (selector: string) => Promise<string | null>;
}

export const RECORD_TITLES: Record<RecordKind, string> = {
  messages: 'Most messages in a day',
  value: 'Most value moved in a day',
  fees: 'Most fees paid to CCIP in a day',
  largest_fee: 'Largest single fee',
  link_share: 'Highest share of fees paid in LINK',
};

/** "Oct 5 – 11, 2026", or "Sep 28 – Oct 4, 2026" across a month. */
export function cardWeek(monday: string): string {
  const sunday = addDays(monday, 6);
  const end = monday.slice(0, 7) === sunday.slice(0, 7) ? String(Number(sunday.slice(8))) : MONTH_DAY.format(date(sunday));
  return `${MONTH_DAY.format(date(monday))} – ${end}, ${sunday.slice(0, 4)}`;
}

export async function iconsFor(sky: OrbitSky, icon: BroadcastInputs['icon']): Promise<Map<string, string | null>> {
  return new Map(await Promise.all(sky.coins.map(async (c) => [c.selector, await icon(c.selector)] as const)));
}

export const namesOf = (replay: ReplayFile, chains: PublicFile<'chains.json'>): ChainNames => chainNameMap([...replay.chains, ...chains.chains]);

/** The day's (or week's) chains and lanes from replay.json, around the busiest chain. */
export function skyFor(replay: ReplayFile, names: ChainNames, from: string, to: string, extra: { dim?: boolean; gold?: string | null } = {}): OrbitSky {
  const weights = windowWeights(replay, from, to);
  return orbitSky({
    chains: [...weights.chains].map(([selector, value]) => ({ selector, value, name: chainName(names, selector) })),
    lanes: weights.lanes,
    seed: dayNumber(to),
    ...extra,
  });
}

const addressOf = (key: string) => key.slice(key.indexOf(':') + 1);

function leaderCell(label: string, name: string, value: string): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: 153 } },
    h('div', { style: { fontSize: 14, fontWeight: 700, letterSpacing: 2, color: COLORS.muted, textTransform: 'uppercase' } }, label),
    h('div', { style: { fontSize: 20, fontWeight: 700, marginTop: 4, maxWidth: 145, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, name),
    h('div', { style: { fontSize: 18, color: COLORS.muted, marginTop: 2 } }, value),
  );
}

function leadersRow(lead: DayLeaders, names: ChainNames): VNode {
  return h(
    'div',
    { style: { display: 'flex', marginTop: 18, paddingTop: 14, borderTop: '1px solid #1f2a3c' } },
    lead.token ? leaderCell('Top token', lead.token.label ?? shortAddress(addressOf(lead.token.key)), formatUsd(lead.token.usd)) : null,
    lead.sender ? leaderCell('Top sender', lead.sender.label ?? shortAddress(addressOf(lead.sender.key)), `${formatCount(lead.sender.messages)} msgs`) : null,
    lead.fee_chain ? leaderCell('Top fee chain', chainName(names, lead.fee_chain.key), `${formatFeeTotal(lead.fee_chain.fee_usd)} fees`) : null,
  );
}

function laneInsight(lane: Leader | null, names: ChainNames): Child[] {
  return lane ? ['Busiest lane: ', boldArrows(laneLabel(names, lane.key)), ` · ${formatUsd(lane.usd)}`] : [];
}

function recordInsight(record: RecordSet): Child[] {
  return [glyph('star', 18, COLORS.gold, { right: 8 }), 'New record: ', bold(RECORD_TITLES[record.kind]), ` (${recordValueText(record.kind, record.value)})`];
}

function feeChainsInsight(chains: readonly Leader[], names: ChainNames): Child[] {
  if (chains.length === 0) return [];
  return ['Top fee chains: ', ...chains.flatMap((l, i): Child[] => [...(i > 0 ? [' · '] : []), bold(chainName(names, l.key)), ` ${formatFeeTotal(l.fee_usd)}`])];
}

async function dailyTree(day: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, leaders, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('day-leaders.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const totals = dayTotalsFacts(history.days, day);
  const lead = leaders.days.find((d) => d.day === day);
  if (totals === null || lead === undefined) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, day, day);
  const record = recordsSetOn(history.days, history.largest_fees ?? [], day)[0];
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Daily report · ${cardDay(day)}`,
    body: statsPanel(
      'Yesterday on CCIP',
      [
        deltaStat('Messages', formatCount(totals.messages.value), totals.messages.pct, ' vs 7d avg'),
        deltaStat('Value moved', formatUsd(totals.value.value), totals.value.pct, ''),
        deltaStat('Fees', formatFeeTotal(totals.fees.value), totals.fees.pct, ''),
        mutedStat('Paid in LINK', formatShare(totals.linkSharePct), formatLinkAmount(totals.linkAmount)),
      ],
      leadersRow(lead, names),
    ),
    insight: record ? recordInsight(record) : laneInsight(lead.lane, names),
    cta: ctaFor(day),
  });
}

async function weeklyTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, leaders, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('day-leaders.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const totals = weekTotalsFacts(history.days, monday);
  const week = leaders.weeks.find((w) => w.week === monday);
  if (totals === null || week === undefined) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, monday, addDays(monday, 6));
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Weekly report · ${cardWeek(monday)}`,
    body: statsPanel(
      'This week on CCIP',
      [
        deltaStat('Messages', formatCount(totals.messages.value), totals.messages.pct, ' vs last week'),
        deltaStat('Value moved', formatUsd(totals.value.value), totals.value.pct, ''),
        deltaStat('Fees', formatFeeTotal(totals.fees.value), totals.fees.pct, ''),
        mutedStat('Paid in LINK', formatShare(totals.linkSharePct), `${formatFeeTotal(totals.linkUsd)} in LINK`),
      ],
      feeBars(totals.feesByDay),
    ),
    insight: feeChainsInsight(week.fee_chains, names),
    // The fee chains fill the strip, so the call to action shows only its address, as in the weekly mockup.
    cta: { ...ctaFor(monday), lead: '' },
  });
}

/** null when the published data has no such card: the route answers 404 and nothing is posted. */
export async function broadcastTree(target: BroadcastTarget, inputs: BroadcastInputs): Promise<VNode | null> {
  switch (target.kind) {
    case 'daily':
      return dailyTree(target.day, inputs);
    case 'weekly':
      return weeklyTree(target.monday, inputs);
    default:
      return null;
  }
}
```

- [ ] **Step 8: Route the broadcast cards** in `site/worker/og.ts`.
  - Add the imports:

```ts
import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { BROADCAST_SIZE } from './cards/broadcast-frame';
import { broadcastTree } from './cards/broadcast-cards';
import { coinIcon } from './cards/coin-icons';
```

  - Change `async function build(route: CardRoute, …)` to `async function build(route: Exclude<CardRoute, { kind: 'broadcast' }>, …)`.
  - Add before `fallback`:

```ts
/**
 * Broadcast cards read fresh data (a just-published file may still sit stale in the edge cache) and never fall back to the
 * default card: a broadcast posts only a card that rendered from its own data.
 */
async function broadcastCard(target: BroadcastTarget, route: CardRoute, url: URL, env: OgEnv, ctx: { waitUntil(p: Promise<unknown>): void }, deps: OgDeps): Promise<Response> {
  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  const uncached = { 'cache-control': 'no-store' };
  try {
    const cached = await deps.cache?.match(cacheKey);
    if (cached) return cached;
    const fresh = ((input: RequestInfo | URL, init?: RequestInit) => deps.fetch(input, { ...init, cache: 'no-store' })) as typeof fetch;
    const tree = await broadcastTree(target, {
      load: (name) => fetchPublic(name, { fetch: fresh }),
      icon: (selector) => coinIcon(env.ASSETS, url.origin, selector),
    });
    if (!tree) return new Response('Not found', { status: 404, headers: uncached });
    const png = await deps.renderPng(tree, BROADCAST_SIZE);
    const response = new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${cardMaxAge(route, null)}` } });
    if (deps.cache) ctx.waitUntil(deps.cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    console.error(`card ${url.pathname} failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Response('Card failed', { status: 500, headers: uncached });
  }
}
```

  - In `handleOg`, right after `if (!route) return new Response('Not found', { status: 404 });`, add `if (route.kind === 'broadcast') return broadcastCard(route.target, route, url, env, ctx, deps);`.

- [ ] **Step 9: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/site test && pnpm typecheck`. Expected: PASS, including the workerd daily render.

- [ ] **Step 10: Build the site.** Run `pnpm --filter @ccip-dev/site build`. Expected: the build passes, `check-build` reports the same page count, and home JavaScript stays under 150 KB. `card-paths.ts` now imports `@ccip-dev/core/broadcasts`; if home JavaScript grows by more than 1 KB, move the import of `parseBroadcastPath` and `broadcastCardPath` behind a small `site/src/lib/broadcast-paths.ts` that only the card Worker and `check-build` use, and say so in the report.

- [ ] **Step 11: Look at the cards.** Follow "Local preview of the broadcast cards". Expected:
  - The daily card matches the daily mockup in `fixes-coins-reserve.html`: circular coins with a soft halo and rim, labels under the larger coins, the glass panel with four stats and green or red deltas, the leaders row, and the strip with the busiest lane and a call to action.
  - The weekly card matches `cards-weekly-record-reserve.html`'s weekly card, plus the fee bars.
  - No "NO GLYPH" boxes anywhere.
  - Each render takes well under 5 s.

- [ ] **Step 12: Commit.**

```bash
git add site/src/lib/card-paths.ts site/worker/cache.ts site/worker/cards/cta.ts site/worker/cards/broadcast-frame.ts site/worker/cards/broadcast-cards.ts site/worker/og.ts site/test/fixtures/broadcast.ts site/test/card-paths.test.ts site/test/card-content.test.ts site/test/cta.test.ts site/test/broadcast-cards.test.ts site/test/og.test.ts site/worker/test/render.test.ts
git commit -m "feat(site): daily and weekly broadcast cards in the orbit-hub style, at 1200×675"
```

---

### Task 11: Record, milestone and Reserve cards

**Files:**
- Modify: `site/worker/cards/broadcast-cards.ts` (record and milestone cards; the dispatcher covers every kind)
- Create: `site/worker/cards/reserve-card.ts`
- Modify: `site/test/fixtures/broadcast.ts` (`DEPOSIT_TX`, `RESERVE`, `reserve.json` in `BROADCAST_FILES`)
- Test: `site/test/broadcast-cards.test.ts`, `site/test/og.test.ts`, `site/worker/test/render.test.ts`

**Interfaces:**
- Consumes:
  - Task 4: `recordDriver`, `RECORD_TOTAL`, `allTimeTotal`, `type TotalMetric`, `reserveDepositFacts`, `type ReserveDepositFacts`, `trackedMilestones`, `type MilestoneMetric`, `formatThresholdUsd`.
  - Task 9: `skySvg`, `svgDataUri`.
  - Task 10: `broadcastFrame`, `eyebrow`, `bold`, `row`, `boldArrows`, `COLORS`, `cardDay`, `MONTH_DAY`, `date`, `dayNumber`, `RECORD_TITLES`, `skyFor`, `namesOf`, `iconsFor`, `RECORDS_CTA`, `RESERVE_CTA`, `BroadcastInputs`.
- Produces:
  - `broadcastTree` renders every `BroadcastTarget` kind.
  - `reserve-card.ts`: `RESERVE_BARS = { x: 735, bottom: 540, step: 30, width: 20, max: 70 }`, `reserveSvg(d: ReserveDepositFacts, seed: number): string` and `reserveTree(tx: string, load: BroadcastInputs['load']): Promise<VNode | null>`.
  - `broadcast-cards.ts`: `bigSize(text: string): number` (132, 104 or 80 px).

- [ ] **Step 1: Add the Reserve fixture.** In `site/test/fixtures/broadcast.ts`:
  - Change the public import to also take `type ReserveFile`.
  - Before `BROADCAST_FILES`, add:

```ts
export const DEPOSIT_TX = `0x${'ab'.repeat(32)}`;

const transfer = (ts: string, tx: string, direction: 'in' | 'out', link: number, extra: Partial<ReserveFile['transfers'][number]> = {}) => ({
  ts, tx, direction, counterparty: '0x5680681ed3767b96914ce741a308155c7fb9171d', link, price_usd: null, usd: null, value_now_usd: null, change_pct: null,
  deposit: direction === 'in' && link >= 1000, ...extra,
});

/** Three weekly deposits; the last is the one broadcast. A 5-LINK gift and a 1-LINK outflow sit between them. */
export const RESERVE: ReserveFile = {
  ...envelope,
  token: '0x514910771af9ca656af840dff83e8264ecf986ca',
  reserve: '0x9a709b7b69ea42d5eeb1cebc48674c69e1569ec6',
  latest: null,
  series: [],
  link_price_usd: 15,
  cost_basis: null,
  pace: null,
  performance: null,
  latest_transfer: null,
  weekly: [
    { week: '2026-08-31', deposits: 1, link: 100_000, usd: 1_000_000 },
    { week: '2026-09-07', deposits: 1, link: 50_000, usd: 600_000 },
    { week: '2026-09-14', deposits: 1, link: 60_000, usd: 750_000 },
  ],
  transfers: [
    transfer('2026-09-01T10:00:00.000Z', '0x01', 'in', 100_000),
    transfer('2026-09-02T12:00:00.000Z', '0x02', 'in', 5),
    transfer('2026-09-08T15:00:00.000Z', '0x03', 'in', 50_000),
    transfer('2026-09-10T09:00:00.000Z', '0x04', 'out', 1),
    transfer('2026-09-15T15:00:00.000Z', DEPOSIT_TX, 'in', 60_000, { price_usd: 12.5, usd: 750_000, value_now_usd: 900_000, change_pct: 20 }),
  ],
};
```

  - Add `'reserve.json': RESERVE,` to `BROADCAST_FILES`.

- [ ] **Step 2: Write the failing tests.**
  - In `site/test/broadcast-cards.test.ts`, change the fixtures import to `import { BASE, DAY, DEPOSIT_TX, loadFixture, MONDAY, RECORD_DAY, texts } from './fixtures/broadcast';` and add:

```ts
describe('record broadcast card', () => {
  it('shows the new record big, the one it beat and how long that stood, what drove it, and the all-time total', async () => {
    // #when
    const card = await tree({ kind: 'record', record: 'messages', day: RECORD_DAY });
    // #then 300 messages beat Sep 28's 200; the busiest lane drove it; 12 × 200 + 150 + 300 messages so far
    expect(texts(card)).toEqual(
      expect.arrayContaining([
        'New all-time record · Sun, Oct 11, 2026', 'NEW RECORD', 'Most messages in a day', '300',
        'Previous record ', '200', ' on Sep 28, 2026 · stood 13 days', 'Driven by ', 'Ethereum', 'Base', ': 30 messages',
        'All-time messages now ', '2,850', 'Every record: ', 'ccip.dev/records',
      ]),
    );
    expect(JSON.stringify(card)).toContain('rgba(255,207,90,0.9)');
  });

  it("names each record's own driver: the top fee lane for fees, the route and token for the largest fee", async () => {
    // #when
    const fees = texts(await tree({ kind: 'record', record: 'fees', day: RECORD_DAY }));
    const largest = texts(await tree({ kind: 'record', record: 'largest_fee', day: RECORD_DAY }));
    // #then
    expect({ fees, largest }).toEqual({
      fees: expect.arrayContaining(['Most fees paid to CCIP in a day', '$6', '$4', 'Driven by ', 'Base', 'Arbitrum One', ': 5,712 messages', 'All-time fees now ', '$57']),
      largest: expect.arrayContaining(['Largest single fee', '$120.00', '$80.00', ' on Sep 30, 2026 · stood 11 days', 'Paid on ', 'Ethereum', ', paid in LINK']),
    });
  });

  it('has no card for a record the day did not set', async () => {
    expect([
      await broadcastTree({ kind: 'record', record: 'link_share', day: RECORD_DAY }, inputs),
      await broadcastTree({ kind: 'record', record: 'messages', day: DAY }, inputs),
    ]).toEqual([null, null]);
  });
});

describe('milestone broadcast card', () => {
  it('shows the threshold and the day it was crossed', async () => {
    // #when 200 messages a day reach 2,000 on the tenth day, Oct 7
    const card = await tree({ kind: 'milestone', metric: 'messages', threshold: 2000 });
    // #then
    expect(texts(card)).toEqual(
      expect.arrayContaining(['Milestone · Wed, Oct 7, 2026', 'MILESTONE', 'All-time messages on CCIP', '2,000', 'Crossed on Oct 7, 2026', 'All-time messages now ']),
    );
  });

  it('has no card for a threshold not crossed yet', async () => {
    expect(await broadcastTree({ kind: 'milestone', metric: 'messages', threshold: 5000 }, inputs)).toBeNull();
  });
});

describe('Reserve broadcast card', () => {
  it('shows the deposit, its value then and now, the balance, the streak, the pace and the weekly bars', async () => {
    // #when
    const card = await tree({ kind: 'reserve', tx: DEPOSIT_TX });
    // #then 210,004 LINK held after it; three deposits in a row; 75,000 LINK a week reaches 1M on Nov 28
    const bars = atob(String((card.props.children as { props: { src?: string } }[])[0]!.props.src).split(',')[1]!);
    expect({
      words: texts(card),
      bars: (bars.match(/<rect x="/g) ?? []).length,
      current: bars.includes('fill="#7de3ff" opacity="1"'),
    }).toEqual({
      words: expect.arrayContaining([
        'Chainlink Reserve · Tue, Sep 15, 2026', 'New deposit into the Reserve', '+60,000', 'LINK',
        '$750.0K', ' at deposit', ' · ', '$900.0K', ' today (+20.0%)',
        '210.0K', 'LINK held', '3', 'weeks in a row', 'Nov 28', 'On pace for 1M', 'LINK ADDED PER WEEK · 3 WEEKS',
        'Weekly average: ', '75,000 LINK', ' ($800.0K) over 4 weeks', 'Track it: ', 'ccip.dev/reserve',
      ]),
      bars: 3,
      current: true,
    });
  });

  it('has no card for a gift, an outflow or an unknown transaction', async () => {
    expect([
      await broadcastTree({ kind: 'reserve', tx: '0x02' }, inputs),
      await broadcastTree({ kind: 'reserve', tx: '0x04' }, inputs),
      await broadcastTree({ kind: 'reserve', tx: `0x${'cd'.repeat(32)}` }, inputs),
    ]).toEqual([null, null, null]);
  });

  it('writes no glyph the card fonts lack on the record, milestone and Reserve cards', async () => {
    const words = [
      ...texts(await tree({ kind: 'record', record: 'value', day: RECORD_DAY })),
      ...texts(await tree({ kind: 'milestone', metric: 'messages', threshold: 2000 })),
      ...texts(await tree({ kind: 'reserve', tx: DEPOSIT_TX })),
    ];
    expect(words.filter((w) => MISSING_GLYPHS.test(w))).toEqual([]);
  });
});
```

  - In `site/test/og.test.ts`, change the fixtures import to `import { BROADCAST_FILES, DAY, DEPOSIT_TX, RECORD_DAY } from './fixtures/broadcast';` and add inside `describe('handleOg', …)`:

```ts
  it('renders the record, milestone and Reserve cards from their own files, and 404s the ones the data does not hold', async () => {
    // #given
    const { get, dataUrls } = setup({}, [], { ...DATA, ...BROADCAST_FILES });
    // #when
    const statuses = [
      (await get(`/og/broadcast/record/messages/${RECORD_DAY}.png`)).status,
      (await get(`/og/broadcast/record/link_share/${RECORD_DAY}.png`)).status,
      (await get('/og/broadcast/milestone/messages/2000.png')).status,
      (await get('/og/broadcast/milestone/messages/5000.png')).status,
    ];
    const before = dataUrls.length;
    const reserve = (await get(`/og/broadcast/reserve/${DEPOSIT_TX}.png`)).status;
    // #then the Reserve card reads reserve.json alone
    expect({ statuses, reserve, read: dataUrls.slice(before).map((u) => u.replace('https://data.ccip.dev/v1/', '')) }).toEqual({
      statuses: [200, 404, 200, 404],
      reserve: 200,
      read: ['reserve.json'],
    });
  });
```

  - In `site/worker/test/render.test.ts`:
    - change the fixtures import to `import { BROADCAST_FILES, DAY, DEPOSIT_TX } from '../../test/fixtures/broadcast';`;
    - in `afterEach`, add `await caches.default.delete(new Request(\`https://ccip.dev/og/broadcast/reserve/${DEPOSIT_TX}.png\`));`;
    - add:

```ts
  it('renders the Reserve broadcast card as a real 1200×675 PNG with the Chainlink hexagon mark', async () => {
    // #given
    stubData(BROADCAST_FILES);
    // #when
    const png = await renderCard(`/og/broadcast/reserve/${DEPOSIT_TX}.png`);
    // #then the mark's #375BD2 stroke runs through (880, 200), just below its top corner
    const [r, g, b] = await pngPixel(png, 880, 200);
    expect({ height: new DataView(png.buffer).getUint32(20), mark: b > 180 && r < 100 && g < 130 }).toEqual({ height: 675, mark: true });
  });
```

- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @ccip-dev/site exec vitest run test/broadcast-cards.test.ts test/og.test.ts`. Expected: FAIL, the record, milestone and Reserve kinds answer null (404).

- [ ] **Step 4: Write the Reserve card.** Create `site/worker/cards/reserve-card.ts`:

```ts
import { reserveDepositFacts, type ReserveDepositFacts } from '@ccip-dev/core/broadcasts';
import { formatCompactCount, formatCount, formatPct, formatUsd } from '@ccip-dev/core/format';
import { h, type Child, type VNode } from '../h';
import type { BroadcastInputs } from './broadcast-cards';
import { bold, broadcastFrame, cardDay, COLORS, date, dayNumber, eyebrow, MONTH_DAY, row } from './broadcast-frame';
import { RESERVE_CTA } from './cta';
import { ORBIT_H, ORBIT_W, skySvg, svgDataUri } from './orbit-sky';

export const RESERVE_BARS = { x: 735, bottom: 540, step: 30, width: 20, max: 70 } as const;

const MARK = { x: 880, y: 300 };
const STREAMS = [
  { d: 'M1210 40 C1090 70 1010 140 935 215', width: 5, opacity: 0.9, from: [1210, 40], to: [935, 215] },
  { d: 'M1215 170 C1120 190 1050 230 975 265', width: 4, opacity: 0.7, from: [1215, 170], to: [975, 265] },
  { d: 'M1150 -10 C1080 60 1000 120 915 200', width: 3, opacity: 0.5, from: [1150, -10], to: [915, 200] },
] as const;
const COMETS = [[1010, 140], [1080, 205], [1010, 95]] as const;

const r1 = (v: number) => Math.round(v * 10) / 10;

function hexagon(r: number): string {
  return Array.from({ length: 6 }, (_, k) => {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return `${r1(MARK.x + r * Math.cos(a))},${r1(MARK.y + r * Math.sin(a))}`;
  }).join(' ');
}

/** The Chainlink hexagon glowing with deposits streaming in, over the LINK added each week (this deposit's week lit). */
export function reserveSvg(d: ReserveDepositFacts, seed: number): string {
  const defs = [
    '<filter id="blur8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>',
    '<filter id="blur20" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="20"/></filter>',
    ...STREAMS.map(
      (s, i) =>
        `<linearGradient id="stream${i}" gradientUnits="userSpaceOnUse" x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}"><stop offset="0" stop-color="#4a7ff0"/><stop offset="1" stop-color="#7de3ff"/></linearGradient>`,
    ),
  ].join('');
  const max = Math.max(0, ...d.weeks.map((w) => w.link));
  const bars = d.weeks.map((w, i) => {
    const height = max > 0 ? Math.max(2, Math.round((RESERVE_BARS.max * w.link) / max)) : 2;
    const current = i === d.weeks.length - 1;
    return `<rect x="${RESERVE_BARS.x + RESERVE_BARS.step * i}" y="${RESERVE_BARS.bottom - height}" width="${RESERVE_BARS.width}" height="${height}" rx="3" fill="${current ? '#7de3ff' : '#4a7ff0'}" opacity="${current ? 1 : 0.75}"/>`;
  });
  const body = [
    `<circle cx="${MARK.x}" cy="${MARK.y}" r="230" fill="none" stroke="#4a7ff0" stroke-opacity="0.14" stroke-width="1.5" stroke-dasharray="3 9"/>`,
    `<circle cx="${MARK.x}" cy="${MARK.y}" r="165" fill="none" stroke="#4a7ff0" stroke-opacity="0.18" stroke-width="1.5" stroke-dasharray="3 9"/>`,
    `<polygon points="${hexagon(118)}" fill="#2a5bd7" opacity="0.55" filter="url(#blur20)"/>`,
    `<polygon points="${hexagon(104)}" fill="#0b1430" stroke="#375BD2" stroke-width="30" stroke-linejoin="miter"/>`,
    `<polygon points="${hexagon(104)}" fill="none" stroke="#7aa2ff" stroke-opacity="0.5" stroke-width="2"/>`,
    ...STREAMS.map((s, i) => `<path d="${s.d}" stroke="url(#stream${i})" stroke-width="${s.width}" fill="none" stroke-linecap="round" opacity="${s.opacity}"/>`),
    ...COMETS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="#9fc2ff" opacity="0.4" filter="url(#blur8)"/>`),
    ...bars,
  ].join('');
  return skySvg(seed, defs, body);
}

function reserveStat(value: string, label: string): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', marginRight: 44 } },
    h('div', { style: { fontSize: 34, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: -1 } }, value),
    h('div', { style: { fontSize: 17, fontWeight: 700, letterSpacing: 2.5, color: COLORS.muted, textTransform: 'uppercase', marginTop: 2 } }, label),
  );
}

function reserveBody(d: ReserveDepositFacts): VNode {
  const worth: Child[] = [
    ...(d.usdAtDeposit === null ? [] : [bold(formatUsd(d.usdAtDeposit)), ' at deposit']),
    ...(d.usdNow === null ? [] : [' · ', bold(formatUsd(d.usdNow)), ` today${d.changePct === null ? '' : ` (${formatPct(d.changePct)})`}`]),
  ];
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 124, width: 640, display: 'flex', flexDirection: 'column' } },
    eyebrow('New deposit into the Reserve'),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', marginTop: 10 } },
      h('div', { style: { fontSize: 104, fontWeight: 800, letterSpacing: -3, lineHeight: 1 } }, `+${formatCount(d.link)}`),
      h('div', { style: { fontSize: 52, fontWeight: 800, color: '#7aa2ff', marginLeft: 14, marginBottom: 8 } }, 'LINK'),
    ),
    row(worth, { fontSize: 28, marginTop: 18, color: COLORS.muted }),
    h(
      'div',
      { style: { display: 'flex', marginTop: 40, paddingTop: 26, borderTop: '1px solid #1f2a3c' } },
      reserveStat(formatCompactCount(d.balanceLink), 'LINK held'),
      reserveStat(formatCount(d.streak), 'weeks in a row'),
      d.nextMilestone ? reserveStat(MONTH_DAY.format(date(d.nextMilestone.eta)), `On pace for ${formatCount(d.nextMilestone.link / 1_000_000)}M`) : null,
    ),
  );
}

export async function reserveTree(tx: string, load: BroadcastInputs['load']): Promise<VNode | null> {
  const d = reserveDepositFacts(await load('reserve.json'), tx);
  if (d === null) return null;
  const day = d.ts.slice(0, 10);
  return broadcastFrame({
    background: [
      h('img', { src: svgDataUri(reserveSvg(d, dayNumber(day))), width: ORBIT_W, height: ORBIT_H, style: { position: 'absolute', left: 0, top: 0, width: ORBIT_W, height: ORBIT_H } }),
      h(
        'div',
        { style: { position: 'absolute', left: RESERVE_BARS.x, top: RESERVE_BARS.bottom - RESERVE_BARS.max - 27, fontSize: 15, fontWeight: 700, letterSpacing: 2.5, color: COLORS.muted } },
        `LINK ADDED PER WEEK · ${d.weeks.length} WEEKS`,
      ),
    ],
    eyebrow: `Chainlink Reserve · ${cardDay(day)}`,
    body: reserveBody(d),
    insight:
      d.avgWeeklyLink === null
        ? []
        : ['Weekly average: ', bold(`${formatCount(d.avgWeeklyLink)} LINK`), `${d.avgWeeklyUsd === null ? '' : ` (${formatUsd(d.avgWeeklyUsd)})`} over 4 weeks`],
    cta: RESERVE_CTA,
  });
}
```

  The `import type { BroadcastInputs } from './broadcast-cards'` is type-only, so it adds no runtime import cycle with the dispatcher.

- [ ] **Step 5: Add the record and milestone cards** in `site/worker/cards/broadcast-cards.ts`.
  - Change the imports to:

```ts
import {
  allTimeTotal, dayTotalsFacts, RECORD_TOTAL, recordDriver, recordValueText, weekTotalsFacts, type BroadcastTarget, type RecordDriver, type TotalMetric,
} from '@ccip-dev/core/broadcasts';
import { formatCount, formatFeeTotal, formatLink, formatLinkAmount, formatShare, formatUsd, formatUtcDay } from '@ccip-dev/core/format';
import { chainName, chainNameMap, laneLabel, shortAddress, type ChainNames } from '@ccip-dev/core/names';
import type { DayLeaders, Leader, PublicFile, PublicFileName, ReplayFile } from '@ccip-dev/core/public';
import { formatThresholdUsd, recordsSetOn, trackedMilestones, type MilestoneMetric, type RecordKind, type RecordSet } from '@ccip-dev/core/records';
import { addDays } from '@ccip-dev/core/time';
import { windowWeights } from '../../src/sky/weights';
import { h, type Child, type VNode } from '../h';
import { bold, boldArrows, broadcastFrame, cardDay, COLORS, date, dayNumber, deltaStat, eyebrow, feeBars, MONTH_DAY, mutedStat, row, statsPanel } from './broadcast-frame';
import { ctaFor, RECORDS_CTA } from './cta';
import { glyph } from './glyphs';
import { orbitSky, skyNodes, type OrbitSky } from './orbit-sky';
import { reserveTree } from './reserve-card';
```

  - Before `broadcastTree`, add:

```ts
export function bigSize(text: string): number {
  return text.length <= 7 ? 132 : text.length <= 10 ? 104 : 80;
}

function headlineBody(o: { pill: string; title: string; value: string; lines: (VNode | null)[] }): VNode {
  return h(
    'div',
    { style: { position: 'absolute', left: 52, top: 118, width: 660, display: 'flex', flexDirection: 'column' } },
    row([glyph('star', 18, '#1a1205', { right: 8 }), o.pill], {
      alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 999, backgroundImage: 'linear-gradient(90deg, #ffcf5a, #ff9f43)',
      color: '#1a1205', fontWeight: 800, fontSize: 20, letterSpacing: 3,
    }),
    eyebrow(o.title, { marginTop: 24 }),
    h('div', { style: { fontSize: bigSize(o.value), fontWeight: 800, letterSpacing: -4, lineHeight: 1.02, color: '#ffffff', textShadow: '0 0 40px rgba(255,207,90,0.35)' } }, o.value),
    ...o.lines,
  );
}

function previousLine(r: RecordSet): VNode {
  const days = `${formatCount(r.stoodDays)} day${r.stoodDays === 1 ? '' : 's'}`;
  return row(['Previous record ', bold(recordValueText(r.kind, r.previous.value)), ` on ${formatUtcDay(r.previous.day)} · stood ${days}`], { fontSize: 26, marginTop: 10, color: COLORS.muted });
}

function driverLine(r: RecordSet, d: RecordDriver | null, names: ChainNames): VNode | null {
  if (d === null) return null;
  const lane = boldArrows(laneLabel(names, d.lane), 20);
  const style = { fontSize: 24, marginTop: 10, color: COLORS.soft };
  if (r.kind === 'largest_fee') return row(['Paid on ', lane, d.symbol ? `, paid in ${d.symbol}` : ''], style);
  return row(['Driven by ', lane, r.kind === 'value' ? `: ${formatUsd(d.usd)} moved` : `: ${formatCount(d.messages)} messages`], style);
}

const ALL_TIME: Record<TotalMetric, [string, (v: number) => string]> = {
  messages: ['All-time messages now ', formatCount],
  value: ['All-time value moved now ', formatUsd],
  fees: ['All-time fees now ', formatFeeTotal],
  link_amount: ['All-time LINK paid in fees now ', formatLink],
};

function allTimeInsight(metric: TotalMetric, total: number): Child[] {
  const [lead, format] = ALL_TIME[metric];
  return [lead, bold(format(total))];
}

async function recordTree(kind: RecordKind, day: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, leaders, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('day-leaders.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const largest = history.largest_fees ?? [];
  const record = recordsSetOn(history.days, largest, day).find((r) => r.kind === kind);
  if (record === undefined) return null;
  const names = namesOf(replay, chains);
  const driver = recordDriver(record, leaders.days.find((d) => d.day === day) ?? null, largest);
  const sky = skyFor(replay, names, day, day, { dim: true, gold: driver ? (driver.lane.split('>')[0] ?? null) : null });
  const metric = RECORD_TOTAL[kind];
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `New all-time record · ${cardDay(day)}`,
    body: headlineBody({ pill: 'NEW RECORD', title: RECORD_TITLES[kind], value: recordValueText(kind, record.value), lines: [previousLine(record), driverLine(record, driver, names)] }),
    insight: allTimeInsight(metric, allTimeTotal(metric, history.days, day)),
    cta: RECORDS_CTA,
  });
}

const MILESTONE_TITLES: Record<MilestoneMetric, string> = {
  messages: 'All-time messages on CCIP',
  value: 'All-time value moved over CCIP',
  fees: 'All-time fees paid to CCIP',
};

async function milestoneTree(metric: MilestoneMetric, threshold: number, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const milestone = trackedMilestones(history.days).find((m) => m.metric === metric && m.threshold === threshold);
  if (milestone === undefined) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, milestone.day, milestone.day, { dim: true });
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Milestone · ${cardDay(milestone.day)}`,
    body: headlineBody({
      pill: 'MILESTONE',
      title: MILESTONE_TITLES[metric],
      value: metric === 'messages' ? formatCount(threshold) : formatThresholdUsd(threshold),
      lines: [row([`Crossed on ${formatUtcDay(milestone.day)}`], { fontSize: 26, marginTop: 10, color: COLORS.muted })],
    }),
    insight: allTimeInsight(metric, allTimeTotal(metric, history.days, milestone.day)),
    cta: RECORDS_CTA,
  });
}
```

  - Replace the `default: return null;` branch of `broadcastTree` with:

```ts
    case 'record':
      return recordTree(target.record, target.day, inputs);
    case 'milestone':
      return milestoneTree(target.metric, target.threshold, inputs);
    case 'reserve':
      return reserveTree(target.tx, inputs.load);
```

- [ ] **Step 6: Run the tests, typecheck and build.** Run `pnpm --filter @ccip-dev/site test && pnpm typecheck && pnpm --filter @ccip-dev/site build`. Expected: all pass, with home JavaScript unchanged.

- [ ] **Step 7: Look at the cards.** Follow "Local preview of the broadcast cards". Expected:
  - The record card matches `cards-weekly-record-reserve.html`'s record card: the sky dimmed to 45% with the driver's source chain in gold, the gold pill, the eyebrow, the value at 132 px, the previous-record and driver lines, and the all-time total in the strip.
  - The milestone card has the same layout, with "MILESTONE".
  - The Reserve card matches the redesigned card in `fixes-coins-reserve.html`: "+N LINK" on one line, USD at deposit and today, the three stats, the glowing hexagon with three streams and comets, and the weekly bars with their label.
  - No "NO GLYPH" boxes anywhere.

- [ ] **Step 8: Commit.**

```bash
git add site/worker/cards/broadcast-cards.ts site/worker/cards/reserve-card.ts site/test/fixtures/broadcast.ts site/test/broadcast-cards.test.ts site/test/og.test.ts site/worker/test/render.test.ts
git commit -m "feat(site): record, milestone and Reserve broadcast cards"
```

---

### Task 12: Proposed handles, for the owner's review

This is research, not code. It produces a proposed `labels/chain-x.json` and `[[tokens]]` entries in one draft pull request for the owner (spec §10, step 1). **Never invent a handle.** A handle goes in only when the chain's or project's own website or docs link to that X account. Everything else is left out and listed under "Not added", where it stays a plain name in posts.

**Files:**
- Modify: `labels/chain-x.json`
- Modify or create: `labels/projects/<project>.toml` (`[[tokens]]` entries; new token-only project files)
- Modify: `worker/src/generated/handles.json` (written by `pnpm labels:build`)

**Interfaces:**
- Consumes: the schema and checks from Task 3, which must already be on `main`. Run this task after Tasks 1–11 are merged.
- Produces: a draft pull request from `labels/handles` that the owner reviews and merges. Do not merge it yourself.

- [ ] **Step 1: Branch from `main`.** Run `git fetch origin && git switch -c labels/handles origin/main`.

- [ ] **Step 2: List the chains to research.** These are the chains that would appear in the busiest lane or the top fee chains, from the live 30-day rankings:

```bash
{ curl -s https://data.ccip.dev/v1/top/src_chain.json | jq -r '.windows["30d"][:15][].key, (.by_fees["30d"] // [])[:10][].key'
  curl -s https://data.ccip.dev/v1/top/dst_chain.json | jq -r '.windows["30d"][:15][].key'; } | sort -u > <scratch>/handle-chains.txt
curl -s https://data.ccip.dev/v1/chains.json | jq -r --rawfile wanted <scratch>/handle-chains.txt \
  '($wanted | split("\n") | map(select(length > 0))) as $s | .chains[] | select(.selector as $x | $s | index($x)) | [.name, (.display_name // "")] | @tsv'
```

  Expected: about 20 lines of `<registry name>\t<display name>`. The registry name is the `labels/chain-x.json` key, and it must be listed in `labels/ccip-chains.json`.

- [ ] **Step 3: List the tokens to research.**

```bash
curl -s https://data.ccip.dev/v1/top/token.json | jq -r '.windows["30d"][:10][] | [.key, (.symbol // "?"), .usd] | @tsv'
```

  Each key is `<chain selector>:<address>`. Find the chain's registry name in `chains.json` as in Step 2. One entry per token group is enough: an entry on one chain covers every chain in the token's CCIP registry group.

- [ ] **Step 4: Verify each chain's handle.** For each chain:
  - Find the chain's own website. Prefer the site its CCIP directory page or its own docs name. Do not use an aggregator, a block explorer or a third-party list.
  - List the X links on that page: `curl -sL <site> | grep -oiE 'https?://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}' | sort -u`. If the homepage has none, try the site's own community or contact page.
  - Accept a handle only when it appears on a page of the chain's own domain or its official docs. The `source` is that page's URL.
  - If there is no such link, or more than one candidate and the site does not say which is official, leave the chain out and note why.

- [ ] **Step 5: Verify each token's project.** For each token:
  - Find the issuing project's docs page that lists this token's contract address on one CCIP chain. That page is the token's `source`.
  - Find the project's X handle on its own website, as in Step 4.
  - If `labels/projects/` already has a file for the project, add the token there. Otherwise create `labels/projects/<kebab-case name>.toml`:

```toml
name = "<Project name as the project writes it>"
x = "<handle without @>"
url = "<the project's site, the page that links to the handle>"
kind = "issuer"
verified = true

[[tokens]]
chain = "<registry chain name>"
address = "<token address on that chain, as the docs list it>"
source = "<the docs page that lists this address>"
```

  - Leave a token out when either the address or the handle cannot be verified this way.

- [ ] **Step 6: Write the chain handles.** Write `labels/chain-x.json`, sorted by key, as `{ "<registry name>": { "x": "<handle without @>", "source": "<https page>" } }`.

- [ ] **Step 7: Re-check every source mechanically.**

```bash
jq -r 'to_entries[] | "\(.value.source) \(.value.x)"' labels/chain-x.json | while read -r src x; do
  if curl -sL "$src" | grep -qiE "(x|twitter)\.com/${x}([^A-Za-z0-9_]|$)"; then echo "ok    $x"; else echo "CHECK $x $src"; fi
done
```

  Expected: every line starts with `ok`. For each `CHECK`, open the page in a browser; if the link is not there, remove the entry. Do the same by hand for each project's `url` and `x`, and for each token's `source` and address.

- [ ] **Step 8: Validate and compile.** Run `pnpm labels:check && pnpm labels:build`. Expected: `labels ok: …`, then `wrote N chain handle(s) and M token handle(s) to worker/src/generated/handles.json`, with N and M matching what you added. Then run `pnpm --filter @ccip-dev/core test && pnpm --filter @ccip-dev/worker test`. Expected: PASS.

- [ ] **Step 9: Open the draft pull request.** Write the body to `<scratch>/handles-pr.md`, where `<scratch>` is your scratch directory:
  - A "Chains" table: chain, handle, source.
  - A "Tokens" table: symbol, chain, address, project, handle, token source, handle source.
  - A "Not added" list: each chain or token left out, and why.
  - Write handles without the `@`, inside backticks, so GitHub does not mention its own users of the same name.

  Then run:

```bash
git add labels/chain-x.json labels/projects/<each file you changed or created> worker/src/generated/handles.json
git commit -m "chore(labels): proposed chain and token handles for broadcasts, each with its source"
git push -u origin labels/handles
gh pr create --draft --base main --head labels/handles --title "Proposed chain and token handles for broadcasts" --body-file <scratch>/handles-pr.md
```

  Report the PR URL and the counts. Do not merge it: the owner reviews every handle (spec §10a).

---

## Self-review notes

- **Spec coverage:**
  - §1 owner decisions:
    - finalize at 00:07: Task 1;
    - the broadcast step after finalize and the Reserve: Task 8;
    - Telegram automatic and X drafts: Task 8;
    - an X API output fits the `BroadcastOutput` interface: Task 8;
    - images and no links: Tasks 7, 8 and 10;
    - the four types and the C2 style: Tasks 9–11;
    - the strip and its rotation, with Be The Oracle behind `ORACLE`: Task 10;
    - tags and closing tags: Task 7.
  - §2 success criteria:
    - 1–4: Task 8 (daily, weekly on Monday, records with live-only, rewind and seeding rules, Reserve once);
    - 5: Task 8 (claims, release, partial success, re-runs);
    - 6–7: Task 7;
    - 8: Tasks 3 and 6;
    - 9: Tasks 8 (image first) and 10–11 (public data only; a failure is 500, not the fallback);
    - 10: no new dependency or service anywhere.
  - §4 pipeline:
    - §4.1: Task 1;
    - §4.2: Task 8 (finalize, the late run never, the Reserve after publishing `reserve.json`);
    - §4.3 dedup keys and seeding, and §4.4 mode and settings: Task 8.
  - §5 content:
    - §5.1 facts: Tasks 4 and 6;
    - the record kinds and the shared record logic: Tasks 2 and 4;
    - §5.2 tables: Task 3, with the data in Task 12;
    - §5.3 copy: Task 7.
  - §6 outputs, failure alerts and image first: Task 8.
  - §7 cards:
    - §7.1 routes, size and data: Tasks 9–10;
    - §7.2 C2 style: Tasks 9–10;
    - §7.3 per type: Tasks 10–11;
    - §7.4 `day-leaders.json`: Task 5.
  - §8 docs:
    - 00:07: Task 1;
    - labels and handles: Task 3;
    - `day-leaders-publish`: Task 5;
    - Broadcasts in the runbook and the methodology: Task 8.
  - §9 testing: every listed test has a home:
    - facts: Tasks 4 and 6;
    - records and seeding: Tasks 4 and 8;
    - dedup and mode, image first, and the Worker run: Task 8;
    - copy: Task 7;
    - cards: Tasks 9–11.
  - §10 rollout: Task 12 and the runbook's "Testing with drafts" (Task 8).
  - §10a risks: render time is asserted in Task 9's workerd test, and the preview prints it.
- **Names used across tasks:**
  - Task 2: `@ccip-dev/core/format`, `/names`, `/records`.
  - Task 3: `Handles`, `TokenHandle`, `ChainHandles`, `validateChainHandles`, `buildHandles`, `RunContext.handles`, `harness({ handles })`.
  - Task 4:
    - `reserve-pace` (`isDeposit`, `depositStreak`, `nextMilestone`);
    - `TransferView.deposit` and `isDay`;
    - `formatLinkAmount`;
    - `RECORD_KINDS`, `MILESTONE_METRICS`, `RecordSet`, `MilestoneSet`, `recordValue`, `recordsSetOn`, `trackedMilestones`, `milestonesOn`;
    - from `@ccip-dev/core/broadcasts`: `BroadcastTarget`, `broadcastKey`, `broadcastCardPath`, `parseBroadcastPath`, `dayTotalsFacts`, `weekTotalsFacts`, `recordValueText`, `recordDriver`, `RECORD_TOTAL`, `allTimeTotal`, `isDepositTransfer`, `reserveDepositFacts`.
  - Task 5: `Leader`, `DayLeaders`, `DayLeadersFile`, `store.dailyLeaders`, `TopOrder` with `messages`, `leader`, `dayLeaderEntries`, `weekFeeChains`, `lastCompleteMonday`, `publishDayLeaders`.
  - Task 6: `historyDays`, `largestFeeEntries`, `LARGEST_FEES_LIMIT`, `weekLeaderRows`, `store.tokenGroupIds`, `Player`, `Tagger`, `createTagger`, the facts types, `loadFactsSource` and the five fact builders.
  - Task 7: `xLength`, `fitLines`, `noLinks`, `composeCopy`, `Copy`.
  - Task 8: `sendTelegramPhoto`, `Broadcast`, `BroadcastOutput`, `OutputSet`, `broadcastMode`, `telegramOutputs`, `runBroadcasts`, `broadcastSafely`, `broadcastHourly`, `ReserveBody`, `store.markMeta`.
  - Task 9: `CardSize`, `CARD_SIZE`, `renderPng`, `CARD_FONTS`, `glyph`, `withArrows`, `MISSING_GLYPHS`, `orbitSky`, `skyNodes`, `skySvg`, `svgDataUri`, `coinIcon`, `LETTERMARK_BG`, `lettermarkLetter`.
  - Task 10: `BROADCAST_SIZE`, `broadcastFrame` and its helpers, `ctaFor`, `RECORDS_CTA`, `RESERVE_CTA`, `broadcastTree`, `BroadcastInputs`, `skyFor`, `namesOf`, `iconsFor`, `RECORD_TITLES`, and the test fixtures.
- **Checked on 2026-10-11:**
  - The renderer probe (`@cf-wasm/og` 0.5.0, in node and in this repo's workerd test pool, deleted afterwards) gave these results:
    - gradients, `feGaussianBlur`, dashed strokes and clip paths draw inside an SVG image;
    - nested data-URI images (SVG and PNG) and `<text>` do not;
    - a straight stroke with an `objectBoundingBox` gradient draws nothing;
    - a Satori `borderRadius` + `overflow: hidden` box clips a 125% icon to a circle;
    - Inter's latin subset draws `→ ▲ ▼ ★ ▶ ≈` as "NO GLYPH" boxes;
    - JetBrains Mono 800 renders;
    - a bare sky probe takes 0.4–0.8 s.
  - Each task's code was prototyped outside the repo from this plan's own code blocks, and its tests run against it in node; all passed:
    - Task 4's core functions with the existing `reserveStats` suite (56 tests), typechecked;
    - Task 7's copy (22 tests), whose expected texts are that code's output;
    - Tasks 9–11's sky, frame and five cards (27 tests).
  - The prototype cards were rendered from the Task 10–11 fixtures through `@cf-wasm/og` and checked by eye against the mockups. That pass caught two problems, now fixed in the plan: Satori ignores `textAlign` on coin labels, and the weekly strip overlapped when the insight and the call to action were both long.
  - twitter-text's `config/v3.json` and `parseTweet` were read from GitHub.
  - `reserveStats` counts a deposit as `direction === 'in'` and at least 1,000 LINK. `insertReserveTransfers` (`INSERT OR IGNORE`) is where a new transfer first appears. `publishRegistryFiles` publishes `reserve.json` in the same hourly run.
  - Date and float arithmetic in the tests was checked in node: Mar 1 to Jul 9 2026 is 130 days, and the next-million ETA is 2026-11-28.
