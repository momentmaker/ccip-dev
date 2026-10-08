# Fee Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch one CCIP detail per historical message, value each fee at its send-day price, and load the fee columns and fee aggregates for every day from 2023-07-06 to 2026-10-04 into D1. The site's fee coverage then follows the data.

**Architecture:** Three resumable scripts under `scripts/backfill/fees/`, all working in `.backfill/fees/`:
- `fetch` crawls newest day first at an adaptive rate and writes gzipped JSONL records per day.
- `build` turns finished days into SQL `UPDATE`s, using the original build's price cache and the Worker's own `buildRows`, `rollupDay` and `linkFeeUsd`.
- `upload` applies the SQL with wrangler and waits out the finalize windows.

A small core helper builds the LINK fee set from a registry snapshot. A guard stops the original backfill upload from wiping fees. The site derives fee coverage from `history.json`.

**Tech stack:** TypeScript (ESM, `tsx`), Vitest 4, `node:zlib`, `@ccip-dev/core`, wrangler for D1, DefiLlama `coins.llama.fi` (free), and the CCIP API `https://api.ccip.chain.link/v2` (free).

**Spec:** `docs/superpowers/specs/2026-10-08-fee-backfill-design.md`. The survey of the existing pipeline is in `.superpowers/fee-backfill-map.md`.

## Global Constraints

- **Data directory:** `.backfill/fees/`, git-ignored through `.backfill/`. The original data in `.backfill/archive`, `.backfill/prices`, `.backfill/registry` and `.backfill/sql` is input only: never write, move or delete it. The price cache is the one exception, since `PriceCache.ensure` may add keys to `.backfill/prices/cache.json`.
- **Rate:**
  - Start at 3 req/s. Add 1 req/s after each healthy 10-minute window, up to a cap of 8.
  - Never go below 1 req/s.
  - Halve on a 429, or on an error rate above 1% over at least 20 requests, then hold for 10 minutes.
  - On a 429, pause for `Retry-After`, capped at 30 s, or 5 s when it's absent.
  - Up to 6 requests in flight.
  - Stop after 15 minutes without a successful answer.
  - Every request sends `user-agent: curl/8.7.1` (`USER_AGENT` from `@ccip-dev/core`) and has a 30 s timeout.
- **Message update predicate:** `WHERE message_id = … AND source = 'backfill' AND detail_fetched_at IS NULL`. Live rows must never match.
- **Price cache range:** it must open with the exact range of the original build, `<oldest archive day>..<newest archive day>`, which is `2023-07-06..2026-10-04`. A mismatch is an error, never a silent refetch.
- **Finalize windows:** no SQL file starts between 23:55 and 00:30 UTC or between 05:50 and 06:20 UTC.
- **Free sources only:** the CCIP API and DefiLlama free endpoints. No new dependencies.
- **Commits:**
  - Conventional subjects (`feat(scripts): …`, `feat(core): …`, `fix(site): …`, `docs(runbook): …`).
  - Stage explicit paths only; never `git add -A`, `git add .` or `git commit -a`.
  - End each message with the implementer's `Co-Authored-By` trailer.
- **Tests:**
  - `scripts/test/**/*.test.ts` runs with the root `vitest run`;
  - core tests run with `pnpm --filter @ccip-dev/core test`;
  - site tests run with `pnpm --filter site test`.
  - Use the BDD comments `// #given`, `// #when`, `// #then` in new tests.

## Review Focus

1. **A crash mid-day leaves a half-written last line in the partial file.** The rerun must drop that line, fetch the message again, and keep every complete line. (Task 3, the test "drops a last line cut short by a crash".)
2. **The API answers 200 with a body that isn't JSON** (an HTML error page, or a truncated body). That is a retryable error, not a crash and not a skip. (Task 4, the test "retries a 200 whose body is not JSON".)
3. **Every detail of a day is a 404 or fails the schema.** The day still seals, its aggregates are written with NULL fees, and each skip is recorded. (Task 5, the test "writes NULL fee aggregates for a day whose details were all skipped".)
4. **The price cache file has a different range or is missing.** The build stops with a clear error instead of refetching about 1,800 series. (Task 5, the test "refuses a price cache built for another range".)
5. **`wrangler` fails in the middle of a file.** The file stays unapplied and a rerun applies it again. The statements are idempotent. (Task 6, the test "leaves a file unapplied when wrangler fails".)

---

### Task 1: Core: LINK fee keys from a registry snapshot

**Files:**
- Modify: `packages/core/src/rollup.ts` (add `linkFeeKeys` next to `linkFeeMatcher`)
- Test: `packages/core/test/rollup.test.ts`

**Interfaces:**
- Consumes: `LINK_TOKEN`, `LINK_TOKEN_CHAIN_SELECTOR`, `UNLISTED_LINK_FEE_TOKENS` (`packages/core/src/reserve.ts`) and `normalizeAddress` (`normalize.ts`).
- Produces: `linkFeeKeys(tokens: readonly { chain: string; address: string; groupId: string | null }[]): Set<string>`. Each key has the form `${chainSelector}:${normalizedAddress}`. It holds the same set `worker/src/store.ts` `linkFeeTokens` builds from D1: Ethereum LINK, the unlisted LINK fee tokens, and every token that shares Ethereum LINK's `groupId`.

- [ ] **Step 1: Write the failing test.** Add it to `packages/core/test/rollup.test.ts`, and extend the existing import from `../src/rollup` with `linkFeeKeys`:

```ts
describe('linkFeeKeys', () => {
  const ethLink = { chain: '5009297550715157269', address: '0x514910771af9ca656af840dff83e8264ecf986ca', groupId: 'link-group' };
  const baseLink = { chain: '15971525489660198786', address: '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196', groupId: 'link-group' };
  const baseWeth = { chain: '15971525489660198786', address: '0x4200000000000000000000000000000000000006', groupId: 'weth-group' };

  it("includes every registry token in Ethereum LINK's group", () => {
    // #given / #when
    const keys = linkFeeKeys([ethLink, baseLink, baseWeth]);

    // #then
    expect(keys.has(`${baseLink.chain}:${baseLink.address}`)).toBe(true);
  });

  it('leaves out tokens of other groups', () => {
    expect(linkFeeKeys([ethLink, baseLink, baseWeth]).has(`${baseWeth.chain}:${baseWeth.address}`)).toBe(false);
  });

  it('includes Ethereum LINK and the unlisted LINK fee tokens even with an empty registry', () => {
    const keys = linkFeeKeys([]);
    expect([keys.has('5009297550715157269:0x514910771af9ca656af840dff83e8264ecf986ca'), keys.has('4949039107694359620:0xf97f4df75117a78c1a5a0dbb814af92458539fb4')]).toEqual([true, true]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `pnpm --filter @ccip-dev/core exec vitest run test/rollup.test.ts -t linkFeeKeys`. Expected: FAIL, because `linkFeeKeys` is not exported.

- [ ] **Step 3: Implement it** in `packages/core/src/rollup.ts`, after `linkFeeMatcher`. Add `import { LINK_TOKEN, LINK_TOKEN_CHAIN_SELECTOR, UNLISTED_LINK_FEE_TOKENS } from './reserve';` to the imports.

```ts
/** The LINK fee tokens as `chain:address` keys; the same set the Worker's `store.linkFeeTokens` reads from D1. */
export function linkFeeKeys(tokens: readonly { chain: string; address: string; groupId: string | null }[]): Set<string> {
  const ethLink = normalizeAddress(LINK_TOKEN);
  const group = tokens.find((t) => t.chain === LINK_TOKEN_CHAIN_SELECTOR && normalizeAddress(t.address) === ethLink)?.groupId ?? null;
  return new Set([
    `${LINK_TOKEN_CHAIN_SELECTOR}:${ethLink}`,
    ...Object.entries(UNLISTED_LINK_FEE_TOKENS).map(([chain, address]) => `${chain}:${normalizeAddress(address)}`),
    ...(group === null ? [] : tokens.filter((t) => t.groupId === group).map((t) => `${t.chain}:${normalizeAddress(t.address)}`)),
  ]);
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @ccip-dev/core test`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/rollup.ts packages/core/test/rollup.test.ts
git commit -m "feat(core): build the LINK fee token set from a registry snapshot"
```

---

### Task 2: Adaptive rate and pacer

**Files:**
- Create: `scripts/backfill/fees/rate.ts`
- Test: `scripts/test/fees-rate.test.ts`

**Interfaces:**
- Produces:
  - `RATE`, the constants;
  - `type RateSample = { kind: 'ok'; latencyMs: number | null } | { kind: 'throttled'; retryAfterMs: number | null } | { kind: 'error' }`;
  - `class AdaptiveRate`, with `constructor(now: () => number, log?: (line: string) => void, start?: number)`, the getter `rps: number`, and the methods `intervalMs(): number`, `pausedUntil(): number` and `record(sample: RateSample): void`;
  - `class Pacer`, with `constructor(rate: AdaptiveRate, clock: { now: () => number; sleep: (ms: number) => Promise<void> })` and `acquire(): Promise<void>`.

- [ ] **Step 1: Write the failing tests** in `scripts/test/fees-rate.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { AdaptiveRate, Pacer, RATE } from '../backfill/fees/rate';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; }, sleep: async (ms: number) => { t += ms; } };
}

/** Feeds `seconds` of successful requests at the current rate, each with `latencyMs`. */
function healthy(rate: AdaptiveRate, c: ReturnType<typeof clock>, seconds: number, latencyMs = 200): void {
  const end = c.now() + seconds * 1000;
  while (c.now() < end) {
    c.advance(rate.intervalMs());
    rate.record({ kind: 'ok', latencyMs });
  }
}

describe('AdaptiveRate', () => {
  it('starts at 3 requests per second', () => {
    expect(new AdaptiveRate(clock().now).rps).toBe(3);
  });

  it('adds one request per second after a healthy ten-minute window', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now);

    // #when
    healthy(rate, c, 600);

    // #then
    expect(rate.rps).toBe(4);
  });

  it('never goes past 8 requests per second', () => {
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    healthy(rate, c, 600 * 12);
    expect(rate.rps).toBe(RATE.maxRps);
  });

  it('halves on a 429, pauses for its Retry-After, and holds before stepping up again', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    healthy(rate, c, 600 * 3);

    // #when
    rate.record({ kind: 'throttled', retryAfterMs: 12_000 });

    // #then
    expect({ rps: rate.rps, pausedFor: rate.pausedUntil() - c.now() }).toEqual({ rps: 3, pausedFor: 12_000 });
  });

  it('caps a long Retry-After at 30 seconds and assumes 5 seconds when there is none', () => {
    const c = clock();
    const a = new AdaptiveRate(c.now);
    a.record({ kind: 'throttled', retryAfterMs: 120_000 });
    const b = new AdaptiveRate(c.now);
    b.record({ kind: 'throttled', retryAfterMs: null });
    expect([a.pausedUntil(), b.pausedUntil()]).toEqual([30_000, 5_000]);
  });

  it('never drops below 1 request per second', () => {
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    for (let i = 0; i < 5; i++) rate.record({ kind: 'throttled', retryAfterMs: 1_000 });
    expect(rate.rps).toBe(RATE.minRps);
  });

  it('halves when more than 1% of at least 20 requests fail', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now, () => {}, 6);

    // #when
    for (let i = 0; i < 18; i++) rate.record({ kind: 'ok', latencyMs: 100 });
    rate.record({ kind: 'error' });
    rate.record({ kind: 'error' });

    // #then
    expect(rate.rps).toBe(3);
  });

  it('does not step up when the median latency more than doubles', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    healthy(rate, c, 600, 200);

    // #when
    healthy(rate, c, 600, 500);

    // #then
    expect(rate.rps).toBe(4);
  });
});

describe('Pacer', () => {
  it('spaces request starts by the rate even when callers ask at once', async () => {
    // #given
    const c = clock(1_000);
    const pacer = new Pacer(new AdaptiveRate(c.now, () => {}, 4), c);
    const starts: number[] = [];

    // #when
    for (let i = 0; i < 3; i++) {
      await pacer.acquire();
      starts.push(c.now());
    }

    // #then
    expect(starts).toEqual([1_000, 1_250, 1_500]);
  });

  it('waits out a pause before the next start', async () => {
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    rate.record({ kind: 'throttled', retryAfterMs: 7_000 });
    await new Pacer(rate, c).acquire();
    expect(c.now()).toBe(7_000);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm exec vitest run scripts/test/fees-rate.test.ts`. Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement** `scripts/backfill/fees/rate.ts`.

```ts
export const RATE = {
  startRps: 3,
  maxRps: 8,
  minRps: 1,
  stepRps: 1,
  windowMs: 10 * 60_000,
  holdMs: 10 * 60_000,
  maxErrorRate: 0.01,
  minSamplesForErrorRate: 20,
  latencyFactor: 2,
  defaultPauseMs: 5_000,
  maxPauseMs: 30_000,
} as const;

export type RateSample = { kind: 'ok'; latencyMs: number | null } | { kind: 'throttled'; retryAfterMs: number | null } | { kind: 'error' };

/** Additive increase, multiplicative decrease: one more request per second after each healthy window, half on trouble. */
export class AdaptiveRate {
  private current: number;
  private windowStart: number;
  private ok = 0;
  private errors = 0;
  private latencies: number[] = [];
  private baselineMs: number | null = null;
  private holdUntil = 0;
  private pause = 0;

  constructor(private readonly now: () => number, private readonly log: (line: string) => void = () => {}, start: number = RATE.startRps) {
    this.current = start;
    this.windowStart = now();
  }

  get rps(): number {
    return this.current;
  }

  intervalMs(): number {
    return 1000 / this.current;
  }

  pausedUntil(): number {
    return this.pause;
  }

  record(sample: RateSample): void {
    const now = this.now();
    if (sample.kind === 'throttled') {
      this.pause = now + Math.min(sample.retryAfterMs ?? RATE.defaultPauseMs, RATE.maxPauseMs);
      this.backOff(now, 'HTTP 429');
      return;
    }
    if (sample.kind === 'ok') {
      this.ok += 1;
      if (sample.latencyMs !== null) this.latencies.push(sample.latencyMs);
    } else {
      this.errors += 1;
    }
    const total = this.ok + this.errors;
    if (total >= RATE.minSamplesForErrorRate && this.errors / total > RATE.maxErrorRate) {
      this.backOff(now, `${this.errors} of ${total} requests failed`);
      return;
    }
    if (now - this.windowStart >= RATE.windowMs) this.closeWindow(now);
  }

  private closeWindow(now: number): void {
    const median = medianOf(this.latencies);
    if (this.baselineMs === null) this.baselineMs = median;
    const total = this.ok + this.errors;
    const fewErrors = total === 0 || this.errors / total <= RATE.maxErrorRate;
    const fast = median === null || this.baselineMs === null || median <= this.baselineMs * RATE.latencyFactor;
    if (fewErrors && fast && now >= this.holdUntil && this.current < RATE.maxRps) {
      const next = Math.min(RATE.maxRps, this.current + RATE.stepRps);
      this.log(`rate ${this.current} -> ${next} req/s (healthy window, median ${Math.round(median ?? 0)} ms)`);
      this.current = next;
    }
    this.resetWindow(now);
  }

  private backOff(now: number, why: string): void {
    const next = Math.max(RATE.minRps, Math.floor(this.current / 2));
    this.log(`rate ${this.current} -> ${next} req/s (${why}); holding ${RATE.holdMs / 60_000} min`);
    this.current = next;
    this.holdUntil = now + RATE.holdMs;
    this.resetWindow(now);
  }

  private resetWindow(now: number): void {
    this.windowStart = now;
    this.ok = 0;
    this.errors = 0;
    this.latencies = [];
  }
}

/** Spaces request starts by the current rate. Each start is reserved before awaiting, so concurrent callers never share a slot. */
export class Pacer {
  private next = 0;

  constructor(private readonly rate: AdaptiveRate, private readonly clock: { now: () => number; sleep: (ms: number) => Promise<void> }) {}

  async acquire(): Promise<void> {
    const now = this.clock.now();
    const at = Math.max(now, this.next, this.rate.pausedUntil());
    this.next = at + this.rate.intervalMs();
    if (at > now) await this.clock.sleep(at - now);
  }
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm exec vitest run scripts/test/fees-rate.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/backfill/fees/rate.ts scripts/test/fees-rate.test.ts
git commit -m "feat(scripts): adaptive request rate for the fee backfill"
```

---

### Task 3: Archive reader and detail record store

**Files:**
- Create: `scripts/backfill/fees/store.ts`
- Test: `scripts/test/fees-store.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic(file, contents)` from `scripts/backfill/crawl.ts`.
- Produces:
  - `type DetailRecord = { id: string; kind: 'ok'; fetchedAt: string; version: string | null; fee: { token: string; amount: string } | null; feeShapeUnknown: boolean; tokens: { token: string; amount: string }[] } | { id: string; kind: 'skip'; fetchedAt: string; status: number | null; reason: string }`;
  - `listArchiveDays(dir: string): Promise<string[]>`, newest first;
  - `readArchiveDay(dir: string, day: string): Promise<unknown[]>`, the raw list messages;
  - `appendRecords(dir: string, day: string, records: DetailRecord[]): Promise<void>`;
  - `readPartial(dir: string, day: string): Promise<DetailRecord[]>`;
  - `sealDay(dir: string, day: string): Promise<number>`, which returns the record count;
  - `readSealedDay(dir: string, day: string): Promise<DetailRecord[]>`;
  - `listSealedDays(dir: string): Promise<string[]>`, newest first;
  - `saveUnparsed(dir: string, id: string, body: unknown): Promise<void>`.

  Here `dir` is always the `.backfill` directory. The paths are:
  - archive: `<dir>/archive/messages/YYYY/MM/DD.jsonl.gz`
  - partial: `<dir>/fees/details/YYYY/MM/DD.partial.jsonl`
  - sealed: `<dir>/fees/details/YYYY/MM/DD.jsonl.gz`
  - unparsed: `<dir>/fees/unparsed/<id>.json`

- [ ] **Step 1: Write the failing tests** in `scripts/test/fees-store.test.ts`.

```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { appendRecords, listArchiveDays, listSealedDays, readArchiveDay, readPartial, readSealedDay, sealDay, type DetailRecord } from '../backfill/fees/store';

async function backfill(days: Record<string, unknown[]>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-store-'));
  for (const [day, messages] of Object.entries(days)) {
    const file = path.join(dir, 'archive', 'messages', day.slice(0, 4), day.slice(5, 7), `${day.slice(8, 10)}.jsonl.gz`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, gzipSync(messages.map((m) => JSON.stringify(m)).join('\n') + '\n'));
  }
  return dir;
}

const ok = (id: string): DetailRecord => ({ id, kind: 'ok', fetchedAt: '2026-10-08T00:00:00.000Z', version: '1.6.0', fee: { token: '0xabc', amount: '1' }, feeShapeUnknown: false, tokens: [] });

describe('archive', () => {
  it('lists archive days newest first', async () => {
    const dir = await backfill({ '2023-07-06': [], '2026-10-04': [], '2025-01-31': [] });
    expect(await listArchiveDays(dir)).toEqual(['2026-10-04', '2025-01-31', '2023-07-06']);
  });

  it("reads a day's raw messages", async () => {
    const dir = await backfill({ '2026-10-04': [{ messageId: '0x1' }, { messageId: '0x2' }] });
    expect(await readArchiveDay(dir, '2026-10-04')).toEqual([{ messageId: '0x1' }, { messageId: '0x2' }]);
  });
});

describe('detail records', () => {
  it('keeps appended records in the partial file until the day is sealed', async () => {
    // #given
    const dir = await backfill({});

    // #when
    await appendRecords(dir, '2026-10-04', [ok('0x1')]);
    await appendRecords(dir, '2026-10-04', [ok('0x2')]);

    // #then
    expect((await readPartial(dir, '2026-10-04')).map((r) => r.id)).toEqual(['0x1', '0x2']);
  });

  it('drops a last line cut short by a crash, so that message is fetched again', async () => {
    // #given
    const dir = await backfill({});
    await appendRecords(dir, '2026-10-04', [ok('0x1')]);
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await writeFile(partial, `${await readFile(partial, 'utf8')}{"id":"0x2","kind":"o`);

    // #when
    const records = await readPartial(dir, '2026-10-04');

    // #then
    expect(records.map((r) => r.id)).toEqual(['0x1']);
  });

  it('seals a day into one gzipped file, keeps the last record per id, and removes the partial', async () => {
    // #given
    const dir = await backfill({});
    await appendRecords(dir, '2026-10-04', [ok('0x1'), { id: '0x2', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' }, ok('0x2')]);

    // #when
    const count = await sealDay(dir, '2026-10-04');

    // #then
    expect({
      count,
      ids: (await readSealedDay(dir, '2026-10-04')).map((r) => `${r.id}:${r.kind}`),
      partialLeft: existsSync(path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl')),
      sealed: await listSealedDays(dir),
    }).toEqual({ count: 2, ids: ['0x1:ok', '0x2:ok'], partialLeft: false, sealed: ['2026-10-04'] });
  });

  it('seals an empty day', async () => {
    const dir = await backfill({});
    expect(await sealDay(dir, '2026-10-03')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm exec vitest run scripts/test/fees-store.test.ts`. Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement** `scripts/backfill/fees/store.ts`.

```ts
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeFileAtomic } from '../crawl';

export type DetailRecord =
  | {
      id: string;
      kind: 'ok';
      fetchedAt: string;
      version: string | null;
      fee: { token: string; amount: string } | null;
      feeShapeUnknown: boolean;
      tokens: { token: string; amount: string }[];
    }
  | { id: string; kind: 'skip'; fetchedAt: string; status: number | null; reason: string };

const DAY_FILE = /^(\d{4})\/(\d{2})\/(\d{2})\.jsonl\.gz$/;

const dayFile = (root: string, day: string, suffix: string) => path.join(root, day.slice(0, 4), day.slice(5, 7), `${day.slice(8, 10)}${suffix}`);
const archiveRoot = (dir: string) => path.join(dir, 'archive', 'messages');
const detailsRoot = (dir: string) => path.join(dir, 'fees', 'details');

async function daysIn(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files = (await readdir(root, { recursive: true })).map((p) => p.split(path.sep).join('/'));
  return files
    .map((p) => DAY_FILE.exec(p))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}-${m[2]}-${m[3]}`)
    .sort()
    .reverse();
}

export const listArchiveDays = (dir: string) => daysIn(archiveRoot(dir));
export const listSealedDays = (dir: string) => daysIn(detailsRoot(dir));

export async function readArchiveDay(dir: string, day: string): Promise<unknown[]> {
  return parseLines(gunzipSync(await readFile(dayFile(archiveRoot(dir), day, '.jsonl.gz'))).toString('utf8'), false);
}

export async function appendRecords(dir: string, day: string, records: DetailRecord[]): Promise<void> {
  if (records.length === 0) return;
  const file = dayFile(detailsRoot(dir), day, '.partial.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, records.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

/** A day's records so far. A last line cut short by a crash is dropped, so its message is fetched again. */
export async function readPartial(dir: string, day: string): Promise<DetailRecord[]> {
  const file = dayFile(detailsRoot(dir), day, '.partial.jsonl');
  return existsSync(file) ? (parseLines(await readFile(file, 'utf8'), true) as DetailRecord[]) : [];
}

export async function sealDay(dir: string, day: string): Promise<number> {
  const byId = new Map<string, DetailRecord>();
  for (const r of await readPartial(dir, day)) byId.set(r.id, r);
  const sealed = dayFile(detailsRoot(dir), day, '.jsonl.gz');
  await mkdir(path.dirname(sealed), { recursive: true });
  const tmp = `${sealed}.tmp`;
  await writeFile(tmp, gzipSync([...byId.values()].map((r) => `${JSON.stringify(r)}\n`).join('')));
  await rename(tmp, sealed);
  await rm(dayFile(detailsRoot(dir), day, '.partial.jsonl'), { force: true });
  return byId.size;
}

export async function readSealedDay(dir: string, day: string): Promise<DetailRecord[]> {
  return parseLines(gunzipSync(await readFile(dayFile(detailsRoot(dir), day, '.jsonl.gz'))).toString('utf8'), false) as DetailRecord[];
}

export async function saveUnparsed(dir: string, id: string, body: unknown): Promise<void> {
  const file = path.join(dir, 'fees', 'unparsed', `${id}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, JSON.stringify(body));
}

function parseLines(text: string, tolerateCutLastLine: boolean): unknown[] {
  const lines = text.split('\n').filter((l) => l.length > 0);
  return lines.flatMap((line, i) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch (err) {
      if (tolerateCutLastLine && i === lines.length - 1) return [];
      throw new Error(`line ${i + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  });
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm exec vitest run scripts/test/fees-store.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/backfill/fees/store.ts scripts/test/fees-store.test.ts
git commit -m "feat(scripts): archive reader and per-day detail record store for the fee backfill"
```

---

### Task 4: Fetch command (`pnpm backfill:fees:fetch`)

**Files:**
- Create: `scripts/backfill/fees/fetch.ts`
- Modify: `package.json` (scripts: `"backfill:fees:fetch": "tsx scripts/backfill/fees/fetch.ts"`)
- Test: `scripts/test/fees-fetch.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's `AdaptiveRate`, `Pacer` and `RateSample`;
  - Task 3's `listArchiveDays`, `readArchiveDay`, `appendRecords`, `readPartial`, `sealDay`, `saveUnparsed` and `DetailRecord`;
  - from `@ccip-dev/core`: `CCIP_API_BASE`, `DetailMessage`, `issuePath`, `normalizeDetail` and `USER_AGENT`;
  - `writeFileAtomic` from `../crawl`.
- Produces:
  - `type FetchDeps = { fetch: typeof fetch; now: () => number; sleep: (ms: number) => Promise<void> }`;
  - `type DetailOutcome = { kind: 'ok'; body: unknown; latencyMs: number } | { kind: 'gone'; status: number } | { kind: 'throttled'; retryAfterMs: number | null } | { kind: 'error'; status: number | null; message: string }`;
  - `fetchDetail(deps: FetchDeps, baseUrl: string, id: string): Promise<DetailOutcome>`;
  - `recordFromBody(id: string, body: unknown, fetchedAt: string): { record: DetailRecord; keepRaw: boolean }`;
  - `runFetch(opts: FetchOptions): Promise<FetchState>`;
  - `runProbe(opts: FetchOptions & { count?: number }): Promise<ProbeSummary>`.

  The state lives in `<dir>/fees/state.json`, shaped `{ done: string[]; fetched: number; skipped: number; versions: Record<string, number>; unknownShapes: number }`. The probe summary goes to `<dir>/fees/probe.json`.

Behaviour:
- **Order:** days go newest first. A day listed in `state.done` is skipped. Within a day, ids already in the partial file are skipped.
- **Workers:** six workers share one queue per day. Each calls `pacer.acquire()`, then `fetchDetail`.
- **Outcomes:**
  - `ok`: `rate.record({kind:'ok', latencyMs})`, then `recordFromBody`. If `keepRaw`, `saveUnparsed`.
  - `gone`: `rate.record({kind:'ok', latencyMs:null})`, and the id becomes a skip record with reason `HTTP <status>`.
  - `throttled`: record it and put the id back at the front of the queue. A throttle doesn't count as an attempt.
  - `error`: record it and count an attempt. On the 6th failure the id becomes a skip with reason `failed 6 times: <message>`. Otherwise it goes to the back of the queue.
- **Flushing:** buffered records are flushed through one promise chain every 50 records, and at the end of the day.
- **End of day:** `sealDay`, update the state (`done`, counts, version histogram), `writeFileAtomic` the state, and log one line: `<day>: <n> messages (<skips> skipped) · <rps> req/s · <fetched>/<total> · ETA <h>h`.
- **Stall guard:** if no `ok` or `gone` answer arrives for 15 minutes, throw `Error('the CCIP API has answered nothing for 15 minutes; stopping, and a rerun resumes')`.

- [ ] **Step 1: Write the failing tests** in `scripts/test/fees-fetch.test.ts`. A fake API answers from a map of id to response.

```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import detailToken from '../../packages/core/test/fixtures/detail-token.json';
import { fetchDetail, recordFromBody, runFetch, runProbe, type FetchDeps } from '../backfill/fees/fetch';
import { readSealedDay } from '../backfill/fees/store';

type Reply = { status: number; body?: string; headers?: Record<string, string> };

function fakeApi(replies: Record<string, Reply | Reply[]>) {
  let t = Date.parse('2026-10-08T00:00:00Z');
  const calls: string[] = [];
  const deps: FetchDeps = {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    fetch: (async (input: string | URL) => {
      const id = decodeURIComponent(String(input).split('/messages/')[1]!);
      calls.push(id);
      const entry = replies[id] ?? { status: 404 };
      const reply = Array.isArray(entry) ? entry.shift() ?? { status: 404 } : entry;
      t += 50;
      return new Response(reply.body ?? '', { status: reply.status, headers: reply.headers });
    }) as typeof fetch,
  };
  return { deps, calls };
}

const detail = (id: string) => JSON.stringify({ ...detailToken, messageId: id });

async function backfill(days: Record<string, string[]>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-fetch-'));
  for (const [day, ids] of Object.entries(days)) {
    const file = path.join(dir, 'archive', 'messages', day.slice(0, 4), day.slice(5, 7), `${day.slice(8, 10)}.jsonl.gz`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, gzipSync(ids.map((id) => JSON.stringify({ messageId: id })).join('\n') + '\n'));
  }
  return dir;
}

describe('fetchDetail', () => {
  it('retries a 200 whose body is not JSON', async () => {
    const { deps } = fakeApi({ '0x1': { status: 200, body: '<html>oops' } });
    expect((await fetchDetail(deps, 'https://api.test', '0x1')).kind).toBe('error');
  });

  it('reads a 429 with its Retry-After', async () => {
    const { deps } = fakeApi({ '0x1': { status: 429, headers: { 'retry-after': '7' } } });
    expect(await fetchDetail(deps, 'https://api.test', '0x1')).toEqual({ kind: 'throttled', retryAfterMs: 7000 });
  });

  it('treats a 404 as gone', async () => {
    const { deps } = fakeApi({});
    expect(await fetchDetail(deps, 'https://api.test', '0x1')).toEqual({ kind: 'gone', status: 404 });
  });
});

describe('recordFromBody', () => {
  it('keeps the fee, version and tokens of a valid detail', () => {
    const { record } = recordFromBody('0x1', JSON.parse(detail('0x1')), 't');
    expect(record).toMatchObject({ id: '0x1', kind: 'ok', fee: { token: expect.any(String), amount: expect.any(String) }, feeShapeUnknown: false });
  });

  it('records a schema failure as a skip and keeps the raw body', () => {
    const out = recordFromBody('0x1', { nope: true }, 't');
    expect({ kind: out.record.kind, keepRaw: out.keepRaw }).toEqual({ kind: 'skip', keepRaw: true });
  });
});

describe('runFetch', () => {
  it('fetches days newest first and seals each one', async () => {
    // #given
    const dir = await backfill({ '2026-10-03': ['0xa'], '2026-10-04': ['0xb'] });
    const { deps, calls } = fakeApi({ '0xa': { status: 200, body: detail('0xa') }, '0xb': { status: 200, body: detail('0xb') } });

    // #when
    const state = await runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    expect({ calls, done: state.done }).toEqual({ calls: ['0xb', '0xa'], done: ['2026-10-04', '2026-10-03'] });
  });

  it('resumes a day without fetching what its partial file already holds', async () => {
    // #given
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, `${JSON.stringify(recordFromBody('0xa', JSON.parse(detail('0xa')), 't').record)}\n`);
    const { deps, calls } = fakeApi({ '0xb': { status: 200, body: detail('0xb') } });

    // #when
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    expect({ calls, sealed: (await readSealedDay(dir, '2026-10-04')).map((r) => r.id).sort() }).toEqual({ calls: ['0xb'], sealed: ['0xa', '0xb'] });
  });

  it('retries a throttled message after its pause and records a 404 as a skip', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa', '0xgone'] });
    const { deps } = fakeApi({ '0xa': [{ status: 429, headers: { 'retry-after': '1' } }, { status: 200, body: detail('0xa') }] });
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });
    const sealed = await readSealedDay(dir, '2026-10-04');
    expect(sealed.map((r) => `${r.id}:${r.kind}`).sort()).toEqual(['0xa:ok', '0xgone:skip']);
  });

  it('gives up on a message after six failures and records why', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const { deps } = fakeApi({ '0xa': { status: 200, body: detail('0xa') }, '0xb': { status: 502 } });
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });
    const skip = (await readSealedDay(dir, '2026-10-04')).find((r) => r.id === '0xb');
    expect(skip).toMatchObject({ kind: 'skip', reason: expect.stringMatching(/^failed 6 times/) });
  });

  it('stops when nothing has been answered for fifteen minutes', async () => {
    const dir = await backfill({ '2026-10-04': Array.from({ length: 400 }, (_, i) => `0x${i}`) });
    const { deps } = fakeApi(Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`0x${i}`, { status: 429, headers: { 'retry-after': '30' } }])));
    await expect(runFetch({ dir, deps, baseUrl: 'https://api.test' })).rejects.toThrow(/answered nothing for 15 minutes/);
  });
});

describe('runProbe', () => {
  it('fetches the newest and oldest messages and summarizes versions without sealing days', async () => {
    const dir = await backfill({ '2023-07-06': ['0xold'], '2026-10-04': ['0xnew'] });
    const { deps } = fakeApi({ '0xold': { status: 200, body: detail('0xold') }, '0xnew': { status: 200, body: detail('0xnew') } });
    const summary = await runProbe({ dir, deps, baseUrl: 'https://api.test', count: 1 });
    expect({ fetched: summary.fetched, versions: Object.values(summary.versions).reduce((a, b) => a + b, 0) }).toEqual({ fetched: 2, versions: 2 });
    expect(JSON.parse(await readFile(path.join(dir, 'fees', 'probe.json'), 'utf8')).fetched).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm exec vitest run scripts/test/fees-fetch.test.ts`. Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement** `scripts/backfill/fees/fetch.ts`.

```ts
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CCIP_API_BASE, DetailMessage, issuePath, normalizeDetail, USER_AGENT } from '@ccip-dev/core';
import { writeFileAtomic } from '../crawl';
import { AdaptiveRate, Pacer } from './rate';
import { appendRecords, listArchiveDays, readArchiveDay, readPartial, saveUnparsed, sealDay, type DetailRecord } from './store';

export interface FetchDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export type DetailOutcome =
  | { kind: 'ok'; body: unknown; latencyMs: number }
  | { kind: 'gone'; status: number }
  | { kind: 'throttled'; retryAfterMs: number | null }
  | { kind: 'error'; status: number | null; message: string };

export interface FetchOptions {
  dir: string;
  deps: FetchDeps;
  baseUrl?: string;
  concurrency?: number;
  maxAttempts?: number;
  stallMs?: number;
  rate?: AdaptiveRate;
  log?: (line: string) => void;
}

export interface FetchState {
  done: string[];
  fetched: number;
  skipped: number;
  versions: Record<string, number>;
  unknownShapes: number;
}

export interface ProbeSummary {
  fetched: number;
  versions: Record<string, number>;
  feeNull: number;
  unknownShapes: number;
  schemaFailures: number;
  statuses: Record<string, number>;
}

const MAX_RETRY_AFTER_MS = 30_000;

export async function fetchDetail(deps: FetchDeps, baseUrl: string, id: string): Promise<DetailOutcome> {
  const started = deps.now();
  let res: Response;
  try {
    res = await deps.fetch(`${baseUrl}/messages/${encodeURIComponent(id)}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  } catch (err) {
    return { kind: 'error', status: null, message: errorText(err) };
  }
  if (!res.ok) {
    // The body is not used; reading it to the end releases the connection for the next request. The status already decides the outcome.
    await res.arrayBuffer().catch((err: unknown) => console.warn(`could not read the body of HTTP ${res.status} for ${id}: ${errorText(err)}`));
    if (res.status === 429) return { kind: 'throttled', retryAfterMs: retryAfterMs(res) };
    if (res.status >= 500) return { kind: 'error', status: res.status, message: `HTTP ${res.status}` };
    return { kind: 'gone', status: res.status };
  }
  try {
    return { kind: 'ok', body: await res.json(), latencyMs: deps.now() - started };
  } catch (err) {
    return { kind: 'error', status: res.status, message: `invalid JSON: ${errorText(err)}` };
  }
}

export function recordFromBody(id: string, body: unknown, fetchedAt: string): { record: DetailRecord; keepRaw: boolean } {
  const parsed = DetailMessage.safeParse(body);
  if (!parsed.success) return { record: { id, kind: 'skip', fetchedAt, status: 200, reason: `schema: ${issuePath(parsed.error)}` }, keepRaw: true };
  const { message, version, feeShapeUnknown } = normalizeDetail(parsed.data);
  return {
    record: { id, kind: 'ok', fetchedAt, version, fee: message.fee, feeShapeUnknown, tokens: message.tokens.map((t) => ({ token: t.token, amount: t.amount })) },
    keepRaw: feeShapeUnknown,
  };
}

/** Fetches every listed id with a shared pacer and a pool of workers; resolves with the records in the order they were answered. */
async function fetchAll(
  ids: string[],
  opts: Required<Pick<FetchOptions, 'deps' | 'baseUrl' | 'concurrency' | 'maxAttempts' | 'stallMs'>> & { dir: string; rate: AdaptiveRate; pacer: Pacer },
  onRecords: (records: DetailRecord[]) => Promise<void>,
): Promise<{ statuses: Record<string, number> }> {
  const queue = [...ids];
  const attempts = new Map<string, number>();
  const statuses: Record<string, number> = {};
  const buffer: DetailRecord[] = [];
  let flushing = Promise.resolve();
  let lastAnswer = opts.deps.now();
  const flush = () => (flushing = flushing.then(() => onRecords(buffer.splice(0))));
  const iso = () => new Date(opts.deps.now()).toISOString();

  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (opts.deps.now() - lastAnswer > opts.stallMs) throw new Error('the CCIP API has answered nothing for 15 minutes; stopping, and a rerun resumes');
      await opts.pacer.acquire();
      const outcome = await fetchDetail(opts.deps, opts.baseUrl, id);
      const label = outcome.kind === 'ok' ? '200' : outcome.kind === 'throttled' ? '429' : String(outcome.status ?? 'network');
      statuses[label] = (statuses[label] ?? 0) + 1;
      if (outcome.kind === 'ok') {
        opts.rate.record({ kind: 'ok', latencyMs: outcome.latencyMs });
        lastAnswer = opts.deps.now();
        const { record, keepRaw } = recordFromBody(id, outcome.body, iso());
        if (keepRaw) await saveUnparsed(opts.dir, id, outcome.body);
        buffer.push(record);
      } else if (outcome.kind === 'gone') {
        opts.rate.record({ kind: 'ok', latencyMs: null });
        lastAnswer = opts.deps.now();
        buffer.push({ id, kind: 'skip', fetchedAt: iso(), status: outcome.status, reason: `HTTP ${outcome.status}` });
      } else if (outcome.kind === 'throttled') {
        opts.rate.record(outcome);
        queue.unshift(id);
      } else {
        opts.rate.record({ kind: 'error' });
        const n = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, n);
        if (n >= opts.maxAttempts) buffer.push({ id, kind: 'skip', fetchedAt: iso(), status: outcome.status, reason: `failed ${n} times: ${outcome.message}` });
        else queue.push(id);
      }
      if (buffer.length >= 50) await flush();
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  await flush();
  return { statuses };
}

function settings(opts: FetchOptions) {
  const rate = opts.rate ?? new AdaptiveRate(opts.deps.now, opts.log);
  return {
    dir: opts.dir,
    deps: opts.deps,
    baseUrl: opts.baseUrl ?? CCIP_API_BASE,
    concurrency: opts.concurrency ?? 6,
    maxAttempts: opts.maxAttempts ?? 6,
    stallMs: opts.stallMs ?? 15 * 60_000,
    rate,
    pacer: new Pacer(rate, { now: opts.deps.now, sleep: opts.deps.sleep }),
  };
}

const idsOf = (raw: unknown[]) => raw.map((m) => (m as { messageId: string }).messageId);

export async function runFetch(opts: FetchOptions): Promise<FetchState> {
  const log = opts.log ?? (() => {});
  const s = settings(opts);
  const statePath = path.join(opts.dir, 'fees', 'state.json');
  const state: FetchState = existsSync(statePath)
    ? (JSON.parse(await readFile(statePath, 'utf8')) as FetchState)
    : { done: [], fetched: 0, skipped: 0, versions: {}, unknownShapes: 0 };
  const days = (await listArchiveDays(opts.dir)).filter((d) => !state.done.includes(d));
  const perDay = new Map<string, string[]>();
  for (const day of days) perDay.set(day, idsOf(await readArchiveDay(opts.dir, day)));
  const total = state.fetched + [...perDay.values()].reduce((n, ids) => n + ids.length, 0);
  const started = opts.deps.now();
  let fetchedThisRun = 0;

  for (const day of days) {
    const known = new Set((await readPartial(opts.dir, day)).map((r) => r.id));
    const ids = perDay.get(day)!.filter((id) => !known.has(id));
    await fetchAll(ids, s, async (records) => {
      for (const r of records) {
        if (r.kind === 'skip') state.skipped += 1;
        else {
          state.versions[r.version ?? 'none'] = (state.versions[r.version ?? 'none'] ?? 0) + 1;
          if (r.feeShapeUnknown) state.unknownShapes += 1;
        }
      }
      await appendRecords(opts.dir, day, records);
    });
    const count = await sealDay(opts.dir, day);
    state.fetched += count;
    fetchedThisRun += ids.length;
    state.done.push(day);
    await writeFileAtomic(statePath, JSON.stringify(state));
    const hours = (opts.deps.now() - started) / 3_600_000;
    const eta = fetchedThisRun > 0 ? ((total - state.fetched) * hours) / fetchedThisRun : null;
    log(`${day}: ${count} messages · ${s.rate.rps} req/s · ${state.fetched}/${total} · ETA ${eta === null ? '?' : eta.toFixed(1)}h`);
  }
  return state;
}

export async function runProbe(opts: FetchOptions & { count?: number }): Promise<ProbeSummary> {
  const count = opts.count ?? 2000;
  const s = settings(opts);
  const days = await listArchiveDays(opts.dir);
  const take = async (ordered: string[]) => {
    const out: string[] = [];
    for (const day of ordered) {
      if (out.length >= count) break;
      out.push(...idsOf(await readArchiveDay(opts.dir, day)).slice(0, count - out.length));
    }
    return out;
  };
  const ids = [...new Set([...(await take(days)), ...(await take([...days].reverse()))])];
  const summary: ProbeSummary = { fetched: 0, versions: {}, feeNull: 0, unknownShapes: 0, schemaFailures: 0, statuses: {} };
  const { statuses } = await fetchAll(ids, s, async (records) => {
    for (const r of records) {
      summary.fetched += 1;
      if (r.kind === 'skip') {
        if (r.reason.startsWith('schema:')) summary.schemaFailures += 1;
        continue;
      }
      summary.versions[r.version ?? 'none'] = (summary.versions[r.version ?? 'none'] ?? 0) + 1;
      if (r.fee === null) summary.feeNull += 1;
      if (r.feeShapeUnknown) summary.unknownShapes += 1;
    }
  });
  summary.statuses = statuses;
  await writeFileAtomic(path.join(opts.dir, 'fees', 'probe.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const deps: FetchDeps = {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
  const result = process.argv.includes('--probe') ? await runProbe({ dir: '.backfill', deps, log }) : await runFetch({ dir: '.backfill', deps, log });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

`writeFileAtomic` in `crawl.ts` creates no directories. Before the first state write and the probe write, `fees/` must exist. Add `await mkdir(path.join(opts.dir, 'fees'), { recursive: true });` at the start of both `runFetch` and `runProbe`, with `mkdir` imported from `node:fs/promises`.

- [ ] **Step 4: Add the package script.** In the root `package.json`, after `"backfill:upload"`, add `"backfill:fees:fetch": "tsx scripts/backfill/fees/fetch.ts",`.

- [ ] **Step 5: Run the tests and confirm they pass.** Run `pnpm exec vitest run scripts/test/fees-fetch.test.ts`. Expected: PASS. If the stall test loops because the queue never drains, check that the stall check runs before `acquire` and that throttles advance the fake clock through `pacer.acquire`.

- [ ] **Step 6: Commit.**

```bash
git add scripts/backfill/fees/fetch.ts scripts/test/fees-fetch.test.ts package.json
git commit -m "feat(scripts): resumable, rate-adaptive detail crawl for the fee backfill"
```

---

### Task 5: Build command (`pnpm backfill:fees:build`)

**Files:**
- Modify: `scripts/backfill/build.ts`. Export `PriceCache` (change `class PriceCache` to `export class PriceCache`) and add the static method `openExisting`, shown below.
- Create: `scripts/backfill/fees/build.ts`
- Modify: `package.json` (scripts: `"backfill:fees:build": "tsx scripts/backfill/fees/build.ts"`)
- Test: `scripts/test/fees-build.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's `linkFeeKeys`;
  - Task 3's `listArchiveDays`, `listSealedDays`, `readArchiveDay`, `readSealedDay` and `DetailRecord`;
  - from `@ccip-dev/core`: `buildRows`, `linkFeeMatcher`, `linkFeeUsd`, `ListMessage`, `llamaKey`, `normalizeList`, `normalizeRegistryToken`, `rollupDay`, `sqlLiteral`, `valueFee`, and the types `PricesClient` and `RegistryToken`;
  - `SqlWriter` and `PriceCache` from `../build`, and `writeFileAtomic` from `../crawl`.
- Produces:
  - `buildFees(opts: { dir: string; prices: PricesClient; chunkSize?: number; log?: (line: string) => void }): Promise<FeeBuildResult>`;
  - `flagFeeOutliers(checks: FeeDayCheck[]): string[]`;
  - `FEE_DIMS`.

  The state lives in `<dir>/fees/build-state.json`, shaped `{ built: string[]; batches: number }`. SQL goes to `<dir>/fees/sql/B0001/00001.sql`, and so on. Checks go to `<dir>/fees/checks/B0001.json`.

`PriceCache.openExisting`, added inside the class in `scripts/backfill/build.ts`:

```ts
  /** Opens the original build's cache, refusing a missing file or another range: a silent fresh cache would refetch every series. */
  static async openExisting(client: PricesClient, file: string, fromDay: string, toDay: string): Promise<PriceCache> {
    if (!existsSync(file)) throw new Error(`${file} is missing: the fee build reuses the original backfill's price cache`);
    const cached = await readPriceCache(file);
    const range = `${fromDay}..${toDay}`;
    if (cached.range !== range) throw new Error(`${file} covers ${cached.range}, not ${range}; refusing to start a new cache`);
    return new PriceCache(client, file, fromDay, toDay, cached);
  }
```

- [ ] **Step 1: Write the failing tests** in `scripts/test/fees-build.test.ts`. The fixture day has three messages:
  - `0xlink` pays its fee in Base LINK;
  - `0xweth` pays in Base WETH;
  - `0xgone` has a 404 skip.

  The price cache is a file holding `range`, `history` and `decimals` for both keys. Prices: LINK $10 and WETH $2,000, both with 18 decimals.

```ts
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { PricesClient } from '@ccip-dev/core';
import { describe, expect, it } from 'vitest';
import listPage from '../../packages/core/test/fixtures/list-page.json';
import { buildFees, flagFeeOutliers } from '../backfill/fees/build';
import { appendRecords, sealDay, type DetailRecord } from '../backfill/fees/store';

const DAY = '2026-10-04';
const BASE = '15971525489660198786';
const LINK = '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196';
const WETH = '0x4200000000000000000000000000000000000006';
const sample = (listPage as { data?: unknown[] }).data?.[0] ?? (listPage as unknown[])[0];

function message(id: string): unknown {
  const m = structuredClone(sample) as Record<string, unknown> & { sourceNetworkInfo: Record<string, unknown> };
  return { ...m, messageId: id, sendTimestamp: `${DAY}T12:00:00Z`, sourceNetworkInfo: { ...m.sourceNetworkInfo, chainSelector: BASE, chainId: '8453', chainFamily: 'EVM' } };
}

const ok = (id: string, token: string, amount: string): DetailRecord => ({ id, kind: 'ok', fetchedAt: '2026-10-08T00:00:00.000Z', version: '1.6.0', fee: { token, amount }, feeShapeUnknown: false, tokens: [] });

const noPrices: PricesClient = {
  latest: async () => new Map(),
  dailyHistory: async () => [],
} as unknown as PricesClient;

async function backfill(opts: { range?: string; records: DetailRecord[] }): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-build-'));
  const archive = path.join(dir, 'archive', 'messages', '2026', '10', '04.jsonl.gz');
  await mkdir(path.dirname(archive), { recursive: true });
  await writeFile(archive, gzipSync(['0xlink', '0xweth', '0xgone'].map((id) => JSON.stringify(message(id))).join('\n') + '\n'));
  await mkdir(path.join(dir, 'prices'), { recursive: true });
  await writeFile(path.join(dir, 'prices', 'cache.json'), JSON.stringify({
    range: opts.range ?? `${DAY}..${DAY}`,
    history: { [`base:${LINK}`]: { [DAY]: 10 }, [`base:${WETH}`]: { [DAY]: 2000 } },
    decimals: { [`base:${LINK}`]: 18, [`base:${WETH}`]: 18 },
  }));
  await mkdir(path.join(dir, 'registry'), { recursive: true });
  await writeFile(path.join(dir, 'registry', 'tokens.json'), JSON.stringify([
    { chainSelector: '5009297550715157269', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'ChainLink Token', decimals: 18, groupId: 'link' },
    { chainSelector: BASE, address: LINK, symbol: 'LINK', name: 'ChainLink Token', decimals: 18, groupId: 'link' },
  ]));
  await appendRecords(dir, DAY, opts.records);
  await sealDay(dir, DAY);
  return dir;
}

async function sqlOf(dir: string): Promise<string> {
  const batchDir = path.join(dir, 'fees', 'sql', 'B0001');
  const files = (await readdir(batchDir)).filter((f) => f.endsWith('.sql')).sort();
  return (await Promise.all(files.map((f) => readFile(path.join(batchDir, f), 'utf8')))).join('');
}

const records = [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', WETH, '1000000000000000'), { id: '0xgone', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' } as DetailRecord];

describe('buildFees', () => {
  it('updates only backfill rows not filled yet, valued at the send day price', async () => {
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    expect(await sqlOf(dir)).toContain(
      `UPDATE messages SET fee_token = '${WETH}', fee_amount = '1000000000000000', fee_usd = 2, detail_fetched_at = '2026-10-08T00:00:00.000Z' WHERE message_id = '0xweth' AND source = 'backfill' AND detail_fetched_at IS NULL;`,
    );
  });

  it('leaves a skipped message out of the message updates', async () => {
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    expect(await sqlOf(dir)).not.toMatch(/message_id = '0xgone'/);
  });

  it("writes the day's fee total and LINK-paid fees", async () => {
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = 3, fee_link_usd = 1 WHERE day = '${DAY}';`);
  });

  it('writes the fee of each source chain, destination chain, lane and sender group', async () => {
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    expect(await sqlOf(dir)).toMatch(new RegExp(`UPDATE daily_breakdown SET fee_usd = 3 WHERE day = '${DAY}' AND dim = 'src_chain' AND key = '${BASE}';`));
  });

  it('writes NULL fee aggregates for a day whose details were all skipped', async () => {
    const dir = await backfill({ records: ['0xlink', '0xweth', '0xgone'].map((id) => ({ id, kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' }) as DetailRecord) });
    await buildFees({ dir, prices: noPrices });
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = NULL, fee_link_usd = NULL WHERE day = '${DAY}';`);
  });

  it('refuses a price cache built for another range', async () => {
    const dir = await backfill({ records, range: '2023-07-06..2026-10-03' });
    await expect(buildFees({ dir, prices: noPrices })).rejects.toThrow(/refusing to start a new cache/);
  });

  it('builds a day only once', async () => {
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    expect((await buildFees({ dir, prices: noPrices })).days).toEqual([]);
  });
});

describe('flagFeeOutliers', () => {
  it('flags a day whose fee per message is more than 5x its neighbours median', () => {
    const checks = ['01', '02', '03', '04', '05', '06', '07'].map((d, i) => ({ day: `2026-01-${d}`, messages: 100, withFee: 100, priced: 100, feeUsd: i === 3 ? 600 : 100, perMessage: i === 3 ? 6 : 1 }));
    expect(flagFeeOutliers(checks)).toEqual(['2026-01-04']);
  });
});
```

If `list-page.json` has a different top-level shape, adapt `sample` by reading the file. The test only needs one valid `ListMessage` to clone.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm exec vitest run scripts/test/fees-build.test.ts`. Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Export `PriceCache` and add `openExisting`** in `scripts/backfill/build.ts`, as shown above.

- [ ] **Step 4: Implement** `scripts/backfill/fees/build.ts`.

```ts
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildRows, createPricesClient, linkFeeKeys, linkFeeMatcher, linkFeeUsd, ListMessage, llamaKey, normalizeList, normalizeRegistryToken, rollupDay,
  sqlLiteral, valueFee, type HttpDeps, type NormalizedMessage, type PricesClient, type RegistryToken,
} from '@ccip-dev/core';
import { PriceCache, SqlWriter } from '../build';
import { writeFileAtomic } from '../crawl';
import { listArchiveDays, listSealedDays, readArchiveDay, readSealedDay, type DetailRecord } from './store';

export const FEE_DIMS = new Set(['src_chain', 'dst_chain', 'lane', 'sender']);

export interface FeeDayCheck {
  day: string;
  messages: number;
  withFee: number;
  priced: number;
  feeUsd: number | null;
  perMessage: number | null;
}

export interface FeeBuildResult {
  batch: string | null;
  days: string[];
  messagesUpdated: number;
  sqlFiles: number;
  outlierDays: string[];
  largest: { id: string; day: string; usd: number; token: string }[];
}

interface BuildState {
  built: string[];
  batches: number;
}

export async function buildFees(opts: { dir: string; prices: PricesClient; chunkSize?: number; log?: (line: string) => void }): Promise<FeeBuildResult> {
  const log = opts.log ?? (() => {});
  const statePath = path.join(opts.dir, 'fees', 'build-state.json');
  const state: BuildState = existsSync(statePath) ? (JSON.parse(await readFile(statePath, 'utf8')) as BuildState) : { built: [], batches: 0 };
  const days = (await listSealedDays(opts.dir)).filter((d) => !state.built.includes(d));
  const result: FeeBuildResult = { batch: null, days: [], messagesUpdated: 0, sqlFiles: 0, outlierDays: [], largest: [] };
  if (days.length === 0) return result;

  const archiveDays = await listArchiveDays(opts.dir);
  const prices = await PriceCache.openExisting(opts.prices, path.join(opts.dir, 'prices', 'cache.json'), archiveDays.at(-1)!, archiveDays[0]!);
  const registry = JSON.parse(await readFile(path.join(opts.dir, 'registry', 'tokens.json'), 'utf8')) as RegistryToken[];
  const isLinkFee = linkFeeMatcher(linkFeeKeys(registry.map(normalizeRegistryToken)));
  const batch = `B${String(state.batches + 1).padStart(4, '0')}`;
  const writer = new SqlWriter(path.join(opts.dir, 'fees', 'sql', batch), opts.chunkSize ?? 20_000);
  const checks: FeeDayCheck[] = [];

  for (const day of days) {
    const byId = new Map<string, DetailRecord>((await readSealedDay(opts.dir, day)).map((r) => [r.id, r]));
    const messages: NormalizedMessage[] = (await readArchiveDay(opts.dir, day)).map((raw) => {
      const m = normalizeList(ListMessage.parse(raw));
      const rec = byId.get(m.messageId);
      return rec?.kind === 'ok' ? { ...m, fee: rec.fee } : m;
    });
    await prices.ensure(messages.flatMap((m) => (m.fee ? [llamaKey(m.src, m.fee.token)] : [])).filter((k): k is string => k !== null));
    const lookup = prices.lookupOn(day);
    const { rows } = buildRows(messages, lookup, (m) => {
      const rec = byId.get(m.messageId);
      return { source: 'backfill', feeUsd: valueFee(m.fee, m.src, lookup), detailFetchedAt: rec?.kind === 'ok' ? rec.fetchedAt : null };
    });
    const filled = rows.filter((r) => byId.get(r.message_id)?.kind === 'ok');
    const statements = filled.map(
      (r) =>
        `UPDATE messages SET fee_token = ${sqlLiteral(r.fee_token)}, fee_amount = ${sqlLiteral(r.fee_amount)}, fee_usd = ${sqlLiteral(r.fee_usd)}, ` +
        `detail_fetched_at = ${sqlLiteral(r.detail_fetched_at)} WHERE message_id = ${sqlLiteral(r.message_id)} AND source = 'backfill' AND detail_fetched_at IS NULL;`,
    );
    const { totals, breakdown } = rollupDay(day, rows, []);
    statements.push(`UPDATE daily_totals SET fee_usd = ${sqlLiteral(totals.fee_usd)}, fee_link_usd = ${sqlLiteral(linkFeeUsd(rows, day, isLinkFee))} WHERE day = ${sqlLiteral(day)};`);
    for (const b of breakdown) {
      if (!FEE_DIMS.has(b.dim)) continue;
      statements.push(`UPDATE daily_breakdown SET fee_usd = ${sqlLiteral(b.fee_usd)} WHERE day = ${sqlLiteral(day)} AND dim = ${sqlLiteral(b.dim)} AND key = ${sqlLiteral(b.key)};`);
    }
    await writer.add(statements);

    const withFee = rows.filter((r) => r.fee_token !== null);
    checks.push({
      day,
      messages: rows.length,
      withFee: withFee.length,
      priced: withFee.filter((r) => r.fee_usd !== null).length,
      feeUsd: totals.fee_usd,
      perMessage: totals.fee_usd === null || rows.length === 0 ? null : totals.fee_usd / rows.length,
    });
    for (const r of withFee) if (r.fee_usd !== null) result.largest.push({ id: r.message_id, day, usd: r.fee_usd, token: r.fee_token! });
    result.largest = result.largest.sort((a, b) => b.usd - a.usd).slice(0, 10);
    result.messagesUpdated += filled.length;
    result.days.push(day);
    log(`${day}: ${filled.length}/${rows.length} messages with details, fees $${(totals.fee_usd ?? 0).toFixed(2)}`);
  }

  const written = await writer.finish();
  result.batch = batch;
  result.sqlFiles = written.files;
  result.outlierDays = flagFeeOutliers(checks);
  state.built.push(...result.days);
  state.batches += 1;
  await mkdir(path.join(opts.dir, 'fees', 'checks'), { recursive: true });
  await writeFileAtomic(path.join(opts.dir, 'fees', 'checks', `${batch}.json`), `${JSON.stringify({ checks, outlierDays: result.outlierDays, largest: result.largest }, null, 2)}\n`);
  await writeFileAtomic(statePath, JSON.stringify(state));
  for (const day of result.outlierDays) log(`check: ${day} has fees per message more than 5x its neighbours' median`);
  for (const l of result.largest) log(`largest fee: ${l.day} ${l.id} $${l.usd.toFixed(2)} (${l.token})`);
  return result;
}

/** Days whose fees per message are more than 5x the median of the days within a week of them; a sign of a price or decimals error. */
export function flagFeeOutliers(checks: FeeDayCheck[]): string[] {
  const dated = checks.filter((c) => c.perMessage !== null).sort((a, b) => (a.day < b.day ? -1 : 1));
  return dated
    .filter((c) => {
      const t = Date.parse(c.day);
      const near = dated.filter((o) => o !== c && Math.abs(Date.parse(o.day) - t) <= 7 * 86_400_000).map((o) => o.perMessage!);
      if (near.length < 3) return false;
      const sorted = near.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      return c.perMessage! > 5 * median;
    })
    .map((c) => c.day);
}

async function main(): Promise<void> {
  const deps: HttpDeps = {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    clock: () => Date.now(),
  };
  const result = await buildFees({ dir: '.backfill', prices: createPricesClient(deps), log: (line) => console.log(line) });
  console.log(JSON.stringify({ ...result, days: result.days.length }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Add the package script.** In the root `package.json`, add `"backfill:fees:build": "tsx scripts/backfill/fees/build.ts",`.

- [ ] **Step 6: Run the tests and confirm they pass.** Run `pnpm exec vitest run scripts/test/fees-build.test.ts scripts/test/build.test.ts`. Expected: PASS. The original build tests must stay green.

- [ ] **Step 7: Commit.**

```bash
git add scripts/backfill/build.ts scripts/backfill/fees/build.ts scripts/test/fees-build.test.ts package.json
git commit -m "feat(scripts): build fee SQL from fetched details with the original price cache and the Worker's rollup"
```

---

### Task 6: Upload command and the original-upload guard

**Files:**
- Create: `scripts/backfill/fees/upload.ts`
- Modify:
  - `scripts/backfill/upload.ts`: add the `allowFeeWipe` option and guard, and read `--allow-fee-wipe` in `main`;
  - `package.json` (scripts: `"backfill:fees:upload": "tsx --env-file=.env scripts/backfill/fees/upload.ts"`).
- Test:
  - `scripts/test/fees-upload.test.ts`;
  - `scripts/test/upload.test.ts`, extended.

**Interfaces:**
- Produces:
  - `inFinalizeWindow(nowMs: number): boolean`;
  - `uploadFees(opts: { dir: string; deps: { runSqlFile(file: string): void; now(): number; sleep(ms: number): Promise<void> }; log?: (line: string) => void }): Promise<{ applied: number; skipped: number }>`;
  - `feeUploadStarted(dir: string): Promise<boolean>`.

  The state lives in `<dir>/fees/upload-state.json`, shaped `{ applied: string[] }`. Each entry is a path relative to `fees/sql`, such as `B0001/00001.sql`.

- [ ] **Step 1: Write the failing tests** in `scripts/test/fees-upload.test.ts`.

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { feeUploadStarted, inFinalizeWindow, uploadFees } from '../backfill/fees/upload';

async function feeSql(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-upload-'));
  for (const f of ['B0001/00001.sql', 'B0001/00002.sql', 'B0002/00001.sql']) {
    await mkdir(path.join(dir, 'fees', 'sql', path.dirname(f)), { recursive: true });
    await writeFile(path.join(dir, 'fees', 'sql', f), 'SELECT 1;\n');
  }
  return dir;
}

function deps(at: string, fail?: string) {
  let t = Date.parse(at);
  const runs: string[] = [];
  return {
    runs,
    deps: {
      runSqlFile: (file: string) => {
        const rel = file.split(`${path.sep}sql${path.sep}`)[1]!.split(path.sep).join('/');
        if (rel === fail) throw new Error('wrangler failed');
        runs.push(rel);
      },
      now: () => t,
      sleep: async (ms: number) => { t += ms; },
    },
  };
}

describe('inFinalizeWindow', () => {
  it.each([
    ['2026-10-08T23:56:00Z', true],
    ['2026-10-09T00:20:00Z', true],
    ['2026-10-09T00:31:00Z', false],
    ['2026-10-09T06:00:00Z', true],
    ['2026-10-09T06:21:00Z', false],
    ['2026-10-09T12:00:00Z', false],
  ])('at %s is %s', (at, expected) => {
    expect(inFinalizeWindow(Date.parse(at))).toBe(expected);
  });
});

describe('uploadFees', () => {
  it('applies every batch file once, in order', async () => {
    const dir = await feeSql();
    const d = deps('2026-10-09T12:00:00Z');
    await uploadFees({ dir, deps: d.deps });
    await uploadFees({ dir, deps: d.deps });
    expect(d.runs).toEqual(['B0001/00001.sql', 'B0001/00002.sql', 'B0002/00001.sql']);
  });

  it('waits out a finalize window before the next file', async () => {
    const dir = await feeSql();
    const d = deps('2026-10-09T00:10:00Z');
    await uploadFees({ dir, deps: d.deps });
    expect(new Date(d.deps.now()).toISOString() >= '2026-10-09T00:30:00.000Z').toBe(true);
  });

  it('leaves a file unapplied when wrangler fails, so a rerun applies it', async () => {
    const dir = await feeSql();
    await expect(uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z', 'B0001/00002.sql').deps })).rejects.toThrow('wrangler failed');
    const rerun = deps('2026-10-09T12:00:00Z');
    await uploadFees({ dir, deps: rerun.deps });
    expect(rerun.runs).toEqual(['B0001/00002.sql', 'B0002/00001.sql']);
  });

  it('reports a started fee upload', async () => {
    const dir = await feeSql();
    const before = await feeUploadStarted(dir);
    await uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z').deps });
    expect([before, await feeUploadStarted(dir)]).toEqual([false, true]);
  });
});
```

Then extend `scripts/test/upload.test.ts`, using its existing `backfillDir()` and `deps()` helpers:

```ts
describe('guard against wiping backfilled fees', () => {
  it('refuses to apply the original SQL after a fee upload', async () => {
    // #given
    const dir = await backfillDir();
    await mkdir(path.join(dir, 'fees'), { recursive: true });
    await writeFile(path.join(dir, 'fees', 'upload-state.json'), JSON.stringify({ applied: ['B0001/00001.sql'] }));

    // #when / #then
    await expect(upload({ dir, archiveBaseUrl: BASE, deps: deps().deps })).rejects.toThrow(/--allow-fee-wipe/);
  });

  it('applies it when told the fee wipe is intended', async () => {
    const dir = await backfillDir();
    await mkdir(path.join(dir, 'fees'), { recursive: true });
    await writeFile(path.join(dir, 'fees', 'upload-state.json'), JSON.stringify({ applied: ['B0001/00001.sql'] }));
    const d = deps();
    await upload({ dir, archiveBaseUrl: BASE, deps: d.deps, allowFeeWipe: true });
    expect(d.sqlRuns).toEqual(['00001.sql', '00002.sql']);
  });
});
```

Adapt `deps()` field names to the helper that already exists in `upload.test.ts`. It returns `{ sqlRuns, requests, deps }`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm exec vitest run scripts/test/fees-upload.test.ts scripts/test/upload.test.ts`. Expected: FAIL. The module is missing, and the guard tests fail.

- [ ] **Step 3: Implement** `scripts/backfill/fees/upload.ts`.

```ts
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { wrangler } from '../../lib/d1';
import { writeFileAtomic } from '../crawl';

export interface FeeUploadDeps {
  runSqlFile(file: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** The Worker finalizes at 00:10 and 06:00 UTC; D1 is unavailable while a file imports, so no file starts near either run. */
export function inFinalizeWindow(nowMs: number): boolean {
  const d = new Date(nowMs);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= 23 * 60 + 55 || m < 30 || (m >= 5 * 60 + 50 && m < 6 * 60 + 20);
}

const statePath = (dir: string) => path.join(dir, 'fees', 'upload-state.json');

export async function feeUploadStarted(dir: string): Promise<boolean> {
  if (!existsSync(statePath(dir))) return false;
  return ((JSON.parse(await readFile(statePath(dir), 'utf8')) as { applied?: string[] }).applied ?? []).length > 0;
}

export async function uploadFees(opts: { dir: string; deps: FeeUploadDeps; log?: (line: string) => void }): Promise<{ applied: number; skipped: number }> {
  const log = opts.log ?? (() => {});
  const sqlDir = path.join(opts.dir, 'fees', 'sql');
  const state = existsSync(statePath(opts.dir)) ? (JSON.parse(await readFile(statePath(opts.dir), 'utf8')) as { applied: string[] }) : { applied: [] };
  const files = (await readdir(sqlDir, { recursive: true }))
    .map((p) => p.split(path.sep).join('/'))
    .filter((p) => /^B\d{4}\/\d{5}\.sql$/.test(p))
    .sort();
  const result = { applied: 0, skipped: 0 };
  for (const file of files) {
    if (state.applied.includes(file)) {
      result.skipped += 1;
      continue;
    }
    if (inFinalizeWindow(opts.deps.now())) log('waiting for the Worker finalize window to pass');
    while (inFinalizeWindow(opts.deps.now())) await opts.deps.sleep(60_000);
    opts.deps.runSqlFile(path.join(sqlDir, file));
    state.applied.push(file);
    await writeFileAtomic(statePath(opts.dir), JSON.stringify(state));
    result.applied += 1;
    log(`applied ${file}`);
  }
  return result;
}

async function main(): Promise<void> {
  const result = await uploadFees({
    dir: '.backfill',
    deps: {
      runSqlFile: (file) => {
        wrangler(['d1', 'execute', 'ccip-dev', '--remote', '--yes', `--file=${path.resolve(file)}`], { token: process.env.CF_BACKFILL_TOKEN, inherit: true });
      },
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add the guard** to `scripts/backfill/upload.ts`.
  - Add `allowFeeWipe?: boolean` to the options of `upload(...)`.
  - Add the import `import { feeUploadStarted } from './fees/upload';`.
  - Right after `const sqlFiles = …` is computed, insert:

```ts
  const pending = sqlFiles.filter((f) => !state.applied.includes(f));
  if (pending.length > 0 && !opts.allowFeeWipe && (await feeUploadStarted(opts.dir))) {
    throw new Error(
      'The fee backfill has been uploaded, and this SQL would reset daily fee totals and breakdowns to NULL. ' +
        'Rerun with --allow-fee-wipe only if you then rerun pnpm backfill:fees:upload (see docs/runbook.md, "Fee backfill").',
    );
  }
```

  In `main()`, pass `allowFeeWipe: process.argv.includes('--allow-fee-wipe')`.

- [ ] **Step 5: Add the package script** `"backfill:fees:upload": "tsx --env-file=.env scripts/backfill/fees/upload.ts",`.

- [ ] **Step 6: Run the tests and confirm they pass.** Run `pnpm exec vitest run scripts/test/fees-upload.test.ts scripts/test/upload.test.ts`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add scripts/backfill/fees/upload.ts scripts/backfill/upload.ts scripts/test/fees-upload.test.ts scripts/test/upload.test.ts package.json
git commit -m "feat(scripts): fee SQL upload that waits out finalize, and a guard so the original upload cannot wipe fees"
```

---

### Task 7: Site: fee coverage comes from the data

**Files:**
- Modify:
  - `site/src/lib/records.ts`: replace `FEES_SINCE`, add `feesSince` and `feesNote`, and set the fees record note from the data;
  - `site/src/components/HistoryCharts.tsx`: add the prop `feesSince: string | null`, and trim the fee chart to the covered days with a note;
  - `site/src/pages/history/[range].astro`: pass `feesSince`, and show the tile's "since" only when it applies.
- Test:
  - `site/test/records.test.ts`;
  - `site/test/charts.test.ts`, or the chart test file that already exists for `HistoryCharts` helpers.

**Interfaces:**
- Produces:
  - `feesSince(days: readonly { day: string; fee_usd: number | null }[]): string | null`;
  - `feesNote(days: readonly { day: string }[], since: string | null): string | null`, which returns `since <day>` only when `since` falls after the first of `days`;
  - `feeChartRows<T extends { day: string }>(rows: T[], since: string | null): { rows: T[]; from: string | null }`.

- [ ] **Step 1: Write the failing tests** in `site/test/records.test.ts`. Extend its import with `feesSince` and `feesNote`.

```ts
describe('fee coverage', () => {
  const days = [
    { day: '2026-10-03', fee_usd: null },
    { day: '2026-10-04', fee_usd: null },
    { day: '2026-10-05', fee_usd: 1245.29 },
    { day: '2026-10-06', fee_usd: 1072.33 },
  ];

  it('starts at the first day with fee data', () => {
    expect(feesSince(days)).toBe('2026-10-05');
  });

  it('has no start without fee data', () => {
    expect(feesSince([{ day: '2026-10-03', fee_usd: null }])).toBeNull();
  });

  it('notes a start that falls inside the shown days', () => {
    expect(feesNote(days, '2026-10-05')).toBe('since 2026-10-05');
  });

  it('has no note once fees cover every shown day', () => {
    expect(feesNote(days.slice(2), '2026-10-05')).toBeNull();
  });

  it('notes the start on the highest-fees record only while coverage is partial', () => {
    const full = (fee: number | null, day: string) => ({ day, messages: 1, usd_value: 1, unique_senders: 1, fee_usd: fee, median_delivery_s: null });
    const partial = computeRecords([full(null, '2026-10-04'), full(5, '2026-10-05')]).find((r) => r.key === 'fees');
    const complete = computeRecords([full(4, '2026-10-04'), full(5, '2026-10-05')]).find((r) => r.key === 'fees');
    expect([partial?.note, complete?.note]).toEqual(['since 2026-10-05', null]);
  });
});
```

In the chart helpers' test file, with `feeChartRows` imported from `../src/lib/records`:

```ts
describe('feeChartRows', () => {
  const rows = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'].map((day) => ({ day }));

  it('starts the fee chart where fee data starts inside the window', () => {
    expect(feeChartRows(rows, '2026-10-05')).toEqual({ rows: rows.slice(2), from: '2026-10-05' });
  });

  it('keeps the whole window when fees cover it', () => {
    expect(feeChartRows(rows, '2026-10-01')).toEqual({ rows, from: null });
  });

  it('keeps the whole window when there is no fee data at all', () => {
    expect(feeChartRows(rows, null)).toEqual({ rows, from: null });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter site exec vitest run test/records.test.ts`. Expected: FAIL, because `feesSince`, `feesNote` and `feeChartRows` are not exported.

- [ ] **Step 3: Implement** in `site/src/lib/records.ts`. Remove `export const FEES_SINCE = '2026-10-05';` and add:

```ts
/** The first day with fee data. Fees reach further back as the fee backfill loads, so this comes from the data. */
export function feesSince(days: readonly { day: string; fee_usd: number | null }[]): string | null {
  let first: string | null = null;
  for (const d of days) if (d.fee_usd !== null && (first === null || d.day < first)) first = d.day;
  return first;
}

export function feesNote(days: readonly { day: string }[], since: string | null): string | null {
  if (since === null || days.length === 0) return null;
  const firstShown = days.reduce((min, d) => (d.day < min ? d.day : min), days[0]!.day);
  return since > firstShown ? `since ${since}` : null;
}

export function feeChartRows<T extends { day: string }>(rows: T[], since: string | null): { rows: T[]; from: string | null } {
  if (since === null || rows.length === 0 || since <= rows[0]!.day) return { rows, from: null };
  return { rows: rows.filter((r) => r.day >= since), from: since };
}
```

Change the fees rule's `note: \`since ${FEES_SINCE}\`` to `note: null`. In `computeRecords`, build that rule's record with `note: rule.key === 'fees' ? feesNote(sorted, feesSince(sorted)) : rule.note`.

- [ ] **Step 4: Wire up the chart and the page.**
  - **`HistoryCharts.tsx`:**
    - Remove the `FEES_SINCE` import and import `feeChartRows`.
    - Give `HistoryCharts` a `feesSince: string | null` prop and pass it to `Chart` as `since`.
    - In `Chart`, compute `const { rows: shownRows, from } = spec.key === 'fee_usd' ? feeChartRows(rows, since) : { rows, from: null };`, and use `shownRows` wherever the component read `rows` (the series, the share and the summary).
    - Replace the fee note line with `{from && <p className="muted small">Fees are collected from {from} onward.</p>}`.
  - **`pages/history/[range].astro`:**
    - Import `feesSince` and `feesNote` instead of `FEES_SINCE`.
    - Add `const since = feesSince(history.days);`.
    - Change the tile's sub line to `{feesNote(rows, since) && <span class="sub">{feesNote(rows, since)}</span>}`.
    - Render `<HistoryCharts client:visible rows={rows} feesSince={since} />`.

  Run `rg -n FEES_SINCE site/src` and expect no matches.

- [ ] **Step 5: Run the tests, typecheck and build, and confirm they pass.** Run `pnpm --filter site test && pnpm typecheck && pnpm --filter site build`. Expected: all pass, with the budgets OK.

- [ ] **Step 6: Commit.**

```bash
git add site/src/lib/records.ts site/src/components/HistoryCharts.tsx 'site/src/pages/history/[range].astro' site/test/records.test.ts site/test/charts.test.ts
git commit -m "fix(site): take fee coverage from the data, and start the fee chart where coverage starts"
```

Stage the chart test file you actually changed, if its name differs.

---

### Task 8: Runbook and methodology

**Files:**
- Modify: `docs/runbook.md` (a new section, "Fee backfill") and `docs/methodology.md` (the fee coverage lines 28 and 34).

- [ ] **Step 1: Add the runbook section** at the end of `docs/runbook.md`.

````markdown
## Fee backfill

Fills fees for every day before live ingest (2023-07-06 to 2026-10-04) from one CCIP detail per message. Spec: `docs/superpowers/specs/2026-10-08-fee-backfill-design.md`. Data lives in `.backfill/fees/`. The original backfill data in `.backfill/` must be on disk.

1. **Probe** (about 15 minutes): `pnpm backfill:fees:fetch --probe`. Read `.backfill/fees/probe.json`. Every `versions` entry should have fees (`feeNull` and `unknownShapes` near 0, `schemaFailures` 0). If not, stop and check `.backfill/fees/unparsed/`.
2. **Fetch** (2.5–6 days, resumable): `caffeinate -i pnpm backfill:fees:fetch`. The rate starts at 3 req/s and steps up by 1 every healthy 10 minutes, to 8. It halves and holds 10 minutes on a 429 or more than 1% errors. It stops after 15 minutes with no answer. Rerun the same command to resume. The log shows each finished day, the rate and an ETA.
3. **Build** (any time, as often as you like): `pnpm backfill:fees:build`. It writes SQL for the days fetched since the last build to `.backfill/fees/sql/B<n>/`. Read its check lines: days with outlier fees per message, and the 10 largest fees. Don't upload a batch with an outlier until you understand it.
4. **Upload** (owner): `pnpm backfill:fees:upload`. It applies new batches in order and resumes after a failure. It waits out 23:55–00:30 and 05:50–06:20 UTC, because D1 is unavailable while a file imports. The next finalize (00:10 or 06:00 UTC) republishes `history.json` and `top/*`, and the site picks up the new coverage on its next build.

The original `pnpm backfill:upload` refuses to run after a fee upload, because its SQL would reset daily fees to NULL. Only run it with `--allow-fee-wipe` if you then rerun `pnpm backfill:fees:upload` from scratch: delete `.backfill/fees/upload-state.json` first.
````

- [ ] **Step 2: Update `docs/methodology.md`.** Replace the two "collected from 2026-10-05 onward" sentences with:

> Fees come from each message's detail. Live messages have them from 2026-10-05; earlier days get them from the fee backfill, which values each fee at its send day's price. The site shows fees from the first day that has them.

- [ ] **Step 3: Commit.**

```bash
git add docs/runbook.md docs/methodology.md
git commit -m "docs(runbook): fee backfill commands, pacing, checks and the upload guard"
```

---

## Self-review notes

- **Spec coverage:**
  - §3.1 is in Tasks 2–4, and the probe in Task 4.
  - §3.2 is in Task 5: the price cache, the LINK set (Task 1), the aggregates and the checks.
  - §3.3 is in Task 6.
  - §4: the guard is in Task 6, coverage and the chart in Task 7, and the runbook in Task 8.
  - §7: the tests are in each task. §8, the rollout, is owner steps in the runbook.
- **Token data:** the token lists are kept in the records (Task 3's `DetailRecord.tokens`) and not loaded, as §2 says.
- **Names used across tasks:**
  - `DetailRecord`, `readSealedDay`, `listSealedDays`, `readArchiveDay` and `listArchiveDays` (Task 3), used by Tasks 4 and 5;
  - `AdaptiveRate` and `Pacer` (Task 2), used by Task 4;
  - `linkFeeKeys` (Task 1), used by Task 5;
  - `feeUploadStarted` (Task 6), used by `upload.ts`.
