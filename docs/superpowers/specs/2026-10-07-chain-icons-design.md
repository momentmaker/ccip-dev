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
3. **Static skies and cards:** day-page skies (and the home static fallback) show coins for their top 12 chains, and share cards show the top 8.
4. **Lists:** a 16 px icon sits beside the chain name in the live feed, the top lists, the chains page, and the flow page (top-lanes table and chord labels).
5. **Offline build:** no build or page view fetches anything from docs.chain.link. Icons are committed to the repo.
6. **Budgets hold:** home JavaScript stays ≤ 150 KB gzipped and replay ≤ 200 KB. Lighthouse mobile accessibility stays ≥ 95. There is no horizontal scroll at 390 px.
7. **Failure is quiet:** a missing or broken icon leaves a plain star or no icon, never a broken sky or layout.

## 3. Scope

**In:** the vendoring script, icon files and manifest; coins on the home sky, replay, day-page skies and share cards; the hover and tap card on the home sky; `ChainIcons` in lists; an About-page credit; tests.

**Out:**
- coins on the flow map's chord arcs (they get the 16 px label icon only);
- automatic icon refresh in CI (the script is run by hand when chains are added);
- token icons;

## 4. Facts this design relies on (measured 2026-10-07)

- **Source:** `https://docs.chain.link/assets/chains/<slug>.svg` serves chain icons. The source files are in `smartcontractkit/documentation` at `public/assets/chains/`, 108 SVGs. The responses carry `access-control-allow-origin: *`.
- **Icon format:** every icon checked is a 32×32 `viewBox`. Each has a full-size `<rect rx="4">` in the brand color with a white glyph on top, and some use a `clipPath` with generated ids such as `clip0_1460_57425`. Sizes are 0.5–2.6 KB.
- **Coverage:** the §5.2 rules match 88 of the 95 chains in `chains.json`. Six more have icons under other file names (`abchain`, `adi-network`, `cronoszkevm`, `mindnetwork`, `polygonkatana`, `polygonzkevm`) and get overrides, so 94 get a docs icon. Only Sui has none.
- **Card renderer (measured 2026-10-07):** resvg, as called by satori, draws nothing for an SVG image nested inside another SVG image, whether linked with `href` or `xlink:href`. A satori `<img>` with an SVG data URI and `borderRadius` renders correctly as a round coin.
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
3. **Child chain:** for `<parent>-mainnet-<x>` or `<parent>-mainnet-<x>-<n>`, the segment `<x>`.
4. **Stem:** for a name of the form `<x>-mainnet`, the segment `<x>`.

A child chain never falls back to its parent's icon. For example, `ethereum-mainnet-polygon-zkevm-1` never gets `ethereum`.
5. **Display name:** the display name lowercased, with a trailing ` mainnet` removed and spaces turned into `-`.

The pure function `matchIcon(chain, slugs, overrides): { slug: string | null; rule: string }` is unit-tested. The overrides file starts with the six entries from §4: `ab-mainnet` to `abchain`, `adi-mainnet` to `adi-network`, `cronos-zkevm-mainnet` to `cronoszkevm`, `ethereum-mainnet-polygon-zkevm-1` to `polygonzkevm`, `mind-mainnet` to `mindnetwork`, and `polygon-mainnet-katana` to `polygonkatana`. Before committing, the controller reviews the contact sheet. Each wrong match, for example a zkEVM chain picking up its parent's logo, gets an override, and the script is run again.

### 5.3 Cleaning

The script cleans icons with svgo 4.1.0, added as an exact-pinned `devDependency` of `@ccip-dev/site`. The config:
- `preset-default`, with `removeViewBox` disabled;
- `removeScripts`;
- `removeXlink`;
- `prefixIds` with the prefix `<chain name>-`, so ids such as `clip0_…` cannot collide when several icons are inlined in one SVG;
- a small custom plugin that removes every `on*` attribute and every `href` that does not start with `#`.

The root `<svg>` keeps its `viewBox` and is set to `width="32" height="32"`. A docs icon that lacks a `viewBox` gets one derived from its width and height. Paths are rounded to 2 decimals.

**Raster icons.** A few docs icons are a PNG wrapped in SVG: today `polygonzkevm`, `xlayer` and `zora`. The card renderer cannot draw a PNG nested in an SVG, which was measured on 2026-10-07. So the script rasterizes each of these once, through `@cf-wasm/og`, to a 128×128 PNG and vendors it as `<chain name>.png`. Every consumer handles both extensions: `iconDataUri` picks the MIME type, and the replay loads PNGs directly instead of resizing SVG text.

### 5.4 Lettermarks

For chains with no icon, the script writes a 32×32 lettermark: a rounded square (radius 4) in `#2a3446` with the first letter or digit of the display name, uppercased, in white Inter 700 at 18 px. The script renders it once through `@cf-wasm/og`'s `asSvg()`, which outputs the letter as paths. No font is needed later, and every renderer draws it the same. The result goes through the same cleaning as docs icons. These files have the same shape as docs icons, so every surface treats both kinds the same.

### 5.5 Manifest

The manifest is `site/src/data/chain-icons.json`, committed with the icons. It has no timestamp, so re-runs stay byte-identical; git history records when it changed.

```json
{
  "source": "https://github.com/smartcontractkit/documentation/tree/main/public/assets/chains",
  "icons": {
    "ethereum-mainnet": { "selector": "5009297550715157269", "file": "ethereum-mainnet.svg", "kind": "logo", "slug": "ethereum", "rule": "stem" },
    "sui-mainnet": { "selector": "17529533435026248318", "file": "sui-mainnet.svg", "kind": "lettermark", "slug": null, "rule": "none" }
  }
}
```

The manifest is keyed by chain `name`, the registry name used in `replay.json` and `chains.json`. Each entry also carries the chain's `selector`, because the site identifies chains by selector everywhere. `site/src/lib/chain-icons.ts` exports:
- `iconHref(selector): string | null`, which returns `/chains/<file>` or `null`;
- `hasIcon(selector): boolean`;
- `missingIcons(chains): string[]`.

`site/src/lib/chain-icons-server.ts` exports `iconDataUri(selector): string | null`. It is build-time only: it reads the file from `public/chains/` and returns it as a base64 data URI.

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

**Motion.** Coins do not animate on the home sky or static skies. On the replay they fade in and out (§7.2). An opacity fade is not vestibular motion, so the fade also runs under reduced motion. Reduced-motion visitors start on the end card anyway.

## 7. Surfaces

### 7.1 Home live sky (`SkyCanvas.tsx`)

**Coins.** A `.sky-coins` layer (`aria-hidden="true"`) sits next to `.sky-labels`. It holds `<img src={iconHref} alt="" width height decoding="async">` elements positioned at their stars with `border-radius: 50%`. They are recomputed on resize and when chain values change. Name labels keep their counts (12, or 6 under 640 px) and move outward by the coin's radius so they don't overlap it.

`SkyCanvas` measures the hero's UI boxes (the toolbar items and the headline card) and passes them to `skyOverlay` as rectangles to avoid:
- A chain whose coin box hits one loses its coin to the next-ranked chain.
- A label that would hit one moves to the star's left side, or is dropped if both sides are blocked.
- Every star stays hoverable.

The toolbar's own box has `pointer-events: none`, with only its children active, so it never blocks hover or tap on the sky behind it. Coin images load eagerly; they're about 12 small files.

**Hover and tap card.**
- **Opening:** `pointermove` with a mouse, or a tap with touch or pen, on the sky wrapper finds the nearest star within `max(12, coinDiameter/2 + 4)` CSS px of the pointer, using a pure `nearestStar(points, x, y, maxDist)`. A card then appears beside that star.
- **Content:** the card holds the star's coin (40 px), its display name, and "$X moved · N messages · 30 days". The value is the star's own 30-day USD value; messages are summed over the 30-day lanes touching the chain, with a self-lane counted once (pure `chainMessages(lanes, selector)`).
- **Closing:** the card closes on `pointerleave`, a tap outside it, Escape or scroll.
- **Accessibility:** the card is `aria-hidden` like the rest of the sky, because the chains page is the accessible list of chains, and the card is never keyboard-focusable. While a card is open, the hovered star's coin (or a temporary coin for a non-top star) is shown.

**Failures.** An `<img>` that fires `error` is removed and its star stays plain.

### 7.2 Replay (`replay/compose.ts`, `replay/timeline.ts`)

**Drawing.** Coins are drawn in the compositor's 2D overlay pass, after the sky `drawImage` and before the text overlay. MP4 frames therefore contain them. Each coin is pre-rasterized once to an offscreen canvas at 2× its maximum pixel size, clipped to a circle, and then drawn with `drawImage`. This stays sharp at any device pixel ratio and at 1080p recording.

**Images.** As soon as `replay.json` has loaded, the player preloads the icons of every replay chain, because the replay's join cards and leaderboard (viral replay spec) show any chain's logo:
- It fetches each SVG from the same origin and rewrites its root `width` and `height` to the raster size (128 px).
- It loads that text through a Blob URL into an `Image` and awaits `decode()`.
- It draws the result once into a circle-clipped canvas.

The player does not use `createImageBitmap`, because Chrome cannot decode SVG blobs with it. Same-origin and Blob sources do not taint the canvas. The player shows its first frame without waiting; coins appear once their image is ready. A recording waits for all icon images before frame 0, or for 5 s at most; after that, missing coins are skipped.

**Selection over time.** `ReplayModel.frameAt(t)` gains `coins: { selector: string; alpha: number }[]`.
- Each day has a top-12 set by that day's star values: the replay's trailing 30-day USD, which also sizes the stars. Only chains with an icon and a value above 0 count.
- At time `t`, a chain's coin alpha is `smoothstep(m)`, where `m` is the share of the replay-time window `[t − 0.5 s, t]` during which the chain was in its day's set. Time before day 0 counts as not in the set.
- This fades a chain in over 0.5 s when it enters, and out over 0.5 s when it leaves. A chain that flickers in and out at 12th place shows partial alpha instead of strobing.
- From the last day onward, time counts as inside the last day's set, so coins finish fading during the end card.
- `frameAt` stays a pure function of `t`.
- The star radius used for coin size is the frame's own star radius at `t`.

**Camera.** Coins follow the same projected points as stars, including the growing camera extent.

### 7.3 Static skies (`sky/svg.ts`)

`SkySvgOptions` gains `coins?: { count: number; href: (selector: string) => string | null }`. For each coin selector, `skySvg` emits an `<image href width height>` with a circular `clipPath` (one shared `<clipPath id="coin-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>`) and a 1 px ring `<circle>`. Day pages pass `href = iconHref`, with a count of 12. The home page's static fallback sky (`fallbackSvg` in `index.astro`, shown when no renderer works) passes the same, so it shows coins too.

### 7.4 Share cards

**Coin data.** Coins cannot be nested inside the card sky SVG (§4), so a new build-time asset carries them as data. `/card-coins.json` (`site/src/pages/card-coins.json.ts`) has the shape `{ coins: { x: number; y: number; d: number; src: string }[] }`:
- It uses the same 640×630 projection and 30-day weights as `/card-sky.svg`.
- It lists the top 8 chains.
- `d` is `coinDiameter(radius) × 1.6`, because cards are viewed small.
- `src` is the icon's base64 data URI from `iconDataUri`.

The same endpoint logs a build warning that names every chain from `missingIcons`.

**Card frame.** `worker/og.ts` fetches `/card-coins.json` from `ASSETS` alongside `/card-sky.svg`. A missing file, a non-OK response or invalid JSON gives no coins. `worker/cards/frame.ts` places each coin as a satori `<img>`:
- position `absolute`;
- `left` = `CARD_W − 640 + x − d/2`, `top` = `y − d/2`;
- size `d`, `borderRadius` `d/2`;
- `boxShadow` `0 0 0 1px rgba(255,255,255,0.18)`.

Coins sit after the sky image and before the text column, so text stays on top. The sky stays at 0.6 opacity and the coins are fully opaque.

### 7.5 Lists (`ChainIcons`)

There are two thin components with the same output: `site/src/components/ChainIcons.astro` for static pages and `site/src/components/ChainIcons.tsx` for islands.
- **Props:** `selectors: string[]` and `size`, 16 by default.
- **Output:** a `<span class="chain-icons">` with one `<img src alt="" width height loading="lazy" decoding="async">` per selector that has an icon. Each is round. Two icons overlap as a pair, the second shifted left by a quarter of its size.
- **No icons:** it renders nothing.
- **Accessibility:** the icons are decorative, because the chain names are always next to them.

Placements:
- **Live feed:** the lane's pair, before "Ethereum → Base".
- **Top lists:** a lane row's pair, or a token or sender row's chain, before the name.
- **Chains page:** every chain row, and the chain column of the tokens table.
- **Flow page:** the top-lanes table's pair, and the chord's arc labels as SVG `<image>` elements at 14 px. The Other arc has none.

Day pages have no chain tables; they get coins through their sky (§7.3).

## 8. Error handling

| Failure | Behavior |
|---|---|
| Icon file missing or fails to load in the browser | That coin or list icon is not shown. The star stays plain. No retry, no error UI. |
| Chain not in the manifest (added after the last script run) | No icon anywhere. The build prints a warning naming it. |
| An icon fails to fetch or decode on the replay | That chain has no coin on the replay or in recordings. The replay plays normally. |
| `/card-coins.json` missing from `ASSETS` or invalid | Cards render without coins, as before. |
| The script hits a download error, an oversized icon or a missing `viewBox` | It exits non-zero and writes nothing. Committed icons are unchanged. |

## 9. Testing and budgets

**Unit tests (Vitest, Node):**
- `matchIcon`: one test per rule, rule order, an override to a slug, an override to `null`, no match.
- `coinSelectors`, `coinCount`, `coinDiameter`, `nearestStar` and `chainMessages`, including a self-lane, ties, zero values, chains without icons, the 640 px boundary, the clamp ends and the max distance.
- The `frameAt` coin list: deterministic for equal `t`; alpha 0 before entry and 1 at 0.5 s after; fade-out on exit.
- `skySvg` with `coins` emits one `<image>` per coin, the shared `clipPath`, and nothing for chains without an `href`.
- The lettermark generator: valid 32×32 SVG output for a letter, a digit and an unknown character (it falls back to "?").
- The svgo config: prefixes ids and rewrites their references, strips a `<script>`, an `onload` and an external `href`, and keeps `viewBox`.

**Card Worker (workerd):** a real render with a `/card-coins.json` holding one solid-red test icon produces a PNG in which the pixel at the coin's center is red. A small PNG reader in the test decodes it with `DecompressionStream`. A missing or invalid `/card-coins.json` still renders the card.

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
- **§9.2 Share cards:** cards place coins from `/card-coins.json` over the sky.
- **§11 Visual system:** logos are content and exempt from the accent-color rules.

## 11. Owner steps and follow-ups

**Owner steps:** none. Everything ships through the normal push-to-deploy.

**Maintenance:** when CCIP adds chains, run `pnpm --filter @ccip-dev/site icons:fetch`, review `site/.icons-review.html`, and commit. The build warning names any chain that needs this.

**Follow-ups, not in this spec:**
- token icons;
- coins on the flow map's arcs;
- a CI job that opens a pull request when the docs repo gains icons for our lettermark chains.
