# Chain Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put each CCIP chain's logo on ccip.dev. The busiest chains wear logo coins on every sky (home, replay and its MP4s, day pages, share cards), a hover or tap card shows any chain's logo, and small icons sit next to chain names in lists.

**Architecture:**
- **Icons:** a hand-run script vendors Chainlink docs chain icons into `site/public/chains/` with a manifest keyed by chain name that also carries each selector. svgo cleans the icons; lettermarks cover chains without one.
- **Coins:** each surface draws coins with the layer it already has:
  - **Home sky:** DOM images over the canvas, like the existing name labels.
  - **Replay:** the compositor's 2D pass, so recordings include coins.
  - **Day pages:** `<image>` elements in the static sky SVG.
  - **Share cards:** satori `<img>` elements placed from a build-time `/card-coins.json`. Nested SVGs do not render in resvg.
- **Lists:** a `ChainIcons` component.

**Tech Stack:** Astro 7, React 19, TypeScript 7 (tsgo), Vitest 4, svgo 4.1.0 (new exact-pinned devDependency), `@cf-wasm/og` 0.5.0 (satori and resvg, already present), Cloudflare Workers with `@cloudflare/vitest-plugin`.

**Spec:** `docs/superpowers/specs/2026-10-07-chain-icons-design.md`. Parent spec: `docs/superpowers/specs/2026-10-06-website-design.md`.

## Global Constraints

**Repo and workflow**
- Repo `/Users/rubberduck/GitHub/momentmaker/ccip-dev`, branch `main`, pnpm workspace. The site package is `@ccip-dev/site` in `site/`.
- Never push and never deploy; the controller does both.
- Every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before each commit, run `pnpm --filter @ccip-dev/site test` and `pnpm --filter @ccip-dev/site typecheck`.
- Before the last commit of any task that touches pages or the Worker, also run `pnpm --filter @ccip-dev/site build`. It runs check-build and check-budgets, and both must pass.

**Dependencies and sources**
- No new runtime dependencies. The only new devDependency is `"svgo": "4.1.0"`, pinned exactly.
- Free sources only. Icons come from `https://docs.chain.link/assets/chains/<slug>.svg`, listed through `https://api.github.com/repos/smartcontractkit/documentation/contents/public/assets/chains`.
- No build and no page view may fetch from docs.chain.link. Icons are committed to the repo.

**Code style**
- Follow the surrounding code: no comments that restate code, single-responsibility functions.
- Test first for anything with logic (RED, then GREEN). There are no React component tests in this repo; components are verified by build and browser checks.

**Colors**
- Gold only for $1M+ moments.
- Green, amber and red only for status and deltas.
- One brand blue (`--blue`, `--blue-2`).
- Chain logos are content and exempt from these rules.

**Budgets**
- Home JavaScript ≤ 150 KB gzipped; replay ≤ 200 KB.
- Lighthouse mobile accessibility ≥ 95.
- No horizontal scroll at 390 px.

**Verbatim values (exact copy)**
- About credit: `Chain icons: Chainlink documentation. Logos are trademarks of their respective owners.`
- Hover card line: `{formatUsd(value)} moved · {formatCount(messages)} messages · 30 days`
- Coin ring color: `rgba(255,255,255,0.18)`. Lettermark background: `#2a3446`.

**Coin constants**
| Constant | Value | Meaning |
|---|---|---|
| `COIN_MIN` | 18 | smallest coin diameter |
| `COIN_MAX` | 40 | largest coin diameter |
| `COIN_SCALE` | 2.4 | coin diameter per unit of star radius |
| `COINS_WIDE` | 12 | coins on a wide sky |
| `COINS_NARROW` | 8 | coins on a narrow sky |
| `NARROW_PX` | 640 | width below which a sky is narrow |
| `REPLAY_COINS` | 12 | coins on the replay |
| `COIN_FADE_S` | 0.5 | replay fade, in seconds |
| `CARD_COINS` | 8 | coins on a share card |
| `CARD_COIN_SCALE` | 1.6 | card coin size multiplier |
| `REPLAY_COIN_UNIT` | 800 | replay coin scale divisor |
| `COIN_RASTER_PX` | 128 | replay coin raster size |
| `COIN_WAIT_MS` | 5000 | longest a recording waits for icons |

## Review Focus

Five failure modes the spec implies but feature tests would not exercise. Each one is pinned by a test in the task named:

1. **A chain added after the last icon run** (not in the manifest). It shows no coin, no list icon and no card coin, and nothing breaks.
   - Task 2: `coinSelectors` skips it.
   - Task 3: `cardCoins` skips it.
   - Task 2: `missingIcons` names it.
2. **An icon that fails to load in the browser.** That coin is dropped and the others still draw.
   - Task 6: `loadCoinImages` with a rejecting loader keeps the rest.
   - Task 5: the overlay excludes broken selectors.
3. **A recording started before icons have loaded.** It waits at most 5 s, then records without the missing coins.
   - Task 6: `settleWithin` falls back after the timeout.
4. **A malformed, missing or hostile `/card-coins.json`.** The card still renders, with no coins and no 5xx.
   - Task 4 (Node `og.test.ts`): invalid JSON, a 404, and a coin with a non-`data:` src.
5. **A chain at 12th place that flickers in and out between days.** Its replay coin fades instead of strobing, and the same `t` always gives the same coins.
   - Task 6: a timeline test where membership alternates.

---

## Task 1: Vendor the chain icons

**Files:**
- Create: `site/scripts/chain-icons/match.ts`, `site/scripts/chain-icons/clean.ts`, `site/scripts/chain-icons/lettermark.ts`, `site/scripts/chain-icons/sheet.ts`
- Create: `site/scripts/fetch-chain-icons.ts`, `site/scripts/chain-icon-overrides.json`
- Create, by running the script: `site/public/chains/*.svg` (95 files), `site/src/data/chain-icons.json`
- Modify: `site/package.json` (script and devDependency), `.gitignore` (root)
- Test: `site/test/chain-icons-match.test.ts`, `site/test/chain-icons-clean.test.ts`, `site/test/chain-icons-lettermark.test.ts`

**Interfaces:**
- Produces:
  - `site/src/data/chain-icons.json` with the shape `{ source: string; icons: Record<string /* chain name */, { selector: string; file: string; kind: 'logo' | 'lettermark'; slug: string | null; rule: string }> }`.
  - `site/public/chains/<chain name>.svg`. Every file has `viewBox`, `width="32"` and `height="32"` on its root, and every id is prefixed `<chain name>-`.

- [ ] **Step 1: Pin svgo and add the script entry**

In `site/package.json`:
- add `"icons:fetch": "tsx scripts/fetch-chain-icons.ts"` to `scripts`;
- add `"svgo": "4.1.0"` to `devDependencies`, keeping alphabetical order.

Then run `pnpm install` from the repo root. Expected: the lockfile gains a direct `svgo` entry for `site` at 4.1.0.

Append this line to the root `.gitignore`:

```
site/.icons-review.html
```

- [ ] **Step 2: Write the failing matcher tests**

`site/test/chain-icons-match.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { displaySlug, matchIcon } from '../scripts/chain-icons/match';

const chain = (name: string, display_name: string | null = name) => ({ name, display_name });

describe('displaySlug', () => {
  it('lowercases, drops a trailing " Mainnet" and hyphenates spaces', () => {
    expect(displaySlug('BNB Chain Mainnet')).toBe('bnb-chain');
    expect(displaySlug('Henesys')).toBe('henesys');
  });
});

describe('matchIcon', () => {
  it('prefers the exact chain name', () => {
    expect(matchIcon(chain('ethereum-mainnet-base-1'), new Set(['ethereum-mainnet-base-1', 'base']), {})).toEqual({ slug: 'ethereum-mainnet-base-1', rule: 'exact' });
  });

  it('uses the child segment of <parent>-mainnet-<x>-<n>', () => {
    expect(matchIcon(chain('ethereum-mainnet-arbitrum-1'), new Set(['ethereum', 'arbitrum']), {})).toEqual({ slug: 'arbitrum', rule: 'child' });
  });

  it('uses the child segment without a trailing number', () => {
    expect(matchIcon(chain('polygon-mainnet-katana'), new Set(['katana']), {})).toEqual({ slug: 'katana', rule: 'child' });
  });

  it('never gives a child chain its parent icon', () => {
    expect(matchIcon(chain('ethereum-mainnet-polygon-zkevm-1', 'Polygon zkEVM'), new Set(['ethereum', 'polygon']), {})).toEqual({ slug: null, rule: 'none' });
  });

  it('uses the stem of <x>-mainnet', () => {
    expect(matchIcon(chain('avalanche-mainnet'), new Set(['avalanche']), {})).toEqual({ slug: 'avalanche', rule: 'stem' });
  });

  it('falls back to the display name', () => {
    expect(matchIcon(chain('binance_smart_chain-mainnet', 'BNB Chain Mainnet'), new Set(['bnb-chain']), {})).toEqual({ slug: 'bnb-chain', rule: 'display' });
  });

  it('applies an override to a slug', () => {
    expect(matchIcon(chain('mind-mainnet'), new Set(['mindnetwork', 'mind']), { 'mind-mainnet': 'mindnetwork' })).toEqual({ slug: 'mindnetwork', rule: 'override' });
  });

  it('applies an override to null as a forced lettermark', () => {
    expect(matchIcon(chain('avalanche-mainnet'), new Set(['avalanche']), { 'avalanche-mainnet': null })).toEqual({ slug: null, rule: 'none' });
  });

  it('throws when an override names an icon the docs do not have', () => {
    expect(() => matchIcon(chain('mind-mainnet'), new Set(['mind']), { 'mind-mainnet': 'mindnetwork' })).toThrow('mind-mainnet');
  });

  it('reports no match', () => {
    expect(matchIcon(chain('sui-mainnet'), new Set(['solana']), {})).toEqual({ slug: null, rule: 'none' });
  });

  it('skips the display rule when the chain has no display name', () => {
    expect(matchIcon(chain('zz-mainnet-x', null), new Set(['zz']), {})).toEqual({ slug: null, rule: 'none' });
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/chain-icons-match.test.ts`
Expected: FAIL, because `../scripts/chain-icons/match` cannot be resolved.

- [ ] **Step 4: Implement the matcher**

`site/scripts/chain-icons/match.ts`:

```ts
export interface IconChain {
  name: string;
  display_name: string | null;
}

export type Overrides = Record<string, string | null>;
export type MatchRule = 'override' | 'exact' | 'child' | 'stem' | 'display' | 'none';

export interface IconMatch {
  slug: string | null;
  rule: MatchRule;
}

const CHILD = /^.+?-mainnet-(.+?)(?:-\d+)?$/;
const STEM = /^(.+)-mainnet$/;

export function displaySlug(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/ mainnet$/, '').replace(/\s+/g, '-');
}

export function matchIcon(chain: IconChain, slugs: ReadonlySet<string>, overrides: Overrides): IconMatch {
  if (Object.hasOwn(overrides, chain.name)) {
    const slug = overrides[chain.name] ?? null;
    if (slug === null) return { slug: null, rule: 'none' };
    if (!slugs.has(slug)) throw new Error(`override for ${chain.name} names ${slug}, which the docs do not have`);
    return { slug, rule: 'override' };
  }
  const candidates: [MatchRule, string | undefined][] = [
    ['exact', chain.name],
    ['child', CHILD.exec(chain.name)?.[1]],
    ['stem', STEM.exec(chain.name)?.[1]],
    ['display', chain.display_name ? displaySlug(chain.display_name) : undefined],
  ];
  for (const [rule, slug] of candidates) {
    if (slug && slugs.has(slug)) return { slug, rule };
  }
  return { slug: null, rule: 'none' };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/chain-icons-match.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Write the failing cleaner tests**

`site/test/chain-icons-clean.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkIcon, cleanIcon, MAX_ICON_BYTES } from '../scripts/chain-icons/clean';

const ICON = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="paint0_linear_1460" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stop-color="#627EEA"/><stop offset="1" stop-color="#3C3C3D"/></linearGradient></defs>
<rect width="32" height="32" rx="4" fill="url(#paint0_linear_1460)"/><path d="M16 4L9 16L16 13Z" fill="white"/></svg>`;

describe('cleanIcon', () => {
  it('prefixes ids and rewrites the references to them', () => {
    const out = cleanIcon(ICON, 'ethereum-mainnet');
    const id = /\sid="([^"]+)"/.exec(out)?.[1];
    expect(id?.startsWith('ethereum-mainnet-')).toBe(true);
    expect(out).toContain(`url(#${id})`);
    expect(out).not.toContain('paint0_linear_1460');
  });

  it('keeps the viewBox and the 32 px size', () => {
    const out = cleanIcon(ICON, 'x');
    expect(out).toContain('viewBox="0 0 32 32"');
    expect(out).toContain('width="32"');
    expect(out).toContain('height="32"');
  });

  it('strips scripts, event handlers and outside links', () => {
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="32" viewBox="0 0 32 32" onload="steal()">
<script>alert(1)</script><a href="https://evil.example/"><rect width="32" height="32" fill="red" onclick="steal()"/></a>
<image xlink:href="https://evil.example/x.png" width="4" height="4"/></svg>`;
    const out = cleanIcon(hostile, 'x');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/\son[a-z]+=/i);
    expect(out).not.toContain('evil.example');
  });
});

describe('checkIcon', () => {
  it('accepts a small icon with a viewBox', () => {
    expect(() => checkIcon('<svg viewBox="0 0 32 32"/>', 'x')).not.toThrow();
  });

  it('rejects an icon without a viewBox', () => {
    expect(() => checkIcon('<svg width="32"/>', 'x')).toThrow('x: cleaned icon has no viewBox');
  });

  it('rejects an icon over the size limit', () => {
    expect(() => checkIcon(`<svg viewBox="0 0 32 32">${' '.repeat(MAX_ICON_BYTES)}</svg>`, 'x')).toThrow(/over 20000/);
  });
});
```

- [ ] **Step 7: Run the tests and confirm they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/chain-icons-clean.test.ts`
Expected: FAIL, because `../scripts/chain-icons/clean` cannot be resolved.

- [ ] **Step 8: Implement the cleaner**

`site/scripts/chain-icons/clean.ts`:

```ts
import { optimize, type CustomPlugin } from 'svgo';

export const MAX_ICON_BYTES = 20_000;
const SAFE_HREF = /^(#|data:image\/(png|jpeg|webp);)/;

const stripUnsafe: CustomPlugin = {
  name: 'stripUnsafe',
  fn: () => ({
    element: {
      enter: (node) => {
        for (const key of Object.keys(node.attributes)) {
          const value = node.attributes[key] ?? '';
          const outsideLink = (key === 'href' || key === 'xlink:href') && !SAFE_HREF.test(value);
          if (/^on/i.test(key) || outsideLink) delete node.attributes[key];
        }
      },
    },
  }),
};

export function checkIcon(svg: string, prefix: string): void {
  if (!/\sviewBox="/.test(svg)) throw new Error(`${prefix}: cleaned icon has no viewBox`);
  if (svg.length > MAX_ICON_BYTES) throw new Error(`${prefix}: cleaned icon is ${svg.length} bytes, over ${MAX_ICON_BYTES}`);
}

export function cleanIcon(svg: string, prefix: string): string {
  const { data } = optimize(svg, {
    multipass: false,
    plugins: ['preset-default', 'removeScripts', 'removeXlink', stripUnsafe, { name: 'prefixIds', params: { prefix, delim: '-' } }],
  });
  checkIcon(data, prefix);
  return `${data}\n`;
}
```

If svgo 4.1.0 names a plugin or type differently, read `node_modules/svgo/lib/svgo.d.ts` and `node_modules/svgo/plugins/plugins.js`, use the 4.1.0 name, and record the difference in the report. Don't change the behavior the tests describe. The same applies if `preset-default` drops `viewBox` (the test catches that): add the 4.1.0 option that keeps it.

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/chain-icons-clean.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 10: Write the failing lettermark tests**

`site/test/chain-icons-lettermark.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LETTERMARK_BG, lettermarkLetter, lettermarkSvg } from '../scripts/chain-icons/lettermark';

describe('lettermarkLetter', () => {
  it.each([['sui-mainnet', 'S'], ['0G Mainnet', '0'], ['B^2 Mainnet', 'B'], ['—', '?']])('%s → %s', (name, letter) => {
    expect(lettermarkLetter(name)).toBe(letter);
  });
});

describe('lettermarkSvg', () => {
  it('renders a 32 px rounded square with the letter as paths, needing no font', async () => {
    const svg = await lettermarkSvg('Sui');
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain(`fill="${LETTERMARK_BG}"`);
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
  });
});
```

- [ ] **Step 11: Run the tests and confirm they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/chain-icons-lettermark.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 12: Implement the lettermark**

`site/scripts/chain-icons/lettermark.ts`:

```ts
import { render } from '@cf-wasm/og/node';
import { INTER_700 } from '../../worker/fonts';

export const LETTERMARK_BG = '#2a3446';

export function lettermarkLetter(displayName: string): string {
  return /[a-z0-9]/i.exec(displayName)?.[0]?.toUpperCase() ?? '?';
}

export async function lettermarkSvg(displayName: string): Promise<string> {
  const tree = {
    type: 'div',
    props: {
      style: {
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LETTERMARK_BG,
        borderRadius: 4,
        color: '#ffffff',
        fontSize: 18,
        fontWeight: 700,
        fontFamily: 'Inter',
      },
      children: lettermarkLetter(displayName),
    },
  };
  const fonts = [{ name: 'Inter', data: INTER_700, weight: 700, style: 'normal' }];
  const result = await render(tree as never, { width: 32, height: 32, fonts: fonts as never, loadAdditionalAsset: async () => [] }).asSvg();
  return result.image;
}
```

- [ ] **Step 13: Run the tests and confirm they pass**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/chain-icons-lettermark.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 14: Write the contact sheet and the script**

`site/scripts/chain-icons/sheet.ts`:

```ts
export interface SheetRow {
  file: string;
  displayName: string;
  slug: string | null;
  rule: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function contactSheet(rows: readonly SheetRow[]): string {
  const cells = rows
    .map(
      (r) =>
        `<figure><img src="public/chains/${escapeHtml(r.file)}" width="40" height="40"><img src="public/chains/${escapeHtml(r.file)}" width="16" height="16">` +
        `<figcaption>${escapeHtml(r.displayName)}<br><small>${escapeHtml(r.slug ?? 'lettermark')} · ${escapeHtml(r.rule)}</small></figcaption></figure>`,
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Chain icon review</title>
<style>body{background:#0c0f14;color:#e8eaed;font:13px system-ui;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;padding:16px}figure{margin:0;display:grid;justify-items:center;gap:6px}img{border-radius:50%}small{color:#8892a0}</style>
${cells}
`;
}
```

`site/scripts/chain-icon-overrides.json`:

```json
{
  "ab-mainnet": "abchain",
  "adi-mainnet": "adi-network",
  "cronos-zkevm-mainnet": "cronoszkevm",
  "ethereum-mainnet-polygon-zkevm-1": "polygonzkevm",
  "mind-mainnet": "mindnetwork",
  "polygon-mainnet-katana": "polygonkatana"
}
```

`site/scripts/fetch-chain-icons.ts`:

```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchPublic } from '../src/lib/data';
import { cleanIcon } from './chain-icons/clean';
import { lettermarkSvg } from './chain-icons/lettermark';
import { matchIcon, type MatchRule, type Overrides } from './chain-icons/match';
import { contactSheet, type SheetRow } from './chain-icons/sheet';

const SOURCE = 'https://github.com/smartcontractkit/documentation/tree/main/public/assets/chains';
const LISTING = 'https://api.github.com/repos/smartcontractkit/documentation/contents/public/assets/chains';
const iconUrl = (slug: string) => `https://docs.chain.link/assets/chains/${slug}.svg`;
const SITE = join(import.meta.dirname, '..');
const OUT_DIR = join(SITE, 'public', 'chains');
const MANIFEST = join(SITE, 'src', 'data', 'chain-icons.json');
const OVERRIDES = join(import.meta.dirname, 'chain-icon-overrides.json');
const SHEET = join(SITE, '.icons-review.html');
const SAFE_NAME = /^[a-z0-9_-]+$/;

interface ManifestEntry {
  selector: string;
  file: string;
  kind: 'logo' | 'lettermark';
  slug: string | null;
  rule: MatchRule;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  const [{ chains }, listing, overrides] = await Promise.all([
    fetchPublic('chains.json'),
    getText(LISTING).then((t) => JSON.parse(t) as { name: string }[]),
    readFile(OVERRIDES, 'utf8').then((t) => JSON.parse(t) as Overrides),
  ]);
  const slugs = new Set(listing.filter((f) => f.name.endsWith('.svg')).map((f) => f.name.slice(0, -4)));
  const files = new Map<string, string>();
  const icons: Record<string, ManifestEntry> = {};
  const rows: SheetRow[] = [];
  for (const chain of [...chains].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!SAFE_NAME.test(chain.name)) throw new Error(`unsafe chain name for a file: ${chain.name}`);
    const match = matchIcon(chain, slugs, overrides);
    const displayName = chain.display_name ?? chain.name;
    const raw = match.slug ? await getText(iconUrl(match.slug)) : await lettermarkSvg(displayName);
    const file = `${chain.name}.svg`;
    files.set(file, cleanIcon(raw, chain.name));
    icons[chain.name] = { selector: chain.selector, file, kind: match.slug ? 'logo' : 'lettermark', slug: match.slug, rule: match.rule };
    rows.push({ file, displayName, slug: match.slug, rule: match.rule });
  }
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  for (const [file, svg] of files) await writeFile(join(OUT_DIR, file), svg);
  await mkdir(join(SITE, 'src', 'data'), { recursive: true });
  await writeFile(MANIFEST, `${JSON.stringify({ source: SOURCE, icons }, null, 2)}\n`);
  await writeFile(SHEET, contactSheet(rows));
  const byRule = new Map<string, number>();
  for (const r of rows) byRule.set(r.rule, (byRule.get(r.rule) ?? 0) + 1);
  console.log(`icons: ${rows.length} chains · ${[...byRule].map(([rule, n]) => `${rule} ${n}`).join(' · ')}`);
  console.log(`lettermarks: ${rows.filter((r) => r.slug === null).map((r) => r.displayName).join(', ') || 'none'}`);
  console.log(`review: ${SHEET}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
```

The script writes nothing until every icon has downloaded and been cleaned: the `files` map is filled first. So a failed download or a rejected icon (an error thrown by `cleanIcon` or `matchIcon`) leaves the committed icons untouched.

- [ ] **Step 15: Run the script**

Run: `pnpm --filter @ccip-dev/site icons:fetch`
Expected output:
- `icons: 95 chains · …`, where the `none` count is 1;
- `lettermarks: sui-mainnet`;
- the review path.

`site/public/chains/` then holds 95 `.svg` files, and `site/src/data/chain-icons.json` exists.

Run it a second time, then run `git status --porcelain site/public/chains site/src/data`. Expected: the files are unchanged from the first run, which shows the output is byte-identical (spec §5.1).

- [ ] **Step 16: Run the whole site suite and typecheck**

Run: `pnpm --filter @ccip-dev/site test && pnpm --filter @ccip-dev/site typecheck`
Expected: PASS.

- [ ] **Step 17: Commit**

```bash
git add .gitignore pnpm-lock.yaml site/package.json site/scripts/chain-icons site/scripts/fetch-chain-icons.ts site/scripts/chain-icon-overrides.json site/public/chains site/src/data/chain-icons.json site/test/chain-icons-match.test.ts site/test/chain-icons-clean.test.ts site/test/chain-icons-lettermark.test.ts
git commit -m "feat(site): vendor Chainlink docs chain icons with a manifest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 18 (controller, not the implementer): Review the contact sheet**

1. Open `site/.icons-review.html` in a browser at the repo's `site/` folder and check every icon against its chain name.
2. For each wrong match, add an override: the right slug, or `null` for a lettermark.
3. Run `pnpm --filter @ccip-dev/site icons:fetch` again and commit with the message `fix(site): chain icon overrides after review`.
4. Record the review in the ledger.

---

## Task 2: Icon lookup, coin math, build check and credit

**Files:**
- Create: `site/src/lib/chain-icons.ts`, `site/src/lib/chain-icons-server.ts`, `site/src/sky/coins.ts`
- Modify: `site/scripts/check-build.ts`, `site/src/pages/about.astro`
- Test: `site/test/chain-icons.test.ts`, `site/test/coins.test.ts`, `site/test/check-build.test.ts`

**Interfaces:**
- Consumes: `site/src/data/chain-icons.json` (Task 1).
- Produces:
  - `iconHref(selector: string): string | null`, which returns `'/chains/<file>'`;
  - `hasIcon(selector: string): boolean`;
  - `missingIcons(chains: readonly { selector: string; name: string | null }[]): string[]`, which falls back to the selector when a chain has no name;
  - `iconFiles(): string[]`;
  - `iconDataUri(selector: string, publicDir?: string): string | null` (server-only);
  - from `sky/coins.ts`: `COIN_MIN`, `COIN_MAX`, `COIN_SCALE`, `COINS_WIDE`, `COINS_NARROW`, `NARROW_PX`;
  - `coinCount(widthCss: number): number`;
  - `coinDiameter(radius: number): number`;
  - `coinSelectors(values: Map<string, number>, count: number, hasIcon: (selector: string) => boolean): string[]`;
  - `nearestStar(points: readonly Reachable[], x: number, y: number): string | null`, with `Reachable = { selector: string; x: number; y: number; reach: number }`;
  - `chainMessages(lanes: readonly { src: string; dst: string; messages: number }[], selector: string): number`;
  - `checkIconFiles(files: readonly string[], present: ReadonlySet<string>): string[]` in `check-build.ts`.

- [ ] **Step 1: Write the failing lookup tests**

`site/test/chain-icons.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasIcon, iconFiles, iconHref, missingIcons } from '../src/lib/chain-icons';
import { iconDataUri } from '../src/lib/chain-icons-server';

const ETHEREUM = '5009297550715157269';
const PUBLIC = join(import.meta.dirname, '..', 'public');

describe('chain icons', () => {
  it('maps a selector to its vendored file', () => {
    expect(iconHref(ETHEREUM)).toBe('/chains/ethereum-mainnet.svg');
    expect(hasIcon(ETHEREUM)).toBe(true);
  });

  it('returns nothing for a chain the manifest does not know', () => {
    expect(iconHref('1')).toBeNull();
    expect(hasIcon('1')).toBe(false);
  });

  it('names the chains that have no icon', () => {
    expect(missingIcons([{ selector: ETHEREUM, name: 'ethereum-mainnet' }, { selector: '1', name: 'brand-new-mainnet' }, { selector: '2', name: null }])).toEqual(['brand-new-mainnet', '2']);
  });

  it('has a file in public/chains for every manifest entry', () => {
    const missing = iconFiles().filter((f) => !existsSync(join(PUBLIC, 'chains', f)));
    expect(missing).toEqual([]);
  });

  it('inlines an icon as a base64 SVG data URI at build time', () => {
    const uri = iconDataUri(ETHEREUM, PUBLIC)!;
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(uri.split(',')[1]!, 'base64').toString('utf8')).toContain('<svg');
    expect(iconDataUri('1', PUBLIC)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing coin math tests**

`site/test/coins.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chainMessages, coinCount, coinDiameter, coinSelectors, nearestStar } from '../src/sky/coins';

describe('coinCount', () => {
  it('shows 12 coins from 640 px up and 8 below', () => {
    expect(coinCount(640)).toBe(12);
    expect(coinCount(639)).toBe(8);
  });
});

describe('coinDiameter', () => {
  it('is 2.4 × the radius, clamped to 18–40', () => {
    expect(coinDiameter(10)).toBe(24);
    expect(coinDiameter(2)).toBe(18);
    expect(coinDiameter(50)).toBe(40);
  });
});

describe('coinSelectors', () => {
  const values = new Map([['a', 50], ['b', 90], ['c', 90], ['d', 0], ['e', 70]]);
  const all = () => true;

  it('ranks by value with ties broken by selector', () => {
    expect(coinSelectors(values, 3, all)).toEqual(['b', 'c', 'e']);
  });

  it('skips chains with no icon', () => {
    expect(coinSelectors(values, 3, (s) => s !== 'c')).toEqual(['b', 'e', 'a']);
  });

  it('skips chains with no value', () => {
    expect(coinSelectors(values, 10, all)).toEqual(['b', 'c', 'e', 'a']);
  });
});

describe('nearestStar', () => {
  const points = [
    { selector: 'a', x: 100, y: 100, reach: 12 },
    { selector: 'b', x: 120, y: 100, reach: 30 },
  ];

  it('picks the nearest star within its reach', () => {
    expect(nearestStar(points, 104, 100)).toBe('a');
    expect(nearestStar(points, 112, 100)).toBe('b');
  });

  it('returns null when no star is in reach', () => {
    expect(nearestStar(points, 200, 200)).toBeNull();
  });
});

describe('chainMessages', () => {
  it('sums lanes touching the chain and counts a self-lane once', () => {
    const lanes = [
      { src: 'a', dst: 'b', messages: 5 },
      { src: 'b', dst: 'a', messages: 3 },
      { src: 'a', dst: 'a', messages: 2 },
      { src: 'b', dst: 'c', messages: 7 },
    ];
    expect(chainMessages(lanes, 'a')).toBe(10);
    expect(chainMessages(lanes, 'z')).toBe(0);
  });
});
```

- [ ] **Step 3: Run both test files and confirm they fail**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/chain-icons.test.ts test/coins.test.ts`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 4: Implement the lookup**

`site/src/lib/chain-icons.ts`:

```ts
import manifest from '../data/chain-icons.json';

interface IconEntry {
  selector: string;
  file: string;
}

const bySelector = new Map<string, IconEntry>(Object.values(manifest.icons as Record<string, IconEntry>).map((e) => [e.selector, e]));

export function iconHref(selector: string): string | null {
  const entry = bySelector.get(selector);
  return entry ? `/chains/${entry.file}` : null;
}

export function hasIcon(selector: string): boolean {
  return bySelector.has(selector);
}

export function missingIcons(chains: readonly { selector: string; name: string | null }[]): string[] {
  return chains.filter((c) => !bySelector.has(c.selector)).map((c) => c.name ?? c.selector);
}

export function iconFiles(): string[] {
  return [...bySelector.values()].map((e) => e.file);
}
```

`site/src/lib/chain-icons-server.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { iconHref } from './chain-icons';

export function iconDataUri(selector: string, publicDir = join(process.cwd(), 'public')): string | null {
  const href = iconHref(selector);
  return href ? `data:image/svg+xml;base64,${readFileSync(join(publicDir, href), 'base64')}` : null;
}
```

- [ ] **Step 5: Implement the coin math**

`site/src/sky/coins.ts`:

```ts
import { topSelectors } from './weights';

export const COIN_MIN = 18;
export const COIN_MAX = 40;
export const COIN_SCALE = 2.4;
export const COINS_WIDE = 12;
export const COINS_NARROW = 8;
export const NARROW_PX = 640;

export interface Reachable {
  selector: string;
  x: number;
  y: number;
  reach: number;
}

export function coinCount(widthCss: number): number {
  return widthCss < NARROW_PX ? COINS_NARROW : COINS_WIDE;
}

export function coinDiameter(radius: number): number {
  return Math.min(COIN_MAX, Math.max(COIN_MIN, COIN_SCALE * radius));
}

export function coinSelectors(values: Map<string, number>, count: number, hasIcon: (selector: string) => boolean): string[] {
  return topSelectors(new Map([...values].filter(([selector, value]) => value > 0 && hasIcon(selector))), count);
}

export function nearestStar(points: readonly Reachable[], x: number, y: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const p of points) {
    const distance = Math.hypot(p.x - x, p.y - y);
    if (distance <= p.reach && distance < bestDistance) {
      best = p.selector;
      bestDistance = distance;
    }
  }
  return best;
}

export function chainMessages(lanes: readonly { src: string; dst: string; messages: number }[], selector: string): number {
  return lanes.reduce((sum, l) => (l.src === selector || l.dst === selector ? sum + l.messages : sum), 0);
}
```

- [ ] **Step 6: Run both test files and confirm they pass**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/chain-icons.test.ts test/coins.test.ts`
Expected: PASS.

- [ ] **Step 7: Add the failing build-check test**

In `site/test/check-build.test.ts`, add `checkIconFiles` to the import from `'../scripts/check-build'`, and add this block inside `describe('check-build', …)`:

```ts
  it('reports manifest icons missing from dist/chains', () => {
    expect(checkIconFiles(['a.svg', 'b.svg'], new Set(['a.svg']))).toEqual(['/chains/b.svg: icon listed in the manifest is missing from the build']);
    expect(checkIconFiles(['a.svg'], new Set(['a.svg']))).toEqual([]);
  });
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/check-build.test.ts`
Expected: FAIL, because `checkIconFiles` is not exported.

- [ ] **Step 8: Implement the build check**

In `site/scripts/check-build.ts`:
- add `import { existsSync, readdirSync } from 'node:fs';` next to the existing `node:fs/promises` import;
- add `import { iconFiles } from '../src/lib/chain-icons';`;
- add the exported function after `checkPages`:

```ts
export function checkIconFiles(files: readonly string[], present: ReadonlySet<string>): string[] {
  return files.filter((f) => !present.has(f)).map((f) => `/chains/${f}: icon listed in the manifest is missing from the build`);
}
```

In `main()`, replace `const problems = checkPages(pages, methodologyIds, Object.values(METRIC_ANCHORS));` with:

```ts
  const chainsDir = join(dist, 'chains');
  const iconsPresent = new Set(existsSync(chainsDir) ? readdirSync(chainsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : []);
  const problems = [...checkPages(pages, methodologyIds, Object.values(METRIC_ANCHORS)), ...checkIconFiles(iconFiles(), iconsPresent)];
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/check-build.test.ts`
Expected: PASS.

- [ ] **Step 9: Credit the icons on the About page**

In `site/src/pages/about.astro`, insert this paragraph directly after the paragraph that ends with `…how it is measured and how it compares with other sources.` and before the `<p><strong>{DISCLAIMER}…` paragraph:

```astro
    <p>Chain icons: Chainlink documentation. Logos are trademarks of their respective owners.</p>
```

- [ ] **Step 10: Run the suite, typecheck and build**

Run: `pnpm --filter @ccip-dev/site test && pnpm --filter @ccip-dev/site typecheck && pnpm --filter @ccip-dev/site build`
Expected:
- all tests pass;
- the build ends with `check-build: N pages OK` and both budget lines within their limits.

- [ ] **Step 11: Commit**

```bash
git add site/src/lib/chain-icons.ts site/src/lib/chain-icons-server.ts site/src/sky/coins.ts site/scripts/check-build.ts site/src/pages/about.astro site/test/chain-icons.test.ts site/test/coins.test.ts site/test/check-build.test.ts
git commit -m "feat(site): chain icon lookup, coin sizing and selection, build check and credit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Coins on static skies and the card coin data

**Files:**
- Create: `site/src/sky/card-coins.ts`, `site/src/pages/card-coins.json.ts`
- Modify: `site/src/sky/svg.ts`, `site/src/pages/day/[day].astro`, `site/src/pages/index.astro`
- Test: `site/test/svg.test.ts`, `site/test/card-coins.test.ts`

**Interfaces:**
- Consumes:
  - `coinSelectors`, `coinDiameter`, `COINS_WIDE` (Task 2);
  - `iconHref`, `missingIcons` (Task 2);
  - `iconDataUri` (Task 2);
  - `projector`, `StarPoint` from `sky/layout`, and `starRadius` from `sky/weights`.
- Produces:
  - `SkySvgOptions.coins?: { count: number; href: (selector: string) => string | null }`;
  - `CARD_COINS = 8` and `CARD_COIN_SCALE = 1.6`;
  - `interface CardCoin { x: number; y: number; d: number; src: string }`;
  - `cardCoins(o: { width: number; height: number; stars: readonly StarPoint[]; chainValues: Map<string, number>; count: number; src: (selector: string) => string | null }): CardCoin[]`;
  - the build asset `/card-coins.json` with the body `{ "coins": CardCoin[] }`.

- [ ] **Step 1: Write the failing static-sky test**

Append to `site/test/svg.test.ts`. Reuse the imports already at the top of the file. If `buildLayout` is not imported there yet, add it from `'../src/sky/layout'`.

```ts
describe('skySvg coins', () => {
  const stars = buildLayout([
    { selector: 'a', first_day: '2023-07-06' },
    { selector: 'b', first_day: '2023-07-07' },
    { selector: 'c', first_day: '2023-07-08' },
  ]);
  const chainValues = new Map([['a', 300], ['b', 200], ['c', 100]]);
  const href = (s: string) => (s === 'c' ? null : `/chains/${s}.svg`);

  it('draws one clipped coin with a ring per top chain that has an icon', () => {
    const svg = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [], coins: { count: 3, href } });
    expect(svg.match(/<image /g)).toHaveLength(2);
    expect(svg).toContain('href="/chains/a.svg"');
    expect(svg).toContain('href="/chains/b.svg"');
    expect(svg).toContain('<clipPath id="coin-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>');
    expect(svg.match(/clip-path="url\(#coin-clip\)"/g)).toHaveLength(2);
  });

  it('sizes a coin at 2.4 × the star radius', () => {
    const svg = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [], coins: { count: 1, href } });
    expect(svg).toMatch(/<image href="\/chains\/a\.svg" x="[\d.-]+" y="[\d.-]+" width="24" height="24"/);
  });

  it('adds nothing without the coins option', () => {
    const svg = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [] });
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('coin-clip');
  });

  it('moves a coin chain’s label past the coin', () => {
    const labels = new Map([['a', 'Alpha']]);
    const withCoin = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [], labels, labelCount: 1, coins: { count: 1, href } });
    const without = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [], labels, labelCount: 1 });
    const x = (svg: string) => Number(/<text x="([\d.]+)"/.exec(svg)![1]);
    expect(x(withCoin) - x(without)).toBeCloseTo(2, 1);
  });
});
```

The coin-size expectation follows from the inputs. At 700×700, `scale` = 1 and chain `a` has the max value, so its radius is `2 + 8·√1 = 10` and its coin is `coinDiameter(10)` = 24. The label moves from `r + 6` = 16 to `d/2 + 6` = 18, so it shifts by 2.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/svg.test.ts`
Expected: FAIL. The new `coins` option is ignored, so no `<image>` elements are drawn and TypeScript reports the unknown property.

- [ ] **Step 3: Implement coins in `skySvg`**

In `site/src/sky/svg.ts`:
- add `import { coinDiameter, coinSelectors } from './coins';`;
- add this field to `SkySvgOptions`: `coins?: { count: number; href: (selector: string) => string | null };`;
- replace the block from the `for (const s of o.stars)` loop through the end of the labels `if` with:

```ts
  for (const s of o.stars) {
    const p = at.get(s.selector)!;
    const r = radius(s.selector);
    parts.push(
      `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r * 4)}" fill="url(#halo)"/><circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(Math.max(r, 1))}" fill="#e8eaed"/>`,
    );
  }
  const coinSizes = new Map<string, number>();
  if (o.coins) {
    const { href } = o.coins;
    const chosen = coinSelectors(o.chainValues, o.coins.count, (s) => href(s) !== null);
    if (chosen.length > 0) {
      parts.push('<defs><clipPath id="coin-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>');
    }
    for (const selector of chosen) {
      const p = at.get(selector);
      const link = href(selector);
      if (!p || !link) continue;
      const d = coinDiameter(radius(selector));
      coinSizes.set(selector, d);
      parts.push(
        `<image href="${escapeXml(link)}" x="${r1(p.x - d / 2)}" y="${r1(p.y - d / 2)}" width="${r1(d)}" height="${r1(d)}" clip-path="url(#coin-clip)"/>` +
          `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(d / 2)}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1"/>`,
      );
    }
  }
  if (o.labels && o.labelCount) {
    for (const selector of topSelectors(o.chainValues, o.labelCount)) {
      const p = at.get(selector);
      const text = o.labels.get(selector);
      if (!p || !text) continue;
      const offset = (coinSizes.has(selector) ? coinSizes.get(selector)! / 2 : radius(selector)) + 6;
      parts.push(
        `<text x="${r1(p.x + offset)}" y="${r1(p.y + 4)}" fill="#8892a0" font-family="Inter, sans-serif" font-size="12">${escapeXml(text)}</text>`,
      );
    }
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/svg.test.ts`
Expected: PASS, including the existing `skySvg` tests.

- [ ] **Step 5: Write the failing card-coin test**

`site/test/card-coins.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CARD_COIN_SCALE, cardCoins } from '../src/sky/card-coins';
import { coinDiameter } from '../src/sky/coins';
import { buildLayout, projector } from '../src/sky/layout';

const stars = buildLayout([
  { selector: 'a', first_day: '2023-07-06' },
  { selector: 'b', first_day: '2023-07-07' },
  { selector: 'c', first_day: '2023-07-08' },
]);
const chainValues = new Map([['a', 300], ['b', 200], ['c', 100]]);
const src = (s: string) => (s === 'b' ? null : `data:image/svg+xml;base64,${s}`);

describe('cardCoins', () => {
  it('places the top chains with icons at their projected stars', () => {
    const coins = cardCoins({ width: 700, height: 700, stars, chainValues, count: 2, src });
    const [ax, ay] = projector(700, 700, stars)(stars.find((s) => s.selector === 'a')!.x, stars.find((s) => s.selector === 'a')!.y);
    expect(coins.map((c) => c.src)).toEqual(['data:image/svg+xml;base64,a', 'data:image/svg+xml;base64,c']);
    expect(coins[0]!.x).toBeCloseTo(ax, 1);
    expect(coins[0]!.y).toBeCloseTo(ay, 1);
  });

  it('scales coins up for cards', () => {
    const [coin] = cardCoins({ width: 700, height: 700, stars, chainValues, count: 1, src });
    expect(coin!.d).toBeCloseTo(coinDiameter(10) * CARD_COIN_SCALE, 1);
  });

  it('skips chains without an icon and returns nothing for an empty sky', () => {
    expect(cardCoins({ width: 700, height: 700, stars, chainValues, count: 8, src }).some((c) => c.src.endsWith(',b'))).toBe(false);
    expect(cardCoins({ width: 700, height: 700, stars, chainValues: new Map(), count: 8, src })).toEqual([]);
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/card-coins.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 6: Implement the card coins**

`site/src/sky/card-coins.ts`:

```ts
import { coinDiameter, coinSelectors } from './coins';
import { projector, type StarPoint } from './layout';
import { starRadius } from './weights';

export const CARD_COINS = 8;
export const CARD_COIN_SCALE = 1.6;

export interface CardCoin {
  x: number;
  y: number;
  d: number;
  src: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function cardCoins(o: {
  width: number;
  height: number;
  stars: readonly StarPoint[];
  chainValues: Map<string, number>;
  count: number;
  src: (selector: string) => string | null;
}): CardCoin[] {
  const project = projector(o.width, o.height, o.stars);
  const max = Math.max(0, ...o.chainValues.values());
  const scale = Math.min(o.width, o.height) / 700;
  const sources = new Map<string, string | null>();
  const srcOf = (selector: string) => {
    if (!sources.has(selector)) sources.set(selector, o.src(selector));
    return sources.get(selector)!;
  };
  return coinSelectors(o.chainValues, o.count, (s) => srcOf(s) !== null).flatMap((selector) => {
    const star = o.stars.find((s) => s.selector === selector);
    const src = srcOf(selector);
    if (!star || !src) return [];
    const [x, y] = project(star.x, star.y);
    const d = coinDiameter(starRadius(o.chainValues.get(selector) ?? 0, max) * scale) * CARD_COIN_SCALE;
    return [{ x: r1(x), y: r1(y), d: r1(d), src }];
  });
}
```

`site/src/pages/card-coins.json.ts`:

```ts
import type { APIRoute } from 'astro';
import { buildData } from '../lib/build-data';
import { missingIcons } from '../lib/chain-icons';
import { iconDataUri } from '../lib/chain-icons-server';
import { CARD_COINS, cardCoins } from '../sky/card-coins';
import { buildLayout } from '../sky/layout';
import { trailingWeights } from '../sky/weights';

export const GET: APIRoute = async () => {
  const replay = await buildData('replay.json');
  const missing = missingIcons(replay.chains);
  if (missing.length > 0) console.warn(`chain icons missing for ${missing.join(', ')}; run pnpm --filter @ccip-dev/site icons:fetch`);
  const weights = trailingWeights(replay, 30);
  const coins = cardCoins({ width: 640, height: 630, stars: buildLayout(replay.chains), chainValues: weights.chains, count: CARD_COINS, src: (s) => iconDataUri(s) });
  return new Response(JSON.stringify({ coins }), { headers: { 'content-type': 'application/json' } });
};
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/card-coins.test.ts`
Expected: PASS.

The `console.warn` in this endpoint is the build warning spec §5.5 asks for. It names the chains with no icon. It lives here because the endpoint runs once per build with the chain list in hand, which check-build does not have.

- [ ] **Step 7: Put coins on the day-page and home fallback skies**

In `site/src/pages/day/[day].astro`:
- add `import { iconHref } from '../../lib/chain-icons';` and `import { COINS_WIDE } from '../../sky/coins';` to the frontmatter imports;
- add `coins: { count: COINS_WIDE, href: iconHref },` to the `skySvg({ … })` options, after `labelCount: 8,`.

In `site/src/pages/index.astro`:
- add `import { iconHref } from '../lib/chain-icons';` and `import { COINS_WIDE } from '../sky/coins';`;
- add `coins: { count: COINS_WIDE, href: iconHref },` to the `fallbackSvg = skySvg({ … })` options, after `lanes: weights.lanes,`.

- [ ] **Step 8: Run the suite, typecheck and build**

Run: `pnpm --filter @ccip-dev/site test && pnpm --filter @ccip-dev/site typecheck && pnpm --filter @ccip-dev/site build`
Expected: PASS, and `site/dist/card-coins.json` exists. Check it with `node -e "const j=require('./site/dist/card-coins.json'); console.log(j.coins.length, j.coins[0].d, j.coins[0].src.slice(0,30))"`, run from the repo root. Expected: `8 <a number between 28.8 and 34.6> data:image/svg+xml;base64,…`. That range comes from the 640×630 card sky: scale 0.9, coin 18–21.6, times 1.6.

- [ ] **Step 9: Commit**

```bash
git add site/src/sky/svg.ts site/src/sky/card-coins.ts site/src/pages/card-coins.json.ts site/src/pages/day/[day].astro site/src/pages/index.astro site/test/svg.test.ts site/test/card-coins.test.ts
git commit -m "feat(site): coins on day-page and fallback skies; build-time card coin data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 4: Coins on share cards

**Files:**
- Create: `site/worker/test/png.ts`
- Modify: `site/worker/og.ts`, `site/worker/cards/frame.ts`, `site/scripts/render-static-cards.ts`
- Test: `site/test/og.test.ts` (Node), `site/worker/test/render.test.ts` (workerd)

**Interfaces:**
- Consumes: `CardCoin` from `site/src/sky/card-coins.ts` (Task 3), as a type-only import, and the build asset `/card-coins.json` (Task 3).
- Produces:
  - `cardTree(spec, opts: { skyDataUri: string | null; coins: readonly CardCoin[]; sparkDataUri: string | null; sponsorLine: string | null })`;
  - `pngPixel(png: Uint8Array, x: number, y: number): Promise<[number, number, number]>`, a test-only helper.

- [ ] **Step 1: Write the failing Node tests**

In `site/test/og.test.ts`:

1. Give `setup` a fourth parameter, `assets: Record<string, string> = {}`. In its `ASSETS.fetch`, add this line before `return new Response('missing', { status: 404 });`:

```ts
        if (path in assets) return new Response(assets[path]);
```

2. Add this helper below `setup`:

```ts
function imgSrcs(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return [];
  const { type, props } = node as { type?: string; props?: { src?: string; children?: unknown } };
  const own = type === 'img' && typeof props?.src === 'string' ? [props.src] : [];
  const kids = props?.children;
  return [...own, ...(Array.isArray(kids) ? kids.flatMap(imgSrcs) : imgSrcs(kids))];
}
```

3. Add these tests inside `describe('handleOg', …)`:

```ts
  it('places the coins from /card-coins.json on the card', async () => {
    const coins = { coins: [{ x: 100, y: 80, d: 32, src: 'data:image/svg+xml;base64,AAAA' }] };
    const { get, renderPng } = setup({}, [], DATA, { '/card-coins.json': JSON.stringify(coins) });
    expect((await get('/og/home.png')).status).toBe(200);
    expect(imgSrcs(renderPng.mock.calls[0]![0])).toContain('data:image/svg+xml;base64,AAAA');
  });

  it('renders without coins when /card-coins.json is missing, invalid or unsafe', async () => {
    for (const assets of [
      {},
      { '/card-coins.json': '{not json' },
      { '/card-coins.json': JSON.stringify({ coins: [{ x: 1, y: 1, d: 10, src: 'https://evil.example/x.svg' }, { x: 'a', y: 1, d: 10, src: 'data:image/svg+xml;base64,AA' }] }) },
    ]) {
      const { get, renderPng } = setup({}, [], DATA, assets);
      expect((await get('/og/home.png')).status).toBe(200);
      expect(imgSrcs(renderPng.mock.calls[0]![0]).filter((s) => !s.startsWith('data:image/svg+xml;base64,PHN2Zy'))).toEqual([]);
    }
  });
```

The filter in the second test removes the sky's own data URI. `PHN2Zy` is the base64 of `<svg`, and the test sky is `<svg …/>`. The spark is also an `<svg` data URI. So any `src` left over would be a coin.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/og.test.ts`
Expected: the first new test FAILS, because no coin `img` is found. The second already passes, since no coins are drawn yet. That's fine: it pins the failure behavior once coins exist.

- [ ] **Step 2: Write the PNG reader for the workerd test**

`site/worker/test/png.ts`:

```ts
export async function pngPixel(png: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const bitDepth = png[24];
  const colorType = png[25];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG: depth ${bitDepth}, color type ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IDAT') idat.push(png.slice(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = width * channels;
  let prev = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  for (let r = 0; r <= y; r++) {
    const base = r * (stride + 1);
    const filter = raw[base]!;
    row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels]! : 0;
      const up = prev[i]!;
      const upLeft = i >= channels ? prev[i - channels]! : 0;
      const p = left + up - upLeft;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter]!;
      row[i] = (raw[base + 1 + i]! + predictor) & 0xff;
    }
    prev = row;
  }
  return [row[x * channels]!, row[x * channels + 1]!, row[x * channels + 2]!];
}
```

- [ ] **Step 3: Write the failing workerd test**

In `site/worker/test/render.test.ts`:

1. Add `import { pngPixel } from './png';`.

2. Replace the `env` constant with an assets map, so a test can add files:

```ts
const assets: Record<string, string> = { '/card-sky.svg': SKY };
const env = {
  ASSETS: {
    fetch: async (req: Request | string) => {
      const path = new URL(typeof req === 'string' ? req : req.url).pathname;
      return path in assets ? new Response(assets[path]) : new Response('missing', { status: 404 });
    },
  },
};
```

3. In `afterEach`, add `delete assets['/card-coins.json'];`.

4. Add this test inside `describe('site Worker', …)`:

```ts
  it('draws a coin from /card-coins.json onto the real card', async () => {
    const red = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>');
    assets['/card-coins.json'] = JSON.stringify({ coins: [{ x: 560, y: 80, d: 60, src: `data:image/svg+xml;base64,${red}` }] });
    stubData({ 'today.json': today });
    const png = await renderCard('/og/home.png');
    expectPng(png);
    const [r, g, b] = await pngPixel(png, 1200 - 640 + 560, 80);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });
```

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts`
Expected: the new test FAILS, with `r` near the background value (about 12). The other three pass.

- [ ] **Step 4: Implement coin loading and placement**

In `site/worker/og.ts`:
- add `import type { CardCoin } from '../src/sky/card-coins';`;
- add below `skyDataUri`:

```ts
function isCardCoin(value: unknown): value is CardCoin {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  const finite = (k: string) => typeof c[k] === 'number' && Number.isFinite(c[k]);
  return finite('x') && finite('y') && finite('d') && typeof c.src === 'string' && c.src.startsWith('data:image/');
}

async function coinLayer(env: OgEnv, origin: string): Promise<CardCoin[]> {
  const res = await env.ASSETS.fetch(new Request(`${origin}/card-coins.json`));
  if (!res.ok) return [];
  try {
    const body = (await res.json()) as { coins?: unknown };
    return Array.isArray(body.coins) ? body.coins.filter(isCardCoin) : [];
  } catch (err) {
    console.warn(`card-coins.json is unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
```

- in `handleOg`, replace the `const png = await deps.renderPng(…)` statement with:

```ts
    const [sky, coins] = await Promise.all([skyDataUri(env, url.origin), coinLayer(env, url.origin)]);
    const png = await deps.renderPng(
      cardTree(built.spec, {
        skyDataUri: sky,
        coins,
        sparkDataUri: spark ? toDataUri(spark) : null,
        sponsorLine: sponsorView(sponsor).cardLine,
      }),
    );
```

In `site/worker/cards/frame.ts`:
- add `import type { CardCoin } from '../../src/sky/card-coins';`;
- add `const SKY_W = 640;` below `CARD_H`;
- change the `cardTree` signature to `opts: { skyDataUri: string | null; coins: readonly CardCoin[]; sparkDataUri: string | null; sponsorLine: string | null }`;
- replace the sky `img` line with these two lines:

```ts
    opts.skyDataUri ? h('img', { src: opts.skyDataUri, width: SKY_W, height: 630, style: { position: 'absolute', right: 0, top: 0, opacity: 0.6 } }) : null,
    ...opts.coins.map((c) =>
      h('img', {
        src: c.src,
        width: c.d,
        height: c.d,
        style: { position: 'absolute', left: CARD_W - SKY_W + c.x - c.d / 2, top: c.y - c.d / 2, width: c.d, height: c.d, borderRadius: c.d / 2, boxShadow: '0 0 0 1px rgba(255,255,255,0.18)' },
      }),
    ),
```

In `site/scripts/render-static-cards.ts`, change the options object to `{ skyDataUri: null, coins: [], sparkDataUri: null, sponsorLine: null }`.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/og.test.ts && pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts`
Expected: PASS. That covers both new Node tests and the existing ones, and all 4 workerd tests, including the red coin pixel.

- [ ] **Step 5: Run the suite, typecheck and build**

Run: `pnpm --filter @ccip-dev/site test && pnpm --filter @ccip-dev/site typecheck && pnpm --filter @ccip-dev/site build`
Expected: PASS.

- [ ] **Step 6: Look at a real card**

1. Run `pnpm --filter @ccip-dev/site exec wrangler dev --port 8790` in the background. Wait until it prints `Ready`.
2. Run `curl -s -o /tmp/home-card.png http://localhost:8790/og/home.png`.
3. Open the PNG with the Read tool. Expected: up to 8 round chain coins over the faint sky on the right; the text stays on top and readable.
4. Stop `wrangler dev`, and describe what you saw in the report.

- [ ] **Step 7: Commit**

```bash
git add site/worker/og.ts site/worker/cards/frame.ts site/scripts/render-static-cards.ts site/worker/test/png.ts site/worker/test/render.test.ts site/test/og.test.ts
git commit -m "feat(site): share cards show chain coins from the build-time coin data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Coins and the hover card on the home sky

**Files:**
- Create: `site/src/sky/overlay.ts`
- Modify: `site/src/components/home/SkyCanvas.tsx`, `site/src/components/home/HomeLive.tsx`, `site/src/pages/index.astro`, `site/src/styles/home.css`
- Test: `site/test/overlay.test.ts`

**Interfaces:**
- Consumes:
  - `coinDiameter`, `coinSelectors`, `coinCount`, `nearestStar`, `chainMessages`, `Reachable` (Task 2);
  - `iconHref`, `hasIcon` (Task 2);
  - `projector`, `StarPoint` from `sky/layout`, and `starRadius`, `topSelectors` from `sky/weights`.
- Produces:
  - `interface OverlayPoint extends Reachable { d: number }`;
  - `interface OverlayCoin { selector: string; x: number; y: number; d: number }`;
  - `interface OverlayLabel { selector: string; x: number; y: number }`;
  - `skyOverlay(stars: readonly StarPoint[], values: Map<string, number>, width: number, height: number, opts: { coins: number; labels: number; hasIcon: (selector: string) => boolean }): { points: OverlayPoint[]; coins: OverlayCoin[]; labels: OverlayLabel[] }`.

- [ ] **Step 1: Write the failing overlay tests**

`site/test/overlay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildLayout, projector } from '../src/sky/layout';
import { skyOverlay } from '../src/sky/overlay';
import { starRadius } from '../src/sky/weights';

const stars = buildLayout([
  { selector: 'a', first_day: '2023-07-06' },
  { selector: 'b', first_day: '2023-07-07' },
  { selector: 'c', first_day: '2023-07-08' },
]);
const values = new Map([['a', 300], ['b', 200], ['c', 100]]);
const all = () => true;
const at = (selector: string) => {
  const s = stars.find((p) => p.selector === selector)!;
  return projector(700, 700, stars)(s.x, s.y);
};

describe('skyOverlay', () => {
  it('puts coins on the top chains at their projected stars', () => {
    const { coins } = skyOverlay(stars, values, 700, 700, { coins: 2, labels: 0, hasIcon: all });
    const [ax, ay] = at('a');
    expect(coins.map((c) => c.selector)).toEqual(['a', 'b']);
    expect(coins[0]).toEqual({ selector: 'a', x: ax, y: ay, d: 24 });
  });

  it('leaves out chains whose icon is missing or broke', () => {
    const { coins } = skyOverlay(stars, values, 700, 700, { coins: 2, labels: 0, hasIcon: (s) => s !== 'a' });
    expect(coins.map((c) => c.selector)).toEqual(['b', 'c']);
  });

  it('moves a coin chain’s label past its coin and keeps others beside their star', () => {
    const { labels } = skyOverlay(stars, values, 700, 700, { coins: 1, labels: 3, hasIcon: all });
    const [ax] = at('a');
    const [cx] = at('c');
    const rc = starRadius(100, 300);
    expect(labels.find((l) => l.selector === 'a')!.x).toBeCloseTo(ax + 18, 5);
    expect(labels.find((l) => l.selector === 'c')!.x).toBeCloseTo(cx + Math.max(10, rc + 6), 5);
  });

  it('gives every star a hover reach of at least 12 px', () => {
    const { points } = skyOverlay(stars, values, 700, 700, { coins: 0, labels: 0, hasIcon: all });
    expect(points.find((p) => p.selector === 'a')!.reach).toBe(16);
    expect(points.every((p) => p.reach >= 12)).toBe(true);
  });
});
```

The numbers follow from the inputs. At 700×700, scale is 1 and `a` has the max value, so its radius is 10, its coin is 24, its label offset is `24/2 + 6` = 18, and its reach is `max(12, 24/2 + 4)` = 16.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/overlay.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement the overlay**

`site/src/sky/overlay.ts`:

```ts
import { coinDiameter, coinSelectors, type Reachable } from './coins';
import { projector, type StarPoint } from './layout';
import { starRadius, topSelectors } from './weights';

export interface OverlayPoint extends Reachable {
  d: number;
}

export interface OverlayCoin {
  selector: string;
  x: number;
  y: number;
  d: number;
}

export interface OverlayLabel {
  selector: string;
  x: number;
  y: number;
}

export function skyOverlay(
  stars: readonly StarPoint[],
  values: Map<string, number>,
  width: number,
  height: number,
  opts: { coins: number; labels: number; hasIcon: (selector: string) => boolean },
): { points: OverlayPoint[]; coins: OverlayCoin[]; labels: OverlayLabel[] } {
  const project = projector(width, height, stars);
  const max = Math.max(0, ...values.values());
  const scale = Math.min(width, height) / 700;
  const placed = stars.map((s) => {
    const [x, y] = project(s.x, s.y);
    const r = starRadius(values.get(s.selector) ?? 0, max) * scale;
    const d = coinDiameter(r);
    return { selector: s.selector, x, y, r, d, reach: Math.max(12, d / 2 + 4) };
  });
  const bySelector = new Map(placed.map((p) => [p.selector, p]));
  const coins = coinSelectors(values, opts.coins, opts.hasIcon).flatMap((selector) => {
    const p = bySelector.get(selector);
    return p ? [{ selector, x: p.x, y: p.y, d: p.d }] : [];
  });
  const withCoin = new Set(coins.map((c) => c.selector));
  const labels = topSelectors(values, opts.labels).flatMap((selector) => {
    const p = bySelector.get(selector);
    return p ? [{ selector, x: p.x + Math.max(10, (withCoin.has(selector) ? p.d / 2 : p.r) + 6), y: p.y }] : [];
  });
  return { points: placed.map(({ selector, x, y, d, reach }) => ({ selector, x, y, d, reach })), coins, labels };
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/overlay.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Pass lane message counts to the sky**

In `site/src/pages/index.astro`, change the `lanes` prop of `<HomeLive>` to:

```astro
    lanes={weights.lanes.map(({ src, dst, usd, messages }) => ({ src, dst, usd, messages }))}
```

In `site/src/components/home/HomeLive.tsx`, change the props type entry `lanes: { src: string; dst: string; usd: number }[];` to `lanes: { src: string; dst: string; usd: number; messages: number }[];`.

In `site/src/components/home/SkyCanvas.tsx`, change the same entry in `Props` the same way.

- [ ] **Step 4: Draw the coins and the hover card in `SkyCanvas`**

Edit `site/src/components/home/SkyCanvas.tsx`.

1. Update the imports:
   - add `formatCount` to the `../../lib/format` import;
   - add `import { hasIcon, iconHref } from '../../lib/chain-icons';`;
   - add `import { chainMessages, coinCount, nearestStar } from '../../sky/coins';`;
   - add `import { skyOverlay, type OverlayCoin, type OverlayPoint } from '../../sky/overlay';`;
   - remove the `topSelectors` import, which is now unused.

2. Below the existing `labels` state, add:

```tsx
  const [coins, setCoins] = useState<OverlayCoin[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const pointsRef = useRef<OverlayPoint[]>([]);
  const widthRef = useRef(0);
  const brokenRef = useRef(new Set<string>());
```

3. In `resize`, replace these lines:

```tsx
      const css = projector(wrap.clientWidth, wrap.clientHeight, scene.starPoints);
      const count = wrap.clientWidth < 640 ? 6 : 12;
      setLabels(
        topSelectors(new Map(latest.current.chainValues), count).flatMap((selector) => {
          const star = scene.starPoints.find((s) => s.selector === selector);
          if (!star) return [];
          const [x, y] = css(star.x, star.y);
          return [{ selector, text: chainName(latest.current.names, selector), x, y }];
        }),
      );
```

   with:

```tsx
      const overlay = skyOverlay(scene.starPoints, new Map(latest.current.chainValues), wrap.clientWidth, wrap.clientHeight, {
        coins: coinCount(wrap.clientWidth),
        labels: wrap.clientWidth < 640 ? 6 : 12,
        hasIcon: (s) => hasIcon(s) && !brokenRef.current.has(s),
      });
      pointsRef.current = overlay.points;
      widthRef.current = wrap.clientWidth;
      setCoins(overlay.coins);
      setLabels(overlay.labels.map((l) => ({ ...l, text: chainName(latest.current.names, l.selector) })));
```

4. Add this effect after the main effect. It closes the card on Escape, on scroll, and on a press outside the sky:

```tsx
  useEffect(() => {
    if (hover === null) return;
    const close = () => setHover(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, { passive: true });
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [hover]);
```

5. Add these helpers before `return (`:

```tsx
  const pick = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return nearestStar(pointsRef.current, clientX - rect.left, clientY - rect.top);
  };
  const dropCoin = (selector: string) => {
    brokenRef.current.add(selector);
    setCoins((cs) => cs.filter((c) => c.selector !== selector));
  };
  const hovered = hover === null ? undefined : pointsRef.current.find((p) => p.selector === hover);
  const values = new Map(props.chainValues);
  const shownCoins =
    hovered && hasIcon(hovered.selector) && !brokenRef.current.has(hovered.selector) && !coins.some((c) => c.selector === hovered.selector)
      ? [...coins, { selector: hovered.selector, x: hovered.x, y: hovered.y, d: hovered.d }]
      : coins;
```

6. Replace the returned JSX with:

```tsx
  return (
    <div
      className="sky-wrap"
      ref={wrapRef}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') setHover(pick(e.clientX, e.clientY));
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHover(null);
      }}
      onClick={(e) => {
        if ((e.nativeEvent as PointerEvent).pointerType === 'mouse') return;
        const next = pick(e.clientX, e.clientY);
        setHover((current) => (next === current ? null : next));
      }}
    >
      <canvas key={canvasKey} aria-hidden="true" />
      <div className="sky-coins" aria-hidden="true">
        {shownCoins.map((c) => (
          <img
            key={c.selector}
            src={iconHref(c.selector) ?? undefined}
            alt=""
            width={Math.round(c.d)}
            height={Math.round(c.d)}
            decoding="async"
            style={{ left: c.x, top: c.y }}
            onError={() => dropCoin(c.selector)}
          />
        ))}
      </div>
      <div className="sky-labels" aria-hidden="true">
        {labels.map((l) => (
          <span key={l.selector} style={{ left: l.x, top: l.y }}>
            {l.text}
          </span>
        ))}
      </div>
      {hovered && (
        <div className={`sky-card card${hovered.x > widthRef.current - 300 ? ' flip' : ''}`} aria-hidden="true" style={{ left: hovered.x, top: hovered.y }}>
          {hasIcon(hovered.selector) && <img src={iconHref(hovered.selector)!} alt="" width={40} height={40} />}
          <div>
            <strong>{chainName(props.names, hovered.selector)}</strong>
            <span className="muted">
              {formatUsd(values.get(hovered.selector) ?? 0)} moved · {formatCount(chainMessages(props.lanes, hovered.selector))} messages · 30 days
            </span>
          </div>
        </div>
      )}
    </div>
  );
```

- [ ] **Step 5: Style the coins and the card**

In `site/src/styles/home.css`, replace the `.sky-labels span` rule with:

```css
.sky-labels span { position: absolute; transform: translate(0, -50%); font-size: 12px; color: var(--muted); pointer-events: none; white-space: nowrap; }
.sky-coins img { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18); pointer-events: none; }
.sky-card { position: absolute; z-index: 2; transform: translate(24px, -50%); display: flex; gap: 10px; align-items: center; max-width: 260px; padding: 10px 12px; pointer-events: none; }
.sky-card.flip { transform: translate(calc(-100% - 24px), -50%); }
.sky-card img { flex: none; border-radius: 50%; }
.sky-card strong { display: block; }
.sky-card .muted { font-size: 12px; }
```

- [ ] **Step 6: Run the suite, typecheck and build**

Run: `pnpm --filter @ccip-dev/site test && pnpm --filter @ccip-dev/site typecheck && pnpm --filter @ccip-dev/site build`
Expected:
- PASS;
- the home budget line stays under 150 KB;
- check-budgets prints the new home figure; quote it in the report.

- [ ] **Step 7: Check it in a browser**

1. Run `pnpm --filter @ccip-dev/site exec astro preview --port 4321` in the background.
2. Load the chrome-devtools MCP tools: ToolSearch with the query `chrome-devtools`, max_results 30.
3. Open `http://localhost:4321/`, wait 5 s and take a screenshot at 1440×900, then again at 390×844.
4. Expected: about 12 round coins (8 at 390) on the biggest stars; name labels beside them, not on top; no horizontal scroll at 390. Check `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
5. Dispatch a mouse `pointermove` over a coin's center with `evaluate_script`. Read the coin's center from the `.sky-coins img` element's `getBoundingClientRect()`. Take a screenshot.
6. Expected: a card beside the coin with the 40 px logo, the chain name and a line like `$1.2B moved · 12,345 messages · 30 days`.
7. Stop the preview, and describe what you saw in the report.

- [ ] **Step 8: Commit**

```bash
git add site/src/sky/overlay.ts site/test/overlay.test.ts site/src/components/home/SkyCanvas.tsx site/src/components/home/HomeLive.tsx site/src/pages/index.astro site/src/styles/home.css
git commit -m "feat(site): home sky wears chain coins and shows a chain card on hover or tap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 6: Coins on the replay and in recordings

**Files:**
- Create: `site/src/replay/coin-images.ts`
- Modify: `site/src/replay/timeline.ts`, `site/src/replay/compose.ts`, `site/src/replay/player.tsx`
- Test: `site/test/timeline.test.ts`, `site/test/compose.test.ts`, `site/test/coin-images.test.ts`

**Interfaces:**
- Consumes: `coinSelectors`, `coinDiameter` (Task 2) and `iconHref`, `hasIcon` (Task 2).
- Produces:
  - from `timeline.ts`:
    - the constants `REPLAY_COINS = 12` and `COIN_FADE_S = 0.5`;
    - `interface FrameCoin { star: number; selector: string; alpha: number }`;
    - `interface CoinOptions { count: number; eligible: (selector: string) => boolean }`;
    - `ReplayFrameState.coins: FrameCoin[]`;
    - the constructor `new ReplayModel(replay, history, milestones, stars, length, coinOptions?)`;
  - from `compose.ts`:
    - `REPLAY_COIN_UNIT = 800`;
    - `interface DrawnCoin { x: number; y: number; d: number; alpha: number; image: CanvasImageSource }`;
    - `drawCoins(ctx, coins: readonly DrawnCoin[]): void`;
    - `ReplayCompositor.setCoinImages(images: ReadonlyMap<string, CanvasImageSource>): void`;
  - from `coin-images.ts`:
    - `COIN_RASTER_PX = 128` and `COIN_WAIT_MS = 5000`;
    - `sizedSvg(svg: string, size: number): string`;
    - `loadCoinImage(href: string, size?: number): Promise<HTMLCanvasElement>`;
    - `loadCoinImages(hrefs: ReadonlyMap<string, string>, load?: (href: string) => Promise<CanvasImageSource>): Promise<Map<string, CanvasImageSource>>`;
    - `settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T>`.

- [ ] **Step 1: Write the failing timeline tests**

The fixture `test/fixtures/replay.json` has 4 days, so a 60 s replay gives each day 15 s. These are each day's 30-day USD values by chain:

| Day | Ethereum | Polygon | Base | Solana | Top chain (count 1) |
|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 | none; values of 0 never get coins |
| 1 | 1,500 | 1,500 | 0 | 0 | Polygon; the tie goes to selector `'4051…'` < `'5009…'` |
| 2 | 1,503,500 | 3,500 | 1,500,000 | 0 | Ethereum |
| 3 | 1,504,500 | 3,500 | 1,500,700 | 300 | Ethereum |

Append to `site/test/timeline.test.ts`:

```ts
const POLYGON = '4051577828743386545';
const ETHEREUM = '5009297550715157269';
const coinModel = (eligible: (selector: string) => boolean = () => true) => new ReplayModel(replay, history, [], stars, 60, { count: 1, eligible });
const coinsAt = (m: ReplayModel, t: number) => m.frameAt(t).coins.map((c) => [c.selector, Number(c.alpha.toFixed(3))]).sort();

describe('replay coins', () => {
  it('shows no coin while no chain has value', () => {
    expect(coinModel().frameAt(0).coins).toEqual([]);
    expect(coinModel().frameAt(14).coins).toEqual([]);
  });

  it('fades the day’s top chain in over half a second', () => {
    const m = coinModel();
    expect(coinsAt(m, m.dayStart(1) + 0.25)).toEqual([[POLYGON, 0.5]]);
    expect(coinsAt(m, m.dayStart(1) + 0.6)).toEqual([[POLYGON, 1]]);
  });

  it('cross-fades when the top chain changes', () => {
    const m = coinModel();
    expect(coinsAt(m, m.dayStart(2) + 0.25)).toEqual([[POLYGON, 0.5], [ETHEREUM, 0.5]].sort());
    expect(coinsAt(m, m.dayStart(2) + 0.6)).toEqual([[ETHEREUM, 1]]);
  });

  it('only gives coins to eligible chains', () => {
    const m = coinModel((s) => s !== POLYGON);
    expect(coinsAt(m, m.dayStart(1) + 0.6)).toEqual([[ETHEREUM, 1]]);
  });

  it('is a pure function of t and holds through the end card', () => {
    const m = coinModel();
    expect(m.frameAt(31.3).coins).toEqual(m.frameAt(31.3).coins);
    expect(coinsAt(m, m.duration)).toEqual([[ETHEREUM, 1]]);
  });

  it('fades a chain that flickers at the cutoff instead of strobing it', () => {
    const flicker: ReplayFile = {
      ...replay,
      since: '2024-01-01',
      chains: [
        { selector: 'A', name: 'a-mainnet', display_name: 'A', first_day: '2024-01-01' },
        { selector: 'B', name: 'b-mainnet', display_name: 'B', first_day: '2024-01-01' },
      ],
      lanes: [[0, 0], [1, 1]],
      days: [
        { day: '2024-01-01', lanes: [[0, 1, 50]] },
        { day: '2024-01-02', lanes: [[1, 1, 75]] },
        { day: '2024-01-03', lanes: [[0, 1, 50]] },
        { day: '2024-01-04', lanes: [[1, 1, 50]] },
      ],
    };
    const m = new ReplayModel(flicker, [], [], buildLayout(flicker.chains), 1, { count: 1, eligible: () => true });
    expect(coinsAt(m, 0.75)).toEqual([['A', 0.5], ['B', 0.5]]);
  });
});
```

The flicker case uses self-lanes, which count twice toward their chain, as in `frameAt`. The leader is A, then B, then A, then B, with values 100, 150, 200 and 250. At 0.25 s per day, the 0.5 s window ending at 0.75 s covers day 1 (B) and day 2 (A) equally, so both coins sit at half alpha.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/timeline.test.ts`
Expected: FAIL. `coins` is undefined, and TypeScript reports the extra constructor argument.

- [ ] **Step 2: Implement coins in the timeline**

In `site/src/replay/timeline.ts`:
- add `import { coinSelectors } from '../sky/coins';`;
- add below `MAX_REPLAY_COMETS`:

```ts
export const REPLAY_COINS = 12;
export const COIN_FADE_S = 0.5;
```

- add below `easeOutCubic`:

```ts
const smoothstep = (x: number) => x * x * (3 - 2 * x);
```

- add these interfaces above `ReplayFrameState`:

```ts
export interface FrameCoin {
  star: number;
  selector: string;
  alpha: number;
}

export interface CoinOptions {
  count: number;
  eligible: (selector: string) => boolean;
}
```

- add `coins: FrameCoin[];` to `ReplayFrameState`, after `extent`;
- add the field `private readonly coinSets: number[][];` to `ReplayModel`;
- add the constructor parameter `coinOptions: CoinOptions = { count: REPLAY_COINS, eligible: () => true },` after `length: number,`;
- as the last statement of the constructor, add `this.coinSets = this.dailyCoinSets(coinOptions);`;
- add these private methods after `spawns`:

```ts
  private dailyCoinSets(opts: CoinOptions): number[][] {
    const values = new Map<string, number>();
    const starBySelector = new Map(this.stars.map((s, i) => [s.selector, i]));
    const shift = (dayIndex: number, sign: 1 | -1) => {
      for (const [lane, , usd] of this.lanesByDay.get(this.days[dayIndex]!) ?? []) {
        for (const chain of this.replay.lanes[lane] ?? []) {
          const star = this.starOfChain[chain] ?? -1;
          if (star < 0) continue;
          const selector = this.stars[star]!.selector;
          values.set(selector, (values.get(selector) ?? 0) + sign * usd);
        }
      }
    };
    return this.days.map((_, d) => {
      shift(d, 1);
      if (d >= STAR_WINDOW_DAYS) shift(d - STAR_WINDOW_DAYS, -1);
      return coinSelectors(values, opts.count, opts.eligible).map((selector) => starBySelector.get(selector)!);
    });
  }

  private coinsAt(time: number): FrameCoin[] {
    const end = Math.min(time, this.length - 1e-9);
    const start = end - COIN_FADE_S;
    const firstDay = Math.max(0, Math.floor(Math.max(0, start) / this.secondsPerDay));
    const lastDay = Math.min(this.days.length - 1, Math.floor(Math.max(0, end) / this.secondsPerDay));
    const share = new Map<number, number>();
    for (let d = firstDay; d <= lastDay; d++) {
      const overlap = Math.min(end, this.dayStart(d + 1)) - Math.max(start, this.dayStart(d));
      if (overlap <= 0) continue;
      for (const star of this.coinSets[d]!) share.set(star, (share.get(star) ?? 0) + overlap / COIN_FADE_S);
    }
    return [...share]
      .sort(([a], [b]) => a - b)
      .map(([star, m]) => ({ star, selector: this.stars[star]!.selector, alpha: smoothstep(Math.min(1, m)) }));
  }
```

- in `frameAt`, add `coins: []` to the early `return` for an empty replay, and `coins: this.coinsAt(time),` to the final `return`, after `extent,`.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/timeline.test.ts`
Expected: PASS, both the new tests and the existing ones.

- [ ] **Step 3: Write the failing compositor and image tests**

In `site/test/compose.test.ts`:
- add `coins: [],` to the object the `state` helper returns, after `extent: 1,`;
- add `drawCoins` to the import from `'../src/replay/compose'`;
- append:

```ts
const coinTarget = (drawn: unknown[][], alphas: number[]) =>
  ({
    fillRect: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }),
    save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(),
    drawImage: (...args: unknown[]) => drawn.push(args),
    set globalAlpha(v: number) { alphas.push(v); },
    set font(_v: string) {}, set fillStyle(_v: unknown) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    set strokeStyle(_v: string) {}, set lineWidth(_v: number) {},
  }) as unknown as CanvasRenderingContext2D;

describe('drawCoins', () => {
  it('draws each coin centered at its alpha with a ring', () => {
    const drawn: unknown[][] = [];
    const alphas: number[] = [];
    const image = { tag: 'coin' } as unknown as CanvasImageSource;
    drawCoins(coinTarget(drawn, alphas), [{ x: 100, y: 50, d: 20, alpha: 0.5, image }]);
    expect(drawn).toEqual([[image, 90, 40, 20, 20]]);
    expect(alphas).toEqual([0.5]);
  });
});

describe('ReplayCompositor coins', () => {
  it('draws a coin over its star once its image is set', () => {
    const frame: ReplayFrameState = {
      ...state(false),
      coins: [{ star: 0, selector: 'a', alpha: 1 }],
      sky: { stars: [{ x: 0, y: 0, radius: 10, brightness: 1, flash: 0 }], lanes: [], comets: [], rings: [] },
    };
    const model = { frameAt: () => frame } as unknown as ReplayModel;
    const drawn: unknown[][] = [];
    const target = coinTarget(drawn, []);
    const compositor = new ReplayCompositor(model, [{ selector: 'a', x: 0, y: 0 }], '2023-07-06', '2026-10-06', () => ({ width: 800, height: 800 }) as never);
    compositor.draw(1, target, 800, 800);
    expect(drawn).toHaveLength(1);
    const image = { tag: 'coin' } as unknown as CanvasImageSource;
    compositor.setCoinImages(new Map([['a', image]]));
    compositor.draw(1, target, 800, 800);
    expect(drawn.find((args) => args[0] === image)).toEqual([image, 388, 388, 24, 24]);
  });
});
```

The expected position follows from the setup. At 800×800, the star at (0, 0) projects to (400, 400). The unit is 800 / `REPLAY_COIN_UNIT` = 1, and `coinDiameter(10)` = 24, so the coin draws at (388, 388), 24 px wide.

`site/test/coin-images.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { loadCoinImages, settleWithin, sizedSvg } from '../src/replay/coin-images';

describe('sizedSvg', () => {
  it('sets the root size and keeps the viewBox and children', () => {
    expect(sizedSvg('<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32"/></svg>', 128)).toBe(
      '<svg width="128" height="128" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32"/></svg>',
    );
  });

  it('adds a size to a root without one', () => {
    expect(sizedSvg('<svg viewBox="0 0 32 32"/>', 64)).toBe('<svg width="64" height="64" viewBox="0 0 32 32"/>');
  });
});

describe('loadCoinImages', () => {
  it('keeps the icons that load and skips one that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = { tag: 'ok' } as unknown as CanvasImageSource;
    const images = await loadCoinImages(new Map([['a', '/chains/a.svg'], ['b', '/chains/b.svg']]), async (href) => {
      if (href.endsWith('b.svg')) throw new Error('HTTP 404');
      return ok;
    });
    expect([...images]).toEqual([['a', ok]]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('settleWithin', () => {
  it('resolves with the promise when it is fast enough', async () => {
    await expect(settleWithin(Promise.resolve('fast'), 50, 'slow')).resolves.toBe('fast');
  });

  it('falls back after the timeout', async () => {
    vi.useFakeTimers();
    const pending = settleWithin(new Promise<string>(() => {}), 5_000, 'fallback');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBe('fallback');
    vi.useRealTimers();
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/compose.test.ts test/coin-images.test.ts`
Expected: FAIL. `drawCoins`, `setCoinImages` and the `coin-images` module don't exist yet.

- [ ] **Step 4: Implement the compositor coins and image loading**

In `site/src/replay/compose.ts`:
- change the layout import to `import { projector, type Projector, type StarPoint } from '../sky/layout';`;
- add `import { coinDiameter } from '../sky/coins';`;
- add below the `Ctx2d` type:

```ts
export const REPLAY_COIN_UNIT = 800;

export interface DrawnCoin {
  x: number;
  y: number;
  d: number;
  alpha: number;
  image: CanvasImageSource;
}

export function drawCoins(ctx: Ctx2d, coins: readonly DrawnCoin[]): void {
  ctx.save();
  for (const c of coins) {
    ctx.globalAlpha = c.alpha;
    ctx.drawImage(c.image, c.x - c.d / 2, c.y - c.d / 2, c.d, c.d);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.d / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = Math.max(1, c.d / 40);
    ctx.stroke();
  }
  ctx.restore();
}
```

- in `ReplayCompositor`, add the field `private coinImages: ReadonlyMap<string, CanvasImageSource> = new Map();` and these methods before `destroy`:

```ts
  setCoinImages(images: ReadonlyMap<string, CanvasImageSource>): void {
    this.coinImages = images;
  }

  private placeCoins(state: ReplayFrameState, project: Projector, width: number, height: number): DrawnCoin[] {
    const unit = Math.min(width, height) / REPLAY_COIN_UNIT;
    return state.coins.flatMap((c) => {
      const image = this.coinImages.get(c.selector);
      const star = state.sky.stars[c.star];
      if (!image || !star || star.radius <= 0) return [];
      const [x, y] = project(star.x, star.y);
      return [{ x, y, d: coinDiameter(star.radius) * unit, alpha: c.alpha, image }];
    });
  }
```

- in `draw`, replace the `this.renderer.draw(...)` line with:

```ts
    const project = projector(width, height, this.stars, undefined, state.extent);
    this.renderer.draw(state.sky, project, Math.min(width, height) / 1000);
```

- also in `draw`, add `drawCoins(target, this.placeCoins(state, project, width, height));` between `target.drawImage(this.skyCanvas, 0, 0);` and `drawOverlay(...)`.

`site/src/replay/coin-images.ts`:

```ts
export const COIN_RASTER_PX = 128;
export const COIN_WAIT_MS = 5_000;

export function sizedSvg(svg: string, size: number): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, '').replace(/^<svg/, `<svg width="${size}" height="${size}"`));
}

export async function loadCoinImage(href: string, size = COIN_RASTER_PX): Promise<HTMLCanvasElement> {
  const res = await fetch(href);
  if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`);
  const url = URL.createObjectURL(new Blob([sizedSvg(await res.text(), size)], { type: 'image/svg+xml' }));
  try {
    const img = new Image(size, size);
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, 0, 0, size, size);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadCoinImages(
  hrefs: ReadonlyMap<string, string>,
  load: (href: string) => Promise<CanvasImageSource> = loadCoinImage,
): Promise<Map<string, CanvasImageSource>> {
  const entries = [...hrefs];
  const settled = await Promise.allSettled(entries.map(([, href]) => load(href)));
  const images = new Map<string, CanvasImageSource>();
  settled.forEach((result, i) => {
    const [selector, href] = entries[i]!;
    if (result.status === 'fulfilled') images.set(selector, result.value);
    else console.warn(`coin icon ${href} failed to load`, result.reason);
  });
  return images;
}

export function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/compose.test.ts test/coin-images.test.ts test/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the player**

In `site/src/replay/player.tsx`:

1. Update the imports:
   - add `import { hasIcon, iconHref } from '../lib/chain-icons';`;
   - add `import { COIN_WAIT_MS, loadCoinImages, settleWithin } from './coin-images';`;
   - change the timeline import to `import { REPLAY_COINS, REPLAY_LENGTHS, ReplayModel, type ReplayLength } from './timeline';`.

2. Below the `compositor` state, add:

```tsx
  const [coinImages, setCoinImages] = useState<ReadonlyMap<string, CanvasImageSource>>(new Map());
  const coinLoadRef = useRef<Promise<ReadonlyMap<string, CanvasImageSource>> | null>(null);
```

3. In the `model` `useMemo`, pass the coin options as the sixth argument:

```tsx
    () => (data ? new ReplayModel(data.replay, data.history, computeMilestones(data.history, data.replay.chains), stars, length, { count: REPLAY_COINS, eligible: hasIcon }) : null),
```

4. After the data-loading effect, add:

```tsx
  useEffect(() => {
    if (!data) return;
    let alive = true;
    const hrefs = new Map(
      data.replay.chains.flatMap((c) => {
        const href = iconHref(c.selector);
        return href ? [[c.selector, href] as const] : [];
      }),
    );
    const load = loadCoinImages(hrefs);
    coinLoadRef.current = load;
    void load.then((images) => {
      if (alive) setCoinImages(images);
    });
    return () => {
      alive = false;
    };
  }, [data]);
```

5. After the `drawFrame` `useCallback`, add:

```tsx
  useEffect(() => {
    if (!compositor) return;
    compositor.setCoinImages(coinImages);
    drawFrame();
  }, [compositor, coinImages, drawFrame]);
```

6. In `record`, directly after `recorder = new ReplayCompositor(...)`, add:

```tsx
      recorder.setCoinImages(await settleWithin(coinLoadRef.current ?? Promise.resolve(new Map()), COIN_WAIT_MS, new Map()));
```

- [ ] **Step 6: Run the suite, typecheck and build**

Run: `pnpm --filter @ccip-dev/site test && pnpm --filter @ccip-dev/site typecheck && pnpm --filter @ccip-dev/site build`
Expected:
- PASS;
- the replay budget line stays under 200 KB; quote it in the report.

- [ ] **Step 7: Check it in a browser**

1. Run `pnpm --filter @ccip-dev/site exec astro preview --port 4321` in the background.
2. Load the chrome-devtools tools: ToolSearch with the query `chrome-devtools`, max_results 30.
3. Open `http://localhost:4321/replay/` and press Play. Take a screenshot after about 20 s and again after about 40 s.
4. Expected: round chain coins on the biggest stars, a different set in the two shots, no console errors, and the network list shows `/chains/*.svg` requests with 200s.
5. Stop the preview and describe what you saw in the report.

The controller checks a recorded MP4.

- [ ] **Step 8: Commit**

```bash
git add site/src/replay/timeline.ts site/src/replay/compose.ts site/src/replay/coin-images.ts site/src/replay/player.tsx site/test/timeline.test.ts site/test/compose.test.ts site/test/coin-images.test.ts
git commit -m "feat(site): replay and its recordings show coins for the busiest chains

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Chain icons in lists

**Files:**
- Create: `site/src/components/ChainIcons.tsx`, `site/src/components/ChainIcons.astro`
- Modify:
  - `site/src/lib/names.ts`, `site/src/lib/top.ts`, `site/src/lib/registry.ts`, `site/src/lib/flow.ts`;
  - `site/src/components/home/Feed.tsx`, `site/src/components/FlowChord.tsx`;
  - `site/src/pages/top/[dim]/[window].astro`, `site/src/pages/chains.astro`, `site/src/pages/flow/[window].astro`;
  - `site/src/styles/base.css`.
- Test: `site/test/names.test.ts`, `site/test/top.test.ts`, `site/test/registry.test.ts`, `site/test/flow.test.ts`

**Interfaces:**
- Consumes: `iconHref` (Task 2).
- Produces:
  - `keyChains(key: string): string[]`;
  - `TopRow.chains: string[]`;
  - `TokenRow.chainSelector: string`;
  - `FlowData.topLanes[i].src` and `.dst`;
  - the components `<ChainIcons selectors={string[]} size?={number} />` in `.tsx` and `.astro` versions.

- [ ] **Step 1: Write the failing data tests**

1. In `site/test/names.test.ts`, add `keyChains` to the import from `'../src/lib/names'` and append:

```ts
describe('keyChains', () => {
  it('reads both ends of a lane key', () => {
    expect(keyChains('1>2')).toEqual(['1', '2']);
  });

  it('reads the chain of a token or sender key', () => {
    expect(keyChains('5009297550715157269:0xabc')).toEqual(['5009297550715157269']);
  });

  it('returns nothing for a key without a chain', () => {
    expect(keyChains('0xabc')).toEqual([]);
    expect(keyChains('1>2>3')).toEqual([]);
  });
});
```

2. In `site/test/top.test.ts`:
   - add `chains: [<src>, <dst>]` to every existing lane-row expectation that uses `toEqual`, with the selectors from that row's key;
   - add `chains: [<chain>]` to every token-row and sender-row expectation, with the selector before the `:`;
   - add one assertion that a lane row's `chains` equals the two selectors of its key.

3. In `site/test/registry.test.ts`, add `chainSelector: <the token's chain selector>` to every `tokenRows` expectation.

4. In `site/test/flow.test.ts`, add `src` and `dst` to every `topLanes` expectation, and add one assertion that `topLanes[0]` carries the `src` and `dst` of the busiest lane.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/names.test.ts test/top.test.ts test/registry.test.ts test/flow.test.ts`
Expected: FAIL, because the fields and `keyChains` do not exist yet.

- [ ] **Step 2: Implement the data changes**

In `site/src/lib/names.ts`, append:

```ts
export function keyChains(key: string): string[] {
  const ends = key.split('>');
  if (ends.length === 2 && ends[0] && ends[1]) return [ends[0], ends[1]];
  const split = key.indexOf(':');
  return split > 0 ? [key.slice(0, split)] : [];
}
```

In `site/src/lib/top.ts`:
- import `keyChains` from `'./names'`;
- add `chains: string[];` to `TopRow`;
- in `topRows`, add `chains: keyChains(e.key),` to the returned object, after `...label,`.

In `site/src/lib/registry.ts`:
- add `chainSelector: string;` to `TokenRow`;
- in `tokenRows`, add `chainSelector: t.chain,` after `chain: chainName(names, t.chain),`.

In `site/src/lib/flow.ts`:
- change the `topLanes` type in `FlowData` to `{ label: string; src: string; dst: string; usd: number; messages: number }[]`;
- change the final `.map` to `.map((l) => ({ label: laneLabel(names, `${l.src}>${l.dst}`), src: l.src, dst: l.dst, usd: l.usd, messages: l.messages }))`.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/names.test.ts test/top.test.ts test/registry.test.ts test/flow.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the components and their style**

`site/src/components/ChainIcons.tsx`:

```tsx
import { iconHref } from '../lib/chain-icons';

export default function ChainIcons({ selectors, size = 16 }: { selectors: readonly string[]; size?: number }) {
  const hrefs = selectors.flatMap((s) => {
    const href = iconHref(s);
    return href ? [href] : [];
  });
  if (hrefs.length === 0) return null;
  return (
    <span className="chain-icons" aria-hidden="true">
      {hrefs.map((href, i) => (
        <img key={`${i}-${href}`} src={href} alt="" width={size} height={size} loading="lazy" decoding="async" style={i > 0 ? { marginLeft: -size / 4 } : undefined} />
      ))}
    </span>
  );
}
```

`site/src/components/ChainIcons.astro`:

```astro
---
import { iconHref } from '../lib/chain-icons';

interface Props {
  selectors: readonly string[];
  size?: number;
}

const { selectors, size = 16 } = Astro.props;
const hrefs = selectors.flatMap((s) => {
  const href = iconHref(s);
  return href ? [href] : [];
});
---

{
  hrefs.length > 0 && (
    <span class="chain-icons" aria-hidden="true">
      {hrefs.map((href, i) => (
        <img src={href} alt="" width={size} height={size} loading="lazy" decoding="async" style={i > 0 ? `margin-left: ${-size / 4}px` : undefined} />
      ))}
    </span>
  )
}
```

Append to `site/src/styles/base.css`:

```css
.chain-icons { display: inline-flex; align-items: center; margin-right: 6px; vertical-align: -3px; }
.chain-icons img { border-radius: 50%; box-shadow: 0 0 0 1px var(--card); }
```

- [ ] **Step 4: Place the icons**

1. **Feed.** In `site/src/components/home/Feed.tsx`, import `ChainIcons` from `'../ChainIcons'`. Change the lane span to:

```tsx
          <span className="lane">
            <ChainIcons selectors={[m.src, m.dst]} />
            {laneLabel(names, `${m.src}>${m.dst}`)}
          </span>
```

2. **Top lists.** In `site/src/pages/top/[dim]/[window].astro`, import `ChainIcons` from `'../../../components/ChainIcons.astro'`. In the name cell, put `<ChainIcons selectors={r.chains} />` directly before `{r.primary}`.

3. **Chains page.** In `site/src/pages/chains.astro`, import `ChainIcons` from `'../components/ChainIcons.astro'`:
   - in the chains table, change the first cell to `<td><ChainIcons selectors={[c.selector]} />{c.name}{c.isNew && <span class="badge">new</span>}</td>`;
   - in the tokens table, change the chain cell to `<td><ChainIcons selectors={[t.chainSelector]} />{t.chain}</td>`.

4. **Flow page table.** In `site/src/pages/flow/[window].astro`, import `ChainIcons` from `'../../components/ChainIcons.astro'`. Change the top-lanes cell to `<td><ChainIcons selectors={[l.src, l.dst]} />{l.label}</td>`.

5. **Flow chord labels.** In `site/src/components/FlowChord.tsx`:
   - import `iconHref` from `'../lib/chain-icons'`;
   - add `const LABEL_ICON = 14;` below `INNER`;
   - add this as the first child of the `<svg>`:

```tsx
        <defs>
          <clipPath id="flow-icon-clip" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
        </defs>
```

   - in the `chords.groups.map` callback, add `const href = iconHref(group.key);` after `const group = …`;
   - replace the `{g.endAngle - g.startAngle > 0.05 && (<text …>{group.label}</text>)}` block with:

```tsx
                {g.endAngle - g.startAngle > 0.05 && (
                  <g transform={`rotate(${(mid * 180) / Math.PI - 90}) translate(${OUTER + 8}) ${flip ? 'rotate(180)' : ''}`}>
                    {href && <image href={href} x={flip ? -LABEL_ICON : 0} y={-LABEL_ICON / 2} width={LABEL_ICON} height={LABEL_ICON} clipPath="url(#flow-icon-clip)" />}
                    <text x={href ? (flip ? -(LABEL_ICON + 4) : LABEL_ICON + 4) : 0} textAnchor={flip ? 'end' : 'start'} dominantBaseline="middle" className="flow-label">
                      {group.label}
                    </text>
                  </g>
                )}
```

- [ ] **Step 5: Run the suite, typecheck and build**

Run: `pnpm --filter @ccip-dev/site test && pnpm --filter @ccip-dev/site typecheck && pnpm --filter @ccip-dev/site build`
Expected: PASS, with both budgets within their limits.

- [ ] **Step 6: Check it in a browser**

1. With `astro preview --port 4321` running, take screenshots at 1440 and 390 px of `/top/lane/7d/`, `/top/token/7d/`, `/chains/` and `/flow/30d/`.
2. Expected:
   - icon pairs before lane names;
   - a single icon before token and sender names, and on every chain row;
   - round 14 px icons beside the chord labels, with no label cut off at the chart edge.
3. At 390 px, check `scrollWidth === clientWidth` on each page.
4. If a chord label is cut off, set `LABEL_ICON` to 12 and check again; record that in the report.
5. Stop the preview.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/names.ts site/src/lib/top.ts site/src/lib/registry.ts site/src/lib/flow.ts site/src/components/ChainIcons.tsx site/src/components/ChainIcons.astro site/src/components/home/Feed.tsx site/src/components/FlowChord.tsx site/src/pages/top/[dim]/[window].astro site/src/pages/chains.astro site/src/pages/flow/[window].astro site/src/styles/base.css site/test/names.test.ts site/test/top.test.ts site/test/registry.test.ts site/test/flow.test.ts
git commit -m "feat(site): chain icons beside chain names in the feed, top lists, chains and flow pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the last task (controller)

1. **Full checks.** Run `pnpm test && pnpm typecheck` at the repo root and `pnpm --filter @ccip-dev/site build` against production data. All must pass, and both budget lines must be within their limits.

2. **Browser QA** on `astro preview`, using chrome-devtools:
   - home at 1440 and 390 px, including a hover card and a tap card under touch emulation;
   - `/replay/` playing;
   - a recorded 30 s 16:9 MP4. Decode the frame at 20 s with `ffmpeg -ss 20 -i <file> -frames:v 1 frame.png`, view it, and confirm coins appear;
   - a day page sky;
   - `/flow/30d/`, `/top/lane/7d/` and `/chains/`;
   - `/og/home.png` and `/og/day/<yesterday>.png` through `wrangler dev`.

3. **Lighthouse and layout.** Run Lighthouse mobile accessibility on `/`, `/replay/`, `/chains/`, `/flow/30d/` and `/top/lane/7d/`; each must be ≥ 95. Run a 390 px horizontal-overflow check on every page type.

4. **Website spec cross-references.** Add a one-line note pointing to `2026-10-07-chain-icons-design.md` in the website spec's §7.2, §8, §9.2 and §11, as that spec's §10 lists.

5. **Project status.** In `IMPLEMENTATION_PLAN.md`, add `Stage 9: Chain icons` and set its status from the results.

6. **Release.** After the final whole-branch review is clean, push to `main`. The site workflow deploys ccip.dev; confirm that run succeeds and that the live home page shows coins.
