# ccip.dev: the LinkMarine Discord bot

**Status:** Approved for planning · **Date:** 2026-10-13

An interactive Discord app for the unofficial LinkMarine server. Marines enlist for a permanent callsign and get a collectible dog tag card. They pull CCIP intel as cinematic briefing cards. Everything is a slash command, and every reply is a striking image.

The design was approved in conversation on 2026-10-13, section by section. The visual targets are the approved mockups in `2026-10-13-linkmarine-bot-mockups/`. Open `dog-tag-card.html` and `intel-cards.html` in a browser.

It builds on:
- the callsign rules: `docs/callsigns/rules.md` and `docs/callsigns/tags.toml`;
- the chainlinkme.me meme archive (the sibling repo `../chainlinkmeme`, served from `raw.githubusercontent.com/momentmaker/chainlinkmeme/<ref>/memes/<file>`);
- the site Worker's card renderer (`site/worker/`: `@cf-wasm/og`, Satori and resvg, with its fonts and chain icons);
- the public data files at `https://data.ccip.dev/v1/`.

## 1. Goal

Give LinkMarines two things they will love and share:
- **An identity.** `/enlist` draws a permanent, unique callsign made of three meme tags, with a rarity tier, and stamps it on a pair of dog tags.
- **Intel.** Four commands post CCIP numbers as cinematic cards ("kino") that people screenshot and talk about.

**Owner decisions (2026-10-13):**
- **Commands:** `/enlist`, `/dogtag [@marine]`, `/cciptoday`, `/ccipchain <chain>`, `/linkreserve`, `/cciprecords`.
- **Not in v1:** the Oracle game, ranks, watches, the mess hall (memes), and Telegram enlistment.
- **Replies are public** in the channel where the command ran. Errors are private (ephemeral).
- **Install with no permissions.** The app is installed with the `applications.commands` scope only. It gives no roles, changes no nicknames and reads no messages.
- **Separate per platform.** A Discord account and, later, a Telegram account each get their own card. The two are never linked. Callsigns and serials are shared across platforms, so a callsign is unique everywhere.
- **The dog tag card:** a pair of tags on a ball chain, each tier its own metal, lore fields drawn per Marine, rim microtext, hex meme planets on CCIP lanes, a sky seeded by the callsign, the Chainlink hex halo, "LINK MARINE #0007" bottom left and "ccip.dev" bottom right.
  - Dropped during design: ribbons, the serial watermark, the light rays and circle memes.
- **Effects scale with tier.** Legendary gets everything. Rare gets a toned-down sheen. Common and Uncommon stay matte. Rare and up get an animated glint.
- **Chain icons fill their hexagon.** The hex takes the icon's own background color, with the logo mark centered. No square is ever visible.
- **Approach A.** A dedicated `discord` Worker, with its own D1 database and R2 bucket. Cards are drawn by the site Worker through a private service binding.

## 2. Success criteria

- **Fast:** every command is acknowledged within Discord's 3 seconds. An intel card appears within about 5 s, and the enlistment reveal completes within about 8 s.
- **Permanent:**
  - a Marine's callsign, serial, tier, memes, lore and stamped name never change;
  - `/enlist` never draws twice;
  - no two Marines share a callsign, in any order, on any platform.
- **Honest:** every number on an intel card comes from the public data files and matches the site. Each intel card shows its "as of" time.
- **Kino:** the cards match the approved mockups in layout, palette and effects at 1200×675.
- **Safe:** unsigned requests are rejected. The bot can't post anywhere it wasn't invoked. A broken data file or render never produces a half-drawn card.
- **Isolated:** nothing in the bot can affect ingest, finalize, broadcasts or the website.

## 3. Scope

**In:**
- the `discord` Worker and its D1 database and R2 bucket;
- the six commands, plus `/ccipchain` autocomplete;
- the callsign snapshot and its generator script;
- `docs/callsigns/lore.toml`;
- the dog tag card and the four intel cards in the site Worker's renderer, behind a private entrypoint;
- the animated glint;
- the command registration script;
- alerts;
- runbook and methodology sections.

**Out:**
- Oracle calls;
- ranks and promotions;
- Fleets;
- watches;
- drill;
- the mess hall;
- roles and nicknames;
- Telegram enlistment (a later, separate front door);
- global installation outside the LinkMarine server.

## 4. Commands

| Command | Reply (public) |
|---|---|
| `/enlist` | **First time:** the reveal (§5.4), ending with the dog tag card. **Already enlisted:** "You're already enlisted, Marine." plus their card. |
| `/dogtag [marine]` | The invoker's card, or another member's. If that member hasn't enlisted: "<name> hasn't enlisted yet. `/enlist`" (private when it's the invoker). |
| `/cciptoday` | The SITREP card (§7.1). |
| `/ccipchain <chain>` | The chain dossier card (§7.2). The `chain` option autocompletes from `chains.json` display names; at most 25 suggestions, matching name or slug, case-insensitive. |
| `/linkreserve` | The vault card (§7.3). |
| `/cciprecords` | The hall of records card (§7.4). |

**Private errors:**
- an unknown chain: "No chain called '<x>' on CCIP." (`<x>` is shown as plain text, cut to 64 characters);
- a chain CCIP lists that no message has crossed yet: "<name> has no CCIP traffic yet.";
- unreadable data: "Intel is unavailable right now, try again in a minute.";
- an internal failure: "Something went wrong. It's been reported."

## 5. Enlistment

### 5.1 The snapshot

A script, `pnpm discord:snapshot`, reads the local `../chainlinkmeme` checkout and writes `discord/src/data/callsigns.json`, which is committed. It holds:
- the allowed tags from `docs/callsigns/tags.toml`, with their meme counts (only memes with `nsfw = false` count), excluding tags longer than 13 characters;
- for each tag, its SFW meme filenames;
- the chainlinkmeme commit SHA, so image URLs are immutable;
- the tier cut-offs and the score distribution: 200,000 seeded simulated draws, per rules.md;
- a `version`.

Odds and tiers come only from this file. A Marine's stored tier never changes. A later snapshot changes odds only for future draws.

### 5.2 The draw

- Draw three different tags. Each tag's chance is proportional to √(its count), as in rules.md. The callsign is the three tags in draw order, joined by hyphens.
- **Unique in any order.** A sorted key of the three tags is unique in D1. On a clash, draw again, up to 20 times. If all 20 clash, it fails with an internal alert.
- **Score** = Σ −ln(p_tag). The tier comes from the snapshot's cut-offs, at shares of 60/25/12/3% for Common, Uncommon, Rare and Legendary.
- **Percentile:** the share of simulated draws scoring below this one. The card prints "top X%" (the tier's share) and "rarer than N in 100 Marines", where N is the percentile rounded down.
- **Tag pips** count the tag's SFW memes:
  - ◆◆◆ for exactly 1;
  - ◆◆◇ for 2–9;
  - ◆◇◇ for 10–49;
  - ◇◇◇ for 50 or more.
- **One meme per tag,** chosen from the tag's SFW filenames by a PRNG seeded with the callsign.
- **Lore:** BLOOD and FAITH are each drawn by weight from `docs/callsigns/lore.toml`, which the owner edits. Its format is like tags.toml. Each entry has a weight, and low weights make rare lines. The file is read into the snapshot. The starter list:
  - BLOOD: LINK+, O-LINK, 7777777;
  - FAITH: 4IR, SERGEY, STAKING, FUNDAMENTALS.
- **Microtext:** a fixed list of rim phrases ("LINK MARINES · STAY POOR · 4IR · FUNDAMENTALLY · WAGMI"), ordered by the seed.
- **Sky seed:** the callsign seeds the star field, the halo's subtle rotation, and the choice among planet layout templates.
- **Serial:** a global counter starting at 1, in enlistment order (a D1 `INTEGER PRIMARY KEY AUTOINCREMENT`).
- **Stamped name:** the member's Discord display name at enlistment (`member.nick` ?? `user.global_name` ?? `user.username`). It is stamped once.
- **Randomness:** `crypto.getRandomValues` for the tag draw and the lore. Deterministic, callsign-seeded randomness for everything visual.

### 5.3 Storage

D1 `ccip-dev-marines`, table `marines`:
- `serial` INTEGER PRIMARY KEY AUTOINCREMENT;
- `platform` TEXT, plus `user_id` TEXT, UNIQUE (platform, user_id);
- `callsign`, plus `tag_key` UNIQUE (the sorted tags);
- `tags` (JSON);
- `tier`, `score`, `percentile`;
- `memes` (JSON: tag, filename, R2 key);
- `blood`, `faith`;
- `display_name`;
- `snapshot_version`;
- `enlisted_at`;
- `card_key` (null until stamped).

R2 `ccip-dev-marines`:
- `memes/<filename>.png`: each meme, copied from the pinned archive URL at enlistment and kept as a 240×240 PNG, so a card never depends on GitHub again;
- `cards/<serial>.png` (static) and `cards/<serial>.gif` (Rare and up).

### 5.4 The reveal

1. Acknowledge with a deferred response (type 5).
2. Edit the original message: "Drawing your callsign… ▮▮▮".
3. About one second later, stamp each tag in turn: "PAINTING ▮▮" → "PAINTING · SPACE ▮" → "PAINTING · SPACE · PROPHECY".
4. Rare and up add a banner line: "⚠ RARE DRAW" or "⚠ LEGENDARY DRAW".
5. Edit in the card as an attachment, with the callsign as the message text.

The card renders in parallel with steps 2–4. Edits stay within Discord's webhook rate limits (about 1 per second). The whole sequence runs inside `waitUntil` after the deferred response, well inside the 15-minute token lifetime.

The draw is committed to D1 **before** the reveal starts. If the render fails, the final edit says "You're `<callsign>`, Marine #<serial>. Your tag is being stamped; run `/dogtag` in a minute." `/dogtag` renders any missing card on demand.

## 6. The dog tag card (1200×675)

The visual target is `2026-10-13-linkmarine-bot-mockups/dog-tag-card.html` (Legendary).

**Left: the tags.**
- **Two tags on a beaded ball chain** that runs from the top edge into each tag's hole.
- **The back tag** is rotated about −11°. Its three memes are hexagons etched into the metal (grayscale and contrast, multiplied onto the metal), with "LINK MARINES · ccip.dev" stamped beneath.
- **The front tag** is rotated about 5°. The callsign is embossed in three lines (JetBrains Mono 800, uppercase, light/dark text shadows), above the lore line "LM 0007 · BLOOD LINK+ / FAITH 4IR · 13 OCT 2026". The rim microtext runs inside the bottom rim.
- **Tier metals:**

  | Tier | Metal |
  |---|---|
  | Common | brushed steel |
  | Uncommon | bronze with green patina |
  | Rare | heat-tinted anodized titanium |
  | Legendary | gold |

  Legendary adds a holo sheen and sparkles. Rare adds a softer sheen.
- **Behind the tags, the Chainlink halo:** concentric glowing hexagons in the tier's color. Their intensity scales with tier: strong at Legendary, soft at Rare, faint outlines at Common and Uncommon.

**Right: the panel.**
- The Discord avatar and the stamped name.
- The tier wordmark in the tier's metal gradient (Inter 900).
- "top X% · rarer than N in 100 Marines".
- **The meme planets:**
  - each meme is a hexagon planet with a glow in the tier color;
  - ◆◆◆ tags get a double hex frame;
  - each is labelled with its tag name and pips plus "N meme(s)";
  - CCIP-style curved lanes join the three, with glowing message pulses, and the layout is chosen by the sky seed.

**Bottom.** "LINK MARINE #0007" (gold mono) on the left and "ccip.dev" (blue mono) on the right.

**The animated glint (Rare and up).** A short loop of about 1–1.5 s: a light sweep across the front tag. It's stored next to the static PNG, and `/dogtag` posts the animated one when it exists.

## 7. Intel cards (1200×675)

The visual target is `2026-10-13-linkmarine-bot-mockups/intel-cards.html`. All four share:
- the Marine card's universe: a navy sky, the Chainlink halo, gold for records and LINK, blue for CCIP;
- hex chain icons, filled with the icon's background color and the logo mark centered;
- an eyebrow in mono caps;
- "ccip.dev" at the top right.

They're cached in R2 for 5 minutes per command and argument.

### 7.1 `/cciptoday`: SITREP

The eyebrow is a pulsing-dot "LIVE" plus "SITREP · TUE 13 OCT 2026 · 10:40 UTC", the time being `today.json.updated_at`.

**The big number:** today's messages so far.

**The pace line:**
- projected = messages ÷ the fraction of the UTC day elapsed at `updated_at`;
- it shows ▲/▼ % against yesterday's total, from `history.json`'s last day if that day is yesterday, and omits the comparison otherwise;
- for example: "▼ 12% on pace for ~1,430 · yesterday 1,625";
- before 01:00 UTC, the pace line is replaced by "early in the day".

**Stats, hex-bulleted:**
- value moved;
- fees, and LINK share;
- unique senders;
- median delivery.

**Right:** "TOP LANES TODAY". A radar (concentric rings and a sweep) behind up to five of today's top lanes by value, drawn as curved lanes between hex chain icons. Line width is scaled by value, and the top three carry value labels.

**Bottom:** a UTC day progress bar from 00:00 to 24:00, with a marker at `updated_at`.

### 7.2 `/ccipchain <chain>`: the dossier

**Left:**
- the chain's hex icon as the hero, inside its own halo in the chain's color, with a double frame;
- up to four top partners from the last 7 days (both directions, by value from `replay.json`) in orbit, joined by lanes with pulses and value labels.

**Right:**
- the eyebrow "CHAIN DOSSIER · CCIP";
- the chain's display name, without " Mainnet", as the big title;
- a highlight line: its rank by all-time value moved (both directions, from `replay.json`) as "#R of N all time". When the chain is in the top 3 by 7-day fees (`top/src_chain.json` `by_fees.7d`), " · #K in fees this week" is added;
- stats:
  - all-time messages and value moved (both directions);
  - all-time fees paid on the chain (`top/src_chain.json`, all);
  - the last 7 days of messages and value;
- a 7-bar chart of messages a day over the last 7 finalized days, the newest in gold.

**Bottom left:** "ON CCIP SINCE <first_seen>".

### 7.3 `/linkreserve`: the vault

**Left:** a gold hex vault door with bolts at the vertices and a dashed inner ring, around the Chainlink logo (a blue hexagon outline), inside a soft gold halo.

**Right:**
- the eyebrow "CHAINLINK RESERVE";
- the LINK held as the big gold number;
- "LINK held · $value at $price";
- the gain on cost: ▲/▼ `cost_basis.change_pct` "on its $cost_usd cost";
- "N-week deposit streak · ~X a week" (the 4-week average);
- "last <link> LINK on <day>";
- "next one due ~<day>", or "overdue since <day>" when `deposit_overdue` is set;
- weekly deposit bars for the last 26 weeks, the latest in pale gold.

**Bottom left:** "<next milestone> LINK ETA <date>".

### 7.4 `/cciprecords`: the hall of records

The eyebrow is "HALL OF RECORDS · CCIP ALL TIME".

**Five hex medals with gold frames,** for the all-time records by the Records page's rules (`packages/core` records logic):
- the most messages in a day;
- the most value moved in a day;
- the most fees in a day;
- the largest single fee (with its lane);
- the highest LINK share in a day.

Each medal shows its value, its label and its date. The most recently set record is raised, glows, and carries a NEWEST badge.

**Bottom:** all-time messages and value moved "since <coverage start>".

## 8. Architecture

**The `discord` Worker** (`discord/` in the pnpm workspace; Worker name `ccip-dev-discord`):
- It serves `POST /interactions` on a ccip.dev subdomain, for example `discord.ccip.dev`.
- It verifies `X-Signature-Ed25519` and `X-Signature-Timestamp` against the app's public key, using `crypto.subtle` Ed25519. A failure answers 401.
- PING (type 1) is answered with PONG.
- Commands (type 2) get a deferred response (type 5). The work runs in `ctx.waitUntil`: it edits `PATCH /webhooks/{app_id}/{token}/messages/@original`, as multipart with the image attachment.
- Autocomplete (type 4) answers type 8 synchronously from a cached `chains.json`.
- Errors are sent as private follow-up messages: flags 64, `POST /webhooks/{app_id}/{token}` with the error text.

**Data.** It fetches `https://data.ccip.dev/v1/*.json`: today, history, chains, replay, reserve and top files. A small in-isolate cache plus the Cache API keep them for 60 s. It has no access to the data Worker's D1.

**Rendering.**
- The site Worker exposes a named entrypoint, a `WorkerEntrypoint` class reached through a service binding: `renderMarineCard(data)`, `renderMarineGlint(data)`, `renderMarineCards(data)`, `renderIntelCard(kind, input)`.
- The bot stamps with `renderMarineCards`: one render gives the PNG and, for Rare and up, the glint. A glint that fails comes back as its reason beside the PNG; a call that fails whole is followed by `renderMarineCard` alone for Rare and up.
- It's not routable from the public internet. It returns PNG bytes, or the animated image.
- The art layers (tags, halo, hex clipping, glows, lanes, charts) are built as SVG and embedded in the Satori tree as image layers. Text uses Satori with the existing fonts.
- Meme bytes are passed in by the bot, from R2. Chain icons come from the site's bundled icons.

**Registration.** `pnpm discord:register` uses `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN` from the owner's shell to PUT the six commands to the LinkMarine guild. These are guild commands only.

**Secrets:**
- the bot Worker: `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and the existing alert secrets;
- `DISCORD_BOT_TOKEN` is used only by the registration script, on the owner's machine.

**Vars:** `DISCORD_GUILD_ID`.

**Deploy.** The existing deploy workflow deploys the new Worker. The D1 migrations live in `discord/migrations/`.

## 9. Failures and alerts

- **A bad signature** gets 401 and no alert. That's normal internet noise.
- **A data fetch failure or an unparseable file** gets the private "Intel is unavailable" reply and the alert `discord-data:<file>`, once an hour.
- **A render failure:** an intel command gets the private internal-failure reply. Enlistment keeps the saved draw (§5.4). Both alert `discord-render:<kind>`, once an hour.
- **Meme copy failure** (GitHub unreachable): the enlistment is still saved, and the card is stamped later by `/dogtag`, which retries the copy. It alerts `discord-memes`.
- **Other alerts, each once an hour:**
  - `discord-render:marine` also covers memes missing from storage right after copying, a card that could not be read back, stamping that passed its deadline, and a glint that failed while the static card was posted and kept;
  - `discord-upload`: Discord refused a card upload (the post falls back from the GIF to the PNG to text);
  - `discord-store:marine`: the card rendered but R2 or `card_key` would not keep it;
  - `discord-draw`: all 20 draws clashed;
  - `discord-command:<name>`: a command failed unexpectedly.
- **Concurrent `/enlist`:** the second request gets the "already enlisted" path once the first commits, through the UNIQUE (platform, user_id) constraint.
- **Alerts** use the same Telegram alert chat and dedupe pattern as the other Workers.

## 10. Testing

Vitest in workerd, like `worker/`:
- **Signatures:** valid, forged and missing; PING.
- **Routing:** each command's routing and its deferral; autocomplete matching and its 25-item limit.
- **The draw:** with a seeded random source.
  - weighting follows √count;
  - three distinct tags;
  - a clash draws again;
  - tiers come from the cut-offs; the percentile; the pips; lore weighting.
- **The snapshot generator:** tested against a small fixture archive.
- **D1:** uniqueness on (platform, user_id) and on tag_key; serial order; a double enlistment.
- **The reveal:** its edit sequence and timing against a fake Discord API; render failure keeps the draw.
- **Intel math from fixture files:** today's pace (including before 01:00, and a missing yesterday), chain rank and partners, the Reserve fields including overdue, and records, including which one is newest.
- **The site entrypoint:** each card renders to a valid PNG at 1200×675 from fixtures, and the animated glint is a valid animated image of bounded size.
- **Visual check:** a script renders every card from fixtures into a folder. Every tier and every intel card gets a human look before launch.

## 11. Rollout

1. **Experiments first.** The plan's first task checks two things:
   - that Discord autoplays the chosen animated format as an attachment, and that the site Worker can encode it within its limits;
   - that resvg renders the etched-meme filter (grayscale and contrast).

   If the glint fails, Rare and up stay static. If the filter fails, the etching falls back to a tinted overlay.
2. **Merge.** The deploy of the bot is gated by the repository variable `DISCORD_BOT`, because the D1 database id must exist and be committed first. Before setting it to `on`, the owner applies the migrations and deploys the bot once from their own login: that first deploy attaches the `discord.ccip.dev` custom domain, which needs a zone permission the CI deploy token does not have (or the token gains Zone · Workers Routes · Edit on `ccip.dev`). Once it is `on`, CI deploys every merge, with no commands registered yet.
3. **Owner steps:**
   - create the Discord app;
   - set the interactions URL;
   - set the secrets;
   - invite the app with the `applications.commands` link;
   - run `pnpm discord:register` (Discord refuses guild commands, 403 Missing Access, for an app not yet in the server: invite first).
4. **The owner enlists first, as Marine #0001,** in a test channel. Then announce.

## 12. Risks

- **The animated format.** Discord's autoplay support, file size and encode cost decide this. The first task settles it. The static card is the fallback.
- **Renderer features.** Satori lacks clip-path and filters, which is why the art is drawn as SVG layers. resvg's filter support is checked in the first task.
- **GitHub raw availability for memes.** Copying at enlistment and retrying on `/dogtag` covers it.
- **Discord rate limits on the reveal's edits.** The edits are spaced at least 1 s apart. A 429 waits for `retry_after` once.
- **Alts farming rare draws.** Accepted: the cards are free cosmetics.
