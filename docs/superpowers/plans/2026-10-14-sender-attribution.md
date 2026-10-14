# Sender Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Credit CCIP activity to the projects behind it: rank senders by identity (a verified project, or an address across chains), publish projects and label coverage, give projects their own pages and posts, and teach the weekly candidates job to find the next xStocks.

**Architecture:** Identity resolution is one pure module, `packages/core/src/senders.ts`, fed by `worker/src/generated/labels.json` (now carrying each project's `slug` and `spread`) and the chains table. Storage is unchanged except two migrations (`daily_totals.data_messages`, and `arrivals` kind `sender`). The Worker ranks identities at publish time from two store queries (every labeled row, plus the busiest unlabeled addresses) and writes the new fields beside the old ones, so the site and the bot keep working whichever deploys first. The site then reads the identity fields, falls back to the old ones, and adds `/projects/`, `/projects/<slug>/`, "Suggest a label" and a coverage line.

**Tech Stack:** TypeScript, a pnpm workspace, Cloudflare Workers (D1, R2, crons), Astro 7 with React 19 islands, Satori/resvg cards (`@cf-wasm/og`), zod 4, smol-toml, Vitest 4 (the workerd pool on real D1 and R2 for `worker/`; Node for `packages/core`, `site` and `scripts`, with `node:sqlite` for script SQL).

**Spec:** `docs/superpowers/specs/2026-10-14-sender-attribution-design.md` (owner-approved 2026-10-14). The code survey behind this plan is `.superpowers/sdd/2026-10-14-sender-attribution/code-map.md`; trust the code over it.

## Global Constraints

- **Green after every task:** `pnpm test` and `pnpm typecheck` at the root. A task that touches `site/src/` also runs `pnpm --filter @ccip-dev/site build` and it must pass (it builds against the production data at `data.ccip.dev`, so it must pass both before and after the Worker publishes the new fields).
- **Never** run wrangler with `--remote`, deploy, or push. The controller pushes `main` at the checkpoints marked below; the deploy workflow applies migrations (`wrangler d1 migrations apply --remote`) before it deploys the Worker.
- **Identity keys:** `project:<slug>` for a verified project (slug = the label file's name, e.g. `xstocks`) and `address:<address>` for any other sender (EVM lowercased, every other family as-is). A key from a file published before identities is `<selector>:<address>` and must still render everywhere (`parseSenderKey` returns `{ kind: 'legacy' }` for it).
- **Label spread:** an EVM address with no label on its chain takes the label of the same address on another EVM chain, marked `inferred`. Never across families, never from or to Solana or any non-EVM chain, never for a project whose file sets `spread = false`, and never for an address two projects label.
- **Compatibility (the Worker ships first; old keys still render):**
  - `top/sender.json` keeps `windows` and `by_fees` exactly as today (per-chain keys and `label`). Identities go in two new keys, `identities` and `identities_by_fees`. **Ruling:** the spec's "entries become identities" lands in these new keys, because the old site renders `windows` keys it doesn't understand with a chain name of "project". A later change can drop the old keys once both deploys are out.
  - `day-leaders.json` `days[].sender` and `today.json` `top.sender` become identity entries in place: the old card already prints `label ?? shortAddress(key after the first ':')`, which reads `address:0x…` correctly, and nothing on the old site reads `today.json` `top.sender`.
  - Every new field in `packages/core/src/public.ts` is `.optional()`, so cached and old files still parse.
  - **Ruling:** `schema_version` stays `1`. Old site builds and the card Worker parse it with `z.literal(1)`, so a bump would break them; the additive change is documented in the methodology instead (Task 16).
- **Mentions policy (owner decision 2026-10-12):** the daily and weekly reports tag nobody; their top sender is a plain name. Only a moment's subject is tagged, with `@x`, and only when it is a verified project with a handle. **Ruling:** an `inferred` identity is never tagged (its label was carried over, not verified for that address). The existing test "tags nobody for a project" must keep passing.
- **X copy:** every X text still ends through `oneCashtag(...)` and fits `X_MAX` (280) through `fitLines`.
- **Exact copy:**
  - Daily/weekly X: `Top sender: xStocks · 319 messages (20%)`.
  - Daily Telegram: `Top sender: xStocks · 319 messages, 20% of the day's`; weekly: `…, 20% of the week's`.
  - Daily card cell: `319 msgs · 20%`, and a muted line `62% data`.
  - Status page: `Labeled senders: 81% of messages, 94% of value (last 7 days)` and a link to `/projects/`.
- **Migrations:** `worker/migrations/0006_data_messages.sql` and `0007_sender_arrivals.sql`, in the style of `0005`. **Ruling:** the `data_messages` backfill is the single statement `UPDATE daily_totals SET data_messages = messages - token_messages;`. Every `daily_totals` row was written by `rollupDay`, whose `token_messages` counts the same day's messages with `token_count > 0`, so this equals counting `token_count = 0` messages. It reads about 1,200 rows instead of about 1.6 million, which keeps the deploy's migration far inside D1's statement limits. Task 5 tests the equality.
- **D1 queries:** address lists are bound as one JSON parameter and read with `json_each(?)` (D1 caps a statement at 100 bound parameters). Labeled rows are summed with no `LIMIT`, so no project is cut before its chains merge.
- **Reuse, don't rebuild:** `buildDataIfPublished` for `projects.json`; the `/replay/[slug]/` `getStaticPaths` pattern; the moment pipeline (`BUDGETED_MOMENTS`, `broadcastKey`, `broadcastCardPath`, `parseBroadcastPath`, `dueMoments`, `momentFacts`, `composeMomentCopy`, `broadcastTree`); `oneCashtag`.
- **Further rulings** (each is restated in the task it shapes):
  - `today.json` `top.sender` ranks identities by value, as its lane and token lists do.
  - Address rows link to the CCIP Explorer's address page, `https://ccip.chain.link/address/<address>` (checked: it answers 200 for an EVM and a Solana address, so one URL serves every family).
  - A project page's "source line" is the label file's first `# Source:` comment, beside a link to the label file.
  - A project's first day is the earliest message from any of its addresses on any chain.
  - For a sender arrival, `arrivals.first_seen` is the day it entered the top 10 (`<day>T00:00:00.000Z`).
  - `today.json` `arrivals` leaves sender rows out, so its list keeps meaning chains, tokens and lanes.
  - The weekly project spotlight picks the largest gain in messages (not the largest ratio), with 50 or more this week and more than last week. It has no repeat-skip.
  - The daily card's "62% data" is a muted line under the stats, because the 2×2 stats grid is full.
  - The day page had no top sender; it gains a "Top sender" line, which is where its "Suggest a label" link goes.
  - New moment kinds are `newcomer` (key `broadcast:newcomer:<identity>`, posted the day after) and `project` (key `broadcast:project:<monday>`, posted on the Wednesday after the week).
  - A newcomer whose identity key can't form a card path (an address holding `:`, `/`, `_` or `-`) is never planned.
  - A candidate draft is named after its busiest chain, so a single-chain candidate keeps the file name it had.
- **Test style:** `// #given`, `// #when`, `// #then` comments, one `expect` per test where possible, test names that describe the behavior. Worker tests run in the workerd pool on real D1 and R2 (`worker/test/helpers.ts`); core, site and script tests run on Node.
- **Commits:**
  - Stage explicit paths only. Never `git add -A`, `git add .` or `git commit -a`. Never stage `.superpowers/` or `.DS_Store`.
  - Every commit message ends with a `Co-Authored-By:` trailer naming your model.
- **Comments:** explain why, never what (the owner's comment policy). No commented-out code, no TODOs.

## Review Focus

1. **A cached, pre-identity file** (`<selector>:<address>` keys, no `share_pct`, no `identities`, no `data_messages`, no `label_coverage`, no `arrivals.senders`) must still render on the new site and in every card, with no "project" or "address" text leaking out of a key. (The Discord bot reads none of the changed fields.) Tests: Task 4 (daily card with an old `day-leaders.json`), Task 6 (history without `data_messages`), Task 9 (Top › Senders from the old `top-sender.json` fixture), Task 10 (status without coverage), Task 12 (`dueMoments` on a `moments.json` without `senders`).
2. **Ambiguous spread:** the same EVM address labeled by two projects on two chains, a project with `spread = false`, and a chain missing from the chains table must each resolve to the address, never to a guess. Tests: Task 1.
3. **Zero or missing totals** (a day, week or window with no messages, value or fees) give `null` shares and coverage, never `NaN`, `Infinity` or a division by zero in a file, a post or a card. Tests: Task 1 (`sharePct`), Task 10 (coverage of an empty window), Task 13 (a spotlight project with no messages the week before).
4. **An identity key that can't be a card path** (a non-EVM address holding `:` or `/`) must never be planned as a moment, or its card would 404 and the hourly run would alert forever. Tests: Task 12.
5. **`projects.json` not yet published**, or a project with no activity in the window: the site build passes, `/projects/` says when pages appear, and an idle project still gets a page with zeros. Tests: Task 7 (an idle project in the file) and Task 8 (`projectPaths(null)`, and the build).

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/core/src/labels.ts` | 1, 7 | `spread`, slugs and sources in the registry; `slug`/`spread` in the label index; the project registry |
| `packages/core/src/senders.ts` (new) | 1, 10, 11, 13 | Identity resolution, merging and ranking; shares; coverage; newcomer picks; kind phrases |
| `packages/core/src/testing.ts` | 1 | Ink, X Layer and HyperEVM networks; the 2026-10-13 xStocks fixture |
| `packages/core/src/public.ts` | 3, 5, 7, 10, 11, 13 | Identity fields, `data_messages`, `projects.json`, `label_coverage`, sender arrivals, project spotlight |
| `packages/core/src/rollup.ts`, `sql.ts`, `types.ts` | 5 | `data_messages` in the rollup and the upsert |
| `packages/core/src/broadcasts.ts`, `moments.ts` | 6, 12, 13 | `dataSharePct`; the `newcomer` and `project` targets; the project spotlight pick |
| `scripts/build-labels.ts` | 1, 7 | Writes `labels.json` (with slugs) and `label-projects.json` |
| `worker/migrations/0006_data_messages.sql`, `0007_sender_arrivals.sql` (new) | 5, 11 | The two migrations |
| `worker/src/store.ts` | 2, 5, 7, 11 | Identity queries, `data_messages`, project lanes, sender arrivals |
| `worker/src/senders.ts` (new) | 3, 10, 11 | The sender book, identity rankings, coverage, newcomer recording and arrivals |
| `worker/src/publish.ts` | 3, 7, 10 | Identity entries in every file; `projects.json`; coverage in `status.json` |
| `worker/src/projects.ts` (new) | 7 | Builds `projects.json` |
| `worker/src/labels.ts`, `context.ts` | 7 | The bundled project registry in the run context |
| `worker/src/jobs/finalize.ts` | 11 | Records new senders as each day is finalized |
| `worker/src/moments.ts` | 11, 13 | Sender arrivals and the weekly project spotlight in `moments.json` |
| `worker/src/broadcasts/*.ts` | 3, 4, 12, 13 | Facts, copy and planning for the share, `newcomer` and `project` |
| `site/worker/cards/broadcast-cards.ts`, `project-cards.ts` (new), `content.ts`, `cta.ts` | 4, 6, 8, 9, 12, 13 | Card cells, the data line, the project card and the two moment cards |
| `site/worker/og.ts`, `site/src/lib/card-paths.ts` | 8 | `/og/project/<slug>.png` |
| `site/src/lib/projects.ts`, `senders.ts` (new) | 8, 9 | View helpers for projects and sender rows |
| `site/src/pages/projects/index.astro`, `[slug].astro` (new) | 8 | Project pages |
| `site/src/pages/top/[dim]/[window]/[...order].astro`, `day/[day].astro`, `history/[range].astro` | 6, 9 | Sender rows, the day's top sender, the data tile |
| `site/src/components/StatusPanel.tsx`, `HistoryCharts.tsx`, `Header.astro`, `Footer.astro` | 6, 8, 10 | Coverage line, data chart, menu links |
| `.github/ISSUE_TEMPLATE/label.yml` (new) | 9 | The "Suggest a label" issue form |
| `scripts/label-candidates.ts` | 14, 15 | The candidates job overhaul |
| `docs/runbook.md`, `docs/methodology.md`, `site/src/lib/metric-anchors.ts` | 16 | Docs |

---

### Task 1: Sender identity in core, and slugs in the label build

**Files:**
- Modify: `packages/core/src/labels.ts`
- Create: `packages/core/src/senders.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`
- Modify: `packages/core/src/testing.ts`
- Modify: `worker/test/publish.test.ts`, `worker/test/broadcast-facts.test.ts` (label fixtures gain `slug`)
- Regenerate: `worker/src/generated/labels.json`
- Test: `packages/core/test/labels.test.ts`, `packages/core/test/senders.test.ts`

**Interfaces:**
- **Produces** (from `@ccip-dev/core`, and `senders.ts` also as `@ccip-dev/core/senders`):
  - `LabelProject` gains `spread: boolean` (default `true`).
  - `Label` = `{ name: string; x?: string; kind: LabelKind; slug: string; spread?: false }`.
  - `type RegistryProject = LabelProject & { slug: string; source: string | null }`; `validateRegistry(files, chainNames): { projects: RegistryProject[]; errors: string[] }`; `projectSlug(file: string): string`; `buildLabelIndex(projects: readonly RegistryProject[]): LabelIndex`.
  - `type LabelKind`, `interface SenderChain { name; family }`, `type SenderChains = ReadonlyMap<string, SenderChain>`.
  - `interface SenderIdentity { key: string; project: Label | null; inferred: boolean }`, `type IdentityResolver = (selector: string, address: string) => SenderIdentity`, `identityResolver(labels: LabelIndex, chains: SenderChains): IdentityResolver`.
  - `projectKey(slug)`, `addressKey(address)`, `senderAddress(address)`, `senderKeyAddress(key)`, `parseSenderKey(key): ParsedSenderKey`, `labeledAddresses(labels): string[]`, `projectAddresses(labels, slug): string[]`.
  - `interface SenderRow { key; messages; usd_value; fee_usd: number | null }`, `interface IdentityTotals { key; label; slug; x; kind; inferred; messages; usd_value; fee_usd; chains: string[]; addresses: number; keys: string[] }`, `mergeIdentities(rows, resolve): IdentityTotals[]`.
  - `type IdentityOrder = 'value' | 'fees' | 'messages'`, `rankIdentities(identities, order, limit): IdentityTotals[]`, `sharePct(part: number, total: number | null): number | null`.
  - From `@ccip-dev/core/testing`: `NETWORKS.ink`, `NETWORKS.xlayer`, `NETWORKS.hyperliquid`; `XSTOCKS_DAY`, `XBRIDGE_EVM`, `XBRIDGE_SOLANA`, `XBRIDGE_PROGRAM`, `BASE_SENDER_1`, `BASE_SENDER_2`, `XSTOCKS_LABEL`, `XSTOCKS_LABELS`, `XSTOCKS_CHAINS`, `XSTOCKS_SENDER_ROWS`, `XSTOCKS_TOTALS`, `xstocksBreakdown(day?)`.

- [ ] **Step 1: Write the failing label tests**

In `packages/core/test/labels.test.ts`, change the expectation in `'indexes only verified projects under a lowercase key that matches stored message addresses'` to:

```ts
    expect(index).toEqual({
      'ethereum-mainnet:0x514910771af9ca656af840dff83e8264ecf986ca': { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol', slug: 'maple' },
    });
```

and append:

```ts
describe('slugs, sources and spread', () => {
  const XBRIDGE = '0x9ec0e4a4c411493773e01e2abf4d42395788846b';
  const xstocks = (extra = '') =>
    `name = "xStocks"\nx = "xStocksFi"\nkind = "protocol"\nverified = true\n${extra}\n` +
    `# Source: https://api.xstocks.fi/api/v2/public/bridges (the xBridge)\n[[addresses]]\nchain = "ethereum-mainnet"\naddress = "${XBRIDGE}"\n`;

  it('names a project by its file, keeps its first source line, and spreads by default', () => {
    // #when
    const { projects } = validateRegistry([{ file: 'labels/projects/xstocks.toml', text: xstocks() }], chains);
    // #then
    expect(projects.map((p) => [p.slug, p.source, p.spread])).toEqual([['xstocks', 'https://api.xstocks.fi/api/v2/public/bridges (the xBridge)', true]]);
  });

  it('refuses a verified project whose file name is not a slug', () => {
    // #when
    const { errors } = validateRegistry([{ file: 'labels/projects/xStocks.toml', text: xstocks() }], chains);
    // #then
    expect(errors).toEqual(['labels/projects/xStocks.toml: a verified project needs a file name of lowercase letters, digits and dashes']);
  });

  it('indexes the slug, and writes spread = false only for a project that turns spreading off', () => {
    // #given
    const { projects } = validateRegistry([{ file: 'xstocks.toml', text: xstocks('spread = false') }, { file: 'maple.toml', text: project(LINK) }], chains);
    // #when
    const index = buildLabelIndex(projects);
    // #then
    expect(index).toEqual({
      [`ethereum-mainnet:${XBRIDGE}`]: { name: 'xStocks', x: 'xStocksFi', kind: 'protocol', slug: 'xstocks', spread: false },
      [`ethereum-mainnet:${LINK.toLowerCase()}`]: { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol', slug: 'maple' },
    });
  });
});
```

- [ ] **Step 2: Run the label tests to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/labels.test.ts`
Expected: FAIL (no `slug`, `source` or `spread` on the projects; the index lacks `slug`).

- [ ] **Step 3: Add `spread`, slugs and sources to the registry**

In `packages/core/src/labels.ts`:

1. In `LabelProject`, after `verified: z.boolean(),`, add:

```ts
  /** false keeps the project's EVM addresses from being credited to it on chains its file does not list. */
  spread: z.boolean().default(true),
```

2. Replace the `Label` interface with:

```ts
export interface Label {
  name: string;
  x?: string;
  kind: LabelProject['kind'];
  /** The label file's name: the project's identity is `project:<slug>` and its page `/projects/<slug>/`. */
  slug: string;
  /** Present, as false, only for a project that turns label spread off. */
  spread?: false;
}

/** A parsed label file, with the slug its file name gives it and the first "# Source:" line it cites. */
export type RegistryProject = LabelProject & { slug: string; source: string | null };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_LINE = /^#\s*Source:\s*(.+)$/m;

export function projectSlug(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1).replace(/\.toml$/, '');
}
```

3. In `validateRegistry`, change the return type to `{ projects: RegistryProject[]; errors: string[] }`, declare `const projects: RegistryProject[] = [];`, and replace the final `projects.push(result.data);` with:

```ts
    const slug = projectSlug(file);
    if (result.data.verified && !SLUG.test(slug)) errors.push(`${file}: a verified project needs a file name of lowercase letters, digits and dashes`);
    projects.push({ ...result.data, slug, source: SOURCE_LINE.exec(text)?.[1]?.trim() ?? null });
```

4. Replace `buildLabelIndex` with:

```ts
export function buildLabelIndex(projects: readonly RegistryProject[]): LabelIndex {
  const index: LabelIndex = {};
  for (const p of projects) {
    if (!p.verified) continue;
    const label: Label = { name: p.name, ...(p.x ? { x: p.x } : {}), kind: p.kind, slug: p.slug, ...(p.spread ? {} : { spread: false as const }) };
    for (const { chain, address } of p.addresses) index[labelKey(chain, address)] = label;
  }
  return index;
}
```

- [ ] **Step 4: Run the label tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/labels.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the networks and the xStocks fixture**

In `packages/core/src/testing.ts`, add to `NETWORKS` after `solana`:

```ts
  ink: net('ethereum-mainnet-ink-1', 'Ink Mainnet', '3461204551265785888', '57073'),
  xlayer: net('ethereum-mainnet-xlayer-1', 'X Layer Mainnet', '3016212468291539606', '196'),
  hyperliquid: net('hyperliquid-mainnet', 'HyperEVM Mainnet', '2442541497099098535', '999'),
```

Add to the imports at the top: `import type { Label, LabelIndex } from './labels';`, `import type { SenderChain, SenderRow } from './senders';`, and `DailyBreakdown, DailyTotals` to the existing `import type { PriceInfo } from './types';` (making it `import type { DailyBreakdown, DailyTotals, PriceInfo } from './types';`). Then append:

```ts
/** The day CCIPMetrics named xStocks the top sender and our daily named one of its addresses (2026-10-13). */
export const XSTOCKS_DAY = '2026-10-13';
/** xStocks's xBridge: one address on every EVM chain it bridges. */
export const XBRIDGE_EVM = '0x9ec0e4a4c411493773e01e2abf4d42395788846b';
/** The account xStocks's Solana xBridge program sends from: system-owned, so the candidates job used to skip it as a wallet. */
export const XBRIDGE_SOLANA = 'A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u';
/** xStocks's Solana xBridge program, which A8JP's sends invoke. */
export const XBRIDGE_PROGRAM = 'F2ZYgyh8YDG6rHo9F1T8Aw4WoTyy8eYN3GgM2LaPKcZN';
/** The day's next busiest senders, both unlabeled, on Base. */
export const BASE_SENDER_1 = '0x671be08d6d3c826c2f6d76915f1b54af484d4077';
export const BASE_SENDER_2 = '0xd791156a50c586c4e8b313d35bc8017b2556dfcc';

export const XSTOCKS_LABEL: Label = { name: 'xStocks', x: 'xStocksFi', kind: 'protocol', slug: 'xstocks' };

const XBRIDGE_CHAINS = [
  'ethereum-mainnet', 'ethereum-mainnet-arbitrum-1', 'ethereum-mainnet-optimism-1', 'ethereum-mainnet-mantle-1', 'ethereum-mainnet-ink-1',
  'ethereum-mainnet-xlayer-1', 'binance_smart_chain-mainnet', 'hyperliquid-mainnet', 'monad-mainnet',
];

/** labels.json's xStocks entries, as labels/projects/xstocks.toml builds them. */
export const XSTOCKS_LABELS: LabelIndex = Object.fromEntries([
  ...XBRIDGE_CHAINS.map((chain) => [`${chain}:${XBRIDGE_EVM}`, XSTOCKS_LABEL] as const),
  [`solana-mainnet:${XBRIDGE_SOLANA}`, XSTOCKS_LABEL] as const,
]);

/** The day's source chains, by selector. */
export const XSTOCKS_CHAINS: ReadonlyMap<string, SenderChain> = new Map(
  [NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc, NETWORKS.solana, NETWORKS.ink, NETWORKS.xlayer, NETWORKS.hyperliquid].map((n) => [
    n.chainSelector,
    { name: n.name, family: n.chainFamily },
  ]),
);

const senderRow = (network: NetworkInfo, address: string, messages: number, usd = 0): SenderRow => ({
  key: `${network.chainSelector}:${address}`,
  messages,
  usd_value: usd,
  fee_usd: messages / 4,
});

/**
 * The day's sender rows as daily_breakdown holds them: xStocks's 319 messages (81 Ink, 58 X Layer, 22 BNB Chain,
 * 6 Ethereum, 3 HyperEVM and 149 Solana), the two Base senders behind it (76 and 68), and 23 smaller Base senders
 * (22 of 50 and one of 6), 1,569 in all. Fees are a quarter of a dollar a message, so every sum is exact.
 */
export const XSTOCKS_SENDER_ROWS: SenderRow[] = [
  senderRow(NETWORKS.ink, XBRIDGE_EVM, 81),
  senderRow(NETWORKS.xlayer, XBRIDGE_EVM, 58),
  senderRow(NETWORKS.bsc, XBRIDGE_EVM, 22),
  senderRow(NETWORKS.ethereum, XBRIDGE_EVM, 6),
  senderRow(NETWORKS.hyperliquid, XBRIDGE_EVM, 3),
  senderRow(NETWORKS.solana, XBRIDGE_SOLANA, 149),
  senderRow(NETWORKS.base, BASE_SENDER_1, 76, 250_000),
  senderRow(NETWORKS.base, BASE_SENDER_2, 68),
  ...Array.from({ length: 22 }, (_, i) => senderRow(NETWORKS.base, `0x${String(i + 1).padStart(40, '0')}`, 50)),
  senderRow(NETWORKS.base, `0x${'9'.repeat(40)}`, 6),
];

export const XSTOCKS_TOTALS: DailyTotals = {
  day: XSTOCKS_DAY, messages: 1_569, token_messages: 0, usd_value: 250_000, fee_usd: 392.25, unique_senders: 31, median_delivery_s: null, unpriced_messages: 0,
};

export const xstocksBreakdown = (day = XSTOCKS_DAY): DailyBreakdown[] => XSTOCKS_SENDER_ROWS.map((r) => ({ day, dim: 'sender', ...r }));
```

- [ ] **Step 6: Write the failing identity tests**

Create `packages/core/test/senders.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Label, LabelIndex } from '../src/labels';
import { identityResolver, labeledAddresses, mergeIdentities, parseSenderKey, projectAddresses, rankIdentities, sharePct, type SenderChains } from '../src/senders';
import {
  BASE_SENDER_1, BASE_SENDER_2, NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_CHAINS, XSTOCKS_LABEL, XSTOCKS_LABELS, XSTOCKS_SENDER_ROWS, XSTOCKS_TOTALS,
} from '../src/testing';

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const SOL = NETWORKS.solana.chainSelector;
const INK = NETWORKS.ink.chainSelector;
const XLAYER = NETWORKS.xlayer.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const HYPER = NETWORKS.hyperliquid.chainSelector;
const APTOS = '4741433654826277614';
const SVM_L2 = '9999999999999999999';
const ADDR = '0x7af7632562b6063e52788607ad56f7a60f57ce09';
const SHOUTED = `0x${ADDR.slice(2).toUpperCase()}`;
const MAPLE: Label = { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol', slug: 'maple-finance' };
const CHAINS: SenderChains = new Map([
  [ETH, { name: 'ethereum-mainnet', family: 'EVM' }],
  [BASE, { name: 'ethereum-mainnet-base-1', family: 'EVM' }],
  [SOL, { name: 'solana-mainnet', family: 'SVM' }],
  [APTOS, { name: 'aptos-mainnet', family: 'APTOS' }],
  [SVM_L2, { name: 'svm-l2-mainnet', family: 'SVM' }],
]);
const ON_ETHEREUM: LabelIndex = { [`ethereum-mainnet:${ADDR}`]: MAPLE };
const row = (selector: string, address: string, messages: number, usd_value = 0, fee_usd: number | null = null) => ({ key: `${selector}:${address}`, messages, usd_value, fee_usd });

describe('sender identity', () => {
  it('is the project a verified label names on the chain', () => {
    // #when
    const identity = identityResolver(ON_ETHEREUM, CHAINS)(ETH, ADDR);
    // #then
    expect(identity).toEqual({ key: 'project:maple-finance', project: MAPLE, inferred: false });
  });

  it('spreads a label to the same EVM address on another EVM chain, in any letter case, marked inferred', () => {
    // #when
    const identity = identityResolver(ON_ETHEREUM, CHAINS)(BASE, SHOUTED);
    // #then
    expect(identity).toEqual({ key: 'project:maple-finance', project: MAPLE, inferred: true });
  });

  it('never spreads to a chain of another family', () => {
    // #when
    const identity = identityResolver(ON_ETHEREUM, CHAINS)(APTOS, ADDR);
    // #then
    expect(identity).toEqual({ key: `address:${ADDR}`, project: null, inferred: false });
  });

  it('never spreads a Solana label, even to another SVM chain', () => {
    // #when
    const identity = identityResolver({ [`solana-mainnet:${XBRIDGE_SOLANA}`]: XSTOCKS_LABEL }, CHAINS)(SVM_L2, XBRIDGE_SOLANA);
    // #then
    expect(identity.key).toBe(`address:${XBRIDGE_SOLANA}`);
  });

  it('does not spread a project whose file sets spread = false', () => {
    // #when
    const identity = identityResolver({ [`ethereum-mainnet:${ADDR}`]: { ...MAPLE, spread: false } }, CHAINS)(BASE, ADDR);
    // #then
    expect(identity.key).toBe(`address:${ADDR}`);
  });

  it('does not spread an address two projects label on different chains', () => {
    // #given Maple on Ethereum and xStocks on Base claim the same address
    const labels: LabelIndex = { [`ethereum-mainnet:${ADDR}`]: MAPLE, [`ethereum-mainnet-base-1:${ADDR}`]: XSTOCKS_LABEL };
    const resolve = identityResolver(labels, new Map([...CHAINS, ['3', { name: 'ethereum-mainnet-arbitrum-1', family: 'EVM' }]]));
    // #when
    const keys = [resolve(ETH, ADDR).key, resolve(BASE, ADDR).key, resolve('3', ADDR).key];
    // #then
    expect(keys).toEqual(['project:maple-finance', 'project:xstocks', `address:${ADDR}`]);
  });

  it('falls back to the address: one identity across chains, lowercased for EVM, as-is for Solana', () => {
    // #given
    const resolve = identityResolver({}, CHAINS);
    // #when
    const keys = [resolve(ETH, SHOUTED).key, resolve(BASE, ADDR).key, resolve(SOL, XBRIDGE_SOLANA).key];
    // #then
    expect(keys).toEqual([`address:${ADDR}`, `address:${ADDR}`, `address:${XBRIDGE_SOLANA}`]);
  });

  it('gives a chain missing from the chains table the address, with no label and no spread', () => {
    // #when
    const identity = identityResolver(ON_ETHEREUM, CHAINS)('424242', ADDR);
    // #then
    expect(identity.key).toBe(`address:${ADDR}`);
  });
});

describe('ranking by identity', () => {
  const resolve = identityResolver(XSTOCKS_LABELS, XSTOCKS_CHAINS);

  it("credits xStocks with 319 of 2026-10-13's 1,569 messages (20.3%), across six chains and two addresses", () => {
    // #when
    const [top] = rankIdentities(mergeIdentities(XSTOCKS_SENDER_ROWS, resolve), 'messages', 1);
    // #then
    expect({ ...top, share: sharePct(top!.messages, XSTOCKS_TOTALS.messages) }).toEqual({
      key: 'project:xstocks', label: 'xStocks', slug: 'xstocks', x: 'xStocksFi', kind: 'protocol', inferred: false,
      messages: 319, usd_value: 0, fee_usd: 79.75,
      chains: [SOL, INK, XLAYER, BSC, ETH, HYPER],
      addresses: 2,
      keys: [`${INK}:${XBRIDGE_EVM}`, `${XLAYER}:${XBRIDGE_EVM}`, `${BSC}:${XBRIDGE_EVM}`, `${ETH}:${XBRIDGE_EVM}`, `${HYPER}:${XBRIDGE_EVM}`, `${SOL}:${XBRIDGE_SOLANA}`],
      share: 20.3,
    });
  });

  it('ranks the unlabeled senders behind it by their own messages', () => {
    // #when
    const ranked = rankIdentities(mergeIdentities(XSTOCKS_SENDER_ROWS, resolve), 'messages', 3);
    // #then
    expect(ranked.map((i) => [i.key, i.messages])).toEqual([['project:xstocks', 319], [`address:${BASE_SENDER_1}`, 76], [`address:${BASE_SENDER_2}`, 68]]);
  });

  it("sums one key's rows from several days, and lists the key once", () => {
    // #when
    const [merged] = mergeIdentities([row(BASE, ADDR, 5), row(BASE, ADDR, 3)], identityResolver({}, CHAINS));
    // #then
    expect([merged!.messages, merged!.keys]).toEqual([8, [`${BASE}:${ADDR}`]]);
  });

  it('marks a project inferred only when every one of its rows came from a spread label', () => {
    // #given
    const resolveMaple = identityResolver(ON_ETHEREUM, CHAINS);
    // #when
    const both = mergeIdentities([row(ETH, ADDR, 5), row(BASE, ADDR, 3)], resolveMaple)[0]!.inferred;
    const spreadOnly = mergeIdentities([row(BASE, ADDR, 3)], resolveMaple)[0]!.inferred;
    // #then
    expect([both, spreadOnly]).toEqual([false, true]);
  });

  it('ranks by value, and by fees leaves out an identity with no fee data', () => {
    // #given A moved the most value, B paid the most fees, C has no fee data
    const merged = mergeIdentities([row(BASE, '0xa', 1, 900, 1), row(BASE, '0xb', 1, 100, 9), row(BASE, '0xc', 9, 500, null)], identityResolver({}, CHAINS));
    // #when
    const ranked = [rankIdentities(merged, 'value', 3).map((i) => i.key), rankIdentities(merged, 'fees', 3).map((i) => i.key)];
    // #then
    expect(ranked).toEqual([['address:0xa', 'address:0xc', 'address:0xb'], ['address:0xb', 'address:0xa']]);
  });
});

describe('sharePct', () => {
  it('rounds to one decimal, and is null without a total rather than NaN or Infinity', () => {
    // #then
    expect([sharePct(319, 1_569), sharePct(0, 10), sharePct(5, 0), sharePct(5, null)]).toEqual([20.3, 0, null, null]);
  });
});

describe('sender keys', () => {
  it.each([
    ['project:xstocks', { kind: 'project', slug: 'xstocks' }],
    [`address:${ADDR}`, { kind: 'address', address: ADDR }],
    [`${ETH}:${ADDR}`, { kind: 'legacy', chain: ETH, address: ADDR }],
  ])('reads %s', (key, parsed) => {
    // #then
    expect(parseSenderKey(key)).toEqual(parsed);
  });

  it('lists each labeled address once, and one project’s addresses', () => {
    // #then
    expect([labeledAddresses(XSTOCKS_LABELS), projectAddresses({ ...XSTOCKS_LABELS, ...ON_ETHEREUM }, 'xstocks')]).toEqual([
      [XBRIDGE_EVM, XBRIDGE_SOLANA],
      [XBRIDGE_EVM, XBRIDGE_SOLANA],
    ]);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/senders.test.ts`
Expected: FAIL, because `../src/senders` does not exist.

- [ ] **Step 8: Write `senders.ts`**

Create `packages/core/src/senders.ts`:

```ts
import { isAddressShape } from './chain-map';
import type { Label, LabelIndex, LabelProject } from './labels';

export type LabelKind = LabelProject['kind'];

/** A chain as the chains table holds it: its CCIP name, as label files write it, and its family. */
export interface SenderChain {
  name: string;
  family: string;
}

/** Chains by selector. */
export type SenderChains = ReadonlyMap<string, SenderChain>;

/**
 * Who sent a message: the verified project behind its (chain, address), or else the address itself across chains.
 * Every ranking of senders goes through this, so the site, the posts and the cards credit activity the same way.
 */
export interface SenderIdentity {
  /** `project:<slug>` for a verified project, `address:<address>` for any other sender. */
  key: string;
  project: Label | null;
  /** The project's label names this address on another EVM chain, not on this one. */
  inferred: boolean;
}

export type IdentityResolver = (selector: string, address: string) => SenderIdentity;

const PROJECT_PREFIX = 'project:';
const ADDRESS_PREFIX = 'address:';

export const projectKey = (slug: string): string => `${PROJECT_PREFIX}${slug}`;
export const addressKey = (address: string): string => `${ADDRESS_PREFIX}${address}`;

/** As messages store senders: EVM lowercased, any other address as it is. */
export function senderAddress(address: string): string {
  return isAddressShape('EVM', address) ? address.toLowerCase() : address;
}

/** What follows the first colon: the address of a `<selector>:<address>` or `address:` key, the slug of a `project:` key. */
export function senderKeyAddress(key: string): string {
  return key.slice(key.indexOf(':') + 1);
}

export type ParsedSenderKey =
  | { kind: 'project'; slug: string }
  | { kind: 'address'; address: string }
  | { kind: 'legacy'; chain: string; address: string };

/** An identity key, or a `<selector>:<address>` key from a file published before identities. */
export function parseSenderKey(key: string): ParsedSenderKey {
  if (key.startsWith(PROJECT_PREFIX)) return { kind: 'project', slug: key.slice(PROJECT_PREFIX.length) };
  if (key.startsWith(ADDRESS_PREFIX)) return { kind: 'address', address: key.slice(ADDRESS_PREFIX.length) };
  const at = key.indexOf(':');
  return { kind: 'legacy', chain: at < 0 ? '' : key.slice(0, at), address: key.slice(at + 1) };
}

/** Every address a label names, once each and sorted: the store splits sender rows into labeled and not by this list. */
export function labeledAddresses(labels: LabelIndex): string[] {
  return [...new Set(Object.keys(labels).map(senderKeyAddress))].sort();
}

/** The addresses one project's label names, on any chain. */
export function projectAddresses(labels: LabelIndex, slug: string): string[] {
  return [...new Set(Object.entries(labels).filter(([, label]) => label.slug === slug).map(([key]) => senderKeyAddress(key)))].sort();
}

/**
 * EVM addresses labeled on an EVM chain, for the projects that allow spreading. An address two projects label is left
 * out: whose it is on a third chain is unknown.
 */
function spreadIndex(labels: LabelIndex, chains: SenderChains): Map<string, Label> {
  const evmChains = new Set([...chains.values()].filter((c) => c.family === 'EVM').map((c) => c.name));
  const claims = new Map<string, Label | null>();
  for (const [key, label] of Object.entries(labels)) {
    const chain = key.slice(0, key.indexOf(':'));
    const address = senderKeyAddress(key);
    if (label.spread === false || !evmChains.has(chain) || !isAddressShape('EVM', address)) continue;
    const claimed = claims.get(address);
    if (claimed === undefined) claims.set(address, label);
    else if (claimed !== null && claimed.slug !== label.slug) claims.set(address, null);
  }
  return new Map([...claims].flatMap(([address, label]) => (label === null ? [] : [[address, label] as const])));
}

/** The sender's own label on its chain, else a label spread from the same EVM address on another EVM chain, else the address. */
export function identityResolver(labels: LabelIndex, chains: SenderChains): IdentityResolver {
  const spread = spreadIndex(labels, chains);
  return (selector, address) => {
    const normalized = senderAddress(address);
    const chain = chains.get(selector);
    const own = chain === undefined ? undefined : labels[`${chain.name}:${normalized}`];
    if (own !== undefined) return { key: projectKey(own.slug), project: own, inferred: false };
    const spreadLabel = chain?.family === 'EVM' ? spread.get(normalized) : undefined;
    if (spreadLabel !== undefined) return { key: projectKey(spreadLabel.slug), project: spreadLabel, inferred: true };
    return { key: addressKey(normalized), project: null, inferred: false };
  };
}

export interface SenderRow {
  /** `<selector>:<address>`, as daily_breakdown keys senders. */
  key: string;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

export interface IdentityTotals {
  key: string;
  label: string | null;
  slug: string | null;
  x: string | null;
  kind: LabelKind | null;
  /** Every row of the project came through a spread label. */
  inferred: boolean;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
  /** Source chain selectors, busiest first. */
  chains: string[];
  /** Distinct addresses. */
  addresses: number;
  /** The `<selector>:<address>` keys merged in, each once, in the order first seen. */
  keys: string[];
}

interface Group {
  identity: SenderIdentity;
  allInferred: boolean;
  messages: number;
  usd: number;
  fee: number;
  anyFee: boolean;
  chains: Map<string, number>;
  addresses: Set<string>;
  keys: Set<string>;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Sums sender rows by identity; one key's rows from several days add up. */
export function mergeIdentities(rows: readonly SenderRow[], resolve: IdentityResolver): IdentityTotals[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const selector = row.key.slice(0, row.key.indexOf(':'));
    const address = senderKeyAddress(row.key);
    const identity = resolve(selector, address);
    let group = groups.get(identity.key);
    if (group === undefined) {
      group = { identity, allInferred: true, messages: 0, usd: 0, fee: 0, anyFee: false, chains: new Map(), addresses: new Set(), keys: new Set() };
      groups.set(identity.key, group);
    }
    group.allInferred &&= identity.inferred;
    group.messages += row.messages;
    group.usd += row.usd_value;
    if (row.fee_usd !== null) {
      group.fee += row.fee_usd;
      group.anyFee = true;
    }
    group.chains.set(selector, (group.chains.get(selector) ?? 0) + row.messages);
    group.addresses.add(senderAddress(address));
    group.keys.add(row.key);
  }
  return [...groups.values()].map(totalsOf);
}

function totalsOf(g: Group): IdentityTotals {
  const project = g.identity.project;
  return {
    key: g.identity.key,
    label: project?.name ?? null,
    slug: project?.slug ?? null,
    x: project?.x ?? null,
    kind: project?.kind ?? null,
    inferred: project !== null && g.allInferred,
    messages: g.messages,
    usd_value: g.usd,
    fee_usd: g.anyFee ? g.fee : null,
    chains: [...g.chains].sort(([a, x], [b, y]) => y - x || compare(a, b)).map(([selector]) => selector),
    addresses: g.addresses.size,
    keys: [...g.keys],
  };
}

export type IdentityOrder = 'value' | 'fees' | 'messages';

/** Each order ends on the key, as the store's per-key rankings do, so ties always fall the same way. */
const ORDER: Record<IdentityOrder, (a: IdentityTotals, b: IdentityTotals) => number> = {
  value: (a, b) => b.usd_value - a.usd_value || b.messages - a.messages || compare(a.key, b.key),
  fees: (a, b) => (b.fee_usd ?? 0) - (a.fee_usd ?? 0) || b.usd_value - a.usd_value || compare(a.key, b.key),
  messages: (a, b) => b.messages - a.messages || b.usd_value - a.usd_value || compare(a.key, b.key),
};

/** The first `limit` identities in `order`. By fees, an identity with no fee data has nothing to rank by, so it is left out. */
export function rankIdentities(identities: readonly IdentityTotals[], order: IdentityOrder, limit: number): IdentityTotals[] {
  return identities.filter((i) => order !== 'fees' || i.fee_usd !== null).sort(ORDER[order]).slice(0, limit);
}

/** `part` as a percentage of `total`, to one decimal; null when there is no total to share. */
export function sharePct(part: number, total: number | null): number | null {
  return total === null || total <= 0 ? null : Math.round((part / total) * 1000) / 10;
}
```

In `packages/core/src/index.ts`, add after `export * from './labels';`:

```ts
export * from './senders';
```

In `packages/core/package.json` `exports`, after `"./roster": "./src/roster.ts"`, add `"./senders": "./src/senders.ts"` (with the comma on the line before).

- [ ] **Step 9: Run the core tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/senders.test.ts test/labels.test.ts`
Expected: PASS.

- [ ] **Step 10: Give the Worker tests' label fixtures their slug**

`Label` now requires `slug`, so update these fixtures (no behavior changes):
- `worker/test/publish.test.ts`:
  - In `'publishes the last 15 minutes with token symbols and verified sender labels'`: `{ name: 'Maple Finance', kind: 'protocol', slug: 'maple-finance' }`.
  - In `describe('a mixed-case (EIP-55) sender')`: `buildLabelIndex([{ name: 'Maple Finance', kind: 'protocol', verified: true, spread: true, slug: 'maple-finance', source: null, addresses: [{ chain: 'ethereum-mainnet-base-1', address: CHECKSUMMED }], tokens: [] }])`.
  - In `describe('day-leaders.json')`: `{ name: 'Maple Finance', x: 'maplefinance', kind: 'protocol' as const, slug: 'maple-finance' }`.
- `worker/test/broadcast-facts.test.ts`: `const LABELS = { [labelKey('ethereum-mainnet', SENDER)]: { name: 'xStocks', x: 'xStocksFi', kind: 'issuer' as const, slug: 'xstocks' } };`

- [ ] **Step 11: Rebuild the generated labels**

Run: `pnpm labels:build`
Expected: `wrote 66 verified address label(s) to worker/src/generated/labels.json` (the count may differ if labels changed since 2026-10-14); every entry now carries `"slug"`, e.g. `"slug": "xstocks"`.

Check: `grep -c '"slug"' worker/src/generated/labels.json` equals the label count, and `pnpm labels:check` passes.

- [ ] **Step 12: Run everything**

```bash
pnpm test && pnpm typecheck
```

Expected: all green.

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/labels.ts packages/core/src/senders.ts packages/core/src/index.ts packages/core/package.json packages/core/src/testing.ts \
  packages/core/test/labels.test.ts packages/core/test/senders.test.ts worker/test/publish.test.ts worker/test/broadcast-facts.test.ts worker/src/generated/labels.json
git commit -m "feat(core): sender identity, a verified project or an address across chains, with label spread

The 2026-10-13 daily split xStocks's xBridge five ways and named its Solana sender
instead; identities merge a project's addresses on every chain. Label files now carry
a slug (their file name), an optional spread = false, and their source line.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---
### Task 2: Store queries that rank senders by identity

**Files:**
- Modify: `worker/src/store.ts`
- Test: `worker/test/store.test.ts`

**Interfaces:**
- **Consumes:** `SenderChain` from Task 1.
- **Produces** (from `worker/src/store.ts`):
  - `senderChains(db): Promise<Map<string, SenderChain>>`: selector to `{ name, family }`.
  - `senderTotalsOf(db, fromDay: string | null, toDay: string, addresses: readonly string[]): Promise<BreakdownRow[]>`: per-key sums of every sender row whose address is in the list, with no limit (`SENDER_TOTALS_OF_SQL`).
  - `senderDaysOf(db, fromDay, toDay, addresses): Promise<LeaderRow[]>`: the same rows per day.
  - `topUnlabeledSenders(db, fromDay: string | null, toDay, labeled, limit, order: TopOrder): Promise<BreakdownRow[]>`: the per-key rows of the `limit` busiest addresses outside `labeled`, each summed across its chains.
  - `dailyTopUnlabeledSenders(db, fromDay, toDay, labeled): Promise<LeaderRow[]>`: each day's per-key rows of its busiest unlabeled address by messages.
  - `interface WindowTotals { messages: number; usd_value: number; fee_usd: number | null }`, `totalsBetween(db, fromDay: string | null, toDay): Promise<WindowTotals>`.
  - `messagesByDay(db, fromDay, toDay): Promise<Map<string, number>>`.

**Why two queries are exact:** an address no label names is exactly one identity, so ranking addresses outside the labeled list gives the unlabeled identities in order, and `limit` of them can't be cut short by a merge. Every row of a labeled address comes back unranked, so a project's six chains all merge before it ranks.

- [ ] **Step 1: Write the failing store tests**

In `worker/test/store.test.ts`, change the first import to `import { chainRef, siblingKeys } from '@ccip-dev/core';` plus a second line:

```ts
import { BASE_SENDER_1, BASE_SENDER_2, NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_DAY, XSTOCKS_TOTALS, xstocksBreakdown } from '@ccip-dev/core/testing';
```

(replacing the existing `import { NETWORKS } from '@ccip-dev/core/testing';`), and append:

```ts
describe('sender identity queries', () => {
  const NOW = '2026-10-14T00:07:00.000Z';
  const DAY = XSTOCKS_DAY;
  const ETH = NETWORKS.ethereum.chainSelector;
  const BASE = NETWORKS.base.chainSelector;
  const SOL = NETWORKS.solana.chainSelector;
  const LABELED = [XBRIDGE_EVM, XBRIDGE_SOLANA];
  const sender = (day: string, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim: 'sender' as const, key, messages, usd_value, fee_usd });

  beforeEach(async () => {
    // #given 2026-10-13's sender rows: xStocks on six chains, then 25 unlabeled Base senders
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, xstocksBreakdown(), NOW);
  });

  it('sums every row of a labeled address with no limit, so all six of xStocks’s chains are there to merge', async () => {
    // #when
    const rows = await store.senderTotalsOf(env.DB, DAY, DAY, LABELED);
    // #then
    expect({ keys: rows.length, messages: rows.reduce((sum, r) => sum + r.messages, 0) }).toEqual({ keys: 6, messages: 319 });
  });

  it('ranks only addresses outside the labeled list', async () => {
    // #when
    const rows = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 2, 'messages');
    // #then
    expect(rows.map((r) => r.key)).toEqual([`${BASE}:${BASE_SENDER_1}`, `${BASE}:${BASE_SENDER_2}`]);
  });

  it('ranks an unlabeled address by its sum across chains and returns each of its chains’ rows', async () => {
    // #given the second Base sender also sent 30 from Ethereum: 98 in all, ahead of the first one's 76
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [...xstocksBreakdown(), sender(DAY, `${ETH}:${BASE_SENDER_2}`, 30, 0, 7.5)], NOW);
    // #when
    const rows = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'messages');
    // #then
    expect(rows).toEqual([
      { key: `${BASE}:${BASE_SENDER_2}`, messages: 68, usd_value: 0, fee_usd: 17 },
      { key: `${ETH}:${BASE_SENDER_2}`, messages: 30, usd_value: 0, fee_usd: 7.5 },
    ]);
  });

  it('ranks by fees only the addresses with fee data', async () => {
    // #given an address with the most messages of the day but no fee data
    const QUIET = '0x00000000000000000000000000000000000000ff';
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [...xstocksBreakdown(), sender(DAY, `${BASE}:${QUIET}`, 900, 0, null)], NOW);
    // #when
    const [first] = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'fees');
    // #then
    expect(first?.key).toBe(`${BASE}:${BASE_SENDER_1}`);
  });

  it('tells a Solana address from one that differs only in letter case', async () => {
    // #given an unlabeled Solana sender whose address is xStocks's lowercased
    const lower = XBRIDGE_SOLANA.toLowerCase();
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [...xstocksBreakdown(), sender(DAY, `${SOL}:${lower}`, 500, 0, 1)], NOW);
    // #when
    const labeled = await store.senderTotalsOf(env.DB, DAY, DAY, LABELED);
    const [top] = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'messages');
    // #then
    expect({ labeled: labeled.some((r) => r.key === `${SOL}:${lower}`), top: top?.key }).toEqual({ labeled: false, top: `${SOL}:${lower}` });
  });

  it("gives each day its busiest unlabeled address with every chain it sent from, and the labeled rows per day", async () => {
    // #given on Oct 12 the second Base sender also sent from Ethereum
    await store.replaceDaily(env.DB, { ...XSTOCKS_TOTALS, day: '2026-10-12' }, [
      sender('2026-10-12', `${BASE}:${BASE_SENDER_2}`, 10, 0, 1), sender('2026-10-12', `${ETH}:${BASE_SENDER_2}`, 10, 0, 1),
      sender('2026-10-12', `${BASE}:${BASE_SENDER_1}`, 15, 0, 1), sender('2026-10-12', `${SOL}:${XBRIDGE_SOLANA}`, 40, 0, 1),
    ], NOW);
    // #when
    const unlabeled = await store.dailyTopUnlabeledSenders(env.DB, '2026-10-12', DAY, LABELED);
    const labeled = await store.senderDaysOf(env.DB, '2026-10-12', DAY, LABELED);
    // #then
    expect({
      unlabeled: unlabeled.map((r) => `${r.day} ${r.key}`),
      labeled: labeled.filter((r) => r.day === '2026-10-12').map((r) => r.key),
    }).toEqual({
      unlabeled: [`2026-10-12 ${BASE}:${BASE_SENDER_2}`, `2026-10-12 ${ETH}:${BASE_SENDER_2}`, `${DAY} ${BASE}:${BASE_SENDER_1}`],
      labeled: [`${SOL}:${XBRIDGE_SOLANA}`],
    });
  });

  it("totals a window's messages, value and fees, and each day's messages, from daily_totals", async () => {
    // #when
    const totals = await store.totalsBetween(env.DB, '2026-10-07', DAY);
    const byDay = await store.messagesByDay(env.DB, '2026-10-07', DAY);
    // #then
    expect({ totals, byDay: [...byDay] }).toEqual({ totals: { messages: 1_569, usd_value: 250_000, fee_usd: 392.25 }, byDay: [[DAY, 1_569]] });
  });

  it('totals an empty window as zero messages and value, and no fees', async () => {
    // #when
    const totals = await store.totalsBetween(env.DB, '2026-01-01', '2026-01-07');
    // #then
    expect(totals).toEqual({ messages: 0, usd_value: 0, fee_usd: null });
  });

  it('reads the labeled rows through a daily_breakdown index', async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.SENDER_TOTALS_OF_SQL}`).bind('2026-10-07', DAY, JSON.stringify(LABELED)).all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toMatch(/SEARCH daily_breakdown USING (COVERING )?INDEX/);
  });
});

describe('senderChains', () => {
  it("maps each selector to its CCIP name and family", async () => {
    // #given
    await seedRegistry([NETWORKS.ethereum, NETWORKS.solana], []);
    // #when
    const chains = await store.senderChains(env.DB);
    // #then
    expect([...chains]).toEqual(
      expect.arrayContaining([
        [NETWORKS.ethereum.chainSelector, { name: 'ethereum-mainnet', family: 'EVM' }],
        [NETWORKS.solana.chainSelector, { name: 'solana-mainnet', family: 'SVM' }],
      ]),
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/store.test.ts`
Expected: FAIL (`store.senderTotalsOf` and the others are not functions).

- [ ] **Step 3: Write the queries**

In `worker/src/store.ts`, add `type SenderChain` to the `@ccip-dev/core` import list, then add after `dailyLeaders`:

```ts
/** Chains by selector with their CCIP name and family, for resolving sender identities. */
export async function senderChains(db: D1Database): Promise<Map<string, SenderChain>> {
  const { results } = await db.prepare('SELECT selector, name, family FROM chains').all<{ selector: string; name: string; family: string }>();
  return new Map(results.map((r) => [r.selector, { name: r.name, family: r.family }]));
}

/** A sender key's address: daily_breakdown keys senders `<selector>:<address>`, and selectors hold no colon. */
const SENDER_ADDRESS = "substr(key, instr(key, ':') + 1)";

/** Per-key sums of every sender row whose address is in the JSON list ?3, over [?1, ?2], with no limit. */
export const SENDER_TOTALS_OF_SQL = `SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
  FROM daily_breakdown WHERE dim = 'sender' AND day >= ?1 AND day <= ?2 AND ${SENDER_ADDRESS} IN (SELECT value FROM json_each(?3))
  GROUP BY key ORDER BY key`;

export async function senderTotalsOf(db: D1Database, fromDay: string | null, toDay: string, addresses: readonly string[]): Promise<BreakdownRow[]> {
  const { results } = await db.prepare(SENDER_TOTALS_OF_SQL).bind(fromDay ?? '0000-00-00', toDay, JSON.stringify(addresses)).all<BreakdownRow>();
  return results;
}

export async function senderDaysOf(db: D1Database, fromDay: string, toDay: string, addresses: readonly string[]): Promise<LeaderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT day, key, messages, usd_value, fee_usd FROM daily_breakdown
       WHERE dim = 'sender' AND day >= ?1 AND day <= ?2 AND ${SENDER_ADDRESS} IN (SELECT value FROM json_each(?3)) ORDER BY day, key`,
    )
    .bind(fromDay, toDay, JSON.stringify(addresses))
    .all<LeaderRow>();
  return results;
}

/** An address's rank over its rows summed across chains; each order ends on the address, as ORDER_COLUMNS ends on the key. */
const ADDRESS_ORDER_SQL: Record<TopOrder, string> = {
  value: 'ORDER BY SUM(usd_value) DESC, SUM(messages) DESC, address',
  fees: 'HAVING SUM(fee_usd) IS NOT NULL ORDER BY SUM(fee_usd) DESC, SUM(usd_value) DESC, address',
  messages: 'ORDER BY SUM(messages) DESC, SUM(usd_value) DESC, address',
};

const unlabeledRowsSql = (withDay: boolean) => `SELECT ${withDay ? 'day, ' : ''}key, ${SENDER_ADDRESS} AS address, messages, usd_value, fee_usd
  FROM daily_breakdown WHERE dim = 'sender' AND day >= ?1 AND day <= ?2 AND ${SENDER_ADDRESS} NOT IN (SELECT value FROM json_each(?3))`;

/**
 * The per-key rows of the ?4 busiest addresses outside the labeled list ?3 over [?1, ?2], each address ranked by its rows
 * summed across chains. An address no label names is one identity, so these merge into exactly ?4 ranked identities.
 */
export const topUnlabeledSendersSql = (order: TopOrder) => `WITH rows AS (${unlabeledRowsSql(false)}),
  top AS (SELECT address FROM rows GROUP BY address ${ADDRESS_ORDER_SQL[order]} LIMIT ?4)
  SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
  FROM rows WHERE address IN (SELECT address FROM top) GROUP BY key ORDER BY key`;

export async function topUnlabeledSenders(
  db: D1Database,
  fromDay: string | null,
  toDay: string,
  labeled: readonly string[],
  limit: number,
  order: TopOrder,
): Promise<BreakdownRow[]> {
  const { results } = await db.prepare(topUnlabeledSendersSql(order)).bind(fromDay ?? '0000-00-00', toDay, JSON.stringify(labeled), limit).all<BreakdownRow>();
  return results;
}

/** Each day's per-key rows of its busiest address outside the labeled list ?3, by messages summed across chains, over [?1, ?2]. */
export const DAILY_TOP_UNLABELED_SQL = `WITH rows AS (${unlabeledRowsSql(true)}),
  ranked AS (
    SELECT day, address, ROW_NUMBER() OVER (PARTITION BY day ORDER BY SUM(messages) DESC, SUM(usd_value) DESC, address) AS rn
    FROM rows GROUP BY day, address
  )
  SELECT r.day, r.key, r.messages, r.usd_value, r.fee_usd FROM rows r JOIN ranked k ON k.day = r.day AND k.address = r.address
  WHERE k.rn = 1 ORDER BY r.day, r.key`;

export async function dailyTopUnlabeledSenders(db: D1Database, fromDay: string, toDay: string, labeled: readonly string[]): Promise<LeaderRow[]> {
  const { results } = await db.prepare(DAILY_TOP_UNLABELED_SQL).bind(fromDay, toDay, JSON.stringify(labeled)).all<LeaderRow>();
  return results;
}

export interface WindowTotals {
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

/** Messages, value and fees over [fromDay, toDay] (from the first day when fromDay is null), from daily_totals. */
export async function totalsBetween(db: D1Database, fromDay: string | null, toDay: string): Promise<WindowTotals> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(usd_value), 0) AS usd_value, SUM(fee_usd) AS fee_usd FROM daily_totals WHERE day >= ? AND day <= ?')
    .bind(fromDay ?? '0000-00-00', toDay)
    .first<WindowTotals>();
  return row ?? { messages: 0, usd_value: 0, fee_usd: null };
}

export async function messagesByDay(db: D1Database, fromDay: string, toDay: string): Promise<Map<string, number>> {
  const { results } = await db.prepare('SELECT day, messages FROM daily_totals WHERE day >= ? AND day <= ? ORDER BY day').bind(fromDay, toDay).all<{ day: string; messages: number }>();
  return new Map(results.map((r) => [r.day, r.messages]));
}
```

- [ ] **Step 4: Run the store tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add worker/src/store.ts worker/test/store.test.ts
git commit -m "feat(worker): store queries that rank senders by identity

Every labeled row comes back unlimited and the busiest unlabeled addresses come
back ranked across chains, so merging the two gives exact identity totals.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Publish identities in top/sender.json, the leaders, today.json and live.json

**Files:**
- Create: `worker/src/senders.ts`
- Modify: `worker/src/publish.ts`
- Modify: `packages/core/src/public.ts`
- Modify: `worker/src/broadcasts/facts.ts`, `worker/src/broadcasts/tags.ts`
- Test: `worker/test/publish.test.ts`, `worker/test/broadcast-facts.test.ts`, `worker/test/moment-facts.test.ts`, `packages/core/test/public.test.ts`

**Interfaces:**
- **Consumes:** Task 1's `identityResolver`, `labeledAddresses`, `mergeIdentities`, `rankIdentities`, `sharePct`, `senderKeyAddress`, `IdentityTotals`, `IdentityResolver`; Task 2's store functions.
- **Produces:**
  - `worker/src/senders.ts`: `interface SenderBook { resolve: IdentityResolver; labeled: string[] }`, `senderBook(c): Promise<SenderBook>`, `rankedIdentities(c, book, fromDay: string | null, toDay, order: IdentityOrder, limit): Promise<IdentityTotals[]>`, `topIdentityByDay(rows: readonly LeaderRow[], resolve): Map<string, IdentityTotals>`.
  - `worker/src/publish.ts`: `identityEntry(i: IdentityTotals, periodMessages: number | null): Leader`; `dayLeaderEntries` and `weekLeaderRows` return identity senders; `top/sender.json` gains `identities` and `identities_by_fees`.
  - `packages/core/src/public.ts`: `TopEntrySchema` and `LeaderSchema` gain the optional identity fields `x`, `kind`, `inferred`, `chains`, `addresses`, `share_pct`; `TopFileSchema` gains optional `identities` and `identities_by_fees`.
  - `Tagger` loses `sender` (the facts read the sender's name from its leader entry).

- [ ] **Step 1: Write the failing schema test**

Append to `packages/core/test/public.test.ts`, inside `describe('public file schemas')`:

```ts
  it('reads identity fields on top entries and leaders, and still reads files without them', () => {
    // #given an identity entry, and the per-chain entry an older file holds
    const identity = { key: 'project:xstocks', label: 'xStocks', messages: 319, usd: 0, fee_usd: 79.75, x: 'xStocksFi', kind: 'protocol', inferred: false, chains: ['1', '2'], addresses: 2, share_pct: 20.3 };
    const windows = { '7d': [identity], '30d': [], all: [] };
    const file = { ...envelope, dim: 'sender', since: null, windows: { '7d': [{ key: '1:0xa', messages: 1, usd: 1, label: null }], '30d': [], all: [] }, identities: windows, identities_by_fees: windows };
    // #when
    const top = TopFileSchema.parse(file);
    const old = TopFileSchema.parse({ ...file, identities: undefined, identities_by_fees: undefined });
    const leader = DayLeadersFileSchema.parse({ ...envelope, days: [{ day: '2026-10-13', token: null, sender: identity, lane: null, fee_lane: null, fee_chain: null }], weeks: [] });
    // #then
    expect({ share: top.identities?.['7d'][0]?.share_pct, old: old.identities, chains: leader.days[0]?.sender?.chains }).toEqual({ share: 20.3, old: undefined, chains: ['1', '2'] });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/public.test.ts`
Expected: FAIL (the parsed objects drop `identities` and `share_pct`).

- [ ] **Step 3: Add the identity fields to the schemas**

In `packages/core/src/public.ts`, before `TopEntrySchema`, add:

```ts
/** A sender identity's fields, all optional so files published before identities still parse. */
const identityFields = {
  x: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  inferred: z.boolean().optional(),
  chains: z.array(z.string()).optional(),
  addresses: z.number().optional(),
  share_pct: z.number().nullable().optional(),
};
```

Spread `...identityFields` as the last entry of both `TopEntrySchema` and `LeaderSchema`. In `TopFileSchema`, after `by_fees: TopWindowsSchema.optional(),`, add:

```ts
  /** Senders by identity; `windows` and `by_fees` keep their per-chain keys for consumers that predate identities. */
  identities: TopWindowsSchema.optional(),
  identities_by_fees: TopWindowsSchema.optional(),
```

Run the test again: PASS.

- [ ] **Step 4: Write the failing publish tests**

In `worker/test/publish.test.ts`:

1. Extend the imports: add `labelKey` (already there), and from `@ccip-dev/core/testing` add `BASE_SENDER_1, BASE_SENDER_2, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_DAY, XSTOCKS_LABELS, XSTOCKS_TOTALS, xstocksBreakdown`; from `../src/publish` add `weekLeaderRows`.

2. Update the existing expectations that now read identities:
   - In `'publishes today totals and top lists, excluding other days'`: `expect(today.top.sender[0]).toMatchObject({ key: \`address:${SENDER}\`, label: null });`
   - In `describe('a mixed-case (EIP-55) sender')`: `expect((await readPublic('today.json')).top.sender).toMatchObject([{ key: 'project:maple-finance', label: 'Maple Finance' }]);`
   - In `describe('day-leaders.json')`: change its `totals` helper to `messages: 20` (so the share reads 35%), and the expected sender to:

```ts
      sender: { key: 'project:maple-finance', label: 'Maple Finance', messages: 7, usd: 10, fee_usd: 1, x: 'maplefinance', kind: 'protocol', inferred: false, chains: [BASE], addresses: 1, share_pct: 35 },
```

3. Append:

```ts
describe('senders by identity', () => {
  const NOW = '2026-10-14T00:07:00.000Z';
  const INK = NETWORKS.ink.chainSelector;
  const XLAYER = NETWORKS.xlayer.chainSelector;
  const BSC = NETWORKS.bsc.chainSelector;
  const ETH = NETWORKS.ethereum.chainSelector;
  const HYPER = NETWORKS.hyperliquid.chainSelector;
  const SOL = NETWORKS.solana.chainSelector;
  const CHAINS = [NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc, NETWORKS.solana, NETWORKS.ink, NETWORKS.xlayer, NETWORKS.hyperliquid];

  beforeEach(async () => {
    // #given 2026-10-13: xStocks's xBridge on five EVM chains and its Solana sender, then the unlabeled Base senders
    await seedRegistry(CHAINS, []);
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, xstocksBreakdown(), NOW);
  });

  it("names xStocks the day's top sender: 319 messages, 20.3% of the day, on six chains from two addresses", async () => {
    // #when
    await publishHistoryFiles(harness({ now: NOW, labels: XSTOCKS_LABELS }).c);
    // #then
    const day = (await readPublic('day-leaders.json')).days.find((d: { day: string }) => d.day === XSTOCKS_DAY);
    expect(day.sender).toEqual({
      key: 'project:xstocks', label: 'xStocks', messages: 319, usd: 0, fee_usd: 79.75, x: 'xStocksFi', kind: 'protocol', inferred: false,
      chains: [SOL, INK, XLAYER, BSC, ETH, HYPER], addresses: 2, share_pct: 20.3,
    });
  });

  it('publishes identities in top/sender.json beside the per-chain windows, which stay as they were', async () => {
    // #when
    await publishHistoryFiles(harness({ now: NOW, labels: XSTOCKS_LABELS }).c);
    // #then
    const top = await readPublic('top/sender.json');
    expect({
      identities: top.identities['7d'].slice(0, 3).map((e: { key: string; messages: number; share_pct: number }) => [e.key, e.messages, e.share_pct]),
      byFees: top.identities_by_fees['7d'][0].key,
      perChain: [top.windows['7d'][0].key, top.windows['7d'][0].label],
    }).toEqual({
      identities: [[`address:${BASE_SENDER_1}`, 76, 4.8], ['project:xstocks', 319, 20.3], [`address:${BASE_SENDER_2}`, 68, 4.3]],
      byFees: 'project:xstocks',
      perChain: [`${NETWORKS.base.chainSelector}:${BASE_SENDER_1}`, null],
    });
  });

  it("names the week's top sender by identity", async () => {
    // #when
    const week = await weekLeaderRows(harness({ now: NOW, labels: XSTOCKS_LABELS }).c, '2026-10-12');
    // #then
    expect([week.sender?.key, week.sender?.messages, week.sender?.share_pct]).toEqual(['project:xstocks', 319, 20.3]);
  });
});

describe("today's and the live feed's senders by identity", () => {
  const at = (minute: number) => `2026-10-13T19:${String(minute).padStart(2, '0')}:00.000Z`;

  it("merges today's xBridge messages on Ink and Solana into xStocks, with its share of the day so far", async () => {
    // #given 3 messages from the xBridge on Ink, 2 from its Solana sender and 4 from an unlabeled Base sender
    await seedRegistry([NETWORKS.base, NETWORKS.solana, NETWORKS.ink], []);
    await store.upsertListRows(env.DB, [
      ...[1, 2, 3].map((m) => liveRow({ id: `ink${m}`, sendTs: at(m), src: NETWORKS.ink, sender: XBRIDGE_EVM })),
      ...[4, 5].map((m) => liveRow({ id: `sol${m}`, sendTs: at(m), src: NETWORKS.solana, sender: XBRIDGE_SOLANA })),
      ...[6, 7, 8, 9].map((m) => liveRow({ id: `base${m}`, sendTs: at(m), sender: BASE_SENDER_1 })),
    ], []);
    // #when
    await publishLiveFiles(harness({ now: '2026-10-13T20:00:00.000Z', labels: XSTOCKS_LABELS }).c);
    // #then
    expect((await readPublic('today.json')).top.sender[0]).toMatchObject({
      key: 'project:xstocks', messages: 5, chains: [NETWORKS.ink.chainSelector, NETWORKS.solana.chainSelector], addresses: 2, share_pct: 55.6,
    });
  });

  it('names a live message by a label spread from the same address on another chain', async () => {
    // #given Maple is labeled on Ethereum and the message comes from the same address on Base
    await seedRegistry([NETWORKS.ethereum, NETWORKS.base], []);
    await store.upsertListRows(env.DB, [liveRow({ id: 'b1', sendTs: at(55), sender: SENDER })], []);
    const labels = { [labelKey('ethereum-mainnet', SENDER)]: { name: 'Maple Finance', kind: 'protocol' as const, slug: 'maple-finance' } };
    // #when
    await publishLiveFiles(harness({ now: '2026-10-13T20:00:00.000Z', labels }).c);
    // #then
    expect((await readPublic('live.json')).messages[0].sender_label).toBe('Maple Finance');
  });
});
```

In `worker/test/broadcast-facts.test.ts`, change the expected sender in `"gives the day's totals and leaders, tagging a token's project through its registry group"` to `sender: { key: 'project:xstocks', player: { name: 'xStocks', x: 'xStocksFi' }, messages: 97 },`.

In `worker/test/moment-facts.test.ts`, delete the line `sender: (key) => ({ name: key, x: null }),` from `TAGS`.

- [ ] **Step 5: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts test/broadcast-facts.test.ts`
Expected: FAIL (the files still carry per-chain senders; `identities` is missing).

- [ ] **Step 6: Write the sender book**

Create `worker/src/senders.ts`:

```ts
import { identityResolver, labeledAddresses, mergeIdentities, rankIdentities, type IdentityOrder, type IdentityResolver, type IdentityTotals } from '@ccip-dev/core';
import type { RunContext } from './context';
import * as store from './store';

/** What every identity ranking needs: the resolver, and the addresses the store splits labeled rows by. */
export interface SenderBook {
  resolve: IdentityResolver;
  labeled: string[];
}

export async function senderBook(c: RunContext): Promise<SenderBook> {
  return { resolve: identityResolver(c.labels, await store.senderChains(c.env.DB)), labeled: labeledAddresses(c.labels) };
}

/** The top `limit` identities over [fromDay, toDay]: every labeled row, plus the busiest unlabeled addresses, merged. */
export async function rankedIdentities(
  c: RunContext,
  book: SenderBook,
  fromDay: string | null,
  toDay: string,
  order: IdentityOrder,
  limit: number,
): Promise<IdentityTotals[]> {
  const db = c.env.DB;
  const rows = [...(await store.senderTotalsOf(db, fromDay, toDay, book.labeled)), ...(await store.topUnlabeledSenders(db, fromDay, toDay, book.labeled, limit, order))];
  return rankIdentities(mergeIdentities(rows, book.resolve), order, limit);
}

/** Each day's top identity by messages, from that day's labeled rows and its busiest unlabeled address. */
export function topIdentityByDay(rows: readonly store.LeaderRow[], resolve: IdentityResolver): Map<string, IdentityTotals> {
  const byDay = new Map<string, store.LeaderRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  const top = new Map<string, IdentityTotals>();
  for (const [day, list] of byDay) {
    const [first] = rankIdentities(mergeIdentities(list, resolve), 'messages', 1);
    if (first) top.set(day, first);
  }
  return top;
}
```

- [ ] **Step 7: Publish identities**

In `worker/src/publish.ts`:

1. Imports: add `mergeIdentities, rankIdentities, sharePct, type IdentityTotals` to the `@ccip-dev/core` import; change the public import to `import { TOP_WINDOWS, type DayLeaders, type DayTotals, type LargestFee, type Leader, type ReserveFile, type TopWindow } from '@ccip-dev/core/public';`; add `import { rankedIdentities, senderBook, topIdentityByDay, type SenderBook } from './senders';`.

2. After `leader(...)`, add:

```ts
/** A sender identity as every public file publishes it, with its share of the period's messages. */
export function identityEntry(i: IdentityTotals, periodMessages: number | null): Leader {
  return {
    key: i.key,
    label: i.label,
    messages: i.messages,
    usd: usd(i.usd_value),
    fee_usd: usd(i.fee_usd),
    x: i.x,
    kind: i.kind,
    inferred: i.inferred,
    chains: i.chains,
    addresses: i.addresses,
    share_pct: sharePct(i.messages, periodMessages),
  };
}
```

3. Replace `dayLeaderEntries` with:

```ts
/** Each day's leaders over [fromDay, toDay]: the top token and lane by value, the top sender identity by messages, and the top lane and source chain by fees. */
export async function dayLeaderEntries(c: RunContext, fromDay: string, toDay: string): Promise<DayLeaders[]> {
  const db = c.env.DB;
  const book = await senderBook(c);
  const tokens = await store.dailyLeaders(db, 'token', 'value', fromDay, toDay);
  const senders = topIdentityByDay(
    [...(await store.senderDaysOf(db, fromDay, toDay, book.labeled)), ...(await store.dailyTopUnlabeledSenders(db, fromDay, toDay, book.labeled))],
    book.resolve,
  );
  const dayMessages = await store.messagesByDay(db, fromDay, toDay);
  const lanes = await store.dailyLeaders(db, 'lane', 'value', fromDay, toDay);
  const feeLanes = await store.dailyLeaders(db, 'lane', 'fees', fromDay, toDay);
  const feeChains = await store.dailyLeaders(db, 'src_chain', 'fees', fromDay, toDay);
  const symbols = await store.tokenSymbols(db, tokens.map((r) => splitTokenKey(r.key)));
  const byDay = (rows: store.LeaderRow[]) => new Map(rows.map((r) => [r.day, r]));
  const [token, lane, feeLane, feeChain] = [tokens, lanes, feeLanes, feeChains].map(byDay);
  const days = [...new Set([...[tokens, lanes, feeLanes, feeChains].flat().map((r) => r.day), ...senders.keys()])].sort();
  return days.map((day) => {
    const t = token!.get(day);
    const s = senders.get(day);
    const l = lane!.get(day);
    const fl = feeLane!.get(day);
    const fc = feeChain!.get(day);
    return {
      day,
      token: t ? leader(t, symbolOf(symbols, t.key)) : null,
      sender: s ? identityEntry(s, dayMessages.get(day) ?? null) : null,
      lane: l ? leader(l, null) : null,
      fee_lane: fl ? leader(fl, null) : null,
      fee_chain: fc ? leader(fc, null) : null,
    };
  });
}
```

4. Replace `publishLiveFiles`, `publishLive` and `publishToday` with:

```ts
export async function publishLiveFiles(c: RunContext): Promise<void> {
  const now = c.deps.now();
  const book = await senderBook(c);
  const since = new Date(now.getTime() - LIVE_WINDOW_MINUTES * 60_000).toISOString();
  const rows = await store.liveSince(c.env.DB, since);
  const today = await rollupToday(c, now);
  const symbols = await store.tokenSymbols(c.env.DB, [
    ...rows.flatMap((r) => (r.symbol === null && r.chain !== null && r.token !== null ? [{ chain: r.chain, address: r.token }] : [])),
    ...topOf(today.breakdown, 'token', TOP_LIMIT).map((b) => splitTokenKey(b.key)),
  ]);
  await publishLive(c, now, book, rows, symbols);
  await publishToday(c, now, book, today, symbols);
  await publishStatus(c, now);
}
```

```ts
async function publishLive(c: RunContext, now: Date, book: SenderBook, rows: store.LiveRow[], symbols: Map<string, string>): Promise<void> {
  await putJson(
    c.env.PUBLIC,
    'live.json',
    {
      window_minutes: LIVE_WINDOW_MINUTES,
      messages: rows.map((r) => ({
        id: r.message_id,
        send_ts: r.send_ts,
        status: r.status,
        src: r.src_chain,
        dst: r.dst_chain,
        token: r.symbol ?? (r.chain !== null && r.token !== null ? symbolOf(symbols, `${r.chain}:${r.token}`) : null),
        usd: usd(r.usd_value),
        sender_label: book.resolve(r.src_chain, r.sender).project?.name ?? null,
      })),
    },
    TTL.live,
    now,
  );
}

/** today.json's top senders are identities ranked by value, as its lanes and tokens are. */
async function publishToday(
  c: RunContext,
  now: Date,
  book: SenderBook,
  { day, messages, totals, breakdown }: Awaited<ReturnType<typeof rollupToday>>,
  symbols: Map<string, string>,
): Promise<void> {
  const feeLink = linkFeeUsd(messages, day, linkFeeMatcher(await store.linkFeeTokens(c.env.DB)));
  const top = (dim: Dim) =>
    topOf(breakdown, dim, TOP_LIMIT).map((b) => ({
      key: b.key,
      messages: b.messages,
      usd: usd(b.usd_value),
      ...(dim === 'token' ? { symbol: symbolOf(symbols, b.key) } : {}),
    }));
  const senders = rankIdentities(mergeIdentities(breakdown.filter((b) => b.dim === 'sender'), book.resolve), 'value', TOP_LIMIT).map((i) =>
    identityEntry(i, totals.messages),
  );
  await putJson(
    c.env.PUBLIC,
    'today.json',
    {
      day,
      totals: {
        ...totals,
        usd_value: usd(totals.usd_value),
        fee_usd: usd(totals.fee_usd),
        fee_link_usd: usd(feeLink),
        fee_link_share_pct: feeLinkShare(feeLink, totals.fee_usd),
      },
      top: { lane: top('lane'), token: top('token'), sender: senders },
      arrivals: await store.recentArrivals(c.env.DB, 10),
    },
    TTL.today,
    now,
  );
}
```

5. In `weekLeaderRows`, replace the `topBetween(db, 'sender', …)` line and the `names` line with:

```ts
  const book = await senderBook(c);
  const [sender] = await rankedIdentities(c, book, monday, sunday, 'messages', 1);
  const weekMessages = (await store.totalsBetween(db, monday, sunday)).messages;
```

and its `sender:` entry with `sender: sender ? identityEntry(sender, weekMessages) : null,`.

6. Add, after `historyDays`:

```ts
const TOP_FILE_LIMIT = 100;

/** top/sender.json's identities for each window, each with its share of the window's messages. */
async function identityWindows(c: RunContext, book: SenderBook, today: string, order: store.TopOrder): Promise<Record<TopWindow, Leader[]>> {
  const lastDay = addDays(today, -1);
  const from: Record<TopWindow, string | null> = { '7d': addDays(today, -7), '30d': addDays(today, -30), all: null };
  const out: Record<TopWindow, Leader[]> = { '7d': [], '30d': [], all: [] };
  for (const window of TOP_WINDOWS) {
    const total = (await store.totalsBetween(c.env.DB, from[window], lastDay)).messages;
    out[window] = (await rankedIdentities(c, book, from[window], lastDay, order, TOP_FILE_LIMIT)).map((i) => identityEntry(i, total));
  }
  return out;
}
```

7. In `publishHistoryFiles`, after `const names = await store.chainNames(db);` add `const book = await senderBook(c);`, and in the `for (const dim of DIMS)` loop replace the `putJson(… top/${dim}.json …)` call with:

```ts
    const identities =
      dim === 'sender' ? { identities: await identityWindows(c, book, today, 'value'), identities_by_fees: await identityWindows(c, book, today, 'fees') } : {};
    await putJson(
      c.env.PUBLIC,
      `top/${dim}.json`,
      { dim, since, windows: published(windows), ...(byFees ? { by_fees: published(byFees) } : {}), ...identities },
      TTL.top,
      now,
    );
```

`senderLabel` stays: the per-chain `windows` still use it.

- [ ] **Step 8: Read the daily's sender name from its leader entry**

In `worker/src/broadcasts/facts.ts`, add `senderKeyAddress` to the `@ccip-dev/core` import (making it `import { feeClassifier, senderKeyAddress } from '@ccip-dev/core';`), and in `leaderFacts` replace the `sender:` line with:

```ts
    sender: sender ? { key: sender.key, player: { name: sender.label ?? shortAddress(senderKeyAddress(sender.key)), x: sender.x ?? null }, messages: sender.messages } : null,
```

In `worker/src/broadcasts/tags.ts`, delete `sender(key: string): Player;` from `Tagger`, the `sender: (key) => { … },` entry from the returned object, and the imports only it used: `import { lookupLabel } from '../labels';`, and `shortAddress` from the `@ccip-dev/core/names` import (which keeps `chainNameMap`).

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts test/broadcast-facts.test.ts test/moment-facts.test.ts test/broadcasts.test.ts`
Expected: PASS. `today.json`'s share for the today test is 5 of 9 messages, 55.6%.

- [ ] **Step 10: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add worker/src/senders.ts worker/src/publish.ts worker/src/broadcasts/facts.ts worker/src/broadcasts/tags.ts packages/core/src/public.ts \
  packages/core/test/public.test.ts worker/test/publish.test.ts worker/test/broadcast-facts.test.ts worker/test/moment-facts.test.ts
git commit -m "feat(worker): publish senders by identity, beside the old per-chain fields

day-leaders.json, the weekly leaders and today.json name a sender identity with its
chains, address count and share; top/sender.json adds identities and identities_by_fees
and keeps its per-chain windows, so the site can deploy after the Worker.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: The top sender's share in the daily and weekly posts, and on the daily card

**Files:**
- Modify: `worker/src/broadcasts/facts.ts`, `worker/src/broadcasts/copy.ts`
- Modify: `site/worker/cards/broadcast-cards.ts`
- Test: `worker/test/broadcast-copy.test.ts`, `worker/test/broadcast-facts.test.ts`, `site/test/broadcast-cards.test.ts`

**Interfaces:**
- **Consumes:** `Leader.share_pct` from Task 3.
- **Produces:** `SenderFacts` gains `sharePct: number | null` (share of the period's messages).

**Copy (exact):** X `Top sender: xStocks · 319 messages (20%)`; Telegram daily `Top sender: xStocks · 319 messages, 20% of the day's`, weekly `…, 20% of the week's`. No `@` anywhere in these posts. Card cell `319 msgs · 20%`. A leader without a share (a file from before identities) reads as before.

- [ ] **Step 1: Write the failing tests**

In `worker/test/broadcast-copy.test.ts`:
- Change `DAILY.leaders.sender` to `{ key: 'project:xstocks', player: p('xStocks', 'xStocksFi'), messages: 97, sharePct: 7.39 },`.
- Change the expected `'Top sender: xStocks · 97 messages'` line to `'Top sender: xStocks · 97 messages (7.4%)'` in `'writes the daily post in the shape of the spec'` and in the weekly test, and the weekly test's `length: 247` to `length: 254` (the share adds 7 characters; the busiest lane is still the line that drops).
- In `'words the daily report in HTML with names in place of handles'`, change the line to `"Top sender: xStocks · 97 messages, 7.4% of the day's"`.
- In the three tests that build a sender inline (`{ key: 's', player: p(long(120)), messages: 97 }`, `{ key: 's', player: p('pump.fun'), messages: 97 }` and `{ key: 's', player: p('A<b>&C'), messages: 1 }`), add `sharePct: null`.
- Append:

```ts
describe("the top sender's share", () => {
  const XSTOCKS = { key: 'project:xstocks', player: p('xStocks', 'xStocksFi'), messages: 319, sharePct: 20.33 };

  it('writes the 2026-10-13 top sender as the spec does on X, by name and with no mention', () => {
    // #when
    const { xText } = composeCopy(withLeaders({ sender: XSTOCKS }));
    // #then
    expect({ line: xText.split('\n').find((l) => l.startsWith('Top sender')), mentions: xText.match(/@\w+/g) }).toEqual({ line: 'Top sender: xStocks · 319 messages (20%)', mentions: null });
  });

  it("words it as a share of the day's messages on Telegram, and of the week's in the weekly", () => {
    // #when
    const daily = composeCopy(withLeaders({ sender: XSTOCKS })).telegramHtml;
    const weekly = composeCopy({ ...WEEKLY, leaders: { ...WEEKLY.leaders, sender: XSTOCKS } }).telegramHtml;
    // #then
    expect([daily, weekly].map((t) => t.split('\n').find((l) => l.startsWith('Top sender')))).toEqual([
      "Top sender: xStocks · 319 messages, 20% of the day's",
      "Top sender: xStocks · 319 messages, 20% of the week's",
    ]);
  });

  it('leaves the share out for a sender without one', () => {
    // #when
    const { xText } = composeCopy(withLeaders({ sender: { ...XSTOCKS, sharePct: null } }));
    // #then
    expect(xText).toContain('Top sender: xStocks · 319 messages\n');
  });
});
```

In `worker/test/broadcast-facts.test.ts`, change the expected sender to `sender: { key: 'project:xstocks', player: { name: 'xStocks', x: 'xStocksFi' }, messages: 97, sharePct: 64.7 },` (97 of the day's 150 messages).

In `site/test/broadcast-cards.test.ts`, add `LEADERS` and `SENDER` to the `./fixtures/broadcast` import and add to `describe('daily broadcast card')`:

```ts
  it("shows an identity sender's share, and an unlabeled one by its short address", async () => {
    // #given the day's top sender as an identity with its share, then as an unlabeled address
    const withSender = (sender: object): typeof loadFixture => async (name) =>
      name === 'day-leaders.json' ? ({ ...LEADERS, days: LEADERS.days.map((d) => (d.day === DAY ? { ...d, sender } : d)) } as never) : loadFixture(name);
    const project = { key: 'project:xstocks', label: 'xStocks', messages: 319, usd: 0, fee_usd: 79.75, share_pct: 20.3 };
    const address = { key: `address:${SENDER}`, label: null, messages: 76, usd: 0, fee_usd: 19, share_pct: 4.8 };
    // #when
    const named = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load: withSender(project) }));
    const unnamed = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load: withSender(address) }));
    // #then
    expect([named, unnamed]).toEqual([
      expect.arrayContaining(['Top sender', 'xStocks', '319 msgs · 20%']),
      expect.arrayContaining(['Top sender', '0x7af7…ce09', '76 msgs · 4.8%']),
    ]);
  });
```

The existing `'shows the day against its 7-day average, its leaders, …'` test keeps `'97 msgs'`: its fixture is a pre-identity file with no share, which must still render.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/broadcast-copy.test.ts test/broadcast-facts.test.ts && pnpm --filter @ccip-dev/site exec vitest run test/broadcast-cards.test.ts`
Expected: FAIL (no share in the copy or the cell; `sharePct` is not on `SenderFacts`).

- [ ] **Step 3: Carry the share into the facts**

In `worker/src/broadcasts/facts.ts`, give `SenderFacts` a field:

```ts
export interface SenderFacts {
  key: string;
  player: Player;
  messages: number;
  /** Share of the period's messages; null for a leader published before identities. */
  sharePct: number | null;
}
```

and in `leaderFacts` set it: `…, messages: sender.messages, sharePct: sender.share_pct ?? null }`.

- [ ] **Step 4: Write it into the copy**

In `worker/src/broadcasts/copy.ts`:
- In `leaderLinesX`, replace the sender line with:

```ts
  if (l.sender) {
    const share = l.sender.sharePct === null ? null : formatShare(l.sender.sharePct);
    lines.push({ text: `Top sender: ${plainName(l.sender.player)} · ${plural(l.sender.messages, 'message')}${paren(share)}`, drop: DROP.sender });
  }
```

- Give `leaderLinesTg` a second parameter, `period: 'day' | 'week'`, and replace its sender line with:

```ts
  if (l.sender) {
    const share = l.sender.sharePct === null ? '' : `, ${formatShare(l.sender.sharePct)} of the ${period}'s`;
    lines.push({ text: `Top sender: ${tgName(l.sender.player)} · ${plural(l.sender.messages, 'message')}${share}`, drop: DROP.sender });
  }
```

- Call it as `...leaderLinesTg(f.leaders, 'day'),` in `dailyTg` and `...leaderLinesTg(f.leaders, 'week'),` in `weeklyTg`.

- [ ] **Step 5: Show it on the daily card**

In `site/worker/cards/broadcast-cards.ts`, add `type Leader` (already imported) use, and in `leadersRow` replace the sender cell with:

```ts
    lead.sender ? leaderCell('Top sender', lead.sender.label ?? shortAddress(addressOf(lead.sender.key)), senderFigure(lead.sender)) : null,
```

with, above `leadersRow`:

```ts
/** "319 msgs · 20%"; a leader published before identities has no share and reads "319 msgs". */
const senderFigure = (l: Leader) => `${formatCount(l.messages)} msgs${l.share_pct === undefined || l.share_pct === null ? '' : ` · ${formatShare(l.share_pct)}`}`;
```

`addressOf` already reads `address:0x…` and `<selector>:0x…` alike (everything after the first colon), and a project leader always has its label.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/broadcast-copy.test.ts test/broadcast-facts.test.ts && pnpm --filter @ccip-dev/site exec vitest run test/broadcast-cards.test.ts`
Expected: PASS, including the unchanged `'tags nobody for a project while a symbol with an @ is neutralized, within the 280 limit'`.

- [ ] **Step 7: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add worker/src/broadcasts/facts.ts worker/src/broadcasts/copy.ts site/worker/cards/broadcast-cards.ts \
  worker/test/broadcast-copy.test.ts worker/test/broadcast-facts.test.ts site/test/broadcast-cards.test.ts
git commit -m "feat(broadcasts): the top sender's share of the day or week, in the posts and on the card

X: \"Top sender: xStocks · 319 messages (20%)\"; Telegram: \"…, 20% of the day's\".
Still a plain name: the reports tag nobody.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

#### Checkpoint 1 (controller, after Task 4 is reviewed): push, and check the identities live

Push `main` (pre-approved). `deploy` (the Worker) and `site` (core changed) both run; wait for both to be green. Then:
- Within a minute, `curl -s https://data.ccip.dev/v1/today.json | jq '.top.sender[0]'` shows an identity entry (`key` starting `project:` or `address:`, with `chains`, `addresses` and `share_pct`), and `live.json` still has `sender_label`.
- After the next finalize (00:07 UTC; history files are only written then):
  - `top/sender.json` has `identities` and `identities_by_fees` for each window, and its `windows` still hold `<selector>:<address>` keys;
  - `day-leaders.json` `days[-1].sender` is an identity with `share_pct`;
  - `https://ccip.dev/og/broadcast/daily/<yesterday>.png` shows `N msgs · P%` in the TOP SENDER cell;
  - the daily post's X text reads `Top sender: <name> · N messages (P%)`.
- `https://ccip.dev/top/sender/7d/` still renders as before: the site reads the per-chain `windows` until Task 9.

---

### Task 5: Data messages: the migration with its backfill, the rollup and the published totals

**Files:**
- Create: `worker/migrations/0006_data_messages.sql`
- Modify: `packages/core/src/types.ts`, `packages/core/src/rollup.ts`, `packages/core/src/sql.ts`, `packages/core/src/public.ts`
- Modify: `worker/src/store.ts`
- Modify: `scripts/test/backfill-sql.test.ts` (it builds its database from every migration now)
- Test: `packages/core/test/rollup.test.ts`, `worker/test/store.test.ts`, `worker/test/publish.test.ts`

**Interfaces:**
- **Produces:**
  - `DailyTotals.data_messages?: number | null` (optional so existing callers and fixtures stand; `rollupDay` always sets it).
  - `DayTotalsSchema.data_messages: z.number().nullable().optional()`, so `history.json` days and `today.json` totals carry it.
  - `daily_totals.data_messages INTEGER`, written by `replaceDaily` and read by `dailyHistory`.

**Ruling (Global Constraints):** the backfill is `UPDATE daily_totals SET data_messages = messages - token_messages;`, equal by construction to counting each day's `token_count = 0` messages, which Step 1's migration test proves on real rows.

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/rollup.test.ts`, add `data_messages: 1,` after `token_messages: 2,` in the expected totals of `'totals one day, counting a message seen twice only once'` (m3 is the one message without tokens).

In `worker/test/store.test.ts`, add `import { rollupDay } from '@ccip-dev/core';` to the core import (making it `import { chainRef, rollupDay, siblingKeys } from '@ccip-dev/core';`) and append:

```ts
describe('migration 0006', () => {
  const DAY = '2026-10-07';
  const NOW = '2026-10-08T00:07:00.000Z';

  async function rollUpFiveMessages(): Promise<ReturnType<typeof rollupDay>> {
    // 3 messages without tokens and 2 with one
    await store.upsertListRows(env.DB, [0, 0, 0, 1, 1].map((tokens, i) => liveRow({ id: `m${i}`, sendTs: `${DAY}T10:0${i}:00.000Z` }, { token_count: tokens })), []);
    return rollupDay(DAY, await store.messagesForDay(env.DB, DAY), []);
  }

  it("backfills each day's data messages as its messages without tokens", async () => {
    // #given a day rolled up before the column existed
    const { totals, breakdown } = await rollUpFiveMessages();
    await store.replaceDaily(env.DB, { ...totals, data_messages: null }, breakdown, NOW);
    const backfill = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0006'))!.queries.find((q) => q.includes('UPDATE daily_totals'))!;
    // #when
    await env.DB.prepare(backfill).run();
    // #then
    expect((await store.dailyHistory(env.DB))[0]?.data_messages).toBe(3);
  });

  it('stores the rollup’s data messages and reads them back with the history', async () => {
    // #given
    const { totals, breakdown } = await rollUpFiveMessages();
    // #when
    await store.replaceDaily(env.DB, totals, breakdown, NOW);
    // #then
    expect((await store.dailyHistory(env.DB)).map((d) => [d.day, d.messages, d.token_messages, d.data_messages])).toEqual([[DAY, 5, 2, 3]]);
  });
});
```

In `worker/test/publish.test.ts`, append:

```ts
describe('data messages', () => {
  it("publishes each day's data messages in history.json, and today's in today.json", async () => {
    // #given yesterday rolled up with 3 data messages of 5, and today one message without tokens and one with
    const yesterday = { day: '2026-10-07', messages: 5, token_messages: 2, data_messages: 3, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 };
    await store.replaceDaily(env.DB, yesterday, [], '2026-10-08T00:07:00.000Z');
    await store.upsertListRows(env.DB, [
      liveRow({ id: 'data', sendTs: '2026-10-08T11:00:00.000Z' }),
      liveRow({ id: 'token', sendTs: '2026-10-08T11:01:00.000Z' }, { token_count: 1 }),
    ], []);
    const { c } = harness({ now: '2026-10-08T12:00:00.000Z' });
    // #when
    await publishHistoryFiles(c);
    await publishLiveFiles(c);
    // #then
    expect([(await readPublic('history.json')).days[0].data_messages, (await readPublic('today.json')).totals.data_messages]).toEqual([3, 1]);
  });
});
```

In `scripts/test/backfill-sql.test.ts`, the build's `daily_totals` rows now name `data_messages`, so its databases need every migration. With `readdir` and `readFile` already imported, add above `describe`:

```ts
const MIGRATIONS = path.resolve(import.meta.dirname, '../../worker/migrations');

/** The Worker's schema: every migration in order, as the deploy applies them. */
async function schema(): Promise<string> {
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  return (await Promise.all(files.map((f) => readFile(path.join(MIGRATIONS, f), 'utf8')))).join('\n');
}
```

and replace both `db.exec(await readFile(path.resolve(import.meta.dirname, '../../worker/migrations/0001_init.sql'), 'utf8'));` and `scratch.exec(await readFile(…0001_init.sql…))` with `db.exec(await schema());` and `scratch.exec(await schema());`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/rollup.test.ts && pnpm --filter @ccip-dev/worker exec vitest run test/store.test.ts test/publish.test.ts`
Expected: FAIL (no `data_messages` in the rollup; no migration 0006).

- [ ] **Step 3: Write the migration**

Create `worker/migrations/0006_data_messages.sql`:

```sql
-- Messages that carry no tokens, per day. Every row here was written by rollupDay, whose token_messages counts the same
-- day's messages with token_count > 0, so the rest are exactly its data messages: one pass over daily_totals, about
-- 1,200 rows, instead of reading every message in the deploy's migration.
ALTER TABLE daily_totals ADD COLUMN data_messages INTEGER;
UPDATE daily_totals SET data_messages = messages - token_messages;
```

- [ ] **Step 4: Count them in the rollup and write them**

1. `packages/core/src/types.ts`, in `DailyTotals` after `token_messages: number;`:

```ts
  /** Messages with no tokens. Optional so rows written before it was counted still type; the rollup always sets it. */
  data_messages?: number | null;
```

2. `packages/core/src/rollup.ts`, in `rollupDay`'s `totals`, after `token_messages: …,`:

```ts
    data_messages: rows.filter((r) => r.token_count === 0).length,
```

3. `packages/core/src/sql.ts`, in `TOTALS_CONFLICT`, after `token_messages = excluded.token_messages, ` add `data_messages = excluded.data_messages, ` (so the string reads `…token_messages = excluded.token_messages, data_messages = excluded.data_messages, ' + 'usd_value = …`).

4. `packages/core/src/public.ts`, in `DayTotalsSchema` after `token_messages: z.number(),`:

```ts
  data_messages: z.number().nullable().optional(),
```

5. `worker/src/store.ts`, in `writeDaily`, make the insert:

```ts
        `INSERT INTO daily_totals (day, messages, token_messages, data_messages, usd_value, fee_usd, unique_senders, median_delivery_s, unpriced_messages, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ${TOTALS_CONFLICT}`,
```

with `.bind(totals.day, totals.messages, totals.token_messages, totals.data_messages ?? null, totals.usd_value, …)` (the rest of the bind list unchanged), and in `dailyHistory` select `day, messages, token_messages, data_messages, usd_value, …`.

`publishToday` spreads the rollup's totals and `historyDays` spreads `dailyHistory`'s rows, so both files carry the field with no more change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/rollup.test.ts && pnpm --filter @ccip-dev/worker exec vitest run test/store.test.ts test/publish.test.ts test/finalize.test.ts && pnpm exec vitest run scripts/test/backfill-sql.test.ts scripts/test/build.test.ts`
Expected: PASS. (`finalize.test.ts`'s `'produces the same daily_totals as the backfill computation for the same day'` selects named columns, so it is unaffected.)

- [ ] **Step 6: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add worker/migrations/0006_data_messages.sql packages/core/src/types.ts packages/core/src/rollup.ts packages/core/src/sql.ts packages/core/src/public.ts \
  worker/src/store.ts packages/core/test/rollup.test.ts worker/test/store.test.ts worker/test/publish.test.ts scripts/test/backfill-sql.test.ts
git commit -m "feat(data): count data messages per day, backfilled in the migration

daily_totals.data_messages is filled at finalize and live in today.json; the migration
backfills every day as messages - token_messages, which rollupDay makes exact.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: The data share on the daily card and the history page

**Files:**
- Modify: `packages/core/src/broadcasts.ts`
- Modify: `site/worker/cards/broadcast-cards.ts`
- Modify: `site/src/lib/charts.ts`, `site/src/components/HistoryCharts.tsx`, `site/src/pages/history/[range].astro`
- Modify: `site/test/fixtures/broadcast.ts` (history days carry data messages)
- Test: `packages/core/test/broadcasts.test.ts`, `site/test/broadcast-cards.test.ts`, `site/test/charts.test.ts`

**Interfaces:**
- **Consumes:** `DayTotals.data_messages` from Task 5.
- **Produces:** `dataSharePct(d: Pick<DayTotals, 'messages' | 'data_messages'>): number | null` in `@ccip-dev/core/broadcasts`; `HistoryMetric` gains `'data_messages'`; `rangeTotals` returns `data_messages: number | null`; `dataShareOf(rows): number | null` in `site/src/lib/charts.ts`.

**Ruling:** the daily card's "62% data" is a muted line under the stats grid, above the leaders, because the grid's four 230 px stats already fill its 460 px.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/broadcasts.test.ts` (adding `dataSharePct` to its `../src/broadcasts` import):

```ts
describe('dataSharePct', () => {
  it("is a day's share of messages without tokens, and null for a day published before they were counted", () => {
    // #then
    expect([dataSharePct({ messages: 150, data_messages: 93 }), dataSharePct({ messages: 150 }), dataSharePct({ messages: 0, data_messages: 0 })]).toEqual([62, null, null]);
  });
});
```

In `site/test/fixtures/broadcast.ts`, in `HISTORY.days`, add `data_messages: Math.round(f.messages * 0.62),` after `token_messages: 0,` (150 → 93, 62%). In `site/test/broadcast-cards.test.ts`, add `'62% data'` to the expected words of `'shows the day against its 7-day average, its leaders, and the busiest lane in the strip'`, right after `'0.29 LINK'`, and add:

```ts
  it('leaves the data line out for a day published before data messages were counted', async () => {
    // #given history.json without data_messages
    const old: typeof loadFixture = async (name) =>
      name === 'history.json' ? ({ ...HISTORY, days: HISTORY.days.map(({ data_messages: _, ...d }) => d) } as never) : loadFixture(name);
    // #when
    const words = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load: old }));
    // #then
    expect(words.some((w) => w.endsWith('% data'))).toBe(false);
  });
```

Append to `site/test/charts.test.ts` (adding `dataShareOf` to its `../src/lib/charts` import, and `rangeTotals` if it is not imported yet):

```ts
describe('data messages', () => {
  const day = (d: string, messages: number, data: number | null | undefined) => ({
    day: d, messages, token_messages: 0, usd_value: 0, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: null,
    ...(data === undefined ? {} : { data_messages: data }),
  });

  it('charts them as a series that adds up, with a gap on a day that lacks them', () => {
    // #when
    const points = chartSeries([day('2026-10-12', 10, 6), day('2026-10-13', 10, undefined), day('2026-10-14', 10, 7)], 'data_messages', true);
    // #then
    expect(points.map((p) => p.value)).toEqual([6, 6, 13]);
  });

  it('totals them for a range, and gives their share of the messages on the days that count them', () => {
    // #given
    const rows = [day('2026-10-12', 10, 6), day('2026-10-13', 30, undefined), day('2026-10-14', 10, 4)];
    // #then
    expect({ total: rangeTotals(rows).data_messages, share: dataShareOf(rows), none: dataShareOf([day('2026-10-13', 30, undefined)]) }).toEqual({ total: 10, share: 50, none: null });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/broadcasts.test.ts && pnpm --filter @ccip-dev/site exec vitest run test/broadcast-cards.test.ts test/charts.test.ts`
Expected: FAIL.

- [ ] **Step 3: The core helper**

Append to `packages/core/src/broadcasts.ts`:

```ts
/** The share of a day's messages that carried no tokens; null for a day published before they were counted. */
export function dataSharePct(d: Pick<DayTotals, 'messages' | 'data_messages'>): number | null {
  const data = d.data_messages ?? null;
  return data === null || d.messages === 0 ? null : (data / d.messages) * 100;
}
```

- [ ] **Step 4: The card line**

In `site/worker/cards/broadcast-cards.ts`, add `dataSharePct` to the `@ccip-dev/core/broadcasts` import, and add above `dailyTree`:

```ts
/** The leaders, under a muted "62% data" line when the day counts its data messages. */
function dayFooter(dataShare: number | null, leaders: VNode): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column' } },
    dataShare === null ? null : h('div', { style: { fontSize: 18, color: COLORS.muted, marginTop: 12 } }, `${formatShare(dataShare)} data`),
    leaders,
  );
}
```

In `dailyTree`, after `const totals = …`, add `const row = history.days.find((d) => d.day === day);`, and pass `dayFooter(row ? dataSharePct(row) : null, leadersRow(lead, names))` as the `statsPanel` footer instead of `leadersRow(lead, names)`.

- [ ] **Step 5: The history page**

In `site/src/lib/charts.ts`:
- `export type HistoryMetric = 'messages' | 'data_messages' | 'usd_value' | 'fee_usd' | 'take_rate_bps' | 'unique_senders' | 'median_delivery_s';`
- `export const ADDITIVE: ReadonlySet<HistoryMetric> = new Set<HistoryMetric>(['messages', 'data_messages', 'usd_value', 'fee_usd']);`
- `const metricValue = (d: DayTotals, metric: HistoryMetric): number | null => (metric === 'take_rate_bps' ? takeRateBps(d) : (d[metric] ?? null));`
- Replace `rangeTotals` with:

```ts
export function rangeTotals(rows: readonly DayTotals[]): { messages: number; usd_value: number; fee_usd: number | null; data_messages: number | null } {
  const fees = rows.flatMap((d) => (d.fee_usd === null ? [] : [d.fee_usd]));
  const data = rows.flatMap((d) => (d.data_messages === undefined || d.data_messages === null ? [] : [d.data_messages]));
  return {
    messages: rows.reduce((s, d) => s + d.messages, 0),
    usd_value: rows.reduce((s, d) => s + d.usd_value, 0),
    fee_usd: fees.length === 0 ? null : fees.reduce((s, v) => s + v, 0),
    data_messages: data.length === 0 ? null : data.reduce((s, v) => s + v, 0),
  };
}

/** The share of messages without tokens, over the days that count them; null when none does. */
export function dataShareOf(rows: readonly DayTotals[]): number | null {
  const counted = rows.filter((d) => d.data_messages !== undefined && d.data_messages !== null);
  const messages = counted.reduce((s, d) => s + d.messages, 0);
  return messages === 0 ? null : (counted.reduce((s, d) => s + (d.data_messages ?? 0), 0) / messages) * 100;
}
```

In `site/src/components/HistoryCharts.tsx`, add to `METRICS` right after the messages entry:

```ts
  { key: 'data_messages', title: 'Data messages', format: formatCount, metric: 'messages', note: 'Messages that carry no tokens.' },
```

In `site/src/pages/history/[range].astro`, import `dataShareOf` with `rangeRows, rangeTotals`, and `formatShare` with `formatCount, formatUsd`; add `const dataShare = dataShareOf(rows);` after `const totals = …`; and add this tile after the Messages tile:

```astro
    {dataShare !== null && (
      <div class="tile"><span class="label">Data messages<InfoLink metric="messages" label="data messages" /></span><p class="value">{formatCount(totals.data_messages)}</p><span class="sub">{formatShare(dataShare)} of messages carry no tokens</span></div>
    )}
```

- [ ] **Step 6: Run the tests and the build**

```bash
pnpm --filter @ccip-dev/core exec vitest run test/broadcasts.test.ts
pnpm --filter @ccip-dev/site exec vitest run test/broadcast-cards.test.ts test/charts.test.ts
pnpm test && pnpm typecheck && pnpm --filter @ccip-dev/site build
```

Expected: all green. Before Checkpoint 2 the production `history.json` has no `data_messages`, so the build shows no Data tile and the chart reads "no data"; both appear once the Worker's next finalize publishes it.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/broadcasts.ts site/worker/cards/broadcast-cards.ts site/src/lib/charts.ts site/src/components/HistoryCharts.tsx "site/src/pages/history/[range].astro" \
  site/test/fixtures/broadcast.ts packages/core/test/broadcasts.test.ts site/test/broadcast-cards.test.ts site/test/charts.test.ts
git commit -m "feat(site): the data message share on the daily card and the history page

A muted \"62% data\" line on the daily card, and a Data messages tile and chart on
History; both stay hidden for days published before data messages were counted.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 7: The `projects.json` publisher

**Files:**
- Modify: `packages/core/src/labels.ts` (the project registry), `scripts/build-labels.ts`
- Create: `worker/src/generated/label-projects.json` (generated)
- Modify: `worker/src/labels.ts`, `worker/src/context.ts`, `worker/test/helpers.ts`
- Modify: `packages/core/src/public.ts`
- Modify: `worker/src/store.ts` (`senderLanes`)
- Create: `worker/src/projects.ts`
- Modify: `worker/src/publish.ts`
- Test: `packages/core/test/labels.test.ts`, `packages/core/test/public.test.ts`, `worker/test/projects.test.ts` (new)

**Interfaces:**
- **Consumes:** Task 1's registry and identity functions; Task 2's `senderDaysOf`, `senderTotalsOf`, `totalsBetween`, `senderChains`; Task 3's `senderBook`.
- **Produces:**
  - `interface RegistryEntry { name: string; x: string | null; url: string | null; kind: LabelKind; source: string | null; addresses: { chain: string; address: string; note: string | null }[] }`, `type ProjectRegistry = Record<string, RegistryEntry>`, `buildProjectRegistry(projects: readonly RegistryProject[]): ProjectRegistry` (verified only, addresses normalized).
  - `RunContext.projects: ProjectRegistry` (bundled from `label-projects.json`); `harness({ projects })`, default `{}`.
  - `store.senderLanes(db, fromDay, toDay, keys: readonly string[]): Promise<SenderLaneRow[]>`, `SenderLaneRow { key; dst_chain; messages; usd_value; data_messages }`.
  - `ProjectSchema`, `ProjectsFileSchema` (`{ from, to, projects }`), `type Project`, `type ProjectsFile`, and `'projects.json'` in `PUBLIC_SCHEMAS`.
  - `buildProjects(c, lastDay): Promise<ProjectsBody>`; `PROJECT_DAYS = 30`, `PROJECT_LANES = 5`. `projects.json` is published by `publishHistoryFiles` (finalize), before `triggerSiteBuild`.

**`projects.json`, per verified project:** `slug`, `name`, `x`, `url`, `kind`, `source`; `totals['7d' | '30d' | 'all']` = `{ messages, usd, fee_usd, share_pct }`; `series` (30 days, a zero for each quiet day); `chains` (source selectors over 30 days, busiest first); `lanes` (top 5 by messages over 30 days, from `messages`); `split` (`data_messages`, `token_messages` over 30 days); `addresses` (the label file's, on chains CCIP knows, then any a spread label credited in 30 days, `inferred: true`). Projects are sorted by 7-day messages, then name.

- [ ] **Step 1: Write the failing core tests**

Append to `packages/core/test/labels.test.ts` (adding `buildProjectRegistry` to its import):

```ts
describe('buildProjectRegistry', () => {
  it('keeps each verified project by slug, with its link, source and lowercased addresses, and leaves drafts out', () => {
    // #given
    const draft = project('0x1111111111111111111111111111111111111111').replace('verified = true', 'verified = false');
    const { projects } = validateRegistry([{ file: 'maple.toml', text: project(LINK) }, { file: '_draft.toml', text: draft }], chains);
    // #when
    const registry = buildProjectRegistry(projects);
    // #then
    expect(registry).toEqual({
      maple: { name: 'Maple Finance', x: 'maplefinance', url: null, kind: 'protocol', source: null, addresses: [{ chain: 'ethereum-mainnet', address: LINK.toLowerCase(), note: 'test' }] },
    });
  });
});
```

Append to `packages/core/test/public.test.ts` (adding `ProjectsFileSchema` to its import), inside `describe('public file schemas')`:

```ts
  it('parses projects.json and lists it among the public files', () => {
    // #given
    const window = { messages: 319, usd: 0, fee_usd: 79.75, share_pct: 20.3 };
    const doc = {
      ...envelope, from: '2026-09-14', to: '2026-10-13',
      projects: [{
        slug: 'xstocks', name: 'xStocks', x: 'xStocksFi', url: 'https://xstocks.fi', kind: 'protocol', source: null,
        totals: { '7d': window, '30d': window, all: window }, series: [{ day: '2026-10-13', messages: 319 }], chains: ['1'],
        lanes: [{ src: '1', dst: '2', messages: 2, usd: 0 }], split: { data_messages: 2, token_messages: 1 },
        addresses: [{ chain: '1', address: '0xa', note: null, inferred: true }],
      }],
    };
    // #when
    const parsed = ProjectsFileSchema.parse(doc);
    // #then
    expect({ slug: parsed.projects[0]?.slug, listed: PUBLIC_SCHEMAS['projects.json'] === ProjectsFileSchema }).toEqual({ slug: 'xstocks', listed: true });
  });
```

Run: `pnpm --filter @ccip-dev/core exec vitest run test/labels.test.ts test/public.test.ts`
Expected: FAIL.

- [ ] **Step 2: The registry and the schema**

Append to `packages/core/src/labels.ts`:

```ts
/** What a project page shows beyond the label index: its links, its source and every address its file lists. */
export interface RegistryEntry {
  name: string;
  x: string | null;
  url: string | null;
  kind: LabelProject['kind'];
  source: string | null;
  addresses: { chain: string; address: string; note: string | null }[];
}

/** Verified projects by slug. */
export type ProjectRegistry = Record<string, RegistryEntry>;

export function buildProjectRegistry(projects: readonly RegistryProject[]): ProjectRegistry {
  return Object.fromEntries(
    projects
      .filter((p) => p.verified)
      .map((p): [string, RegistryEntry] => [
        p.slug,
        {
          name: p.name,
          x: p.x ?? null,
          url: p.url ?? null,
          kind: p.kind,
          source: p.source,
          addresses: p.addresses.map((a) => ({ chain: a.chain, address: normalizeAddress(a.address), note: a.note ?? null })),
        },
      ]),
  );
}
```

In `packages/core/src/public.ts`, before `PUBLIC_SCHEMAS`, add:

```ts
const ProjectWindowSchema = z.object({ messages: z.number(), usd: z.number(), fee_usd: z.number().nullable(), share_pct: z.number().nullable() });

export const ProjectSchema = z.object({
  slug: z.string(),
  name: z.string(),
  x: z.string().nullable(),
  url: z.string().nullable(),
  kind: z.string(),
  source: z.string().nullable(),
  totals: z.object({ '7d': ProjectWindowSchema, '30d': ProjectWindowSchema, all: ProjectWindowSchema }),
  series: z.array(z.object({ day: z.string(), messages: z.number() })),
  chains: z.array(z.string()),
  lanes: z.array(z.object({ src: z.string(), dst: z.string(), messages: z.number(), usd: z.number() })),
  split: z.object({ data_messages: z.number(), token_messages: z.number() }),
  addresses: z.array(z.object({ chain: z.string(), address: z.string(), note: z.string().nullable(), inferred: z.boolean() })),
});

export const ProjectsFileSchema = z.object({ ...envelope, from: z.string(), to: z.string(), projects: z.array(ProjectSchema) });
```

add `'projects.json': ProjectsFileSchema,` to `PUBLIC_SCHEMAS` (after `'moments.json'`), and at the end:

```ts
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectsFile = z.infer<typeof ProjectsFileSchema>;
```

Run the core tests again: PASS.

- [ ] **Step 3: Build and bundle the registry**

In `scripts/build-labels.ts`, add `buildProjectRegistry` to the `@ccip-dev/core` import, and after the `labels.json` lines in the `else` branch add:

```ts
  const registry = buildProjectRegistry(projects);
  await writeFile(path.join(generated, 'label-projects.json'), `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`wrote ${Object.keys(registry).length} verified project(s) to worker/src/generated/label-projects.json`);
```

Run `pnpm labels:build`. Expected: a new `worker/src/generated/label-projects.json` with one entry per verified project (`xstocks` among them, its `source` the URL line from its file).

In `worker/src/labels.ts`:

```ts
import { labelKey, type Label, type LabelIndex, type ProjectRegistry } from '@ccip-dev/core';
import bundled from './generated/labels.json';
import bundledRegistry from './generated/label-projects.json';

export const bundledLabels: LabelIndex = bundled as LabelIndex;
export const bundledProjects: ProjectRegistry = bundledRegistry as ProjectRegistry;
```

(keeping `lookupLabel` as it is). In `worker/src/context.ts`: add `type ProjectRegistry` to the core import and `import { bundledLabels, bundledProjects } from './labels';`; add `projects: ProjectRegistry;` to `RunContext`; add `'projects'` to the `overrides` `Pick` list; and set `projects: overrides.projects ?? bundledProjects,`. In `worker/test/helpers.ts`: add `type ProjectRegistry` to the core import, `projects?: ProjectRegistry;` to `harness`'s options, and `projects: opts.projects ?? {},` to its overrides.

- [ ] **Step 4: Write the failing Worker tests**

Create `worker/test/projects.test.ts`:

```ts
import { buildLabelIndex, buildProjectRegistry, type RegistryProject } from '@ccip-dev/core';
import { PUBLIC_SCHEMAS } from '@ccip-dev/core/public';
import { NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_DAY, XSTOCKS_TOTALS, xstocksBreakdown } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProjects } from '../src/projects';
import { publishHistoryFiles } from '../src/publish';
import * as store from '../src/store';
import { harness, liveRow, readPublic, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-14T00:07:00.000Z';
const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const SOL = NETWORKS.solana.chainSelector;
const INK = NETWORKS.ink.chainSelector;
const XLAYER = NETWORKS.xlayer.chainSelector;
const HYPER = NETWORKS.hyperliquid.chainSelector;
const IDLE_ADDRESS = '0x00000000000000000000000000000000000000aa';

/** xStocks labeled on Ink and Solana only, so its other EVM chains come through label spread; Monad is not in the chains table. */
const XSTOCKS: RegistryProject = {
  name: 'xStocks', x: 'xStocksFi', url: 'https://xstocks.fi', kind: 'protocol', verified: true, spread: true, slug: 'xstocks',
  source: 'https://api.xstocks.fi/api/v2/public/bridges',
  addresses: [
    { chain: 'ethereum-mainnet-ink-1', address: XBRIDGE_EVM, note: 'xBridge (Ink)' },
    { chain: 'solana-mainnet', address: XBRIDGE_SOLANA, note: 'xBridge sender' },
    { chain: 'monad-mainnet', address: XBRIDGE_EVM },
  ],
  tokens: [],
};
const IDLE: RegistryProject = { name: 'Idle', kind: 'app', verified: true, spread: true, slug: 'idle', source: null, addresses: [{ chain: 'ethereum-mainnet', address: IDLE_ADDRESS }], tokens: [] };
const context = () => harness({ now: NOW, labels: buildLabelIndex([XSTOCKS, IDLE]), projects: buildProjectRegistry([XSTOCKS, IDLE]) });
const build = async () => buildProjects(context().c, XSTOCKS_DAY);
const xstocks = async () => (await build()).projects.find((p) => p.slug === 'xstocks')!;

beforeEach(async () => {
  // #given 2026-10-13's senders, 100 xBridge messages from Ink on Oct 1 (a day of 400), and three xStocks messages for its lanes
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc, NETWORKS.solana, NETWORKS.ink, NETWORKS.xlayer, NETWORKS.hyperliquid], []);
  await store.replaceDaily(env.DB, XSTOCKS_TOTALS, xstocksBreakdown(), NOW);
  await store.replaceDaily(env.DB, { ...XSTOCKS_TOTALS, day: '2026-10-01', messages: 400 }, [
    { day: '2026-10-01', dim: 'sender', key: `${INK}:${XBRIDGE_EVM}`, messages: 100, usd_value: 0, fee_usd: 25 },
  ], NOW);
  await store.upsertListRows(env.DB, [
    liveRow({ id: 'x1', sendTs: '2026-10-13T10:00:00.000Z', src: NETWORKS.ink, dst: NETWORKS.base, sender: XBRIDGE_EVM }),
    liveRow({ id: 'x2', sendTs: '2026-10-13T10:01:00.000Z', src: NETWORKS.ink, dst: NETWORKS.base, sender: XBRIDGE_EVM }),
    liveRow({ id: 'x3', sendTs: '2026-10-13T10:02:00.000Z', src: NETWORKS.solana, dst: NETWORKS.ethereum, sender: XBRIDGE_SOLANA }, { token_count: 1, usd_value: 500 }),
  ], []);
});

describe('projects.json', () => {
  it('gives a project its 7-day, 30-day and all-time totals and its share of all messages', async () => {
    // #then 319 of 1,569 over 7 days; 419 of 1,969 over 30 days and all time
    expect((await xstocks()).totals).toEqual({
      '7d': { messages: 319, usd: 0, fee_usd: 79.75, share_pct: 20.3 },
      '30d': { messages: 419, usd: 0, fee_usd: 104.75, share_pct: 21.3 },
      all: { messages: 419, usd: 0, fee_usd: 104.75, share_pct: 21.3 },
    });
  });

  it('gives a 30-day daily series with a zero for each quiet day', async () => {
    // #when
    const { series } = await xstocks();
    // #then
    expect({ length: series.length, first: series[0]?.day, busy: series.filter((s) => s.messages > 0) }).toEqual({
      length: 30,
      first: '2026-09-14',
      busy: [{ day: '2026-10-01', messages: 100 }, { day: XSTOCKS_DAY, messages: 319 }],
    });
  });

  it('lists its source chains busiest first, its top lanes and its data split, over 30 days', async () => {
    // #when
    const { chains, lanes, split } = await xstocks();
    // #then
    expect({ chains, lanes, split }).toEqual({
      chains: [INK, SOL, XLAYER, BSC, ETH, HYPER],
      lanes: [{ src: INK, dst: BASE, messages: 2, usd: 0 }, { src: SOL, dst: ETH, messages: 1, usd: 500 }],
      split: { data_messages: 2, token_messages: 1 },
    });
  });

  it("lists its label file's addresses on chains CCIP knows, then those a spread label credited, marked inferred", async () => {
    // #then
    expect((await xstocks()).addresses).toEqual([
      { chain: INK, address: XBRIDGE_EVM, note: 'xBridge (Ink)', inferred: false },
      { chain: SOL, address: XBRIDGE_SOLANA, note: 'xBridge sender', inferred: false },
      { chain: XLAYER, address: XBRIDGE_EVM, note: null, inferred: true },
      { chain: BSC, address: XBRIDGE_EVM, note: null, inferred: true },
      { chain: ETH, address: XBRIDGE_EVM, note: null, inferred: true },
      { chain: HYPER, address: XBRIDGE_EVM, note: null, inferred: true },
    ]);
  });

  it('lists a project with no activity after the busy ones, with zeros, an empty series and its addresses', async () => {
    // #when
    const { projects } = await build();
    const idle = projects.find((p) => p.slug === 'idle')!;
    // #then
    expect({
      order: projects.map((p) => p.slug),
      week: idle.totals['7d'],
      series: idle.series.every((s) => s.messages === 0),
      rest: [idle.chains, idle.lanes, idle.split, idle.addresses],
    }).toEqual({
      order: ['xstocks', 'idle'],
      week: { messages: 0, usd: 0, fee_usd: null, share_pct: 0 },
      series: true,
      rest: [[], [], { data_messages: 0, token_messages: 0 }, [{ chain: ETH, address: IDLE_ADDRESS, note: null, inferred: false }]],
    });
  });

  it('is published with the history files and matches its public schema', async () => {
    // #when
    await publishHistoryFiles(context().c);
    // #then
    const file = await readPublic('projects.json');
    expect({ valid: PUBLIC_SCHEMAS['projects.json'].safeParse(file).success, from: file.from, to: file.to }).toEqual({ valid: true, from: '2026-09-14', to: XSTOCKS_DAY });
  });

  it('raises one projects-publish alert when it fails, and still publishes the other history files', async () => {
    // #given
    vi.spyOn(store, 'senderLanes').mockRejectedValueOnce(new Error('D1 unavailable'));
    const { c, alerts } = context();
    // #when
    await publishHistoryFiles(c);
    // #then
    expect({
      projects: await env.PUBLIC.get('v1/projects.json'),
      history: (await env.PUBLIC.get('v1/history.json')) !== null,
      alerts: alerts.filter((a) => a.signature === 'projects-publish'),
    }).toEqual({ projects: null, history: true, alerts: [{ signature: 'projects-publish', text: 'projects.json was not published: D1 unavailable' }] });
  });
});
```

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/projects.test.ts`
Expected: FAIL, because `../src/projects` does not exist.

- [ ] **Step 5: The lanes query**

In `worker/src/store.ts`, add after `messagesByDay`:

```ts
export interface SenderLaneRow {
  key: string;
  dst_chain: string;
  messages: number;
  usd_value: number;
  data_messages: number;
}

/** Messages by sender key and destination over [?1, ?2], for the keys in the JSON list ?3, with how many carried no tokens. */
export const SENDER_LANES_SQL = `SELECT src_chain || ':' || sender AS key, dst_chain, COUNT(*) AS messages, SUM(usd_value) AS usd_value,
    SUM(CASE WHEN token_count = 0 THEN 1 ELSE 0 END) AS data_messages
  FROM messages WHERE day >= ?1 AND day <= ?2 AND (src_chain || ':' || sender) IN (SELECT value FROM json_each(?3))
  GROUP BY src_chain, sender, dst_chain ORDER BY key, dst_chain`;

export async function senderLanes(db: D1Database, fromDay: string, toDay: string, keys: readonly string[]): Promise<SenderLaneRow[]> {
  const { results } = await db.prepare(SENDER_LANES_SQL).bind(fromDay, toDay, JSON.stringify(keys)).all<SenderLaneRow>();
  return results;
}
```

- [ ] **Step 6: The builder**

Create `worker/src/projects.ts`:

```ts
import {
  addDays, daysBetween, mergeIdentities, projectKey, senderKeyAddress, sharePct, type IdentityTotals, type RegistryEntry, type SenderIdentity,
} from '@ccip-dev/core';
import type { ProjectsFile } from '@ccip-dev/core/public';
import type { RunContext } from './context';
import { senderBook } from './senders';
import * as store from './store';

export type ProjectsBody = Omit<ProjectsFile, 'schema_version' | 'updated_at' | 'attribution'>;
type Project = ProjectsBody['projects'][number];
type ProjectWindow = Project['totals']['7d'];

/** A project page's series, chains and lanes cover the last 30 finalized days, as Top's 30-day window does. */
export const PROJECT_DAYS = 30;
export const PROJECT_LANES = 5;

const cents = (v: number) => Math.round(v * 100) / 100;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function windowOf(identity: IdentityTotals | undefined, total: store.WindowTotals): ProjectWindow {
  return {
    messages: identity?.messages ?? 0,
    usd: cents(identity?.usd_value ?? 0),
    fee_usd: identity === undefined || identity.fee_usd === null ? null : cents(identity.fee_usd),
    share_pct: sharePct(identity?.messages ?? 0, total.messages),
  };
}

/** Every verified project as of the end of `lastDay`. */
export async function buildProjects(c: RunContext, lastDay: string): Promise<ProjectsBody> {
  const db = c.env.DB;
  const book = await senderBook(c);
  const from7 = addDays(lastDay, -6);
  const from30 = addDays(lastDay, -(PROJECT_DAYS - 1));
  const dayRows = await store.senderDaysOf(db, from30, lastDay, book.labeled);
  const month = mergeIdentities(dayRows, book.resolve);
  const week = mergeIdentities(dayRows.filter((r) => r.day >= from7), book.resolve);
  const allTime = mergeIdentities(await store.senderTotalsOf(db, null, lastDay, book.labeled), book.resolve);
  const totals = {
    '7d': await store.totalsBetween(db, from7, lastDay),
    '30d': await store.totalsBetween(db, from30, lastDay),
    all: await store.totalsBetween(db, null, lastDay),
  };
  const projectKeys = month.filter((i) => i.slug !== null).flatMap((i) => i.keys);
  const lanes = projectKeys.length === 0 ? [] : await store.senderLanes(db, from30, lastDay, projectKeys);
  const selectorOf = new Map([...(await store.senderChains(db))].map(([selector, chain]) => [chain.name, selector]));
  const identityOfKey = (key: string) => book.resolve(key.slice(0, key.indexOf(':')), senderKeyAddress(key));
  const days = daysBetween(from30, lastDay);

  const projects = Object.entries(c.projects).map(([slug, entry]): Project => {
    const key = projectKey(slug);
    const find = (list: readonly IdentityTotals[]) => list.find((i) => i.key === key);
    const thisMonth = find(month);
    const perDay = new Map<string, number>();
    for (const r of dayRows) if (identityOfKey(r.key).key === key) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.messages);
    return {
      slug,
      name: entry.name,
      x: entry.x,
      url: entry.url,
      kind: entry.kind,
      source: entry.source,
      totals: { '7d': windowOf(find(week), totals['7d']), '30d': windowOf(thisMonth, totals['30d']), all: windowOf(find(allTime), totals.all) },
      series: days.map((day) => ({ day, messages: perDay.get(day) ?? 0 })),
      chains: thisMonth?.chains ?? [],
      ...lanesOf(lanes.filter((l) => thisMonth?.keys.includes(l.key) ?? false)),
      addresses: addressesOf(entry, thisMonth, selectorOf, identityOfKey),
    };
  });
  projects.sort((a, b) => b.totals['7d'].messages - a.totals['7d'].messages || compare(a.name, b.name));
  return { from: from30, to: lastDay, projects };
}

/** The top lanes by messages, and the data and token split over all of them. */
function lanesOf(rows: readonly store.SenderLaneRow[]): Pick<Project, 'lanes' | 'split'> {
  const byLane = new Map<string, { src: string; dst: string; messages: number; usd: number }>();
  let data = 0;
  let messages = 0;
  for (const r of rows) {
    const src = r.key.slice(0, r.key.indexOf(':'));
    const id = `${src}>${r.dst_chain}`;
    const lane = byLane.get(id) ?? { src, dst: r.dst_chain, messages: 0, usd: 0 };
    lane.messages += r.messages;
    lane.usd += r.usd_value;
    byLane.set(id, lane);
    data += r.data_messages;
    messages += r.messages;
  }
  const lanes = [...byLane.values()]
    .sort((a, b) => b.messages - a.messages || b.usd - a.usd || compare(`${a.src}>${a.dst}`, `${b.src}>${b.dst}`))
    .slice(0, PROJECT_LANES)
    .map((l) => ({ ...l, usd: cents(l.usd) }));
  return { lanes, split: { data_messages: data, token_messages: messages - data } };
}

/** The label file's addresses on chains CCIP knows, then those a spread label credited over the month, busiest chain first. */
function addressesOf(
  entry: RegistryEntry,
  month: IdentityTotals | undefined,
  selectorOf: ReadonlyMap<string, string>,
  identityOfKey: (key: string) => SenderIdentity,
): Project['addresses'] {
  const listed = entry.addresses.flatMap((a) => {
    const chain = selectorOf.get(a.chain);
    return chain === undefined ? [] : [{ chain, address: a.address, note: a.note, inferred: false }];
  });
  const known = new Set(listed.map((a) => `${a.chain}:${a.address}`));
  const inferred = (month?.chains ?? []).flatMap((chain) =>
    (month?.keys ?? [])
      .filter((key) => key.startsWith(`${chain}:`) && !known.has(key) && identityOfKey(key).inferred)
      .map((key) => ({ chain, address: senderKeyAddress(key), note: null, inferred: true })),
  );
  return [...listed, ...inferred];
}
```

- [ ] **Step 7: Publish it with the history files**

In `worker/src/publish.ts`: add `projects: 300` to `TTL`, `import { buildProjects } from './projects';`, and in `publishHistoryFiles`, after the `moments.json` try block:

```ts
  try {
    await putJson(c.env.PUBLIC, 'projects.json', await buildProjects(c, addDays(dayOf(now), -1)), TTL.projects, now);
  } catch (err) {
    await c.alert('projects-publish', `projects.json was not published: ${err instanceof Error ? err.message : String(err)}`);
  }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/projects.test.ts test/publish.test.ts`
Expected: PASS (the `'public file contract'` test now also validates `projects.json`, with no projects).

- [ ] **Step 9: Run everything and commit**

```bash
pnpm test && pnpm typecheck && pnpm labels:check
git add packages/core/src/labels.ts packages/core/src/public.ts scripts/build-labels.ts worker/src/generated/label-projects.json worker/src/labels.ts worker/src/context.ts \
  worker/src/store.ts worker/src/projects.ts worker/src/publish.ts worker/test/helpers.ts worker/test/projects.test.ts packages/core/test/labels.test.ts packages/core/test/public.test.ts
git commit -m "feat(worker): publish projects.json at finalize

Each verified project with its 7-day, 30-day and all-time totals and share, its
30-day series, chains, top lanes and data split, and its addresses (spread ones
marked inferred), for the project pages the site builds next.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

#### Checkpoint 2 (controller, after Task 7 is reviewed): push, and check the migration and the new files

Push `main`. `deploy` applies migration `0006_data_messages` before deploying the Worker; `site` redeploys the card and the history page. When both are green:
- The deploy log's "Apply migrations" step lists `0006_data_messages.sql` as applied.
- Within a minute, `today.json` `totals.data_messages` is a number.
- After the next finalize (00:07 UTC):
  - `history.json` days all carry `data_messages` (the backfill), and `https://ccip.dev/history/30d/` shows the Data messages tile after the site's own 00:25 build;
  - `https://data.ccip.dev/v1/projects.json` lists every verified project (xStocks first or near it), and validates: `curl -s https://data.ccip.dev/v1/projects.json | jq '.projects[] | {slug, week: .totals["7d"].messages}'`;
  - the daily card shows `NN% data` under its stats.

From here on, Task 8's local build can render real project pages.

---

### Task 8: Project pages, their card, and the menu links

**Files:**
- Create: `site/src/lib/projects.ts`
- Create: `site/src/pages/projects/index.astro`, `site/src/pages/projects/[slug].astro`
- Modify: `site/src/lib/card-paths.ts`, `site/worker/og.ts`, `site/worker/cards/content.ts`
- Modify: `site/src/components/Header.astro`, `site/src/components/Footer.astro`
- Create: `site/test/fixtures/projects.json`
- Test: `site/test/projects.test.ts` (new), `site/test/card-paths.test.ts`, `site/test/card-content.test.ts`, `site/test/socials.test.ts`

**Interfaces:**
- **Consumes:** `ProjectsFile`, `Project` from Task 7; `buildDataIfPublished`.
- **Produces** (from `site/src/lib/projects.ts`): `PROJECT_KIND_LABEL`, `kindLabel(kind)`, `projectHref(slug)`, `addressExplorerUrl(address)`, `xProfileUrl(handle)`, `labelFileUrl(slug)`, `projectPaths(file: ProjectsFile | null)`, `interface ProjectIndexRow`, `projectIndexRows(projects)`, `seriesPoints(series): ChartPoint[]`, `splitText(split): string | null`. `CardRoute` gains `{ kind: 'project'; slug: string }` (path `project/<slug>`); `projectCard(file, slug): CardSpec | null` in `site/worker/cards/content.ts`.

**Ruling:** addresses link to the CCIP Explorer's address page, which serves every chain family. A project's "source line" is its label file's first `# Source:` comment, beside a link to the file.

- [ ] **Step 1: Add the fixture**

Create `site/test/fixtures/projects.json` (the shape Task 7 publishes, with a short series):

```json
{
  "schema_version": 1,
  "updated_at": "2026-10-14T00:07:00.000Z",
  "attribution": "Data: Chainlink CCIP API, DefiLlama",
  "from": "2026-09-14",
  "to": "2026-10-13",
  "projects": [
    {
      "slug": "xstocks",
      "name": "xStocks",
      "x": "xStocksFi",
      "url": "https://xstocks.fi",
      "kind": "protocol",
      "source": "https://api.xstocks.fi/api/v2/public/bridges",
      "totals": {
        "7d": { "messages": 319, "usd": 0, "fee_usd": 79.75, "share_pct": 20.3 },
        "30d": { "messages": 419, "usd": 0, "fee_usd": 104.75, "share_pct": 21.3 },
        "all": { "messages": 419, "usd": 0, "fee_usd": 104.75, "share_pct": 21.3 }
      },
      "series": [{ "day": "2026-10-11", "messages": 0 }, { "day": "2026-10-12", "messages": 100 }, { "day": "2026-10-13", "messages": 319 }],
      "chains": ["3461204551265785888", "124615329519749607", "3016212468291539606", "11344663589394136015", "5009297550715157269", "2442541497099098535"],
      "lanes": [
        { "src": "3461204551265785888", "dst": "15971525489660198786", "messages": 2, "usd": 0 },
        { "src": "124615329519749607", "dst": "5009297550715157269", "messages": 1, "usd": 500 }
      ],
      "split": { "data_messages": 2, "token_messages": 1 },
      "addresses": [
        { "chain": "3461204551265785888", "address": "0x9ec0e4a4c411493773e01e2abf4d42395788846b", "note": "xBridge (Ink)", "inferred": false },
        { "chain": "124615329519749607", "address": "A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u", "note": "xBridge sender", "inferred": false },
        { "chain": "3016212468291539606", "address": "0x9ec0e4a4c411493773e01e2abf4d42395788846b", "note": null, "inferred": true }
      ]
    },
    {
      "slug": "idle",
      "name": "Idle",
      "x": null,
      "url": null,
      "kind": "app",
      "source": null,
      "totals": {
        "7d": { "messages": 0, "usd": 0, "fee_usd": null, "share_pct": 0 },
        "30d": { "messages": 0, "usd": 0, "fee_usd": null, "share_pct": 0 },
        "all": { "messages": 0, "usd": 0, "fee_usd": null, "share_pct": 0 }
      },
      "series": [{ "day": "2026-10-13", "messages": 0 }],
      "chains": [],
      "lanes": [],
      "split": { "data_messages": 0, "token_messages": 0 },
      "addresses": [{ "chain": "5009297550715157269", "address": "0x00000000000000000000000000000000000000aa", "note": null, "inferred": false }]
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `site/test/projects.test.ts`:

```ts
import { PUBLIC_SCHEMAS } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { addressExplorerUrl, kindLabel, labelFileUrl, projectIndexRows, projectPaths, seriesPoints, splitText } from '../src/lib/projects';
import fixture from './fixtures/projects.json';

const FILE = PUBLIC_SCHEMAS['projects.json'].parse(fixture);
const [XSTOCKS, IDLE] = FILE.projects;

describe('project pages', () => {
  it('builds one page per project, and none before projects.json is published', () => {
    // #then
    expect([projectPaths(FILE).map((p) => p.params.slug), projectPaths(null)]).toEqual([['xstocks', 'idle'], []]);
  });

  it('lists the projects in the file’s order with their kind, handle, 7-day messages and share, 30-day value and chains', () => {
    // #when
    const [row] = projectIndexRows(FILE.projects);
    // #then
    expect(row).toEqual({
      slug: 'xstocks', href: '/projects/xstocks/', name: 'xStocks', kind: 'Protocol', x: 'xStocksFi',
      messages7d: 319, share7d: 20.3, usd30d: 0, chains: XSTOCKS!.chains,
    });
  });

  it('words the data split, and has none for a project without messages', () => {
    // #then
    expect([splitText(XSTOCKS!.split), splitText(IDLE!.split)]).toEqual(['67% data messages · 33% token transfers', null]);
  });

  it('charts the series day by day', () => {
    // #then
    expect(seriesPoints(XSTOCKS!.series)).toEqual([{ day: '2026-10-11', value: 0 }, { day: '2026-10-12', value: 100 }, { day: '2026-10-13', value: 319 }]);
  });

  it('links an address to the CCIP Explorer, a project to its label file, and names an unknown kind a project', () => {
    // #then
    expect([addressExplorerUrl('A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u'), labelFileUrl('xstocks'), kindLabel('issuer'), kindLabel('robot')]).toEqual([
      'https://ccip.chain.link/address/A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u',
      'https://github.com/momentmaker/ccip-dev/blob/main/labels/projects/xstocks.toml',
      'Token issuer',
      'Project',
    ]);
  });
});
```

In `site/test/card-paths.test.ts`, add `['project/xstocks', { kind: 'project', slug: 'xstocks' }],` to the round-trip list, and `'project/XStocks', 'project/a/b', 'project'` to the rejected list.

Append to `site/test/card-content.test.ts` (adding `projectCard` to its `../worker/cards/content` import, and `import projects from './fixtures/projects.json';` plus `import { PUBLIC_SCHEMAS } from '@ccip-dev/core/public';`):

```ts
describe('project card', () => {
  const file = PUBLIC_SCHEMAS['projects.json'].parse(projects);

  it("shows a project's week, its share, and its 30 days", () => {
    // #then
    expect(projectCard(file, 'xstocks')).toEqual({
      eyebrow: 'XSTOCKS ON CHAINLINK CCIP',
      big: '319',
      label: 'messages in the last 7 days · 20% of all',
      date: 'to Oct 13, 2026',
      extra: ['419 messages in 30 days', 'ccip.dev/projects/xstocks'],
      spark: [0, 100, 319],
      badge: null,
    });
  });

  it('has no card for a project the file does not list', () => {
    // #then
    expect(projectCard(file, 'nobody')).toBeNull();
  });
});
```

In `site/test/socials.test.ts`, add inside its first `describe` that reads sources (next to `'lists the roster in the header menu, the footer links and the about page'`):

```ts
  it('lists the projects in the header menu and the footer links', () => {
    // #then
    expect([
      source('../src/components/Header.astro').includes("{ href: '/projects/', label: 'Projects' }"),
      source('../src/components/Footer.astro').includes('<a href="/projects/">Projects</a>'),
    ]).toEqual([true, true]);
  });
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/projects.test.ts test/card-paths.test.ts test/card-content.test.ts test/socials.test.ts`
Expected: FAIL.

- [ ] **Step 3: The view helpers**

Create `site/src/lib/projects.ts`:

```ts
import type { Project, ProjectsFile } from '@ccip-dev/core/public';
import { REPO_URL } from '../config';
import type { ChartPoint } from './charts';
import { formatShare } from './format';

export const PROJECT_KIND_LABEL: Readonly<Record<string, string>> = {
  protocol: 'Protocol',
  app: 'App',
  institution: 'Institution',
  exchange: 'Exchange',
  issuer: 'Token issuer',
  unknown: 'Project',
};

export const kindLabel = (kind: string): string => PROJECT_KIND_LABEL[kind] ?? 'Project';
export const projectHref = (slug: string): string => `/projects/${slug}/`;
/** The CCIP Explorer's page for a sender address: one URL for every chain family. */
export const addressExplorerUrl = (address: string): string => `https://ccip.chain.link/address/${address}`;
export const xProfileUrl = (handle: string): string => `https://x.com/${handle}`;
export const labelFileUrl = (slug: string): string => `${REPO_URL}/blob/main/labels/projects/${slug}.toml`;

/** One page per project; none while projects.json is not published yet. */
export function projectPaths(file: ProjectsFile | null): { params: { slug: string }; props: { project: Project } }[] {
  return (file?.projects ?? []).map((project) => ({ params: { slug: project.slug }, props: { project } }));
}

export interface ProjectIndexRow {
  slug: string;
  href: string;
  name: string;
  kind: string;
  x: string | null;
  messages7d: number;
  share7d: number | null;
  usd30d: number;
  chains: string[];
}

/** The index rows, in the file's order (busiest over 7 days first). */
export function projectIndexRows(projects: readonly Project[]): ProjectIndexRow[] {
  return projects.map((p) => ({
    slug: p.slug,
    href: projectHref(p.slug),
    name: p.name,
    kind: kindLabel(p.kind),
    x: p.x,
    messages7d: p.totals['7d'].messages,
    share7d: p.totals['7d'].share_pct,
    usd30d: p.totals['30d'].usd,
    chains: p.chains,
  }));
}

export function seriesPoints(series: Project['series']): ChartPoint[] {
  return series.map((s) => ({ day: s.day, value: s.messages }));
}

/** "62% data messages · 38% token transfers"; null for a project with no messages. */
export function splitText(split: Project['split']): string | null {
  const total = split.data_messages + split.token_messages;
  if (total === 0) return null;
  const data = (split.data_messages / total) * 100;
  return `${formatShare(data)} data messages · ${formatShare(100 - data)} token transfers`;
}
```

- [ ] **Step 4: The card route and the card**

In `site/src/lib/card-paths.ts`:
- add `| { kind: 'project'; slug: string }` to `CardRoute`;
- in `parseCardPath`, after the `replay` line: `if (head === 'project' && parts.length === 2) return a !== undefined && SLUG.test(a) ? { kind: 'project', slug: a } : null;`
- in `cardPathOf`: `case 'project': return \`project/${route.slug}\`;`

In `site/worker/cards/content.ts`, add `ProjectsFile` to the `@ccip-dev/core/public` type import and `formatShare` to the format import, then:

```ts
export function projectCard(file: ProjectsFile, slug: string): CardSpec | null {
  const p = file.projects.find((x) => x.slug === slug);
  if (!p) return null;
  const week = p.totals['7d'];
  const month = p.totals['30d'];
  return {
    eyebrow: `${p.name.toUpperCase()} ON CHAINLINK CCIP`,
    big: formatCount(week.messages),
    label: `messages in the last 7 days${week.share_pct === null ? '' : ` · ${formatShare(week.share_pct)} of all`}`,
    date: `to ${formatUtcDay(file.to)}`,
    extra: [month.usd > 0 ? `${formatUsd(month.usd)} moved in 30 days` : `${formatCount(month.messages)} messages in 30 days`, `ccip.dev/projects/${slug}`],
    spark: sparkPoints(p.series.map((s) => s.messages)),
    badge: null,
  };
}
```

In `site/worker/og.ts`, import `projectCard` with the other cards and add to `build`'s switch:

```ts
    case 'project': {
      const spec = projectCard(await load('projects.json'), route.slug);
      return spec ? { spec, maxAge: cardMaxAge(route, null) } : null;
    }
```

- [ ] **Step 5: The pages**

Create `site/src/pages/projects/index.astro`:

```astro
---
import ChainIcons from '../../components/ChainIcons.astro';
import Base from '../../layouts/Base.astro';
import { buildDataIfPublished } from '../../lib/build-data';
import { formatCount, formatShare, formatUsd } from '../../lib/format';
import { projectIndexRows, xProfileUrl } from '../../lib/projects';

const file = await buildDataIfPublished('projects.json');
const rows = file ? projectIndexRows(file.projects) : [];
---
<Base title="Projects" description="Every project with a verified label on its CCIP senders: messages, value and chains.">
  <h1>Projects</h1>
  <p class="muted">Projects with a verified label on their CCIP senders, busiest over the last 7 days first. A project counts every address its label names, on every chain. <a href="/top/sender/7d/">Top senders</a> ranks every sender.</p>
  {rows.length === 0 ? (
    <p class="card muted">Project pages appear after the next daily update.</p>
  ) : (
    <div class="table-wrap card">
      <table class="data">
        <thead><tr><th>Project</th><th class="num">Messages (7d)</th><th class="num">Share (7d)</th><th class="num">Value (30d)</th><th>Chains</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td>
                <a href={r.href}>{r.name}</a><span class="verified" title="Verified label" aria-label="verified">✓</span>
                <span class="secondary">{r.kind}{r.x && <> · <a href={xProfileUrl(r.x)} rel="noopener">@{r.x}</a></>}</span>
              </td>
              <td class="num">{formatCount(r.messages7d)}</td>
              <td class="num muted">{formatShare(r.share7d)}</td>
              <td class="num">{formatUsd(r.usd30d)}</td>
              <td><ChainIcons selectors={r.chains} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</Base>
```

Create `site/src/pages/projects/[slug].astro`:

```astro
---
import type { Project } from '@ccip-dev/core/public';
import ChainIcons from '../../components/ChainIcons.astro';
import ShareButton from '../../components/ShareButton';
import Base from '../../layouts/Base.astro';
import { buildData, buildDataIfPublished } from '../../lib/build-data';
import { CHART_H, CHART_W, chartGeometry, chartSummary } from '../../lib/charts';
import { formatCount, formatFeeTotal, formatShare, formatUsd } from '../../lib/format';
import { chainName, chainNameMap, laneLabel } from '../../lib/names';
import { addressExplorerUrl, kindLabel, labelFileUrl, projectPaths, seriesPoints, splitText, xProfileUrl } from '../../lib/projects';
import '../../styles/history.css';

export async function getStaticPaths() {
  return projectPaths(await buildDataIfPublished('projects.json'));
}

const { project } = Astro.props as { project: Project };
const chains = await buildData('chains.json');
const names = chainNameMap(chains.chains);
const points = seriesPoints(project.series);
const geo = chartGeometry(points, CHART_W, CHART_H);
const split = splitText(project.split);
const WINDOWS = [['7d', 'last 7 days'], ['30d', 'last 30 days']] as const;
const cardPath = `project/${project.slug}`;
const week = project.totals['7d'];
---
<Base title={`${project.name} on CCIP`} description={`${project.name} on Chainlink CCIP: ${formatCount(week.messages)} messages in the last 7 days, with its chains, lanes and addresses.`} cardPath={cardPath}>
  <div class="page-head">
    <div>
      <p class="label">{kindLabel(project.kind)} · <a href="/projects/">Projects</a></p>
      <h1>{project.name}<span class="verified" title="Verified label" aria-label="verified">✓</span></h1>
      <p class="muted">
        {project.url && <a href={project.url} rel="noopener">{project.url.replace(/^https?:\/\//, '')}</a>}
        {project.url && project.x && ' · '}
        {project.x && <a href={xProfileUrl(project.x)} rel="noopener">@{project.x}</a>}
      </p>
    </div>
    <ShareButton client:load view={cardPath} headline={`${project.name} on CCIP: ${formatCount(week.messages)} messages in the last 7 days`} url={`https://ccip.dev/projects/${project.slug}/`} cardUrl={`/og/${cardPath}.png`} />
  </div>
  {WINDOWS.map(([w, label]) => {
    const t = project.totals[w];
    return (
      <section class="tiles project-window" aria-label={label}>
        <div class="tile"><span class="label">Messages, {label}</span><p class="value">{formatCount(t.messages)}</p></div>
        <div class="tile"><span class="label">Value, {label}</span><p class="value">{formatUsd(t.usd)}</p></div>
        <div class="tile"><span class="label">Fees, {label}</span><p class="value">{formatFeeTotal(t.fee_usd)}</p></div>
        <div class="tile"><span class="label">Share of messages, {label}</span><p class="value">{formatShare(t.share_pct)}</p></div>
      </section>
    );
  })}
  <figure class="card chart">
    <figcaption><span class="label">Messages per day, last 30 days</span></figcaption>
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" role="img" aria-label={chartSummary('Messages', points, formatCount, false)}>
      <path d={geo.area} class="chart-area" />
      <path d={geo.line} class="chart-line" vector-effect="non-scaling-stroke" />
    </svg>
  </figure>
  <h2>Chains and lanes</h2>
  {project.chains.length === 0 ? (
    <p class="muted">No messages in the last 30 days.</p>
  ) : (
    <>
      <p>Sends from {project.chains.map((s, i) => <>{i > 0 && ' · '}<ChainIcons selectors={[s]} />{chainName(names, s)}</>)}</p>
      <div class="table-wrap card">
        <table class="data">
          <thead><tr><th>Top lanes, last 30 days</th><th class="num">Messages</th><th class="num">Value</th></tr></thead>
          <tbody>
            {project.lanes.map((l) => (
              <tr><td><ChainIcons selectors={[l.src, l.dst]} />{laneLabel(names, `${l.src}>${l.dst}`)}</td><td class="num">{formatCount(l.messages)}</td><td class="num">{formatUsd(l.usd)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {split && <p class="muted">{split}, last 30 days.</p>}
    </>
  )}
  <h2>Addresses</h2>
  <div class="table-wrap card">
    <table class="data">
      <thead><tr><th>Chain</th><th>Address</th><th>Note</th></tr></thead>
      <tbody>
        {project.addresses.map((a) => (
          <tr>
            <td><ChainIcons selectors={[a.chain]} />{chainName(names, a.chain)}</td>
            <td class="mono"><a href={addressExplorerUrl(a.address)} rel="noopener">{a.address}</a>{a.inferred && <span class="inferred" title="The same address is labeled on another chain">inferred</span>}</td>
            <td class="muted">{a.note ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  <p class="muted">Source: {project.source ?? 'see the label file'} · Label: <a href={labelFileUrl(project.slug)}>labels/projects/{project.slug}.toml</a>. "inferred" marks the same address on another chain, credited to the project through its label.</p>
</Base>

<style>
  .project-window { margin-top: 12px; }
  .mono { font-family: var(--font-mono); overflow-wrap: anywhere; }
</style>
```

Add to `site/src/styles/base.css`, after the `.verified` rule:

```css
.inferred { margin-left: 6px; padding: 0 6px; border: 1px dashed var(--border); border-radius: 999px; color: var(--muted); font-size: 11px; white-space: nowrap; }
```

In `site/src/components/Header.astro`'s `MORE`, after `{ href: '/chains/', label: 'Chains' },`, add `{ href: '/projects/', label: 'Projects' },`. In `site/src/components/Footer.astro`, put `<a href="/projects/">Projects</a>{' · '}` before `<a href="/methodology/">Methodology</a>`.

- [ ] **Step 6: Run the tests, the typecheck and the build**

```bash
pnpm --filter @ccip-dev/site exec vitest run test/projects.test.ts test/card-paths.test.ts test/card-content.test.ts test/socials.test.ts
pnpm test && pnpm typecheck && pnpm --filter @ccip-dev/site build
```

Expected: all green. If Checkpoint 2's finalize has run, the build lists a `/projects/<slug>/` page per verified project and `check-build` accepts each page's `og:image` (`/og/project/<slug>.png`). If not, `/projects/` builds with its "appear after the next daily update" note and the build logs `projects.json is not published yet; building without it`.

- [ ] **Step 7: Build the pages from the fixture**

So the pages are checked whatever production holds, serve the fixture beside the production files and build against it:

```bash
D=/private/tmp/claude-501/-Users-rubberduck-GitHub-momentmaker-ccip-dev/19cabbec-cd1e-4fc5-a2ef-ade789a597b9/scratchpad/projects-data
mkdir -p "$D/v1/top"
for f in status live today history chains tokens reserve replay cost day-leaders moments top/lane top/token top/sender top/src_chain top/dst_chain; do curl -sf "https://data.ccip.dev/v1/$f.json" -o "$D/v1/$f.json"; done
cp site/test/fixtures/projects.json "$D/v1/projects.json"
(cd "$D" && python3 -m http.server 8799 >/dev/null 2>&1 &)
CCIP_DATA_BASE=http://localhost:8799/v1 pnpm --filter @ccip-dev/site build
ls site/dist/projects/xstocks/index.html site/dist/projects/idle/index.html
```

Expected: both pages exist and `check-build` passes. Open `site/dist/projects/xstocks/index.html` in a browser (or `astro preview`) and check the header, the tiles, the chart, the chains and lanes, the addresses with the "inferred" mark on X Layer, and the source line; then `idle` (zeros, "No messages in the last 30 days."). Stop the server (`pkill -f "http.server 8799"`). If the sandbox blocks the downloads, say so and rely on Step 6.

- [ ] **Step 8: Commit**

```bash
git add site/src/lib/projects.ts site/src/pages/projects/index.astro "site/src/pages/projects/[slug].astro" site/src/lib/card-paths.ts site/worker/og.ts site/worker/cards/content.ts \
  site/src/components/Header.astro site/src/components/Footer.astro site/src/styles/base.css site/test/fixtures/projects.json site/test/projects.test.ts \
  site/test/card-paths.test.ts site/test/card-content.test.ts site/test/socials.test.ts
git commit -m "feat(site): project pages at /projects/ and /projects/<slug>/, with a share card

Every verified project: its 7- and 30-day messages, value, fees and share, a 30-day
chart, its chains and top lanes, the data split, its addresses (spread ones marked
inferred) and its label's source. Built from projects.json, and empty until it exists.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 9: Top › Senders by identity, the day's top sender, and "Suggest a label"

**Files:**
- Create: `site/src/lib/senders.ts`
- Modify: `site/src/lib/top.ts` (optional link fields on `TopRow`)
- Modify: `site/src/pages/top/[dim]/[window]/[...order].astro`, `site/src/pages/day/[day].astro`
- Modify: `site/worker/cards/content.ts` (the Top senders card reads identities)
- Modify: `site/src/styles/base.css`
- Create: `.github/ISSUE_TEMPLATE/label.yml`
- Test: `site/test/senders.test.ts` (new), `site/test/card-content.test.ts`

**Interfaces:**
- **Consumes:** `parseSenderKey` (`@ccip-dev/core/senders`); identity fields on `TopEntry`/`Leader` (Task 3); `projectHref`, `addressExplorerUrl` (Task 8).
- **Produces** (from `site/src/lib/senders.ts`):
  - `type RegistryNames = ReadonlyMap<string, string>` (selector to CCIP chain name) and `registryNames(chains): RegistryNames`;
  - `senderEntries(top: TopFile, window, order): TopEntry[]`: `identities`/`identities_by_fees` when the file has them, else the per-chain `windows`/`by_fees`;
  - `interface SenderView { primary; secondary; verified; inferred; chains; href; suggestUrl }`, `senderView(entry, names, registry): SenderView`;
  - `senderRows(entries, names, registry, order?): TopRow[]`;
  - `suggestLabelUrl(chain: string | null, address: string): string`;
  - `interface DaySender extends SenderView { messages; sharePct }`, `daySender(leaders: DayLeaders | undefined, names, registry): DaySender | null`.
- `TopRow` gains optional `href?: string | null`, `inferred?: boolean` and `suggestUrl?: string | null`.

**Rows:** a project shows its name with ✓ (or an "inferred" mark), its chain icons, and `2 addresses · 6 chains`, linking to `/projects/<slug>/`. An unlabeled address shows its short address with its chain icons and up to three chain names, links to the CCIP Explorer, and has a "Suggest a label" link. A key from an older file renders as before, with "Suggest a label" when it has no label.

- [ ] **Step 1: Write the failing tests**

Create `site/test/senders.test.ts`:

```ts
import type { TopFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { chainNameMap } from '../src/lib/names';
import { daySender, senderEntries, senderRows, senderView, suggestLabelUrl } from '../src/lib/senders';
import oldTopSender from './fixtures/top-sender.json';

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const SOL = '124615329519749607';
const INK = '3461204551265785888';
const CHAINS = [
  { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet' },
  { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet' },
  { selector: SOL, name: 'solana-mainnet', display_name: 'Solana' },
  { selector: INK, name: 'ethereum-mainnet-ink-1', display_name: 'Ink Mainnet' },
];
const names = chainNameMap(CHAINS);
const registry = new Map(CHAINS.map((c) => [c.selector, c.name]));
const B1 = '0x671be08d6d3c826c2f6d76915f1b54af484d4077';
const XSTOCKS = { key: 'project:xstocks', label: 'xStocks', messages: 319, usd: 0, fee_usd: 79.75, x: 'xStocksFi', kind: 'protocol', inferred: false, chains: [SOL, INK, ETH], addresses: 2, share_pct: 20.3 };
const ADDRESS = { key: `address:${B1}`, label: null, messages: 76, usd: 250_000, fee_usd: 19, chains: [BASE, ETH, INK, SOL], addresses: 1, share_pct: 4.8 };
const params = (url: string | null) => Object.fromEntries(new URL(url!).searchParams);

describe('sender rows', () => {
  it('names a project with its tick, address and chain counts, and links its page', () => {
    // #when
    const view = senderView(XSTOCKS, names, registry);
    // #then
    expect(view).toEqual({
      primary: 'xStocks', secondary: '2 addresses · 3 chains', verified: true, inferred: false, chains: [SOL, INK, ETH], href: '/projects/xstocks/', suggestUrl: null,
    });
  });

  it('marks a project credited only through a spread label as inferred, without the tick', () => {
    // #when
    const view = senderView({ ...XSTOCKS, inferred: true, addresses: 1 }, names, registry);
    // #then
    expect([view.verified, view.inferred, view.secondary]).toEqual([false, true, '1 address · 3 chains']);
  });

  it('names an unlabeled address by its short form and first three chains, links the explorer, and offers a label suggestion', () => {
    // #when
    const view = senderView(ADDRESS, names, registry);
    // #then
    expect({ ...view, suggestUrl: params(view.suggestUrl) }).toEqual({
      primary: '0x671b…4077', secondary: 'Base · Ethereum · Ink +1 more', verified: false, inferred: false, chains: [BASE, ETH, INK, SOL],
      href: `https://ccip.chain.link/address/${B1}`,
      suggestUrl: { template: 'label.yml', title: 'Label: 0x671b…4077', address: B1, chain: 'ethereum-mainnet-base-1' },
    });
  });

  it('still renders a per-chain key from a file published before identities, with a suggestion when it has no label', () => {
    // #given the captured top/sender.json from before identities
    const file = oldTopSender as TopFile;
    // #when
    const [first] = senderRows(senderEntries(file, '7d', 'value'), names, registry);
    // #then
    expect({ primary: first?.primary, secondary: first?.secondary, chains: first?.chains, suggest: params(first?.suggestUrl ?? null).chain }).toEqual({
      primary: '0xc616…579a', secondary: 'Ethereum', chains: [ETH], suggest: 'ethereum-mainnet',
    });
  });

  it('reads the identities when a file has them, by value and by fees', () => {
    // #given
    const file = { ...(oldTopSender as TopFile), identities: { '7d': [XSTOCKS], '30d': [], all: [] }, identities_by_fees: { '7d': [ADDRESS], '30d': [], all: [] } };
    // #then
    expect([senderEntries(file, '7d', 'value')[0]?.key, senderEntries(file, '7d', 'fees')[0]?.key]).toEqual(['project:xstocks', `address:${B1}`]);
  });

  it('shares each row out of the listed total, as the other Top tabs do', () => {
    // #when
    const rows = senderRows([XSTOCKS, ADDRESS], names, registry, 'fees');
    // #then
    expect(rows.map((r) => [r.rank, Math.round(r.sharePct! * 10) / 10])).toEqual([[1, 80.8], [2, 19.2]]);
  });
});

describe("the day's top sender", () => {
  it('names it with its messages and share, and has none for a day without leaders', () => {
    // #given
    const day = { day: '2026-10-13', token: null, sender: XSTOCKS, lane: null, fee_lane: null, fee_chain: null };
    // #when
    const sender = daySender(day, names, registry);
    // #then
    expect([sender?.primary, sender?.messages, sender?.sharePct, daySender(undefined, names, registry)]).toEqual(['xStocks', 319, 20.3, null]);
  });
});

describe('suggestLabelUrl', () => {
  it('opens the label issue form with the chain and address filled in, and no chain when it is unknown', () => {
    // #then
    expect([params(suggestLabelUrl('ethereum-mainnet', B1)), params(suggestLabelUrl(null, B1)).chain]).toEqual([
      { template: 'label.yml', title: 'Label: 0x671b…4077', address: B1, chain: 'ethereum-mainnet' },
      undefined,
    ]);
  });
});
```

Append to `site/test/card-content.test.ts`:

```ts
describe('top senders card', () => {
  it('names the identity at the top when the file has identities', () => {
    // #given
    const file = {
      ...envelope, dim: 'sender' as const, since: '2023-07-06',
      windows: { '7d': [{ key: `${BASE}:0xabc`, messages: 1, usd: 9, label: null }], '30d': [], all: [] },
      identities: { '7d': [{ key: 'project:xstocks', label: 'xStocks', messages: 319, usd: 10 }], '30d': [], all: [] },
    };
    // #then
    expect(topCard(file, 'sender', '7d', 'value', names).big).toBe('xStocks');
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/senders.test.ts test/card-content.test.ts`
Expected: FAIL (`../src/lib/senders` does not exist; the card reads `windows`).

- [ ] **Step 2: The sender view helpers**

In `site/src/lib/top.ts`, add to `TopRow`:

```ts
  /** Sender rows only: the project page or the address's explorer page. */
  href?: string | null;
  inferred?: boolean;
  /** Sender rows only: the label issue form, for an address with no label. */
  suggestUrl?: string | null;
```

Create `site/src/lib/senders.ts`:

```ts
import type { ChainsFile, DayLeaders, TopEntry, TopFile } from '@ccip-dev/core/public';
import { parseSenderKey } from '@ccip-dev/core/senders';
import { REPO_URL } from '../config';
import type { TopOrder, Window } from './card-paths';
import { chainName, senderLabel, shortAddress, type ChainNames } from './names';
import { addressExplorerUrl, projectHref } from './projects';
import { topEntries, type TopRow } from './top';

/** CCIP chain names by selector, as label files and the issue form name chains. */
export type RegistryNames = ReadonlyMap<string, string>;

export const registryNames = (chains: ChainsFile['chains']): RegistryNames => new Map(chains.map((c) => [c.selector, c.name]));

/** The ranking by identity when the file has it; a file published before identities has only its per-chain entries. */
export function senderEntries(top: TopFile, window: Window, order: TopOrder): TopEntry[] {
  const identities = order === 'fees' ? top.identities_by_fees : top.identities;
  return identities ? identities[window] : topEntries(top, window, order);
}

/** The label issue form, with the chain and address filled in. */
export function suggestLabelUrl(chain: string | null, address: string): string {
  const params = new URLSearchParams({ template: 'label.yml', title: `Label: ${shortAddress(address)}`, address, ...(chain === null ? {} : { chain }) });
  return `${REPO_URL}/issues/new?${params}`;
}

export interface SenderView {
  primary: string;
  secondary: string | null;
  verified: boolean;
  inferred: boolean;
  chains: string[];
  href: string | null;
  suggestUrl: string | null;
}

const counted = (n: number, word: string, plural: string) => `${n.toLocaleString('en-US')} ${n === 1 ? word : plural}`;

type SenderFields = Pick<TopEntry, 'key' | 'label' | 'inferred' | 'chains' | 'addresses'>;

/** How the site names a sender: a project by its label, an address by its short form, and an older per-chain key as before. */
export function senderView(e: SenderFields, names: ChainNames, registry: RegistryNames): SenderView {
  const parsed = parseSenderKey(e.key);
  if (parsed.kind === 'legacy') {
    const { primary, secondary, verified } = senderLabel(names, e.key, e.label);
    return {
      primary, secondary, verified, inferred: false,
      chains: parsed.chain ? [parsed.chain] : [],
      href: verified ? null : addressExplorerUrl(parsed.address),
      suggestUrl: verified ? null : suggestLabelUrl(registry.get(parsed.chain) ?? null, parsed.address),
    };
  }
  const chains = e.chains ?? [];
  if (parsed.kind === 'project') {
    const inferred = e.inferred ?? false;
    return {
      primary: e.label ?? parsed.slug,
      secondary: `${counted(e.addresses ?? 0, 'address', 'addresses')} · ${counted(chains.length, 'chain', 'chains')}`,
      verified: !inferred,
      inferred,
      chains,
      href: projectHref(parsed.slug),
      suggestUrl: null,
    };
  }
  const shown = chains.slice(0, 3).map((s) => chainName(names, s));
  const more = chains.length - shown.length;
  return {
    primary: shortAddress(parsed.address),
    secondary: shown.length === 0 ? null : `${shown.join(' · ')}${more > 0 ? ` +${more} more` : ''}`,
    verified: false,
    inferred: false,
    chains,
    href: addressExplorerUrl(parsed.address),
    suggestUrl: suggestLabelUrl(chains[0] === undefined ? null : (registry.get(chains[0]) ?? null), parsed.address),
  };
}

/** Top › Senders rows; Share is of the listed total, as on the other tabs. */
export function senderRows(entries: readonly TopEntry[], names: ChainNames, registry: RegistryNames, order: TopOrder = 'value'): TopRow[] {
  const measure = (e: TopEntry) => (order === 'fees' ? (e.fee_usd ?? null) : e.usd);
  const total = entries.reduce((sum, e) => sum + (measure(e) ?? 0), 0);
  return entries.map((e, i) => {
    const m = measure(e);
    return {
      rank: i + 1,
      ...senderView(e, names, registry),
      messages: e.messages,
      usd: e.usd,
      fee: e.fee_usd ?? null,
      typicalFee: null,
      sharePct: total > 0 && m !== null ? (m / total) * 100 : null,
    };
  });
}

export interface DaySender extends SenderView {
  messages: number;
  sharePct: number | null;
}

/** A day's top sender for its page, from day-leaders.json; null for a day it does not list. */
export function daySender(leaders: DayLeaders | undefined, names: ChainNames, registry: RegistryNames): DaySender | null {
  const s = leaders?.sender;
  return s ? { ...senderView(s, names, registry), messages: s.messages, sharePct: s.share_pct ?? null } : null;
}
```

- [ ] **Step 3: The card reads identities**

In `site/worker/cards/content.ts`, import `senderEntries` from `'../../src/lib/senders'`, and in `topCard` replace `const entries = topEntries(top, window, order);` with:

```ts
  const entries = dim === 'sender' ? senderEntries(top, window, order) : topEntries(top, window, order);
```

`entryLabel`'s `senderLabel(names, e.key, e.label).primary` already reads an identity: the label, or the short form of what follows the first colon.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/senders.test.ts test/card-content.test.ts`
Expected: PASS.

- [ ] **Step 4: The Top page**

In `site/src/pages/top/[dim]/[window]/[...order].astro`:
- import `{ registryNames, senderEntries, senderRows } from '../../../../lib/senders';`;
- replace `const rows = topRows(...)` with:

```ts
const rows =
  dim === 'sender'
    ? senderRows(senderEntries(top, window, order), names, registryNames(chains.chains), order)
    : topRows(topEntries(top, window, order), dim, names, { order, typicalFees: typicalFeeMap(cost) });
```

- replace the name cell's contents with:

```astro
              <td>
                <ChainIcons selectors={r.chains} />{r.href ? <a href={r.href} rel={r.href.startsWith('http') ? 'noopener' : undefined}>{r.primary}</a> : r.primary}{r.verified && <span class="verified" title="Verified label" aria-label="verified">✓</span>}{r.inferred && <span class="inferred" title="Credited through the same address labeled on another chain">inferred</span>}
                {r.secondary && <span class="secondary">{r.secondary}</span>}
                {r.suggestUrl && <a class="suggest" href={r.suggestUrl} rel="noopener">Suggest a label</a>}
              </td>
```

- change the note's sender sentence from `'Labels appear only for verified senders.'` to `'A project counts every address its label names, on every chain; "inferred" marks one credited through the same address labeled on another chain.'`.

In `site/src/styles/base.css`, after `.inferred`, add:

```css
.suggest { display: block; font-size: 12px; color: var(--muted); }
.suggest:hover { color: var(--blue-2); }
```

- [ ] **Step 5: The day page**

In `site/src/pages/day/[day].astro`:
- import `ChainIcons from '../../components/ChainIcons.astro'` and `{ daySender, registryNames } from '../../lib/senders'`;
- load the leaders with the other files: `const [history, replay, chains, leaders] = await Promise.all([buildData('history.json'), buildData('replay.json'), buildData('chains.json'), buildData('day-leaders.json')]);`
- after `const label = …`, add `const sender = daySender(leaders.days.find((d) => d.day === day), chainNameMap(chains.chains), registryNames(chains.chains));`
- right after the closing `</section>` of the tiles, add:

```astro
  {sender && (
    <p class="top-sender">
      Top sender: <ChainIcons selectors={sender.chains} />{sender.href ? <a href={sender.href} rel={sender.href.startsWith('http') ? 'noopener' : undefined}>{sender.primary}</a> : sender.primary}{sender.verified && <span class="verified" title="Verified label" aria-label="verified">✓</span>}{sender.inferred && <span class="inferred">inferred</span>}
      {` · ${formatCount(sender.messages)} messages`}{sender.sharePct !== null && ` (${formatShare(sender.sharePct)})`}
      {sender.suggestUrl && <>{' · '}<a href={sender.suggestUrl} rel="noopener">Suggest a label</a></>}
    </p>
  )}
```

- add `.top-sender { margin: 12px 0 0; }` to its `<style>`.

`day-leaders.json` covers the last 400 days, so older day pages show no line.

- [ ] **Step 6: The issue form**

Create `.github/ISSUE_TEMPLATE/label.yml`:

```yaml
name: Suggest a label
description: Name the project behind a CCIP sender address.
title: "Label: "
body:
  - type: markdown
    attributes:
      value: |
        Thanks for helping name who sends on CCIP. A label needs a public source that ties the address to the project: its docs, its deployments on GitHub, or its own website. We add it as a file in `labels/projects/`; see "Labels and handles" in `docs/runbook.md`.
  - type: input
    id: chain
    attributes:
      label: Chain
      description: The CCIP chain name, as in labels/ccip-chains.json, for example ethereum-mainnet-base-1.
    validations:
      required: true
  - type: input
    id: address
    attributes:
      label: Address
    validations:
      required: true
  - type: input
    id: project
    attributes:
      label: Project name
    validations:
      required: true
  - type: input
    id: x
    attributes:
      label: X handle
      description: Without the @, and only one the project's own website or docs link to.
  - type: input
    id: source
    attributes:
      label: Source URL
      description: An https page of the project's own that lists this address.
    validations:
      required: true
```

- [ ] **Step 7: Run everything, build, and look**

```bash
pnpm test && pnpm typecheck && pnpm --filter @ccip-dev/site build
```

Expected: green. After Checkpoint 1's finalize, production `top/sender.json` has identities, so `site/dist/top/sender/7d/index.html` lists projects and addresses; before it, the page renders the per-chain rows with "Suggest a label" on unlabeled ones. Open `/top/sender/7d/` and a recent `/day/<day>/` (with `astro preview`) at 1280 and 390 px: no row overflows (`document.documentElement.scrollWidth === innerWidth`), project rows link to `/projects/<slug>/`, and an unlabeled row's "Suggest a label" opens the GitHub form with the chain and address filled. If you have no browser tool, say so.

- [ ] **Step 8: Commit**

```bash
git add site/src/lib/senders.ts site/src/lib/top.ts "site/src/pages/top/[dim]/[window]/[...order].astro" "site/src/pages/day/[day].astro" site/worker/cards/content.ts \
  site/src/styles/base.css .github/ISSUE_TEMPLATE/label.yml site/test/senders.test.ts site/test/card-content.test.ts
git commit -m "feat(site): Top › Senders by identity, the day's top sender, and Suggest a label

Projects show their tick (or inferred), chains and address count and link to their
page; unlabeled addresses link to the CCIP Explorer and to a prefilled label issue.
Files from before identities still render their per-chain rows.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 10: Label coverage in status.json and on the status page

**Files:**
- Modify: `packages/core/src/senders.ts`, `packages/core/src/public.ts`
- Modify: `worker/src/senders.ts`, `worker/src/publish.ts`
- Modify: `site/src/lib/status-light.ts`, `site/src/components/StatusPanel.tsx`
- Test: `packages/core/test/senders.test.ts`, `worker/test/publish.test.ts`, `site/test/status-light.test.ts`

**Interfaces:**
- **Consumes:** Task 1's `mergeIdentities`, `sharePct`; Task 2's `senderTotalsOf`, `totalsBetween`; Task 3's `SenderBook`.
- **Produces:**
  - Core: `interface LabelCoverage { messages_pct: number | null; usd_pct: number | null; fees_pct: number | null; window: '7d' }`, `labelCoverage(identities: readonly IdentityTotals[], totals: { messages: number; usd_value: number; fee_usd: number | null }): LabelCoverage`. Labeled means a project identity, verified or inferred.
  - `LabelCoverageSchema` and `StatusFileSchema.label_coverage: LabelCoverageSchema.nullable().optional()`.
  - Worker: `labelCoverageOf(c, book, fromDay, toDay): Promise<LabelCoverage>`; `LABEL_COVERAGE_KEY = 'label_coverage'` in D1 `meta`, written at finalize by `publishHistoryFiles` and read every minute by `publishStatus`.
  - Site: `coverageLine(c: StatusFile['label_coverage']): string | null`.

**Copy (exact):** `Labeled senders: 81% of messages, 94% of value (last 7 days)`, then a link "See the projects" to `/projects/`. With no value in the window: `Labeled senders: 81% of messages (last 7 days)`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/senders.test.ts` (adding `labelCoverage` to the `../src/senders` import):

```ts
describe('label coverage', () => {
  it("is the labeled identities' share of the window's messages, value and fees", () => {
    // #given 2026-10-13: xStocks is the only labeled identity
    const identities = mergeIdentities(XSTOCKS_SENDER_ROWS, identityResolver(XSTOCKS_LABELS, XSTOCKS_CHAINS));
    // #when
    const coverage = labelCoverage(identities, XSTOCKS_TOTALS);
    // #then
    expect(coverage).toEqual({ messages_pct: 20.3, usd_pct: 0, fees_pct: 20.3, window: '7d' });
  });

  it('counts a project credited through a spread label as labeled', () => {
    // #given Maple's only row came through its Ethereum label
    const identities = mergeIdentities([row(BASE, ADDR, 3, 30, 1), row(BASE, '0xb', 1, 10, 1)], identityResolver(ON_ETHEREUM, CHAINS));
    // #then
    expect(labelCoverage(identities, { messages: 4, usd_value: 40, fee_usd: 2 })).toEqual({ messages_pct: 75, usd_pct: 75, fees_pct: 50, window: '7d' });
  });

  it('has no shares for an empty window, never NaN', () => {
    // #then
    expect(labelCoverage([], { messages: 0, usd_value: 0, fee_usd: null })).toEqual({ messages_pct: null, usd_pct: null, fees_pct: null, window: '7d' });
  });
});
```

Append to `worker/test/publish.test.ts`, inside `describe('senders by identity')` (which seeds 2026-10-13 and the chains):

```ts
  it('writes the last 7 days’ label coverage at finalize, and status.json carries it every minute', async () => {
    // #given
    const { c } = harness({ now: NOW, labels: XSTOCKS_LABELS });
    // #when
    await publishHistoryFiles(c);
    await publishLiveFiles(c);
    // #then
    expect((await readPublic('status.json')).label_coverage).toEqual({ messages_pct: 20.3, usd_pct: 0, fees_pct: 20.3, window: '7d' });
  });
```

and inside `describe('publishLiveFiles')`, after `'publishes ingest lag and finalize progress'`:

```ts
  it('publishes no label coverage before the first finalize has written it', async () => {
    // #given
    await seed();
    // #when
    await publishLiveFiles(harness({ now: '2026-10-08T12:00:00.000Z' }).c);
    // #then
    expect((await readPublic('status.json')).label_coverage).toBeNull();
  });
```

Append to `site/test/status-light.test.ts` (adding `coverageLine` to its import):

```ts
describe('label coverage line', () => {
  it.each([
    [{ messages_pct: 81.2, usd_pct: 94.4, fees_pct: 90, window: '7d' as const }, 'Labeled senders: 81% of messages, 94% of value (last 7 days)'],
    [{ messages_pct: 81.2, usd_pct: null, fees_pct: null, window: '7d' as const }, 'Labeled senders: 81% of messages (last 7 days)'],
    [{ messages_pct: null, usd_pct: null, fees_pct: null, window: '7d' as const }, null],
    [null, null],
    [undefined, null],
  ])('words %o as %j', (coverage, line) => {
    // #then
    expect(coverageLine(coverage)).toBe(line);
  });
});
```

Run: `pnpm --filter @ccip-dev/core exec vitest run test/senders.test.ts && pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts && pnpm --filter @ccip-dev/site exec vitest run test/status-light.test.ts`
Expected: FAIL.

- [ ] **Step 2: The coverage maths**

Append to `packages/core/src/senders.ts`:

```ts
export interface LabelCoverage {
  messages_pct: number | null;
  usd_pct: number | null;
  fees_pct: number | null;
  window: '7d';
}

/** How much of a window the labeled identities (verified or inferred) account for. */
export function labelCoverage(identities: readonly IdentityTotals[], totals: { messages: number; usd_value: number; fee_usd: number | null }): LabelCoverage {
  const labeled = identities.filter((i) => i.slug !== null);
  const sum = (pick: (i: IdentityTotals) => number) => labeled.reduce((s, i) => s + pick(i), 0);
  return {
    messages_pct: sharePct(sum((i) => i.messages), totals.messages),
    usd_pct: sharePct(sum((i) => i.usd_value), totals.usd_value),
    fees_pct: sharePct(sum((i) => i.fee_usd ?? 0), totals.fee_usd),
    window: '7d',
  };
}
```

In `packages/core/src/public.ts`, before `StatusFileSchema`:

```ts
export const LabelCoverageSchema = z.object({
  messages_pct: z.number().nullable(),
  usd_pct: z.number().nullable(),
  fees_pct: z.number().nullable(),
  window: z.literal('7d'),
});
```

and add `label_coverage: LabelCoverageSchema.nullable().optional(),` as the last field of `StatusFileSchema`.

- [ ] **Step 3: Compute it at finalize and publish it every minute**

Append to `worker/src/senders.ts` (adding `labelCoverage, type LabelCoverage` to its core import):

```ts
/** status.json reads the coverage every minute from meta; finalize writes it. */
export const LABEL_COVERAGE_KEY = 'label_coverage';

/** The labeled identities' share of [fromDay, toDay]: every labeled row merged, against daily_totals. */
export async function labelCoverageOf(c: RunContext, book: SenderBook, fromDay: string, toDay: string): Promise<LabelCoverage> {
  const rows = await store.senderTotalsOf(c.env.DB, fromDay, toDay, book.labeled);
  return labelCoverage(mergeIdentities(rows, book.resolve), await store.totalsBetween(c.env.DB, fromDay, toDay));
}
```

In `worker/src/publish.ts`:
- import `LabelCoverageSchema` with the other public imports (it is a value: `import { LabelCoverageSchema, TOP_WINDOWS, type … } from '@ccip-dev/core/public';`), and `LABEL_COVERAGE_KEY, labelCoverageOf` from `./senders`;
- in `publishHistoryFiles`, right after `const book = await senderBook(c);`:

```ts
  try {
    await store.setMeta(db, LABEL_COVERAGE_KEY, JSON.stringify(await labelCoverageOf(c, book, addDays(today, -7), lastDay)));
  } catch (err) {
    await c.alert('label-coverage', `Label coverage was not computed: ${err instanceof Error ? err.message : String(err)}`);
  }
```

- replace `publishStatus` with:

```ts
/** A missing or unreadable coverage row reads as none, so status.json always publishes. */
function storedCoverage(raw: string | null) {
  if (raw === null) return null;
  try {
    const parsed = LabelCoverageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function publishStatus(c: RunContext, now: Date): Promise<void> {
  const db = c.env.DB;
  const [lastIngest, lastFinalize, coverageFrom, coverage] = await Promise.all([
    store.getMeta(db, 'last_ingest_ok_at'),
    store.getMeta(db, 'last_finalize_day'),
    store.getMeta(db, 'coverage_from'),
    store.getMeta(db, LABEL_COVERAGE_KEY),
  ]);
  await putJson(
    c.env.PUBLIC,
    'status.json',
    {
      last_ingest_ok_at: lastIngest,
      lag_seconds: lastIngest ? Math.round((now.getTime() - Date.parse(lastIngest)) / 1000) : null,
      last_finalize_day: lastFinalize,
      coverage_from: coverageFrom,
      label_coverage: storedCoverage(coverage),
    },
    TTL.status,
    now,
  );
}
```

- [ ] **Step 4: The status page line**

Append to `site/src/lib/status-light.ts` (adding `formatShare` to its `./format` import):

```ts
/** "Labeled senders: 81% of messages, 94% of value (last 7 days)"; null before the first finalize computes it. */
export function coverageLine(c: StatusFile['label_coverage']): string | null {
  if (!c || c.messages_pct === null) return null;
  const value = c.usd_pct === null ? '' : `, ${formatShare(c.usd_pct)} of value`;
  return `Labeled senders: ${formatShare(c.messages_pct)} of messages${value} (last 7 days)`;
}
```

In `site/src/components/StatusPanel.tsx`, import `coverageLine` from `'../lib/status-light'`, add `const coverage = coverageLine(status?.label_coverage);` after `const ingest = …`, and add after the closing `</dl>`:

```tsx
      {coverage && (
        <p className="coverage">
          {coverage}. <a href="/projects/">See the projects</a>
        </p>
      )}
```

and in `site/src/styles/base.css` after `.status-big`: `.coverage { margin: 16px 0 0; color: var(--muted); }`.

- [ ] **Step 5: Run the tests and the build**

```bash
pnpm --filter @ccip-dev/core exec vitest run test/senders.test.ts
pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts
pnpm --filter @ccip-dev/site exec vitest run test/status-light.test.ts
pnpm test && pnpm typecheck && pnpm --filter @ccip-dev/site build
```

Expected: green. The status page renders no coverage line until the Worker's next finalize writes it.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/senders.ts packages/core/src/public.ts worker/src/senders.ts worker/src/publish.ts site/src/lib/status-light.ts site/src/components/StatusPanel.tsx \
  site/src/styles/base.css packages/core/test/senders.test.ts worker/test/publish.test.ts site/test/status-light.test.ts
git commit -m "feat: label coverage, in status.json and on the status page

Finalize computes the share of the last 7 days' messages, value and fees that came
from labeled identities; status.json carries it, and the status page says it and
links to the projects.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

#### Checkpoint 3 (controller, after Task 10 is reviewed): push, and check the site live

Push `main`. When `deploy` and `site` are green:
- `https://ccip.dev/top/sender/7d/` lists identities (projects with ✓ and their counts; addresses with "Suggest a label"), and `/top/sender/7d/fees/` too.
- `https://ccip.dev/projects/` lists the verified projects; `/projects/xstocks/` renders, and `https://ccip.dev/og/project/xstocks.png` returns a 1200×630 PNG.
- A recent `/day/<day>/` shows its top sender.
- After the next finalize, `status.json` has `label_coverage`, and `https://ccip.dev/status/` shows the "Labeled senders" line.
- A "Suggest a label" link opens GitHub's new-issue form with the chain and address filled in.

---

### Task 11: New senders: the arrivals migration, recording them at finalize, and `moments.json`

**Files:**
- Create: `worker/migrations/0007_sender_arrivals.sql`
- Modify: `packages/core/src/senders.ts`, `packages/core/src/public.ts`
- Modify: `worker/src/store.ts`, `worker/src/senders.ts`, `worker/src/jobs/finalize.ts`, `worker/src/moments.ts`
- Test: `packages/core/test/senders.test.ts`, `worker/test/senders.test.ts` (new), `worker/test/finalize.test.ts`, `worker/test/store.test.ts`, `worker/test/publish.test.ts`

**Interfaces:**
- **Consumes:** Task 1's `rankIdentities`, `mergeIdentities`, `projectAddresses`, `senderKeyAddress`; Task 2's `senderTotalsOf`; Task 3's `senderBook`.
- **Produces:**
  - Core: `NEWCOMER_TOP = 10`, `NEWCOMER_MIN_MESSAGES = 20`, `NEWCOMER_NEW_DAYS = 30`; `interface Newcomer { identity: IdentityTotals; rank: number; firstDay: string }`; `newcomerPicks(dayIdentities, firstDays: ReadonlyMap<string, string>, day, recorded: ReadonlySet<string>): Newcomer[]`; `newcomerSpan(firstDay, day): 'first-day' | 'first-week' | 'since'`.
  - `SenderArrivalSchema` = `{ key, label, x, kind, inferred, day, first_day, rank, messages, total_messages, chains }`; `MomentsFileSchema.arrivals.senders` (optional); `type SenderArrival`.
  - Store: `insertArrivals(db, kind: 'chain' | 'token' | 'sender', …)`; `existingArrivals(db, kind: 'sender', keys): Promise<Set<string>>`; `FIRST_SENDER_DAYS_SQL`, `firstSenderDays(db, addresses): Promise<Map<string, string>>`; `senderArrivalsSince(db, sinceIso): Promise<{ key: string; first_seen: string }[]>`; `recentArrivals` leaves sender rows out.
  - Worker (`worker/src/senders.ts`): `identityAddresses(labels, identity): string[]`, `identityFirstDays(c, identities): Promise<Map<string, string>>`, `recordSenderArrivals(c, day, breakdown): Promise<string[]>`, `senderArrivals(c, since, lastDay): Promise<SenderArrival[]>`.

**Rule (spec §7):** an identity is new on CCIP when it is in the day's top 10 by messages with 20 or more that day, and its first message (the earliest day over all its addresses on any chain) came within the 30 days ending that day. It is recorded once, in `arrivals` with `kind = 'sender'`, `key` = its identity key, and `first_seen` = that day at 00:00 UTC (**ruling:** the day it qualified, which is when its moment is due). A failure to record alerts and never fails the day.

- [ ] **Step 1: Write the failing core tests**

Append to `packages/core/test/senders.test.ts` (adding `newcomerPicks, newcomerSpan` to the `../src/senders` import):

```ts
describe('new on CCIP', () => {
  const DAY = '2026-10-13';
  const resolve = identityResolver({}, CHAINS);
  /** Twelve unlabeled senders with 120, 110, … 10 messages: the 11th and 12th fall outside the top 10. */
  const day = mergeIdentities(Array.from({ length: 12 }, (_, i) => row(BASE, `0x${String(i + 1).padStart(40, '0')}`, 120 - i * 10)), resolve);
  const key = (i: number) => `address:0x${String(i).padStart(40, '0')}`;
  const firstDays = new Map(Array.from({ length: 12 }, (_, i) => [key(i + 1), '2026-10-01']));

  it('picks the top 10 senders of the day with 20 or more messages whose first message came within 30 days', () => {
    // #when
    const picks = newcomerPicks(day, firstDays, DAY, new Set());
    // #then the 10th sender sent 30; the 11th and 12th are outside the top 10
    expect(picks.map((p) => [p.identity.key, p.rank])).toEqual(Array.from({ length: 10 }, (_, i) => [key(i + 1), i + 1]));
  });

  it('counts the 30 days through the day itself: a first message 29 days back is new, 30 days back is not', () => {
    // #given
    const edges = new Map([[key(1), '2026-09-14'], [key(2), '2026-09-13']]);
    // #when
    const picks = newcomerPicks(day, edges, DAY, new Set());
    // #then
    expect(picks.map((p) => p.identity.key)).toEqual([key(1)]);
  });

  it('leaves out an identity already recorded, one under 20 messages, and one with no known first day', () => {
    // #given only sender 1 qualifies on its own
    const quiet = mergeIdentities([row(BASE, '0x00000000000000000000000000000000000000cc', 19)], resolve);
    const picks = newcomerPicks([...day.slice(0, 3), ...quiet], new Map([[key(1), DAY], [key(2), DAY], ['address:0x00000000000000000000000000000000000000cc', DAY]]), DAY, new Set([key(2)]));
    // #then sender 3 has no first day
    expect(picks.map((p) => p.identity.key)).toEqual([key(1)]);
  });

  it.each([
    ['2026-10-13', 'first-day'],
    ['2026-10-07', 'first-week'],
    ['2026-10-06', 'since'],
  ] as const)('says a first message on %s came %s', (firstDay, span) => {
    // #then
    expect(newcomerSpan(firstDay, DAY)).toBe(span);
  });
});
```

Run: `pnpm --filter @ccip-dev/core exec vitest run test/senders.test.ts`
Expected: FAIL.

- [ ] **Step 2: The selection**

Append to `packages/core/src/senders.ts` (adding `import { addDays } from './time';` to its imports):

```ts
export const NEWCOMER_TOP = 10;
export const NEWCOMER_MIN_MESSAGES = 20;
/** "Never sent before the last 30 days": the 30 days ending on the day itself. */
export const NEWCOMER_NEW_DAYS = 30;

export interface Newcomer {
  identity: IdentityTotals;
  /** The identity's place in the day's ranking by messages. */
  rank: number;
  firstDay: string;
}

/**
 * The day's new identities: in its top 10 by messages, with 20 or more, a first message within the 30 days ending on
 * `day`, and not recorded before. `firstDays` holds each candidate's earliest day over all its addresses; an identity
 * missing from it is left out rather than guessed new.
 */
export function newcomerPicks(dayIdentities: readonly IdentityTotals[], firstDays: ReadonlyMap<string, string>, day: string, recorded: ReadonlySet<string>): Newcomer[] {
  const since = addDays(day, -(NEWCOMER_NEW_DAYS - 1));
  return rankIdentities(dayIdentities, 'messages', NEWCOMER_TOP).flatMap((identity, i) => {
    const firstDay = firstDays.get(identity.key);
    if (identity.messages < NEWCOMER_MIN_MESSAGES || firstDay === undefined || firstDay < since || recorded.has(identity.key)) return [];
    return [{ identity, rank: i + 1, firstDay }];
  });
}

/** How a post words the time since a newcomer's first message: its first day, its first week, or since a date. */
export function newcomerSpan(firstDay: string, day: string): 'first-day' | 'first-week' | 'since' {
  if (firstDay === day) return 'first-day';
  return firstDay >= addDays(day, -6) ? 'first-week' : 'since';
}
```

Run the core tests: PASS.

- [ ] **Step 3: Write the failing Worker tests**

In `worker/test/store.test.ts`, append:

```ts
describe('migration 0007', () => {
  it('accepts sender arrivals and still refuses an unknown kind', async () => {
    // #when
    await store.insertArrivals(env.DB, 'sender', ['project:xstocks'], '2026-10-13T00:00:00.000Z', null);
    const refused = await env.DB.prepare("INSERT INTO arrivals VALUES ('robot', 'k', 'x', NULL)").run().then(() => false, () => true);
    // #then
    expect({ count: await store.countArrivals(env.DB, 'sender'), refused }).toEqual({ count: 1, refused: true });
  });

  it("finds an address's first day on any chain through the messages_sender index", async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.FIRST_SENDER_DAYS_SQL}`).bind('["0xa"]').all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toContain('messages_sender');
  });
});
```

In `worker/test/publish.test.ts`, in `'lists new arrivals but not baseline rows seeded at first sight'`, add `env.DB.prepare("INSERT INTO arrivals VALUES ('sender', 'project:xstocks', '2026-10-08T00:00:00.000Z', NULL)"),` to the batch; the expected list stays the same (today.json's arrivals keep meaning chains, tokens and lanes).

Create `worker/test/senders.test.ts`:

```ts
import { BASE_SENDER_1, NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_DAY, XSTOCKS_LABELS, XSTOCKS_TOTALS, xstocksBreakdown } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildMoments } from '../src/moments';
import { recordSenderArrivals } from '../src/senders';
import * as store from '../src/store';
import { harness, liveRow, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-14T00:07:00.000Z';
const CHAINS = [NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc, NETWORKS.solana, NETWORKS.ink, NETWORKS.xlayer, NETWORKS.hyperliquid];
const [ETH, BSC, SOL, INK, XLAYER, HYPER] = [NETWORKS.ethereum, NETWORKS.bsc, NETWORKS.solana, NETWORKS.ink, NETWORKS.xlayer, NETWORKS.hyperliquid].map((n) => n.chainSelector);
const context = () => harness({ now: NOW, labels: XSTOCKS_LABELS }).c;
const senderRows = async () => (await env.DB.prepare("SELECT key, first_seen FROM arrivals WHERE kind = 'sender' ORDER BY key").all()).results;

/** One message from `address` on `network` on `day`, so the store knows its first day. */
const firstMessage = (id: string, day: string, network: (typeof CHAINS)[number], address: string) => liveRow({ id, sendTs: `${day}T09:00:00.000Z`, src: network, sender: address });

beforeEach(async () => {
  // #given 2026-10-13's senders; xStocks's xBridge first sent on Oct 9, its Solana sender on Oct 13, the Base senders in July
  await seedRegistry(CHAINS, []);
  await store.replaceDaily(env.DB, XSTOCKS_TOTALS, xstocksBreakdown(), NOW);
  await store.upsertListRows(env.DB, [
    firstMessage('x-ink', '2026-10-09', NETWORKS.ink, XBRIDGE_EVM),
    firstMessage('x-sol', XSTOCKS_DAY, NETWORKS.solana, XBRIDGE_SOLANA),
    firstMessage('b1', '2026-07-01', NETWORKS.base, BASE_SENDER_1),
  ], []);
});

describe('recording new senders', () => {
  it('records xStocks, new this month, and not the Base senders that have sent since July', async () => {
    // #when the 23 smaller Base senders have no stored messages, so no known first day
    const keys = await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #then
    expect({ keys, rows: await senderRows() }).toEqual({ keys: ['project:xstocks'], rows: [{ key: 'project:xstocks', first_seen: '2026-10-13T00:00:00.000Z' }] });
  });

  it('records a sender once', async () => {
    // #given
    await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #when
    const again = await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #then
    expect({ again, rows: (await senderRows()).length }).toEqual({ again: [], rows: 1 });
  });

  it('does not count a project new when any of its addresses sent before the last 30 days', async () => {
    // #given the xBridge sent from Ethereum in August
    await store.upsertListRows(env.DB, [firstMessage('x-old', '2026-08-01', NETWORKS.ethereum, XBRIDGE_EVM)], []);
    // #when
    const keys = await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #then
    expect(keys).toEqual([]);
  });
});

describe('moments.json new senders', () => {
  it('lists each new sender of the last 30 days with its day, first day, rank, messages and chains', async () => {
    // #given
    await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #when
    const moments = await buildMoments(context(), { lastDay: XSTOCKS_DAY, days: [] });
    // #then
    expect(moments.arrivals.senders).toEqual([{
      key: 'project:xstocks', label: 'xStocks', x: 'xStocksFi', kind: 'protocol', inferred: false,
      day: XSTOCKS_DAY, first_day: '2026-10-09', rank: 1, messages: 319, total_messages: 319, chains: [SOL, INK, XLAYER, BSC, ETH, HYPER],
    }]);
  });

  it('leaves out a sender that arrived more than 30 days before', async () => {
    // #given
    await store.insertArrivals(env.DB, 'sender', ['address:0xold'], '2026-09-01T00:00:00.000Z', null);
    // #when
    const moments = await buildMoments(context(), { lastDay: XSTOCKS_DAY, days: [] });
    // #then
    expect(moments.arrivals.senders).toEqual([]);
  });
});
```

In `worker/test/finalize.test.ts`, append:

```ts
describe('new senders at finalize', () => {
  const NEWBIE = '0x5555555555555555555555555555555555555555';
  const newbieRows = () => Array.from({ length: 20 }, (_, i) => liveRow({ id: `n${i}`, sendTs: `2026-10-09T10:${String(i).padStart(2, '0')}:00.000Z`, sender: NEWBIE }));

  it('records an address that sent 20 messages on its first day', async () => {
    // #given
    await seedMeta('2026-10-08', '2026-10-08');
    await seedRegistry([NETWORKS.base, NETWORKS.bsc], []);
    await store.upsertListRows(env.DB, newbieRows(), []);
    // #when
    await runFinalize(harness({ now: NOW, ccip: api() }).c, 'early');
    // #then
    const rows = (await env.DB.prepare("SELECT key, first_seen FROM arrivals WHERE kind = 'sender'").all()).results;
    expect(rows).toEqual([{ key: `address:${NEWBIE}`, first_seen: '2026-10-09T00:00:00.000Z' }]);
  });

  it('still finalizes the day, and alerts, when recording new senders fails', async () => {
    // #given
    await seedMeta('2026-10-08', '2026-10-08');
    await seedRegistry([NETWORKS.base, NETWORKS.bsc], []);
    await store.upsertListRows(env.DB, newbieRows(), []);
    vi.spyOn(store, 'firstSenderDays').mockRejectedValueOnce(new Error('D1 unavailable'));
    const h = harness({ now: NOW, ccip: api() });
    // #when
    await runFinalize(h.c, 'early');
    // #then
    expect({
      finalized: await store.getMeta(env.DB, 'last_finalize_day'),
      alerts: h.alerts.filter((a) => a.signature.startsWith('sender-arrivals')),
    }).toEqual({
      finalized: '2026-10-09',
      alerts: [{ signature: 'sender-arrivals:2026-10-09', text: 'New senders for 2026-10-09 were not recorded: D1 unavailable' }],
    });
  });
});
```

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/senders.test.ts test/finalize.test.ts test/store.test.ts test/publish.test.ts`
Expected: FAIL (the CHECK refuses `sender`; nothing records senders).

- [ ] **Step 4: The migration**

Create `worker/migrations/0007_sender_arrivals.sql`:

```sql
-- SQLite cannot alter a CHECK, so arrivals is rebuilt to take kind 'sender': a sender identity's first day in the
-- day's top 10, recorded once for the "New on CCIP" moment.
CREATE TABLE arrivals_new (
  kind TEXT NOT NULL CHECK (kind IN ('chain', 'token', 'lane', 'sender')),
  key TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  announced_at TEXT,
  PRIMARY KEY (kind, key)
);
INSERT INTO arrivals_new (kind, key, first_seen, announced_at) SELECT kind, key, first_seen, announced_at FROM arrivals;
DROP TABLE arrivals;
ALTER TABLE arrivals_new RENAME TO arrivals;
```

- [ ] **Step 5: The store**

In `worker/src/store.ts`:
- `insertArrivals(db, kind: 'chain' | 'token' | 'sender', …)` and `countArrivals(db, kind: 'chain' | 'token' | 'lane' | 'sender')`;
- in `recentArrivals`, make the `WHERE` read `WHERE kind <> 'sender' AND (announced_at IS NULL OR announced_at <> first_seen)`;
- add after `recentArrivals`:

```ts
/** The keys among `keys` already recorded under `kind`. */
export async function existingArrivals(db: D1Database, kind: 'sender', keys: readonly string[]): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT key FROM arrivals WHERE kind = ?1 AND key IN (SELECT value FROM json_each(?2))')
    .bind(kind, JSON.stringify(keys))
    .all<{ key: string }>();
  return new Set(results.map((r) => r.key));
}

/** Sender arrivals from `sinceIso` on, oldest first. */
export async function senderArrivalsSince(db: D1Database, sinceIso: string): Promise<{ key: string; first_seen: string }[]> {
  const { results } = await db
    .prepare("SELECT key, first_seen FROM arrivals WHERE kind = 'sender' AND first_seen >= ? ORDER BY first_seen, key")
    .bind(sinceIso)
    .all<{ key: string; first_seen: string }>();
  return results;
}

/** Each address's first day with a message from it, on any chain the registry lists, through messages_sender. */
export const FIRST_SENDER_DAYS_SQL = `SELECT sender AS address, MIN(day) AS first_day FROM messages
  WHERE src_chain IN (SELECT selector FROM chains) AND sender IN (SELECT value FROM json_each(?1)) GROUP BY sender`;

export async function firstSenderDays(db: D1Database, addresses: readonly string[]): Promise<Map<string, string>> {
  const { results } = await db.prepare(FIRST_SENDER_DAYS_SQL).bind(JSON.stringify(addresses)).all<{ address: string; first_day: string }>();
  return new Map(results.map((r) => [r.address, r.first_day]));
}
```

- [ ] **Step 6: Record and describe new senders**

In `packages/core/src/public.ts`, before `MomentsFileSchema`, add:

```ts
export const SenderArrivalSchema = z.object({
  key: z.string(),
  label: z.string().nullable(),
  x: z.string().nullable(),
  kind: z.string().nullable(),
  inferred: z.boolean(),
  /** The day it entered the day's top 10. */
  day: z.string(),
  /** Its first message's day, over all its addresses. */
  first_day: z.string(),
  rank: z.number(),
  messages: z.number(),
  /** Its messages from its first day through `day`. */
  total_messages: z.number(),
  chains: z.array(z.string()),
});
```

add `senders: z.array(SenderArrivalSchema).optional(),` to `MomentsFileSchema.arrivals` (after `tokens`), and `export type SenderArrival = z.infer<typeof SenderArrivalSchema>;` with the other types.

Append to `worker/src/senders.ts` (adding `dayStartIso, newcomerPicks, NEWCOMER_MIN_MESSAGES, NEWCOMER_TOP, projectAddresses, senderKeyAddress, type DailyBreakdown, type LabelIndex` to its core import, and `import type { SenderArrival } from '@ccip-dev/core/public';`):

```ts
/** An identity's addresses: those it sent from, plus, for a project, every address its label names. */
export function identityAddresses(labels: LabelIndex, identity: IdentityTotals): string[] {
  return [...new Set([...identity.keys.map(senderKeyAddress), ...(identity.slug === null ? [] : projectAddresses(labels, identity.slug))])];
}

/** Each identity's first day: the earliest message from any of its addresses, on any chain. */
export async function identityFirstDays(c: RunContext, identities: readonly IdentityTotals[]): Promise<Map<string, string>> {
  const addressesOf = new Map(identities.map((i) => [i.key, identityAddresses(c.labels, i)]));
  const firsts = await store.firstSenderDays(c.env.DB, [...new Set([...addressesOf.values()].flat())]);
  const out = new Map<string, string>();
  for (const [key, addresses] of addressesOf) {
    const days = addresses.flatMap((a) => firsts.get(a) ?? []).sort();
    if (days[0] !== undefined) out.set(key, days[0]);
  }
  return out;
}

/** Records the day's new identities (see newcomerPicks) in arrivals, once each, and returns their keys. */
export async function recordSenderArrivals(c: RunContext, day: string, breakdown: readonly DailyBreakdown[]): Promise<string[]> {
  const db = c.env.DB;
  const book = await senderBook(c);
  const identities = mergeIdentities(breakdown.filter((b) => b.dim === 'sender'), book.resolve);
  const top = rankIdentities(identities, 'messages', NEWCOMER_TOP).filter((i) => i.messages >= NEWCOMER_MIN_MESSAGES);
  if (top.length === 0) return [];
  const recorded = await store.existingArrivals(db, 'sender', top.map((i) => i.key));
  const fresh = top.filter((i) => !recorded.has(i.key));
  if (fresh.length === 0) return [];
  const keys = newcomerPicks(identities, await identityFirstDays(c, fresh), day, recorded).map((p) => p.identity.key);
  await store.insertArrivals(db, 'sender', keys, dayStartIso(day), null);
  return keys;
}

/** The senders recorded from `since` through `lastDay`, as moments.json lists them. */
export async function senderArrivals(c: RunContext, since: string, lastDay: string): Promise<SenderArrival[]> {
  const db = c.env.DB;
  const rows = (await store.senderArrivalsSince(db, dayStartIso(since))).filter((r) => r.first_seen.slice(0, 10) <= lastDay);
  if (rows.length === 0) return [];
  const book = await senderBook(c);
  const out: SenderArrival[] = [];
  for (const row of rows) {
    const day = row.first_seen.slice(0, 10);
    const ranked = rankIdentities(mergeIdentities(await store.breakdownBetween(db, 'sender', day, day), book.resolve), 'messages', Infinity);
    const rank = ranked.findIndex((i) => i.key === row.key);
    const identity = ranked[rank];
    if (identity === undefined) continue;
    const firstDay = (await identityFirstDays(c, [identity])).get(identity.key) ?? day;
    const sinceFirst = mergeIdentities(await store.senderTotalsOf(db, firstDay, day, identityAddresses(c.labels, identity)), book.resolve).find((i) => i.key === identity.key);
    out.push({
      key: identity.key,
      label: identity.label,
      x: identity.x,
      kind: identity.kind,
      inferred: identity.inferred,
      day,
      first_day: firstDay,
      rank: rank + 1,
      messages: identity.messages,
      total_messages: sinceFirst?.messages ?? identity.messages,
      chains: identity.chains,
    });
  }
  return out;
}
```

In `worker/src/jobs/finalize.ts`, import `recordSenderArrivals` from `'../senders'`, add at the end of `finalizeDay` (after `setFeeGroupTotals`):

```ts
  await recordArrivalsSafely(c, day, breakdown);
```

and below it:

```ts
/** New senders feed a moment, not the day's numbers, so a failure to record them alerts and lets the day finalize. */
async function recordArrivalsSafely(c: RunContext, day: string, breakdown: readonly DailyBreakdown[]): Promise<void> {
  try {
    await recordSenderArrivals(c, day, breakdown);
  } catch (err) {
    await c.alert(`sender-arrivals:${day}`, `New senders for ${day} were not recorded: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

(adding `type DailyBreakdown` to its `@ccip-dev/core` import).

In `worker/src/moments.ts`, import `senderArrivals` from `'./senders'`, and in `buildMoments`'s `arrivals` add `senders: await senderArrivals(c, since, lastDay),` after `tokens`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/senders.test.ts test/finalize.test.ts test/store.test.ts test/publish.test.ts test/moments.test.ts`
Expected: PASS. (`finalize.test.ts`'s existing runs record nobody: none of their senders reaches 20 messages.)

- [ ] **Step 8: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add worker/migrations/0007_sender_arrivals.sql packages/core/src/senders.ts packages/core/src/public.ts worker/src/store.ts worker/src/senders.ts worker/src/jobs/finalize.ts \
  worker/src/moments.ts packages/core/test/senders.test.ts worker/test/senders.test.ts worker/test/finalize.test.ts worker/test/store.test.ts worker/test/publish.test.ts
git commit -m "feat(worker): record new senders at finalize, and list them in moments.json

An identity that enters the day's top 10 with 20+ messages, having first sent within
the last 30 days, is recorded once as an arrival of kind sender (migration 0007
widens the CHECK) and listed with its day, first day, rank, messages and chains.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 12: The "New on CCIP" sender moment: its target, plan, facts, copy and card

**Files:**
- Modify: `packages/core/src/broadcasts.ts`
- Modify: `worker/src/broadcasts/moment-plan.ts`, `worker/src/broadcasts/moment-facts.ts`, `worker/src/broadcasts/moment-copy.ts`
- Create: `site/worker/cards/project-cards.ts`
- Modify: `site/worker/cards/broadcast-cards.ts`, `site/worker/cards/cta.ts`
- Modify: `site/test/fixtures/moments.ts` (a sender arrival)
- Test: `packages/core/test/broadcasts.test.ts`, `worker/test/moments-pipeline.test.ts`, `worker/test/moment-facts.test.ts`, `worker/test/moment-copy.test.ts`, `site/test/project-cards.test.ts` (new), `site/test/card-paths.test.ts`

**Interfaces:**
- **Consumes:** `SenderArrival` and `moments.json` `arrivals.senders` (Task 11); `newcomerSpan`, `parseSenderKey`, `senderKeyAddress` (Tasks 1 and 11).
- **Produces:**
  - `BroadcastTarget` gains `{ kind: 'newcomer'; key: string }` (an identity key); key `broadcast:newcomer:<key>`; card path `broadcast/newcomer/project/<slug>` or `broadcast/newcomer/address/<address>`; `BUDGETED_MOMENTS = ['welcome', 'newcomer', 'countdown', 'movers', 'spotlight', 'roundup']`; `newcomerPathOk(key: string): boolean`.
  - `NewcomerFacts { kind: 'newcomer'; key; sender: Player; slug: string | null; day; firstDay; rank; messages; total; chains: Player[] }`.
  - `newcomerTree(key, inputs)` in `site/worker/cards/project-cards.ts`; `SENDERS_CTA` in `cta.ts`.

**Plan:** due the day after the sender's day (like a welcome), carried 2 days, in the daily budget right after welcomes. **Ruling:** a key whose card path would not parse back (an address holding `:`, `/`, `_` or `-`) is never planned, since its card would 404 and the hourly run would alert on it forever.

**Copy (exact, for xStocks on 2026-10-13):**
- X: `🆕 New on #CCIP: @xStocksFi sent 319 messages on its first day` / `#1 sender on Tue, Oct 13 · 6 chains` / `Chains: Solana · Ink · X Layer · +3 more` (dropped first) / `#Chainlink $LINK` (dropped second).
- Telegram: `<b>New on CCIP: xStocks</b>` / `xStocks sent <b>319</b> messages on its first day, and was the #1 sender on Tue, Oct 13, 2026.` / `Chains: …` / `` / `#CCIP #Chainlink $LINK`.
- The span reads `on its first day`, `in its first week` (first message 1–6 days before) or `since Sep 20`. The subject is `@x` only for a verified, non-inferred project with a handle; anyone else is a plain name (an address by its short form). Chains are always plain names.

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/broadcasts.test.ts` (adding `newcomerPathOk` to its import), add to `targets`:

```ts
    [{ kind: 'newcomer', key: 'project:xstocks' }, 'broadcast:newcomer:project:xstocks', 'broadcast/newcomer/project/xstocks'],
    [
      { kind: 'newcomer', key: 'address:0x671be08d6d3c826c2f6d76915f1b54af484d4077' },
      'broadcast:newcomer:address:0x671be08d6d3c826c2f6d76915f1b54af484d4077',
      'broadcast/newcomer/address/0x671be08d6d3c826c2f6d76915f1b54af484d4077',
    ],
```

add `'broadcast/newcomer/project/XStocks', 'broadcast/newcomer/robot/x', 'broadcast/newcomer/address/a_b', 'broadcast/newcomer/project'` to the rejected paths, and append inside the same `describe`:

```ts
  it('plans a newcomer only when its key can be a card path', () => {
    // #then
    expect(['project:xstocks', 'address:A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u', 'address:a:b', 'address:a/b', 'address:a_b'].map(newcomerPathOk)).toEqual([true, true, false, false, false]);
  });
```

In `site/test/card-paths.test.ts`, add `['broadcast/newcomer/project/xstocks', { kind: 'broadcast', target: { kind: 'newcomer', key: 'project:xstocks' } }],` to the round-trip list.

In `worker/test/moments-pipeline.test.ts`, append inside `describe('dueMoments')`:

```ts
  it('plans a new sender the day after its day, and never one whose key cannot be a card path', () => {
    // #given
    const arrival = (key: string) => ({ key, label: null, x: null, kind: null, inferred: false, day: '2026-10-13', first_day: '2026-10-13', rank: 1, messages: 30, total_messages: 30, chains: [] });
    const m: MomentsBody = { ...MOMENTS, arrivals: { ...MOMENTS.arrivals, chains: [], senders: [arrival('project:xstocks'), arrival('address:a:b')] } };
    // #when
    const due = dueMoments(m, '2026-10-14').flatMap((d) => (d.target.kind === 'newcomer' ? [[d.target.key, d.due]] : []));
    // #then
    expect(due).toEqual([['project:xstocks', '2026-10-14']]);
  });

  it('plans no new sender from a moments.json published before senders', () => {
    // #then MOMENTS has no arrivals.senders
    expect(dueMoments(MOMENTS, '2026-10-14').some((d) => d.target.kind === 'newcomer')).toBe(false);
  });
```

and inside `describe('pickMoments')`:

```ts
  it('takes a new sender right after a welcome and before a countdown', () => {
    // #when
    const picked = pickMoments([d({ kind: 'countdown', metric: 'fees', threshold: 1e6 }, '2026-10-15'), d({ kind: 'newcomer', key: 'project:xstocks' }, '2026-10-15'), d({ kind: 'welcome', selector: 'a' }, '2026-10-15')], { done: new Set(), sentToday: 0 });
    // #then
    expect(keys(picked)).toEqual(['welcome:a', 'newcomer']);
  });
```

In `worker/test/moment-facts.test.ts`, append inside `describe('momentFacts')`:

```ts
  it('describes a new sender, tagging a verified project and never one credited through a spread label', () => {
    // #given xStocks, and a project known only through a spread label
    const arrival = { key: 'project:xstocks', label: 'xStocks', x: 'xStocksFi', kind: 'protocol', inferred: false, day: '2026-10-13', first_day: '2026-10-09', rank: 1, messages: 319, total_messages: 520, chains: ['2', '1'] };
    const src = { ...SRC, moments: { ...MOMENTS, arrivals: { ...MOMENTS.arrivals, senders: [arrival, { ...arrival, key: 'project:spread', label: 'Spread', x: 'spread', inferred: true }] } } };
    // #when
    const xstocks = momentFacts(src, { kind: 'newcomer', key: 'project:xstocks' });
    const spread = momentFacts(src, { kind: 'newcomer', key: 'project:spread' });
    // #then
    expect({ xstocks, spread: spread?.kind === 'newcomer' ? spread.sender : null }).toEqual({
      xstocks: {
        kind: 'newcomer', key: 'project:xstocks', sender: { name: 'xStocks', x: 'xStocksFi' }, slug: 'xstocks', day: '2026-10-13', firstDay: '2026-10-09',
        rank: 1, messages: 319, total: 520, chains: [{ name: 'Base', x: 'base' }, { name: 'Ethereum', x: 'ethereum' }],
      },
      spread: { name: 'Spread', x: null },
    });
  });
```

and add `momentFacts(SRC, { kind: 'newcomer', key: 'project:nobody' }),` (with one more `null`) to `'has no facts for a moment the data does not hold'`.

In `worker/test/moment-copy.test.ts`, add `NewcomerFacts` to the `moment-facts` type import and, after `const ROUNDUP …`, add:

```ts
const NEWCOMER: NewcomerFacts = {
  kind: 'newcomer', key: 'project:xstocks', sender: p('xStocks', 'xStocksFi'), slug: 'xstocks', day: '2026-10-13', firstDay: '2026-10-13', rank: 1, messages: 319, total: 319,
  chains: [p('Solana', 'solana'), p('Ink', 'inkonchain'), p('X Layer', 'XLayerOfficial'), p('BNB Chain', 'BNBCHAIN'), p('Ethereum', 'ethereum'), p('HyperEVM')],
};
```

then append:

```ts
describe('the new sender moment', () => {
  it('writes the X post with the subject tagged, its first day, its rank and its chains', () => {
    // #then
    expect(composeMomentCopy(NEWCOMER).xText).toBe(
      ['🆕 New on #CCIP: @xStocksFi sent 319 messages on its first day', '#1 sender on Tue, Oct 13 · 6 chains', 'Chains: Solana · Ink · X Layer · +3 more', '#Chainlink $LINK'].join('\n'),
    );
  });

  it('says the same on Telegram with names and a bold count', () => {
    // #then
    expect(composeMomentCopy(NEWCOMER).telegramHtml).toBe(
      [
        '<b>New on CCIP: xStocks</b>',
        'xStocks sent <b>319</b> messages on its first day, and was the #1 sender on Tue, Oct 13, 2026.',
        'Chains: Solana · Ink · X Layer · +3 more',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
    );
  });

  it('tags only the subject, and no one for an unlabeled address, which it names by its short form', () => {
    // #given
    const address: NewcomerFacts = { ...NEWCOMER, key: 'address:0x671be08d6d3c826c2f6d76915f1b54af484d4077', sender: p('0x671b…4077'), slug: null, total: 76, firstDay: '2026-10-08', chains: [p('Base', 'base')] };
    // #when
    const [project, unlabeled] = [NEWCOMER, address].map((f) => composeMomentCopy(f).xText);
    // #then
    expect([project!.match(/@\w+/g), unlabeled!.match(/@\w+/g), unlabeled!.split('\n').slice(0, 2)]).toEqual([
      ['@xStocksFi'],
      null,
      ['🆕 New on #CCIP: 0x671b…4077 sent 76 messages in its first week', '#1 sender on Tue, Oct 13'],
    ]);
  });

  it('counts from the first message when it came over a week before', () => {
    // #then
    expect(composeMomentCopy({ ...NEWCOMER, firstDay: '2026-09-20', total: 2_400 }).xText.split('\n')[0]).toBe('🆕 New on #CCIP: @xStocksFi sent 2,400 messages since Sep 20');
  });
});
```

In `site/test/fixtures/moments.ts`, add to `MOMENTS.arrivals` (after `tokens`):

```ts
    senders: [
      { key: 'project:xstocks', label: 'xStocks', x: 'xStocksFi', kind: 'protocol', inferred: false, day: '2026-10-11', first_day: '2026-10-09', rank: 1, messages: 319, total_messages: 520, chains: [ETH, BASE] },
    ],
```

Create `site/test/project-cards.test.ts`:

```ts
import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { describe, expect, it } from 'vitest';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import { BASE, texts } from './fixtures/broadcast';
import { loadMoments, MOMENTS, withMoments } from './fixtures/moments';

const inputs = { load: loadMoments, icon: async (selector: string) => (selector === BASE ? 'data:image/svg+xml;base64,AAAA' : null) };
const words = async (target: BroadcastTarget, load = loadMoments) => texts(await broadcastTree(target, { ...inputs, load }));

describe('new sender card', () => {
  it('names the project big with its rank, its messages since its first day, its chains and its page', async () => {
    // #then
    expect(await words({ kind: 'newcomer', key: 'project:xstocks' })).toEqual(
      expect.arrayContaining([
        'New on CCIP · Sun, Oct 11, 2026', 'NEW ON CCIP', '#1 sender of the day', 'xStocks', '520 messages ', 'in its first week',
        'First message ', 'Oct 9, 2026 ', '· 2 chains', 'On ', 'Ethereum', ' · ', 'Base', 'Its page: ', 'ccip.dev/projects/xstocks',
      ]),
    );
  });

  it('names an unlabeled sender by its short address and points to Top senders', async () => {
    // #given
    const address = { ...MOMENTS.arrivals.senders![0]!, key: 'address:0x671be08d6d3c826c2f6d76915f1b54af484d4077', label: null, x: null, kind: null };
    const load = withMoments({ arrivals: { ...MOMENTS.arrivals, senders: [address] } });
    // #then
    expect(await words({ kind: 'newcomer', key: address.key }, load)).toEqual(expect.arrayContaining(['0x671b…4077', 'Every sender: ', 'ccip.dev/top/sender/7d']));
  });

  it('has no card for a sender moments.json does not list, and writes no glyph the fonts lack', async () => {
    // #when
    const missing = await broadcastTree({ kind: 'newcomer', key: 'project:nobody' }, inputs);
    const all = await words({ kind: 'newcomer', key: 'project:xstocks' });
    // #then
    expect({ missing, glyphs: all.filter((w) => MISSING_GLYPHS.test(w)) }).toEqual({ missing: null, glyphs: [] });
  });
});
```

Run:

```bash
pnpm --filter @ccip-dev/core exec vitest run test/broadcasts.test.ts
pnpm --filter @ccip-dev/worker exec vitest run test/moments-pipeline.test.ts test/moment-facts.test.ts test/moment-copy.test.ts
pnpm --filter @ccip-dev/site exec vitest run test/project-cards.test.ts test/card-paths.test.ts
```

Expected: FAIL.

- [ ] **Step 2: The target**

In `packages/core/src/broadcasts.ts`:
- add `| { kind: 'newcomer'; key: string }` to `BroadcastTarget` (after `welcome`);
- `export const BUDGETED_MOMENTS = ['welcome', 'newcomer', 'countdown', 'movers', 'spotlight', 'roundup'] as const;`
- in `broadcastKey`: `case 'newcomer': return \`broadcast:newcomer:${t.key}\`;`
- in `broadcastCardPath`: `case 'newcomer': return \`broadcast/newcomer/${t.key.replace(':', '/')}\`;` (the first colon only: `project:xstocks` becomes `project/xstocks`);
- next to `SELECTOR_RE`, add:

```ts
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** EVM and base58 addresses; an address of another shape gets no newcomer card. */
const NEWCOMER_ADDRESS_RE = /^[0-9A-Za-z]{1,128}$/;
```

- in `parseBroadcastPath`, before the `WEEKLY_MOMENTS` line:

```ts
  if (kind === 'newcomer' && b !== undefined && ((a === 'project' && SLUG_RE.test(b)) || (a === 'address' && NEWCOMER_ADDRESS_RE.test(b)))) return { kind: 'newcomer', key: `${a}:${b}` };
```

- after `parseBroadcastPath`:

```ts
/** A newcomer can post only when its card path parses back to it. */
export function newcomerPathOk(key: string): boolean {
  return parseBroadcastPath(broadcastCardPath({ kind: 'newcomer', key }).split('/')) !== null;
}
```

- [ ] **Step 3: Plan it**

In `worker/src/broadcasts/moment-plan.ts`, add `newcomerPathOk` to the `@ccip-dev/core/broadcasts` import, and in `dueMoments`, after the welcome loop:

```ts
  for (const s of m.arrivals.senders ?? []) {
    const due = addDays(s.day, 1);
    if (inWindow(due) && newcomerPathOk(s.key)) out.push({ target: { kind: 'newcomer', key: s.key }, due });
  }
```

Update `pickMoments`'s comment to list the order: welcome, a new sender, countdown, movers, spotlight, then the weekly New on CCIP.

- [ ] **Step 4: The facts**

In `worker/src/broadcasts/moment-facts.ts`:
- imports: add `parseSenderKey, senderKeyAddress` to `import { addDays, dayOf } from '@ccip-dev/core';`, and `SenderArrival` to the `@ccip-dev/core/public` type import;
- add:

```ts
export interface NewcomerFacts {
  kind: 'newcomer';
  key: string;
  /** The post's subject: tagged by its handle only as a verified project, never through a spread label. */
  sender: Player;
  /** The project's page, or null for an address. */
  slug: string | null;
  day: string;
  firstDay: string;
  rank: number;
  /** Its messages on `day`. */
  messages: number;
  /** Its messages from its first day through `day`. */
  total: number;
  chains: Player[];
}
```

- add `NewcomerFacts` to the `MomentFacts` union and `'newcomer'` to `MOMENT_FACT_KINDS`;
- add:

```ts
function newcomerFacts(tags: Tagger, a: SenderArrival): NewcomerFacts {
  const parsed = parseSenderKey(a.key);
  return {
    kind: 'newcomer',
    key: a.key,
    sender: { name: a.label ?? shortAddress(senderKeyAddress(a.key)), x: a.inferred ? null : a.x },
    slug: parsed.kind === 'project' ? parsed.slug : null,
    day: a.day,
    firstDay: a.first_day,
    rank: a.rank,
    messages: a.messages,
    total: a.total_messages,
    chains: a.chains.map((s) => tags.chain(s)),
  };
}
```

- in `momentFacts`, after the `welcome` case:

```ts
    case 'newcomer': {
      const a = (moments.arrivals.senders ?? []).find((s) => s.key === target.key);
      return a ? newcomerFacts(tags, a) : null;
    }
```

- [ ] **Step 5: The copy**

In `worker/src/broadcasts/moment-copy.ts`:
- add `newcomerSpan` to `import { addDays } from '@ccip-dev/core';`, `postDay` to the `./copy` import, and `NewcomerFacts` to the `./moment-facts` type import;
- add after the welcome functions:

```ts
const SPAN_WORDS = { 'first-day': 'on its first day', 'first-week': 'in its first week' } as const;

function newcomerSpanText(f: NewcomerFacts): string {
  const span = newcomerSpan(f.firstDay, f.day);
  return span === 'since' ? `since ${shortDay(f.firstDay)}` : SPAN_WORDS[span];
}

function newcomerX(f: NewcomerFacts): Line[] {
  return [
    { text: `🆕 New on #CCIP: ${subject(f.sender)} sent ${plural(f.total, 'message')} ${newcomerSpanText(f)}` },
    { text: `#${f.rank} sender on ${postDay(f.day)}${f.chains.length > 1 ? ` · ${plural(f.chains.length, 'chain')}` : ''}` },
    ...(f.chains.length > 0 ? [{ text: `Chains: ${shownList(f.chains, 3, plain)}`, drop: MOMENT_DROP.detail }] : []),
    { text: '#Chainlink $LINK', drop: MOMENT_DROP.closing },
  ];
}

function newcomerTg(f: NewcomerFacts): Line[] {
  const name = tgName(f.sender);
  return [
    { text: bold(`New on CCIP: ${name}`) },
    { text: `${name} sent ${bold(formatCount(f.total))} message${f.total === 1 ? '' : 's'} ${newcomerSpanText(f)}, and was the #${f.rank} sender on ${longDay(f.day)}.` },
    ...(f.chains.length > 0 ? [{ text: `Chains: ${shownList(f.chains, 3, tgName)}`, drop: MOMENT_DROP.detail }] : []),
    { text: '' },
    { text: CLOSING_TG, drop: MOMENT_DROP.closing },
  ];
}
```

- add `case 'newcomer': return newcomerX(f);` to `momentX` and `case 'newcomer': return newcomerTg(f);` to `momentTelegram`.

- [ ] **Step 6: The card**

In `site/worker/cards/cta.ts`, add `export const SENDERS_CTA: Cta = { lead: 'Every sender:', path: 'ccip.dev/top/sender/7d' };`.

Create `site/worker/cards/project-cards.ts`:

```ts
import { formatCount, formatUtcDay } from '@ccip-dev/core/format';
import { chainName, shortAddress } from '@ccip-dev/core/names';
import type { SenderArrival } from '@ccip-dev/core/public';
import { newcomerSpan, parseSenderKey, senderKeyAddress } from '@ccip-dev/core/senders';
import type { Child, VNode } from '../h';
import {
  bigText, bold, broadcastFrame, cardDay, COLORS, columnLine, eyebrow, hasReplayDay, iconsFor, loadMomentFiles, momentColumn, nameSize, namesOf, pill, PILLS, skyFor,
  TEXT_COLUMN, type BroadcastInputs,
} from './broadcast-frame';
import { SENDERS_CTA, type Cta } from './cta';
import { skyNodes } from './orbit-sky';

const SPAN_WORDS = { 'first-day': 'on its first day', 'first-week': 'in its first week' } as const;
const counted = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;
const listed = (names: readonly string[]): Child[] => names.flatMap((n, i): Child[] => [...(i > 0 ? [' · '] : []), bold(n)]);
export const projectCta = (slug: string): Cta => ({ lead: 'Its page:', path: `ccip.dev/projects/${slug}` });

function spanText(a: SenderArrival): string {
  const span = newcomerSpan(a.first_day, a.day);
  return span === 'since' ? `since ${formatUtcDay(a.first_day)}` : SPAN_WORDS[span];
}

/** A new sender big in the column, its busiest chain gold in the day's sky. */
export async function newcomerTree(key: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const files = await loadMomentFiles(inputs);
  if (files === null) return null;
  const { moments, replay, chains } = files;
  const arrival = (moments.arrivals.senders ?? []).find((s) => s.key === key);
  if (arrival === undefined || !hasReplayDay(replay, arrival.day)) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, arrival.day, arrival.day, { gold: arrival.chains[0] ?? null, starFree: [TEXT_COLUMN] });
  const name = arrival.label ?? shortAddress(senderKeyAddress(arrival.key));
  const parsed = parseSenderKey(arrival.key);
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `New on CCIP · ${cardDay(arrival.day)}`,
    body: momentColumn(
      pill('NEW ON CCIP', PILLS.green, 'star'),
      eyebrow(`#${arrival.rank} sender of the day`, { marginTop: 24 }),
      bigText(name, nameSize(name)),
      columnLine([bold(`${counted(arrival.total_messages, 'message')} `), spanText(arrival)]),
      columnLine(['First message ', bold(`${formatUtcDay(arrival.first_day)} `), `· ${counted(arrival.chains.length, 'chain')}`], { fontSize: 24, color: COLORS.soft }),
    ),
    insight: arrival.chains.length === 0 ? [] : ['On ', ...listed(arrival.chains.slice(0, 3).map((s) => chainName(names, s)))],
    cta: parsed.kind === 'project' ? projectCta(parsed.slug) : SENDERS_CTA,
  });
}
```

In `site/worker/cards/broadcast-cards.ts`, import `newcomerTree` from `./project-cards` and add `case 'newcomer': return newcomerTree(target.key, inputs);` to `broadcastTree`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @ccip-dev/core exec vitest run test/broadcasts.test.ts
pnpm --filter @ccip-dev/worker exec vitest run test/moments-pipeline.test.ts test/moment-facts.test.ts test/moment-copy.test.ts
pnpm --filter @ccip-dev/site exec vitest run test/project-cards.test.ts test/card-paths.test.ts test/moment-cards.test.ts
```

Expected: PASS, and the existing `"tags only each post's subject on X: …"` still tags `[['@tempo'], [], ['@base'], ['@base'], [], []]`.

- [ ] **Step 8: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add packages/core/src/broadcasts.ts worker/src/broadcasts/moment-plan.ts worker/src/broadcasts/moment-facts.ts worker/src/broadcasts/moment-copy.ts \
  site/worker/cards/project-cards.ts site/worker/cards/broadcast-cards.ts site/worker/cards/cta.ts site/test/fixtures/moments.ts site/test/project-cards.test.ts \
  site/test/card-paths.test.ts packages/core/test/broadcasts.test.ts worker/test/moments-pipeline.test.ts worker/test/moment-facts.test.ts worker/test/moment-copy.test.ts
git commit -m "feat(moments): New on CCIP for a sender, with its card

The day after a new identity enters the top 10, a post names it (tagging a verified
project's handle, never an inferred one), its messages since its first day, its rank
and its chains.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 13: The weekly project spotlight moment

**Files:**
- Modify: `packages/core/src/moments.ts`, `packages/core/src/senders.ts`, `packages/core/src/public.ts`, `packages/core/src/broadcasts.ts`
- Modify: `worker/src/moments.ts`
- Modify: `worker/src/broadcasts/moment-plan.ts`, `worker/src/broadcasts/moment-facts.ts`, `worker/src/broadcasts/moment-copy.ts`
- Modify: `site/worker/cards/project-cards.ts`, `site/worker/cards/broadcast-cards.ts`
- Modify: `site/test/fixtures/moments.ts`
- Test: `packages/core/test/moments.test.ts`, `packages/core/test/senders.test.ts`, `packages/core/test/broadcasts.test.ts`, `worker/test/moments.test.ts`, `worker/test/moments-pipeline.test.ts`, `worker/test/moment-facts.test.ts`, `worker/test/moment-copy.test.ts`, `site/test/project-cards.test.ts`, `site/test/card-paths.test.ts`

**Interfaces:**
- **Consumes:** Task 1's identity functions, Task 2's `senderTotalsOf`, Task 3's `senderBook`, Task 12's `project-cards.ts` (`projectCta`).
- **Produces:**
  - Core: `PROJECT_SPOTLIGHT_MIN_MESSAGES = 50`, `interface ProjectWeekCount { key: string; messages: number; previous: number }`, `projectSpotlightPick(projects): string | null`; `kindPhrase(kind: string | null): string | null`.
  - `ProjectSpotlightSchema` = `{ key, slug, name, x, kind, inferred, messages, previous_messages, usd, fee_usd, chains }`; `MomentsWeekSchema.project` (optional, nullable); `type ProjectSpotlight`.
  - `BroadcastTarget` gains `{ kind: 'project'; monday: string }` (key `broadcast:project:<monday>`, path `broadcast/project/<monday>`); `BUDGETED_MOMENTS = ['welcome', 'newcomer', 'countdown', 'movers', 'spotlight', 'project', 'roundup']`; `WEEKLY_DUE.project = 9`.
  - `ProjectSpotlightFacts { kind: 'project'; monday; project: Player; slug; projectKind; messages; previous; usd; feeUsd; chains: Player[] }`; `projectSpotlightTree(monday, inputs)`.

**Rule (spec §7, ruling in Global Constraints):** of the labeled projects (verified or inferred), the one that gained the most messages over the week before, with at least 50 this week and more than the week before; ties go to more messages, then the key. No repeat-skip. Posted on the Wednesday after its week (Monday + 9), in the budget after the chain spotlight.

**Copy (exact, for 2,100 messages against 1,400, $0 moved, $525 in fees, on Ethereum and Base):**
- X: `Project spotlight: @xStocksFi, a protocol, grew the most on #CCIP last week` / `2,100 messages (▲ 50% vs the week before) · $525 in fees` / `Chains: Ethereum · Base` (dropped first) / `#Chainlink $LINK`.
- Telegram: `<b>Project spotlight: xStocks</b>` / `xStocks, a protocol, grew the most on CCIP last week: <b>2,100</b> messages (▲ 50% vs the week before).` / `<b>$525</b> in fees` / `Chains: Ethereum · Base` / `` / `#CCIP #Chainlink $LINK`.
- The kind clause comes from `kind`: protocol "a protocol", app "an app", institution "an institution", exchange "an exchange", issuer "a token issuer"; an unknown kind has none. A value or fee figure that is zero or missing is left out. The subject is untagged when it is inferred.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/moments.test.ts` (adding `projectSpotlightPick` to its `../src/moments` import):

```ts
describe('projectSpotlightPick', () => {
  it('picks the project that gained the most messages on the week before, with 50 or more this week', () => {
    // #then b grew more in percent, a in messages; c is under 50
    expect(projectSpotlightPick([{ key: 'a', messages: 300, previous: 100 }, { key: 'b', messages: 120, previous: 10 }, { key: 'c', messages: 49, previous: 0 }])).toBe('a');
  });

  it('picks no project that shrank or stayed flat, and none from an empty week', () => {
    // #then
    expect([projectSpotlightPick([{ key: 'a', messages: 300, previous: 300 }, { key: 'b', messages: 60, previous: 90 }]), projectSpotlightPick([])]).toEqual([null, null]);
  });

  it('breaks a tie in gain by more messages, then by key', () => {
    // #then
    expect([
      projectSpotlightPick([{ key: 'a', messages: 150, previous: 50 }, { key: 'b', messages: 300, previous: 200 }]),
      projectSpotlightPick([{ key: 'b', messages: 100, previous: 0 }, { key: 'a', messages: 100, previous: 0 }]),
    ]).toEqual(['b', 'a']);
  });
});
```

Append to `packages/core/test/senders.test.ts` (adding `kindPhrase` to the import):

```ts
describe('kindPhrase', () => {
  it('words each label kind for a post, and leaves an unknown one out', () => {
    // #then
    expect(['protocol', 'app', 'institution', 'exchange', 'issuer', 'unknown', null].map(kindPhrase)).toEqual(['a protocol', 'an app', 'an institution', 'an exchange', 'a token issuer', null, null]);
  });
});
```

In `packages/core/test/broadcasts.test.ts`, add `[{ kind: 'project', monday: '2026-10-05' }, 'broadcast:project:2026-10-05', 'broadcast/project/2026-10-05'],` to `targets` and `'broadcast/project/2026-10-06'` to the rejected paths. In `site/test/card-paths.test.ts`, add `['broadcast/project/2026-10-05', { kind: 'broadcast', target: { kind: 'project', monday: '2026-10-05' } }],`.

Append to `worker/test/moments.test.ts`:

```ts
describe('moments.json project spotlight', () => {
  const ALPHA = '0x00000000000000000000000000000000000000a1';
  const BETA = '0x00000000000000000000000000000000000000b2';
  const labels = {
    [`ethereum-mainnet-base-1:${ALPHA}`]: { name: 'Alpha', x: 'alpha', kind: 'app' as const, slug: 'alpha' },
    [`ethereum-mainnet-base-1:${BETA}`]: { name: 'Beta', kind: 'protocol' as const, slug: 'beta' },
  };
  const sender = (day: string, address: string, messages: number) => row(day, 'sender', `${BASE}:${address}`, messages, 0, messages / 4);

  beforeEach(async () => {
    // #given the week of Sep 28: Alpha 100, Beta 400; the week of Oct 5: Alpha 300, Beta 500
    await seedRegistryChains();
    await seedRows([sender('2026-09-29', ALPHA, 100), sender('2026-09-29', BETA, 400), sender('2026-10-06', ALPHA, 300), sender('2026-10-06', BETA, 500)]);
  });

  it('spotlights the labeled project that gained the most messages each week', async () => {
    // #when
    const { weeks } = await buildMoments(harness({ now: NOW, labels }).c, { lastDay: LAST_DAY, days: [] });
    // #then Beta gained 400 from nothing in the week of Sep 28; Alpha gained 200 the week after, against Beta's 100
    expect({ before: weeks.at(-2)!.project?.key, latest: weeks.at(-1)!.project }).toEqual({
      before: 'project:beta',
      latest: { key: 'project:alpha', slug: 'alpha', name: 'Alpha', x: 'alpha', kind: 'app', inferred: false, messages: 300, previous_messages: 100, usd: 0, fee_usd: 75, chains: [BASE] },
    });
  });

  it('spotlights no project in a week without labeled senders', async () => {
    // #when
    const { weeks } = await buildMoments(harness({ now: NOW }).c, { lastDay: LAST_DAY, days: [] });
    // #then
    expect(weeks.at(-1)!.project).toBeNull();
  });
});
```

In `worker/test/moments-pipeline.test.ts`, append inside `describe('dueMoments')`:

```ts
  it('plans the project spotlight on the Wednesday after its week', () => {
    // #given
    const project = { key: 'project:xstocks', slug: 'xstocks', name: 'xStocks', x: 'xStocksFi', kind: 'protocol', inferred: false, messages: 2_100, previous_messages: 1_400, usd: 0, fee_usd: 525, chains: [] };
    const m: MomentsBody = { ...MOMENTS, weeks: MOMENTS.weeks.map((w) => (w.week === '2026-10-05' ? { ...w, project } : w)) };
    // #when
    const due = dueMoments(m, '2026-10-14').flatMap((d) => (d.target.kind === 'project' ? [[d.target.monday, d.due]] : []));
    // #then
    expect(due).toEqual([['2026-10-05', '2026-10-14']]);
  });
```

In `worker/test/moment-facts.test.ts`, append inside `describe('momentFacts')`:

```ts
  it('describes the project spotlight, untagged when the project is credited only through a spread label', () => {
    // #given
    const project = { key: 'project:xstocks', slug: 'xstocks', name: 'xStocks', x: 'xStocksFi', kind: 'protocol', inferred: false, messages: 2_100, previous_messages: 1_400, usd: 0, fee_usd: 525, chains: ['1', '2'] };
    const withProject = (p: typeof project) => ({ ...SRC, moments: { ...MOMENTS, weeks: MOMENTS.weeks.map((w) => (w.week === '2026-10-05' ? { ...w, project: p } : w)) } });
    // #when
    const facts = momentFacts(withProject(project), { kind: 'project', monday: '2026-10-05' });
    const inferred = momentFacts(withProject({ ...project, inferred: true }), { kind: 'project', monday: '2026-10-05' });
    // #then
    expect({ facts, inferred: inferred?.kind === 'project' ? inferred.project : null }).toEqual({
      facts: {
        kind: 'project', monday: '2026-10-05', project: { name: 'xStocks', x: 'xStocksFi' }, slug: 'xstocks', projectKind: 'protocol',
        messages: 2_100, previous: 1_400, usd: 0, feeUsd: 525, chains: [{ name: 'Ethereum', x: 'ethereum' }, { name: 'Base', x: 'base' }],
      },
      inferred: { name: 'xStocks', x: null },
    });
  });
```

and add `momentFacts(SRC, { kind: 'project', monday: '2026-09-28' }),` (one more `null`) to `'has no facts for a moment the data does not hold'`.

In `worker/test/moment-copy.test.ts`, add `ProjectSpotlightFacts` to the type import, and after `NEWCOMER`:

```ts
const PROJECT: ProjectSpotlightFacts = {
  kind: 'project', monday: '2026-10-05', project: p('xStocks', 'xStocksFi'), slug: 'xstocks', projectKind: 'protocol',
  messages: 2_100, previous: 1_400, usd: 0, feeUsd: 525, chains: [p('Ethereum', 'ethereum'), p('Base', 'base')],
};
```

then append:

```ts
describe('the project spotlight', () => {
  it('writes the X post with the project tagged, what it is, its growth and its chains', () => {
    // #then
    expect(composeMomentCopy(PROJECT).xText).toBe(
      [
        'Project spotlight: @xStocksFi, a protocol, grew the most on #CCIP last week',
        '2,100 messages (▲ 50% vs the week before) · $525 in fees',
        'Chains: Ethereum · Base',
        '#Chainlink $LINK',
      ].join('\n'),
    );
  });

  it('says the same on Telegram', () => {
    // #then
    expect(composeMomentCopy(PROJECT).telegramHtml).toBe(
      [
        '<b>Project spotlight: xStocks</b>',
        'xStocks, a protocol, grew the most on CCIP last week: <b>2,100</b> messages (▲ 50% vs the week before).',
        '<b>$525</b> in fees',
        'Chains: Ethereum · Base',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
    );
  });

  it('leaves out the kind it does not know, the change from a week with none, and a value of $0', () => {
    // #when
    const [title, figures] = composeMomentCopy({ ...PROJECT, project: p('Newco'), projectKind: 'unknown', previous: 0, feeUsd: null }).xText.split('\n');
    // #then
    expect([title, figures]).toEqual(['Project spotlight: Newco grew the most on #CCIP last week', '2,100 messages']);
  });
});
```

and add `PROJECT` with `['@xStocksFi']` to the moment tags test's lists: `const facts = [WELCOME, COUNTDOWN, MOVERS, SPOTLIGHT, ROUNDUP, POLL, PROJECT];` expecting `[['@tempo'], [], ['@base'], ['@base'], [], [], ['@xStocksFi']]`.

In `site/test/fixtures/moments.ts`, add to the week of `MONDAY` (after its `spotlight`):

```ts
      project: { key: 'project:xstocks', slug: 'xstocks', name: 'xStocks', x: 'xStocksFi', kind: 'protocol', inferred: false, messages: 2_100, previous_messages: 1_400, usd: 0, fee_usd: 525, chains: [ETH, BASE] },
```

Append to `site/test/project-cards.test.ts`:

```ts
describe('project spotlight card', () => {
  it('names the project big with its growth, its chains, its fees and its page', async () => {
    // #then
    expect(await words({ kind: 'project', monday: '2026-10-05' })).toEqual(
      expect.arrayContaining([
        'PROJECT SPOTLIGHT', 'Fastest-growing project', 'xStocks', '2,100 messages ', '50% vs the week before',
        'On ', 'Ethereum', ' · ', 'Base', 'Paid ', '$525', ' in fees last week', 'Its page: ', 'ccip.dev/projects/xstocks',
      ]),
    );
  });

  it('has no card for a week without a spotlighted project', async () => {
    // #then
    expect(await broadcastTree({ kind: 'project', monday: '2026-09-28' }, inputs)).toBeNull();
  });
});
```

Run:

```bash
pnpm --filter @ccip-dev/core exec vitest run test/moments.test.ts test/senders.test.ts test/broadcasts.test.ts
pnpm --filter @ccip-dev/worker exec vitest run test/moments.test.ts test/moments-pipeline.test.ts test/moment-facts.test.ts test/moment-copy.test.ts
pnpm --filter @ccip-dev/site exec vitest run test/project-cards.test.ts test/card-paths.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Core: the pick, the kind phrase, the schema and the target**

Append to `packages/core/src/moments.ts`:

```ts
export const PROJECT_SPOTLIGHT_MIN_MESSAGES = 50;

export interface ProjectWeekCount {
  key: string;
  messages: number;
  previous: number;
}

/** The project that gained the most messages on the week before, with 50 or more this week; ties go to more messages, then the key. */
export function projectSpotlightPick(projects: readonly ProjectWeekCount[]): string | null {
  const grown = projects.filter((p) => p.messages >= PROJECT_SPOTLIGHT_MIN_MESSAGES && p.messages > p.previous);
  grown.sort((a, b) => b.messages - b.previous - (a.messages - a.previous) || b.messages - a.messages || compare(a.key, b.key));
  return grown[0]?.key ?? null;
}
```

Append to `packages/core/src/senders.ts`:

```ts
const KIND_PHRASES: Readonly<Record<string, string>> = {
  protocol: 'a protocol',
  app: 'an app',
  institution: 'an institution',
  exchange: 'an exchange',
  issuer: 'a token issuer',
};

/** "a protocol", for a post's clause; null for an unknown kind, which the post leaves out. */
export function kindPhrase(kind: string | null): string | null {
  return kind === null ? null : (KIND_PHRASES[kind] ?? null);
}
```

In `packages/core/src/public.ts`, before `MomentsWeekSchema`:

```ts
export const ProjectSpotlightSchema = z.object({
  key: z.string(),
  slug: z.string(),
  name: z.string(),
  x: z.string().nullable(),
  kind: z.string(),
  inferred: z.boolean(),
  messages: z.number(),
  previous_messages: z.number(),
  usd: z.number(),
  fee_usd: z.number().nullable(),
  chains: z.array(z.string()),
});
```

add `project: ProjectSpotlightSchema.nullable().optional(),` to `MomentsWeekSchema` (after `spotlight`), and `export type ProjectSpotlight = z.infer<typeof ProjectSpotlightSchema>;`.

In `packages/core/src/broadcasts.ts`:
- add `| { kind: 'project'; monday: string }` to `BroadcastTarget` (after `spotlight`);
- `export const BUDGETED_MOMENTS = ['welcome', 'newcomer', 'countdown', 'movers', 'spotlight', 'project', 'roundup'] as const;`
- add `case 'project':` to the grouped `poll`/`movers`/`spotlight`/`roundup` cases in both `broadcastKey` and `broadcastCardPath`;
- `const WEEKLY_MOMENTS = ['poll', 'movers', 'spotlight', 'project', 'roundup'] as const;`

- [ ] **Step 3: The Worker: the pick in moments.json, the plan, the facts and the copy**

In `worker/src/moments.ts`:
- imports: add `mergeIdentities, type IdentityTotals` to the `@ccip-dev/core` import, `projectSpotlightPick` to the `@ccip-dev/core/moments` import, `ProjectSpotlight` to the `@ccip-dev/core/public` type import, and `import { senderBook, type SenderBook } from './senders';`;
- add:

```ts
type ProjectWeeks = (monday: string) => Promise<IdentityTotals[]>;

/** Each Monday–Sunday week's labeled projects, merged from every labeled row, each week read once per build. */
function projectWeeks(c: RunContext, book: SenderBook): ProjectWeeks {
  const cache = new Map<string, Promise<IdentityTotals[]>>();
  return (monday) => {
    let found = cache.get(monday);
    if (found === undefined) {
      found = store
        .senderTotalsOf(c.env.DB, monday, addDays(monday, 6), book.labeled)
        .then((rows) => mergeIdentities(rows, book.resolve).filter((i) => i.slug !== null));
      cache.set(monday, found);
    }
    return found;
  };
}

async function projectSpotlightOf(weeks: ProjectWeeks, monday: string): Promise<ProjectSpotlight | null> {
  const now = await weeks(monday);
  const before = new Map((await weeks(addDays(monday, -7))).map((p) => [p.key, p.messages]));
  const key = projectSpotlightPick(now.map((p) => ({ key: p.key, messages: p.messages, previous: before.get(p.key) ?? 0 })));
  const p = now.find((x) => x.key === key);
  if (p === undefined || p.slug === null || p.label === null || p.kind === null) return null;
  return {
    key: p.key,
    slug: p.slug,
    name: p.label,
    x: p.x,
    kind: p.kind,
    inferred: p.inferred,
    messages: p.messages,
    previous_messages: before.get(p.key) ?? 0,
    usd: cents(p.usd_value),
    fee_usd: centsOrNull(p.fee_usd),
    chains: p.chains,
  };
}
```

- in `momentWeeks`, add `const projects = projectWeeks(c, await senderBook(c));` before the loop, and `project: await projectSpotlightOf(projects, monday),` to each pushed week (after `spotlight`).

In `worker/src/broadcasts/moment-plan.ts`:
- `export const WEEKLY_DUE = { movers: 8, spotlight: 10, project: 9, roundup: 5 } as const;` (and add "the project spotlight on the Wednesday after it" to its comment);
- in the `for (const w of m.weeks)` loop, after the spotlight lines:

```ts
    const project = addDays(w.week, WEEKLY_DUE.project);
    if (inWindow(project) && (w.project ?? null) !== null) out.push({ target: { kind: 'project', monday: w.week }, due: project });
```

In `worker/src/broadcasts/moment-facts.ts`:

```ts
export interface ProjectSpotlightFacts {
  kind: 'project';
  monday: string;
  /** The post's subject: tagged by its handle unless it is credited only through a spread label. */
  project: Player;
  slug: string;
  projectKind: string;
  messages: number;
  previous: number;
  usd: number;
  feeUsd: number | null;
  chains: Player[];
}
```

add it to `MomentFacts` and `'project'` to `MOMENT_FACT_KINDS`, and to `momentFacts` (after `spotlight`):

```ts
    case 'project': {
      const p = moments.weeks.find((w) => w.week === target.monday)?.project;
      if (!p) return null;
      return {
        kind: 'project',
        monday: target.monday,
        project: { name: p.name, x: p.inferred ? null : p.x },
        slug: p.slug,
        projectKind: p.kind,
        messages: p.messages,
        previous: p.previous_messages,
        usd: p.usd,
        feeUsd: p.fee_usd,
        chains: p.chains.map((s) => tags.chain(s)),
      };
    }
```

In `worker/src/broadcasts/moment-copy.ts`, add `kindPhrase` to the `@ccip-dev/core` import and `ProjectSpotlightFacts` to the type import, then after the chain spotlight functions:

```ts
/** "$1.2M moved · $525 in fees", leaving out a zero value and missing fees. */
function projectFigures(f: ProjectSpotlightFacts, strong: (s: string) => string): string[] {
  return [...(f.usd > 0 ? [`${strong(formatUsd(f.usd))} moved`] : []), ...(f.feeUsd === null ? [] : [`${strong(formatFeeTotal(f.feeUsd))} in fees`])];
}

const kindClause = (f: ProjectSpotlightFacts) => {
  const phrase = kindPhrase(f.projectKind);
  return phrase === null ? '' : `, ${phrase},`;
};

const growth = (f: ProjectSpotlightFacts) => {
  const change = arrow(pctOf(f.messages, f.previous));
  return change === null ? '' : ` (${change} vs the week before)`;
};

function projectX(f: ProjectSpotlightFacts): Line[] {
  return [
    { text: `Project spotlight: ${subject(f.project)}${kindClause(f)} grew the most on #CCIP last week` },
    { text: [`${plural(f.messages, 'message')}${growth(f)}`, ...projectFigures(f, (s) => s)].join(' · ') },
    ...(f.chains.length > 0 ? [{ text: `Chains: ${shownList(f.chains, 3, plain)}`, drop: MOMENT_DROP.detail }] : []),
    { text: '#Chainlink $LINK', drop: MOMENT_DROP.closing },
  ];
}

function projectTg(f: ProjectSpotlightFacts): Line[] {
  const name = tgName(f.project);
  const figures = projectFigures(f, bold);
  return [
    { text: bold(`Project spotlight: ${name}`) },
    { text: `${name}${kindClause(f)} grew the most on CCIP last week: ${bold(formatCount(f.messages))} message${f.messages === 1 ? '' : 's'}${growth(f)}.` },
    ...(figures.length > 0 ? [{ text: figures.join(' · ') }] : []),
    ...(f.chains.length > 0 ? [{ text: `Chains: ${shownList(f.chains, 3, tgName)}`, drop: MOMENT_DROP.detail }] : []),
    { text: '' },
    { text: CLOSING_TG, drop: MOMENT_DROP.closing },
  ];
}
```

and add `case 'project': return projectX(f);` to `momentX` and `case 'project': return projectTg(f);` to `momentTelegram`.

- [ ] **Step 4: The card**

Append to `site/worker/cards/project-cards.ts` (adding `formatFeeTotal, formatShare, formatUsd` to the format import, `cardWeek` to the `broadcast-frame` import, `import { glyph } from './glyphs';` and `import { addDays } from '@ccip-dev/core/time';`):

```ts
/** The week's fastest-growing project big in the column, its busiest chain gold in the week's sky. */
export async function projectSpotlightTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const files = await loadMomentFiles(inputs);
  if (files === null) return null;
  const { moments, replay, chains } = files;
  const project = moments.weeks.find((w) => w.week === monday)?.project ?? null;
  const sunday = addDays(monday, 6);
  if (project === null || !hasReplayDay(replay, sunday)) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, monday, sunday, { gold: project.chains[0] ?? null, starFree: [TEXT_COLUMN] });
  const pct = project.previous_messages === 0 ? null : ((project.messages - project.previous_messages) / project.previous_messages) * 100;
  const change: Child[] =
    pct === null
      ? ['its first week on CCIP']
      : [glyph(pct >= 0 ? 'up' : 'down', 18, pct >= 0 ? COLORS.up : COLORS.down, { right: 6 }), `${formatShare(Math.abs(pct))} vs the week before`];
  const insight: Child[] =
    project.usd > 0
      ? ['Moved ', bold(formatUsd(project.usd)), ' last week']
      : project.fee_usd !== null
        ? ['Paid ', bold(formatFeeTotal(project.fee_usd)), ' in fees last week']
        : [];
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Project spotlight · ${cardWeek(monday)}`,
    body: momentColumn(
      pill('PROJECT SPOTLIGHT', PILLS.violet, 'star'),
      eyebrow('Fastest-growing project', { marginTop: 24 }),
      bigText(project.name, nameSize(project.name)),
      columnLine([bold(`${counted(project.messages, 'message')} `), ...change]),
      project.chains.length === 0 ? null : columnLine(['On ', ...listed(project.chains.slice(0, 3).map((s) => chainName(names, s)))], { fontSize: 24, color: COLORS.soft }),
    ),
    insight,
    cta: projectCta(project.slug),
  });
}
```

In `site/worker/cards/broadcast-cards.ts`, import `projectSpotlightTree` with `newcomerTree` and add `case 'project': return projectSpotlightTree(target.monday, inputs);` to `broadcastTree`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @ccip-dev/core exec vitest run test/moments.test.ts test/senders.test.ts test/broadcasts.test.ts
pnpm --filter @ccip-dev/worker exec vitest run test/moments.test.ts test/moments-pipeline.test.ts test/moment-facts.test.ts test/moment-copy.test.ts
pnpm --filter @ccip-dev/site exec vitest run test/project-cards.test.ts test/card-paths.test.ts test/moment-cards.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add packages/core/src/moments.ts packages/core/src/senders.ts packages/core/src/public.ts packages/core/src/broadcasts.ts worker/src/moments.ts \
  worker/src/broadcasts/moment-plan.ts worker/src/broadcasts/moment-facts.ts worker/src/broadcasts/moment-copy.ts site/worker/cards/project-cards.ts \
  site/worker/cards/broadcast-cards.ts site/test/fixtures/moments.ts packages/core/test/moments.test.ts packages/core/test/senders.test.ts \
  packages/core/test/broadcasts.test.ts worker/test/moments.test.ts worker/test/moments-pipeline.test.ts worker/test/moment-facts.test.ts \
  worker/test/moment-copy.test.ts site/test/project-cards.test.ts site/test/card-paths.test.ts
git commit -m "feat(moments): the weekly project spotlight, with its card

On the Wednesday after each week, the labeled project that gained the most messages
(50 or more) is named and tagged by its verified handle, with what it is, its growth,
its value or fees and its chains.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

#### Checkpoint 4 (controller, after Task 13 is reviewed): push, and check the moments

Push `main`. `deploy` applies `0007_sender_arrivals.sql` (the deploy log lists it), then deploys. When `deploy` and `site` are green:
- After the next finalize, `moments.json` has `arrivals.senders` (possibly empty) and each week a `project` (possibly null): `curl -s https://data.ccip.dev/v1/moments.json | jq '{senders: .arrivals.senders, project: .weeks[-1].project}'`.
- For a listed sender, `https://ccip.dev/og/broadcast/newcomer/<project|address>/<slug|address>.png` renders; for the latest week with a project, `/og/broadcast/project/<monday>.png` renders.
- When one posts (MOMENTS is `on`), its X text tags only its subject (or no one for an address or an inferred project). If MOMENTS is `drafts`, read the drafts chat instead.

---

### Task 14: The candidates job ranks by identity, keeps busy wallets, and reports coverage and spread

**Files:**
- Modify: `scripts/label-candidates.ts`
- Test: `scripts/test/label-candidates.test.ts`

**Interfaces:**
- **Consumes:** `identityResolver`, `mergeIdentities`, `labelCoverage`, `buildLabelIndex`, `senderKeyAddress`, `SenderRow`, `LabelCoverage` from core; `arrivals` rows of kind `sender` (Task 11).
- **Produces** (from `scripts/label-candidates.ts`):
  - `CANDIDATES_PER_ORDER = 100`, `BUSY_WALLET_MESSAGES = 100`;
  - `interface CandidateRow { address; chain; chain_name; chain_id; family; messages; usd }`, `interface CandidateChain { selector; name; chain_id; family; messages }`, `interface Candidate { address; family; chains: CandidateChain[]; messages; usd; data_messages; first_seen }`;
  - `identityCandidateQuery(sinceDay, minUsd, minMessages, limit?)`, `messageStatsQuery(sinceDay, addresses)`, `newcomerQuery(sinceDay)`, `senderRowsQuery(fromDay, toDay)`, `windowTotalsQuery(fromDay, toDay)` (each `{ sql, params }`), and the unchanged `priorityQuery`;
  - `unlabeledRows(rows, labeled: ReadonlySet<string>, resolve): CandidateRow[]`, `groupCandidates(rows, stats): Candidate[]`, `type AddressKind`, `keepCandidate(kind, messages): boolean`, `explorerLink(explorerMap, c): string | null`;
  - `detailsQuery(sinceDay, addresses)` and `summarizeDetails(rows): Map<address, { tokens; destinations }>` (by address now);
  - `draftFileName(c)`, `draftToml(c, name)` for multi-chain candidates;
  - `interface CandidateReportRow { candidate; name; priority: 'new on CCIP' | 'top 3' | null; tokens; destinations; hints: string[]; explorer }`, `prBody(rows, weekOf, coverage: string, spread: string)`;
  - `coverageMarkdown(now: LabelCoverage, before: LabelCoverage): string`; `interface SpreadRow { project; chain; address; messages }`, `spreadReport(rows: SenderRow[], resolve, chainNames): SpreadRow[]`, `spreadMarkdown(rows): string`.
- Removes `candidateQuery` (replaced by `identityCandidateQuery`).

**What changes (spec §8):**
- Rank by identity: an address summed across its chains, the top 100 by messages and the top 100 by value, deduplicated, still behind the `CANDIDATE_MIN_USD_7D`/`CANDIDATE_MIN_MESSAGES_7D` thresholds. xStocks's xBridge (170 messages over five chains, no value) is found by messages.
- A candidate's rows on chains a label names (verified or a draft), or that a label spreads to, are left out; a candidate is what remains.
- A wallet with 100 or more messages in the week stays a candidate.
- The PR body leads with label coverage and its change from last week, gains Chains, Data share and Hints columns (Hints are filled in Task 15), lists `new on CCIP` addresses first, then `top 3`, and ends with a label spread report.
- **Ruling:** a draft is named after its busiest chain (`_candidate-<chain>-<address>.toml`), so a single-chain candidate keeps the file name it had on the open candidates branch.

- [ ] **Step 1: Write the failing tests**

In `scripts/test/label-candidates.test.ts`:

1. Replace the import of `../label-candidates` with:

```ts
import {
  BUSY_WALLET_MESSAGES, chainGapQuery, classify, classifySolana, contractName, coverageMarkdown, detailsQuery, draftFileName, draftToml, escapeMarkdownCell, groupCandidates,
  handleGaps, handleGapsMarkdown, handleGroupQuery, identityCandidateQuery, keepCandidate, loadEndpointMaps, messageStatsQuery, newcomerQuery, prBody, spreadMarkdown,
  spreadReport, summarizeDetails, tokenGapQuery, unlabeledRows, windowStart, type Candidate, type CandidateReportRow, type CandidateRow,
} from '../label-candidates';
```

and add `identityResolver` to the `@ccip-dev/core` import and

```ts
import { BASE_SENDER_1, BASE_SENDER_2, NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_CHAINS, XSTOCKS_DAY, XSTOCKS_LABEL, XSTOCKS_SENDER_ROWS } from '@ccip-dev/core/testing';
```

(merging `fakeFetch, jsonResponse` into that import).

2. Replace the `candidate` fixture with:

```ts
const candidate: Candidate = {
  address: '0x1111111111111111111111111111111111111111',
  family: 'EVM',
  chains: [
    { selector: '5009297550715157269', name: 'ethereum-mainnet', chain_id: '1', family: 'EVM', messages: 90 },
    { selector: '15971525489660198786', name: 'ethereum-mainnet-base-1', chain_id: '8453', family: 'EVM', messages: 30 },
  ],
  messages: 120,
  usd: 75_000,
  data_messages: 90,
  first_seen: '2026-09-28',
};
```

3. Delete these tests, which the ones below replace: `'queries the last 7 days with both thresholds and includes all-time first seen'`, `'writes a draft that a hostile contract name cannot break out of'`, `'keeps draft file names inside labels/projects'`, `'details query shapes the data for enrichment'`, `'summarizeDetails extracts and orders tokens and chains'` and `'escapes markdown in PR table cells and lists top-3 senders first'`. Keep the `escapeMarkdownCell` assertion by moving it into the PR body test below.

4. Append:

```ts
describe('candidates by identity', () => {
  const database = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE daily_breakdown (day TEXT, dim TEXT, key TEXT, messages INTEGER, usd_value REAL, fee_usd REAL);
      CREATE TABLE daily_totals (day TEXT, messages INTEGER, usd_value REAL, fee_usd REAL);
      CREATE TABLE chains (selector TEXT, name TEXT, chain_id TEXT, family TEXT);
      CREATE TABLE messages (message_id TEXT, day TEXT, src_chain TEXT, sender TEXT, receiver TEXT, token_count INTEGER);
      CREATE TABLE arrivals (kind TEXT, key TEXT, first_seen TEXT, announced_at TEXT);
    `);
    const chain = db.prepare('INSERT INTO chains VALUES (?, ?, ?, ?)');
    for (const n of Object.values(NETWORKS)) chain.run(n.chainSelector, n.name, n.chainId, n.chainFamily);
    return db;
  };
  const rows = (db: DatabaseSync, q: { sql: string; params: unknown[] }) => (db.prepare(q.sql).all(...(q.params as (string | number)[])) as Record<string, unknown>[]).map((r) => ({ ...r }));
  const FILLER_1 = `0x${'0'.repeat(39)}1`;

  it("finds xStocks's xBridge by its messages summed across five chains, though they carry no value", () => {
    // #given 2026-10-13's senders, before xStocks had a label
    const db = database();
    const insert = db.prepare("INSERT INTO daily_breakdown VALUES (?, 'sender', ?, ?, ?, ?)");
    for (const r of XSTOCKS_SENDER_ROWS) insert.run(XSTOCKS_DAY, r.key, r.messages, r.usd_value, r.fee_usd);
    // #when the top 2 by messages and the top 2 by value
    const candidates = groupCandidates(rows(db, identityCandidateQuery('2026-10-07', 50_000, 50, 2)) as unknown as CandidateRow[], new Map());
    // #then
    expect(candidates.map((c) => [c.address, c.messages, c.chains.length])).toEqual([[XBRIDGE_EVM, 170, 5], [XBRIDGE_SOLANA, 149, 1], [BASE_SENDER_1, 76, 1], [FILLER_1, 50, 1]]);
  });

  it("reads each address's data messages in the window and its first day ever, on any chain", () => {
    // #given
    const db = database();
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, NULL, ?)');
    insert.run('a', '2026-08-01', NETWORKS.ink.chainSelector, XBRIDGE_EVM, 1);
    insert.run('b', XSTOCKS_DAY, NETWORKS.ink.chainSelector, XBRIDGE_EVM, 0);
    insert.run('c', XSTOCKS_DAY, NETWORKS.xlayer.chainSelector, XBRIDGE_EVM, 0);
    insert.run('d', XSTOCKS_DAY, NETWORKS.xlayer.chainSelector, XBRIDGE_EVM, 1);
    // #then
    expect(rows(db, messageStatsQuery('2026-10-07', [XBRIDGE_EVM]))).toEqual([{ address: XBRIDGE_EVM, data_messages: 2, first_seen: '2026-08-01' }]);
  });

  it('groups an address’s chains busiest first, with its data messages and first day', () => {
    // #given
    const row = (chain: string, name: string, messages: number): CandidateRow => ({ address: XBRIDGE_EVM, chain, chain_name: name, chain_id: '1', family: 'EVM', messages, usd: 1 });
    // #when
    const [c] = groupCandidates([row('9', 'b', 10), row('8', 'a', 30)], new Map([[XBRIDGE_EVM, { data_messages: 40, first_seen: '2026-10-09' }]]));
    // #then
    expect({ chains: c!.chains.map((ch) => ch.name), messages: c!.messages, usd: c!.usd, data: c!.data_messages, first: c!.first_seen }).toEqual({ chains: ['a', 'b'], messages: 40, usd: 2, data: 40, first: '2026-10-09' });
  });

  it("leaves out the rows a label names, a draft included, and the rows a label spreads to", () => {
    // #given xStocks labeled on Ink (so X Layer is spread), and a draft naming the first Base sender
    const resolve = identityResolver({ [`ethereum-mainnet-ink-1:${XBRIDGE_EVM}`]: XSTOCKS_LABEL }, XSTOCKS_CHAINS);
    const row = (n: (typeof NETWORKS)[keyof typeof NETWORKS], address: string): CandidateRow => ({ address, chain: n.chainSelector, chain_name: n.name, chain_id: n.chainId, family: n.chainFamily, messages: 1, usd: 0 });
    const labeled = new Set([`ethereum-mainnet-ink-1:${XBRIDGE_EVM}`, `ethereum-mainnet-base-1:${BASE_SENDER_1}`]);
    // #when
    const left = unlabeledRows([row(NETWORKS.ink, XBRIDGE_EVM), row(NETWORKS.xlayer, XBRIDGE_EVM), row(NETWORKS.base, BASE_SENDER_1), row(NETWORKS.base, BASE_SENDER_2)], labeled, resolve);
    // #then
    expect(left.map((r) => r.address)).toEqual([BASE_SENDER_2]);
  });

  it.each([
    ['wallet', BUSY_WALLET_MESSAGES - 1, false],
    ['wallet', 149, true],
    ['contract', 1, true],
    ['unknown', 1, true],
    ['error', 500, false],
  ] as const)('keeps a %s with %i messages in the week: %s (a busy wallet, like xStocks’s Solana sender, is an operator)', (kind, messages, kept) => {
    // #then
    expect(keepCandidate(kind, messages)).toBe(kept);
  });

  it('writes one draft with an address entry per known chain, which a hostile contract name cannot break out of', () => {
    // #when
    const toml = draftToml(candidate, 'Evil"\nverified = true\n[[addresses]]');
    const parsed = parse(toml) as { name: string; verified: boolean; addresses: { chain: string }[] };
    // #then
    expect({
      verified: parsed.verified,
      chains: parsed.addresses.map((a) => a.chain),
      newline: parsed.name.includes('\n'),
      errors: validateRegistry([{ file: draftFileName(candidate), text: toml }], new Set(['ethereum-mainnet', 'ethereum-mainnet-base-1'])).errors,
    }).toEqual({ verified: false, chains: ['ethereum-mainnet', 'ethereum-mainnet-base-1'], newline: false, errors: [] });
  });

  it('names a draft after its busiest chain, and keeps the name inside labels/projects', () => {
    // #then
    expect([draftFileName(candidate), draftFileName({ ...candidate, address: 'a/../../x', chains: [{ ...candidate.chains[0]!, name: '../../scripts' }] })]).toEqual([
      '_candidate-ethereum-mainnet-0x1111111111111111111111111111111111111111.toml',
      '_candidate-.._.._scripts-a_.._.._x.toml',
    ]);
  });

  it('reads tokens and destinations by address, across all of a candidate’s chains', () => {
    // #when
    const q = detailsQuery('2026-09-30', ['0xa', 'A8JP']);
    const summary = summarizeDetails([
      { address: '0xa', token: 'LINK', dst_name: 'polygon' },
      { address: '0xa', token: 'LINK', dst_name: 'arbitrum' },
      { address: '0xa', token: null, dst_name: 'polygon' },
      { address: '0xa', token: 'USDC', dst_name: 'optimism' },
    ]);
    // #then
    expect({ params: q.params, json: q.sql.includes('json_each'), summary: summary.get('0xa') }).toEqual({
      params: ['2026-09-30', '["0xa","A8JP"]'],
      json: true,
      summary: { tokens: ['LINK', 'USDC'], destinations: ['arbitrum', 'optimism', 'polygon'] },
    });
  });

  it('fast-tracks the unlabeled addresses recorded as new on CCIP this week', () => {
    // #given
    const db = database();
    const insert = db.prepare('INSERT INTO arrivals VALUES (?, ?, ?, NULL)');
    insert.run('sender', `address:${BASE_SENDER_1}`, '2026-10-13T00:00:00.000Z');
    insert.run('sender', 'project:xstocks', '2026-10-13T00:00:00.000Z');
    insert.run('sender', `address:${BASE_SENDER_2}`, '2026-09-01T00:00:00.000Z');
    insert.run('lane', 'a>b', '2026-10-13T00:00:00.000Z');
    // #then
    expect(rows(db, newcomerQuery('2026-10-07')).map((r) => r.address)).toEqual([BASE_SENDER_1]);
  });
});

describe('the candidates pull request', () => {
  it('leads with label coverage and its change in points from last week', () => {
    // #given
    const now = { messages_pct: 81.2, usd_pct: 94.4, fees_pct: 90, window: '7d' as const };
    const before = { messages_pct: 78.2, usd_pct: 95.4, fees_pct: 90, window: '7d' as const };
    const none = { messages_pct: null, usd_pct: null, fees_pct: null, window: '7d' as const };
    // #then
    expect([coverageMarkdown(now, before), coverageMarkdown(now, none), coverageMarkdown(none, before)]).toEqual([
      'Labeled senders: 81% of messages (+3 points), 94% of value (−1 point), 90% of fees (±0 points) over the last 7 days.',
      'Labeled senders: 81% of messages, 94% of value, 90% of fees over the last 7 days.',
      'Labeled senders: no messages in the last 7 days.',
    ]);
  });

  it("reports the rows a label spread to this week, busiest first, for the owner to confirm or block", () => {
    // #given xStocks labeled on Ink only
    const resolve = identityResolver({ [`ethereum-mainnet-ink-1:${XBRIDGE_EVM}`]: XSTOCKS_LABEL }, XSTOCKS_CHAINS);
    // #when
    const report = spreadReport(XSTOCKS_SENDER_ROWS, resolve, new Map([...XSTOCKS_CHAINS].map(([selector, c]) => [selector, c.name])));
    // #then
    expect({ report, table: spreadMarkdown(report).includes(`| xStocks | ethereum-mainnet-xlayer-1 | ${XBRIDGE_EVM} | 58 |`), none: spreadMarkdown([]).includes('No label spread this week.') }).toEqual({
      report: [
        { project: 'xStocks', chain: 'ethereum-mainnet-xlayer-1', address: XBRIDGE_EVM, messages: 58 },
        { project: 'xStocks', chain: 'binance_smart_chain-mainnet', address: XBRIDGE_EVM, messages: 22 },
        { project: 'xStocks', chain: 'ethereum-mainnet', address: XBRIDGE_EVM, messages: 6 },
        { project: 'xStocks', chain: 'hyperliquid-mainnet', address: XBRIDGE_EVM, messages: 3 },
      ],
      table: true,
      none: true,
    });
  });

  it('lists new-on-CCIP addresses first, then the top 3, with chains, data share and hints, and escapes every cell', () => {
    // #given
    expect(escapeMarkdownCell('a|b`c[d](e)<f>')).toBe('a\\|b\\`c\\[d\\](e)&lt;f&gt;');
    const row = (address: string, priority: CandidateReportRow['priority'], messages: number): CandidateReportRow => ({
      candidate: { ...candidate, address, messages, data_messages: messages * 0.75 }, name: address === '0xaaa' ? 'X|Y' : null, priority, tokens: [], destinations: [], hints: ['pairs with 0x9ec0…846b'], explorer: null,
    });
    // #when
    const body = prBody([row('0xaaa', null, 500), row('0xbbb', 'top 3', 10), row('0xccc', 'new on CCIP', 5)], '2026-10-19', 'Labeled senders: 81% of messages over the last 7 days.', 'No label spread this week.');
    const table = body.split('\n').filter((l) => /^\| (new on CCIP|top 3|) \|/.test(l));
    // #then
    expect({
      lead: body.split('\n')[0],
      order: table.map((l) => l.split(' | ')[2]),
      cells: table[0]!.includes('| ethereum-mainnet, ethereum-mainnet-base-1 |') && table[0]!.includes('| 75% |') && table[0]!.includes('| pairs with 0x9ec0…846b |'),
      escaped: body.includes('X\\|Y'),
      spread: body.trimEnd().endsWith('No label spread this week.'),
    }).toEqual({ lead: 'Labeled senders: 81% of messages over the last 7 days.', order: ['0xccc', '0xbbb', '0xaaa'], cells: true, escaped: true, spread: true });
  });
});
```

Run: `pnpm exec vitest run scripts/test/label-candidates.test.ts`
Expected: FAIL (the new exports do not exist).

- [ ] **Step 2: Rewrite the candidate pipeline**

In `scripts/label-candidates.ts`:

1. Replace the imports with:

```ts
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addDays, buildHandles, buildLabelIndex, dayOf, identityResolver, isAddressShape, labelCoverage, labelKey, mergeIdentities, sanitize, senderKeyAddress,
  validateChainHandles, validateRegistry, type Handles, type IdentityResolver, type LabelCoverage, type RegistryProject, type SenderRow,
} from '@ccip-dev/core';
import { formatShare } from '@ccip-dev/core/format';
import { stringify } from 'smol-toml';
```

2. Replace everything from `export interface Candidate {` through the end of `candidateQuery` with:

```ts
/** Senders rank by identity, an address summed across its chains: the top 100 by messages and the top 100 by value. */
export const CANDIDATES_PER_ORDER = 100;
/** A wallet sending this many messages in a week is an operator, not a user, so it stays a candidate. */
export const BUSY_WALLET_MESSAGES = 100;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

export interface CandidateRow {
  address: string;
  chain: string;
  chain_name: string | null;
  chain_id: string | null;
  family: string | null;
  messages: number;
  usd: number;
}

export interface CandidateChain {
  selector: string;
  name: string | null;
  chain_id: string | null;
  family: string | null;
  messages: number;
}

export interface Candidate {
  address: string;
  /** The family of its busiest chain. */
  family: string | null;
  /** Its source chains, busiest first. */
  chains: CandidateChain[];
  messages: number;
  usd: number;
  /** Its messages in the window that carried no tokens. */
  data_messages: number;
  first_seen: string;
}

export function windowStart(today: string): string {
  return addDays(today, -6);
}

/**
 * Each (address, chain) row of the addresses in the top ?4 by messages or the top ?4 by value since ?1, each address
 * summed across its chains and held to the thresholds (?2 dollars or ?3 messages).
 */
export function identityCandidateQuery(sinceDay: string, minUsd: number, minMessages: number, limit = CANDIDATES_PER_ORDER) {
  return {
    sql: `WITH rows AS (
            SELECT substr(key, 1, instr(key, ':') - 1) AS chain, substr(key, instr(key, ':') + 1) AS address, messages, usd_value
            FROM daily_breakdown WHERE dim = 'sender' AND day >= ?1
          ), by_address AS (
            SELECT address, SUM(messages) AS messages, SUM(usd_value) AS usd FROM rows GROUP BY address
            HAVING SUM(usd_value) >= ?2 OR SUM(messages) >= ?3
          ), picked AS (
            SELECT address FROM (SELECT address FROM by_address ORDER BY messages DESC, address LIMIT ?4)
            UNION
            SELECT address FROM (SELECT address FROM by_address ORDER BY usd DESC, address LIMIT ?4)
          )
          SELECT r.address AS address, r.chain AS chain, c.name AS chain_name, c.chain_id AS chain_id, c.family AS family,
            SUM(r.messages) AS messages, SUM(r.usd_value) AS usd
          FROM rows r JOIN picked p ON p.address = r.address LEFT JOIN chains c ON c.selector = r.chain
          GROUP BY r.address, r.chain ORDER BY r.address, messages DESC, r.chain`,
    params: [sinceDay, minUsd, minMessages, limit],
  };
}

/** Each address's messages without tokens since ?1, and its first day ever, through the messages_sender index. */
export function messageStatsQuery(sinceDay: string, addresses: readonly string[]) {
  return {
    sql: `SELECT sender AS address, SUM(CASE WHEN day >= ?1 AND token_count = 0 THEN 1 ELSE 0 END) AS data_messages, MIN(day) AS first_seen
          FROM messages WHERE src_chain IN (SELECT selector FROM chains) AND sender IN (SELECT value FROM json_each(?2))
          GROUP BY sender`,
    params: [sinceDay, JSON.stringify(addresses)],
  };
}

/** The unlabeled addresses the Worker recorded as new on CCIP since ?1, which the PR lists first. */
export function newcomerQuery(sinceDay: string) {
  return {
    sql: `SELECT substr(key, 9) AS address FROM arrivals WHERE kind = 'sender' AND key LIKE 'address:%' AND first_seen >= ?1`,
    params: [`${sinceDay}T00:00:00.000Z`],
  };
}

/** Per-key sender sums over [?1, ?2], for label coverage and the spread report. */
export function senderRowsQuery(fromDay: string, toDay: string) {
  return {
    sql: `SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
          FROM daily_breakdown WHERE dim = 'sender' AND day >= ?1 AND day <= ?2 GROUP BY key`,
    params: [fromDay, toDay],
  };
}

export function windowTotalsQuery(fromDay: string, toDay: string) {
  return {
    sql: `SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(usd_value), 0) AS usd_value, SUM(fee_usd) AS fee_usd
          FROM daily_totals WHERE day >= ?1 AND day <= ?2`,
    params: [fromDay, toDay],
  };
}

/** A row a label names (a draft included), or one a label spreads to, belongs to a project; the rest are candidates' rows. */
export function unlabeledRows(rows: readonly CandidateRow[], labeled: ReadonlySet<string>, resolve: IdentityResolver): CandidateRow[] {
  return rows.filter((r) => !(r.chain_name !== null && labeled.has(labelKey(r.chain_name, r.address))) && resolve(r.chain, r.address).project === null);
}

/** One candidate per address, its chains busiest first, busiest candidates first. */
export function groupCandidates(rows: readonly CandidateRow[], stats: ReadonlyMap<string, { data_messages: number; first_seen: string }>): Candidate[] {
  const byAddress = new Map<string, CandidateRow[]>();
  for (const r of rows) {
    const list = byAddress.get(r.address);
    if (list) list.push(r);
    else byAddress.set(r.address, [r]);
  }
  return [...byAddress]
    .map(([address, list]): Candidate => {
      const chains = [...list]
        .sort((a, b) => b.messages - a.messages || compare(a.chain, b.chain))
        .map((r) => ({ selector: r.chain, name: r.chain_name, chain_id: r.chain_id, family: r.family, messages: r.messages }));
      const stat = stats.get(address);
      return {
        address,
        family: chains[0]?.family ?? null,
        chains,
        messages: sum(list.map((r) => r.messages)),
        usd: sum(list.map((r) => r.usd)),
        data_messages: stat?.data_messages ?? 0,
        first_seen: stat?.first_seen ?? '-',
      };
    })
    .sort((a, b) => b.messages - a.messages || b.usd - a.usd || compare(a.address, b.address));
}
```

3. Change `type AddressKind = …` to `export type AddressKind = …`, and after `classifySolana` add:

```ts
/** A wallet is a user unless it is busy enough to be an operator; an address the RPC could not check is skipped. */
export function keepCandidate(kind: AddressKind, messages: number): boolean {
  if (kind === 'error') return false;
  return kind !== 'wallet' || messages >= BUSY_WALLET_MESSAGES;
}
```

4. Replace `detailsQuery` and `summarizeDetails` with:

```ts
export function detailsQuery(sinceDay: string, addresses: readonly string[]) {
  return {
    sql: `SELECT m.sender AS address, COALESCE(tk.symbol, mt.token) AS token, d.name AS dst_name
          FROM messages m
          LEFT JOIN message_tokens mt ON mt.message_id = m.message_id
          LEFT JOIN tokens tk ON tk.chain = mt.chain AND lower(tk.address) = lower(mt.token)
          LEFT JOIN chains d ON d.selector = m.dst_chain
          WHERE m.day >= ? AND m.sender IN (SELECT value FROM json_each(?))`,
    params: [sinceDay, JSON.stringify(addresses)],
  };
}

/** Each address's five most-sent tokens and every destination chain, across all its source chains. */
export function summarizeDetails(rows: readonly { address: string; token: string | null; dst_name: string | null }[]): Map<string, { tokens: string[]; destinations: string[] }> {
  const tokenCounts = new Map<string, Map<string, number>>();
  const destinations = new Map<string, Set<string>>();
  for (const row of rows) {
    const counts = tokenCounts.get(row.address) ?? new Map<string, number>();
    tokenCounts.set(row.address, counts);
    const dsts = destinations.get(row.address) ?? new Set<string>();
    destinations.set(row.address, dsts);
    if (row.token) counts.set(row.token, (counts.get(row.token) ?? 0) + 1);
    if (row.dst_name) dsts.add(row.dst_name);
  }
  return new Map(
    [...tokenCounts].map(([address, counts]) => [
      address,
      {
        tokens: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([token]) => sanitize(token)),
        destinations: [...(destinations.get(address) ?? [])].sort(),
      },
    ]),
  );
}
```

5. Replace `draftFileName`, `draftToml` and `prBody` with:

```ts
export function draftFileName(c: Candidate): string {
  const busiest = c.chains[0];
  return `_candidate-${fileSafe(busiest?.name ?? busiest?.selector ?? 'unknown')}-${fileSafe(c.address)}.toml`;
}

export function draftToml(c: Candidate, name: string | null): string {
  const body = stringify({
    name: sanitize(name ?? `Unknown ${c.address.slice(0, 10)}`),
    kind: 'unknown',
    verified: false,
    addresses: c.chains.flatMap((ch) =>
      ch.name === null
        ? []
        : [{ chain: ch.name, address: c.address, note: sanitize(`candidate: ${ch.messages} of ${c.messages} messages in the last 7 days, $${Math.round(c.usd)} in all, first seen ${c.first_seen}`, 120) }],
    ),
  });
  return `# Draft from the weekly candidate pipeline. Fill in name, x and kind; set verified = true only with public proof.\n${body}\n`;
}
```

(after `escapeMarkdownCell`, which stays):

```ts
export interface CandidateReportRow {
  candidate: Candidate;
  name: string | null;
  priority: 'new on CCIP' | 'top 3' | null;
  tokens: string[];
  destinations: string[];
  /** "sends via program F2ZY…KcZN", "pairs with 0x9ec0…846b" (Task 15 fills them). */
  hints: string[];
  explorer: string | null;
}

const PRIORITY_ORDER = { 'new on CCIP': 0, 'top 3': 1 } as const;
const dataShare = (c: Candidate) => (c.messages === 0 ? '-' : formatShare((c.data_messages / c.messages) * 100));

export function prBody(rows: readonly CandidateReportRow[], weekOf: string, coverage: string, spread: string): string {
  const rank = (r: CandidateReportRow) => (r.priority === null ? 2 : PRIORITY_ORDER[r.priority]);
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || b.candidate.messages - a.candidate.messages || b.candidate.usd - a.candidate.usd);
  const lines = sorted.map(({ candidate: c, name, priority, tokens, destinations, hints, explorer }) =>
    [
      priority ?? '',
      escapeMarkdownCell(c.chains.map((ch) => ch.name ?? ch.selector).join(', ')),
      escapeMarkdownCell(c.address),
      escapeMarkdownCell(name ?? '-'),
      String(c.messages),
      Math.round(c.usd).toLocaleString('en-US'),
      dataShare(c),
      escapeMarkdownCell(c.first_seen),
      escapeMarkdownCell(tokens.join(', ')),
      escapeMarkdownCell(destinations.join(', ')),
      escapeMarkdownCell(hints.join('; ')),
      explorer ? `[link](${explorer})` : '-',
    ].join(' | '),
  ).map((cells) => `| ${cells} |`);
  return [
    coverage,
    '',
    `Label candidates for the week of ${weekOf}: senders ranked by identity (an address summed across its chains), the top ${CANDIDATES_PER_ORDER} by messages and the top ${CANDIDATES_PER_ORDER} by value.`,
    '',
    'Each file is a draft with `verified = false`. Fill in the real name, `x` and `kind`, and set `verified = true` only if the project publicly confirms the address. Otherwise delete the file. Then merge.',
    '',
    '| Priority | Chains | Address | Contract name | Messages (7d) | USD (7d) | Data share | First seen | Tokens | Destinations | Hints | Explorer |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...lines,
    '',
    spread,
    '',
  ].join('\n');
}

const points = (delta: number) => {
  const rounded = Math.round(delta * 10) / 10;
  const size = Math.abs(rounded);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${size} ${size === 1 ? 'point' : 'points'}`;
};

/** The line the PR leads with: this week's labeled shares and their change from last week. */
export function coverageMarkdown(now: LabelCoverage, before: LabelCoverage): string {
  const part = (what: string, a: number | null, b: number | null) => (a === null ? [] : [`${formatShare(a)} of ${what}${b === null ? '' : ` (${points(a - b)})`}`]);
  const parts = [...part('messages', now.messages_pct, before.messages_pct), ...part('value', now.usd_pct, before.usd_pct), ...part('fees', now.fees_pct, before.fees_pct)];
  return now.messages_pct === null ? 'Labeled senders: no messages in the last 7 days.' : `Labeled senders: ${parts.join(', ')} over the last 7 days.`;
}

export interface SpreadRow {
  project: string;
  chain: string;
  address: string;
  messages: number;
}

/** The week's rows credited to a project through label spread, busiest first. */
export function spreadReport(rows: readonly SenderRow[], resolve: IdentityResolver, chainNames: ReadonlyMap<string, string>): SpreadRow[] {
  return rows
    .flatMap((r) => {
      const selector = r.key.slice(0, r.key.indexOf(':'));
      const identity = resolve(selector, senderKeyAddress(r.key));
      return identity.inferred && identity.project !== null
        ? [{ project: identity.project.name, chain: chainNames.get(selector) ?? selector, address: senderKeyAddress(r.key), messages: r.messages }]
        : [];
    })
    .sort((a, b) => b.messages - a.messages || compare(a.chain, b.chain));
}

export function spreadMarkdown(rows: readonly SpreadRow[]): string {
  const intro = [
    '## Label spread this week',
    '',
    "Addresses credited to a project because the same address is labeled on another EVM chain. Confirm each by adding it to the project's file, or turn the project's spread off with `spread = false`.",
    '',
  ];
  if (rows.length === 0) return [...intro, 'No label spread this week.', ''].join('\n');
  return [
    ...intro,
    '| Project | Chain | Address | Messages (7d) |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${escapeMarkdownCell(r.project)} | ${escapeMarkdownCell(r.chain)} | ${escapeMarkdownCell(r.address)} | ${r.messages} |`),
    '',
  ].join('\n');
}
```

6. Replace `labeledKeys`, `currentHandles` and `classifyCandidate` with:

```ts
async function loadProjects(knownChains: ReadonlySet<string>): Promise<RegistryProject[]> {
  const dir = path.join(ROOT, 'labels/projects');
  const files = await Promise.all(
    (await readdir(dir)).filter((f) => f.endsWith('.toml')).map(async (f) => ({ file: f, text: await readFile(path.join(dir, f), 'utf8') })),
  );
  return validateRegistry(files, knownChains).projects;
}

async function currentHandles(projects: RegistryProject[], knownChains: ReadonlySet<string>): Promise<Handles> {
  const chainHandles = validateChainHandles(await readFile(path.join(ROOT, 'labels/chain-x.json'), 'utf8'), knownChains).handles;
  return buildHandles(projects, chainHandles);
}

function classifyCandidate(c: Candidate, rpcMap: Record<string, string>): Promise<AddressKind> {
  if (c.family === 'EVM') return classify(fetch, rpcMap[c.chains[0]?.name ?? ''], c.address);
  if (c.family === 'SVM') return classifySolana(fetch, rpcMap['solana-mainnet'], c.address);
  return Promise.resolve('unknown');
}

/** The Blockscout page of the address on the first of its chains that has one. */
export function explorerLink(explorerMap: Record<string, string>, c: Candidate): string | null {
  const base = c.chains.map((ch) => (ch.name === null ? undefined : explorerMap[ch.name])).find((b) => b !== undefined);
  return base === undefined ? null : `${base.replace(/\/$/, '')}/address/${c.address}`;
}
```

7. Replace `main` with:

```ts
async function main(): Promise<void> {
  const today = dayOf(new Date());
  const since = windowStart(today);
  const minUsd = Number(process.env.CANDIDATE_MIN_USD_7D ?? '50000');
  const minMessages = Number(process.env.CANDIDATE_MIN_MESSAGES_7D ?? '50');
  const { rpcMap, explorerMap } = await loadEndpointMaps(ROOT);
  const knownChains = new Set<string>(JSON.parse(await readFile(path.join(ROOT, 'labels/ccip-chains.json'), 'utf8')));
  const projects = await loadProjects(knownChains);
  const labeled = new Set(projects.flatMap((p) => p.addresses.map((a) => labelKey(a.chain, a.address))));
  const chainRows = await d1<{ selector: string; name: string; family: string }>('SELECT selector, name, family FROM chains', []);
  const chainNames = new Map(chainRows.map((c) => [c.selector, c.name]));
  const resolve = identityResolver(buildLabelIndex(projects), new Map(chainRows.map((c) => [c.selector, { name: c.name, family: c.family }])));

  const cq = identityCandidateQuery(since, minUsd, minMessages);
  const rows = unlabeledRows(await d1<CandidateRow>(cq.sql, cq.params), labeled, resolve).filter((r) => {
    if (r.chain_name !== null && knownChains.has(r.chain_name)) return true;
    console.warn(`skipping ${r.chain}:${r.address}: ${r.chain_name ?? 'its chain'} is not in labels/ccip-chains.json yet`);
    return false;
  });
  const sq = messageStatsQuery(since, [...new Set(rows.map((r) => r.address))]);
  const stats = new Map((await d1<{ address: string; data_messages: number; first_seen: string }>(sq.sql, sq.params)).map((s) => [s.address, s]));
  const pq = priorityQuery(since);
  const top3 = new Set((await d1<{ key: string }>(pq.sql, pq.params)).map((r) => senderKeyAddress(r.key)));
  const nq = newcomerQuery(since);
  const newcomers = new Set((await d1<{ address: string }>(nq.sql, nq.params)).map((r) => r.address));

  const report: CandidateReportRow[] = [];
  for (const c of groupCandidates(rows, stats)) {
    if (!isAddressShape(c.family ?? '', c.address)) {
      console.warn(`skipping ${c.address}: not a valid ${c.family} address`);
      continue;
    }
    const kind = await classifyCandidate(c, rpcMap);
    if (kind === 'error') console.warn(`skipping ${c.address}: RPC check failed`);
    if (!keepCandidate(kind, c.messages)) continue;
    const busiest = c.chains[0]!;
    const name =
      c.family === 'EVM'
        ? await contractName(fetch, { chainId: busiest.chain_id, address: c.address, etherscanKey: process.env.ETHERSCAN_API_KEY, blockscoutBase: explorerMap[busiest.name ?? ''] })
        : null;
    await writeFile(path.join(ROOT, 'labels/projects', draftFileName(c)), draftToml(c, name));
    report.push({
      candidate: c,
      name,
      priority: newcomers.has(c.address) ? 'new on CCIP' : top3.has(c.address) ? 'top 3' : null,
      tokens: [],
      destinations: [],
      hints: [],
      explorer: explorerLink(explorerMap, c),
    });
  }

  if (report.length > 0) {
    const dq = detailsQuery(since, report.map((r) => r.candidate.address));
    const details = summarizeDetails(await d1<{ address: string; token: string | null; dst_name: string | null }>(dq.sql, dq.params));
    for (const row of report) {
      const found = details.get(row.candidate.address);
      if (found) {
        row.tokens = found.tokens;
        row.destinations = found.destinations;
      }
    }
  }

  const lastWeek = { from: addDays(since, -7), to: addDays(since, -1) };
  const windowRows = (from: string, to: string) => d1<SenderRow>(senderRowsQuery(from, to).sql, senderRowsQuery(from, to).params);
  const windowTotals = async (from: string, to: string) =>
    (await d1<{ messages: number; usd_value: number; fee_usd: number | null }>(windowTotalsQuery(from, to).sql, windowTotalsQuery(from, to).params))[0] ?? { messages: 0, usd_value: 0, fee_usd: null };
  const weekRows = await windowRows(since, today);
  const coverage = coverageMarkdown(
    labelCoverage(mergeIdentities(weekRows, resolve), await windowTotals(since, today)),
    labelCoverage(mergeIdentities(await windowRows(lastWeek.from, lastWeek.to), resolve), await windowTotals(lastWeek.from, lastWeek.to)),
  );
  const spread = spreadMarkdown(spreadReport(weekRows, resolve, chainNames));

  const handles = await currentHandles(projects, knownChains);
  const tq = tokenGapQuery(since, GAP_TOKENS);
  const gq2 = chainGapQuery(since, GAP_CHAINS_BY_VALUE, GAP_CHAINS_BY_FEES);
  const hq = handleGroupQuery(handles.tokens);
  const gaps = handleGaps(
    await d1<TokenGap>(tq.sql, tq.params),
    await d1<ChainGap>(gq2.sql, gq2.params),
    handles,
    handles.tokens.length === 0 ? [] : await d1<HandleGroup>(hq.sql, hq.params),
  );
  const gapsMarkdown = handleGapsMarkdown(gaps);
  await writeFile(path.join(ROOT, 'labels/handle-gaps.md'), gapsMarkdown);
  await writeFile(path.join(ROOT, 'pr-body.md'), `${prBody(report, today, coverage, spread)}\n${gapsMarkdown}`);
  console.log(`${report.length} candidate draft(s) written; ${gaps.tokens.length} token and ${gaps.chains.length} chain handle gap(s)`);
}
```

The `d1`, `classify`, `classifySolana`, `contractName`, `escapeMarkdownCell`, `priorityQuery`, `loadEndpointMaps` and handle-gap functions stay as they are.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run scripts/test/label-candidates.test.ts`
Expected: PASS, the kept classify, Solana, contract-name, endpoint and handle-gap tests included.

- [ ] **Step 4: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add scripts/label-candidates.ts scripts/test/label-candidates.test.ts
git commit -m "feat(labels): rank label candidates by identity, keep busy wallets, report coverage and spread

The weekly job missed xStocks: it ranked (chain, address) pairs by value and skipped
wallets. It now ranks addresses across chains by messages and by value, keeps a wallet
sending 100+ messages a week, leads its PR with label coverage, lists new-on-CCIP
addresses first, and reports where a label spread.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 15: The candidates job explains Solana senders and pairs candidates

**Files:**
- Modify: `scripts/label-candidates.ts`
- Test: `scripts/test/label-candidates.test.ts`

**Interfaces:**
- **Consumes:** Task 14's `CandidateReportRow.hints`, `AddressKind`, `keepCandidate`; `shortAddress` from `@ccip-dev/core/names`.
- **Produces:** `solanaSendProgram(fetchFn, rpcUrl, address): Promise<string | null>`, `receiversQuery(sinceDay, addresses)`, `pairHints(addresses, sends, programs): Map<string, string[]>`, `candidateHints(address, program, pairs): string[]`.

**What it adds (spec §8):**
- For a system-owned Solana sender, read its latest successful send and record the first top-level program it invokes that is not the system, compute-budget, token, associated-token or memo program: `sends via program F2ZY…KcZN`. That is how xStocks's A8JP was confirmed.
- Two candidates pair when one sends to the other, or to the program the other sends through: `pairs with 0x9ec0…846b`. (0x9ec0 sends to F2ZY…, A8JP's program, and A8JP sends to 0x9ec0.)
- Both use the free public Solana RPC in `config/endpoints.json` (`rpc['solana-mainnet']`) and D1; a failed call leaves the hint out.

- [ ] **Step 1: Write the failing tests**

Add `candidateHints, pairHints, receiversQuery, solanaSendProgram` to the `../label-candidates` import and `XBRIDGE_PROGRAM` to the `@ccip-dev/core/testing` import, then append:

```ts
describe('Solana program hints', () => {
  const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
  const tx = (accountKeys: string[], programIdIndexes: number[], readonly: string[] = []) => ({
    transaction: { message: { accountKeys, instructions: programIdIndexes.map((programIdIndex) => ({ programIdIndex })) } },
    meta: { loadedAddresses: { writable: [], readonly } },
  });
  const rpc = (signatures: unknown, transaction: unknown, seen: string[] = []) =>
    fakeFetch((_url, init) => {
      const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      seen.push(method === 'getTransaction' ? `${method} ${String(params[0])}` : method);
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: method === 'getSignaturesForAddress' ? signatures : transaction });
    });

  it("names the program xStocks's Solana sender sends through, skipping compute budget, from its latest successful send", async () => {
    // #given a failed send, then a successful one that sets a compute budget and calls the xBridge program
    const seen: string[] = [];
    const fetchFn = rpc([{ signature: 'failed', err: { InstructionError: [0, 'Custom'] } }, { signature: 'sent', err: null }], tx([XBRIDGE_SOLANA, COMPUTE_BUDGET, XBRIDGE_PROGRAM], [1, 2]), seen);
    // #when
    const program = await solanaSendProgram(fetchFn, 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect({ program, seen }).toEqual({ program: XBRIDGE_PROGRAM, seen: ['getSignaturesForAddress', 'getTransaction sent'] });
  });

  it('finds a program held in the transaction’s loaded addresses', async () => {
    // #when the program sits in a lookup table, after the two static keys
    const program = await solanaSendProgram(rpc([{ signature: 'sent', err: null }], tx([XBRIDGE_SOLANA, COMPUTE_BUDGET], [1, 2], [XBRIDGE_PROGRAM])), 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect(program).toBe(XBRIDGE_PROGRAM);
  });

  it('has no hint without an RPC, without a successful send, or when the RPC fails', async () => {
    // #when
    const results = await Promise.all([
      solanaSendProgram(rpc([], null), undefined, XBRIDGE_SOLANA),
      solanaSendProgram(rpc([{ signature: 'failed', err: {} }], null), 'https://rpc', XBRIDGE_SOLANA),
      solanaSendProgram(fakeFetch(() => jsonResponse({}, 500)), 'https://rpc', XBRIDGE_SOLANA),
      solanaSendProgram(fakeFetch(async () => { throw new Error('network'); }), 'https://rpc', XBRIDGE_SOLANA),
    ]);
    // #then
    expect(results).toEqual([null, null, null, null]);
  });
});

describe('pair hints', () => {
  it("pairs xStocks's two senders: A8JP sends to the xBridge, and the xBridge sends to A8JP's program", () => {
    // #when
    const pairs = pairHints(
      [XBRIDGE_EVM, XBRIDGE_SOLANA, BASE_SENDER_1],
      [{ address: XBRIDGE_SOLANA, receiver: XBRIDGE_EVM }, { address: XBRIDGE_EVM, receiver: XBRIDGE_PROGRAM }, { address: BASE_SENDER_1, receiver: '0x2222222222222222222222222222222222222222' }],
      new Map([[XBRIDGE_SOLANA, XBRIDGE_PROGRAM]]),
    );
    // #then
    expect([...pairs]).toEqual([
      [XBRIDGE_SOLANA, ['pairs with 0x9ec0…846b']],
      [XBRIDGE_EVM, ['pairs with A8JP…in3u']],
    ]);
  });

  it('writes the program hint first, then the pairs', () => {
    // #then
    expect(candidateHints(XBRIDGE_SOLANA, XBRIDGE_PROGRAM, new Map([[XBRIDGE_SOLANA, ['pairs with 0x9ec0…846b']]]))).toEqual(['sends via program F2ZY…KcZN', 'pairs with 0x9ec0…846b']);
  });

  it('reads who each candidate sent to over the week', () => {
    // #given
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE messages (message_id TEXT, day TEXT, src_chain TEXT, sender TEXT, receiver TEXT, token_count INTEGER)');
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, 0)');
    insert.run('a', '2026-10-13', '1', XBRIDGE_SOLANA, XBRIDGE_EVM);
    insert.run('b', '2026-10-13', '1', XBRIDGE_SOLANA, XBRIDGE_EVM);
    insert.run('c', '2026-09-01', '1', XBRIDGE_SOLANA, '0xold');
    insert.run('d', '2026-10-13', '1', BASE_SENDER_1, null);
    // #when
    const q = receiversQuery('2026-10-07', [XBRIDGE_SOLANA, BASE_SENDER_1]);
    // #then
    expect((db.prepare(q.sql).all(...(q.params as string[])) as Record<string, unknown>[]).map((r) => ({ ...r }))).toEqual([{ address: XBRIDGE_SOLANA, receiver: XBRIDGE_EVM, messages: 2 }]);
  });
});
```

Run: `pnpm exec vitest run scripts/test/label-candidates.test.ts`
Expected: FAIL.

- [ ] **Step 2: The hints**

In `scripts/label-candidates.ts`, add `import { shortAddress } from '@ccip-dev/core/names';`, and after `classifySolana`:

```ts
/** Programs nearly every Solana transaction calls; the program that says who the sender is is the first one after them. */
const COMMON_PROGRAMS = new Set([
  '11111111111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);

interface SolanaTransaction {
  transaction?: { message?: { accountKeys?: unknown; instructions?: unknown } };
  meta?: { loadedAddresses?: { writable?: string[]; readonly?: string[] } };
}

/** The program a system-owned Solana sender's latest successful send invokes at the top level, past the common ones. */
export async function solanaSendProgram(fetchFn: typeof fetch, rpcUrl: string | undefined, address: string): Promise<string | null> {
  if (!rpcUrl) return null;
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    const res = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return res.ok ? ((await res.json()) as { result?: unknown }).result : undefined;
  };
  try {
    const signatures = await call('getSignaturesForAddress', [address, { limit: 10 }]);
    const sent = Array.isArray(signatures) ? (signatures as { signature?: unknown; err?: unknown }[]).find((s) => s.err === null && typeof s.signature === 'string') : undefined;
    if (sent === undefined) return null;
    const tx = (await call('getTransaction', [sent.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }])) as SolanaTransaction | null | undefined;
    const message = tx?.transaction?.message;
    if (!message || !Array.isArray(message.accountKeys) || !Array.isArray(message.instructions)) return null;
    const keys: unknown[] = [...message.accountKeys, ...(tx?.meta?.loadedAddresses?.writable ?? []), ...(tx?.meta?.loadedAddresses?.readonly ?? [])];
    for (const instruction of message.instructions as { programIdIndex?: unknown }[]) {
      const program = typeof instruction.programIdIndex === 'number' ? keys[instruction.programIdIndex] : undefined;
      if (typeof program === 'string' && !COMMON_PROGRAMS.has(program)) return program;
    }
    return null;
  } catch {
    return null;
  }
}

/** Who each address sent to since ?1, for pairing candidates. */
export function receiversQuery(sinceDay: string, addresses: readonly string[]) {
  return {
    sql: `SELECT sender AS address, receiver, COUNT(*) AS messages FROM messages
          WHERE day >= ?1 AND sender IN (SELECT value FROM json_each(?2)) AND receiver IS NOT NULL
          GROUP BY sender, receiver`,
    params: [sinceDay, JSON.stringify(addresses)],
  };
}

/** Two candidates pair when one sends to the other, or to the program the other sends through. */
export function pairHints(addresses: readonly string[], sends: readonly { address: string; receiver: string }[], programs: ReadonlyMap<string, string>): Map<string, string[]> {
  const candidates = new Set(addresses);
  const ownerOf = new Map<string, string>([...addresses.map((a) => [a, a] as const), ...[...programs].map(([a, program]) => [program, a] as const)]);
  const pairs = new Map<string, Set<string>>();
  const link = (a: string, b: string) => pairs.set(a, (pairs.get(a) ?? new Set<string>()).add(b));
  for (const s of sends) {
    const other = ownerOf.get(s.receiver);
    if (!candidates.has(s.address) || other === undefined || other === s.address) continue;
    link(s.address, other);
    link(other, s.address);
  }
  return new Map([...pairs].map(([a, others]) => [a, [...others].sort().map((o) => `pairs with ${shortAddress(o)}`)]));
}

export function candidateHints(address: string, program: string | undefined, pairs: ReadonlyMap<string, string[]>): string[] {
  return [...(program === undefined ? [] : [`sends via program ${shortAddress(program)}`]), ...(pairs.get(address) ?? [])];
}
```

In `main`:
- before the report loop, add `const kinds = new Map<string, AddressKind>();`, and inside it, right after `const kind = await classifyCandidate(c, rpcMap);`, add `kinds.set(c.address, kind);`;
- after the details enrichment block, add:

```ts
  const programs = new Map<string, string>();
  for (const row of report) {
    if (row.candidate.family !== 'SVM' || kinds.get(row.candidate.address) !== 'wallet') continue;
    const program = await solanaSendProgram(fetch, rpcMap['solana-mainnet'], row.candidate.address);
    if (program !== null) programs.set(row.candidate.address, program);
  }
  const addresses = report.map((r) => r.candidate.address);
  const rq = receiversQuery(since, addresses);
  const pairs = addresses.length === 0 ? new Map<string, string[]>() : pairHints(addresses, await d1<{ address: string; receiver: string }>(rq.sql, rq.params), programs);
  for (const row of report) row.hints = candidateHints(row.candidate.address, programs.get(row.candidate.address), pairs);
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run scripts/test/label-candidates.test.ts`
Expected: PASS.

- [ ] **Step 4: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add scripts/label-candidates.ts scripts/test/label-candidates.test.ts
git commit -m "feat(labels): explain Solana senders by their program, and pair candidates

A system-owned Solana sender gets \"sends via program F2ZY…\" from its latest successful
send, and two candidates that message each other (or each other's program) get \"pairs
with …\": the two clues that confirmed xStocks.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 16: The runbook and the methodology

**Files:**
- Modify: `docs/methodology.md`, `docs/runbook.md`
- Modify: `site/src/lib/metric-anchors.ts`
- Test: the site build's `check-build` (every metric anchor must exist on `/methodology/`)

**Interfaces:**
- **Consumes:** every earlier task's behavior, as built.
- **Produces:** the methodology section `## Senders and projects` (anchor `senders-and-projects`), and `METRIC_ANCHORS.labels = 'senders-and-projects'`.

- [ ] **Step 1: The methodology**

In `docs/methodology.md`, add this section after "What is counted" (before `## Broadcasts`):

```markdown
## Senders and projects

- **Sender identity:** a message is credited to a project when its source chain and sender address have a verified label in `labels/projects/`, and otherwise to the address itself, across every chain it sends from. On 2026-10-13, xStocks's xBridge (one address on five EVM chains) and its Solana sender add up to 319 of the day's 1,569 messages (20.3%).
- **Label spread:** an EVM address with no label on its chain takes the label the same address has on another EVM chain, marked "inferred". A label never spreads across chain families, never from or to Solana or another non-EVM chain, never to an address two projects label, and never for a project whose label file sets `spread = false`. The weekly label candidates pull request lists every address a label spread to, so each is confirmed or blocked.
- **Rankings:** Top › Senders, the daily and weekly top sender and today's top senders rank identities, not chain-and-address pairs. The daily and weekly top sender is the identity with the most messages; Top › Senders ranks by value or by fees, as its other tabs do. A top sender's share is of all the period's messages.
- **Unique senders** still counts chain-and-address pairs: the same address on two chains counts twice.
- **Data messages:** messages that carry no tokens. Every day in history counts them; the daily card and History show their share.
- **Label coverage:** the share of the last 7 days' messages, value and fees sent by labeled identities (verified or inferred), computed at each finalize and shown on the status page.
- **Project pages** (`/projects/`) list every verified project: its totals over 7 days, 30 days and all time, its last 30 days, its chains and top lanes, its addresses (inferred ones marked) and its label's source.
- **Public files:** from 2026-10-14 the files carry sender identities in additive fields, so `schema_version` stays 1 and older readers keep working.
  - `top/sender.json` adds `identities` and `identities_by_fees`; its `windows` and `by_fees` keep the older `<selector>:<address>` keys.
  - `day-leaders.json` and `today.json` name senders `project:<slug>` or `address:<address>`, with `chains`, `addresses`, `inferred`, `x`, `kind` and `share_pct`.
  - `history.json` and `today.json` add `data_messages`; `status.json` adds `label_coverage`; `moments.json` adds `arrivals.senders` and each week's `project`.
  - `projects.json` is new.
```

In `## Moments`, add after the **New on CCIP** bullet:

```markdown
- **A new sender** is posted the day after it enters the day's top 10 senders by messages, with 20 or more that day, when its first message on any chain came within the 30 days ending that day. Each sender is posted once. Its count is of its messages since its first day.
- **The project spotlight** is the labeled project that gained the most messages on the week before, with at least 50 that week; it is posted on the Wednesday after the week.
```

and replace its **Tags** bullet with:

```markdown
- **Tags:** an X post tags only what it is about (the welcomed chain, the spotlighted chain, the headline chain of the movers when the headline is a chain, the new sender or the spotlighted project), and only with a verified handle. A project credited only through label spread, and any address, is never tagged. Everyone else is named in plain text, and the daily and weekly reports tag no one.
```

In `site/src/lib/metric-anchors.ts`, change `labels: 'data-sources',` to `labels: 'senders-and-projects',`.

- [ ] **Step 2: The runbook**

In `docs/runbook.md`, `## Labels and handles`:
- After the **Senders** bullet, add:

```markdown
- **A label file:** its file name is the project's slug (`labels/projects/xstocks.toml` is `project:xstocks` and `/projects/xstocks/`), so a verified project's file name must be lowercase letters, digits and dashes; renaming it changes the project's key and page. Start the file with a `# Source: <url> (…)` comment: the project page shows the first one. Add `spread = false` to stop the project's EVM addresses from being credited to it on chains its file does not list.
- **Label spread:** an address labeled on one EVM chain is credited to its project on every other EVM chain, marked "inferred" (never tagged in a post). The weekly candidates pull request's "Label spread this week" table lists each one: confirm it by adding the chain to the file, or set `spread = false`.
- **Suggest a label:** unlabeled rows on Top › Senders and day pages link to the "Suggest a label" issue form (`.github/ISSUE_TEMPLATE/label.yml`: chain, address, project, X handle, source). To accept one: check that the source is the project's own page and lists the address; add an `[[addresses]]` entry to the project's file, or create `labels/projects/<slug>.toml` with `name`, `kind`, `verified = true`, the `# Source:` comment and the address (and `x` only with a verified handle); run `pnpm labels:check`; push; close the issue with the commit. Decline anything without a public source.
```

- Change the **Check and build** bullet to: "`pnpm labels:check` validates both tables (CI runs it); `pnpm labels:build` writes `worker/src/generated/labels.json` (with each project's slug), `label-projects.json` (what the project pages show) and `handles.json`. The deploy also runs it."
- Replace the **Weekly gaps** bullet with:

```markdown
- **Weekly candidates** (`label-candidates` workflow, Mondays 06:00 UTC): ranks senders by identity (an address summed across its chains), the top 100 by messages and the top 100 by value over the last 7 days, and drafts `labels/projects/_candidate-<busiest chain>-<address>.toml` for each address no label names. A wallet sending 100+ messages a week stays in. The pull request leads with label coverage and its change from last week, lists addresses posted as new on CCIP first, then the day's top-3 senders; its Hints column says which program a system-owned Solana sender sends through and which candidates message each other. It ends with the label spread report and `labels/handle-gaps.md`, the busiest tokens with no project entry and the busiest chains with no handle. Drafts from before 2026-10-14 named by another chain can be deleted when a newer draft covers the same address.
```

In `## Moments`:
- Change the intro's list to "…a welcome for each new chain, a post for each new sender, milestone countdowns, leaderboard movers, a weekly chain spotlight, a weekly project spotlight, a weekly "New on CCIP" roundup and a weekly Telegram poll."
- In **Rhythm**, add: "New sender: the day after it enters the day's top 10 (see the methodology), once." and change the weekday line to "Tuesday: movers, for the week that ended on Sunday. Wednesday: the project spotlight, for the same week. Thursday: the chain spotlight. Saturday: New on CCIP, for Monday to Friday."
- In **Budget**, the order becomes "welcome, new sender, countdown, movers, chain spotlight, project spotlight, New on CCIP".
- In **Tags**, add: "A new sender tags its project's verified handle (an address, or a project credited only through label spread, is a plain name); the project spotlight tags the project."
- In **Keys**, add `broadcast:newcomer:<project:slug | address:address>` and `broadcast:project:<monday>`.
- In **A card**, add `…/newcomer/project/<slug>.png`, `…/newcomer/address/<address>.png` and `…/project/<monday>.png`.
- Add a bullet: "**New senders** are recorded at each finalize in D1 `arrivals` with `kind = 'sender'` (`first_seen` is the day they entered the top 10), so each posts once. A failure to record alerts `sender-arrivals:<day>` and the day still finalizes; the next finalize of that day records them."

In `## Website (ccip.dev)`, add under **Build failures**: "`projects.json`, like `cost.json`, may be missing before the Worker's first finalize after a deploy: the build passes, `/projects/` says pages appear after the next daily update, and no project page is built." Add a bullet: "**Project pages:** `/projects/` and `/projects/<slug>/` are built from `projects.json` at each site build; a project's share card is `/og/project/<slug>.png`."

- [ ] **Step 3: Check the docs build**

```bash
pnpm test && pnpm typecheck && pnpm --filter @ccip-dev/site build
```

Expected: green; `check-build` finds `id="senders-and-projects"` on `/methodology/` for the Top › Senders info link.

- [ ] **Step 4: Commit**

```bash
git add docs/methodology.md docs/runbook.md site/src/lib/metric-anchors.ts
git commit -m "docs: sender identities, label spread, coverage and the new moments in the methodology and runbook

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

#### Final checkpoint (controller, after Task 16 is reviewed)

Push `main`. When `deploy`, `site` and `ci` are green, run the whole-branch review, then check live:
- `https://ccip.dev/methodology/#senders-and-projects` renders, and Top › Senders' info link lands on it.
- The next Monday's `label-candidates` pull request leads with "Labeled senders: …", has the Chains, Data share and Hints columns, and ends with the label spread report. If the owner wants it sooner: `gh workflow run label-candidates` (pre-approved).
- After a week, `moments.json` has had a `project` for the latest week, and the Wednesday post went out (or reached the drafts chat).
