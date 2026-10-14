# Via-Token Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Credit a wallet's direct CCIP sends of a claimed token (`sender = origin`) to the token's project, marked "via token", so rankings, coverage, posts and project pages count the issuer behind half of CCIP's messages.

**Architecture:** The rollup adds one breakdown dimension, `via_token` (`<src_selector>:<sender>|<group>`), written at finalize and backfilled by migration 0008. One pure core module, `packages/core/src/via-token.ts`, turns the label files' `[[tokens]]` (a new generated `worker/src/generated/label-tokens.json`) and the D1 `tokens` table into claims, and splits a day's sender rows. The `sender` dimension is untouched: at publish time the store's SQL nets claimed direct sends out of unlabeled addresses and sums them as credits per `(source chain, group)`, and `mergeIdentities` takes those credits as a third argument, so a project is one identity with its sent-by and via-token parts. Every new public field is optional. The site then shows a "via token" mark, the new coverage line, and each project's split and claimed tokens.

**Tech Stack:** TypeScript, a pnpm workspace, Cloudflare Workers (D1, R2, crons), Astro 7 with React 19 islands, Satori/resvg cards (`@cf-wasm/og`), zod 4, smol-toml, Vitest 4 (the workerd pool on real D1 and R2 for `worker/`; Node for `packages/core`, `site` and `scripts`, with `node:sqlite` for script SQL).

**Spec:** `docs/superpowers/specs/2026-10-14-via-token-attribution-design.md` (owner-approved 2026-10-14). It builds on `docs/superpowers/plans/2026-10-14-sender-attribution.md`, which is implemented; trust the code over that plan and over `.superpowers/sdd/2026-10-14-sender-attribution/code-map.md`.

## Global Constraints

- **Green after every task:** `pnpm test` and `pnpm typecheck` at the root. A task that touches `site/src/` or `site/worker/` also runs `pnpm --filter @ccip-dev/site build`, which builds against the production data at `data.ccip.dev` and must pass before and after the Worker publishes the new fields.
- **Never** run wrangler with `--remote`, deploy, or push. The controller pushes `main` after Task 7 (the Worker, with migration 0008) and after Task 10 (the site). The deploy workflow applies migrations before it deploys the Worker.
- **Free sources only:** no paid API or plan. Everything here reads D1 and the bundled label files.
- **D1 bound parameters:** at most 100 per statement. Every list (claimed keys, labeled addresses, registry keys) is bound as one JSON parameter and read with `json_each(?)`.
- **The rule (spec §1), in order of precedence:** sent by (a verified label on the sender's chain), then inferred (label spread), then via token, then address. A message counts via token only when `sender = origin` as stored, its first token (`message_tokens.idx = 0`) is claimed, and its sender has no label.
  - **Ruling, "no label":** an address that no verified label names on any chain, which is the split the store already makes with `labeledAddresses(c.labels)`. SQL and JS use the same list, so the window queries and `splitViaToken` agree. An address a label names but that resolves to `address:` (an ambiguous spread, say) keeps all its messages.
- **Claims (controller correction 2026-10-14):** a message's first token is claimed when **either** its exact `<selector>:<address>` is a verified project's `[[tokens]]` entry (entry chain resolved to its selector through the chains table), **or** its registry `group_id` is the group of any entry's token. Many moved tokens are outside the registry (e.g. Maple's `ethereum-mainnet` `0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b`, 110 direct sends last week). `tokenClaims` maps both keys to the project. A key two projects claim is left out.
- **Storage key:** `via_token` rows are keyed `<src_selector>:<sender>|<group>`, where `<group>` is `tokens.group_id`, or `<chain>:<token>` from `message_tokens` when the token has no group or no registry row. Selectors hold no `:` and addresses no `|`, so the first of each splits a key. The `sender` dimension is unchanged.
- **Mentions policy (owner decision 2026-10-12, unchanged):** the daily and weekly reports tag nobody. A moment's subject is tagged only when it is a verified project with a handle and sent-by messages: `taggableX` publishes `x` as null for an inferred identity and for a via-token-only one, at the source.
- **X copy:** every X text still ends through `oneCashtag(...)` and fits `X_MAX` (280) through `fitLines`.
- **Exact copy:**
  - X: `Top sender: elizaOS via its token · 1,889 messages (15%)`, when half or more of the identity's messages came via token.
  - Telegram: `Top sender: elizaOS via its token · 1,889 messages, 15% of the day's` (`of the week's` weekly).
  - Site and card mark: `via token` when every message came via token, `incl. 1,889 via token` when some did; title `Credited via its token: wallets bridging the project's token through CCIP themselves`.
  - Status and candidates PR: `Labeled: 74% of messages (29% sent by a labeled project, 45% via its token), 61% of value (last 7 days)`. A `label_coverage` without the new fields keeps `Labeled senders: 81% of messages, 94% of value (last 7 days)`.
  - Project page: `1,200 sent by its contracts · 689 via its token, by wallets bridging it, last 7 days.`
- **Compatibility:** `schema_version` stays 1; every new field in `packages/core/src/public.ts` is `.optional()`; `top/sender.json` `windows` and `by_fees` keep their per-chain keys.
- **Migration:** `worker/migrations/0008_via_token.sql`, 40 statements, one per calendar month from 2023-07 (the first message, 2023-07-06, already carries an origin; checked in `.backfill/archive`), the last one open-ended. It fills only days that have a `daily_totals` row, and upserts with the same clause as `BREAKDOWN_CONFLICT`.
- **Test style:** `// #given`, `// #when`, `// #then` comments, one `expect` per test where possible, names that describe the behavior. Worker tests run in the workerd pool on real D1 and R2 (`worker/test/helpers.ts`), which applies every migration; core, site and script tests run on Node.
- **Commits:**
  - Stage explicit paths only. Never `git add -A`, `git add .` or `git commit -a`. Never stage `.superpowers/` or `.DS_Store`.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Comments:** explain why, never what. No commented-out code, no TODOs.

## Review Focus

1. **A direct send whose first token has no registry row, or a registry row with no group:** it is keyed `<chain>:<address>`, credited when that exact address is a `[[tokens]]` entry, and stays with the address otherwise; it is never dropped and never breaks the group lookup. Tests: Task 1 (exact match with no group, sibling match through the group, no match), Task 3 (rollup and migration both write the fallback key).
2. **A project with both sent-by and via-token messages** is one identity, ranked once, with totals equal to sent-by plus via token, `via_token: false` and its `x` kept; via-token messages reaching it through two chains of one group merge into it too. Tests: Task 2 (merge and rank), Task 4 (ranking through a sibling chain's group), Task 5 (`top/sender.json` lists it once with its `x`).
3. **An address identity left with nothing after the move** is dropped from every ranking, and a partly moved one ranks by what is left, both in SQL (the top-N cut happens after netting) and in JS (`today.json`, finalize); the claimed list is one JSON parameter however long. Tests: Task 1 (`splitViaToken`), Task 4 (net SQL, and 150 claimed keys), Task 5 (`top/sender.json` and `today.json` without the wallet).
4. **Migration 0008 against a day the rollup writes again:** running the backfill over a finalized day, twice, and finalizing the day after it each leave exactly the rollup's rows, one per key; a day never rolled up gets none. The deploy-window race (an old Worker re-finalizing a day after the migration) is in the runbook with its fix. Tests: Task 3.
5. **" via its token" on a long name:** a 64-character project name with the suffix still fits 280 (the busiest lane drops first), still goes through `oneCashtag`, and Telegram keeps the line. Tests: Task 7.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/core/src/via-token.ts` (new) | 1, 3, 4 | Token group lookup, via-token keys, claims, credits, `splitViaToken`, the shared SQL |
| `packages/core/src/labels.ts` | 1 | `TokenLabels`, `buildTokenLabels`, `RegistryEntry.tokens` |
| `packages/core/src/senders.ts` | 2 | Credits in `mergeIdentities`, via-token totals, coverage, `taggableX`, `mostlyViaToken` |
| `packages/core/src/format.ts` | 2 | `labelCoverageLine`, the coverage wording the status page (a client island) and the candidates PR share |
| `packages/core/src/types.ts`, `rollup.ts` | 3 | The `via_token` dim and its rollup |
| `packages/core/src/public.ts` | 5, 6 | Optional identity, coverage and project fields |
| `scripts/build-labels.ts` | 1 | Writes `label-tokens.json`; `label-projects.json` carries tokens |
| `worker/migrations/0008_via_token.sql` (new) | 3 | The backfill |
| `worker/src/store.ts` | 3, 4 | Registry groups, credits, unlabeled senders net of credits |
| `worker/src/labels.ts`, `context.ts`, `test/helpers.ts` | 4 | `labelTokens` in the run context |
| `worker/src/senders.ts` | 4, 6 | The sender book's claims, credits in rankings, coverage, newcomers and arrivals |
| `worker/src/publish.ts` | 3, 4, 5 | Today's rollup, the day leaders, identity fields, `today.json` |
| `worker/src/projects.ts`, `moments.ts` | 6 | Project totals, series and tokens; the spotlight |
| `worker/src/jobs/finalize.ts` | 3 | Groups for the day's rollup |
| `worker/src/broadcasts/facts.ts`, `copy.ts` | 7 | " via its token" |
| `scripts/backfill/build.ts`, `scripts/backfill/fees/build.ts` | 3 | The new `rollupDay` argument |
| `scripts/label-candidates.ts` | 8 | Coverage with credits, "Tokens to claim" |
| `site/src/lib/senders.ts`, `top.ts`, `status-light.ts`, `styles/base.css` | 9 | The mark, the coverage line |
| `site/src/pages/top/[dim]/[window]/[...order].astro`, `day/[day].astro` | 9 | The mark on rows and the day's top sender |
| `site/worker/cards/broadcast-cards.ts`, `content.ts` | 9 | The mark on the daily card and the top card |
| `site/src/lib/projects.ts`, `pages/projects/[slug].astro`, `pages/projects/index.astro` | 10 | The split and the token list |
| `docs/methodology.md`, `docs/runbook.md` | 11 | Docs |

---

### Task 1: Token claims in core, and `label-tokens.json` from the label build

**Files:**
- Create: `packages/core/src/via-token.ts`, `packages/core/test/via-token.test.ts`
- Create (generated): `worker/src/generated/label-tokens.json`
- Modify: `packages/core/src/labels.ts`, `packages/core/src/index.ts`, `scripts/build-labels.ts`
- Modify (regenerated): `worker/src/generated/label-projects.json`
- Test: `packages/core/test/labels.test.ts`, `packages/core/test/via-token.test.ts`

**Interfaces:**
- **Consumes:** `SenderChains`, `SenderRow` (`packages/core/src/senders.ts`); `Label`, `ProjectRegistry`, `RegistryProject`, `labelKey` (`labels.ts`).
- **Produces** (all exported from `@ccip-dev/core`):
  - `type TokenLabels = Record<string, string>` (`<chainName>:<address>` to slug) and `buildTokenLabels(projects: readonly RegistryProject[]): TokenLabels`.
  - `RegistryEntry.tokens: { chain: string; address: string; source: string }[]` (chain is a CCIP name, address normalized).
  - `type TokenGroupOf = (chain: string, token: string) => string | null`, `NO_TOKEN_GROUPS: TokenGroupOf`, `tokenGroupLookup(groups: ReadonlyMap<string, string | null>): TokenGroupOf`, `viaTokenGroup(chain: string, token: string, groupOf: TokenGroupOf): string`.
  - `viaTokenKey(selector: string, sender: string, group: string): string`, `parseViaTokenKey(key: string): ViaTokenKeyParts` (`{ selector, address, senderKey, group }`).
  - `type TokenClaims = ReadonlyMap<string, Label>`, `claimedTokenKeys(tokenLabels: TokenLabels, chains: SenderChains): string[]`, `tokenClaims(tokenLabels: TokenLabels, projects: ProjectRegistry, chains: SenderChains, groups: ReadonlyMap<string, string | null>): TokenClaims`.
  - `interface ViaTokenCredit { selector: string; project: Label; messages: number; usd_value: number; fee_usd: number | null }`, `viaCreditKey(selector: string, group: string): string`, `viaTokenCredits(rows: readonly SenderRow[], claims: TokenClaims): ViaTokenCredit[]`.
  - `splitViaToken(senderRows: readonly SenderRow[], viaRows: readonly SenderRow[], claims: TokenClaims, labeled: ReadonlySet<string>): { senders: SenderRow[]; credits: SenderRow[] }`.
  - `interface RowSums { messages: number; usd: number; fee: number; anyFee: boolean }`, `emptyRowSums(): RowSums`, `addRowSums(sums: RowSums, row: { messages: number; usd_value: number; fee_usd: number | null }): void`.

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/labels.test.ts`, make the import `import { buildHandles, buildLabelIndex, buildProjectRegistry, buildTokenLabels, labelKey, toChecksumAddress, validateChainHandles, validateRegistry } from '../src/labels';`. In `'keeps each verified project by slug, with its link, source and lowercased addresses, and leaves drafts out'`, add `tokens: []` to the expected `maple` entry, after `addresses: [...]`. Append:

```ts
describe('token labels', () => {
  const SYRUP = '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b';
  const OTHER = '0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d';
  const tokenFile = (address: string, extra: string) =>
    `name = "Maple Finance"\nkind = "issuer"\n${extra}\n[[tokens]]\nchain = "ethereum-mainnet"\naddress = "${address}"\nsource = "https://docs.maple.finance/integrate"\n`;

  it("maps each verified project's tokens to its slug, with or without an x, and leaves drafts out", () => {
    // #given Maple has no x; the draft has one but is not verified
    const { projects } = validateRegistry(
      [{ file: 'maple.toml', text: tokenFile(SYRUP, 'verified = true') }, { file: '_draft.toml', text: tokenFile(OTHER, 'x = "draft"\nverified = false') }],
      chains,
    );
    // #then
    expect(buildTokenLabels(projects)).toEqual({ [`ethereum-mainnet:${SYRUP}`]: 'maple' });
  });

  it("carries each verified project's tokens in the registry, for its page", () => {
    // #given
    const { projects } = validateRegistry([{ file: 'maple.toml', text: tokenFile(SYRUP, 'verified = true') }], chains);
    // #then
    expect(buildProjectRegistry(projects).maple?.tokens).toEqual([{ chain: 'ethereum-mainnet', address: SYRUP, source: 'https://docs.maple.finance/integrate' }]);
  });
});
```

Create `packages/core/test/via-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Label, ProjectRegistry, RegistryEntry, TokenLabels } from '../src/labels';
import type { SenderChains } from '../src/senders';
import {
  claimedTokenKeys, NO_TOKEN_GROUPS, parseViaTokenKey, splitViaToken, tokenClaims, tokenGroupLookup, viaTokenCredits, viaTokenGroup, viaTokenKey, type TokenClaims,
} from '../src/via-token';

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const CHAINS: SenderChains = new Map([
  [ETH, { name: 'ethereum-mainnet', family: 'EVM' }],
  [BASE, { name: 'ethereum-mainnet-base-1', family: 'EVM' }],
]);
const SYRUP_ETH = '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b';
const SYRUP_BASE = '0x660975730059246a68521a3e2fbd4740173100f5';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const entry = (name: string, x: string | null): RegistryEntry => ({ name, x, url: null, kind: 'issuer', source: null, addresses: [], tokens: [] });
const PROJECTS: ProjectRegistry = { maple: entry('Maple Finance', 'maplefinance'), rival: entry('Rival', null) };
const MAPLE: Label = { name: 'Maple Finance', x: 'maplefinance', kind: 'issuer', slug: 'maple' };
const RIVAL: Label = { name: 'Rival', kind: 'issuer', slug: 'rival' };
const ON_ETHEREUM: TokenLabels = { [`ethereum-mainnet:${SYRUP_ETH}`]: 'maple' };
const GROUPS = new Map([[`${ETH}:${SYRUP_ETH}`, 'g-syrup'], [`${BASE}:${SYRUP_BASE}`, 'g-syrup'], [`${BASE}:${USDC_BASE}`, 'g-usdc']]);
/** The claim a message's first token reaches: its registry group, or the token itself when it has none. */
const claimOf = (claims: TokenClaims, chain: string, token: string) => claims.get(viaTokenGroup(chain, token, tokenGroupLookup(GROUPS)));

describe('token claims', () => {
  it('claims a token outside the registry by its exact chain and address', () => {
    // #given the entry's token has no registry row, so its messages are keyed by the token itself
    const claims = tokenClaims(ON_ETHEREUM, PROJECTS, CHAINS, new Map());
    // #then
    expect(claims.get(viaTokenGroup(ETH, SYRUP_ETH, NO_TOKEN_GROUPS))).toEqual(MAPLE);
  });

  it("claims the token on a sibling chain through the entry's registry group", () => {
    // #given the entry names the Ethereum token, and the message moves its Base sibling
    const claims = tokenClaims(ON_ETHEREUM, PROJECTS, CHAINS, GROUPS);
    // #then
    expect(claimOf(claims, BASE, SYRUP_BASE)).toEqual(MAPLE);
  });

  it('claims nothing for a token no entry names, grouped or not', () => {
    // #given
    const claims = tokenClaims(ON_ETHEREUM, PROJECTS, CHAINS, GROUPS);
    // #then
    expect([claimOf(claims, BASE, USDC_BASE), claimOf(claims, BASE, '0x00000000000000000000000000000000000000ff')]).toEqual([undefined, undefined]);
  });

  it('leaves out a group two projects claim, and keeps each exact token', () => {
    // #given Rival names the Base sibling of Maple's token
    const claims = tokenClaims({ ...ON_ETHEREUM, [`ethereum-mainnet-base-1:${SYRUP_BASE}`]: 'rival' }, PROJECTS, CHAINS, GROUPS);
    // #then
    expect([claims.has('g-syrup'), claims.get(`${ETH}:${SYRUP_ETH}`), claims.get(`${BASE}:${SYRUP_BASE}`)]).toEqual([false, MAPLE, RIVAL]);
  });

  it('skips an entry on a chain the chains table does not know, or of a project the registry lacks', () => {
    // #when
    const claims = tokenClaims({ [`monad-mainnet:${SYRUP_ETH}`]: 'maple', [`ethereum-mainnet-base-1:${USDC_BASE}`]: 'gone' }, PROJECTS, CHAINS, GROUPS);
    // #then
    expect(claims.size).toBe(0);
  });

  it("asks the registry for each known entry's group by selector and address", () => {
    // #then
    expect(claimedTokenKeys({ ...ON_ETHEREUM, [`monad-mainnet:${SYRUP_ETH}`]: 'maple' }, CHAINS)).toEqual([`${ETH}:${SYRUP_ETH}`]);
  });
});

describe('via-token keys', () => {
  it('keys a direct send by sender and group, and reads back a fallback group that holds a colon', () => {
    // #when
    const key = viaTokenKey(BASE, '0xwallet', viaTokenGroup(BASE, '0xloose', NO_TOKEN_GROUPS));
    // #then
    expect({ key, parts: parseViaTokenKey(key) }).toEqual({
      key: `${BASE}:0xwallet|${BASE}:0xloose`,
      parts: { selector: BASE, address: '0xwallet', senderKey: `${BASE}:0xwallet`, group: `${BASE}:0xloose` },
    });
  });
});

describe('via-token credits', () => {
  const claims = tokenClaims(ON_ETHEREUM, PROJECTS, CHAINS, GROUPS);
  const row = (key: string, messages: number, fee_usd: number | null = null) => ({ key, messages, usd_value: messages * 10, fee_usd });

  it("gives each claimed group's credit row its project, and drops the rest", () => {
    // #then
    expect(viaTokenCredits([row(`${BASE}|g-syrup`, 6, 0.6), row(`${BASE}|g-usdc`, 9)], claims)).toEqual([
      { selector: BASE, project: MAPLE, messages: 6, usd_value: 60, fee_usd: 0.6 },
    ]);
  });

  it('moves the claimed direct sends of unlabeled senders to credit rows, keeps the rest, and drops a sender with nothing left', () => {
    // #given W1 only bridged syrup; W2 bridged syrup once and USDC once of its 3; the labeled W3 bridged syrup twice
    const senders = [row(`${BASE}:0xw1`, 5, 0.5), row(`${BASE}:0xw2`, 3), row(`${BASE}:0xw3`, 2)];
    const via = [row(`${BASE}:0xw1|g-syrup`, 5, 0.5), row(`${BASE}:0xw2|g-syrup`, 1), row(`${BASE}:0xw2|g-usdc`, 1), row(`${BASE}:0xw3|g-syrup`, 2)];
    // #when
    const split = splitViaToken(senders, via, claims, new Set(['0xw3']));
    // #then
    expect(split).toEqual({
      senders: [row(`${BASE}:0xw2`, 2), row(`${BASE}:0xw3`, 2)],
      credits: [{ key: `${BASE}|g-syrup`, messages: 6, usd_value: 60, fee_usd: 0.5 }],
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/labels.test.ts test/via-token.test.ts`
Expected: FAIL (`buildTokenLabels` is not exported; `../src/via-token` does not exist).

- [ ] **Step 3: Token labels and registry tokens in `labels.ts`**

In `packages/core/src/labels.ts`, add after `buildLabelIndex`:

```ts
/** `<chainName>:<address>` of each verified project's `[[tokens]]` entry, to the project's slug. */
export type TokenLabels = Record<string, string>;

/** Every verified project's tokens, with or without an `x`: crediting direct sends needs the verified claim, tagging still needs the `x`. */
export function buildTokenLabels(projects: readonly RegistryProject[]): TokenLabels {
  const index: TokenLabels = {};
  for (const p of projects) {
    if (!p.verified) continue;
    for (const { chain, address } of p.tokens) index[labelKey(chain, address)] = p.slug;
  }
  return index;
}
```

In `RegistryEntry`, after `addresses: …;`, add:

```ts
  /** Its `[[tokens]]` entries, which the project page lists. */
  tokens: { chain: string; address: string; source: string }[];
```

In `buildProjectRegistry`, after the `addresses: …` line, add:

```ts
          tokens: p.tokens.map((t) => ({ chain: t.chain, address: normalizeAddress(t.address), source: t.source })),
```

- [ ] **Step 4: Create `packages/core/src/via-token.ts`**

```ts
import type { Label, ProjectRegistry, TokenLabels } from './labels';
import type { SenderChains, SenderRow } from './senders';

/** A token's registry group id by its chain selector and address as message_tokens stores them; null for none. */
export type TokenGroupOf = (chain: string, token: string) => string | null;

/** For a rollup whose groups don't matter: tests that read only totals, and the fee backfill, whose rollup carries no tokens. */
export const NO_TOKEN_GROUPS: TokenGroupOf = () => null;

/** `groups` is keyed `<selector>:<address>`, as REGISTRY_GROUPS_SQL returns it; a token missing from it has no group. */
export function tokenGroupLookup(groups: ReadonlyMap<string, string | null>): TokenGroupOf {
  return (chain, token) => groups.get(`${chain}:${token}`) ?? null;
}

/** The token's registry group, or for a token with none, or outside the registry, its own `<chain>:<address>`. */
export function viaTokenGroup(chain: string, token: string, groupOf: TokenGroupOf): string {
  return groupOf(chain, token) ?? `${chain}:${token}`;
}

/** daily_breakdown's via_token key. */
export const viaTokenKey = (selector: string, sender: string, group: string): string => `${selector}:${sender}|${group}`;

export interface ViaTokenKeyParts {
  selector: string;
  address: string;
  /** `<selector>:<address>`, as the sender dimension keys the same sender. */
  senderKey: string;
  group: string;
}

/** Selectors hold no colon and addresses no bar, so the first of each splits the key, even when the group is `<chain>:<address>`. */
export function parseViaTokenKey(key: string): ViaTokenKeyParts {
  const colon = key.indexOf(':');
  const bar = key.indexOf('|');
  return { selector: key.slice(0, colon), address: key.slice(colon + 1, bar), senderKey: key.slice(0, bar), group: key.slice(bar + 1) };
}

/** The project each via-token group key is credited to: an entry's own `<selector>:<address>`, and its registry group. */
export type TokenClaims = ReadonlyMap<string, Label>;

const entryChain = (key: string) => key.slice(0, key.indexOf(':'));
const entryAddress = (key: string) => key.slice(key.indexOf(':') + 1);
const selectorsByName = (chains: SenderChains) => new Map([...chains].map(([selector, chain]) => [chain.name, selector]));

/** Each entry on a chain the chains table knows, as `<selector>:<address>`: the keys whose registry groups a claim needs. */
export function claimedTokenKeys(tokenLabels: TokenLabels, chains: SenderChains): string[] {
  const selectorOf = selectorsByName(chains);
  return Object.keys(tokenLabels)
    .flatMap((key) => {
      const selector = selectorOf.get(entryChain(key));
      return selector === undefined ? [] : [`${selector}:${entryAddress(key)}`];
    })
    .sort();
}

/**
 * A first token is claimed when its own `<selector>:<address>` is an entry, which covers tokens outside the registry, or
 * when its registry group is the group of an entry's token, which covers every chain of the group. A key two projects
 * claim is left out: whose it is is unknown.
 */
export function tokenClaims(tokenLabels: TokenLabels, projects: ProjectRegistry, chains: SenderChains, groups: ReadonlyMap<string, string | null>): TokenClaims {
  const selectorOf = selectorsByName(chains);
  const claims = new Map<string, Label>();
  const contested = new Set<string>();
  const claim = (key: string, label: Label) => {
    const held = claims.get(key);
    if (held !== undefined && held.slug !== label.slug) contested.add(key);
    else claims.set(key, label);
  };
  for (const [key, slug] of Object.entries(tokenLabels)) {
    const entry = projects[slug];
    const selector = selectorOf.get(entryChain(key));
    if (entry === undefined || selector === undefined) continue;
    const label: Label = { name: entry.name, ...(entry.x ? { x: entry.x } : {}), kind: entry.kind, slug };
    const exact = `${selector}:${entryAddress(key)}`;
    claim(exact, label);
    const group = groups.get(exact);
    if (group) claim(group, label);
  }
  for (const key of contested) claims.delete(key);
  return claims;
}

/** One source chain's claimed direct sends, credited to the project that claims the token. */
export interface ViaTokenCredit {
  selector: string;
  project: Label;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

/** A credit row's key: one source chain's direct sends of one group, summed over the senders no label names. */
export const viaCreditKey = (selector: string, group: string): string => `${selector}|${group}`;

/** Credit rows keyed `<selector>|<group>`, each with the project that claims its group; a group no project claims credits nobody. */
export function viaTokenCredits(rows: readonly SenderRow[], claims: TokenClaims): ViaTokenCredit[] {
  return rows.flatMap((r) => {
    const bar = r.key.indexOf('|');
    const project = claims.get(r.key.slice(bar + 1));
    return project === undefined ? [] : [{ selector: r.key.slice(0, bar), project, messages: r.messages, usd_value: r.usd_value, fee_usd: r.fee_usd }];
  });
}

export interface RowSums {
  messages: number;
  usd: number;
  fee: number;
  anyFee: boolean;
}

export const emptyRowSums = (): RowSums => ({ messages: 0, usd: 0, fee: 0, anyFee: false });

export function addRowSums(sums: RowSums, row: { messages: number; usd_value: number; fee_usd: number | null }): void {
  sums.messages += row.messages;
  sums.usd += row.usd_value;
  if (row.fee_usd !== null) {
    sums.fee += row.fee_usd;
    sums.anyFee = true;
  }
}

/**
 * Moves the claimed direct sends of senders no label names out of their sender rows: a row keeps what is left, a row
 * with nothing left is dropped, and the moved part comes back as credit rows. `senderRows` holds one row per key, as one
 * day's breakdown does.
 */
export function splitViaToken(
  senderRows: readonly SenderRow[],
  viaRows: readonly SenderRow[],
  claims: TokenClaims,
  labeled: ReadonlySet<string>,
): { senders: SenderRow[]; credits: SenderRow[] } {
  const moved = new Map<string, RowSums>();
  const credited = new Map<string, RowSums>();
  const into = (sums: Map<string, RowSums>, key: string) => {
    const found = sums.get(key);
    if (found !== undefined) return found;
    const created = emptyRowSums();
    sums.set(key, created);
    return created;
  };
  for (const row of viaRows) {
    const { selector, address, senderKey, group } = parseViaTokenKey(row.key);
    if (!claims.has(group) || labeled.has(address)) continue;
    addRowSums(into(moved, senderKey), row);
    addRowSums(into(credited, viaCreditKey(selector, group)), row);
  }
  const senders = senderRows.flatMap((row): SenderRow[] => {
    const part = moved.get(row.key);
    if (part === undefined) return [row];
    const messages = row.messages - part.messages;
    return messages > 0 ? [{ key: row.key, messages, usd_value: row.usd_value - part.usd, fee_usd: row.fee_usd === null ? null : row.fee_usd - part.fee }] : [];
  });
  const credits = [...credited].map(([key, s]) => ({ key, messages: s.messages, usd_value: s.usd, fee_usd: s.anyFee ? s.fee : null }));
  return { senders, credits };
}
```

In `packages/core/src/index.ts`, add `export * from './via-token';` after `export * from './senders';`.

- [ ] **Step 5: Write `label-tokens.json` from the label build**

In `scripts/build-labels.ts`, add `buildTokenLabels` to the `@ccip-dev/core` import, and after the `label-projects.json` lines add:

```ts
  const tokenLabels = buildTokenLabels(projects);
  await writeFile(path.join(generated, 'label-tokens.json'), `${JSON.stringify(tokenLabels, null, 2)}\n`);
  console.log(`wrote ${Object.keys(tokenLabels).length} claimed token(s) to worker/src/generated/label-tokens.json`);
```

- [ ] **Step 6: Run the tests, check and build the labels**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/labels.test.ts test/via-token.test.ts && pnpm labels:check && pnpm labels:build`
Expected: PASS; `labels ok: …`; `wrote 10 claimed token(s) to worker/src/generated/label-tokens.json` (Aave 1, Huma 1, Lido 1, Kinetiq 1, Maple 5, Saturn 1). `git diff --stat worker/src/generated/` shows `label-projects.json` gaining `tokens` arrays and no change to `labels.json` or `handles.json`.

- [ ] **Step 7: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add packages/core/src/via-token.ts packages/core/src/labels.ts packages/core/src/index.ts packages/core/test/via-token.test.ts packages/core/test/labels.test.ts \
  scripts/build-labels.ts worker/src/generated/label-tokens.json worker/src/generated/label-projects.json
git commit -m "feat(labels): claim tokens for their projects, by exact address or registry group

label-tokens.json maps each verified project's [[tokens]] entry to its slug, with no x
needed, and label-projects.json lists the tokens for the project pages. Core resolves
claims and splits a day's direct sends, so later tasks credit them via the token.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Identity merge with credits, coverage, and the coverage line

**Files:**
- Modify: `packages/core/src/senders.ts`, `packages/core/src/format.ts`
- Test: `packages/core/test/senders.test.ts`, `packages/core/test/format.test.ts`

**Interfaces:**
- **Consumes:** `ViaTokenCredit`, `RowSums`, `emptyRowSums`, `addRowSums` (Task 1).
- **Produces:**
  - `mergeIdentities(rows: readonly SenderRow[], resolve: IdentityResolver, credits: readonly ViaTokenCredit[] = []): IdentityTotals[]`.
  - `IdentityTotals` gains `via_token_messages: number`, `via_token_usd: number`, `via_token_fee_usd: number | null`, `via_token: boolean`. `messages`, `usd_value` and `fee_usd` include them. `addresses` and `keys` count sender rows only (a via-token-only identity has 0 and `[]`); `chains` includes the credits' source chains.
  - `LabelCoverage` gains `via_token_messages_pct`, `via_token_usd_pct`, `via_token_fees_pct` (each `number | null`).
  - `taggableX(i: Pick<IdentityTotals, 'x' | 'inferred' | 'via_token'>): string | null`.
  - `mostlyViaToken(messages: number, viaTokenMessages: number | undefined): boolean` (true at 50% or more).
  - In `packages/core/src/format.ts` (`@ccip-dev/core/format`, which the status page's client island already loads without zod or the label code): `interface CoverageShares { messages_pct: number | null; usd_pct: number | null; via_token_messages_pct?: number | null }` and `labelCoverageLine(c: CoverageShares | null | undefined): string | null`.

**Ruling (spec §3, "Its inferred stays as it is"):** `inferred` is computed from the sender rows alone: true when the identity has sender rows and every one came through a spread label. Credits never make an identity inferred or un-inferred.

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/senders.test.ts`, make the senders import `import { identityResolver, kindPhrase, labelCoverage, labeledAddresses, mergeIdentities, mostlyViaToken, newcomerPicks, newcomerSpan, newcomerSpanWords, parseSenderKey, projectAddresses, rankIdentities, sharePct, taggableX, type SenderChains } from '../src/senders';` and add `import type { ViaTokenCredit } from '../src/via-token';`.

Update the existing expectations:
- `"credits xStocks with 319 of 2026-10-13's 1,569 messages (20.3%), across six chains and two addresses"`: add `via_token_messages: 0, via_token_usd: 0, via_token_fee_usd: null, via_token: false,` after `messages: 319, usd_value: 0, fee_usd: 79.75,`.
- `"is the labeled identities' share of the window's messages, value and fees"`: expect `{ messages_pct: 20.3, usd_pct: 0, fees_pct: 20.3, via_token_messages_pct: 0, via_token_usd_pct: 0, via_token_fees_pct: 0, window: '7d' }`.
- `'counts a project credited through a spread label as labeled'`: expect `{ messages_pct: 75, usd_pct: 75, fees_pct: 50, via_token_messages_pct: 0, via_token_usd_pct: 0, via_token_fees_pct: 0, window: '7d' }`.
- `'has no shares for an empty window, never NaN'`: expect `{ messages_pct: null, usd_pct: null, fees_pct: null, via_token_messages_pct: null, via_token_usd_pct: null, via_token_fees_pct: null, window: '7d' }`.

Append:

```ts
const ELIZA: Label = { name: 'elizaOS', x: 'elizaOS', kind: 'protocol', slug: 'eliza' };
const credit = (selector: string, project: Label, messages: number, usd_value = 0, fee_usd: number | null = null): ViaTokenCredit => ({ selector, project, messages, usd_value, fee_usd });

describe('credits in the merge', () => {
  it("adds a project's credits to its own sends: one identity with both parts, its chains and its handle", () => {
    // #given Maple sent 5 from its Ethereum contract, and wallets bridged its token 3 times from Base
    const merged = mergeIdentities([row(ETH, ADDR, 5, 50, 1)], identityResolver(ON_ETHEREUM, CHAINS), [credit(BASE, MAPLE, 3, 30, 0.5)]);
    // #then
    expect(merged.map((i) => ({ ...i, tag: taggableX(i) }))).toEqual([
      expect.objectContaining({
        key: 'project:maple-finance', messages: 8, usd_value: 80, fee_usd: 1.5, via_token_messages: 3, via_token_usd: 30, via_token_fee_usd: 0.5,
        via_token: false, inferred: false, chains: [ETH, BASE], addresses: 1, keys: [`${ETH}:${ADDR}`], tag: 'maplefinance',
      }),
    ]);
  });

  it('marks an identity of credits alone via token, not inferred, with no address and no handle to tag', () => {
    // #when
    const [eliza] = mergeIdentities([], identityResolver({}, CHAINS), [credit(BASE, ELIZA, 4), credit(ETH, ELIZA, 2)]);
    // #then
    expect({ via: eliza!.via_token, inferred: eliza!.inferred, messages: eliza!.messages, addresses: eliza!.addresses, chains: eliza!.chains, tag: taggableX(eliza!) }).toEqual({
      via: true, inferred: false, messages: 6, addresses: 0, chains: [BASE, ETH], tag: null,
    });
  });

  it("keeps the inferred mark of a project whose own rows all came through a spread label", () => {
    // #when
    const [maple] = mergeIdentities([row(BASE, ADDR, 3)], identityResolver(ON_ETHEREUM, CHAINS), [credit(BASE, MAPLE, 2)]);
    // #then
    expect([maple!.inferred, maple!.via_token, taggableX(maple!)]).toEqual([true, false, null]);
  });

  it('ranks a project with credits once, by its sends and credits together', () => {
    // #when
    const ranked = rankIdentities(mergeIdentities([row(ETH, ADDR, 5), row(BASE, '0xb', 7)], identityResolver(ON_ETHEREUM, CHAINS), [credit(BASE, MAPLE, 3)]), 'messages', 5);
    // #then
    expect(ranked.map((i) => [i.key, i.messages])).toEqual([['project:maple-finance', 8], ['address:0xb', 7]]);
  });
});

describe('mostlyViaToken', () => {
  it.each([
    [10, 5, true],
    [10, 4, false],
    [10, undefined, false],
    [0, 0, false],
  ] as const)('%i messages with %s via token: %s', (messages, via, mostly) => {
    // #then
    expect(mostlyViaToken(messages, via)).toBe(mostly);
  });
});

describe('label coverage via token', () => {
  it('counts credits as labeled, and reports the part that came via a token', () => {
    // #given Maple 3 of 8 messages through its label, elizaOS 4 via its token, one unlabeled address
    const identities = mergeIdentities([row(ETH, ADDR, 3, 30, 1), row(BASE, '0xb', 1, 10, 1)], identityResolver(ON_ETHEREUM, CHAINS), [credit(BASE, ELIZA, 4, 40, 2)]);
    // #then
    expect(labelCoverage(identities, { messages: 8, usd_value: 80, fee_usd: 4 })).toEqual({
      messages_pct: 87.5, usd_pct: 87.5, fees_pct: 75, via_token_messages_pct: 50, via_token_usd_pct: 50, via_token_fees_pct: 50, window: '7d',
    });
  });
});

```

In `packages/core/test/format.test.ts`, add `labelCoverageLine` to the `../src/format` import and append:

```ts
describe('the coverage line', () => {
  it.each([
    [{ messages_pct: 74.2, usd_pct: 61.3, via_token_messages_pct: 45.1 }, 'Labeled: 74% of messages (29% sent by a labeled project, 45% via its token), 61% of value (last 7 days)'],
    [{ messages_pct: 30, usd_pct: null, via_token_messages_pct: 0 }, 'Labeled: 30% of messages (30% sent by a labeled project, 0% via its token) (last 7 days)'],
    [{ messages_pct: 81.2, usd_pct: 94.4 }, 'Labeled senders: 81% of messages, 94% of value (last 7 days)'],
    [{ messages_pct: null, usd_pct: null }, null],
    [null, null],
  ])('words %o as %j', (coverage, line) => {
    // #then
    expect(labelCoverageLine(coverage)).toBe(line);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/senders.test.ts test/format.test.ts`
Expected: FAIL (`taggableX`, `mostlyViaToken` and `labelCoverageLine` are not exported; no via-token fields).

- [ ] **Step 3: Merge credits, and the new helpers**

In `packages/core/src/senders.ts`:

1. Add an import below the existing ones:

```ts
import { addRowSums, emptyRowSums, type RowSums, type ViaTokenCredit } from './via-token';
```

2. In `IdentityTotals`, after `fee_usd: number | null;`, add:

```ts
  /** Messages credited through a claimed token: wallets bridging it through CCIP themselves. `messages` includes them. */
  via_token_messages: number;
  via_token_usd: number;
  via_token_fee_usd: number | null;
  /** Every one of its messages came via its token. */
  via_token: boolean;
```

and change the `inferred` doc comment to `/** It has sender rows, and every one came through a spread label. */`.

3. Replace `interface Group`, `mergeIdentities` and `totalsOf` with:

```ts
interface Group {
  identity: SenderIdentity;
  /** It has sender rows, not only credits. */
  sent: boolean;
  allInferred: boolean;
  all: RowSums;
  via: RowSums;
  chains: Map<string, number>;
  addresses: Set<string>;
  keys: Set<string>;
}

/**
 * Sums sender rows by identity; one key's rows from several days add up. Credits add a claimed token's direct sends to
 * its project, so a project that also sends from its own addresses is still one identity.
 */
export function mergeIdentities(rows: readonly SenderRow[], resolve: IdentityResolver, credits: readonly ViaTokenCredit[] = []): IdentityTotals[] {
  const groups = new Map<string, Group>();
  const groupOf = (identity: SenderIdentity): Group => {
    let group = groups.get(identity.key);
    if (group === undefined) {
      group = { identity, sent: false, allInferred: true, all: emptyRowSums(), via: emptyRowSums(), chains: new Map(), addresses: new Set(), keys: new Set() };
      groups.set(identity.key, group);
    }
    return group;
  };
  for (const row of rows) {
    const selector = row.key.slice(0, row.key.indexOf(':'));
    const address = senderKeyAddress(row.key);
    const identity = resolve(selector, address);
    const group = groupOf(identity);
    group.sent = true;
    group.allInferred &&= identity.inferred;
    addRowSums(group.all, row);
    group.chains.set(selector, (group.chains.get(selector) ?? 0) + row.messages);
    group.addresses.add(senderAddress(address));
    group.keys.add(row.key);
  }
  for (const credit of credits) {
    const group = groupOf({ key: projectKey(credit.project.slug), project: credit.project, inferred: false });
    addRowSums(group.all, credit);
    addRowSums(group.via, credit);
    group.chains.set(credit.selector, (group.chains.get(credit.selector) ?? 0) + credit.messages);
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
    inferred: project !== null && g.sent && g.allInferred,
    messages: g.all.messages,
    usd_value: g.all.usd,
    fee_usd: g.all.anyFee ? g.all.fee : null,
    via_token_messages: g.via.messages,
    via_token_usd: g.via.usd,
    via_token_fee_usd: g.via.anyFee ? g.via.fee : null,
    via_token: g.via.messages > 0 && g.via.messages === g.all.messages,
    chains: [...g.chains].sort(([a, x], [b, y]) => y - x || byName(a, b)).map(([selector]) => selector),
    addresses: g.addresses.size,
    keys: [...g.keys],
  };
}

/** The handle a post may tag: a verified project's, unless its label was spread or none of its messages were its own sends. */
export function taggableX(i: Pick<IdentityTotals, 'x' | 'inferred' | 'via_token'>): string | null {
  return i.inferred || i.via_token ? null : i.x;
}

/** Half or more of the identity's messages came via its token, so a post names it "via its token". */
export function mostlyViaToken(messages: number, viaTokenMessages: number | undefined): boolean {
  return messages > 0 && (viaTokenMessages ?? 0) * 2 >= messages;
}
```

4. Replace `LabelCoverage` and `labelCoverage` with:

```ts
export interface LabelCoverage {
  messages_pct: number | null;
  usd_pct: number | null;
  fees_pct: number | null;
  /** The part of each share credited via a claimed token; each is included in its share above. */
  via_token_messages_pct: number | null;
  via_token_usd_pct: number | null;
  via_token_fees_pct: number | null;
  window: '7d';
}

/** How much of a window the labeled identities (verified, inferred or credited via a token) account for. */
export function labelCoverage(identities: readonly IdentityTotals[], totals: { messages: number; usd_value: number; fee_usd: number | null }): LabelCoverage {
  const labeled = identities.filter((i) => i.slug !== null);
  const sum = (pick: (i: IdentityTotals) => number) => labeled.reduce((s, i) => s + pick(i), 0);
  return {
    messages_pct: sharePct(sum((i) => i.messages), totals.messages),
    usd_pct: sharePct(sum((i) => i.usd_value), totals.usd_value),
    fees_pct: sharePct(sum((i) => i.fee_usd ?? 0), totals.fee_usd),
    via_token_messages_pct: sharePct(sum((i) => i.via_token_messages), totals.messages),
    via_token_usd_pct: sharePct(sum((i) => i.via_token_usd), totals.usd_value),
    via_token_fees_pct: sharePct(sum((i) => i.via_token_fee_usd ?? 0), totals.fee_usd),
    window: '7d',
  };
}
```

5. Append to `packages/core/src/format.ts`:

```ts
/** The label coverage shares a coverage line words; coverage stored before via token has no via-token share. */
export interface CoverageShares {
  messages_pct: number | null;
  usd_pct: number | null;
  via_token_messages_pct?: number | null;
}

/**
 * The status page's coverage line, which the candidates pull request leads with too. Coverage stored before via token
 * keeps the older wording; null when the window had no messages.
 */
export function labelCoverageLine(c: CoverageShares | null | undefined): string | null {
  if (!c || c.messages_pct === null) return null;
  const value = c.usd_pct === null ? '' : `, ${formatShare(c.usd_pct)} of value`;
  const via = c.via_token_messages_pct;
  if (via === undefined || via === null) return `Labeled senders: ${formatShare(c.messages_pct)} of messages${value} (last 7 days)`;
  return `Labeled: ${formatShare(c.messages_pct)} of messages (${formatShare(c.messages_pct - via)} sent by a labeled project, ${formatShare(via)} via its token)${value} (last 7 days)`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/senders.test.ts test/format.test.ts test/via-token.test.ts`
Expected: PASS.

- [ ] **Step 5: Run everything and commit**

`status.json` still parses `label_coverage` through `LabelCoverageSchema`, which strips the new keys until Task 5 adds them, so the Worker's coverage test stays as it is.

```bash
pnpm test && pnpm typecheck
git add packages/core/src/senders.ts packages/core/src/format.ts packages/core/test/senders.test.ts packages/core/test/format.test.ts
git commit -m "feat(core): merge via-token credits into their project's identity

An identity carries its via-token messages, value and fees inside its totals, is marked
via_token when all of them came that way, and has no handle to tag then; label coverage
reports the via-token part, and labelCoverageLine words it for the status page and the PR.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `via_token` dimension: the rollup, finalize, today and migration 0008

**Files:**
- Create: `worker/migrations/0008_via_token.sql`, `worker/test/via-token.test.ts`
- Modify: `packages/core/src/types.ts`, `packages/core/src/rollup.ts`, `packages/core/src/via-token.ts`
- Modify: `worker/src/store.ts`, `worker/src/jobs/finalize.ts`, `worker/src/publish.ts` (`rollupToday` only)
- Modify: `scripts/backfill/build.ts`, `scripts/backfill/fees/build.ts`
- Modify (call sites): `packages/core/test/rollup.test.ts`, `worker/test/finalize.test.ts`, `worker/test/store.test.ts`, `scripts/test/build.test.ts`
- Test: `packages/core/test/rollup.test.ts`, `worker/test/via-token.test.ts`

**Interfaces:**
- **Consumes:** `TokenGroupOf`, `NO_TOKEN_GROUPS`, `tokenGroupLookup`, `viaTokenGroup`, `viaTokenKey` (Task 1).
- **Produces:**
  - `Dim` gains `'via_token'`.
  - `rollupDay(day: string, messages: MessageRow[], tokens: TokenRow[], tokenGroup: TokenGroupOf): DayRollup`, which adds a `via_token` row per `(src_chain, sender, group)` for direct sends with a first token (messages, `usd_value`, `fee_usd` as the sender dim sums them).
  - `REGISTRY_GROUPS_SQL` (core): `key` (`<selector>:<address>`) and `group_id` for the JSON list `?1`.
  - `store.registryGroups(db: D1Database, keys: readonly string[]): Promise<Map<string, string | null>>`.
  - `store.firstTokenGroups(db: D1Database, tokens: readonly TokenRow[]): Promise<TokenGroupOf>`.

**Ruling:** `rollupDay`'s group lookup is a required argument, so no caller can write a token-keyed row for a grouped token by forgetting it. The backfill build passes the registry it already fetched; the fee backfill passes `NO_TOKEN_GROUPS` with no tokens, so it writes no `via_token` rows (its `FEE_DIMS` update loop leaves them alone).

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/rollup.test.ts`, add `import { NO_TOKEN_GROUPS, type TokenGroupOf } from '../src/via-token';`, and give every existing `rollupDay(` call a fourth argument `NO_TOKEN_GROUPS`:
- `const { totals, breakdown } = rollupDay('2026-10-05', messages, tokens, NO_TOKEN_GROUPS);`
- `expect(rollupDay('2026-10-05', [row('a')], [], NO_TOKEN_GROUPS).totals.fee_usd).toBeNull();`
- in `'counts the same address on two source chains as two unique senders'`, the closing `], []);` becomes `], [], NO_TOKEN_GROUPS);`
- `expect(rollupDay('2026-10-05', all, [], NO_TOKEN_GROUPS).totals.messages).toBe(1);` and `expect(rollupDay('2026-10-06', all, [], NO_TOKEN_GROUPS).totals.messages).toBe(1);`

Then append:

```ts
describe('rollupDay via token', () => {
  const W = '0xw';
  const direct = (id: string, overrides: Partial<MessageRow> = {}) => row(id, { sender: W, origin: W, token_count: 1, ...overrides });
  const first = (id: string, token: string, idx = 0): TokenRow => ({ message_id: id, idx, chain: 'A', token, amount: '1', usd_value: null });
  const groupOf: TokenGroupOf = (chain, token) => (chain === 'A' && token === '0xeliza' ? 'g-eliza' : null);
  const viaRows = (messages: MessageRow[], tokens: TokenRow[]) =>
    rollupDay('2026-10-05', messages, tokens, groupOf)
      .breakdown.filter((b) => b.dim === 'via_token')
      .map(({ key, messages: count, usd_value, fee_usd }) => ({ key, messages: count, usd_value, fee_usd }));

  it("keys a wallet's direct sends by their first token's registry group", () => {
    // #then
    expect(viaRows([direct('d1', { usd_value: 10, fee_usd: 1 }), direct('d2', { usd_value: 20 })], [first('d1', '0xeliza'), first('d2', '0xeliza')])).toEqual([
      { key: 'A:0xw|g-eliza', messages: 2, usd_value: 30, fee_usd: 1 },
    ]);
  });

  it('keys a token with no registry group by its own chain and address', () => {
    // #then
    expect(viaRows([direct('d1')], [first('d1', '0xloose')]).map((r) => r.key)).toEqual(['A:0xw|A:0xloose']);
  });

  it('keys a message by its first token only', () => {
    // #then
    expect(viaRows([direct('d1')], [first('d1', '0xloose', 1), first('d1', '0xeliza', 0)]).map((r) => r.key)).toEqual(['A:0xw|g-eliza']);
  });

  it("never keys an app contract's send, a message with no origin, or one with no token", () => {
    // #given
    const messages = [direct('app', { sender: '0xapp' }), direct('no-origin', { origin: null }), direct('data', { token_count: 0 })];
    // #then
    expect(viaRows(messages, [first('app', '0xeliza'), first('no-origin', '0xeliza')])).toEqual([]);
  });

  it('leaves the sender row whole', () => {
    // #when
    const { breakdown } = rollupDay('2026-10-05', [direct('d1', { usd_value: 10 }), direct('d2')], [first('d1', '0xeliza')], groupOf);
    // #then
    expect(breakdown.find((b) => b.dim === 'sender')).toMatchObject({ key: 'A:0xw', messages: 2, usd_value: 10 });
  });
});
```

Create `worker/test/via-token.test.ts`:

```ts
import { rollupDay } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { liveRow, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const BASE = NETWORKS.base.chainSelector;
const GROUP = 'group-eliza';
const ELIZA_BASE = '0x00000000000000000000000000000000000e1a01';
const LOOSE = '0x00000000000000000000000000000000000b0001';
const WALLET = '0x00000000000000000000000000000000000c0001';
const APP = '0x00000000000000000000000000000000000d0001';

describe('migration 0008', () => {
  const DAY = '2026-10-07';
  const NOW = '2026-10-08T00:07:00.000Z';
  const at = (minute: number) => `${DAY}T10:0${minute}:00.000Z`;
  const EXPECTED = [
    { key: `${BASE}:${WALLET}|${BASE}:${LOOSE}`, messages: 1, usd_value: 7, fee_usd: 2 },
    { key: `${BASE}:${WALLET}|${GROUP}`, messages: 2, usd_value: 15, fee_usd: 1 },
  ];

  /** The wallet bridged elizaOS twice and a token outside the registry once, and sent one data message; an app sent elizaOS for it once. */
  async function seedDay(): Promise<void> {
    await seedRegistry([NETWORKS.base], [{ chainSelector: BASE, address: ELIZA_BASE, symbol: 'ELIZA', name: 'elizaOS', decimals: 18, groupId: GROUP }]);
    await store.upsertListRows(
      env.DB,
      [
        liveRow({ id: 'w1', sendTs: at(1), sender: WALLET }, { origin: WALLET, token_count: 1, usd_value: 10, fee_usd: 1 }),
        liveRow({ id: 'w2', sendTs: at(2), sender: WALLET }, { origin: WALLET, token_count: 1, usd_value: 5 }),
        liveRow({ id: 'w3', sendTs: at(3), sender: WALLET }, { origin: WALLET, token_count: 1, usd_value: 7, fee_usd: 2 }),
        liveRow({ id: 'w4', sendTs: at(4), sender: WALLET }, { origin: WALLET }),
        liveRow({ id: 'a1', sendTs: at(5), sender: APP }, { origin: WALLET, token_count: 1, usd_value: 3 }),
      ],
      [
        { message_id: 'w1', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: 10 },
        { message_id: 'w2', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: 5 },
        { message_id: 'w3', idx: 0, chain: BASE, token: LOOSE, amount: '1', usd_value: 7 },
        { message_id: 'a1', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: 3 },
      ],
    );
  }

  /** What finalize does for the day. */
  async function finalizeDay(): Promise<void> {
    const tokens = await store.tokensForDay(env.DB, DAY);
    const { totals, breakdown } = rollupDay(DAY, await store.messagesForDay(env.DB, DAY), tokens, await store.firstTokenGroups(env.DB, tokens));
    await store.replaceDaily(env.DB, totals, breakdown, NOW);
  }

  const viaRows = async () =>
    (await env.DB.prepare("SELECT key, messages, usd_value, fee_usd FROM daily_breakdown WHERE dim = 'via_token' ORDER BY key").all()).results;
  const backfill = () => env.DB.batch(env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0008'))!.queries.map((q) => env.DB.prepare(q)));

  it("rolls up a wallet's direct sends by their first token's group or the token itself, and never an app's send", async () => {
    // #given
    await seedDay();
    // #when
    await finalizeDay();
    // #then
    expect(await viaRows()).toEqual(EXPECTED);
  });

  it('backfills the same rows the rollup writes', async () => {
    // #given a finalized day whose via_token rows are gone, as before the migration
    await seedDay();
    await finalizeDay();
    await env.DB.prepare("DELETE FROM daily_breakdown WHERE dim = 'via_token'").run();
    // #when
    await backfill();
    // #then
    expect(await viaRows()).toEqual(EXPECTED);
  });

  it('leaves one row per key when the backfill runs twice over a finalized day, and when the day is finalized again after it', async () => {
    // #given
    await seedDay();
    await finalizeDay();
    // #when
    await backfill();
    await backfill();
    await finalizeDay();
    // #then
    expect(await viaRows()).toEqual(EXPECTED);
  });

  it('backfills nothing for a day that was never rolled up', async () => {
    // #given
    await seedDay();
    // #when
    await backfill();
    // #then
    expect(await viaRows()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/rollup.test.ts && pnpm --filter @ccip-dev/worker exec vitest run test/via-token.test.ts`
Expected: FAIL (no fourth argument and no `via_token` rows; no migration 0008; no `store.firstTokenGroups`).

- [ ] **Step 3: The dimension and the rollup**

1. `packages/core/src/types.ts`: `export type Dim = 'src_chain' | 'dst_chain' | 'lane' | 'token' | 'sender' | 'via_token';`

2. `packages/core/src/rollup.ts`: add `import { viaTokenGroup, viaTokenKey, type TokenGroupOf } from './via-token';`. Change the signature to `export function rollupDay(day: string, messages: MessageRow[], tokens: TokenRow[], tokenGroup: TokenGroupOf): DayRollup {`. Make `addMessageGroups` skip a null key:

```ts
  const addMessageGroups = (dim: Dim, keyOf: (r: MessageRow) => string | null) => {
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const key = keyOf(r);
      if (key === null) continue;
      const g = groupFor(groups, key);
      g.ids.add(r.message_id);
      g.usd += r.usd_value;
      if (r.fee_usd !== null) {
        g.fee += r.fee_usd;
        g.anyFee = true;
      }
    }
    pushGroups(breakdown, day, dim, groups, true);
  };
```

and after `addMessageGroups('sender', senderKey);` add:

```ts
  // A wallet's direct send, which the sender row already counts: publish moves this part to the project claiming the token.
  const firstTokens = new Map(tokens.filter((t) => t.idx === 0).map((t) => [t.message_id, t]));
  addMessageGroups('via_token', (r) => {
    const first = firstTokens.get(r.message_id);
    if (first === undefined || r.origin === null || r.sender !== r.origin) return null;
    return viaTokenKey(r.src_chain, r.sender, viaTokenGroup(first.chain, first.token, tokenGroup));
  });
```

3. `packages/core/src/via-token.ts`, append:

```ts
/** Registry groups for the `<selector>:<address>` keys in the JSON list ?1; the tokens table stores addresses normalized. */
export const REGISTRY_GROUPS_SQL = `SELECT chain || ':' || address AS key, group_id FROM tokens
  WHERE chain || ':' || address IN (SELECT value FROM json_each(?1))`;
```

- [ ] **Step 4: Write the migration**

Create `worker/migrations/0008_via_token.sql` with exactly this content: the header and 40 statements, one per calendar month from 2023-07, identical except for their `WHERE` date bounds; the last one has no upper bound.

```sql
-- Fills daily_breakdown's via_token rows for every rolled-up day: each day's direct sends (sender = origin, as stored),
-- keyed <src_selector>:<sender>|<group>, where group is the first token's registry group_id, or <chain>:<address> for a
-- token with none, as rollupDay keys them. One statement per calendar month keeps each inside D1's statement limits;
-- history starts on 2023-07-06 and every list message since then carries an origin. The last statement has no upper
-- bound, so days finalized between this file and the deploy are filled too. Re-running it upserts the same rows.
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-07-01' AND m.day < '2023-08-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-08-01' AND m.day < '2023-09-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-09-01' AND m.day < '2023-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-10-01' AND m.day < '2023-11-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-11-01' AND m.day < '2023-12-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-12-01' AND m.day < '2024-01-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-01-01' AND m.day < '2024-02-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-02-01' AND m.day < '2024-03-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-03-01' AND m.day < '2024-04-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-04-01' AND m.day < '2024-05-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-05-01' AND m.day < '2024-06-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-06-01' AND m.day < '2024-07-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-07-01' AND m.day < '2024-08-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-08-01' AND m.day < '2024-09-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-09-01' AND m.day < '2024-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-10-01' AND m.day < '2024-11-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-11-01' AND m.day < '2024-12-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-12-01' AND m.day < '2025-01-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-01-01' AND m.day < '2025-02-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-02-01' AND m.day < '2025-03-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-03-01' AND m.day < '2025-04-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-04-01' AND m.day < '2025-05-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-05-01' AND m.day < '2025-06-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-06-01' AND m.day < '2025-07-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-07-01' AND m.day < '2025-08-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-08-01' AND m.day < '2025-09-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-09-01' AND m.day < '2025-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-10-01' AND m.day < '2025-11-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-11-01' AND m.day < '2025-12-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-12-01' AND m.day < '2026-01-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-01-01' AND m.day < '2026-02-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-02-01' AND m.day < '2026-03-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-03-01' AND m.day < '2026-04-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-04-01' AND m.day < '2026-05-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-05-01' AND m.day < '2026-06-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-06-01' AND m.day < '2026-07-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-07-01' AND m.day < '2026-08-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-08-01' AND m.day < '2026-09-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-09-01' AND m.day < '2026-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
```

Check the file: `grep -c '^INSERT INTO daily_breakdown' worker/migrations/0008_via_token.sql` prints `40`, and `sqlite3 :memory: '.read worker/migrations/0001_init.sql' '.read worker/migrations/0008_via_token.sql' "SELECT 'ok'"` prints `ok`.

- [ ] **Step 5: Group the day's first tokens in finalize and today**

1. `worker/src/store.ts`: add `REGISTRY_GROUPS_SQL, tokenGroupLookup,` and `type TokenGroupOf,` to the `@ccip-dev/core` import, and after `tokenGroupIds` add:

```ts
/** Registry groups by `<selector>:<address>`; a key missing from the result has no registry row. */
export async function registryGroups(db: D1Database, keys: readonly string[]): Promise<Map<string, string | null>> {
  if (keys.length === 0) return new Map();
  const { results } = await db.prepare(REGISTRY_GROUPS_SQL).bind(JSON.stringify(keys)).all<{ key: string; group_id: string | null }>();
  return new Map(results.map((r) => [r.key, r.group_id]));
}

/** The registry groups of the day's first tokens, as rollupDay keys via_token rows. */
export async function firstTokenGroups(db: D1Database, tokens: readonly TokenRow[]): Promise<TokenGroupOf> {
  return tokenGroupLookup(await registryGroups(db, [...new Set(tokens.filter((t) => t.idx === 0).map((t) => `${t.chain}:${t.token}`))]));
}
```

2. `worker/src/jobs/finalize.ts`, in `finalizeDay`, replace the rollup line with:

```ts
  const tokens = await store.tokensForDay(db, day);
  const { totals, breakdown } = rollupDay(day, messages, tokens, await store.firstTokenGroups(db, tokens));
```

3. `worker/src/publish.ts`, replace `rollupToday` with:

```ts
async function rollupToday(c: RunContext, now: Date) {
  const day = dayOf(now);
  const messages = await store.messagesForDay(c.env.DB, day);
  const tokens = await store.tokensForDay(c.env.DB, day);
  return { day, messages, ...rollupDay(day, messages, tokens, await store.firstTokenGroups(c.env.DB, tokens)) };
}
```

4. `scripts/backfill/build.ts`: add `tokenGroupLookup` to the `@ccip-dev/core` import; after `const groups = tokenGroupsOf(registry.tokens, networks);` add

```ts
  const registryGroupOf = tokenGroupLookup(new Map(registry.tokens.map(normalizeRegistryToken).map((t) => [`${t.chain}:${t.address}`, t.groupId])));
```

and make the rollup `const { totals, breakdown } = rollupDay(day, rows, tokens, registryGroupOf);`.

5. `scripts/backfill/fees/build.ts`: add `NO_TOKEN_GROUPS` to the `@ccip-dev/core` import and make the rollup `const { totals, breakdown } = rollupDay(day, rows, [], NO_TOKEN_GROUPS);`.

6. The remaining test call sites read only totals:
   - `worker/test/finalize.test.ts`: add `NO_TOKEN_GROUPS` to the `@ccip-dev/core` import and make the call `const expected = rollupDay(day, rows, tokens, NO_TOKEN_GROUPS).totals;`.
   - `worker/test/store.test.ts`: make the core import `import { chainRef, NO_TOKEN_GROUPS, rollupDay, siblingKeys } from '@ccip-dev/core';` and the call `return rollupDay(DAY, await store.messagesForDay(env.DB, DAY), [], NO_TOKEN_GROUPS);`.
   - `scripts/test/build.test.ts`: add `NO_TOKEN_GROUPS` to the `@ccip-dev/core` import and make the call `{ ...rollupDay('2026-10-06', live.rows, live.tokens, NO_TOKEN_GROUPS).totals, computed_at: NOW.toISOString() },`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/rollup.test.ts && pnpm --filter @ccip-dev/worker exec vitest run test/via-token.test.ts test/finalize.test.ts test/store.test.ts test/publish.test.ts && pnpm exec vitest run scripts/test/build.test.ts scripts/test/backfill-sql.test.ts scripts/test/fees-build.test.ts`
Expected: PASS. (`backfill-sql.test.ts` applies every migration to `node:sqlite`, so it also proves 0008 parses there.)

- [ ] **Step 7: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add packages/core/src/types.ts packages/core/src/rollup.ts packages/core/src/via-token.ts packages/core/test/rollup.test.ts \
  worker/migrations/0008_via_token.sql worker/src/store.ts worker/src/jobs/finalize.ts worker/src/publish.ts worker/test/via-token.test.ts \
  worker/test/finalize.test.ts worker/test/store.test.ts scripts/backfill/build.ts scripts/backfill/fees/build.ts scripts/test/build.test.ts
git commit -m "feat(rollup): a via_token dimension for direct sends, backfilled by migration 0008

Each day's direct sends (sender = origin) are rolled up by sender and first-token group,
or the token itself when it has no group. The migration fills every finalized day month
by month with the same keys the rollup writes, and re-running either leaves one row each.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Credits in the store and the sender book: rankings net of the move, and coverage

**Files:**
- Modify: `packages/core/src/via-token.ts`
- Modify: `worker/src/store.ts`, `worker/src/labels.ts`, `worker/src/context.ts`, `worker/src/senders.ts`, `worker/src/publish.ts` (`dayLeaderEntries` only)
- Modify: `worker/test/helpers.ts`, `worker/test/store.test.ts` (call sites)
- Test: `worker/test/via-token.test.ts`

**Interfaces:**
- **Consumes:** `TokenLabels` (Task 1), `claimedTokenKeys`, `tokenClaims`, `viaTokenCredits`, `splitViaToken`, `ViaTokenCredit` (Task 1); `mergeIdentities` with credits, `labelCoverage` (Task 2); `store.registryGroups` (Task 3).
- **Produces:**
  - Core SQL: `VIA_SENDER_KEY`, `VIA_ADDRESS`, `VIA_GROUP` (SQL expressions over a `via_token` key), and `VIA_TOKEN_CREDITS_SQL` / `VIA_TOKEN_CREDIT_DAYS_SQL`: credit rows keyed `<selector>|<group>` over `[?1, ?2]` for the claimed keys `?3` (JSON) from senders outside the labeled addresses `?4` (JSON); the `DAYS` one adds `day`.
  - `store.viaTokenCreditsOf(db: D1Database, fromDay: string | null, toDay: string, claimed: readonly string[], labeled: readonly string[]): Promise<BreakdownRow[]>` and `store.viaTokenCreditDays(db: D1Database, fromDay: string, toDay: string, claimed: readonly string[], labeled: readonly string[]): Promise<LeaderRow[]>`; both return `[]` with no query when `claimed` is empty.
  - `store.topUnlabeledSenders(db, fromDay, toDay, labeled, limit, order, claimed: readonly string[])` and `store.dailyTopUnlabeledSenders(db, fromDay, toDay, labeled, claimed: readonly string[])`: rows net of the claimed direct sends; a key or address with nothing left is gone.
  - `RunContext.labelTokens: TokenLabels` (bundled `label-tokens.json`); `harness({ labelTokens })`.
  - `SenderBook { resolve: IdentityResolver; labeled: string[]; claims: TokenClaims; claimed: string[] }`.
  - `windowCredits(c: RunContext, book: SenderBook, fromDay: string | null, toDay: string): Promise<ViaTokenCredit[]>`.
  - `identitiesOf(book: Pick<SenderBook, 'resolve' | 'labeled' | 'claims'>, senderRows: readonly SenderRow[], viaRows: readonly SenderRow[]): IdentityTotals[]` (one day's rows, one per key).
  - `topIdentityByDay(book: Pick<SenderBook, 'resolve' | 'claims'>, rows: readonly store.LeaderRow[], creditRows: readonly store.LeaderRow[]): Map<string, IdentityTotals>`.
  - `rankedIdentities` and `labelCoverageOf` keep their signatures and now include credits.

- [ ] **Step 1: Write the failing tests**

In `worker/test/via-token.test.ts`, make the imports:

```ts
import { rollupDay, VIA_TOKEN_CREDITS_SQL, type Dim } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { labelCoverageOf, rankedIdentities, senderBook } from '../src/senders';
import * as store from '../src/store';
import { harness, liveRow, resetStorage, seedRegistry } from './helpers';
```

add `const ETH = NETWORKS.ethereum.chainSelector;` and `const ELIZA_ETH = '0x00000000000000000000000000000000000e1a02';` below `BASE` and `ELIZA_BASE`, and append:

```ts
describe('via-token store queries', () => {
  const DAY = '2026-10-13';
  const NOW = '2026-10-14T00:07:00.000Z';
  const W1 = '0x0000000000000000000000000000000000000a01';
  const W2 = '0x0000000000000000000000000000000000000a02';
  const W3 = '0x0000000000000000000000000000000000000a03';
  const LABELED_WALLET = '0x0000000000000000000000000000000000000a04';
  const ELIZA_APP = '0x0000000000000000000000000000000000000a05';
  const TOTALS = { day: DAY, messages: 200, token_messages: 200, usd_value: 2_000, fee_usd: 20, unique_senders: 5, median_delivery_s: null, unpriced_messages: 0 };
  const row = (dim: Dim, key: string, messages: number, fee_usd: number) => ({ day: DAY, dim, key, messages, usd_value: messages * 10, fee_usd });
  /** W1 only bridged elizaOS; W2 bridged it 10 times and USDC 5 times of its 30; W3 sent 25 through no token; a labeled wallet bridged elizaOS 7 times. */
  const ROWS = [
    row('sender', `${BASE}:${W1}`, 50, 5), row('via_token', `${BASE}:${W1}|${GROUP}`, 50, 5),
    row('sender', `${BASE}:${W2}`, 30, 3), row('via_token', `${BASE}:${W2}|${GROUP}`, 10, 1), row('via_token', `${BASE}:${W2}|group-usdc`, 5, 0.5),
    row('sender', `${BASE}:${W3}`, 25, 2.5),
    row('sender', `${BASE}:${LABELED_WALLET}`, 7, 0.7), row('via_token', `${BASE}:${LABELED_WALLET}|${GROUP}`, 7, 0.7),
  ];

  beforeEach(async () => {
    await store.replaceDaily(env.DB, TOTALS, ROWS, NOW);
  });

  it('credits each source chain with the claimed direct sends of senders no label names', async () => {
    // #when
    const credits = await store.viaTokenCreditsOf(env.DB, DAY, DAY, [GROUP], [LABELED_WALLET]);
    // #then
    expect(credits).toEqual([{ key: `${BASE}|${GROUP}`, messages: 60, usd_value: 600, fee_usd: 6 }]);
  });

  it('credits each day separately, for the day leaders', async () => {
    // #when
    const credits = await store.viaTokenCreditDays(env.DB, DAY, DAY, [GROUP], [LABELED_WALLET]);
    // #then
    expect(credits).toEqual([{ day: DAY, key: `${BASE}|${GROUP}`, messages: 60, usd_value: 600, fee_usd: 6 }]);
  });

  it('ranks unlabeled addresses by what the move leaves them, and drops one with nothing left', async () => {
    // #when
    const before = await store.topUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], 1, 'messages', []);
    const after = await store.topUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], 2, 'messages', [GROUP]);
    // #then W1's 50 all moved; W2 keeps 20 of 30, its USDC sends included, since no project claims USDC
    expect({ before: before.map((r) => r.key), after: after.map((r) => [r.key, r.messages, r.fee_usd]) }).toEqual({
      before: [`${BASE}:${W1}`],
      after: [[`${BASE}:${W2}`, 20, 2], [`${BASE}:${W3}`, 25, 2.5]],
    });
  });

  it("gives each day its busiest unlabeled address by what the move leaves it", async () => {
    // #when
    const rows = await store.dailyTopUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], [GROUP]);
    // #then
    expect(rows.map((r) => `${r.day} ${r.key}`)).toEqual([`${DAY} ${BASE}:${W3}`]);
  });

  it('takes a claimed list of more than 100 keys as one parameter', async () => {
    // #given
    const claimed = [GROUP, ...Array.from({ length: 150 }, (_, i) => `group-${i}`)];
    // #when
    const credits = await store.viaTokenCreditsOf(env.DB, DAY, DAY, claimed, [LABELED_WALLET]);
    // #then
    expect(credits.map((r) => r.messages)).toEqual([60]);
  });

  it('reads the credits through a daily_breakdown index', async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${VIA_TOKEN_CREDITS_SQL}`).bind(DAY, DAY, '[]', '[]').all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toMatch(/SEARCH daily_breakdown USING (COVERING )?INDEX/);
  });

  it('has no credits when no project claims a token', async () => {
    // #then
    expect(await store.viaTokenCreditsOf(env.DB, DAY, DAY, [], [LABELED_WALLET])).toEqual([]);
  });

  describe('through the sender book', () => {
    const ELIZA = { name: 'elizaOS', x: 'elizaOS', url: null, kind: 'protocol' as const, source: null, addresses: [], tokens: [] };
    const OTHER = { name: 'Other', x: null, url: null, kind: 'app' as const, source: null, addresses: [], tokens: [] };
    const context = () =>
      harness({
        now: NOW,
        labels: {
          [`ethereum-mainnet-base-1:${ELIZA_APP}`]: { name: 'elizaOS', x: 'elizaOS', kind: 'protocol', slug: 'elizaos' },
          [`ethereum-mainnet-base-1:${LABELED_WALLET}`]: { name: 'Other', kind: 'app', slug: 'other' },
        },
        labelTokens: { [`ethereum-mainnet:${ELIZA_ETH}`]: 'elizaos' },
        projects: { elizaos: ELIZA, other: OTHER },
      }).c;

    beforeEach(async () => {
      // #given elizaOS's entry names its Ethereum token, its Base token shares the registry group, and its own Base contract sent 40
      await seedRegistry([NETWORKS.base, NETWORKS.ethereum], [
        { chainSelector: ETH, address: ELIZA_ETH, symbol: 'ELIZA', name: 'elizaOS', decimals: 18, groupId: GROUP },
        { chainSelector: BASE, address: ELIZA_BASE, symbol: 'ELIZA', name: 'elizaOS', decimals: 18, groupId: GROUP },
      ]);
      await store.replaceDaily(env.DB, TOTALS, [...ROWS, row('sender', `${BASE}:${ELIZA_APP}`, 40, 4)], NOW);
    });

    it("ranks elizaOS once, with its own sends and the Base wallets' sends of its token, ahead of what the wallets keep", async () => {
      // #given
      const c = context();
      // #when
      const ranked = await rankedIdentities(c, await senderBook(c), DAY, DAY, 'messages', 4);
      // #then
      expect(ranked.map((i) => [i.key, i.messages, i.via_token_messages])).toEqual([
        ['project:elizaos', 100, 60], [`address:${W3}`, 25, 0], [`address:${W2}`, 20, 0], ['project:other', 7, 0],
      ]);
    });

    it('counts the credits in label coverage, with their own part', async () => {
      // #given
      const c = context();
      // #then
      expect(await labelCoverageOf(c, await senderBook(c), DAY, DAY)).toEqual({
        messages_pct: 53.5, usd_pct: 53.5, fees_pct: 53.5, via_token_messages_pct: 30, via_token_usd_pct: 30, via_token_fees_pct: 30, window: '7d',
      });
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/via-token.test.ts`
Expected: FAIL (no credit queries, no `claimed` argument, no `labelTokens` option).

- [ ] **Step 3: The credit SQL in core**

Append to `packages/core/src/via-token.ts`:

```ts
/** SQL over a via_token key `<selector>:<sender>|<group>`: its sender key, its address and its group. */
export const VIA_SENDER_KEY = "substr(key, 1, instr(key, '|') - 1)";
export const VIA_ADDRESS = "substr(key, instr(key, ':') + 1, instr(key, '|') - instr(key, ':') - 1)";
export const VIA_GROUP = "substr(key, instr(key, '|') + 1)";
const VIA_SELECTOR = "substr(key, 1, instr(key, ':') - 1)";

const viaTokenCreditsSql = (withDay: boolean) => {
  const day = withDay ? 'day, ' : '';
  return `SELECT ${day}credit AS key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd FROM (
    SELECT day, ${VIA_SELECTOR} || '|' || ${VIA_GROUP} AS credit, messages, usd_value, fee_usd FROM daily_breakdown
    WHERE dim = 'via_token' AND day >= ?1 AND day <= ?2
      AND ${VIA_GROUP} IN (SELECT value FROM json_each(?3)) AND ${VIA_ADDRESS} NOT IN (SELECT value FROM json_each(?4))
  ) GROUP BY ${day}credit ORDER BY ${day}credit`;
};

/**
 * Credit rows `<selector>|<group>` over [?1, ?2] for the claimed keys in the JSON list ?3, from senders outside the
 * labeled addresses ?4. The Worker and the candidates job both read coverage through it, so their numbers match.
 */
export const VIA_TOKEN_CREDITS_SQL = viaTokenCreditsSql(false);
export const VIA_TOKEN_CREDIT_DAYS_SQL = viaTokenCreditsSql(true);
```

- [ ] **Step 4: Credits and net rows in the store**

In `worker/src/store.ts`, add `VIA_ADDRESS, VIA_GROUP, VIA_SENDER_KEY, VIA_TOKEN_CREDIT_DAYS_SQL, VIA_TOKEN_CREDITS_SQL,` to the `@ccip-dev/core` import. Replace `unlabeledRowsSql`, `topUnlabeledSendersSql`, `topUnlabeledSenders`, `DAILY_TOP_UNLABELED_SQL` and `dailyTopUnlabeledSenders` with:

```ts
/**
 * The sender rows over [?1, ?2] of addresses outside the labeled list ?3, with the claimed direct sends (the keys in the
 * JSON list `claimedParam`) as negative rows: summed per key, they leave what the move to the token's project leaves.
 */
const unlabeledRowsSql = (withDay: boolean, claimedParam: string) => `SELECT ${withDay ? 'day, ' : ''}key, address, messages, usd_value, fee_usd FROM (
    SELECT day, key, ${SENDER_ADDRESS} AS address, messages, usd_value, fee_usd FROM daily_breakdown
    WHERE dim = 'sender' AND day >= ?1 AND day <= ?2
    UNION ALL
    SELECT day, ${VIA_SENDER_KEY}, ${VIA_ADDRESS}, -messages, -usd_value, -fee_usd FROM daily_breakdown
    WHERE dim = 'via_token' AND day >= ?1 AND day <= ?2 AND ${VIA_GROUP} IN (SELECT value FROM json_each(${claimedParam}))
  ) WHERE address NOT IN (SELECT value FROM json_each(?3))`;

/**
 * The per-key rows of the ?4 busiest addresses outside the labeled list ?3 over [?1, ?2], net of the claimed keys ?5,
 * each address ranked by its rows summed across chains. A key with nothing left is dropped before the cut, so the ?4
 * are the busiest by what they keep.
 */
export const topUnlabeledSendersSql = (order: TopOrder) => `WITH rows AS (${unlabeledRowsSql(false, '?5')}),
  net AS (
    SELECT key, address, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
    FROM rows GROUP BY key HAVING SUM(messages) > 0
  ),
  top AS (SELECT address FROM net GROUP BY address ${ADDRESS_ORDER_SQL[order]} LIMIT ?4)
  SELECT key, messages, usd_value, fee_usd FROM net WHERE address IN (SELECT address FROM top) ORDER BY key`;

export async function topUnlabeledSenders(
  db: D1Database,
  fromDay: string | null,
  toDay: string,
  labeled: readonly string[],
  limit: number,
  order: TopOrder,
  claimed: readonly string[],
): Promise<BreakdownRow[]> {
  const { results } = await db
    .prepare(topUnlabeledSendersSql(order))
    .bind(fromDay ?? '0000-00-00', toDay, JSON.stringify(labeled), limit, JSON.stringify(claimed))
    .all<BreakdownRow>();
  return results;
}

/** By messages, summed across chains and net of the claimed keys ?4, so a day's leader is one identity with every chain it sent from. */
export const DAILY_TOP_UNLABELED_SQL = `WITH rows AS (${unlabeledRowsSql(true, '?4')}),
  net AS (
    SELECT day, key, address, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
    FROM rows GROUP BY day, key HAVING SUM(messages) > 0
  ),
  ranked AS (
    SELECT day, address, ROW_NUMBER() OVER (PARTITION BY day ORDER BY SUM(messages) DESC, SUM(usd_value) DESC, address) AS rn
    FROM net GROUP BY day, address
  )
  SELECT n.day, n.key, n.messages, n.usd_value, n.fee_usd FROM net n JOIN ranked k ON k.day = n.day AND k.address = n.address
  WHERE k.rn = 1 ORDER BY n.day, n.key`;

export async function dailyTopUnlabeledSenders(db: D1Database, fromDay: string, toDay: string, labeled: readonly string[], claimed: readonly string[]): Promise<LeaderRow[]> {
  const { results } = await db.prepare(DAILY_TOP_UNLABELED_SQL).bind(fromDay, toDay, JSON.stringify(labeled), JSON.stringify(claimed)).all<LeaderRow>();
  return results;
}

/** The claimed direct sends over the window as credit rows (see VIA_TOKEN_CREDITS_SQL); none, unread, when nothing is claimed. */
export async function viaTokenCreditsOf(db: D1Database, fromDay: string | null, toDay: string, claimed: readonly string[], labeled: readonly string[]): Promise<BreakdownRow[]> {
  if (claimed.length === 0) return [];
  const { results } = await db.prepare(VIA_TOKEN_CREDITS_SQL).bind(fromDay ?? '0000-00-00', toDay, JSON.stringify(claimed), JSON.stringify(labeled)).all<BreakdownRow>();
  return results;
}

export async function viaTokenCreditDays(db: D1Database, fromDay: string, toDay: string, claimed: readonly string[], labeled: readonly string[]): Promise<LeaderRow[]> {
  if (claimed.length === 0) return [];
  const { results } = await db.prepare(VIA_TOKEN_CREDIT_DAYS_SQL).bind(fromDay, toDay, JSON.stringify(claimed), JSON.stringify(labeled)).all<LeaderRow>();
  return results;
}
```

In `worker/test/store.test.ts`, give the existing calls their claimed list:
- `const rows = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 2, 'messages', []);`
- `const rows = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'messages', []);`
- `const [first] = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'fees', []);`
- `const [top] = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'messages', []);`
- `const unlabeled = await store.dailyTopUnlabeledSenders(env.DB, '2026-10-12', DAY, LABELED, []);`

- [ ] **Step 5: Token labels in the run context**

1. `worker/src/labels.ts`: make the core import `import { labelKey, type Label, type LabelIndex, type ProjectRegistry, type TokenLabels } from '@ccip-dev/core';`, add `import bundledTokenLabels from './generated/label-tokens.json';`, and add `export const bundledLabelTokens: TokenLabels = bundledTokenLabels as TokenLabels;`.
2. `worker/src/context.ts`: add `type TokenLabels` to the core import and `bundledLabelTokens` to the `./labels` import; add `labelTokens: TokenLabels;` to `RunContext` after `projects`; add `'labelTokens'` to the `Pick<…>` list of `overrides`; and add `labelTokens: overrides.labelTokens ?? bundledLabelTokens,` after `projects: …`.
3. `worker/test/helpers.ts`: add `type TokenLabels` to the core import, `labelTokens?: TokenLabels;` to `harness`'s options after `projects?`, and `labelTokens: opts.labelTokens ?? {},` after `projects: opts.projects ?? {},`.

- [ ] **Step 6: Claims and credits in the sender book**

In `worker/src/senders.ts`, replace the core import with:

```ts
import {
  addressKey, claimedTokenKeys, dayStartIso, identityResolver, labelCoverage, labeledAddresses, mergeIdentities, newcomerPicks, NEWCOMER_MIN_MESSAGES, NEWCOMER_TOP,
  projectAddresses, rankIdentities, senderKeyAddress, splitViaToken, tokenClaims, viaTokenCredits, type DailyBreakdown, type IdentityOrder, type IdentityResolver,
  type IdentityTotals, type LabelCoverage, type LabelIndex, type SenderRow, type TokenClaims, type ViaTokenCredit,
} from '@ccip-dev/core';
```

and replace everything from `export interface SenderBook` through `labelCoverageOf` with:

```ts
/** What every identity ranking needs: the resolver, the addresses the store splits labeled rows by, and the token claims. */
export interface SenderBook {
  resolve: IdentityResolver;
  labeled: string[];
  claims: TokenClaims;
  /** Every key a claim is made by, as the store's via-token queries take them. */
  claimed: string[];
}

export async function senderBook(c: RunContext): Promise<SenderBook> {
  const db = c.env.DB;
  const chains = await store.senderChains(db);
  const claims = tokenClaims(c.labelTokens, c.projects, chains, await store.registryGroups(db, claimedTokenKeys(c.labelTokens, chains)));
  return { resolve: identityResolver(c.labels, chains), labeled: labeledAddresses(c.labels), claims, claimed: [...claims.keys()] };
}

/** The window's claimed direct sends by senders no label names, credited to the projects that claim the tokens. */
export async function windowCredits(c: RunContext, book: SenderBook, fromDay: string | null, toDay: string): Promise<ViaTokenCredit[]> {
  return viaTokenCredits(await store.viaTokenCreditsOf(c.env.DB, fromDay, toDay, book.claimed, book.labeled), book.claims);
}

/** One day's identities from its sender and via_token rows, one row per key, as finalize and today.json have them. */
export function identitiesOf(book: Pick<SenderBook, 'resolve' | 'labeled' | 'claims'>, senderRows: readonly SenderRow[], viaRows: readonly SenderRow[]): IdentityTotals[] {
  const { senders, credits } = splitViaToken(senderRows, viaRows, book.claims, new Set(book.labeled));
  return mergeIdentities(senders, book.resolve, viaTokenCredits(credits, book.claims));
}

/** The top `limit` identities over [fromDay, toDay]: every labeled row, the busiest unlabeled addresses net of the move, and the credits. */
export async function rankedIdentities(
  c: RunContext,
  book: SenderBook,
  fromDay: string | null,
  toDay: string,
  order: IdentityOrder,
  limit: number,
): Promise<IdentityTotals[]> {
  const db = c.env.DB;
  const rows = [
    ...(await store.senderTotalsOf(db, fromDay, toDay, book.labeled)),
    ...(await store.topUnlabeledSenders(db, fromDay, toDay, book.labeled, limit, order, book.claimed)),
  ];
  return rankIdentities(mergeIdentities(rows, book.resolve, await windowCredits(c, book, fromDay, toDay)), order, limit);
}

function byDay(rows: readonly store.LeaderRow[]): Map<string, store.LeaderRow[]> {
  const days = new Map<string, store.LeaderRow[]>();
  for (const r of rows) {
    const list = days.get(r.day);
    if (list) list.push(r);
    else days.set(r.day, [r]);
  }
  return days;
}

/** Each day's top identity by messages, from that day's labeled rows, its busiest unlabeled address net of the move, and its credits. */
export function topIdentityByDay(book: Pick<SenderBook, 'resolve' | 'claims'>, rows: readonly store.LeaderRow[], creditRows: readonly store.LeaderRow[]): Map<string, IdentityTotals> {
  const senders = byDay(rows);
  const credits = byDay(creditRows);
  const top = new Map<string, IdentityTotals>();
  for (const day of new Set([...senders.keys(), ...credits.keys()])) {
    const [first] = rankIdentities(mergeIdentities(senders.get(day) ?? [], book.resolve, viaTokenCredits(credits.get(day) ?? [], book.claims)), 'messages', 1);
    if (first) top.set(day, first);
  }
  return top;
}

export const LABEL_COVERAGE_KEY = 'label_coverage';

/** The labeled identities' share of [fromDay, toDay]: every labeled row and every credit merged, against daily_totals. */
export async function labelCoverageOf(c: RunContext, book: SenderBook, fromDay: string, toDay: string): Promise<LabelCoverage> {
  const rows = await store.senderTotalsOf(c.env.DB, fromDay, toDay, book.labeled);
  return labelCoverage(mergeIdentities(rows, book.resolve, await windowCredits(c, book, fromDay, toDay)), await store.totalsBetween(c.env.DB, fromDay, toDay));
}
```

In `worker/src/publish.ts`, `dayLeaderEntries`, replace the `senders` line with:

```ts
  const senders = topIdentityByDay(
    book,
    [...(await store.senderDaysOf(db, fromDay, toDay, book.labeled)), ...(await store.dailyTopUnlabeledSenders(db, fromDay, toDay, book.labeled, book.claimed))],
    await store.viaTokenCreditDays(db, fromDay, toDay, book.claimed, book.labeled),
  );
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/via-token.test.ts test/store.test.ts test/publish.test.ts test/senders.test.ts test/moments.test.ts test/projects.test.ts`
Expected: PASS.

- [ ] **Step 8: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add packages/core/src/via-token.ts worker/src/store.ts worker/src/labels.ts worker/src/context.ts worker/src/senders.ts worker/src/publish.ts \
  worker/test/helpers.ts worker/test/store.test.ts worker/test/via-token.test.ts
git commit -m "feat(senders): credit claimed direct sends in rankings and coverage

The sender book resolves token claims from label-tokens.json and the registry groups.
Window rankings take unlabeled addresses net of their claimed direct sends, so a wallet
with nothing left drops out before the cut, and the credits go to the token's project.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Publish the split: identity fields, `today.json`, the day leaders, `top/sender.json` and coverage

**Files:**
- Modify: `packages/core/src/public.ts`, `worker/src/publish.ts`
- Test: `worker/test/publish.test.ts`

**Interfaces:**
- **Consumes:** `taggableX` (Task 2); `identitiesOf`, `senderBook` (Task 4).
- **Produces:**
  - Every identity entry (`TopEntrySchema`, `LeaderSchema`) may carry `via_token_messages: number`, `via_token_usd: number | null`, `via_token_fee_usd: number | null`, `via_token: boolean`, all optional.
  - `LabelCoverageSchema` may carry `via_token_messages_pct`, `via_token_usd_pct`, `via_token_fees_pct` (`number | null`, optional), so `status.json` publishes them.
  - `identityEntry` writes the four fields and `x: taggableX(i)`.

- [ ] **Step 1: Write the failing tests**

In `worker/test/publish.test.ts`, add `type LabelIndex` to the `@ccip-dev/core` import, and update two existing expectations:
- `"names xStocks the day's top sender: 319 messages, 20.3% of the day, on six chains from two addresses"`: add `via_token_messages: 0, via_token_usd: 0, via_token_fee_usd: null, via_token: false,` after `addresses: 2, share_pct: 20.3,`.
- `'writes the last 7 days’ label coverage at finalize, and status.json carries it every minute'`: expect `{ messages_pct: 20.3, usd_pct: 0, fees_pct: 20.3, via_token_messages_pct: 0, via_token_usd_pct: 0, via_token_fees_pct: 0, window: '7d' }`.

Append:

```ts
describe('senders via token', () => {
  const NOW = '2026-10-14T00:07:00.000Z';
  const DAY = '2026-10-13';
  const ELIZA_BASE = '0x00000000000000000000000000000000000e1a01';
  const APP = '0x00000000000000000000000000000000000d0001';
  const W1 = '0x0000000000000000000000000000000000000a01';
  const W2 = '0x0000000000000000000000000000000000000a02';
  const W3 = '0x0000000000000000000000000000000000000a03';
  const ELIZA = {
    name: 'elizaOS', x: 'elizaOS', url: null, kind: 'protocol' as const, source: null, addresses: [],
    tokens: [{ chain: 'ethereum-mainnet-base-1', address: ELIZA_BASE, source: 'https://elizaos.example/ccip' }],
  };
  const LABEL_TOKENS = { [`ethereum-mainnet-base-1:${ELIZA_BASE}`]: 'elizaos' };
  const APP_LABEL = { [`ethereum-mainnet-base-1:${APP}`]: { name: 'elizaOS', x: 'elizaOS', kind: 'protocol' as const, slug: 'elizaos' } };
  const TOTALS = { day: DAY, messages: 200, token_messages: 200, usd_value: 2_000, fee_usd: 20, unique_senders: 4, median_delivery_s: null, unpriced_messages: 0 };
  const daily = (dim: Dim, key: string, messages: number) => ({ day: DAY, dim, key, messages, usd_value: messages * 10, fee_usd: messages / 10 });
  /** Bridging elizaOS's Base token, which has no registry row, so its messages are keyed by the token itself. */
  const via = (wallet: string, messages: number) => daily('via_token', `${BASE}:${wallet}|${BASE}:${ELIZA_BASE}`, messages);
  const ROWS = [daily('sender', `${BASE}:${W1}`, 50), via(W1, 50), daily('sender', `${BASE}:${W2}`, 30), via(W2, 10), daily('sender', `${BASE}:${W3}`, 25)];
  const context = (labels: LabelIndex = {}) => harness({ now: NOW, labels, labelTokens: LABEL_TOKENS, projects: { elizaos: ELIZA } }).c;
  type Entry = { key: string; messages: number; via_token_messages: number; via_token: boolean; x: string | null };
  const brief = (e: Entry) => [e.key, e.messages, e.via_token_messages, e.via_token, e.x];

  beforeEach(async () => {
    // #given W1 bridged elizaOS's token 50 times and sent nothing else, W2 bridged it 10 times of its 30, W3 sent 25 through no token
    await seedRegistry([NETWORKS.base], []);
    await store.replaceDaily(env.DB, TOTALS, ROWS, NOW);
  });

  it('credits the moved sends to the project, marked via token with no handle, and drops the wallet left with nothing', async () => {
    // #when
    await publishHistoryFiles(context());
    // #then
    expect((await readPublic('top/sender.json')).identities['7d'].map(brief)).toEqual([
      ['project:elizaos', 60, 60, true, null],
      [`address:${W3}`, 25, 0, false, null],
      [`address:${W2}`, 20, 0, false, null],
    ]);
  });

  it('lists a project with its own contract and its token once, with both parts and its handle', async () => {
    // #given elizaOS's own Base contract also sent 40
    await store.replaceDaily(env.DB, TOTALS, [...ROWS, daily('sender', `${BASE}:${APP}`, 40)], NOW);
    // #when
    await publishHistoryFiles(context(APP_LABEL));
    // #then
    const eliza = (await readPublic('top/sender.json')).identities['7d'].filter((e: Entry) => e.key === 'project:elizaos');
    expect(eliza.map(brief)).toEqual([['project:elizaos', 100, 60, false, 'elizaOS']]);
  });

  it("names the project the day's top sender, with its via-token part", async () => {
    // #when
    await publishHistoryFiles(context());
    // #then
    const day = (await readPublic('day-leaders.json')).days.find((d: { day: string }) => d.day === DAY);
    expect([day.sender.key, day.sender.messages, day.sender.via_token_messages, day.sender.share_pct]).toEqual(['project:elizaos', 60, 60, 30]);
  });

  it('publishes coverage with its via-token part in status.json', async () => {
    // #given
    const c = context();
    // #when
    await publishHistoryFiles(c);
    await publishLiveFiles(c);
    // #then
    expect((await readPublic('status.json')).label_coverage).toEqual({
      messages_pct: 30, usd_pct: 30, fees_pct: 30, via_token_messages_pct: 30, via_token_usd_pct: 30, via_token_fees_pct: 30, window: '7d',
    });
  });

  it("moves today's direct sends of the token to the project in today.json", async () => {
    // #given today W1 bridged elizaOS's token twice and W3 sent once through no token
    const at = (minute: number) => `2026-10-14T09:0${minute}:00.000Z`;
    await store.upsertListRows(
      env.DB,
      [
        liveRow({ id: 't1', sendTs: at(1), sender: W1 }, { origin: W1, token_count: 1 }),
        liveRow({ id: 't2', sendTs: at(2), sender: W1 }, { origin: W1, token_count: 1 }),
        liveRow({ id: 't3', sendTs: at(3), sender: W3 }),
      ],
      [
        { message_id: 't1', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: null },
        { message_id: 't2', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: null },
      ],
    );
    // #when
    await publishLiveFiles(harness({ now: '2026-10-14T10:00:00.000Z', labelTokens: LABEL_TOKENS, projects: { elizaos: ELIZA } }).c);
    // #then
    expect((await readPublic('today.json')).top.sender.map((e: Entry) => [e.key, e.messages, e.via_token])).toEqual([
      ['project:elizaos', 2, true],
      [`address:${W3}`, 1, false],
    ]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts`
Expected: FAIL (no via-token fields in the files; `today.json` still credits W1; coverage has no via-token part).

- [ ] **Step 3: The optional public fields**

In `packages/core/src/public.ts`, add to `identityFields` after `share_pct: …,`:

```ts
  via_token_messages: z.number().optional(),
  via_token_usd: z.number().nullable().optional(),
  via_token_fee_usd: z.number().nullable().optional(),
  via_token: z.boolean().optional(),
```

and to `LabelCoverageSchema`, after `fees_pct: …,`:

```ts
  via_token_messages_pct: z.number().nullable().optional(),
  via_token_usd_pct: z.number().nullable().optional(),
  via_token_fees_pct: z.number().nullable().optional(),
```

- [ ] **Step 4: Write the fields, and today's identities**

In `worker/src/publish.ts`:

1. In the `@ccip-dev/core` import, remove `mergeIdentities` and add `taggableX`; add `identitiesOf` to the `./senders` import.

2. Replace `identityEntry` with:

```ts
/** A sender identity as every public file publishes it, with its share of the period's messages and its via-token part. */
export function identityEntry(i: IdentityTotals, periodMessages: number | null): Leader {
  return {
    key: i.key,
    label: i.label,
    messages: i.messages,
    usd: usd(i.usd_value),
    fee_usd: usd(i.fee_usd),
    x: taggableX(i),
    kind: i.kind,
    inferred: i.inferred,
    chains: i.chains,
    addresses: i.addresses,
    share_pct: sharePct(i.messages, periodMessages),
    via_token_messages: i.via_token_messages,
    via_token_usd: usd(i.via_token_usd),
    via_token_fee_usd: usd(i.via_token_fee_usd),
    via_token: i.via_token,
  };
}
```

3. In `publishToday`, replace the `senders` line with:

```ts
  const identities = identitiesOf(book, breakdown.filter((b) => b.dim === 'sender'), breakdown.filter((b) => b.dim === 'via_token'));
  const senders = rankIdentities(identities, 'value', TOP_LIMIT).map((i) => identityEntry(i, totals.messages));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts test/via-token.test.ts && pnpm --filter @ccip-dev/core exec vitest run test/public.test.ts`
Expected: PASS.

- [ ] **Step 6: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add packages/core/src/public.ts worker/src/publish.ts worker/test/publish.test.ts
git commit -m "feat(publish): publish each identity's via-token part, and coverage's

top/sender.json, day-leaders.json and today.json carry via_token_messages, its value and
fees, and via_token; a via-token-only identity publishes no handle. status.json's label
coverage gains its via-token shares. Every new field is optional, so old files parse.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Projects and moments: totals, series and claimed tokens; new senders and the spotlight

**Files:**
- Modify: `packages/core/src/public.ts`, `worker/src/projects.ts`, `worker/src/moments.ts`, `worker/src/senders.ts`
- Test: `worker/test/projects.test.ts`, `worker/test/moments.test.ts`, `worker/test/senders.test.ts`

**Interfaces:**
- **Consumes:** `taggableX` (Task 2); `identitiesOf`, `windowCredits`, `senderBook` (Task 4); `store.viaTokenCreditDays` (Task 4); `RegistryEntry.tokens` (Task 1).
- **Produces:**
  - `ProjectWindowSchema` may carry `via_token_messages: number` and `via_token_usd: number` (optional); `ProjectSchema` may carry `tokens: { chain: string; address: string; symbol: string | null; source: string }[]` (optional; `chain` is a selector).
  - `buildProjects` counts credits in every window and in the series, and lists each project's claimed tokens on chains CCIP knows.
  - `recordSenderArrivals` and `senderArrivals` rank one day's identities through `identitiesOf`; `senderArrivals` and the project spotlight publish `x: taggableX(…)`.

**Rulings:**
- A project page's lanes and data split stay its sent-by messages (they come from `senderLanes` over its own keys); its totals, share and series include via token. The page says so (Task 10).
- A via-token-only project is never a newcomer: its label names no address, so it has no first day, and `newcomerPicks` leaves out an identity it can't date.

- [ ] **Step 1: Write the failing tests**

In `worker/test/projects.test.ts`, make the core import `import { buildLabelIndex, buildProjectRegistry, buildTokenLabels, type RegistryProject } from '@ccip-dev/core';` and add `via_token_messages: 0, via_token_usd: 0` to every window in `'gives a project its 7-day, 30-day and all-time totals and its share of all messages'` (`'7d': { messages: 319, usd: 0, fee_usd: 79.75, share_pct: 20.3, via_token_messages: 0, via_token_usd: 0 }`, and the same for `'30d'` and `all`) and to `week` in `'lists a project with no activity after the busy ones, …'` (`week: { messages: 0, usd: 0, fee_usd: null, share_pct: 0, via_token_messages: 0, via_token_usd: 0 }`). Append inside `describe('projects.json', …)`:

```ts
  it("adds its claimed token's direct sends to its totals and series, and lists the token", async () => {
    // #given xStocks claims a Base token outside any registry group, which a wallet bridged 30 times on Oct 13
    const XTOKEN = '0x00000000000000000000000000000000000000c3';
    const WALLET = '0x00000000000000000000000000000000000000d4';
    const withToken: RegistryProject = { ...XSTOCKS, tokens: [{ chain: 'ethereum-mainnet-base-1', address: XTOKEN, source: 'https://xstocks.fi/tokens' }] };
    await env.DB.prepare("INSERT INTO tokens VALUES (?, ?, 'TSLAx', 'Tesla xStock', 18, NULL, 'x', 'x')").bind(BASE, XTOKEN).run();
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [
      ...xstocksBreakdown(),
      { day: XSTOCKS_DAY, dim: 'sender', key: `${BASE}:${WALLET}`, messages: 30, usd_value: 3_000, fee_usd: 3 },
      { day: XSTOCKS_DAY, dim: 'via_token', key: `${BASE}:${WALLET}|${BASE}:${XTOKEN}`, messages: 30, usd_value: 3_000, fee_usd: 3 },
    ], NOW);
    const c = harness({ now: NOW, labels: buildLabelIndex([withToken, IDLE]), labelTokens: buildTokenLabels([withToken, IDLE]), projects: buildProjectRegistry([withToken, IDLE]) }).c;
    // #when
    const project = (await buildProjects(c, XSTOCKS_DAY)).projects.find((p) => p.slug === 'xstocks')!;
    // #then 349 of the day's 1,569 messages
    expect({ week: project.totals['7d'], day: project.series.at(-1), tokens: project.tokens }).toEqual({
      week: { messages: 349, usd: 3_000, fee_usd: 82.75, share_pct: 22.2, via_token_messages: 30, via_token_usd: 3_000 },
      day: { day: XSTOCKS_DAY, messages: 349 },
      tokens: [{ chain: BASE, address: XTOKEN, symbol: 'TSLAx', source: 'https://xstocks.fi/tokens' }],
    });
  });
```

In `worker/test/moments.test.ts`, inside `describe('moments.json project spotlight', …)`, append:

```ts
  it('never tags a project whose week came only via its token, and counts those messages', async () => {
    // #given Gamma claims a Base token with no registry row; a wallet bridged it 600 times in the week of Oct 5
    const GAMMA_TOKEN = '0x00000000000000000000000000000000000000c3';
    const WALLET = '0x00000000000000000000000000000000000000d4';
    const gamma = {
      name: 'Gamma', x: 'gamma', url: null, kind: 'issuer' as const, source: null, addresses: [],
      tokens: [{ chain: 'ethereum-mainnet-base-1', address: GAMMA_TOKEN, source: 'https://gamma.example/ccip' }],
    };
    await seedRows([
      sender('2026-09-29', ALPHA, 100), sender('2026-09-29', BETA, 400), sender('2026-10-06', ALPHA, 300), sender('2026-10-06', BETA, 500),
      sender('2026-10-06', WALLET, 600), row('2026-10-06', 'via_token', `${BASE}:${WALLET}|${BASE}:${GAMMA_TOKEN}`, 600, 0, 150),
    ]);
    const c = harness({ now: NOW, labels, labelTokens: { [`ethereum-mainnet-base-1:${GAMMA_TOKEN}`]: 'gamma' }, projects: { gamma } }).c;
    // #when
    const { weeks } = await buildMoments(c, { lastDay: LAST_DAY, days: [] });
    // #then
    expect(weeks.at(-1)!.project).toMatchObject({ key: 'project:gamma', x: null, inferred: false, messages: 600 });
  });
```

In `worker/test/senders.test.ts`, inside `describe('recording new senders', …)`, append:

```ts
  it('records neither a project credited only via its token, which has no first day, nor the wallet whose sends moved to it', async () => {
    // #given a wallet new today bridged 400 of a token Gamma claims, ahead of xStocks's 319
    const BASE = NETWORKS.base.chainSelector;
    const WALLET = '0x00000000000000000000000000000000000000d4';
    const TOKEN = '0x00000000000000000000000000000000000000c3';
    const gamma = { name: 'Gamma', x: 'gamma', url: null, kind: 'issuer' as const, source: null, addresses: [], tokens: [] };
    await store.upsertListRows(env.DB, [firstMessage('w', XSTOCKS_DAY, NETWORKS.base, WALLET)], []);
    const breakdown = [
      ...xstocksBreakdown(),
      { day: XSTOCKS_DAY, dim: 'sender' as const, key: `${BASE}:${WALLET}`, messages: 400, usd_value: 0, fee_usd: null },
      { day: XSTOCKS_DAY, dim: 'via_token' as const, key: `${BASE}:${WALLET}|${BASE}:${TOKEN}`, messages: 400, usd_value: 0, fee_usd: null },
    ];
    const c = harness({ now: NOW, labels: XSTOCKS_LABELS, labelTokens: { [`ethereum-mainnet-base-1:${TOKEN}`]: 'gamma' }, projects: { gamma } }).c;
    // #when
    const keys = await recordSenderArrivals(c, XSTOCKS_DAY, breakdown);
    // #then
    expect(keys).toEqual(['project:xstocks']);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/projects.test.ts test/moments.test.ts test/senders.test.ts`
Expected: FAIL (no via-token fields or tokens in `projects.json`; the spotlight sees no credits; the wallet is recorded as new).

- [ ] **Step 3: The optional project fields**

In `packages/core/src/public.ts`, replace `ProjectWindowSchema` with:

```ts
const ProjectWindowSchema = z.object({
  messages: z.number(),
  usd: z.number(),
  fee_usd: z.number().nullable(),
  share_pct: z.number().nullable(),
  /** The part of `messages` and `usd` credited via the project's claimed tokens. */
  via_token_messages: z.number().optional(),
  via_token_usd: z.number().optional(),
});
```

and add to `ProjectSchema`, after `addresses: …,`:

```ts
  tokens: z.array(z.object({ chain: z.string(), address: z.string(), symbol: z.string().nullable(), source: z.string() })).optional(),
```

- [ ] **Step 4: Credits and tokens in `projects.json`**

In `worker/src/projects.ts`:

1. Add `viaTokenCredits` to the `@ccip-dev/core` import and change the `./senders` import to `import { senderBook, windowCredits } from './senders';`.

2. Replace `windowOf` with:

```ts
function windowOf(identity: IdentityTotals | undefined, total: store.WindowTotals): ProjectWindow {
  return {
    messages: identity?.messages ?? 0,
    usd: cents(identity?.usd_value ?? 0),
    fee_usd: identity === undefined || identity.fee_usd === null ? null : cents(identity.fee_usd),
    share_pct: sharePct(identity?.messages ?? 0, total.messages),
    via_token_messages: identity?.via_token_messages ?? 0,
    via_token_usd: cents(identity?.via_token_usd ?? 0),
  };
}

/** The project's `[[tokens]]` on chains CCIP knows, by selector. */
function claimedTokens(entry: RegistryEntry, selectorOf: ReadonlyMap<string, string>): { chain: string; address: string; source: string }[] {
  return entry.tokens.flatMap((t) => {
    const chain = selectorOf.get(t.chain);
    return chain === undefined ? [] : [{ chain, address: t.address, source: t.source }];
  });
}
```

3. In `buildProjects`, replace the lines from `const dayRows = …` through `const allTime = …` with:

```ts
  const dayRows = await store.senderDaysOf(db, from30, lastDay, book.labeled);
  const creditDays = await store.viaTokenCreditDays(db, from30, lastDay, book.claimed, book.labeled);
  const creditsOf = (rows: readonly store.LeaderRow[]) => viaTokenCredits(rows, book.claims);
  const month = mergeIdentities(dayRows, book.resolve, creditsOf(creditDays));
  const week = mergeIdentities(dayRows.filter((r) => r.day >= from7), book.resolve, creditsOf(creditDays.filter((r) => r.day >= from7)));
  const allTime = mergeIdentities(await store.senderTotalsOf(db, null, lastDay, book.labeled), book.resolve, await windowCredits(c, book, null, lastDay));
```

after the `selectorOf` line add:

```ts
  const symbols = await store.tokenSymbols(db, Object.values(c.projects).flatMap((entry) => claimedTokens(entry, selectorOf)));
```

after the `for (const r of dayRows) …` line inside the projects map add:

```ts
    for (const r of creditDays) {
      const [credit] = creditsOf([r]);
      if (credit !== undefined && projectKey(credit.project.slug) === key) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.messages);
    }
```

and after `addresses: addressesOf(…),` add:

```ts
      tokens: claimedTokens(entry, selectorOf).map((t) => ({ ...t, symbol: symbols.get(`${t.chain}:${t.address}`) ?? null })),
```

- [ ] **Step 5: New senders and arrivals through `identitiesOf`**

In `worker/src/senders.ts`, add `taggableX` to the `@ccip-dev/core` import. In `recordSenderArrivals`, replace the `identities` line with:

```ts
  const identities = identitiesOf(book, breakdown.filter((b) => b.dim === 'sender'), breakdown.filter((b) => b.dim === 'via_token'));
```

In `senderArrivals`, replace the `ranked` and `sinceFirst` lines and the `x` field with:

```ts
    const ranked = rankIdentities(
      identitiesOf(book, await store.breakdownBetween(db, 'sender', day, day), await store.breakdownBetween(db, 'via_token', day, day)),
      'messages',
      Infinity,
    );
```

```ts
    const sinceFirst = mergeIdentities(
      await store.senderTotalsOf(db, firstDay, day, identityAddresses(c.labels, identity)),
      book.resolve,
      await windowCredits(c, book, firstDay, day),
    ).find((i) => i.key === identity.key);
```

```ts
      x: taggableX(identity),
```

- [ ] **Step 6: Credits in the spotlight**

In `worker/src/moments.ts`, add `taggableX` to the `@ccip-dev/core` import and `windowCredits` to the `./senders` import. In `projectWeeks`, replace the assignment to `found` with:

```ts
      found = (async () => {
        const sunday = addDays(monday, 6);
        const rows = await store.senderTotalsOf(c.env.DB, monday, sunday, book.labeled);
        return mergeIdentities(rows, book.resolve, await windowCredits(c, book, monday, sunday)).filter((i) => i.slug !== null);
      })();
```

and in `projectSpotlightOf` write `x: taggableX(p),`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/projects.test.ts test/moments.test.ts test/senders.test.ts test/moments-pipeline.test.ts test/moment-facts.test.ts`
Expected: PASS.

- [ ] **Step 8: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add packages/core/src/public.ts worker/src/projects.ts worker/src/moments.ts worker/src/senders.ts \
  worker/test/projects.test.ts worker/test/moments.test.ts worker/test/senders.test.ts
git commit -m "feat(projects): count via-token sends in projects.json, new senders and the spotlight

A project's totals, share and series include its claimed tokens' direct sends, and
projects.json lists the tokens. New senders and the weekly spotlight see the same
identities; a project with no sends of its own is never tagged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: " via its token" in the daily and weekly posts

**Files:**
- Modify: `worker/src/broadcasts/facts.ts`, `worker/src/broadcasts/copy.ts`
- Test: `worker/test/broadcast-copy.test.ts`, `worker/test/broadcast-facts.test.ts`

**Interfaces:**
- **Consumes:** `mostlyViaToken` (Task 2); the identity fields of `day-leaders.json` and `weekLeaderRows` (Task 5).
- **Produces:** `SenderFacts.viaToken: boolean`, true when half or more of the leader's messages came via token; copy appends ` via its token` after the name on X and Telegram, daily and weekly.

- [ ] **Step 1: Write the failing tests**

In `worker/test/broadcast-copy.test.ts`, every `SenderFacts` literal gains `viaToken: false`: the `sender` of `DAILY`, the `sender` constants in `'still drops the busiest lane before the top sender when the sender carries a share'` and `'drops the busiest lane, then the top sender, then the top token until the post fits 280'`, the `pump.fun` sender in `'never writes a domain-looking name as a link, on X or Telegram'`, the `A<b>&C` sender in `'escapes names, and drops lines to stay within 1,024 characters'`, and `XSTOCKS` in `describe("the top sender's share")`. In `worker/test/broadcast-facts.test.ts`, the expected `sender` of the first `dailyFacts` test becomes `{ key: 'project:xstocks', player: { name: 'xStocks', x: 'xStocksFi' }, messages: 97, sharePct: 64.7, viaToken: false }`.

Append to `worker/test/broadcast-copy.test.ts`:

```ts
describe('a top sender credited via its token', () => {
  const ELIZA = { key: 'project:elizaos', player: p('elizaOS', 'elizaOS'), messages: 1_889, sharePct: 15.23, viaToken: true };

  it('says "via its token" after the name on X, with no mention', () => {
    // #when
    const { xText } = composeCopy(withLeaders({ sender: ELIZA }));
    // #then
    expect({ line: xText.split('\n').find((l) => l.startsWith('Top sender')), mentions: xText.match(/@\w+/g) }).toEqual({
      line: 'Top sender: elizaOS via its token · 1,889 messages (15%)',
      mentions: null,
    });
  });

  it('says it on Telegram, daily and weekly', () => {
    // #when
    const daily = composeCopy(withLeaders({ sender: ELIZA })).telegramHtml;
    const weekly = composeCopy({ ...WEEKLY, leaders: { ...WEEKLY.leaders, sender: ELIZA } }).telegramHtml;
    // #then
    expect([daily, weekly].map((t) => t.split('\n').find((l) => l.startsWith('Top sender')))).toEqual([
      "Top sender: elizaOS via its token · 1,889 messages, 15% of the day's",
      "Top sender: elizaOS via its token · 1,889 messages, 15% of the week's",
    ]);
  });

  it('keeps a 64-character name with the suffix within 280 by dropping the busiest lane first', () => {
    // #given the longest name a label file allows
    const name = long(64);
    // #when
    const { xText } = composeCopy(withLeaders({ sender: { ...ELIZA, player: p(name) } }));
    // #then
    expect({
      sender: xText.includes(`Top sender: ${name} via its token · 1,889 messages (15%)`),
      lane: xText.includes('Busiest lane'),
      fits: xLength(xText) <= X_MAX,
      cashtags: cashtags(xText).length,
    }).toEqual({ sender: true, lane: false, fits: true, cashtags: 1 });
  });
});
```

Append to `worker/test/broadcast-facts.test.ts`, inside `describe('daily facts', …)`:

```ts
  it('marks a top sender credited mostly via its token, and names it without its handle', async () => {
    // #given a wallet bridged 120 of a syrupUSDC token Maple claims, ahead of xStocks's 97
    await seedDay();
    const WALLET = '0x00000000000000000000000000000000000000d4';
    const insert = env.DB.prepare('INSERT INTO daily_breakdown VALUES (?, ?, ?, ?, ?, ?)');
    await env.DB.batch([
      insert.bind(DAY, 'sender', `${BASE}:${WALLET}`, 120, 0, 1),
      insert.bind(DAY, 'via_token', `${BASE}:${WALLET}|syrup`, 120, 0, 1),
    ]);
    const maple = { name: 'Maple', x: 'maplefinance', url: null, kind: 'protocol' as const, source: null, addresses: [], tokens: [] };
    const { c } = harness({ now: NOW, labels: LABELS, handles: HANDLES, labelTokens: { [labelKey('ethereum-mainnet', SYRUP_ETH)]: 'maple' }, projects: { maple } });
    // #when
    const facts = dailyFacts(await loadFactsSource(c, { days: [DAY], monday: null }), DAY);
    // #then
    expect(facts?.leaders.sender).toEqual({ key: 'project:maple', player: { name: 'Maple', x: null }, messages: 120, sharePct: 80, viaToken: true });
  });
```

(`seedDay` puts both syrupUSDC tokens in group `syrup`, so Maple's Ethereum entry claims the Base wallet's sends through the group. 120 of the day's 150 messages is 80%.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/broadcast-copy.test.ts test/broadcast-facts.test.ts`
Expected: FAIL (`viaToken` is not a `SenderFacts` field; the copy has no suffix).

- [ ] **Step 3: Facts and copy**

1. `worker/src/broadcasts/facts.ts`: add `mostlyViaToken` to the `@ccip-dev/core` import. In `SenderFacts`, after `sharePct`, add:

```ts
  /** Half or more of its messages came via its token, so the post says so. */
  viaToken: boolean;
```

and in `leaderFacts` make the sender:

```ts
    sender: sender
      ? {
          key: sender.key,
          player: { name: sender.label ?? shortAddress(senderKeyAddress(sender.key)), x: sender.inferred ? null : sender.x ?? null },
          messages: sender.messages,
          sharePct: sender.share_pct ?? null,
          viaToken: mostlyViaToken(sender.messages, sender.via_token_messages),
        }
      : null,
```

2. `worker/src/broadcasts/copy.ts`: add `SenderFacts` to the `./facts` type import, add below `present`:

```ts
const viaItsToken = (s: SenderFacts) => (s.viaToken ? ' via its token' : '');
```

and make the two sender lines:

```ts
    lines.push({ text: `Top sender: ${plainName(l.sender.player)}${viaItsToken(l.sender)} · ${plural(l.sender.messages, 'message')}${paren(share)}`, drop: DROP.sender });
```

```ts
    lines.push({ text: `Top sender: ${tgName(l.sender.player)}${viaItsToken(l.sender)} · ${plural(l.sender.messages, 'message')}${share}`, drop: DROP.sender });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/broadcast-copy.test.ts test/broadcast-facts.test.ts test/broadcasts.test.ts test/x-cashtags.test.ts`
Expected: PASS.

- [ ] **Step 5: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add worker/src/broadcasts/facts.ts worker/src/broadcasts/copy.ts worker/test/broadcast-copy.test.ts worker/test/broadcast-facts.test.ts
git commit -m "feat(broadcasts): name a top sender credited mostly via its token as such

When half or more of the daily or weekly top sender's messages came via its token, the
X and Telegram copy says \"elizaOS via its token\". Nobody is tagged, and a long name
still fits 280 by dropping the busiest lane first.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Checkpoint:** the Worker is complete. The controller reviews Tasks 1–7 and pushes `main`; the deploy applies migration 0008, then deploys the Worker. The site tasks follow.

---
### Task 8: The candidates job: the status page's coverage line, and "Tokens to claim"

**Files:**
- Modify: `scripts/label-candidates.ts`
- Test: `scripts/test/label-candidates.test.ts`

**Interfaces:**
- **Consumes:** `buildTokenLabels`, `buildProjectRegistry`, `claimedTokenKeys`, `tokenClaims`, `viaTokenCredits`, `labeledAddresses`, `REGISTRY_GROUPS_SQL` (Tasks 1, 3); `VIA_TOKEN_CREDITS_SQL` (Task 4); `mergeIdentities` with credits, `labelCoverage` (Task 2); `labelCoverageLine` from `@ccip-dev/core/format` (Task 2).
- **Produces:**
  - `viaTokenCreditsQuery(fromDay: string, toDay: string, claimed: readonly string[], labeled: readonly string[]): { sql: string; params: unknown[] }` and `registryGroupsQuery(keys: readonly string[])`, both on the core SQL the Worker runs.
  - `coverageMarkdown(now: LabelCoverage, before: LabelCoverage): string`, which leads with `labelCoverageLine(now)` and then `Since last week: +3 points of messages, −1 point of value, ±0 points of fees.`
  - `CLAIM_TOKENS = 15`, `interface ClaimRow { group_key; messages; usd; selector; chain_name; address; symbol; name; group_id }`, `tokensToClaimQuery(fromDay: string, toDay: string, claimed: readonly string[], limit = CLAIM_TOKENS)`.
  - `tokenExplorerLink(explorerMap: Record<string, string>, chainName: string | null, address: string | null): string | null` (`<blockscout>/token/<address>`).
  - `tokensToClaimMarkdown(rows: readonly ClaimRow[], byValue: readonly TokenGap[], explorerMap: Record<string, string>): string`: `## Tokens to claim`, with `### By direct sends` and `### By value, with no handle` (the old "Tokens without a project" table, folded in, with name and explorer link).
  - `TokenGap.name: string | null`; `handleGapsMarkdown(gaps: { chains: readonly ChainGap[] }): string` (chains only).

**Ruling:** "Tokens to claim" ranks unclaimed groups by all their direct sends, labeled wallets included: a token with direct sends nobody claims is worth a look whoever sent them. The candidate list itself is unchanged (it already skips wallets under 100 messages a week).

- [ ] **Step 1: Write the failing tests**

In `scripts/test/label-candidates.test.ts`, add `registryGroupsQuery, tokensToClaimMarkdown, tokensToClaimQuery, viaTokenCreditsQuery` to the `../label-candidates` import. In `describe('handle gaps')`:
- `tables()` creates `CREATE TABLE tokens (chain TEXT, address TEXT, symbol TEXT, name TEXT, group_id TEXT);`.
- Both `db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?)').run('1', '0xAbC', 'syrupUSDC', 'syrup');` become `db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?)').run('1', '0xAbC', 'syrupUSDC', 'Syrup USDC', 'syrup');`.
- `'lists the busiest tokens of the window with their symbol, group and chain'` expects `{ key: '1:0xabc', usd: 1000, symbol: 'syrupUSDC', name: 'Syrup USDC', group_id: 'syrup', chain_name: 'ethereum-mainnet' }` and `{ key: '1:0xdef', usd: 900, symbol: null, name: null, group_id: null, chain_name: 'ethereum-mainnet' }`.
- In `'keeps only the tokens no entry covers, …'`, the `token` helper becomes `({ key, usd: 1, symbol: 'T', name: 'Token', group_id: group, chain_name: 'ethereum-mainnet' })`.
- Replace `'writes the gaps for the pull request with escaped cells, and says when there are none'` with:

```ts
  it('writes the chains with no handle for the pull request, and says when there are none', () => {
    // #when
    const some = handleGapsMarkdown({ chains: [{ selector: '2', chain_name: 'ethereum-mainnet-base-1' }] });
    const none = handleGapsMarkdown({ chains: [] });
    // #then
    expect({
      heading: some.startsWith('## Handles to research'),
      chain: some.includes('| ethereum-mainnet-base-1 | 2 |'),
      tokens: some.includes('Token'),
      none: none.includes('Nothing to research this week.'),
    }).toEqual({ heading: true, chain: true, tokens: false, none: true });
  });
```

Append inside `describe('handle gaps')`:

```ts
  it("reads the week's via-token credits with the Worker's own query", () => {
    // #given two wallets and a labeled one bridged elizaOS's group, and one bridged USDC
    const { db } = tables();
    const via = db.prepare("INSERT INTO daily_breakdown VALUES ('2026-10-08', 'via_token', ?, ?, ?, NULL)");
    via.run('2:0xw1|g-eliza', 5, 50);
    via.run('2:0xw2|g-eliza', 3, 30);
    via.run('2:0xlabeled|g-eliza', 7, 70);
    via.run('2:0xw3|g-usdc', 9, 90);
    // #when
    const q = viaTokenCreditsQuery('2026-10-07', '2026-10-13', ['g-eliza'], ['0xlabeled']);
    const rows = db.prepare(q.sql).all(...(q.params as string[])) as any[];
    // #then
    expect(rows.map((r) => ({ ...r }))).toEqual([{ key: '2|g-eliza', messages: 8, usd_value: 80, fee_usd: null }]);
  });

  it('reads the registry group of each claimed token by selector and address', () => {
    // #given
    const { db } = tables();
    db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?)').run('1', '0xe1', 'ELIZA', 'elizaOS', 'g-eliza');
    // #when
    const q = registryGroupsQuery(['1:0xe1', '1:0xnone']);
    const rows = db.prepare(q.sql).all(...(q.params as string[])) as any[];
    // #then
    expect(rows.map((r) => ({ ...r }))).toEqual([{ key: '1:0xe1', group_id: 'g-eliza' }]);
  });

  it('lists the busiest unclaimed token groups by direct sends, each with the token on its busiest chain', () => {
    // #given elizaOS on two chains (17, mostly Base), USDC 8, a token outside the registry 4, syrup 20 but claimed, and an older USDC week
    const { db } = tables();
    for (const [selector, name] of [['1', 'ethereum-mainnet'], ['2', 'ethereum-mainnet-base-1']]) db.prepare('INSERT INTO chains VALUES (?, ?)').run(selector, name);
    const token = db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?)');
    token.run('1', '0xe1', 'ELIZA', 'elizaOS', 'g-eliza');
    token.run('2', '0xe2', 'ELIZA', 'elizaOS', 'g-eliza');
    token.run('1', '0xusdc', 'USDC', 'USD Coin', 'g-usdc');
    token.run('2', '0xsyrup', 'syrupUSDC', 'Syrup USDC', 'g-syrup');
    const via = db.prepare("INSERT INTO daily_breakdown VALUES (?, 'via_token', ?, ?, ?, NULL)");
    via.run('2026-10-08', '1:0xw1|g-eliza', 5, 50);
    via.run('2026-10-08', '2:0xw2|g-eliza', 9, 90);
    via.run('2026-10-08', '2:0xw3|g-eliza', 3, 30);
    via.run('2026-10-08', '1:0xw4|g-usdc', 8, 80);
    via.run('2026-10-08', '2:0xw5|g-syrup', 20, 200);
    via.run('2026-10-08', '1:0xw6|1:0xloose', 4, 40);
    via.run('2026-09-01', '1:0xw7|g-usdc', 100, 1000);
    // #when
    const q = tokensToClaimQuery('2026-10-07', '2026-10-13', ['g-syrup']);
    const rows = db.prepare(q.sql).all(...(q.params as (string | number)[])) as any[];
    // #then
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { group_key: 'g-eliza', messages: 17, usd: 170, selector: '2', chain_name: 'ethereum-mainnet-base-1', address: '0xe2', symbol: 'ELIZA', name: 'elizaOS', group_id: 'g-eliza' },
      { group_key: 'g-usdc', messages: 8, usd: 80, selector: '1', chain_name: 'ethereum-mainnet', address: '0xusdc', symbol: 'USDC', name: 'USD Coin', group_id: 'g-usdc' },
      { group_key: '1:0xloose', messages: 4, usd: 40, selector: '1', chain_name: 'ethereum-mainnet', address: '0xloose', symbol: null, name: null, group_id: null },
    ]);
  });

  it('writes the tokens to claim with explorer links, then the busiest tokens with no handle, and says when there are none', () => {
    // #given
    const explorers = { 'ethereum-mainnet-base-1': 'https://base.blockscout.com/' };
    const eliza = { group_key: 'g-eliza', messages: 17, usd: 170.4, selector: '2', chain_name: 'ethereum-mainnet-base-1', address: '0xe2', symbol: 'EL|ZA', name: 'elizaOS', group_id: 'g-eliza' };
    const loose = { group_key: '1:0xloose', messages: 4, usd: 40, selector: '1', chain_name: 'ethereum-mainnet', address: '0xloose', symbol: null, name: null, group_id: null };
    const gap = { key: '1:0xccc', usd: 1234.5, symbol: 'T', name: 'Token', group_id: null, chain_name: 'ethereum-mainnet' };
    // #when
    const some = tokensToClaimMarkdown([eliza, loose], [gap], explorers);
    const none = tokensToClaimMarkdown([], [], explorers);
    // #then
    expect({
      heading: some.startsWith('## Tokens to claim'),
      claim: some.includes('| EL\\|ZA | elizaOS | ethereum-mainnet-base-1 | 0xe2 | g-eliza | 17 | 170 | [link](https://base.blockscout.com/token/0xe2) |'),
      loose: some.includes('| - | - | ethereum-mainnet | 0xloose | - | 4 | 40 | - |'),
      gap: some.includes('| T | Token | ethereum-mainnet | 0xccc | - | 1,235 | - |'),
      rule: some.includes('USDC, LINK, cbBTC'),
      none: none.includes('No unclaimed direct sends this week.') && none.includes('Every busy token has a handle.'),
    }).toEqual({ heading: true, claim: true, loose: true, gap: true, rule: true, none: true });
  });
```

In `describe('the candidates pull request')`, replace `'leads with label coverage and its change in points from last week'` with:

```ts
  it("leads with the status page's coverage line, then each share's change in points from last week", () => {
    // #given
    const now = { messages_pct: 81.2, usd_pct: 94.4, fees_pct: 90, via_token_messages_pct: 45.1, via_token_usd_pct: 20, via_token_fees_pct: 30, window: '7d' as const };
    const before = { messages_pct: 78.2, usd_pct: 95.4, fees_pct: 90, via_token_messages_pct: 40, via_token_usd_pct: 20, via_token_fees_pct: 30, window: '7d' as const };
    const none = { messages_pct: null, usd_pct: null, fees_pct: null, via_token_messages_pct: null, via_token_usd_pct: null, via_token_fees_pct: null, window: '7d' as const };
    // #then
    expect([coverageMarkdown(now, before), coverageMarkdown(now, none), coverageMarkdown(none, before)]).toEqual([
      'Labeled: 81% of messages (36% sent by a labeled project, 45% via its token), 94% of value (last 7 days). Since last week: +3 points of messages, −1 point of value, ±0 points of fees.',
      'Labeled: 81% of messages (36% sent by a labeled project, 45% via its token), 94% of value (last 7 days).',
      'Labeled senders: no messages in the last 7 days.',
    ]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run scripts/test/label-candidates.test.ts`
Expected: FAIL (the new functions are not exported; `tokenGapQuery` has no `name`; `coverageMarkdown` has the old wording).

- [ ] **Step 3: Queries and markdown**

In `scripts/label-candidates.ts`:

1. Replace the `@ccip-dev/core` import with:

```ts
import {
  addDays, buildHandles, buildLabelIndex, buildProjectRegistry, buildTokenLabels, claimedTokenKeys, dayOf, identityResolver, isAddressShape, labelCoverage,
  labeledAddresses, labelKey, mergeIdentities, REGISTRY_GROUPS_SQL, sanitize, senderKeyAddress, tokenClaims, validateChainHandles, validateRegistry, VIA_TOKEN_CREDITS_SQL,
  viaTokenCredits, type Handles, type IdentityResolver, type LabelCoverage, type RegistryProject, type SenderRow,
} from '@ccip-dev/core';
```

and the format import with `import { dataSharePct, formatShare, labelCoverageLine } from '@ccip-dev/core/format';`.

2. Replace `coverageMarkdown` with:

```ts
/** The line the PR leads with: the status page's coverage line, then each share's change in points from last week. */
export function coverageMarkdown(now: LabelCoverage, before: LabelCoverage): string {
  const line = labelCoverageLine(now);
  if (line === null) return 'Labeled senders: no messages in the last 7 days.';
  const change = (what: string, a: number | null, b: number | null) => (a === null || b === null ? [] : [`${points(a - b)} of ${what}`]);
  const changes = [...change('messages', now.messages_pct, before.messages_pct), ...change('value', now.usd_pct, before.usd_pct), ...change('fees', now.fees_pct, before.fees_pct)];
  return changes.length === 0 ? `${line}.` : `${line}. Since last week: ${changes.join(', ')}.`;
}

/** The via-token credits over [fromDay, toDay], through the Worker's own query, so the coverage matches the status page's. */
export function viaTokenCreditsQuery(fromDay: string, toDay: string, claimed: readonly string[], labeled: readonly string[]) {
  return { sql: VIA_TOKEN_CREDITS_SQL, params: [fromDay, toDay, JSON.stringify(claimed), JSON.stringify(labeled)] };
}

/** Registry groups by `<selector>:<address>`, for resolving the claims. */
export function registryGroupsQuery(keys: readonly string[]) {
  return { sql: REGISTRY_GROUPS_SQL, params: [JSON.stringify(keys)] };
}
```

3. Add `name: string | null;` to `TokenGap` after `symbol`, and in `tokenGapQuery` select `t.symbol AS symbol, t.name AS name, t.group_id AS group_id, c.name AS chain_name`.

4. Replace `handleGapsMarkdown` with:

```ts
export function handleGapsMarkdown(gaps: { chains: readonly ChainGap[] }): string {
  const intro = [
    '## Handles to research',
    '',
    'Regenerated by the weekly label-candidates job.',
    '',
    "Add a chain's handle only with a source: the chain's own website or docs, on a page that links to the X account. Chains go in `labels/chain-x.json`. Leave out anything you cannot verify; it stays a plain name. See docs/runbook.md, \"Labels and handles\".",
    '',
  ];
  if (gaps.chains.length === 0) return [...intro, 'Nothing to research this week.', ''].join('\n');
  return [
    ...intro,
    '### Chains without an X handle',
    '',
    '| Chain | Selector |',
    '|---|---|',
    ...gaps.chains.map((c) => `| ${escapeMarkdownCell(c.chain_name ?? '-')} | ${escapeMarkdownCell(c.selector)} |`),
    '',
  ].join('\n');
}
```

5. Add after `handleGapsMarkdown`:

```ts
export const CLAIM_TOKENS = 15;

export interface ClaimRow {
  /** The via_token key's group: a registry group id, or `<selector>:<address>` for a token with none. */
  group_key: string;
  messages: number;
  usd: number;
  /** The source chain with the most direct sends of the group. */
  selector: string;
  chain_name: string | null;
  address: string | null;
  symbol: string | null;
  name: string | null;
  group_id: string | null;
}

/**
 * The ?4 token groups with the most direct sends (via_token rows) over [?1, ?2] that no claimed key in ?3 covers, each
 * with its token on its busiest source chain: the registry's symbol, name and group, or a group-less token's own address.
 */
export function tokensToClaimQuery(fromDay: string, toDay: string, claimed: readonly string[], limit = CLAIM_TOKENS) {
  return {
    sql: `WITH via AS (
            SELECT substr(key, instr(key, '|') + 1) AS group_key, substr(key, 1, instr(key, ':') - 1) AS selector, SUM(messages) AS messages, SUM(usd_value) AS usd
            FROM daily_breakdown WHERE dim = 'via_token' AND day >= ?1 AND day <= ?2 GROUP BY group_key, selector
          ), top AS (
            SELECT group_key, SUM(messages) AS messages, SUM(usd) AS usd FROM via
            WHERE group_key NOT IN (SELECT value FROM json_each(?3))
            GROUP BY group_key ORDER BY SUM(messages) DESC, SUM(usd) DESC, group_key LIMIT ?4
          ), busiest AS (
            SELECT v.group_key, v.selector, ROW_NUMBER() OVER (PARTITION BY v.group_key ORDER BY v.messages DESC, v.selector) AS rn
            FROM via v JOIN top ON top.group_key = v.group_key
          ), tok AS (
            SELECT chain, address, symbol, name, group_id, COALESCE(group_id, chain || ':' || address) AS group_key,
              ROW_NUMBER() OVER (PARTITION BY chain, COALESCE(group_id, chain || ':' || address) ORDER BY address) AS rn
            FROM tokens
          )
          SELECT top.group_key AS group_key, top.messages AS messages, top.usd AS usd, b.selector AS selector, c.name AS chain_name,
            COALESCE(t.address, CASE WHEN instr(top.group_key, ':') > 0 THEN substr(top.group_key, instr(top.group_key, ':') + 1) END) AS address,
            t.symbol AS symbol, t.name AS name, t.group_id AS group_id
          FROM top JOIN busiest b ON b.group_key = top.group_key AND b.rn = 1
          LEFT JOIN tok t ON t.rn = 1 AND t.chain = b.selector AND t.group_key = top.group_key
          LEFT JOIN chains c ON c.selector = b.selector
          ORDER BY top.messages DESC, top.usd DESC, top.group_key`,
    params: [fromDay, toDay, JSON.stringify(claimed), limit],
  };
}

/** The Blockscout page of a token on its chain, when the chain has one. */
export function tokenExplorerLink(explorerMap: Record<string, string>, chainName: string | null, address: string | null): string | null {
  const base = chainName === null ? undefined : explorerMap[chainName];
  return base === undefined || address === null ? null : `${base.replace(/\/$/, '')}/token/${address}`;
}

export function tokensToClaimMarkdown(rows: readonly ClaimRow[], byValue: readonly TokenGap[], explorerMap: Record<string, string>): string {
  const cell = (text: string | null) => escapeMarkdownCell(text ?? '-');
  const link = (chain: string | null, address: string | null) => {
    const url = tokenExplorerLink(explorerMap, chain, address);
    return url === null ? '-' : `[link](${url})`;
  };
  const dollars = (usd: number) => Math.round(usd).toLocaleString('en-US');
  const sends =
    rows.length === 0
      ? ['No unclaimed direct sends this week.']
      : [
          '| Token | Name | Chain | Address | Group | Direct sends (7d) | USD (7d) | Explorer |',
          '|---|---|---|---|---|---|---|---|',
          ...rows.map(
            (r) =>
              `| ${cell(r.symbol)} | ${cell(r.name)} | ${cell(r.chain_name ?? r.selector)} | ${cell(r.address)} | ${cell(r.group_id)} | ${r.messages} | ` +
              `${dollars(r.usd)} | ${link(r.chain_name, r.address)} |`,
          ),
        ];
  const value =
    byValue.length === 0
      ? ['Every busy token has a handle.']
      : [
          '| Token | Name | Chain | Address | Group | USD (7d) | Explorer |',
          '|---|---|---|---|---|---|---|',
          ...byValue.map((t) => {
            const address = t.key.slice(t.key.indexOf(':') + 1);
            return `| ${cell(t.symbol)} | ${cell(t.name)} | ${cell(t.chain_name)} | ${cell(address)} | ${cell(t.group_id)} | ${dollars(t.usd)} | ${link(t.chain_name, address)} |`;
          }),
        ];
  return [
    '## Tokens to claim',
    '',
    'Regenerated by the weekly label-candidates job.',
    '',
    "A wallet that calls the CCIP router itself is the sender of its message, so its sends are credited to the project that claims the message's first token, \"via its token\". Claim a token with a `[[tokens]]` entry (`chain`, `address`, `source`) in the project's file, and only for the project that put the token on CCIP: the source is the project's own docs or announcement naming CCIP and the token's address. General-purpose assets that no single app's users bridge (USDC, LINK, cbBTC and the like) are not claimed. A claim needs `verified = true`; tagging the token in posts also needs the project's `x`. See docs/runbook.md, \"Labels and handles\".",
    '',
    '### By direct sends',
    '',
    ...sends,
    '',
    '### By value, with no handle',
    '',
    ...value,
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Coverage with credits and the new section in `main`**

In `main()`:

1. Replace the `resolve` line with:

```ts
  const senderChains = new Map(chainRows.map((c) => [c.selector, { name: c.name, family: c.family }]));
  const labelIndex = buildLabelIndex(projects);
  const resolve = identityResolver(labelIndex, senderChains);
  const tokenLabels = buildTokenLabels(projects);
  const rgq = registryGroupsQuery(claimedTokenKeys(tokenLabels, senderChains));
  const groups = new Map((await d1<{ key: string; group_id: string | null }>(rgq.sql, rgq.params)).map((r) => [r.key, r.group_id]));
  const claims = tokenClaims(tokenLabels, buildProjectRegistry(projects), senderChains, groups);
  const claimed = [...claims.keys()];
  const labeledList = labeledAddresses(labelIndex);
```

2. After `windowTotals`, add:

```ts
  const windowCredits = async (from: string, to: string) => {
    const q = viaTokenCreditsQuery(from, to, claimed, labeledList);
    return viaTokenCredits(await d1<SenderRow>(q.sql, q.params), claims);
  };
```

and make the coverage:

```ts
  const coverage = coverageMarkdown(
    labelCoverage(mergeIdentities(weekRows, resolve, await windowCredits(windows.week.from, windows.week.to)), await windowTotals(windows.week.from, windows.week.to)),
    labelCoverage(
      mergeIdentities(await windowRows(windows.before.from, windows.before.to), resolve, await windowCredits(windows.before.from, windows.before.to)),
      await windowTotals(windows.before.from, windows.before.to),
    ),
  );
```

3. Replace the lines from `const gapsMarkdown = handleGapsMarkdown(gaps);` to the final `console.log` with:

```ts
  const ctq = tokensToClaimQuery(since, windows.week.to, claimed);
  const toClaim = await d1<ClaimRow>(ctq.sql, ctq.params);
  const tokensMarkdown = tokensToClaimMarkdown(toClaim, gaps.tokens, explorerMap);
  const gapsMarkdown = handleGapsMarkdown(gaps);
  await writeFile(path.join(ROOT, 'labels/handle-gaps.md'), `${tokensMarkdown}\n${gapsMarkdown}`);
  await writeFile(path.join(ROOT, 'pr-body.md'), `${prBody(report, today, coverage, spread)}\n${tokensMarkdown}\n${gapsMarkdown}`);
  console.log(`${report.length} candidate draft(s) written; ${toClaim.length} token(s) to claim; ${gaps.tokens.length} token and ${gaps.chains.length} chain handle gap(s)`);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run scripts/test/label-candidates.test.ts`
Expected: PASS.

- [ ] **Step 6: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add scripts/label-candidates.ts scripts/test/label-candidates.test.ts
git commit -m "feat(candidates): lead with the status page's coverage, and list tokens to claim

The weekly PR's coverage counts via-token credits through the Worker's own query and
wording. A new \"Tokens to claim\" section ranks the unclaimed token groups by direct
sends, with symbol, name and explorer link, and folds in the token handle gaps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Site: the "via token" mark on Top › Senders, the day page and the cards; the status line

**Files:**
- Modify: `site/src/lib/senders.ts`, `site/src/lib/top.ts`, `site/src/lib/status-light.ts`, `site/src/components/CoverageNote.tsx`, `site/src/styles/base.css`
- Modify: `site/src/pages/top/[dim]/[window]/[...order].astro`, `site/src/pages/day/[day].astro`
- Modify: `site/worker/cards/broadcast-cards.ts`, `site/worker/cards/content.ts`
- Test: `site/test/senders.test.ts`, `site/test/broadcast-cards.test.ts`, `site/test/card-content.test.ts`, `site/test/status-light.test.ts`, `site/test/coverage-note.test.ts`

**Interfaces:**
- **Consumes:** the optional identity fields (Task 5); `labelCoverageLine` (Task 2, re-exported by `site/src/lib/format.ts` from `@ccip-dev/core/format`).
- **Produces:**
  - `VIA_TOKEN_TITLE: string`, `viaTokenMark(e: Pick<TopEntry, 'messages' | 'via_token_messages' | 'via_token'>): string | null` in `site/src/lib/senders.ts`.
  - `SenderView.viaToken: string | null` (and `TopRow.viaToken?: string | null`). A via-token-only project has `verified: false` and a secondary of its chain count alone.
  - `coverageLine` leaves `status-light.ts`; `CoverageNote` calls `labelCoverageLine`.

**Ruling:** a via-token-only row shows no ✓: its messages come from wallets, not from an address the label verifies. The mark says where they come from instead.

- [ ] **Step 1: Write the failing tests**

`site/test/senders.test.ts`: add `viaTokenMark` to the `../src/lib/senders` import; add `viaToken: null` to the expected views of `'names a project with its tick, address and chain counts, and links its page'` and `'names an unlabeled address by its short form and first three chains, …'`; append inside `describe('sender rows')`:

```ts
  it("marks a project credited only via its token, without the tick or an address count", () => {
    // #when
    const view = senderView({ ...XSTOCKS, messages: 60, via_token_messages: 60, via_token: true, addresses: 0, chains: [BASE] }, names, registry, slugs);
    // #then
    expect([view.verified, view.viaToken, view.secondary]).toEqual([false, 'via token', '1 chain']);
  });

  it('marks a project with some messages via its token, keeping its tick', () => {
    // #when
    const view = senderView({ ...XSTOCKS, messages: 2_000, via_token_messages: 1_889, via_token: false }, names, registry, slugs);
    // #then
    expect([view.verified, view.viaToken]).toEqual([true, 'incl. 1,889 via token']);
  });

  it('has no mark for an entry from a file published before the split', () => {
    // #then
    expect(viaTokenMark(XSTOCKS)).toBeNull();
  });
```

`site/test/broadcast-cards.test.ts`, append inside `describe('daily broadcast card')`:

```ts
  it("marks the day's top sender credited via its token under its figure", async () => {
    // #given the same sender with all, then some, of its messages via its token
    const withSender = (sender: object): typeof loadFixture => async (name) =>
      name === 'day-leaders.json' ? ({ ...LEADERS, days: LEADERS.days.map((d) => (d.day === DAY ? { ...d, sender } : d)) } as never) : loadFixture(name);
    const all = { key: 'project:elizaos', label: 'elizaOS', messages: 1_889, usd: 0, fee_usd: 1, share_pct: 15.2, via_token_messages: 1_889, via_token: true };
    const some = { ...all, messages: 2_000, via_token: false };
    // #when
    const allTexts = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load: withSender(all) }));
    const someTexts = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load: withSender(some) }));
    // #then
    expect([allTexts.includes('via token'), someTexts.includes('incl. 1,889 via token')]).toEqual([true, true]);
  });
```

`site/test/card-content.test.ts`, append inside `describe('top senders card')`:

```ts
  it("adds the via-token mark to the top sender's line", () => {
    // #given
    const file = {
      ...envelope, dim: 'sender' as const, since: '2023-07-06',
      windows: { '7d': [], '30d': [], all: [] },
      identities: { '7d': [{ key: 'project:elizaos', label: 'elizaOS', messages: 1_889, usd: 10, via_token_messages: 1_889, via_token: true }], '30d': [], all: [] },
    };
    // #then
    expect(topCard(file, 'sender', '7d', 'value', names).label).toBe('$10 · 1,889 messages · via token');
  });
```

`site/test/status-light.test.ts`: remove `coverageLine` from the `../src/lib/status-light` import, add `import { labelCoverageLine } from '../src/lib/format';`, call `labelCoverageLine(coverage)` in `describe('label coverage line')`, and add this case to its `it.each` table:

```ts
    [{ messages_pct: 74.2, usd_pct: 61.3, fees_pct: 70, via_token_messages_pct: 45.1, via_token_usd_pct: 20, via_token_fees_pct: 30, window: '7d' as const }, 'Labeled: 74% of messages (29% sent by a labeled project, 45% via its token), 61% of value (last 7 days)'],
```

`site/test/coverage-note.test.ts`, append inside `describe('coverage note')`:

```ts
  it('says the part credited via a token when the coverage has it', () => {
    // #given
    const coverage = { messages_pct: 74.2, usd_pct: 61.3, fees_pct: 70, via_token_messages_pct: 45.1, via_token_usd_pct: 20, via_token_fees_pct: 30, window: '7d' as const };
    // #then
    expect(html(coverage)).toMatch(/Labeled: 74% of messages \(29% sent by a labeled project, 45% via its token\), 61% of value \(last 7 days\)(<!-- -->)?\. <a href="\/projects\/">See the projects<\/a>/);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/senders.test.ts test/broadcast-cards.test.ts test/card-content.test.ts test/status-light.test.ts test/coverage-note.test.ts`
Expected: FAIL (no `viaTokenMark`, no `viaToken` in views, no mark on the cards, the coverage note has the old wording).

- [ ] **Step 3: The mark in the sender view**

In `site/src/lib/senders.ts`:

1. Add `import { formatCount } from './format';`.
2. Add after `registryNames`:

```ts
export const VIA_TOKEN_TITLE = "Credited via its token: wallets bridging the project's token through CCIP themselves";

/** "via token" when every message came via the project's token, "incl. 1,889 via token" when some did; null when none did or the file predates the split. */
export function viaTokenMark(e: Pick<TopEntry, 'messages' | 'via_token_messages' | 'via_token'>): string | null {
  const via = e.via_token_messages ?? 0;
  if (via <= 0) return null;
  return e.via_token ? 'via token' : `incl. ${formatCount(via)} via token`;
}
```

3. In `SenderView`, add after `inferred: boolean;`:

```ts
  /** The via-token mark of a project credited messages via its token. */
  viaToken: string | null;
```

4. Make `SenderFields` `Pick<TopEntry, 'key' | 'label' | 'inferred' | 'chains' | 'addresses' | 'messages' | 'via_token_messages' | 'via_token'>`.
5. In `senderView`, add `viaToken: null,` to the legacy and address returns, and make the project return:

```ts
  if (parsed.kind === 'project') {
    const inferred = e.inferred ?? false;
    const addresses = e.addresses ?? 0;
    return {
      primary: e.label ?? parsed.slug,
      secondary: [...(addresses > 0 ? [counted(addresses, 'address', 'addresses')] : []), counted(chains.length, 'chain', 'chains')].join(' · '),
      verified: !inferred && !(e.via_token ?? false),
      inferred,
      viaToken: viaTokenMark(e),
      chains,
      href: slugs.has(parsed.slug) ? projectHref(parsed.slug) : null,
      suggestUrl: null,
    };
  }
```

In `site/src/lib/top.ts`, add to `TopRow` after `inferred?: boolean;`:

```ts
  /** Sender rows only: the via-token mark. */
  viaToken?: string | null;
```

- [ ] **Step 4: The mark on the pages, and its style**

1. `site/src/pages/top/[dim]/[window]/[...order].astro`: import `VIA_TOKEN_TITLE` with `registryNames, senderEntries, senderRows`; after `{r.inferred && <span class="inferred" …>inferred</span>}` add `{r.viaToken && <span class="via-token" title={VIA_TOKEN_TITLE}>{r.viaToken}</span>}`; and make the sender note `{dim === 'sender' && 'A project counts every address its label names, on every chain, and the direct sends of the tokens it claims; "inferred" marks an address credited through the same address labeled on another chain, and "via token" the messages of wallets bridging the project\'s token through CCIP themselves.'}`.
2. `site/src/pages/day/[day].astro`: import `VIA_TOKEN_TITLE` with `daySender, registryNames`; after the day's sender `inferred` span add `{sender.viaToken && <span class="via-token" title={VIA_TOKEN_TITLE}>{sender.viaToken}</span>}`.
3. `site/src/styles/base.css`: the `.inferred { … }` rule's selector becomes `.inferred, .via-token`.

- [ ] **Step 5: The mark on the cards**

1. `site/worker/cards/broadcast-cards.ts`: add `import { viaTokenMark } from '../../src/lib/senders';`; give `leaderCell` a fourth parameter `note: string | null = null` and a fourth child after `value`:

```ts
    note === null
      ? null
      : h('div', { style: { fontSize: 14, color: COLORS.muted, marginTop: 2, maxWidth: 145, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, note),
```

and pass `viaTokenMark(lead.sender)` as the sender cell's fourth argument in `leadersRow`.

2. `site/worker/cards/content.ts`: import `viaTokenMark` with `senderEntries` from `'../../src/lib/senders'`; in `topCard`, add `const mark = dim === 'sender' && first ? viaTokenMark(first) : null;` after `const first = entries[0];`, and make the label `first ? `${amount(first)}${byFees ? ' in fees' : ''} · ${formatCount(first.messages)} messages${mark === null ? '' : ` · ${mark}`}` : 'No data yet'`.

- [ ] **Step 6: The coverage line**

1. `site/src/lib/status-light.ts`: delete `coverageLine`, and make the format import `import { formatDuration } from './format';`.
2. `site/src/components/CoverageNote.tsx`: import `labelCoverageLine` from `'../lib/format'` in place of `coverageLine` from `'../lib/status-light'`, and call `labelCoverageLine(coverage)`. (`@ccip-dev/core/format` has no imports, so the status page's island stays small; `@ccip-dev/core/senders` would pull zod and the label code into it.)

- [ ] **Step 7: Run the tests and the build**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/senders.test.ts test/broadcast-cards.test.ts test/card-content.test.ts test/status-light.test.ts test/coverage-note.test.ts test/top.test.ts test/day.test.ts && pnpm --filter @ccip-dev/site build`
Expected: PASS, and the build succeeds against production data.

- [ ] **Step 8: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add site/src/lib/senders.ts site/src/lib/top.ts site/src/lib/status-light.ts site/src/components/CoverageNote.tsx site/src/styles/base.css \
  "site/src/pages/top/[dim]/[window]/[...order].astro" "site/src/pages/day/[day].astro" site/worker/cards/broadcast-cards.ts site/worker/cards/content.ts \
  site/test/senders.test.ts site/test/broadcast-cards.test.ts site/test/card-content.test.ts site/test/status-light.test.ts site/test/coverage-note.test.ts
git commit -m "feat(site): mark senders credited via their token, and say so in coverage

Top › Senders, the day's top sender, the daily card and the top card show \"via token\"
or \"incl. 1,889 via token\". The status page reads the coverage line with its sent-by
and via-token parts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Site: project pages' split and claimed tokens

**Files:**
- Modify: `site/src/lib/projects.ts`, `site/src/pages/projects/[slug].astro`, `site/src/pages/projects/index.astro`
- Test: `site/test/projects.test.ts`

**Interfaces:**
- **Consumes:** `ProjectWindowSchema.via_token_messages`, `ProjectSchema.tokens` (Task 6).
- **Produces:** `viaTokenSplitText(t: Project['totals']['7d']): string | null`; `interface ProjectTokenRow { chain: string; symbol: string; address: string; source: string }`; `projectTokenRows(project: Project): ProjectTokenRow[]`.

- [ ] **Step 1: Write the failing tests**

In `site/test/projects.test.ts`, add `projectTokenRows, viaTokenSplitText` to the `../src/lib/projects` import and append:

```ts
describe('a project credited via its token', () => {
  const window = { messages: 2_000, usd: 10, fee_usd: 1, share_pct: 15, via_token_messages: 689, via_token_usd: 5 };

  it('words a window split between its contracts and its token, and has none without via-token messages', () => {
    // #then
    expect([viaTokenSplitText(window), viaTokenSplitText({ ...window, via_token_messages: 0 }), viaTokenSplitText(XSTOCKS!.totals['7d'])]).toEqual([
      '1,311 sent by its contracts · 689 via its token, by wallets bridging it',
      null,
      null,
    ]);
  });

  it('lists its claimed tokens, one without a symbol by its short address, and none for a file from before tokens', () => {
    // #given
    const project = {
      ...XSTOCKS!,
      tokens: [
        { chain: '1', address: '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b', symbol: null, source: 'https://x.example' },
        { chain: '2', address: '0xabc', symbol: 'TSLAx', source: 'https://y.example' },
      ],
    };
    // #then
    expect([projectTokenRows(project).map((t) => t.symbol), projectTokenRows(XSTOCKS!)]).toEqual([['0x80ac…cc0b', 'TSLAx'], []]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/projects.test.ts`
Expected: FAIL (`viaTokenSplitText` and `projectTokenRows` are not exported).

- [ ] **Step 3: The helpers**

In `site/src/lib/projects.ts`, make the format import `import { formatCount, formatShare } from './format';`, add `import { shortAddress } from './names';`, and append:

```ts
/** "1,311 sent by its contracts · 689 via its token, by wallets bridging it"; null for a window with nothing via its token. */
export function viaTokenSplitText(t: Project['totals']['7d']): string | null {
  const via = t.via_token_messages ?? 0;
  return via <= 0 ? null : `${formatCount(t.messages - via)} sent by its contracts · ${formatCount(via)} via its token, by wallets bridging it`;
}

export interface ProjectTokenRow {
  chain: string;
  symbol: string;
  address: string;
  source: string;
}

/** The tokens the project claims; one with no symbol is named by its short address. */
export function projectTokenRows(project: Project): ProjectTokenRow[] {
  return (project.tokens ?? []).map((t) => ({ chain: t.chain, symbol: t.symbol ?? shortAddress(t.address), address: t.address, source: t.source }));
}
```

- [ ] **Step 4: The page**

In `site/src/pages/projects/[slug].astro`:

1. Import `projectTokenRows, viaTokenSplitText` with the other `../../lib/projects` names, and add `const tokens = projectTokenRows(project);` after `const week = …`.
2. Make the windows map return the tiles and their split:

```astro
  {WINDOWS.map(([w, label]) => {
    const t = project.totals[w];
    const via = viaTokenSplitText(t);
    return (
      <>
        <section class="tiles wrap-labels project-window" aria-label={label}>
          <div class="tile"><span class="label">Messages, {label}</span><p class="value">{formatCount(t.messages)}</p></div>
          <div class="tile"><span class="label">Value, {label}</span><p class="value">{formatUsd(t.usd)}</p></div>
          <div class="tile"><span class="label">Fees, {label}</span><p class="value">{formatFeeTotal(t.fee_usd)}</p></div>
          <div class="tile"><span class="label">Share of messages, {label}</span><p class="value">{formatShare(t.share_pct)}</p></div>
        </section>
        {via && <p class="muted">{via}, {label}.</p>}
      </>
    );
  })}
```

3. In "Chains and lanes", render the lanes table only when `project.lanes.length > 0`, and after the `split` line add:

```astro
      {(project.totals['30d'].via_token_messages ?? 0) > 0 && <p class="muted">Top lanes and the data split count the messages its own addresses sent; messages via its token are in the totals and the chart.</p>}
```

4. In "Addresses", when `project.addresses.length === 0` show `<p class="muted">Its label names no sending address; its messages come via its tokens.</p>` in place of the table.
5. After the "Addresses" table and before the source line, add:

```astro
  {tokens.length > 0 && (
    <>
      <h2>Tokens</h2>
      <p class="muted">Wallets that bridge these tokens through CCIP themselves are credited to {project.name}, "via its token". One entry covers every chain of the token's CCIP registry group.</p>
      <div class="table-wrap card">
        <table class="data">
          <thead><tr><th>Chain</th><th>Token</th><th>Address</th><th>Source</th></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr>
                <td><ChainIcons selectors={[t.chain]} />{chainName(names, t.chain)}</td>
                <td>{t.symbol}</td>
                <td class="mono">{t.address}</td>
                <td><a href={t.source} rel="noopener">Source</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )}
```

In `site/src/pages/projects/index.astro`, make the intro's second sentence `A project counts every address its label names, on every chain, and the direct sends of the tokens it claims.`

- [ ] **Step 5: Run the tests and the build**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/projects.test.ts test/project-cards.test.ts && pnpm --filter @ccip-dev/site build`
Expected: PASS, and the build succeeds against production data.

- [ ] **Step 6: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add site/src/lib/projects.ts "site/src/pages/projects/[slug].astro" site/src/pages/projects/index.astro site/test/projects.test.ts
git commit -m "feat(site): show a project's via-token split and the tokens it claims

Each project page splits its 7- and 30-day messages into those its contracts sent and
those via its token, notes that lanes count its own sends, and lists its claimed tokens
with their sources.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Checkpoint:** the controller reviews Tasks 8–10 and pushes `main`. The site builds against the Worker's new files.

---

### Task 11: The methodology and the runbook

**Files:**
- Modify: `docs/methodology.md`, `docs/runbook.md`

This task has no code; its check is that the docs say what Tasks 1–10 do.

- [ ] **Step 1: The methodology**

In `docs/methodology.md`, "Senders and projects":

1. Replace the **Sender identity** bullet's first sentence with: `**Sender identity:** a message is credited, in this order, to the project whose verified label names its source chain and sender address ("sent by"); to the project whose label names the same EVM address on another EVM chain ("inferred", see below); to the project that claims its first token, when its sender is the wallet that signed it ("via token", see below); and otherwise to the sender address itself, across every chain it sends from.` Keep the xStocks example sentence.
2. Add after the **Label spread** bullet:

```markdown
- **Via token:** when a wallet calls the CCIP router itself (`sender = origin`), the sender is only an address, but the project behind the message is the token's issuer. Such a message is credited to the verified project whose `[[tokens]]` entry names its first token (`message_tokens.idx = 0`): either the exact token on its chain, or any token in the same CCIP registry group. It counts only when no label names the sender on any chain, so a labeled wallet keeps its label and a message an app contract sent is never credited this way. The project's totals are its sent-by messages plus its via-token ones, and the address loses what moved; an address left with nothing drops out of the rankings. General-purpose assets that no single app's users bridge (USDC, LINK, cbBTC and the like) are not claimed, so their direct sends stay with the address. Every day since 2023-07-06 is covered: the list API gives every message an origin.
```

3. Replace the **Label coverage** bullet with: `**Label coverage:** the share of the last 7 days' messages, value and fees credited to a project (sent by, inferred or via token), computed at each finalize and shown on the status page with its via-token part: "Labeled: 74% of messages (29% sent by a labeled project, 45% via its token), 61% of value (last 7 days)".`
4. In the **Project pages** bullet, add after "its addresses (inferred ones marked)": `, the tokens it claims, and how its 7- and 30-day messages split between its own sends and via its token (its lanes and data split count its own sends only)`.
5. In **Public files**, add a sub-bullet: `` From 2026-10-14 every sender identity also carries `via_token_messages`, `via_token_usd`, `via_token_fee_usd` and `via_token` (true when every message came via token); `label_coverage` adds `via_token_messages_pct`, `via_token_usd_pct` and `via_token_fees_pct`; a `projects.json` window adds `via_token_messages` and `via_token_usd`, and a project lists its `tokens`. A via-token-only identity publishes `x` as null. ``

- [ ] **Step 2: The runbook**

In `docs/runbook.md`, "Labels and handles":

1. In the first paragraph, after "an inferred (spread) identity never is", add `, and neither is a project credited only via its token`.
2. Replace the **Tokens** bullet with:

```markdown
- **Tokens:** a `[[tokens]]` entry (`chain`, `address`, `source`) in the issuing project's file claims the token. It covers every chain in the token's CCIP registry group, and a token outside the registry by its exact chain and address. A verified project's claim credits the token's direct sends (a wallet calling the CCIP router itself) to the project, "via its token"; an `x` is needed only for the token to be tagged in posts. Only the project that put the token on CCIP may claim it, with its own docs or announcement naming CCIP and the token's address as the `source`. General-purpose assets that no single app's users bridge (USDC, LINK, cbBTC and the like) are not claimed. Two projects claiming tokens of one group credit neither through the group. A project file may hold tokens and no addresses.
```

3. In **Check and build**, list `label-tokens.json` (each verified project's tokens to its slug) after `label-projects.json`, and say `label-projects.json` now carries each project's tokens.
4. In **Weekly candidates**, replace "It ends with the label spread report and `labels/handle-gaps.md`, the busiest tokens with no project entry and the busiest chains with no handle." with `It ends with the label spread report and labels/handle-gaps.md: "Tokens to claim" (the 15 busiest token groups by direct sends that no project claims, with symbol, name and explorer link, then the busiest tokens by value with no handle) and the busiest chains with no handle. Its coverage line is the status page's, with the change from last week.`

Under "Incidents and alerts", add after "### Re-finalize a day":

```markdown
### Via-token backfill

The Worker's hourly run fills the `via_token` rows of the days rolled up before the dimension existed: 60 days a run, newest first, one statement a day, from the meta cursor `via_token_backfill:before` (the oldest day filled so far, then `done`). History takes about 20 hours after the deploy; until then, long windows count part of the via-token sends as their senders'. A failed run alerts `via-token-backfill` and resumes from the cursor the next hour. Progress: `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "SELECT value FROM meta WHERE key = 'via_token_backfill:before'"`. To fill the history again, delete that row; the rows are upserted, so a second pass changes nothing that is already right.
```

- [ ] **Step 3: Check the docs against the code and commit**

Run: `grep -n "via token\|via_token\|Tokens to claim\|label-tokens" docs/methodology.md docs/runbook.md`
Expected: each change above appears once.

```bash
git add docs/methodology.md docs/runbook.md
git commit -m "docs: via-token attribution in the methodology and the runbook

How a direct send is credited to the token's project, the token proof rule and the
assets nobody claims, the new public fields, the candidates job's Tokens to claim, and
how the Worker backfills the via-token history.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
