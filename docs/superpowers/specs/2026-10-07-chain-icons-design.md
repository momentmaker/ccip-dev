# ccip.dev — Chain icons on the constellation

**Status:** Draft for owner review · **Date:** 2026-10-07

This extends the website spec (`2026-10-06-website-design.md`), mainly §7 Constellation, §8 Replay, §9 Share cards and §11 Visual system. The design was approved in conversation on 2026-10-07.

## 1. Context and goal

ccip.dev launched on 2026-10-07. The constellation draws each CCIP chain as a star, 4–20 px across, with no logo. The owner wants each chain's icon on the sky, so visitors recognize their chain at a glance and share it.

The goal: the busiest chains wear their logo as a "coin" on every sky, and every chain's icon appears wherever chains are named.

Owner decisions (2026-10-07):
- **Placement:** the busiest chains wear logo coins; every other star shows its logo on hover or tap.
- **Coverage:** use every docs icon that matches a chain (90 of 95 today).
- **Style:** color coins, meaning the icon cut to a circle in its brand color with its white glyph.
- **Surfaces:** every sky (home, replay with its MP4s, day pages), the share cards, and the lists and feed.

## 2. Success criteria

1. **Home sky:** the 12 busiest chains wear coins, or 8 when the sky is narrower than 640 px. "Busiest" means the largest stars: the most USD moved over the sky's 30-day window, the same ranking the name labels already use. Hovering or tapping any star shows its coin, name, 30-day value moved and 30-day message count.
2. **Replay:** at every moment, the 12 busiest chains so far wear coins. A recorded MP4 shows the same coins as the player. The same `t` always draws the same coins.
3. **Static skies:** day-page skies and the build-time card sky show coins for their top chains, with 12 on day pages and 8 on cards.
4. **Lists:** a 16 px icon sits beside the chain name in the live feed, the top lists, the chains page, the flow map labels and day pages.
5. **Offline build:** no build or page view fetches anything from docs.chain.link. Icons are committed to the repo.
6. **Budgets hold:** home JavaScript stays ≤ 150 KB gzipped and replay ≤ 200 KB. Lighthouse mobile accessibility stays ≥ 95. There is no horizontal scroll at 390 px.
7. **Failure is quiet:** a missing or broken icon leaves a plain star or no icon, never a broken sky or layout.

## 3. Scope

**In:** the vendoring script, icon files and manifest; coins on the home sky, replay, day-page skies and card sky; the hover and tap card on the home sky; `ChainIcon` in lists; an About-page credit; tests.

**Out:**
- coins on the flow map's chord arcs (they get the 16 px label icon only);
- automatic icon refresh in CI (the script is run by hand when chains are added);
- token icons;

## 4. Facts this design relies on (measured 2026-10-07)

- **Source:** `https://docs.chain.link/assets/chains/<slug>.svg` serves chain icons. The source files are in `smartcontractkit/documentation` at `public/assets/chains/`, 108 SVGs. The responses carry `access-control-allow-origin: *`.
- **Icon format:** every icon checked is a 32×32 `viewBox`. Each has a full-size `<rect rx="4">` in the brand color with a white glyph on top, and some use a `clipPath` with generated ids such as `clip0_1460_57425`. Sizes are 0.5–2.6 KB.
- **Coverage:** name rules match 90 of the 95 chains in `chains.json`. AB, ADI, B², Mind and Sui have no icon.
- **License:** the docs repo has no license GitHub can identify (`NOASSERTION`). Logos are trademarks of their chains. ccip.dev shows them only to identify those chains, as explorers and dashboards do, and credits the source.
- **Star size:** `starRadius` is `2 + 8·√(v/max)`, scaled by `min(w, h)/700`.
- **Labels:** the home sky already renders the names of its top 12 chains (6 under 640 px) in a DOM layer (`.sky-labels`) over the canvas. Star positions on the home sky change only on resize.
- **Card sky:** share cards embed `/card-sky.svg` as an `<img>` data URI at opacity 0.6 (`worker/cards/frame.ts`).
- **svgo:** `svgo@4.1.0` is already in `pnpm-lock.yaml` as a transitive dependency.

## 5. Icons: source and vendoring

### 5.1 Script

`site/scripts/fetch-chain-icons.ts` is run by hand: `pnpm --filter @ccip-dev/site icons:fetch`. Builds never run it. It:

1. Reads `https://data.ccip.dev/v1/chains.json`.
2. Lists `public/assets/chains/` in `smartcontractkit/documentation` through the GitHub contents API (unauthenticated, one request).
3. Matches each chain to an icon slug (§5.2).
4. Downloads each matched SVG from `https://docs.chain.link/assets/chains/<slug>.svg` and cleans it (§5.3).
5. Writes a lettermark for each unmatched chain (§5.4).
6. Writes `site/public/chains/<chain name>.svg` for every chain, plus the manifest (§5.5).
7. Writes a contact sheet to `site/.icons-review.html`, which is git-ignored. The sheet has a grid of every icon at 16 px and 40 px with its chain display name, the matched slug and the rule that matched.
8. Prints a summary: matched count, the lettermark list, and which overrides were used.

The script exits non-zero if a download fails, or if a cleaned icon is over 20 KB or has no `viewBox`. It writes nothing in that case. Re-running it with unchanged inputs produces byte-identical files.

### 5.2 Matching

Rules are tried in order. The first slug that exists in the docs listing wins.

1. **Override:** `site/scripts/chain-icon-overrides.json` maps a chain name to a slug, or to `null` to force a lettermark.
2. **Exact:** the chain name itself.
3. **Layer-2 pattern:** for `ethereum-mainnet-<x>-<n>`, the segment `<x>`.
4. **Stem:** the chain name with `-mainnet` and everything after it removed.
5. **Display name:** the display name lowercased, with a trailing ` mainnet` removed and spaces turned into `-`.

The pure function `matchIcon(chain, slugs, overrides): { slug: string | null; rule: string }` is unit-tested. Before committing, the controller reviews the contact sheet. Each wrong match, for example a zkEVM chain picking up its parent's logo, gets an override, and the script is run again.

### 5.3 Cleaning

The script cleans icons with svgo 4.1.0, added as an exact-pinned `devDependency` of `@ccip-dev/site`. The config:
- `preset-default`, with `removeViewBox` disabled;
- `removeScripts`;
- `removeXlink`;
- `prefixIds` with the prefix `<chain name>-`, so ids such as `clip0_…` cannot collide when several icons are inlined in one SVG;
- a small custom plugin that removes every `on*` attribute and every `href` that does not start with `#`.

The root `<svg>` keeps its `viewBox` and loses `width` and `height`, so it scales to whatever box it is drawn in.

### 5.4 Lettermarks

For chains with no icon, the script writes a 32×32 lettermark: a rounded `<rect rx="4">` in `#2a3446` with the first letter or digit of the display name, uppercased, in white. The letter is built from a fixed path table for A–Z and 0–9, so no font is needed and every renderer draws it the same. These files have the same shape as docs icons, so every surface treats both kinds the same.

### 5.5 Manifest

The manifest is `site/src/data/chain-icons.json`, committed with the icons:

```json
{
  "source": "https://github.com/smartcontractkit/documentation/tree/main/public/assets/chains",
  "fetched_at": "2026-10-07T00:00:00Z",
  "icons": {
    "ethereum-mainnet": { "file": "ethereum-mainnet.svg", "kind": "logo", "slug": "ethereum", "rule": "stem" },
    "sui-mainnet": { "file": "sui-mainnet.svg", "kind": "lettermark", "slug": null, "rule": "none" }
  }
}
```

The manifest is keyed by chain `name`, the registry name used in `replay.json` and `chains.json`. `site/src/lib/chain-icons.ts` exports:
- `iconHref(name): string | null`, which returns `/chains/<file>` or `null`;
- `iconSvg(name): string | null`, the raw SVG text used to build the card sky. This one is server-only and reads the files at build time.

A chain missing from the manifest has no icon everywhere: it stays a plain star and shows no list icon. check-build prints a warning listing those chains but does not fail.

### 5.6 Credit

The About page gains one line: "Chain icons: Chainlink documentation. Logos are trademarks of their respective owners."

## 6. Coins: look and selection

**Look.** A coin is the chain's icon clipped to a circle. Its diameter is `clamp(18, 2.4 × r, 40)` CSS px, where `r` is the star's CSS radius. It sits centered on the star, inside the star's existing blue glow, with a 1 px ring in `rgba(255,255,255,0.18)` so dark logos read against the sky. The coin hides the star's white core disc; the glow stays.

**Selection.** `site/src/sky/coins.ts` exports:
- `coinSelectors(values: Map<string, number>, count: number, hasIcon: (selector: string) => boolean): string[]`, the top `count` selectors by value (USD moved, the star-size value), ties broken by selector. It reuses `topSelectors`, skipping chains with no icon and chains with value 0.
- `coinCount(widthCss: number): number`, which returns 12, or 8 when `widthCss < 640`.
- `coinDiameter(radiusCss: number): number`, which applies the clamp above.

**Colors.** Logos are content, like the sponsor logo. The website spec's §11 color rules (gold only for $1M+ moments, one brand blue) keep governing interface accents, comets and rings.

**Motion.** Coins do not animate on the home sky or static skies. On the replay they fade in (§7.2). Under reduced motion they appear without fading.

## 7. Surfaces

### 7.1 Home live sky (`SkyCanvas.tsx`)

**Coins.** A `.sky-coins` layer (`aria-hidden="true"`) sits next to `.sky-labels`. It holds `<img src={iconHref} alt="" width height decoding="async">` elements positioned at their stars with `border-radius: 50%`. They are recomputed on resize and when chain values change. Name labels keep their counts (12, or 6 under 640 px) and move outward by the coin's radius so they don't overlap it. Coin images load eagerly; they're about 12 small files.

**Hover and tap card.**
- **Opening:** `pointermove` with a mouse, or a tap with touch or pen, on the sky wrapper finds the nearest star within `max(12, coinDiameter/2 + 4)` CSS px of the pointer, using a pure `nearestStar(points, x, y, maxDist)`. A card then appears beside that star.
- **Content:** the card holds the star's coin (40 px), its display name, and "$X moved · N messages · 30 days". The value is the star's own 30-day USD value; messages are summed over the 30-day lanes touching the chain, with a self-lane counted once (pure `chainMessages(lanes, selector)`).
- **Closing:** the card closes on `pointerleave`, a tap outside it, Escape or scroll.
- **Accessibility:** the card is `aria-hidden` like the rest of the sky, because the chains page is the accessible list of chains, and the card is never keyboard-focusable. While a card is open, the hovered star's coin (or a temporary coin for a non-top star) is shown.

**Failures.** An `<img>` that fires `error` is removed and its star stays plain.

### 7.2 Replay (`replay/compose.ts`, `replay/timeline.ts`)

**Drawing.** Coins are drawn in the compositor's 2D overlay pass, after the sky `drawImage` and before the text overlay. MP4 frames therefore contain them. Each coin is pre-rasterized once to an offscreen canvas at 2× its maximum pixel size, clipped to a circle, and then drawn with `drawImage`. This stays sharp at any device pixel ratio and at 1080p recording.

**Images.** The player preloads all icons with `fetch` (same origin, so nothing taints the canvas) and `createImageBitmap` from a `Blob`. This starts as soon as `replay.json` has loaded. The player shows its first frame without waiting; coins appear once their bitmap is ready. A recording waits for all icon bitmaps before frame 0, or for 5 s at most; after that, missing coins are skipped.

**Selection over time.** `ReplayModel.frameAt(t)` gains `coins: { selector: string; alpha: number }[]`.
- At time `t`, a chain's coin alpha is `smoothstep` over the 0.5 s of replay time since it entered the top 12 by the replay's running star values.
- A chain that leaves the top 12 fades out the same way.
- Entry and exit times are computed from the day index, using values at the start of each day, so `frameAt` stays a pure function of `t`.
- The star radius used for coin size is the frame's own star radius at `t`.

**Camera.** Coins follow the same projected points as stars, including the growing camera extent.

### 7.3 Static skies (`sky/svg.ts`)

`SkySvgOptions` gains `coins?: { count: number; href: (selector: string) => string | null }`. For each coin selector, `skySvg` emits an `<image href width height>` with a circular `clipPath` (one shared `<clipPath id="coin-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>`) and a 1 px ring `<circle>`. Day pages pass `href = iconHref`, with a count of 12. The home page's static fallback sky (`fallbackSvg` in `index.astro`, shown when no renderer works) passes the same, so it shows coins too.

### 7.4 Share cards

**Coin layer.** A new build-time asset, `/card-coins.svg` (`site/src/pages/card-coins.svg.ts`), uses the same 640×630 projection and 30-day weights as `/card-sky.svg`. It contains only the coins of the top 8 chains. Each coin is the cleaned icon inlined as `<image href="data:image/svg+xml;base64,…">`, because the card Worker cannot fetch `/chains/*.svg` during a render.

**Card frame.** `worker/cards/frame.ts` stacks it as a second `<img>` over the sky at full opacity. The sky stays at 0.6, so coins stay vivid. `worker/og.ts` fetches `/card-coins.svg` from `ASSETS` alongside `/card-sky.svg`. A missing file is simply skipped.

**Fallback.** If resvg does not render nested SVG data URIs correctly, as measured by the first task's workerd render test, the coin layer embeds 64 px PNGs instead of SVGs. They are rasterized at build time with `@cf-wasm/resvg`, which is already a dependency through `@cf-wasm/og`. The first plan task must settle this before card work starts.

### 7.5 Lists (`ChainIcon`)

There are two thin components with the same output: `site/src/components/ChainIcon.astro` for static pages and `site/src/components/ChainIcon.tsx` for islands. Each takes `name`, the chain registry name, and `size`, 16 by default. When the chain has an icon, it renders `<img src alt="" width height loading="lazy" decoding="async" class="chain-icon">` with `border-radius: 50%` and `vertical-align: -3px`. Otherwise it renders nothing. The icon is decorative, because the chain name is always next to it.

Placements:
- **Live feed:** both chains of a lane, for example "[icon] Ethereum to [icon] Base".
- **Top lists:** the chain column, lane rows, and the chain under token and sender rows.
- **Chains page:** every row.
- **Flow map:** arc labels, as SVG `<image>` elements at 14 px.
- **Day pages:** the top lanes and chains tables.

## 8. Error handling

| Failure | Behavior |
|---|---|
| Icon file missing or fails to load in the browser | That coin or list icon is not shown. The star stays plain. No retry, no error UI. |
| Chain not in the manifest (added after the last script run) | No icon anywhere. The build prints a warning naming it. |
| `createImageBitmap` unsupported or failing on the replay | No coins on the replay or in recordings. The replay plays normally. |
| `/card-coins.svg` missing from `ASSETS` | Cards render without coins, as before. |
| The script hits a download error, an oversized icon or a missing `viewBox` | It exits non-zero and writes nothing. Committed icons are unchanged. |

## 9. Testing and budgets

**Unit tests (Vitest, Node):**
- `matchIcon`: one test per rule, rule order, an override to a slug, an override to `null`, no match.
- `coinSelectors`, `coinCount`, `coinDiameter`, `nearestStar` and `chainMessages`, including a self-lane, ties, zero values, chains without icons, the 640 px boundary, the clamp ends and the max distance.
- The `frameAt` coin list: deterministic for equal `t`; alpha 0 before entry and 1 at 0.5 s after; fade-out on exit.
- `skySvg` with `coins` emits one `<image>` per coin, the shared `clipPath`, and nothing for chains without an `href`.
- The lettermark generator: valid 32×32 SVG output for a letter, a digit and an unknown character (it falls back to "?").
- The svgo config: prefixes ids and rewrites their references, strips a `<script>`, an `onload` and an external `href`, and keeps `viewBox`.

**Card Worker (workerd):** a real render with a `/card-coins.svg` containing two inlined icons produces a PNG, and pixels at the coin centers are not the background color. This is the test that settles §7.4's fallback.

**Build checks:**
- check-build fails if a manifest entry's file is missing from `dist/chains/`, and warns about chains with no manifest entry.
- check-budgets is unchanged; its limits must still pass.

**Visual check (controller, before merge):**
- the contact sheet reviewed;
- home sky screenshots at 1440 and 390 px;
- a replay frame at 30 s;
- one recorded 1080p MP4 frame decoded with ffmpeg showing coins;
- `/og/home.png` showing coins.

**Budgets:** coin code adds under 5 KB gzipped to the home page. Icon files are images and fall outside the JavaScript budget.

## 10. Changes to the website spec

- **§7.2 Rendering:** the home sky gains the `.sky-coins` layer and the hover and tap card.
- **§8 Replay:** frames carry coins, and recordings include them.
- **§9.2 Share cards:** cards stack `/card-coins.svg` over the sky.
- **§11 Visual system:** logos are content and exempt from the accent-color rules.

## 11. Owner steps and follow-ups

**Owner steps:** none. Everything ships through the normal push-to-deploy.

**Maintenance:** when CCIP adds chains, run `pnpm --filter @ccip-dev/site icons:fetch`, review `site/.icons-review.html`, and commit. The build warning names any chain that needs this.

**Follow-ups, not in this spec:**
- token icons;
- coins on the flow map's arcs;
- a CI job that opens a pull request when the docs repo gains icons for our lettermark chains.
