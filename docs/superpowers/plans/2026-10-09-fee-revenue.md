# Fee Revenue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CCIP's revenue story on the existing pages: an all-time fee line and run-rate on the home hero, fee records and milestones on Records, and a "LINK demand" section on Reserve. Underneath, every day stores its fees split into LINK, gas tokens and stablecoins, plus the LINK paid in LINK units.

**Architecture:** A generated, reviewed table in core (`FEE_TOKEN_GROUPS`) puts each non-LINK fee token in `native` or `stable`. LINK keeps its existing matcher, which now also carries each LINK token's decimals. One core function, `feeGroupTotals`, turns a day's message rows into `{ link_usd, native_usd, stable_usd, link_amount }`. The Worker's finalize and the fee backfill build both call it, so a live day and a backfilled day store identical values. Migration 0005 adds the three new `daily_totals` columns and an index on `messages.fee_usd`. `history.json` then carries the day fields and the 10 largest single fees, and the site reads it at build time.

**Tech stack:** TypeScript (ESM, `tsx`), Vitest 4, Cloudflare Workers with D1 and R2 (`@cloudflare/vitest-plugin`), Astro 7, React 19, `d3-shape` (already a site dependency), zod 4 (core). Data: the CCIP API, DefiLlama and the CCIP docs JSON on GitHub, all free.

**Spec:** `docs/superpowers/specs/2026-10-09-fee-revenue-design.md`.

## Global Constraints

- **No new data sources and no new dependencies:** "everything comes from the CCIP API, DefiLlama and the CCIP docs already in use." The generator reads the docs JSON from `https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/config/data/ccip/v1_2_0/mainnet/{chains,tokens}.json` (checked on 2026-10-09: byte-identical to the copies the spec was written from).
- **No change to how a fee is priced.** `valueFee`, `FEE_PRICE_ALIASES` and the price caches stay as they are.
- **No new page.** Placement is the home hero, Records and Reserve.
- **Groups:** `'link' | 'native' | 'stable' | 'other'`. The table is keyed `chainSelector:normalizedAddress`, the same key shape as `FEE_PRICE_ALIASES`. LINK is never in the table. Other is not stored: it is `fee_usd` minus the three USD groups.
- **Public files:** the new `history.json` day fields (`fee_native_usd`, `fee_stable_usd`, `fee_link_amount`) and the new top-level `largest_fees` are optional in the schema, so a client reading an older file still parses.
- **Copy, verbatim from the spec:**
  - Hero: "All-time fees: $X · $Y/yr at the 30-day pace →", linking to Records. While fee coverage starts after 2023-07-06, it reads "since <first fee day>".
  - Reserve caption: "Shown side by side. The Reserve does not publish which revenue each deposit came from."
- **Run-rate:** the sum of the last 30 complete days × 365 / 30, hidden when fewer than 30 days have fees.
- **Weeks:** start Monday UTC, using core's `weekStart`. A week only partly covered by fee data is left out.
- **Explorer link:** `https://ccip.chain.link/msg/<message_id>`. Checked on 2026-10-09: a real message id answers 200 and the page carries the id, and a bogus id answers 404.
- **Budgets:** home JavaScript ≤ 150 KB gzipped (`pnpm --filter @ccip-dev/site build` enforces it). Lighthouse mobile accessibility ≥ 95 on `/`, `/records/` and `/reserve/`. No horizontal scroll at 390 px.
- **`.backfill/` is the owner's.** The fee crawl is running against it. Never write to it, and never run `pnpm backfill:fees:*` against it. Tests build their own temp directories.
- **Remote operations are owner steps.** Never run a `wrangler … --remote` command. The deploy workflow (`.github/workflows/deploy.yml`) applies D1 migrations on every push to `main`.
- **Commits:**
  - Conventional subjects (`feat(core): …`, `feat(worker): …`, `feat(scripts): …`, `feat(site): …`, `docs(runbook): …`).
  - Stage explicit paths only. Never use `git add -A`, `git add .` or `git commit -a`.
  - End each message with the implementer's `Co-Authored-By` trailer.
- **Tests:**
  - Core: `pnpm --filter @ccip-dev/core test`.
  - Worker: `pnpm --filter @ccip-dev/worker test`.
  - Scripts: `pnpm exec vitest run scripts/test/<file>`.
  - Site: `pnpm --filter @ccip-dev/site test`.
  - Types: `pnpm typecheck`.
  - New tests use the BDD comments `// #given`, `// #when` and `// #then`.
- **Comments:** only where the why is not obvious from the code.

## Review Focus

1. **Midnight on the home hero.** Between 00:00 UTC and the 00:25 site build, `today.json` is already the new day while the build-time `history.json` stops the day before. The all-time figure must keep yesterday's fees when the page saw the rollover, and must never count a day twice. (Task 6, the tests "adds yesterday's fees when history.json does not hold that day yet" and "never counts a day history.json already holds".)
2. **A `history.json` published before the Worker change**, with no group fields and no `largest_fees`. The site must keep building, and the new elements must show nothing rather than zeros. (Task 4 "parses history.json with and without fee groups and the largest fees"; Task 7 "leaves the largest fee out when history.json has no largest_fees"; Task 8 "has no mix for a week whose days lack the fee group columns" and "says when no week has a mix yet".)
3. **Mixed-case 0x ids in the docs.** The docs list Aptos APT as `0x…0A`, but the CCIP API reports `0x…0a`. A key copied verbatim would never match, and APT fees would count as other. (Task 1, "keys each token by chain selector and lowercase 0x address, as the CCIP API reports them".)
4. **Rounded group totals above the rounded fee total.** `history.json` rounds each USD value to cents, so LINK + gas + stable can exceed `fee_usd` by a cent a day. "Other" must never go negative in the mix chart. (Task 8, "never makes other negative when the rounded groups add up to more than the fees".)
5. **Long tile labels at 390 px.** Under 480 px, `.tile .label` is `white-space: nowrap`. "Highest LINK share in a day" is wider than a two-column tile, so it would push the grid wider than the screen. (Tasks 7 and 8: the `wrap-labels` class, and the 390 px overflow check in the local preview.)

## File map

| File | Task | Responsibility |
|---|---|---|
| `scripts/fee-groups/generate.ts` | 1 | Reads the docs JSON, groups fee tokens by symbol, writes the generated table, prints the review list |
| `packages/core/src/fee-groups-docs.ts` | 1 | Generated: `FEE_TOKEN_GROUPS_FROM_DOCS` |
| `packages/core/src/fee-groups.ts` | 2 | Hand-added entries, `FEE_TOKEN_GROUPS`, `feeTokenGroup`, `feeClassifier`, `feeGroupTotals` |
| `packages/core/src/reserve.ts`, `rollup.ts` | 2 | Decimals on unlisted LINK; `linkFeeKeys` returns LINK tokens with their decimals |
| `worker/migrations/0005_fee_groups.sql` | 3 | The three columns and the fee index |
| `worker/src/store.ts`, `jobs/finalize.ts` | 2, 3, 4 | LINK tokens from D1, the group-totals setter and reader, the largest-fees query |
| `worker/src/publish.ts`, `packages/core/src/public.ts` | 4 | `history.json` day fields and `largest_fees`, and their schema |
| `scripts/backfill/fees/build.ts` | 5 | Group columns in the `daily_totals` UPDATE, the pricing hash, the no-group check |
| `site/src/lib/fee-revenue.ts`, `components/home/*` | 6 | All-time and run-rate maths, and the hero line |
| `site/src/lib/records.ts`, `pages/records.astro` | 7 | Fee records and fee milestones |
| `site/src/lib/fee-mix.ts`, `lib/weekly-chart.ts`, `components/WeeklyChart.tsx`, `components/LinkDemandCharts.tsx`, `pages/reserve.astro` | 8 | Weekly bucketing, the LINK tiles and the two weekly charts |

## Local preview with the new fields

Tasks 6, 7 and 8 check the built site in a browser. Until the Worker change is live, `data.ccip.dev` has no group fields, so the preview builds against a local mirror that adds synthetic ones. The mirror is for looking only: never commit it.

1. Save this as `mirror.mjs` in your scratch directory.

```js
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node mirror.mjs <directory>');
const FILES = ['status', 'live', 'today', 'history', 'top/lane', 'top/token', 'top/sender', 'top/src_chain', 'top/dst_chain', 'chains', 'tokens', 'reserve', 'replay'];
const get = async (name) => {
  const res = await fetch(`https://data.ccip.dev/v1/${name}.json`, { headers: { 'user-agent': 'curl/8.7.1' } });
  if (!res.ok) throw new Error(`${name}.json: HTTP ${res.status}`);
  return res.json();
};
const round = (v) => Math.round(v * 100) / 100;
const files = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await get(f)])));
const history = files.history;
for (const d of history.days) {
  if (d.fee_usd === null || d.fee_native_usd != null) continue;
  const link = d.fee_link_usd ?? round(d.fee_usd * 0.2);
  Object.assign(d, { fee_link_usd: link, fee_native_usd: round(d.fee_usd * 0.55), fee_stable_usd: round(d.fee_usd * 0.15), fee_link_amount: round(link / 12) });
}
const lastDay = history.days.at(-1).day;
history.largest_fees ??= files.live.messages.slice(0, 3).map((m, i) => ({
  message_id: m.id, day: lastDay, src: m.src, dst: m.dst, fee_usd: 5000 - i * 1500, symbol: ['WETH', 'LINK', null][i],
}));
for (const [name, body] of Object.entries(files)) {
  const file = path.join(dir, 'v1', `${name}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body));
}
console.log(`mirrored ${FILES.length} files to ${dir}/v1; ${history.days.filter((d) => d.fee_usd !== null).length} days have fees; ${history.largest_fees.length} largest fees`);
```

2. Run `node <scratch>/mirror.mjs <scratch>/mirror`. If it reports `0 largest fees`, `live.json` was empty; run it again a minute later.
3. Serve it in the background: `python3 -m http.server 8799 --directory <scratch>/mirror`.
4. Build against it: `CCIP_DATA_BASE=http://localhost:8799/v1 pnpm --filter @ccip-dev/site build`. Expected: the build passes and prints `index.html: … KB gzipped JavaScript … (budget 150 KB)` under budget.
5. Preview it in the background: `pnpm --filter @ccip-dev/site exec astro preview --port 4321`.
6. With chrome-devtools, for each page the task names:
   - take a screenshot at 1440×900, and another at 390×844 (via `emulate`);
   - at 390×844, evaluate `document.documentElement.scrollWidth === document.documentElement.clientWidth`. It must be `true`.
   - run `lighthouse_audit` in mobile mode. Accessibility must be ≥ 95.
7. Save the screenshots in the SDD workspace, describe them in the report, then stop the preview and the server.

---

### Task 1: Fee-group generator and the generated table

**Files:**
- Create: `scripts/fee-groups/generate.ts`
- Create (generated by Step 5): `packages/core/src/fee-groups-docs.ts`
- Modify: `package.json` (scripts: `"fee-groups:generate": "tsx scripts/fee-groups/generate.ts"`)
- Test: `scripts/test/fee-groups-generate.test.ts`

**Interfaces:**
- Consumes: `USER_AGENT` from `@ccip-dev/core`.
- Produces:
  - `STABLE_SYMBOLS: ReadonlySet<string>` and `UNGROUPED_SYMBOLS: ReadonlySet<string>`;
  - `docsAddress(address: string): string`;
  - `groupFeeTokens(chains: DocsChains, tokens: DocsTokens, rules?: GroupRules): { entries: GroupEntry[]; review: string[] }`;
  - `renderGroupsFile(entries: readonly GroupEntry[]): string`;
  - the types `DocsChains`, `DocsTokens`, `GroupRules` and `GroupEntry = { key: string; chain: string; group: 'native' | 'stable'; symbol: string }`;
  - in `packages/core/src/fee-groups-docs.ts`, `FEE_TOKEN_GROUPS_FROM_DOCS: Readonly<Record<string, { group: 'native' | 'stable'; symbol: string }>>`. Task 2 consumes it.

**Facts behind the rules** (docs snapshot of 2026-10-09):
- The docs list 51 non-LINK fee-token symbols on 79 chains, 88 chain-and-token pairs in all, and LINK on 75 chains.
- The USD-pegged symbols are GHO (10 chains), WGHO (Lens), pathUSD (Tempo), WgUSDT and WUSDT0 (Stable) and WXDAI (Gnosis).
- `STABLE_SYMBOLS` also keeps the spec's USDC, USDT, USDT0 and USD1, which no chain lists today.
- USD-pegged gas tokens count as stable, following the spec's own examples (USDT0, GHO).
- Every other symbol is a gas token or its wrapped form, so `UNGROUPED_SYMBOLS` starts empty.
- Canton CC's docs address is a Daml id (`Amulet@DSO::…`), and Aptos APT's is uppercase hex. Task 2 hand-adds the addresses the API reports for Canton, and `docsAddress` lowercases APT.

- [ ] **Step 1: Write the failing tests** in `scripts/test/fee-groups-generate.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { docsAddress, groupFeeTokens, renderGroupsFile, type DocsChains, type DocsTokens } from '../fee-groups/generate';

const BASE = '15971525489660198786';
const APTOS = '4741433654826277614';
const WETH = '0x4200000000000000000000000000000000000006';

const chains: DocsChains = {
  'ethereum-mainnet-base-1': { chainSelector: BASE, feeTokens: ['LINK', 'GHO', 'WETH'] },
  'aptos-mainnet': { chainSelector: APTOS, feeTokens: ['LINK', 'APT'] },
  'lens-mainnet': { chainSelector: '5608378062013572713', feeTokens: ['LINK', 'WGHO'] },
};
const tokens: DocsTokens = {
  LINK: { 'ethereum-mainnet-base-1': { tokenAddress: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196' } },
  GHO: { 'ethereum-mainnet-base-1': { tokenAddress: '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee' } },
  WETH: { 'ethereum-mainnet-base-1': { tokenAddress: WETH } },
  APT: { 'aptos-mainnet': { tokenAddress: '0x000000000000000000000000000000000000000000000000000000000000000A' } },
  WGHO: { 'lens-mainnet': { tokenAddress: '0x6bDc36E20D267Ff0dd6097799f82e78907105e2F' } },
};

describe('groupFeeTokens', () => {
  it('puts a stablecoin symbol in stable and every other symbol in native', () => {
    // #when
    const { entries } = groupFeeTokens(chains, tokens);
    // #then
    expect(Object.fromEntries(entries.map((e) => [e.symbol, e.group]))).toEqual({ APT: 'native', GHO: 'stable', WETH: 'native', WGHO: 'stable' });
  });

  it('skips LINK, which keeps its own matcher', () => {
    // #when
    const { entries } = groupFeeTokens(chains, tokens);
    // #then
    expect(entries.some((e) => e.symbol === 'LINK')).toBe(false);
  });

  it('keys each token by chain selector and lowercase 0x address, as the CCIP API reports them', () => {
    // #when
    const { entries } = groupFeeTokens(chains, tokens);
    // #then
    expect(entries.map((e) => e.key)).toContain(`${APTOS}:0x000000000000000000000000000000000000000000000000000000000000000a`);
  });

  it('leaves out a symbol marked ungrouped and says so', () => {
    // #when
    const { entries, review } = groupFeeTokens(chains, tokens, { stable: new Set(['GHO']), ungrouped: new Set(['WGHO']) });
    // #then
    expect({ symbols: entries.map((e) => e.symbol).sort(), leftOut: review.filter((l) => l.startsWith('left out')) }).toEqual({
      symbols: ['APT', 'GHO', 'WETH'],
      leftOut: ['left out WGHO: lens-mainnet'],
    });
  });

  it('prints each symbol with its group and chains, then what it skipped', () => {
    // #given a chain whose fee token has no tokens.json entry
    const withGap: DocsChains = { ...chains, 'corn-mainnet': { chainSelector: '9043146809313071210', feeTokens: ['LINK', 'WBTCN'] } };
    // #when
    const { review } = groupFeeTokens(withGap, tokens);
    // #then
    expect(review).toEqual([
      'native APT: aptos-mainnet',
      'native WETH: ethereum-mainnet-base-1',
      'stable GHO: ethereum-mainnet-base-1',
      'stable WGHO: lens-mainnet',
      'skipped LINK on 4 chains',
      'missing WBTCN on corn-mainnet: tokens.json has no address for it; hand-add it in fee-groups.ts if it is a real fee token',
    ]);
  });

  it('refuses two symbols at the same chain and address', () => {
    // #given
    const dup: DocsChains = { 'ethereum-mainnet-base-1': { chainSelector: BASE, feeTokens: ['WETH', 'WETH9'] } };
    const dupTokens: DocsTokens = { WETH: { 'ethereum-mainnet-base-1': { tokenAddress: WETH } }, WETH9: { 'ethereum-mainnet-base-1': { tokenAddress: WETH } } };
    // #when, #then
    expect(() => groupFeeTokens(dup, dupTokens)).toThrow(`${BASE}:${WETH} is listed as both WETH and WETH9`);
  });
});

describe('docsAddress', () => {
  it('lowercases 0x hex of any length and leaves base58 and TON addresses alone', () => {
    // #when
    const out = ['0xAbC', 'So11111111111111111111111111111111111111112', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd99'].map(docsAddress);
    // #then
    expect(out).toEqual(['0xabc', 'So11111111111111111111111111111111111111112', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd99']);
  });
});

describe('renderGroupsFile', () => {
  it('writes one line per token, commented with its docs chain', () => {
    // #when
    const file = renderGroupsFile([{ key: `${BASE}:${WETH}`, chain: 'ethereum-mainnet-base-1', group: 'native', symbol: 'WETH' }]);
    // #then
    expect(file).toContain(`  "${BASE}:${WETH}": { group: "native", symbol: "WETH" }, // ethereum-mainnet-base-1\n`);
  });

  it('exports the table under one name', () => {
    expect(renderGroupsFile([])).toContain("export const FEE_TOKEN_GROUPS_FROM_DOCS: Readonly<Record<string, { group: 'native' | 'stable'; symbol: string }>> = {\n};\n");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm exec vitest run scripts/test/fee-groups-generate.test.ts`. Expected: FAIL, because `../fee-groups/generate` is not found.

- [ ] **Step 3: Implement** `scripts/fee-groups/generate.ts`.

```ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { USER_AGENT } from '@ccip-dev/core';

export const DOCS_BASE = 'https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/config/data/ccip/v1_2_0/mainnet';
/** USD stablecoins among fee-token symbols, including a chain's USD gas token (xDAI on Gnosis, GHO on Lens, USDT0 and gUSDT on Stable). */
export const STABLE_SYMBOLS: ReadonlySet<string> = new Set(['GHO', 'WGHO', 'pathUSD', 'USDC', 'USDT', 'USDT0', 'WUSDT0', 'WgUSDT', 'USD1', 'WXDAI']);
/** Symbols that are neither a gas token nor a USD stablecoin; they stay out of the table and count as other. */
export const UNGROUPED_SYMBOLS: ReadonlySet<string> = new Set();

const OUT = path.resolve(import.meta.dirname, '../../packages/core/src/fee-groups-docs.ts');

export interface DocsChain {
  chainSelector: string;
  feeTokens?: string[];
}
export interface DocsToken {
  tokenAddress: string;
}
export type DocsChains = Record<string, DocsChain>;
export type DocsTokens = Record<string, Record<string, DocsToken>>;
export interface GroupRules {
  stable: ReadonlySet<string>;
  ungrouped: ReadonlySet<string>;
}
export interface GroupEntry {
  key: string;
  chain: string;
  group: 'native' | 'stable';
  symbol: string;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** EVM addresses and the 64-hex ids of Aptos and Sui are case-insensitive, and the CCIP API reports them lowercase. */
export function docsAddress(address: string): string {
  return /^0x[0-9a-fA-F]+$/.test(address) ? address.toLowerCase() : address;
}

export function groupFeeTokens(
  chains: DocsChains,
  tokens: DocsTokens,
  rules: GroupRules = { stable: STABLE_SYMBOLS, ungrouped: UNGROUPED_SYMBOLS },
): { entries: GroupEntry[]; review: string[] } {
  const entries: GroupEntry[] = [];
  const symbolAt = new Map<string, string>();
  const leftOut = new Map<string, string[]>();
  const missing: string[] = [];
  let linkChains = 0;
  for (const [chain, info] of Object.entries(chains).sort(([a], [b]) => compare(a, b))) {
    for (const symbol of info.feeTokens ?? []) {
      if (symbol === 'LINK') {
        linkChains += 1;
        continue;
      }
      if (rules.ungrouped.has(symbol)) {
        leftOut.set(symbol, [...(leftOut.get(symbol) ?? []), chain]);
        continue;
      }
      const token = tokens[symbol]?.[chain];
      if (!token) {
        missing.push(`missing ${symbol} on ${chain}: tokens.json has no address for it; hand-add it in fee-groups.ts if it is a real fee token`);
        continue;
      }
      const key = `${info.chainSelector}:${docsAddress(token.tokenAddress)}`;
      const earlier = symbolAt.get(key);
      if (earlier !== undefined) throw new Error(`${key} is listed as both ${earlier} and ${symbol}`);
      symbolAt.set(key, symbol);
      entries.push({ key, chain, group: rules.stable.has(symbol) ? 'stable' : 'native', symbol });
    }
  }
  const bySymbol = new Map<string, GroupEntry[]>();
  for (const e of entries) bySymbol.set(e.symbol, [...(bySymbol.get(e.symbol) ?? []), e]);
  const grouped = [...bySymbol.values()]
    .sort((a, b) => compare(a[0]!.group, b[0]!.group) || compare(a[0]!.symbol, b[0]!.symbol))
    .map((list) => `${list[0]!.group} ${list[0]!.symbol}: ${list.map((e) => e.chain).join(', ')}`);
  const ungrouped = [...leftOut.entries()].sort(([a], [b]) => compare(a, b)).map(([symbol, list]) => `left out ${symbol}: ${list.join(', ')}`);
  return { entries, review: [...grouped, ...ungrouped, `skipped LINK on ${linkChains} chains`, ...missing] };
}

export function renderGroupsFile(entries: readonly GroupEntry[]): string {
  return [
    "// Generated by `pnpm fee-groups:generate` from the CCIP docs' mainnet chains.json (fee-token symbols) and tokens.json",
    '// (addresses). Regenerate instead of editing; fee tokens the docs miss are hand-added in fee-groups.ts.',
    "export const FEE_TOKEN_GROUPS_FROM_DOCS: Readonly<Record<string, { group: 'native' | 'stable'; symbol: string }>> = {",
    ...entries.map((e) => `  ${JSON.stringify(e.key)}: { group: ${JSON.stringify(e.group)}, symbol: ${JSON.stringify(e.symbol)} }, // ${e.chain}`),
    '};',
    '',
  ].join('\n');
}

async function fetchDocs<T>(name: string): Promise<T> {
  const res = await fetch(`${DOCS_BASE}/${name}`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${DOCS_BASE}/${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const [chains, tokens] = await Promise.all([fetchDocs<DocsChains>('chains.json'), fetchDocs<DocsTokens>('tokens.json')]);
  const { entries, review } = groupFeeTokens(chains, tokens);
  await writeFile(OUT, renderGroupsFile(entries));
  console.log(`wrote ${entries.length} fee tokens to ${path.relative(process.cwd(), OUT)}; check each line:`);
  for (const line of review) console.log(line);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm exec vitest run scripts/test/fee-groups-generate.test.ts`. Expected: PASS.

- [ ] **Step 5: Add the package script and generate the table.** In the root `package.json`, after `"endpoints:refresh"`, add `"fee-groups:generate": "tsx scripts/fee-groups/generate.ts",`. Then run `pnpm fee-groups:generate`. Expected, for the docs as of 2026-10-09:
  - The first line is `wrote 88 fee tokens to packages/core/src/fee-groups-docs.ts; check each line:`.
  - 51 symbol lines follow. Exactly these six are stable:
    - `stable GHO: avalanche-mainnet, ethereum-mainnet-arbitrum-1, ethereum-mainnet-base-1, ethereum-mainnet-ink-1, ethereum-mainnet-mantle-1, ethereum-mainnet-xlayer-1, mainnet, monad-mainnet, plasma-mainnet, xdai-mainnet`
    - `stable WGHO: lens-mainnet`
    - `stable WUSDT0: stable-mainnet`
    - `stable WXDAI: xdai-mainnet`
    - `stable WgUSDT: stable-mainnet`
    - `stable pathUSD: tempo-mainnet`
  - The 45 native symbols are APT, CC, GRAM, W0G, WAB, WADI, WAPE, WASTR, WAVAX, WBERA, WBNB, WBONE, WBTC, WCELO, WCORE, WCRO, WCTC, WETH, WFRAX, WGAS, WHBAR, WHSK, WHYPE, WKLAY, WMETIS, WMNT, WMON, WMOVA, WNXPC, WOKB, WPLUME, WPOL, WPROS, WRBTC, WRON, WS, WSEI, WSOL, WTAO, WTEMP, WWEMIX, WXDC, WXPL, WXTZ and WZKCRO.
  - Then `skipped LINK on 75 chains`, and no `missing` line.

  If the counts differ, the docs have changed since the plan was written. Read the new lines with the rules above before going on. Open the generated file and check that it holds the line `"4426351306075016396:0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c": { group: "native", symbol: "W0G" }, // 0g-mainnet` and the APT key in lowercase. The Canton line keys its Daml id (`Amulet@DSO::…`); that is expected, and Task 2 adds the addresses the API reports.

- [ ] **Step 6: Typecheck.** Run `pnpm typecheck`. Expected: PASS. The generated file compiles on its own.

- [ ] **Step 7: Commit.**

```bash
git add scripts/fee-groups/generate.ts scripts/test/fee-groups-generate.test.ts packages/core/src/fee-groups-docs.ts package.json
git commit -m "feat(scripts): generate the fee-token group table from the CCIP docs"
```

---

### Task 2: Core fee groups, LINK decimals and `feeGroupTotals`

**Files:**
- Modify: `packages/core/src/reserve.ts` (`UNLISTED_LINK_FEE_TOKENS` entries gain `decimals`; add `LINK_TOKEN_DECIMALS`)
- Modify: `packages/core/src/rollup.ts` (`LinkFeeTokens`; `linkFeeKeys` returns each LINK token's decimals; `linkFeeMatcher` accepts a map)
- Create: `packages/core/src/fee-groups.ts`
- Modify: `packages/core/src/index.ts` (export `./fee-groups`)
- Modify: `worker/src/store.ts` (`linkFeeTokens` builds its map with `linkFeeKeys`)
- Modify: `docs/methodology.md` (Fees: groups and LINK paid) and `docs/runbook.md` (new section "Fee groups")
- Test: `packages/core/test/fee-groups.test.ts` (new), `packages/core/test/rollup.test.ts`, `worker/test/store.test.ts`

**Interfaces:**
- Consumes: `FEE_TOKEN_GROUPS_FROM_DOCS` (Task 1).
- Produces:
  - in `reserve.ts`:
    - `UNLISTED_LINK_FEE_TOKENS: Readonly<Record<string, { address: string; decimals: number }>>`;
    - `LINK_TOKEN_DECIMALS = 18`.
  - in `rollup.ts`:
    - `type LinkFeeTokens = ReadonlyMap<string, number>`, mapping `chain:normalizedAddress` to decimals;
    - `linkFeeKeys(tokens: readonly { chain: string; address: string; groupId: string | null; decimals: number }[]): Map<string, number>`;
    - `linkFeeMatcher(keys: { has(key: string): boolean }): LinkFeeMatcher`.
  - in `fee-groups.ts`:
    - `type FeeGroup = 'link' | 'native' | 'stable' | 'other'`;
    - `interface FeeTokenGroup { group: 'native' | 'stable'; symbol: string }`;
    - `FEE_TOKEN_GROUPS: Readonly<Record<string, FeeTokenGroup>>`;
    - `feeTokenGroup(chain: string, feeToken: string, isLinkFee: LinkFeeMatcher): FeeGroup`;
    - `interface FeeTokenClass { group: FeeGroup; symbol: string | null; linkDecimals: number | null }` and `type FeeClassifier = (chain: string, feeToken: string) => FeeTokenClass`;
    - `feeClassifier(linkTokens: LinkFeeTokens): FeeClassifier`;
    - `interface FeeGroupTotals { link_usd: number | null; native_usd: number | null; stable_usd: number | null; link_amount: number | null }`;
    - `feeGroupTotals(messages: MessageRow[], day: string, classify: FeeClassifier): FeeGroupTotals`.
  - in `worker/src/store.ts`: `linkFeeTokens(db: D1Database): Promise<LinkFeeTokens>`.

**Unlisted LINK decimals (verified 2026-10-09):** all 13 entries are 18.
- `decimals()` was read through each chain's keyless RPC in `config/endpoints.json`:
  - Arbitrum: `arb1.arbitrum.io/rpc`
  - Avalanche: `api.avax.network`, where the symbol is `LINK.e`
  - BSC: `bsc-dataseed.bnbchain.org`
  - OP: `mainnet.optimism.io`
  - Polygon: `public.blazingnode.com`
  - Gnosis: `rpc.gnosischain.com`
  - Hyperliquid: `rpc.hyperliquid.xyz/evm`
  - Kaia: `public-en.node.kaia.io`
  - Hedera: `hedera.linkpool.pro`
  - Etherlink: `node.mainnet.etherlink.com`
  - Bittensor: `rpc.blockmachine.io`
  - Cronos zkEVM: `mainnet.zkevm.cronos.org`
  - Nexon Henesys: `henesys-rpc.msu.io`
- Each also matches the docs' `tokens.json` LINK entry for the chain (same address, `decimals: 18`).

**Hand-added fee tokens** come from a scan of every sealed fee-detail day on 2026-10-09 (2026-01-19 to 2026-10-04, 259 days), joined to the archive for the source chain. These pairs are not in the docs table:

| Chain | Fee token | Messages | Check | Plan |
|---|---|---|---|---|
| Arc | `0x8dfa…8743` | 323 | `CCIP_USDC`, 18 decimals | stable |
| Arc | `0xcb9a…a131` | 2 | `CCIP_USDC`, 6 decimals | stable |
| Blast | `0x4300…0004` | 5 | `WETH` | native |
| Canton | `0xd573…628b` | 12 | CC (FEE_PRICE_ALIASES) | native |
| Canton | `0x0000…0000` | 17 | CC (FEE_PRICE_ALIASES) | native |
| Celo | `0x2021…16c6` | 56 | `WCELO` | native |
| Metis | `0x75cb…3481` | 10 | `WMETIS` | native |
| Fraxtal | `0xfc00…0002` | 13 | `WFRAX` (the docs' WFRAX address is frxETH on chain) | native |
| Gravity | `0xbb85…bebd` | 164 | `wG` | native |
| Monad | `0x3bd3…433a` | 6,321 | `WMON` | native |
| Astar | `0xaeaa…f720` | 12 | `WASTR` | native |
| Sui | `0x9258…bdb3` | 6 | SUI's CoinMetadata object, read through Sui GraphQL | native |
| TAC | `0xb63b…c2c9` | 45 | `WTAC` | native |
| Everclear | `0x2e31…835f` | 25 | chain shut down | other, per the spec |
| Mind | `0x3902…2d0b` | 282 | chain shut down | other, per the spec |
| Base | `0x24cb…91de` | 2 | `zunETH`, neither a gas token nor a stablecoin | other |
| Botanix | `0x0d24…0c56` | 2 | RPC unreachable | other |
| Corn | `0xda5d…dfb2` | 18 | RPC unreachable | other |
| Memento | `0x0869…d7bd` | 2 | RPC unreachable | other |
| Pharos, Tempo, TON | `0xfbd4…dab6`, `0xd732…4176`, `EQ…u8e` | 12, 6, 1 | all fee amounts 0 | other |

- [ ] **Step 1: Write the failing core tests** in `packages/core/test/fee-groups.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { FEE_TOKEN_GROUPS, feeClassifier, feeGroupTotals, feeTokenGroup } from '../src/fee-groups';
import { UNLISTED_LINK_FEE_TOKENS } from '../src/reserve';
import { linkFeeKeys, linkFeeMatcher, linkFeeUsd } from '../src/rollup';
import type { MessageRow } from '../src/types';

const BASE = '15971525489660198786';
const SOLANA = '124615329519749607';
const LINK_BASE = '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196';
const LINK_SOLANA = 'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L';
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const GHO_BASE = '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee';
const UNKNOWN = '0x1111111111111111111111111111111111111111';

const linkTokens = linkFeeKeys([
  { chain: '5009297550715157269', address: '0x514910771af9ca656af840dff83e8264ecf986ca', groupId: 'link', decimals: 18 },
  { chain: BASE, address: LINK_BASE, groupId: 'link', decimals: 18 },
  { chain: SOLANA, address: LINK_SOLANA, groupId: 'link', decimals: 9 },
]);
const isLinkFee = linkFeeMatcher(linkTokens);
const classify = feeClassifier(linkTokens);

const row = (id: string, chain: string, token: string | null, amount: string | null, usd: number | null, day = '2026-10-05') =>
  ({ message_id: id, day, src_chain: chain, fee_token: token, fee_amount: amount, fee_usd: usd }) as MessageRow;

describe('feeTokenGroup', () => {
  it.each([
    ['WETH on Base', BASE, WETH_BASE, 'native'],
    ['WBTC on Bitlayer, priced through a fee price alias', '7937294810946806131', '0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f', 'native'],
    ['GHO on Base', BASE, GHO_BASE, 'stable'],
    ['LINK on Arbitrum, which the registry leaves out', '4949039107694359620', '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', 'link'],
    ['a fee token in neither list', BASE, UNKNOWN, 'other'],
  ])('puts %s in its group', (_, chain, token, group) => {
    expect(feeTokenGroup(chain, token, isLinkFee)).toBe(group);
  });

  it('matches a checksummed address', () => {
    expect(feeTokenGroup(BASE, '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee', isLinkFee)).toBe('stable');
  });

  it('groups a fee token the docs miss from the hand-added entries', () => {
    expect(feeTokenGroup('8481857512324358265', '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', isLinkFee)).toBe('native');
  });

  it('keeps LINK out of the table', () => {
    expect(Object.keys(FEE_TOKEN_GROUPS).filter((key) => linkFeeKeys([]).has(key))).toEqual([]);
  });
});

describe('feeClassifier', () => {
  it("names a LINK fee and gives its registry token's decimals", () => {
    expect(classify(SOLANA, LINK_SOLANA)).toEqual({ group: 'link', symbol: 'LINK', linkDecimals: 9 });
  });

  it('names a grouped fee token by its table symbol', () => {
    expect(classify(BASE, WETH_BASE)).toEqual({ group: 'native', symbol: 'WETH', linkDecimals: null });
  });

  it('has no symbol for any other fee token', () => {
    expect(classify(BASE, UNKNOWN)).toEqual({ group: 'other', symbol: null, linkDecimals: null });
  });
});

describe('UNLISTED_LINK_FEE_TOKENS', () => {
  it('gives every unlisted LINK the 18 decimals read on chain on 2026-10-09', () => {
    expect(Object.values(UNLISTED_LINK_FEE_TOKENS).map((t) => t.decimals)).toEqual(Array(13).fill(18));
  });
});

describe('feeGroupTotals', () => {
  // #given a day with 0.1 LINK worth $1, WETH worth $2, GHO worth $3 and an ungrouped token worth $4
  const day = [
    row('l', BASE, LINK_BASE, '100000000000000000', 1),
    row('w', BASE, WETH_BASE, '1000000000000000', 2),
    row('g', BASE, GHO_BASE, '3000000000000000000', 3),
    row('o', BASE, UNKNOWN, '5', 4),
  ];

  it('sums the USD fees of each group and the LINK paid in LINK, leaving other out', () => {
    // #when
    const totals = feeGroupTotals(day, '2026-10-05', classify);
    // #then
    expect(totals).toEqual({ link_usd: 1, native_usd: 2, stable_usd: 3, link_amount: 0.1 });
  });

  it('counts a LINK fee with no price in LINK units, at its token decimals', () => {
    // #given 2.5 Solana LINK (9 decimals) with no USD price
    const rows = [...day, row('s', SOLANA, LINK_SOLANA, '2500000000', null)];
    // #when, #then
    expect(feeGroupTotals(rows, '2026-10-05', classify).link_amount).toBe(2.6);
  });

  it('gives the same LINK USD total as linkFeeUsd', () => {
    expect(feeGroupTotals(day, '2026-10-05', classify).link_usd).toBe(linkFeeUsd(day, '2026-10-05', isLinkFee));
  });

  it('is null throughout for a day with no priced fee', () => {
    expect(feeGroupTotals([row('n', BASE, null, null, null)], '2026-10-05', classify)).toEqual({ link_usd: null, native_usd: null, stable_usd: null, link_amount: null });
  });

  it('ignores other days and counts a duplicated message once', () => {
    // #given
    const rows = [...day, row('w', BASE, WETH_BASE, '1000000000000000', 2), row('z', BASE, WETH_BASE, '1', 9, '2026-10-04')];
    // #when, #then
    expect(feeGroupTotals(rows, '2026-10-05', classify).native_usd).toBe(2);
  });
});
```

- [ ] **Step 2: Update the `linkFeeKeys` tests** in `packages/core/test/rollup.test.ts`. Add `decimals: 18` to the three fixtures `ethLink`, `baseLink` and `baseWeth`, and add this test inside `describe('linkFeeKeys', …)`:

```ts
  it('gives Ethereum LINK 18 decimals, an unlisted LINK its own, and a registry LINK the registry decimals', () => {
    // #given Solana LINK with 9 decimals in Ethereum LINK's group
    const solLink = { chain: '124615329519749607', address: 'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L', groupId: 'link-group', decimals: 9 };
    // #when
    const keys = linkFeeKeys([ethLink, solLink]);
    // #then
    expect([
      keys.get(`${ethLink.chain}:${ethLink.address}`),
      keys.get('6433500567565415381:0x5947bb275c521040051d82396192181b413227a3'),
      keys.get(`${solLink.chain}:${solLink.address}`),
    ]).toEqual([18, 18, 9]);
  });
```

- [ ] **Step 3: Write the failing Worker test** in `worker/test/store.test.ts`, inside `describe('linkFeeTokens', …)`:

```ts
  it("gives each LINK token its decimals: the registry's, or the unlisted table's", async () => {
    // #given Ethereum LINK and Solana LINK (9 decimals) in one registry group
    await seedRegistry([NETWORKS.ethereum, NETWORKS.solana], [
      { chainSelector: NETWORKS.ethereum.chainSelector, address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
      { chainSelector: NETWORKS.solana.chainSelector, address: 'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L', symbol: 'LINK', name: 'Chainlink', decimals: 9, groupId: 'link' },
    ]);

    // #when
    const tokens = await store.linkFeeTokens(env.DB);

    // #then
    expect([
      tokens.get(`${NETWORKS.solana.chainSelector}:LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L`),
      tokens.get('4949039107694359620:0xf97f4df75117a78c1a5a0dbb814af92458539fb4'),
    ]).toEqual([9, 18]);
  });
```

- [ ] **Step 4: Run the tests and confirm they fail.**
  - Run `pnpm --filter @ccip-dev/core exec vitest run test/fee-groups.test.ts test/rollup.test.ts`. Expected: FAIL. `../src/fee-groups` is not found, and `keys.get` is not a function on a `Set`.
  - Run `pnpm --filter @ccip-dev/worker exec vitest run test/store.test.ts`. Expected: FAIL, because `tokens.get` is not a function.

- [ ] **Step 5: Add the decimals** in `packages/core/src/reserve.ts`. Replace the `UNLISTED_LINK_FEE_TOKENS` declaration and its doc comment with:

```ts
/**
 * LINK fee tokens on chains whose CCIP token registry has no LINK row, keyed by chain selector (CCIP docs, tokens.json).
 * A wrong decimals value would misstate LINK paid by a power of ten, so each was read with decimals() through the chain's
 * keyless RPC in config/endpoints.json on 2026-10-09; every one is 18 and matches tokens.json.
 */
export const UNLISTED_LINK_FEE_TOKENS: Readonly<Record<string, { address: string; decimals: number }>> = {
  '4949039107694359620': { address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', decimals: 18 }, // Arbitrum
  '6433500567565415381': { address: '0x5947BB275c521040051D82396192181b413227A3', decimals: 18 }, // Avalanche (LINK.e)
  '11344663589394136015': { address: '0x404460C6A5EdE2D891e8297795264fDe62ADBB75', decimals: 18 }, // BSC
  '3734403246176062136': { address: '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6', decimals: 18 }, // OP
  '4051577828743386545': { address: '0xb0897686c545045aFc77CF20eC7A532E3120E0F1', decimals: 18 }, // Polygon
  '465200170687744372': { address: '0xE2e73A1c69ecF83F464EFCE6A5be353a37cA09b2', decimals: 18 }, // Gnosis
  '2442541497099098535': { address: '0x1AC2EE68b8d038C982C1E1f73F596927dd70De59', decimals: 18 }, // Hyperliquid
  '9813823125703490621': { address: '0x7311DED199CC28D80E58e81e8589aa160199FCD2', decimals: 18 }, // Kaia
  '3229138320728879060': { address: '0x7Ce6bb2Cc2D3Fd45a974Da6a0F29236cb9513a98', decimals: 18 }, // Hedera
  '13624601974233774587': { address: '0x8ce7618E8f8E514d13889283F58FF03B794e6CC3', decimals: 18 }, // Etherlink
  '2135107236357186872': { address: '0xf09AFe78d3c7d359b334d7cB88995751F7eC5E13', decimals: 18 }, // Bittensor
  '8788096068760390840': { address: '0x61170ca9fB9cF98d4c7d684e07be6D969D59667E', decimals: 18 }, // Cronos zkEVM
  '12657445206920369324': { address: '0x76a443768A5e3B8d1AED0105FC250877841Deb40', decimals: 18 }, // Nexon Henesys
};
export const LINK_TOKEN_DECIMALS = 18;
```

- [ ] **Step 6: Carry decimals through the LINK set** in `packages/core/src/rollup.ts`. Change the `./reserve` import to `import { LINK_TOKEN, LINK_TOKEN_CHAIN_SELECTOR, LINK_TOKEN_DECIMALS, UNLISTED_LINK_FEE_TOKENS } from './reserve';`. Replace `linkFeeMatcher` and `linkFeeKeys` with:

```ts
/** LINK fee tokens by `chain:normalizedAddress`, each with the decimals that turn its fee amount into LINK. */
export type LinkFeeTokens = ReadonlyMap<string, number>;

export function linkFeeMatcher(keys: { has(key: string): boolean }): LinkFeeMatcher {
  return (chain, feeToken) => keys.has(`${chain}:${normalizeAddress(feeToken)}`);
}

/** The LINK fee tokens with their decimals; the Worker's `store.linkFeeTokens` builds the same map from D1. */
export function linkFeeKeys(tokens: readonly { chain: string; address: string; groupId: string | null; decimals: number }[]): Map<string, number> {
  const ethLink = normalizeAddress(LINK_TOKEN);
  const group = tokens.find((t) => t.chain === LINK_TOKEN_CHAIN_SELECTOR && normalizeAddress(t.address) === ethLink)?.groupId ?? null;
  return new Map<string, number>([
    [`${LINK_TOKEN_CHAIN_SELECTOR}:${ethLink}`, LINK_TOKEN_DECIMALS],
    ...Object.entries(UNLISTED_LINK_FEE_TOKENS).map(([chain, t]): [string, number] => [`${chain}:${normalizeAddress(t.address)}`, t.decimals]),
    ...(group === null ? [] : tokens.filter((t) => t.groupId === group).map((t): [string, number] => [`${t.chain}:${normalizeAddress(t.address)}`, t.decimals])),
  ]);
}
```

- [ ] **Step 7: Create** `packages/core/src/fee-groups.ts`.

```ts
import { FEE_TOKEN_GROUPS_FROM_DOCS } from './fee-groups-docs';
import { normalizeAddress } from './normalize';
import { linkFeeMatcher, type LinkFeeMatcher, type LinkFeeTokens } from './rollup';
import type { MessageRow } from './types';
import { toUnits } from './value';

export type FeeGroup = 'link' | 'native' | 'stable' | 'other';

export interface FeeTokenGroup {
  group: 'native' | 'stable';
  symbol: string;
}

export interface FeeTokenClass {
  group: FeeGroup;
  symbol: string | null;
  linkDecimals: number | null;
}

export type FeeClassifier = (chain: string, feeToken: string) => FeeTokenClass;

export interface FeeGroupTotals {
  link_usd: number | null;
  native_usd: number | null;
  stable_usd: number | null;
  link_amount: number | null;
}

/**
 * Fee tokens the CCIP API reports that the docs list under another address, or not at all, checked on 2026-10-09:
 * symbol() through a keyless RPC, Sui's object through Sui's GraphQL API, and Canton's CC as FEE_PRICE_ALIASES has it.
 */
const HAND_ADDED: Readonly<Record<string, FeeTokenGroup>> = {
  // Arc CCIP_USDC (wrapped native USDC), 18 decimals; the docs list only LINK for Arc
  '6370580034781731079:0x8dfa585699cb46ca2a5fa649700f09839b4b8743': { group: 'stable', symbol: 'CCIP_USDC' },
  // Arc CCIP_USDC at 6 decimals, used 2026-07-07 to 07-10
  '6370580034781731079:0xcb9a646af26069f052c1b526120facb404c3a131': { group: 'stable', symbol: 'CCIP_USDC' },
  // Blast WETH; Blast has left the docs
  '4411394078118774322:0x4300000000000000000000000000000000000004': { group: 'native', symbol: 'WETH' },
  // Canton CC as the API reports it; the docs give its Daml id (Amulet@DSO::…) instead
  '2308837218439511688:0xd573c85e64a85bc81e99641d37b160febc1581c724255604ce45ef2f99f6628b': { group: 'native', symbol: 'CC' },
  // Canton CC as the API reported it in June 2026, the zero address (see FEE_PRICE_ALIASES)
  '2308837218439511688:0x0000000000000000000000000000000000000000': { group: 'native', symbol: 'CC' },
  // Celo WCELO; the docs list the CELO token itself (0x471e…a438)
  '1346049177634351622:0x2021b12d8138e2d63cf0895eccabc0dfc92416c6': { group: 'native', symbol: 'WCELO' },
  // Metis WMETIS; the docs list the METIS precompile (0xdead…0000)
  '8805746078405598895:0x75cb093e4d61d2a2e65d8e0bbb01de8d89b53481': { group: 'native', symbol: 'WMETIS' },
  // Fraxtal WFRAX; the docs' WFRAX address (0xfc00…0006) is frxETH on chain
  '1462016016387883143:0xfc00000000000000000000000000000000000002': { group: 'native', symbol: 'WFRAX' },
  // Gravity wG; Gravity is not in the docs
  '2988178761202034333:0xbb859e225ac8fb6be1c7e38d87b767e95fef0ebd': { group: 'native', symbol: 'wG' },
  // Monad WMON; the docs list another WMON (0x3a70…8198) that only a 2026-02-21 to 02-23 burst used
  '8481857512324358265:0x3bd359c1119da7da1d913d1c4d2b7c461115433a': { group: 'native', symbol: 'WMON' },
  // Astar's older WASTR; the docs list 0x3779…d093
  '6422105447186081193:0xaeaaf0e2c81af264101b9129c00f4440ccf0f720': { group: 'native', symbol: 'WASTR' },
  // Sui SUI: the API reports SUI's CoinMetadata object id; Sui is not in the docs
  '17529533435026248318:0x9258181f5ceac8dbffb7030890243caed69a9599d2886d957a9cb7656af3bdb3': { group: 'native', symbol: 'SUI' },
  // TAC WTAC; TAC is not in the docs
  '5936861837188149645:0xb63b9f0eb4a6e6f191529d71d4d88cc8900df2c9': { group: 'native', symbol: 'WTAC' },
};

/** Keyed `chainSelector:normalizedAddress`, as FEE_PRICE_ALIASES is. LINK is never here: it has its own matcher. */
export const FEE_TOKEN_GROUPS: Readonly<Record<string, FeeTokenGroup>> = { ...FEE_TOKEN_GROUPS_FROM_DOCS, ...HAND_ADDED };

const keyOf = (chain: string, token: string) => `${chain}:${normalizeAddress(token)}`;

export function feeTokenGroup(chain: string, feeToken: string, isLinkFee: LinkFeeMatcher): FeeGroup {
  if (isLinkFee(chain, feeToken)) return 'link';
  return FEE_TOKEN_GROUPS[keyOf(chain, feeToken)]?.group ?? 'other';
}

export function feeClassifier(linkTokens: LinkFeeTokens): FeeClassifier {
  const isLinkFee = linkFeeMatcher(linkTokens);
  return (chain, feeToken) => {
    const key = keyOf(chain, feeToken);
    const group = feeTokenGroup(chain, feeToken, isLinkFee);
    if (group === 'link') return { group, symbol: 'LINK', linkDecimals: linkTokens.get(key)! };
    return { group, symbol: FEE_TOKEN_GROUPS[key]?.symbol ?? null, linkDecimals: null };
  };
}

/**
 * A day's fees by group, shared by the Worker's finalize and the fee backfill build. Null throughout when no message has a
 * priced fee, as rollupDay's fee_usd is. LINK is also counted in LINK units, priced or not.
 */
export function feeGroupTotals(messages: MessageRow[], day: string, classify: FeeClassifier): FeeGroupTotals {
  const byId = new Map<string, MessageRow>();
  for (const m of messages) if (m.day === day) byId.set(m.message_id, m);
  const rows = [...byId.values()];
  if (!rows.some((r) => r.fee_usd !== null)) return { link_usd: null, native_usd: null, stable_usd: null, link_amount: null };
  const totals = { link_usd: 0, native_usd: 0, stable_usd: 0, link_amount: 0 };
  for (const r of rows) {
    if (r.fee_token === null) continue;
    const { group, linkDecimals } = classify(r.src_chain, r.fee_token);
    if (group === 'link' && r.fee_amount !== null) totals.link_amount += toUnits(r.fee_amount, linkDecimals!);
    if (r.fee_usd === null) continue;
    if (group === 'link') totals.link_usd += r.fee_usd;
    else if (group === 'native') totals.native_usd += r.fee_usd;
    else if (group === 'stable') totals.stable_usd += r.fee_usd;
  }
  return totals;
}
```

Then in `packages/core/src/index.ts`, after `export * from './fee-aliases';`, add `export * from './fee-groups';`.

- [ ] **Step 8: Build the Worker's LINK map with the shared function.** In `worker/src/store.ts`:
  - In the `@ccip-dev/core` import, remove `UNLISTED_LINK_FEE_TOKENS`, and add `linkFeeKeys` and `type LinkFeeTokens`.
  - Replace `linkFeeTokens` with:

```ts
export async function linkFeeTokens(db: D1Database): Promise<LinkFeeTokens> {
  const { results } = await db
    .prepare(
      `SELECT chain, address, group_id, decimals FROM tokens
       WHERE group_id IS NOT NULL AND group_id = (SELECT group_id FROM tokens WHERE chain = ? AND lower(address) = lower(?))`,
    )
    .bind(LINK_TOKEN_CHAIN_SELECTOR, LINK_TOKEN)
    .all<{ chain: string; address: string; group_id: string; decimals: number }>();
  return linkFeeKeys(results.map((r) => ({ chain: r.chain, address: r.address, groupId: r.group_id, decimals: r.decimals })));
}
```

  `finalize.ts` and `publish.ts` still call `linkFeeMatcher(await store.linkFeeTokens(…))`, which accepts the map unchanged. `scripts/backfill/fees/build.ts` passes `NormalizedToken`s, which carry `decimals`.

- [ ] **Step 9: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/core test && pnpm --filter @ccip-dev/worker test && pnpm exec vitest run scripts/test/fees-build.test.ts && pnpm typecheck`. Expected: all pass.

- [ ] **Step 10: Document the groups** in `docs/methodology.md`. Insert these bullets right after the bullet that starts with `- **Fees paid in LINK:**`:

```markdown
- **Fee groups:** each fee counts in one of four groups, by its fee token.
  - **LINK:** the LINK tokens above.
  - **Gas tokens:** a chain's gas token or its wrapped form, such as WETH, WBNB, WPOL, WAVAX, wSOL, WHYPE, APT, CC and GRAM.
  - **Stablecoins:** a USD stablecoin, including a chain's gas token when it is one: GHO, pathUSD, USDT0 and gUSDT on Stable, xDAI on Gnosis and USDC on Arc.
  - **Other:** every other fee token, such as those on Mind and Everclear. Other is a day's fees minus the three groups above.

  A token's group comes from the CCIP docs: each chain's listed fee tokens, grouped by symbol (a fixed list of stablecoin
  symbols; every other symbol is a gas token). Fee tokens the API reports that the docs list under another address, or not
  at all, were checked on chain and added by hand. A token in the wrong group would move USD between groups, but never
  changes total fees.
- **LINK paid:** each LINK fee's amount, `amount / 10^decimals`, counted whether or not the fee has a USD price. The
  decimals come from the CCIP token registry, are 18 for Ethereum LINK, and were read on chain for the 13 chains above.
```

- [ ] **Step 11: Add the runbook section.** Append to `docs/runbook.md`:

````markdown
## Fee groups

`FEE_TOKEN_GROUPS` (`packages/core/src/fee-groups.ts`) puts each non-LINK fee token in `native` (gas tokens) or `stable`. Any other token counts as other. The table merges the generated `packages/core/src/fee-groups-docs.ts` with the hand-added entries in `fee-groups.ts`.

### Regenerate the table

Do this when CCIP adds a chain or a fee token.

1. Run `pnpm fee-groups:generate`. It reads the CCIP docs' mainnet `chains.json` and `tokens.json` from GitHub and rewrites `fee-groups-docs.ts`. It prints each symbol with its group and chains, then any `left out` symbols, `skipped LINK on <n> chains`, and any `missing …` line.
2. Read every line.
   - A symbol that is neither a gas token (or its wrapped form) nor a USD stablecoin goes in `UNGROUPED_SYMBOLS` in `scripts/fee-groups/generate.ts`.
   - A new stablecoin symbol goes in `STABLE_SYMBOLS`.
   - Regenerate after either change.
3. Hand-add a fee token to `HAND_ADDED` in `fee-groups.ts` when it shows in a `missing <symbol> on <chain>` line, or when the fee build's no-group check names it (Fee backfill, Build) and it is a gas token or a stablecoin.
   - Read `symbol()` on chain through the chain's keyless RPC in `config/endpoints.json`.
   - Write a one-line comment saying what the token is and why the docs miss it.
4. Run `git diff packages/core/src/fee-groups-docs.ts`, then `pnpm --filter @ccip-dev/core test`, and commit.
5. A table change makes the next fee build rebuild every sealed day (Fee backfill, Build). The Worker uses the new table for the days it finalizes after its next deploy. To regroup earlier live days, rewind `last_finalize_day` as in "Re-finalize a day".
````

- [ ] **Step 12: Commit.**

```bash
git add packages/core/src/reserve.ts packages/core/src/rollup.ts packages/core/src/fee-groups.ts packages/core/src/index.ts packages/core/test/fee-groups.test.ts packages/core/test/rollup.test.ts worker/src/store.ts worker/test/store.test.ts docs/methodology.md docs/runbook.md
git commit -m "feat(core): fee-token groups and the shared group totals, with LINK paid counted in LINK"
```

---

### Task 3: Migration 0005, and finalize writes the group columns

**Files:**
- Create: `worker/migrations/0005_fee_groups.sql`
- Modify: `worker/src/store.ts` (replace `setFeeLinkUsd` with `setFeeGroupTotals`)
- Modify: `worker/src/jobs/finalize.ts`
- Test: `worker/test/store.test.ts`, `worker/test/finalize.test.ts`

**Interfaces:**
- Consumes: `feeClassifier`, `feeGroupTotals`, `FeeClassifier` and `FeeGroupTotals` (Task 2); `store.linkFeeTokens` (Task 2).
- Produces: `store.setFeeGroupTotals(db: D1Database, day: string, groups: FeeGroupTotals): Promise<void>`, which writes `fee_link_usd`, `fee_native_usd`, `fee_stable_usd` and `fee_link_amount` in one statement.

- [ ] **Step 1: Write the failing migration test.** Add to `worker/test/store.test.ts`:

```ts
describe('migration 0005', () => {
  it('adds the fee group columns to daily_totals', async () => {
    // #when
    const { results } = await env.DB.prepare('PRAGMA table_info(daily_totals)').all<{ name: string }>();
    // #then
    expect(results.map((c) => c.name)).toEqual(expect.arrayContaining(['fee_native_usd', 'fee_stable_usd', 'fee_link_amount']));
  });

  it('indexes the priced message fees', async () => {
    // #when
    const index = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_messages_fee_usd'").first<{ sql: string }>();
    // #then
    expect(index?.sql).toBe('CREATE INDEX idx_messages_fee_usd ON messages (fee_usd) WHERE fee_usd IS NOT NULL');
  });
});
```

- [ ] **Step 2: Write the failing finalize test.** Add to `describe('fees paid in LINK', …)` in `worker/test/finalize.test.ts`. The day is the same as Task 5's build test, so the two tests pin parity (spec §2.4).

```ts
  it("stores the day's fees by group and the LINK paid in LINK units", async () => {
    // #given the fee backfill build test's day: 0.1 LINK worth $1, WETH worth $2 and GHO worth $3, all on Base
    const day = '2026-10-09';
    const linkBase = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196';
    await seedRegistry([NETWORKS.ethereum, NETWORKS.base], [
      { chainSelector: NETWORKS.ethereum.chainSelector, address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
      { chainSelector: NETWORKS.base.chainSelector, address: linkBase, symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
    ]);
    await store.setMeta(env.DB, 'live_start_day', day);
    await store.setMeta(env.DB, 'last_finalize_day', '2026-10-08');
    const fee = (id: string, hour: string, token: string, amount: string, usd: number) =>
      liveRow(
        { id, sendTs: `${day}T${hour}:00:00.000Z`, src: NETWORKS.base },
        { fee_token: token, fee_amount: amount, fee_usd: usd, detail_fetched_at: `${day}T${hour}:01:00.000Z`, next_check_at: null },
      );
    await store.upsertListRows(env.DB, [
      fee('l', '10', linkBase, '100000000000000000', 1),
      fee('w', '11', '0x4200000000000000000000000000000000000006', '1000000000000000', 2),
      fee('g', '12', '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee', '3000000000000000000', 3),
    ], []);

    // #when
    await runFinalize(harness({ now: '2026-10-10T00:10:00.000Z', ccip: fakeCcip({ messages: [] }) }).c, 'early');

    // #then
    const stored = await env.DB.prepare('SELECT fee_usd, fee_link_usd, fee_native_usd, fee_stable_usd, fee_link_amount FROM daily_totals WHERE day = ?').bind(day).first();
    expect(stored).toEqual({ fee_usd: 6, fee_link_usd: 1, fee_native_usd: 2, fee_stable_usd: 3, fee_link_amount: 0.1 });
  });
```

- [ ] **Step 3: Run the tests and confirm they fail.** Run `pnpm --filter @ccip-dev/worker exec vitest run test/store.test.ts test/finalize.test.ts`. Expected: FAIL. The migration tests find no columns and no index, and the finalize test fails with `no such column: fee_native_usd`.

- [ ] **Step 4: Add the migration** `worker/migrations/0005_fee_groups.sql`:

```sql
ALTER TABLE daily_totals ADD COLUMN fee_native_usd REAL;
ALTER TABLE daily_totals ADD COLUMN fee_stable_usd REAL;
ALTER TABLE daily_totals ADD COLUMN fee_link_amount REAL;
CREATE INDEX idx_messages_fee_usd ON messages (fee_usd) WHERE fee_usd IS NOT NULL;
```

- [ ] **Step 5: Replace the setter** in `worker/src/store.ts`. Add `type FeeGroupTotals` to the `@ccip-dev/core` import, and replace `setFeeLinkUsd` with:

```ts
export async function setFeeGroupTotals(db: D1Database, day: string, groups: FeeGroupTotals): Promise<void> {
  await db
    .prepare('UPDATE daily_totals SET fee_link_usd = ?, fee_native_usd = ?, fee_stable_usd = ?, fee_link_amount = ? WHERE day = ?')
    .bind(groups.link_usd, groups.native_usd, groups.stable_usd, groups.link_amount, day)
    .run();
}
```

- [ ] **Step 6: Call it from finalize** in `worker/src/jobs/finalize.ts`.
  - Replace the `@ccip-dev/core` import with:

```ts
import {
  addDays, archiveKey, dayOf, dayStartIso, daysBetween, dedupeRawById, feeClassifier, feeGroupTotals, feePriceKeys, gzipText, rollupDay,
  toJsonl, valueFee, type FeeClassifier, type ListMessage,
} from '@ccip-dev/core';
```

  - In `interface RunShared`, replace `isLinkFee: LinkFeeMatcher;` with `classify: FeeClassifier;`.
  - In `runFinalize`, replace `isLinkFee: linkFeeMatcher(await store.linkFeeTokens(db)),` with `classify: feeClassifier(await store.linkFeeTokens(db)),`.
  - In `finalizeDay`, replace the last store call with `await store.setFeeGroupTotals(db, day, feeGroupTotals(messages, day, shared.classify));`.

  Run `rg -n "setFeeLinkUsd|isLinkFee" worker/src`. Expected: no matches.

- [ ] **Step 7: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/worker test && pnpm typecheck`. Expected: all pass. The existing "stores the USD value of the day's fees paid in LINK" test still passes, because `link_usd` equals `linkFeeUsd`.

- [ ] **Step 8: Commit.**

```bash
git add worker/migrations/0005_fee_groups.sql worker/src/store.ts worker/src/jobs/finalize.ts worker/test/store.test.ts worker/test/finalize.test.ts
git commit -m "feat(worker): migration 0005, and finalize stores each day's fees by group and LINK paid in LINK"
```

---

### Task 4: `history.json` fee groups and the largest fees

**Files:**
- Modify: `packages/core/src/public.ts` (optional day fields, `LargestFeeSchema`, optional `largest_fees`)
- Modify: `worker/src/store.ts` (replace `feeLinkByDay` with `feeGroupsByDay`; add `LARGEST_FEES_SQL`, `LargestFeeRow` and `largestFees`)
- Modify: `worker/src/publish.ts` (`publishHistoryFiles`)
- Modify: `docs/runbook.md` ("Fee groups" gains "Rollout")
- Test: `packages/core/test/public.test.ts`, `worker/test/publish.test.ts`, `worker/test/finalize.test.ts` (`TWO_DAY_OUTPUT`)

**Interfaces:**
- Consumes: `feeClassifier` and `FeeGroupTotals` (Task 2); `store.setFeeGroupTotals` (Task 3).
- Produces:
  - `DayTotalsSchema` gains `fee_native_usd`, `fee_stable_usd` and `fee_link_amount`, each `z.number().nullable().optional()`;
  - `LargestFeeSchema = { message_id: string; day: string; src: string; dst: string; fee_usd: number; symbol: string | null }`, with `type LargestFee`;
  - `HistoryFileSchema` gains `largest_fees: z.array(LargestFeeSchema).optional()`;
  - `store.feeGroupsByDay(db): Promise<Map<string, FeeGroupTotals>>`;
  - `store.LARGEST_FEES_SQL`, and `store.largestFees(db, throughDay: string, limit: number): Promise<LargestFeeRow[]>`;
  - `history.json`: each day has `fee_native_usd`, `fee_stable_usd` (USD rounded to cents) and `fee_link_amount` (LINK rounded to 0.01), null where the day has no fees, and the file has `largest_fees`, at most 10, largest first.
- Decisions:
  - `src` and `dst` are chain selectors, as in `live.json`, so the site names them through its chain map, as it does everywhere else.
  - `largest_fees` counts only days up to the last `history.json` day, so its day link always has a page.

- [ ] **Step 1: Write the failing schema test** in `packages/core/test/public.test.ts`. Add `HistoryFileSchema` to the `../src/public` import, and add inside `describe('public file schemas', …)`:

```ts
  it('parses history.json with and without fee groups and the largest fees', () => {
    // #given one file from after the fee groups and one from before
    const day = { day: '2026-10-07', messages: 3, token_messages: 0, usd_value: 0, fee_usd: 6, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: 1 };
    const after = {
      ...envelope, since: '2023-07-06',
      days: [{ ...day, fee_native_usd: 2, fee_stable_usd: 3, fee_link_amount: 0.1 }],
      largest_fees: [{ message_id: '0xabc', day: '2026-10-07', src: '1', dst: '2', fee_usd: 3, symbol: null }],
    };
    const before = { ...envelope, since: '2023-07-06', days: [day] };
    // #when
    const parsed = HistoryFileSchema.parse(after);
    // #then the new fields survive parsing, and the older file still parses
    expect({ largest: parsed.largest_fees?.length, linkAmount: parsed.days[0]?.fee_link_amount, before: HistoryFileSchema.safeParse(before).success }).toEqual({
      largest: 1,
      linkAmount: 0.1,
      before: true,
    });
  });
```

- [ ] **Step 2: Write the failing publish tests** in `worker/test/publish.test.ts`. Change the `@ccip-dev/core` import to `import { buildLabelIndex, LINK_PRICE_KEY, LINK_TOKEN, toChecksumAddress } from '@ccip-dev/core';`. In the existing test "shows null fees for a day whose daily_totals row has no fee data", change its expectation to `toMatchObject({ fee_usd: null, fee_link_usd: null, fee_native_usd: null, fee_stable_usd: null, fee_link_amount: null })`. Then add:

```ts
describe('history.json fee groups and largest fees', () => {
  const NOW = '2026-10-08T12:00:00.000Z';
  const DAY = '2026-10-07';
  const WETH = '0x4200000000000000000000000000000000000006';
  const BSC = '11344663589394136015';
  const totals = (fee: number | null) => ({ day: DAY, messages: 3, token_messages: 0, usd_value: 0, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
  const feeRow = (id: string, usd: number, extra: Parameters<typeof liveRow>[0] = { id, sendTs: `${DAY}T10:00:00.000Z` }, token = WETH) =>
    liveRow({ ...extra, id }, { fee_token: token, fee_amount: '1', fee_usd: usd });

  it("publishes each day's fees by group and its LINK paid in LINK", async () => {
    // #given
    await store.replaceDaily(env.DB, totals(6), [], NOW);
    await store.setFeeGroupTotals(env.DB, DAY, { link_usd: 1, native_usd: 2, stable_usd: 3, link_amount: 0.123456 });
    // #when
    await publishHistoryFiles(harness({ now: NOW }).c);
    // #then
    const day = (await readPublic('history.json')).days.find((d: { day: string }) => d.day === DAY);
    expect(day).toMatchObject({ fee_usd: 6, fee_link_usd: 1, fee_native_usd: 2, fee_stable_usd: 3, fee_link_amount: 0.12 });
  });

  it('lists the 10 largest single fees of the days history.json holds, largest first', async () => {
    // #given twelve fees on DAY and a larger one today, which history.json does not hold yet
    await store.replaceDaily(env.DB, totals(78), [], NOW);
    await store.upsertListRows(env.DB, [
      ...Array.from({ length: 12 }, (_, i) => feeRow(`f${i + 1}`, i + 1)),
      feeRow('today', 99, { id: 'today', sendTs: '2026-10-08T10:00:00.000Z' }),
    ], []);
    // #when
    await publishHistoryFiles(harness({ now: NOW }).c);
    // #then
    expect((await readPublic('history.json')).largest_fees.map((f: { message_id: string }) => f.message_id)).toEqual(['f12', 'f11', 'f10', 'f9', 'f8', 'f7', 'f6', 'f5', 'f4', 'f3']);
  });

  it('gives each largest fee its route as chain selectors and its fee token symbol', async () => {
    // #given a WETH fee on Base, an Ethereum LINK fee and a fee in an ungrouped token
    await store.replaceDaily(env.DB, totals(60.456), [], NOW);
    await store.upsertListRows(env.DB, [
      feeRow('weth', 30.456),
      feeRow('link', 20, { id: 'link', sendTs: `${DAY}T11:00:00.000Z`, src: NETWORKS.ethereum }, LINK_TOKEN),
      feeRow('other', 10, { id: 'other', sendTs: `${DAY}T12:00:00.000Z` }, '0x1111111111111111111111111111111111111111'),
    ], []);
    // #when
    await publishHistoryFiles(harness({ now: NOW }).c);
    // #then
    expect((await readPublic('history.json')).largest_fees).toEqual([
      { message_id: 'weth', day: DAY, src: BASE, dst: BSC, fee_usd: 30.46, symbol: 'WETH' },
      { message_id: 'link', day: DAY, src: NETWORKS.ethereum.chainSelector, dst: BSC, fee_usd: 20, symbol: 'LINK' },
      { message_id: 'other', day: DAY, src: BASE, dst: BSC, fee_usd: 10, symbol: null },
    ]);
  });

  it('reads the largest fees through idx_messages_fee_usd', async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.LARGEST_FEES_SQL}`).bind(DAY, 10).all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toContain('USING INDEX idx_messages_fee_usd');
  });
});
```

- [ ] **Step 3: Update the recorded catch-up output** in `worker/test/finalize.test.ts`. In `TWO_DAY_OUTPUT`, replace the `history` array with:

```ts
    history: [
      { day: '2026-10-08', messages: 3, token_messages: 1, usd_value: 2, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: null, fee_native_usd: null, fee_stable_usd: null, fee_link_amount: null },
      { day: '2026-10-09', messages: 2, token_messages: 1, usd_value: 24000.58, fee_usd: 0.27, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: 0, fee_native_usd: 0.27, fee_stable_usd: 0, fee_link_amount: 0 },
    ],
```

  The 2026-10-09 fee is WETH on Base, which the docs table puts in `native`.

- [ ] **Step 4: Run the tests and confirm they fail.**
  - Run `pnpm --filter @ccip-dev/core exec vitest run test/public.test.ts`. Expected: FAIL. zod strips fields the schema doesn't know, so `largest` and `linkAmount` come back `undefined`.
  - Run `pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts test/finalize.test.ts`. Expected: FAIL. `fee_native_usd` and `largest_fees` are missing, and `store.LARGEST_FEES_SQL` is undefined.

- [ ] **Step 5: Extend the public schema** in `packages/core/src/public.ts`.
  - In `DayTotalsSchema`, after `fee_link_usd: z.number().nullable(),`, add:

```ts
  fee_native_usd: z.number().nullable().optional(),
  fee_stable_usd: z.number().nullable().optional(),
  fee_link_amount: z.number().nullable().optional(),
```

  - Replace `HistoryFileSchema` with:

```ts
export const LargestFeeSchema = z.object({
  message_id: z.string(),
  day: z.string(),
  src: z.string(),
  dst: z.string(),
  fee_usd: z.number(),
  symbol: z.string().nullable(),
});

export const HistoryFileSchema = z.object({
  ...envelope,
  since: z.string().nullable(),
  days: z.array(DayTotalsSchema),
  largest_fees: z.array(LargestFeeSchema).optional(),
});
```

  - Add `export type LargestFee = z.infer<typeof LargestFeeSchema>;` next to the other exported types.

- [ ] **Step 6: Add the readers** in `worker/src/store.ts`. Replace `feeLinkByDay` with:

```ts
export async function feeGroupsByDay(db: D1Database): Promise<Map<string, FeeGroupTotals>> {
  const { results } = await db
    .prepare('SELECT day, fee_link_usd, fee_native_usd, fee_stable_usd, fee_link_amount FROM daily_totals')
    .all<{ day: string; fee_link_usd: number | null; fee_native_usd: number | null; fee_stable_usd: number | null; fee_link_amount: number | null }>();
  return new Map(results.map((r) => [r.day, { link_usd: r.fee_link_usd, native_usd: r.fee_native_usd, stable_usd: r.fee_stable_usd, link_amount: r.fee_link_amount }]));
}

/** ORDER BY fee_usd alone, so idx_messages_fee_usd yields the rows in order and LIMIT stops the scan. */
export const LARGEST_FEES_SQL =
  'SELECT message_id, day, src_chain, dst_chain, fee_token, fee_usd FROM messages WHERE fee_usd IS NOT NULL AND day <= ? ORDER BY fee_usd DESC LIMIT ?';

export interface LargestFeeRow {
  message_id: string;
  day: string;
  src_chain: string;
  dst_chain: string;
  fee_token: string | null;
  fee_usd: number;
}

export async function largestFees(db: D1Database, throughDay: string, limit: number): Promise<LargestFeeRow[]> {
  const { results } = await db.prepare(LARGEST_FEES_SQL).bind(throughDay, limit).all<LargestFeeRow>();
  return results;
}
```

- [ ] **Step 7: Publish them** in `worker/src/publish.ts`.
  - Add `feeClassifier` to the `@ccip-dev/core` import.
  - After `usd()`, add:

```ts
export function linkAmount(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

const LARGEST_FEES_LIMIT = 10;
```

  - In `publishHistoryFiles`, replace from `const feeLink = await store.feeLinkByDay(db);` through the `history.json` `putJson(…)` call with:

```ts
  const groups = await store.feeGroupsByDay(db);
  const classify = feeClassifier(await store.linkFeeTokens(db));
  const largest = await store.largestFees(db, history.at(-1)?.day ?? '', LARGEST_FEES_LIMIT);
  const since = (await store.getMeta(db, 'coverage_from')) ?? history[0]?.day ?? null;
  await putJson(
    c.env.PUBLIC,
    'history.json',
    {
      since,
      days: history.map((d) => {
        const g = groups.get(d.day);
        return {
          ...d,
          usd_value: usd(d.usd_value),
          fee_usd: usd(d.fee_usd),
          fee_link_usd: usd(g?.link_usd ?? null),
          fee_native_usd: usd(g?.native_usd ?? null),
          fee_stable_usd: usd(g?.stable_usd ?? null),
          fee_link_amount: linkAmount(g?.link_amount ?? null),
        };
      }),
      largest_fees: largest.map((r) => ({
        message_id: r.message_id,
        day: r.day,
        src: r.src_chain,
        dst: r.dst_chain,
        fee_usd: usd(r.fee_usd)!,
        symbol: r.fee_token === null ? null : classify(r.src_chain, r.fee_token).symbol,
      })),
    },
    TTL.history,
    now,
  );
```

  Run `rg -n feeLinkByDay worker/src`. Expected: no matches.

- [ ] **Step 8: Run the tests and typecheck.** Run `pnpm --filter @ccip-dev/core test && pnpm --filter @ccip-dev/worker test && pnpm typecheck`. Expected: all pass, including "public file contract", which validates the new `history.json` against its schema.

- [ ] **Step 9: Add the rollout to the runbook.** Append under "## Fee groups" in `docs/runbook.md`:

````markdown
### Rollout (one time)

1. **Migration 0005** adds `fee_native_usd`, `fee_stable_usd` and `fee_link_amount` to `daily_totals`, and the index `idx_messages_fee_usd`. The deploy workflow applies migrations before it deploys the Worker, so merging to `main` applies it. For a deploy by hand, first run `pnpm --filter @ccip-dev/worker exec wrangler d1 migrations apply ccip-dev --remote`.
2. **Live days:** finalize writes the three columns for each day it finalizes. To fill the live days from 2026-10-05 to the deploy, rewind `last_finalize_day` to 2026-10-04, outside 23:55–00:30 and 05:50–06:20 UTC:
   `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "UPDATE meta SET value = '2026-10-04' WHERE key = 'last_finalize_day'"`
   Finalize redoes at most 3 days per 00:10 run, so N days take about N/2 days, as in "Re-finalize a day".
3. **Backfill days:** after the crawl ends, the next fee build rebuilds every sealed day with the new columns, because the pricing hash changed. Upload it as usual (Fee backfill).
4. Until every day carries the columns, the Reserve's fee mix and LINK tiles cover only the days that have them, and say from when.

`history.json` also lists `largest_fees`: the 10 largest single fees of the days it holds.
````

- [ ] **Step 10: Commit.**

```bash
git add packages/core/src/public.ts packages/core/test/public.test.ts worker/src/store.ts worker/src/publish.ts worker/test/publish.test.ts worker/test/finalize.test.ts docs/runbook.md
git commit -m "feat(worker): history.json carries each day's fees by group and the largest single fees"
```

---

### Task 5: Fee backfill build writes the group columns

**Files:**
- Modify: `scripts/backfill/fees/build.ts`
- Modify: `docs/runbook.md` (Fee backfill, Build)
- Test: `scripts/test/fees-build.test.ts`

**Interfaces:**
- Consumes: `FEE_TOKEN_GROUPS`, `feeClassifier`, `feeGroupTotals` and `FeeTokenGroup` (Task 2); `UNLISTED_LINK_FEE_TOKENS` (Task 2); migration 0005 (Task 3), which the existing SQL-on-SQLite test applies.
- Produces:
  - `FEE_BUILD_FORMAT = 1`;
  - `interface FeePricingInputs { aliases: Readonly<Record<string, FeePriceAlias>>; groups: Readonly<Record<string, FeeTokenGroup>>; unlistedLink: Readonly<Record<string, { address: string; decimals: number }>>; format: number }`;
  - `CURRENT_FEE_PRICING: FeePricingInputs`;
  - `feePricingHash(inputs?: FeePricingInputs): string`;
  - `interface UngroupedFeeToken { chain: string; name: string; token: string; messages: number }`, and `FeeBuildResult.ungrouped: UngroupedFeeToken[]`;
  - each day's SQL: `UPDATE daily_totals SET fee_usd = …, fee_link_usd = …, fee_native_usd = …, fee_stable_usd = …, fee_link_amount = … WHERE day = '…';`;
  - the log line `check: <n> fee messages on <token> (<chain name>) have no fee group`, one per token across the batch, and `ungrouped` in `checks/B<NNNN>.json`.
- The hash also covers `UNLISTED_LINK_FEE_TOKENS`. Its decimals now feed `fee_link_amount`, so a change there must rebuild too.

- [ ] **Step 1: Update the existing expectations** in `scripts/test/fees-build.test.ts`.
  - Change the import `import { FEE_PRICE_ALIASES, type PricesClient } from '@ccip-dev/core';` to `import type { PricesClient } from '@ccip-dev/core';`.
  - Change the build import to `import { buildFees, CURRENT_FEE_PRICING, FEE_BUILD_FORMAT, feePricingHash, flagFeeOutliers } from '../backfill/fees/build';`.
  - In "writes the day's fee total and LINK-paid fees", expect `UPDATE daily_totals SET fee_usd = 3, fee_link_usd = 1, fee_native_usd = 2, fee_stable_usd = 0, fee_link_amount = 0.1 WHERE day = '${DAY}';`.
  - In "writes NULL fee aggregates for a day whose details were all skipped", expect `UPDATE daily_totals SET fee_usd = NULL, fee_link_usd = NULL, fee_native_usd = NULL, fee_stable_usd = NULL, fee_link_amount = NULL WHERE day = '${DAY}';`.
  - In "still counts a message with an unknown fee shape in the day rollup, with no fee", expect `UPDATE daily_totals SET fee_usd = 1, fee_link_usd = 1, fee_native_usd = 0, fee_stable_usd = 0, fee_link_amount = 0.1 WHERE day = '${DAY}';`.
  - In "stores the hash of the fee price table it priced with", expect `state.pricing` to be `feePricingHash()`.
  - In "logs why it rebuilds every day", expect the line `the fee price table, fee groups or build format changed since the last build; building every sealed day again`.
  - Replace the whole `describe('feePricingHash', …)` block with:

```ts
describe('feePricingHash', () => {
  const aliases = { '1:0xa': { key: 'coingecko:a', decimals: 18 }, '2:0xb': { key: 'coingecko:b', decimals: 8 } };
  const base = { ...CURRENT_FEE_PRICING, aliases };

  it('changes when an alias changes', () => {
    expect(feePricingHash({ ...base, aliases: { ...aliases, '2:0xb': { key: 'coingecko:b', decimals: 18 } } })).not.toBe(feePricingHash(base));
  });

  it('does not depend on the order of the entries', () => {
    expect(feePricingHash({ ...base, aliases: { '2:0xb': { decimals: 8, key: 'coingecko:b' }, '1:0xa': { key: 'coingecko:a', decimals: 18 } } })).toBe(feePricingHash(base));
  });

  it('changes when a fee token changes group', () => {
    // #given the Base WETH entry moved to stable
    const groups = { ...CURRENT_FEE_PRICING.groups, '15971525489660198786:0x4200000000000000000000000000000000000006': { group: 'stable' as const, symbol: 'WETH' } };
    // #when, #then
    expect(feePricingHash({ ...base, groups })).not.toBe(feePricingHash(base));
  });

  it('changes when FEE_BUILD_FORMAT changes', () => {
    expect(feePricingHash({ ...base, format: FEE_BUILD_FORMAT + 1 })).not.toBe(feePricingHash(base));
  });

  it("changes when an unlisted LINK's decimals change", () => {
    // #given
    const unlistedLink = { ...CURRENT_FEE_PRICING.unlistedLink, '4949039107694359620': { address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', decimals: 8 } };
    // #when, #then
    expect(feePricingHash({ ...base, unlistedLink })).not.toBe(feePricingHash(base));
  });
});
```

- [ ] **Step 2: Write the failing new tests.** Add to `describe('buildFees', …)`:

```ts
  it('writes the fees paid in gas tokens and stablecoins, and the LINK paid in LINK units', async () => {
    // #given the Worker's finalize test day: 0.1 LINK worth $1, WETH worth $2 and GHO worth $3
    const GHO = '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee';
    const dir = await backfill({ records: [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', WETH, '1000000000000000'), ok('0xgone', GHO, '3000000000000000000')] });
    const prices = { latest: async () => new Map([[`base:${GHO}`, { price: 1, decimals: 18 }]]), dailyHistory: async () => [[DAY, 1]] } as unknown as PricesClient;
    // #when
    await buildFees({ dir, prices });
    // #then
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = 6, fee_link_usd = 1, fee_native_usd = 2, fee_stable_usd = 3, fee_link_amount = 0.1 WHERE day = '${DAY}';`);
  });
```

And a new block:

```ts
describe('fee tokens with no group', () => {
  const NEW = '0x1111111111111111111111111111111111111111';
  const withNew = [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', NEW, '1000000000000000'), ok('0xgone', NEW, '5')];

  it('logs a check line per fee token with no group, with its message count', async () => {
    // #given
    const dir = await backfill({ records: withNew });
    const lines: string[] = [];
    // #when
    await buildFees({ dir, prices: noPrices, log: (l) => lines.push(l) });
    // #then
    expect(lines).toContain(`check: 2 fee messages on ${NEW} (ethereum-mainnet-base-1) have no fee group`);
  });

  it('returns and saves the ungrouped fee tokens of the batch', async () => {
    // #given
    const dir = await backfill({ records: withNew });
    // #when
    const result = await buildFees({ dir, prices: noPrices });
    // #then
    const saved = JSON.parse(await readFile(path.join(dir, 'fees', 'checks', 'B0001.json'), 'utf8')) as { ungrouped: unknown };
    const expected = [{ chain: BASE, name: 'ethereum-mainnet-base-1', token: NEW, messages: 2 }];
    expect({ result: result.ungrouped, saved: saved.ungrouped }).toEqual({ result: expected, saved: expected });
  });

  it('logs nothing when every fee token has a group', async () => {
    // #given
    const dir = await backfill({ records });
    const lines: string[] = [];
    // #when
    await buildFees({ dir, prices: noPrices, log: (l) => lines.push(l) });
    // #then
    expect(lines.filter((l) => l.includes('no fee group'))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail.** Run `pnpm exec vitest run scripts/test/fees-build.test.ts`. Expected: FAIL, because `CURRENT_FEE_PRICING` and `FEE_BUILD_FORMAT` are not exported and the SQL lacks the group columns.

- [ ] **Step 4: Implement** in `scripts/backfill/fees/build.ts`.
  - Replace the `@ccip-dev/core` import with:

```ts
import {
  buildRows, createCoingeckoClient, createPricesClient, FEE_PRICE_ALIASES, FEE_TOKEN_GROUPS, feeClassifier, feeGroupTotals, feePriceKeys, linkFeeKeys, ListMessage,
  normalizeList, normalizeRegistryToken, rollupDay, sqlLiteral, UNLISTED_LINK_FEE_TOKENS, valueFee, type FeePriceAlias, type FeeTokenGroup, type HttpDeps,
  type NormalizedMessage, type PricesClient, type RegistryToken,
} from '@ccip-dev/core';
```

  - Add `ungrouped: UngroupedFeeToken[];` to `FeeBuildResult`, and add this interface above it:

```ts
export interface UngroupedFeeToken {
  chain: string;
  name: string;
  token: string;
  messages: number;
}
```

  - Replace `feePricingHash` and its doc comment with:

```ts
/** Bump when the SQL a build writes changes, so the next build rewrites every sealed day. */
export const FEE_BUILD_FORMAT = 1;

export interface FeePricingInputs {
  aliases: Readonly<Record<string, FeePriceAlias>>;
  groups: Readonly<Record<string, FeeTokenGroup>>;
  unlistedLink: Readonly<Record<string, { address: string; decimals: number }>>;
  format: number;
}

export const CURRENT_FEE_PRICING: FeePricingInputs = {
  aliases: FEE_PRICE_ALIASES,
  groups: FEE_TOKEN_GROUPS,
  unlistedLink: UNLISTED_LINK_FEE_TOKENS,
  format: FEE_BUILD_FORMAT,
};

const sortedEntries = <T>(table: Readonly<Record<string, T>>) => Object.keys(table).sort().map((k) => [k, table[k]!] as const);

/** Prices, groups and LINK decimals apply to every day, so a change to any of them, or to the SQL format, makes every built day stale. */
export function feePricingHash(inputs: FeePricingInputs = CURRENT_FEE_PRICING): string {
  const canonical = {
    aliases: sortedEntries(inputs.aliases).map(([k, a]) => [k, a.key, a.decimals]),
    groups: sortedEntries(inputs.groups).map(([k, g]) => [k, g.group, g.symbol]),
    unlistedLink: sortedEntries(inputs.unlistedLink).map(([k, t]) => [k, t.address.toLowerCase(), t.decimals]),
    format: inputs.format,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
```

  - In `buildFees`:
    - Set `const pricing = feePricingHash();`.
    - Add `ungrouped: []` to the `result` literal.
    - Change the rebuild log to `'the fee price table, fee groups or build format changed since the last build; building every sealed day again'`.
    - Replace `const isLinkFee = linkFeeMatcher(linkFeeKeys(registry.map(normalizeRegistryToken)));` with:

```ts
  const classify = feeClassifier(linkFeeKeys(registry.map(normalizeRegistryToken)));
  const ungrouped = new Map<string, UngroupedFeeToken>();
```

    - In the per-day loop, after `const archived = …`, add `const chainNames = new Map(archived.map((m) => [m.src.selector, m.src.name]));`.
    - Replace the `daily_totals` statement with:

```ts
    const groups = feeGroupTotals(rows, day, classify);
    statements.push(
      `UPDATE daily_totals SET fee_usd = ${sqlLiteral(totals.fee_usd)}, fee_link_usd = ${sqlLiteral(groups.link_usd)}, ` +
        `fee_native_usd = ${sqlLiteral(groups.native_usd)}, fee_stable_usd = ${sqlLiteral(groups.stable_usd)}, ` +
        `fee_link_amount = ${sqlLiteral(groups.link_amount)} WHERE day = ${sqlLiteral(day)};`,
    );
```

    - After `const withFee = rows.filter((r) => r.fee_token !== null);`, add:

```ts
    for (const r of withFee) {
      if (classify(r.src_chain, r.fee_token!).group !== 'other') continue;
      const key = `${r.src_chain}:${r.fee_token}`;
      const entry = ungrouped.get(key) ?? { chain: r.src_chain, name: chainNames.get(r.src_chain) ?? r.src_chain, token: r.fee_token!, messages: 0 };
      entry.messages += 1;
      ungrouped.set(key, entry);
    }
```

    - After the loop, next to `result.unknownShapeDays = …`, add `result.ungrouped = [...ungrouped.values()].sort((a, b) => b.messages - a.messages || (a.token < b.token ? -1 : 1));`.
    - Add `ungrouped: result.ungrouped` to the object written to `checks/${batch}.json`.
    - After the unknown-shape log loop, add `for (const u of result.ungrouped) log(\`check: ${u.messages} fee messages on ${u.token} (${u.name}) have no fee group\`);`.

  Run `rg -n "linkFeeUsd|linkFeeMatcher|isLinkFee" scripts/backfill/fees/build.ts`. Expected: no matches.

- [ ] **Step 5: Run the tests and typecheck.** Run `pnpm exec vitest run scripts/test && pnpm typecheck`. Expected: all pass. The test "fills the fee of a row an earlier batch filled without a price" runs the new SQL on SQLite with every migration, 0005 included.

- [ ] **Step 6: Update the runbook** in `docs/runbook.md`, under "## Fee backfill", step 3 (Build).
  - Replace the bullet that starts with `- **Fee price table:**` with:

```markdown
   - **Fee price table, fee groups and build format:** the next build rebuilds every sealed day into one new batch after a change to any of:
     - `FEE_PRICE_ALIASES` (`packages/core/src/fee-aliases.ts`);
     - `FEE_TOKEN_GROUPS` (`packages/core/src/fee-groups.ts` and the generated `fee-groups-docs.ts`);
     - the decimals in `UNLISTED_LINK_FEE_TOKENS`;
     - `FEE_BUILD_FORMAT` (`scripts/backfill/fees/build.ts`).

     It logs `the fee price table, fee groups or build format changed since the last build; building every sealed day again`. That is expected, and its upload is safe: it fills the fees still NULL, leaves priced fees alone and recomputes the rollups. The build also asks CoinGecko's free public API for the daily history of a coin DefiLlama has none for (today MOVA, once), and that API can rate-limit (HTTP 429): rerun the build if it stops on one.
   - **Fee groups in the SQL:** each day's `daily_totals` UPDATE also writes `fee_native_usd`, `fee_stable_usd` and `fee_link_amount`. Upload such a batch only once migration 0005 is on the remote database (Fee groups, Rollout).
```

  - Under **Checks**, after the unknown-fee-shape bullet, add:

```markdown
     - `check: <n> fee messages on <token> (<chain>) have no fee group`: across the batch, a fee token in neither `FEE_TOKEN_GROUPS` nor the LINK set. Its fees count as other. Expected:
       - Everclear `0x2e31…835f` and Mind `0x3902…2d0b` (both chains are shut down);
       - Base zunETH `0x24cb…91de`;
       - Botanix `0x0d24…0c56`, Corn `0xda5d…dfb2` and Memento `0x0869…d7bd` (no reachable RPC to check them);
       - zero-amount fee tokens on Pharos, Tempo and TON.

       Check any other token as in "Fee groups, Regenerate the table", step 3.
```

- [ ] **Step 7: Commit.**

```bash
git add scripts/backfill/fees/build.ts scripts/test/fees-build.test.ts docs/runbook.md
git commit -m "feat(scripts): fee build writes each day's fees by group and checks for fee tokens with no group"
```

---

### Task 6: Home hero: all-time fees and run-rate

**Files:**
- Create: `site/src/lib/fee-revenue.ts`
- Modify: `site/src/lib/records.ts` (export `FEE_DATA_START`)
- Modify: `site/src/components/home/Headline.tsx`, `site/src/components/home/HomeLive.tsx`, `site/src/pages/index.astro`
- Modify: `docs/methodology.md` (Fees: all-time and run-rate)
- Test: `site/test/fee-revenue.test.ts` (new), `site/test/headline.test.ts`

**Interfaces:**
- Consumes: `feesSince` (`site/src/lib/records.ts`); the optional day fields (Task 4) are not needed here.
- Produces:
  - in `records.ts`: `FEE_DATA_START = '2023-07-06'`;
  - in `fee-revenue.ts`:
    - `RUN_RATE_DAYS = 30`;
    - `interface FeeHistoryTotals { usd: number; through: string; since: string; runRateUsd: number | null }`;
    - `feeHistoryTotals(days: readonly { day: string; fee_usd: number | null }[]): FeeHistoryTotals | null`;
    - `interface HeroFees { usd: number; runRateUsd: number | null; since: string | null }`;
    - `heroFees(totals: FeeHistoryTotals | null, live: readonly ({ day: string; fee_usd: number | null } | null)[]): HeroFees | null`;
  - `Headline` gains the prop `allTime?: HeroFees | null`;
  - `HomeLive` gains the prop `feeTotals: FeeHistoryTotals | null`.
- **Copy:** "All-time fees: $X · $Y/yr at the 30-day pace →". While coverage starts after 2023-07-06, "All-time fees" becomes "Fees since Oct 5, 2026". The run-rate part is left out when it is null.

- [ ] **Step 1: Write the failing maths tests** in `site/test/fee-revenue.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/days';
import { feeHistoryTotals, heroFees } from '../src/lib/fee-revenue';

const run = (from: string, fees: (number | null)[]) => fees.map((fee_usd, i) => ({ day: addDays(from, i), fee_usd }));
const THIRTY = run('2026-09-01', Array(30).fill(100));

describe('feeHistoryTotals', () => {
  it('adds up every day with fees and annualizes the last 30 days', () => {
    expect(feeHistoryTotals(THIRTY)).toEqual({ usd: 3000, through: '2026-09-30', since: '2026-09-01', runRateUsd: 36500 });
  });

  it('has no run-rate while one of the last 30 days has no fees', () => {
    // #given 30 days whose first has no fee data
    const days = run('2026-08-31', [null, ...Array(29).fill(100)]);
    // #when, #then
    expect(feeHistoryTotals(days)?.runRateUsd).toBeNull();
  });

  it('has no run-rate with fewer than 30 days of history', () => {
    expect(feeHistoryTotals(THIRTY.slice(1))?.runRateUsd).toBeNull();
  });

  it('is null without fee data', () => {
    expect(feeHistoryTotals(run('2026-09-01', [null, null]))).toBeNull();
  });
});

describe('heroFees', () => {
  const totals = feeHistoryTotals(THIRTY);

  it("adds today's live fees to history", () => {
    expect(heroFees(totals, [null, { day: '2026-10-01', fee_usd: 40 }])?.usd).toBe(3040);
  });

  it("adds yesterday's fees when history.json does not hold that day yet", () => {
    // #given the page saw midnight pass before the next site build
    const live = [{ day: '2026-10-01', fee_usd: 250 }, { day: '2026-10-02', fee_usd: 40 }];
    // #when, #then
    expect(heroFees(totals, live)?.usd).toBe(3290);
  });

  it('never counts a day history.json already holds', () => {
    expect(heroFees(totals, [{ day: '2026-09-30', fee_usd: 100 }, { day: '2026-10-01', fee_usd: 40 }])?.usd).toBe(3040);
  });

  it('names the first fee day while it is after 2023-07-06', () => {
    expect(heroFees(totals, [])?.since).toBe('2026-09-01');
  });

  it('drops the first fee day once fees reach back to 2023-07-06', () => {
    expect(heroFees(feeHistoryTotals(run('2023-07-06', [1, 2])), [])?.since).toBeNull();
  });

  it('is null without fee history', () => {
    expect(heroFees(null, [{ day: '2026-10-01', fee_usd: 40 }])).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing render tests.** Add to `site/test/headline.test.ts`, with `import type { HeroFees } from '../src/lib/fee-revenue';` at the top:

```ts
describe('Headline all-time fees', () => {
  const allTime = (over: Partial<HeroFees> = {}): HeroFees => ({ usd: 2_345_678, runRateUsd: 1_234_567, since: null, ...over });
  const yesterday = { messages: 2795, usd_value: 58.6e6, fee_usd: 1538.19 };

  it('adds the all-time fees and the 30-day run-rate under the yesterday line', () => {
    // #given
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: allTime() });
    // #then
    expect(text(html)).toMatch(/Yesterday: .*All-time fees: \$2\.3M · \$1\.2M\/yr at the 30-day pace →/);
  });

  it('links the line to the fee records', () => {
    // #given
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: allTime() });
    // #then
    expect(html).toMatch(/<a[^>]*href="\/records\/#fees"[^>]*>All-time fees/);
  });

  it('reads "since" the first fee day while fee coverage starts after 2023-07-06', () => {
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: allTime({ since: '2026-10-05' }) });
    expect(text(html)).toContain('Fees since Oct 5, 2026: $2.3M');
  });

  it('leaves the run-rate out while fewer than 30 days have fees', () => {
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: allTime({ runRateUsd: null }) });
    expect(text(html)).toMatch(/All-time fees: \$2\.3M →(?!.*\/yr)/);
  });

  it('shows no all-time line without fee history', () => {
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: null });
    expect(text(html)).not.toContain('All-time');
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail.** Run `pnpm --filter @ccip-dev/site exec vitest run test/fee-revenue.test.ts test/headline.test.ts`. Expected: FAIL. `../src/lib/fee-revenue` is not found, and Headline renders no all-time line.

- [ ] **Step 4: Implement the maths.**
  - In `site/src/lib/records.ts`, after the `RecordBreak` interface, add:

```ts
/** The first CCIP mainnet message's day; fee figures name their first day until fee data reaches back to it. */
export const FEE_DATA_START = '2023-07-06';
```

  - Create `site/src/lib/fee-revenue.ts`:

```ts
import { FEE_DATA_START, feesSince } from './records';

export const RUN_RATE_DAYS = 30;

type FeeDay = { day: string; fee_usd: number | null };

export interface FeeHistoryTotals {
  usd: number;
  through: string;
  since: string;
  runRateUsd: number | null;
}

export interface HeroFees {
  usd: number;
  runRateUsd: number | null;
  since: string | null;
}

export function feeHistoryTotals(days: readonly FeeDay[]): FeeHistoryTotals | null {
  const since = feesSince(days);
  if (since === null) return null;
  const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const window = sorted.slice(-RUN_RATE_DAYS);
  const full = window.length === RUN_RATE_DAYS && window.every((d) => d.fee_usd !== null);
  return {
    usd: sorted.reduce((sum, d) => sum + (d.fee_usd ?? 0), 0),
    through: sorted.at(-1)!.day,
    since,
    runRateUsd: full ? (window.reduce((sum, d) => sum + d.fee_usd!, 0) * 365) / RUN_RATE_DAYS : null,
  };
}

/** Adds the live days history.json does not hold yet: today, and yesterday between midnight and the next site build. */
export function heroFees(totals: FeeHistoryTotals | null, live: readonly (FeeDay | null)[]): HeroFees | null {
  if (totals === null) return null;
  const extra = live.reduce((sum, d) => sum + (d !== null && d.day > totals.through ? d.fee_usd ?? 0 : 0), 0);
  return { usd: totals.usd + extra, runRateUsd: totals.runRateUsd, since: totals.since > FEE_DATA_START ? totals.since : null };
}
```

- [ ] **Step 5: Render the line.** Replace `site/src/components/home/Headline.tsx` with:

```tsx
import type { TodayFile } from '@ccip-dev/core/public';
import type { HeroFees } from '../../lib/fee-revenue';
import { formatCount, formatUsd, formatUtcDay } from '../../lib/format';
import { useCountUp } from '../hooks';
import InfoLink from '../InfoLink';

export default function Headline({
  today,
  yesterday,
  animate,
  allTime = null,
}: {
  today: TodayFile;
  yesterday: { messages: number; usd_value: number; fee_usd: number | null } | null;
  animate: boolean | null;
  allTime?: HeroFees | null;
}) {
  const messages = useCountUp(today.totals.messages, animate);
  const usd = useCountUp(today.totals.usd_value, animate);
  const fees = useCountUp(today.totals.fee_usd ?? 0, animate);
  return (
    <div className="headline card">
      <span className="label">
        Today so far · UTC
        <InfoLink metric="messages" label="messages" />
      </span>
      <p className="headline-number mono">{formatCount(messages)}</p>
      <p className="headline-sub">
        messages · <span className="mono">{formatUsd(usd)}</span> moved
        <InfoLink metric="value" label="value transferred" />
        {today.totals.fee_usd !== null && (
          <>
            {' · '}
            <a className="headline-fees" href="/reserve/" title="Fees paid to Chainlink, the revenue behind the Chainlink Reserve">
              <span className="mono">{formatUsd(fees)}</span> fees
            </a>
          </>
        )}
      </p>
      {yesterday && (
        <p className="muted small">
          Yesterday: {formatCount(yesterday.messages)} messages · {formatUsd(yesterday.usd_value)}
          {yesterday.fee_usd !== null && ` · ${formatUsd(yesterday.fee_usd)} fees`}
        </p>
      )}
      {allTime && (
        <p className="muted small">
          <a className="headline-fees" href="/records/#fees">
            {allTime.since ? `Fees since ${formatUtcDay(allTime.since)}` : 'All-time fees'}: <span className="mono">{formatUsd(allTime.usd)}</span>
            {allTime.runRateUsd !== null && (
              <>
                {' · '}
                <span className="mono">{formatUsd(allTime.runRateUsd)}</span>/yr at the 30-day pace
              </>
            )}{' '}
            <span aria-hidden="true">→</span>
          </a>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire it.**
  - In `site/src/components/home/HomeLive.tsx`:
    - Add `import { heroFees, type FeeHistoryTotals } from '../../lib/fee-revenue';`.
    - Add `feeTotals: FeeHistoryTotals | null;` to `HomeLiveProps`.
    - After `const yesterday = …`, add `const allTime = heroFees(props.feeTotals, [yesterday, { day: today.day, fee_usd: today.totals.fee_usd }]);`.
    - Render `<Headline today={today} yesterday={yesterday} animate={motion === null ? null : !motion} allTime={allTime} />`.
  - In `site/src/pages/index.astro`:
    - Add `import { feeHistoryTotals } from '../lib/fee-revenue';`.
    - Add the prop `feeTotals={feeHistoryTotals(history.days)}` to `<HomeLive …>`.

  The home page already reads `history.json` at build time for the sky, and the hero already polls `today.json`, so this adds no request.

- [ ] **Step 7: Run the tests, typecheck and build.** Run `pnpm --filter @ccip-dev/site test && pnpm typecheck && pnpm --filter @ccip-dev/site build`. Expected: all pass, with `index.html` under the 150 KB budget.

- [ ] **Step 8: Check it in a browser.** Follow "Local preview with the new fields" for `/`. Expected:
  - At 1440 and at 390, the hero shows the all-time line under "Yesterday", reading "Fees since …: $… · $…/yr at the 30-day pace →" (or "All-time fees: …" once coverage reaches 2023-07-06), and it wraps inside the card.
  - At 390 there is no horizontal scroll.
  - Lighthouse mobile accessibility on `/` is ≥ 95.

- [ ] **Step 9: Document the maths.** In `docs/methodology.md`, after the `- **LINK paid:**` bullet (Task 2), insert:

```markdown
- **All-time fees** (home page): every day in history plus today so far, from the first day with fees. Until fee data
  reaches back to 2023-07-06, the line reads "Fees since <day>" instead of "All-time fees".
- **Run-rate:** the fees of the last 30 complete days × 365 / 30. It is shown once all 30 of those days have fees.
```

- [ ] **Step 10: Commit.**

```bash
git add site/src/lib/fee-revenue.ts site/src/lib/records.ts site/src/components/home/Headline.tsx site/src/components/home/HomeLive.tsx site/src/pages/index.astro site/test/fee-revenue.test.ts site/test/headline.test.ts docs/methodology.md
git commit -m "feat(site): all-time fees and the 30-day run-rate in the home hero"
```

---

### Task 7: Records: fee records and fee milestones

**Files:**
- Modify: `site/src/lib/records.ts`
- Modify: `site/src/pages/records.astro`
- Modify: `site/src/styles/base.css` (`wrap-labels`)
- Test: `site/test/records.test.ts`

**Interfaces:**
- Consumes:
  - `LargestFee` and the optional `HistoryFile.largest_fees` (Task 4);
  - `FEE_DATA_START` (Task 6);
  - `laneLabel` and `ChainNames` (`names.ts`);
  - `formatLink` and `linkShareText` (`format.ts`).
- Produces in `records.ts`:
  - `LINK_SHARE_MIN_MESSAGES = 100` and `EXPLORER_MESSAGE_URL = 'https://ccip.chain.link/msg/'`;
  - `type FeeDayStats = DayStats & Pick<DayTotals, 'fee_link_usd' | 'fee_link_amount'>`;
  - `type FeeRecordKey = 'most_fees' | 'largest_fee' | 'link_paid' | 'link_share'`, and `interface FeeRecord { key: FeeRecordKey; title: string; day: string; display: string; sub: string | null; explorerUrl: string | null }`;
  - `computeFeeRecords(days: readonly FeeDayStats[], largest: readonly LargestFee[], names: ChainNames): FeeRecord[]`;
  - `feeThresholds(max: number, from: number): number[]`;
  - `sortMilestones(list: readonly Milestone[]): Milestone[]`;
  - `computeFeeMilestones(days: readonly Pick<DayStats, 'day' | 'fee_usd'>[]): Milestone[]`;
  - `MilestoneKind` gains `'fees'` and `'fee_day'`.

  `formatThresholdUsd` now also formats K and M. `computeRecords`, `computeMilestones` and their outputs are unchanged, so day-page highlights and the replay keep working as before.
- **Decisions:**
  - The Records page shows "Most fees in a day" in the new Fees section, so its general tiles drop the old "Highest fees" tile. Day-page highlights keep "Highest fees ever".
  - Fee milestones appear only once fee data starts at 2023-07-06. With partial coverage, "first reaching" dates would be wrong and would move as the backfill loads.

- [ ] **Step 1: Write the failing tests.** Add to the import in `site/test/records.test.ts`: `computeFeeMilestones`, `computeFeeRecords`, `feeThresholds` and `type FeeDayStats`. Then add:

```ts
describe('fee records', () => {
  const names = new Map([['15971525489660198786', 'Base'], ['5009297550715157269', 'Ethereum']]);
  const fee = (d: string, messages: number, usd: number | null, link: number | null, amount: number | null = null): FeeDayStats => ({
    ...day(d, messages, 0, 1, usd, null), fee_link_usd: link, fee_link_amount: amount,
  });
  const DAYS_F = [fee('2026-10-05', 150, 1000, 300, 25), fee('2026-10-06', 99, 50, 45, 3), fee('2026-10-07', 400, 2500, 500, 41.5)];
  const largest = [{ message_id: '0xabc', day: '2026-10-06', src: '15971525489660198786', dst: '5009297550715157269', fee_usd: 812.4, symbol: 'WETH' }];

  it('finds the four fee records', () => {
    expect(computeFeeRecords(DAYS_F, largest, names)).toEqual([
      { key: 'most_fees', title: 'Most fees in a day', day: '2026-10-07', display: '$2.5K', sub: null, explorerUrl: null },
      { key: 'largest_fee', title: 'Largest single fee', day: '2026-10-06', display: '$812', sub: 'Base → Ethereum · WETH', explorerUrl: 'https://ccip.chain.link/msg/0xabc' },
      { key: 'link_paid', title: 'Most paid in LINK in a day', day: '2026-10-07', display: '$500', sub: '42 LINK', explorerUrl: null },
      { key: 'link_share', title: 'Highest LINK share in a day', day: '2026-10-05', display: '30% paid in LINK', sub: 'days with 100+ messages', explorerUrl: null },
    ]);
  });

  it('counts a day for the LINK share from exactly 100 messages', () => {
    // #given the 90% day at 100 messages instead of 99
    const days = [DAYS_F[0]!, fee('2026-10-06', 100, 50, 45, 3), DAYS_F[2]!];
    // #when, #then
    expect(computeFeeRecords(days, largest, names).find((r) => r.key === 'link_share')?.day).toBe('2026-10-06');
  });

  it('leaves the largest fee out when history.json has no largest_fees', () => {
    expect(computeFeeRecords(DAYS_F, [], names).map((r) => r.key)).toEqual(['most_fees', 'link_paid', 'link_share']);
  });

  it('leaves the LINK records out while no day has LINK data', () => {
    expect(computeFeeRecords([fee('2026-10-05', 150, 1000, null)], [], names).map((r) => r.key)).toEqual(['most_fees']);
  });

  it('notes the first fee day on the most-fees record while coverage is partial', () => {
    // #given a day before fees began
    const days = [fee('2026-10-04', 150, null, null), ...DAYS_F];
    // #when, #then
    expect(computeFeeRecords(days, [], names)[0]?.sub).toBe('since 2026-10-05');
  });
});

describe('fee milestones', () => {
  const feeDay = (d: string, usd: number | null) => ({ day: d, fee_usd: usd });

  it('steps fee thresholds by 1, 2.5 and 5 from where they start, up to the total', () => {
    expect([feeThresholds(12e6, 1e6), feeThresholds(60e3, 1e4)]).toEqual([[1e6, 2.5e6, 5e6, 1e7], [1e4, 2.5e4, 5e4]]);
  });

  it('formats thresholds in K, M, B and T', () => {
    expect([1e4, 2.5e4, 1e6, 2.5e6, 1e9].map(formatThresholdUsd)).toEqual(['$10K', '$25K', '$1M', '$2.5M', '$1B']);
  });

  it('dates each all-time fee total by the first day the running total reaches it', () => {
    // #given fees from 2023-07-06 that pass $1M on the third day
    const days = [feeDay('2023-07-06', 400e3), feeDay('2023-07-07', 500e3), feeDay('2023-07-08', 200e3)];
    // #when, #then
    expect(computeFeeMilestones(days).filter((m) => m.kind === 'fees')).toEqual([{ kind: 'fees', day: '2023-07-08', label: '$1M in fees', threshold: 1e6 }]);
  });

  it('dates each fee-day threshold by the first day over it', () => {
    // #given
    const days = [feeDay('2023-07-06', 8e3), feeDay('2023-07-07', 12e3), feeDay('2023-07-08', 30e3), feeDay('2023-07-09', 11e3)];
    // #when
    const firsts = computeFeeMilestones(days).filter((m) => m.kind === 'fee_day').map((m) => [m.day, m.label]);
    // #then
    expect(firsts).toEqual([['2023-07-07', 'First $10K fee day'], ['2023-07-08', 'First $25K fee day']]);
  });

  it('lists no fee milestones while fee coverage starts after 2023-07-06', () => {
    expect(computeFeeMilestones([feeDay('2026-10-05', 2e6), feeDay('2026-10-06', 50e3)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter @ccip-dev/site exec vitest run test/records.test.ts`. Expected: FAIL, because `computeFeeRecords`, `computeFeeMilestones` and `feeThresholds` are not exported.

- [ ] **Step 3: Implement** in `site/src/lib/records.ts`.
  - Change the imports to:

```ts
import type { DayTotals, LargestFee } from '@ccip-dev/core/public';
import { formatCount, formatDuration, formatLink, formatUsd, linkShareText } from './format';
import { laneLabel, shortChainName, type ChainNames } from './names';
```

  - Change `MilestoneKind` to `'messages' | 'value' | 'fees' | 'fee_day' | 'chains' | 'join'`, and `KIND_ORDER` to `['messages', 'value', 'fees', 'fee_day', 'chains', 'join']`.
  - After `FEE_DATA_START` (Task 6), add:

```ts
export const LINK_SHARE_MIN_MESSAGES = 100;
export const EXPLORER_MESSAGE_URL = 'https://ccip.chain.link/msg/';

export type FeeDayStats = DayStats & Pick<DayTotals, 'fee_link_usd' | 'fee_link_amount'>;
export type FeeRecordKey = 'most_fees' | 'largest_fee' | 'link_paid' | 'link_share';

export interface FeeRecord {
  key: FeeRecordKey;
  title: string;
  day: string;
  display: string;
  sub: string | null;
  explorerUrl: string | null;
}
```

  - Above `computeRecords`, add the shared best-day helper, and rewrite `computeRecords` to use it:

```ts
/** The best day by `pick`, ties going to the earliest; `sorted` is in day order. */
function bestDay<T extends { day: string }>(
  sorted: readonly T[],
  pick: (d: T) => number | null | undefined,
  better: (a: number, b: number) => boolean = (a, b) => a > b,
): { day: string; value: number } | null {
  let best: { day: string; value: number } | null = null;
  for (const d of sorted) {
    const value = pick(d);
    if (value === null || value === undefined) continue;
    if (best === null || better(value, best.value)) best = { day: d.day, value };
  }
  return best;
}

export function computeRecords(days: readonly DayStats[]): DayRecord[] {
  const sorted = [...days].sort(compareDay);
  return RULES.flatMap((rule) => {
    const best = bestDay(sorted, rule.pick, rule.better);
    return best
      ? [{ key: rule.key, title: rule.title, day: best.day, value: best.value, display: rule.display(best.value), note: rule.key === 'fees' ? feesNote(sorted, feesSince(sorted)) : rule.note }]
      : [];
  });
}

export function computeFeeRecords(days: readonly FeeDayStats[], largest: readonly LargestFee[], names: ChainNames): FeeRecord[] {
  const sorted = [...days].sort(compareDay);
  const out: FeeRecord[] = [];
  const most = bestDay(sorted, (d) => d.fee_usd);
  if (most) out.push({ key: 'most_fees', title: 'Most fees in a day', day: most.day, display: formatUsd(most.value), sub: feesNote(sorted, feesSince(sorted)), explorerUrl: null });
  const top = largest[0];
  if (top) {
    out.push({
      key: 'largest_fee',
      title: 'Largest single fee',
      day: top.day,
      display: formatUsd(top.fee_usd),
      sub: `${laneLabel(names, `${top.src}>${top.dst}`)}${top.symbol ? ` · ${top.symbol}` : ''}`,
      explorerUrl: `${EXPLORER_MESSAGE_URL}${top.message_id}`,
    });
  }
  const link = bestDay(sorted, (d) => d.fee_link_usd);
  if (link) {
    const amount = sorted.find((d) => d.day === link.day)?.fee_link_amount;
    out.push({ key: 'link_paid', title: 'Most paid in LINK in a day', day: link.day, display: formatUsd(link.value), sub: amount == null ? null : formatLink(amount), explorerUrl: null });
  }
  const share = bestDay(sorted, (d) => (d.messages >= LINK_SHARE_MIN_MESSAGES && d.fee_usd && d.fee_link_usd !== null ? (d.fee_link_usd / d.fee_usd) * 100 : null));
  if (share) {
    out.push({ key: 'link_share', title: 'Highest LINK share in a day', day: share.day, display: linkShareText(share.value), sub: `days with ${LINK_SHARE_MIN_MESSAGES}+ messages`, explorerUrl: null });
  }
  return out;
}
```

  - Replace `valueThresholds` and `formatThresholdUsd` with:

```ts
function steppedThresholds(max: number, from: number): number[] {
  const out: number[] = [];
  for (let power = from; power <= max; power *= 10) for (const m of [1, 2.5, 5]) if (m * power <= max) out.push(m * power);
  return out;
}

export function valueThresholds(max: number): number[] {
  return steppedThresholds(max, 1e9);
}

/** All-time fee totals step from $1M (from = 1e6), a day's fees from $10K (from = 1e4). */
export function feeThresholds(max: number, from: number): number[] {
  return steppedThresholds(max, from);
}

export function formatThresholdUsd(value: number): string {
  const [size, suffix] = value >= 1e12 ? [1e12, 'T'] : value >= 1e9 ? [1e9, 'B'] : value >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const n = value / size;
  return `$${Number.isInteger(n) ? n : n.toFixed(1)}${suffix}`;
}
```

  - Replace `computeMilestones` with this version, built on two shared helpers, and add `computeFeeMilestones` after it:

```ts
function runningMilestones<T extends { day: string }>(
  sorted: readonly T[],
  thresholds: readonly number[],
  pick: (d: T) => number,
  kind: MilestoneKind,
  label: (t: number) => string,
): Milestone[] {
  const out: Milestone[] = [];
  let running = 0;
  let next = 0;
  for (const d of sorted) {
    running += pick(d);
    while (next < thresholds.length && running >= thresholds[next]!) {
      out.push({ kind, day: d.day, label: label(thresholds[next]!), threshold: thresholds[next]! });
      next += 1;
    }
  }
  return out;
}

export function sortMilestones(list: readonly Milestone[]): Milestone[] {
  return [...list].sort(
    (a, b) => compareDay(a, b) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.threshold ?? 0) - (b.threshold ?? 0),
  );
}

export function computeMilestones(
  days: readonly MilestoneDay[],
  chains: readonly { selector: string; name: string | null; display_name: string | null; first_day: string }[],
): Milestone[] {
  const sorted = [...days].sort(compareDay);
  const total = (pick: (d: MilestoneDay) => number) => sorted.reduce((sum, d) => sum + pick(d), 0);
  const out: Milestone[] = [
    ...runningMilestones(sorted, messageThresholds(total((d) => d.messages)), (d) => d.messages, 'messages', (t) => `${formatCount(t)} messages`),
    ...runningMilestones(sorted, valueThresholds(total((d) => d.usd_value)), (d) => d.usd_value, 'value', (t) => `${formatThresholdUsd(t)} moved`),
  ];
  const joined = [...chains].sort((a, b) => (a.first_day < b.first_day ? -1 : a.first_day > b.first_day ? 1 : 0));
  for (let n = CHAIN_STEP; n <= joined.length; n += CHAIN_STEP) {
    out.push({ kind: 'chains', day: joined[n - 1]!.first_day, label: `${n} chains`, threshold: n });
  }
  for (const c of joined) out.push({ kind: 'join', day: c.first_day, label: `${shortChainName(c)} joins`, threshold: null });
  return sortMilestones(out);
}

/** Empty until fee data starts at 2023-07-06: partial coverage would date a "first" too late, and the date would move as the backfill loads. */
export function computeFeeMilestones(days: readonly Pick<DayStats, 'day' | 'fee_usd'>[]): Milestone[] {
  if (feesSince(days) !== FEE_DATA_START) return [];
  const sorted = [...days].sort(compareDay);
  const fee = (d: Pick<DayStats, 'fee_usd'>) => d.fee_usd ?? 0;
  const total = sorted.reduce((sum, d) => sum + fee(d), 0);
  const maxDay = sorted.reduce((max, d) => Math.max(max, fee(d)), 0);
  const firstDays = feeThresholds(maxDay, 1e4).map(
    (t): Milestone => ({ kind: 'fee_day', day: sorted.find((d) => fee(d) >= t)!.day, label: `First ${formatThresholdUsd(t)} fee day`, threshold: t }),
  );
  return sortMilestones([...runningMilestones(sorted, feeThresholds(total, 1e6), fee, 'fees', (t) => `${formatThresholdUsd(t)} in fees`), ...firstDays]);
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @ccip-dev/site exec vitest run test/records.test.ts`. Expected: PASS, including the existing record and milestone tests.

- [ ] **Step 5: Add the label-wrapping class.** In `site/src/styles/base.css`, after the `.tiles { … }` line, add:

```css
.tiles.wrap-labels .label { white-space: normal; }
```

- [ ] **Step 6: Render the page.** Replace `site/src/pages/records.astro` with:

```astro
---
import ShareButton from '../components/ShareButton';
import Base from '../layouts/Base.astro';
import { buildData } from '../lib/build-data';
import { formatUtcDay } from '../lib/format';
import { chainNameMap } from '../lib/names';
import { computeFeeMilestones, computeFeeRecords, computeMilestones, computeRecords, sortMilestones } from '../lib/records';

const [history, replay, chains] = await Promise.all([buildData('history.json'), buildData('replay.json'), buildData('chains.json')]);
const names = chainNameMap([...replay.chains, ...chains.chains]);
const records = computeRecords(history.days).filter((r) => r.key !== 'fees');
const feeRecords = computeFeeRecords(history.days, history.largest_fees ?? [], names);
const milestones = sortMilestones([...computeMilestones(history.days, replay.chains), ...computeFeeMilestones(history.days)])
  .filter((m) => m.kind !== 'join')
  .reverse();
---
<Base title="Records" description="CCIP's all-time records and milestones since 2023-07-06." cardPath="records">
  <div class="page-head">
    <div>
      <p class="label">Since {history.since}</p>
      <h1>Records</h1>
    </div>
    <ShareButton client:load view="records" headline="CCIP all-time records" url="https://ccip.dev/records/" cardUrl="/og/records.png" />
  </div>
  <section class="tiles stagger">
    {records.map((r, i) => (
      <a class="tile lift" style={`--i:${i}`} href={`/day/${r.day}/`}>
        <span class="label">{r.title}</span>
        <p class="value">{r.display}</p>
        <span class="sub">{formatUtcDay(r.day)}{r.note ? ` · ${r.note}` : ''}</span>
      </a>
    ))}
  </section>
  {feeRecords.length > 0 && (
    <>
      <h2 id="fees">Fees</h2>
      <section class="tiles wrap-labels">
        {feeRecords.map((r) =>
          r.explorerUrl ? (
            <div class="tile">
              <span class="label">{r.title}</span>
              <p class="value">{r.display}</p>
              <span class="sub">
                {r.sub ? `${r.sub} · ` : ''}<a href={`/day/${r.day}/`}>{formatUtcDay(r.day)}</a> · <a href={r.explorerUrl} rel="noopener">View on CCIP Explorer</a>
              </span>
            </div>
          ) : (
            <a class="tile lift" href={`/day/${r.day}/`}>
              <span class="label">{r.title}</span>
              <p class="value">{r.display}</p>
              <span class="sub">{formatUtcDay(r.day)}{r.sub ? ` · ${r.sub}` : ''}</span>
            </a>
          ),
        )}
      </section>
    </>
  )}
  <h2>Milestones</h2>
  <ol class="timeline">
    {milestones.map((m) => (
      <li><span class="mono muted">{m.day}</span> <a href={`/day/${m.day}/`}>{m.label}</a></li>
    ))}
  </ol>
</Base>

<style>
  .timeline { list-style: none; margin: 0; padding: 0 0 0 16px; border-left: 2px solid var(--border); display: grid; gap: 10px; }
  .timeline li { position: relative; }
  .timeline li::before { content: ''; position: absolute; left: -22px; top: 8px; width: 10px; height: 10px; background: var(--blue-2); clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); }
</style>
```

- [ ] **Step 7: Run the tests, typecheck and build.** Run `pnpm --filter @ccip-dev/site test && pnpm typecheck && pnpm --filter @ccip-dev/site build`. Expected: all pass.

- [ ] **Step 8: Check it in a browser.** Follow "Local preview with the new fields" for `/records/`. Expected:
  - The Fees section shows four tiles.
  - The largest-fee tile names its route and token, and links both to its day page and to `https://ccip.chain.link/msg/<id>`.
  - At 390, the long labels wrap and there is no horizontal scroll.
  - Lighthouse mobile accessibility on `/records/` is ≥ 95.

  The mirror's history only reaches back as far as the fee backfill has loaded, so the fee milestones are absent there by design.

- [ ] **Step 9: Commit.**

```bash
git add site/src/lib/records.ts site/src/pages/records.astro site/src/styles/base.css site/test/records.test.ts
git commit -m "feat(site): fee records and fee milestones on Records"
```

---

### Task 8: Reserve: LINK demand

**Files:**
- Modify: `packages/core/src/time.ts` (add `weekStart`), `packages/core/src/reserve-stats.ts` (import it), `packages/core/package.json` (exports `./time`), `packages/core/test/reserve-stats.test.ts` (import path)
- Create: `site/src/lib/fee-mix.ts`, `site/src/lib/weekly-chart.ts`, `site/src/components/WeeklyChart.tsx`, `site/src/components/LinkDemandCharts.tsx`
- Modify: `site/src/pages/reserve.astro`, `site/src/styles/history.css`
- Modify: `docs/methodology.md` (Chainlink Reserve: LINK demand)
- Test: `site/test/fee-mix.test.ts`, `site/test/weekly-chart.test.ts`, `site/test/link-demand.test.ts` (all new)

**Interfaces:**
- Consumes:
  - the optional day fields (Task 4);
  - `linkShare`, `pointX`, `nearestIndex`, `stepIndex`, `CHART_W` and `CHART_H` (`charts.ts`);
  - `feesNote` (`records.ts`);
  - `Segmented` (`components/controls/Segmented.tsx`);
  - `ReserveFile['weekly']`.
- Produces:
  - `weekStart(iso: string): string`, from `@ccip-dev/core/time`, and still from `@ccip-dev/core`;
  - in `fee-mix.ts`:
    - `type MixRange = '90d' | '1y' | 'all'`, `MIX_RANGES` and `RANGE_WEEKS`;
    - `interface FeeWeek { week: string; fee_usd: number; mix: { link: number; native: number; stable: number; other: number } | null }`;
    - `interface MixWeek { week: string; link: number; native: number; stable: number; other: number }`;
    - `interface BesideWeek { week: string; fees_usd: number; deposits_usd: number }`;
    - `interface LinkDemandTiles { allTimeLink: number | null; linkSince: string | null; last30Link: number | null; last30Note: string | null; last30SharePct: number | null }`;
    - `weeklyFees(days): FeeWeek[]`, `mixWeeks(weeks): MixWeek[]`, `feesBesideDeposits(weeks, deposits): BesideWeek[]`, `weeksInRange(weeks, range)`, `mixCoverageNote(days, weeks): string | null` and `linkDemandTiles(days): LinkDemandTiles`;
  - in `weekly-chart.ts`: `interface WeeklySeries { key: string; label: string; values: number[] }`, `weeklyPaths(series, stacked, width?, height?, pad?): { key: string; d: string }[]` and `weeklySummary(title, weeks, series, format): string`;
  - `WeeklyChart` (props `title`, `weeks`, `series: ChartSeries[]`, `stacked`, `format`, `children`);
  - `LinkDemandCharts` (props `mix: MixWeek[]`, `beside: BesideWeek[]`, `mixFrom: string | null`), and `DEPOSITS_CAPTION`.

- [ ] **Step 1: Move `weekStart` into core's time module.**
  - In `packages/core/src/time.ts`, append:

```ts
const DAY_MS = 86_400_000;

/** The Monday (UTC) of the week holding `iso`, as YYYY-MM-DD; the Reserve's weekly deposits use the same weeks. */
export function weekStart(iso: string): string {
  const midnight = Date.parse(dayStartIso(dayOf(iso)));
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return dayOf(new Date(midnight - sinceMonday * DAY_MS));
}
```

  - In `packages/core/src/reserve-stats.ts`, delete the `weekStart` function, and change `import { dayOf } from './time';` to `import { dayOf, weekStart } from './time';`.
  - In `packages/core/test/reserve-stats.test.ts`, change the import to `import { reserveStats, type PricedTransfer } from '../src/reserve-stats';`, and add `import { weekStart } from '../src/time';`.
  - In `packages/core/package.json` `exports`, add `"./time": "./src/time.ts"`.
  - Run `pnpm --filter @ccip-dev/core test`. Expected: PASS. The `weekStart` tests run against the moved function.

- [ ] **Step 2: Write the failing data tests** in `site/test/fee-mix.test.ts`.

```ts
import type { DayTotals } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/days';
import { feesBesideDeposits, linkDemandTiles, mixCoverageNote, mixWeeks, weeklyFees, weeksInRange } from '../src/lib/fee-mix';

interface Groups { link: number; native: number; stable: number; amount: number }
const day = (d: string, fee: number | null, groups: Groups | null = null): DayTotals => ({
  day: d, messages: 10, token_messages: 0, usd_value: 0, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0,
  fee_link_usd: groups ? groups.link : null,
  ...(groups ? { fee_native_usd: groups.native, fee_stable_usd: groups.stable, fee_link_amount: groups.amount } : {}),
});
const week = (monday: string, fee: number | null, groups: Groups | null = null) => Array.from({ length: 7 }, (_, i) => day(addDays(monday, i), fee, groups));
const G: Groups = { link: 2, native: 5, stable: 1, amount: 0.5 };

describe('weeklyFees', () => {
  it('sums complete Monday-to-Sunday weeks and leaves a partial week out', () => {
    // #given one full week and the first four days of the next
    const days = [...week('2026-09-28', 10, G), ...week('2026-10-05', 10, G).slice(0, 4)];
    // #when, #then
    expect(weeklyFees(days)).toEqual([{ week: '2026-09-28', fee_usd: 70, mix: { link: 14, native: 35, stable: 7, other: 14 } }]);
  });

  it('leaves out a week with a day that has no fee data', () => {
    const days = week('2026-09-28', 10, G).map((d, i) => (i === 3 ? { ...d, fee_usd: null } : d));
    expect(weeklyFees(days)).toEqual([]);
  });

  it('has no mix for a week whose days lack the fee group columns', () => {
    expect(weeklyFees(week('2026-09-28', 10))[0]?.mix).toBeNull();
  });

  it('never makes other negative when the rounded groups add up to more than the fees', () => {
    // #given $1.00 days whose groups round to $1.01
    const days = week('2026-09-28', 1, { link: 0.34, native: 0.33, stable: 0.34, amount: 0.02 });
    // #when, #then
    expect(weeklyFees(days)[0]?.mix?.other).toBe(0);
  });
});

describe('mixWeeks', () => {
  it('keeps the weeks that have a mix, flattened', () => {
    const weeks = weeklyFees([...week('2026-09-21', 10), ...week('2026-09-28', 10, G)]);
    expect(mixWeeks(weeks)).toEqual([{ week: '2026-09-28', link: 14, native: 35, stable: 7, other: 14 }]);
  });
});

describe('feesBesideDeposits', () => {
  it('pairs weekly fees with the Reserve deposits of the same week, over the weeks both cover', () => {
    // #given fee weeks of 09-21 and 09-28, and deposit weeks of 09-28 and 10-05
    const weeks = weeklyFees([...week('2026-09-21', 10), ...week('2026-09-28', 20)]);
    const deposits = [{ week: '2026-09-28', deposits: 1, link: 1000, usd: 15000 }, { week: '2026-10-05', deposits: 0, link: 0, usd: 0 }];
    // #when, #then
    expect(feesBesideDeposits(weeks, deposits)).toEqual([{ week: '2026-09-28', fees_usd: 140, deposits_usd: 15000 }]);
  });
});

describe('weeksInRange', () => {
  const weeks = Array.from({ length: 60 }, (_, i) => ({ week: addDays('2025-08-04', 7 * i) }));

  it.each([['90d', 13], ['1y', 52], ['all', 60]] as const)('shows %s as the last %i weeks', (range, n) => {
    expect(weeksInRange(weeks, range)).toHaveLength(n);
  });
});

describe('mixCoverageNote', () => {
  it("names the first mix week when the mix starts after history's first full week", () => {
    const days = [...week('2026-09-21', 10), ...week('2026-09-28', 10, G)];
    expect(mixCoverageNote(days, weeklyFees(days))).toBe('2026-09-28');
  });

  it("has no note when the mix starts at history's first full week", () => {
    // #given history starting on a Thursday, with the mix from the next Monday
    const days = [...['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'].map((d) => day(d, 10, G)), ...week('2026-09-28', 10, G)];
    // #when, #then
    expect(mixCoverageNote(days, weeklyFees(days))).toBeNull();
  });
});

describe('linkDemandTiles', () => {
  const L: Groups = { link: 2, native: 4, stable: 1, amount: 0.5 };

  it('sums LINK paid all-time and over the last 30 days, and the share of fees paid in LINK', () => {
    // #given 10 days without group columns, then 30 days of $8 fees with $2 and 0.5 LINK paid in LINK
    const days = [...Array.from({ length: 10 }, (_, i) => day(addDays('2026-08-01', i), 8)), ...Array.from({ length: 30 }, (_, i) => day(addDays('2026-08-11', i), 8, L))];
    // #when, #then
    expect(linkDemandTiles(days)).toEqual({ allTimeLink: 15, linkSince: '2026-08-11', last30Link: 15, last30Note: null, last30SharePct: 25 });
  });

  it('notes the first day with LINK amounts when it falls inside the last 30 days', () => {
    // #given
    const days = [...Array.from({ length: 20 }, (_, i) => day(addDays('2026-08-01', i), 8)), ...Array.from({ length: 10 }, (_, i) => day(addDays('2026-08-21', i), 8, L))];
    // #when
    const tiles = linkDemandTiles(days);
    // #then
    expect({ last30Link: tiles.last30Link, last30Note: tiles.last30Note }).toEqual({ last30Link: 5, last30Note: 'since 2026-08-21' });
  });

  it('has no LINK figures before any day carries them', () => {
    expect(linkDemandTiles(week('2026-09-28', 8))).toMatchObject({ allTimeLink: null, linkSince: null, last30Link: null });
  });
});
```

- [ ] **Step 3: Write the failing chart tests.** Create `site/test/weekly-chart.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatUsd } from '../src/lib/format';
import { weeklyPaths, weeklySummary } from '../src/lib/weekly-chart';

describe('weeklyPaths', () => {
  it('stacks each series on the ones before it', () => {
    // #given two weeks: a = [1, 3] and b = [1, 1], so the top of b reaches 4
    const series = [{ key: 'a', label: 'A', values: [1, 3] }, { key: 'b', label: 'B', values: [1, 1] }];
    // #when, #then
    expect(weeklyPaths(series, true)).toEqual([
      { key: 'a', d: 'M4,118L596,42L596,156L4,156Z' },
      { key: 'b', d: 'M4,80L596,4L596,42L4,118Z' },
    ]);
  });

  it('draws side-by-side series as lines on one scale', () => {
    const series = [{ key: 'f', label: 'F', values: [2, 4] }, { key: 'd', label: 'D', values: [0, 8] }];
    expect(weeklyPaths(series, false)).toEqual([
      { key: 'f', d: 'M4,118L596,80' },
      { key: 'd', d: 'M4,156L596,4' },
    ]);
  });
});

describe('weeklySummary', () => {
  it('names the weeks covered and the latest week of each series', () => {
    // #given
    const series = [{ key: 'l', label: 'LINK', values: [1000, 2500] }, { key: 'o', label: 'Other', values: [10, 20] }];
    // #when, #then
    expect(weeklySummary('Weekly fee mix', ['2026-09-28', '2026-10-05'], series, formatUsd)).toBe(
      'Weekly fee mix, weeks of Sep 28, 2026 to Oct 5, 2026. Latest week: LINK $2.5K, Other $20',
    );
  });

  it('says when there are no complete weeks', () => {
    expect(weeklySummary('Weekly fee mix', [], [], formatUsd)).toBe('Weekly fee mix: no complete weeks yet');
  });
});
```

Then create `site/test/link-demand.test.ts`:

```ts
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LinkDemandCharts, { DEPOSITS_CAPTION } from '../src/components/LinkDemandCharts';

const text = (html: string) => html.replace(/<[^>]+>/g, '');
const mix = [
  { week: '2026-09-28', link: 100, native: 300, stable: 50, other: 10 },
  { week: '2026-10-05', link: 120, native: 280, stable: 60, other: 5 },
];
const beside = [{ week: '2026-09-28', fees_usd: 460, deposits_usd: 15000 }];
const render = (props: Parameters<typeof LinkDemandCharts>[0]) => renderToString(createElement(LinkDemandCharts, props));

describe('LinkDemandCharts', () => {
  it('renders the weekly fee mix with its four groups', () => {
    // #when
    const t = text(render({ mix, beside, mixFrom: null }));
    // #then
    expect(['Weekly fee mix (USD)', 'LINK', 'Gas tokens', 'Stablecoins', 'Other'].filter((s) => !t.includes(s))).toEqual([]);
  });

  it('renders the weekly fees beside the Reserve deposits, with the caption', () => {
    const t = text(render({ mix, beside, mixFrom: null }));
    expect(['Weekly fees and Reserve deposits (USD)', 'CCIP fees', 'Reserve deposits', DEPOSITS_CAPTION].filter((s) => !t.includes(s))).toEqual([]);
  });

  it('offers a data table for each chart', () => {
    expect(render({ mix, beside, mixFrom: null }).match(/<table/g)?.length).toBe(2);
  });

  it('describes the fee mix in text for screen readers', () => {
    expect(render({ mix, beside, mixFrom: null })).toContain(
      'aria-label="Weekly fee mix (USD), weeks of Sep 28, 2026 to Oct 5, 2026. Latest week: LINK $120, Gas tokens $280, Stablecoins $60, Other $5"',
    );
  });

  it('says when no week has a mix yet', () => {
    expect(text(render({ mix: [], beside: [], mixFrom: null }))).toContain('No complete weeks with this data yet.');
  });

  it('notes the week the mix starts', () => {
    expect(text(render({ mix, beside, mixFrom: '2026-10-05' }))).toContain('Fee mix from the week of Oct 5, 2026 onward.');
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail.** Run `pnpm --filter @ccip-dev/site exec vitest run test/fee-mix.test.ts test/weekly-chart.test.ts test/link-demand.test.ts`. Expected: FAIL, because the modules are not found.

- [ ] **Step 5: Implement the data** in `site/src/lib/fee-mix.ts`.

```ts
import type { DayTotals, ReserveFile } from '@ccip-dev/core/public';
import { addDays, weekStart } from '@ccip-dev/core/time';
import { linkShare } from './charts';
import { feesNote } from './records';

export type MixRange = '90d' | '1y' | 'all';
export const MIX_RANGES: readonly MixRange[] = ['90d', '1y', 'all'];
export const RANGE_WEEKS: Record<MixRange, number | null> = { '90d': 13, '1y': 52, all: null };
const WINDOW_DAYS = 30;

export interface FeeWeek {
  week: string;
  fee_usd: number;
  mix: { link: number; native: number; stable: number; other: number } | null;
}

export interface MixWeek {
  week: string;
  link: number;
  native: number;
  stable: number;
  other: number;
}

export interface BesideWeek {
  week: string;
  fees_usd: number;
  deposits_usd: number;
}

export interface LinkDemandTiles {
  allTimeLink: number | null;
  linkSince: string | null;
  last30Link: number | null;
  last30Note: string | null;
  last30SharePct: number | null;
}

const byDay = (a: { day: string }, b: { day: string }) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
const hasMix = (d: DayTotals) => d.fee_link_usd !== null && d.fee_native_usd != null && d.fee_stable_usd != null;

/** Complete weeks only: all seven days are in history and carry fees. A week's mix needs every day's group columns. */
export function weeklyFees(days: readonly DayTotals[]): FeeWeek[] {
  const byWeek = new Map<string, DayTotals[]>();
  for (const d of days) {
    const week = weekStart(d.day);
    const list = byWeek.get(week) ?? [];
    list.push(d);
    byWeek.set(week, list);
  }
  return [...byWeek.entries()]
    .filter(([, list]) => new Set(list.map((d) => d.day)).size === 7 && list.every((d) => d.fee_usd !== null))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, list]) => {
      const sum = (pick: (d: DayTotals) => number) => list.reduce((total, d) => total + pick(d), 0);
      const fee = sum((d) => d.fee_usd!);
      if (!list.every(hasMix)) return { week, fee_usd: fee, mix: null };
      const link = sum((d) => d.fee_link_usd!);
      const native = sum((d) => d.fee_native_usd!);
      const stable = sum((d) => d.fee_stable_usd!);
      // history.json rounds each value to cents, so the groups can exceed the fees by a cent a day.
      return { week, fee_usd: fee, mix: { link, native, stable, other: Math.max(0, fee - link - native - stable) } };
    });
}

export function mixWeeks(weeks: readonly FeeWeek[]): MixWeek[] {
  return weeks.flatMap((w) => (w.mix ? [{ week: w.week, ...w.mix }] : []));
}

export function feesBesideDeposits(weeks: readonly FeeWeek[], deposits: ReserveFile['weekly']): BesideWeek[] {
  const fees = new Map(weeks.map((w) => [w.week, w.fee_usd]));
  return deposits.filter((d) => fees.has(d.week)).map((d) => ({ week: d.week, fees_usd: fees.get(d.week)!, deposits_usd: d.usd }));
}

export function weeksInRange<T extends { week: string }>(weeks: readonly T[], range: MixRange): T[] {
  const n = RANGE_WEEKS[range];
  const last = weeks.at(-1)?.week;
  if (n === null || last === undefined) return [...weeks];
  const from = addDays(last, -7 * (n - 1));
  return weeks.filter((w) => w.week >= from);
}

/** The first mix week, when the mix starts later than history's first full week, as the fees note does for fees. */
export function mixCoverageNote(days: readonly DayTotals[], weeks: readonly FeeWeek[]): string | null {
  const first = [...days].sort(byDay)[0]?.day;
  const firstMix = weeks.find((w) => w.mix !== null)?.week;
  if (first === undefined || firstMix === undefined) return null;
  return firstMix > weekStart(addDays(first, 6)) ? firstMix : null;
}

export function linkDemandTiles(days: readonly DayTotals[]): LinkDemandTiles {
  const sorted = [...days].sort(byDay);
  const withLink = sorted.filter((d) => d.fee_link_amount != null);
  const linkSince = withLink[0]?.day ?? null;
  const window = sorted.slice(-WINDOW_DAYS);
  const windowLink = window.filter((d) => d.fee_link_amount != null);
  const last = window.at(-1);
  return {
    allTimeLink: withLink.length === 0 ? null : withLink.reduce((sum, d) => sum + d.fee_link_amount!, 0),
    linkSince,
    last30Link: windowLink.length === 0 ? null : windowLink.reduce((sum, d) => sum + d.fee_link_amount!, 0),
    last30Note: feesNote(window, linkSince),
    last30SharePct: last ? linkShare(window, last.day, true) : null,
  };
}
```

- [ ] **Step 6: Implement the chart geometry** in `site/src/lib/weekly-chart.ts`.

```ts
import { area, line } from 'd3-shape';
import { CHART_H, CHART_W, pointX } from './charts';
import { formatUtcDay } from './format';

export interface WeeklySeries {
  key: string;
  label: string;
  values: number[];
}

/** Stacked: each series is an area on top of the ones before it. Not stacked: each series is a line, all on one scale. */
export function weeklyPaths(series: readonly WeeklySeries[], stacked: boolean, width = CHART_W, height = CHART_H, pad = 4): { key: string; d: string }[] {
  const count = series[0]?.values.length ?? 0;
  const zero = Array.from({ length: count }, () => 0);
  const lower: number[][] = [];
  const upper: number[][] = [];
  let base = zero;
  for (const s of series) {
    const bottom = stacked ? base : zero;
    const top = s.values.map((v, i) => bottom[i]! + v);
    lower.push(bottom);
    upper.push(top);
    if (stacked) base = top;
  }
  const max = Math.max(0, ...upper.flat()) || 1;
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const x = (i: number) => pointX(i, count, width, pad);
  const index = Array.from({ length: count }, (_, i) => i);
  return series.map((s, k) => ({
    key: s.key,
    d: stacked
      ? (area<number>().x(x).y0((i) => y(lower[k]![i]!)).y1((i) => y(upper[k]![i]!))(index) ?? '')
      : (line<number>().x(x).y((i) => y(upper[k]![i]!))(index) ?? ''),
  }));
}

export function weeklySummary(title: string, weeks: readonly string[], series: readonly WeeklySeries[], format: (v: number | null) => string): string {
  if (weeks.length === 0) return `${title}: no complete weeks yet`;
  const last = weeks.length - 1;
  return `${title}, weeks of ${formatUtcDay(weeks[0]!)} to ${formatUtcDay(weeks[last]!)}. Latest week: ${series.map((s) => `${s.label} ${format(s.values[last] ?? null)}`).join(', ')}`;
}
```

- [ ] **Step 7: Implement the chart component** `site/src/components/WeeklyChart.tsx`. It follows History's `Chart`: a figure with a caption readout, keyboard and pointer stepping, an `aria-label` summary, and a data table.

```tsx
import { useMemo, useState, type ReactNode } from 'react';
import { CHART_H, CHART_W, nearestIndex, pointX, stepIndex } from '../lib/charts';
import { formatUtcDay } from '../lib/format';
import { weeklyPaths, weeklySummary, type WeeklySeries } from '../lib/weekly-chart';

export interface ChartSeries extends WeeklySeries {
  className: string;
}

export default function WeeklyChart(props: {
  title: string;
  weeks: readonly string[];
  series: readonly ChartSeries[];
  stacked: boolean;
  format: (v: number | null) => string;
  children?: ReactNode;
}) {
  const { title, weeks, series, stacked, format } = props;
  const paths = useMemo(() => weeklyPaths(series, stacked), [series, stacked]);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? weeks.length - 1;
  return (
    <figure className="card chart">
      <figcaption>
        <span className="label">{title}</span>
        <span className="muted small" aria-live="polite">
          {weeks[shown] ? `Week of ${formatUtcDay(weeks[shown]!)}` : ''}
        </span>
      </figcaption>
      {weeks.length === 0 ? (
        <p className="muted">No complete weeks with this data yet.</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            role="img"
            tabIndex={0}
            aria-label={weeklySummary(title, weeks, series, format)}
            onKeyDown={(e) => {
              const next = stepIndex(hover, e.key, weeks.length);
              if (next === hover) return;
              e.preventDefault();
              setHover(next);
            }}
            onBlur={() => setHover(null)}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setHover(nearestIndex(((e.clientX - box.left) / box.width) * CHART_W, CHART_W, weeks.length));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {paths.map((p, i) => (
              <path
                key={p.key}
                d={p.d}
                className={`${series[i]!.className} ${stacked ? 'weekly-area' : 'weekly-line'}`}
                vectorEffect={stacked ? undefined : 'non-scaling-stroke'}
              />
            ))}
            {hover !== null && (
              <line className="chart-cursor" x1={pointX(hover, weeks.length, CHART_W)} x2={pointX(hover, weeks.length, CHART_W)} y1={0} y2={CHART_H} />
            )}
          </svg>
          <ul className="legend">
            {series.map((s) => (
              <li key={s.key}>
                <span className={`swatch ${s.className}`} aria-hidden="true" />
                {s.label} <span className="mono">{format(s.values[shown] ?? null)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {props.children}
      {weeks.length > 0 && (
        <details className="chart-table">
          <summary>Data table</summary>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Week of</th>
                  {series.map((s) => (
                    <th key={s.key} className="num">{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((w, i) => (
                  <tr key={w}>
                    <td className="mono">{formatUtcDay(w)}</td>
                    {series.map((s) => (
                      <td key={s.key} className="num">{format(s.values[i] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
```

- [ ] **Step 8: Implement the section's charts** in `site/src/components/LinkDemandCharts.tsx`.

```tsx
import { useMemo, useState } from 'react';
import { formatUsd, formatUtcDay } from '../lib/format';
import { MIX_RANGES, weeksInRange, type BesideWeek, type MixRange, type MixWeek } from '../lib/fee-mix';
import Segmented from './controls/Segmented';
import WeeklyChart, { type ChartSeries } from './WeeklyChart';

const RANGE_LABEL: Record<MixRange, string> = { '90d': '90d', '1y': '1y', all: 'All' };
export const DEPOSITS_CAPTION = 'Shown side by side. The Reserve does not publish which revenue each deposit came from.';

export default function LinkDemandCharts({ mix, beside, mixFrom }: { mix: MixWeek[]; beside: BesideWeek[]; mixFrom: string | null }) {
  const [range, setRange] = useState<MixRange>('1y');
  const mixShown = useMemo(() => weeksInRange(mix, range), [mix, range]);
  const besideShown = useMemo(() => weeksInRange(beside, range), [beside, range]);
  const mixSeries = useMemo<ChartSeries[]>(
    () => [
      { key: 'link', label: 'LINK', className: 'series-link', values: mixShown.map((w) => w.link) },
      { key: 'native', label: 'Gas tokens', className: 'series-native', values: mixShown.map((w) => w.native) },
      { key: 'stable', label: 'Stablecoins', className: 'series-stable', values: mixShown.map((w) => w.stable) },
      { key: 'other', label: 'Other', className: 'series-other', values: mixShown.map((w) => w.other) },
    ],
    [mixShown],
  );
  const besideSeries = useMemo<ChartSeries[]>(
    () => [
      { key: 'fees', label: 'CCIP fees', className: 'series-fees', values: besideShown.map((w) => w.fees_usd) },
      { key: 'deposits', label: 'Reserve deposits', className: 'series-deposits', values: besideShown.map((w) => w.deposits_usd) },
    ],
    [besideShown],
  );
  return (
    <div className="link-demand-charts">
      <Segmented label="Range" options={MIX_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} value={range} onChange={setRange} />
      <div className="charts">
        <WeeklyChart title="Weekly fee mix (USD)" weeks={mixShown.map((w) => w.week)} series={mixSeries} stacked format={formatUsd}>
          {mixFrom && <p className="muted small">Fee mix from the week of {formatUtcDay(mixFrom)} onward.</p>}
        </WeeklyChart>
        <WeeklyChart title="Weekly fees and Reserve deposits (USD)" weeks={besideShown.map((w) => w.week)} series={besideSeries} stacked={false} format={formatUsd}>
          <p className="muted small">{DEPOSITS_CAPTION}</p>
        </WeeklyChart>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run the tests and confirm they pass.** Run `pnpm --filter @ccip-dev/site exec vitest run test/fee-mix.test.ts test/weekly-chart.test.ts test/link-demand.test.ts`. Expected: PASS.

- [ ] **Step 10: Style the charts.** Append to `site/src/styles/history.css`:

```css
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none; margin: 8px 0 0; padding: 0; font-size: 12px; color: var(--muted); }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; background: currentColor; }
.weekly-area { fill: currentColor; fill-opacity: 0.6; }
.weekly-line { fill: none; stroke: currentColor; stroke-width: 2; }
.series-link, .series-fees { color: var(--blue-2); }
.series-native { color: #a27bf0; }
.series-stable { color: var(--up); }
.series-other { color: var(--muted); }
.series-deposits { color: var(--gold); }
.chart-table summary { cursor: pointer; color: var(--muted); font-size: 12px; margin-top: 8px; }
```

  The legend wraps on its own. `.charts` already stacks its figures under 2 × 320 px, so the two charts stack at 390 px.

- [ ] **Step 11: Add the section to the page.** Replace `site/src/pages/reserve.astro` with:

```astro
---
import LinkDemandCharts from '../components/LinkDemandCharts';
import ReserveView from '../components/ReserveView';
import Base from '../layouts/Base.astro';
import { buildData } from '../lib/build-data';
import { feesBesideDeposits, linkDemandTiles, mixCoverageNote, mixWeeks, weeklyFees } from '../lib/fee-mix';
import { DASH, formatLink, formatUtcDay, linkShareText } from '../lib/format';
import '../styles/history.css';

const [reserve, history] = await Promise.all([buildData('reserve.json'), buildData('history.json')]);
const weeks = weeklyFees(history.days);
const tiles = linkDemandTiles(history.days);
---
<Base title="Chainlink Reserve" description="The Chainlink Reserve's LINK: cost basis vs value now, weekly deposit cadence, pace, every transfer, and the LINK paid in CCIP fees." cardPath="reserve">
  <ReserveView client:load initial={reserve} />
  <section class="link-demand" aria-labelledby="link-demand">
    <h2 id="link-demand">LINK demand</h2>
    <p class="muted">CCIP fees paid in LINK, next to the fees paid in gas tokens and stablecoins, and beside the Reserve's deposits.</p>
    <div class="tiles wrap-labels">
      <div class="tile">
        <span class="label">LINK paid in fees</span>
        <p class="value">{formatLink(tiles.allTimeLink)}</p>
        <span class="sub">{tiles.linkSince ? `all-time, since ${formatUtcDay(tiles.linkSince)}` : DASH}</span>
      </div>
      <div class="tile">
        <span class="label">LINK paid, last 30 days</span>
        <p class="value">{formatLink(tiles.last30Link)}</p>
        <span class="sub">{tiles.last30Note ?? 'complete days'}</span>
      </div>
      <div class="tile">
        <span class="label">Share of fees, last 30 days</span>
        <p class="value">{tiles.last30SharePct === null ? DASH : linkShareText(tiles.last30SharePct)}</p>
        <span class="sub">USD paid in LINK over all fees</span>
      </div>
    </div>
    <LinkDemandCharts client:visible mix={mixWeeks(weeks)} beside={feesBesideDeposits(weeks, reserve.weekly)} mixFrom={mixCoverageNote(history.days, weeks)} />
  </section>
</Base>

<style>
  :global(.reserve-grid) { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; gap: 16px; align-items: center; margin-top: 12px; }
  :global(.reserve-tiles) { margin-top: 16px; }
  :global(.perf) { margin-top: 16px; }
  :global(.vault) { margin: 0; text-align: center; }
  :global(.vault svg) { width: 100%; max-width: 260px; }
  :global(.vault-shell) { fill: var(--card); stroke: var(--blue); stroke-width: 2; }
  :global(.vault-level) { transition: transform 1.4s var(--ease); }
  :global(.coin) { fill: #c9d6f5; opacity: 0; animation: coin-drop 1.1s var(--ease) both; animation-delay: calc(var(--i) * 80ms); }
  @keyframes coin-drop { from { transform: translateY(-260px); opacity: 0; } 30% { opacity: 1; } 80% { opacity: 1; } to { transform: translateY(0); opacity: 0; } }
  :global(.countdown-overdue) { color: var(--warn); }
  .link-demand { margin-top: 32px; }
  .link-demand .tiles { margin: 12px 0 16px; }
  @media (max-width: 640px) { :global(.reserve-grid) { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 12: Run the tests, typecheck and build.** Run `pnpm --filter @ccip-dev/core test && pnpm --filter @ccip-dev/site test && pnpm typecheck && pnpm --filter @ccip-dev/site build`. Expected: all pass, with the home budget unchanged by this task.

- [ ] **Step 13: Check it in a browser.** Follow "Local preview with the new fields" for `/reserve/`. Expected:
  - Below the transfers, "LINK demand" shows three tiles and two charts. The range control switches both charts.
  - Hovering or arrow keys step the weeks, and each legend shows that week's values.
  - The data tables open.
  - At 390, the charts stack, the legend wraps, the tile labels wrap, and there is no horizontal scroll.
  - Lighthouse mobile accessibility on `/reserve/` is ≥ 95. If the legend's muted text or the stable or deposit colors fail contrast, raise them until it passes; the swatches carry no meaning of their own, because each sits next to its label.

- [ ] **Step 14: Document it.** In `docs/methodology.md`, under "## Chainlink Reserve", after the `- **Weekly:**` bullet, add:

```markdown
- **LINK demand:** LINK paid in fees is the LINK amount of each day's LINK fees (see Fees). The weekly fee mix, and the
  weekly fees beside the Reserve's deposits, use the same Monday UTC weeks as the weekly deposits, and leave out any week
  that fee data covers only in part. Fees and deposits are shown side by side only: the Reserve does not publish which
  revenue each deposit came from.
```

- [ ] **Step 15: Commit.**

```bash
git add packages/core/src/time.ts packages/core/src/reserve-stats.ts packages/core/package.json packages/core/test/reserve-stats.test.ts site/src/lib/fee-mix.ts site/src/lib/weekly-chart.ts site/src/components/WeeklyChart.tsx site/src/components/LinkDemandCharts.tsx site/src/pages/reserve.astro site/src/styles/history.css site/test/fee-mix.test.ts site/test/weekly-chart.test.ts site/test/link-demand.test.ts docs/methodology.md
git commit -m "feat(site): LINK demand on Reserve: LINK paid, the weekly fee mix, and weekly fees beside deposits"
```

---

## Self-review notes

- **Spec coverage:**
  - §4.1 (table, generator, review list, hand-added tokens, `feeTokenGroup`): Tasks 1 and 2.
  - §4.2 (LINK in LINK units, decimals and their sources): Task 2.
  - §4.3 (`feeGroupTotals`; `linkFeeUsd` equals `link_usd`, pinned by a test): Task 2; finalize uses it in Task 3, the build in Task 5.
  - §5.1 (migration 0005): Task 3.
  - §5.2 (finalize setter; `history.json` day fields and `largest_fees` through the index; schema): Tasks 3 and 4.
  - §5.3 (UPDATE columns, pricing hash with `FEE_TOKEN_GROUPS` and `FEE_BUILD_FORMAT`, gap check): Task 5. The rollout is in the runbook (Task 4).
  - §6.1: Task 6. §6.2: Task 7. §6.3 and §6.4: Task 8, plus the `wrap-labels` class from Task 7.
  - §7: methodology in Tasks 2, 6 and 8; runbook in Tasks 2, 4 and 5.
  - §8: runbook "Fee groups, Rollout".
  - §9: each task's tests. 390 px and a11y are in the local preview steps of Tasks 6, 7 and 8.
  - §2.4 (parity): Task 3's finalize test and Task 5's build test use the same day and expect the same five values.
- **Names used across tasks:**
  - `FEE_TOKEN_GROUPS_FROM_DOCS` (Task 1), used by Task 2.
  - From Task 2:
    - `FEE_TOKEN_GROUPS`, `FeeTokenGroup`, `feeClassifier`, `FeeClassifier`, `feeGroupTotals` and `FeeGroupTotals`, used by Tasks 3, 4 and 5;
    - `LinkFeeTokens` and `linkFeeKeys`, used by Tasks 2 and 5;
    - `UNLISTED_LINK_FEE_TOKENS` with `{ address, decimals }`, used by Task 5.
  - `store.setFeeGroupTotals` (Task 3), used by Task 4's tests.
  - From Task 4: `store.feeGroupsByDay`, `store.largestFees` and `store.LARGEST_FEES_SQL`; `LargestFee` and `largest_fees`, used by Task 7.
  - From Task 6: `FEE_DATA_START`, used by Task 7; `feeHistoryTotals` and `heroFees`.
  - From Task 7: `computeFeeRecords`, `computeFeeMilestones`, `sortMilestones` and `feeThresholds`.
  - From Task 8: `weekStart` from `@ccip-dev/core/time`.
- **Deliberate additions to the spec, each small:**
  - `largest_fees` is optional in the schema.
  - `src` and `dst` are chain selectors.
  - `largest_fees` is limited to the days `history.json` holds.
  - The pricing hash also covers the unlisted LINK decimals.
  - Fee milestones wait for full coverage.
  - The generator has `UNGROUPED_SYMBOLS`, so a symbol can stay out of the table, as §4.1 requires.
  - The two new charts get a collapsed data table; History's charts have only a text summary today.
