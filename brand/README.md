# ccip.dev brand assets

| File | Size | Use it for |
|---|---|---|
| `mark.svg` | vector | The hexagon mark: favicons, small icons, anything that scales |
| `icon-1024.png` | 1024×1024 | Profile pictures: the X @ccipdev avatar, the Telegram channel photo, the Discord app icon |
| `x-header-3000x1000.jpg` | 3000×1000 (3:1) | The X profile header |
| `discord-banner-1360x480.png` | 1360×480 (17:6) | The Discord app's profile banner (Developer Portal → Bot → Banner) |
| `og-1200x630.png` | 1200×630 | The default share image (`site/public/og-default.png`, copied by `pnpm --filter @ccip-dev/site cards:static`) and GitHub's social preview |

The site's own icons and default share image live in `site/public/`: `favicon.svg`, `favicon-32.png`, `favicon.ico`, `apple-touch-icon.png` and `og-default.png`.

Colours: background `#0c0f14`, CCIP blue `#2f62df` and `#4a7ff0`, text `#e8eaed`, records and LINK gold `#f5c451`. Type: Inter for words, JetBrains Mono for numbers and labels.

## Re-rendering

The X header and the share image are rendered from the replay's own sky (frame 25 s of the all-time show), with the HTML in `src/`:
1. Bundle `src/render.ts` for the browser (for example `pnpm exec esbuild brand/src/render.ts --bundle --outfile=brand/src/render.js`).
2. Put `replay.json` and `history.json` from `https://data.ccip.dev/v1/` next to it.
3. Open `src/banner.html` (1500×500) or `src/og.html` (1200×630; use `?zoom=1.45&cx=0.3`) in Chrome at device scale 2 and screenshot the viewport.
4. Downscale by half with lanczos.
