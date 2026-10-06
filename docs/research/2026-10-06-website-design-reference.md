> Design study for the ccip.dev website (sub-project 2), taken 2026-10-06 from https://chainlinkme.me and its source in `../chainlinkmeme`, with metrics.chain.link and l2beat.com for contrast. The screenshots were not committed because of their size; retake them with chrome-devtools when needed.

# Design reference: chainlinkme.me

Source repo (read-only): /Users/rubberduck/GitHub/momentmaker/chainlinkmeme (paths below relative to it).
Note: chainlinkmeme.com does not resolve; the live site is https://chainlinkme.me/ (X: @chainlinkmeme).

## What it is
Community-curated archive of ~1,800 Chainlink memes ("cosmic memes by linkmarines, for chainlink"). Static Astro build on GitHub Pages plus a small Cloudflare Worker for reactions.
Stack: Astro 6 + React 18 islands, ClientRouter view transitions, no Tailwind, no UI or animation library (only react, react-dom, smol-toml, upng-js; site/package.json). All CSS is one hand-written file. Runtime scripts on the page: Astro ClientRouter chunk and a Umami-style analytics script. 4 inline SVGs, 0 canvas on home (canvas 2D is used on /map/), ~23 CSS animations.

## Layout and IA
- Single centered column, max-width 1280px, padding 16px 20px 80px (site/src/styles/base.css `.page`).
- Header (site/src/layouts/Base.astro): wordmark "⬡⏣⬢ chainlink meme ⬢⏣⬡" in brand blue + muted tagline on the left; 4 hexagonal icon buttons on the right (theme, tag map, weekly, honeycomb grid). 1px bottom rule.
- Home (site/src/pages/index.astro): Meme-of-the-day hero card, "MOST LIKED" horizontal snap strip, search + pill filters (GIFs, Favorites, Random, ?), JS-distributed masonry gallery with infinite scroll.
- Subpages: /map/ (canvas tag constellation), /week/ (list of ISO-week rows, mono dates), /grid/ (honeycomb tessellation), /m/<slug>/ permalinks, /contribute/.
- Footer: centered small text links plus "hex kin" credit.

## Visual language
Palette (site/src/styles/base.css :root, site/src/styles/theme-dark.css):
- Brand blue #2f62df (links, wordmark, accents, progress bar, theme-color meta); hero gradient 135deg #2f62df -> #4a7ff0; hex lattice tint #4a8eff at 9% (dark) / #2f62df at 7% (light)
- Accent red #ff0000 (scrollbar thumb only)
- Dark: bg #0c0f14, fg #e8eaed, card #161b23, card border rgba(47,98,223,.30), muted #8892a0, shadow 0 1px 2px rgba(0,0,0,.3); image placeholder #1a1f2a
- Light: bg #fff, fg #222, card #fff, border rgba(47,98,223,.12), muted #777
- Body bg in dark = fixed hex-lattice SVG tile (56x98) + radial-gradient(ellipse at top, rgba(47,98,223,.08), transparent 60%) (theme-dark.css). background-attachment fixed gives free parallax.
Typography: `font: 400 14px CoreSans, "Helvetica Neue", Arial, sans-serif` (base.css line ~38). CoreSans is NOT loaded (no @font-face anywhere; document.fonts empty), so it renders Helvetica Neue/Arial. Mono: Menlo, Monaco, monospace for counts/dates. Computed: body 14px/400; brand 20px/700, -0.01em; hero title 22px/800 (clamps larger on desktop); section labels 11px/700 uppercase, letter-spacing .14em, muted. Page titles on /week/ are large bold sans (~64px) with small mono eyebrow.
Shape: card radius 8px, hero 12px, pills 999px, inputs 10px; hex buttons 40x46 via clip-path polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%) with ::before border layer and ::after 1.5px-inset fill (base.css ~691-742). Shadows: soft 0 1px 2px; hover 0 4px 12px rgba(0,0,0,.08); hero 0 18px 40px rgba(47,98,223,.35); focus ring 0 0 0 6px rgba(47,98,223,.2).
Spacing: 4/8/12/16/20/24 px rhythm; gallery gap 16px (12px under 640px).
Iconography: inline 24px stroke SVGs (stroke 2, round caps) in hex frames, plus Unicode hexagon glyphs (⬡ ⬢ ⏣) as the brand motif (also in section labels, bullets, badges).
Imagery: the memes themselves; images have border radius and sit on dark cards; OG images rendered with satori + resvg at 1200x630 (scripts/build-og-images.ts, Inter-Bold vendored).
Motion/effects (base.css): card-in stagger (opacity+translateY 12px+scale .96, 14ms per index, cubic-bezier(.2,.8,.2,1)); hover lift translateY(-2px); hero 3D mouse-tilt (perspective 1200px, rotateX/Y via CSS vars) with radial "shine" overlay (mix-blend-mode screen); hero-title text-shadow "breath" 4.5s; search spotlight (matches lit and pulsing, non-matches dim to .18 opacity + grayscale); load pulse; backdrop-filter blur(6px) on overlays; content-visibility:auto on cards; prefers-reduced-motion respected. /map/ is hand-rolled canvas 2D physics (site/src/components/Constellation.tsx), glow colors rgba(110,155,255,.9), shooting stars.
Meta/OG: site/src/layouts/Base.astro: theme-color #2f62df, canonical, og:* with explicit 1200x630 + alt, twitter summary_large_image, per-page OG override, home OG cache-busted by manifest date, svg+ico+apple-touch favicons, webmanifest. Theme set by inline pre-paint script (localStorage 'chainlinkmeme:theme', falls back to prefers-color-scheme), re-applied on astro:after-swap.

## What makes it feel legit/premium
- One brand color used with discipline; everything else is near-black neutrals with blue-tinted borders.
- Ownable motif (hexagon: lattice background, hex buttons, glyph bullets) tied to Chainlink's cube without copying the logo.
- Tactile micro-interactions (tilt, shine, spotlight) while layout stays simple and calm.
- Real polish: dark/light parity, no FOUC, keyboard shortcuts, focus states, reduced-motion, per-page OG, view transitions.
- Open source, "source on github" link in footer.

## Borrow for a live CCIP dashboard
- Dark-first tokens: #0c0f14 bg, #161b23 cards, blue-tinted 1px borders, #8892a0 muted; swap in semantic green/red/amber for status only.
- Fixed faint hex lattice + top radial glow as page ground (cheap, GPU-friendly, no WebGL).
- Hex icon buttons and uppercase tracked 11px labels for nav and section headers.
- Mono (tabular-nums) for numbers, hashes, timestamps; sans for labels.
- Hero card with gradient and subtle tilt for the single headline stat (e.g. 24h CCIP messages); count-up on load.
- Stagger fade-in for tiles; hover lift; pulsing ring for "live" or "new message".
- Canvas constellation idea maps directly to a lane graph of chains; keep it canvas 2D, pause when hidden, honor reduced motion.
- Pre-paint theme script, satori OG per page (could render live stats into the OG).
## Avoid
- Playful meme tone, red scrollbar, text-shadow glow on titles, unloaded brand font (declare a real font and load it with font-display swap).
- Masonry and infinite scroll (wrong for tabular data); background-attachment fixed can jank on mobile Safari.
- Hex-only chrome overload: keep tables and charts plain and high-contrast. Do not copy the Chainlink logo; do not use more than one accent hue.
- Heavy 3D tilt on data tiles (distracting when numbers update).

## Contrast
- metrics.chain.link (light, institutional): bg ~#fafbfc, cards white with 1px light border and ~16px radius, text #141921 / #4e5560 / #6c7585, Chainlink blue (~#0847f7) for icon accents with pale-blue (#e0ebff) icon tiles; triangular lattice line art top-right. Headings TASAOrbiterDisplay 600 (36px sections, huge hero), body Inter. Giant KPI numbers with a small unit word ("$36.42 Trillion"), tabular mono-ish numerals, icon tile per card, thin left icon rail.
- l2beat.com (dark, dense): near-black navy (~#0a0b14 to #14162b), panels rounded ~16px with 1px border, text #fafafa, green (+) and red (-) deltas, per-chain brand colors as coin avatars, pastel category icons. Roboto, bold, big numbers with lighter units ("$1.31B"). Interop section has an animated force graph of chains with flowing dots: closest analogue for CCIP lanes.

## Screenshot files (all in this folder)
- clm-home-1440-full.png, clm-home-1440-fold.png
- clm-home-390-full.png, clm-home-390-fold.png
- clm-map-1440-fold.png (constellation, full-page not taken)
- clm-week-1440-full.png
- metrics-chain-link-1440-fold.png
- l2beat-1440-fold.png

## Owner-approved concepts (2026-10-06)
Input for the sub-project 2 brainstorm. These are directions, not a spec.
- **CCIP Constellation (live hero):** every chain is a star sized by 30-day volume. Each live message is a comet along its lane, sized by USD and colored by token. Transfers of $1M or more get a shockwave and a caption. A new chain ignites as a new star. Built with WebGL instanced particles and D3 layout, fed by `live.json`.
- **Time-lapse replay:** "Watch CCIP grow", 2023-07-06 to today in about 60 s, with in-browser recording to video or GIF for sharing on X.
- **Reserve vault:** LINK fills a vault, and each weekly deposit drops in. Shows cost basis vs value now, a countdown to the next million, a deposit streak, and share of supply (from `reserve.json`).
- **Share cards everywhere:** satori + resvg share images for every view and filter, plus a daily "CCIP today" card.
- **Embeddable widget** and a **fullscreen TV mode**.
- **Trust signals:**
  - a live status light
  - "since 2023-07-06" on every all-time figure
  - a methodology link on every number
  - a verified check on labeled senders
- **Not doing:** in-browser SQL (DuckDB-WASM over Parquet). The owner declined it.
