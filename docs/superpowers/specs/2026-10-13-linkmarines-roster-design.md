# ccip.dev: the LinkMarines roster

**Status:** Approved for planning · **Date:** 2026-10-13

A public page at `ccip.dev/marines/` showing every Marine who has enlisted with the ccip.dev Discord bot, by callsign, plus a page per Marine at `/marines/0007/` with its own share preview. It turns enlisting from a private moment into joining something visible: low serials and rare draws become public trophies, and the corps fills a 260-tag collection board together.

The design was approved in conversation on 2026-10-13, section by section. The visual target is the approved mockup in `2026-10-13-linkmarines-roster-mockups/`:
- `roster.html` opens in a browser straight from disk, drawing 40 sample Marines with the real odds and memes;
- `roster-full.jpeg` is a full-page screenshot of it.

The mockup still shows four things the owner dropped, which must not be built:
- the hero's "NEXT UP · LINK MARINE #0041 · 60 plank-owner seats left" pill;
- the ticker's "NEXT UP" item;
- the profile tag's pointer tilt and its "TILT IT" badge;
- the "NEW" badges.

It builds on:
- the LinkMarine bot: `docs/superpowers/specs/2026-10-13-linkmarine-bot-design.md` and `discord/`;
- its callsign snapshot, `discord/src/data/callsigns.json` (version 1: 260 tags, archive `momentmaker/chainlinkmeme@ec873ea`);
- the site Worker's card renderer, `site/worker/linkmarine/`, reached by the bot through the `LinkMarineCards` service binding.

## 1. Goal

Give LinkMarines a public home for their dog tags that they want to visit, share and come back to.

**Owner decisions (2026-10-13):**
- **Callsign only, always.** The roster never shows a Discord display name, avatar or user ID. The callsign is the public identity. (Memory: `roster-callsign-only`.)
- **Approach A.** The bot serves its own public, read-only roster. The site draws the page from it in the browser and needs no access to the bot's database.
- **Sections:**
  - the hero counters;
  - a news-style **ticker**;
  - the **census** with the 260-tag board;
  - **today's most wanted**;
  - the **rarest ten**;
  - **plank owners**;
  - **the wall** of dog tags;
  - the meme **constellation**;
  - a page per Marine;
  - the call to action.
- **Kept from the second round of ideas:** first-discoverer credit, today's most wanted and the rarest ten.
- **Dropped:** the "next up" counter, the tilting profile tag, milestone posts to X and Telegram, per-tag pages, and live drop-in animations.
- **The wall's default order is rarity.** A NEWEST pill sorts by serial instead.

## 2. Success criteria

- **Private:** no public response from the bot or the site ever contains a Marine's Discord user ID, display name or avatar. A test proves it.
- **Fresh:** a new Marine appears on the roster within about a minute of enlisting.
- **Robust:** the per-Marine page and its share preview work even when the bot is down. The roster page degrades to a clear "out of reach" state and recovers on its own.
- **Light:** thousands of Marines don't make the page heavy. Meme images load only when needed, and the wall pages in 60 at a time.
- **Accessible:**
  - Lighthouse accessibility 100;
  - no horizontal overflow at 390 px;
  - every interactive element reachable by keyboard;
  - reduced motion respected.

## 3. Architecture

```
discord.ccip.dev (the bot Worker)            ccip.dev (the site Worker + static Astro)
  GET /roster.json   ──────────────────────▶   /marines/        static page; the browser loads roster.json
  GET /memes/<file>.png ───────────────────▶   (img src)        and derives every section in the browser
  GET /web/<serial>.png ───────────────────▶   /marines/0007/   one static template; the Worker fills in the
        │ renders once through SITE                             title and share image without asking the bot
        ▼
  LinkMarineCards.renderMarineWebCard (site Worker entrypoint)
```

- **The bot Worker (`discord/`)** answers three public GET routes beside `POST /interactions` (§5). It builds them from D1 and R2, which only it can read.
- **The site (`site/`)** has:
  - a static `/marines/` page;
  - a static template for the Marine pages;
  - a small addition to its Worker that serves `/marines/<serial>/` (§8).
- **Shared logic:** the roster file's types and every derived rule (census, discoverers, ranking, most wanted, ticker items, search, tag odds) live in a new pure module, `packages/core/src/roster.ts`. The bot builds `roster.json` against those types, the page imports the functions, and both are tested there.
- **No new storage:** no D1 migration and no new bucket. Web cards go under a new `web/` prefix in the bot's existing `ccip-dev-marines` R2 bucket.

## 4. The public roster file

`GET https://discord.ccip.dev/roster.json`, version 1:

```json
{
  "version": 1,
  "updatedAt": "2026-10-13T14:00:00.000Z",
  "snapshot": {
    "version": 1,
    "tags": [{ "tag": "sergey", "count": 653, "chance": 0.04416, "meme": "0036c94ab8b36fdcac3c94fe63a8609b.jpeg" }]
  },
  "marines": [
    {
      "serial": 7,
      "callsign": "painting-space-prophecy",
      "tags": ["painting", "space", "prophecy"],
      "tier": "legendary",
      "score": 18.74,
      "percentile": 97.3,
      "memes": [
        { "tag": "painting", "file": "4be1e1c1f7a8e2b0c3d4e5f60718293a.jpeg", "count": 1 },
        { "tag": "space", "file": "9c0d1e2f3a4b5c6d7e8f90a1b2c3d4e5.jpeg", "count": 1 },
        { "tag": "prophecy", "file": "1a2b3c4d5e6f708192a3b4c5d6e7f809.jpg", "count": 3 }
      ],
      "blood": "LINK+",
      "faith": "4IR",
      "enlisted": "2026-10-13"
    }
  ]
}
```

**The snapshot block:**
- `snapshot` is the bot's current callsign snapshot (`discord/src/data/callsigns.json`).
- `tags` lists every tag in the snapshot's order, with:
  - its SFW meme `count`;
  - its per-pick `chance`, which is `tagChances` (√count over the sum of √count), to 6 significant digits;
  - `meme`, the tag's first meme file. That's the WANTED poster image, and it's the tag's only meme when the count is 1.

**The marines block:**
- `marines` is ordered by serial, ascending.
- Each meme's `count` is the stored count. Rows from before counts were stored fall back to the snapshot's count, as the card already does.
- `enlisted` is the UTC date of `enlisted_at`, never the time.

**Allowlist, not denylist.** The query names its columns: `serial, callsign, tags, tier, score, percentile, memes, blood, faith, enlisted_at`. The JSON is built field by field from a `RosterMarine` type that has no slot for anything else. `user_id`, `display_name`, `platform`, `card_key`, `snapshot_version` and meme `key`/`sha` never leave the bot. `SELECT *` is not allowed in this path.

## 5. The bot's public routes

All three routes answer GET and HEAD (HEAD with headers and no body) and carry `Access-Control-Allow-Origin: *`. Any other method on these paths gets 405. Every other path behaves exactly as it does today: `POST /interactions` is unchanged and still demands a valid signature, and everything else returns 404.

| Route | Answer | Cache |
|---|---|---|
| `/roster.json` | §4, `application/json` | `public, max-age=60`, also kept in the edge cache (Cache API) for 60 s |
| `/memes/<file>.png` | the 240 px meme PNG from R2 `memes/<file>.png` | `public, max-age=31536000, immutable`, also kept in the edge cache |
| `/web/<serial>.png` | the web card (§6) from R2 `web/<serial>.png` | `public, max-age=86400`, also kept in the edge cache |

**`/roster.json`:**
- A D1 failure returns 503 `{"error":"roster unavailable"}`, which is never cached.

**`/memes/<file>.png`:**
- If R2 has the file, serve it.
- If not, and the file is a meme of any tag in the current snapshot, stock it once through the existing `stockMemes` path (pinned archive URL, the site's `prepareMeme`, 8 s timeout), then serve it. This is how WANTED posters get images for tags no Marine holds yet.
- Anything else gets 404.
- If the archive fetch or the render fails, return 503, never cached.
- Two simultaneous misses may stock the same meme twice. The bytes are identical, so that's harmless.

**`/web/<serial>.png`:**
- `<serial>` must match `^[1-9][0-9]*$` (no padding). Anything else gets 404.
- On a miss in R2:
  1. Load the Marine by serial. If there's none, return 404 with `max-age=60`, so a brand-new Marine isn't blocked for long.
  2. Make sure its three memes are in R2, stocking any that are missing.
  3. Render through the site's `renderMarineWebCard`.
  4. Store the result in R2 under `web/<serial>.png` and serve it.
- A render failure returns 503, never cached.
- Each card is rendered once, ever. A web card has no glint GIF.

## 6. The web card

The web card is the Marine's dog tag card exactly as the bot posts it, with the avatar-and-name row removed from the top of the right-hand panel. The tier word, the odds line, the tags, the meme planets and lanes, the sky, "LINK MARINE #0007" and "ccip.dev" all stay where they are. It's 1200×675 PNG.

- **Type:** `packages/core/src/linkmarine.ts` gains `MarineWebCard = Omit<MarineCard, 'name' | 'avatar'>`.
- **Renderer:** `LinkMarineRenderer` and the `LinkMarineCards` entrypoint gain `renderMarineWebCard(card: MarineWebCard): Promise<Uint8Array>`. `marineTree` draws the panel without its first row when given a web card.
- **Review gate:** the task that adds the web card renders a Common and a Legendary sample to PNG files and names them in its report. The controller shows them to the owner. Later tasks continue meanwhile, and a requested change is a follow-up fix.

## 7. The roster page, `/marines/`

The page uses `site/src/layouts/Base.astro` with:
- title "LinkMarines";
- description "Every LinkMarine who has enlisted with the ccip.dev bot, by callsign: the dog tags, the rarest draws and the tags still undrawn.";
- the default share image.

It's built in the site's usual way (Astro page plus React islands, styles from `site/src/styles/tokens.css`).

**Data:**
- The page loads `ROSTER_URL` (`https://discord.ccip.dev/roster.json`, a new constant in `site/src/config.ts`) with the site's existing data loader.
- It reloads every 60 s while the tab is visible, using the site's existing visibility-aware refresh if one exists.
- Every section below is derived from that one file by `packages/core/src/roster.ts`.

**Sections, top to bottom.** These match the mockup unless noted.

1. **Hero:**
   - The eyebrow "LinkMarines", the h1 "The Roster.", and the lead "Every Marine who has enlisted with the ccip.dev bot, by callsign. One draw each, stamped forever. Enlist in any server with `/enlist`."
   - Three counters: **Marines**, **Legendary** (in gold), and **Tags drawn** as "82/260". The denominator is the snapshot's tag count, never a literal 260.
2. **The ticker:** a full-width crawl under the hero.
   - **Label:** "LIVE · ROSTER" on a blue slanted block, with a blinking red dot.
   - **Items** come from the 20 newest Marines, newest first:
     - **★ LEGENDARY DRAWN** `callsign` "#0007 · rarer than 97% of draws", in gold, for a Legendary;
     - otherwise **NEW RECRUIT** `callsign` "#0038 · COMMON", in the tier colour;
     - then **FIRST SIGHTING** "“tag” · about 1 in N · discovered by #0038", if that Marine discovered any tag. Use the rarest tag they discovered, one item at most per Marine.
   - **Stats:** after every third Marine, one stat item in rotation: **MARINES** n, **TAGS DRAWN** n/N, **LEGENDARIES** n, and **PLANK-OWNER SEATS LEFT** n. The seats item is left out once all 100 seats are taken.
   - **Motion:**
     - It moves at a constant ~60 px/s.
     - The content repeats once for a seamless loop, and the repeat is `aria-hidden`.
     - Hover or focus pauses it.
     - With reduced motion, it's a still strip you can scroll sideways.
3. **Census:**
   - **Tier bars:**
     - One bar per tier: Legendary, Rare, Uncommon, Common.
     - Each fills with its tier metal to the share of Marines in that tier. A white tick marks the expected share: 3, 12, 25 and 60%, from `TIER_CUTS`.
     - Each shows "n · x% / expected".
   - **The tag board:**
     - One hexagon per snapshot tag, commonest first (chance descending, then tag name).
     - A drawn tag is lit blue, or gold when it's a one-meme tag. A one-meme tag that's undrawn is dim gold, and any other undrawn tag is dark.
     - Hovering shows a tooltip:
       - the tag;
       - "N memes · about 1 in X callsigns";
       - then either "first drawn by #0012 callsign · carried by N Marines" or "UNDRAWN · nobody carries it yet".
     - Clicking a lit hexagon filters the wall to that tag and scrolls to it.
     - The board is a mouse enhancement. It carries a visually hidden summary ("82 of 260 tags drawn"), and the wall's search reaches the same information by keyboard.
4. **Today's most wanted:**
   - Five WANTED posters: sepia meme, tag, "ABOUT 1 IN N CALLSIGNS", "ONE MEME IN THE ARCHIVE" or "N MEMES IN THE ARCHIVE", and "REWARD · DISCOVERER CREDIT".
   - Each is slightly rotated, and straightens on hover.
   - The lead reads "N tags are still undrawn, M of them one-of-a-kind. Five new posters every day at 00:00 UTC. Draw one first and you're its discoverer, on the board for good."
   - With fewer than five undrawn tags it shows the ones left. With none, it shows "Every tag has been drawn. The board is full."
5. **Rarest ten:**
   - Marines ranked by exact score, descending, with the lower serial winning a tie. Show the top ten.
   - Each row has the rank (gold, silver and bronze for 1–3), the callsign, #serial, the tier word, a bar in the tier metal and "rarer than X%".
   - The bar's length is relative to the roster's lowest and highest scores: 20% plus 80% of the way between them.
   - Each row links to the Marine's page.
   - The section is hidden while there are no Marines.
6. **Plank owners:**
   - 100 hexagon seats. Seat n holds serial n, in its tier metal with the number on it. Its `title` is the callsign, and it links to the Marine's page.
   - Empty seats are dark.
   - Once all 100 are taken, the lead adds "All 100 seats are taken."
7. **The wall:** every Marine as a hanging dog tag on a ball chain.
   - **Front:** the tier metal, the three tags embossed, and "LM 0007". Rare and Legendary tags glint.
   - **Back:** the three memes as etched hexagons. Hovering or keyboard focus flips the tag. Phones get no flip.
   - **Below each tag:** the tier word and #serial.
   - **Links:** each tag is a link to its Marine's page, with an `aria-label` like "LINK MARINE #0007, painting-space-prophecy, Legendary".
   - **Order:** by rarity (Legendary first), then serial ascending.
   - **Pills:** ALL, LEGENDARY, RARE, UNCOMMON, COMMON and NEWEST (serial descending).
   - **Search:**
     - It matches, case-insensitively, any substring of a callsign.
     - An entry that is all digits, with or without a leading `#`, also matches that serial (so `#7`, `7` and `0007` all find Marine 7).
     - Clicking a board hexagon or a constellation planet sets an exact-tag filter, shown as "N Marines carry “linkpilled” · clear".
   - **Paging:** 60 tags at a time, with a "Show more" button. A back's meme images load only when that tag first flips.
   - **Empty:** with no Marines, it shows "No Marines yet. Be #0001: `/enlist`".
8. **The constellation:**
   - The 24 most-carried tags (carriers descending, then tag name) as hexagon planets showing the discoverer's meme for that tag.
   - Planets are sized 34–80 px by carriers. One-meme tags glow gold. Each is labelled "tag ×N".
   - The layout is deterministic: a golden-angle spiral, then a repulsion pass so no two planets overlap and none leave the frame.
   - Clicking a planet filters the wall.
   - It's hidden while there are no Marines.
9. **Call to action:** "Your callsign is waiting." with the Add ccip.dev to Discord button (`DISCORD_INSTALL_URL`).

**States:**
- **Loading:** a skeleton of the counters and sections.
- **Out of reach:** if `roster.json` fails, show "The roster is out of reach right now. Retrying…" in place of the sections, and retry every 60 s.
- **Phones (390 px):** everything stacks to one column. The board goes to 20 columns, the seats to 10, the wall to 2, and the posters scroll sideways.
- **Reduced motion:** the ticker is still, the glints stop, and the flip is instant.

## 8. A Marine's page, `/marines/0007/`

**The URL:**
- The serial is zero-padded to at least four digits.
- `/marines/7/`, `/marines/007/` or `/marines/7` redirect with a 301 to `/marines/0007/`. Serials above 9999 use their own digits.

**The site Worker:**
- `run_worker_first` gains `/marines/*`.
- For `/marines/<digits>/`:
  - a value of 0 gets the 404 page;
  - a non-canonical form gets the redirect;
  - otherwise it fetches the static template from `ASSETS` and rewrites the head with `HTMLRewriter`.
- **The rewrite:**
  - `<title>` and `og:title` become "LINK MARINE #0007 · ccip.dev".
  - The description and `og:description` become "A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it."
  - `canonical` and `og:url` become the canonical URL.
  - `og:image` becomes `https://discord.ccip.dev/web/7.png`, with `og:image:width` 1200, `og:image:height` 675 and `og:image:alt` "The dog tags of LINK MARINE #0007".
- The Worker never calls the bot, so a bot outage can't break the page or its preview.
- `/marines/` and every other `/marines/…` path go straight to `ASSETS`, except the template's own path, `/marines/marine/`. The Worker answers a direct request for it with the 404 page (it fetches the template from `ASSETS` itself).

**The template:** a static Astro page at `/marines/marine/`, never linked and `noindex`. The browser reads the serial from the URL, loads `roster.json` and renders:
- **The card:** the web card image (`/web/<serial>.png`, 1200×675, with a real `alt`). If it fails to load, it's replaced by the wall's CSS dog tag at large size.
- **"LINK MARINE #0007 · enlisted 13 Oct 2026"**, the tier word in its metal, and the card's own odds wording plus "rank #N of M".
  - `oddsText` moves from `site/worker/linkmarine/marine-card.ts` to `packages/core/src/linkmarine.ts`, so the card and the page share it.
- **The three tags,** each with:
  - its meme hexagon;
  - its pips (`filledPips`);
  - "N memes";
  - "only you carry it" (gold) or "carried by N";
  - a **discoverer** badge when this Marine was first to draw it.
- **The two lore lines,** blood and faith.
- **Buttons:**
  - **Share on X** (an intent with the page URL and "LINK MARINE #0007 · painting-space-prophecy · LEGENDARY");
  - **Copy link** (reuse `ShareButton.tsx` where it fits);
  - **Enlist yours**, linking to `/discord/`.
- **Not found:** an unknown serial shows "No Marine #0999 yet." and the Enlist button. An out-of-reach roster shows the same state as §7.

## 9. Derived rules, `packages/core/src/roster.ts`

These are all pure functions of the roster file (and, for most wanted, a date), unit-tested.

- **Discoverer of a tag:** the Marine with the lowest serial whose tags include it. Serials only increase, so a discoverer never changes.
- **Carriers of a tag:** the number of Marines whose tags include it.
- **Rank:** score descending, then serial ascending. It's 1-based.
- **Census:** Marines per tier, each tier's share, and the expected shares 60/25/12/3 derived from `TIER_CUTS`. `TIER_CUTS` moves from `discord/src/draw.ts` to `packages/core/src/linkmarine.ts` (the bot imports it from there), so core can use it.
- **Tag odds, "about 1 in N callsigns":** N = round(1 / (1 − (1 − chance)³)), formatted with thousands separators. It's an approximation, so the wording always says "about".
- **Today's most wanted:**
  - Sort the undrawn tags by chance ascending, then by `fnv1a32(<UTC date YYYY-MM-DD> + ':' + tag)` ascending (32-bit FNV-1a over the UTF-8 bytes, as an unsigned integer), and take five.
  - The date is the visitor's current UTC date, so every visitor sees the same five, and the set changes at 00:00 UTC.
- **Ticker items:** as in §7.2, built from the 20 newest Marines.
- **Search:** as in §7.7.
- **Serial label:** `String(serial).padStart(4, '0')`.

## 10. Links into the roster

- **Header:** `{ href: '/marines/', label: 'LinkMarines' }` in the More menu.
- **Footer:** a "LinkMarines" text link.
- **`/discord/`:**
  - The final call to action gains a line, "N Marines enlisted · See the roster", linking to `/marines/`.
  - The count comes from `roster.json` in the browser. If the fetch fails, only "See the roster" shows.
- **About:** the Discord line adds "Every enlisted Marine is on the roster: <a href='/marines/'>ccip.dev/marines</a>."
- Extend any test that pins the menu or footer links.

## 11. Testing

**Bot (`discord/test`):**
- Each route's status codes, `Content-Type`, CORS and `Cache-Control`.
- HEAD has no body, and other methods get 405.
- `/interactions` is unchanged and still rejects unsigned requests.
- **Privacy:** seed Marines whose display name and user ID are distinctive strings, request every public route, and assert neither string appears in any response body or header.
  - Assert that the roster JSON's keys are exactly the allowlist.
- Memes:
  - a snapshot meme missing from R2 is stocked once, then served from R2;
  - a file outside the snapshot gets 404;
  - an archive failure gets 503 with no caching.
- Web cards:
  - rendered once on the first request, then served from R2;
  - an unknown or padded serial gets 404;
  - a render failure gets 503 with no caching.

**Core (`packages/core`):**
- Discoverers, carriers, and ranking with ties.
- The census and its expected shares.
- Tag odds.
- Most wanted: the same pick all day, a different pick the next UTC day, ties at equal chance broken by the hash, and fewer than five undrawn.
- Ticker items: the Legendary, recruit, first-sighting and stat rotation, the seats item disappearing at 100, and an empty roster.
- Search: substring, `#7`, `7`, `0007`, and an exact-tag filter.

**Site:**
- The web card render has no name or avatar row. Its tree contains no `name` text, and a Common and a Legendary snapshot are checked visually.
- The Worker:
  - `/marines/0007/` gets the rewritten head (title, description, canonical, og:url, og:image and its 1200×675 size, and alt);
  - `/marines/7/` and `/marines/7` get the 301;
  - `/marines/0/` and `/marines/marine/` get 404;
  - `/marines/` passes through.
- The build includes `/marines/` and the template.
- Screenshots at 1280 px and 390 px show no horizontal overflow. Lighthouse accessibility is 100 on `/marines/` and on a Marine page.

## 12. Shipping

- The bot and the site ship in the same push to main, through the existing `deploy` workflow (bot) and the site's deploy.
- Until the bot's deploy finishes, `/marines/` shows its out-of-reach state for a minute or two. No ordering is needed.
- **Owner step, optional, and only before this ships:** wiping the test Marines. A wiped serial would reuse its old web card for up to a day. The exact commands are given when the owner asks:
  1. delete the D1 rows and reset the serial counter;
  2. delete R2 `cards/` and `web/`;
  3. memes may stay.
- The runbook's Discord section gains the three public routes and the wipe note.

## 13. Out of scope

- The "next up" counter.
- The tilting profile tag.
- Milestone posts.
- Per-tag pages.
- Live drop-in animations.
- An opt-in to show Discord names.
- Telegram Marines.
- A glinting GIF on the web.
- A dedicated share card for `/marines/`.
- Splitting `roster.json` once it grows large. At about 250 bytes per Marine, 5,000 Marines is about 1.2 MB raw and about 250 KB gzipped.
