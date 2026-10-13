# The LinkMarines Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public roster of every enlisted LinkMarine at `ccip.dev/marines/` and a page per Marine at `/marines/0007/`, by callsign only, fed by three new read-only routes on the bot.

**Architecture:** The bot Worker (`discord/`) answers `GET /roster.json`, `/memes/<file>.png` and `/web/<serial>.png` beside `POST /interactions`. The site is static Astro: `/marines/` is one React island that loads `roster.json` and derives every section in the browser. `/marines/<serial>/` is a static template whose head the site Worker rewrites with `HTMLRewriter`, never calling the bot. The roster's types, schema and every derived rule live in a new pure module, `packages/core/src/roster.ts`.

**Tech Stack:** TypeScript, a pnpm workspace, Cloudflare Workers (D1, R2, the Cache API, service bindings, `HTMLRewriter`), Astro 7 with React 19 islands, Satori and resvg through `@cf-wasm/og`, zod 4, and Vitest 4 (the workerd pool for Worker code).

**Spec:** `docs/superpowers/specs/2026-10-13-linkmarines-roster-design.md`. The visual target is `docs/superpowers/specs/2026-10-13-linkmarines-roster-mockups/roster.html` (open it from disk) and `roster-full.jpeg`.

## Global Constraints

- **Callsign only, always.** No public response or page ever contains a Discord user ID, display name or avatar. A public route reads only the columns in `PUBLIC_COLUMNS`, and `SELECT *` is never used on a public path.
- **The roster file's fields** are exactly the spec's §4: `version`, `updatedAt`, `snapshot { version, tags[{ tag, count, chance, meme }] }`, and `marines[{ serial, callsign, tags, tier, score, percentile, memes[{ tag, file, count }], blood, faith, enlisted }]`.
- **Caching:**

  | Route | Cache-Control |
  |---|---|
  | roster | `public, max-age=60` |
  | memes | `public, max-age=31536000, immutable` |
  | web cards | `public, max-age=86400` |
  | 404 on any of the three | `public, max-age=60` |
  | 503 on any of the three | `no-store` |

  Every public route carries `Access-Control-Allow-Origin: *`.
- **Serials:**
  - Shown as `serialText(serial)` from `@ccip-dev/core/linkmarine` (zero-padded to 4).
  - Page paths are `/marines/0007/`.
  - Web card URLs use the bare number, `https://discord.ccip.dev/web/7.png`.
- **Exact strings:**
  - "LIVE · ROSTER"
  - "The roster is out of reach right now. Retrying…"
  - "No Marines yet. Be #0001: `/enlist`"
  - "Every tag has been drawn. The board is full."
  - "All 100 seats are taken."
  - "No Marine #0999 yet." (the serial is formatted)
  - "LINK MARINE #0007 · ccip.dev" (the Marine page title)
  - "A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it." (the Marine page description)
- **Tag odds** are always worded "about 1 in N", where N = round(1 / (1 − (1 − chance)³)) and is formatted with `toLocaleString('en-US')`.
- **Expected tier shares** come from `TIER_SHARE_PCT` (60/25/12/3), already in `packages/core/src/linkmarine.ts`.
  - **Ruling:** the spec's §9 says to move `TIER_CUTS` into core. `TIER_SHARE_PCT` already holds the same shares there, so `TIER_CUTS` stays in `discord/src/draw.ts`.
- **Ruling, the constellation's layout:** the spec's §7.8 says a golden-angle spiral, then a repulsion pass. Measured on 24 planets with their labels, that pass still overlaps them (13–17 overlaps on a 1132×420 frame). The plan instead gives each planet its own cell, the busiest in the middle, with a fixed-seed nudge. That keeps the spec's requirements: deterministic, no overlaps, none outside the frame, sized 34–80 px by carriers. Phones get their own 3×4 sky of twelve.
- **Ruling, the loading state:** the spec's §7 asks for "a skeleton of the counters and sections". The plan renders the real hero with "—" in each counter and a "Loading the roster…" line below it. That's a lighter skeleton with the same layout, and it's what the server renders before the island hydrates.
- **CSS:** roster classes are prefixed `mr-` and live in `site/src/styles/marines.css`, which only the two roster pages import. Use `tokens.css` variables, and `.visually-hidden` from `base.css` for screen-reader-only text.
- **Test style:**
  - `// #given`, `// #when`, `// #then` comments, and one `expect` per test where possible.
  - Bot tests run in the workerd pool on real D1 and R2.
  - Core and site tests run in Node.
- **Commits:**
  - Stage explicit paths only. Never `git add -A`, `git add .` or `git commit -a`.
  - Never stage `.superpowers/` or `.DS_Store`.
  - Every commit message ends with a `Co-Authored-By:` trailer naming your model.
- `pnpm test` and `pnpm typecheck` must be green at the root after every task.

## Review Focus

1. **Meme file names that need URL encoding** (spaces, `#`, unicode) must round-trip. The site's `memeUrl` encodes, and the bot's `/memes/` route decodes and serves the same R2 key. A malformed escape gets 404, not a crash. Tests are in Task 5 and Task 6.
2. **A Marine carrying a tag the current snapshot lacks** (after a future snapshot change) must not break anything:
   - the board ignores the tag;
   - the ticker skips its sighting;
   - the constellation and the Marine page still render;
   - `roster.json` still builds.

   Tests are in Task 2 and Task 3.
3. **Search input as people actually type it** (`' Sergey '`, `'#0007'`, `'0007'`, `'7'`, a callsign containing digits such as `216-judges-butter`) finds the right Marines. Tests are in Task 2.
4. **Long callsigns at 390 px:** a 3×13-character callsign never pushes the wall, the rarest-ten rows, the ticker or the Marine page past the viewport. CSS ellipsis and `min-width: 0` handle it. The check is in Task 11.
5. **A Marine page for a serial newer than the cached roster** says "No Marine #0041 yet." and turns into the Marine's page on the next 60 s refresh, without a reload. The page keeps polling after a not-found. Tests are in Task 10.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/core/src/roster.ts` (new) | 1, 2 | The roster file's schema and types, plus every derived rule |
| `packages/core/src/linkmarine.ts` | 1, 4 | `rarerThan`, `marineOdds`, `MarineWebCard`, `renderMarineWebCard` on the renderer interface |
| `packages/core/src/testing.ts` | 1 | `ROSTER_FIXTURE`, shared by core and site tests |
| `packages/core/package.json` | 1 | The `./roster` export |
| `discord/src/public.ts` (new) | 3, 5 | The three public routes |
| `discord/src/index.ts` | 3 | Hands non-`/interactions` paths to `publicRoute` |
| `discord/test/helpers.ts`, `discord/test/site-stub.js` | 3, 4 | `seedMarine`, plus `renderMarineWebCard` on the fakes |
| `site/worker/linkmarine/marine-card.ts`, `entrypoint.ts` | 4 | The web card (no name and avatar row) |
| `site/scripts/render-linkmarine-cards.ts` | 4 | Also writes `marine-<tier>-web.png` for the owner's look |
| `site/src/config.ts` | 6 | `BOT_ORIGIN` and `ROSTER_URL` |
| `site/src/lib/marines.ts` (new) | 6, 7 | URLs, paths and view helpers (planet layout, bar widths, wording) |
| `site/worker/marines.ts` (new), `site/worker/index.ts`, `site/wrangler.toml` | 6 | `/marines/<serial>/`: redirect, 404 and head rewrite |
| `site/src/lib/poller.ts` | 7 | A generic `startLoop`, with `startPoller` built on it |
| `site/src/lib/roster.ts` (new) | 7 | `fetchRoster`, `rosterSource`, `ROSTER_POLL_MS` |
| `site/src/components/marines/*.tsx`, `use-roster.ts` (new) | 7–10 | The roster page and the Marine page islands |
| `site/src/styles/marines.css` (new) | 8–10 | All roster styles |
| `site/src/pages/marines/index.astro`, `marine.astro` (new) | 8, 10 | The roster page and the Marine page template |
| `Header.astro`, `Footer.astro`, `about.astro`, `discord.astro`, `docs/runbook.md` | 11 | Links into the roster, and the runbook |

---

### Task 1: The roster file and its tag and Marine rules (core)

**Files:**
- Create: `packages/core/src/roster.ts`
- Modify: `packages/core/src/linkmarine.ts` (add `rarerThan`)
- Modify: `packages/core/src/testing.ts` (add `ROSTER_FIXTURE`)
- Modify: `packages/core/package.json` (exports)
- Test: `packages/core/test/roster.test.ts`

**Interfaces:**
- **Produces:**
  - from `@ccip-dev/core/roster`:
    - `ROSTER_VERSION = 1`, `PLANK_SEATS = 100`, `ROSTER_SCHEMA` (zod);
    - types `RosterFile`, `RosterMarine`, `RosterTag`, `RosterMeme`, `TagFacts`, `TierCount`, `BoardTag`;
    - `callsignsPerTag(chance): number`;
    - `tagFacts(marines): Map<string, TagFacts>`;
    - `ranked(marines): RosterMarine[]`;
    - `rankOf(marines, serial): number | null`;
    - `census(marines): TierCount[]`;
    - `tagBoard(roster): BoardTag[]`;
  - from `@ccip-dev/core/linkmarine`: `rarerThan(percentile): number`;
  - from `@ccip-dev/core/testing`: `ROSTER_FIXTURE: RosterFile`.

- [ ] **Step 1: Add the export and the fixture**

In `packages/core/package.json` `exports`, after `"./linkmarine"`, add:

```json
    "./roster": "./src/roster.ts"
```

Append to `packages/core/src/testing.ts`:

```ts
import type { RosterFile } from './roster';

const rosterMeme = (tag: string, count: number) => ({ tag, file: `${tag}.jpeg`, count });

/**
 * A small roster: eight tags (four of them one-meme, two never drawn) and four Marines, one per tier.
 * Shared by core and site tests.
 */
export const ROSTER_FIXTURE: RosterFile = {
  version: 1,
  updatedAt: '2026-10-13T14:00:00.000Z',
  snapshot: {
    version: 1,
    tags: [
      { tag: 'sergey', count: 400, chance: 0.4, meme: 'sergey.jpeg' },
      { tag: 'pepe', count: 100, chance: 0.2, meme: 'pepe.jpeg' },
      { tag: 'comfy', count: 25, chance: 0.1, meme: 'comfy.jpeg' },
      { tag: 'prophecy', count: 3, chance: 0.1, meme: 'prophecy.jpeg' },
      { tag: 'painting', count: 1, chance: 0.05, meme: 'painting.jpeg' },
      { tag: 'space', count: 1, chance: 0.05, meme: 'space.jpeg' },
      { tag: 'zoomer', count: 1, chance: 0.05, meme: 'zoomer.jpeg' },
      { tag: 'samurai', count: 1, chance: 0.05, meme: 'samurai.jpeg' },
    ],
  },
  marines: [
    { serial: 1, callsign: 'sergey-pepe-comfy', tags: ['sergey', 'pepe', 'comfy'], tier: 'common', score: 14.2, percentile: 31.5, memes: [rosterMeme('sergey', 400), rosterMeme('pepe', 100), rosterMeme('comfy', 25)], blood: 'LINK+', faith: '4IR', enlisted: '2026-10-13' },
    { serial: 2, callsign: 'painting-space-prophecy', tags: ['painting', 'space', 'prophecy'], tier: 'legendary', score: 18.74, percentile: 97.9, memes: [rosterMeme('painting', 1), rosterMeme('space', 1), rosterMeme('prophecy', 3)], blood: 'O-LINK', faith: 'SERGEY', enlisted: '2026-10-13' },
    { serial: 3, callsign: 'pepe-sergey-prophecy', tags: ['pepe', 'sergey', 'prophecy'], tier: 'uncommon', score: 16.3, percentile: 66.1, memes: [rosterMeme('pepe', 100), rosterMeme('sergey', 400), rosterMeme('prophecy', 3)], blood: 'LINK+', faith: 'STAKING', enlisted: '2026-10-14' },
    { serial: 4, callsign: 'comfy-painting-sergey', tags: ['comfy', 'painting', 'sergey'], tier: 'rare', score: 17.5, percentile: 88.2, memes: [rosterMeme('comfy', 25), rosterMeme('painting', 1), rosterMeme('sergey', 400)], blood: '7777777', faith: '4IR', enlisted: '2026-10-14' },
  ],
};
```

(If `testing.ts` already imports from other modules at the top, move the new `import type` up to join them.)

- [ ] **Step 2: Write the failing tests**

Create `packages/core/test/roster.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rarerThan } from '../src/linkmarine';
import { callsignsPerTag, census, rankOf, ranked, ROSTER_SCHEMA, tagBoard, tagFacts } from '../src/roster';
import { ROSTER_FIXTURE } from '../src/testing';

const serials = (marines: { serial: number }[]) => marines.map((m) => m.serial);

describe('the roster file', () => {
  it('accepts the fixture as a version 1 roster', () => {
    // #then
    expect(ROSTER_SCHEMA.safeParse(ROSTER_FIXTURE).success).toBe(true);
  });

  it('refuses a Marine carrying any field beyond the allowlist, such as a display name', () => {
    // #given a Marine with a leaked name
    const leaked = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0]!, displayName: 'moment maker' }] };
    // #then
    expect(ROSTER_SCHEMA.safeParse(leaked).success).toBe(false);
  });

  it('refuses an enlistment that is not a bare UTC date', () => {
    // #given an enlistment time
    const timed = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0]!, enlisted: '2026-10-13T10:40:00.000Z' }] };
    // #then
    expect(ROSTER_SCHEMA.safeParse(timed).success).toBe(false);
  });
});

describe('tag facts', () => {
  it('counts each drawn tag’s carriers and credits the lowest serial as its discoverer', () => {
    // #when
    const facts = tagFacts(ROSTER_FIXTURE.marines);
    // #then
    expect([...facts].map(([tag, f]) => [tag, f.carriers, f.discoverer.serial])).toEqual([
      ['sergey', 3, 1],
      ['pepe', 2, 1],
      ['comfy', 2, 1],
      ['painting', 2, 2],
      ['space', 1, 2],
      ['prophecy', 2, 2],
    ]);
  });

  it('credits the discoverer by serial, whatever order the Marines arrive in', () => {
    // #when
    const facts = tagFacts([...ROSTER_FIXTURE.marines].reverse());
    // #then
    expect(facts.get('painting')!.discoverer.serial).toBe(2);
  });

  it('puts about 1 in N callsigns on a tag, from its per-pick chance', () => {
    // #then
    expect([0.4, 0.2, 0.1, 0.05].map(callsignsPerTag)).toEqual([1, 2, 4, 7]);
  });
});

describe('ranking', () => {
  it('orders by score, rarest first', () => {
    // #then
    expect(serials(ranked(ROSTER_FIXTURE.marines))).toEqual([2, 4, 3, 1]);
  });

  it('breaks a tied score by the lower serial', () => {
    // #given two Marines on the same score
    const tied = ROSTER_FIXTURE.marines.map((m) => ({ ...m, score: 15 }));
    // #then
    expect(serials(ranked(tied))).toEqual([1, 2, 3, 4]);
  });

  it('gives a Marine its 1-based rank, and null for a serial not on the roster', () => {
    // #then
    expect([rankOf(ROSTER_FIXTURE.marines, 4), rankOf(ROSTER_FIXTURE.marines, 99)]).toEqual([2, null]);
  });

  it('says "rarer than N" for N from 0 to 99, as the card does', () => {
    // #then
    expect([0.4, 31.5, 97.9, 100].map(rarerThan)).toEqual([0, 31, 97, 99]);
  });
});

describe('the census', () => {
  it('counts each tier rarest first, beside the 3/12/25/60 odds', () => {
    // #then
    expect(census(ROSTER_FIXTURE.marines)).toEqual([
      { tier: 'legendary', count: 1, sharePct: 25, expectedPct: 3 },
      { tier: 'rare', count: 1, sharePct: 25, expectedPct: 12 },
      { tier: 'uncommon', count: 1, sharePct: 25, expectedPct: 25 },
      { tier: 'common', count: 1, sharePct: 25, expectedPct: 60 },
    ]);
  });

  it('shares nothing out on an empty roster', () => {
    // #then
    expect(census([]).map((t) => t.sharePct)).toEqual([0, 0, 0, 0]);
  });
});

describe('the tag board', () => {
  it('lists every snapshot tag commonest first, ties by name, with its carriers and discoverer', () => {
    // #when
    const board = tagBoard(ROSTER_FIXTURE);
    // #then
    expect(board.map((t) => [t.tag, t.carriers, t.discoverer?.serial ?? null])).toEqual([
      ['sergey', 3, 1],
      ['pepe', 2, 1],
      ['comfy', 2, 1],
      ['prophecy', 2, 2],
      ['painting', 2, 2],
      ['samurai', 0, null],
      ['space', 1, 2],
      ['zoomer', 0, null],
    ]);
  });

  it('leaves out a tag a Marine carries but the current snapshot lacks', () => {
    // #given a Marine from an older snapshot carrying "ghost"
    const old = { ...ROSTER_FIXTURE.marines[0]!, serial: 5, tags: ['ghost', 'pepe', 'comfy'] as [string, string, string] };
    // #when
    const board = tagBoard({ ...ROSTER_FIXTURE, marines: [...ROSTER_FIXTURE.marines, old] });
    // #then
    expect(board.map((t) => t.tag)).not.toContain('ghost');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/roster.test.ts`
Expected: FAIL, because `../src/roster` doesn't exist and `rarerThan` isn't exported.

- [ ] **Step 4: Add `rarerThan`**

In `packages/core/src/linkmarine.ts`, after `tierTopPct`, add:

```ts
/** "rarer than N in 100": the share of simulated draws below this one, floored, and never 100. */
export function rarerThan(percentile: number): number {
  return Math.min(99, Math.floor(percentile));
}
```

- [ ] **Step 5: Write `roster.ts`**

Create `packages/core/src/roster.ts`:

```ts
import { z } from 'zod';
import { TIER_SHARE_PCT, TIERS, type Tier } from './linkmarine';

/**
 * The public LinkMarines roster the bot serves at discord.ccip.dev/roster.json, and every rule the site derives from it.
 * Callsigns only: the schema is strict, so a Discord name, avatar or id can never ride along.
 */
export const ROSTER_VERSION = 1;
/** The first hundred serials: the plank owners. */
export const PLANK_SEATS = 100;

const MEME = z.strictObject({ tag: z.string(), file: z.string(), count: z.number().int().positive() });

export const ROSTER_SCHEMA = z.strictObject({
  version: z.literal(ROSTER_VERSION),
  updatedAt: z.string(),
  snapshot: z.strictObject({
    version: z.number().int(),
    tags: z.array(z.strictObject({ tag: z.string(), count: z.number().int().positive(), chance: z.number().positive(), meme: z.string() })),
  }),
  marines: z.array(
    z.strictObject({
      serial: z.number().int().positive(),
      callsign: z.string(),
      tags: z.tuple([z.string(), z.string(), z.string()]),
      tier: z.enum(TIERS),
      score: z.number(),
      percentile: z.number(),
      memes: z.tuple([MEME, MEME, MEME]),
      blood: z.string(),
      faith: z.string(),
      enlisted: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
});

export type RosterFile = z.infer<typeof ROSTER_SCHEMA>;
export type RosterMarine = RosterFile['marines'][number];
export type RosterTag = RosterFile['snapshot']['tags'][number];
export type RosterMeme = RosterMarine['memes'][number];

export const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** About 1 in N callsigns carry a tag: three picks at its per-pick chance (an approximation, since picks never repeat a tag). */
export function callsignsPerTag(chance: number): number {
  return Math.round(1 / (1 - (1 - chance) ** 3));
}

export interface TagFacts {
  carriers: number;
  /** The Marine with the lowest serial carrying the tag. Serials only grow, so a discoverer never changes. */
  discoverer: RosterMarine;
}

/** Every drawn tag, in the order its discoverer drew it: how many Marines carry it, and who drew it first. */
export function tagFacts(marines: readonly RosterMarine[]): Map<string, TagFacts> {
  const facts = new Map<string, TagFacts>();
  for (const marine of [...marines].sort((a, b) => a.serial - b.serial)) {
    for (const tag of marine.tags) {
      const known = facts.get(tag);
      if (known) known.carriers += 1;
      else facts.set(tag, { carriers: 1, discoverer: marine });
    }
  }
  return facts;
}

/** Rarest first: score descending, then the lower serial. */
export function ranked(marines: readonly RosterMarine[]): RosterMarine[] {
  return [...marines].sort((a, b) => b.score - a.score || a.serial - b.serial);
}

/** A Marine's 1-based place in `ranked`, or null when the serial is not on the roster. */
export function rankOf(marines: readonly RosterMarine[], serial: number): number | null {
  const at = ranked(marines).findIndex((m) => m.serial === serial);
  return at < 0 ? null : at + 1;
}

export interface TierCount {
  tier: Tier;
  count: number;
  /** The share of Marines in the tier, 0–100. */
  sharePct: number;
  /** The tier's share of all draws (TIER_SHARE_PCT). */
  expectedPct: number;
}

/** Marines per tier, rarest first, beside the odds. */
export function census(marines: readonly RosterMarine[]): TierCount[] {
  return [...TIERS].reverse().map((tier) => {
    const count = marines.filter((m) => m.tier === tier).length;
    return { tier, count, sharePct: marines.length === 0 ? 0 : (count / marines.length) * 100, expectedPct: TIER_SHARE_PCT[tier] };
  });
}

export interface BoardTag extends RosterTag {
  carriers: number;
  discoverer: RosterMarine | null;
}

/** Every tag in the snapshot, commonest first (chance descending, then name), with who carries it. */
export function tagBoard(roster: RosterFile): BoardTag[] {
  const facts = tagFacts(roster.marines);
  return [...roster.snapshot.tags]
    .sort((a, b) => b.chance - a.chance || byName(a.tag, b.tag))
    .map((t) => ({ ...t, carriers: facts.get(t.tag)?.carriers ?? 0, discoverer: facts.get(t.tag)?.discoverer ?? null }));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/roster.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 7: Run the whole suite and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/roster.ts packages/core/src/linkmarine.ts packages/core/src/testing.ts packages/core/package.json packages/core/test/roster.test.ts
git commit -m "feat(core): the public roster file, strict to callsigns, with its tag, rank and census rules

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: Most wanted, the ticker, the wall's search, the constellation and a Marine's tags (core)

**Files:**
- Modify: `packages/core/src/roster.ts`
- Test: `packages/core/test/roster.test.ts` (append)

**Interfaces:**
- **Consumes (Task 1):** `RosterFile`, `RosterMarine`, `RosterTag`, `tagFacts`, `byName`, `callsignsPerTag`, `PLANK_SEATS`, plus `rarerThan` and `callsignSeed` from `./linkmarine`.
- **Produces:**
  - `MOST_WANTED = 5`, `utcDay(now: Date): string`, `mostWanted(roster, now): RosterTag[]`;
  - `TICKER_MARINES = 20`, `type TickerItem`, `tickerItems(roster): TickerItem[]`;
  - `type WallOrder = 'rarity' | 'newest'`, `interface WallQuery { text; tier; tag; order }`, `ALL_MARINES: WallQuery`, `wallMarines(marines, query): RosterMarine[]`;
  - `CONSTELLATION_SIZE = 24`, `interface Planet { tag; carriers; meme; oneMeme }`, `constellation(roster): Planet[]`;
  - `interface MarineTag { tag; file; count; carriers; discoverer: boolean }`, `marineTags(roster, marine): MarineTag[]`;
  - `plankSeats(marines): (RosterMarine | null)[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/roster.test.ts`. Add these imports to the existing import line from `../src/roster`: `ALL_MARINES, constellation, marineTags, mostWanted, plankSeats, tickerItems, wallMarines`.

```ts
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const empty = { ...ROSTER_FIXTURE, marines: [] };

describe('today’s most wanted', () => {
  it('posts the rarest undrawn tags, five at most', () => {
    // #then only zoomer and samurai are undrawn in the fixture
    expect(mostWanted(ROSTER_FIXTURE, day('2026-10-13')).map((t) => t.tag)).toEqual(['zoomer', 'samurai']);
  });

  it('breaks ties at equal odds by a hash of the UTC day, so the five change at midnight', () => {
    // #when nothing is drawn: four one-meme tags tie at 0.05, then comfy and prophecy at 0.1
    const picks = ['2026-10-13', '2026-10-14'].map((d) => mostWanted(empty, day(d)).map((t) => t.tag));
    // #then
    expect(picks).toEqual([
      ['space', 'zoomer', 'samurai', 'painting', 'comfy'],
      ['zoomer', 'painting', 'samurai', 'space', 'prophecy'],
    ]);
  });

  it('keeps the same five all day', () => {
    // #then
    expect(mostWanted(empty, new Date('2026-10-13T00:00:01.000Z'))).toEqual(mostWanted(empty, new Date('2026-10-13T23:59:59.000Z')));
  });
});

describe('the ticker', () => {
  it('runs newest first: recruits, a Legendary, first sightings, and a stat after every third Marine', () => {
    // #then
    expect(tickerItems(ROSTER_FIXTURE)).toEqual([
      { kind: 'recruit', serial: 4, callsign: 'comfy-painting-sergey', tier: 'rare' },
      { kind: 'recruit', serial: 3, callsign: 'pepe-sergey-prophecy', tier: 'uncommon' },
      { kind: 'legendary', serial: 2, callsign: 'painting-space-prophecy', rarerThan: 97 },
      { kind: 'sighting', serial: 2, tag: 'painting', oneIn: 7 },
      { kind: 'stat', label: 'MARINES', value: '4' },
      { kind: 'recruit', serial: 1, callsign: 'sergey-pepe-comfy', tier: 'common' },
      { kind: 'sighting', serial: 1, tag: 'comfy', oneIn: 4 },
    ]);
  });

  it('shows only the stats on an empty roster, the plank-owner seats included', () => {
    // #then
    expect(tickerItems(empty)).toEqual([
      { kind: 'stat', label: 'MARINES', value: '0' },
      { kind: 'stat', label: 'TAGS DRAWN', value: '0/8' },
      { kind: 'stat', label: 'LEGENDARIES', value: '0' },
      { kind: 'stat', label: 'PLANK-OWNER SEATS LEFT', value: '100' },
    ]);
  });

  it('drops the seats stat once all 100 are taken', () => {
    // #given 100 Marines
    const full = { ...ROSTER_FIXTURE, marines: Array.from({ length: 100 }, (_, i) => ({ ...ROSTER_FIXTURE.marines[0]!, serial: i + 1 })) };
    // #then
    expect(tickerItems(full).filter((i) => i.kind === 'stat').map((i) => (i.kind === 'stat' ? i.label : ''))).not.toContain('PLANK-OWNER SEATS LEFT');
  });

  it('skips a first sighting for a tag the snapshot lacks', () => {
    // #given the only Marine carries "ghost", not in the snapshot
    const ghost = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0]!, tags: ['ghost', 'zoomer', 'samurai'] as [string, string, string] }] };
    // #when
    const sightings = tickerItems(ghost).filter((i) => i.kind === 'sighting');
    // #then the rarest known tag it discovered is named, never ghost
    expect(sightings).toEqual([{ kind: 'sighting', serial: 1, tag: 'samurai', oneIn: 7 }]);
  });
});

describe('the wall', () => {
  const find = (query: Partial<typeof ALL_MARINES>) => serials(wallMarines(ROSTER_FIXTURE.marines, { ...ALL_MARINES, ...query }));

  it('orders by rarity, then serial; NEWEST by serial descending', () => {
    // #then
    expect([find({}), find({ order: 'newest' })]).toEqual([
      [2, 4, 3, 1],
      [4, 3, 2, 1],
    ]);
  });

  it('matches part of a callsign, ignoring case and outer spaces', () => {
    // #then
    expect([find({ text: 'sergey' }), find({ text: ' SERGEY ' }), find({ text: 'paint' })]).toEqual([
      [4, 3, 1],
      [4, 3, 1],
      [2, 4],
    ]);
  });

  it('finds a serial typed as #2, 2 or 0002, and digits inside a callsign too (so 2 also finds 216-judges-butter)', () => {
    // #given a Marine whose callsign holds digits
    const digits = [...ROSTER_FIXTURE.marines, { ...ROSTER_FIXTURE.marines[0]!, serial: 5, callsign: '216-judges-butter' }];
    const q = (text: string) => serials(wallMarines(digits, { ...ALL_MARINES, text }));
    // #then
    expect([q('#2'), q('2'), q('0002'), q('216')]).toEqual([[2], [2, 5], [2], [5]]);
  });

  it('filters by tier and by an exact tag', () => {
    // #then
    expect([find({ tier: 'common' }), find({ tag: 'painting' }), find({ tag: 'paint' })]).toEqual([[1], [2, 4], []]);
  });
});

describe('the constellation', () => {
  it('picks the most-carried tags, ties by name, each showing its discoverer’s meme', () => {
    // #then
    expect(constellation(ROSTER_FIXTURE)).toEqual([
      { tag: 'sergey', carriers: 3, meme: 'sergey.jpeg', oneMeme: false },
      { tag: 'comfy', carriers: 2, meme: 'comfy.jpeg', oneMeme: false },
      { tag: 'painting', carriers: 2, meme: 'painting.jpeg', oneMeme: true },
      { tag: 'pepe', carriers: 2, meme: 'pepe.jpeg', oneMeme: false },
      { tag: 'prophecy', carriers: 2, meme: 'prophecy.jpeg', oneMeme: false },
      { tag: 'space', carriers: 1, meme: 'space.jpeg', oneMeme: true },
    ]);
  });
});

describe('a Marine’s tags', () => {
  it('says who else carries each tag and which ones this Marine discovered', () => {
    // #then
    expect([marineTags(ROSTER_FIXTURE, ROSTER_FIXTURE.marines[1]!), marineTags(ROSTER_FIXTURE, ROSTER_FIXTURE.marines[3]!)]).toEqual([
      [
        { tag: 'painting', file: 'painting.jpeg', count: 1, carriers: 2, discoverer: true },
        { tag: 'space', file: 'space.jpeg', count: 1, carriers: 1, discoverer: true },
        { tag: 'prophecy', file: 'prophecy.jpeg', count: 3, carriers: 2, discoverer: true },
      ],
      [
        { tag: 'comfy', file: 'comfy.jpeg', count: 25, carriers: 2, discoverer: false },
        { tag: 'painting', file: 'painting.jpeg', count: 1, carriers: 2, discoverer: false },
        { tag: 'sergey', file: 'sergey.jpeg', count: 400, carriers: 3, discoverer: false },
      ],
    ]);
  });
});

describe('the plank owners', () => {
  it('seats serial n in seat n, and leaves the rest of the hundred open', () => {
    // #when
    const seats = plankSeats(ROSTER_FIXTURE.marines);
    // #then
    expect({ size: seats.length, taken: seats.slice(0, 5).map((m) => m?.serial ?? null) }).toEqual({ size: 100, taken: [1, 2, 3, 4, null] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/roster.test.ts`
Expected: FAIL, because the new exports are undefined.

- [ ] **Step 3: Implement**

In `packages/core/src/roster.ts`, change the first import line to:

```ts
import { callsignSeed, rarerThan, TIER_SHARE_PCT, TIERS, type Tier } from './linkmarine';
```

Then append:

```ts
export const MOST_WANTED = 5;

/** "2026-10-13": the UTC day, which the most-wanted posters turn over on. */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Today's most wanted: the rarest tags nobody carries yet, ties broken by FNV-1a of "<UTC day>:<tag>" (callsignSeed),
 * so every visitor sees the same five all day and a new five at 00:00 UTC.
 */
export function mostWanted(roster: RosterFile, now: Date): RosterTag[] {
  const drawn = tagFacts(roster.marines);
  const today = utcDay(now);
  return roster.snapshot.tags
    .filter((t) => !drawn.has(t.tag))
    .map((t) => ({ t, key: callsignSeed(`${today}:${t.tag}`) }))
    .sort((a, b) => a.t.chance - b.t.chance || a.key - b.key || byName(a.t.tag, b.t.tag))
    .slice(0, MOST_WANTED)
    .map(({ t }) => t);
}

export const TICKER_MARINES = 20;

export type TickerItem =
  | { kind: 'legendary'; serial: number; callsign: string; rarerThan: number }
  | { kind: 'recruit'; serial: number; callsign: string; tier: Tier }
  | { kind: 'sighting'; serial: number; tag: string; oneIn: number }
  | { kind: 'stat'; label: string; value: string };

const stat = (label: string, value: string): TickerItem => ({ kind: 'stat', label, value });

function tickerStats(roster: RosterFile): TickerItem[] {
  const seatsLeft = PLANK_SEATS - roster.marines.filter((m) => m.serial <= PLANK_SEATS).length;
  const stats = [
    stat('MARINES', String(roster.marines.length)),
    stat('TAGS DRAWN', `${tagFacts(roster.marines).size}/${roster.snapshot.tags.length}`),
    stat('LEGENDARIES', String(roster.marines.filter((m) => m.tier === 'legendary').length)),
  ];
  return seatsLeft > 0 ? [...stats, stat('PLANK-OWNER SEATS LEFT', String(seatsLeft))] : stats;
}

/**
 * The ticker's crawl, from the 20 newest Marines: each one's enlistment (a Legendary gets its own line), the rarest
 * tag it discovered if any, and a stat in rotation after every third Marine. With no stat placed, the stats alone.
 */
export function tickerItems(roster: RosterFile): TickerItem[] {
  const facts = tagFacts(roster.marines);
  const chance = new Map(roster.snapshot.tags.map((t) => [t.tag, t.chance]));
  const stats = tickerStats(roster);
  const items: TickerItem[] = [];
  let placed = 0;
  [...roster.marines]
    .sort((a, b) => b.serial - a.serial)
    .slice(0, TICKER_MARINES)
    .forEach((m, i) => {
      items.push(m.tier === 'legendary' ? { kind: 'legendary', serial: m.serial, callsign: m.callsign, rarerThan: rarerThan(m.percentile) } : { kind: 'recruit', serial: m.serial, callsign: m.callsign, tier: m.tier });
      const found = m.tags
        .filter((t) => chance.has(t) && facts.get(t)?.discoverer.serial === m.serial)
        .sort((a, b) => chance.get(a)! - chance.get(b)! || byName(a, b))[0];
      if (found !== undefined) items.push({ kind: 'sighting', serial: m.serial, tag: found, oneIn: callsignsPerTag(chance.get(found)!) });
      if (i % 3 === 2) items.push(stats[placed++ % stats.length]!);
    });
  return placed === 0 ? [...items, ...stats] : items;
}

export type WallOrder = 'rarity' | 'newest';

export interface WallQuery {
  /** A callsign fragment, or a serial as "#7", "7" or "0007". */
  text: string;
  tier: Tier | null;
  /** An exact tag, set by clicking the board or a planet. */
  tag: string | null;
  order: WallOrder;
}

export const ALL_MARINES: WallQuery = { text: '', tier: null, tag: null, order: 'rarity' };

const RARITY: Readonly<Record<Tier, number>> = { legendary: 0, rare: 1, uncommon: 2, common: 3 };

/** The wall's Marines for a query: every filter applies, then rarity (Legendary first) and serial, or newest first. */
export function wallMarines(marines: readonly RosterMarine[], query: WallQuery): RosterMarine[] {
  const text = query.text.trim().toLowerCase();
  const serial = /^#?\d+$/.test(text) ? Number(text.replace('#', '')) : null;
  return marines
    .filter((m) => (query.tier === null || m.tier === query.tier) && (query.tag === null || m.tags.includes(query.tag)) && (text === '' || m.callsign.includes(text) || m.serial === serial))
    .sort(query.order === 'newest' ? (a, b) => b.serial - a.serial : (a, b) => RARITY[a.tier] - RARITY[b.tier] || a.serial - b.serial);
}

export const CONSTELLATION_SIZE = 24;

export interface Planet {
  tag: string;
  carriers: number;
  /** The meme file its discoverer drew for this tag. */
  meme: string;
  /** The tag exists in a single meme: it glows gold. */
  oneMeme: boolean;
}

/** The most-carried tags (ties by name), up to CONSTELLATION_SIZE. */
export function constellation(roster: RosterFile): Planet[] {
  return [...tagFacts(roster.marines)]
    .sort(([a, fa], [b, fb]) => fb.carriers - fa.carriers || byName(a, b))
    .slice(0, CONSTELLATION_SIZE)
    .map(([tag, f]) => {
      const meme = f.discoverer.memes[f.discoverer.tags.indexOf(tag)]!;
      return { tag, carriers: f.carriers, meme: meme.file, oneMeme: meme.count === 1 };
    });
}

export interface MarineTag {
  tag: string;
  file: string;
  count: number;
  carriers: number;
  /** This Marine drew the tag first. */
  discoverer: boolean;
}

/** A Marine's three tags, in draw order, with who else carries each. */
export function marineTags(roster: RosterFile, marine: RosterMarine): MarineTag[] {
  const facts = tagFacts(roster.marines);
  return marine.memes.map((m) => ({ tag: m.tag, file: m.file, count: m.count, carriers: facts.get(m.tag)?.carriers ?? 1, discoverer: facts.get(m.tag)?.discoverer.serial === marine.serial }));
}

/** The hundred plank-owner seats: seat n holds serial n, or null while open. */
export function plankSeats(marines: readonly RosterMarine[]): (RosterMarine | null)[] {
  const bySerial = new Map(marines.map((m) => [m.serial, m]));
  return Array.from({ length: PLANK_SEATS }, (_, i) => bySerial.get(i + 1) ?? null);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/roster.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Run the whole suite and the typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add packages/core/src/roster.ts packages/core/test/roster.test.ts
git commit -m "feat(core): most wanted, the ticker, the wall's search, the constellation and a Marine's tags

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: The bot serves `/roster.json`

**Files:**
- Create: `discord/src/public.ts`
- Modify: `discord/src/index.ts` (the default export's `fetch`)
- Modify: `discord/test/helpers.ts` (add `seedMarine` and `publicDeps`)
- Test: `discord/test/public.test.ts` (new); `discord/test/index.test.ts` (append one test)

**Interfaces:**
- **Consumes:** `ROSTER_SCHEMA`, `ROSTER_VERSION` and `RosterFile`/`RosterMarine` from `@ccip-dev/core/roster`; `Bot` (`discord/src/bot.ts`); `tagChances` and `CallsignSnapshot` (`discord/src/draw.ts`); `enlist` and `MarineMeme` (`discord/src/store.ts`).
- **Produces:**
  - `discord/src/public.ts`:
    - `PublicDeps`;
    - `PUBLIC_COLUMNS`;
    - `PublicRow`;
    - `rosterMarine(row, snapshot): RosterMarine`;
    - `buildRoster(deps): Promise<RosterFile>`;
    - `publicRoute(request, deps): Promise<Response | null>`, which returns null for a path that isn't public;
    - internal `ROUTES`, `CORS`, `NO_STORE`, `MISSING_MAX_AGE` and `reason`, which Task 5 extends.
  - `discord/test/helpers.ts`: `seedMarine(userId, displayName, callsign, extra?)` and `publicDeps(overrides?)`.

- [ ] **Step 1: Add the test helpers**

Append to `discord/test/helpers.ts`. Add `import { enlist, type MarineMeme } from '../src/store';` and `import type { PublicDeps } from '../src/public';` at the top:

```ts
/**
 * Enlists a Marine straight into the test D1 with the given callsign. Each meme is the tag's first snapshot file,
 * keyed as the bot keys memes. `extra` overrides the draw's tier, score or percentile, or the memes (to leave out counts).
 */
export async function seedMarine(
  userId: string,
  displayName: string,
  callsign: string,
  extra: { tier?: 'common' | 'uncommon' | 'rare' | 'legendary'; score?: number; percentile?: number; memes?: MarineMeme[] } = {},
): Promise<void> {
  const tags = callsign.split('-') as [string, string, string];
  const files = tags.map((tag) => SNAPSHOT.tags.find((t) => t.tag === tag)!.memes[0]!);
  const result = await enlist(
    env.DB,
    { platform: 'discord', userId, displayName, enlistedAt: '2026-10-13T10:40:00.000Z', snapshotVersion: SNAPSHOT.version },
    () => ({
      draw: { tags, callsign, tagKey: [...tags].sort().join('-'), score: extra.score ?? 15, tier: extra.tier ?? 'common', percentile: extra.percentile ?? 40 },
      memes: extra.memes ?? tags.map((tag, i) => ({ tag, file: files[i]!, key: `memes/${files[i]}.png`, count: SNAPSHOT.tags.find((t) => t.tag === tag)!.count, sha: SNAPSHOT.archive.sha })),
      blood: 'LINK+',
      faith: '4IR',
    }),
  );
  if (result.kind !== 'enlisted') throw new Error(`seedMarine ${callsign}: ${result.kind}`);
}

/** The public routes' dependencies on the test D1 and R2, with the fake renderer and archive, and no edge cache. */
export function publicDeps(overrides: Partial<PublicDeps> = {}): PublicDeps & { renderer: ReturnType<typeof fakeRenderer>; fetch: ReturnType<typeof fakeFetch>; work: Promise<unknown>[] } {
  const work: Promise<unknown>[] = [];
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: fakeRenderer(),
    fetch: fakeFetch(ARCHIVE_ROUTES),
    snapshot: SNAPSHOT,
    now: () => new Date('2026-10-13T14:00:00.000Z'),
    cache: null,
    waitUntil: (p) => void work.push(p),
    work,
    ...overrides,
  } as PublicDeps & { renderer: ReturnType<typeof fakeRenderer>; fetch: ReturnType<typeof fakeFetch>; work: Promise<unknown>[] };
}

/** An edge cache in a Map, keyed by URL. */
export function fakeCache(): Pick<Cache, 'match' | 'put'> & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    match: async (request: RequestInfo | URL) => store.get(String(request instanceof Request ? request.url : request))?.clone(),
    put: async (request: RequestInfo | URL, response: Response) => void store.set(String(request instanceof Request ? request.url : request), response),
  } as Pick<Cache, 'match' | 'put'> & { store: Map<string, Response> };
}
```

- [ ] **Step 2: Write the failing tests**

Create `discord/test/public.test.ts`:

```ts
import { ROSTER_SCHEMA } from '@ccip-dev/core/roster';
import { beforeEach, describe, expect, it } from 'vitest';
import { publicRoute } from '../src/public';
import { fakeCache, publicDeps, resetStorage, seedMarine } from './helpers';

const PRIVATE_NAME = 'Zed PRIVATE-NAME 991';
const PRIVATE_ID = '999888777666555444';
const get = (path: string, method = 'GET') => new Request(`https://discord.ccip.dev${path}`, { method });

beforeEach(resetStorage);

describe('/roster.json', () => {
  it('lists every Marine by serial with only the allowlisted fields, as a valid roster', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { tier: 'legendary', score: 18.7, percentile: 97.9 });
    await seedMarine('b', 'rory', 'sergey-pepe-comfy');
    // #when
    const body = await (await publicRoute(get('/roster.json'), publicDeps()))!.json();
    // #then
    expect({ valid: ROSTER_SCHEMA.safeParse(body).success, marines: body.marines.map((m: Record<string, unknown>) => [m.serial, m.callsign, Object.keys(m).sort()]) }).toEqual({
      valid: true,
      marines: [
        [1, 'painting-space-prophecy', ['blood', 'callsign', 'enlisted', 'faith', 'memes', 'percentile', 'score', 'serial', 'tags', 'tier']],
        [2, 'sergey-pepe-comfy', ['blood', 'callsign', 'enlisted', 'faith', 'memes', 'percentile', 'score', 'serial', 'tags', 'tier']],
      ],
    });
  });

  it('never carries a Discord name or id, in the body or the headers', async () => {
    // #given
    await seedMarine(PRIVATE_ID, PRIVATE_NAME, 'painting-space-prophecy');
    // #when
    const res = (await publicRoute(get('/roster.json'), publicDeps()))!;
    const seen = (await res.text()) + JSON.stringify([...res.headers]);
    // #then
    expect([seen.includes(PRIVATE_NAME), seen.includes(PRIVATE_ID)]).toEqual([false, false]);
  });

  it('gives each meme the tag, file and count, and the enlistment as a bare date', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    // #when
    const [marine] = (await (await publicRoute(get('/roster.json'), publicDeps()))!.json()).marines;
    // #then
    expect({ memes: marine.memes, enlisted: marine.enlisted }).toEqual({
      memes: [
        { tag: 'painting', file: 'shared.gif', count: 1 },
        { tag: 'space', file: 'sp1.jpeg', count: 1 },
        { tag: 'prophecy', file: 'pr1.jpg', count: 3 },
      ],
      enlisted: '2026-10-13',
    });
  });

  it('falls back to the snapshot’s meme count for the first Marines, whose memes were stored without one', async () => {
    // #given memes stored without counts
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { memes: ['shared.gif', 'sp1.jpeg', 'pr1.jpg'].map((file, i) => ({ tag: ['painting', 'space', 'prophecy'][i]!, file, key: `memes/${file}.png` })) });
    // #when
    const [marine] = (await (await publicRoute(get('/roster.json'), publicDeps()))!.json()).marines;
    // #then
    expect(marine.memes.map((m: { count: number }) => m.count)).toEqual([1, 1, 3]);
  });

  it('carries the snapshot: every tag with its count, its per-pick chance and its first meme', async () => {
    // #when
    const { snapshot } = await (await publicRoute(get('/roster.json'), publicDeps()))!.json();
    // #then
    expect({
      version: snapshot.version,
      first: snapshot.tags[0],
      total: Math.round(snapshot.tags.reduce((s: number, t: { chance: number }) => s + t.chance, 0) * 1000) / 1000,
    }).toEqual({ version: 3, first: { tag: 'sergey', count: 400, chance: expect.any(Number), meme: 's1.jpeg' }, total: 1 });
  });

  it('answers as JSON any site may read, fresh for a minute', async () => {
    // #when
    const res = (await publicRoute(get('/roster.json'), publicDeps()))!;
    // #then
    expect([res.status, res.headers.get('content-type'), res.headers.get('access-control-allow-origin'), res.headers.get('cache-control')]).toEqual([200, 'application/json', '*', 'public, max-age=60']);
  });

  it('answers HEAD with the headers and no body, and anything else with 405', async () => {
    // #when
    const [head, post] = [(await publicRoute(get('/roster.json', 'HEAD'), publicDeps()))!, (await publicRoute(get('/roster.json', 'POST'), publicDeps()))!];
    // #then
    expect([head.status, head.body, post.status, post.headers.get('allow')]).toEqual([200, null, 405, 'GET, HEAD']);
  });

  it('answers 503, never cached, when the database fails', async () => {
    // #given a D1 that throws
    const cache = fakeCache();
    const deps = publicDeps({ db: { prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database, cache });
    // #when
    const res = (await publicRoute(get('/roster.json'), deps))!;
    await Promise.all(deps.work);
    // #then
    expect([res.status, res.headers.get('cache-control'), cache.store.size]).toEqual([503, 'no-store', 0]);
  });

  it('serves a repeat from the edge cache, so a new Marine waits out the minute', async () => {
    // #given a cached roster of one
    const deps = publicDeps({ cache: fakeCache() });
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    await publicRoute(get('/roster.json'), deps);
    await Promise.all(deps.work);
    await seedMarine('b', 'rory', 'sergey-pepe-comfy');
    // #when
    const again = await (await publicRoute(get('/roster.json'), deps))!.json();
    // #then
    expect(again.marines.length).toBe(1);
  });

  it('is not a public path for anything else', async () => {
    // #then
    expect(await publicRoute(get('/rosters.json'), publicDeps())).toBeNull();
  });
});
```

Append to `discord/test/index.test.ts`, inside `describe('the interactions endpoint', …)`:

```ts
  it('serves the public roster beside the interactions endpoint', async () => {
    // #when
    const res = await handle(new Request('https://discord.ccip.dev/roster.json'), env);
    // #then
    expect([res.status, (await res.json()).version]).toEqual([200, 1]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/public.test.ts test/index.test.ts`
Expected: FAIL, because `../src/public` doesn't exist.

- [ ] **Step 4: Write `public.ts`**

Create `discord/src/public.ts`:

```ts
import { ROSTER_VERSION, type RosterFile, type RosterMarine } from '@ccip-dev/core/roster';
import type { Tier } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import { tagChances, type CallsignSnapshot } from './draw';
import type { MarineMeme } from './store';

/**
 * The bot's public, read-only routes, which the site's /marines/ pages read: the roster, the meme images and the web
 * cards. Callsigns only. Every query names PUBLIC_COLUMNS, so a Discord name, avatar or id never leaves the bot.
 */
export interface PublicDeps extends Pick<Bot, 'db' | 'bucket' | 'renderer' | 'fetch' | 'snapshot' | 'now'> {
  cache: Pick<Cache, 'match' | 'put'> | null;
  waitUntil: (work: Promise<unknown>) => void;
}

/** The only marines columns a public route reads: never user_id, display_name, platform, card_key or snapshot_version. */
export const PUBLIC_COLUMNS = 'serial, callsign, tags, tier, score, percentile, memes, blood, faith, enlisted_at';

export interface PublicRow {
  serial: number;
  callsign: string;
  tags: string;
  tier: Tier;
  score: number;
  percentile: number;
  memes: string;
  blood: string;
  faith: string;
  enlisted_at: string;
}

export const CORS = { 'Access-Control-Allow-Origin': '*' } as const;
export const NO_STORE = 'no-store';
export const MISSING_MAX_AGE = 60;
const ROSTER_MAX_AGE = 60;

export const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));
const snapshotCount = (snapshot: CallsignSnapshot, tag: string) => snapshot.tags.find((t) => t.tag === tag)?.count ?? 1;

/** A row as the roster shows it: the meme count the card used (the snapshot's, for rows stored before counts were), and the enlistment's UTC date. */
export function rosterMarine(row: PublicRow, snapshot: CallsignSnapshot): RosterMarine {
  const memes = (JSON.parse(row.memes) as MarineMeme[]).map((m) => ({ tag: m.tag, file: m.file, count: m.count ?? snapshotCount(snapshot, m.tag) }));
  return {
    serial: row.serial,
    callsign: row.callsign,
    tags: JSON.parse(row.tags) as RosterMarine['tags'],
    tier: row.tier,
    score: row.score,
    percentile: row.percentile,
    memes: memes as RosterMarine['memes'],
    blood: row.blood,
    faith: row.faith,
    enlisted: row.enlisted_at.slice(0, 10),
  };
}

function rosterSnapshot(snapshot: CallsignSnapshot): RosterFile['snapshot'] {
  const chances = tagChances(snapshot.tags);
  return { version: snapshot.version, tags: snapshot.tags.map((t) => ({ tag: t.tag, count: t.count, chance: Number(chances.get(t.tag)!.toPrecision(6)), meme: t.memes[0]! })) };
}

export async function buildRoster(deps: PublicDeps): Promise<RosterFile> {
  const { results } = await deps.db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM marines ORDER BY serial`).all<PublicRow>();
  return { version: ROSTER_VERSION, updatedAt: deps.now().toISOString(), snapshot: rosterSnapshot(deps.snapshot), marines: results.map((r) => rosterMarine(r, deps.snapshot)) };
}

const json = (body: unknown, status: number, cacheControl: string) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': cacheControl } });

async function rosterResponse(_path: string, deps: PublicDeps): Promise<Response> {
  try {
    return json(await buildRoster(deps), 200, `public, max-age=${ROSTER_MAX_AGE}`);
  } catch (err) {
    console.error(`roster.json: ${reason(err)}`);
    return json({ error: 'roster unavailable' }, 503, NO_STORE);
  }
}

export type Route = (path: string, deps: PublicDeps) => Promise<Response>;

/** Each public path and its answer. */
export const ROUTES: [RegExp, Route][] = [[/^\/roster\.json$/, rosterResponse]];

/** A GET answer from the edge cache, else built; only a 200 or a 404 is kept, for as long as its Cache-Control says. */
async function cached(request: Request, deps: PublicDeps, build: () => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  const key = new Request(`${url.origin}${url.pathname}`);
  const hit = await deps.cache?.match(key);
  if (hit) return hit;
  const res = await build();
  if (deps.cache && (res.status === 200 || res.status === 404)) deps.waitUntil(deps.cache.put(key, res.clone()));
  return res;
}

/** The answer to a public path (GET and HEAD only), or null when the path is not one, for the caller's 404. */
export async function publicRoute(request: Request, deps: PublicDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const route = ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { ...CORS, Allow: 'GET, HEAD' } });
  const res = await cached(request, deps, () => route[1](path, deps));
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
```

- [ ] **Step 5: Route the Worker**

In `discord/src/index.ts`, add `import { SNAPSHOT } from './bot';` beside `createBot` (making the import `import { createBot, SNAPSHOT, type Bot } from './bot';`) and add `import { publicRoute, type PublicDeps } from './public';`. Then add, above `export default`:

```ts
function publicDeps(env: Env, ctx: ExecutionContext): PublicDeps {
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: env.SITE,
    fetch: (input, init) => fetch(input, init),
    snapshot: SNAPSHOT,
    now: () => new Date(),
    cache: caches.default,
    waitUntil: (work) => ctx.waitUntil(work),
  };
}
```

Replace the first line of `fetch` (`if (request.method !== 'POST' || new URL(request.url).pathname !== '/interactions') return new Response('Not found', { status: 404 });`) with:

```ts
    if (new URL(request.url).pathname !== '/interactions') return (await publicRoute(request, publicDeps(env, ctx))) ?? new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/public.test.ts test/index.test.ts`
Expected: PASS. The existing "answers anything but a POST to /interactions with 404" still passes, because `POST /` isn't a public path.

- [ ] **Step 7: Run the whole suite and the typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add discord/src/public.ts discord/src/index.ts discord/test/helpers.ts discord/test/public.test.ts discord/test/index.test.ts
git commit -m "feat(discord): serve the public roster.json, callsigns only, cached for a minute

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: The web card, a dog tag card without the name and avatar

**Files:**
- Modify: `packages/core/src/linkmarine.ts`: add `MarineWebCard`, `marineOdds`, and `renderMarineWebCard` on `LinkMarineRenderer`.
- Modify: `site/worker/linkmarine/marine-card.ts`: `oddsText` gives way to `marineOdds`; `marineTree` and `panel` accept a web card.
- Modify: `site/worker/linkmarine/entrypoint.ts`: add `renderMarineWebCard`.
- Modify: `site/test/fixtures/linkmarine.ts`: add `webMarine`.
- Modify: `site/scripts/render-linkmarine-cards.ts`: also write `marine-<tier>-web.png`.
- Modify: `discord/test/helpers.ts` (`fakeRenderer`) and `discord/test/site-stub.js`: the new method.
- Test: `packages/core/test/linkmarine.test.ts`, `site/test/linkmarine-marine.test.ts`, `site/worker/test/linkmarine-marine.test.ts`.

**Interfaces:**
- **Produces:**
  - `MarineWebCard = Omit<MarineCard, 'name' | 'avatar'>`;
  - `marineOdds(tier: Tier, percentile: number): string | null`;
  - `LinkMarineRenderer.renderMarineWebCard(card: MarineWebCard): Promise<Uint8Array>`;
  - `fakeRenderer()` now also returns `webCards: MarineWebCard[]` (each card it was asked to draw), and `'renderMarineWebCard'` may be passed as its failing method.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/linkmarine.test.ts` (add `marineOdds` to its import from `../src/linkmarine`):

```ts
describe('the odds line', () => {
  it('prints the tier’s share from Uncommon up and "rarer than N" for N from 1 to 99', () => {
    // #then
    expect([marineOdds('legendary', 97.9), marineOdds('common', 17.3), marineOdds('uncommon', 0.9), marineOdds('common', 0.4), marineOdds('legendary', 100)]).toEqual([
      'top 3% · rarer than 97 in 100 Marines',
      'rarer than 17 in 100 Marines',
      'top 40%',
      null,
      'top 3% · rarer than 99 in 100 Marines',
    ]);
  });
});
```

Append to `site/test/fixtures/linkmarine.ts`. Add `MarineWebCard` to its type import from `@ccip-dev/core/linkmarine`:

```ts
/** A tier's sample Marine as the roster's web card draws it: no name, no avatar. */
export function webMarine(tier: Tier, pngs: readonly Uint8Array[]): MarineWebCard {
  const m = marine(tier, pngs);
  return { serial: m.serial, callsign: m.callsign, tier: m.tier, percentile: m.percentile, memes: m.memes, blood: m.blood, faith: m.faith, enlistedAt: m.enlistedAt };
}
```

Append to `site/test/linkmarine-marine.test.ts`. Add `webMarine` to the fixtures import:

```ts
describe('the web card', () => {
  it('draws the same card without the stamped name, keeping the tier word and the odds', () => {
    // #when
    const words = texts(marineTree(webMarine('legendary', [PNG])));
    // #then
    expect({ name: words.includes('momentmaker'), kept: ['LEGENDARY', 'top 3% · rarer than 97 in 100 Marines', 'LINK MARINE #0007', 'ccip.dev'].every((w) => words.includes(w)) }).toEqual({ name: false, kept: true });
  });
});
```

Append to `site/worker/test/linkmarine-marine.test.ts`. Add `webMarine` to the `../../test/fixtures/linkmarine` import:

```ts
describe('the LinkMarineCards entrypoint: the web card', () => {
  it('renders the roster’s card at 1200×675', async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const png = await cards().renderMarineWebCard(webMarine('legendary', [red]));
    // #then
    expect(size(png)).toEqual([1200, 675]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/linkmarine.test.ts && pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-marine.test.ts`
Expected: FAIL, because `marineOdds` and `webMarine`'s type don't exist.

- [ ] **Step 3: Core types and wording**

In `packages/core/src/linkmarine.ts`:
- After `rarerThan`, add:

```ts
/**
 * The card's odds line: "top 15% · rarer than 95 in 100 Marines". The share is left out for Common (it would say
 * "top 100%") and "rarer than" where N would be 0. Null when both are left out.
 */
export function marineOdds(tier: Tier, percentile: number): string | null {
  const top = tierTopPct(tier);
  const n = rarerThan(percentile);
  const parts = [top === null ? null : `top ${top}%`, n > 0 ? `rarer than ${n} in 100 Marines` : null].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
```

- After `interface MarineCard`, add:

```ts
/** The card as the public roster draws it: everything but the stamped Discord name and avatar. */
export type MarineWebCard = Omit<MarineCard, 'name' | 'avatar'>;
```

- In `interface LinkMarineRenderer`, after `renderMarineCards`, add:

```ts
  /** The roster's card for the web: the dog tag card without the name and avatar row. */
  renderMarineWebCard(card: MarineWebCard): Promise<Uint8Array>;
```

- [ ] **Step 4: The card tree**

In `site/worker/linkmarine/marine-card.ts`:
- Add `marineOdds` and `type MarineWebCard` to the `@ccip-dev/core/linkmarine` import.
- Delete the `oddsText` function, with its doc comment.
- Replace `function panel(card: MarineCard, look: TierLook): VNode {` and its first line, `const odds = oddsText(card);`, with:

```ts
function panel(card: MarineCard | MarineWebCard, look: TierLook): VNode {
  const odds = marineOdds(card.tier, card.percentile);
  // The web card keeps the row's height, so the tier word and the odds stay where the posted card has them.
  const stamp =
    'name' in card
      ? h('div', { style: { display: 'flex', alignItems: 'center' } }, avatarNode(card), h('div', { style: { ...font('Inter', 700, 14, INK.text), marginLeft: px(8), maxWidth: px(260), overflow: 'hidden', textOverflow: 'ellipsis' } }, cardName(card.name)))
      : h('div', { style: { display: 'flex', height: px(26) } });
```

- In the `return at(430, 30, …)` that follows, replace the avatar-and-name `h('div', …)` argument with `stamp`.
- Change `export function marineTree(card: MarineCard): VNode {` to `export function marineTree(card: MarineCard | MarineWebCard): VNode {`.
- If any other helper in the file now gets a type error for being handed `card` (for example `frontText`, `backEtch` or `skyChoices`), widen its parameter to `MarineCard | MarineWebCard`. None of them reads `name` or `avatar`.

- [ ] **Step 5: The entrypoint**

In `site/worker/linkmarine/entrypoint.ts`, add `type MarineWebCard` to the core import, and after `renderMarineCards` add:

```ts
  async renderMarineWebCard(card: MarineWebCard): Promise<Uint8Array> {
    return (await renderKino(marineTree(card))).png;
  }
```

- [ ] **Step 6: The bot's fakes**

In `discord/test/helpers.ts`, change `fakeRenderer` to:
- return type `LinkMarineRenderer & { calls: string[]; webCards: MarineWebCard[] }`, adding `type MarineWebCard` to the core import;
- declare `const webCards: MarineWebCard[] = [];`;
- return `webCards` beside `calls`;
- add the method:

```ts
    async renderMarineWebCard(card) {
      webCards.push(card);
      return call('renderMarineWebCard', PNG_BYTES);
    },
```

In `discord/test/site-stub.js`, add to `LinkMarineCards`:

```js
  async renderMarineWebCard() {
    return new Uint8Array(PNG);
  }
```

- [ ] **Step 7: The sample renders for the owner**

In `site/scripts/render-linkmarine-cards.ts`, add `type MarineWebCard` to the core import. Inside the `for (const tier of TIERS)` loop, after the static card is written, add:

```ts
  const web: MarineWebCard = { serial: card.serial, callsign: card.callsign, tier: card.tier, percentile: card.percentile, memes: card.memes, blood: card.blood, faith: card.faith, enlistedAt: card.enlistedAt };
  await writeFile(join(out, `marine-${tier}-web.png`), (await draw(marineTree(web))).image);
```

Update its closing `console.log` to say it also wrote the web cards.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: green. The existing card tests (the odds wording, "momentmaker" on the Discord card) still pass.

- [ ] **Step 9: Render the samples for the owner's look**

Run: `pnpm --filter @ccip-dev/site cards:linkmarine --out /private/tmp/claude-501/-Users-rubberduck-GitHub-momentmaker-ccip-dev/19cabbec-cd1e-4fc5-a2ef-ade789a597b9/scratchpad/roster-web-cards`
Expected: `marine-common-web.png` and `marine-legendary-web.png` among the files. Open both and the matching posted cards (`marine-legendary.png`):
- the top-right name row is gone;
- LEGENDARY and the odds line sit at the same height as on the posted card.

Name both web files in your report.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/linkmarine.ts packages/core/test/linkmarine.test.ts site/worker/linkmarine/marine-card.ts site/worker/linkmarine/entrypoint.ts site/test/fixtures/linkmarine.ts site/test/linkmarine-marine.test.ts site/worker/test/linkmarine-marine.test.ts site/scripts/render-linkmarine-cards.ts discord/test/helpers.ts discord/test/site-stub.js
git commit -m "feat(site): the web dog tag card, drawn without the Discord name and avatar

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: The bot serves `/memes/<file>.png` and `/web/<serial>.png`

**Files:**
- Modify: `discord/src/public.ts`
- Test: `discord/test/public.test.ts` (append)

**Interfaces:**
- **Consumes:**
  - Task 3: `PublicDeps`, `PUBLIC_COLUMNS`, `PublicRow`, `ROUTES`, `CORS`, `NO_STORE`, `MISSING_MAX_AGE` and `reason`.
  - Task 4: `MarineWebCard` and `renderMarineWebCard`.
  - `discord/src/memes.ts`: `memeKey`, `stockMemes` and `loadMemes`.
- **Produces:** `webCardKey(serial: number): string`, which is `web/<serial>.png`.

- [ ] **Step 1: Write the failing tests**

Append to `discord/test/public.test.ts`. Add `import { env } from 'cloudflare:workers';`, add `PNG_BYTES` and `SNAPSHOT` to the helpers import, and add `import { webCardKey } from '../src/public';`:

```ts
describe('/memes/<file>.png', () => {
  it('serves a kept meme from R2, immutable, without touching the archive', async () => {
    // #given
    await env.MARINES.put('memes/sp1.jpeg.png', PNG_BYTES);
    const deps = publicDeps();
    // #when
    const res = (await publicRoute(get('/memes/sp1.jpeg.png'), deps))!;
    // #then
    expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control'), deps.fetch.urls.length]).toEqual([200, 'image/png', 'public, max-age=31536000, immutable', 0]);
  });

  it('copies a snapshot meme nobody holds yet once, then serves it from R2', async () => {
    // #given
    const deps = publicDeps();
    // #when
    await publicRoute(get('/memes/sp1.jpeg.png'), deps);
    const again = (await publicRoute(get('/memes/sp1.jpeg.png'), deps))!;
    // #then
    expect([again.status, deps.fetch.urls.length, deps.renderer.calls]).toEqual([200, 1, ['prepareMeme']]);
  });

  it('decodes an escaped file name to the same R2 key', async () => {
    // #given a snapshot meme whose name has a space
    const snapshot = { ...SNAPSHOT, tags: [...SNAPSHOT.tags, { tag: 'odd', count: 1, memes: ['b c.gif'] }] };
    await env.MARINES.put('memes/b c.gif.png', PNG_BYTES);
    // #when
    const res = (await publicRoute(get('/memes/b%20c.gif.png'), publicDeps({ snapshot })))!;
    // #then
    expect(res.status).toBe(200);
  });

  it('answers 404 for a file outside the snapshot, or a broken escape, without fetching', async () => {
    // #given
    const deps = publicDeps();
    // #when
    const answers = [(await publicRoute(get('/memes/elsewhere.jpeg.png'), deps))!, (await publicRoute(get('/memes/%E0%A4%A.png'), deps))!];
    // #then
    expect([answers.map((r) => r.status), deps.fetch.urls.length]).toEqual([[404, 404], 0]);
  });

  it('answers 503, never cached, when the archive fails', async () => {
    // #given an archive that answers nothing
    const cache = fakeCache();
    const deps = publicDeps({ fetch: (await import('./helpers')).fakeFetch({}), cache });
    // #when
    const res = (await publicRoute(get('/memes/sp1.jpeg.png'), deps))!;
    await Promise.all(deps.work);
    // #then
    expect([res.status, res.headers.get('cache-control'), cache.store.size]).toEqual([503, 'no-store', 0]);
  });
});

describe('/web/<serial>.png', () => {
  it('renders a Marine’s web card once, keeps it in R2, and serves the copy after', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { tier: 'legendary' });
    const deps = publicDeps();
    // #when
    const first = (await publicRoute(get('/web/1.png'), deps))!;
    const second = (await publicRoute(get('/web/1.png'), deps))!;
    // #then
    expect([first.status, second.status, first.headers.get('cache-control'), deps.renderer.calls.filter((c) => c === 'renderMarineWebCard').length, (await env.MARINES.head(webCardKey(1)))?.httpMetadata?.contentType]).toEqual([
      200, 200, 'public, max-age=86400', 1, 'image/png',
    ]);
  });

  it('hands the renderer no Discord name or avatar', async () => {
    // #given
    await seedMarine(PRIVATE_ID, PRIVATE_NAME, 'painting-space-prophecy');
    const deps = publicDeps();
    // #when
    await publicRoute(get('/web/1.png'), deps);
    // #then
    expect([Object.keys(deps.renderer.webCards[0]!).sort(), JSON.stringify(deps.renderer.webCards[0]).includes(PRIVATE_NAME)]).toEqual([
      ['blood', 'callsign', 'enlistedAt', 'faith', 'memes', 'percentile', 'serial', 'tier'],
      false,
    ]);
  });

  it('answers 404, briefly cached, for an unknown, zero or padded serial', async () => {
    // #when
    const answers = await Promise.all(['/web/9.png', '/web/0.png', '/web/007.png', '/web/x.png'].map(async (p) => (await publicRoute(get(p), publicDeps()))!));
    // #then
    expect(answers.map((r) => [r.status, r.headers.get('cache-control')])).toEqual(Array(4).fill([404, 'public, max-age=60']));
  });

  it('answers 503, never cached, when the card fails to render', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    const cache = fakeCache();
    const deps = publicDeps({ renderer: (await import('./helpers')).fakeRenderer('renderMarineWebCard'), cache });
    // #when
    const res = (await publicRoute(get('/web/1.png'), deps))!;
    await Promise.all(deps.work);
    // #then
    expect([res.status, res.headers.get('cache-control'), cache.store.size, await env.MARINES.head(webCardKey(1))]).toEqual([503, 'no-store', 0, null]);
  });
});
```

(Instead of the `await import('./helpers')` calls, you may import `fakeFetch` and `fakeRenderer` at the top of the file. Either is fine.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/public.test.ts`
Expected: FAIL. The new paths return null, so the `!` dereferences throw, and `webCardKey` isn't exported.

- [ ] **Step 3: Implement**

In `discord/src/public.ts`:
- Add `import type { MarineWebCard } from '@ccip-dev/core/linkmarine';`, merging it with the existing core import as `import type { MarineWebCard, Tier } from '@ccip-dev/core/linkmarine';`.
- Add `import { loadMemes, memeKey, stockMemes } from './memes';`.
- Insert this before `export type Route`:

```ts
const IMMUTABLE = 'public, max-age=31536000, immutable';
const WEB_MAX_AGE = 86_400;
const MEME_PATH = /^\/memes\/([^/]+)\.png$/;
const WEB_PATH = /^\/web\/([^/]+)\.png$/;
const SERIAL = /^[1-9][0-9]{0,8}$/;

export const webCardKey = (serial: number) => `web/${serial}.png`;

const png = (body: ReadableStream | Uint8Array, cacheControl: string) => new Response(body, { headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': cacheControl } });
const missing = () => new Response('Not found', { status: 404, headers: { ...CORS, 'Cache-Control': `public, max-age=${MISSING_MAX_AGE}` } });
const unavailable = (what: string) => new Response(`${what} unavailable`, { status: 503, headers: { ...CORS, 'Cache-Control': NO_STORE } });

/** Each snapshot meme file and the tag it came from, built once per snapshot. */
const snapshotFiles = new WeakMap<CallsignSnapshot, Map<string, string>>();

function snapshotMeme(snapshot: CallsignSnapshot, file: string): MarineMeme | null {
  let files = snapshotFiles.get(snapshot);
  if (!files) {
    files = new Map(snapshot.tags.flatMap((t) => t.memes.map((f) => [f, t.tag] as const)));
    snapshotFiles.set(snapshot, files);
  }
  const tag = files.get(file);
  return tag === undefined ? null : { tag, file, key: memeKey(file) };
}

/** A meme's 240 px PNG: from R2, else copied once from the pinned archive when the snapshot has it, else 404. */
async function memeResponse(path: string, deps: PublicDeps): Promise<Response> {
  let file: string;
  try {
    file = decodeURIComponent(MEME_PATH.exec(path)![1]!);
  } catch {
    return missing();
  }
  const kept = await deps.bucket.get(memeKey(file));
  if (kept) return png(kept.body, IMMUTABLE);
  const meme = snapshotMeme(deps.snapshot, file);
  if (!meme) return missing();
  try {
    await stockMemes(deps.bucket, deps.renderer, deps.fetch, deps.snapshot.archive, [meme]);
  } catch (err) {
    console.error(`meme ${file}: ${reason(err)}`);
    return unavailable('meme');
  }
  const stocked = await deps.bucket.get(meme.key);
  return stocked ? png(stocked.body, IMMUTABLE) : unavailable('meme');
}

/** A Marine's web card: from R2, else rendered once through the site (never with a name or avatar) and kept. */
async function webCardResponse(path: string, deps: PublicDeps): Promise<Response> {
  const digits = WEB_PATH.exec(path)![1]!;
  if (!SERIAL.test(digits)) return missing();
  const serial = Number(digits);
  const kept = await deps.bucket.get(webCardKey(serial));
  if (kept) return png(kept.body, `public, max-age=${WEB_MAX_AGE}`);
  const row = await deps.db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM marines WHERE serial = ?`).bind(serial).first<PublicRow>();
  if (!row) return missing();
  try {
    const stored = JSON.parse(row.memes) as MarineMeme[];
    await stockMemes(deps.bucket, deps.renderer, deps.fetch, deps.snapshot.archive, stored);
    const pngs = await loadMemes(deps.bucket, stored);
    if (!pngs) throw new Error('memes missing from storage right after copying');
    const marine = rosterMarine(row, deps.snapshot);
    const card: MarineWebCard = {
      serial,
      callsign: marine.callsign,
      tier: marine.tier,
      percentile: marine.percentile,
      memes: marine.memes.map((m, i) => ({ tag: m.tag, count: m.count, png: pngs[i]! })),
      blood: marine.blood,
      faith: marine.faith,
      enlistedAt: row.enlisted_at,
    };
    const bytes = await deps.renderer.renderMarineWebCard(card);
    await deps.bucket.put(webCardKey(serial), bytes, { httpMetadata: { contentType: 'image/png' } });
    return png(bytes, `public, max-age=${WEB_MAX_AGE}`);
  } catch (err) {
    console.error(`web card #${serial}: ${reason(err)}`);
    return unavailable('card');
  }
}
```

Then extend `ROUTES`:

```ts
export const ROUTES: [RegExp, Route][] = [
  [/^\/roster\.json$/, rosterResponse],
  [MEME_PATH, memeResponse],
  [WEB_PATH, webCardResponse],
];
```

`MEME_PATH` and `WEB_PATH` must be declared above `ROUTES`. Move `export type Route` and `ROUTES` below the new block if needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/public.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add discord/src/public.ts discord/test/public.test.ts
git commit -m "feat(discord): serve meme images and web cards for the roster, each made once and kept

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: The site Worker serves `/marines/<serial>/`

**Files:**
- Modify: `site/src/config.ts` (add `BOT_ORIGIN`, `ROSTER_URL`)
- Create: `site/src/lib/marines.ts` (URLs and paths)
- Create: `site/worker/marines.ts`
- Modify: `site/worker/index.ts`, `site/wrangler.toml`
- Test: `site/test/marines.test.ts` (new), `site/worker/test/marines.test.ts` (new)

**Interfaces:**
- **Produces:**
  - `site/src/config.ts`: `BOT_ORIGIN = 'https://discord.ccip.dev'` and `ROSTER_URL = 'https://discord.ccip.dev/roster.json'`.
  - `site/src/lib/marines.ts`:
    - `MARINE_TEMPLATE_PATH = '/marines/marine/'` and `MARINE_DESCRIPTION`;
    - `marinePath(serial)`, `marineUrl(serial)`, `marineTitle(serial)`;
    - `webCardUrl(serial)`, `memeUrl(file)`;
    - `serialFromPath(path): number | null`.
  - `site/worker/marines.ts`: `marinePage(request, assets): Promise<Response>` and `marineHead(page, serial): Response`.

- [ ] **Step 1: Write the failing tests**

Create `site/test/marines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { marinePath, marineTitle, marineUrl, memeUrl, serialFromPath, webCardUrl } from '../src/lib/marines';

describe('Marine URLs', () => {
  it('pads the page path, and keeps the web card on the bare serial', () => {
    // #then
    expect([marinePath(7), marineUrl(7), marineTitle(7), webCardUrl(7), marinePath(12345)]).toEqual([
      '/marines/0007/',
      'https://ccip.dev/marines/0007/',
      'LINK MARINE #0007',
      'https://discord.ccip.dev/web/7.png',
      '/marines/12345/',
    ]);
  });

  it('escapes a meme file name for the bot', () => {
    // #then
    expect(memeUrl('b c#1.gif')).toBe('https://discord.ccip.dev/memes/b%20c%231.gif.png');
  });

  it('reads the serial from a Marine page path, and nothing else', () => {
    // #then
    expect(['/marines/0007/', '/marines/7', '/marines/0/', '/marines/marine/', '/marines/', '/marines/1234567890/'].map(serialFromPath)).toEqual([7, 7, null, null, null, null]);
  });
});
```

Create `site/worker/test/marines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import worker from '../index';
import { marinePage } from '../marines';

/** The template's head as Base.astro writes it, noindex included. */
const TEMPLATE = `<!doctype html><html lang="en"><head><title>LinkMarine · ccip.dev</title><meta name="description" content="x"><link rel="canonical" href="https://ccip.dev/marines/marine/"><meta name="robots" content="noindex"><meta property="og:title" content="LinkMarine · ccip.dev"><meta property="og:description" content="x"><meta property="og:url" content="https://ccip.dev/marines/marine/"><meta property="og:image" content="https://ccip.dev/og-default.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="LinkMarine · ccip.dev"></head><body><main></main></body></html>`;

function assets() {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (request: Request | string) => {
      const path = new URL(typeof request === 'string' ? request : request.url).pathname;
      seen.push(path);
      if (path === '/marines/marine/') return new Response(TEMPLATE, { headers: { 'Content-Type': 'text/html' } });
      if (path === '/404') return new Response('<h1>Not found</h1>', { headers: { 'Content-Type': 'text/html' } });
      return new Response(`asset ${path}`, { headers: { 'Content-Type': 'text/html' } });
    },
  };
}

const page = (path: string, a = assets()) => marinePage(new Request(`https://ccip.dev${path}`), a);
/** An attribute's value, its escaped apostrophes decoded (HTMLRewriter may write ' as &#39;). */
const attr = (html: string, selector: RegExp) => selector.exec(html)?.[1]?.replace(/&#39;|&#x27;|&apos;/g, "'") ?? null;

describe('a Marine page', () => {
  it('serves the template with the Marine’s title, description, canonical URL and web card', async () => {
    // #when
    const html = await (await page('/marines/0007/')).text();
    // #then
    expect({
      title: attr(html, /<title>([^<]*)<\/title>/),
      ogTitle: attr(html, /property="og:title" content="([^"]*)"/),
      description: attr(html, /name="description" content="([^"]*)"/),
      ogDescription: attr(html, /property="og:description" content="([^"]*)"/),
      canonical: attr(html, /rel="canonical" href="([^"]*)"/),
      url: attr(html, /property="og:url" content="([^"]*)"/),
      image: attr(html, /property="og:image" content="([^"]*)"/),
      size: [attr(html, /og:image:width" content="([^"]*)"/), attr(html, /og:image:height" content="([^"]*)"/)],
      alt: attr(html, /og:image:alt" content="([^"]*)"/),
      noindex: html.includes('noindex'),
    }).toEqual({
      title: 'LINK MARINE #0007 · ccip.dev',
      ogTitle: 'LINK MARINE #0007 · ccip.dev',
      description: "A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it.",
      ogDescription: "A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it.",
      canonical: 'https://ccip.dev/marines/0007/',
      url: 'https://ccip.dev/marines/0007/',
      image: 'https://discord.ccip.dev/web/7.png',
      size: ['1200', '675'],
      alt: 'The dog tags of LINK MARINE #0007',
      noindex: false,
    });
  });

  it('redirects any other spelling of the serial to its padded path, keeping the query', async () => {
    // #when
    const answers = await Promise.all(['/marines/7/', '/marines/7', '/marines/007/?ref=x'].map((p) => page(p)));
    // #then
    expect(answers.map((r) => [r.status, r.headers.get('location')])).toEqual([
      [301, 'https://ccip.dev/marines/0007/'],
      [301, 'https://ccip.dev/marines/0007/'],
      [301, 'https://ccip.dev/marines/0007/?ref=x'],
    ]);
  });

  it('answers the 404 page for serial 0, a serial too long to be one, and the template’s own path', async () => {
    // #when
    const answers = await Promise.all(['/marines/0/', '/marines/1234567890/', '/marines/marine/', '/marines/marine'].map((p) => page(p)));
    // #then
    expect(answers.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  });

  it('passes the roster and any other /marines/ path through to the assets', async () => {
    // #given
    const a = assets();
    // #when
    const answers = await Promise.all(['/marines/', '/marines/about/'].map((p) => page(p, a)));
    // #then
    expect([await answers[0]!.text(), await answers[1]!.text()]).toEqual(['asset /marines/', 'asset /marines/about/']);
  });

  it('serves a five-digit serial at its own digits', async () => {
    // #when
    const html = await (await page('/marines/12345/')).text();
    // #then
    expect(attr(html, /<title>([^<]*)<\/title>/)).toBe('LINK MARINE #12345 · ccip.dev');
  });
});

describe('the site Worker', () => {
  it('routes /marines/ paths to the Marine page handler', async () => {
    // #when
    const res = await worker.fetch(new Request('https://ccip.dev/marines/7/'), { ASSETS: assets() } as never, {} as ExecutionContext);
    // #then
    expect(res.status).toBe(301);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/marines.test.ts && pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/marines.test.ts`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Config and URLs**

Append to `site/src/config.ts`:

```ts
/** The LinkMarine bot, which serves the public roster, its memes and its web cards. */
export const BOT_ORIGIN = 'https://discord.ccip.dev';
export const ROSTER_URL = `${BOT_ORIGIN}/roster.json`;
```

Create `site/src/lib/marines.ts`:

```ts
import { serialText } from '@ccip-dev/core/linkmarine';
import { BOT_ORIGIN, SITE_URL } from '../config';

/** The static page every /marines/<serial>/ is served from; the site Worker rewrites its head. Never linked. */
export const MARINE_TEMPLATE_PATH = '/marines/marine/';
export const MARINE_DESCRIPTION = "A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it.";

export const marinePath = (serial: number) => `/marines/${serialText(serial)}/`;
export const marineUrl = (serial: number) => `${SITE_URL}${marinePath(serial)}`;
export const marineTitle = (serial: number) => `LINK MARINE #${serialText(serial)}`;
export const webCardUrl = (serial: number) => `${BOT_ORIGIN}/web/${serial}.png`;
export const memeUrl = (file: string) => `${BOT_ORIGIN}/memes/${encodeURIComponent(file)}.png`;

const MARINE_PATH = /^\/marines\/(\d{1,9})\/?$/;

/** The serial in a Marine page's path, however it is padded; null for anything else, serial 0 included. */
export function serialFromPath(path: string): number | null {
  const match = MARINE_PATH.exec(path);
  if (!match) return null;
  const serial = Number(match[1]);
  return serial >= 1 ? serial : null;
}
```

- [ ] **Step 4: The Worker handler**

Create `site/worker/marines.ts`:

```ts
import { SITE_URL } from '../src/config';
import { MARINE_DESCRIPTION, MARINE_TEMPLATE_PATH, marinePath, marineTitle, serialFromPath, webCardUrl } from '../src/lib/marines';

export interface MarineAssets {
  fetch(request: Request | string): Promise<Response>;
}

/** A path shaped like a Marine's, valid or not: anything else under /marines/ is the assets' to answer. */
const SERIAL_SHAPED = /^\/marines\/\d+\/?$/;

async function notFound(url: URL, assets: MarineAssets): Promise<Response> {
  const page = await assets.fetch(new Request(new URL('/404', url)));
  return new Response(page.body, { status: 404, headers: page.headers });
}

const setAttribute = (name: string, value: string) => ({
  element(e: Element) {
    e.setAttribute(name, value);
  },
});

/** The template's head made the Marine's: title, description, canonical URL and web card. A Marine page is indexable. */
export function marineHead(page: Response, serial: number): Response {
  const title = `${marineTitle(serial)} · ccip.dev`;
  const url = `${SITE_URL}${marinePath(serial)}`;
  return new HTMLRewriter()
    .on('title', { element: (e) => void e.setInnerContent(title) })
    .on('meta[name="robots"]', { element: (e) => void e.remove() })
    .on('meta[name="description"]', setAttribute('content', MARINE_DESCRIPTION))
    .on('meta[property="og:description"]', setAttribute('content', MARINE_DESCRIPTION))
    .on('meta[property="og:title"]', setAttribute('content', title))
    .on('meta[property="og:url"]', setAttribute('content', url))
    .on('link[rel="canonical"]', setAttribute('href', url))
    .on('meta[property="og:image"]', setAttribute('content', webCardUrl(serial)))
    .on('meta[property="og:image:width"]', setAttribute('content', '1200'))
    .on('meta[property="og:image:height"]', setAttribute('content', '675'))
    .on('meta[property="og:image:alt"]', setAttribute('content', `The dog tags of ${marineTitle(serial)}`))
    .transform(page);
}

/**
 * /marines/<serial>/: the padded path gets the template with the Marine's head, other spellings redirect to it, and
 * serial 0 or the template's own path get the 404 page. The bot is never asked, so its outage cannot break a page.
 */
export async function marinePage(request: Request, assets: MarineAssets): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === MARINE_TEMPLATE_PATH || url.pathname === MARINE_TEMPLATE_PATH.slice(0, -1)) return notFound(url, assets);
  if (!SERIAL_SHAPED.test(url.pathname)) return assets.fetch(request);
  const serial = serialFromPath(url.pathname);
  if (serial === null) return notFound(url, assets);
  const canonical = marinePath(serial);
  if (url.pathname !== canonical) return Response.redirect(new URL(`${canonical}${url.search}`, url).href, 301);
  const template = await assets.fetch(new Request(new URL(MARINE_TEMPLATE_PATH, url)));
  if (!template.ok) return template;
  return marineHead(template, serial);
}
```

If `Element` from `@cloudflare/workers-types` clashes with a DOM `Element` in this tsconfig (the worker tsconfig uses only `ES2022`, so it shouldn't), annotate with `HTMLRewriterTypes.Element` instead.

- [ ] **Step 5: Route it**

Replace the body of `fetch` in `site/worker/index.ts`:

```ts
import { marinePage } from './marines';
import { handleOg, type OgEnv } from './og';
import { renderPng } from './render';

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/marines/')) return marinePage(request, env.ASSETS);
    if (!path.startsWith('/og/')) return env.ASSETS.fetch(request);
    return handleOg(request, env, ctx, { fetch: (input, init) => fetch(input, init), renderPng, cache: caches.default });
  },
} satisfies ExportedHandler<OgEnv & { ASSETS: Fetcher }>;

export { LinkMarineCards } from './linkmarine/entrypoint';
```

In `site/wrangler.toml`, change `run_worker_first = ["/og/*"]` to `run_worker_first = ["/og/*", "/marines/*"]`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/site test`
Expected: PASS, both the Node suite and the worker suite.

- [ ] **Step 7: Run the whole suite and the typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add site/src/config.ts site/src/lib/marines.ts site/worker/marines.ts site/worker/index.ts site/wrangler.toml site/test/marines.test.ts site/worker/test/marines.test.ts
git commit -m "feat(site): serve /marines/<serial>/ from one template, its head rewritten with the Marine's card

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

#### Checkpoint (controller, after Task 6 is reviewed): push and check the bot's routes live

Push `main` (pre-approved). Both `deploy` (the bot) and `site` (the card entrypoint and the Worker) run. When both are green, check:
- `curl -sI https://discord.ccip.dev/roster.json` returns 200 with `access-control-allow-origin: *`.
- `curl -s https://discord.ccip.dev/roster.json | head -c 300` shows a version-1 roster, with no display names in the body (grep it for the owner's Discord name).
- `/web/1.png` returns a 1200×675 PNG with no name row.
- `/memes/<a roster meme file>.png` returns 200.
- `https://ccip.dev/marines/1/` returns a 301 to `/marines/0001/`, and that page returns the 404 page until Task 10 ships the template. That's expected.

From here on, Tasks 8–10 can check their pages locally against the real production roster, memes and web cards.

---

### Task 7: Site data plumbing: a general poll loop, the roster loader and the view helpers

**Files:**
- Modify: `site/src/lib/poller.ts`
- Create: `site/src/lib/roster.ts`
- Modify: `site/src/lib/marines.ts` (append the view helpers)
- Create: `site/src/components/marines/use-roster.ts`
- Test: `site/test/poller.test.ts` (append), `site/test/roster.test.ts` (new), `site/test/marines.test.ts` (append)

**Interfaces:**
- **Consumes:** `ROSTER_SCHEMA` and `RosterFile` from `@ccip-dev/core/roster`; `ROSTER_URL` (Task 6); `seededRandom`, `filledPips` and `Tier` from core.
- **Produces:**
  - `poller.ts`: `LoopOptions<T>` and `startLoop<T>(opts): () => void`. `startPoller` keeps its signature.
  - `roster.ts`: `ROSTER_POLL_MS = 60_000`, `fetchRoster(url?, fetchFn?)` and `rosterSource(location)`.
  - `marines.ts`:
    - `tierName(tier)`, `enlistedText(day)`, `pipText(count)`;
    - `rarestBarPct(score, low, high)`, `shareLine(marine)`;
    - `TICKER_SECONDS_PER_ITEM = 5`;
    - `PlanetFrame`, `WIDE_FRAME`, `NARROW_FRAME`, `PLANET_LABEL_H = 18`, `planetLayout(carriers, frame)`.
  - `use-roster.ts`: `RosterState { roster: RosterFile | null; failed: boolean }` and `useRoster(): RosterState`.

- [ ] **Step 1: Write the failing tests**

Append to `site/test/poller.test.ts`. Follow the file's existing fake-timer setup (its `beforeEach` and `afterEach`), and add `startLoop` to its import from `../src/lib/poller`:

```ts
describe('startLoop', () => {
  it('loads at once, then after each delay, handing failures their count', async () => {
    // #given a load that fails once, then succeeds
    const seen: string[] = [];
    let calls = 0;
    const stop = startLoop({
      load: async () => {
        calls += 1;
        if (calls === 1) throw new Error('down');
        return calls;
      },
      onData: (n) => void seen.push(`data ${n}`),
      onError: (_err, failures) => void seen.push(`error ${failures}`),
      delayMs: () => 60_000,
      visibility: { isVisible: () => true, onChange: () => () => {} },
    });
    // #when
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    // #then
    expect(seen).toEqual(['error 1', 'data 2']);
  });
});
```

Create `site/test/roster.test.ts`:

```ts
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { ROSTER_URL } from '../src/config';
import { fetchRoster, rosterSource } from '../src/lib/roster';

const answering = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('fetchRoster', () => {
  it('returns a valid roster', async () => {
    // #then
    expect((await fetchRoster(ROSTER_URL, answering(ROSTER_FIXTURE))).marines.length).toBe(4);
  });

  it('refuses a roster carrying a field beyond the allowlist', async () => {
    // #given a Marine with a leaked name
    const leaked = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0], displayName: 'x' }] };
    // #then
    await expect(fetchRoster(ROSTER_URL, answering(leaked))).rejects.toThrow('roster.json: unexpected shape at marines.0');
  });

  it('fails on an HTTP error', async () => {
    // #then
    await expect(fetchRoster(ROSTER_URL, answering({ error: 'roster unavailable' }, 503))).rejects.toThrow('roster.json: HTTP 503');
  });
});

describe('rosterSource', () => {
  it('honours ?roster= on localhost only, for a visual check', () => {
    // #then
    expect([
      rosterSource({ hostname: 'localhost', search: '?roster=http://localhost:4322/roster.json' }),
      rosterSource({ hostname: '127.0.0.1', search: '' }),
      rosterSource({ hostname: 'ccip.dev', search: '?roster=https://evil.example/roster.json' }),
    ]).toEqual(['http://localhost:4322/roster.json', ROSTER_URL, ROSTER_URL]);
  });
});
```

Append to `site/test/marines.test.ts`. Extend its import with `enlistedText, NARROW_FRAME, pipText, planetLayout, PLANET_LABEL_H, rarestBarPct, shareLine, tierName, WIDE_FRAME, type PlanetFrame`, and add `import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';`:

```ts
describe('wording', () => {
  it('names tiers, dates enlistments, draws pips and writes the share line', () => {
    // #then
    expect([tierName('legendary'), enlistedText('2026-10-13'), pipText(1), pipText(5), pipText(400), shareLine(ROSTER_FIXTURE.marines[1]!)]).toEqual([
      'Legendary',
      '13 Oct 2026',
      '◆◆◆',
      '◆◆◇',
      '◇◇◇',
      'LINK MARINE #0002 · painting-space-prophecy · LEGENDARY',
    ]);
  });

  it('runs a rarest-ten bar from 20% at the roster’s lowest score to 100% at its highest', () => {
    // #then
    expect([rarestBarPct(14.2, 14.2, 18.74), rarestBarPct(18.74, 14.2, 18.74), rarestBarPct(16.47, 14.2, 18.74), rarestBarPct(15, 15, 15)]).toEqual([20, 100, 60, 100]);
  });
});

describe('the constellation layout', () => {
  /** A planet's box: its hexagon (size × 1.12) and its label below. */
  const box = (p: { x: number; y: number; size: number }) => ({ left: p.x - p.size / 2, right: p.x + p.size / 2, top: p.y - p.size * 0.56, bottom: p.y + p.size * 0.56 + PLANET_LABEL_H });
  const overlaps = (ps: { x: number; y: number; size: number }[]) =>
    ps.flatMap((p, i) => ps.slice(i + 1).map((q) => [box(p), box(q)])).filter(([a, b]) => a!.left < b!.right && b!.left < a!.right && a!.top < b!.bottom && b!.top < a!.bottom).length;
  const outside = (ps: { x: number; y: number; size: number }[], f: PlanetFrame) => ps.map(box).filter((b) => b.left < 0 || b.top < 0 || b.right > f.width || b.bottom > f.height).length;

  it('never overlaps two planets or leaves the frame, wide or narrow, however the carriers fall', () => {
    // #given
    const cases = [Array(24).fill(3), Array.from({ length: 24 }, (_, i) => 30 - i), [1]];
    // #when
    const wide = cases.map((c) => planetLayout(c, WIDE_FRAME));
    const narrow = cases.map((c) => planetLayout(c.slice(0, 12), NARROW_FRAME));
    // #then
    expect([...wide.map((p) => [overlaps(p), outside(p, WIDE_FRAME)]), ...narrow.map((p) => [overlaps(p), outside(p, NARROW_FRAME)])]).toEqual(Array(6).fill([0, 0]));
  });

  it('lays the same carriers out the same way every time, the busiest planet biggest and nearest the middle', () => {
    // #when
    const [a, b] = [planetLayout([9, 3, 1], WIDE_FRAME), planetLayout([9, 3, 1], WIDE_FRAME)];
    // #then
    expect({ same: a, biggest: a[0]!.size, central: Math.abs(a[0]!.x - WIDE_FRAME.width / 2) < WIDE_FRAME.width / WIDE_FRAME.cols }).toEqual({ same: b, biggest: WIDE_FRAME.max, central: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/poller.test.ts test/roster.test.ts test/marines.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 3: The general loop**

In `site/src/lib/poller.ts`, insert the following above `startPoller`, then replace `startPoller`'s body as shown. The removed body moves into `startLoop` with `load`, `delayMs` and a plain `onError`:

```ts
export interface LoopOptions<T> {
  load: () => Promise<T>;
  onData: (data: T) => void;
  onError: (error: unknown, failures: number) => void;
  /** How long to wait before the next load, given the failures in a row. */
  delayMs: (failures: number) => number;
  visibility?: Visibility;
}

/** Loads at once and then after each delay, only while the page is visible, at once again when it reappears; returns stop. */
export function startLoop<T>(opts: LoopOptions<T>): () => void {
  const visibility = opts.visibility ?? documentVisibility;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (stopped || !visibility.isVisible()) return;
    clear();
    timer = setTimeout(() => void tick(), opts.delayMs(failures));
  };
  const tick = async () => {
    timer = null;
    if (stopped || inFlight || !visibility.isVisible()) return;
    inFlight = true;
    try {
      const data = await opts.load();
      failures = 0;
      if (!stopped) opts.onData(data);
    } catch (err) {
      failures += 1;
      if (!stopped) opts.onError(err, failures);
    } finally {
      inFlight = false;
      schedule();
    }
  };

  const unsubscribe = visibility.onChange(() => {
    if (stopped) return;
    clear();
    if (visibility.isVisible()) void tick();
  });
  void tick();

  return () => {
    stopped = true;
    unsubscribe();
    clear();
  };
}

export function startPoller<N extends PublicFileName>(opts: PollerOptions<N>): () => void {
  return startLoop({
    load: () => fetchPublic(opts.name, { fetch: opts.fetch, base: opts.base }),
    onData: opts.onData,
    onError: (err, failures) => opts.onError(err instanceof DataError ? err : new DataError(opts.name, String(err)), failures),
    delayMs: pollDelay,
    visibility: opts.visibility,
  });
}
```

- [ ] **Step 4: The roster loader**

Create `site/src/lib/roster.ts`:

```ts
import { ROSTER_SCHEMA, type RosterFile } from '@ccip-dev/core/roster';
import { ROSTER_URL } from '../config';

/** The bot keeps roster.json for a minute, so the page asks no more often. */
export const ROSTER_POLL_MS = 60_000;

export async function fetchRoster(url: string = ROSTER_URL, fetchFn: typeof fetch = fetch): Promise<RosterFile> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`roster.json: HTTP ${res.status}`);
  const parsed = ROSTER_SCHEMA.safeParse(await res.json());
  if (!parsed.success) throw new Error(`roster.json: unexpected shape at ${parsed.error.issues[0]?.path.join('.') || '(root)'}`);
  return parsed.data;
}

/** Where to load the roster from: ?roster=<url> on localhost only, for a visual check before shipping; the bot anywhere else. */
export function rosterSource(location: { hostname: string; search: string }): string {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    const override = new URLSearchParams(location.search).get('roster');
    if (override) return override;
  }
  return ROSTER_URL;
}
```

- [ ] **Step 5: The view helpers**

Append to `site/src/lib/marines.ts`. Extend the core import to `import { filledPips, seededRandom, serialText, type Tier } from '@ccip-dev/core/linkmarine';` and add `import type { RosterMarine } from '@ccip-dev/core/roster';`:

```ts
export const tierName = (tier: Tier) => `${tier[0]!.toUpperCase()}${tier.slice(1)}`;

/** "13 Oct 2026" from "2026-10-13". */
export const enlistedText = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** ◆◆◇: a tag's rarity in three pips, as the card draws it. */
export const pipText = (count: number) => '◆'.repeat(filledPips(count)) + '◇'.repeat(3 - filledPips(count));

/** A rarest-ten bar: 20% at the roster's lowest score, 100% at its highest, to one decimal. */
export function rarestBarPct(score: number, low: number, high: number): number {
  return high === low ? 100 : Math.round((20 + (80 * (score - low)) / (high - low)) * 10) / 10;
}

export const shareLine = (m: Pick<RosterMarine, 'serial' | 'callsign' | 'tier'>) => `${marineTitle(m.serial)} · ${m.callsign} · ${m.tier.toUpperCase()}`;

/** The ticker crawls about 60 px a second; an item runs about 300 px. */
export const TICKER_SECONDS_PER_ITEM = 5;

export interface PlanetFrame {
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Planet sizes, in px, for the fewest and the most carriers. */
  min: number;
  max: number;
}

export const WIDE_FRAME: PlanetFrame = { cols: 8, rows: 3, width: 1120, height: 420, min: 34, max: 80 };
export const NARROW_FRAME: PlanetFrame = { cols: 3, rows: 4, width: 360, height: 440, min: 26, max: 52 };
/** The room under a planet for its "tag ×N" label. */
export const PLANET_LABEL_H = 18;
const PLANET_SEED = 0x5eed;

/**
 * The constellation: each planet in a cell of its own, busiest nearest the middle, nudged off-centre by a fixed seed.
 * Since a planet and its label stay inside their cell, no two overlap and none leaves the frame. Returns each hexagon's
 * centre in the frame's pixels and its size.
 */
export function planetLayout(carriers: readonly number[], frame: PlanetFrame): { x: number; y: number; size: number }[] {
  const cellW = frame.width / frame.cols;
  const cellH = frame.height / frame.rows;
  const cells = Array.from({ length: frame.cols * frame.rows }, (_, i) => ({ i, cx: ((i % frame.cols) + 0.5) * cellW, cy: (Math.floor(i / frame.cols) + 0.5) * cellH }))
    .map((c) => ({ ...c, d: Math.hypot(c.cx - frame.width / 2, c.cy - frame.height / 2) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const random = seededRandom(PLANET_SEED);
  const top = Math.max(1, ...carriers);
  return carriers.slice(0, cells.length).map((n, i) => {
    const size = frame.min + (n / top) * (frame.max - frame.min);
    const cell = cells[i]!;
    const slackX = (cellW - size) / 2;
    const slackY = (cellH - size * 1.12 - PLANET_LABEL_H) / 2;
    return { x: cell.cx + slackX * 0.9 * (random() * 2 - 1), y: cell.cy - PLANET_LABEL_H / 2 + slackY * 0.9 * (random() * 2 - 1), size };
  });
}
```

- [ ] **Step 6: The hook**

Create `site/src/components/marines/use-roster.ts`:

```ts
import type { RosterFile } from '@ccip-dev/core/roster';
import { useEffect, useState } from 'react';
import { startLoop } from '../../lib/poller';
import { fetchRoster, ROSTER_POLL_MS, rosterSource } from '../../lib/roster';

export interface RosterState {
  /** The last roster loaded; it stays on screen through a failed refresh. */
  roster: RosterFile | null;
  /** The latest load failed. */
  failed: boolean;
}

/** The roster, loaded at once and every minute while the page is visible. */
export function useRoster(): RosterState {
  const [state, setState] = useState<RosterState>({ roster: null, failed: false });
  useEffect(() => {
    const url = rosterSource(window.location);
    return startLoop({
      load: () => fetchRoster(url),
      onData: (roster) => setState({ roster, failed: false }),
      onError: (err) => {
        console.warn(`roster: ${err instanceof Error ? err.message : String(err)}`);
        setState((s) => ({ ...s, failed: true }));
      },
      delayMs: () => ROSTER_POLL_MS,
    });
  }, []);
  return state;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/poller.test.ts test/roster.test.ts test/marines.test.ts`
Expected: PASS, with the existing `startPoller` tests still green.

- [ ] **Step 8: Run the whole suite and the typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add site/src/lib/poller.ts site/src/lib/roster.ts site/src/lib/marines.ts site/src/components/marines/use-roster.ts site/test/poller.test.ts site/test/roster.test.ts site/test/marines.test.ts
git commit -m "feat(site): load the roster every minute, and lay out its constellation with no overlaps

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 8: The roster page, part 1: the page, the hero, the ticker, the census and today's most wanted

**Files:**
- Create: `site/src/pages/marines/index.astro`
- Create: `site/src/styles/marines.css`
- Create: `site/src/components/marines/RosterView.tsx`, `Ticker.tsx`, `Census.tsx`, `MostWanted.tsx`
- Test: `site/test/roster-view.test.ts` (new)

**Interfaces:**
- **Consumes:**
  - core: `tickerItems`, `census`, `tagBoard`, `tagFacts`, `mostWanted`, `callsignsPerTag`, `ALL_MARINES` and `WallQuery`;
  - `serialText`;
  - Task 6/7: `memeUrl`, `TICKER_SECONDS_PER_ITEM` and `useRoster`;
  - `useNow` (`site/src/components/hooks.ts`).
- **Produces:**
  - `RosterView.tsx`: `RosterPage({ roster, failed, now }): JSX`, which is pure and tested, and the default `RosterView`, the island. Its `pickTag(tag)` sets the wall's query and scrolls to `#wall`. Task 9 adds the wall.
  - `Census.tsx`: default `Census({ roster, onPickTag })`.
  - `Ticker.tsx`: default `Ticker({ roster })`.
  - `MostWanted.tsx`: default `MostWanted({ roster, now })`.

- [ ] **Step 1: Write the failing tests**

Create `site/test/roster-view.test.ts`:

```ts
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RosterPage } from '../src/components/marines/RosterView';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const html = (props: Partial<Parameters<typeof RosterPage>[0]> = {}) => renderToString(createElement(RosterPage, { roster: ROSTER_FIXTURE, failed: false, now: NOW, ...props }));
/** The page's text without tags or React's comment markers, entities decoded. */
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('the roster page', () => {
  it('counts Marines, Legendaries and tags drawn out of the snapshot', () => {
    // #then
    expect(text(html())).toContain('Marines 4 Legendary 1 Tags drawn 6 /8');
  });

  it('crawls the ticker twice, the repeat hidden from screen readers', () => {
    // #when
    const out = html();
    // #then
    expect({ label: out.includes('LIVE · ROSTER'), runs: out.match(/class="mr-ticker-run"/g)?.length, hidden: /<ul[^>]*aria-hidden="true"/.test(out), sighting: text(out).includes('FIRST SIGHTING “painting” about 1 in 7 · discovered by #0002') }).toEqual({ label: true, runs: 1, hidden: true, sighting: true });
  });

  it('bars each tier against its odds', () => {
    // #then
    expect(text(html())).toContain('LEGENDARY 1 · 25% / 3 RARE 1 · 25% / 12 UNCOMMON 1 · 25% / 25 COMMON 1 · 25% / 60');
  });

  it('lights one hexagon per drawn tag on the board, gold for one-meme tags', () => {
    // #when
    const out = html();
    // #then
    expect({ hexes: out.match(/class="mr-hex[ "]/g)?.length, lit: out.match(/class="mr-hex mr-on/g)?.length, label: text(out).includes('TAGS DRAWN · 6 OF 8') }).toEqual({ hexes: 8, lit: 6, label: true });
  });

  it('posts today’s most wanted with their odds and the reward', () => {
    // #then
    expect(text(html())).toContain('2 tags are still undrawn, 2 of them one-of-a-kind.');
    expect(text(html())).toMatch(/WANTED zoomer ABOUT 1 IN 7 CALLSIGNS ONE MEME IN THE ARCHIVE REWARD · DISCOVERER CREDIT/);
  });

  it('says the board is full when every tag is drawn', () => {
    // #given every tag drawn
    const full = { ...ROSTER_FIXTURE, snapshot: { ...ROSTER_FIXTURE.snapshot, tags: ROSTER_FIXTURE.snapshot.tags.filter((t) => t.tag !== 'zoomer' && t.tag !== 'samurai') } };
    // #then
    expect(text(html({ roster: full }))).toContain('Every tag has been drawn. The board is full.');
  });

  it('shows loading, then the out-of-reach state, before any roster arrives', () => {
    // #then
    expect([text(html({ roster: null })).includes('Loading the roster'), text(html({ roster: null, failed: true })).includes('The roster is out of reach right now. Retrying…')]).toEqual([true, true]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/roster-view.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: The components**

Create `site/src/components/marines/Ticker.tsx`:

```tsx
import { serialText } from '@ccip-dev/core/linkmarine';
import { tickerItems, type RosterFile, type TickerItem } from '@ccip-dev/core/roster';
import { TICKER_SECONDS_PER_ITEM } from '../../lib/marines';

function Item({ item }: { item: TickerItem }) {
  switch (item.kind) {
    case 'legendary':
      return (
        <li className="mr-tk">
          <span className="mr-tk-k mr-tk-gold">★ LEGENDARY DRAWN</span>
          <span className="mr-c-legendary">{item.callsign}</span>
          <small>#{serialText(item.serial)} · rarer than {item.rarerThan}% of draws</small>
        </li>
      );
    case 'recruit':
      return (
        <li className="mr-tk">
          <span className="mr-tk-k">NEW RECRUIT</span>
          <span className={`mr-c-${item.tier}`}>{item.callsign}</span>
          <small>#{serialText(item.serial)} · {item.tier.toUpperCase()}</small>
        </li>
      );
    case 'sighting':
      return (
        <li className="mr-tk">
          <span className="mr-tk-k mr-tk-hot">FIRST SIGHTING</span>“{item.tag}”
          <small>about 1 in {item.oneIn.toLocaleString('en-US')} · discovered by #{serialText(item.serial)}</small>
        </li>
      );
    case 'stat':
      return (
        <li className="mr-tk">
          <span className="mr-tk-k">{item.label}</span>
          {item.value}
        </li>
      );
  }
}

/** The news-style crawl: the content twice in one strip that slides by half its width, the repeat hidden from screen readers. */
export default function Ticker({ roster }: { roster: RosterFile }) {
  const items = tickerItems(roster);
  const run = items.map((item, i) => <Item key={i} item={item} />);
  return (
    <section className="mr-ticker" aria-label="Latest on the roster">
      <div className="mr-ticker-label" aria-hidden="true">
        <span className="mr-dot" />
        LIVE · ROSTER
      </div>
      <div className="mr-ticker-lane" tabIndex={0}>
        <div className="mr-ticker-run" style={{ animationDuration: `${items.length * TICKER_SECONDS_PER_ITEM}s` }}>
          <ul>{run}</ul>
          <ul aria-hidden="true">{run}</ul>
        </div>
      </div>
    </section>
  );
}
```

Create `site/src/components/marines/Census.tsx`:

```tsx
import { serialText } from '@ccip-dev/core/linkmarine';
import { callsignsPerTag, census, tagBoard, type BoardTag, type RosterFile, type TierCount } from '@ccip-dev/core/roster';
import { useState } from 'react';

function TierBar({ tier, count, sharePct, expectedPct }: TierCount) {
  return (
    <div className="mr-bar">
      <span className={`mr-c-${tier}`}>{tier.toUpperCase()}</span>
      <span className="mr-track" aria-hidden="true">
        <span className={`mr-fill mr-metal-${tier}`} style={{ width: `${sharePct}%` }} />
        <span className="mr-expected" style={{ left: `${expectedPct}%` }} />
      </span>
      <span className="mr-n">
        {count} · {Math.round(sharePct)}% <small>/ {expectedPct}</small>
      </span>
    </div>
  );
}

function BoardTip({ tag: t, x, y }: { tag: BoardTag; x: number; y: number }) {
  return (
    <div className="mr-tip" style={{ left: x + 14, top: y + 14 }} aria-hidden="true">
      <b>{t.tag}</b>
      <br />
      {t.count} {t.count === 1 ? 'meme' : 'memes'} · about 1 in {callsignsPerTag(t.chance).toLocaleString('en-US')} callsigns
      <br />
      {t.discoverer ? (
        <>
          first drawn by <span className="mr-tip-gold">#{serialText(t.discoverer.serial)} {t.discoverer.callsign}</span>
          <br />
          carried by {t.carriers} {t.carriers === 1 ? 'Marine' : 'Marines'}
        </>
      ) : (
        <span className="mr-tip-hot">UNDRAWN · nobody carries it yet</span>
      )}
    </div>
  );
}

/** The tier bars against the odds, and the board of every tag: a mouse enhancement, its facts also reachable by the wall's search. */
export default function Census({ roster, onPickTag }: { roster: RosterFile; onPickTag: (tag: string) => void }) {
  const [tip, setTip] = useState<{ tag: BoardTag; x: number; y: number } | null>(null);
  const board = tagBoard(roster);
  const drawn = board.filter((t) => t.discoverer !== null).length;
  return (
    <section className="mr-section" aria-labelledby="census-title">
      <p className="mr-eyebrow">census</p>
      <h2 id="census-title">How the draws are landing.</h2>
      <div className="mr-census">
        <div>
          {census(roster.marines).map((t) => (
            <TierBar key={t.tier} {...t} />
          ))}
          <p className="mr-note">The bar is how many Marines drew the tier. The white tick is the odds.</p>
        </div>
        <div>
          <p className="mr-label">
            TAGS DRAWN · {drawn} OF {board.length}
          </p>
          <div className="mr-board" aria-hidden="true" onMouseLeave={() => setTip(null)}>
            {board.map((t) => (
              <i
                key={t.tag}
                className={`mr-hex${t.discoverer ? ' mr-on' : ''}${t.count === 1 ? ' mr-one' : ''}`}
                onMouseMove={(e) => setTip({ tag: t, x: e.clientX, y: e.clientY })}
                onClick={t.discoverer ? () => onPickTag(t.tag) : undefined}
              />
            ))}
          </div>
          {tip && <BoardTip {...tip} />}
          <p className="mr-note">Every hexagon is one of the {board.length} tags, commonest first. Lit ones have been drawn; gold ones exist in only one meme. Hover one to see who drew it first.</p>
        </div>
      </div>
    </section>
  );
}
```

Create `site/src/components/marines/MostWanted.tsx`:

```tsx
import { callsignsPerTag, mostWanted, tagBoard, type RosterFile } from '@ccip-dev/core/roster';
import type { CSSProperties } from 'react';
import { memeUrl } from '../../lib/marines';

const TILTS = [-2.5, 1.5, -1, 2.2, -1.8];

/** Five WANTED posters of the rarest undrawn tags, the same five for everyone until 00:00 UTC. */
export default function MostWanted({ roster, now }: { roster: RosterFile; now: Date }) {
  const posters = mostWanted(roster, now);
  const undrawn = tagBoard(roster).filter((t) => t.discoverer === null);
  return (
    <section className="mr-section" aria-labelledby="wanted-title">
      <h2 id="wanted-title" className="mr-h3">
        Today’s most wanted
      </h2>
      {posters.length === 0 ? (
        <p className="mr-note">Every tag has been drawn. The board is full.</p>
      ) : (
        <>
          <p className="mr-note">
            {undrawn.length} tags are still undrawn, {undrawn.filter((t) => t.count === 1).length} of them one-of-a-kind. Five new posters every day at 00:00 UTC. Draw one first and you’re its discoverer, on the board for good.
          </p>
          <ul className="mr-posters">
            {posters.map((t, i) => (
              <li key={t.tag} className="mr-poster" style={{ '--tilt': `${TILTS[i]}deg` } as CSSProperties}>
                <p className="mr-poster-head">WANTED</p>
                <img src={memeUrl(t.meme)} alt={`The ${t.tag} meme`} width={200} height={200} loading="lazy" />
                <p className="mr-poster-name">{t.tag}</p>
                <p className="mr-poster-odds">
                  ABOUT 1 IN {callsignsPerTag(t.chance).toLocaleString('en-US')} CALLSIGNS
                  <br />
                  {t.count === 1 ? 'ONE MEME' : `${t.count} MEMES`} IN THE ARCHIVE
                </p>
                <p className="mr-poster-reward">REWARD · DISCOVERER CREDIT</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

Create `site/src/components/marines/RosterView.tsx`:

```tsx
import { tagFacts, ALL_MARINES, type RosterFile, type WallQuery } from '@ccip-dev/core/roster';
import { useState } from 'react';
import { useNow } from '../hooks';
import Census from './Census';
import MostWanted from './MostWanted';
import Ticker from './Ticker';
import { useRoster } from './use-roster';

function Hero({ roster }: { roster: RosterFile | null }) {
  const dash = '—';
  return (
    <header className="mr-hero">
      <div>
        <p className="mr-eyebrow">LinkMarines</p>
        <h1>
          The <span className="mr-gold-text">Roster</span>.
        </h1>
        <p className="mr-lead">
          Every Marine who has enlisted with the ccip.dev bot, by callsign. One draw each, stamped forever. Enlist in any server with <code>/enlist</code>.
        </p>
      </div>
      <dl className="mr-stats">
        <div>
          <dt>Marines</dt>
          <dd>{roster ? roster.marines.length : dash}</dd>
        </div>
        <div>
          <dt>Legendary</dt>
          <dd className="mr-c-legendary">{roster ? roster.marines.filter((m) => m.tier === 'legendary').length : dash}</dd>
        </div>
        <div>
          <dt>Tags drawn</dt>
          <dd>
            {roster ? tagFacts(roster.marines).size : dash}
            <span>/{roster ? roster.snapshot.tags.length : dash}</span>
          </dd>
        </div>
      </dl>
    </header>
  );
}

/** The roster page's sections, from the roster as loaded: pure, so it renders on the server for tests and as the loading shell. */
export function RosterPage({ roster, failed, now }: { roster: RosterFile | null; failed: boolean; now: Date }) {
  const [, setQuery] = useState<WallQuery>(ALL_MARINES);
  const pickTag = (tag: string) => {
    setQuery({ ...ALL_MARINES, tag });
    document.getElementById('wall')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (roster === null) {
    return (
      <>
        <Hero roster={null} />
        {failed ? (
          <p className="mr-state" role="status">
            The roster is out of reach right now. Retrying…
          </p>
        ) : (
          <p className="mr-state" aria-busy="true">
            Loading the roster…
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <Hero roster={roster} />
      <Ticker roster={roster} />
      <Census roster={roster} onPickTag={pickTag} />
      <MostWanted roster={roster} now={now} />
    </>
  );
}

export default function RosterView() {
  const { roster, failed } = useRoster();
  const now = useNow(60_000);
  return <RosterPage roster={roster} failed={failed} now={now ?? new Date()} />;
}
```

(Task 9 changes `const [, setQuery]` to `const [query, setQuery]` when it adds the wall.)

- [ ] **Step 4: The page and its styles**

Create `site/src/pages/marines/index.astro`:

```astro
---
import RosterView from '../../components/marines/RosterView';
import Base from '../../layouts/Base.astro';
import '../../styles/marines.css';
---
<Base title="LinkMarines" description="Every LinkMarine who has enlisted with the ccip.dev bot, by callsign: the dog tags, the rarest draws and the tags still undrawn.">
  <div class="mr-page">
    <RosterView client:load />
  </div>
</Base>
```

Create `site/src/styles/marines.css`. It's ported from the mockup's `<style>`, prefixed and on the site's tokens:

```css
/* The LinkMarines roster: /marines/ and /marines/<serial>/. Ported from docs/superpowers/specs/2026-10-13-linkmarines-roster-mockups/roster.html. */
.mr-page { --hex: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
.mr-metal-common { background: linear-gradient(135deg, #4a5260, #c9d1dc 28%, #f4f7fb 40%, #8e98a6 62%, #5b6472); }
.mr-metal-uncommon { background: radial-gradient(circle at 80% 28%, #4fae8c55 0 5%, transparent 11%), linear-gradient(135deg, #5a3416, #c98a4b 30%, #f0c08a 42%, #9a5f2c 64%, #4e2c12); }
.mr-metal-rare { background: linear-gradient(120deg, #2b3a8f, #4f7cff 22%, #b07cff 42%, #ffd27a 58%, #4fd1c5 76%, #2b3a8f); }
.mr-metal-legendary { background: linear-gradient(135deg, #6e4a0c, #f5c451 20%, #fff6cf 36%, #c8901e 54%, #f7dc85 72%, #7d570f); }
.mr-c-common { color: #c9d1dc; } .mr-c-uncommon { color: #5fe0a4; } .mr-c-rare { color: #8fb0ff; } .mr-c-legendary { color: var(--gold); }
.mr-gold-text { background: linear-gradient(180deg, #fff6cf, #f5c451 50%, #b07a12); -webkit-background-clip: text; background-clip: text; color: transparent; }

.mr-eyebrow { font: 700 12px var(--font-mono); letter-spacing: 0.16em; color: var(--blue-2); text-transform: uppercase; margin: 0; }
.mr-section { padding: 40px 0; border-top: 1px solid var(--border-soft); }
.mr-section h2 { font-size: 28px; font-weight: 800; line-height: 1.15; margin: 6px 0 8px; }
.mr-h3 { font-size: 18px !important; }
.mr-lead, .mr-note { color: #aab3c0; max-width: 680px; }
.mr-note { font-size: 13px; }
.mr-label { font: 700 12px var(--font-mono); letter-spacing: 0.1em; color: var(--muted); margin: 0; }
.mr-state { padding: 40px 0; color: var(--muted); font: 600 14px var(--font-mono); }

.mr-hero { padding: 40px 0 28px; display: grid; grid-template-columns: 1.2fr 1fr; gap: 36px; align-items: end; }
.mr-hero h1 { font-size: 56px; font-weight: 800; line-height: 1; letter-spacing: -0.02em; margin: 12px 0 10px; }
.mr-hero code { font-family: var(--font-mono); color: #c9cdfb; }
.mr-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 0; }
.mr-stats div { background: var(--card); border: 1px solid var(--border-soft); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column-reverse; }
.mr-stats dt { color: var(--muted); font: 600 12px var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; }
.mr-stats dd { margin: 0; font-size: 34px; font-weight: 800; line-height: 1; }
.mr-stats dd span { font-size: 16px; color: var(--muted); }

.mr-ticker { display: flex; height: 46px; margin: 0 -20px; background: #090c12; border-block: 1px solid var(--border); overflow: hidden; }
.mr-ticker-label { flex: none; display: flex; align-items: center; gap: 9px; padding: 0 30px 0 22px; background: linear-gradient(90deg, var(--blue), var(--blue-2)); color: #fff; font: 800 12px var(--font-mono); letter-spacing: 0.16em; clip-path: polygon(0 0, 100% 0, calc(100% - 16px) 100%, 0 100%); }
.mr-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff5a5a; box-shadow: 0 0 8px #ff5a5a; animation: mr-blink 1.2s steps(2) infinite; }
@keyframes mr-blink { 50% { opacity: 0.2; } }
.mr-ticker-lane { flex: 1; min-width: 0; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 50px, #000 calc(100% - 50px), transparent); mask-image: linear-gradient(90deg, transparent, #000 50px, #000 calc(100% - 50px), transparent); }
.mr-ticker-run { display: inline-flex; white-space: nowrap; animation: mr-crawl linear infinite; }
.mr-ticker-run ul { display: inline-flex; margin: 0; padding: 0; list-style: none; }
.mr-ticker:hover .mr-ticker-run, .mr-ticker:focus-within .mr-ticker-run { animation-play-state: paused; }
@keyframes mr-crawl { to { transform: translateX(-50%); } }
.mr-tk { display: inline-flex; align-items: center; gap: 9px; font: 700 13px/46px var(--font-mono); }
.mr-tk::after { content: ''; width: 9px; height: 10px; margin: 0 26px; background: var(--blue); clip-path: var(--hex); }
.mr-tk small { color: var(--muted); font-weight: 600; font-size: 13px; }
.mr-tk-k { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: var(--muted); }
.mr-tk-gold { color: var(--gold); } .mr-tk-hot { color: #ff8a5c; }

.mr-census { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 22px; }
.mr-bar { display: grid; grid-template-columns: 110px 1fr 120px; gap: 12px; align-items: center; margin: 10px 0; font: 700 12px var(--font-mono); letter-spacing: 0.1em; }
.mr-track { height: 14px; background: #10141c; border-radius: 7px; position: relative; overflow: hidden; border: 1px solid var(--border-soft); }
.mr-fill { position: absolute; inset: 0 auto 0 0; border-radius: 7px; }
.mr-expected { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #e8eaed88; }
.mr-n { color: var(--muted); text-align: right; }
.mr-board { display: grid; grid-template-columns: repeat(26, 1fr); gap: 3px; margin-top: 14px; }
.mr-hex { aspect-ratio: 1 / 1.15; clip-path: var(--hex); background: #1a2030; cursor: help; }
.mr-hex.mr-one { background: #3a2f12; }
.mr-hex.mr-on { background: var(--blue-2); box-shadow: 0 0 6px var(--blue-2); cursor: pointer; }
.mr-hex.mr-on.mr-one { background: var(--gold); box-shadow: 0 0 6px var(--gold); }
.mr-tip { position: fixed; z-index: 9; pointer-events: none; background: #0f141d; border: 1px solid var(--border); border-radius: 10px; padding: 9px 12px; font: 600 12px/1.5 var(--font-mono); color: #c3cad5; box-shadow: 0 10px 30px #000a; max-width: 300px; }
.mr-tip b { color: var(--fg); font-size: 14px; } .mr-tip-gold { color: var(--gold); } .mr-tip-hot { color: #ff8a5c; }

.mr-posters { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin: 16px 0 0; padding: 0; list-style: none; }
.mr-poster { background: linear-gradient(180deg, #e9dcc0, #d6c39c); color: #3b2a14; border-radius: 6px; padding: 12px 12px 14px; text-align: center; box-shadow: 0 10px 24px #000a, inset 0 0 30px #a0835288; transform: rotate(var(--tilt, 0deg)); transition: transform 0.2s var(--ease); }
.mr-poster:hover { transform: rotate(0) scale(1.04); }
.mr-poster p { margin: 0; }
.mr-poster-head { font-size: 26px; font-weight: 800; line-height: 1; letter-spacing: 0.12em; }
.mr-poster img { display: block; margin: 10px auto 8px; width: 86%; height: auto; aspect-ratio: 1; object-fit: cover; filter: sepia(0.9) contrast(1.15) brightness(0.95); border: 3px solid #3b2a14; }
.mr-poster-name { font: 800 17px var(--font-mono); text-transform: uppercase; overflow-wrap: anywhere; }
.mr-poster-odds { font: 700 10px/1.5 var(--font-mono); letter-spacing: 0.08em; margin-top: 4px !important; }
.mr-poster-reward { margin-top: 8px !important; padding-top: 6px; border-top: 2px dashed #3b2a1466; font: 800 10px var(--font-mono); letter-spacing: 0.12em; }

@media (max-width: 760px) {
  .mr-hero { grid-template-columns: 1fr; }
  .mr-hero h1 { font-size: 40px; }
  .mr-ticker { margin: 0 -16px; }
  .mr-census { grid-template-columns: 1fr; }
  .mr-bar { grid-template-columns: 90px 1fr 100px; }
  .mr-board { grid-template-columns: repeat(20, 1fr); }
  .mr-posters { display: flex; overflow-x: auto; padding-bottom: 12px; }
  .mr-poster { flex: 0 0 170px; }
}
@media (prefers-reduced-motion: reduce) {
  .mr-ticker-run { animation: none; }
  .mr-ticker-lane { overflow-x: auto; }
  .mr-ticker-run ul[aria-hidden='true'] { display: none; }
  .mr-dot { animation: none; }
  .mr-poster { transition: none; }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/roster-view.test.ts`
Expected: PASS. If a `text()` assertion misses only on whitespace between React text nodes, adjust the expected string to what React actually renders. Don't change the component's words.

- [ ] **Step 6: Build and look**

```bash
pnpm --filter @ccip-dev/site build
pnpm --filter @ccip-dev/site exec astro preview --port 4321
```

Open `http://localhost:4321/marines/` at 1280 and 390 px. It loads the production roster, which the checkpoint after Task 6 made live. Compare it with the mockup's hero, ticker, census and posters:
- nothing overflows sideways at 390 px;
- the ticker crawls, and pauses on hover.

Save screenshots to `/private/tmp/claude-501/-Users-rubberduck-GitHub-momentmaker-ccip-dev/19cabbec-cd1e-4fc5-a2ef-ade789a597b9/scratchpad/roster-page/`. If you have no browser tool, say so in the report.

- [ ] **Step 7: Run the whole suite and the typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add site/src/pages/marines/index.astro site/src/styles/marines.css site/src/components/marines/RosterView.tsx site/src/components/marines/Ticker.tsx site/src/components/marines/Census.tsx site/src/components/marines/MostWanted.tsx site/test/roster-view.test.ts
git commit -m "feat(site): the roster page's hero, live ticker, census board and daily WANTED posters

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 9: The roster page, part 2: rarest ten, plank owners, the wall, the constellation and the call to action

**Files:**
- Create: `site/src/components/marines/RarestTen.tsx`, `PlankOwners.tsx`, `DogTag.tsx`, `Wall.tsx`, `Constellation.tsx`
- Modify: `site/src/components/marines/RosterView.tsx`, `site/src/pages/marines/index.astro`, `site/src/styles/marines.css`
- Test: `site/test/roster-view.test.ts` (append)

**Interfaces:**
- **Consumes:**
  - core: `ranked`, `rarerThan`, `plankSeats`, `wallMarines`, `ALL_MARINES`, `WallQuery`, `constellation` and `serialText`;
  - `marines.ts`: `marinePath`, `memeUrl`, `tierName`, `rarestBarPct`, `planetLayout`, `WIDE_FRAME`, `NARROW_FRAME`;
  - `DISCORD_INSTALL_URL` and `DISCORD_PATH`.
- **Produces:**
  - `DogTag({ marine, big?, flip? })`, which Task 10 reuses as the card image's fallback;
  - `WALL_PAGE = 60`, exported from `Wall.tsx`.

- [ ] **Step 1: Write the failing tests**

Append to `site/test/roster-view.test.ts`:

```ts
describe('the roster page, part 2', () => {
  it('ranks the rarest ten by score, each linking to the Marine', () => {
    // #when
    const out = html();
    // #then
    expect([...out.matchAll(/class="mr-rarest-row" href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/marines/0002/', '/marines/0004/', '/marines/0003/', '/marines/0001/']);
  });

  it('seats the first four plank owners and leaves 96 seats open', () => {
    // #when
    const out = html();
    // #then
    expect({ taken: out.match(/class="mr-seat mr-metal-/g)?.length, open: out.match(/class="mr-seat"/g)?.length }).toEqual({ taken: 4, open: 96 });
  });

  it('hangs every Marine on the wall by rarity, each a labelled link to its page', () => {
    // #when
    const out = html();
    // #then
    expect([...out.matchAll(/class="mr-wall-link" href="([^"]+)" aria-label="([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['/marines/0002/', 'LINK MARINE #0002, painting-space-prophecy, Legendary'],
      ['/marines/0004/', 'LINK MARINE #0004, comfy-painting-sergey, Rare'],
      ['/marines/0003/', 'LINK MARINE #0003, pepe-sergey-prophecy, Uncommon'],
      ['/marines/0001/', 'LINK MARINE #0001, sergey-pepe-comfy, Common'],
    ]);
  });

  it('loads no meme on a tag’s back until it first flips', () => {
    // #then the wall has no meme images; only the posters and planets do
    expect(html().match(/<li><a class="mr-wall-link"[\s\S]*?<\/a><\/li>/g)?.some((li) => li.includes('<img'))).toBe(false);
  });

  it('draws a planet per carried tag, in both the wide and the narrow sky', () => {
    // #when
    const out = html();
    // #then six tags are carried: six wide planets, and the same six narrow (up to twelve)
    expect(out.match(/class="mr-planet"/g)?.length).toBe(12);
  });

  it('says there are no Marines yet on an empty roster, and hides the rarest ten and the sky', () => {
    // #when
    const out = text(html({ roster: { ...ROSTER_FIXTURE, marines: [] } }));
    // #then
    expect([out.includes('No Marines yet. Be #0001: /enlist'), out.includes('The hardest draws in the corps.'), out.includes('The meme constellation.')]).toEqual([true, false, false]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/roster-view.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: The components**

Create `site/src/components/marines/DogTag.tsx`:

```tsx
import { serialText } from '@ccip-dev/core/linkmarine';
import type { RosterMarine } from '@ccip-dev/core/roster';
import { useState } from 'react';
import { memeUrl } from '../../lib/marines';

/**
 * A Marine's dog tag in its tier's metal: the three tags embossed on the front, and the three memes etched on the back.
 * The back loads its memes only once it is first shown (hover or focus), so the wall stays light. `flip={false}` draws the front alone.
 */
export default function DogTag({ marine, big = false, flip = true }: { marine: RosterMarine; big?: boolean; flip?: boolean }) {
  const [shown, setShown] = useState(false);
  const reveal = () => setShown(true);
  return (
    <div className={`mr-slot mr-${marine.tier}${big ? ' mr-big' : ''}`} onMouseEnter={reveal} onFocus={reveal}>
      <div className="mr-tag">
        <div className={`mr-face mr-front mr-metal-${marine.tier}`}>
          <span className="mr-hole" />
          {marine.tags.map((t) => (
            <span key={t} className="mr-emb">
              {t}
            </span>
          ))}
          <span className="mr-ser">LM {serialText(marine.serial)}</span>
        </div>
        {flip && (
          <div className={`mr-face mr-back mr-metal-${marine.tier}`}>
            <span className="mr-hole" />
            {shown && marine.memes.map((m) => <img key={m.tag} src={memeUrl(m.file)} alt="" width={44} height={50} />)}
          </div>
        )}
      </div>
    </div>
  );
}
```

Create `site/src/components/marines/Wall.tsx`:

```tsx
import { serialText, type Tier } from '@ccip-dev/core/linkmarine';
import { wallMarines, type RosterFile, type WallQuery } from '@ccip-dev/core/roster';
import { useState } from 'react';
import { marinePath, tierName } from '../../lib/marines';
import DogTag from './DogTag';

export const WALL_PAGE = 60;

const PILLS: { label: string; tier: Tier | null; order: WallQuery['order'] }[] = [
  { label: 'ALL', tier: null, order: 'rarity' },
  { label: 'LEGENDARY', tier: 'legendary', order: 'rarity' },
  { label: 'RARE', tier: 'rare', order: 'rarity' },
  { label: 'UNCOMMON', tier: 'uncommon', order: 'rarity' },
  { label: 'COMMON', tier: 'common', order: 'rarity' },
  { label: 'NEWEST', tier: null, order: 'newest' },
];

export default function Wall({ roster, query, onQuery }: { roster: RosterFile; query: WallQuery; onQuery: (q: WallQuery) => void }) {
  const [shown, setShown] = useState(WALL_PAGE);
  const marines = wallMarines(roster.marines, query);
  const set = (q: WallQuery) => {
    onQuery(q);
    setShown(WALL_PAGE);
  };
  return (
    <section id="wall" className="mr-section" aria-labelledby="wall-title">
      <p className="mr-eyebrow">the wall</p>
      <h2 id="wall-title">Every dog tag.</h2>
      <div className="mr-toolbar">
        <label className="mr-search">
          <span className="visually-hidden">Search the roster</span>
          <input type="search" value={query.text} placeholder="Search a callsign, a tag or a serial: sergey, comfy, #7…" onChange={(e) => set({ ...query, text: e.target.value })} />
        </label>
        <div className="mr-pills" role="group" aria-label="Filter the wall">
          {PILLS.map((p) => (
            <button key={p.label} type="button" className="mr-pill" aria-pressed={p.tier === query.tier && p.order === query.order} onClick={() => set({ ...query, tier: p.tier, order: p.order })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {query.tag !== null && (
        <p className="mr-filter" role="status">
          {marines.length} {marines.length === 1 ? 'Marine carries' : 'Marines carry'} “{query.tag}” ·{' '}
          <button type="button" onClick={() => set({ ...query, tag: null })}>
            clear
          </button>
        </p>
      )}
      {roster.marines.length === 0 ? (
        <p className="mr-empty">
          No Marines yet. Be #0001: <code>/enlist</code>
        </p>
      ) : marines.length === 0 ? (
        <p className="mr-empty">No Marine matches that.</p>
      ) : null}
      <ul className="mr-wall">
        {marines.slice(0, shown).map((m) => (
          <li key={m.serial}>
            <a className="mr-wall-link" href={marinePath(m.serial)} aria-label={`LINK MARINE #${serialText(m.serial)}, ${m.callsign}, ${tierName(m.tier)}`}>
              <DogTag marine={m} />
              <span className="mr-meta" aria-hidden="true">
                <span className={`mr-c-${m.tier}`}>{m.tier.toUpperCase()}</span>
                <span>#{serialText(m.serial)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {marines.length > shown && (
        <button type="button" className="mr-more" onClick={() => setShown(shown + WALL_PAGE)}>
          Show more
        </button>
      )}
    </section>
  );
}
```

Create `site/src/components/marines/RarestTen.tsx`:

```tsx
import { rarerThan, serialText } from '@ccip-dev/core/linkmarine';
import { ranked, type RosterFile } from '@ccip-dev/core/roster';
import { marinePath, rarestBarPct } from '../../lib/marines';

export default function RarestTen({ roster }: { roster: RosterFile }) {
  if (roster.marines.length === 0) return null;
  const all = ranked(roster.marines);
  const high = all[0]!.score;
  const low = all[all.length - 1]!.score;
  return (
    <section className="mr-section" aria-labelledby="rarest-title">
      <p className="mr-eyebrow">rarest ten</p>
      <h2 id="rarest-title">The hardest draws in the corps.</h2>
      <p className="mr-lead">Ranked by the callsign’s exact score, so two Legendaries still have an order. Every Marine’s page shows their rank.</p>
      <ol className="mr-rarest">
        {all.slice(0, 10).map((m, i) => (
          <li key={m.serial}>
            <a className="mr-rarest-row" href={marinePath(m.serial)}>
              <span className="mr-rank">{i + 1}</span>
              <span className="mr-callsign">
                {m.callsign} <small>#{serialText(m.serial)}</small>
              </span>
              <span className={`mr-tierword mr-c-${m.tier}`}>{m.tier.toUpperCase()}</span>
              <span className="mr-score" aria-hidden="true">
                <i className={`mr-metal-${m.tier}`} style={{ width: `${rarestBarPct(m.score, low, high)}%` }} />
              </span>
              <span className="mr-odds">rarer than {rarerThan(m.percentile)}%</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

Create `site/src/components/marines/PlankOwners.tsx`:

```tsx
import { serialText } from '@ccip-dev/core/linkmarine';
import { plankSeats, type RosterFile } from '@ccip-dev/core/roster';
import { marinePath } from '../../lib/marines';

export default function PlankOwners({ roster }: { roster: RosterFile }) {
  const seats = plankSeats(roster.marines);
  return (
    <section className="mr-section" aria-labelledby="plank-title">
      <p className="mr-eyebrow">plank owners</p>
      <h2 id="plank-title">The first hundred.</h2>
      <p className="mr-lead">
        Navy and Marine tradition calls a ship’s original crew its plank owners. The first 100 to enlist hold those seats for good.
        {seats.every((s) => s !== null) ? ' All 100 seats are taken.' : ''}
      </p>
      <ol className="mr-seats">
        {seats.map((m, i) => (
          <li key={i}>
            {m ? (
              <a className={`mr-seat mr-metal-${m.tier}`} href={marinePath(m.serial)} title={m.callsign}>
                <span className="visually-hidden">LINK MARINE #{serialText(m.serial)}, {m.callsign}: seat </span>
                {i + 1}
              </a>
            ) : (
              <span className="mr-seat">{i + 1}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

Create `site/src/components/marines/Constellation.tsx`:

```tsx
import { constellation, type Planet, type RosterFile } from '@ccip-dev/core/roster';
import { memeUrl, NARROW_FRAME, planetLayout, WIDE_FRAME, type PlanetFrame } from '../../lib/marines';

function Sky({ planets, frame, className, onPickTag }: { planets: Planet[]; frame: PlanetFrame; className: string; onPickTag: (tag: string) => void }) {
  const spots = planetLayout(planets.map((p) => p.carriers), frame);
  return (
    <div className={`mr-stars ${className}`} style={{ height: frame.height }}>
      {spots.map((s, i) => {
        const p = planets[i]!;
        return (
          <button
            key={p.tag}
            type="button"
            className="mr-planet"
            style={{ left: `${(s.x / frame.width) * 100}%`, top: `${((s.y - s.size * 0.56) / frame.height) * 100}%` }}
            onClick={() => onPickTag(p.tag)}
            aria-label={`${p.tag}, carried by ${p.carriers}: show them on the wall`}
          >
            <span className={`mr-planet-hex${p.oneMeme ? ' mr-glow-gold' : ''}`} style={{ width: s.size, height: s.size * 1.12, backgroundImage: `url(${memeUrl(p.meme)})` }} />
            <span className="mr-planet-label" aria-hidden="true">
              {p.tag} <small>×{p.carriers}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The most-carried tags as hexagon planets; a wide sky above 900 px, a narrow one of twelve below. */
export default function Constellation({ roster, onPickTag }: { roster: RosterFile; onPickTag: (tag: string) => void }) {
  const planets = constellation(roster);
  if (planets.length === 0) return null;
  return (
    <section className="mr-section" aria-labelledby="stars-title">
      <p className="mr-eyebrow">tags in the corps</p>
      <h2 id="stars-title">The meme constellation.</h2>
      <p className="mr-lead">Each drawn tag is a planet, sized by how many Marines carry it. Click one to see the Marines who wear it.</p>
      <Sky planets={planets} frame={WIDE_FRAME} className="mr-stars-wide" onPickTag={onPickTag} />
      <Sky planets={planets.slice(0, 12)} frame={NARROW_FRAME} className="mr-stars-narrow" onPickTag={onPickTag} />
    </section>
  );
}
```

- [ ] **Step 4: Wire them into the page**

In `RosterView.tsx`:
- add imports for `Constellation`, `PlankOwners`, `RarestTen` and `Wall`;
- change `const [, setQuery]` to `const [query, setQuery]`;
- after `<MostWanted … />`, add:

```tsx
      <RarestTen roster={roster} />
      <PlankOwners roster={roster} />
      <Wall roster={roster} query={query} onQuery={setQuery} />
      <Constellation roster={roster} onPickTag={pickTag} />
```

In `site/src/pages/marines/index.astro`, import `DISCORD_INSTALL_URL` from `../../config` and `DISCORD_PATH` from `../../lib/socials`. Add the call to action after `<RosterView client:load />`, inside `.mr-page`:

```astro
    <section class="mr-cta" aria-labelledby="cta-title">
      <p class="mr-eyebrow">enlist</p>
      <h2 id="cta-title">Your callsign is waiting.</h2>
      <a class="mr-add" href={DISCORD_INSTALL_URL}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d={DISCORD_PATH} /></svg>
        Add ccip.dev to Discord
      </a>
    </section>
```

- [ ] **Step 5: Styles**

Append to `site/src/styles/marines.css`, before the `@media` blocks, which stay last:

```css
.mr-rarest { margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.mr-rarest-row { display: grid; grid-template-columns: 44px minmax(0, 1.4fr) 110px 1fr 120px; gap: 14px; align-items: center; background: var(--card); border: 1px solid var(--border-soft); border-radius: 12px; padding: 10px 16px; font: 700 14px var(--font-mono); color: var(--fg); text-decoration: none; }
.mr-rarest-row:hover { border-color: var(--border); }
.mr-rank { font-size: 20px; font-weight: 800; color: var(--muted); }
.mr-rarest li:nth-child(1) .mr-rank { color: var(--gold); } .mr-rarest li:nth-child(2) .mr-rank { color: #d7dde6; } .mr-rarest li:nth-child(3) .mr-rank { color: #d08a4b; }
.mr-callsign { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .mr-callsign small { color: var(--muted); }
.mr-tierword { font-size: 11px; letter-spacing: 0.12em; }
.mr-score { height: 8px; background: #10141c; border-radius: 4px; overflow: hidden; } .mr-score i { display: block; height: 100%; border-radius: 4px; }
.mr-odds { color: var(--muted); font-size: 12px; text-align: right; }

.mr-seats { display: grid; grid-template-columns: repeat(25, 1fr); gap: 6px; margin: 18px 0 0; padding: 0; list-style: none; }
.mr-seat { aspect-ratio: 1 / 1.15; clip-path: var(--hex); background: #141925; display: grid; place-items: center; font: 700 9px var(--font-mono); color: #4a5468; text-decoration: none; }
a.mr-seat { color: #0c0f14; }

.mr-toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0 6px; align-items: center; }
.mr-search { flex: 1; min-width: min(240px, 100%); }
.mr-search input { width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 11px 14px; color: var(--fg); font: 500 14px var(--font-mono); }
.mr-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.mr-pill { background: var(--card); border: 1px solid var(--border-soft); border-radius: 999px; padding: 7px 12px; font: 700 11px var(--font-mono); letter-spacing: 0.1em; color: var(--muted); cursor: pointer; }
.mr-pill[aria-pressed='true'] { color: var(--fg); border-color: var(--blue-2); background: #13244d; }
.mr-filter, .mr-empty { font: 600 13px var(--font-mono); color: #c3cad5; }
.mr-filter button { background: none; border: 0; color: var(--blue-2); font: inherit; cursor: pointer; text-decoration: underline; }
.mr-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 26px 18px; margin: 22px 0 0; padding: 0; list-style: none; }
.mr-wall-link { display: block; color: inherit; text-decoration: none; }
.mr-slot { perspective: 900px; padding-top: 22px; position: relative; }
.mr-slot::before { content: ''; position: absolute; top: 0; left: 50%; width: 2px; height: 26px; background: repeating-linear-gradient(180deg, #cfd6e2 0 3px, transparent 3px 6px); transform: translateX(-50%); opacity: 0.55; }
.mr-tag { position: relative; height: 118px; transform-style: preserve-3d; transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.2, 1); }
.mr-wall-link:hover .mr-tag, .mr-wall-link:focus-visible .mr-tag { transform: rotateY(180deg); }
.mr-face { position: absolute; inset: 0; border-radius: 26px; backface-visibility: hidden; box-shadow: 0 12px 26px #000a, inset 0 2px 0 #fff8, inset 0 -3px 0 #0005; padding: 14px 14px 0 40px; overflow: hidden; display: flex; flex-direction: column; }
.mr-face::after { content: ''; position: absolute; inset: 7px; border-radius: 20px; box-shadow: inset 0 0 0 1.5px #0002, inset 1px 1px 0 1.5px #fff4; pointer-events: none; }
.mr-hole { position: absolute; left: 14px; top: 50%; width: 13px; height: 13px; margin-top: -6px; border-radius: 50%; background: #0c0f14; box-shadow: inset 0 2px 3px #000d; }
.mr-emb { font: 800 15px/1.18 var(--font-mono); letter-spacing: 0.03em; text-transform: uppercase; text-shadow: -1px -1px 0 #fff9, 1px 1px 0 #0006; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.mr-ser { font: 800 9.5px var(--font-mono); letter-spacing: 0.12em; margin-top: 6px; opacity: 0.75; }
.mr-common .mr-face { color: #1d222a; } .mr-uncommon .mr-face { color: #2e1808; } .mr-rare .mr-face { color: #10142e; } .mr-legendary .mr-face { color: #3a2706; }
.mr-back { transform: rotateY(180deg); flex-direction: row; gap: 7px; align-items: center; justify-content: center; padding: 0 10px 0 30px; }
.mr-back img { width: 44px; height: 50px; object-fit: cover; clip-path: var(--hex); filter: grayscale(1) contrast(1.6); opacity: 0.85; mix-blend-mode: multiply; }
.mr-legendary .mr-front::before, .mr-rare .mr-front::before { content: ''; position: absolute; inset: -40%; background: linear-gradient(105deg, transparent 40%, #ffffffaa 50%, transparent 60%); animation: mr-glint 3.2s infinite; mix-blend-mode: overlay; }
.mr-rare .mr-front::before { animation-duration: 4.4s; opacity: 0.6; }
@keyframes mr-glint { 0%, 55% { transform: translateX(-60%); } 85%, 100% { transform: translateX(60%); } }
.mr-meta { display: flex; justify-content: space-between; margin-top: 10px; font: 700 10px var(--font-mono); letter-spacing: 0.1em; color: var(--muted); }
.mr-more { display: block; margin: 24px auto 0; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 18px; color: var(--fg); font: 700 13px var(--font-sans); cursor: pointer; }

.mr-stars { position: relative; margin-top: 20px; border-radius: 18px; overflow: hidden; background: radial-gradient(ellipse at 50% 50%, #1b2f66 0%, transparent 60%), #0a0f1e; border: 1px solid var(--border-soft); }
.mr-stars-narrow { display: none; }
.mr-planet { position: absolute; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; background: none; border: 0; padding: 0; cursor: pointer; color: var(--fg); }
.mr-planet-hex { clip-path: var(--hex); background-size: cover; background-position: center; box-shadow: 0 0 18px var(--blue-2); }
.mr-glow-gold { filter: drop-shadow(0 0 8px var(--gold)); }
.mr-planet-label { font: 700 10px var(--font-mono); text-shadow: 0 1px 4px #000; margin-top: 4px; white-space: nowrap; } .mr-planet-label small { color: var(--gold); }

.mr-cta { text-align: center; padding: 50px 0 70px; border-top: 1px solid var(--border-soft); background: radial-gradient(ellipse at 50% 0%, rgba(88, 101, 242, 0.18), transparent 60%); }
.mr-cta h2 { font-size: 30px; font-weight: 800; margin: 6px 0 0; }
.mr-add { display: inline-flex; gap: 10px; align-items: center; margin-top: 16px; padding: 13px 20px; border-radius: 12px; background: #5865f2; color: #fff; font: 700 15px var(--font-sans); text-decoration: none; }
```

Inside the existing `@media (max-width: 760px)` block, add:

```css
  .mr-rarest-row { grid-template-columns: 28px minmax(0, 1fr) auto; }
  .mr-rarest-row .mr-score, .mr-rarest-row .mr-odds { display: none; }
  .mr-seats { grid-template-columns: repeat(10, 1fr); }
  .mr-wall { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 12px; }
  .mr-face { padding: 12px 10px 0 30px; } .mr-emb { font-size: 12px; } .mr-hole { left: 10px; }
```

Add a new media block for the sky:

```css
@media (max-width: 900px) {
  .mr-stars-wide { display: none; }
  .mr-stars-narrow { display: block; }
}
```

and one for phones, where there's no flip:

```css
@media (hover: none) {
  .mr-wall-link:hover .mr-tag { transform: none; }
}
```

Inside the existing `@media (prefers-reduced-motion: reduce)` block, add `.mr-tag { transition: none; } .mr-front::before { animation: none !important; }`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/roster-view.test.ts`
Expected: PASS.

- [ ] **Step 7: Build and look**

Repeat Task 8's Step 6 against the production roster:
- a wall tag flips on hover and on Tab focus, and its memes load then;
- clicking a lit board hexagon or a planet filters the wall and scrolls to it, and "clear" resets it;
- the pills and the search work;
- at 390 px:
  - the wall is two columns;
  - the seats are ten across;
  - the narrow sky shows;
  - nothing overflows sideways.

Save screenshots to the same folder.

- [ ] **Step 8: Run the whole suite and the typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add site/src/components/marines/RarestTen.tsx site/src/components/marines/PlankOwners.tsx site/src/components/marines/DogTag.tsx site/src/components/marines/Wall.tsx site/src/components/marines/Constellation.tsx site/src/components/marines/RosterView.tsx site/src/pages/marines/index.astro site/src/styles/marines.css site/test/roster-view.test.ts
git commit -m "feat(site): the rarest ten, the plank owners, the wall of dog tags and the meme constellation

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 10: A Marine's page

**Files:**
- Create: `site/src/pages/marines/marine.astro`, `site/src/components/marines/MarineView.tsx`
- Modify: `site/src/styles/marines.css`
- Test: `site/test/marine-view.test.ts` (new)

**Interfaces:**
- **Consumes:**
  - core: `marineTags`, `rankOf`, `marineOdds`, `serialText` and `filledPips`;
  - `marines.ts`: `webCardUrl`, `memeUrl`, `marineUrl`, `marineTitle`, `enlistedText`, `pipText`, `tierName`, `shareLine` and `serialFromPath`;
  - `xIntentUrl` (`site/src/lib/share.ts`);
  - `DogTag` (Task 9) and `useRoster` (Task 7).
- **Produces:** `MarinePage({ roster, failed, serial }): JSX` (pure) and the default `MarineView` island.

`ShareButton.tsx` is a menu built around card downloads. It doesn't fit here, so the page uses a plain Share on X link and a small Copy link button.

- [ ] **Step 1: Write the failing tests**

Create `site/test/marine-view.test.ts`:

```ts
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarinePage } from '../src/components/marines/MarineView';

const html = (props: Partial<Parameters<typeof MarinePage>[0]> = {}) => renderToString(createElement(MarinePage, { roster: ROSTER_FIXTURE, failed: false, serial: 2, ...props }));
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('a Marine’s page', () => {
  it('shows the web card with a real alt text', () => {
    // #then
    expect(html()).toMatch(/<img[^>]*src="https:\/\/discord\.ccip\.dev\/web\/2\.png"[^>]*alt="The dog tags of LINK MARINE #0002, painting-space-prophecy, Legendary"/);
  });

  it('heads the facts with the serial, the date, the callsign, the tier, the odds and the rank', () => {
    // #then
    expect(text(html())).toContain('LINK MARINE #0002 · enlisted 13 Oct 2026 painting-space-prophecy LEGENDARY top 3% · rarer than 97 in 100 Marines · rank #1 of 4');
  });

  it('marks each tag’s pips and carriers, and the tags this Marine discovered', () => {
    // #then
    expect(text(html())).toContain('painting ◆◆◆ 3 of 3 pips 1 meme · carried by 2 · discoverer space ◆◆◆ 3 of 3 pips 1 meme · only you carry it · discoverer prophecy ◆◆◇ 2 of 3 pips 3 memes · carried by 2 · discoverer');
  });

  it('prints the lore and shares the page on X with its line', () => {
    // #when
    const out = html();
    // #then
    expect([text(out).includes('BLOOD O-LINK · FAITH SERGEY'), out.includes('https://x.com/intent/post?text=LINK%20MARINE%20%230002%20%C2%B7%20painting-space-prophecy%20%C2%B7%20LEGENDARY&amp;url=https%3A%2F%2Fccip.dev%2Fmarines%2F0002%2F')]).toEqual([true, true]);
  });

  it('says no Marine has the serial yet, and becomes the Marine once a refreshed roster has it', () => {
    // #given a roster without #5, then one with it
    const later = { ...ROSTER_FIXTURE, marines: [...ROSTER_FIXTURE.marines, { ...ROSTER_FIXTURE.marines[0]!, serial: 5, callsign: 'pepe-comfy-sergey' }] };
    // #then
    expect([text(html({ serial: 5 })).includes('No Marine #0005 yet.'), text(html({ serial: 5, roster: later })).includes('pepe-comfy-sergey')]).toEqual([true, true]);
  });

  it('waits for the serial and the roster before saying anything is missing', () => {
    // #then
    expect([text(html({ serial: undefined })), text(html({ roster: null })), text(html({ roster: null, failed: true }))].map((t) => t.includes('No Marine'))).toEqual([false, false, false]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/marine-view.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: The component**

Create `site/src/components/marines/MarineView.tsx`:

```tsx
import { filledPips, marineOdds, serialText } from '@ccip-dev/core/linkmarine';
import { marineTags, rankOf, type RosterFile, type RosterMarine } from '@ccip-dev/core/roster';
import { useEffect, useState } from 'react';
import { enlistedText, marineTitle, marineUrl, memeUrl, pipText, serialFromPath, shareLine, tierName, webCardUrl } from '../../lib/marines';
import { xIntentUrl } from '../../lib/share';
import DogTag from './DogTag';
import { useRoster } from './use-roster';

function CardImage({ marine }: { marine: RosterMarine }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <DogTag marine={marine} big flip={false} />;
  return (
    <img
      className="mr-card"
      src={webCardUrl(marine.serial)}
      alt={`The dog tags of ${marineTitle(marine.serial)}, ${marine.callsign}, ${tierName(marine.tier)}`}
      width={1200}
      height={675}
      onError={() => setBroken(true)}
    />
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="mr-btn"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => setCopied(true));
      }}
    >
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
}

function Missing({ label }: { label: string }) {
  return (
    <section className="mr-missing">
      <h1>{label}</h1>
      <a className="mr-add" href="/discord/">
        Enlist yours
      </a>
    </section>
  );
}

/** A Marine's page. `serial` is undefined until the browser has read it from the path, null when the path holds none. */
export function MarinePage({ roster, failed, serial }: { roster: RosterFile | null; failed: boolean; serial: number | null | undefined }) {
  if (serial === null) return <Missing label="No Marine here." />;
  if (serial === undefined || roster === null) {
    return failed ? (
      <p className="mr-state" role="status">
        The roster is out of reach right now. Retrying…
      </p>
    ) : (
      <p className="mr-state" aria-busy="true">
        Loading {serial === undefined ? 'the Marine' : marineTitle(serial)}…
      </p>
    );
  }
  const marine = roster.marines.find((m) => m.serial === serial);
  if (!marine) return <Missing label={`No Marine #${serialText(serial)} yet.`} />;
  const odds = marineOdds(marine.tier, marine.percentile);
  return (
    <article className="mr-profile">
      <CardImage marine={marine} />
      <div className="mr-profile-facts">
        <p className="mr-eyebrow">
          {marineTitle(serial)} · enlisted {enlistedText(marine.enlisted)}
        </p>
        <h1 className="mr-profile-callsign">{marine.callsign}</h1>
        <p className={`mr-profile-tier mr-metal-text-${marine.tier}`}>{marine.tier.toUpperCase()}</p>
        <p className="mr-profile-odds">
          {odds ? `${odds} · ` : ''}rank #{rankOf(roster.marines, serial)} of {roster.marines.length}
        </p>
        <ul className="mr-profile-tags">
          {marineTags(roster, marine).map((t) => (
            <li key={t.tag}>
              <span className="mr-profile-meme" style={{ backgroundImage: `url(${memeUrl(t.file)})` }} aria-hidden="true" />
              <span className="mr-profile-tag">{t.tag}</span>
              <span className="mr-profile-pips" aria-hidden="true">
                {pipText(t.count)}
              </span>
              <span className="visually-hidden">{filledPips(t.count)} of 3 pips</span>
              <span className="mr-profile-note">
                {t.count} {t.count === 1 ? 'meme' : 'memes'} · {t.carriers === 1 ? <span className="mr-c-legendary">only you carry it</span> : `carried by ${t.carriers}`}
                {t.discoverer && (
                  <>
                    {' '}
                    · <span className="mr-hot">discoverer</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="mr-profile-lore">
          BLOOD {marine.blood} · FAITH {marine.faith}
        </p>
        <div className="mr-actions">
          <a className="mr-btn mr-btn-x" href={xIntentUrl(shareLine(marine), marineUrl(serial))}>
            Share on X
          </a>
          <CopyLink url={marineUrl(serial)} />
          <a className="mr-btn mr-btn-discord" href="/discord/">
            Enlist yours
          </a>
        </div>
      </div>
    </article>
  );
}

export default function MarineView() {
  const { roster, failed } = useRoster();
  const [serial, setSerial] = useState<number | null | undefined>(undefined);
  useEffect(() => setSerial(serialFromPath(window.location.pathname)), []);
  return <MarinePage roster={roster} failed={failed} serial={serial} />;
}
```

`useRoster` keeps polling after a not-found, so a page opened seconds after enlisting fills in on the next refresh. That's the Review Focus item.

- [ ] **Step 4: The template and its styles**

Create `site/src/pages/marines/marine.astro`:

```astro
---
import MarineView from '../../components/marines/MarineView';
import Base from '../../layouts/Base.astro';
import '../../styles/marines.css';
---
<Base title="LinkMarine" description="A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it." noindex>
  <div class="mr-page">
    <MarineView client:load />
  </div>
</Base>
```

Append to `site/src/styles/marines.css`, before the `@media` blocks:

```css
.mr-profile { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 32px; align-items: center; padding: 32px 0; }
.mr-card { width: 100%; height: auto; border-radius: 16px; box-shadow: 0 20px 50px #000b; }
.mr-big .mr-tag { height: 220px; } .mr-big .mr-face { border-radius: 44px; padding: 30px 26px 0 70px; } .mr-big .mr-hole { left: 26px; width: 22px; height: 22px; margin-top: -11px; } .mr-big .mr-emb { font-size: 26px; } .mr-big .mr-ser { font-size: 13px; }
.mr-profile-callsign { font: 800 30px/1.1 var(--font-mono); margin: 10px 0 0; overflow-wrap: anywhere; }
.mr-profile-tier { font-size: 40px; font-weight: 800; line-height: 1; margin: 10px 0 0; }
.mr-metal-text-common, .mr-metal-text-uncommon, .mr-metal-text-rare, .mr-metal-text-legendary { -webkit-background-clip: text; background-clip: text; color: transparent; }
.mr-metal-text-common { background-image: linear-gradient(180deg, #f4f7fb, #8e98a6); } .mr-metal-text-uncommon { background-image: linear-gradient(180deg, #f0c08a, #9a5f2c); } .mr-metal-text-rare { background-image: linear-gradient(90deg, #8fb0ff, #b07cff, #ffd27a, #4fd1c5); } .mr-metal-text-legendary { background-image: linear-gradient(180deg, #fff6cf, #f5c451 45%, #b07a12); }
.mr-profile-odds { font: 700 13px var(--font-mono); color: #f5d77a; margin: 8px 0 14px; }
.mr-profile-tags { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.mr-profile-tags li { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font: 600 13px var(--font-mono); color: #c3cad5; }
.mr-profile-meme { width: 42px; height: 48px; flex: none; clip-path: var(--hex); background-size: cover; background-position: center; }
.mr-profile-tag { min-width: 110px; color: var(--fg); font-weight: 700; }
.mr-profile-pips { color: var(--gold); letter-spacing: 2px; }
.mr-profile-note { color: var(--muted); }
.mr-hot { color: #ff8a5c; }
.mr-profile-lore { font: 700 12px var(--font-mono); letter-spacing: 0.12em; color: var(--muted); margin: 16px 0 0; }
.mr-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.mr-btn { padding: 10px 14px; border-radius: 10px; font: 700 13px var(--font-sans); background: var(--card); border: 1px solid var(--border); color: var(--fg); text-decoration: none; cursor: pointer; }
.mr-btn-x { background: #000; } .mr-btn-discord { background: #5865f2; border-color: #5865f2; color: #fff; }
.mr-missing { padding: 60px 0; text-align: center; } .mr-missing h1 { font-size: 32px; margin: 0 0 8px; }
```

Inside `@media (max-width: 760px)`, add `.mr-profile { grid-template-columns: 1fr; } .mr-profile-tier { font-size: 32px; }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/marine-view.test.ts`
Expected: PASS. If the X intent assertion fails only because React escapes the `&` differently, assert on the exact `href` that React renders.

- [ ] **Step 6: Build and look**

```bash
pnpm --filter @ccip-dev/site build
```

The build's own check (`check-build`) must report the new pages:
- titles are unique ("LinkMarines · ccip.dev" and "LinkMarine · ccip.dev");
- the default share image is allowed.

`astro preview` doesn't run the site Worker, so look at the template through `/marines/marine/`. It shows "No Marine here." locally, because only the Worker maps a serial onto it. To see a real Marine page before shipping, run the site Worker locally:

```bash
pnpm --filter @ccip-dev/site exec wrangler dev --port 8788
```

Open `http://localhost:8788/marines/0001/`. Check:
- the head has the Marine's title and `og:image` (view source);
- the card renders;
- each tag row shows its meme;
- Copy link works.

Then check at 390 px, and a missing serial (`/marines/9999/`). Save screenshots to the scratchpad folder. If `wrangler dev` won't start, say so in the report; the controller checks it in production.

- [ ] **Step 7: Run the whole suite and the typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add site/src/pages/marines/marine.astro site/src/components/marines/MarineView.tsx site/src/styles/marines.css site/test/marine-view.test.ts
git commit -m "feat(site): a page per Marine with its web card, odds, rank, discoveries and a share link

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 11: Links into the roster, the runbook and the final checks

**Files:**
- Modify: `site/src/components/Header.astro` (`MORE`), `site/src/components/Footer.astro`, `site/src/pages/about.astro`, `site/src/pages/discord.astro`
- Modify: `docs/runbook.md` (the "Discord bot (LinkMarine)" section)
- Test: `site/test/socials.test.ts`

**Interfaces:**
- **Consumes:** `ROSTER_URL` (Task 6).

- [ ] **Step 1: Write the failing tests**

In `site/test/socials.test.ts`:
- replace the test `it('leaves out the roster counter', …)` in `describe('the /discord/ page source')` with:

```ts
  it('links the roster and counts its Marines from ROSTER_URL', () => {
    expect([page.includes('href="/marines/"'), page.includes('ROSTER_URL'), page.includes('enlisted · ')]).toEqual([true, true, true]);
  });
```

- add to `describe('the menus')`:

```ts
  it('lists the roster in the header menu, the footer links and the about page', () => {
    expect([
      source('../src/components/Header.astro').includes("{ href: '/marines/', label: 'LinkMarines' }"),
      source('../src/components/Footer.astro').includes('<a href="/marines/">LinkMarines</a>'),
      source('../src/pages/about.astro').includes('Every enlisted Marine is on the roster: <a href="/marines/">ccip.dev/marines</a>.'),
    ]).toEqual([true, true, true]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/socials.test.ts`
Expected: FAIL.

- [ ] **Step 3: The links**

- **`Header.astro` `MORE`:** after `{ href: '/discord/', label: 'Discord bot' },`, add `{ href: '/marines/', label: 'LinkMarines' },`.
- **`Footer.astro`:** after `<a href="/discord/">Discord bot</a>{' · '}`, add `<a href="/marines/">LinkMarines</a>{' · '}`.
- **`about.astro`:** append ` Every enlisted Marine is on the roster: <a href="/marines/">ccip.dev/marines</a>.` to the end of the paragraph that holds "ccip.dev on Discord", inside the `<p>`.
- **`discord.astro`:**
  - In the final `.cta` section, after the `.ctas` div, add:

```astro
      <p class="roster-line"><span id="roster-count" hidden></span><a href="/marines/">See the roster</a></p>
```

  - Before the `<style>` block, add:

```astro
<script>
  import { ROSTER_URL } from '../config';

  // "N Marines enlisted · " from the live roster; on any failure only the link shows.
  const count = document.getElementById('roster-count');
  fetch(ROSTER_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then((roster: { marines?: unknown } | null) => {
      const marines = roster?.marines;
      const n = Array.isArray(marines) ? marines.length : null;
      if (count && n !== null) {
        count.textContent = `${n.toLocaleString('en-US')} ${n === 1 ? 'Marine' : 'Marines'} enlisted · `;
        count.hidden = false;
      }
    })
    .catch(() => {});
</script>
```

  - Add to its `<style>`: `.roster-line { margin-top: 18px; font: 600 14px var(--font-mono); color: var(--soft); }` and `.roster-line a { color: var(--blue-2); }`.

- [ ] **Step 4: The runbook**

In `docs/runbook.md`, add a subsection at the end of the "Discord bot (LinkMarine)" section:

```markdown
### The public roster

The bot also answers three public, read-only routes on `discord.ccip.dev`, which `ccip.dev/marines/` reads (spec: `docs/superpowers/specs/2026-10-13-linkmarines-roster-design.md`):

| Route | What it serves | Cache |
|---|---|---|
| `/roster.json` | Every Marine by callsign: never a Discord name, avatar or id | 60 s |
| `/memes/<file>.png` | The 240 px memes; one no Marine holds yet is copied from the pinned archive on first request | a year, immutable |
| `/web/<serial>.png` | The dog tag card without the name and avatar row, rendered once into R2 `web/` | a day |

A 404 is cached for 60 s, and a 503 is never cached.

**Wiping test Marines** must also delete R2 `web/` (as well as `cards/` and `avatars/`). Do it before the roster is announced: the edge can serve a wiped serial's old web card for up to a day. Memes may stay.
```

- [ ] **Step 5: Run the tests, the build and the typecheck**

```bash
pnpm test && pnpm typecheck && pnpm --filter @ccip-dev/site build
```

Expected: all green. Report the page count `check-build` prints and the JS budget lines.

- [ ] **Step 6: The final visual and accessibility pass**

With `pnpm --filter @ccip-dev/site exec astro preview --port 4321` (the roster page) and `wrangler dev` (a Marine page, as in Task 10 Step 6), check all of these against the production roster. If you have no browser tool, say so.
- `/marines/` at 1280 and 390 px:
  - no horizontal overflow (`document.documentElement.scrollWidth === innerWidth`);
  - long callsigns ellipsize on the wall and in the rarest-ten rows (Review Focus 4).
- `/marines/0001/` at 1280 and 390 px.
- Lighthouse accessibility on `/marines/` and on the Marine page: report the scores. Fix anything below 100 that the page's own markup causes.
- Reduced motion (emulate `prefers-reduced-motion: reduce`): the ticker is still and can scroll, and there's no glint.
- The `/discord/` page's call to action shows "N Marines enlisted · See the roster".

Save screenshots to `/private/tmp/claude-501/-Users-rubberduck-GitHub-momentmaker-ccip-dev/19cabbec-cd1e-4fc5-a2ef-ade789a597b9/scratchpad/roster-page/`.

- [ ] **Step 7: Commit**

```bash
git add site/src/components/Header.astro site/src/components/Footer.astro site/src/pages/about.astro site/src/pages/discord.astro site/test/socials.test.ts docs/runbook.md
git commit -m "feat(site): link the LinkMarines roster from the menus, About and the Discord page; runbook

Co-Authored-By: <your model> <noreply@anthropic.com>"
```
