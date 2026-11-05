# CRE-sent CCIP Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every CCIP message whose source transaction a Chainlink CRE node key signed, and show those counts in the daily and weekly posts, on the home page, and on project and day pages.

**Architecture:**
- A checked-in key list (`config/cre-keys.json`) is refreshed by a daily GitHub PR and compiled into a generated set that the Worker bundles.
- Messages get a `cre` flag at insert time, which costs nothing: `origin` is already in hand.
- The daily rollup gains CRE totals and a `cre` breakdown dimension.
- An hourly `retagCre` step back-tags history, and re-tags after a key change, one day per batch.
- The published files, posts and site read only rollups.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, vitest (with `@cloudflare/vitest-plugin` in `worker/`), Astro + React (site), zod schemas (`packages/core/src/public.ts`), tsx scripts, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-cre-sent-messages-design.md`

## Global Constraints

- **No backfill and no index in a migration.** History is back-tagged from the Worker in chunks (the D1 7429 timeout rule).
- **Every-minute and finalize paths add no new D1 reads.** CRE totals come from rollups or from rows already fetched.
- **Addresses are lowercase.** A CRE key is the string `<selector>:<0x40-hex lowercase>` and must match `^\d+:0x[0-9a-f]{40}$`.
- **The key list never deletes a key.** Only production `KeystoneForwarder` addresses are used, never `MockKeystoneForwarder`.
- **CRE counts are a lower bound.** Docs and copy never say "executions"; they say "sent by CRE workflows".
- **History starts at `2025-10-17`**, the first CRE Workflow Registry record (`CRE_FIRST_DAY`).
- **Re-tag window after a key change: 30 days. Pace: 30 days per hourly run.**
- **Drop ranks:** `DROP = { lane: 1, cre: 2, sender: 3, token: 4, feeChains: 5, closing: 6 }`.
- **Tests:** `// #given` / `// #when` / `// #then` comments. Run with `pnpm test` (root) or `pnpm -C <pkg> test`, and `pnpm typecheck` before each commit.
- **Commits:** subject `Area: sentence`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage explicit paths only (never `git add -A`, `git add .` or `commit -a`).
- **Deviation from the spec, approved in planning:** a key records `first_seen` only, not `last_seen`. Bumping `last_seen` daily would open a PR every day. Task 2 updates the spec's JSON example to match.

## Review Focus

1. **A message whose `origin` is a Solana base58 address, or null.** It must never match or throw. Pinned in Task 1 (`isCreOrigin`).
2. **A `retagCre` pass interrupted by a new key version.** It must restart from today with the new version, never mark the old version done. Pinned in Task 5.
3. **A day with CRE messages but no `daily_totals` row yet (today, or an unfinalized day).** The messages are tagged, but no `cre` breakdown rows are written for that day; finalize writes them. Pinned in Task 5.
4. **The refresh run where a chain's RPC fails on every endpoint.** Its keys stay exactly as they were, and the PR body names the chain. Pinned in Task 2.
5. **A daily post on a day with zero CRE messages.** No CRE line, and the rest of the post is byte-for-byte unchanged. Pinned in Task 7.

## PR split

- **PR A (`feat/cre-tagging`):** Tasks 1–5, the data layer. Ship it, then let `retagCre` finish the history pass before PR B. Check with `wrangler d1 execute ccip-dev --remote --command "SELECT value FROM meta WHERE key='cre_keys_version'"`.
- **PR B (`feat/cre-surfaces`):** Tasks 6–9, the published files, posts, site and docs.

## File map

| File | Change | Responsibility |
|---|---|---|
| `packages/core/src/cre.ts` | create | Key types, key validation, `isCreOrigin`, SQL builders for the re-tag |
| `packages/core/src/index.ts` | modify | `export * from './cre'` |
| `scripts/cre-keys/refresh.ts` | create | Scans forwarder logs, merges keys, writes `config/cre-keys.json` and `cre-keys-pr.md` |
| `config/cre-keys.json` | create | The checked-in key list |
| `scripts/build-labels.ts` | modify | Writes `worker/src/generated/cre-keys.json` |
| `.github/workflows/cre-keys.yml` | create | Daily refresh PR |
| `worker/migrations/0014_cre.sql` | create | Three `ADD COLUMN`s |
| `packages/core/src/types.ts`, `rows.ts`, `rollup.ts`, `sql.ts` | modify | `cre` on rows; CRE totals and dimension |
| `worker/src/labels.ts`, `context.ts`, `jobs/ingest.ts`, `store.ts` | modify | Bundled key set, tagging at ingest, totals columns, `retagCreDay` |
| `worker/src/cre-retag.ts` | create | Cursor-paced back-tag and re-tag |
| `worker/src/jobs/hourly.ts` | modify | Runs `retagCre` |
| `scripts/backfill/build.ts` | modify | Tags offline backfill rows |
| `packages/core/src/public.ts`, `worker/src/publish.ts`, `worker/src/projects.ts` | modify | Published CRE fields and `top/cre.json` |
| `worker/src/broadcasts/facts.ts`, `copy.ts` | modify | CRE facts and lines |
| `site/src/lib/cre.ts` | create | Series, totals and leaders for the band |
| `site/src/components/home/HomeCre.astro` | create | The CRE band |
| `site/src/components/home/Feed.tsx`, `HomeTicker.tsx`, `TodayTiles.tsx`, `site/src/pages/index.astro`, `projects/[slug].astro`, `day/[day].astro`, `site/src/lib/metric-anchors.ts`, `site/src/styles/home.css` | modify | Badge, tile, band, page stats |
| `docs/methodology.md`, `docs/runbook.md`, `IMPLEMENTATION_PLAN.md` | modify | Docs |

---

### Task 1: Core CRE key set and SQL builders

**Files:**
- Create: `packages/core/src/cre.ts`
- Modify: `packages/core/src/index.ts` (append `export * from './cre';` after `export * from './sql';`)
- Test: `packages/core/test/cre.test.ts`

**Interfaces:**
- Consumes: `BREAKDOWN_CONFLICT` from `packages/core/src/sql.ts`.
- Produces:
  - `interface CreKey { address: string; first_seen: string }`
  - `interface CreChain { selector: string; forwarder: string; keys: CreKey[] }`
  - `interface CreKeyFile { source: string; chains: Record<string, CreChain> }`
  - `interface GeneratedCreKeys { version: string; keys: string[] }`
  - `interface CreKeySet { version: string; keys: ReadonlySet<string> }`
  - `const NO_CRE_KEYS: CreKeySet`
  - `const CRE_FIRST_DAY = '2025-10-17'`
  - `creKeyOf(selector, address): string`
  - `generatedCreKeys(file: CreKeyFile): GeneratedCreKeys`
  - `creKeySet(g: GeneratedCreKeys): CreKeySet`
  - `isCreOrigin(set: CreKeySet, srcChain: string, origin: string | null): boolean`
  - `creRetagDaySql(set: CreKeySet): string`
  - `const CRE_BREAKDOWN_DAY_SQL: string`
  - `const CRE_TOTALS_DAY_SQL: string`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/cre.test.ts
import { describe, expect, it } from 'vitest';
import { creKeyOf, creKeySet, creRetagDaySql, generatedCreKeys, isCreOrigin, NO_CRE_KEYS, type CreKeyFile } from '../src/cre';

const BASE = '15971525489660198786';
const ETH = '5009297550715157269';
const KEY = '0x1d07e028aaaaaaaaaaaaaaaaaaaaaaaaaaaa6327';

const file = (keys: { chain: string; selector: string; address: string }[]): CreKeyFile => ({
  source: 'test',
  chains: Object.fromEntries(
    keys.map((k) => [k.chain, { selector: k.selector, forwarder: '0xf8344cfd5c43616a4366c34e3eee75af79a74482', keys: [{ address: k.address, first_seen: '2026-11-05' }] }]),
  ),
});

describe('generatedCreKeys', () => {
  it('lists each chain key once, lowercased and sorted, with a version that changes with the list', () => {
    // #given
    const one = file([{ chain: 'ethereum-mainnet-base-1', selector: BASE, address: KEY.toUpperCase().replace('0X', '0x') }]);
    const two = file([
      { chain: 'ethereum-mainnet-base-1', selector: BASE, address: KEY },
      { chain: 'ethereum-mainnet', selector: ETH, address: KEY },
    ]);
    // #when
    const a = generatedCreKeys(one);
    const b = generatedCreKeys(two);
    // #then
    expect(a.keys).toEqual([`${BASE}:${KEY}`]);
    expect(b.keys).toEqual([`${BASE}:${KEY}`, `${ETH}:${KEY}`]);
    expect(a.version).not.toBe(b.version);
    expect(generatedCreKeys(one).version).toBe(a.version);
  });

  it('refuses a malformed address', () => {
    // #given
    const bad = file([{ chain: 'ethereum-mainnet-base-1', selector: BASE, address: "0x12'; DROP TABLE messages; --" }]);
    // #then
    expect(() => generatedCreKeys(bad)).toThrow(/malformed/);
  });
});

describe('isCreOrigin', () => {
  const set = creKeySet({ version: 'v', keys: [`${BASE}:${KEY}`] });

  it('matches a node key on its own chain, in any letter case', () => {
    expect(isCreOrigin(set, BASE, KEY.toUpperCase().replace('0X', '0x'))).toBe(true);
  });

  it('does not match the same address on another chain', () => {
    expect(isCreOrigin(set, ETH, KEY)).toBe(false);
  });

  it('never matches a null or non-EVM origin', () => {
    expect(isCreOrigin(set, BASE, null)).toBe(false);
    expect(isCreOrigin(set, BASE, 'bpfe9tJukfJWf4M8SPVR1kzby6NCfH45zA87vbYgtG5')).toBe(false);
  });
});

describe('creKeySet', () => {
  it('refuses a generated key that is not a selector and lowercase address', () => {
    expect(() => creKeySet({ version: 'v', keys: [`${BASE}:0xABC`] })).toThrow(/malformed/);
  });
});

describe('creRetagDaySql', () => {
  it('inlines every key as a literal and only writes rows whose flag changes', () => {
    // #given
    const set = creKeySet({ version: 'v', keys: [`${BASE}:${KEY}`, `${ETH}:${KEY}`] });
    // #when
    const sql = creRetagDaySql(set);
    // #then
    expect(sql).toContain(`'${BASE}:${KEY}', '${ETH}:${KEY}'`);
    expect(sql).toMatch(/WHERE day = \?1 AND cre <> /);
  });

  it('tags nothing with an empty set', () => {
    expect(creRetagDaySql(NO_CRE_KEYS)).toContain('IN (NULL)');
  });
});

describe('creKeyOf', () => {
  it('joins the selector and the lowercase address', () => {
    expect(creKeyOf(BASE, '0xABCDEF0000000000000000000000000000000001')).toBe(`${BASE}:0xabcdef0000000000000000000000000000000001`);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C packages/core exec vitest run test/cre.test.ts`
Expected: FAIL, `Cannot find module '../src/cre'`

- [ ] **Step 3: Implement `packages/core/src/cre.ts`**

```ts
import { BREAKDOWN_CONFLICT } from './sql';

/** A CRE DON node's sending key on one chain, as the forwarder transactions it signed show it. */
export interface CreKey {
  address: string;
  first_seen: string;
}

export interface CreChain {
  selector: string;
  forwarder: string;
  keys: CreKey[];
}

/** config/cre-keys.json, keyed by CCIP chain name. */
export interface CreKeyFile {
  source: string;
  chains: Record<string, CreChain>;
}

/** worker/src/generated/cre-keys.json: every `<selector>:<address>` key, sorted, and a version that changes with the list. */
export interface GeneratedCreKeys {
  version: string;
  keys: string[];
}

export interface CreKeySet {
  version: string;
  keys: ReadonlySet<string>;
}

/** The CRE Workflow Registry's first record: no CCIP message before it was sent by a CRE workflow. */
export const CRE_FIRST_DAY = '2025-10-17';

export const NO_CRE_KEYS: CreKeySet = { version: 'none', keys: new Set() };

/** Only these strings are ever written into SQL, so a key list can be inlined safely. */
const CRE_KEY = /^\d+:0x[0-9a-f]{40}$/;

export const creKeyOf = (selector: string, address: string): string => `${selector}:${address.toLowerCase()}`;

function assertKey(key: string, where: string): string {
  if (!CRE_KEY.test(key)) throw new Error(`${where} has a malformed CRE key ${JSON.stringify(key)}`);
  return key;
}

export function generatedCreKeys(file: CreKeyFile): GeneratedCreKeys {
  const keys = [...new Set(Object.values(file.chains).flatMap((c) => c.keys.map((k) => creKeyOf(c.selector, k.address))))].sort();
  for (const key of keys) assertKey(key, 'config/cre-keys.json');
  return { version: `${keys.length}-${fnv1a(keys.join('\n'))}`, keys };
}

export function creKeySet(generated: GeneratedCreKeys): CreKeySet {
  for (const key of generated.keys) assertKey(key, 'worker/src/generated/cre-keys.json');
  return { version: generated.version, keys: new Set(generated.keys) };
}

/** A CCIP message was sent by a CRE workflow when a CRE node key on its source chain signed the source transaction. */
export function isCreOrigin(set: CreKeySet, srcChain: string, origin: string | null): boolean {
  return origin !== null && set.keys.has(creKeyOf(srcChain, origin));
}

/** The keys as SQL string literals; `NULL` for none, so `IN (NULL)` matches nothing. */
function keysSql(set: CreKeySet): string {
  if (set.keys.size === 0) return 'NULL';
  return [...set.keys].map((k) => `'${assertKey(k, 'the CRE key set')}'`).join(', ');
}

/**
 * Sets one day's `cre` flags (?1 = day) from the key set. The list is inlined: binding it in PARAM_CHUNK pieces would
 * need a statement a piece, and a later piece's ELSE 0 would clear an earlier piece's matches. Only changed rows are written.
 */
export function creRetagDaySql(set: CreKeySet): string {
  const flag = `CASE WHEN src_chain || ':' || origin IN (${keysSql(set)}) THEN 1 ELSE 0 END`;
  return `UPDATE messages SET cre = ${flag} WHERE day = ?1 AND cre <> ${flag}`;
}

/** One rolled-up day's `cre` breakdown rows (?1 = day), as rollupDay writes them; a day not rolled up yet gets none. */
export const CRE_BREAKDOWN_DAY_SQL = `INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT day, 'cre', src_chain || ':' || sender, COUNT(*), SUM(usd_value), SUM(fee_usd)
FROM messages
WHERE day = ?1 AND cre = 1 AND EXISTS (SELECT 1 FROM daily_totals d WHERE d.day = ?1)
GROUP BY src_chain, sender
${BREAKDOWN_CONFLICT}`;

/** One day's CRE totals (?1 = day) from its `cre` breakdown rows: a message has one sender, so the rows sum to the day. */
export const CRE_TOTALS_DAY_SQL = `UPDATE daily_totals SET
  cre_messages = COALESCE((SELECT SUM(messages) FROM daily_breakdown WHERE day = ?1 AND dim = 'cre'), 0),
  cre_usd = COALESCE((SELECT SUM(usd_value) FROM daily_breakdown WHERE day = ?1 AND dim = 'cre'), 0)
WHERE day = ?1`;

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
```

Then append `export * from './cre';` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm -C packages/core exec vitest run test/cre.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/cre-tagging
git add packages/core/src/cre.ts packages/core/src/index.ts packages/core/test/cre.test.ts
git commit -m "Core: the CRE node key set and the SQL that re-tags a day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Key refresh script, generated set and daily PR workflow

**Files:**
- Create: `scripts/cre-keys/refresh.ts`, `config/cre-keys.json` (written by the script), `.github/workflows/cre-keys.yml`, `worker/src/generated/cre-keys.json` (written by `labels:build`)
- Modify: `scripts/build-labels.ts`, `package.json` (scripts), `.gitignore` (add `cre-keys-pr.md`), `docs/superpowers/specs/2026-11-05-cre-sent-messages-design.md` (drop `last_seen` from its JSON example and from the merge rules), `IMPLEMENTATION_PLAN.md`
- Test: `scripts/test/cre-keys.test.ts`

**Interfaces:**
- Consumes: `ethRpc`, `toHex`, `type Fetcher`, `generatedCreKeys`, `type CreKeyFile` from `@ccip-dev/core`.
- Produces:
  - `REPORT_PROCESSED_TOPIC`
  - `FORWARDERS: Readonly<Record<string, string>>`
  - `signersOf(deps: Fetcher, url: string, forwarder: string): Promise<string[]>`
  - `interface ChainScan { chain: string; signers: string[] | null; error: string | null }`
  - `mergeKeys(current: CreKeyFile | null, scans: readonly ChainScan[], forwarders: Readonly<Record<string, string>>, selectors: ReadonlyMap<string, string>, day: string): MergeResult`
  - `interface MergeResult { file: CreKeyFile; added: string[]; failed: string[]; skipped: string[] }`
  - `prBody(r: MergeResult): string`
  - the file `worker/src/generated/cre-keys.json` (`GeneratedCreKeys`)

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/test/cre-keys.test.ts
import { describe, expect, it } from 'vitest';
import { mergeKeys, prBody, REPORT_PROCESSED_TOPIC, signersOf, type ChainScan } from '../cre-keys/refresh';
import type { CreKeyFile } from '@ccip-dev/core';

const BASE_SEL = '15971525489660198786';
const FWD = { 'ethereum-mainnet-base-1': '0xf8344cfd5c43616a4366c34e3eee75af79a74482', 'monad-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62' };
const SELECTORS = new Map([['ethereum-mainnet-base-1', BASE_SEL]]);
const OLD = '0x00000000000000000000000000000000000000a1';
const NEW = '0x00000000000000000000000000000000000000b2';
const current: CreKeyFile = {
  source: 's',
  chains: { 'ethereum-mainnet-base-1': { selector: BASE_SEL, forwarder: FWD['ethereum-mainnet-base-1'], keys: [{ address: OLD, first_seen: '2026-11-01' }] } },
};

describe('mergeKeys', () => {
  it('adds new signers with today as first_seen and keeps every known key unchanged', () => {
    // #given
    const scans: ChainScan[] = [{ chain: 'ethereum-mainnet-base-1', signers: [OLD, NEW.toUpperCase().replace('0X', '0x')], error: null }];
    // #when
    const r = mergeKeys(current, scans, FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['ethereum-mainnet-base-1']!.keys).toEqual([
      { address: OLD, first_seen: '2026-11-01' },
      { address: NEW, first_seen: '2026-11-06' },
    ]);
    expect(r.added).toEqual([`ethereum-mainnet-base-1 ${NEW}`]);
  });

  it('keeps a key the scan no longer sees: a rotated-out key still marks its old messages', () => {
    // #when
    const r = mergeKeys(current, [{ chain: 'ethereum-mainnet-base-1', signers: [NEW], error: null }], FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['ethereum-mainnet-base-1']!.keys.map((k) => k.address)).toEqual([OLD, NEW]);
  });

  it("leaves a failed chain's keys exactly as they were and names it", () => {
    // #when
    const r = mergeKeys(current, [{ chain: 'ethereum-mainnet-base-1', signers: null, error: 'HTTP 403' }], FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['ethereum-mainnet-base-1']).toEqual(current.chains['ethereum-mainnet-base-1']);
    expect(r.failed).toEqual(['ethereum-mainnet-base-1: HTTP 403']);
    expect(prBody(r)).toContain('ethereum-mainnet-base-1: HTTP 403');
  });

  it('skips a chain CCIP does not list, since none of its messages can be in D1', () => {
    // #when
    const r = mergeKeys(null, [{ chain: 'monad-mainnet', signers: [NEW], error: null }], FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['monad-mainnet']).toBeUndefined();
    expect(r.skipped).toEqual(['monad-mainnet']);
  });
});

describe('signersOf', () => {
  it("takes the signer of each forwarder report() transaction in the window, narrowing ranges the RPC refuses", async () => {
    // #given an RPC that refuses ranges wider than 1,000 blocks
    const calls: { method: string; params: any[] }[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body));
      calls.push({ method, params });
      const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      if (method === 'eth_blockNumber') return reply('0x2710');
      if (method === 'eth_getBlockByNumber') return reply({ timestamp: params[0] === '0x2710' ? '0x15180' : '0x14f8c' });
      if (method === 'eth_getLogs') {
        const span = parseInt(params[0].toBlock, 16) - parseInt(params[0].fromBlock, 16);
        if (span > 1000) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'range too wide' } }));
        expect(params[0].topics).toEqual([REPORT_PROCESSED_TOPIC]);
        return reply(parseInt(params[0].toBlock, 16) === 10000 ? [{ transactionHash: '0xaa' }, { transactionHash: '0xbb' }] : []);
      }
      if (method === 'eth_getTransactionByHash') return reply({ from: params[0] === '0xaa' ? OLD.toUpperCase().replace('0X', '0x') : NEW });
      throw new Error(`unexpected ${method}`);
    }) as unknown as typeof globalThis.fetch;
    // #when
    const signers = await signersOf({ fetch }, 'https://rpc.test', FWD['ethereum-mainnet-base-1']);
    // #then
    expect(signers).toEqual([OLD, NEW]);
    expect(calls.some((c) => c.method === 'eth_getLogs' && parseInt(c.params[0].toBlock, 16) - parseInt(c.params[0].fromBlock, 16) <= 1000)).toBe(true);
  });
});
```

These tests use 2 s blocks: the head is at 0x15180 and block head−500 at 0x14f8c, a difference of 1,000 s. So the 24 h window is 43,200 blocks, which is wider than the 10,000-block chain. The walk therefore stops at block 0.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm exec vitest run scripts/test/cre-keys.test.ts`
Expected: FAIL, `Cannot find module '../cre-keys/refresh'`

- [ ] **Step 3: Implement `scripts/cre-keys/refresh.ts`**

```ts
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ethRpc, toHex, type CreChain, type CreKeyFile, type Fetcher } from '@ccip-dev/core';

const ROOT = path.resolve(import.meta.dirname, '../..');
const KEYS_FILE = path.join(ROOT, 'config/cre-keys.json');
const PR_BODY_FILE = path.join(ROOT, 'cre-keys-pr.md');
const SOURCE =
  'Built by pnpm cre-keys:refresh from KeystoneForwarder ReportProcessed logs; a key is the signer of a forwarder report() transaction. Keys are never removed.';

/** keccak256("ReportProcessed(address,bytes32,bytes2,bool)") */
export const REPORT_PROCESSED_TOPIC = '0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5';

/** Production KeystoneForwarders from docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts (checked 2026-11-05); never the MockKeystoneForwarder simulation addresses. */
export const FORWARDERS: Readonly<Record<string, string>> = {
  'adi-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'avalanche-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'binance_smart_chain-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'celo-mainnet': '0x98b8335d29aca40840ed8426da1a0aaa8677d8d1',
  'ethereum-mainnet': '0x0b93082d9b3c7c97facd250082899bacf3af3885',
  'ethereum-mainnet-arbitrum-1': '0xf8344cfd5c43616a4366c34e3eee75af79a74482',
  'ethereum-mainnet-base-1': '0xf8344cfd5c43616a4366c34e3eee75af79a74482',
  'ethereum-mainnet-ink-1': '0x9ef6468c5f37b976e57d52054c693269479a784d',
  'ethereum-mainnet-linea-1': '0x9ef6468c5f37b976e57d52054c693269479a784d',
  'ethereum-mainnet-mantle-1': '0xb9f79d863261869b234c481d1f9a7af84aead192',
  'ethereum-mainnet-optimism-1': '0xf8344cfd5c43616a4366c34e3eee75af79a74482',
  'ethereum-mainnet-scroll-1': '0x98b8335d29aca40840ed8426da1a0aaa8677d8d1',
  'ethereum-mainnet-worldchain-1': '0x98b8335d29aca40840ed8426da1a0aaa8677d8d1',
  'ethereum-mainnet-xlayer-1': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'ethereum-mainnet-zksync-1': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'gnosis_chain-mainnet': '0x9ef6468c5f37b976e57d52054c693269479a784d',
  'hyperliquid-mainnet': '0x9ef6468c5f37b976e57d52054c693269479a784d',
  'jovay-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'megaeth-mainnet': '0x7bccafbd064cb3658476066cc33cee3f3414c04c',
  'monad-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'pharos-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'plasma-mainnet': '0x7bccafbd064cb3658476066cc33cee3f3414c04c',
  'polygon-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'sonic-mainnet': '0x98b8335d29aca40840ed8426da1a0aaa8677d8d1',
};

/** Tried after config/endpoints.json's keyless RPC, for chains whose listed RPC refuses wide log ranges. */
const FALLBACK_RPC: Readonly<Record<string, readonly string[]>> = {
  'avalanche-mainnet': ['https://avalanche-c-chain-rpc.publicnode.com'],
  'binance_smart_chain-mainnet': ['https://bsc-rpc.publicnode.com'],
  'ethereum-mainnet': ['https://ethereum-rpc.publicnode.com'],
  'ethereum-mainnet-arbitrum-1': ['https://arbitrum-one-rpc.publicnode.com'],
  'ethereum-mainnet-base-1': ['https://base-rpc.publicnode.com'],
  'ethereum-mainnet-optimism-1': ['https://optimism-rpc.publicnode.com'],
  'polygon-mainnet': ['https://polygon-bor-rpc.publicnode.com'],
};

const WINDOW_SECONDS = 86_400;
const START_BLOCKS = 5_000;
const MIN_BLOCKS = 100;
const MAX_LOG_CALLS = 200;
const TX_SAMPLE = 80;
const BLOCK_TIME_SPAN = 500;

/** The node keys that signed the forwarder's report() transactions over about the last day, from up to TX_SAMPLE of them. */
export async function signersOf(deps: Fetcher, url: string, forwarder: string): Promise<string[]> {
  const head = Number(await ethRpc(deps, url, 'eth_blockNumber', []));
  const timestamp = async (n: number) => Number(((await ethRpc(deps, url, 'eth_getBlockByNumber', [toHex(n), false])) as { timestamp: string }).timestamp);
  const span = Math.min(head, BLOCK_TIME_SPAN);
  const secondsPerBlock = span === 0 ? 1 : ((await timestamp(head)) - (await timestamp(head - span))) / span;
  const oldest = Math.max(0, head - Math.ceil(WINDOW_SECONDS / Math.max(secondsPerBlock, 0.05)));

  const hashes = new Set<string>();
  let to = head;
  let step = START_BLOCKS;
  for (let calls = 0; to >= oldest && calls < MAX_LOG_CALLS; calls++) {
    const from = Math.max(oldest, to - step + 1);
    try {
      const logs = (await ethRpc(deps, url, 'eth_getLogs', [{ address: forwarder, topics: [REPORT_PROCESSED_TOPIC], fromBlock: toHex(from), toBlock: toHex(to) }])) as { transactionHash: string }[];
      for (const log of logs) hashes.add(log.transactionHash);
      to = from - 1;
    } catch (err) {
      if (step <= MIN_BLOCKS) throw err;
      step = Math.max(MIN_BLOCKS, Math.floor(step / 4));
    }
  }

  const all = [...hashes];
  const stride = Math.max(1, Math.floor(all.length / TX_SAMPLE));
  const signers = new Set<string>();
  for (const hash of all.filter((_, i) => i % stride === 0).slice(0, TX_SAMPLE)) {
    const tx = (await ethRpc(deps, url, 'eth_getTransactionByHash', [hash])) as { from: string };
    signers.add(tx.from.toLowerCase());
  }
  return [...signers].sort();
}

export interface ChainScan {
  chain: string;
  /** null when every endpoint failed. */
  signers: string[] | null;
  error: string | null;
}

export interface MergeResult {
  file: CreKeyFile;
  added: string[];
  failed: string[];
  skipped: string[];
}

export function mergeKeys(
  current: CreKeyFile | null,
  scans: readonly ChainScan[],
  forwarders: Readonly<Record<string, string>>,
  selectors: ReadonlyMap<string, string>,
  day: string,
): MergeResult {
  const chains: Record<string, CreChain> = structuredClone(current?.chains ?? {});
  const added: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const [chain, forwarder] of Object.entries(forwarders)) {
    const selector = selectors.get(chain);
    if (selector === undefined) {
      skipped.push(chain);
      continue;
    }
    const scan = scans.find((s) => s.chain === chain);
    if (!scan || scan.signers === null) {
      failed.push(`${chain}: ${scan?.error ?? 'not scanned'}`);
      continue;
    }
    const entry = chains[chain] ?? { selector, forwarder, keys: [] };
    entry.selector = selector;
    entry.forwarder = forwarder;
    const known = new Set(entry.keys.map((k) => k.address));
    for (const signer of scan.signers.map((s) => s.toLowerCase())) {
      if (known.has(signer)) continue;
      known.add(signer);
      entry.keys.push({ address: signer, first_seen: day });
      added.push(`${chain} ${signer}`);
    }
    entry.keys.sort((a, b) => a.address.localeCompare(b.address));
    chains[chain] = entry;
  }
  const sorted = Object.fromEntries(Object.entries(chains).sort(([a], [b]) => a.localeCompare(b)));
  return { file: { source: SOURCE, chains: sorted }, added, failed, skipped };
}

export function prBody(r: MergeResult): string {
  const list = (items: string[]) => (items.length === 0 ? '- none' : items.map((i) => `- \`${i}\``).join('\n'));
  return [
    'New CRE node keys found in KeystoneForwarder report() transactions. Messages these keys signed will be tagged as sent by CRE workflows, and `retagCre` re-tags the last 30 days.',
    '',
    '## Added',
    list(r.added),
    '',
    '## Chains whose RPCs failed (keys kept as they were)',
    list(r.failed),
    '',
  ].join('\n');
}

async function scanChain(deps: Fetcher, urls: readonly string[], chain: string, forwarder: string): Promise<ChainScan> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      return { chain, signers: await signersOf(deps, url, forwarder), error: null };
    } catch (err) {
      errors.push(`${new URL(url).hostname}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { chain, signers: null, error: errors.join('; ') || 'no RPC' };
}

async function main(): Promise<void> {
  const deps: Fetcher = { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) };
  const { rpc } = JSON.parse(await readFile(path.join(ROOT, 'config/endpoints.json'), 'utf8')) as { rpc: Record<string, string> };
  const current = existsSync(KEYS_FILE) ? (JSON.parse(await readFile(KEYS_FILE, 'utf8')) as CreKeyFile) : null;
  const res = await fetch('https://data.ccip.dev/v1/chains.json', { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`chains.json answered HTTP ${res.status}`);
  const { chains } = (await res.json()) as { chains: { selector: string; name: string }[] };
  const selectors = new Map(chains.map((c) => [c.name, c.selector]));
  const scans = await Promise.all(
    Object.entries(FORWARDERS).map(([chain, forwarder]) =>
      scanChain(deps, [rpc[chain], ...(FALLBACK_RPC[chain] ?? [])].filter((u): u is string => typeof u === 'string'), chain, forwarder),
    ),
  );
  const result = mergeKeys(current, scans, FORWARDERS, selectors, new Date().toISOString().slice(0, 10));
  await writeFile(KEYS_FILE, `${JSON.stringify(result.file, null, 2)}\n`);
  await writeFile(PR_BODY_FILE, prBody(result));
  const total = Object.values(result.file.chains).reduce((n, c) => n + c.keys.length, 0);
  console.log(`cre keys: ${total} on ${Object.keys(result.file.chains).length} chains; ${result.added.length} added; failed: ${result.failed.join(', ') || 'none'}; skipped: ${result.skipped.join(', ') || 'none'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

If `toHex` or `Fetcher` is not re-exported from `@ccip-dev/core` (check `packages/core/src/eth-rpc.ts`, which `index.ts` re-exports), import it from `@ccip-dev/core/eth-rpc` instead, following how `scripts/refresh-endpoints.ts` imports core.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm exec vitest run scripts/test/cre-keys.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Generate the worker set from `scripts/build-labels.ts`**

Add to the imports: `import { generatedCreKeys, type CreKeyFile } from '@ccip-dev/core';`. After the staking-operator validation, before `if (allErrors.length > 0)`, add:

```ts
const creFile = JSON.parse(await readFile(path.join(ROOT, 'config/cre-keys.json'), 'utf8')) as CreKeyFile;
let creKeys: ReturnType<typeof generatedCreKeys> | null = null;
try {
  creKeys = generatedCreKeys(creFile);
} catch (err) {
  allErrors.push(err instanceof Error ? err.message : String(err));
}
```

`allErrors` is a `const` array, so `push` is fine.

In the `--check` log line, append `, ${creKeys?.keys.length ?? 0} CRE key(s)`.

In the `else` (write) branch, after `staking-operators.json`:

```ts
await writeFile(path.join(generated, 'cre-keys.json'), `${JSON.stringify(creKeys, null, 2)}\n`);
console.log(`wrote ${creKeys!.keys.length} CRE node key(s) to worker/src/generated/cre-keys.json`);
```

- [ ] **Step 6: Scripts, ignore file, workflow**

In `package.json` "scripts", after `"endpoints:refresh"`, add `"cre-keys:refresh": "tsx scripts/cre-keys/refresh.ts",`. In `.gitignore`, add `cre-keys-pr.md` under `endpoints-pr.md`.

Create `.github/workflows/cre-keys.yml`:

```yaml
name: cre-keys
on:
  schedule:
    - cron: '41 3 * * *'
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm cre-keys:refresh
      - run: pnpm labels:build
      - name: Open or update the CRE keys PR
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          if [ -z "$(git status --porcelain config/cre-keys.json worker/src/generated/cre-keys.json)" ]; then
            echo "No new CRE keys"
            exit 0
          fi
          day=$(date -u +%F)
          git config user.name "ccip.dev bot"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git checkout -B cre-keys/refresh
          git add config/cre-keys.json worker/src/generated/cre-keys.json
          git commit -m "chore(cre-keys): new CRE node keys for ${day}"
          git push --force origin cre-keys/refresh
          pr=$(gh pr list --head cre-keys/refresh --state open --json number --jq '.[0].number // empty')
          if [ -n "${pr}" ]; then
            gh pr edit "${pr}" --title "CRE node keys — ${day}" --body-file cre-keys-pr.md
          else
            gh pr create --head cre-keys/refresh --base main --title "CRE node keys — ${day}" --body-file cre-keys-pr.md
          fi
```

- [ ] **Step 7: Seed the key list**

Run: `pnpm cre-keys:refresh && pnpm labels:build`

Expected: a log line like `cre keys: ~220 on 24 chains`. The 2026-11-05 probe found 223 keys on 24 chains, 10 per chain on most. If a chain is listed under "failed", run the refresh again, since free RPCs are flaky. Accept the result when at most 3 chains fail.

Then check: `node -e 'const g=require("./worker/src/generated/cre-keys.json");console.log(g.version,g.keys.length)'`.

- [ ] **Step 8: Update the spec and the stage list**

In the spec's §1 JSON example, change each key to `{ "address": "0x…", "first_seen": "2026-11-05" }`. Replace its merge bullet with: "new keys are added with today's `first_seen`; known keys are left unchanged (no `last_seen`, so the file only changes when a key is new)". Also delete the bullet "Keys are never deleted. … and its `last_seen` stops moving." and replace it with "Keys are never deleted; a rotated-out key still marks the messages it signed."

Append to `IMPLEMENTATION_PLAN.md`:

```markdown
## CRE-sent messages (plan: docs/superpowers/plans/2026-11-05-cre-sent-messages.md)

### Stage C1: Data layer (PR A)
**Goal**: tag CRE-sent messages at ingest, back-tag history, roll CRE totals up
**Success Criteria**: `meta.cre_keys_version` equals the generated version; `daily_totals.cre_messages` matches the 2026-11-05 probe for Aug–Oct 2026 (252 / 271 / 389, or more)
**Tests**: core cre, rows, rollup, retag, EXPLAIN plans
**Status**: In Progress

### Stage C2: Published files, posts, site (PR B)
**Goal**: CRE lines in the posts, a CRE band and tile on the home page, CRE stats on project and day pages
**Success Criteria**: schemas parse; post fixtures pass; the band renders with data and hides without
**Tests**: publish, broadcast copy and facts, site components
**Status**: Not Started
```

- [ ] **Step 9: Run every test and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add scripts/cre-keys/refresh.ts scripts/test/cre-keys.test.ts scripts/build-labels.ts config/cre-keys.json worker/src/generated/cre-keys.json .github/workflows/cre-keys.yml package.json .gitignore docs/superpowers/specs/2026-11-05-cre-sent-messages-design.md IMPLEMENTATION_PLAN.md
git commit -m "CRE keys: a daily PR keeps the CRE node keys that sign forwarder reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration and tagging at ingest

**Files:**
- Create: `worker/migrations/0014_cre.sql`
- Modify:
  - `packages/core/src/types.ts` (`MessageRow`)
  - `packages/core/src/rows.ts` (`RowExtras`, `toMessageRow`)
  - `worker/src/store.ts` (`MESSAGE_COLUMNS`)
  - `worker/src/labels.ts`, `worker/src/context.ts`, `worker/test/helpers.ts`
  - `worker/src/jobs/ingest.ts` (`storeListMessages`)
  - `scripts/backfill/build.ts`
  - fixtures with `MessageRow` literals: `packages/core/test/rollup.test.ts`, `packages/core/test/rows.test.ts`, `worker/test/store.test.ts`
- Test: `packages/core/test/rows.test.ts`, `worker/test/ingest.test.ts`

**Interfaces:**
- Consumes: `creKeySet`, `isCreOrigin`, `NO_CRE_KEYS`, `type CreKeySet`, `type GeneratedCreKeys` (Task 1); `worker/src/generated/cre-keys.json` (Task 2).
- Produces:
  - `MessageRow.cre: 0 | 1`
  - `RowExtras.cre?: boolean`
  - `RunContext.creKeys: CreKeySet`
  - `bundledCreKeys` from `worker/src/labels.ts`
  - `harness({ creKeys })`

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/rows.test.ts`, add:

```ts
it('flags a message sent by a CRE workflow', () => {
  // #given
  const m = normalizeList(listMessage({ id: 'c1', sendTs: '2026-11-05T10:00:00.000Z' }));
  const v = { usdValue: 0, unpriced: false, tokenUsd: [], outliers: [] };
  // #then
  expect(toMessageRow(m, v, { source: 'live', cre: true }).cre).toBe(1);
  expect(toMessageRow(m, v, { source: 'live' }).cre).toBe(0);
});
```

Import `listMessage` from `../src/testing` and `normalizeList` from `../src/normalize` if the file does not already.

In `worker/test/ingest.test.ts`, add:

```ts
it('tags a message whose origin is a CRE node key on its source chain', async () => {
  // #given listMessage's default origin is 0x3333…, sent from Base
  const ccip = fakeCcip({ messages: [listMessage({ id: 'cre-1', sendTs: '2026-11-05T09:59:00.000Z' }), listMessage({ id: 'other', sendTs: '2026-11-05T09:58:00.000Z', src: NETWORKS.ethereum })] });
  const creKeys = creKeySet({ version: 't', keys: [`${NETWORKS.base.chainSelector}:0x3333333333333333333333333333333333333333`] });
  const { c } = harness({ now: '2026-11-05T10:00:00.000Z', ccip, creKeys });
  // #when
  await runIngest(c, { pageSize: 10 });
  // #then
  const rows = (await env.DB.prepare('SELECT message_id, cre FROM messages ORDER BY message_id').all()).results;
  expect(rows).toEqual([{ message_id: 'cre-1', cre: 1 }, { message_id: 'other', cre: 0 }]);
});
```

Import `creKeySet` from `@ccip-dev/core`, and `NETWORKS`/`listMessage` from `@ccip-dev/core/testing` if not already imported.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C packages/core exec vitest run test/rows.test.ts && pnpm -C worker exec vitest run test/ingest.test.ts`
Expected: FAIL. `cre` is `undefined`, and `harness` has no `creKeys` option.

- [ ] **Step 3: Write the migration**

```sql
-- worker/migrations/0014_cre.sql
-- CCIP messages sent by Chainlink CRE workflows: the source transaction's signer (origin) is a CRE node key on the source
-- chain (config/cre-keys.json). ADD COLUMN with a constant default does not rewrite the table, so this is cheap on the
-- ~1.6M-row messages table. No index and no backfill here: retagCre (worker/src/cre-retag.ts) back-tags history from the
-- Worker one day per batch, as the 7429 rule requires.
ALTER TABLE messages ADD COLUMN cre INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_totals ADD COLUMN cre_messages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_totals ADD COLUMN cre_usd REAL NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Thread `cre` through rows and the store**

- **`packages/core/src/types.ts`:** in `MessageRow`, after `source: Source;`, add:

  ```ts
  /** 1 when a CRE node key on the source chain signed the source transaction (see packages/core/src/cre.ts). */
  cre: 0 | 1;
  ```

- **`packages/core/src/rows.ts`:** add `cre?: boolean;` to `RowExtras`, and `cre: extras.cre ? 1 : 0,` after `source: extras.source,` in `toMessageRow`.

- **`worker/src/store.ts`:** add `'cre'` to the end of `MESSAGE_COLUMNS`, after `'source'`. `upsertListRows`' `ON CONFLICT … DO UPDATE` does not mention `cre`, so a re-seen message keeps its first-insert value, as `origin` does.

- **`MessageRow` literal fixtures:** add `cre: 0,` to every literal in `packages/core/test/rollup.test.ts`, `packages/core/test/rows.test.ts` and `worker/test/store.test.ts`. Find them with `grep -n "ready_for_manual_exec:" <file>`. `pnpm typecheck` lists any you miss.

- [ ] **Step 5: Bundle the key set into the RunContext**

- **`worker/src/labels.ts`:**

  ```ts
  import { creKeySet, type CreKeySet, type GeneratedCreKeys } from '@ccip-dev/core';
  import bundledCre from './generated/cre-keys.json';

  export const bundledCreKeys: CreKeySet = creKeySet(bundledCre as GeneratedCreKeys);
  ```

- **`worker/src/context.ts`:**
  - Add `creKeys: CreKeySet;` to `RunContext`.
  - Add `'creKeys'` to the `overrides` `Pick<…>` union.
  - Add `creKeys: overrides.creKeys ?? bundledCreKeys,` beside `labelTokens`.
  - Import `bundledCreKeys` from `./labels` and `type CreKeySet` from `@ccip-dev/core`.

- **`worker/test/helpers.ts`:**
  - Add `creKeys?: CreKeySet;` to the `harness` opts.
  - Pass `creKeys: opts.creKeys ?? NO_CRE_KEYS,` to `createRunContext`.
  - Import `NO_CRE_KEYS` and `type CreKeySet` from `@ccip-dev/core`.

- **`worker/src/jobs/ingest.ts`:** in `storeListMessages`, change the extras callback to

  ```ts
  (m) => ({ source: 'live', nextCheckAt: firstCheckAt(m.sendTs), cre: isCreOrigin(c.creKeys, m.src.selector, m.origin) }),
  ```

  and import `isCreOrigin` from `@ccip-dev/core`. Finalize's `collectDay` calls `storeListMessages`, so its sweeps tag too.

- **`scripts/backfill/build.ts`:**
  - Add the imports, then at module top level:

    ```ts
    import { creKeySet, isCreOrigin, type GeneratedCreKeys } from '@ccip-dev/core';

    const CRE_KEYS = creKeySet(JSON.parse(await readFile(path.join(import.meta.dirname, '../../worker/src/generated/cre-keys.json'), 'utf8')) as GeneratedCreKeys);
    ```

  - Change `() => ({ source: 'backfill' })` to `(m) => ({ source: 'backfill', cre: isCreOrigin(CRE_KEYS, m.src.selector, m.origin) })`.
  - `insertSql` takes its columns from the row's keys, so it writes `cre`.
  - If `build.ts` already defines a `ROOT` constant, resolve the path from it instead.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS, including both new tests

- [ ] **Step 7: Commit**

```bash
git add worker/migrations/0014_cre.sql packages/core/src/types.ts packages/core/src/rows.ts worker/src/store.ts worker/src/labels.ts worker/src/context.ts worker/test/helpers.ts worker/src/jobs/ingest.ts scripts/backfill/build.ts packages/core/test/rows.test.ts packages/core/test/rollup.test.ts worker/test/store.test.ts worker/test/ingest.test.ts
git commit -m "Ingest: flag messages a CRE node key signed, as they are first stored

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CRE totals and the `cre` breakdown in the rollup

**Files:**
- Modify:
  - `packages/core/src/types.ts` (`Dim`, `DailyTotals`)
  - `packages/core/src/rollup.ts`
  - `packages/core/src/sql.ts` (`TOTALS_CONFLICT`)
  - `worker/src/store.ts` (`writeDaily`, `BREAKDOWN_DIMS`, `dailyHistory`)
- Test: `packages/core/test/rollup.test.ts`, `worker/test/store.test.ts`

**Interfaces:**
- Consumes: `MessageRow.cre` (Task 3).
- Produces:
  - `Dim` now includes `'cre'`
  - `DailyTotals.cre_messages?: number` and `DailyTotals.cre_usd?: number` (optional so older literals still type; `rollupDay` always sets them)
  - `daily_breakdown` rows `{ dim: 'cre', key: '<src>:<sender>' }`
  - `store.dailyHistory` returns `cre_messages` and `cre_usd`

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/rollup.test.ts`, add the following, using the file's existing row builder. If it builds rows with a helper (look at the top of the file), use that helper with `{ cre: 1 }`:

```ts
it('counts CRE-sent messages and ranks their senders under the cre dimension', () => {
  // #given two CRE-sent messages from one sender and one ordinary message
  const day = '2026-11-04';
  const rows = [
    row({ message_id: 'a', day, sender: '0xaaa', cre: 1, usd_value: 10, fee_usd: 1 }),
    row({ message_id: 'b', day, sender: '0xaaa', cre: 1, usd_value: 5, fee_usd: null }),
    row({ message_id: 'c', day, sender: '0xbbb', cre: 0, usd_value: 7, fee_usd: 2 }),
  ];
  // #when
  const { totals, breakdown } = rollupDay(day, rows, [], () => null);
  // #then
  expect(totals.cre_messages).toBe(2);
  expect(totals.cre_usd).toBe(15);
  expect(breakdown.filter((b) => b.dim === 'cre')).toEqual([{ day, dim: 'cre', key: `${rows[0]!.src_chain}:0xaaa`, messages: 2, usd_value: 15, fee_usd: 1 }]);
});

it('has no cre rows and zero CRE totals on a day without CRE messages', () => {
  // #given
  const day = '2026-11-04';
  // #when
  const { totals, breakdown } = rollupDay(day, [row({ message_id: 'c', day, cre: 0 })], [], () => null);
  // #then
  expect(totals.cre_messages).toBe(0);
  expect(totals.cre_usd).toBe(0);
  expect(breakdown.some((b) => b.dim === 'cre')).toBe(false);
});
```

If the third argument of `rollupDay` (`TokenGroupOf`) has a different shape, use the same value the file's other tests pass.

In `worker/test/store.test.ts`, add:

```ts
it('stores and returns the CRE totals of a day', async () => {
  // #given
  const totals = { day: '2026-11-04', messages: 3, token_messages: 1, data_messages: 2, usd_value: 22, fee_usd: 3, unique_senders: 2, median_delivery_s: null, unpriced_messages: 0, cre_messages: 2, cre_usd: 15 };
  // #when
  await store.replaceDaily(env.DB, totals, [], '2026-11-05T00:07:00.000Z');
  // #then
  const [day] = await store.dailyHistory(env.DB);
  expect(day).toMatchObject({ cre_messages: 2, cre_usd: 15 });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C packages/core exec vitest run test/rollup.test.ts && pnpm -C worker exec vitest run test/store.test.ts`
Expected: FAIL. `cre_messages` is undefined.

- [ ] **Step 3: Implement**

- **`packages/core/src/types.ts`:**
  - `export type Dim = 'src_chain' | 'dst_chain' | 'lane' | 'token' | 'sender' | 'via_token' | 'cre';`
  - In `DailyTotals`, after `unpriced_messages`, add:

    ```ts
    /** Messages sent by CRE workflows and their value. Optional so rows written before CRE tagging still type; the rollup always sets them. */
    cre_messages?: number;
    cre_usd?: number;
    ```

- **`packages/core/src/rollup.ts`:**
  - In the `totals` literal, after `unpriced_messages`, add:

    ```ts
    cre_messages: rows.filter((r) => r.cre === 1).length,
    cre_usd: sum(rows.filter((r) => r.cre === 1).map((r) => r.usd_value)),
    ```

  - After `addMessageGroups('sender', senderKey);`, add:

    ```ts
    addMessageGroups('cre', (r) => (r.cre === 1 ? senderKey(r) : null));
    ```

- **`packages/core/src/sql.ts`:** in `TOTALS_CONFLICT`, before `computed_at = excluded.computed_at`, insert `cre_messages = excluded.cre_messages, cre_usd = excluded.cre_usd, `.

- **`worker/src/store.ts`:**
  - In `writeDaily`, change the totals insert to

    ```ts
    `INSERT INTO daily_totals (day, messages, token_messages, data_messages, usd_value, fee_usd, unique_senders, median_delivery_s, unpriced_messages, cre_messages, cre_usd, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ${TOTALS_CONFLICT}`,
    ```

    and bind `totals.cre_messages ?? 0, totals.cre_usd ?? 0,` before `computedAt`.
  - Add `'cre'` to `BREAKDOWN_DIMS`.
  - In `dailyHistory`, add `, cre_messages, cre_usd` after `unpriced_messages` in the SELECT.

- [ ] **Step 4: Run every test**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

A test that snapshots `daily_totals` columns or `BREAKDOWN_DIMS` statement counts (for example the `rollMonth` test in `worker/test/monthly-rollup.test.ts`, which counts one statement per dim) needs its expected value raised by one dim. Update it, then rerun.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/rollup.ts packages/core/src/sql.ts worker/src/store.ts packages/core/test/rollup.test.ts worker/test/store.test.ts worker/test/monthly-rollup.test.ts
git commit -m "Rollup: CRE totals per day and a cre breakdown of their senders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Leave `worker/test/monthly-rollup.test.ts` out of `git add` if it did not change.

---

### Task 5: `retagCre`, the hourly back-tag and re-tag

**Files:**
- Create: `worker/src/cre-retag.ts`
- Modify: `worker/src/store.ts` (export `retagCreDay`), `worker/src/jobs/hourly.ts`, `docs/runbook.md`
- Test: `worker/test/cre-retag.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `creRetagDaySql`, `CRE_BREAKDOWN_DAY_SQL`, `CRE_TOTALS_DAY_SQL`, `CRE_FIRST_DAY`
  - `RunContext.creKeys` (Task 3)
  - `store.getMeta`, `store.setMeta` (a `null` value deletes the key), `unrollStatement` (private in `store.ts`, used inside it)
- Produces:
  - `store.retagCreDay(db: D1Database, day: string, retagSql: string): Promise<void>`
  - `retagCre(c: RunContext, maxDays?: number): Promise<void>`
  - meta keys `cre_keys_version` and `cre_retag`
  - constants `CRE_RETAG_DAYS = 30`, `CRE_RETAG_DAYS_PER_RUN = 30`

- [ ] **Step 1: Write the failing tests**

```ts
// worker/test/cre-retag.test.ts
import { CRE_FIRST_DAY, creKeySet, creRetagDaySql } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { retagCre } from '../src/cre-retag';
import * as store from '../src/store';
import { harness, liveRow, resetStorage } from './helpers';

beforeEach(resetStorage);

const BASE = NETWORKS.base.chainSelector;
const NODE = '0x00000000000000000000000000000000000c4e01';
const SENDER = '0x00000000000000000000000000000000000d0001';
const keys = (version: string) => creKeySet({ version, keys: [`${BASE}:${NODE}`] });
const TOTALS = { messages: 2, token_messages: 0, data_messages: 2, usd_value: 9, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 };
const NOW = '2026-11-05T01:00:00.000Z';

async function seed(day: string, rolledUp: boolean): Promise<void> {
  await store.upsertListRows(env.DB, [
    liveRow({ id: `${day}-cre`, sendTs: `${day}T10:00:00.000Z`, sender: SENDER }, { origin: NODE, usd_value: 9 }),
    liveRow({ id: `${day}-other`, sendTs: `${day}T11:00:00.000Z`, sender: SENDER }, { origin: SENDER }),
  ], []);
  if (rolledUp) await store.replaceDaily(env.DB, { day, ...TOTALS }, [], NOW);
}

const flags = async () => (await env.DB.prepare('SELECT message_id, cre FROM messages ORDER BY message_id').all()).results;
const meta = (key: string) => store.getMeta(env.DB, key);

describe('retagCre', () => {
  it('back-tags every day from today to CRE_FIRST_DAY on the first pass, 30 days a run, then records the version', async () => {
    // #given a rolled-up day at each end of the history
    await seed('2026-11-04', true);
    await seed(CRE_FIRST_DAY, true);
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when the runs walk back until the pass ends
    for (let run = 0; run < 20 && (await meta('cre_keys_version')) === null; run++) await retagCre(c);
    // #then
    expect(await flags()).toEqual([
      { message_id: `${CRE_FIRST_DAY}-cre`, cre: 1 }, { message_id: `${CRE_FIRST_DAY}-other`, cre: 0 },
      { message_id: '2026-11-04-cre', cre: 1 }, { message_id: '2026-11-04-other', cre: 0 },
    ]);
    expect(await meta('cre_keys_version')).toBe('v1');
    expect(await meta('cre_retag')).toBeNull();
    const day = (await env.DB.prepare("SELECT cre_messages, cre_usd FROM daily_totals WHERE day = '2026-11-04'").first());
    expect(day).toEqual({ cre_messages: 1, cre_usd: 9 });
    const rows = (await env.DB.prepare("SELECT key, messages FROM daily_breakdown WHERE dim = 'cre' AND day = '2026-11-04'").all()).results;
    expect(rows).toEqual([{ key: `${BASE}:${SENDER}`, messages: 1 }]);
  });

  it('walks at most maxDays a run and keeps its place in cre_retag', async () => {
    // #given
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when
    await retagCre(c, 3);
    // #then
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v1', next: '2026-11-02', from: CRE_FIRST_DAY });
  });

  it('re-tags only the last 30 days after a key change', async () => {
    // #given v1 done, and a day 40 days back whose flag v1 never set
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    await seed('2026-09-26', true);
    await seed('2026-11-01', true);
    const { c } = harness({ now: NOW, creKeys: keys('v2') });
    // #when
    await retagCre(c);
    await retagCre(c);
    // #then
    expect(await meta('cre_keys_version')).toBe('v2');
    const tagged = (await flags()).filter((r: any) => r.cre === 1).map((r: any) => r.message_id);
    expect(tagged).toEqual(['2026-11-01-cre']);
  });

  it('restarts from today when the version changes mid-pass, and never marks the old version done', async () => {
    // #given a v1 first pass part-way through
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    await retagCre(c, 3);
    // #when v2 arrives
    const next = harness({ now: NOW, creKeys: keys('v2') }).c;
    await retagCre(next, 3);
    // #then
    expect(await meta('cre_keys_version')).toBeNull();
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v2', next: '2026-11-02', from: CRE_FIRST_DAY });
  });

  it('tags a day not rolled up yet but writes no cre rows for it: finalize does', async () => {
    // #given today, with no daily_totals row
    await seed('2026-11-05', false);
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when
    await retagCre(c, 1);
    // #then
    expect((await flags()).find((r: any) => r.message_id === '2026-11-05-cre')).toEqual({ message_id: '2026-11-05-cre', cre: 1 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM daily_breakdown WHERE dim = 'cre'").first())).toEqual({ n: 0 });
  });

  it('does nothing with an empty key set', async () => {
    // #given
    const { c } = harness({ now: NOW });
    // #when
    await retagCre(c);
    // #then
    expect(await meta('cre_retag')).toBeNull();
    expect(await meta('cre_keys_version')).toBeNull();
  });

  it('moves the rolled pointer back so the monthly rollup redoes a touched month', async () => {
    // #given October is rolled
    await store.setMeta(env.DB, store.ROLLED_THROUGH_KEY, '2026-10');
    await seed('2026-10-15', true);
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    const { c } = harness({ now: NOW, creKeys: keys('v2') });
    // #when the 30-day re-tag reaches 2026-10-15
    await retagCre(c);
    await retagCre(c);
    // #then
    expect(await meta(store.ROLLED_THROUGH_KEY)).toBe('2026-09');
  });

  it('searches one day of messages through the day index', async () => {
    // #when
    const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${creRetagDaySql(keys('v1'))}`).bind('2026-11-04').all()).results;
    // #then
    expect(JSON.stringify(plan)).toMatch(/USING INDEX messages_day/);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C worker exec vitest run test/cre-retag.test.ts`
Expected: FAIL, `Cannot find module '../src/cre-retag'`

- [ ] **Step 3: Implement**

Add to `worker/src/store.ts`, after `backfillViaTokenDay`. Import `CRE_BREAKDOWN_DAY_SQL` and `CRE_TOTALS_DAY_SQL` in the existing `@ccip-dev/core` import:

```ts
/** Re-tags one day's messages and rebuilds its CRE totals and cre rows in one batch; the rolled pointer moves back before its month. */
export async function retagCreDay(db: D1Database, day: string, retagSql: string): Promise<void> {
  await db.batch([
    db.prepare(retagSql).bind(day),
    db.prepare("DELETE FROM daily_breakdown WHERE day = ?1 AND dim = 'cre'").bind(day),
    db.prepare(CRE_BREAKDOWN_DAY_SQL).bind(day),
    db.prepare(CRE_TOTALS_DAY_SQL).bind(day),
    unrollStatement(db, day),
  ]);
}
```

Create `worker/src/cre-retag.ts`:

```ts
import { addDays, CRE_FIRST_DAY, creRetagDaySql, dayOf } from '@ccip-dev/core';
import type { RunContext } from './context';
import * as store from './store';

/** After a key change, the days whose messages a new key may have signed before the PR merged. */
export const CRE_RETAG_DAYS = 30;
export const CRE_RETAG_DAYS_PER_RUN = 30;

const VERSION_KEY = 'cre_keys_version';
const PASS_KEY = 'cre_retag';

/** A pass walks back from `next` to `from`, one day per batch. */
interface RetagPass {
  version: string;
  next: string;
  from: string;
}

function parsePass(value: string | null): RetagPass | null {
  if (value === null) return null;
  const pass = JSON.parse(value) as Partial<RetagPass>;
  return typeof pass.version === 'string' && typeof pass.next === 'string' && typeof pass.from === 'string' ? (pass as RetagPass) : null;
}

/**
 * Brings every message's `cre` flag in line with the bundled key set. The first pass covers CRE's whole history; a new
 * key list re-covers the last CRE_RETAG_DAYS days. A pass whose version is no longer current restarts from today.
 */
export async function retagCre(c: RunContext, maxDays = CRE_RETAG_DAYS_PER_RUN): Promise<void> {
  const { version, keys } = c.creKeys;
  if (keys.size === 0) return;
  const db = c.env.DB;
  const done = await store.getMeta(db, VERSION_KEY);
  if (done === version) return;
  const today = dayOf(c.deps.now());
  const stored = parsePass(await store.getMeta(db, PASS_KEY));
  const pass: RetagPass =
    stored?.version === version ? stored : { version, next: today, from: done === null ? CRE_FIRST_DAY : addDays(today, -(CRE_RETAG_DAYS - 1)) };
  const retagSql = creRetagDaySql(c.creKeys);
  let day = pass.next;
  for (let n = 0; n < maxDays && day >= pass.from; n++, day = addDays(day, -1)) await store.retagCreDay(db, day, retagSql);
  if (day < pass.from) {
    await store.setMeta(db, VERSION_KEY, version);
    await store.setMeta(db, PASS_KEY, null);
  } else {
    await store.setMeta(db, PASS_KEY, JSON.stringify({ ...pass, next: day }));
  }
}
```

In `worker/src/jobs/hourly.ts`, import `retagCre` from `../cre-retag`. Then add a wrapper after `backfillViaTokenHistory`, modelled on `refreshDayLeadersOrAlert`:

```ts
/** A failed re-tag keeps its place in meta and is retried next hour. */
async function retagCreOrAlert(c: RunContext): Promise<void> {
  try {
    await retagCre(c);
  } catch (err) {
    await c.alert('cre-retag', `CRE re-tagging stopped and is retried next hour: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

Call `await retagCreOrAlert(c);` in `runHourly` right after `await backfillViaTokenHistory(c);`.

- [ ] **Step 4: Run every test**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Hourly tests are unaffected, because `harness` defaults to `NO_CRE_KEYS` and `retagCre` returns early.

- [ ] **Step 5: Runbook**

Add a `## CRE-sent messages` section to `docs/runbook.md`:

```markdown
## CRE-sent messages

- **Keys:** `config/cre-keys.json`, refreshed daily by `.github/workflows/cre-keys.yml`, which opens a "CRE node keys — <day>" PR when a key is new. By hand: `pnpm cre-keys:refresh && pnpm labels:build`, then commit both `config/cre-keys.json` and `worker/src/generated/cre-keys.json`.
- **Tagging:** live ingest and finalize sweeps tag at insert. `retagCre` (hourly) back-tags the whole history on its first run, then the last 30 days after each key change, 30 days per run.
- **State:** `meta.cre_keys_version` (the finished version) and `meta.cre_retag` (a pass in progress: `{version, next, from}`).
- **Force a full pass:** `DELETE FROM meta WHERE key IN ('cre_keys_version', 'cre_retag');`
- **Alert:** `cre-retag`. The step stopped and keeps its place; it retries next hour.
```

- [ ] **Step 6: Commit and open PR A**

```bash
git add worker/src/cre-retag.ts worker/src/store.ts worker/src/jobs/hourly.ts worker/test/cre-retag.test.ts docs/runbook.md
git commit -m "Hourly: retagCre back-tags CRE-sent messages and re-tags after a key change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/cre-tagging
gh pr create --base main --title "CRE: tag CCIP messages sent by CRE workflows (data layer)" --body "$(cat <<'EOF'
Tags every CCIP message whose source transaction a Chainlink CRE node key signed (spec: docs/superpowers/specs/2026-11-05-cre-sent-messages-design.md, plan stage C1).

- config/cre-keys.json plus a daily PR workflow that keeps it current
- migration 0014 (columns only)
- tagging at ingest
- CRE totals and a cre breakdown in the rollup
- retagCre back-tags history from the Worker, 30 days a run

The 2026-11-05 probe found 975 such messages (Re, Lido, Aave and about 30 unlabeled senders); every sampled one's source tx went to the chain's KeystoneForwarder.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 6: Published CRE data

**Files:**
- Modify:
  - `packages/core/src/public.ts` (schemas)
  - `worker/src/store.ts` (`LiveRow`, `liveSince`)
  - `worker/src/publish.ts` (live, today, history, `top/cre.json`)
  - `worker/src/projects.ts`
- Test: `worker/test/publish.test.ts`, `packages/core/test/public.test.ts` (or the file that tests `PUBLIC_SCHEMAS`; find it with `grep -rln PUBLIC_SCHEMAS packages/core/test worker/test`)

**Interfaces:**
- Consumes:
  - `daily_totals.cre_*` and the `cre` dim (Task 4)
  - `store.topBetween(db, 'cre', from, to, limit, 'messages')`
  - `identitiesOf(book, rows, [])`, `rankIdentities(…, 'messages', n)`, `identityEntry(i, total)`
- Produces:
  - `LiveMessage.cre?: boolean`
  - `DayTotals.cre_messages?: number` and `DayTotals.cre_usd?: number`
  - `top/cre.json` (a `TopFile` with `dim: 'cre'`, windows ranked by messages, `identities` ranked by messages)
  - `ProjectWindow.cre_messages?: number` and `ProjectWindow.cre_share_pct?: number | null`

- [ ] **Step 1: Write the failing tests**

In `worker/test/publish.test.ts`, add a `describe('CRE in the published files')` block. Model it on the file's existing live/today and finalize-publish tests, and use the same publishing entry points those tests call: `publishLiveFiles(c)` for live and today, and the finalize publish function they use for history and top. Seed with `store.upsertListRows(env.DB, [liveRow({ id: 'c1', sendTs: <today>T…, sender: SENDER }, { cre: 1, usd_value: 9 }), liveRow({ id: 'o1', sendTs: <today>T…, sender: SENDER })], [])`. Then assert:

```ts
// live.json
expect((await readPublic('live.json')).messages.find((m: any) => m.id === 'c1').cre).toBe(true);
expect((await readPublic('live.json')).messages.find((m: any) => m.id === 'o1').cre).toBeUndefined();
// today.json
expect((await readPublic('today.json')).totals).toMatchObject({ cre_messages: 1, cre_usd: 9 });
// history.json, after the day is finalized
expect((await readPublic('history.json')).days.at(-1)).toMatchObject({ cre_messages: 1, cre_usd: 9 });
// top/cre.json
const top = await readPublic('top/cre.json');
expect(top.dim).toBe('cre');
expect(top.windows['7d'][0]).toMatchObject({ key: `${BASE}:${SENDER}`, messages: 1 });
```

For `projects.json`, label `SENDER` as a project through the harness `labels` and `projects` options. Use the same fixtures the existing projects test in that file uses. Then assert:

```ts
expect((await readPublic('projects.json')).projects[0].totals['7d']).toMatchObject({ cre_messages: 1, cre_share_pct: 50 });
```

In the schema test file, add: `PUBLIC_SCHEMAS['top/cre.json']` parses a file with `dim: 'cre'`, and `LiveFileSchema` parses a message with `cre: true` and one without.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C worker exec vitest run test/publish.test.ts`
Expected: FAIL. There is no `cre` field and no `top/cre.json`.

- [ ] **Step 3: Implement the schemas** (`packages/core/src/public.ts`)

- `LiveMessageSchema`: add `/** Present, as true, when a CRE workflow sent the message. */ cre: z.boolean().optional(),`
- `DayTotalsSchema`: add `cre_messages: z.number().optional(), cre_usd: z.number().optional(),`
- `TopFileSchema.dim`: `z.enum(['src_chain', 'dst_chain', 'lane', 'token', 'sender', 'cre'])`
- `ProjectWindowSchema`: add `/** Messages its addresses sent through CRE workflows. */ cre_messages: z.number().optional(), cre_share_pct: z.number().nullable().optional(),`
- `PUBLIC_SCHEMAS`: add `'top/cre.json': TopFileSchema,` after `'top/dst_chain.json'`

- [ ] **Step 4: Implement the live and today rows**

- **`worker/src/store.ts`:** add `cre: 0 | 1;` to `LiveRow`, and `m.cre,` to the `liveSince` SELECT list after `m.usd_value,`.
- **`worker/src/publish.ts`, `publishLive`:** in the row mapping, after `sender_label`, add `...(r.cre === 1 ? { cre: true } : {}),`.
- **`worker/src/publish.ts`, `publishToday`:** in `totals`, after `fee_usd: usd(totals.fee_usd),`, add `cre_usd: usd(totals.cre_usd ?? 0) ?? 0,`. `cre_messages` already comes through `...totals`.
- **`worker/src/publish.ts`, `historyDays`:** in the mapping, add `cre_usd: usd(d.cre_usd ?? 0) ?? 0,`.

- [ ] **Step 5: Implement `top/cre.json`**

In `worker/src/publish.ts`, after the `for (const dim of DIMS)` loop and before the replay step, add the block below. It uses the `book`, `today`, `lastDay`, `since` and `db` already in scope there.

```ts
await pauseForD1(c);
await measured('top/cre', () =>
  untilD1Recovers(c, async () => {
    const from: Record<TopWindow, string | null> = { '7d': addDays(today, -7), '30d': addDays(today, -30), all: null };
    const windows = { '7d': [] as Leader[], '30d': [] as Leader[], all: [] as Leader[] };
    const identities = { '7d': [] as Leader[], '30d': [] as Leader[], all: [] as Leader[] };
    for (const window of TOP_WINDOWS) {
      const rows = await store.topBetween(db, 'cre', from[window], lastDay, 1_000, 'messages');
      const total = rows.reduce((n, r) => n + r.messages, 0);
      windows[window] = rows.slice(0, 100).map((r) => ({ key: r.key, messages: r.messages, usd: usd(r.usd_value), fee_usd: usd(r.fee_usd), label: senderLabel(c, names, r.key) }));
      if (book) identities[window] = rankIdentities(identitiesOf(book, rows, []), 'messages', 100).map((i) => identityEntry(i, total));
    }
    await putJson(c.env.PUBLIC, 'top/cre.json', { dim: 'cre', since, windows, ...(book ? { identities } : {}) }, TTL.top, now);
  }),
);
```

Import `rankIdentities` from `@ccip-dev/core` and `identitiesOf` from `./senders` if `publish.ts` does not already. `TOP_WINDOWS`, `TopWindow` and `Leader` are already used in `senderIdentities` in the same file.

The `cre` dim has a few dozen keys per window, so these reads are small. The step logs its `rows_read` through `measured`.

- [ ] **Step 6: Implement the project CRE totals** (`worker/src/projects.ts`)

Before `const projects = …`, add:

```ts
const creByProject = async (fromDay: string) => {
  const sums = new Map<string, number>();
  for (const r of await store.topBetween(db, 'cre', fromDay, lastDay, 1_000, 'messages')) {
    const key = identityOfKey(r.key).key;
    sums.set(key, (sums.get(key) ?? 0) + r.messages);
  }
  return sums;
};
const cre = { '7d': await creByProject(from7), '30d': await creByProject(from30) };
```

Change `windowOf` to take the CRE count:

```ts
function windowOf(identity: IdentityTotals | undefined, total: store.WindowTotals, creMessages: number | null = null): ProjectWindow {
  return {
    // …existing fields unchanged…
    ...(creMessages === null ? {} : { cre_messages: creMessages, cre_share_pct: sharePct(creMessages, identity?.messages ?? 0) }),
  };
}
```

Then call it as `windowOf(find(week), totals['7d'], cre['7d'].get(key) ?? 0)` and `windowOf(thisMonth, totals['30d'], cre['30d'].get(key) ?? 0)`. Leave the all-time window without a CRE count: the spec covers only 7d and 30d.

`sharePct` returns null when the total is 0, so a project with no messages gets `cre_share_pct: null`.

- [ ] **Step 7: Run every test**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

A test that asserts the exact list of published keys, or the number of `measured` steps, needs `top/cre.json` added to its expected list.

- [ ] **Step 8: Commit**

```bash
git checkout main && git pull && git checkout -b feat/cre-surfaces
git add packages/core/src/public.ts worker/src/store.ts worker/src/publish.ts worker/src/projects.ts worker/test/publish.test.ts
git commit -m "Publish: CRE flags on live messages, CRE totals by day, top/cre.json and project CRE shares

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Also stage the schema test file you changed in Step 1.

---

### Task 7: CRE lines in the daily and weekly posts

**Files:**
- Modify: `worker/src/store.ts` (`dimDaysBetween`), `worker/src/broadcasts/facts.ts`, `worker/src/broadcasts/copy.ts`
- Test: `worker/test/broadcast-facts.test.ts`, `worker/test/broadcast-copy.test.ts`

**Interfaces:**
- Consumes:
  - `history.json` days with `cre_messages` and `cre_usd` (Task 6's `historyDays`)
  - the `cre` dim
  - `senderBook`, `identitiesOf`, `rankIdentities`
- Produces:
  - `store.dimDaysBetween(db: D1Database, dim: Dim, fromDay: string, toDay: string): Promise<LeaderRow[]>`
  - `interface CreFacts { messages: number; usd: number; sharePct: number | null; changePct: number | null; top: Player | null }`
  - `DailyFacts.cre: CreFacts | null` and `WeeklyFacts.cre: CreFacts | null`
  - `FactsSource.creTop: { days: ReadonlyMap<string, Player>; week: Player | null }`
  - `DROP.cre`

- [ ] **Step 1: Write the failing copy tests** (`worker/test/broadcast-copy.test.ts`)

Use the file's existing daily and weekly facts fixtures (the 2026-10-10 daily at lines ~57–87, and the weekly at ~198–214). Add `cre: null` to them so the existing expectations still hold: this is Review Focus #5, the unchanged post on a zero-CRE day. Then add:

```ts
const RE: Player = { name: 'Re', x: 're' };

it('adds the CRE line under the leaders on a day with CRE-sent messages', () => {
  // #given
  const f = { ...DAILY, cre: { messages: 32, usd: 41_000, sharePct: 2.4, changePct: null, top: RE } };
  // #then
  expect(postText(f, 'x')).toContain('CRE workflows: 32 messages (2.4%) · top: Re');
  expect(postText(f, 'telegram')).toContain('Sent by CRE workflows: 32 messages · $41.0K (2.4%) · top: Re');
});

it('leaves the daily post exactly as before on a day without CRE-sent messages', () => {
  expect(postText({ ...DAILY, cre: null }, 'x')).toBe(postText(DAILY_BEFORE, 'x'));
});

it('shows the weekly CRE trend against the week before', () => {
  // #given
  const f = { ...WEEKLY, cre: { messages: 140, usd: 0, sharePct: 1, changePct: 12, top: RE } };
  // #then
  expect(postText(f, 'x')).toContain('CRE workflows: 140 messages ▲ 12% · top: Re');
});

it('drops the CRE line second, after the lane, when the X post is too long', () => {
  // #given a post one line over 280 characters
  const long = { ...DAILY, cre: { messages: 32, usd: 0, sharePct: 2.4, changePct: null, top: { name: 'R'.repeat(60), x: null } } };
  // #when
  const text = postText(long, 'x');
  // #then the lane went first; if that was not enough, the CRE line went next
  expect(text).not.toContain('Busiest lane');
  expect(xLength(text)).toBeLessThanOrEqual(280);
});
```

Name the file's own helpers in place of `postText`, `DAILY`, `WEEKLY` and `xLength`. The file renders through the copy functions with a platform argument; use those exact names. `DAILY_BEFORE` is the existing fixture object before you added `cre`; keep a copy of it for the "unchanged" test.

The expected string uses `formatUsd(41_000)`, which renders as shown in the file's other `$…K` expectations. If the existing fixtures render thousands as `$41k`, match that.

- [ ] **Step 2: Write the failing facts tests** (`worker/test/broadcast-facts.test.ts`)

Following the file's existing `dailyFacts`/`weeklyFacts` setup, give the `FactsSource` a `history` row for the day with `messages: 1313, cre_messages: 32, cre_usd: 41_000`, and `creTop: { days: new Map([[DAY, RE]]), week: RE }`. Then:

```ts
expect(dailyFacts(src, DAY)!.cre).toEqual({ messages: 32, usd: 41_000, sharePct: (32 / 1313) * 100, changePct: null, top: RE });
expect(dailyFacts({ ...src, history: src.history.map((d) => ({ ...d, cre_messages: 0, cre_usd: 0 })) }, DAY)!.cre).toBeNull();
```

For the weekly facts, take a week with 140 CRE messages after a week with 125, and expect `changePct` to be `12`.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `pnpm -C worker exec vitest run test/broadcast-copy.test.ts test/broadcast-facts.test.ts`
Expected: FAIL. `cre` is missing from the facts and the copy has no CRE line.

- [ ] **Step 4: Implement the store read**

Add to `worker/src/store.ts`:

```ts
/** Every `dim` row per day over [fromDay, toDay], through daily_breakdown_dim (dim, day). */
export async function dimDaysBetween(db: D1Database, dim: Dim, fromDay: string, toDay: string): Promise<LeaderRow[]> {
  const { results } = await db
    .prepare('SELECT day, key, messages, usd_value, fee_usd FROM daily_breakdown WHERE dim = ?1 AND day >= ?2 AND day <= ?3 ORDER BY day, key')
    .bind(dim, fromDay, toDay)
    .all<LeaderRow>();
  return results;
}
```

Add an EXPLAIN test beside the others in `worker/test/store.test.ts`. It should expect `USING INDEX daily_breakdown_dim` or the primary key; assert whichever plan the existing `daily_breakdown` range tests accept.

- [ ] **Step 5: Implement the facts** (`worker/src/broadcasts/facts.ts`)

```ts
export interface CreFacts {
  messages: number;
  usd: number;
  /** Share of the period's messages. */
  sharePct: number | null;
  /** Weekly only: change against the week before. */
  changePct: number | null;
  top: Player | null;
}
```

- Add `cre: CreFacts | null;` to `DailyFacts` and `WeeklyFacts`.
- Add `creTop: { days: ReadonlyMap<string, Player>; week: Player | null };` to `FactsSource`.

In `loadFactsSource`, after `week`:

```ts
const book = await senderBook(c);
const topOf = (rows: readonly store.LeaderRow[]): Player | null => {
  const [top] = rankIdentities(identitiesOf(book, rows, []), 'messages', 1);
  return top ? { name: top.label ?? shortAddress(top.key.replace(/^address:/, '')), x: top.inferred ? null : top.x } : null;
};
const creRows = await store.dimDaysBetween(c.env.DB, 'cre', o.monday !== null && o.monday < first ? o.monday : first, o.monday !== null ? maxDay(last, addDays(o.monday, 6)) : last);
const creDays = new Map<string, Player>();
for (const day of sorted) {
  const top = topOf(creRows.filter((r) => r.day === day));
  if (top) creDays.set(day, top);
}
const creWeek = o.monday === null ? null : topOf(creRows.filter((r) => r.day >= o.monday! && r.day <= addDays(o.monday!, 6)));
```

Return `creTop: { days: creDays, week: creWeek }` in the object. Define `const maxDay = (a: string, b: string) => (a > b ? a : b);` at module level.

Imports:
- `senderBook` and `identitiesOf` from `../senders`
- `rankIdentities` and `addDays` from `@ccip-dev/core`

`shortAddress` is already imported.

Add the pure helpers:

```ts
const creSum = (rows: readonly DayTotals[]) => ({
  messages: rows.reduce((n, d) => n + (d.cre_messages ?? 0), 0),
  usd: rows.reduce((n, d) => n + (d.cre_usd ?? 0), 0),
  all: rows.reduce((n, d) => n + d.messages, 0),
});

function creFacts(rows: readonly DayTotals[], before: readonly DayTotals[] | null, top: Player | null): CreFacts | null {
  const now = creSum(rows);
  if (now.messages === 0) return null;
  const prev = before === null ? null : creSum(before).messages;
  return {
    messages: now.messages,
    usd: now.usd,
    sharePct: now.all === 0 ? null : (now.messages / now.all) * 100,
    changePct: prev === null || prev === 0 ? null : ((now.messages - prev) / prev) * 100,
    top,
  };
}
```

- In `dailyFacts`, add `cre: creFacts(src.history.filter((d) => d.day === day), null, src.creTop.days.get(day) ?? null),`.
- In `weeklyFacts`, add:

  ```ts
  cre: creFacts(
    src.history.filter((d) => d.day >= monday && d.day <= addDays(monday, 6)),
    src.history.filter((d) => d.day >= addDays(monday, -7) && d.day <= addDays(monday, -1)),
    src.creTop.week,
  ),
  ```

Any other place that constructs a `FactsSource` gets `creTop: { days: new Map(), week: null }`. That includes test helpers and record or milestone paths; `pnpm typecheck` lists them.

- [ ] **Step 6: Implement the copy** (`worker/src/broadcasts/copy.ts`)

```ts
export const DROP = { lane: 1, cre: 2, sender: 3, token: 4, feeChains: 5, closing: 6 } as const;

function creLineX(cre: CreFacts | null, trend: boolean): Line[] {
  if (cre === null) return [];
  const head = trend ? words(`CRE workflows: ${plural(cre.messages, 'message')}`, arrow(cre.changePct)) : `CRE workflows: ${plural(cre.messages, 'message')}${paren(cre.sharePct === null ? null : formatShare(cre.sharePct))}`;
  return [{ text: `${head}${cre.top ? ` · top: ${plainName(cre.top)}` : ''}`, drop: DROP.cre }];
}

function creLineTg(cre: CreFacts | null, trend: boolean): Line[] {
  if (cre === null) return [];
  const value = cre.usd > 0 ? ` · ${formatUsd(cre.usd)}` : '';
  const change = trend ? paren(arrow(cre.changePct) === null ? null : `${arrow(cre.changePct)} vs last week`) : paren(cre.sharePct === null ? null : formatShare(cre.sharePct));
  return [{ text: `Sent by CRE workflows: ${plural(cre.messages, 'message')}${value}${change}${cre.top ? ` · top: ${tgName(cre.top)}` : ''}`, drop: DROP.cre }];
}
```

Then:
- `dailyX`: insert `...creLineX(f.cre, false),` after `...leaderLinesX(f.leaders),`.
- `dailyTg`: insert `...creLineTg(f.cre, false),` after `...leaderLinesTg(f.leaders, 'day'),`.
- `weeklyX`: insert `...creLineX(f.cre, true),` after its leader lines.
- `weeklyTg`: insert `...creLineTg(f.cre, true),` after its leader lines.

Import `type CreFacts` from `./facts`.

The weekly X expectation `CRE workflows: 140 messages ▲ 12% · top: Re` matches `words(…, arrow(12))`, because `arrow` renders `▲ 12%` through `formatShare`.

- [ ] **Step 7: Run every test**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Existing copy fixtures still pass unchanged, since `cre: null` adds no line.

- [ ] **Step 8: Commit**

```bash
git add worker/src/store.ts worker/src/broadcasts/facts.ts worker/src/broadcasts/copy.ts worker/test/broadcast-copy.test.ts worker/test/broadcast-facts.test.ts worker/test/store.test.ts
git commit -m "Broadcasts: a CRE workflows line in the daily and weekly posts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Site: feed badge, today tile, CRE band, project and day stats, methodology

**Files:**
- Create: `site/src/lib/cre.ts`, `site/src/components/home/HomeCre.astro`, `site/test/cre.test.ts`
- Modify:
  - `site/src/components/home/Feed.tsx`, `site/src/components/home/HomeTicker.tsx`, `site/src/components/home/TodayTiles.tsx`
  - `site/src/pages/index.astro`, `site/src/pages/projects/[slug].astro`, `site/src/pages/day/[day].astro`
  - `site/src/lib/metric-anchors.ts`, `site/src/styles/home.css`
  - `docs/methodology.md`
- Test: `site/test/cre.test.ts`, `site/test/home-sections.test.ts`

**Interfaces:**
- Consumes: `LiveMessage.cre`, `DayTotals.cre_messages`/`cre_usd`, `top/cre.json`, `ProjectWindow.cre_messages`/`cre_share_pct` (Task 6).
- Produces:
  - `creSeries(days, n?): CrePoint[]`
  - `creTotal(days): number`
  - `creLeaders(top, projects, limit?): CreLeader[]`
  - `creSparkPoints(points, width, height): string`
  - `CRE_DAYS = 90`
  - `METRIC_ANCHORS.cre = 'cre-sent-messages'`

- [ ] **Step 1: Write the failing tests**

```ts
// site/test/cre.test.ts
import type { DayTotals, TopFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { creLeaders, creSeries, creSparkPoints, creTotal } from '../src/lib/cre';

const day = (d: string, messages: number, cre: number): DayTotals =>
  ({ day: d, messages, token_messages: 0, usd_value: 0, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: null, cre_messages: cre, cre_usd: 0 }) as DayTotals;

describe('creSeries', () => {
  it("gives each day's CRE share of messages, and 0 for days before CRE tagging", () => {
    // #given
    const days = [day('2026-11-01', 100, 2), { ...day('2026-11-02', 50, 0), cre_messages: undefined } as DayTotals];
    // #then
    expect(creSeries(days)).toEqual([
      { day: '2026-11-01', messages: 2, sharePct: 2 },
      { day: '2026-11-02', messages: 0, sharePct: 0 },
    ]);
  });
});

describe('creTotal', () => {
  it('sums every day', () => expect(creTotal([day('a', 1, 2), day('b', 1, 3)])).toBe(5));
});

describe('creLeaders', () => {
  it('names identities, linking only projects that have a page', () => {
    // #given
    const top = { identities: { '30d': [
      { key: 'project:re', label: 'Re', messages: 750, usd: 0 },
      { key: 'project:gone', label: 'Gone', messages: 3, usd: 0 },
      { key: 'address:0x00000000000000000000000000000000000000a1', label: null, messages: 2, usd: 0 },
    ], '7d': [], all: [] } } as unknown as TopFile;
    // #then
    expect(creLeaders(top, new Set(['re']))).toEqual([
      { name: 'Re', slug: 're', messages: 750 },
      { name: 'Gone', slug: null, messages: 3 },
      { name: '0x0000…00a1', slug: null, messages: 2 },
    ]);
  });

  it('is empty without the file', () => expect(creLeaders(null, new Set())).toEqual([]));
});

describe('creSparkPoints', () => {
  it('scales shares into the box, highest at the top', () => {
    expect(creSparkPoints([{ day: 'a', messages: 0, sharePct: 0 }, { day: 'b', messages: 1, sharePct: 2 }], 100, 20)).toBe('0,20 100,0');
  });
});
```

`shortAddress` in `@ccip-dev/core/names` decides the exact short form. If it renders differently from `0x0000…00a1`, use its output in the expectation.

In `site/test/home-sections.test.ts`, add:

```ts
describe('TodayTiles CRE tile', () => {
  it('shows CRE-sent messages when there are any', () => {
    const out = text(render(TodayTiles, { totals: { ...today.totals, messages: 200, cre_messages: 4 } }));
    expect(out).toContain('Sent by CRE');
    expect(out).toMatch(/\b4\b.*of today/);
  });
  it('hides when there are none', () => {
    expect(text(render(TodayTiles, { totals: { ...today.totals, cre_messages: 0 } }))).not.toContain('Sent by CRE');
  });
});
```

Add a Feed test beside the existing `rowClass` tests, rendering `Feed` with one `LiveMessage` that has `cre: true`. Expect the output to contain `title="Sent by a Chainlink CRE workflow"`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C site exec vitest run test/cre.test.ts test/home-sections.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `site/src/lib/cre.ts`**

```ts
import type { DayTotals, TopFile } from '@ccip-dev/core/public';
import { shortAddress } from '@ccip-dev/core/names';

export const CRE_DAYS = 90;

export interface CrePoint {
  day: string;
  messages: number;
  sharePct: number;
}

export interface CreLeader {
  name: string;
  slug: string | null;
  messages: number;
}

export function creSeries(days: readonly DayTotals[], n = CRE_DAYS): CrePoint[] {
  return days.slice(-n).map((d) => {
    const messages = d.cre_messages ?? 0;
    return { day: d.day, messages, sharePct: d.messages > 0 ? (messages / d.messages) * 100 : 0 };
  });
}

export const creTotal = (days: readonly DayTotals[]): number => days.reduce((n, d) => n + (d.cre_messages ?? 0), 0);

export function creLeaders(top: TopFile | null, projects: ReadonlySet<string>, limit = 5): CreLeader[] {
  return (top?.identities?.['30d'] ?? []).slice(0, limit).map((e) => {
    const slug = e.key.startsWith('project:') ? e.key.slice('project:'.length) : null;
    return { name: e.label ?? shortAddress(e.key.replace(/^address:/, '')), slug: slug !== null && projects.has(slug) ? slug : null, messages: e.messages };
  });
}

/** SVG polyline points for the shares, x across the width and the highest share at y = 0. */
export function creSparkPoints(points: readonly CrePoint[], width: number, height: number): string {
  const max = Math.max(...points.map((p) => p.sharePct), 0);
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return points.map((p, i) => `${Math.round(i * step)},${max === 0 ? height : Math.round(height - (p.sharePct / max) * height)}`).join(' ');
}
```

- [ ] **Step 4: Implement the badge and the tile**

`Feed.tsx`: after the `m.sender_label && (…)` block, inside `comms-text`, add:

```tsx
{m.cre && (
  <span className="comms-cre" title="Sent by a Chainlink CRE workflow">
    CRE
  </span>
)}
```

`HomeTicker.tsx`: after its `m.sender_label && (…)` block, add:

```tsx
{m.cre && <span className="comms-cre" title="Sent by a Chainlink CRE workflow">CRE</span>}
```

`home.css`: after `.comms-sender`, add:

```css
.comms-cre { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid var(--accent, currentColor); border-radius: 3px; font-size: 10px; letter-spacing: 0.04em; color: var(--accent, inherit); vertical-align: middle; }
```

If `home.css` names its accent token differently, use the token `.verified` or `.g` uses.

`metric-anchors.ts`: add `cre: 'cre-sent-messages',`.

`TodayTiles.tsx`:
- import `formatShare` from `../../lib/format`
- build the stats with a conditional entry after `Fees`:

```tsx
...((totals.cre_messages ?? 0) > 0
  ? [{ label: 'Sent by CRE', metric: 'cre' as const, info: 'CRE-sent messages', value: formatCount(totals.cre_messages), sub: `${formatShare(((totals.cre_messages ?? 0) / Math.max(totals.messages, 1)) * 100)} of today` }]
  : []),
```

Make `stats` a `const stats: Stat[] = [ …, ...cre, … ]` so the spread fits.

- [ ] **Step 5: Implement the band**

Create `site/src/components/home/HomeCre.astro`:

```astro
---
import type { DayTotals, TopFile } from '@ccip-dev/core/public';
import { creLeaders, creSeries, creSparkPoints, creTotal, CRE_DAYS } from '../../lib/cre';
import { formatCount, formatShare } from '../../lib/format';

interface Props {
  days: readonly DayTotals[];
  top: TopFile | null;
  projects: ReadonlySet<string>;
}

const { days, top, projects } = Astro.props;
const series = creSeries(days);
const total = creTotal(days);
const latest = series.at(-1)?.sharePct ?? 0;
const leaders = creLeaders(top, projects);
const W = 320;
const H = 56;
---
{series.some((p) => p.messages > 0) && (
  <section class="band" id="cre" aria-labelledby="cre-title">
    <div class="band-head">
      <div>
        <p class="eyebrow">CRE</p>
        <h2 id="cre-title">Workflows that send CCIP. <span class="g">{formatCount(total)} messages so far.</span></h2>
        <p class="lead">Chainlink's Runtime Environment runs workflows on Chainlink nodes; these CCIP messages were sent by one. The count is a lower bound.</p>
      </div>
      <a class="more-link" href="/methodology/#cre-sent-messages">How we count →</a>
    </div>
    <div class="cre-grid">
      <figure class="card cre-chart">
        <figcaption class="label">Share of messages sent by CRE workflows, last {CRE_DAYS} days · today {formatShare(latest)}</figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`CRE share of CCIP messages over the last ${CRE_DAYS} days`}>
          <polyline points={creSparkPoints(series, W, H)} fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
      </figure>
      {leaders.length > 0 && (
        <ol class="card cre-leaders">
          <p class="label">Top CRE-driven senders, 30 days</p>
          {leaders.map((l) => (
            <li>
              {l.slug ? <a href={`/projects/${l.slug}/`}>{l.name}</a> : <span>{l.name}</span>}
              <span class="mono muted">{formatCount(l.messages)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  </section>
)}
```

`home.css`: add

```css
.cre-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; }
.cre-leaders { list-style: none; margin: 0; }
.cre-leaders li { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; }
@media (max-width: 720px) { .cre-grid { grid-template-columns: 1fr; } }
```

In `site/src/pages/index.astro`:
- add `buildDataIfPublished('top/cre.json')` as the tenth `Promise.all` entry and `topCre` as the tenth destructured name
- import `HomeCre`
- place `<HomeCre days={history.days} top={topCre} projects={projectSet} />` between `</HomeLive>` and the vault `<section>`

- [ ] **Step 6: Implement the project and day stats**

`projects/[slug].astro`: inside the `tiles` section, after the "Share of messages" tile, add:

```astro
{(t.cre_messages ?? 0) > 0 && (
  <div class="tile"><span class="label">Sent by CRE workflows, {label}</span><p class="value">{formatCount(t.cre_messages)} <span class="muted">({formatShare(t.cre_share_pct)})</span></p></div>
)}
```

`day/[day].astro`: drop the `as const` on `tiles`, and type the list instead: `{ title: string; metric: MetricKey; value: string; deltas: { text: string | null; tone: … }[]; sub: string | null }[]`, reusing the element type the template already expects. Append:

```ts
...((view.row.cre_messages ?? 0) > 0 ? [{ title: 'Sent by CRE', metric: 'cre' as const, value: formatCount(view.row.cre_messages), deltas: [], sub: 'messages sent by CRE workflows' }] : []),
```

If dropping `as const` breaks the template's types, keep `as const` and spread a conditional `as const` tuple instead.

- [ ] **Step 7: Methodology**

Add to `docs/methodology.md`, after "Senders and projects":

```markdown
## CRE-sent messages

The Chainlink Runtime Environment (CRE) runs workflows on Chainlink nodes. A workflow reaches a chain by having a node submit a signed report to that chain's KeystoneForwarder; the forwarder calls the workflow's contract, which can send a CCIP message. ccip.dev counts a CCIP message as **sent by a CRE workflow** when the signer of its source transaction (its origin) is a known CRE node key on the source chain.

- **The keys** are the signers of KeystoneForwarder `report()` transactions, read from each chain's `ReportProcessed` logs (`config/cre-keys.json`, refreshed daily). Only production forwarders count, never the simulation forwarders.
- **Checked:** on 2026-11-05, every one of 20 sampled tagged messages had its source transaction sent to the chain's forwarder, and none of 10 untagged messages from the same senders did.
- **Matching on the CCIP sender does not work:** the contract that receives a CRE report usually hands off to another contract that sends, so the sender is not a forwarder receiver.
- **A lower bound.** It misses a workflow whose contract queues a request and sends CCIP in a later transaction, and a key rotation until the next key refresh is merged; the last 30 days are re-tagged after each key change.
- History is tagged from 2025-10-17, the CRE Workflow Registry's first record.
```

- [ ] **Step 8: Run every test and build the site**

Run: `pnpm test && pnpm typecheck && pnpm -C site build`
Expected: PASS, and the build succeeds. `buildDataIfPublished('top/cre.json')` tolerates a 404 before PR B's first publish.

- [ ] **Step 9: Commit**

```bash
git add site/src/lib/cre.ts site/src/components/home/HomeCre.astro site/test/cre.test.ts site/src/components/home/Feed.tsx site/src/components/home/HomeTicker.tsx site/src/components/home/TodayTiles.tsx site/src/pages/index.astro "site/src/pages/projects/[slug].astro" "site/src/pages/day/[day].astro" site/src/lib/metric-anchors.ts site/src/styles/home.css site/test/home-sections.test.ts docs/methodology.md
git commit -m "Site: CRE badge, today tile, a CRE band, and CRE stats on project and day pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Finish PR B and close the stage

**Files:**
- Modify: `IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: Verify against production data**

Do this after PR A's `retagCre` pass has finished (`meta.cre_keys_version` set). Run:

```bash
cd worker && npx wrangler d1 execute ccip-dev --remote --json --command "SELECT substr(day,1,7) month, SUM(cre_messages) cre FROM daily_totals WHERE day >= '2026-08-01' GROUP BY month"
```

Expected: August 252 or more, September 271 or more, October 389 or more (the 2026-11-05 probe; the full key list can only find more).

- [ ] **Step 2: Update the stages**

In `IMPLEMENTATION_PLAN.md`, set Stage C1 to `Complete` and Stage C2 to `Complete` once PR B merges. When every stage in the file is complete, remove the CRE section, as the global process asks.

- [ ] **Step 3: Commit and open PR B**

```bash
git add IMPLEMENTATION_PLAN.md
git commit -m "Plan: CRE-sent messages stages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/cre-surfaces
gh pr create --base main --title "CRE: posts, home band and page stats for CRE-sent messages" --body "$(cat <<'EOF'
Surfaces the CRE tagging from the data layer PR (spec: docs/superpowers/specs/2026-11-05-cre-sent-messages-design.md, plan stage C2).

- live.json `cre` flag, CRE totals in today.json and history.json, top/cre.json, project CRE shares
- daily and weekly posts: a "CRE workflows" line on days with CRE traffic, dropped second on X
- home: CRE badge in the feed, a "Sent by CRE" tile, and a CRE band with the 90-day share and top senders
- project and day pages: CRE stats when non-zero
- methodology: how CRE-sent messages are counted, and why it is a lower bound

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
