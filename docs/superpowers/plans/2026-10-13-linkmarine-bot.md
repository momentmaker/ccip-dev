# The LinkMarine Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Discord app for the LinkMarine server where `/enlist` draws a permanent three-tag meme callsign and stamps it on a pair of dog tags, `/dogtag` shows a Marine's card, and `/cciptoday`, `/ccipchain`, `/linkreserve` and `/cciprecords` post CCIP intel as cinematic 1200×675 cards, every reply an image.

**Architecture:** A new `discord` Worker (`ccip-dev-discord`, `POST https://discord.ccip.dev/interactions`) verifies Discord's Ed25519 signature with `crypto.subtle`, answers PING and `/ccipchain` autocomplete inside the request, and defers every command, doing the work in `ctx.waitUntil` and editing the reply through the interaction webhook. It keeps Marines in its own D1 (`ccip-dev-marines`) and cards, memes and avatars in its own R2 bucket, and reads intel only from `https://data.ccip.dev/v1/`. The cards are drawn by the site Worker's new named entrypoint `LinkMarineCards`, reached over a private service binding: Satori lays out text, images and their clip-paths and filters, and resvg draws the art (tags, halos, lanes, charts) from full-card SVG layers in the mockups' 760×428 coordinates; a small pure-JS GIF encoder turns the static card into the Rare and Legendary glint. The callsign odds come from a committed snapshot that `pnpm discord:snapshot` builds from `docs/callsigns/tags.toml`, `docs/callsigns/lore.toml` and the `../chainlinkmeme` archive.

**Tech Stack:** TypeScript (ESM), Vitest 4 (Node for core, the site's trees and the scripts; `@cloudflare/vitest-plugin` in workerd for the site's renders and the whole bot, with real D1 and R2), `@cf-wasm/og` 0.5.0 (Satori 0.32.0, resvg-wasm 2.4.1), Web Crypto Ed25519, Workers RPC (`WorkerEntrypoint`) over a service binding, the Discord interactions API v10, `smol-toml` (already a root dev dependency). One new runtime dependency: `gifenc` 1.0.3 in the site Worker.

**Spec:** `docs/superpowers/specs/2026-10-13-linkmarine-bot-design.md`. The visual targets are `docs/superpowers/specs/2026-10-13-linkmarine-bot-mockups/dog-tag-card.html` and `intel-cards.html` (760×428; every number in them is scaled by 1200/760 here). Background: `docs/callsigns/rules.md`, the card renderer in `site/worker/` and the alerts in `worker/src/alerts.ts`.

## Global Constraints

- **Commands** (spec §1): "`/enlist`, `/dogtag [@marine]`, `/cciptoday`, `/ccipchain <chain>`, `/linkreserve`, `/cciprecords`." "Not in v1: the Oracle game, ranks, watches, the mess hall (memes), and Telegram enlistment."
- **Replies:** "Replies are public in the channel where the command ran. Errors are private (ephemeral)." The private errors, verbatim: "No chain called '<x>' on CCIP."; "Intel is unavailable right now, try again in a minute."; "Something went wrong. It's been reported."
- **Install:** "The app is installed with the `applications.commands` scope only. It gives no roles, changes no nicknames and reads no messages." "These are guild commands only."
- **Per platform:** "A Discord account and, later, a Telegram account each get their own card. The two are never linked. Callsigns and serials are shared across platforms, so a callsign is unique everywhere."
- **Success criteria** (§2): "every command is acknowledged within Discord's 3 seconds. An intel card appears within about 5 s, and the enlistment reveal completes within about 8 s." "a Marine's callsign, serial, tier, memes, lore and stamped name never change; `/enlist` never draws twice; no two Marines share a callsign, in any order, on any platform." "every number on an intel card comes from the public data files and matches the site. Each intel card shows its "as of" time." "the cards match the approved mockups in layout, palette and effects at 1200×675." "unsigned requests are rejected. The bot can't post anywhere it wasn't invoked. A broken data file or render never produces a half-drawn card." "nothing in the bot can affect ingest, finalize, broadcasts or the website."
- **The draw** (§5.2): "Each tag's chance is proportional to √(its count)". "The callsign is the three tags in draw order, joined by hyphens." "A sorted key of the three tags is unique in D1. On a clash, draw again, up to 20 times. If all 20 clash, it fails with an internal alert." "Score = Σ −ln(p_tag). The tier comes from the snapshot's cut-offs, at shares of 60/25/12/3% for Common, Uncommon, Rare and Legendary." "Percentile: the share of simulated draws scoring below this one." Pips: "◆◆◆ for exactly 1; ◆◆◇ for 2–9; ◆◇◇ for 10–49; ◇◇◇ for 50 or more." "One meme per tag, chosen from the tag's SFW filenames by a PRNG seeded with the callsign." "BLOOD and FAITH are each drawn by weight from `docs/callsigns/lore.toml`". Starter lore: "BLOOD: LINK+, O-LINK, 7777777; FAITH: 4IR, SERGEY, STAKING, FUNDAMENTALS." Rim phrases: "LINK MARINES · STAY POOR · 4IR · FUNDAMENTALLY · WAGMI". "Serial: a global counter starting at 1, in enlistment order (a D1 `INTEGER PRIMARY KEY AUTOINCREMENT`)." "Stamped name: ... (`member.nick` ?? `user.global_name` ?? `user.username`). It is stamped once." "Randomness: `crypto.getRandomValues` for the tag draw and the lore. Deterministic, callsign-seeded randomness for everything visual."
- **The snapshot** (§5.1): "`pnpm discord:snapshot`, reads the local `../chainlinkmeme` checkout and writes `discord/src/data/callsigns.json`, which is committed", holding "the allowed tags ... (only memes with `nsfw = false` count), excluding tags longer than 13 characters", "for each tag, its SFW meme filenames", "the chainlinkmeme commit SHA", "the tier cut-offs and the score distribution: 200,000 seeded simulated draws", "a `version`". "A Marine's stored tier never changes. A later snapshot changes odds only for future draws."
- **Storage** (§5.3): D1 `ccip-dev-marines`, table `marines` with the spec's columns; R2 `ccip-dev-marines`.
- **The reveal** (§5.4): "Acknowledge with a deferred response (type 5)." "Drawing your callsign… ▮▮▮" → "PAINTING ▮▮" → "PAINTING · SPACE ▮" → "PAINTING · SPACE · PROPHECY"; "⚠ RARE DRAW" or "⚠ LEGENDARY DRAW"; "Edit in the card as an attachment, with the callsign as the message text." "The draw is committed to D1 before the reveal starts. If the render fails, the final edit says "You're `<callsign>`, Marine #<serial>. Your tag is being stamped; run `/dogtag` in a minute." `/dogtag` renders any missing card on demand." "The edits are spaced at least 1 s apart. A 429 waits for `retry_after` once."
- **Cards** (§6, §7): the dog tag card and the four intel cards as the spec and the mockups describe them; "They're cached in R2 for 5 minutes per command and argument."
- **Architecture** (§8): Worker `ccip-dev-discord` at "`POST /interactions`"; "A failure answers 401." "PING (type 1) is answered with PONG." "Commands (type 2) get a deferred response (type 5)." "Autocomplete (type 4) answers type 8 synchronously from a cached `chains.json`." Data: "A small in-isolate cache plus the Cache API keep them for 60 s. It has no access to the data Worker's D1." Rendering: "a `WorkerEntrypoint` class reached through a service binding: `renderMarineCard(data)`, `renderMarineGlint(data)`, `renderIntelCard(kind, input)`. It's not routable from the public internet." "Meme bytes are passed in by the bot, from R2. Chain icons come from the site's bundled icons." Secrets: "`DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and the existing alert secrets"; "`DISCORD_BOT_TOKEN` is used only by the registration script, on the owner's machine." Vars: "`DISCORD_GUILD_ID`." "The D1 migrations live in `discord/migrations/`."
- **Alerts** (§9): "`discord-data:<file>`, once an hour", "`discord-render:<kind>`, once an hour", "It alerts `discord-memes`." "A bad signature gets 401 and no alert." "Alerts use the same Telegram alert chat and dedupe pattern as the other Workers."
- **pnpm workspace, TypeScript ESM, Vitest;** workerd tests through `@cloudflare/vitest-plugin`, as `worker/` does.
- **Tests:**
  - Core: `pnpm --filter @ccip-dev/core test`.
  - Site: `pnpm --filter @ccip-dev/site test` (the Node and the workerd configs).
  - Bot: `pnpm --filter @ccip-dev/discord test` (workerd, real D1 and R2).
  - Scripts: `pnpm exec vitest run scripts/test/<file>` from the repo root.
  - Everything: `pnpm test` and `pnpm typecheck` at the root, green after every task.
  - New tests use the comments `// #given`, `// #when` and `// #then`.
- **Comments:** only where the why is not obvious from the code.
- **Commits:** conventional subjects. Stage explicit paths only; never `git add -A`, `git add .` or `git commit -a`. End each message with a `Co-Authored-By:` trailer naming the model you are (shown below as `<your model>`).
- **Free services only.** Workers Paid is already in place. No paid APIs.
- **Remote operations are owner steps.** Never run `wrangler … --remote`, never set or print a secret, and never create Discord or Cloudflare resources. They are in the runbook as exact commands for the owner. The deploy workflow's own steps are the only exception, and they run only once the owner switches `DISCORD_BOT` on.
- **`.backfill/` is the owner's:** never write to it. Never stage `.superpowers/`.
- **New dependencies** only as stated: `gifenc` 1.0.3, exact, in the site. No Ed25519 helper: workerd's `crypto.subtle` verifies Ed25519.
- **The site's existing cards and routes must not change.** `CARD_FONTS` stays as it is, the new code lives in `site/worker/linkmarine/`, and `site/worker/index.ts` only adds a named export. Its existing tests stay green.

## Review Focus

1. **An error answered after the public defer goes public.** Discord's docs: a followup sent "directly after responding to an interaction with `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` ... will function as Edit Original Interaction Response ... The ephemeral flag will be ignored". So the spec's "private follow-up messages: flags 64" would print "No chain called 'x' on CCIP." to the whole channel. A Marine expects it to be theirs alone.
   - Tests: Task 11 "answers privately by deleting the loading message first, since Discord would edit it instead and ignore the flag"; Task 11 "says publicly that another member hasn't enlisted, and privately when it is the one asking"; Task 13's error tests, which expect `private` calls only.
2. **A meme too big to draw.** The archive holds animated GIFs of up to 8.2 MB. Inlined twice into the card's SVG, three of them would not fit a 128 MB isolate (nor, as originals, a 32 MiB RPC call). A Marine expects their card anyway.
   - Tests: Task 3 "keeps a JPEG, a PNG or a GIF meme as a 240×240 PNG, an animated GIF by its first frame"; Task 10 "copies each meme from the archive at the pinned commit, as the PNG the site makes of it". The 8.2 MB GIF was measured by hand (see "Decisions").
3. **A display name the fonts cannot draw.** A stamped name of emoji or CJK, a ◆ pip or a → arrow would be drawn as nothing by the Latin-subset fonts. A Marine expects a legible card.
   - Tests: Task 3 "writes no character the card fonts lack, and a name of emoji alone as "Marine""; Tasks 5 and 6 "writes no character the card fonts lack".
4. **`/enlist` twice, or twice at once** (a double tap, or a second try while the reveal runs). A Marine expects one draw, ever, and the next Marine to be the next serial.
   - Tests: Task 10 "gives two enlistments at once one Marine: the second finds the first" (and the next Marine is #2) and "draws again on a callsign whose tags another Marine holds in any order, keeping serials dense"; Task 11 "answers a Marine who enlists again with their own card, drawing nothing".
5. **A chain typed rather than picked:** another case, " Mainnet" on the end, the registry name, the selector, or a chain CCIP never saw. A Marine expects the chain, or a private "No chain called".
   - Tests: Task 12 "finds a chain however it is typed: name, " Mainnet", registry name, selector, any case"; Task 13 "finds /ccipchain however it is typed, and keeps each typing apart" and "answers privately when there is no such chain, drawing nothing and alerting no one".

Also checked and pinned, but less likely to bite: scores that tie at a cut-off (Task 8 "puts a cut-off between steps of equal scores"); two lanes between the same chains both ways (Task 5 seating test); a week in progress without a deposit (Task 12); the lore line FAITH FUNDAMENTALS (Task 3 "shrinks the lore rows"); Discord rate-limiting an edit twice in a row (Task 11 "a second 429 fails"); the slow GitHub of Review Focus 2's copy, bounded so the reveal ends inside `waitUntil`'s 30 s (Task 10's 8 s copies in parallel, Task 11's 5 s avatar).

## Decisions the spec leaves open or gets wrong

- **Experiment (a), the animated glint: GIF, encoded by `gifenc` 1.0.3.**
  - Discord autoplays GIF attachments (honouring the viewer's "Automatically play GIFs" setting). Animated WebP attachments also play since 2025 ("You can now share animated WebP and AVIF content through attachments and embeds", Discord engineering blog, 12 Mar 2025: https://discord.com/blog/modern-image-formats-at-discord-supporting-webp-and-avif). APNG attachments are shown as their first frame (Discord's own feedback forum, https://support.discord.com/hc/en-us/community/posts/360030116852-APNG-support; no official statement). GIF is chosen: it plays everywhere Discord plays images, and it has a small pure-JS encoder; an animated WebP encoder for Workers would mean a libwebp wasm build with its muxer, several hundred KB more.
  - `gifenc` 1.0.3 (MIT, no dependencies, 9 KB minified ESM): its LZW writer and its quantizer. The plan adds its own 4×4 ordered dithering (gifenc has none) and draws every frame after the first as only the pixels that change, transparent elsewhere, with disposal "do not dispose".
  - Measured in workerd (vitest-plugin, an Apple-silicon Mac; production CPUs differ): the static card renders in 2.5–2.6 s (746–790 KB PNG); the glint, render and encode together, in 2.8–2.9 s: 13 frames (the card held 600 ms, then a 12-frame sweep at 60 ms, a 1.32 s loop), 423 KB for Rare and 509 KB for Legendary. In Node the encode alone took 0.34–0.53 s. Well inside the 30 s default CPU limit and Discord's 20 MiB upload limit. The quality, dithered, shows no banding in the sky or the metal: see the frames below.
  - The site Worker's bundle grows from 3,312.14 KiB to 3,476.37 KiB (gzip 1,019.05 → 1,100.68 KiB): the two fonts add 78.6 KB of base64 and `gifenc` 22.6 KB. The limit is 64 MiB uncompressed (https://developers.cloudflare.com/workers/platform/limits/).
  - `gifenc` ships CommonJS as `main` and ESM as `module`, without `exports`: Wrangler's bundle and the workerd tests get the named exports, Node gets them on `default`. `glint.ts` takes whichever it is handed.
  - `/enlist` and `/dogtag` call `renderMarineCard` and `renderMarineGlint` at once (two RPC calls render in parallel); the static PNG is kept beside the GIF, and `/dogtag` posts the GIF when there is one.
- **Experiment (b), the etched filter: yes, but through Satori's own CSS, not an SVG filter in an art layer.** resvg draws no raster `<image>` inside an SVG that is itself an image (usvg loads a nested SVG with image loading off), filter or none: an art layer with the meme in it draws only the background (the pixel check in Task 2: green where the meme should be). Satori 0.32.0 does support CSS `filter` and `clipPath` on an `img`, and resvg draws them: grayscale(1) contrast(1.7) brightness(0.95) turns the red meme grey (r = g = b within 2) and the hexagon's corner stays the background. So every meme, avatar and chain icon is a card element with a `clipPath`, and the art layers hold only shapes. Satori has no `mix-blend-mode`, so the mockup's "multiply" becomes `sepia(0.35)` at 62% opacity over the metal: the etching follows the meme and loses its colour (Task 3's pixel test). The tinted-overlay fallback is not needed.
- **Fonts:** added Inter 900 (the wordmark, the big numbers) and JetBrains Mono 700 (eyebrows, rows, labels), as WOFF from `@fontsource`, SIL OFL 1.1 like the others, 59 KB. The mockups' Inter 600 and JetBrains Mono 500 and 600 map to 700. They join a new `KINO_FONTS`; `CARD_FONTS` is unchanged, so no existing card can pick up a new weight.
- **Rendering approach, checked by rendering every tier and every intel card at 1200×675** (`pnpm --filter @ccip-dev/site cards:linkmarine`, real memes, real data from 13 Oct 2026). The renders:
  - `/private/tmp/claude-501/-Users-rubberduck-GitHub-momentmaker-ccip-dev/19cabbec-cd1e-4fc5-a2ef-ade789a597b9/scratchpad/lm-renders/v4/marine-legendary.png`, `…/marine-rare.png`, `…/marine-uncommon.png`, `…/marine-common.png` (the four sample Marines between them use all three planet layouts);
  - the glints `…/marine-legendary.gif`, `…/marine-rare.gif`, and their mid-sweep frames `…/marine-legendary-glint-frame7.png`, `…/marine-rare-glint-frame7.png`;
  - `…/intel-sitrep.png`, `…/intel-dossier.png`, `…/intel-vault.png`, `…/intel-records.png`.
  - The art layers carry the halos, metals (CSS gradients converted to SVG exactly: the same line through the centre, the same length), shadows, inset edges, the holo sheen (`mix-blend-mode: overlay` inside the layer, which resvg does draw), lanes, glows, radar, vault and medals. Text is Satori's, turned with the tags by `transform: rotate()`.
- **Discord, checked against discord/discord-api-docs at commit 37148620 (9 Oct 2026):**
  - `developers/interactions/overview.mdx`: "Validate security-related request headers (`X-Signature-Ed25519` and `X-Signature-Timestamp`)"; the signature covers the timestamp followed by the raw body; "If the signature fails validation, your app should respond with a `401` error code." Discord sends a PING when the endpoint URL is saved.
  - `developers/interactions/receiving-and-responding.mdx`: interaction types PING 1, APPLICATION_COMMAND 2, APPLICATION_COMMAND_AUTOCOMPLETE 4; response types PONG 1, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE 5, APPLICATION_COMMAND_AUTOCOMPLETE_RESULT 8, the autocomplete data "max of 25 choices"; "Interaction `tokens` are valid for **15 minutes** ... you **must send an initial response within 3 seconds**"; `PATCH /webhooks/{application.id}/{interaction.token}/messages/@original` "Functions the same as Edit Webhook Message"; `DELETE` of the same path; followups `POST /webhooks/{application.id}/{interaction.token}` with "the `EPHEMERAL` message flag `1 << 6` (64)", and the line Review Focus 1 quotes. Interaction webhooks need no bot token, so the Worker holds none. The resolved data: "users? Map of Snowflakes to user objects", "members? ... partial Member objects", which "are missing `user`".
  - `developers/reference.mdx`: multipart uploads with `files[n]` and `payload_json`; "The file upload size limit applies to each file in a request. The default limit is `20 MiB`"; the CDN: `avatars/{user_id}/{user_avatar}.png`, `guilds/{guild_id}/users/{user_id}/avatars/{member_avatar}.png`, and `embed/avatars/{index}.png` with "`index` will be `(user_id >> 22) % 6`" for migrated users; `?size=` any power of two.
  - `developers/resources/webhook.mdx`: "Starting with API v10, the `attachments` array must contain all attachments that should be present after edit". The client sends `attachments: [{ id: 0, filename }]` with each image, and `[]` with each text edit, and `allowed_mentions: { parse: [] }` on everything, so the bot never pings anyone.
  - `developers/interactions/application-commands.mdx`: "Bulk Overwrite Guild Application Commands" is `PUT /applications/{application.id}/guilds/{guild.id}/commands`; options take `autocomplete` (STRING) and `required`; option type 6 is USER.
  - `developers/topics/rate-limits.mdx`: limits are per route, read from `X-RateLimit-*` headers; a 429 carries `retry_after` (seconds, a float); "Interaction endpoints are not bound to the bot's Global Rate Limit." No number is published for webhook edits, so the spec's "about 1 per second" is kept as a floor: the reveal waits 1 s between edits, and a 429 is waited out once (at most 10 s), the request sent whole again.
- **Cloudflare, checked:**
  - Named entrypoints: `export class LinkMarineCards extends WorkerEntrypoint` on the site Worker, bound from the bot with `[[services]] binding = "SITE" service = "ccip-dev-site" entrypoint = "LinkMarineCards"` (`wrangler/config-schema.json` 4.147.0: "entrypoint ... the entrypoint (named export) of the service to bind to"; https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/). `wrangler deploy --dry-run` lists `env.SITE (ccip-dev-site#LinkMarineCards)`. "The maximum serialized RPC limit is 32 MiB" (https://developers.cloudflare.com/workers/runtime-apis/rpc/): the bot passes 240 px PNGs only.
  - Ed25519: workerd's Web Crypto signs and verifies `Ed25519` (Secure Curves; https://developers.cloudflare.com/workers/runtime-apis/web-crypto/). No helper library.
  - `ctx.waitUntil()` "can extend execution for up to 30 seconds after the response is sent" (https://developers.cloudflare.com/workers/runtime-apis/context/). This, not the 15-minute token, bounds the reveal: the three meme copies run at once with 8 s timeouts, the avatar has 5 s, and the renders take about 3 s, so even a slow GitHub ends the reveal well inside 30 s.
  - Tests: the site's workerd tests construct the entrypoint directly, `new LinkMarineCards(createExecutionContext(), { ASSETS })`. The bot's `vitest.config.ts` runs a stand-in `ccip-dev-site` Worker (`discord/test/site-stub.js`, the same entrypoint answering marker bytes) as an auxiliary worker, because Miniflare refuses to start a binding to a service it does not have; the bot's own tests inject a `fakeRenderer` instead.
- **Rulings where the spec is open or off:**
  - **Errors after the defer** (Review Focus 1): `privateFollowup` deletes the deferred "thinking" message, then posts the error with flags 64. Whether Discord then creates the followup as a new ephemeral message was not seen live (no Discord app exists yet); the docs only describe the case before a deletion. The runbook's launch step checks it with an unknown chain.
  - **"top X%"** is the share of draws at the tier or rarer, 40 for Uncommon, 15 for Rare, 3 for Legendary, as the mockup's Legendary "top 3%" reads; Common prints only "rarer than N in 100 Marines" ("top 100%" says nothing; "top 60%" would be wrong).
  - **Cut-offs between steps.** Scores come in steps (three tags of one meme each always score the same), so the share at a cut-off cannot always be exact. Each cut-off is the step edge nearest its share, a score equal to a cut-off takes the rarer tier, and scores are summed in tag order to 6 decimals so the same three tags score exactly the same in any order. On the archive at `ec873ea` the shares come out 59.78 / 25.31 / 12.06 / 2.85% (200,000 draws).
  - **Memes are kept as 240×240 PNGs**, `memes/<file>.png` in R2, made by a fourth entrypoint method, `prepareMeme(image)`: the card never draws one larger than 145 px, and the originals reach 8.2 MB (Review Focus 2). The original bytes are fetched from the pinned raw URL and not kept. The 8.2 MB GIF prepares in 569 ms to a 141 KB PNG.
  - **The avatar** is fetched at stamping (`?size=128`) and kept as `avatars/<serial>.png`, so a card stamped later by `/dogtag` keeps it; without one the card draws the mockup's gradient disc.
  - **Serials stay dense.** An insert that loses on `tag_key` would still use up an AUTOINCREMENT value, so a clash is looked up before inserting; only a race between two Marines drawing the same three tags at the same moment (caught as `UNIQUE constraint failed: marines.tag_key`) is drawn again after a failed insert, which SQLite rolls back whole.
  - **The dossier counts both directions**, as the spec says: Base is 552,062 messages and $3.8B; the mockup's 275,325 and $1.84B were messages from Base only. The rank is "#R of N" among every chain in `replay.json` (92), as the mockup reads.
  - **"As of" on every intel card:** the SITREP's eyebrow has its time; the dossier, the vault and the hall of records print "AS OF 13 OCT 2026 · 06:01 UTC" at the bottom right, from their file's `updated_at`.
  - **The vault's bars** leave out the week in progress while it has no deposit, as the mockup's last bar (82,480 LINK, the week of Oct 5) does.
  - **Planet glows and frames take the tier's colour** for every planet, as the spec says; the mockup's third planet is blue. ◆◆◆ planets get the double frame in the tier's paler accent.
  - **Names the fonts lack** are dropped from the card; a name with nothing left becomes "Marine" (Review Focus 3). The stored name is untouched.
  - **The lore row** shrinks below the mockup's 11 px only when a line would run off the tag: "FAITH FUNDAMENTALS · 13 OCT 2026" sets at 9.9 px. `lore.toml` lines are 1–12 characters of A–Z, 0–9, + and -.
  - **Message text:** the reveal's last edit and `/dogtag` carry the callsign; intel replies carry the card alone.
  - **The intel cache** is R2's copy, keyed by command and, for `/ccipchain`, the typed argument lowercased, and it is checked before any data is read, so a fresh card still posts while `data.ccip.dev` is down.
  - **Alerts beyond the spec's three:** `discord-draw` when all 20 draws clash (the spec's "internal alert") and `discord-command:<name>` for anything a command did not catch. All go through the bot's own `meta` table, once an hour per signature, like `worker/src/alerts.ts`.
  - **`DISCORD_GUILD_ID`** lives in `discord/wrangler.toml`'s `[vars]`, read by the Worker and by `pnpm discord:register`. Empty, the Worker turns every command away.
  - **Rollout step 2 ("The deploy creates the Worker").** The D1 database needs its id in `discord/wrangler.toml` before a deploy can bind it, and creating it is an owner step. So the deploy workflow's two new steps run only when the repository variable `DISCORD_BOT` is `on`; the owner creates the database and the bucket, commits the id, sets the variable, and the next deploy creates the Worker. Until then a merge deploys nothing new. Automatic provisioning (Wrangler's open beta) was not relied on.
  - **The snapshot's `version`** is 1 for the first and goes up by one whenever the content changes, so each Marine's `snapshot_version` names the odds it was drawn under.
  - **The 3-second window:** the Worker answers PING and commands without awaiting anything slow; autocomplete awaits `chains.json`, which is cached and small.

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/core/src/linkmarine.ts`, `packages/core/package.json` | 1 | Tiers, pips, seeds, the rim text, the card inputs and the renderer's interface |
| `site/scripts/embed-fonts.ts`, `site/worker/fonts.ts`, `site/worker/linkmarine/{art,fonts,render}.ts` | 2 | Inter 900 and Mono 700, art layers in mockup coordinates, hexagons, pips, `renderKino` |
| `site/worker/linkmarine/{metal,marine-card,meme,entrypoint}.ts`, `site/worker/index.ts` | 3 | The dog tag card, meme preparation, the `LinkMarineCards` entrypoint |
| `site/worker/linkmarine/{gifenc.d.ts,glint}.ts`, `site/package.json` | 4 | The animated glint |
| `site/worker/linkmarine/{chain-hex,intel-frame,sitrep-card,dossier-card}.ts` | 5 | Chain hexagons, the intel frame, SITREP and dossier |
| `site/worker/linkmarine/{vault-card,records-card,intel}.ts`, `site/scripts/render-linkmarine-cards.ts` | 6 | Vault, hall of records, `renderIntelCard`, `pnpm cards:linkmarine` |
| `discord/{package.json,tsconfig.json,wrangler.toml,vitest.config.ts}`, `discord/migrations/0001_marines.sql`, `discord/src/{env,verify,interactions,index}.ts` | 7 | The Worker, its signature check and its router |
| `discord/src/draw.ts` | 8 | The draw, scores, tiers, percentiles, lore, memes, the simulation |
| `discord/src/snapshot.ts`, `scripts/discord/{archive,snapshot}.ts`, `docs/callsigns/lore.toml`, `discord/src/data/callsigns.json` | 9 | The snapshot and its generator |
| `discord/src/{store,memes}.ts` | 10 | Enlistment in D1, the meme copy into R2 |
| `discord/src/{discord-api,alerts,bot,marines}.ts` | 11 | Discord's webhook client, alerts, `/enlist` and its reveal, `/dogtag` |
| `discord/src/intel.ts` | 12 | The intel cards' numbers |
| `discord/src/{data,intel-commands}.ts` | 13 | The public files, the intel commands, autocomplete, the R2 cache |
| `discord/src/commands.ts`, `scripts/discord/{commands,register}.ts`, `.github/workflows/deploy.yml`, `docs/{runbook,methodology}.md` | 14 | Registration, the gated deploy, docs |

---

### Task 1: The LinkMarine vocabulary in core

The bot draws and computes; the site draws the cards. Both speak through these types and helpers, so they live in `@ccip-dev/core`, which both already depend on.

**Files:**
- Create: `packages/core/src/linkmarine.ts`
- Modify: `packages/core/package.json` (the `./linkmarine` export)
- Test: `packages/core/test/linkmarine.test.ts`

**Interfaces:**
- Consumes (live code): `type RecordKind` (`records.ts`).
- Produces (`@ccip-dev/core/linkmarine`):
  - `TIERS = ['common', 'uncommon', 'rare', 'legendary'] as const`, `type Tier`, `TIER_SHARE_PCT: Record<Tier, number>` (60/25/12/3);
  - `tierTopPct(tier: Tier): number | null` (40, 15, 3; null for Common), `hasGlint(tier: Tier): boolean` (Rare and Legendary);
  - `filledPips(memes: number): 0 | 1 | 2 | 3`;
  - `callsignSeed(callsign: string): number` (FNV-1a 32-bit), `seededRandom(seed: number): () => number` (mulberry32, [0, 1));
  - `RIM_PHRASES`, `rimText(seed: number): string` (the five phrases in a seeded order, twice, joined by " · ");
  - `serialText(serial: number): string` ("0007");
  - `interface MarineCardMeme { tag: string; count: number; png: Uint8Array }`;
  - `interface MarineCard { serial; callsign; tier: Tier; percentile; memes: readonly MarineCardMeme[]; blood; faith; name; enlistedAt; avatar: Uint8Array | null }`;
  - `interface IntelChain { selector: string; name: string }`, `interface IntelLane { src: IntelChain; dst: IntelChain; usd: number }`;
  - `interface SitrepCard { updatedAt; messages; pace: { projected: number; yesterday: number | null } | null; usd; feesUsd: number | null; linkSharePct: number | null; senders; medianDeliveryS: number | null; lanes: readonly IntelLane[] }`;
  - `interface DossierCard { asOf; chain: IntelChain; rank; ranked; feeRank: number | null; messages; usd; feesUsd: number | null; week: { messages; usd }; days: readonly { day; messages }[]; partners: readonly { chain: IntelChain; usd }[]; since: string | null }`;
  - `interface VaultCard { asOf; link; valueUsd; priceUsd; changePct; costUsd (each number | null); streak; avgWeeklyLink: number | null; lastDeposit: { link; day } | null; nextDue: string | null; overdue: boolean; weekly: readonly number[]; milestone: { link; eta } | null }`;
  - `interface RecordMedal { kind: RecordKind; value; day; lane: { src: string; dst: string } | null }`, `interface RecordsCard { asOf; medals: readonly RecordMedal[]; newest: RecordKind | null; messages; usd; since: string | null }`;
  - `interface IntelCards { sitrep: SitrepCard; dossier: DossierCard; vault: VaultCard; records: RecordsCard }`, `type IntelKind = keyof IntelCards`, `INTEL_KINDS`;
  - `interface LinkMarineRenderer { prepareMeme(image: Uint8Array): Promise<Uint8Array>; renderMarineCard(card: MarineCard): Promise<Uint8Array>; renderMarineGlint(card: MarineCard): Promise<Uint8Array | null>; renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array> }`.

- [ ] **Step 1: Write the failing test.**

Create `packages/core/test/linkmarine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { callsignSeed, filledPips, hasGlint, rimText, RIM_PHRASES, seededRandom, serialText, TIER_SHARE_PCT, TIERS, tierTopPct } from '../src/linkmarine';

describe('LinkMarine tiers', () => {
  it('shares the draws 60/25/12/3 and prints the share at the tier or rarer', () => {
    // #when
    const known = {
      shares: TIERS.map((t) => TIER_SHARE_PCT[t]),
      top: TIERS.map(tierTopPct),
      glint: TIERS.map(hasGlint),
    };
    // #then
    expect(known).toEqual({ shares: [60, 25, 12, 3], top: [null, 40, 15, 3], glint: [false, false, true, true] });
  });

  it('fills three pips for a tag on one meme and none from fifty', () => {
    // #when
    const pips = [1, 2, 9, 10, 49, 50, 649].map(filledPips);
    // #then
    expect(pips).toEqual([3, 2, 2, 1, 1, 0, 0]);
  });
});

describe('LinkMarine seeds', () => {
  it('seeds from the callsign with FNV-1a, the same on every run', () => {
    // #when
    const seeds = [callsignSeed(''), callsignSeed('a'), callsignSeed('painting-space-prophecy') === callsignSeed('painting-space-prophecy')];
    // #then the published FNV-1a 32-bit vectors
    expect(seeds).toEqual([0x811c9dc5, 0xe40c292c, true]);
  });

  it('draws the same sequence from the same seed, in [0, 1)', () => {
    // #when
    const a = seededRandom(7);
    const b = seededRandom(7);
    const draws = Array.from({ length: 200 }, () => [a(), b()]);
    // #then
    expect({ same: draws.every(([x, y]) => x === y), inRange: draws.every(([x]) => x! >= 0 && x! < 1) }).toEqual({ same: true, inRange: true });
  });

  it('writes the rim with every phrase twice, in an order the seed picks', () => {
    // #when
    const rims = [rimText(1), rimText(2), rimText(1)];
    const phrases = rims[0]!.split(' · ');
    // #then
    expect({
      count: phrases.length,
      each: RIM_PHRASES.every((p) => phrases.filter((x) => x === p).length === 2),
      repeat: phrases.slice(0, 5).join() === phrases.slice(5).join(),
      stable: rims[0] === rims[2],
      seeded: rims[0] !== rims[1],
    }).toEqual({ count: 10, each: true, repeat: true, stable: true, seeded: true });
  });

  it('pads a serial to four digits', () => {
    // #then
    expect([serialText(7), serialText(1234), serialText(12345)]).toEqual(['0007', '1234', '12345']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/linkmarine.test.ts`
Expected: FAIL: `../src/linkmarine` does not exist.

- [ ] **Step 3: Add the module and its export.**

Create `packages/core/src/linkmarine.ts`:

```ts
import type { RecordKind } from './records';

/** The LinkMarine Discord bot's shared vocabulary: the bot draws callsigns and computes intel, the site Worker draws the cards. */

export const TIERS = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Tier = (typeof TIERS)[number];

/** Each tier's share of all draws, in percent (docs/callsigns/rules.md). */
export const TIER_SHARE_PCT: Readonly<Record<Tier, number>> = { common: 60, uncommon: 25, rare: 12, legendary: 3 };

/** The share of draws at this tier or rarer, which a card prints as "top X%"; null for Common, where it would say "top 100%". */
export function tierTopPct(tier: Tier): number | null {
  if (tier === 'common') return null;
  return TIERS.slice(TIERS.indexOf(tier)).reduce((sum, t) => sum + TIER_SHARE_PCT[t], 0);
}

/** Rare and Legendary cards also get the animated glint. */
export function hasGlint(tier: Tier): boolean {
  return tier === 'rare' || tier === 'legendary';
}

/** Filled pips (◆) of three for a tag carried by `memes` SFW memes: ◆◆◆ for 1, ◆◆◇ for 2–9, ◆◇◇ for 10–49, ◇◇◇ for 50 or more. */
export function filledPips(memes: number): 0 | 1 | 2 | 3 {
  if (memes <= 1) return 3;
  if (memes <= 9) return 2;
  if (memes <= 49) return 1;
  return 0;
}

/** FNV-1a (32-bit) of the callsign: the seed of everything drawn from it, from the memes to the stars. */
export function callsignSeed(callsign: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(callsign)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** mulberry32: a small seeded generator in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RIM_PHRASES = ['LINK MARINES', 'STAY POOR', '4IR', 'FUNDAMENTALLY', 'WAGMI'] as const;

/** The rim microtext: every phrase once, in an order the seed shuffles, then again, so it runs past the tag's edge. */
export function rimText(seed: number): string {
  const random = seededRandom(seed);
  const order: string[] = [...RIM_PHRASES];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return [...order, ...order].join(' · ');
}

/** "0007": four digits until the 10,000th Marine. */
export function serialText(serial: number): string {
  return String(serial).padStart(4, '0');
}

export interface MarineCardMeme {
  tag: string;
  /** SFW memes carrying the tag in the snapshot: the pips and "N memes". */
  count: number;
  /** The meme as the bot keeps it in R2: the PNG that prepareMeme made. */
  png: Uint8Array;
}

export interface MarineCard {
  serial: number;
  callsign: string;
  tier: Tier;
  /** The share of simulated draws scoring below this one, 0–100. */
  percentile: number;
  /** The three tags' memes, in draw order. */
  memes: readonly MarineCardMeme[];
  blood: string;
  faith: string;
  /** The Discord display name stamped at enlistment. */
  name: string;
  enlistedAt: string;
  /** The Discord avatar as PNG bytes, or null for the gradient disc. */
  avatar: Uint8Array | null;
}

export interface IntelChain {
  selector: string;
  name: string;
}

export interface IntelLane {
  src: IntelChain;
  dst: IntelChain;
  usd: number;
}

export interface SitrepCard {
  updatedAt: string;
  messages: number;
  /** null before 01:00 UTC; `yesterday` is null when history.json's last day is not yesterday. */
  pace: { projected: number; yesterday: number | null } | null;
  usd: number;
  feesUsd: number | null;
  linkSharePct: number | null;
  senders: number;
  medianDeliveryS: number | null;
  /** Up to five of today's lanes, by value. */
  lanes: readonly IntelLane[];
}

export interface DossierCard {
  asOf: string;
  chain: IntelChain;
  /** By all-time value moved, both directions, among every chain in replay.json. */
  rank: number;
  ranked: number;
  /** 1–3 when the chain is in the top 3 by fees over the last 7 days. */
  feeRank: number | null;
  messages: number;
  usd: number;
  feesUsd: number | null;
  week: { messages: number; usd: number };
  /** The last 7 finalized days, oldest first. */
  days: readonly { day: string; messages: number }[];
  /** Up to four partners over the last 7 days, by value. */
  partners: readonly { chain: IntelChain; usd: number }[];
  since: string | null;
}

export interface VaultCard {
  asOf: string;
  link: number;
  valueUsd: number | null;
  priceUsd: number | null;
  changePct: number | null;
  costUsd: number | null;
  streak: number;
  avgWeeklyLink: number | null;
  lastDeposit: { link: number; day: string } | null;
  nextDue: string | null;
  overdue: boolean;
  /** LINK deposited each week, the last 26 weeks, oldest first. */
  weekly: readonly number[];
  milestone: { link: number; eta: string } | null;
}

export interface RecordMedal {
  kind: RecordKind;
  value: number;
  day: string;
  /** The largest single fee's lane, by name. */
  lane: { src: string; dst: string } | null;
}

export interface RecordsCard {
  asOf: string;
  medals: readonly RecordMedal[];
  /** The record set most recently, which the card raises. */
  newest: RecordKind | null;
  messages: number;
  usd: number;
  since: string | null;
}

export interface IntelCards {
  sitrep: SitrepCard;
  dossier: DossierCard;
  vault: VaultCard;
  records: RecordsCard;
}

export type IntelKind = keyof IntelCards;
export const INTEL_KINDS: readonly IntelKind[] = ['sitrep', 'dossier', 'vault', 'records'];

/** The site Worker's LinkMarine entrypoint, as the bot sees it over its service binding. */
export interface LinkMarineRenderer {
  /** A meme as a 240×240 PNG, cover-cropped: the card never draws one larger. */
  prepareMeme(image: Uint8Array): Promise<Uint8Array>;
  renderMarineCard(card: MarineCard): Promise<Uint8Array>;
  /** The animated GIF for Rare and Legendary cards; null for the others. */
  renderMarineGlint(card: MarineCard): Promise<Uint8Array | null>;
  renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array>;
}
```

In `packages/core/package.json`, replace:

```json
    "./broadcasts": "./src/broadcasts.ts",
    "./moments": "./src/moments.ts",
    "./month": "./src/month.ts"
  },
  "scripts": {
```

with:

```json
    "./broadcasts": "./src/broadcasts.ts",
    "./moments": "./src/moments.ts",
    "./month": "./src/month.ts",
    "./linkmarine": "./src/linkmarine.ts"
  },
  "scripts": {
```

- [ ] **Step 4: Run the test and the typecheck.**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/linkmarine.test.ts`
Expected: PASS (6 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/linkmarine.ts packages/core/package.json packages/core/test/linkmarine.test.ts
git commit -m "feat(core): the LinkMarine bot's tiers, pips, seeds and card shapes" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: The kino renderer's groundwork, and the experiments pinned

The cards are drawn as full-card SVG art layers in the mockups' 760×428 coordinates, with Satori placing every image and word on top. This task adds the two font weights, the coordinate helpers and the renderer that hands back the pixels as well as the PNG. Its workerd test pins the two findings of experiment (b) (see "Decisions"): resvg draws no raster image inside an art layer, and Satori's own `filter` and `clipPath` on an image do draw. Everything below builds on both.

**Files:**
- Modify: `site/scripts/embed-fonts.ts` (Inter 900, JetBrains Mono 700)
- Regenerate: `site/worker/fonts.ts` (`pnpm --filter @ccip-dev/site fonts:embed`; two lines added, `CARD_FONTS` unchanged)
- Create: `site/worker/linkmarine/art.ts`, `site/worker/linkmarine/fonts.ts`, `site/worker/linkmarine/render.ts`
- Test: `site/test/linkmarine-art.test.ts` (Node), `site/worker/test/linkmarine-kino.test.ts` (workerd)

**Interfaces:**
- Consumes: Task 1 (`seededRandom`); live code `h`, `type Child`, `type VNode` (`site/worker/h.ts`), `CARD_FONTS` (`site/worker/fonts.ts`), `render` from `@cf-wasm/og/workerd`.
- Produces:
  - `site/worker/fonts.ts` (generated): `INTER_900`, `MONO_700` beside the existing exports.
  - `site/worker/linkmarine/fonts.ts`: `KINO_FONTS` (`CARD_FONTS` plus Inter 900 and JetBrains Mono 700).
  - `site/worker/linkmarine/render.ts`: `interface Rendered { png: Uint8Array; pixels: Uint8Array; width: number; height: number }` (`pixels` straight RGBA), `renderKino(tree: VNode, size = KINO_SIZE): Promise<Rendered>`.
  - `site/worker/linkmarine/art.ts`:
    - `KINO_SIZE` (1200×675), `MOCK` (760×428), `S` (1200/760), `MONO` ('JetBrains Mono'), `INK` (the mockups' palette: `navy`, `text`, `soft`, `sub`, `muted`, `gold`, `paleGold`, `cream`, `blue`, `ccip`, `lane`, `up`, `down`, `live`);
    - `r1(v)`, `px(n)` (mockup to card pixels), `MONTHS`, `utcDate(dayOrIso)`, `capDay(dayOrIso)` ("13 OCT 2026");
    - `hexPoints(cx, cy, r): string` (pointy-top), `HEX_CLIP` (the same hexagon as a CSS `clip-path`), `svgDataUri(svg)`;
    - `artLayer(body: string, defs?: string): VNode` (a full-card SVG in mockup coordinates), `at(left, top, style, ...children): VNode`, `font(family, weight, size, color, tracking?)` (a style object in the mockups' sizes);
    - `skyLayer(seed, glows: readonly { x; y; color; stop }[], extra?, extraDefs?): VNode`;
    - `interface HaloRing { r; width; opacity }`, `halo(id, cx, cy, color, rings, glow: { r; opacity } | null, rotate?): { defs: string; body: string }`;
    - `pulse(x, y, r?): string`, `DOT_FILTER`, `onCurve(a, c, b, t)`;
    - `hexImage(src, cx, cy, r, style?): VNode` (an `img` clipped to the hexagon);
    - `drawable(text): string` (only the fonts' Latin subset), `pips(filled, size, color): VNode`, `hexBullet(size, color): VNode`.

- [ ] **Step 1: Write the failing tests.**

The workerd test's fixture is a 16×16 JPEG, red on the left and blue on the right.

Create `site/test/linkmarine-art.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { capDay, drawable, font, halo, hexPoints, onCurve, pips, px, S } from '../worker/linkmarine/art';

describe('kino art', () => {
  it('scales the mockups by 1200/760 and draws pointy-top hexagons', () => {
    // #when
    const known = { s: S, widths: [px(760), px(30), px(46)], hexagon: hexPoints(100, 100, 10).split(' ') };
    // #then
    expect(known).toEqual({ s: 1200 / 760, widths: [1200, 47.4, 72.6], hexagon: ['100,90', '108.7,95', '108.7,105', '100,110', '91.3,105', '91.3,95'] });
  });

  it("sets type at the mockups' size and tracking", () => {
    // #when
    const style = font('JetBrains Mono', 700, 11, '#8892a0', 0.16);
    // #then 11 px at 0.16em, scaled
    expect(style).toEqual({ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 17.4, color: '#8892a0', letterSpacing: 2.8, whiteSpace: 'nowrap' });
  });

  it('writes a day as the mockups do, in UTC', () => {
    // #then
    expect([capDay('2026-10-13'), capDay('2023-07-06T23:59:59.000Z'), capDay('2026-12-01T00:00:00.000Z')]).toEqual(['13 OCT 2026', '6 JUL 2023', '1 DEC 2026']);
  });

  it('keeps only the text the card fonts can draw', () => {
    // #when
    const kept = ['momentmaker 🚀', '日本語', 'Zoë · O’Neil', '  two   spaces  '].map(drawable);
    // #then
    expect(kept).toEqual(['momentmaker', '', 'Zoë · O’Neil', 'two spaces']);
  });

  it('draws pips as an image, the first ones filled', () => {
    // #when
    const node = pips(2, 12.6, '#f5c451') as { type: string; props: { src: string; width: number } };
    const svg = atob(node.props.src.replace('data:image/svg+xml;base64,', ''));
    // #then
    expect({ type: node.type, width: node.props.width, filled: (svg.match(/fill="#f5c451"/g) ?? []).length, hollow: (svg.match(/fill="none"/g) ?? []).length }).toEqual({ type: 'img', width: 39.9, filled: 2, hollow: 1 });
  });

  it('finds a point along a lane, and rings the halo with a blurred and a crisp copy of each hexagon', () => {
    // #when
    const mid = onCurve({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 0.5);
    const ring = halo('h', 100, 100, '#f5c451', [{ r: 50, width: 2, opacity: 0.5 }, { r: 80, width: 1, opacity: 0.2 }], { r: 120, opacity: 0.3 }, 4);
    // #then
    expect({ mid, hexagons: (ring.body.match(/<polygon/g) ?? []).length, turned: ring.body.includes('rotate(4.00 100 100)'), glow: ring.defs.includes('stop-opacity="0.3"') }).toEqual({
      mid: { x: 50, y: 50 },
      hexagons: 4,
      turned: true,
      glow: true,
    });
  });
});
```

Create `site/worker/test/linkmarine-kino.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { h } from '../h';
import { artLayer, HEX_CLIP } from '../linkmarine/art';
import { renderKino } from '../linkmarine/render';

/** A 16×16 JPEG, red on the left half and blue on the right. */
const RED_BLUE_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAQEBAQEBAgEBAgMCAgIDBAMDAwMEBQQEBAQEBQYFBQUFBQUGBgYGBgYGBgcHBwcHBwgICAgICQkJCQkJCQkJCf/bAEMBAQEBAgICBAICBAkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCf/dAAQAAf/aAAwDAQACEQMRAD8A+F6+R6+uK+R6/vz9gP8A81Z/3Jf+7Z/qB/pBX/NI/wDc9/7pn//Z';
const GREEN = '#00ff00';

const pixel = (r: { pixels: Uint8Array; width: number }, x: number, y: number) => [...r.pixels.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];
const box = (left: number, child: ReturnType<typeof h>) => h('div', { style: { position: 'absolute', left, top: 0, width: 100, height: 100, display: 'flex' } }, child);

describe('the kino renderer', () => {
  it("etches a meme through Satori's own filter and clip-path, which resvg draws", async () => {
    // #given the meme plain, and grey, contrasty and clipped to a hexagon
    const tree = h(
      'div',
      { style: { width: 200, height: 100, display: 'flex', position: 'relative', backgroundColor: GREEN } },
      box(0, h('img', { src: RED_BLUE_JPEG, width: 100, height: 100, style: { width: 100, height: 100 } })),
      box(100, h('img', { src: RED_BLUE_JPEG, width: 100, height: 100, style: { width: 100, height: 100, clipPath: HEX_CLIP, filter: 'grayscale(1) contrast(1.7) brightness(0.95)' } })),
    );
    // #when
    const r = await renderKino(tree, { width: 200, height: 100 });
    // #then plain is red; etched is grey (r = g = b); the hexagon's corner is the background
    const [plain, etched, corner] = [pixel(r, 25, 50), pixel(r, 125, 50), pixel(r, 102, 3)];
    expect({ red: plain[0]! > 200 && plain[1]! < 80, grey: Math.max(...etched) - Math.min(...etched) <= 2, clipped: corner }).toEqual({ red: true, grey: true, clipped: [0, 255, 0] });
  });

  it('draws no raster image nested in an SVG art layer, so memes and icons are card elements', async () => {
    // #given the same meme inside an art layer's SVG
    const tree = h(
      'div',
      { style: { width: 1200, height: 675, display: 'flex', position: 'relative', backgroundColor: GREEN } },
      artLayer(`<image href="${RED_BLUE_JPEG}" x="0" y="0" width="100" height="100"/><rect x="200" y="0" width="100" height="100" fill="#ff0000"/>`),
    );
    // #when
    const r = await renderKino(tree);
    // #then the art layer's shapes draw, its image does not
    expect([pixel(r, 40, 80), pixel(r, 395, 80)]).toEqual([[0, 255, 0], [255, 0, 0]]);
  });

  it('has Inter 900 and JetBrains Mono 700 besides the 800s', async () => {
    // #given the same word in each weight
    const word = (family: string, weight: number) => h('div', { style: { position: 'absolute', left: 0, top: 0, fontFamily: family, fontWeight: weight, fontSize: 60, color: '#000' } }, 'MMMMMM');
    const ink = async (family: string, weight: number) => {
      const r = await renderKino(h('div', { style: { width: 400, height: 80, display: 'flex', position: 'relative', backgroundColor: '#fff' } }, word(family, weight)), { width: 400, height: 80 });
      let dark = 0;
      for (let i = 0; i < r.pixels.length; i += 4) if (r.pixels[i]! < 128) dark++;
      return dark;
    };
    // #when
    const [inter800, inter900, mono700, mono800] = await Promise.all([ink('Inter', 800), ink('Inter', 900), ink('JetBrains Mono', 700), ink('JetBrains Mono', 800)]);
    // #then each weight is its own, heavier one with more ink
    expect({ inter: inter900 > inter800, mono: mono800 > mono700 }).toEqual({ inter: true, mono: true });
  });
});
```

- [ ] **Step 2: Run the Node test and confirm it fails.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-art.test.ts`
Expected: FAIL: `../worker/linkmarine/art` does not exist.

- [ ] **Step 3: Embed the two weights.**

In `site/scripts/embed-fonts.ts`, replace:

```ts
const encode = async (path: string) => (await readFile(path)).toString('base64');
const inter = (weight: number) => encode(font('@fontsource/inter', `inter-latin-${weight}-normal.woff`));

const body = `// Generated by pnpm fonts:embed from @fontsource/inter and @fontsource/jetbrains-mono (SIL Open Font License 1.1; see fonts/LICENSE-*.txt).
```

with:

```ts
const encode = async (path: string) => (await readFile(path)).toString('base64');
const inter = (weight: number) => encode(font('@fontsource/inter', `inter-latin-${weight}-normal.woff`));
const mono = (weight: number) => encode(font('@fontsource/jetbrains-mono', `jetbrains-mono-latin-${weight}-normal.woff`));

const body = `// Generated by pnpm fonts:embed from @fontsource/inter and @fontsource/jetbrains-mono (SIL Open Font License 1.1; see fonts/LICENSE-*.txt).
```

In `site/scripts/embed-fonts.ts`, replace:

```ts
export const INTER_700 = decode('${await inter(700)}');
export const INTER_800 = decode('${await inter(800)}');
export const MONO_800 = decode('${await encode(font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-800-normal.woff'))}');

export const CARD_FONTS = [
```

with:

```ts
export const INTER_700 = decode('${await inter(700)}');
export const INTER_800 = decode('${await inter(800)}');
export const INTER_900 = decode('${await inter(900)}');
export const MONO_700 = decode('${await mono(700)}');
export const MONO_800 = decode('${await mono(800)}');

export const CARD_FONTS = [
```

Run: `pnpm --filter @ccip-dev/site fonts:embed`
Expected: `wrote worker/fonts.ts`.

Run: `git diff --stat site/worker/fonts.ts`
Expected: `1 file changed, 2 insertions(+)`: `INTER_900` and `MONO_700`; the four existing fonts and `CARD_FONTS` are byte for byte the same.

- [ ] **Step 4: Add the art helpers, the kino fonts and the renderer.**

Create `site/worker/linkmarine/art.ts`:

```ts
import { seededRandom } from '@ccip-dev/core/linkmarine';
import { h, type Child, type VNode } from '../h';

export const KINO_SIZE = { width: 1200, height: 675 } as const;
/** The approved mockups were drawn at 760×428: every number below is theirs, scaled up by S. */
export const MOCK = { width: 760, height: 428 } as const;
export const S = KINO_SIZE.width / MOCK.width;
export const MONO = 'JetBrains Mono';

export const INK = {
  navy: '#0a0f1e',
  text: '#e8eaed',
  soft: '#c3cad5',
  sub: '#aab3c0',
  muted: '#8892a0',
  gold: '#f5c451',
  paleGold: '#f5d77a',
  cream: '#fff6cf',
  blue: '#6c9bff',
  ccip: '#3c7bff',
  lane: '#cfe0ff',
  up: '#5fe0a4',
  down: '#f5b04a',
  live: '#ff6b7a',
} as const;

/** To a tenth of a pixel. */
export const r1 = (v: number) => Math.round(v * 10) / 10;

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A day ("2026-10-13") or a timestamp, as a Date read in UTC. */
export const utcDate = (dayOrIso: string) => new Date(dayOrIso.length === 10 ? `${dayOrIso}T00:00:00.000Z` : dayOrIso);

/** "13 OCT 2026", from a day or a timestamp, in UTC. */
export function capDay(dayOrIso: string): string {
  const d = utcDate(dayOrIso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A length in the mockups' coordinates, in card pixels. */
export const px = (n: number) => r1(n * S);

/** The corners of a pointy-top hexagon around (cx, cy) with circumradius r. */
export function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, k) => {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return `${r1(cx + r * Math.cos(a))},${r1(cy + r * Math.sin(a))}`;
  }).join(' ');
}

/** The same hexagon as a CSS clip-path on a box 0.866·2r wide and 2r tall. */
export const HEX_CLIP = 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)';

export const svgDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/**
 * A full-card layer of SVG art, written in the mockups' 760×428 coordinates. resvg draws no raster image and no text
 * inside an SVG that is itself an image, so memes, icons, avatars and words are card elements on top.
 */
export function artLayer(body: string, defs = ''): VNode {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${KINO_SIZE.width}" height="${KINO_SIZE.height}" viewBox="0 0 ${MOCK.width} ${MOCK.height}" preserveAspectRatio="none"><defs>${defs}</defs>${body}</svg>`;
  return h('img', { src: svgDataUri(svg), width: KINO_SIZE.width, height: KINO_SIZE.height, style: { position: 'absolute', left: 0, top: 0, width: KINO_SIZE.width, height: KINO_SIZE.height } });
}

/** A card element placed in the mockups' coordinates. */
export function at(left: number, top: number, style: Record<string, unknown>, ...children: Child[]): VNode {
  return h('div', { style: { position: 'absolute', left: px(left), top: px(top), display: 'flex', ...style } }, ...children);
}

/** Type in the mockups' sizes: `size` and `tracking` (em) as the mockups' CSS has them. */
export function font(family: 'Inter' | typeof MONO, weight: number, size: number, color: string, tracking = 0): Record<string, unknown> {
  return { fontFamily: family, fontWeight: weight, fontSize: px(size), color, letterSpacing: r1(tracking * size * S), whiteSpace: 'nowrap' };
}

/** A navy night sky: the base colour, soft radial glows, and stars the seed places. */
export function skyLayer(seed: number, glows: readonly { x: number; y: number; color: string; stop: number }[], extra = '', extraDefs = ''): VNode {
  const defs = glows
    .map((g, i) => {
      const rx = Math.max(g.x, MOCK.width - g.x) * Math.SQRT2;
      const ry = Math.max(g.y, MOCK.height - g.y) * Math.SQRT2;
      return `<radialGradient id="glow${i}" gradientUnits="userSpaceOnUse" cx="${r1(g.x)}" cy="${r1(g.y)}" r="${r1(rx)}" gradientTransform="translate(${r1(g.x)} ${r1(g.y)}) scale(1 ${(ry / rx).toFixed(4)}) translate(${r1(-g.x)} ${r1(-g.y)})"><stop offset="0" stop-color="${g.color}"/><stop offset="${g.stop}" stop-color="${g.color}" stop-opacity="0"/></radialGradient>`;
    })
    .join('');
  const rect = (fill: string) => `<rect width="${MOCK.width}" height="${MOCK.height}" fill="${fill}"/>`;
  return artLayer(`${rect(INK.navy)}${glows.map((_, i) => rect(`url(#glow${i})`)).join('')}${stars(seed)}${extra}`, `${defs}${extraDefs}`);
}

const STAR_COUNT = 70;

function stars(seed: number): string {
  const random = seededRandom(seed);
  let out = '';
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = r1(random() * MOCK.width);
    const y = r1(random() * MOCK.height);
    const r = random() < 0.8 ? 0.6 : 1;
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${(0.25 + random() * 0.5).toFixed(2)}"/>`;
  }
  return out;
}

export interface HaloRing {
  r: number;
  width: number;
  opacity: number;
}

/** The Chainlink halo: concentric hexagons, a soft blurred copy under crisp ones, over a radial glow. */
export function halo(id: string, cx: number, cy: number, color: string, rings: readonly HaloRing[], glow: { r: number; opacity: number } | null, rotate = 0): { defs: string; body: string } {
  const hexes = rings.map((ring) => `<polygon points="${hexPoints(cx, cy, ring.r)}" fill="none" stroke="${color}" stroke-width="${ring.width}" opacity="${ring.opacity}"/>`).join('');
  const defs =
    `<filter id="${id}-blur"><feGaussianBlur stdDeviation="3"/></filter>` +
    (glow ? `<radialGradient id="${id}-glow"><stop offset="0" stop-color="${color}" stop-opacity="${glow.opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` : '');
  const body =
    (glow ? `<circle cx="${cx}" cy="${cy}" r="${glow.r}" fill="url(#${id}-glow)"/>` : '') +
    `<g transform="rotate(${rotate.toFixed(2)} ${cx} ${cy})"><g filter="url(#${id}-blur)">${hexes}</g>${hexes}</g>`;
  return { defs, body };
}

/** A soft glowing dot: a lane's message pulse. */
export function pulse(x: number, y: number, r = 5): string {
  return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${INK.cream}" filter="url(#dot)"/><circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 0.44)}" fill="#fff"/>`;
}

export const DOT_FILTER = '<filter id="dot" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.5"/></filter>';

/** The point at t along the quadratic curve from a to b through control c. */
export function onCurve(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** An image clipped to a pointy-top hexagon of circumradius r around (cx, cy), in the mockups' coordinates. */
export function hexImage(src: string, cx: number, cy: number, r: number, style: Record<string, unknown> = {}): VNode {
  const width = px(r * Math.sqrt(3));
  const height = px(r * 2);
  return h('img', {
    src,
    width,
    height,
    style: { position: 'absolute', left: px(cx - (r * Math.sqrt(3)) / 2), top: px(cy - r), width, height, objectFit: 'cover', clipPath: HEX_CLIP, ...style },
  });
}

const DRAWABLE = /^[\u0020-\u007e\u00a0-\u00ff\u2000-\u206f\u20ac\u2122]$/;

/** Text in the card fonts' Latin subset only: anything else (emoji, CJK, ◆) would be drawn as nothing. */
export function drawable(text: string): string {
  return [...text].filter((ch) => DRAWABLE.test(ch)).join('').replace(/\s+/g, ' ').trim();
}

/** The fonts have no ◆ or ◇: three diamonds as an image, the first `filled` solid. */
export function pips(filled: number, size: number, color: string): VNode {
  const shapes = [0, 1, 2]
    .map((i) => {
      const cx = 6 + i * 13;
      const d = `M${cx} 1 L${cx + 5} 6 L${cx} 11 L${cx - 5} 6 Z`;
      return i < filled ? `<path d="${d}" fill="${color}"/>` : `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.4"/>`;
    })
    .join('');
  const width = r1((size * 38) / 12);
  return h('img', {
    src: svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="38" height="12" viewBox="0 0 38 12">${shapes}</svg>`),
    width,
    height: size,
    style: { width, height: size, flexShrink: 0 },
  });
}

/** The ⬡ bullet the intel rows start with, which the fonts lack. */
export function hexBullet(size: number, color: string): VNode {
  return h('img', {
    src: svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><polygon points="${hexPoints(12, 12, 10)}" fill="none" stroke="${color}" stroke-width="2.4"/></svg>`),
    width: size,
    height: size,
    style: { width: size, height: size, flexShrink: 0 },
  });
}
```

Create `site/worker/linkmarine/fonts.ts`:

```ts
import { CARD_FONTS, INTER_900, MONO_700 } from '../fonts';

/** The site's card fonts plus the two weights the LinkMarine mockups need; Inter 600 and JetBrains Mono 600 fall to 700. */
export const KINO_FONTS = [
  ...CARD_FONTS,
  { name: 'Inter', data: INTER_900, weight: 900 as const, style: 'normal' as const },
  { name: 'JetBrains Mono', data: MONO_700, weight: 700 as const, style: 'normal' as const },
];
```

Create `site/worker/linkmarine/render.ts`:

```ts
import { render } from '@cf-wasm/og/workerd';
import type { VNode } from '../h';
import { KINO_SIZE } from './art';
import { KINO_FONTS } from './fonts';

export interface Rendered {
  png: Uint8Array;
  /** Straight RGBA, row by row: what the glint is drawn onto. */
  pixels: Uint8Array;
  width: number;
  height: number;
}

export async function renderKino(tree: VNode, size: { width: number; height: number } = KINO_SIZE): Promise<Rendered> {
  const result = await render(tree as never, { width: size.width, height: size.height, fonts: KINO_FONTS, loadAdditionalAsset: async () => [] }).asPng();
  return { png: result.image, pixels: result.pixels, width: result.width, height: result.height };
}
```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-art.test.ts`
Expected: PASS (6 tests).

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/linkmarine-kino.test.ts`
Expected: PASS (3 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add site/scripts/embed-fonts.ts site/worker/fonts.ts site/worker/linkmarine/art.ts site/worker/linkmarine/fonts.ts site/worker/linkmarine/render.ts site/test/linkmarine-art.test.ts site/worker/test/linkmarine-kino.test.ts
git commit -m "feat(site): the kino renderer's groundwork: Inter 900 and JetBrains Mono 700, SVG art layers, hexagons and pips" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: The dog tag card and the LinkMarineCards entrypoint

The card of `dog-tag-card.html`, at 1200×675, for every tier: two tags on a ball chain over the tier's halo, the back tag etched with the three memes, the front tag embossed with the callsign, the lore and the rim text, and the panel with the avatar, the tier wordmark, the odds and the meme planets. The site Worker exports the entrypoint the bot will bind to, with its first two methods.

**Files:**
- Create: `site/worker/linkmarine/metal.ts`, `site/worker/linkmarine/marine-card.ts`, `site/worker/linkmarine/meme.ts`, `site/worker/linkmarine/entrypoint.ts`
- Modify: `site/worker/index.ts` (export `LinkMarineCards`)
- Test: `site/test/fixtures/linkmarine.ts`, `site/test/linkmarine-marine.test.ts` (Node), `site/worker/test/linkmarine-marine.test.ts` (workerd)

**Interfaces:**
- Consumes: Task 1 (`callsignSeed`, `filledPips`, `rimText`, `seededRandom`, `serialText`, `tierTopPct`, `hasGlint`, `type MarineCard`, `type Tier`); Task 2 (`artLayer`, `at`, `capDay`, `DOT_FILTER`, `drawable`, `font`, `halo`, `HEX_CLIP`, `hexImage`, `hexPoints`, `INK`, `KINO_SIZE`, `MONO`, `onCurve`, `pips`, `pulse`, `px`, `r1`, `skyLayer`, `renderKino`); live code `bytesToBase64` (`site/worker/cards/coin-icons.ts`), `pngPixel` (`site/worker/test/png.ts`), `texts` (`site/test/fixtures/broadcast.ts`), `WorkerEntrypoint` from `cloudflare:workers`.
- Produces:
  - `metal.ts`: `interface Stop { at; color }`, `cssLinear(id, angle, w, h, stops): string` (a CSS `linear-gradient(angle)` as the same SVG gradient), `cssRadialSpot(id, xPct, yPct, w, h, stops): string`, `interface TierLook { metal; ink; color; word; accent; halo: { strength; glow }; sheen: 'holo' | 'soft' | null; sparkles }`, `TIER_LOOKS: Record<Tier, TierLook>`, `HOLO_STOPS`.
  - `marine-card.ts`: `interface TagBox { left; top; width; height; rotate }`, `BACK_TAG` (−11°), `FRONT_TAG` (5°), `TAG_RADIUS`, `ETCH_FILTER`, `PLANET_LAYOUTS` (three layouts: planets and lane controls), `onTag(tag, x, y)`, `skyChoices(callsign): { seed; layout; haloTurn }`, `loreSize(rows): number`, `loreRows(card): string[]`, `cardName(name): string`, `marineTree(card: MarineCard): VNode`.
  - `meme.ts`: `MEME_SIZE = 240`, `sniffImage(bytes): string | null`, `memeTree(image: Uint8Array): VNode` (throws "prepareMeme: not a JPEG, PNG or GIF image").
  - `entrypoint.ts`: `class LinkMarineCards extends WorkerEntrypoint` with `prepareMeme(image: Uint8Array): Promise<Uint8Array>` and `renderMarineCard(card: MarineCard): Promise<Uint8Array>`; exported from `site/worker/index.ts`.
  - `site/test/fixtures/linkmarine.ts`: `DRAWABLE_TEXT` (the fonts' Latin subset as a pattern), `MARINES` (one sample Marine per tier, from `rules.md`'s samples), `marine(tier, pngs, avatar?): MarineCard`.

- [ ] **Step 1: Write the fixtures and the failing tests.**

Create `site/test/fixtures/linkmarine.ts`:

```ts
import type { MarineCard, Tier } from '@ccip-dev/core/linkmarine';

/** Text the card fonts can draw: their Latin subset. */
export const DRAWABLE_TEXT = /^[\u0020-\u007e\u00a0-\u00ff\u2000-\u206f\u20ac\u2122]*$/;

/** Four Marines from docs/callsigns/rules.md's samples, one per tier, at their snapshot odds; between them they use all three planet layouts. */
export const MARINES: Readonly<Record<Tier, { serial: number; callsign: string; counts: readonly number[]; percentile: number; blood: string; faith: string; name: string }>> = {
  legendary: { serial: 7, callsign: 'painting-space-prophecy', counts: [1, 1, 3], percentile: 97.9, blood: 'LINK+', faith: '4IR', name: 'momentmaker' },
  rare: { serial: 42, callsign: 'yes-glowy-millionaire', counts: [5, 1, 1], percentile: 95.3, blood: 'O-LINK', faith: 'SERGEY', name: 'sergey_nakamoto' },
  uncommon: { serial: 108, callsign: 'party-4ir-deep', counts: [2, 47, 1], percentile: 76.7, blood: '7777777', faith: 'STAKING', name: 'Chad Marine of the 4th Industrial Revolution' },
  common: { serial: 1203, callsign: 'clown-rory-pepe', counts: [6, 15, 426], percentile: 17.3, blood: 'LINK+', faith: 'FUNDAMENTALS', name: 'rory' },
};

/** A tier's sample Marine as the site draws it, with the memes given (reused when fewer than three). */
export function marine(tier: Tier, pngs: readonly Uint8Array[], avatar: Uint8Array | null = null): MarineCard {
  const m = MARINES[tier];
  return {
    serial: m.serial,
    callsign: m.callsign,
    tier,
    percentile: m.percentile,
    memes: m.callsign.split('-').map((tag, i) => ({ tag, count: m.counts[i]!, png: pngs[i % pngs.length]! })),
    blood: m.blood,
    faith: m.faith,
    name: m.name,
    enlistedAt: '2026-10-13T10:40:00.000Z',
    avatar,
  };
}
```

Create `site/test/linkmarine-marine.test.ts`:

```ts
import { TIERS } from '@ccip-dev/core/linkmarine';
import { describe, expect, it } from 'vitest';
import { cardName, BACK_TAG, FRONT_TAG, loreRows, loreSize, marineTree, onTag, skyChoices } from '../worker/linkmarine/marine-card';
import { DRAWABLE_TEXT, MARINES, marine } from './fixtures/linkmarine';
import { texts } from './fixtures/broadcast';

const PNG = new Uint8Array([137, 80, 78, 71]);

describe('the dog tag card', () => {
  it('stamps the callsign, the lore, the odds and the planets as the mockup does', () => {
    // #when
    const words = texts(marineTree(marine('legendary', [PNG])));
    // #then
    expect(words).toEqual(
      expect.arrayContaining([
        'momentmaker', 'LEGENDARY', 'top 3% · rarer than 97 in 100 Marines', 'PAINTING', 'SPACE', 'PROPHECY', 'LM 0007 · BLOOD LINK+', 'FAITH 4IR · 13 OCT 2026',
        'LINK MARINES · ccip.dev', 'painting', 'space', 'prophecy', '1 meme', '3 memes', 'LINK MARINE #0007', 'ccip.dev',
      ]),
    );
  });

  it('prints a share only from Uncommon up: "top 100%" would say nothing', () => {
    // #when
    const odds = TIERS.map((tier) => texts(marineTree(marine(tier, [PNG]))).find((w) => w.includes('in 100 Marines')));
    // #then
    expect(odds).toEqual(['rarer than 17 in 100 Marines', 'top 40% · rarer than 76 in 100 Marines', 'top 15% · rarer than 95 in 100 Marines', 'top 3% · rarer than 97 in 100 Marines']);
  });

  it('writes no character the card fonts lack, and a name of emoji alone as "Marine"', () => {
    // #given a stamped name the fonts cannot draw
    const card = { ...marine('rare', [PNG]), name: '🚀🚀 日本' };
    // #when
    const words = texts(marineTree(card));
    // #then
    expect({ missing: words.filter((w) => !DRAWABLE_TEXT.test(w)), names: [cardName('🚀🚀'), cardName('Zoë 🚀')], shown: words.includes('Marine') }).toEqual({ missing: [], names: ['Marine', 'Zoë'], shown: true });
  });

  it('shrinks the lore rows only when a long line would run off the tag', () => {
    // #when
    const sizes = [loreSize(loreRows(marine('legendary', [PNG]))), loreSize(loreRows(marine('common', [PNG])))];
    // #then "FAITH FUNDAMENTALS · 13 OCT 2026" (32 characters) fits the 222 px column at 9.9
    expect(sizes).toEqual([11, 9.9]);
  });

  it("hangs the ball chain into each tag's hole, the tags turned -11° and 5°", () => {
    // #when
    const holes = [onTag(BACK_TAG, 32, 88), onTag(FRONT_TAG, 32, 88)].map((p) => [Math.round(p.x), Math.round(p.y)]);
    // #then
    expect(holes).toEqual([[92, 203], [128, 228]]);
  });

  it("draws the sky's layout and halo turn from the callsign, the same every time", () => {
    // #when
    const choices = Object.values(MARINES).map((m) => skyChoices(m.callsign));
    // #then the four samples use all three layouts; the halo turns within ±6°
    expect({
      layouts: choices.map((c) => c.layout),
      turns: choices.every((c) => Math.abs(c.haloTurn) <= 6),
      stable: skyChoices('painting-space-prophecy').layout === choices[0]!.layout,
    }).toEqual({ layouts: [2, 1, 0, 0], turns: true, stable: true });
  });
});
```

The workerd test makes its memes with the renderer itself; the JPEG is the 16×16 red-and-blue one of Task 2, and the GIF has two frames, red then blue.

Create `site/worker/test/linkmarine-marine.test.ts`:

```ts
import { TIERS } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { px } from '../linkmarine/art';
import { BACK_TAG, FRONT_TAG, onTag } from '../linkmarine/marine-card';
import { renderKino } from '../linkmarine/render';
import { pngPixel } from './png';

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
/** A 16×16 JPEG, red on the left half and blue on the right. */
const JPEG = bytes('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAQEBAQEBAgEBAgMCAgIDBAMDAwMEBQQEBAQEBQYFBQUFBQUGBgYGBgYGBgcHBwcHBwgICAgICQkJCQkJCQkJCf/bAEMBAQEBAgICBAICBAkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCf/dAAQAAf/aAAwDAQACEQMRAD8A+F6+R6+uK+R6/vz9gP8A81Z/3Jf+7Z/qB/pBX/NI/wDc9/7pn//Z');
/** An 8×8 GIF of two frames, red then blue. */
const GIF = bytes('R0lGODlhCAAIAIEAAMgeHgAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQBCgABACwAAAAACAAIAIEeHsgAAAAAAAAAAAAIDwABCBxIsKDBgwgTKkwYEAA7');

const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];
const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;
const cards = () => new LinkMarineCards(createExecutionContext(), {} as never);
const at = (p: { x: number; y: number }) => [Math.round(px(p.x)), Math.round(px(p.y))] as const;

describe('the LinkMarineCards entrypoint: memes', () => {
  it('keeps a JPEG, a PNG or a GIF meme as a 240×240 PNG, an animated GIF by its first frame', async () => {
    // #when
    const [fromJpeg, fromPng, fromGif] = await Promise.all([cards().prepareMeme(JPEG), cards().prepareMeme(await solid('#336699')), cards().prepareMeme(GIF)]);
    // #then
    const [r, g] = await pngPixel(fromGif, 120, 120);
    expect({ sizes: [fromJpeg, fromPng, fromGif].map(size), signature: [...fromJpeg.slice(0, 4)], firstFrame: r > 150 && g < 80 }).toEqual({
      sizes: [[240, 240], [240, 240], [240, 240]],
      signature: [137, 80, 78, 71],
      firstFrame: true,
    });
  });

  it('refuses bytes that are not an image', async () => {
    // #then
    await expect(cards().prepareMeme(new TextEncoder().encode('<html>404</html>'))).rejects.toThrow('not a JPEG, PNG or GIF');
  });
});

describe('the LinkMarineCards entrypoint: the dog tag card', () => {
  it('renders every tier at 1200×675, each tag in its own metal', async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const pngs = await Promise.all(TIERS.map((tier) => cards().renderMarineCard(marine(tier, [red]))));
    // #then the front tag's bare metal at its upper right differs tier by tier, gold is warm
    const [x, y] = at(onTag(FRONT_TAG, 250, 40));
    const metals = await Promise.all(pngs.map((png) => pngPixel(png, x, y)));
    const gold = metals[3]!;
    expect({ sizes: pngs.map(size), distinct: new Set(metals.map((m) => m.join())).size, gold: gold[0]! > gold[2]! + 60 }).toEqual({ sizes: TIERS.map(() => [1200, 675]), distinct: 4, gold: true });
  });

  it('etches the memes into the back tag without colour, and shows them in colour as planets', async () => {
    // #given a red meme and a white one; painting-space-prophecy puts its first planet at (580, 214)
    const [red, white] = await Promise.all([solid('#d01818'), solid('#ffffff')]);
    const [onRed, onWhite] = await Promise.all([cards().renderMarineCard(marine('legendary', [red])), cards().renderMarineCard(marine('legendary', [white]))]);
    // #when the third etching, above the front tag, and the first planet's centre
    const [ex, ey] = at(onTag(BACK_TAG, 254, 50));
    const [etchedRed, etchedWhite, planet] = await Promise.all([pngPixel(onRed, ex, ey), pngPixel(onWhite, ex, ey), pngPixel(onRed, Math.round(px(580)), Math.round(px(214)))]);
    // #then the etching follows the meme but loses its red; the planet keeps it
    expect({ etched: etchedWhite[0]! - etchedRed[0]! > 100, etchedRed: etchedRed[0]! - etchedRed[1]! > 60, planetRed: planet[0]! - planet[1]! > 120 }).toEqual({ etched: true, etchedRed: false, planetRed: true });
  });
});
```

- [ ] **Step 2: Run the Node test and confirm it fails.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-marine.test.ts`
Expected: FAIL: `../worker/linkmarine/marine-card` does not exist.

- [ ] **Step 3: Add the metals, the card, the meme preparation and the entrypoint.**

Create `site/worker/linkmarine/metal.ts`:

```ts
import type { Tier } from '@ccip-dev/core/linkmarine';

export interface Stop {
  at: number;
  color: string;
}

const stops = (list: readonly Stop[]) => list.map((s) => `<stop offset="${s.at}" stop-color="${s.color.slice(0, 7)}"${s.color.length === 9 ? ` stop-opacity="${(parseInt(s.color.slice(7), 16) / 255).toFixed(3)}"` : ''}/>`).join('');

/** A CSS linear-gradient(angle) on a w×h box, as SVG: the same line through the centre, the same length. */
export function cssLinear(id: string, angle: number, w: number, h: number, list: readonly Stop[]): string {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const f = (v: number) => Math.round(v * 100) / 100;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(w / 2 - dx * half)}" y1="${f(h / 2 - dy * half)}" x2="${f(w / 2 + dx * half)}" y2="${f(h / 2 + dy * half)}">${stops(list)}</linearGradient>`;
}

/** A CSS radial-gradient(circle at x% y%, …) on a w×h box: farthest-corner, as CSS sizes it. */
export function cssRadialSpot(id: string, xPct: number, yPct: number, w: number, h: number, list: readonly Stop[]): string {
  const cx = (w * xPct) / 100;
  const cy = (h * yPct) / 100;
  const r = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x! - cx, y! - cy)));
  const f = (v: number) => Math.round(v * 100) / 100;
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}">${stops(list)}</radialGradient>`;
}

export interface TierLook {
  /** The metal: linear gradient stops at an angle, with optional patina spots and brushing. */
  metal: { angle: number; stops: readonly Stop[]; spots: readonly { x: number; y: number; stops: readonly Stop[] }[]; brushed: boolean };
  /** Embossed type on the metal. */
  ink: string;
  /** The halo, the planets' glow and frames. */
  color: string;
  /** The wordmark: a vertical gradient. */
  word: string;
  /** The odds line, the pips and the outer frames of a ◆◆◆ planet. */
  accent: string;
  halo: { strength: number; glow: boolean };
  sheen: 'holo' | 'soft' | null;
  sparkles: boolean;
}

export const TIER_LOOKS: Readonly<Record<Tier, TierLook>> = {
  common: {
    metal: {
      angle: 135,
      stops: [{ at: 0, color: '#4a5260' }, { at: 0.28, color: '#c9d1dc' }, { at: 0.4, color: '#f4f7fb' }, { at: 0.62, color: '#8e98a6' }, { at: 1, color: '#5b6472' }],
      spots: [],
      brushed: true,
    },
    ink: '#1d2430',
    color: '#c9d1dc',
    word: 'linear-gradient(180deg, #ffffff, #c9d1dc 45%, #6b7584)',
    accent: '#e4e9f0',
    halo: { strength: 0.35, glow: false },
    sheen: null,
    sparkles: false,
  },
  uncommon: {
    metal: {
      angle: 135,
      stops: [{ at: 0, color: '#5a3416' }, { at: 0.3, color: '#c98a4b' }, { at: 0.42, color: '#f0c08a' }, { at: 0.64, color: '#9a5f2c' }, { at: 1, color: '#4e2c12' }],
      spots: [
        { x: 78, y: 30, stops: [{ at: 0, color: '#4fae8c99' }, { at: 0.09, color: '#4fae8c99' }, { at: 0.16, color: '#4fae8c00' }] },
        { x: 22, y: 78, stops: [{ at: 0, color: '#3f9c7b88' }, { at: 0.07, color: '#3f9c7b88' }, { at: 0.13, color: '#3f9c7b00' }] },
        { x: 60, y: 85, stops: [{ at: 0, color: '#5fbf9a66' }, { at: 0.05, color: '#5fbf9a66' }, { at: 0.1, color: '#5fbf9a00' }] },
      ],
      brushed: false,
    },
    ink: '#2e1606',
    color: '#d9955a',
    word: 'linear-gradient(180deg, #ffe2bf, #d9955a 45%, #6e3d16)',
    accent: '#f0c08a',
    halo: { strength: 0.35, glow: false },
    sheen: null,
    sparkles: false,
  },
  rare: {
    metal: {
      angle: 120,
      stops: [{ at: 0, color: '#2b3a8f' }, { at: 0.22, color: '#4f7cff' }, { at: 0.42, color: '#b07cff' }, { at: 0.58, color: '#ffd27a' }, { at: 0.76, color: '#4fd1c5' }, { at: 1, color: '#2b3a8f' }],
      spots: [],
      brushed: false,
    },
    ink: '#141a46',
    color: '#8f8cff',
    word: 'linear-gradient(180deg, #eef2ff, #8fa8ff 40%, #b07cff 70%, #4fd1c5)',
    accent: '#c3b8ff',
    halo: { strength: 0.65, glow: true },
    sheen: 'soft',
    sparkles: false,
  },
  legendary: {
    metal: {
      angle: 135,
      stops: [{ at: 0, color: '#6e4a0c' }, { at: 0.2, color: '#f5c451' }, { at: 0.36, color: '#fff6cf' }, { at: 0.54, color: '#c8901e' }, { at: 0.72, color: '#f7dc85' }, { at: 1, color: '#7d570f' }],
      spots: [],
      brushed: false,
    },
    ink: '#3a2706',
    color: '#f5c451',
    word: 'linear-gradient(180deg, #fff6cf, #f5c451 45%, #b07a12)',
    accent: '#f5d77a',
    halo: { strength: 1, glow: true },
    sheen: 'holo',
    sparkles: true,
  },
};

export const HOLO_STOPS: readonly Stop[] = [
  { at: 0.2, color: '#ff7ad900' },
  { at: 0.32, color: '#ff7ad955' },
  { at: 0.4, color: '#7af0ff55' },
  { at: 0.48, color: '#fff7a855' },
  { at: 0.6, color: '#fff7a800' },
];
```

Create `site/worker/linkmarine/marine-card.ts`:

```ts
import { callsignSeed, filledPips, rimText, seededRandom, serialText, tierTopPct, type MarineCard, type Tier } from '@ccip-dev/core/linkmarine';
import { bytesToBase64 } from '../cards/coin-icons';
import { h, type VNode } from '../h';
import { artLayer, at, capDay, DOT_FILTER, drawable, font, halo, type HaloRing, HEX_CLIP, hexImage, hexPoints, INK, KINO_SIZE, MONO, onCurve, pips, pulse, px, r1, skyLayer } from './art';
import { cssLinear, cssRadialSpot, HOLO_STOPS, TIER_LOOKS, type TierLook } from './metal';

export interface TagBox {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
}

export const BACK_TAG: TagBox = { left: 58, top: 92, width: 300, height: 176, rotate: -11 };
export const FRONT_TAG: TagBox = { left: 96, top: 150, width: 300, height: 176, rotate: 5 };
export const TAG_RADIUS = 40;
const HOLE = { x: 32, y: 88, r: 10 };
/** The front tag's text column: from the 58 px left padding to 20 px short of the right edge. */
const LORE_WIDTH = 222;
const CHAIN_TOP = { x: 260, y: -10 };
/** The etching: the mockup's grayscale(1) contrast(1.7) brightness(.95), toned towards the metal. */
export const ETCH_FILTER = 'grayscale(1) contrast(1.7) brightness(0.95) sepia(0.35)';
const ETCH_OPACITY = 0.62;

const HALO_CENTER = { x: 225, y: 230 };
const HALO_RINGS: readonly HaloRing[] = [
  { r: 150, width: 3, opacity: 0.55 },
  { r: 200, width: 2, opacity: 0.35 },
  { r: 255, width: 1.5, opacity: 0.22 },
  { r: 315, width: 1, opacity: 0.12 },
];

interface Point {
  x: number;
  y: number;
}

/**
 * Three planet layouts, picked by the callsign, in the mockups' coordinates: the planets (the first tag's first) and the
 * control points of the lanes A→B, B→C and A→C, bent so that no lane crosses a planet's label.
 */
export const PLANET_LAYOUTS: readonly { planets: readonly [Point, Point, Point]; lanes: readonly [Point, Point, Point] }[] = [
  { planets: [{ x: 478, y: 262 }, { x: 668, y: 212 }, { x: 600, y: 340 }], lanes: [{ x: 570, y: 170 }, { x: 600, y: 260 }, { x: 510, y: 360 }] },
  { planets: [{ x: 682, y: 262 }, { x: 492, y: 212 }, { x: 560, y: 340 }], lanes: [{ x: 590, y: 170 }, { x: 560, y: 260 }, { x: 650, y: 360 }] },
  { planets: [{ x: 580, y: 214 }, { x: 470, y: 318 }, { x: 690, y: 300 }], lanes: [{ x: 490, y: 230 }, { x: 580, y: 390 }, { x: 660, y: 220 }] },
];
const PLANET_R = [46, 40, 30];

const pngUri = (bytes: Uint8Array) => `data:image/png;base64,${bytesToBase64(bytes)}`;

/** A point of a tag's own coordinates, where it lands on the card once the tag is turned about its centre. */
export function onTag(tag: TagBox, x: number, y: number): { x: number; y: number } {
  const cx = tag.left + tag.width / 2;
  const cy = tag.top + tag.height / 2;
  const a = (tag.rotate * Math.PI) / 180;
  const dx = tag.left + x - cx;
  const dy = tag.top + y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** The card's look drawn from its callsign: the planet layout and the halo's turn. */
export function skyChoices(callsign: string): { seed: number; layout: number; haloTurn: number } {
  const seed = callsignSeed(callsign);
  const random = seededRandom(seed ^ 0x5bd1e995);
  return { seed, layout: Math.floor(random() * PLANET_LAYOUTS.length), haloTurn: r1((random() * 2 - 1) * 6) };
}

const roundRect = (y: number, w: number, hgt: number, r: number) =>
  `M0 ${y + r}a${r} ${r} 0 0 1 ${r} -${r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hgt - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}z`;

/** A tag as the mockup's CSS draws it: shadow, metal, patina or brushing, sheen, inset edges, inner rim and the hole. */
function tagSvg(id: string, tag: TagBox, look: TierLook): { defs: string; body: string } {
  const { width: w, height: hgt } = tag;
  const R = TAG_RADIUS;
  // An inset shadow offset by dy: the tag less the tag moved by dy, inside the tag.
  const inset = (dy: number, fill: string, opacity: number) => `<path d="${roundRect(0, w, hgt, R)}${roundRect(dy, w, hgt, R)}" fill="${fill}" fill-opacity="${opacity}" fill-rule="evenodd"/>`;
  const plate = (fill: string, extra = '') => `<rect width="${w}" height="${hgt}" rx="${R}" fill="${fill}"${extra}/>`;
  const defs = [
    cssLinear(`${id}-metal`, look.metal.angle, w, hgt, look.metal.stops),
    ...look.metal.spots.map((s, i) => cssRadialSpot(`${id}-spot${i}`, s.x, s.y, w, hgt, s.stops)),
    look.sheen ? cssLinear(`${id}-sheen`, 115, w, hgt, HOLO_STOPS) : '',
    `<clipPath id="${id}-clip"><rect width="${w}" height="${hgt}" rx="${R}"/></clipPath>`,
    `<filter id="${id}-shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="20"/></filter>`,
    look.metal.brushed ? `<pattern id="${id}-brush" width="3" height="${hgt}" patternUnits="userSpaceOnUse" patternTransform="rotate(2)"><rect width="1" height="${hgt}" fill="#fff" fill-opacity="0.063"/></pattern>` : '',
  ].join('');
  const body = [
    `<g transform="translate(${tag.left} ${tag.top}) rotate(${tag.rotate} ${w / 2} ${hgt / 2})">`,
    `<rect y="18" width="${w}" height="${hgt}" rx="${R}" fill="#000" opacity="0.73" filter="url(#${id}-shadow)"/>`,
    plate(`url(#${id}-metal)`),
    ...look.metal.spots.map((_, i) => plate(`url(#${id}-spot${i})`)),
    look.metal.brushed ? plate(`url(#${id}-brush)`) : '',
    look.sheen ? plate(`url(#${id}-sheen)`, ` opacity="${look.sheen === 'holo' ? 1 : 0.6}" style="mix-blend-mode:overlay"`) : '',
    `<g clip-path="url(#${id}-clip)">${inset(2, '#fff', 0.6)}${inset(-3, '#000', 0.33)}</g>`,
    `<rect x="10" y="10" width="${w - 20}" height="${hgt - 20}" rx="32" fill="none" stroke="#000" stroke-opacity="0.13" stroke-width="2"/>`,
    `<rect x="11" y="11" width="${w - 20}" height="${hgt - 20}" rx="32" fill="none" stroke="#fff" stroke-opacity="0.27" stroke-width="1.5"/>`,
    `<circle cx="${HOLE.x}" cy="${HOLE.y + 1}" r="${HOLE.r}" fill="#fff" fill-opacity="0.4"/>`,
    `<circle cx="${HOLE.x}" cy="${HOLE.y}" r="${HOLE.r}" fill="${INK.navy}"/>`,
    `<circle cx="${HOLE.x}" cy="${HOLE.y - 1}" r="${HOLE.r - 1.5}" fill="none" stroke="#000" stroke-opacity="0.85" stroke-width="2"/>`,
    '</g>',
  ].join('');
  return { defs, body };
}

function chainSvg(): string {
  const back = onTag(BACK_TAG, HOLE.x, HOLE.y);
  const front = onTag(FRONT_TAG, HOLE.x, HOLE.y);
  const bead = (d: string) =>
    `<path d="${d}" stroke="#5b6472" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 10" fill="none" transform="translate(0.8 1)"/>` +
    `<path d="${d}" stroke="#d9dee6" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 10" fill="none"/>`;
  return (
    bead(`M${CHAIN_TOP.x} ${CHAIN_TOP.y} C 200 40, 110 120, ${r1(back.x)} ${r1(back.y)}`) +
    bead(`M${CHAIN_TOP.x} ${CHAIN_TOP.y} C 250 80, 135 150, ${r1(front.x)} ${r1(front.y)}`)
  );
}

function sparkles(): string {
  const spark = (x: number, y: number, s: number) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><circle r="5" fill="#ffe9a8" opacity="0.7" filter="url(#dot)"/><rect x="-7" y="-0.7" width="14" height="1.4" fill="#fff"/><rect x="-0.7" y="-7" width="1.4" height="14" fill="#fff"/><circle r="1.4" fill="#fff"/></g>`;
  return spark(81, 147, 1) + spark(379, 203, 0.7) + spark(337, 345, 1.2);
}

interface Planet {
  x: number;
  y: number;
  r: number;
  filled: number;
}

function planetsSvg(planets: readonly Planet[], ctrls: readonly [Point, Point, Point], look: TierLook): { under: string; over: string; defs: string } {
  const [a, b, c] = planets as [Planet, Planet, Planet];
  const lanes = [
    { from: a, to: b, ctrl: ctrls[0], color: look.color, alpha: '88' },
    { from: b, to: c, ctrl: ctrls[1], color: INK.lane, alpha: '77' },
    { from: a, to: c, ctrl: ctrls[2], color: INK.lane, alpha: '77' },
  ];
  const lanePaths = lanes
    .map((l) => `<path d="M${l.from.x} ${l.from.y} Q ${r1(l.ctrl.x)} ${r1(l.ctrl.y)} ${l.to.x} ${l.to.y}" stroke="${l.color}${l.alpha}" stroke-width="1.6" fill="none"/>`)
    .join('');
  const pulses = lanes.map((l) => onCurve(l.from, l.ctrl, l.to, 0.42)).map((p) => pulse(p.x, p.y, 4.5)).join('');
  const glows = planets.map((p) => `<polygon points="${hexPoints(p.x, p.y, p.r + 6)}" fill="${look.color}" opacity="0.55" filter="url(#planet-glow)"/>`).join('');
  const frames = planets
    .map(
      (p) =>
        `<polygon points="${hexPoints(p.x, p.y, p.r)}" fill="none" stroke="${look.color}" stroke-width="2.5"/>` +
        (p.filled === 3
          ? `<polygon points="${hexPoints(p.x, p.y, p.r + 9)}" fill="none" stroke="${look.accent}" stroke-width="1.6" opacity="0.9"/><polygon points="${hexPoints(p.x, p.y, p.r + 15)}" fill="none" stroke="${look.accent}" stroke-width="1" opacity="0.45"/>`
          : ''),
    )
    .join('');
  return {
    defs: '<filter id="planet-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>',
    under: lanePaths + pulses + glows,
    over: frames,
  };
}

/** Embossed type on the metal: a light edge up-left, a dark one down-right. */
const emboss = (ink: string, size: number) => ({ color: ink, textShadow: `-${px(size)}px -${px(size)}px 0 #ffffff99, ${px(size)}px ${px(size)}px 0 #00000066` });

function tagFace(tag: TagBox, ...children: VNode[]): VNode {
  return at(tag.left, tag.top, { width: px(tag.width), height: px(tag.height), transform: `rotate(${tag.rotate}deg)` }, ...children);
}

/** The lore rows' type size: 11 as in the mockup, smaller when a long line (FAITH FUNDAMENTALS) would run off the tag. */
export function loreSize(rows: readonly string[]): number {
  const longest = Math.max(...rows.map((r) => r.length));
  return Math.min(11, Math.floor((LORE_WIDTH / (longest * 0.7)) * 10) / 10);
}

export const loreRows = (card: MarineCard) => [`LM ${serialText(card.serial)} · BLOOD ${card.blood}`, `FAITH ${card.faith} · ${capDay(card.enlistedAt)}`];

function frontText(card: MarineCard, look: TierLook): VNode {
  const lines = card.callsign.toUpperCase().split('-');
  const rows = loreRows(card);
  const size = loreSize(rows);
  const line = (text: string) => h('div', { style: { ...font(MONO, 800, 21, look.ink, 0.03), ...emboss(look.ink, 1), lineHeight: 1.18 } }, text);
  const small = (text: string) => h('div', { style: { ...font(MONO, 800, size, `${look.ink}cc`, 0.1), ...emboss(`${look.ink}cc`, 1), lineHeight: 1.5 } }, text);
  return tagFace(
    FRONT_TAG,
    h(
      'div',
      { style: { position: 'absolute', left: px(58), top: px(22), display: 'flex', flexDirection: 'column' } },
      ...lines.map(line),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', marginTop: px(6) } },
        ...rows.map(small),
      ),
    ),
    h(
      'div',
      { style: { position: 'absolute', left: px(22), top: px(FRONT_TAG.height - 13 - 9), width: px(FRONT_TAG.width - 44), display: 'flex', overflow: 'hidden' } },
      h('div', { style: { ...font(MONO, 700, 6.5, `${look.ink}aa`, 0.22), textShadow: `-${px(0.5)}px -${px(0.5)}px 0 #ffffff88` } }, rimText(callsignSeed(card.callsign))),
    ),
  );
}

function backEtch(card: MarineCard, look: TierLook): VNode {
  return tagFace(
    BACK_TAG,
    h(
      'div',
      { style: { position: 'absolute', left: px(62), top: px(30), display: 'flex' } },
      ...card.memes.map((m, i) =>
        h('img', {
          src: pngUri(m.png),
          width: px(64),
          height: px(72),
          style: {
            width: px(64), height: px(72), marginLeft: i === 0 ? 0 : px(10), objectFit: 'cover', clipPath: HEX_CLIP,
            // The mockup multiplies a grey, contrasty meme onto the metal; Satori has no blend modes, so a sepia tint and transparency stand in.
            filter: ETCH_FILTER, opacity: ETCH_OPACITY,
          },
        }),
      ),
    ),
    h('div', { style: { position: 'absolute', left: px(64), top: px(108), ...font(MONO, 800, 10, `${look.ink}aa`, 0.14), textShadow: `-${px(1)}px -${px(1)}px 0 #ffffff88` } }, 'LINK MARINES · ccip.dev'),
  );
}

/** The stamped name as the card can draw it; a name of emoji alone becomes "Marine". */
export function cardName(name: string): string {
  return drawable(name) || 'Marine';
}

function avatarNode(card: MarineCard): VNode {
  const size = px(26);
  const disc = { width: size, height: size, borderRadius: size / 2, flexShrink: 0 };
  return card.avatar
    ? h('img', { src: pngUri(card.avatar), width: size, height: size, style: { ...disc, objectFit: 'cover' } })
    : h('div', { style: { ...disc, backgroundImage: 'linear-gradient(135deg, #2f62df, #a27bf0)' } });
}

function oddsText(card: MarineCard): string {
  const top = tierTopPct(card.tier);
  const rarer = `rarer than ${Math.floor(card.percentile)} in 100 Marines`;
  return top === null ? rarer : `top ${top}% · ${rarer}`;
}

const TIER_WORD: Readonly<Record<Tier, string>> = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', legendary: 'LEGENDARY' };

function panel(card: MarineCard, look: TierLook): VNode {
  return at(
    430,
    30,
    { width: px(300), flexDirection: 'column' },
    h('div', { style: { display: 'flex', alignItems: 'center' } }, avatarNode(card), h('div', { style: { ...font('Inter', 700, 14, INK.text), marginLeft: px(8), maxWidth: px(260), overflow: 'hidden', textOverflow: 'ellipsis' } }, cardName(card.name))),
    h(
      'div',
      { style: { ...font('Inter', 900, 46, 'transparent', 0.02), lineHeight: 1, marginTop: px(16), backgroundImage: look.word, backgroundClip: 'text', filter: `drop-shadow(0 ${px(2)}px ${px(10)}px ${look.color}55)` } },
      TIER_WORD[card.tier],
    ),
    h('div', { style: { ...font(MONO, 700, 13, look.accent), marginTop: px(10) } }, oddsText(card)),
  );
}

function planetLabel(p: Planet, tag: string, count: number, look: TierLook): VNode {
  return at(
    p.x - 70,
    p.y + p.r + (p.filled === 3 ? 18 : 8),
    { width: px(140), flexDirection: 'column', alignItems: 'center' },
    h('div', { style: { ...font(MONO, 700, 11, INK.text), textShadow: `0 ${px(1)}px ${px(4)}px #000` } }, tag),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', marginTop: px(2) } },
      pips(p.filled, px(8), look.accent),
      h('div', { style: { ...font(MONO, 700, 10, INK.gold), marginLeft: px(5), textShadow: `0 ${px(1)}px ${px(4)}px #000` } }, `${count} ${count === 1 ? 'meme' : 'memes'}`),
    ),
  );
}

/** The dog tag card: two tags on a ball chain over the tier's halo, and the panel with the meme planets. */
export function marineTree(card: MarineCard): VNode {
  const look = TIER_LOOKS[card.tier];
  const { seed, layout, haloTurn } = skyChoices(card.callsign);
  const strength = look.halo.strength;
  const glow = halo(
    'halo',
    HALO_CENTER.x,
    HALO_CENTER.y,
    look.color,
    HALO_RINGS.map((r) => ({ ...r, opacity: r1(r.opacity * strength * 100) / 100 })),
    look.halo.glow ? { r: 230, opacity: 0.3 * strength } : null,
    haloTurn,
  );
  const back = tagSvg('back', BACK_TAG, look);
  const front = tagSvg('front', FRONT_TAG, look);
  const chosen = PLANET_LAYOUTS[layout]!;
  const planets = chosen.planets.map((c, i): Planet => ({ ...c, r: PLANET_R[i]!, filled: filledPips(card.memes[i]!.count) }));
  const orbit = planetsSvg(planets, chosen.lanes, look);
  return h(
    'div',
    { style: { width: KINO_SIZE.width, height: KINO_SIZE.height, display: 'flex', position: 'relative', backgroundColor: INK.navy, fontFamily: 'Inter', color: INK.text } },
    skyLayer(seed, [{ x: 212.8, y: 192.6, color: `${look.color}33`, stop: 0.42 }, { x: 608, y: 42.8, color: '#1d3a7a', stop: 0.55 }], glow.body + back.body, glow.defs + back.defs),
    backEtch(card, look),
    artLayer(front.body, front.defs),
    frontText(card, look),
    artLayer(chainSvg() + (look.sparkles ? sparkles() : '') + orbit.under, DOT_FILTER + orbit.defs),
    ...planets.map((p, i) => hexImage(pngUri(card.memes[i]!.png), p.x, p.y, p.r)),
    artLayer(orbit.over),
    panel(card, look),
    ...planets.map((p, i) => planetLabel(p, card.memes[i]!.tag, card.memes[i]!.count, look)),
    at(30, 393, { ...font(MONO, 800, 15, INK.paleGold, 0.12), textShadow: `0 0 ${px(12)}px #f5c45155` }, `LINK MARINE #${serialText(card.serial)}`),
    at(680, 395, { width: px(50), justifyContent: 'flex-end', ...font(MONO, 700, 13, INK.blue) }, 'ccip.dev'),
  );
}
```

Create `site/worker/linkmarine/meme.ts`:

```ts
import { bytesToBase64 } from '../cards/coin-icons';
import { h, type VNode } from '../h';

/** The largest the card ever draws a meme (a planet) is 145 px: memes are kept at this size, square, cover-cropped. */
export const MEME_SIZE = 240;

const SIGNATURES: readonly { mime: string; bytes: readonly number[] }[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

/** The image type by its first bytes; the archive holds JPEG, PNG and GIF, whatever their file names say. */
export function sniffImage(bytes: Uint8Array): string | null {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[i] === b))?.mime ?? null;
}

/** A meme cover-cropped to MEME_SIZE square; an animated GIF keeps its first frame. */
export function memeTree(image: Uint8Array): VNode {
  const mime = sniffImage(image);
  if (!mime) throw new Error('prepareMeme: not a JPEG, PNG or GIF image');
  return h(
    'div',
    { style: { width: MEME_SIZE, height: MEME_SIZE, display: 'flex' } },
    h('img', { src: `data:${mime};base64,${bytesToBase64(image)}`, width: MEME_SIZE, height: MEME_SIZE, style: { width: MEME_SIZE, height: MEME_SIZE, objectFit: 'cover' } }),
  );
}
```

Create `site/worker/linkmarine/entrypoint.ts`:

```ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { MarineCard } from '@ccip-dev/core/linkmarine';
import { marineTree } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
import { renderKino } from './render';

/**
 * The LinkMarine bot's renderer, reached only through its service binding: no route serves it. It returns PNG (and GIF)
 * bytes, and throws when a card cannot be drawn, so the bot never posts a half-drawn one.
 */
export class LinkMarineCards extends WorkerEntrypoint {
  async prepareMeme(image: Uint8Array): Promise<Uint8Array> {
    return (await renderKino(memeTree(image), { width: MEME_SIZE, height: MEME_SIZE })).png;
  }

  async renderMarineCard(card: MarineCard): Promise<Uint8Array> {
    return (await renderKino(marineTree(card))).png;
  }
}
```

In `site/worker/index.ts`, replace:

```ts
  },
} satisfies ExportedHandler<OgEnv & { ASSETS: Fetcher }>;
```

with:

```ts
  },
} satisfies ExportedHandler<OgEnv & { ASSETS: Fetcher }>;

export { LinkMarineCards } from './linkmarine/entrypoint';
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-marine.test.ts`
Expected: PASS (6 tests).

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts`
Expected: PASS: the existing 9 card tests and the 7 new ones (about 30 s: each dog tag card takes 2–3 s to draw).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add site/worker/linkmarine/metal.ts site/worker/linkmarine/marine-card.ts site/worker/linkmarine/meme.ts site/worker/linkmarine/entrypoint.ts site/worker/index.ts site/test/fixtures/linkmarine.ts site/test/linkmarine-marine.test.ts site/worker/test/linkmarine-marine.test.ts
git commit -m "feat(site): the LinkMarine dog tag card in four tier metals, and the LinkMarineCards entrypoint" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: The animated glint

Rare and Legendary cards get a light sweeping across the front tag: the static card held 600 ms, then twelve 60 ms frames, a GIF that loops every 1.32 s. The frames are lit in JavaScript from the static card's pixels (the tag's rounded rectangle, turned 5°, is known exactly), so the card is drawn once. Every frame after the first carries only the pixels that change.

**Files:**
- Modify: `site/package.json`, `pnpm-lock.yaml` (`gifenc` 1.0.3, exact)
- Create: `site/worker/linkmarine/gifenc.d.ts`, `site/worker/linkmarine/glint.ts`
- Modify: `site/worker/linkmarine/entrypoint.ts` (`renderMarineGlint`)
- Test: `site/test/linkmarine-glint.test.ts` (Node), `site/worker/test/linkmarine-glint.test.ts` (workerd)

**Interfaces:**
- Consumes: Task 1 (`hasGlint`); Task 2 (`px`, `renderKino`); Task 3 (`FRONT_TAG`, `TAG_RADIUS`, `type TagBox`, `marineTree`, `LinkMarineCards`, the fixture `marine`); `gifenc` (`GIFEncoder`, `quantize`, `nearestColorIndex`).
- Produces (`glint.ts`):
  - `GLINT = { sweepFrames: 12, frameMs: 60, holdMs: 600 }`, `TRANSPARENT = 255`;
  - `tagFrame(tag: TagBox, width, height)`: the tag in card pixels and its turned bounding box `x0, y0, x1, y1`;
  - `glintAt(frame, x, y, t): number` (0 off the tag; t from 0 to 1 sweeps the band across);
  - `interface GlintFrames { palette; first: Uint8Array; sweep: Uint8Array[]; box }`, `glintFrames(base: Uint8Array, width, height, tag = FRONT_TAG): GlintFrames`;
  - `glintGif(base: Uint8Array, width, height, tag = FRONT_TAG): Uint8Array` (GIF89a, looping);
  - `LinkMarineCards.renderMarineGlint(card: MarineCard): Promise<Uint8Array | null>` (null for Common and Uncommon).

- [ ] **Step 1: Write the failing tests.**

Create `site/test/linkmarine-glint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GLINT, glintAt, glintFrames, tagFrame, TRANSPARENT } from '../worker/linkmarine/glint';
import { FRONT_TAG } from '../worker/linkmarine/marine-card';

const W = 1200;
const H = 675;

/** A card of two colours, so the palette has room and the sweep has something to light. */
function base(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let p = 0; p < W * H; p++) rgba.set(p % W < 600 ? [10, 15, 30, 255] : [200, 150, 60, 255], p * 4);
  return rgba;
}

describe('the glint', () => {
  it('lights only the front tag, from nothing to a bright band and back', () => {
    // #given the tag's centre in card pixels
    const f = tagFrame(FRONT_TAG, W, H);
    const [cx, cy] = [Math.floor(f.cx), Math.floor(f.cy)];
    // #when
    const light = { offTag: glintAt(f, 5, 5, 0.5), centre: glintAt(f, cx, cy, 0.5), before: glintAt(f, cx, cy, 0), after: glintAt(f, cx, cy, 1) };
    // #then
    expect({ offTag: light.offTag, centre: light.centre > 0.8, before: light.before < 0.01, after: light.after < 0.01 }).toEqual({ offTag: 0, centre: true, before: true, after: true });
  });

  it('holds the card, then sweeps in twelve frames that change nothing outside the tag', () => {
    // #when
    const frames = glintFrames(base(), W, H);
    const { x0, y0, x1, y1 } = frames.box;
    const outside = frames.sweep.every((index) => index.every((v, p) => v === TRANSPARENT || ((p % W) >= x0 && (p % W) < x1 && Math.floor(p / W) >= y0 && Math.floor(p / W) < y1)));
    const changed = frames.sweep.map((index) => index.filter((v) => v !== TRANSPARENT).length);
    // #then
    expect({
      sweep: frames.sweep.length,
      palette: frames.palette.length,
      outside,
      lit: changed.slice(2, 10).every((n) => n > 1000),
      timing: GLINT.holdMs + GLINT.sweepFrames * GLINT.frameMs,
    }).toEqual({ sweep: 12, palette: 256, outside: true, lit: true, timing: 1320 });
  });
});
```

Create `site/worker/test/linkmarine-glint.test.ts`:

```ts
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { renderKino } from '../linkmarine/render';

const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;

/** A GIF's logical size, loop count and frame delays (ms), read from its blocks. */
function gifInfo(gif: Uint8Array): { header: string; width: number; height: number; loop: number | null; delays: number[] } {
  const u16 = (at: number) => gif[at]! | (gif[at + 1]! << 8);
  const skipSubBlocks = (at: number) => {
    while (gif[at] !== 0) at += gif[at]! + 1;
    return at + 1;
  };
  let at = 13 + (gif[10]! & 0x80 ? 3 * (1 << ((gif[10]! & 7) + 1)) : 0);
  let loop: number | null = null;
  const delays: number[] = [];
  while (at < gif.length && gif[at] !== 0x3b) {
    if (gif[at] === 0x21 && gif[at + 1] === 0xf9) {
      delays.push(u16(at + 4) * 10);
      at = skipSubBlocks(at + 2);
    } else if (gif[at] === 0x21 && gif[at + 1] === 0xff) {
      if (String.fromCharCode(...gif.subarray(at + 3, at + 14)) === 'NETSCAPE2.0') loop = u16(at + 16);
      at = skipSubBlocks(at + 2);
    } else if (gif[at] === 0x2c) {
      const local = gif[at + 9]! & 0x80 ? 3 * (1 << ((gif[at + 9]! & 7) + 1)) : 0;
      at = skipSubBlocks(at + 10 + local + 1);
    } else {
      throw new Error(`unexpected GIF block 0x${gif[at]!.toString(16)} at ${at}`);
    }
  }
  return { header: String.fromCharCode(...gif.subarray(0, 6)), width: u16(6), height: u16(8), loop, delays };
}

describe('the LinkMarineCards entrypoint: the animated glint', () => {
  it('animates Rare and Legendary as a looping 1200×675 GIF of about 1.3 s, under 2 MB', async () => {
    // #given
    const cards = new LinkMarineCards(createExecutionContext(), {} as never);
    const memes = [await solid('#d01818'), await solid('#1f6fb2')];
    // #when
    const gifs = await Promise.all((['rare', 'legendary'] as const).map((tier) => cards.renderMarineGlint(marine(tier, memes))));
    // #then
    expect(
      gifs.map((gif) => {
        const info = gifInfo(gif!);
        return { ...info, delays: info.delays.reduce((s, d) => s + d, 0), frames: info.delays.length, small: gif!.length < 2_000_000 };
      }),
    ).toEqual([0, 1].map(() => ({ header: 'GIF89a', width: 1200, height: 675, loop: 0, delays: 1320, frames: 13, small: true })));
  });

  it('has no glint for Common and Uncommon', async () => {
    // #given
    const cards = new LinkMarineCards(createExecutionContext(), {} as never);
    const memes = [await solid('#d01818')];
    // #when
    const gifs = await Promise.all((['common', 'uncommon'] as const).map((tier) => cards.renderMarineGlint(marine(tier, memes))));
    // #then
    expect(gifs).toEqual([null, null]);
  });
});
```

- [ ] **Step 2: Run the Node test and confirm it fails.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-glint.test.ts`
Expected: FAIL: `../worker/linkmarine/glint` does not exist.

- [ ] **Step 3: Add the encoder.**

Run: `pnpm --filter @ccip-dev/site add gifenc@1.0.3 --save-exact`
Expected: `site/package.json` gains `"gifenc": "1.0.3"` under `dependencies`, and `pnpm-lock.yaml` gains `gifenc@1.0.3`.

- [ ] **Step 4: Add the glint and its entrypoint method.**

`gifenc` ships no types:

Create `site/worker/linkmarine/gifenc.d.ts`:

```ts
declare module 'gifenc' {
  export type Palette = number[][];
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): Palette;
  export function nearestColorIndex(palette: Palette, pixel: number[]): number;
}
```

Create `site/worker/linkmarine/glint.ts`:

```ts
/// <reference path="./gifenc.d.ts" />
import * as gifencModule from 'gifenc';
import { px } from './art';
import { FRONT_TAG, TAG_RADIUS, type TagBox } from './marine-card';

// Bundlers hand gifenc over as ES named exports, Node as the CommonJS object behind `default`.
const gifenc: typeof gifencModule = 'GIFEncoder' in gifencModule ? gifencModule : (gifencModule as unknown as { default: typeof gifencModule }).default;

export const GLINT = { sweepFrames: 12, frameMs: 60, holdMs: 600 } as const;
export const TRANSPARENT = 255;
/** A 4×4 Bayer matrix, centred on zero: ordered dithering stays put from frame to frame, so unchanged pixels stay transparent. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 10);

interface TagFrame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
  cos: number;
  sin: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The front tag in card pixels, with the box around it once turned. */
export function tagFrame(tag: TagBox, width: number, height: number): TagFrame {
  const w = px(tag.width);
  const h = px(tag.height);
  const cx = px(tag.left) + w / 2;
  const cy = px(tag.top) + h / 2;
  const a = (tag.rotate * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const halfW = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
  const halfH = (Math.abs(w * sin) + Math.abs(h * cos)) / 2;
  return {
    cx, cy, w, h, r: px(TAG_RADIUS), cos, sin,
    x0: Math.max(0, Math.floor(cx - halfW)), y0: Math.max(0, Math.floor(cy - halfH)),
    x1: Math.min(width, Math.ceil(cx + halfW)), y1: Math.min(height, Math.ceil(cy + halfH)),
  };
}

/** How much light the sweep throws on card pixel (x, y) at progress t (0 → 1), 0 off the tag. */
export function glintAt(f: TagFrame, x: number, y: number, t: number): number {
  const dx = x + 0.5 - f.cx;
  const dy = y + 0.5 - f.cy;
  const u = dx * f.cos + dy * f.sin;
  const v = -dx * f.sin + dy * f.cos;
  const qx = Math.abs(u) - (f.w / 2 - f.r);
  const qy = Math.abs(v) - (f.h / 2 - f.r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - f.r;
  const cover = Math.min(1, Math.max(0, 0.5 - outside));
  if (cover === 0) return 0;
  const centre = (-0.85 + 1.7 * t) * f.w;
  const s = (u + 0.42 * v - centre) / f.w;
  const light = 0.55 * Math.exp(-((s / 0.09) ** 2)) + 0.35 * Math.exp(-((s / 0.018) ** 2));
  return cover * Math.min(0.85, light);
}

function lit(base: Uint8Array, f: TagFrame, t: number, width: number): Uint8Array {
  const out = new Uint8Array(base);
  for (let y = f.y0; y < f.y1; y++) {
    for (let x = f.x0; x < f.x1; x++) {
      const k = glintAt(f, x, y, t);
      if (k === 0) continue;
      const i = (y * width + x) * 4;
      out[i] = out[i]! + k * (255 - out[i]!);
      out[i + 1] = out[i + 1]! + k * (255 - out[i + 1]!);
      out[i + 2] = out[i + 2]! + k * (255 - out[i + 2]!);
    }
  }
  return out;
}

function indexer(palette: gifencModule.Palette): (rgba: Uint8Array, i: number, x: number, y: number) => number {
  const cache = new Int16Array(1 << 15).fill(-1);
  return (rgba, i, x, y) => {
    const d = BAYER[(y & 3) * 4 + (x & 3)]!;
    const r = Math.min(255, Math.max(0, rgba[i]! + d));
    const g = Math.min(255, Math.max(0, rgba[i + 1]! + d));
    const b = Math.min(255, Math.max(0, rgba[i + 2]! + d));
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let found = cache[key]!;
    if (found < 0) {
      found = gifenc.nearestColorIndex(palette, [(r >> 3) << 3, (g >> 3) << 3, (b >> 3) << 3]);
      cache[key] = found;
    }
    return found;
  };
}

export interface GlintFrames {
  palette: gifencModule.Palette;
  /** The static card, indexed. */
  first: Uint8Array;
  /** The sweep: each frame's changed pixels, TRANSPARENT everywhere else. */
  sweep: Uint8Array[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * The glint's frames: the static card, then a light sweeping across the front tag. They share one 255-colour palette,
 * and every frame after the first carries only the pixels that change, so the file stays small.
 */
export function glintFrames(base: Uint8Array, width: number, height: number, tag: TagBox = FRONT_TAG): GlintFrames {
  const frame = tagFrame(tag, width, height);
  const sweeps = Array.from({ length: GLINT.sweepFrames }, (_, k) => lit(base, frame, (k + 1) / (GLINT.sweepFrames + 1), width));
  const sample = new Uint8Array(base.length * 2);
  sample.set(base);
  sample.set(sweeps[Math.floor(GLINT.sweepFrames / 2)]!, base.length);
  const palette = gifenc.quantize(sample, 255);
  while (palette.length < 256) palette.push([0, 0, 0]);
  const toIndex = indexer(palette);
  const shown = new Uint8Array(width * height);
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) shown[p] = toIndex(base, p * 4, x, y);
  const first = new Uint8Array(shown);
  const sweep = sweeps.map((pixels) => {
    const index = new Uint8Array(width * height).fill(TRANSPARENT);
    for (let y = frame.y0; y < frame.y1; y++) {
      for (let x = frame.x0; x < frame.x1; x++) {
        const p = y * width + x;
        const want = toIndex(pixels, p * 4, x, y);
        if (want !== shown[p]) {
          index[p] = want;
          shown[p] = want;
        }
      }
    }
    return index;
  });
  return { palette, first, sweep, box: { x0: frame.x0, y0: frame.y0, x1: frame.x1, y1: frame.y1 } };
}

/** The animated glint as a looping GIF: the card held 600 ms, then twelve 60 ms frames of the sweep, about 1.3 s in all. */
export function glintGif(base: Uint8Array, width: number, height: number, tag: TagBox = FRONT_TAG): Uint8Array {
  const frames = glintFrames(base, width, height, tag);
  const gif = gifenc.GIFEncoder();
  gif.writeFrame(frames.first, width, height, { palette: frames.palette, delay: GLINT.holdMs, repeat: 0 });
  for (const index of frames.sweep) gif.writeFrame(index, width, height, { delay: GLINT.frameMs, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 });
  gif.finish();
  return gif.bytes();
}
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { MarineCard } from '@ccip-dev/core/linkmarine';
import { marineTree } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
```

with:

```ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import { hasGlint, type MarineCard } from '@ccip-dev/core/linkmarine';
import { glintGif } from './glint';
import { marineTree } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
    return (await renderKino(marineTree(card))).png;
  }
}
```

with:

```ts
    return (await renderKino(marineTree(card))).png;
  }

  async renderMarineGlint(card: MarineCard): Promise<Uint8Array | null> {
    if (!hasGlint(card.tier)) return null;
    const rendered = await renderKino(marineTree(card));
    return glintGif(rendered.pixels, rendered.width, rendered.height);
  }
}
```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-glint.test.ts`
Expected: PASS (2 tests).

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/linkmarine-glint.test.ts`
Expected: PASS (2 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add site/package.json pnpm-lock.yaml site/worker/linkmarine/gifenc.d.ts site/worker/linkmarine/glint.ts site/worker/linkmarine/entrypoint.ts site/test/linkmarine-glint.test.ts site/worker/test/linkmarine-glint.test.ts
git commit -m "feat(site): the animated glint of Rare and Legendary dog tags, a looping GIF" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: The SITREP and the chain dossier

The first two intel cards of `intel-cards.html`, and what all four share: the navy sky with its glows, the eyebrow, "ccip.dev" at the top right, the "as of" line, the hex-bulleted rows, and chain icons that fill their hexagon. A chain's hexagon takes the fill of its icon's first shape (the icon's background square), its glow and frame a lighter shade of it, and the icon square is drawn as wide as the hexagon, so its corners fall outside the clip and only its colour shows.

**Files:**
- Create: `site/worker/linkmarine/chain-hex.ts`, `site/worker/linkmarine/intel-frame.ts`, `site/worker/linkmarine/sitrep-card.ts`, `site/worker/linkmarine/dossier-card.ts`
- Test: `site/test/fixtures/linkmarine.ts` (the real intel of 13 Oct 2026), `site/test/linkmarine-intel.test.ts` (Node), `site/worker/test/linkmarine-sitrep.test.ts` (workerd)

**Interfaces:**
- Consumes: Task 1 (`type SitrepCard`, `type DossierCard`, `type IntelLane`); Task 2 (`artLayer`, `at`, `capDay`, `DOT_FILTER`, `font`, `halo`, `hexBullet`, `hexImage`, `hexPoints`, `INK`, `KINO_SIZE`, `MONO`, `MONTHS`, `onCurve`, `pulse`, `px`, `r1`, `skyLayer`, `utcDate`, `renderKino`); live code `iconHref`, `LETTERMARK_BG`, `lettermarkLetter` (`site/src/lib/chain-icons.ts`), `bytesToBase64`, `type AssetFetcher` (`coin-icons.ts`), `glyph` (`cards/glyphs.ts`), `formatCount`, `formatDuration`, `formatFeeTotal`, `formatShare`, `formatUsd` (`@ccip-dev/core/format`).
- Produces:
  - `chain-hex.ts`: `interface ChainArt { src: string | null; bg: string; glow: string }`, `iconBackground(svg): string`, `glowColor(bg): string`, `chainArt(assets, selector): Promise<ChainArt>`, `chainArts(assets, selectors): Promise<Map<string, ChainArt>>`, `NO_ART`, `chainHexUnder(id, cx, cy, r, art): { defs; body }`, `chainHexFrame(cx, cy, r, art, double?): string`, `chainHexIcon(cx, cy, r, art, name): VNode`.
  - `intel-frame.ts`: `capWeekday`, `plainDay`, `shortWeekday`, `clock`, `BLUE_TEXT`, `GOLD_TEXT`, `daySeed(iso)`, `intelFrame(seed, glows, art, ...children): VNode`, `eyebrow(left, top, text, extra?)`, `caption(left, top, text, color?, style?)`, `asOf(iso)`, `b(text)`, `textRow(children, style?)`, `bulletRow(children, style?)`, `change(pct, digits)`, `bend(a, b, k)`.
  - `sitrep-card.ts`: `LANE_SLOTS`, `roughCount(n)`, `dayFraction(iso)`, `placeLanes(lanes)`, `laneLabel(x, y, text)`, `sitrepTree(card: SitrepCard, arts): VNode`.
  - `dossier-card.ts`: `PARTNER_SLOTS`, `titleSize(name)`, `highlight(card)`, `dossierTree(card: DossierCard, arts): VNode`.
  - Fixtures: `AVALANCHE`, `BASE`, `ETHEREUM`, `MONAD`, `PLASMA`, `ROBINHOOD` (`IntelChain`s), `SITREP`, `DOSSIER`.

- [ ] **Step 1: Add the fixtures and write the failing tests.**

In `site/test/fixtures/linkmarine.ts`, replace:

```ts
import type { MarineCard, Tier } from '@ccip-dev/core/linkmarine';

/** Text the card fonts can draw: their Latin subset. */
```

with:

```ts
import type { DossierCard, MarineCard, SitrepCard, Tier } from '@ccip-dev/core/linkmarine';

/** Text the card fonts can draw: their Latin subset. */
```

In `site/test/fixtures/linkmarine.ts`, replace:

```ts
  };
}
```

with:

```ts
  };
}

// Real intel from data.ccip.dev on Tue 13 Oct 2026, as the bot computes it: the cards' fixtures and the visual check's input.
export const AVALANCHE = { selector: '6433500567565415381', name: 'Avalanche' };
export const BASE = { selector: '15971525489660198786', name: 'Base' };
export const ETHEREUM = { selector: '5009297550715157269', name: 'Ethereum' };
export const MONAD = { selector: '8481857512324358265', name: 'Monad' };
export const PLASMA = { selector: '9335212494177455608', name: 'Plasma' };
export const ROBINHOOD = { selector: '6180753054346818345', name: 'Robinhood' };

export const SITREP: SitrepCard = {
  updatedAt: '2026-10-13T11:28:01.860Z',
  messages: 685,
  pace: { projected: 1433.6563323454902, yesterday: 1625 },
  usd: 44064348.04,
  feesUsd: 419.36,
  linkSharePct: 0.25,
  senders: 211,
  medianDeliveryS: 820,
  lanes: [
    { src: MONAD, dst: ETHEREUM, usd: 16298903.16 },
    { src: ETHEREUM, dst: MONAD, usd: 10704140.65 },
    { src: ETHEREUM, dst: PLASMA, usd: 6754321.91 },
    { src: MONAD, dst: AVALANCHE, usd: 1999585.26 },
    { src: MONAD, dst: PLASMA, usd: 1468701.01 },
  ],
};

export const DOSSIER: DossierCard = {
  asOf: '2026-10-13T06:01:00.177Z',
  chain: BASE,
  rank: 3,
  ranked: 92,
  feeRank: 1,
  messages: 552062,
  usd: 3792810516,
  feesUsd: 356718.47,
  week: { messages: 3881, usd: 16181949 },
  days: [{ day: '2026-10-06', messages: 684 }, { day: '2026-10-07', messages: 639 }, { day: '2026-10-08', messages: 756 }, { day: '2026-10-09', messages: 391 }, { day: '2026-10-10', messages: 352 }, { day: '2026-10-11', messages: 442 }, { day: '2026-10-12', messages: 617 }],
  partners: [{ chain: MONAD, usd: 5788934 }, { chain: ETHEREUM, usd: 5290358 }, { chain: AVALANCHE, usd: 2114221 }, { chain: ROBINHOOD, usd: 1454504 }],
  since: '2023-09-16',
};
```

Create `site/test/linkmarine-intel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LETTERMARK_BG } from '../src/lib/chain-icons';
import { glowColor, iconBackground } from '../worker/linkmarine/chain-hex';
import { dossierTree, highlight, titleSize } from '../worker/linkmarine/dossier-card';
import { dayFraction, placeLanes, roughCount, sitrepTree } from '../worker/linkmarine/sitrep-card';
import { texts } from './fixtures/broadcast';
import { DOSSIER, DRAWABLE_TEXT, SITREP } from './fixtures/linkmarine';

const NO_ARTS = new Map();

describe('the chain hexagons', () => {
  it("fills a hexagon with the icon's own background: its first shape's fill", () => {
    // #when
    const fills = [
      iconBackground('<svg viewBox="0 0 32 32"><g clip-path="url(#a)"><rect width="32" height="32" fill="#627eea" rx="4"/><path fill="#fff" d="M0 0"/></g></svg>'),
      iconBackground('<svg viewBox="0 0 32 32"><path fill="#cf0" d="M0 4"/></svg>'),
      iconBackground('<svg viewBox="0 0 200 200"><path d="M0 0h200v200H0z"/><path fill="#c0ff72" d="M1 1"/></svg>'),
      iconBackground('<svg viewBox="0 0 32 32"><path fill="url(#g)" d="M0 4"/></svg>'),
    ];
    // #then
    expect(fills).toEqual(['#627eea', '#cf0', '#000000', LETTERMARK_BG]);
  });

  it('glows in the background\'s hue, lit enough for the night sky, and pale blue for a grey', () => {
    // #then
    expect(['#627eea', '#e84142', '#001a19', '#808080', '#ffffff'].map(glowColor)).toEqual(['#9caef2', '#f08586', '#3dfff8', '#cfe0ff', '#cfe0ff']);
  });
});

describe('the SITREP card', () => {
  it('shows today so far, its pace against yesterday and the top lanes, as the mockup does', () => {
    // #when
    const words = texts(sitrepTree(SITREP, NO_ARTS));
    // #then
    expect(words).toEqual(
      expect.arrayContaining([
        'LIVE', 'SITREP · TUE 13 OCT 2026 · 11:28 UTC', 'ccip.dev', '685', 'messages so far today', '12%', ' on pace for ~1,430 · yesterday ', '1,625',
        '$44.1M', ' moved', '$419', ' in fees · ', '0.3%', ' in LINK', '211', ' senders · median delivery ', '13m 40s', 'TOP LANES TODAY', '$16.3M', '$10.7M', '$6.8M', '00:00', '24:00 UTC',
      ]),
    );
  });

  it('says "early in the day" before 01:00, and leaves out yesterday when it is not in history.json', () => {
    // #when
    const early = texts(sitrepTree({ ...SITREP, pace: null }, NO_ARTS));
    const noYesterday = texts(sitrepTree({ ...SITREP, pace: { projected: 1433.7, yesterday: null } }, NO_ARTS));
    // #then
    expect({ early: early.includes('early in the day'), pace: noYesterday.includes('on pace for ~1,430'), yesterday: noYesterday.some((w) => w.includes('yesterday')) }).toEqual({ early: true, pace: true, yesterday: false });
  });

  it('rounds the projection to three figures and knows how far into the UTC day it is', () => {
    // #then
    expect([roughCount(1433.66), roughCount(636), roughCount(12_345.6), dayFraction('2026-10-13T12:00:00.000Z')]).toEqual([1430, 636, 12_300, 0.5]);
  });

  it('seats the busiest chains first, and drops a lane whose chain finds no seat', () => {
    // #given nine chains across five lanes
    const chain = (n: number) => ({ selector: String(n), name: `C${n}` });
    const lanes = [1, 2, 3, 4, 5].map((n) => ({ src: chain(n * 2 - 1), dst: chain(n * 2), usd: 100 - n }));
    // #when
    const seated = placeLanes(SITREP.lanes);
    const crowded = placeLanes(lanes);
    // #then Ethereum ($33.8M of these lanes) takes the first seat and Monad ($30.5M) the second; the lanes between them run both ways
    expect({
      first: [seated[0]!.lane.src.name, seated[0]!.a, seated[0]!.b],
      reversed: [seated[1]!.a, seated[1]!.b],
      crowded: crowded.length,
    }).toEqual({ first: ['Monad', { x: 690, y: 215 }, { x: 585, y: 120 }], reversed: [{ x: 585, y: 120 }, { x: 690, y: 215 }], crowded: 4 });
  });
});

describe('the dossier card', () => {
  it("shows the chain's rank, its all-time numbers, its week and its partners", () => {
    // #when
    const words = texts(dossierTree(DOSSIER, NO_ARTS));
    // #then
    expect(words).toEqual(
      expect.arrayContaining([
        'CHAIN DOSSIER · CCIP', 'BASE', '#3 of 92 all time · #1 in fees this week', '552,062', ' messages · ', '$3.8B', ' moved', '$356.7K', ' in fees, all time',
        '7 days: ', '3,881', '$16.2M', '$5.8M', '$5.3M', '$2.1M', '$1.5M', 'LAST 7 DAYS · MESSAGES A DAY', 'ON CCIP SINCE 16 SEP 2023', 'AS OF 13 OCT 2026 · 06:01 UTC',
      ]),
    );
  });

  it('adds the fee rank only for a top-3 chain, and shrinks a long name to fit', () => {
    // #then
    expect({ plain: highlight({ ...DOSSIER, rank: 40, feeRank: null }), sizes: ['BASE', 'ETHEREUM', 'ARBITRUM ONE', 'BINANCE SMART CHAIN'].map(titleSize) }).toEqual({
      plain: '#40 of 92 all time',
      sizes: [72, 56, 42, 32],
    });
  });

  it('writes no character the card fonts lack', () => {
    // #when
    const words = [...texts(sitrepTree(SITREP, NO_ARTS)), ...texts(dossierTree(DOSSIER, NO_ARTS))];
    // #then
    expect(words.filter((w) => !DRAWABLE_TEXT.test(w))).toEqual([]);
  });
});
```

Create `site/worker/test/linkmarine-sitrep.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BASE, DOSSIER, ETHEREUM, SITREP } from '../../test/fixtures/linkmarine';
import { px } from '../linkmarine/art';
import { chainArts } from '../linkmarine/chain-hex';
import { dossierTree } from '../linkmarine/dossier-card';
import { renderKino } from '../linkmarine/render';
import { LANE_SLOTS, sitrepTree } from '../linkmarine/sitrep-card';

const RED_SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>';
/** The site's assets with every chain icon missing but the ones given. */
const assets = (icons: Record<string, string>) => ({
  fetch: async (request: Request | string) => {
    const path = new URL(typeof request === 'string' ? request : request.url).pathname;
    return path in icons ? new Response(icons[path]) : new Response('missing', { status: 404 });
  },
});
const pixel = (r: { pixels: Uint8Array; width: number }, x: number, y: number) => [...r.pixels.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];

describe('the SITREP and dossier cards', () => {
  it("fill each chain's hexagon with its icon from the site's assets, in its own colour", async () => {
    // #given Ethereum's icon is a red square, and Base's
    const arts = await chainArts(assets({ '/chains/ethereum-mainnet.svg': RED_SQUARE, '/chains/ethereum-mainnet-base-1.svg': RED_SQUARE }), [ETHEREUM.selector, BASE.selector]);
    // #when
    const [sitrep, dossier] = await Promise.all([renderKino(sitrepTree(SITREP, arts)), renderKino(dossierTree(DOSSIER, arts))]);
    // #then Ethereum sits in the busiest seat, Base is the dossier's hero at (200, 218), both red to the hexagon's tip
    const seat = LANE_SLOTS[0]!;
    expect({
      size: [sitrep.width, sitrep.height, dossier.width, dossier.height],
      ethereum: pixel(sitrep, Math.round(px(seat.x)), Math.round(px(seat.y))),
      tip: pixel(sitrep, Math.round(px(seat.x)), Math.round(px(seat.y - 23))),
      base: pixel(dossier, Math.round(px(200)), Math.round(px(218))),
      art: [arts.get(ETHEREUM.selector)!.bg, arts.get(ETHEREUM.selector)!.glow],
    }).toEqual({ size: [1200, 675, 1200, 675], ethereum: [255, 0, 0], tip: [255, 0, 0], base: [255, 0, 0], art: ['#ff0000', '#ff4d4d'] });
  });
});
```

- [ ] **Step 2: Run the Node test and confirm it fails.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-intel.test.ts`
Expected: FAIL: `../worker/linkmarine/chain-hex` does not exist.

- [ ] **Step 3: Add the chain hexagons, the intel frame and the two cards.**

Create `site/worker/linkmarine/chain-hex.ts`:

```ts
import { iconHref, LETTERMARK_BG, lettermarkLetter } from '../../src/lib/chain-icons';
import { bytesToBase64, type AssetFetcher } from '../cards/coin-icons';
import { h, type VNode } from '../h';
import { font, hexImage, hexPoints, INK, px } from './art';

/** A chain's icon as the cards draw it: the logo, the hexagon's fill behind it, and the glow and frame around it. */
export interface ChainArt {
  src: string | null;
  bg: string;
  glow: string;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The fill of the icon's first shape, which is its background square; black when it has none, as SVG paints it. */
export function iconBackground(svg: string): string {
  const first = /<(?:rect|path|circle)\b[^>]*>/.exec(svg)?.[0];
  if (!first) return LETTERMARK_BG;
  const fill = /\sfill="([^"]*)"/.exec(first)?.[1];
  if (fill === undefined) return '#000000';
  return HEX.test(fill) ? fill.toLowerCase() : LETTERMARK_BG;
}

const rgb = (hex: string): [number, number, number] => {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
};

/** The background's hue, saturated and lit enough to glow on the navy sky: Ethereum's #627eea glows #9caef2; a grey glows pale blue. */
export function glowColor(bg: string): string {
  const [r, g, b] = rgb(bg);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.08) return INK.lane;
  const s = d / (1 - Math.abs(2 * l - 1));
  const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const light = Math.min(0.78, Math.max(0.62, l + 0.15));
  const sat = Math.max(s, 0.6);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const [r1, g1, b1] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue)]!;
  const m = light - c / 2;
  return `#${[r1!, g1!, b1!].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Fetches a chain's icon from the site's own assets; a chain without one gets the lettermark's slate. */
export async function chainArt(assets: AssetFetcher, selector: string): Promise<ChainArt> {
  const href = iconHref(selector);
  const res = href ? await assets.fetch(new Request(`https://ccip.dev${href}`)) : null;
  if (!href || !res?.ok) return { src: null, bg: LETTERMARK_BG, glow: INK.lane };
  const bytes = new Uint8Array(await res.arrayBuffer());
  const svg = href.endsWith('.svg');
  const bg = svg ? iconBackground(new TextDecoder().decode(bytes)) : LETTERMARK_BG;
  return { src: `data:${svg ? 'image/svg+xml' : 'image/png'};base64,${bytesToBase64(bytes)}`, bg, glow: glowColor(bg) };
}

export async function chainArts(assets: AssetFetcher, selectors: readonly string[]): Promise<Map<string, ChainArt>> {
  const unique = [...new Set(selectors)];
  return new Map(await Promise.all(unique.map(async (s) => [s, await chainArt(assets, s)] as const)));
}

export const NO_ART: ChainArt = { src: null, bg: LETTERMARK_BG, glow: INK.lane };

/** Under the icon: its glow and its background hexagon. */
export function chainHexUnder(id: string, cx: number, cy: number, r: number, art: ChainArt): { defs: string; body: string } {
  return {
    defs: `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>`,
    body: `<polygon points="${hexPoints(cx, cy, r + 6)}" fill="${art.glow}" opacity="0.6" filter="url(#${id})"/><polygon points="${hexPoints(cx, cy, r)}" fill="${art.bg}"/>`,
  };
}

/** Over the icon: its frame, doubled for a hero. */
export function chainHexFrame(cx: number, cy: number, r: number, art: ChainArt, double = false): string {
  return (
    `<polygon points="${hexPoints(cx, cy, r)}" fill="none" stroke="${art.glow}" stroke-width="2.4"/>` +
    (double
      ? `<polygon points="${hexPoints(cx, cy, r + 9)}" fill="none" stroke="${art.glow}" stroke-width="1.6" opacity="0.85"/><polygon points="${hexPoints(cx, cy, r + 16)}" fill="none" stroke="${art.glow}" stroke-width="1" opacity="0.45"/>`
      : '')
  );
}

/** The icon itself, filling the hexagon: its square fits the hexagon's width, so its corners fall outside and only its colour shows. */
export function chainHexIcon(cx: number, cy: number, r: number, art: ChainArt, name: string): VNode {
  if (art.src) return hexImage(art.src, cx, cy, r, { objectFit: 'contain' });
  return h(
    'div',
    { style: { position: 'absolute', left: px(cx - r), top: px(cy - r), width: px(2 * r), height: px(2 * r), display: 'flex', alignItems: 'center', justifyContent: 'center', ...font('Inter', 800, r * 0.9, '#ffffff') } },
    lettermarkLetter(name),
  );
}
```

Create `site/worker/linkmarine/intel-frame.ts`:

```ts
import { h, type Child, type VNode } from '../h';
import { glyph } from '../cards/glyphs';
import { at, capDay, font, hexBullet, INK, KINO_SIZE, MONO, MONTHS, px, skyLayer, utcDate as utc } from './art';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const title = (word: string) => word[0] + word.slice(1).toLowerCase();

/** "TUE 13 OCT 2026" */
export const capWeekday = (dayOrIso: string) => `${WEEKDAYS[utc(dayOrIso).getUTCDay()]} ${capDay(dayOrIso)}`;
/** "6 Jul 2023" */
export const plainDay = (dayOrIso: string) => {
  const d = utc(dayOrIso);
  return `${d.getUTCDate()} ${title(MONTHS[d.getUTCMonth()]!)} ${d.getUTCFullYear()}`;
};
/** "Thu 8 Oct" */
export const shortWeekday = (dayOrIso: string) => {
  const d = utc(dayOrIso);
  return `${title(WEEKDAYS[d.getUTCDay()]!)} ${d.getUTCDate()} ${title(MONTHS[d.getUTCMonth()]!)}`;
};
/** "10:40 UTC" */
export const clock = (iso: string) => `${utc(iso).toISOString().slice(11, 16)} UTC`;

export const BLUE_TEXT = { backgroundImage: 'linear-gradient(180deg, #ffffff, #9cc0ff 50%, #3c7bff)', backgroundClip: 'text', color: 'transparent', filter: `drop-shadow(0 ${px(2)}px ${px(14)}px #3c7bff55)` };
export const GOLD_TEXT = { backgroundImage: 'linear-gradient(180deg, #fff6cf, #f5c451 45%, #b07a12)', backgroundClip: 'text', color: 'transparent', filter: `drop-shadow(0 ${px(2)}px ${px(12)}px #f5c45144)` };

/** A card's stars, seeded by its day so they hold still within it. */
export const daySeed = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10)) / 86_400_000);

/** The intel cards' frame: the night sky with its glows and art, then the card elements, "ccip.dev" at the top right. */
export function intelFrame(seed: number, glows: Parameters<typeof skyLayer>[1], art: { body: string; defs: string }, ...children: Child[]): VNode {
  return h(
    'div',
    { style: { width: KINO_SIZE.width, height: KINO_SIZE.height, display: 'flex', position: 'relative', backgroundColor: INK.navy, fontFamily: 'Inter', color: INK.text } },
    skyLayer(seed, glows, art.body, art.defs),
    ...children,
    at(630, 23, { width: px(100), justifyContent: 'flex-end', ...font(MONO, 700, 13, INK.blue) }, 'ccip.dev'),
  );
}

export function eyebrow(left: number, top: number, text: string, extra: Child = null): VNode {
  return at(left, top, { alignItems: 'center', ...font(MONO, 700, 11, INK.muted, 0.16) }, extra, text);
}

export function caption(left: number, top: number, text: string, color: string = INK.muted, style: Record<string, unknown> = {}): VNode {
  return at(left, top, { ...font(MONO, 700, 11, color, 0.08), ...style }, text);
}

/** "AS OF 13 OCT 2026 · 11:28 UTC", bottom right. */
export function asOf(iso: string): VNode {
  return caption(430, 396, `AS OF ${capDay(iso)} · ${clock(iso)}`, INK.muted, { width: px(300), justifyContent: 'flex-end' });
}

/** Values the rows print bright; the rest of a row is soft. */
export const b = (text: string): VNode => h('span', { style: { color: INK.text, flexShrink: 0 } }, text);

/** Each piece keeps its width, so a long row runs past the column rather than losing its spaces. */
export function textRow(children: readonly Child[], style: Record<string, unknown> = {}): VNode {
  const pieces = children.map((c) => (typeof c === 'string' ? h('span', { style: { flexShrink: 0 } }, c) : c));
  return h('div', { style: { display: 'flex', alignItems: 'center', marginTop: px(7), ...font(MONO, 700, 12.5, INK.soft), whiteSpace: 'pre', ...style } }, ...pieces);
}

export function bulletRow(children: readonly Child[], style: Record<string, unknown> = {}): VNode {
  return textRow([h('div', { style: { display: 'flex', marginRight: px(8) } }, hexBullet(px(9), INK.gold)), ...children], style);
}

/** "▲ 12%" in green or "▼ 12%" in amber, to `digits` decimals; the fonts have no triangles. */
export function change(pct: number, digits: number): VNode {
  const up = pct >= 0;
  const color = up ? INK.up : INK.down;
  return h('div', { style: { display: 'flex', alignItems: 'center', color } }, glyph(up ? 'up' : 'down', px(10), color, { right: px(4) }), `${Math.abs(pct).toFixed(digits)}%`);
}

/** A lane's control point: off the middle of a→b, to its left, by `k` of its length, so lanes both ways bend apart. */
export function bend(a: { x: number; y: number }, b: { x: number; y: number }, k: number): { x: number; y: number } {
  return { x: (a.x + b.x) / 2 - (b.y - a.y) * k, y: (a.y + b.y) / 2 + (b.x - a.x) * k };
}
```

Create `site/worker/linkmarine/sitrep-card.ts`:

```ts
import { formatCount, formatDuration, formatFeeTotal, formatShare, formatUsd } from '@ccip-dev/core/format';
import type { IntelLane, SitrepCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { artLayer, at, DOT_FILTER, font, INK, MONO, onCurve, pulse, px, r1 } from './art';
import { chainHexFrame, chainHexIcon, chainHexUnder, NO_ART, type ChainArt } from './chain-hex';
import { b, bend, BLUE_TEXT, bulletRow, caption, capWeekday, change, clock, daySeed, eyebrow, intelFrame, textRow } from './intel-frame';

const RADAR = { x: 590, y: 215 };
/** Where the lanes' chains sit, busiest first, around the radar. */
export const LANE_SLOTS: readonly { x: number; y: number }[] = [
  { x: 585, y: 120 }, { x: 690, y: 215 }, { x: 520, y: 300 }, { x: 665, y: 330 }, { x: 478, y: 172 }, { x: 722, y: 110 }, { x: 600, y: 232 }, { x: 728, y: 300 },
];
const CHAIN_R = 26;
const DAY_MS = 86_400_000;

/** A projection rounded to three figures, as "~1,430" reads. */
export function roughCount(n: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, n))) - 2);
  return Math.round(n / step) * step;
}

/** The share of the UTC day gone at `iso`. */
export function dayFraction(iso: string): number {
  const t = Date.parse(iso);
  return (t - Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`)) / DAY_MS;
}

/** The lanes that fit, with each end's slot: chains take slots by the value of their lanes, the busiest first. */
export function placeLanes(lanes: readonly IntelLane[]): { lane: IntelLane; a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const weight = new Map<string, number>();
  for (const l of lanes) for (const c of [l.src, l.dst]) weight.set(c.selector, (weight.get(c.selector) ?? 0) + l.usd);
  const order = [...weight].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([s]) => s);
  const slot = new Map(order.slice(0, LANE_SLOTS.length).map((s, i) => [s, LANE_SLOTS[i]!]));
  return lanes.flatMap((lane) => {
    const a = slot.get(lane.src.selector);
    const b = slot.get(lane.dst.selector);
    return a && b ? [{ lane, a, b }] : [];
  });
}

function radarSvg(placed: ReturnType<typeof placeLanes>, arts: ReadonlyMap<string, ChainArt>, fraction: number): { under: string; over: string; defs: string; labels: { x: number; y: number; text: string }[] } {
  const rings = [60, 110, 160, 210].map((r, i) => `<circle cx="${RADAR.x}" cy="${RADAR.y}" r="${r}" fill="none" stroke="${INK.ccip}" stroke-opacity="${[0.25, 0.2, 0.14, 0.08][i]}" stroke-width="1"/>`).join('');
  const sweep = `<path d="M${RADAR.x} ${RADAR.y} L ${RADAR.x + 160} ${RADAR.y} A 160 160 0 0 0 ${RADAR.x + 113} ${RADAR.y - 113} Z" fill="url(#sweep)"/><line x1="${RADAR.x}" y1="${RADAR.y}" x2="${RADAR.x + 113}" y2="${RADAR.y - 113}" stroke="${INK.up}" stroke-opacity="0.5" stroke-width="1.2"/>`;
  const max = Math.max(1, ...placed.map((p) => p.lane.usd));
  const ctrls = placed.map((p) => bend(p.a, p.b, 0.18));
  const lanes = placed
    .map((p, i) => `<path d="M${p.a.x} ${p.a.y} Q ${r1(ctrls[i]!.x)} ${r1(ctrls[i]!.y)} ${p.b.x} ${p.b.y}" stroke="${i < 2 ? INK.gold : INK.lane}" stroke-width="${r1(1.6 + 5.4 * (p.lane.usd / max))}" fill="none" opacity="0.8" stroke-linecap="round"/>`)
    .join('');
  const mids = placed.map((p, i) => onCurve(p.a, ctrls[i]!, p.b, 0.5));
  const chains = new Map<string, { x: number; y: number }>();
  for (const p of placed) {
    chains.set(p.lane.src.selector, p.a);
    chains.set(p.lane.dst.selector, p.b);
  }
  const under = [...chains].map(([s, p], i) => chainHexUnder(`c${i}`, p.x, p.y, CHAIN_R, arts.get(s) ?? NO_ART));
  const barX = 30 + 700 * Math.min(1, Math.max(0, fraction));
  const bar = `<rect x="30" y="398" width="700" height="4" rx="2" fill="#ffffff14"/><rect x="30" y="398" width="${r1(barX - 30)}" height="4" rx="2" fill="${INK.ccip}"/><circle cx="${r1(barX)}" cy="400" r="5" fill="#fff" filter="url(#dot)"/><circle cx="${r1(barX)}" cy="400" r="3" fill="#fff"/>`;
  return {
    defs: `${DOT_FILTER}<linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${INK.up}" stop-opacity="0"/><stop offset="1" stop-color="${INK.up}" stop-opacity="0.22"/></linearGradient>${under.map((u) => u.defs).join('')}`,
    under: rings + sweep + lanes + mids.map((m) => pulse(m.x, m.y)).join('') + under.map((u) => u.body).join('') + bar,
    over: [...chains].map(([s, p]) => chainHexFrame(p.x, p.y, CHAIN_R, arts.get(s) ?? NO_ART)).join(''),
    labels: placed.slice(0, 3).map((p, i) => ({ x: mids[i]!.x, y: mids[i]!.y - 14, text: formatUsd(p.lane.usd) })),
  };
}

/** A lane's value in a dark pill above its pulse. */
export function laneLabel(x: number, y: number, text: string): VNode {
  const pill = h('div', { style: { ...font(MONO, 700, 10, INK.text), padding: `${px(2)}px ${px(6)}px`, borderRadius: px(6), backgroundColor: '#0a0f1ecc', border: '1px solid #ffffff1a' } }, text);
  return at(x - 40, y - 9, { width: px(80), height: px(18), justifyContent: 'center', alignItems: 'center' }, pill);
}

function paceRow(card: SitrepCard): VNode {
  if (!card.pace) return textRow(['early in the day'], { marginTop: px(12) });
  const rough = `~${formatCount(roughCount(card.pace.projected))}`;
  if (card.pace.yesterday === null || card.pace.yesterday <= 0) return textRow([`on pace for ${rough}`], { marginTop: px(12) });
  return textRow([change((card.pace.projected / card.pace.yesterday - 1) * 100, 0), ` on pace for ${rough} · yesterday `, b(formatCount(card.pace.yesterday))], { marginTop: px(12) });
}

/** /cciptoday: today so far, its pace against yesterday, and a radar over today's top lanes. */
export function sitrepTree(card: SitrepCard, arts: ReadonlyMap<string, ChainArt>): VNode {
  const placed = placeLanes(card.lanes.slice(0, 5));
  const radar = radarSvg(placed, arts, dayFraction(card.updatedAt));
  const chains = new Map(placed.flatMap((p) => [[p.lane.src.selector, { ...p.a, name: p.lane.src.name }], [p.lane.dst.selector, { ...p.b, name: p.lane.dst.name }]] as const));
  const live = h(
    'div',
    { style: { display: 'flex', alignItems: 'center', color: INK.live, marginRight: px(10) } },
    h('div', { style: { width: px(8), height: px(8), borderRadius: px(4), backgroundColor: '#ff4d5e', boxShadow: `0 0 ${px(10)}px #ff4d5e`, marginRight: px(6) } }),
    'LIVE',
  );
  return intelFrame(
    daySeed(card.updatedAt),
    [{ x: 608, y: 0, color: '#1d3a7a', stop: 0.55 }],
    { body: radar.under, defs: radar.defs },
    ...[...chains].map(([s, c]) => chainHexIcon(c.x, c.y, CHAIN_R, arts.get(s) ?? NO_ART, c.name)),
    artLayer(radar.over),
    eyebrow(30, 24, `SITREP · ${capWeekday(card.updatedAt)} · ${clock(card.updatedAt)}`, live),
    at(
      30,
      70,
      { flexDirection: 'column' },
      h('div', { style: { ...font('Inter', 900, 92, INK.text, -0.02), lineHeight: 0.9, ...BLUE_TEXT } }, formatCount(card.messages)),
      h('div', { style: { ...font('Inter', 700, 14, INK.sub), marginTop: px(8) } }, 'messages so far today'),
      paceRow(card),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', marginTop: px(11) } },
        bulletRow([b(formatUsd(card.usd)), ' moved']),
        bulletRow([b(formatFeeTotal(card.feesUsd)), ' in fees · ', b(formatShare(card.linkSharePct)), ' in LINK']),
        bulletRow([b(formatCount(card.senders)), ' senders · median delivery ', b(formatDuration(card.medianDeliveryS))]),
      ),
    ),
    caption(470, 58, 'TOP LANES TODAY'),
    ...radar.labels.map((l) => laneLabel(l.x, l.y, l.text)),
    caption(30, 376, '00:00'),
    caption(630, 376, '24:00 UTC', INK.muted, { width: px(100), justifyContent: 'flex-end' }),
  );
}
```

Create `site/worker/linkmarine/dossier-card.ts`:

```ts
import { formatCount, formatUsd } from '@ccip-dev/core/format';
import type { DossierCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { artLayer, at, capDay, DOT_FILTER, font, halo, INK, onCurve, pulse, px, r1 } from './art';
import { chainHexFrame, chainHexIcon, chainHexUnder, NO_ART, type ChainArt } from './chain-hex';
import { asOf, b, bend, BLUE_TEXT, bulletRow, caption, daySeed, eyebrow, intelFrame, textRow } from './intel-frame';
import { laneLabel } from './sitrep-card';

const HERO = { x: 200, y: 218, r: 66 };
/** The partners' places in orbit, the biggest first. */
export const PARTNER_SLOTS: readonly { x: number; y: number }[] = [{ x: 340, y: 92 }, { x: 62, y: 100 }, { x: 70, y: 340 }, { x: 340, y: 346 }];
const PARTNER_R = 25;
const BARS = { x: 470, step: 26, width: 16, bottom: 352, max: 44 };

/** The title shrinks with the name, so it stays on one line in the right column. */
export function titleSize(name: string): number {
  return name.length <= 7 ? 72 : name.length <= 10 ? 56 : name.length <= 14 ? 42 : 32;
}

function orbitSvg(card: DossierCard, arts: ReadonlyMap<string, ChainArt>): { under: string; over: string; defs: string; labels: { x: number; y: number; text: string }[] } {
  const hero = arts.get(card.chain.selector) ?? NO_ART;
  const ring = halo('hero', HERO.x, HERO.y, hero.glow, [{ r: 120, width: 2.5, opacity: 0.45 }, { r: 170, width: 1.8, opacity: 0.28 }, { r: 225, width: 1.2, opacity: 0.16 }, { r: 285, width: 1, opacity: 0.08 }], { r: 210, opacity: 0.28 });
  const partners = card.partners.slice(0, PARTNER_SLOTS.length).map((p, i) => ({ ...p, at: PARTNER_SLOTS[i]! }));
  const max = Math.max(1, ...partners.map((p) => p.usd));
  const lanes = partners.map((p) => ({ p, c: bend(HERO, p.at, 0.2) }));
  const mids = lanes.map(({ p, c }) => onCurve(HERO, c, p.at, 0.55));
  const unders = [chainHexUnder('hero-hex', HERO.x, HERO.y, HERO.r, hero), ...partners.map((p, i) => chainHexUnder(`p${i}`, p.at.x, p.at.y, PARTNER_R, arts.get(p.chain.selector) ?? NO_ART))];
  const bars = card.days.slice(-7);
  const top = Math.max(1, ...bars.map((d) => d.messages));
  const barSvg = bars
    .map((d, i) => {
      const height = Math.max(2, Math.round((BARS.max * d.messages) / top));
      const newest = i === bars.length - 1;
      return `<rect x="${BARS.x + BARS.step * i}" y="${BARS.bottom - height}" width="${BARS.width}" height="${height}" rx="3" fill="${newest ? INK.gold : INK.ccip}" opacity="${newest ? 1 : 0.8}"/>`;
    })
    .join('');
  return {
    defs: ring.defs + DOT_FILTER + unders.map((u) => u.defs).join(''),
    under:
      ring.body +
      lanes.map(({ p, c }) => `<path d="M${HERO.x} ${HERO.y} Q ${r1(c.x)} ${r1(c.y)} ${p.at.x} ${p.at.y}" stroke="${INK.blue}" stroke-width="${r1(2 + 3 * (p.usd / max))}" fill="none" opacity="0.8" stroke-linecap="round"/>`).join('') +
      mids.map((m) => pulse(m.x, m.y)).join('') +
      unders.map((u) => u.body).join('') +
      barSvg,
    over: chainHexFrame(HERO.x, HERO.y, HERO.r, hero, true) + partners.map((p) => chainHexFrame(p.at.x, p.at.y, PARTNER_R, arts.get(p.chain.selector) ?? NO_ART)).join(''),
    labels: partners.map((p, i) => ({ x: mids[i]!.x, y: mids[i]!.y - 13, text: formatUsd(p.usd) })),
  };
}

export function highlight(card: DossierCard): string {
  return `#${card.rank} of ${card.ranked} all time${card.feeRank === null ? '' : ` · #${card.feeRank} in fees this week`}`;
}

/** /ccipchain: one chain as the hero, its partners of the last 7 days in orbit, its all-time numbers and its week. */
export function dossierTree(card: DossierCard, arts: ReadonlyMap<string, ChainArt>): VNode {
  const orbit = orbitSvg(card, arts);
  const name = card.chain.name.toUpperCase();
  return intelFrame(
    daySeed(card.asOf),
    [{ x: 197.6, y: 214, color: '#1b3fa0', stop: 0.45 }, { x: 684, y: 0, color: '#1d3a7a', stop: 0.55 }],
    { body: orbit.under, defs: orbit.defs },
    chainHexIcon(HERO.x, HERO.y, HERO.r, arts.get(card.chain.selector) ?? NO_ART, card.chain.name),
    ...card.partners.slice(0, PARTNER_SLOTS.length).map((p, i) => chainHexIcon(PARTNER_SLOTS[i]!.x, PARTNER_SLOTS[i]!.y, PARTNER_R, arts.get(p.chain.selector) ?? NO_ART, p.chain.name)),
    artLayer(orbit.over),
    ...orbit.labels.map((l) => laneLabel(l.x, l.y, l.text)),
    eyebrow(440, 26, 'CHAIN DOSSIER · CCIP'),
    at(
      440,
      50,
      { flexDirection: 'column', width: px(290) },
      h('div', { style: { ...font('Inter', 900, titleSize(name), INK.text, -0.02), lineHeight: 0.9, ...BLUE_TEXT } }, name),
      textRow([highlight(card)], { color: INK.paleGold, marginTop: px(8) }),
      bulletRow([b(formatCount(card.messages)), ' messages · ', b(formatUsd(card.usd)), ' moved'], { marginTop: px(14) }),
      bulletRow([b(formatUsd(card.feesUsd)), ' in fees, all time']),
      bulletRow(['7 days: ', b(formatCount(card.week.messages)), ' messages · ', b(formatUsd(card.week.usd))]),
    ),
    caption(470, 364, 'LAST 7 DAYS · MESSAGES A DAY'),
    card.since ? caption(30, 396, `ON CCIP SINCE ${capDay(card.since)}`) : null,
    asOf(card.asOf),
  );
}
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-intel.test.ts`
Expected: PASS (9 tests).

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/linkmarine-sitrep.test.ts`
Expected: PASS (1 test).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add site/worker/linkmarine/chain-hex.ts site/worker/linkmarine/intel-frame.ts site/worker/linkmarine/sitrep-card.ts site/worker/linkmarine/dossier-card.ts site/test/fixtures/linkmarine.ts site/test/linkmarine-intel.test.ts site/worker/test/linkmarine-sitrep.test.ts
git commit -m "feat(site): the SITREP and chain dossier intel cards, each chain icon filling its hexagon" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: The vault, the hall of records, renderIntelCard and the visual check

The last two intel cards, the entrypoint's `renderIntelCard(kind, card)` (it fetches the chain icons a card needs from the site's own assets), and `pnpm --filter @ccip-dev/site cards:linkmarine`, which draws every tier, both glints and the four intel cards from fixtures into `site/linkmarine-cards/` for a human look before launch (spec §10).

**Files:**
- Create: `site/worker/linkmarine/vault-card.ts`, `site/worker/linkmarine/records-card.ts`, `site/worker/linkmarine/intel.ts`, `site/scripts/render-linkmarine-cards.ts`
- Modify: `site/worker/linkmarine/entrypoint.ts` (`renderIntelCard`, `implements LinkMarineRenderer`, `LinkMarineEnv`), `site/package.json` (`cards:linkmarine`), `.gitignore` (`site/linkmarine-cards/`)
- Test: `site/test/fixtures/linkmarine.ts` (`VAULT`, `RECORDS`), `site/test/linkmarine-hall.test.ts` (Node), `site/worker/test/linkmarine-intel.test.ts` (workerd)

**Interfaces:**
- Consumes: Task 1 (`type VaultCard`, `type RecordsCard`, `type RecordMedal`, `type IntelCards`, `type IntelKind`, `INTEL_KINDS`, `type LinkMarineRenderer`, `TIERS`, `hasGlint`); Task 2 (`at`, `capDay`, `font`, `halo`, `hexPoints`, `INK`, `MONO`, `px`, `r1`, `KINO_FONTS`, `renderKino`); Task 3 (`marineTree`, `memeTree`, `MEME_SIZE`, the fixtures); Task 4 (`glintGif`); Task 5 (`chainArts`, `sitrepTree`, `dossierTree`, `asOf`, `b`, `BLUE_TEXT`, `bulletRow`, `caption`, `change`, `daySeed`, `eyebrow`, `GOLD_TEXT`, `intelFrame`, `plainDay`, `shortWeekday`, `textRow`); live code `formatCompactCount`, `formatCount`, `formatPrice`, `formatShare`, `formatUsd`, `type RecordKind`, `glyph`, `render` from `@cf-wasm/og/node`.
- Produces:
  - `vault-card.ts`: `dueText(card): string | null`, `vaultTree(card: VaultCard): VNode`.
  - `records-card.ts`: `MEDAL_X`, `medalValue(m)`, `medalSize(text, raised)`, `recordsTree(card: RecordsCard): VNode`.
  - `intel.ts`: `intelSelectors(kind, card): string[]`, `intelTree(kind, card, arts): VNode` (throws "no intel card called <kind>").
  - `entrypoint.ts`: `interface LinkMarineEnv { ASSETS: AssetFetcher }`; `LinkMarineCards extends WorkerEntrypoint<LinkMarineEnv> implements LinkMarineRenderer`, adding `renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array>`.
  - `pnpm --filter @ccip-dev/site cards:linkmarine [--out DIR] [--archive PATH]`.
  - Fixtures: `VAULT`, `RECORDS`.

- [ ] **Step 1: Add the fixtures and write the failing tests.**

In `site/test/fixtures/linkmarine.ts`, replace:

```ts
import type { DossierCard, MarineCard, SitrepCard, Tier } from '@ccip-dev/core/linkmarine';

/** Text the card fonts can draw: their Latin subset. */
```

with:

```ts
import type { DossierCard, MarineCard, RecordsCard, SitrepCard, Tier, VaultCard } from '@ccip-dev/core/linkmarine';

/** Text the card fonts can draw: their Latin subset. */
```

In `site/test/fixtures/linkmarine.ts`, replace:

```ts
  since: '2023-09-16',
};
```

with:

```ts
  since: '2023-09-16',
};

export const VAULT: VaultCard = {
  asOf: '2026-10-13T11:00:55.843Z',
  link: 6204681.79,
  valueUsd: 79818684,
  priceUsd: 12.8643,
  changePct: 15.66,
  costUsd: 69008608.43,
  streak: 62,
  avgWeeklyLink: 85687.03,
  lastDeposit: { link: 82480.36, day: '2026-10-08' },
  nextDue: '2026-10-15',
  overdue: false,
  weekly: [121949.84, 123521.9, 125525.28, 119241.2, 100908.77, 123777.33, 132002.93, 148258.62, 147197.58, 143676.39, 153956.18, 151674.71, 146110.67, 138306.29, 135168.33, 135549.02, 139956.08, 127744.15, 103041.41, 91988.7, 97110.77, 91115.63, 97459.26, 88105.46, 74703.04, 82480.36],
  milestone: { link: 7000000, eta: '2026-12-17' },
};

export const RECORDS: RecordsCard = {
  asOf: '2026-10-13T06:01:00.177Z',
  medals: [
    { kind: 'messages', value: 47414, day: '2026-02-22', lane: null },
    { kind: 'value', value: 330226186.84, day: '2026-04-20', lane: null },
    { kind: 'fees', value: 57347.81, day: '2026-07-09', lane: null },
    { kind: 'largest_fee', value: 9002.29, day: '2025-08-19', lane: { src: 'WEMIX', dst: 'Ethereum' } },
    { kind: 'link_share', value: 100, day: '2023-07-08', lane: null },
  ],
  newest: 'fees',
  messages: 1578970,
  usd: 24320486693.239994,
  since: '2023-07-06',
};
```

Create `site/test/linkmarine-hall.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { medalSize, recordsTree } from '../worker/linkmarine/records-card';
import { dueText, vaultTree } from '../worker/linkmarine/vault-card';
import { texts } from './fixtures/broadcast';
import { DRAWABLE_TEXT, RECORDS, VAULT } from './fixtures/linkmarine';


describe('the vault card', () => {
  it('shows the LINK held, its gain on cost, the streak, the last and next deposits and the milestone', () => {
    // #when
    const words = texts(vaultTree(VAULT));
    // #then
    expect(words).toEqual(
      expect.arrayContaining([
        'CHAINLINK RESERVE', '6,204,682', 'LINK held', '$79.8M', ' at $12.86', '15.7%', ' on its $69.0M cost', '62', '-week deposit streak · ~', '85.7K', ' a week',
        'last ', '82,480 LINK', ' on Thu 8 Oct', 'next one due ~Thu 15 Oct', 'LINK DEPOSITED A WEEK · LAST 6 MONTHS', '7,000,000 LINK ETA 17 DEC 2026', 'AS OF 13 OCT 2026 · 11:00 UTC',
      ]),
    );
  });

  it('says when a deposit is overdue, and nothing when none is expected', () => {
    // #then
    expect([dueText({ ...VAULT, overdue: true }), dueText({ ...VAULT, nextDue: null })]).toEqual(['overdue since Thu 15 Oct', null]);
  });
});

describe('the hall of records card', () => {
  it('shows the five all-time records with their days, the newest raised, and the all-time totals', () => {
    // #when
    const words = texts(recordsTree(RECORDS));
    // #then
    expect({
      words,
      newest: words.filter((w) => w === 'NEWEST').length,
    }).toEqual({
      words: expect.arrayContaining([
        'HALL OF RECORDS · CCIP ALL TIME', '47,414', 'MESSAGES', 'IN ONE DAY', '22 FEB 2026', '$330.2M', 'MOVED', '20 APR 2026', '$57.3K', 'IN FEES', '9 JUL 2026',
        '$9.0K', 'ONE FEE', 'WEMIX', 'ETHEREUM', '19 AUG 2025', '100%', 'PAID IN LINK', '8 JUL 2023', '1,578,970 messages · ', '$24.3B', ' moved since 6 Jul 2023', 'AS OF 13 OCT 2026 · 06:01 UTC',
      ]),
      newest: 1,
    });
  });

  it('shrinks a long value to stay inside its medal, the raised one a little larger', () => {
    // #then
    expect(['47,414', '$57.3K', '$330.2M'].flatMap((v) => [medalSize(v, false), medalSize(v, true)])).toEqual([20, 24, 20, 24, 16, 20]);
  });

  it('writes no character the card fonts lack', () => {
    // #when
    const words = [...texts(vaultTree(VAULT)), ...texts(recordsTree(RECORDS))];
    // #then
    expect(words.filter((w) => !DRAWABLE_TEXT.test(w))).toEqual([]);
  });
});
```

Create `site/worker/test/linkmarine-intel.test.ts`:

```ts
import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DOSSIER, RECORDS, SITREP, VAULT } from '../../test/fixtures/linkmarine';
import { LinkMarineCards } from '../linkmarine/entrypoint';

const assets = { fetch: async () => new Response('missing', { status: 404 }) };
const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];

describe('the LinkMarineCards entrypoint: intel cards', () => {
  it('renders each of the four intel cards at 1200×675', async () => {
    // #given the bot's view of the entrypoint
    const cards: LinkMarineRenderer = new LinkMarineCards(createExecutionContext(), { ASSETS: assets });
    // #when
    const pngs = await Promise.all([cards.renderIntelCard('sitrep', SITREP), cards.renderIntelCard('dossier', DOSSIER), cards.renderIntelCard('vault', VAULT), cards.renderIntelCard('records', RECORDS)]);
    // #then
    expect(pngs.map(size)).toEqual([[1200, 675], [1200, 675], [1200, 675], [1200, 675]]);
  });

  it('throws on a kind it does not draw, so the bot reports it instead of posting', async () => {
    // #given
    const cards = new LinkMarineCards(createExecutionContext(), { ASSETS: assets });
    // #then
    await expect(cards.renderIntelCard('weather' as never, SITREP as never)).rejects.toThrow('no intel card called weather');
  });
});
```

- [ ] **Step 2: Run the Node test and confirm it fails.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/linkmarine-hall.test.ts`
Expected: FAIL: `../worker/linkmarine/records-card` does not exist.

- [ ] **Step 3: Add the two cards, the dispatcher and renderIntelCard.**

Create `site/worker/linkmarine/vault-card.ts`:

```ts
import { formatCompactCount, formatCount, formatPrice, formatUsd } from '@ccip-dev/core/format';
import type { VaultCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { at, capDay, font, halo, hexPoints, INK, px, r1 } from './art';
import { asOf, b, bulletRow, caption, change, daySeed, eyebrow, GOLD_TEXT, intelFrame, shortWeekday, textRow } from './intel-frame';

const VAULT = { x: 190, y: 214 };
const BARS = { x: 440, step: 11.2, width: 7.5, bottom: 356, max: 52 };
const VAULT_DEFS =
  '<linearGradient id="vg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6cf"/><stop offset=".4" stop-color="#f5c451"/><stop offset="1" stop-color="#7d570f"/></linearGradient>' +
  '<filter id="vb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>';


function vaultSvg(card: VaultCard): { body: string; defs: string } {
  const ring = halo('vault', VAULT.x, VAULT.y, INK.gold, [{ r: 150, width: 1.4, opacity: 0.25 }, { r: 205, width: 1, opacity: 0.14 }, { r: 265, width: 1, opacity: 0.07 }], { r: 210, opacity: 0.28 });
  const bolts = hexPoints(VAULT.x, VAULT.y, 112)
    .split(' ')
    .map((p) => p.split(','))
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="url(#vg)" stroke="#5a3d08" stroke-width="1.5"/>`)
    .join('');
  const door = [
    `<polygon points="${hexPoints(VAULT.x, VAULT.y, 118)}" fill="${INK.gold}" opacity=".35" filter="url(#vb)"/>`,
    `<polygon points="${hexPoints(VAULT.x, VAULT.y, 112)}" fill="#151b2e" stroke="url(#vg)" stroke-width="10"/>`,
    `<polygon points="${hexPoints(VAULT.x, VAULT.y, 88)}" fill="none" stroke="#f5c45188" stroke-width="2" stroke-dasharray="4 6"/>`,
    bolts,
    `<polygon points="${hexPoints(VAULT.x, VAULT.y, 50)}" fill="none" stroke="#375bd2" stroke-width="15" stroke-linejoin="round"/>`,
    `<polygon points="${hexPoints(VAULT.x, VAULT.y, 50)}" fill="none" stroke="#6c8cff" stroke-width="3" opacity=".6"/>`,
  ].join('');
  const weeks = card.weekly.slice(-26);
  const max = Math.max(1, ...weeks);
  const bars = weeks
    .map((link, i) => {
      const height = Math.max(2, Math.round((BARS.max * link) / max));
      const latest = i === weeks.length - 1;
      return `<rect x="${r1(BARS.x + BARS.step * i)}" y="${BARS.bottom - height}" width="${BARS.width}" height="${height}" rx="2" fill="${latest ? INK.cream : INK.gold}" opacity="${latest ? 1 : 0.7}"/>`;
    })
    .join('');
  return { body: ring.body + door + bars, defs: ring.defs + VAULT_DEFS };
}

export function dueText(card: VaultCard): string | null {
  if (!card.nextDue) return null;
  return card.overdue ? `overdue since ${shortWeekday(card.nextDue)}` : `next one due ~${shortWeekday(card.nextDue)}`;
}

/** /linkreserve: the vault door around the Chainlink mark, the LINK held, its gain on cost, the deposit streak and six months of deposits. */
export function vaultTree(card: VaultCard): VNode {
  const art = vaultSvg(card);
  const due = dueText(card);
  return intelFrame(
    daySeed(card.asOf),
    [{ x: 190, y: 214, color: '#3a2a08', stop: 0.45 }, { x: 684, y: 0, color: '#1d3a7a', stop: 0.55 }],
    art,
    eyebrow(440, 26, 'CHAINLINK RESERVE'),
    at(
      440,
      50,
      { flexDirection: 'column', width: px(290) },
      h('div', { style: { ...font('Inter', 900, 52, INK.text, -0.02), lineHeight: 0.9, ...GOLD_TEXT } }, formatCount(card.link)),
      h(
        'div',
        { style: { display: 'flex', ...font('Inter', 700, 14, INK.sub), marginTop: px(6), whiteSpace: 'pre' } },
        'LINK held',
        ...(card.valueUsd === null ? [] : [' · ', b(formatUsd(card.valueUsd)), ...(card.priceUsd === null ? [] : [` at ${formatPrice(card.priceUsd)}`])]),
      ),
      card.changePct === null || card.costUsd === null ? null : textRow([change(card.changePct, 1), ` on its ${formatUsd(card.costUsd)} cost`], { marginTop: px(10) }),
      bulletRow([b(formatCount(card.streak)), `-week deposit streak${card.avgWeeklyLink === null ? '' : ' · ~'}`, card.avgWeeklyLink === null ? null : b(formatCompactCount(card.avgWeeklyLink)), card.avgWeeklyLink === null ? null : ' a week']),
      card.lastDeposit ? bulletRow(['last ', b(`${formatCount(card.lastDeposit.link)} LINK`), ` on ${shortWeekday(card.lastDeposit.day)}`]) : null,
      due ? bulletRow([due], card.overdue ? { color: INK.down } : {}) : null,
    ),
    caption(440, 366, 'LINK DEPOSITED A WEEK · LAST 6 MONTHS'),
    card.milestone ? caption(30, 396, `${formatCount(card.milestone.link)} LINK ETA ${capDay(card.milestone.eta)}`, INK.paleGold) : null,
    asOf(card.asOf),
  );
}
```

Create `site/worker/linkmarine/records-card.ts`:

```ts
import { formatCount, formatShare, formatUsd } from '@ccip-dev/core/format';
import type { RecordMedal, RecordsCard } from '@ccip-dev/core/linkmarine';
import type { RecordKind } from '@ccip-dev/core/records';
import { glyph } from '../cards/glyphs';
import { h, type Child, type VNode } from '../h';
import { at, capDay, font, halo, hexPoints, INK, MONO, px } from './art';
import { asOf, b, BLUE_TEXT, daySeed, eyebrow, GOLD_TEXT, intelFrame, plainDay } from './intel-frame';

/** Medal centres left to right, in the Records page's order. */
export const MEDAL_X = [96, 238, 380, 522, 664];
const MEDAL = { y: 196, r: 54 };
const RAISED = { y: 178, r: 62 };
const MEDAL_DEFS =
  '<linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6cf"/><stop offset=".4" stop-color="#f5c451"/><stop offset="1" stop-color="#7d570f"/></linearGradient>' +
  '<filter id="mb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>';

const LABELS: Readonly<Record<RecordKind, string>> = { messages: 'MESSAGES', value: 'MOVED', fees: 'IN FEES', largest_fee: 'ONE FEE', link_share: 'PAID IN LINK' };

export function medalValue(m: RecordMedal): string {
  if (m.kind === 'messages') return formatCount(m.value);
  if (m.kind === 'link_share') return formatShare(m.value);
  return formatUsd(m.value);
}

/** The value shrinks with its length, so it stays inside the hexagon. */
export function medalSize(text: string, raised: boolean): number {
  const base = text.length <= 5 ? 21 : text.length <= 6 ? 20 : 16;
  return raised ? base + 4 : base;
}

function medalsSvg(card: RecordsCard): { body: string; defs: string } {
  const ring = halo('hall', 380, 200, INK.gold, [{ r: 170, width: 1.6, opacity: 0.25 }, { r: 230, width: 1.1, opacity: 0.14 }, { r: 300, width: 1, opacity: 0.07 }], { r: 210, opacity: 0.28 });
  const medals = card.medals
    .map((m, i) => {
      const x = MEDAL_X[i]!;
      if (m.kind === card.newest) {
        return (
          `<polygon points="${hexPoints(x, RAISED.y, RAISED.r + 10)}" fill="${INK.gold}" opacity=".55" filter="url(#mb)"/>` +
          `<polygon points="${hexPoints(x, RAISED.y, RAISED.r)}" fill="#141a2c" stroke="url(#mg)" stroke-width="5"/>` +
          `<polygon points="${hexPoints(x, RAISED.y, RAISED.r - 9)}" fill="none" stroke="#f5c45155" stroke-width="1.2"/>`
        );
      }
      return `<polygon points="${hexPoints(x, MEDAL.y, MEDAL.r)}" fill="#141a2c" stroke="url(#mg)" stroke-width="3.5"/><polygon points="${hexPoints(x, MEDAL.y, MEDAL.r - 9)}" fill="none" stroke="#f5c45155" stroke-width="1.2"/>`;
    })
    .join('');
  return { body: ring.body + medals, defs: ring.defs + MEDAL_DEFS };
}

function sub(m: RecordMedal): Child[] {
  if (m.kind !== 'largest_fee' || !m.lane) return ['IN ONE DAY'];
  return [m.lane.src.toUpperCase(), glyph('right', px(8), INK.muted, { left: px(3), right: px(3) }), m.lane.dst.toUpperCase()];
}

function medalText(m: RecordMedal, x: number, raised: boolean): VNode[] {
  const value = medalValue(m);
  const line = (children: Child[], color: string, top: number) => h('div', { style: { display: 'flex', alignItems: 'center', ...font(MONO, 700, 10, color, 0.1), marginTop: px(top) } }, ...children);
  const badge = h('div', { style: { ...font(MONO, 800, 9, '#10131a', 0.14), backgroundImage: 'linear-gradient(135deg, #f5c451, #fff6cf)', padding: `${px(2)}px ${px(7)}px`, borderRadius: px(999), marginBottom: px(5) } }, 'NEWEST');
  const number = h('div', { style: { ...font('Inter', 900, medalSize(value, raised), INK.text), lineHeight: 1, ...(raised ? GOLD_TEXT : BLUE_TEXT) } }, value);
  return [
    at(x - 70, (raised ? RAISED.y : MEDAL.y) - 14, { width: px(140), justifyContent: 'center' }, number),
    at(
      x - 70,
      raised ? 252 : 262,
      { width: px(140), flexDirection: 'column', alignItems: 'center' },
      raised ? badge : null,
      line([LABELS[m.kind]], INK.soft, 0),
      line(sub(m), INK.muted, 3),
      line([capDay(m.day)], INK.paleGold, 3),
    ),
  ];
}

/** /cciprecords: the five all-time records as gold-framed hex medals, the newest raised. */
export function recordsTree(card: RecordsCard): VNode {
  const art = medalsSvg(card);
  return intelFrame(
    daySeed(card.asOf),
    [{ x: 608, y: 0, color: '#1d3a7a', stop: 0.55 }],
    art,
    eyebrow(30, 26, 'HALL OF RECORDS · CCIP ALL TIME'),
    ...card.medals.flatMap((m, i) => medalText(m, MEDAL_X[i]!, m.kind === card.newest)),
    at(30, 384, { ...font(MONO, 700, 14, INK.soft), whiteSpace: 'pre' }, `${formatCount(card.messages)} messages · `, b(formatUsd(card.usd)), ` moved${card.since ? ` since ${plainDay(card.since)}` : ''}`),
    asOf(card.asOf),
  );
}
```

Create `site/worker/linkmarine/intel.ts`:

```ts
import type { IntelCards, IntelKind } from '@ccip-dev/core/linkmarine';
import type { VNode } from '../h';
import type { ChainArt } from './chain-hex';
import { dossierTree } from './dossier-card';
import { recordsTree } from './records-card';
import { sitrepTree } from './sitrep-card';
import { vaultTree } from './vault-card';

/** The chains whose icons a card draws. */
export function intelSelectors<K extends IntelKind>(kind: K, card: IntelCards[K]): string[] {
  if (kind === 'sitrep') return (card as IntelCards['sitrep']).lanes.flatMap((l) => [l.src.selector, l.dst.selector]);
  if (kind === 'dossier') {
    const d = card as IntelCards['dossier'];
    return [d.chain.selector, ...d.partners.map((p) => p.chain.selector)];
  }
  return [];
}

export function intelTree<K extends IntelKind>(kind: K, card: IntelCards[K], arts: ReadonlyMap<string, ChainArt>): VNode {
  switch (kind) {
    case 'sitrep':
      return sitrepTree(card as IntelCards['sitrep'], arts);
    case 'dossier':
      return dossierTree(card as IntelCards['dossier'], arts);
    case 'vault':
      return vaultTree(card as IntelCards['vault']);
    case 'records':
      return recordsTree(card as IntelCards['records']);
    default:
      throw new Error(`no intel card called ${String(kind)}`);
  }
}
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import { hasGlint, type MarineCard } from '@ccip-dev/core/linkmarine';
import { glintGif } from './glint';
import { marineTree } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
import { renderKino } from './render';

/**
```

with:

```ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import { hasGlint, type IntelCards, type IntelKind, type LinkMarineRenderer, type MarineCard } from '@ccip-dev/core/linkmarine';
import type { AssetFetcher } from '../cards/coin-icons';
import { chainArts } from './chain-hex';
import { glintGif } from './glint';
import { intelSelectors, intelTree } from './intel';
import { marineTree } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
import { renderKino } from './render';

export interface LinkMarineEnv {
  ASSETS: AssetFetcher;
}

/**
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
 * bytes, and throws when a card cannot be drawn, so the bot never posts a half-drawn one.
 */
export class LinkMarineCards extends WorkerEntrypoint {
  async prepareMeme(image: Uint8Array): Promise<Uint8Array> {
    return (await renderKino(memeTree(image), { width: MEME_SIZE, height: MEME_SIZE })).png;
```

with:

```ts
 * bytes, and throws when a card cannot be drawn, so the bot never posts a half-drawn one.
 */
export class LinkMarineCards extends WorkerEntrypoint<LinkMarineEnv> implements LinkMarineRenderer {
  async prepareMeme(image: Uint8Array): Promise<Uint8Array> {
    return (await renderKino(memeTree(image), { width: MEME_SIZE, height: MEME_SIZE })).png;
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
    return glintGif(rendered.pixels, rendered.width, rendered.height);
  }
}
```

with:

```ts
    return glintGif(rendered.pixels, rendered.width, rendered.height);
  }

  async renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array> {
    const arts = await chainArts(this.env.ASSETS, intelSelectors(kind, card));
    return (await renderKino(intelTree(kind, card, arts))).png;
  }
}
```

- [ ] **Step 4: Add the visual check.**

Create `site/scripts/render-linkmarine-cards.ts`:

```ts
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { render } from '@cf-wasm/og/node';
import { hasGlint, INTEL_KINDS, TIERS, type IntelCards, type IntelKind } from '@ccip-dev/core/linkmarine';
import { DOSSIER, marine, RECORDS, SITREP, VAULT } from '../test/fixtures/linkmarine';
import type { VNode } from '../worker/h';
import { chainArts } from '../worker/linkmarine/chain-hex';
import { KINO_FONTS } from '../worker/linkmarine/fonts';
import { glintGif } from '../worker/linkmarine/glint';
import { intelSelectors, intelTree } from '../worker/linkmarine/intel';
import { marineTree } from '../worker/linkmarine/marine-card';
import { MEME_SIZE, memeTree } from '../worker/linkmarine/meme';

/**
 * `pnpm --filter @ccip-dev/site cards:linkmarine [--out DIR] [--archive ../chainlinkmeme]`: draws every tier of the dog
 * tag card (and the glint of Rare and Legendary) and the four intel cards from fixtures, for a human look before launch.
 * With the chainlinkmeme checkout the tags carry the mockup's three real memes; without it, plain swatches.
 */
const site = join(import.meta.dirname, '..');
const { values } = parseArgs({ options: { out: { type: 'string', default: join(site, 'linkmarine-cards') }, archive: { type: 'string', default: join(site, '..', '..', 'chainlinkmeme') } } });
const out = resolve(values.out);
/** The mockup's memes: painting, space and prophecy. */
const MOCKUP_MEMES = ['a3ccf753ffd27a408d0d5d974faecf2f.jpeg', 'e572d111223722c3d6cce9d52b90f45e.jpeg', 'aabd55f53e8aea9de4665be183d5bb7d.jpeg'];
const SWATCHES = ['#c0392b', '#1f6fb2', '#7d3c98'];

const draw = async (tree: VNode, width = 1200, height = 675) => render(tree as never, { width, height, fonts: KINO_FONTS, loadAdditionalAsset: async () => [] }).asPng();
const swatch = (color: string) => ({ type: 'div', props: { style: { width: MEME_SIZE, height: MEME_SIZE, display: 'flex', backgroundImage: `linear-gradient(135deg, ${color}, #f4f7fb)` } } }) as VNode;

async function memes(): Promise<Uint8Array[]> {
  const dir = join(resolve(values.archive), 'memes');
  if (MOCKUP_MEMES.every((f) => existsSync(join(dir, f)))) {
    return Promise.all(MOCKUP_MEMES.map(async (f) => (await draw(memeTree(new Uint8Array(await readFile(join(dir, f)))), MEME_SIZE, MEME_SIZE)).image));
  }
  console.warn(`no chainlinkmeme checkout at ${values.archive}: drawing swatches for the memes`);
  return Promise.all(SWATCHES.map(async (c) => (await draw(swatch(c), MEME_SIZE, MEME_SIZE)).image));
}

const assets = { fetch: async (request: Request | string) => {
  const path = join(site, 'public', new URL(typeof request === 'string' ? request : request.url).pathname);
  return existsSync(path) ? new Response(await readFile(path)) : new Response('missing', { status: 404 });
} };

await mkdir(out, { recursive: true });
const pngs = await memes();
for (const tier of TIERS) {
  const card = marine(tier, pngs);
  const rendered = await draw(marineTree(card));
  await writeFile(join(out, `marine-${tier}.png`), rendered.image);
  if (hasGlint(tier)) await writeFile(join(out, `marine-${tier}.gif`), glintGif(new Uint8Array(rendered.pixels), rendered.width, rendered.height));
}
const intel: IntelCards = { sitrep: SITREP, dossier: DOSSIER, vault: VAULT, records: RECORDS };
for (const kind of INTEL_KINDS) {
  const card = intel[kind as IntelKind];
  const arts = await chainArts(assets, intelSelectors(kind, card as never));
  await writeFile(join(out, `intel-${kind}.png`), (await draw(intelTree(kind, card as never, arts))).image);
}
console.log(`wrote ${TIERS.length} dog tag cards, their glints and ${INTEL_KINDS.length} intel cards to ${out}`);
```

In `site/package.json`, replace:

```json
    "test": "vitest run && vitest run -c vitest.worker.config.ts",
    "typecheck": "tsc --noEmit && tsc --noEmit -p worker",
    "cards:static": "tsx scripts/render-static-cards.ts",
    "fonts:embed": "tsx scripts/embed-fonts.ts",
```

with:

```json
    "test": "vitest run && vitest run -c vitest.worker.config.ts",
    "typecheck": "tsc --noEmit && tsc --noEmit -p worker",
    "cards:linkmarine": "tsx scripts/render-linkmarine-cards.ts",
    "cards:static": "tsx scripts/render-static-cards.ts",
    "fonts:embed": "tsx scripts/embed-fonts.ts",
```

In `.gitignore`, replace:

```
site/.astro/
site/.icons-review.html
```

with:

```
site/.astro/
site/.icons-review.html
site/linkmarine-cards/
```

- [ ] **Step 5: Run the site's tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site test`
Expected: PASS: every Node test (the 5 new ones included) and every workerd test (21 in all).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Look at every card.**

With the chainlinkmeme checkout beside this repository, the dog tags carry the mockup's three real memes; without it, plain swatches (pass `--archive <path>` from a worktree elsewhere).

Run: `pnpm --filter @ccip-dev/site cards:linkmarine`
Expected: `wrote 4 dog tag cards, their glints and 4 intel cards to …/site/linkmarine-cards` (about 30 s). Open `marine-*.png` beside `dog-tag-card.html` and `intel-*.png` beside `intel-cards.html`, and play `marine-rare.gif` and `marine-legendary.gif`: layout, palette and effects as the mockups, at 1200×675.

- [ ] **Step 7: Commit.**

```bash
git add site/worker/linkmarine/vault-card.ts site/worker/linkmarine/records-card.ts site/worker/linkmarine/intel.ts site/worker/linkmarine/entrypoint.ts site/scripts/render-linkmarine-cards.ts site/package.json .gitignore site/test/fixtures/linkmarine.ts site/test/linkmarine-hall.test.ts site/worker/test/linkmarine-intel.test.ts
git commit -m "feat(site): the vault and hall of records cards, renderIntelCard, and pnpm cards:linkmarine for a look at every card" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 7: The discord Worker: signatures, PING and the router

A new workspace package, `@ccip-dev/discord`, the Worker `ccip-dev-discord`. It answers only `POST /interactions`: 401 without a valid Ed25519 signature (no alert), PONG to a PING, nothing to a server other than LinkMarine's, and a deferred reply to a command, whose work runs in `ctx.waitUntil`. The commands themselves arrive in Tasks 11 and 13; until then the router has none. Its tests run in workerd with real D1 and R2, and a stand-in for the site's entrypoint behind the `SITE` binding.

**Files:**
- Modify: `pnpm-workspace.yaml` (`discord`), `pnpm-lock.yaml` (`pnpm install`)
- Create: `discord/package.json`, `discord/tsconfig.json`, `discord/wrangler.toml`, `discord/vitest.config.ts`, `discord/migrations/0001_marines.sql`
- Create: `discord/src/env.ts`, `discord/src/verify.ts`, `discord/src/interactions.ts`, `discord/src/index.ts`
- Test: `discord/test/apply-migrations.ts`, `discord/test/env.d.ts`, `discord/test/site-stub.js`, `discord/test/helpers.ts`, `discord/test/verify.test.ts`, `discord/test/interactions.test.ts`, `discord/test/index.test.ts`

**Interfaces:**
- Consumes: Task 1 (`type LinkMarineRenderer`); `@cloudflare/vitest-plugin` (`cloudflareTest`, `readD1Migrations`, `applyD1Migrations`), `cloudflare:workers` (`env`, `WorkerEntrypoint`).
- Produces:
  - `env.ts`: `interface Env { DB: D1Database; MARINES: R2Bucket; SITE: LinkMarineRenderer; DISCORD_GUILD_ID: string; DISCORD_PUBLIC_KEY?; DISCORD_APPLICATION_ID?; TELEGRAM_BOT_TOKEN?; TELEGRAM_ALERT_CHAT_ID? }`.
  - `verify.ts`: `verifyDiscordRequest(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string): Promise<boolean>`.
  - `interactions.ts`: `InteractionType` (`PING`, `APPLICATION_COMMAND`, `APPLICATION_COMMAND_AUTOCOMPLETE`), `ResponseType` (`PONG`, `CHANNEL_MESSAGE_WITH_SOURCE`, `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`, `APPLICATION_COMMAND_AUTOCOMPLETE_RESULT`), `EPHEMERAL` (64), `interface DiscordUser { id; username; global_name?; avatar? }`, `interface DiscordMember { user?; nick?; avatar? }`, `interface CommandOption { name; type; value?; focused? }`, `interface Interaction { id; type; token; application_id; guild_id?; member?; user?; data?: { name; options?; resolved?: { users?; members? } } }`, `json(body, status?)`, `privateReply(content)` (type 4, flags 64, no mentions), `deferred()` (type 5), `optionValue(interaction, name): string | null`, `invoker(interaction): { user; member } | null`, `displayName(user, member): string`, `avatarUrl(user, member, guildId): string`.
  - `index.ts`: `ONLY_HERE`, `interface Handlers { commands: Readonly<Record<string, (interaction: Interaction) => Promise<void>>>; autocomplete(interaction): Promise<{ name: string; value: string }[]> }`, `handleInteraction(interaction, guildId, handlers, waitUntil): Promise<Response>`, `NO_HANDLERS` (until Task 11), and the default export's `fetch`.
  - `test/helpers.ts`: `GUILD`, `APP`, `command(name, options?, extra?): Interaction`.

- [ ] **Step 1: Add the package and write the failing tests.**

In `pnpm-workspace.yaml`, replace:

```yaml
  - worker
  - site
```

with:

```yaml
  - worker
  - site
  - discord
```

Create `discord/package.json`:

```json
{
  "name": "@ccip-dev/discord",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@ccip-dev/core": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "^1.3.6",
    "@cloudflare/workers-types": "^5.20261005.1",
    "typescript": "^7.0.2",
    "vitest": "^4.1.11",
    "wrangler": "^4.147.0"
  }
}
```

Create `discord/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-plugin/types"]
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

The database id is a placeholder until the owner creates the database (Task 14's runbook); `DISCORD_GUILD_ID` stays empty until the owner fills it, and while it is empty every command is turned away.

Create `discord/wrangler.toml`:

```toml
name = "ccip-dev-discord"
main = "src/index.ts"
compatibility_date = "2026-10-01"
workers_dev = false
routes = [{ pattern = "discord.ccip.dev", custom_domain = true }]

[[d1_databases]]
binding = "DB"
database_name = "ccip-dev-marines"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "MARINES"
bucket_name = "ccip-dev-marines"

[[services]]
binding = "SITE"
service = "ccip-dev-site"
entrypoint = "LinkMarineCards"

[vars]
DISCORD_GUILD_ID = ""

[observability]
enabled = true
```

Create `discord/vitest.config.ts`:

```ts
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')) },
        // The SITE binding's target: a stand-in for the site Worker's LinkMarineCards entrypoint.
        workers: [{ name: 'ccip-dev-site', modules: true, compatibilityDate: '2026-10-01', scriptPath: path.join(import.meta.dirname, 'test/site-stub.js') }],
      },
    })),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
});
```

Create `discord/migrations/0001_marines.sql`:

```sql
CREATE TABLE marines (
  serial INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  user_id TEXT NOT NULL,
  callsign TEXT NOT NULL,
  tag_key TEXT NOT NULL UNIQUE,
  tags TEXT NOT NULL,
  tier TEXT NOT NULL,
  score REAL NOT NULL,
  percentile REAL NOT NULL,
  memes TEXT NOT NULL,
  blood TEXT NOT NULL,
  faith TEXT NOT NULL,
  display_name TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL,
  enlisted_at TEXT NOT NULL,
  card_key TEXT,
  UNIQUE (platform, user_id)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Create `discord/test/apply-migrations.ts`:

```ts
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

Create `discord/test/env.d.ts`:

```ts
import type { D1Migration } from 'cloudflare:test';
import type { Env as BotEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends BotEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
```

Create `discord/test/site-stub.js`:

```js
// The site Worker as the bot's tests see it: its LinkMarineCards entrypoint, answering with marker bytes.
import { WorkerEntrypoint } from 'cloudflare:workers';

export const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
export const GIF = [71, 73, 70, 56, 57, 97];

export class LinkMarineCards extends WorkerEntrypoint {
  async prepareMeme() {
    return new Uint8Array(PNG);
  }

  async renderMarineCard() {
    return new Uint8Array(PNG);
  }

  async renderMarineGlint(card) {
    return card.tier === 'rare' || card.tier === 'legendary' ? new Uint8Array(GIF) : null;
  }

  async renderIntelCard() {
    return new Uint8Array(PNG);
  }
}

export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
};
```

Create `discord/test/helpers.ts`:

```ts
import type { CommandOption, Interaction } from '../src/interactions';

export const GUILD = '1100000000000000001';
export const APP = '1200000000000000002';

/** A slash command run in the LinkMarine server by momentmaker. */
export function command(name: string, options: CommandOption[] = [], extra: Partial<Interaction> = {}): Interaction {
  return {
    id: '1300000000000000003',
    type: 2,
    token: 'tok',
    application_id: APP,
    guild_id: GUILD,
    member: { user: { id: '1400000000000000004', username: 'momentmaker', global_name: 'moment maker', avatar: 'abc' }, nick: null, avatar: null },
    data: { name, options },
    ...extra,
  };
}
```

Create `discord/test/verify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { verifyDiscordRequest } from '../src/verify';

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('signature check', () => {
  it('accepts what the key signed and nothing else', async () => {
    // #given
    const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = toHex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    const sign = async (text: string) => toHex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(text)));
    const body = '{"type":1}';
    const signature = await sign(`1700000000${body}`);
    // #when
    const checks = await Promise.all([
      verifyDiscordRequest(publicKey, signature, '1700000000', body),
      verifyDiscordRequest(publicKey, signature, '1700000001', body),
      verifyDiscordRequest(publicKey, signature, '1700000000', '{"type":2}'),
      verifyDiscordRequest(publicKey, null, '1700000000', body),
      verifyDiscordRequest(publicKey, signature, null, body),
      verifyDiscordRequest(publicKey, 'zz', '1700000000', body),
      verifyDiscordRequest('00', signature, '1700000000', body),
    ]);
    // #then
    expect(checks).toEqual([true, false, false, false, false, false, false]);
  });
});
```

Create `discord/test/interactions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { avatarUrl, displayName, invoker, optionValue } from '../src/interactions';
import { command } from './helpers';

const user = { id: '80351110224678912', username: 'nelly', global_name: 'Nelly', avatar: '8342729096ea3675442027381ff50dfe' };

describe('the interaction helpers', () => {
  it("names a member as the server shows them: nickname, then global name, then username", () => {
    // #then
    expect([displayName(user, { nick: 'Sgt Nelly' }), displayName(user, { nick: null }), displayName({ ...user, global_name: null }, null)]).toEqual(['Sgt Nelly', 'Nelly', 'nelly']);
  });

  it("finds the avatar: the server's, the account's, else Discord's default for the id", () => {
    // #then the default index is (id >> 22) % 6
    expect([avatarUrl(user, { avatar: 'a_1' }, '41771983423143937'), avatarUrl(user, null, '41771983423143937'), avatarUrl({ ...user, avatar: null }, null, undefined)]).toEqual([
      'https://cdn.discordapp.com/guilds/41771983423143937/users/80351110224678912/avatars/a_1.png?size=128',
      'https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png?size=128',
      `https://cdn.discordapp.com/embed/avatars/${Number((80351110224678912n >> 22n) % 6n)}.png`,
    ]);
  });

  it('reads an option and who ran the command, in a server or a DM', () => {
    // #given
    const dm = { ...command('dogtag'), member: undefined, user };
    // #then
    expect([optionValue(command('ccipchain', [{ name: 'chain', type: 3, value: 'base' }]), 'chain'), optionValue(command('dogtag'), 'marine'), invoker(dm)?.user.id, invoker(command('enlist'))?.member?.nick]).toEqual(['base', null, '80351110224678912', null]);
  });
});
```

Create `discord/test/index.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { handleInteraction, ONLY_HERE, type Handlers } from '../src/index';
import { command, GUILD } from './helpers';

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function signedRequest(body: string, sign = true): Promise<{ request: Request; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const timestamp = '1791892245';
  const signature = toHex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(timestamp + body)));
  const headers: Record<string, string> = sign ? { 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp } : {};
  return { request: new Request('https://discord.ccip.dev/interactions', { method: 'POST', body, headers }), publicKey: toHex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
/** The Worker's fetch, with a plain Request where Cloudflare would pass its own. */
const handle = (request: Request, environment: typeof env) => worker.fetch(request as Parameters<typeof worker.fetch>[0], environment, ctx);

function handlers(): Handlers & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    commands: { cciptoday: async (i) => void ran.push(i.data!.name) },
    autocomplete: async () => [{ name: 'Base', value: '15971525489660198786' }],
  };
}

describe('the interactions endpoint', () => {
  it('answers a signed PING with PONG, and an unsigned or forged request with 401', async () => {
    // #given
    const ping = await signedRequest('{"type":1}');
    const unsigned = await signedRequest('{"type":1}', false);
    const forged = await signedRequest('{"type":1}');
    // #when
    const answers = await Promise.all([
      handle(ping.request, { ...env, DISCORD_PUBLIC_KEY: ping.publicKey }),
      handle(unsigned.request, { ...env, DISCORD_PUBLIC_KEY: unsigned.publicKey }),
      handle(forged.request, { ...env, DISCORD_PUBLIC_KEY: ping.publicKey }),
    ]);
    // #then
    expect([await answers[0]!.json(), answers[1]!.status, answers[2]!.status]).toEqual([{ type: 1 }, 401, 401]);
  });

  it('answers anything but a POST to /interactions with 404', async () => {
    // #when
    const answers = await Promise.all([handle(new Request('https://discord.ccip.dev/interactions'), env), handle(new Request('https://discord.ccip.dev/', { method: 'POST' }), env)]);
    // #then
    expect(answers.map((r) => r.status)).toEqual([404, 404]);
  });

  it('defers a command and runs its work after the reply', async () => {
    // #given
    const h = handlers();
    const work: Promise<unknown>[] = [];
    // #when
    const res = await handleInteraction(command('cciptoday'), GUILD, h, (p) => void work.push(p));
    await Promise.all(work);
    // #then
    expect({ reply: await res.json(), ran: h.ran }).toEqual({ reply: { type: 5 }, ran: ['cciptoday'] });
  });

  it('turns away a command from another server or a DM privately, and gives their autocomplete nothing', async () => {
    // #given
    const h = handlers();
    const elsewhere = command('cciptoday', [], { guild_id: '999' });
    const dm = { ...command('cciptoday'), guild_id: undefined };
    const complete = { ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }], { guild_id: '999' }), type: 4 };
    // #when
    const replies = await Promise.all([elsewhere, dm, complete].map(async (i) => (await handleInteraction(i, GUILD, h, () => {})).json()));
    // #then
    expect({ replies, ran: h.ran }).toEqual({
      replies: [
        { type: 4, data: { content: ONLY_HERE, flags: 64, allowed_mentions: { parse: [] } } },
        { type: 4, data: { content: ONLY_HERE, flags: 64, allowed_mentions: { parse: [] } } },
        { type: 8, data: { choices: [] } },
      ],
      ran: [],
    });
  });

  it('turns everything away while DISCORD_GUILD_ID is empty', async () => {
    // #when
    const res = await handleInteraction(command('cciptoday', [], { guild_id: '' }), '', handlers(), () => {});
    // #then
    expect(await res.json()).toEqual({ type: 4, data: { content: ONLY_HERE, flags: 64, allowed_mentions: { parse: [] } } });
  });

  it('answers an unknown command privately at once', async () => {
    // #when
    const res = await handleInteraction(command('nuke'), GUILD, handlers(), () => {});
    // #then
    expect(await res.json()).toEqual({ type: 4, data: { content: 'Unknown command /nuke.', flags: 64, allowed_mentions: { parse: [] } } });
  });

  it("answers autocomplete within the request, with type 8, and with nothing when the choices can't be read", async () => {
    // #given
    const complete = { ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }]), type: 4 };
    const broken = { ...handlers(), autocomplete: async () => Promise.reject(new Error('chains.json: HTTP 503')) };
    // #when
    const replies = await Promise.all([handleInteraction(complete, GUILD, handlers(), () => {}), handleInteraction(complete, GUILD, broken, () => {})]);
    // #then
    expect(await Promise.all(replies.map((r) => r.json()))).toEqual([{ type: 8, data: { choices: [{ name: 'Base', value: '15971525489660198786' }] } }, { type: 8, data: { choices: [] } }]);
  });
});
```

- [ ] **Step 2: Install the package and confirm the tests fail.**

Run: `pnpm install`
Expected: `pnpm-lock.yaml` gains the `discord` importer, with versions already in the lockfile.

Run: `pnpm --filter @ccip-dev/discord test`
Expected: FAIL: `../src/verify`, `../src/interactions` and `../src/index` do not exist.

- [ ] **Step 3: Add the environment, the signature check, the protocol helpers and the router.**

Create `discord/src/env.ts`:

```ts
import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';

export interface Env {
  DB: D1Database;
  MARINES: R2Bucket;
  /** The site Worker's LinkMarineCards entrypoint. */
  SITE: LinkMarineRenderer;
  DISCORD_GUILD_ID: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_APPLICATION_ID?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALERT_CHAT_ID?: string;
}
```

Create `discord/src/verify.ts`:

```ts
const hexBytes = (hex: string): Uint8Array | null => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
};

/**
 * Discord signs each interaction with Ed25519 over the timestamp header followed by the raw body. A missing header,
 * malformed hex or a bad signature is false; workerd's crypto.subtle verifies Ed25519 itself.
 */
export async function verifyDiscordRequest(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string): Promise<boolean> {
  const key = hexBytes(publicKeyHex);
  const signature = signatureHex ? hexBytes(signatureHex) : null;
  if (!key || key.length !== 32 || !signature || signature.length !== 64 || !timestamp) return false;
  try {
    const publicKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', publicKey, signature, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}
```

Create `discord/src/interactions.ts`:

```ts
/** The slice of Discord's interaction protocol the bot uses (discord.com/developers/docs/interactions/receiving-and-responding). */

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, APPLICATION_COMMAND_AUTOCOMPLETE: 4 } as const;
export const ResponseType = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5, APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8 } as const;
export const EPHEMERAL = 1 << 6;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
}

export interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
}

export interface Interaction {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  data?: {
    name: string;
    options?: CommandOption[];
    resolved?: { users?: Record<string, DiscordUser>; members?: Record<string, DiscordMember> };
  };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An immediate private reply, for what is known inside the 3-second window. */
export const privateReply = (content: string) => json({ type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

export const deferred = () => json({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });

export function optionValue(interaction: Interaction, name: string): string | null {
  const value = interaction.data?.options?.find((o) => o.name === name)?.value;
  return value === undefined ? null : String(value);
}

/** Who ran the command: the member in a server, the user in a DM. */
export function invoker(interaction: Interaction): { user: DiscordUser; member: DiscordMember | null } | null {
  const user = interaction.member?.user ?? interaction.user;
  return user ? { user, member: interaction.member ?? null } : null;
}

/** A display name as Discord shows it in the server: the nickname, else the global name, else the username. */
export function displayName(user: DiscordUser, member: DiscordMember | null): string {
  return member?.nick || user.global_name || user.username;
}

/** The avatar as a 128 px PNG: the server avatar, else the account's, else Discord's default for the account. */
export function avatarUrl(user: DiscordUser, member: DiscordMember | null, guildId: string | undefined): string {
  if (member?.avatar && guildId) return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=128`;
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}
```

Create `discord/src/index.ts`:

```ts
import type { Env } from './env';
import { deferred, InteractionType, json, privateReply, ResponseType, type Interaction } from './interactions';
import { verifyDiscordRequest } from './verify';

export const ONLY_HERE = 'LinkMarine only serves the LinkMarine server.';

export interface Handlers {
  /** Each command's work, run after the deferred reply. */
  commands: Readonly<Record<string, (interaction: Interaction) => Promise<void>>>;
  autocomplete(interaction: Interaction): Promise<{ name: string; value: string }[]>;
}

const choices = (list: { name: string; value: string }[]) => json({ type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: list } });

/**
 * Answers a verified interaction: PING with PONG, autocomplete at once, and a command with a deferred reply while its
 * work runs in `waitUntil`. A command from anywhere but the LinkMarine server is turned away privately.
 */
export async function handleInteraction(interaction: Interaction, guildId: string, handlers: Handlers, waitUntil: (work: Promise<unknown>) => void): Promise<Response> {
  if (interaction.type === InteractionType.PING) return json({ type: ResponseType.PONG });
  const here = guildId !== '' && interaction.guild_id === guildId;
  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    if (!here) return choices([]);
    try {
      return choices(await handlers.autocomplete(interaction));
    } catch (err) {
      console.error(`autocomplete: ${err instanceof Error ? err.message : String(err)}`);
      return choices([]);
    }
  }
  if (interaction.type !== InteractionType.APPLICATION_COMMAND) return new Response('Unsupported interaction', { status: 400 });
  if (!here) return privateReply(ONLY_HERE);
  const name = interaction.data?.name ?? '';
  const command = handlers.commands[name];
  if (!command) return privateReply(`Unknown command /${name}.`);
  waitUntil(command(interaction));
  return deferred();
}

/** Until the commands exist: none, and no suggestions. */
export const NO_HANDLERS: Handlers = { commands: {}, autocomplete: async () => [] };

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/interactions') return new Response('Not found', { status: 404 });
    const body = await request.text();
    const valid = await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY ?? '', request.headers.get('X-Signature-Ed25519'), request.headers.get('X-Signature-Timestamp'), body);
    if (!valid) return new Response('Invalid request signature', { status: 401 });
    return handleInteraction(JSON.parse(body) as Interaction, env.DISCORD_GUILD_ID, NO_HANDLERS, (work) => ctx.waitUntil(work));
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (11 tests).

Run: `pnpm typecheck`
Expected: PASS (`pnpm -r typecheck` now includes `@ccip-dev/discord`).

- [ ] **Step 5: Commit.**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml discord/package.json discord/tsconfig.json discord/wrangler.toml discord/vitest.config.ts discord/migrations/0001_marines.sql discord/src/env.ts discord/src/verify.ts discord/src/interactions.ts discord/src/index.ts discord/test/apply-migrations.ts discord/test/env.d.ts discord/test/site-stub.js discord/test/helpers.ts discord/test/verify.test.ts discord/test/interactions.test.ts discord/test/index.test.ts
git commit -m "feat(discord): the LinkMarine interactions Worker: the signature check, PING, the server check and deferred commands" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 8: The draw

The pure callsign draw of `rules.md` and spec §5.2: three different tags by √count, the score Σ −ln(chance), the tier from the snapshot's cut-offs, the percentile from its table, the lore by weight, one meme per tag from the callsign's own generator, and the simulation that makes the cut-offs and the table. The tests run on a seeded generator; the Worker draws with `crypto.getRandomValues`.

**Files:**
- Create: `discord/src/draw.ts`
- Modify: `discord/test/helpers.ts` (`SNAPSHOT`, a six-tag test snapshot)
- Test: `discord/test/draw.test.ts`

**Interfaces:**
- Consumes: Task 1 (`callsignSeed`, `seededRandom`, `type Tier`).
- Produces (`draw.ts`):
  - `interface CallsignSnapshot { version: number; archive: { repo; sha }; tags: { tag: string; count: number; memes: string[] }[]; lore: { blood: LoreLine[]; faith: LoreLine[] }; cutoffs: { uncommon; rare; legendary }; quantiles: number[]; draws: number }`, `interface LoreLine { text: string; weight: number }`;
  - `interface Draw { tags: [string, string, string]; callsign; tagKey; score; tier: Tier; percentile }`;
  - `MAX_CLASHES = 20`, `TIER_CUTS = { uncommon: 0.6, rare: 0.85, legendary: 0.97 }`;
  - `tagChances(tags): Map<string, number>`, `drawTags(tags, random): [string, string, string]`, `scoreOf(tags, chances): number` (6 decimals, order-free), `tierOf(score, cutoffs): Tier` (a tie takes the rarer tier), `percentileOf(score, quantiles): number`, `tagKey(tags): string` (sorted, hyphen-joined);
  - `drawCallsign(snapshot, random): Draw`, `drawLore(lines, random): string`, `pickMemes(snapshot, tags, callsign): string[]`;
  - `cutAt(sorted: Float64Array, below: number): number`, `simulate(tags, draws, seed): Pick<CallsignSnapshot, 'cutoffs' | 'quantiles' | 'draws'>`;
  - `cryptoRandom(): number`.
  - `test/helpers.ts`: `SNAPSHOT: CallsignSnapshot` (sergey 400, pepe 100, comfy 25, painting 1, space 1, prophecy 3; archive `c0ffee`; version 3).

- [ ] **Step 1: Write the failing test and its snapshot.**

In `discord/test/helpers.ts`, replace:

```ts
import type { CommandOption, Interaction } from '../src/interactions';

```

with:

```ts
import { simulate, type CallsignSnapshot } from '../src/draw';
import type { CommandOption, Interaction } from '../src/interactions';

```

In `discord/test/helpers.ts`, replace:

```ts
  };
}
```

with:

```ts
  };
}

const TAGS = [
  { tag: 'sergey', count: 400, memes: ['s1.jpeg', 's2.jpeg', 's3.png'] },
  { tag: 'pepe', count: 100, memes: ['p1.jpeg', 'shared.gif'] },
  { tag: 'comfy', count: 25, memes: ['c1.png'] },
  { tag: 'painting', count: 1, memes: ['shared.gif'] },
  { tag: 'space', count: 1, memes: ['sp1.jpeg'] },
  { tag: 'prophecy', count: 3, memes: ['pr1.jpg', 'pr2.jpeg', 'pr3.png'] },
];

/** A six-tag snapshot, simulated as the real one is, with fewer draws. */
export const SNAPSHOT: CallsignSnapshot = {
  version: 3,
  archive: { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee' },
  tags: TAGS,
  lore: { blood: [{ text: 'LINK+', weight: 3 }, { text: 'O-LINK', weight: 1 }], faith: [{ text: '4IR', weight: 1 }] },
  ...simulate(TAGS, 20_000, 1),
};
```

Create `discord/test/draw.test.ts`:

```ts
import { seededRandom } from '@ccip-dev/core/linkmarine';
import { describe, expect, it } from 'vitest';
import { cutAt, drawCallsign, drawLore, drawTags, percentileOf, pickMemes, scoreOf, simulate, tagChances, tagKey, tierOf } from '../src/draw';
import { SNAPSHOT } from './helpers';

const TAGS = [
  { tag: 'big', count: 400 },
  { tag: 'mid', count: 100 },
  { tag: 'small', count: 25 },
  { tag: 'one', count: 1 },
];

describe('the draw', () => {
  it('draws each tag with weight √count: 20:10:5:1 here', () => {
    // #given
    const random = seededRandom(1);
    const firsts = new Map<string, number>();
    // #when
    for (let i = 0; i < 36_000; i++) {
      const [first] = drawTags(TAGS, random);
      firsts.set(first, (firsts.get(first) ?? 0) + 1);
    }
    // #then within 5% of 20,000, 10,000, 5,000 and 1,000
    const expected = { big: 20_000, mid: 10_000, small: 5_000, one: 1_000 };
    expect(Object.entries(expected).every(([tag, n]) => Math.abs(firsts.get(tag)! - n) < n * 0.05)).toBe(true);
  });

  it('draws three different tags, in draw order', () => {
    // #when
    const random = seededRandom(2);
    const draws = Array.from({ length: 2000 }, () => drawTags(TAGS, random));
    // #then
    expect(draws.every((d) => new Set(d).size === 3)).toBe(true);
  });

  it('scores −Σ ln(chance), the same in any order, and keys the tags sorted', () => {
    // #given chances 20/36, 10/36, 5/36, 1/36
    const chances = tagChances(TAGS);
    // #when
    const scores = [scoreOf(['big', 'mid', 'one'], chances), scoreOf(['one', 'big', 'mid'], chances)];
    // #then
    expect({ score: scores[0], same: scores[0] === scores[1], key: tagKey(['one', 'big', 'mid']) }).toEqual({
      score: Math.round(-(Math.log(20 / 36) + Math.log(10 / 36) + Math.log(1 / 36)) * 1e6) / 1e6,
      same: true,
      key: 'big-mid-one',
    });
  });

  it('cuts the simulated scores at 60/85/97% into tiers, and reads a percentile off the table', () => {
    // #given thirty tags, so that three of them make many different scores
    const sim = simulate(Array.from({ length: 30 }, (_, i) => ({ tag: `t${i}`, count: i + 1 })), 10_000, 3);
    // #when
    const tiers = [sim.quantiles[100]!, sim.quantiles[700]!, sim.quantiles[900]!, sim.quantiles[990]!].map((s) => tierOf(s, sim.cutoffs));
    const atCuts = [sim.cutoffs.uncommon, sim.cutoffs.rare, sim.cutoffs.legendary].map((s) => tierOf(s, sim.cutoffs));
    // #then
    expect({
      tiers,
      atCuts,
      table: sim.quantiles.length,
      ascending: sim.quantiles.every((q, i) => i === 0 || q >= sim.quantiles[i - 1]!),
      percentiles: [percentileOf(sim.quantiles[0]! - 1, sim.quantiles), percentileOf(sim.quantiles[1000]! + 1, sim.quantiles)],
    }).toEqual({ tiers: ['common', 'uncommon', 'rare', 'legendary'], atCuts: ['uncommon', 'rare', 'legendary'], table: 1001, ascending: true, percentiles: [0, 100] });
  });

  it('puts a cut-off between steps of equal scores, on the side nearer the share', () => {
    // #given half the draws score 1, a third 2 and a sixth 3
    const sorted = Float64Array.from([1, 1, 1, 2, 2, 3]);
    // #when
    const cuts = [0.1, 0.4, 0.5, 0.9, 0.99].map((below) => cutAt(sorted, below));
    // #then 40% below lands nearer the 50% of the 1s than the 0% before them
    expect(cuts).toEqual([1, 2, 2, 3, 3]);
  });

  it('draws lore by weight: a weight of 1 against 9 comes up about a tenth of the time', () => {
    // #given
    const random = seededRandom(4);
    const lines = [{ text: 'LINK+', weight: 9 }, { text: '7777777', weight: 1 }];
    // #when
    const rare = Array.from({ length: 10_000 }, () => drawLore(lines, random)).filter((t) => t === '7777777').length;
    // #then
    expect(Math.abs(rare - 1000) < 100).toBe(true);
  });

  it('picks one meme per tag from the callsign alone, and not the same file twice when the tag has another', () => {
    // #when painting's only meme is shared.gif, which pepe also carries
    const picks = [pickMemes(SNAPSHOT, ['painting', 'pepe', 'space'], 'painting-pepe-space'), pickMemes(SNAPSHOT, ['painting', 'pepe', 'space'], 'painting-pepe-space')];
    // #then
    expect({ same: picks[0]!.join() === picks[1]!.join(), files: picks[0] }).toEqual({ same: true, files: ['shared.gif', 'p1.jpeg', 'sp1.jpeg'] });
  });

  it('draws a whole callsign: tags joined by hyphens, its key, score, tier and percentile', () => {
    // #when
    const draw = drawCallsign(SNAPSHOT, seededRandom(5));
    // #then
    expect({
      callsign: draw.callsign === draw.tags.join('-'),
      key: draw.tagKey === [...draw.tags].sort().join('-'),
      tier: draw.tier === tierOf(draw.score, SNAPSHOT.cutoffs),
      percentile: draw.percentile === percentileOf(draw.score, SNAPSHOT.quantiles),
    }).toEqual({ callsign: true, key: true, tier: true, percentile: true });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/draw.test.ts`
Expected: FAIL: `../src/draw` does not exist.

- [ ] **Step 3: Add the draw.**

Create `discord/src/draw.ts`:

```ts
import { callsignSeed, seededRandom, type Tier } from '@ccip-dev/core/linkmarine';

/** The committed snapshot the draw reads (discord/src/data/callsigns.json, written by pnpm discord:snapshot). */
export interface CallsignSnapshot {
  version: number;
  archive: { repo: string; sha: string };
  /** Allowed tags with at least one SFW meme: their count and their SFW meme files. */
  tags: { tag: string; count: number; memes: string[] }[];
  lore: { blood: LoreLine[]; faith: LoreLine[] };
  /** Scores at the 60th, 85th and 97th percentiles of the simulated draws: where Uncommon, Rare and Legendary start. */
  cutoffs: { uncommon: number; rare: number; legendary: number };
  /** Simulated scores at every 0.1% (1,001 values, ascending): the percentile table. */
  quantiles: number[];
  draws: number;
}

export interface LoreLine {
  text: string;
  weight: number;
}

export interface Draw {
  tags: [string, string, string];
  callsign: string;
  tagKey: string;
  score: number;
  tier: Tier;
  percentile: number;
}

export const MAX_CLASHES = 20;
/** The share of draws below each tier's cut-off: 60% Common, then 25% Uncommon, 12% Rare and 3% Legendary. */
export const TIER_CUTS = { uncommon: 0.6, rare: 0.85, legendary: 0.97 } as const;

/** Each tag's chance in one draw: √count over the sum of √counts (docs/callsigns/rules.md). */
export function tagChances(tags: readonly { tag: string; count: number }[]): Map<string, number> {
  const total = tags.reduce((s, t) => s + Math.sqrt(t.count), 0);
  return new Map(tags.map((t) => [t.tag, Math.sqrt(t.count) / total]));
}

/** Three different tags, each drawn with weight √count from those left, in draw order. */
export function drawTags(tags: readonly { tag: string; count: number }[], random: () => number): [string, string, string] {
  const pool = tags.map((t) => ({ tag: t.tag, weight: Math.sqrt(t.count) }));
  const picked: string[] = [];
  while (picked.length < 3) {
    const total = pool.reduce((s, t) => s + t.weight, 0);
    let roll = random() * total;
    let i = 0;
    while (i < pool.length - 1 && roll >= pool[i]!.weight) roll -= pool[i++]!.weight;
    picked.push(pool[i]!.tag);
    pool.splice(i, 1);
  }
  return picked as [string, string, string];
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * How surprising the three tags are together: the sum of −ln(chance), to 6 decimals like the cut-offs. Summed in tag
 * order, so the same three tags score exactly the same whatever order they were drawn in.
 */
export function scoreOf(tags: readonly string[], chances: ReadonlyMap<string, number>): number {
  return round6([...tags].sort().reduce((s, t) => s - Math.log(chances.get(t)!), 0));
}

/** A score equal to a cut-off takes the rarer tier. */
export function tierOf(score: number, cutoffs: CallsignSnapshot['cutoffs']): Tier {
  if (score >= cutoffs.legendary) return 'legendary';
  if (score >= cutoffs.rare) return 'rare';
  if (score >= cutoffs.uncommon) return 'uncommon';
  return 'common';
}

/** The share of simulated draws that scored below `score`, in percent, to the table's 0.1%. */
export function percentileOf(score: number, quantiles: readonly number[]): number {
  let below = 0;
  while (below < quantiles.length && quantiles[below]! < score) below++;
  return Math.min(100, (Math.max(0, below - 1) * 100) / (quantiles.length - 1));
}

export const tagKey = (tags: readonly string[]) => [...tags].sort().join('-');

export function drawCallsign(snapshot: CallsignSnapshot, random: () => number): Draw {
  const tags = drawTags(snapshot.tags, random);
  const score = scoreOf(tags, tagChances(snapshot.tags));
  return { tags, callsign: tags.join('-'), tagKey: tagKey(tags), score, tier: tierOf(score, snapshot.cutoffs), percentile: percentileOf(score, snapshot.quantiles) };
}

/** A lore line by weight. */
export function drawLore(lines: readonly LoreLine[], random: () => number): string {
  const total = lines.reduce((s, l) => s + l.weight, 0);
  let roll = random() * total;
  for (const line of lines) {
    if (roll < line.weight) return line.text;
    roll -= line.weight;
  }
  return lines.at(-1)!.text;
}

/** One meme file per tag, picked by the callsign's own generator; a file another tag already took is passed over when the tag has others. */
export function pickMemes(snapshot: CallsignSnapshot, tags: readonly string[], callsign: string): string[] {
  const random = seededRandom(callsignSeed(callsign));
  const taken = new Set<string>();
  return tags.map((tag) => {
    const files = snapshot.tags.find((t) => t.tag === tag)?.memes ?? [];
    const fresh = files.filter((f) => !taken.has(f));
    const pool = fresh.length > 0 ? fresh : files;
    const file = pool[Math.floor(random() * pool.length)]!;
    taken.add(file);
    return file;
  });
}

/**
 * The cut-off whose share of draws scoring below it is nearest `below`. Scores come in steps (three tags of one meme
 * each always score the same), so a step that straddles the share goes wholly to whichever side lands nearer.
 */
export function cutAt(sorted: Float64Array, below: number): number {
  const n = sorted.length;
  const value = sorted[Math.min(n - 1, Math.floor(below * n))]!;
  let first = 0;
  while (sorted[first]! < value) first++;
  let next = first;
  while (next < n && sorted[next] === value) next++;
  if (next === n) return value;
  return Math.abs(first / n - below) <= Math.abs(next / n - below) ? value : sorted[next]!;
}

/** Seeded draws (200,000 for the snapshot, as rules.md says): the tier cut-offs and the percentile table. */
export function simulate(tags: readonly { tag: string; count: number }[], draws: number, seed: number): Pick<CallsignSnapshot, 'cutoffs' | 'quantiles' | 'draws'> {
  const random = seededRandom(seed);
  const chances = tagChances(tags);
  const scores = Float64Array.from({ length: draws }, () => scoreOf(drawTags(tags, random), chances)).sort();
  const at = (share: number) => scores[Math.min(draws - 1, Math.floor(share * draws))]!;
  return {
    cutoffs: { uncommon: cutAt(scores, TIER_CUTS.uncommon), rare: cutAt(scores, TIER_CUTS.rare), legendary: cutAt(scores, TIER_CUTS.legendary) },
    quantiles: Array.from({ length: 1001 }, (_, i) => at(i / 1000)),
    draws,
  };
}

/** Randomness for the draw itself: crypto.getRandomValues, in [0, 1). */
export function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
}
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (19 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add discord/src/draw.ts discord/test/helpers.ts discord/test/draw.test.ts
git commit -m "feat(discord): the callsign draw: three tags by √count, a score, a tier and a percentile" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 9: The callsign snapshot and lore.toml

`pnpm discord:snapshot` reads `docs/callsigns/tags.toml`, the new `docs/callsigns/lore.toml` and the chainlinkmeme archive at its checked-out commit, and writes `discord/src/data/callsigns.json`, which is committed and bundled into the Worker. The pure part (`buildSnapshot`) lives with the bot, so the simulation uses the very draw of Task 8; the file reading lives in `scripts/discord/`. The tests run against a small fixture archive.

**Files:**
- Create: `discord/src/snapshot.ts`, `scripts/discord/archive.ts`, `scripts/discord/snapshot.ts`, `docs/callsigns/lore.toml`
- Modify: `package.json` (`discord:snapshot`)
- Generate: `discord/src/data/callsigns.json`
- Test: `scripts/test/discord-snapshot.test.ts`, the fixture archive `scripts/test/fixtures/meme-archive/memes/` (seven tomls, six placeholder images and an underscore file)

**Interfaces:**
- Consumes: Task 8 (`simulate`, `type CallsignSnapshot`, `type LoreLine`); `smol-toml` (`parse`, a root dev dependency).
- Produces:
  - `discord/src/snapshot.ts`: `SIMULATED_DRAWS = 200_000`, `SIMULATION_SEED = 0x4c4d`, `MAX_TAG_LENGTH = 13`, `MAX_LORE_LENGTH = 12`, `interface ArchiveMeme { file: string; tags: readonly string[]; nsfw: boolean }`, `interface SnapshotInput { allowed; memes; lore; repo; sha; version; draws? }`, `buildSnapshot(input): CallsignSnapshot` (throws on bad lore or fewer than 3 tags).
  - `scripts/discord/archive.ts`: `readArchive(archive: string): ArchiveMeme[]`, `readAllowedTags(text): string[]`, `readLore(text): { blood: LoreLine[]; faith: LoreLine[] }`.
  - `pnpm discord:snapshot [--archive PATH]` (default: `../chainlinkmeme` beside the repository).
  - `discord/src/data/callsigns.json`: the committed snapshot.

- [ ] **Step 1: Write the fixture archive and the failing test.**

Create `scripts/test/fixtures/meme-archive/memes/_schema.toml`:

```toml
# Informational schema; the snapshot skips files starting with an underscore.
```

Create `scripts/test/fixtures/meme-archive/memes/a.toml`:

```toml
tags = ["sergey", "pepe"]
nsfw = false
```

Create `scripts/test/fixtures/meme-archive/memes/a.jpeg`:

```
jpeg
```

Create `scripts/test/fixtures/meme-archive/memes/b.toml`:

```toml
tags = ["sergey"]
```

Create `scripts/test/fixtures/meme-archive/memes/b.png`:

```
png
```

Create `scripts/test/fixtures/meme-archive/memes/c.toml`:

```toml
tags = ["pepe", "comfy"]
nsfw = true
```

Create `scripts/test/fixtures/meme-archive/memes/c.gif`:

```
gif
```

Create `scripts/test/fixtures/meme-archive/memes/d.toml`:

```toml
tags = ["comfy", "weareallinthistogether"]
nsfw = false
```

Create `scripts/test/fixtures/meme-archive/memes/d.JPG`:

```
jpeg
```

Create `scripts/test/fixtures/meme-archive/memes/e.toml`:

```toml
tags = ["painting"]
nsfw = false
```

Create `scripts/test/fixtures/meme-archive/memes/f.toml`:

```toml
tags = ["space", "notallowed"]
nsfw = false
```

Create `scripts/test/fixtures/meme-archive/memes/f.jpeg`:

```
jpeg
```

Create `scripts/test/fixtures/meme-archive/memes/g.toml`:

```toml
tags = ["sergey", "sergey"]
nsfw = false
```

Create `scripts/test/fixtures/meme-archive/memes/g.jpeg`:

```
jpeg
```

Create `scripts/test/discord-snapshot.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../discord/src/snapshot';
import { readAllowedTags, readArchive, readLore } from '../discord/archive';

const ARCHIVE = join(import.meta.dirname, 'fixtures', 'meme-archive');
const ALLOWED = 'tags = ["ignored"]\n[allowed]\ntags = ["sergey", "pepe", "comfy", "painting", "space", "weareallinthistogether"]\n[excluded]\n#  "notallowed",\n';
const LORE = '[blood]\nlines = [{ text = "LINK+", weight = 3 }, { text = "O-LINK", weight = 1 }]\n[faith]\nlines = [{ text = "4IR", weight = 1 }]\n';
const input = { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee', version: 1, draws: 2000 };

describe('the callsign snapshot', () => {
  it("reads the archive's memes: each toml with the image beside it, skipping the underscore files", () => {
    // #when
    const memes = readArchive(ARCHIVE);
    // #then e.toml has no image
    expect(memes).toEqual([
      { file: 'a.jpeg', tags: ['sergey', 'pepe'], nsfw: false },
      { file: 'b.png', tags: ['sergey'], nsfw: false },
      { file: 'c.gif', tags: ['pepe', 'comfy'], nsfw: true },
      { file: 'd.JPG', tags: ['comfy', 'weareallinthistogether'], nsfw: false },
      { file: 'f.jpeg', tags: ['space', 'notallowed'], nsfw: false },
      { file: 'g.jpeg', tags: ['sergey', 'sergey'], nsfw: false },
    ]);
  });

  it('keeps the allowed tags of 13 characters or fewer that an SFW meme carries, with their SFW files', () => {
    // #when
    const snapshot = buildSnapshot({ ...input, allowed: readAllowedTags(ALLOWED), memes: readArchive(ARCHIVE), lore: readLore(LORE) });
    // #then c.gif is NSFW, painting has no image, weareallinthistogether is too long, notallowed is not allowed
    expect({ tags: snapshot.tags, archive: snapshot.archive, version: snapshot.version, lore: snapshot.lore }).toEqual({
      tags: [
        { tag: 'sergey', count: 3, memes: ['a.jpeg', 'b.png', 'g.jpeg'] },
        { tag: 'comfy', count: 1, memes: ['d.JPG'] },
        { tag: 'pepe', count: 1, memes: ['a.jpeg'] },
        { tag: 'space', count: 1, memes: ['f.jpeg'] },
      ],
      archive: { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee' },
      version: 1,
      lore: { blood: [{ text: 'LINK+', weight: 3 }, { text: 'O-LINK', weight: 1 }], faith: [{ text: '4IR', weight: 1 }] },
    });
  });

  it('simulates the draws into ascending cut-offs and a 1,001-step table, the same every run', () => {
    // #when
    const build = () => buildSnapshot({ ...input, allowed: readAllowedTags(ALLOWED), memes: readArchive(ARCHIVE), lore: readLore(LORE) });
    const [a, b] = [build(), build()];
    // #then
    expect({
      draws: a.draws,
      table: a.quantiles.length,
      ordered: a.cutoffs.uncommon <= a.cutoffs.rare && a.cutoffs.rare <= a.cutoffs.legendary,
      same: JSON.stringify(a) === JSON.stringify(b),
    }).toEqual({ draws: 2000, table: 1001, ordered: true, same: true });
  });

  it('refuses lore that would not fit the tag and a snapshot with fewer than three tags', () => {
    // #given
    const memes = readArchive(ARCHIVE);
    const allowed = readAllowedTags(ALLOWED);
    const lore = (text: string, weight: number) => ({ blood: [{ text, weight }], faith: [{ text: '4IR', weight: 1 }] });
    // #then
    expect(() => buildSnapshot({ ...input, allowed, memes, lore: lore('link+', 1) })).toThrow('lore.toml: [blood] "link+" must be 1–12 of A–Z, 0–9, + and -');
    expect(() => buildSnapshot({ ...input, allowed, memes, lore: lore('FUNDAMENTALLY', 1) })).toThrow('must be 1–12');
    expect(() => buildSnapshot({ ...input, allowed, memes, lore: lore('LINK+', 0) })).toThrow('needs a positive whole weight');
    expect(() => buildSnapshot({ ...input, allowed: ['sergey', 'pepe'], memes, lore: readLore(LORE) })).toThrow('only 2 allowed tags have an SFW meme; a callsign needs 3');
  });

  it("reads the repository's own tags.toml and lore.toml", () => {
    // #when
    const docs = join(import.meta.dirname, '..', '..', 'docs', 'callsigns');
    const allowed = readAllowedTags(readFileSync(join(docs, 'tags.toml'), 'utf8'));
    const lore = readLore(readFileSync(join(docs, 'lore.toml'), 'utf8'));
    // #then
    expect({ allowed: allowed.length, lore }).toEqual({
      allowed: 260,
      lore: {
        blood: [{ text: 'LINK+', weight: 60 }, { text: 'O-LINK', weight: 30 }, { text: '7777777', weight: 10 }],
        faith: [{ text: '4IR', weight: 40 }, { text: 'SERGEY', weight: 30 }, { text: 'STAKING', weight: 20 }, { text: 'FUNDAMENTALS', weight: 10 }],
      },
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run scripts/test/discord-snapshot.test.ts`
Expected: FAIL: `../../discord/src/snapshot` and `../discord/archive` do not exist.

- [ ] **Step 3: Add the builder, the readers, the script and the lore.**

Create `discord/src/snapshot.ts`:

```ts
import { simulate, type CallsignSnapshot, type LoreLine } from './draw';

export const SIMULATED_DRAWS = 200_000;
/** The simulation's fixed seed, so the same archive always gives the same snapshot. */
export const SIMULATION_SEED = 0x4c4d;
export const MAX_TAG_LENGTH = 13;
/** The longest lore line that still fits the front tag's lore row beside the date. */
export const MAX_LORE_LENGTH = 12;
const LORE_TEXT = /^[A-Z0-9+\-]+$/;

export interface ArchiveMeme {
  file: string;
  tags: readonly string[];
  nsfw: boolean;
}

export interface SnapshotInput {
  allowed: readonly string[];
  memes: readonly ArchiveMeme[];
  lore: { blood: readonly LoreLine[]; faith: readonly LoreLine[] };
  repo: string;
  sha: string;
  version: number;
  draws?: number;
}

function checkLore(name: string, lines: readonly LoreLine[]): LoreLine[] {
  if (lines.length === 0) throw new Error(`lore.toml: [${name}] has no lines`);
  for (const l of lines) {
    if (!LORE_TEXT.test(l.text) || l.text.length > MAX_LORE_LENGTH) throw new Error(`lore.toml: [${name}] "${l.text}" must be 1–${MAX_LORE_LENGTH} of A–Z, 0–9, + and -`);
    if (!Number.isInteger(l.weight) || l.weight <= 0) throw new Error(`lore.toml: [${name}] "${l.text}" needs a positive whole weight`);
  }
  return lines.map((l) => ({ text: l.text, weight: l.weight }));
}

/**
 * The callsign snapshot: the allowed tags of 13 characters or fewer that some SFW meme carries, each with its SFW meme
 * files (sorted), the lore, and the cut-offs and percentile table from SIMULATED_DRAWS seeded draws.
 */
export function buildSnapshot(input: SnapshotInput): CallsignSnapshot {
  const allowed = new Set(input.allowed.filter((t) => t.length <= MAX_TAG_LENGTH));
  const files = new Map<string, string[]>();
  for (const meme of input.memes) {
    if (meme.nsfw) continue;
    for (const tag of new Set(meme.tags)) {
      if (!allowed.has(tag)) continue;
      files.set(tag, [...(files.get(tag) ?? []), meme.file]);
    }
  }
  const tags = [...files]
    .map(([tag, memes]) => ({ tag, count: memes.length, memes: [...memes].sort() }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
  if (tags.length < 3) throw new Error(`only ${tags.length} allowed tags have an SFW meme; a callsign needs 3`);
  return {
    version: input.version,
    archive: { repo: input.repo, sha: input.sha },
    tags,
    lore: { blood: checkLore('blood', input.lore.blood), faith: checkLore('faith', input.lore.faith) },
    ...simulate(tags, input.draws ?? SIMULATED_DRAWS, SIMULATION_SEED),
  };
}
```

Create `scripts/discord/archive.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import type { LoreLine } from '../../discord/src/draw';
import type { ArchiveMeme } from '../../discord/src/snapshot';

const IMAGE = /\.(?:jpe?g|png|gif)$/i;

/** The archive's memes: each memes/<stem>.toml with its tags and nsfw flag, and the image file beside it. A toml without an image is skipped. */
export function readArchive(archive: string): ArchiveMeme[] {
  const dir = join(archive, 'memes');
  const names = readdirSync(dir).sort();
  const images = new Map(names.filter((n) => IMAGE.test(n)).map((n) => [n.replace(IMAGE, ''), n]));
  return names
    .filter((n) => n.endsWith('.toml') && !n.startsWith('_'))
    .flatMap((n) => {
      const file = images.get(n.slice(0, -'.toml'.length));
      if (!file) return [];
      const meta = parse(readFileSync(join(dir, n), 'utf8')) as { tags?: unknown; nsfw?: unknown };
      const tags = Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [];
      return [{ file, tags, nsfw: meta.nsfw === true }];
    });
}

/** docs/callsigns/tags.toml's [allowed] tags. */
export function readAllowedTags(text: string): string[] {
  const allowed = (parse(text) as { allowed?: { tags?: unknown } }).allowed?.tags;
  if (!Array.isArray(allowed)) throw new Error('tags.toml: no [allowed] tags');
  return allowed.filter((t): t is string => typeof t === 'string');
}

/** docs/callsigns/lore.toml's [blood] and [faith] lines. */
export function readLore(text: string): { blood: LoreLine[]; faith: LoreLine[] } {
  const toml = parse(text) as Record<string, { lines?: unknown } | undefined>;
  const lines = (name: string): LoreLine[] => {
    const list = toml[name]?.lines;
    if (!Array.isArray(list)) throw new Error(`lore.toml: no [${name}] lines`);
    return list.map((l) => ({ text: String((l as { text?: unknown }).text ?? ''), weight: Number((l as { weight?: unknown }).weight) }));
  };
  return { blood: lines('blood'), faith: lines('faith') };
}
```

Create `scripts/discord/snapshot.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CallsignSnapshot } from '../../discord/src/draw';
import { buildSnapshot } from '../../discord/src/snapshot';
import { readAllowedTags, readArchive, readLore } from './archive';

/** `pnpm discord:snapshot [--archive ../chainlinkmeme]`: writes discord/src/data/callsigns.json from the archive at its checked-out commit. */
const root = join(import.meta.dirname, '..', '..');
const { values } = parseArgs({ options: { archive: { type: 'string', default: join(root, '..', 'chainlinkmeme') } } });
const archive = resolve(values.archive);
if (!existsSync(join(archive, 'memes'))) throw new Error(`no chainlinkmeme checkout at ${archive}: pass --archive <path to it>`);
const sha = execFileSync('git', ['-C', archive, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const out = join(root, 'discord', 'src', 'data', 'callsigns.json');
const previous = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as CallsignSnapshot) : null;
const build = (version: number) =>
  buildSnapshot({
    allowed: readAllowedTags(readFileSync(join(root, 'docs', 'callsigns', 'tags.toml'), 'utf8')),
    memes: readArchive(archive),
    lore: readLore(readFileSync(join(root, 'docs', 'callsigns', 'lore.toml'), 'utf8')),
    repo: 'momentmaker/chainlinkmeme',
    sha,
    version,
  });
let snapshot = build(previous?.version ?? 1);
if (previous && JSON.stringify(previous) !== JSON.stringify(snapshot)) snapshot = { ...snapshot, version: previous.version + 1 };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(snapshot)}\n`);
console.log(`wrote discord/src/data/callsigns.json: version ${snapshot.version}, ${snapshot.tags.length} tags, chainlinkmeme ${sha.slice(0, 7)}`);
```

Create `docs/callsigns/lore.toml`:

```toml
# Lore stamped on each Marine's front tag: one BLOOD line and one FAITH line, each drawn by weight.
#
# A line's chance is its weight over the sum of its section's weights, so a low weight makes a rare line.
# Lines are 1–12 characters of A–Z, 0–9, + and -. Edit freely, then run pnpm discord:snapshot and commit
# discord/src/data/callsigns.json. A Marine's lore never changes; an edit changes only future draws.

[blood]
lines = [
  { text = "LINK+", weight = 60 },
  { text = "O-LINK", weight = 30 },
  { text = "7777777", weight = 10 },
]

[faith]
lines = [
  { text = "4IR", weight = 40 },
  { text = "SERGEY", weight = 30 },
  { text = "STAKING", weight = 20 },
  { text = "FUNDAMENTALS", weight = 10 },
]
```

In `package.json`, replace:

```json
    "typecheck": "pnpm -r typecheck && tsc --noEmit",
    "canary": "tsx scripts/canary.ts",
    "backfill:crawl": "tsx scripts/backfill/crawl.ts",
    "backfill:sources": "tsx scripts/backfill/sources.ts",
```

with:

```json
    "typecheck": "pnpm -r typecheck && tsc --noEmit",
    "canary": "tsx scripts/canary.ts",
    "discord:snapshot": "tsx scripts/discord/snapshot.ts",
    "backfill:crawl": "tsx scripts/backfill/crawl.ts",
    "backfill:sources": "tsx scripts/backfill/sources.ts",
```

- [ ] **Step 4: Write the snapshot.**

The command finds the chainlinkmeme checkout beside the main one (`../chainlinkmeme`), from a worktree too. On the archive at `ec873ea` it takes about a second.

Run: `pnpm discord:snapshot --archive "$(git rev-parse --path-format=absolute --git-common-dir)/../../chainlinkmeme"`
Expected: `wrote discord/src/data/callsigns.json: version 1, 260 tags, chainlinkmeme ec873ea` (a later archive commit prints its own short SHA, and may count other tags), a file of about 150 KB.

- [ ] **Step 5: Run the test and the typecheck.**

Run: `pnpm exec vitest run scripts/test/discord-snapshot.test.ts`
Expected: PASS (5 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add discord/src/snapshot.ts scripts/discord/archive.ts scripts/discord/snapshot.ts docs/callsigns/lore.toml package.json discord/src/data/callsigns.json scripts/test/discord-snapshot.test.ts scripts/test/fixtures/meme-archive/memes/_schema.toml scripts/test/fixtures/meme-archive/memes/a.toml scripts/test/fixtures/meme-archive/memes/a.jpeg scripts/test/fixtures/meme-archive/memes/b.toml scripts/test/fixtures/meme-archive/memes/b.png scripts/test/fixtures/meme-archive/memes/c.toml scripts/test/fixtures/meme-archive/memes/c.gif scripts/test/fixtures/meme-archive/memes/d.toml scripts/test/fixtures/meme-archive/memes/d.JPG scripts/test/fixtures/meme-archive/memes/e.toml scripts/test/fixtures/meme-archive/memes/f.toml scripts/test/fixtures/meme-archive/memes/f.jpeg scripts/test/fixtures/meme-archive/memes/g.toml scripts/test/fixtures/meme-archive/memes/g.jpeg
git commit -m "feat(discord): pnpm discord:snapshot, the callsign snapshot from tags.toml, lore.toml and the meme archive" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 10: Enlistment in D1, and the meme copy into R2

`enlist` saves a draw once per account and platform, with a dense serial, and draws again while another Marine holds the same three tags in any order (at most 20 times). `stockMemes` copies a Marine's memes from the archive at the snapshot's pinned commit, each as the 240 px PNG the site's `prepareMeme` makes, into R2.

**Files:**
- Create: `discord/src/store.ts`, `discord/src/memes.ts`
- Modify: `discord/test/helpers.ts` (`resetStorage`, `PNG_BYTES`, `GIF_BYTES`, `fakeRenderer`, `fakeFetch`)
- Test: `discord/test/store.test.ts`, `discord/test/memes.test.ts`

**Interfaces:**
- Consumes: Task 1 (`type Tier`, `type LinkMarineRenderer`); Task 7 (the `marines` table, `env.DB`, `env.MARINES`); Task 8 (`MAX_CLASHES`, `type Draw`, `drawCallsign`).
- Produces:
  - `store.ts`: `interface MarineMeme { tag; file; key }`, `interface Marine { serial; platform; userId; callsign; tags: string[]; tier: Tier; score; percentile; memes: MarineMeme[]; blood; faith; displayName; snapshotVersion; enlistedAt; cardKey: string | null }`, `findMarine(db, platform, userId): Promise<Marine | null>`, `interface Recruit { platform; userId; displayName; enlistedAt; snapshotVersion }`, `interface Drafted { draw: Draw; memes: MarineMeme[]; blood; faith }`, `type EnlistResult = { kind: 'enlisted'; marine } | { kind: 'already'; marine } | { kind: 'clashed' }`, `enlist(db, recruit, draft: () => Drafted): Promise<EnlistResult>`, `setCardKey(db, serial, key): Promise<void>`.
  - `memes.ts`: `rawMemeUrl(repo, sha, file)`, `memeKey(file)` (`memes/<file>.png`), `MEME_TIMEOUT_MS = 8_000`, `stockMemes(bucket, renderer, fetch, archive, memes): Promise<void>` (throws "meme <file>: HTTP <status>"), `loadMemes(bucket, memes): Promise<Uint8Array[] | null>`.
  - `test/helpers.ts`: `resetStorage()`, `PNG_BYTES`, `GIF_BYTES`, `fakeRenderer(failing?)` (counts calls in `.calls`), `fakeFetch(routes?)` (records `.urls`).

- [ ] **Step 1: Write the failing tests and their fakes.**

In `discord/test/helpers.ts`, replace:

```ts
import { simulate, type CallsignSnapshot } from '../src/draw';
import type { CommandOption, Interaction } from '../src/interactions';
```

with:

```ts
import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import { simulate, type CallsignSnapshot } from '../src/draw';
import type { CommandOption, Interaction } from '../src/interactions';
```

In `discord/test/helpers.ts`, replace:

```ts
  ...simulate(TAGS, 20_000, 1),
};
```

with:

```ts
  ...simulate(TAGS, 20_000, 1),
};

export async function resetStorage(): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM marines'), env.DB.prepare('DELETE FROM meta'), env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'marines'")]);
  const listed = await env.MARINES.list();
  await Promise.all(listed.objects.map((o) => env.MARINES.delete(o.key)));
}

export const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export const GIF_BYTES = new Uint8Array([71, 73, 70, 56, 57, 97]);

/** The site's renderer as the bot calls it, counting calls; `failing` names a method that throws. */
export function fakeRenderer(failing: keyof LinkMarineRenderer | null = null): LinkMarineRenderer & { calls: string[] } {
  const calls: string[] = [];
  const call = <T>(name: keyof LinkMarineRenderer, value: T) => {
    calls.push(name);
    if (failing === name) throw new Error(`${name} failed`);
    return value;
  };
  return {
    calls,
    async prepareMeme() {
      return call('prepareMeme', PNG_BYTES);
    },
    async renderMarineCard() {
      return call('renderMarineCard', PNG_BYTES);
    },
    async renderMarineGlint(card) {
      return call('renderMarineGlint', card.tier === 'rare' || card.tier === 'legendary' ? GIF_BYTES : null);
    },
    async renderIntelCard() {
      return call('renderIntelCard', PNG_BYTES);
    },
  };
}

/** A fetch that answers from a table of URL prefixes, recording each URL; anything else is a 404. */
export function fakeFetch(routes: Record<string, () => Response> = {}): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const f = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return route ? routes[route]!() : new Response('not found', { status: 404 });
  };
  return Object.assign(f as typeof fetch, { urls });
}
```

Create `discord/test/store.test.ts`:

```ts
import { seededRandom } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { drawCallsign, MAX_CLASHES, type Draw } from '../src/draw';
import { enlist, findMarine, setCardKey, type Drafted, type Recruit } from '../src/store';
import { resetStorage, SNAPSHOT } from './helpers';

const recruit = (userId: string, platform = 'discord'): Recruit => ({ platform, userId, displayName: `marine ${userId}`, enlistedAt: '2026-10-13T10:40:00.000Z', snapshotVersion: 3 });

function drafted(draw: Draw): Drafted {
  return { draw, memes: draw.tags.map((tag) => ({ tag, file: `${tag}.jpeg`, key: `memes/${tag}.jpeg.png` })), blood: 'LINK+', faith: '4IR' };
}

/** Drafts the given callsigns in turn, then repeats the last. */
function drafts(...callsigns: string[]): () => Drafted {
  let i = 0;
  return () => {
    const tags = callsigns[Math.min(i++, callsigns.length - 1)]!.split('-') as [string, string, string];
    return drafted({ tags, callsign: tags.join('-'), tagKey: [...tags].sort().join('-'), score: 15, tier: 'common', percentile: 40 });
  };
}

beforeEach(resetStorage);

describe('enlistment', () => {
  it('saves the draw with a serial in enlistment order, from 1', async () => {
    // #when
    const results = [await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy')), await enlist(env.DB, recruit('b'), drafts('painting-space-prophecy'))];
    // #then
    expect(results.map((r) => (r.kind === 'enlisted' ? [r.marine.serial, r.marine.callsign, r.marine.memes.map((m) => m.key)] : r.kind))).toEqual([
      [1, 'sergey-pepe-comfy', ['memes/sergey.jpeg.png', 'memes/pepe.jpeg.png', 'memes/comfy.jpeg.png']],
      [2, 'painting-space-prophecy', ['memes/painting.jpeg.png', 'memes/space.jpeg.png', 'memes/prophecy.jpeg.png']],
    ]);
  });

  it('never draws twice: an enlisted Marine gets their record back, untouched', async () => {
    // #given
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    // #when
    const again = await enlist(env.DB, recruit('a'), drafts('painting-space-prophecy'));
    // #then
    expect(again.kind === 'already' && [again.marine.serial, again.marine.callsign]).toEqual([1, 'sergey-pepe-comfy']);
  });

  it('draws again on a callsign whose tags another Marine holds in any order, keeping serials dense', async () => {
    // #given
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    // #when b first draws the same three tags in another order
    const b = await enlist(env.DB, recruit('b'), drafts('comfy-sergey-pepe', 'pepe-comfy-sergey', 'painting-space-prophecy'));
    // #then
    expect(b.kind === 'enlisted' && [b.marine.serial, b.marine.callsign]).toEqual([2, 'painting-space-prophecy']);
  });

  it(`gives up after ${MAX_CLASHES} clashes`, async () => {
    // #given
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    let drawn = 0;
    // #when
    const b = await enlist(env.DB, recruit('b'), () => {
      drawn++;
      return drafts('pepe-sergey-comfy')();
    });
    // #then
    expect({ kind: b.kind, drawn, saved: await findMarine(env.DB, 'discord', 'b') }).toEqual({ kind: 'clashed', drawn: MAX_CLASHES, saved: null });
  });

  it('gives two enlistments at once one Marine: the second finds the first', async () => {
    // #when
    const [x, y] = await Promise.all([enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy')), enlist(env.DB, recruit('a'), drafts('painting-space-prophecy'))]);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM marines').first<{ n: number }>();
    const next = await enlist(env.DB, recruit('b'), drafts('space-comfy-pepe'));
    // #then and the next Marine is #2
    expect({
      kinds: [x.kind, y.kind].sort(),
      count: count?.n,
      same: x.kind !== 'clashed' && y.kind !== 'clashed' && x.marine.callsign === y.marine.callsign,
      next: next.kind === 'enlisted' && next.marine.serial,
    }).toEqual({ kinds: ['already', 'enlisted'], count: 1, same: true, next: 2 });
  });

  it('keeps one Marine per account per platform: the same id on Telegram is another Marine', async () => {
    // #when
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    const telegram = await enlist(env.DB, recruit('a', 'telegram'), drafts('painting-space-prophecy'));
    // #then
    expect(telegram.kind === 'enlisted' && telegram.marine.serial).toBe(2);
  });

  it('records the stamped card', async () => {
    // #given
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    // #when
    await setCardKey(env.DB, 1, 'cards/1.png');
    // #then
    expect((await findMarine(env.DB, 'discord', 'a'))?.cardKey).toBe('cards/1.png');
  });

  it('saves a real draw whole: tags, tier, score, percentile, lore and snapshot version', async () => {
    // #given
    const draw = drawCallsign(SNAPSHOT, seededRandom(9));
    // #when
    await enlist(env.DB, recruit('a'), () => drafted(draw));
    // #then
    const m = (await findMarine(env.DB, 'discord', 'a'))!;
    expect([m.tags, m.tier, m.score, m.percentile, m.blood, m.faith, m.snapshotVersion, m.displayName, m.cardKey]).toEqual([draw.tags, draw.tier, draw.score, draw.percentile, 'LINK+', '4IR', 3, 'marine a', null]);
  });
});
```

Create `discord/test/memes.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMemes, memeKey, rawMemeUrl, stockMemes } from '../src/memes';
import { fakeFetch, fakeRenderer, PNG_BYTES, resetStorage } from './helpers';

const ARCHIVE = { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee' };
const memes = ['a.jpeg', 'b c.gif'].map((file) => ({ tag: 't', file, key: memeKey(file) }));
const RAW = 'https://raw.githubusercontent.com/momentmaker/chainlinkmeme/c0ffee/memes/';

beforeEach(resetStorage);

describe('the meme copy', () => {
  it('copies each meme from the archive at the pinned commit, as the PNG the site makes of it', async () => {
    // #given
    const fetch = fakeFetch({ [RAW]: () => new Response(new Uint8Array([0xff, 0xd8, 0xff])) });
    const renderer = fakeRenderer();
    // #when
    await stockMemes(env.MARINES, renderer, fetch, ARCHIVE, memes);
    // #then
    const stored = await loadMemes(env.MARINES, memes);
    expect({ urls: fetch.urls, prepared: renderer.calls, stored: stored?.map((b) => [...b]), type: (await env.MARINES.head('memes/a.jpeg.png'))?.httpMetadata?.contentType }).toEqual({
      urls: [`${RAW}a.jpeg`, `${RAW}b%20c.gif`],
      prepared: ['prepareMeme', 'prepareMeme'],
      stored: [[...PNG_BYTES], [...PNG_BYTES]],
      type: 'image/png',
    });
  });

  it('copies only what R2 lacks, so a retry fetches the rest', async () => {
    // #given
    await env.MARINES.put(memeKey('a.jpeg'), PNG_BYTES);
    const fetch = fakeFetch({ [RAW]: () => new Response(new Uint8Array([0xff, 0xd8, 0xff])) });
    // #when
    await stockMemes(env.MARINES, fakeRenderer(), fetch, ARCHIVE, memes);
    // #then
    expect(fetch.urls).toEqual([`${RAW}b%20c.gif`]);
  });

  it('fails when GitHub does, leaving loadMemes empty-handed', async () => {
    // #when
    const copying = stockMemes(env.MARINES, fakeRenderer(), fakeFetch(), ARCHIVE, memes);
    // #then
    await expect(copying).rejects.toThrow(/^meme (a\.jpeg|b c\.gif): HTTP 404$/);
    expect(await loadMemes(env.MARINES, memes)).toBeNull();
  });

  it('pins the raw URL to the commit and escapes the file name', () => {
    // #then
    expect(rawMemeUrl('momentmaker/chainlinkmeme', 'c0ffee', 'a b#.jpeg')).toBe(`${RAW}a%20b%23.jpeg`);
  });
});
```

- [ ] **Step 2: Run the store test and confirm it fails.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/store.test.ts`
Expected: FAIL: `../src/store` does not exist.

- [ ] **Step 3: Add the store and the meme copy.**

Create `discord/src/store.ts`:

```ts
import type { Tier } from '@ccip-dev/core/linkmarine';
import { MAX_CLASHES, type Draw } from './draw';

export interface MarineMeme {
  tag: string;
  file: string;
  key: string;
}

export interface Marine {
  serial: number;
  platform: string;
  userId: string;
  callsign: string;
  tags: string[];
  tier: Tier;
  score: number;
  percentile: number;
  memes: MarineMeme[];
  blood: string;
  faith: string;
  displayName: string;
  snapshotVersion: number;
  enlistedAt: string;
  cardKey: string | null;
}

interface MarineRow {
  serial: number;
  platform: string;
  user_id: string;
  callsign: string;
  tags: string;
  tier: Tier;
  score: number;
  percentile: number;
  memes: string;
  blood: string;
  faith: string;
  display_name: string;
  snapshot_version: number;
  enlisted_at: string;
  card_key: string | null;
}

const toMarine = (r: MarineRow): Marine => ({
  serial: r.serial,
  platform: r.platform,
  userId: r.user_id,
  callsign: r.callsign,
  tags: JSON.parse(r.tags) as string[],
  tier: r.tier,
  score: r.score,
  percentile: r.percentile,
  memes: JSON.parse(r.memes) as MarineMeme[],
  blood: r.blood,
  faith: r.faith,
  displayName: r.display_name,
  snapshotVersion: r.snapshot_version,
  enlistedAt: r.enlisted_at,
  cardKey: r.card_key,
});

export async function findMarine(db: D1Database, platform: string, userId: string): Promise<Marine | null> {
  const row = await db.prepare('SELECT * FROM marines WHERE platform = ? AND user_id = ?').bind(platform, userId).first<MarineRow>();
  return row ? toMarine(row) : null;
}

export interface Recruit {
  platform: string;
  userId: string;
  displayName: string;
  enlistedAt: string;
  snapshotVersion: number;
}

export interface Drafted {
  draw: Draw;
  memes: MarineMeme[];
  blood: string;
  faith: string;
}

export type EnlistResult = { kind: 'enlisted'; marine: Marine } | { kind: 'already'; marine: Marine } | { kind: 'clashed' };

/**
 * Enlists once: a Marine already on record is returned as is. A callsign whose tags another Marine holds, in any order,
 * is drawn again, up to MAX_CLASHES times. A clash is looked up before inserting, because an insert that fails late
 * would still use up an AUTOINCREMENT serial and leave a gap. Two enlistments at once meet at UNIQUE (platform,
 * user_id): the second finds the first's record.
 */
export async function enlist(db: D1Database, recruit: Recruit, draft: () => Drafted): Promise<EnlistResult> {
  const existing = await findMarine(db, recruit.platform, recruit.userId);
  if (existing) return { kind: 'already', marine: existing };
  const taken = db.prepare('SELECT 1 FROM marines WHERE tag_key = ?');
  const insert = db.prepare(
    `INSERT INTO marines (platform, user_id, callsign, tag_key, tags, tier, score, percentile, memes, blood, faith, display_name, snapshot_version, enlisted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) RETURNING *`,
  );
  for (let attempt = 0; attempt < MAX_CLASHES; attempt++) {
    const d = draft();
    if (await taken.bind(d.draw.tagKey).first()) continue;
    try {
      const row = await insert
        .bind(recruit.platform, recruit.userId, d.draw.callsign, d.draw.tagKey, JSON.stringify(d.draw.tags), d.draw.tier, d.draw.score, d.draw.percentile, JSON.stringify(d.memes), d.blood, d.faith, recruit.displayName, recruit.snapshotVersion, recruit.enlistedAt)
        .first<MarineRow>();
      if (row) return { kind: 'enlisted', marine: toMarine(row) };
    } catch (err) {
      const raced = await findMarine(db, recruit.platform, recruit.userId);
      if (raced) return { kind: 'already', marine: raced };
      if (!String(err).includes('marines.tag_key')) throw err;
    }
  }
  return { kind: 'clashed' };
}

export async function setCardKey(db: D1Database, serial: number, key: string): Promise<void> {
  await db.prepare('UPDATE marines SET card_key = ? WHERE serial = ?').bind(key, serial).run();
}
```

Create `discord/src/memes.ts`:

```ts
import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import type { MarineMeme } from './store';

/** The archive at the snapshot's commit, so a file's bytes can never change under a Marine. */
export const rawMemeUrl = (repo: string, sha: string, file: string) => `https://raw.githubusercontent.com/${repo}/${sha}/memes/${encodeURIComponent(file)}`;

/** Memes are kept as the 240 px PNG the site makes of them, never the original (some are 8 MB GIFs). */
export const memeKey = (file: string) => `memes/${file}.png`;

/** The reveal runs in waitUntil, which ends 30 s after the deferred reply: three copies at once, each given 8 s. */
export const MEME_TIMEOUT_MS = 8_000;

/** Copies the memes missing from R2 from the pinned archive URL, at once, through the site's prepareMeme. Throws when any fails. */
export async function stockMemes(
  bucket: R2Bucket,
  renderer: Pick<LinkMarineRenderer, 'prepareMeme'>,
  fetchFn: typeof fetch,
  archive: { repo: string; sha: string },
  memes: readonly MarineMeme[],
): Promise<void> {
  await Promise.all(
    memes.map(async (meme) => {
      if (await bucket.head(meme.key)) return;
      const res = await fetchFn(rawMemeUrl(archive.repo, archive.sha, meme.file), { signal: AbortSignal.timeout(MEME_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`meme ${meme.file}: HTTP ${res.status}`);
      const png = await renderer.prepareMeme(new Uint8Array(await res.arrayBuffer()));
      await bucket.put(meme.key, png, { httpMetadata: { contentType: 'image/png' } });
    }),
  );
}

/** The three memes' PNGs from R2, or null while any is missing. */
export async function loadMemes(bucket: R2Bucket, memes: readonly MarineMeme[]): Promise<Uint8Array[] | null> {
  const objects = await Promise.all(memes.map((m) => bucket.get(m.key)));
  if (objects.some((o) => o === null)) return null;
  return Promise.all(objects.map(async (o) => new Uint8Array(await o!.arrayBuffer())));
}
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (31 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add discord/src/store.ts discord/src/memes.ts discord/test/helpers.ts discord/test/store.test.ts discord/test/memes.test.ts
git commit -m "feat(discord): enlistment in D1, once per account and per three tags, and the meme copy into R2" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 11: /enlist with its reveal, /dogtag, and Discord's webhook API

The two Marine commands, on a small client for the interaction webhook: `editOriginal` (text, or text and one image as multipart) and `privateFollowup` (Review Focus 1: it deletes the deferred loading message first, or Discord would edit it and ignore the ephemeral flag). `/enlist` saves the draw, then reveals it a second per edit while the card is stamped in parallel: memes copied, the avatar kept, the card (and the glint, Rare and up) rendered through `SITE` and kept in R2. `/dogtag` posts a Marine's kept card, or stamps a missing one. Alerts go to the alert chat once an hour per signature, through the bot's own `meta` table.

**Files:**
- Create: `discord/src/discord-api.ts`, `discord/src/alerts.ts`, `discord/src/bot.ts`, `discord/src/marines.ts`
- Modify: `discord/src/index.ts` (`botHandlers` with `/enlist` and `/dogtag`, the default export builds the bot), `discord/test/helpers.ts` (`fakeDiscord`, `ARCHIVE_ROUTES`, `FakeBot`, `fakeBot`)
- Test: `discord/test/discord-api.test.ts`, `discord/test/alerts.test.ts`, `discord/test/marines.test.ts`

**Interfaces:**
- Consumes: Task 1 (`hasGlint`, `serialText`, `type MarineCard`, `type Tier`, `type LinkMarineRenderer`); Task 7 (`EPHEMERAL`, `avatarUrl`, `displayName`, `invoker`, `optionValue`, `type Interaction`, `type DiscordUser`, `type DiscordMember`, `type Env`, `Handlers`); Task 8 (`drawCallsign`, `drawLore`, `pickMemes`, `cryptoRandom`, `type CallsignSnapshot`); Task 9 (`discord/src/data/callsigns.json`); Task 10 (`enlist`, `findMarine`, `setCardKey`, `type Drafted`, `type Marine`, `loadMemes`, `memeKey`, `stockMemes`).
- Produces:
  - `discord-api.ts`: `DISCORD_API` (`https://discord.com/api/v10`), `interface Attachment { name; type; bytes: Uint8Array }`, `interface DiscordApi { editOriginal(token, content, file?): Promise<void>; privateFollowup(token, content): Promise<void> }`, `class DiscordError extends Error { status }`, `discordApi(applicationId, deps: { fetch; sleep }): DiscordApi`.
  - `alerts.ts`: `type Alert = (signature: string, text: string) => Promise<void>`, `createAlerter(db, telegram: { token?; chatId? }, deps: { fetch; now }): Alert`.
  - `bot.ts`: `interface Bot { db; bucket; renderer: LinkMarineRenderer; discord: DiscordApi; alert: Alert; fetch; sleep; now; random; snapshot: CallsignSnapshot }` (Task 13 adds `data`), `SNAPSHOT`, `createBot(env: Env): Bot`.
  - `marines.ts`: `PLATFORM = 'discord'`, `STEP_MS = 1_000`, `TEXT` (`drawing`, `already`, `stamping(marine)`, `notEnlisted(name)`, `internal`), `revealSteps(tags, tier): string[]`, `cardKey(serial, 'png' | 'gif')`, `stampCard(bot, marine, avatarSource): Promise<Attachment | null>`, `marineCard(bot, marine, avatarSource): Promise<Attachment | null>`, `reveal(bot, token, marine, avatarSource)`, `enlistCommand(bot, interaction)`, `dogtagCommand(bot, interaction)`.
  - `index.ts`: `botHandlers(bot: Bot): Handlers` (each command wrapped: an uncaught error alerts `discord-command:<name>` and answers `TEXT.internal` privately); `NO_HANDLERS` goes.
  - `test/helpers.ts`: `interface DiscordCall { kind: 'edit' | 'private'; content; file?; at }`, `fakeDiscord(clock)`, `ARCHIVE_ROUTES`, `interface FakeBot`, `fakeBot(overrides?)` (D1 and R2 real, sleeping moves a fake clock, seeded randomness, the test `SNAPSHOT`).

- [ ] **Step 1: Write the failing tests and the fake bot.**

In `discord/test/helpers.ts`, replace:

```ts
import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import { simulate, type CallsignSnapshot } from '../src/draw';
import type { CommandOption, Interaction } from '../src/interactions';
```

with:

```ts
import { seededRandom, type LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import type { Bot } from '../src/bot';
import type { Attachment, DiscordApi } from '../src/discord-api';
import { simulate, type CallsignSnapshot } from '../src/draw';
import type { CommandOption, Interaction } from '../src/interactions';
```

In `discord/test/helpers.ts`, replace:

```ts
  return Object.assign(f as typeof fetch, { urls });
}
```

with:

```ts
  return Object.assign(f as typeof fetch, { urls });
}

export interface DiscordCall {
  kind: 'edit' | 'private';
  content: string;
  file?: string;
  at: number;
}

/** Records what the bot sends Discord, and when on the fake clock. */
export function fakeDiscord(clock: { ms: number }): DiscordApi & { calls: DiscordCall[] } {
  const calls: DiscordCall[] = [];
  return {
    calls,
    async editOriginal(_token: string, content: string, file: Attachment | null = null) {
      calls.push({ kind: 'edit', content, ...(file ? { file: file.name } : {}), at: clock.ms });
    },
    async privateFollowup(_token: string, content: string) {
      calls.push({ kind: 'private', content, at: clock.ms });
    },
  };
}

/** Memes and avatars served as images. */
export const ARCHIVE_ROUTES = {
  'https://raw.githubusercontent.com/momentmaker/chainlinkmeme/c0ffee/memes/': () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
  'https://cdn.discordapp.com/': () => new Response(PNG_BYTES),
};

export interface FakeBot extends Bot {
  discord: ReturnType<typeof fakeDiscord>;
  renderer: ReturnType<typeof fakeRenderer>;
  fetch: ReturnType<typeof fakeFetch>;
  alerts: { signature: string; text: string }[];
  clock: { ms: number };
}

/** A bot on the test D1 and R2, with fakes around them; sleeping advances the fake clock. */
export function fakeBot(overrides: Partial<Bot> = {}): FakeBot {
  const clock = { ms: Date.parse('2026-10-13T10:40:00.000Z') };
  const alerts: { signature: string; text: string }[] = [];
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: fakeRenderer(),
    discord: fakeDiscord(clock),
    fetch: fakeFetch(ARCHIVE_ROUTES),
    alert: async (signature, text) => {
      alerts.push({ signature, text });
    },
    sleep: async (ms) => {
      clock.ms += ms;
    },
    now: () => new Date(clock.ms),
    random: seededRandom(42),
    snapshot: SNAPSHOT,
    alerts,
    clock,
    ...overrides,
  } as FakeBot;
}
```

Create `discord/test/discord-api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DISCORD_API, discordApi } from '../src/discord-api';
import { APP } from './helpers';

interface Sent {
  method: string;
  url: string;
  body: unknown;
  files: { name: string; filename: string; type: string; size: number }[];
}

/** Discord as a list of answers, one per request, recording what was sent; multipart bodies are read back. */
function discord(...answers: Response[]) {
  const sent: Sent[] = [];
  const slept: number[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    let body: unknown = null;
    const files: Sent['files'] = [];
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await request.formData();
      body = JSON.parse(form.get('payload_json') as string);
      for (const [name, value] of form) if (typeof value !== 'string') files.push({ name, filename: value.name, type: value.type, size: value.size });
    } else if (init?.body) {
      body = JSON.parse(init.body as string);
    }
    sent.push({ method: request.method, url: request.url, body, files });
    return answers.shift() ?? new Response(null, { status: 204 });
  }) as typeof globalThis.fetch;
  return { api: discordApi(APP, { fetch, sleep: async (ms) => void slept.push(ms) }), sent, slept };
}

const WEBHOOK = `${DISCORD_API}/webhooks/${APP}/tok`;

describe('the Discord webhook client', () => {
  it('edits the deferred reply with text, never pinging anyone', async () => {
    // #given
    const d = discord();
    // #when
    await d.api.editOriginal('tok', 'Drawing your callsign… ▮▮▮');
    // #then
    expect(d.sent).toEqual([{ method: 'PATCH', url: `${WEBHOOK}/messages/@original`, body: { content: 'Drawing your callsign… ▮▮▮', allowed_mentions: { parse: [] }, attachments: [] }, files: [] }]);
  });

  it('edits in an image as multipart: payload_json naming attachment 0, and files[0]', async () => {
    // #given
    const d = discord();
    // #when
    await d.api.editOriginal('tok', 'painting-space-prophecy', { name: 'marine-7.gif', type: 'image/gif', bytes: new Uint8Array(12) });
    // #then
    expect(d.sent).toEqual([
      {
        method: 'PATCH',
        url: `${WEBHOOK}/messages/@original`,
        body: { content: 'painting-space-prophecy', allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: 'marine-7.gif' }] },
        files: [{ name: 'files[0]', filename: 'marine-7.gif', type: 'image/gif', size: 12 }],
      },
    ]);
  });

  it("answers privately by deleting the loading message first, since Discord would edit it instead and ignore the flag", async () => {
    // #given
    const d = discord();
    // #when
    await d.api.privateFollowup('tok', 'No chain called \'x\' on CCIP.');
    // #then
    expect(d.sent.map((s) => [s.method, s.url, s.body])).toEqual([
      ['DELETE', `${WEBHOOK}/messages/@original`, null],
      ['POST', WEBHOOK, { content: "No chain called 'x' on CCIP.", flags: 64, allowed_mentions: { parse: [] } }],
    ]);
  });

  it("waits out a 429's retry_after once, at most 10 s, sending the whole message again; a second 429 fails", async () => {
    // #given
    const limited = (seconds: number) => new Response(JSON.stringify({ retry_after: seconds, global: false }), { status: 429 });
    const d = discord(limited(0.35), new Response(null, { status: 200 }), limited(60), new Response(null, { status: 200 }), limited(1), limited(1));
    // #when
    await d.api.editOriginal('tok', 'PAINTING ▮▮');
    await d.api.editOriginal('tok', 'PAINTING · SPACE ▮', { name: 'x.png', type: 'image/png', bytes: new Uint8Array(3) });
    const third = d.api.editOriginal('tok', 'again');
    // #then
    await expect(third).rejects.toThrow('Discord returned HTTP 429');
    expect({ slept: d.slept, requests: d.sent.length, resent: d.sent[3]!.files }).toEqual({ slept: [350, 10_000, 1000], requests: 6, resent: [{ name: 'files[0]', filename: 'x.png', type: 'image/png', size: 3 }] });
  });

  it('throws what Discord said when an edit fails', async () => {
    // #given an expired token
    const d = discord(new Response('{"message": "Unknown Webhook", "code": 10015}', { status: 404 }));
    // #then
    await expect(d.api.editOriginal('tok', 'x')).rejects.toThrow('Discord returned HTTP 404: {"message": "Unknown Webhook", "code": 10015}');
  });
});
```

Create `discord/test/alerts.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAlerter } from '../src/alerts';
import { resetStorage } from './helpers';

beforeEach(resetStorage);

function telegram(status = 200) {
  const sent: { url: string; body: { chat_id: string; text: string } }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(init!.body as string) });
    return new Response('{}', { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

describe('alerts', () => {
  it('sends each signature to the alert chat once an hour', async () => {
    // #given
    const t = telegram();
    let now = Date.parse('2026-10-13T10:00:00.000Z');
    const alert = createAlerter(env.DB, { token: 'bot', chatId: '-100' }, { fetch: t.fetch, now: () => new Date(now) });
    // #when
    await alert('discord-data:today.json', 'today.json: HTTP 503');
    await alert('discord-data:today.json', 'today.json: HTTP 503');
    await alert('discord-render:sitrep', 'the sitrep card failed');
    now += 3_600_000;
    await alert('discord-data:today.json', 'today.json: HTTP 503');
    // #then
    expect(t.sent.map((s) => [s.url, s.body.chat_id, s.body.text])).toEqual([
      ['https://api.telegram.org/botbot/sendMessage', '-100', 'ccip.dev discord alert: today.json: HTTP 503'],
      ['https://api.telegram.org/botbot/sendMessage', '-100', 'ccip.dev discord alert: the sitrep card failed'],
      ['https://api.telegram.org/botbot/sendMessage', '-100', 'ccip.dev discord alert: today.json: HTTP 503'],
    ]);
  });

  it('lets the next alert retry when Telegram fails, and only logs without the secrets', async () => {
    // #given
    const down = telegram(502);
    const up = telegram();
    const now = () => new Date('2026-10-13T10:00:00.000Z');
    // #when
    await createAlerter(env.DB, { token: 'bot', chatId: '-100' }, { fetch: down.fetch, now })('discord-memes', 'GitHub is down');
    await createAlerter(env.DB, { token: 'bot', chatId: '-100' }, { fetch: up.fetch, now })('discord-memes', 'GitHub is down');
    await createAlerter(env.DB, {}, { fetch: up.fetch, now })('discord-draw', 'every draw clashed');
    // #then
    expect([down.sent.length, up.sent.length]).toEqual([1, 1]);
  });
});
```

Create `discord/test/marines.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CallsignSnapshot } from '../src/draw';
import { dogtagCommand, enlistCommand, revealSteps, STEP_MS, TEXT } from '../src/marines';
import { findMarine } from '../src/store';
import { ARCHIVE_ROUTES, command, fakeBot, fakeFetch, fakeRenderer, GIF_BYTES, PNG_BYTES, resetStorage, SNAPSHOT } from './helpers';

const ME = '1400000000000000004';
const OTHER = '1500000000000000005';
/** Every draw from this snapshot is Legendary. */
const LEGENDARY: CallsignSnapshot = { ...SNAPSHOT, cutoffs: { uncommon: 0, rare: 0, legendary: 0 } };
/** Three tags only, so every Marine after the first clashes. */
const THREE_TAGS: CallsignSnapshot = { ...SNAPSHOT, tags: SNAPSHOT.tags.slice(0, 3) };

const other = (id = OTHER) => command('dogtag', [{ name: 'marine', type: 6, value: id }], {
  data: { name: 'dogtag', options: [{ name: 'marine', type: 6, value: id }], resolved: { users: { [id]: { id, username: 'rory', avatar: null } }, members: { [id]: { nick: 'Rory' } } } },
});

beforeEach(resetStorage);

describe('the reveal', () => {
  it('stamps the tags one by one, a Rare or Legendary banner on the last', () => {
    // #then
    expect([revealSteps(['painting', 'space', 'prophecy'], 'legendary'), revealSteps(['clown', 'rory', 'pepe'], 'common')]).toEqual([
      ['PAINTING ▮▮', 'PAINTING · SPACE ▮', '⚠ LEGENDARY DRAW\nPAINTING · SPACE · PROPHECY'],
      ['CLOWN ▮▮', 'CLOWN · RORY ▮', 'CLOWN · RORY · PEPE'],
    ]);
  });

  it('saves the draw, edits the reply a second apart, then edits in the card with the callsign', async () => {
    // #given
    const bot = fakeBot();
    const t0 = bot.clock.ms;
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    const steps = revealSteps(marine.tags, marine.tier);
    expect({
      calls: bot.discord.calls,
      saved: [marine.serial, marine.displayName, marine.snapshotVersion, marine.cardKey],
      stored: await Promise.all(['cards/1.png', 'avatars/1.png'].map(async (k) => (await env.MARINES.head(k)) !== null)),
    }).toEqual({
      calls: [
        { kind: 'edit', content: TEXT.drawing, at: t0 },
        ...steps.map((content, i) => ({ kind: 'edit', content, at: t0 + (i + 1) * STEP_MS })),
        { kind: 'edit', content: marine.callsign, file: marine.tier === 'rare' || marine.tier === 'legendary' ? 'marine-1.gif' : 'marine-1.png', at: t0 + 4 * STEP_MS },
      ],
      saved: [1, 'moment maker', 3, 'cards/1.png'],
      stored: [true, true],
    });
  });

  it('banners a Legendary draw and posts its glint, keeping the static card beside it', async () => {
    // #given
    const bot = fakeBot({ snapshot: LEGENDARY });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const gif = await env.MARINES.get('cards/1.gif');
    expect({
      banner: bot.discord.calls[3]!.content.startsWith('⚠ LEGENDARY DRAW\n'),
      posted: bot.discord.calls.at(-1)!.file,
      gif: gif && [...new Uint8Array(await gif.arrayBuffer())],
      png: (await env.MARINES.head('cards/1.png')) !== null,
      rendered: bot.renderer.calls.filter((c) => c !== 'prepareMeme').sort(),
    }).toEqual({ banner: true, posted: 'marine-1.gif', gif: [...GIF_BYTES], png: true, rendered: ['renderMarineCard', 'renderMarineGlint'] });
  });

  it('keeps the draw when the card fails to render: says the tag is being stamped, and alerts', async () => {
    // #given
    const bot = fakeBot({ renderer: fakeRenderer('renderMarineCard') });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1), cardKey: marine.cardKey, alerts: bot.alerts.map((a) => a.signature) }).toEqual({
      last: { kind: 'edit', content: TEXT.stamping(marine), at: bot.clock.ms },
      cardKey: null,
      alerts: ['discord-render:marine'],
    });
  });

  it('keeps the draw when GitHub is down: no card, and a discord-memes alert', async () => {
    // #given
    const bot = fakeBot({ fetch: fakeFetch({ 'https://cdn.discordapp.com/': ARCHIVE_ROUTES['https://cdn.discordapp.com/'] }) });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1)!.content, alerts: bot.alerts.map((a) => a.signature), rendered: bot.renderer.calls }).toEqual({ last: TEXT.stamping(marine), alerts: ['discord-memes'], rendered: [] });
  });

  it('answers a Marine who enlists again with their own card, drawing nothing', async () => {
    // #given
    await enlistCommand(fakeBot(), command('enlist'));
    const bot = fakeBot();
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]), rendered: bot.renderer.calls, marines: (await env.DB.prepare('SELECT COUNT(*) AS n FROM marines').first<{ n: number }>())?.n }).toEqual({
      calls: [['edit', TEXT.already, expect.stringMatching(/^marine-1\.(png|gif)$/)]],
      rendered: [],
      marines: 1,
    });
  });

  it('reports privately and alerts when every draw clashes with a callsign already taken', async () => {
    // #given the only three tags are someone else's
    await enlistCommand(fakeBot({ snapshot: THREE_TAGS }), command('enlist', [], { member: { user: { id: OTHER, username: 'rory' } } }));
    const bot = fakeBot({ snapshot: THREE_TAGS });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), alerts: bot.alerts.map((a) => a.signature) }).toEqual({ calls: [['private', TEXT.internal]], alerts: ['discord-draw'] });
  });
});

describe('/dogtag', () => {
  it("shows another member's card from R2, the glint for a Legendary", async () => {
    // #given
    await enlistCommand(fakeBot({ snapshot: LEGENDARY }), command('enlist', [], { member: { user: { id: OTHER, username: 'rory' } } }));
    const bot = fakeBot({ snapshot: LEGENDARY });
    // #when
    await dogtagCommand(bot, other());
    // #then
    const marine = (await findMarine(env.DB, 'discord', OTHER))!;
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]), rendered: bot.renderer.calls }).toEqual({ calls: [['edit', marine.callsign, 'marine-1.gif']], rendered: [] });
  });

  it("says publicly that another member hasn't enlisted, and privately when it is the one asking", async () => {
    // #given
    const [asked, self] = [fakeBot(), fakeBot()];
    // #when
    await dogtagCommand(asked, other());
    await dogtagCommand(self, command('dogtag'));
    // #then
    expect([asked.discord.calls.map((c) => [c.kind, c.content]), self.discord.calls.map((c) => [c.kind, c.content])]).toEqual([
      [['edit', TEXT.notEnlisted('Rory')]],
      [['private', TEXT.notEnlisted('moment maker')]],
    ]);
  });

  it('stamps on demand a card that failed at enlistment, with the avatar kept then', async () => {
    // #given an enlistment whose card failed
    await enlistCommand(fakeBot({ renderer: fakeRenderer('renderMarineCard') }), command('enlist'));
    const bot = fakeBot();
    // #when
    await dogtagCommand(bot, command('dogtag'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    const avatar = await env.MARINES.get('avatars/1.png');
    expect({
      calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]),
      cardKey: marine.cardKey,
      avatar: avatar && [...new Uint8Array(await avatar.arrayBuffer())],
      avatarUrl: bot.fetch.urls.find((u) => u.includes('cdn.discordapp.com')),
    }).toEqual({
      calls: [['edit', marine.callsign, expect.stringMatching(/^marine-1\.(png|gif)$/)]],
      cardKey: 'cards/1.png',
      avatar: [...PNG_BYTES],
      avatarUrl: `https://cdn.discordapp.com/avatars/${ME}/abc.png?size=128`,
    });
  });

  it('answers privately when the card still cannot be drawn', async () => {
    // #given
    await enlistCommand(fakeBot({ renderer: fakeRenderer('renderMarineCard') }), command('enlist'));
    const bot = fakeBot({ renderer: fakeRenderer('renderMarineCard') });
    // #when
    await dogtagCommand(bot, command('dogtag'));
    // #then
    expect(bot.discord.calls.map((c) => [c.kind, c.content])).toEqual([['private', TEXT.internal]]);
  });
});
```

- [ ] **Step 2: Run the flow test and confirm it fails.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/marines.test.ts`
Expected: FAIL: `../src/marines` does not exist.

- [ ] **Step 3: Add the webhook client, the alerts and the bot.**

Create `discord/src/discord-api.ts`:

```ts
import { EPHEMERAL } from './interactions';

export const DISCORD_API = 'https://discord.com/api/v10';
/** At most this long on one 429, whatever retry_after says: the interaction token outlives it many times over. */
const RETRY_CAP_MS = 10_000;

export interface Attachment {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface DiscordApi {
  /** Edits the deferred reply: text, and an image to replace any before it. */
  editOriginal(token: string, content: string, file?: Attachment | null): Promise<void>;
  /** A reply only the invoker sees. After a public defer, the loading message is deleted first, or Discord would edit it instead. */
  privateFollowup(token: string, content: string): Promise<void>;
}

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Discord returned HTTP ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    this.name = 'DiscordError';
  }
}

const NO_MENTIONS = { parse: [] as string[] };

export function discordApi(applicationId: string, deps: { fetch: typeof fetch; sleep: (ms: number) => Promise<void> }): DiscordApi {
  const webhook = (token: string) => `${DISCORD_API}/webhooks/${applicationId}/${token}`;

  async function send(url: string, init: () => RequestInit): Promise<void> {
    let res = await deps.fetch(url, init());
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: unknown };
      const seconds = typeof body.retry_after === 'number' && body.retry_after > 0 ? body.retry_after : 1;
      await deps.sleep(Math.min(seconds * 1000, RETRY_CAP_MS));
      res = await deps.fetch(url, init());
    }
    if (!res.ok) throw new DiscordError(res.status, await res.text().catch(() => ''));
  }

  return {
    editOriginal(token, content, file = null) {
      return send(`${webhook(token)}/messages/@original`, () => {
        if (!file) return { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: NO_MENTIONS, attachments: [] }) };
        const form = new FormData();
        form.append('payload_json', JSON.stringify({ content, allowed_mentions: NO_MENTIONS, attachments: [{ id: 0, filename: file.name }] }));
        form.append('files[0]', new Blob([file.bytes], { type: file.type }), file.name);
        return { method: 'PATCH', body: form };
      });
    },
    async privateFollowup(token, content) {
      await send(`${webhook(token)}/messages/@original`, () => ({ method: 'DELETE' }));
      await send(webhook(token), () => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, flags: EPHEMERAL, allowed_mentions: NO_MENTIONS }) }));
    },
  };
}
```

Create `discord/src/alerts.ts`:

```ts
export type Alert = (signature: string, text: string) => Promise<void>;

const SUPPRESS_MS = 3_600_000;
const MAX_TEXT_LENGTH = 3500;

/**
 * Each signature goes to the alert chat at most once an hour, as the data Worker's alerts do: the suppression row in
 * meta is claimed before sending, and released when the send fails so the next alert retries. Without the Telegram
 * secrets the alert is only logged.
 */
export function createAlerter(db: D1Database, telegram: { token?: string; chatId?: string }, deps: { fetch: typeof fetch; now: () => Date }): Alert {
  return async (signature, text) => {
    const key = `alert:${signature}`;
    const now = deps.now();
    const claim = now.toISOString();
    const stale = new Date(now.getTime() - SUPPRESS_MS).toISOString();
    const claimed = await db
      .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?3')
      .bind(key, claim, stale)
      .run();
    if (claimed.meta.changes === 0) return;
    if (!telegram.token || !telegram.chatId) {
      console.warn(`[alert] ${text}`);
      return;
    }
    let failure: string | null = null;
    try {
      const res = await deps.fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.chatId, text: `ccip.dev discord alert: ${text}`.slice(0, MAX_TEXT_LENGTH) }),
      });
      if (!res.ok) failure = `Telegram returned HTTP ${res.status}`;
    } catch (err) {
      failure = `Telegram request failed (${err instanceof Error ? err.name : 'unknown error'})`;
    }
    if (failure) {
      console.error(`[alert] ${failure} for ${signature}: ${text}`);
      await db.prepare('DELETE FROM meta WHERE key = ? AND value = ?').bind(key, claim).run();
    }
  };
}
```

Create `discord/src/bot.ts`:

```ts
import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { createAlerter, type Alert } from './alerts';
import { discordApi, type DiscordApi } from './discord-api';
import { cryptoRandom, type CallsignSnapshot } from './draw';
import type { Env } from './env';
import snapshot from './data/callsigns.json';

/** Everything a command needs, so tests can hand it fakes. */
export interface Bot {
  db: D1Database;
  bucket: R2Bucket;
  renderer: LinkMarineRenderer;
  discord: DiscordApi;
  alert: Alert;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  random: () => number;
  snapshot: CallsignSnapshot;
}

export const SNAPSHOT = snapshot as CallsignSnapshot;

export function createBot(env: Env): Bot {
  const fetchFn: typeof fetch = (input, init) => fetch(input, init);
  const now = () => new Date();
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: env.SITE,
    discord: discordApi(env.DISCORD_APPLICATION_ID ?? '', { fetch: fetchFn, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }),
    alert: createAlerter(env.DB, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, { fetch: fetchFn, now }),
    fetch: fetchFn,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now,
    random: cryptoRandom,
    snapshot: SNAPSHOT,
  };
}
```

- [ ] **Step 4: Add the Marine commands and route them.**

Create `discord/src/marines.ts`:

```ts
import { hasGlint, serialText, type MarineCard, type Tier } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import type { Attachment } from './discord-api';
import { drawCallsign, drawLore, pickMemes } from './draw';
import { avatarUrl, displayName, invoker, optionValue, type DiscordMember, type DiscordUser, type Interaction } from './interactions';
import { loadMemes, memeKey, stockMemes } from './memes';
import { enlist, findMarine, setCardKey, type Drafted, type Marine } from './store';

export const PLATFORM = 'discord';
/** Discord answers webhook edits faster than this, but the reveal waits at least this long between them. */
export const STEP_MS = 1_000;

export const TEXT = {
  drawing: 'Drawing your callsign… ▮▮▮',
  already: "You're already enlisted, Marine.",
  stamping: (m: Marine) => `You're \`${m.callsign}\`, Marine #${serialText(m.serial)}. Your tag is being stamped; run \`/dogtag\` in a minute.`,
  notEnlisted: (name: string) => `${name} hasn't enlisted yet. \`/enlist\``,
  internal: "Something went wrong. It's been reported.",
} as const;

/** After "Drawing…": the tags stamped one by one, a Rare or Legendary banner on the last. */
export function revealSteps(tags: readonly string[], tier: Tier): string[] {
  const up = tags.map((t) => t.toUpperCase());
  const last = up.join(' · ');
  const banner = tier === 'legendary' ? '⚠ LEGENDARY DRAW' : tier === 'rare' ? '⚠ RARE DRAW' : null;
  return [`${up[0]} ▮▮`, `${up[0]} · ${up[1]} ▮`, banner ? `${banner}\n${last}` : last];
}

export const cardKey = (serial: number, ext: 'png' | 'gif') => `cards/${serial}.${ext}`;
const AVATAR_TIMEOUT_MS = 5_000;
const avatarKey = (serial: number) => `avatars/${serial}.png`;

function draft(bot: Bot): Drafted {
  const draw = drawCallsign(bot.snapshot, bot.random);
  const files = pickMemes(bot.snapshot, draw.tags, draw.callsign);
  return {
    draw,
    memes: draw.tags.map((tag, i) => ({ tag, file: files[i]!, key: memeKey(files[i]!) })),
    blood: drawLore(bot.snapshot.lore.blood, bot.random),
    faith: drawLore(bot.snapshot.lore.faith, bot.random),
  };
}

async function readBytes(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

/** The avatar kept at enlistment; a fresh one is fetched and kept when its URL is known, and a failed fetch leaves the gradient disc. */
async function avatar(bot: Bot, serial: number, url: string | null): Promise<Uint8Array | null> {
  if (url) {
    try {
      const res = await bot.fetch(url, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        await bot.bucket.put(avatarKey(serial), bytes, { httpMetadata: { contentType: 'image/png' } });
        return bytes;
      }
    } catch (err) {
      console.warn(`avatar for Marine ${serial}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return readBytes(bot.bucket, avatarKey(serial));
}

/**
 * Stamps a Marine's card: copies the memes, renders the card (and the glint for Rare and up), keeps them in R2 and
 * records the card. Returns the image to post, or null when it could not, having alerted.
 */
export async function stampCard(bot: Bot, marine: Marine, avatarSource: string | null): Promise<Attachment | null> {
  try {
    await stockMemes(bot.bucket, bot.renderer, bot.fetch, bot.snapshot.archive, marine.memes);
  } catch (err) {
    await bot.alert('discord-memes', `memes for Marine #${marine.serial} could not be copied: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const pngs = await loadMemes(bot.bucket, marine.memes);
  if (!pngs) return null;
  const count = (tag: string) => bot.snapshot.tags.find((t) => t.tag === tag)?.count ?? 1;
  const card: MarineCard = {
    serial: marine.serial,
    callsign: marine.callsign,
    tier: marine.tier,
    percentile: marine.percentile,
    memes: marine.memes.map((m, i) => ({ tag: m.tag, count: count(m.tag), png: pngs[i]! })),
    blood: marine.blood,
    faith: marine.faith,
    name: marine.displayName,
    enlistedAt: marine.enlistedAt,
    avatar: await avatar(bot, marine.serial, avatarSource),
  };
  try {
    const [png, gif] = await Promise.all([bot.renderer.renderMarineCard(card), hasGlint(marine.tier) ? bot.renderer.renderMarineGlint(card) : Promise.resolve(null)]);
    await bot.bucket.put(cardKey(marine.serial, 'png'), png, { httpMetadata: { contentType: 'image/png' } });
    if (gif) await bot.bucket.put(cardKey(marine.serial, 'gif'), gif, { httpMetadata: { contentType: 'image/gif' } });
    await setCardKey(bot.db, marine.serial, cardKey(marine.serial, 'png'));
    return gif ? { name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: gif } : { name: `marine-${marine.serial}.png`, type: 'image/png', bytes: png };
  } catch (err) {
    await bot.alert('discord-render:marine', `Marine #${marine.serial}'s card failed to render: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The stamped card, animated when there is a glint; stamped now when it is missing. */
export async function marineCard(bot: Bot, marine: Marine, avatarSource: string | null): Promise<Attachment | null> {
  if (marine.cardKey) {
    const gif = hasGlint(marine.tier) ? await readBytes(bot.bucket, cardKey(marine.serial, 'gif')) : null;
    if (gif) return { name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: gif };
    const png = await readBytes(bot.bucket, marine.cardKey);
    if (png) return { name: `marine-${marine.serial}.png`, type: 'image/png', bytes: png };
  }
  return stampCard(bot, marine, avatarSource);
}

/** The reveal: the draw is already saved; the card renders while the tags are stamped, a second apart, then it is edited in. */
export async function reveal(bot: Bot, token: string, marine: Marine, avatarSource: string | null): Promise<void> {
  const stamping = stampCard(bot, marine, avatarSource);
  await bot.discord.editOriginal(token, TEXT.drawing);
  for (const step of revealSteps(marine.tags, marine.tier)) {
    await bot.sleep(STEP_MS);
    await bot.discord.editOriginal(token, step);
  }
  const [card] = await Promise.all([stamping, bot.sleep(STEP_MS)]);
  await bot.discord.editOriginal(token, card ? marine.callsign : TEXT.stamping(marine), card);
}

export async function enlistCommand(bot: Bot, interaction: Interaction): Promise<void> {
  const who = invoker(interaction);
  if (!who) throw new Error('an interaction without a user');
  const result = await enlist(
    bot.db,
    { platform: PLATFORM, userId: who.user.id, displayName: displayName(who.user, who.member), enlistedAt: bot.now().toISOString(), snapshotVersion: bot.snapshot.version },
    () => draft(bot),
  );
  const source = avatarUrl(who.user, who.member, interaction.guild_id);
  if (result.kind === 'clashed') {
    await bot.alert('discord-draw', `every one of 20 draws for ${who.user.id} clashed with a callsign already taken`);
    await bot.discord.privateFollowup(interaction.token, TEXT.internal);
  } else if (result.kind === 'already') {
    const card = await marineCard(bot, result.marine, source);
    await bot.discord.editOriginal(interaction.token, card ? TEXT.already : TEXT.stamping(result.marine), card);
  } else {
    await reveal(bot, interaction.token, result.marine, source);
  }
}

function target(interaction: Interaction): { user: DiscordUser; member: DiscordMember | null; self: boolean } | null {
  const who = invoker(interaction);
  const id = optionValue(interaction, 'marine');
  if (!who) return null;
  if (!id || id === who.user.id) return { ...who, self: true };
  const user = interaction.data?.resolved?.users?.[id];
  return user ? { user, member: interaction.data?.resolved?.members?.[id] ?? null, self: false } : null;
}

export async function dogtagCommand(bot: Bot, interaction: Interaction): Promise<void> {
  const whose = target(interaction);
  if (!whose) throw new Error('/dogtag without a resolvable user');
  const marine = await findMarine(bot.db, PLATFORM, whose.user.id);
  if (!marine) {
    const text = TEXT.notEnlisted(displayName(whose.user, whose.member));
    await (whose.self ? bot.discord.privateFollowup(interaction.token, text) : bot.discord.editOriginal(interaction.token, text));
    return;
  }
  const card = await marineCard(bot, marine, avatarUrl(whose.user, whose.member, interaction.guild_id));
  if (card) await bot.discord.editOriginal(interaction.token, marine.callsign, card);
  else await bot.discord.privateFollowup(interaction.token, TEXT.internal);
}
```

In `discord/src/index.ts`, replace:

```ts
import type { Env } from './env';
import { deferred, InteractionType, json, privateReply, ResponseType, type Interaction } from './interactions';
import { verifyDiscordRequest } from './verify';

```

with:

```ts
import { createBot, type Bot } from './bot';
import type { Env } from './env';
import { deferred, InteractionType, json, privateReply, ResponseType, type Interaction } from './interactions';
import { dogtagCommand, enlistCommand, TEXT } from './marines';
import { verifyDiscordRequest } from './verify';

```

In `discord/src/index.ts`, replace:

```ts
}

/** Until the commands exist: none, and no suggestions. */
export const NO_HANDLERS: Handlers = { commands: {}, autocomplete: async () => [] };

export default {
```

with:

```ts
}

/** A command that fails unexpectedly is reported to the alert chat and answered privately. */
function guarded(bot: Bot, command: (bot: Bot, interaction: Interaction) => Promise<void>): (interaction: Interaction) => Promise<void> {
  return async (interaction) => {
    try {
      await command(bot, interaction);
    } catch (err) {
      const name = interaction.data?.name ?? 'unknown';
      console.error(`/${name} failed: ${err instanceof Error ? err.stack : String(err)}`);
      try {
        await bot.alert(`discord-command:${name}`, `/${name} failed: ${err instanceof Error ? err.message : String(err)}`);
        await bot.discord.privateFollowup(interaction.token, TEXT.internal);
      } catch (reportErr) {
        console.error(`/${name}: the failure could not be reported: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`);
      }
    }
  };
}

export function botHandlers(bot: Bot): Handlers {
  return {
    commands: { enlist: guarded(bot, enlistCommand), dogtag: guarded(bot, dogtagCommand) },
    autocomplete: async () => [],
  };
}

export default {
```

In `discord/src/index.ts`, replace:

```ts
    const valid = await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY ?? '', request.headers.get('X-Signature-Ed25519'), request.headers.get('X-Signature-Timestamp'), body);
    if (!valid) return new Response('Invalid request signature', { status: 401 });
    return handleInteraction(JSON.parse(body) as Interaction, env.DISCORD_GUILD_ID, NO_HANDLERS, (work) => ctx.waitUntil(work));
  },
} satisfies ExportedHandler<Env>;
```

with:

```ts
    const valid = await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY ?? '', request.headers.get('X-Signature-Ed25519'), request.headers.get('X-Signature-Timestamp'), body);
    if (!valid) return new Response('Invalid request signature', { status: 401 });
    return handleInteraction(JSON.parse(body) as Interaction, env.DISCORD_GUILD_ID, botHandlers(createBot(env)), (work) => ctx.waitUntil(work));
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (49 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add discord/src/discord-api.ts discord/src/alerts.ts discord/src/bot.ts discord/src/marines.ts discord/src/index.ts discord/test/helpers.ts discord/test/discord-api.test.ts discord/test/alerts.test.ts discord/test/marines.test.ts
git commit -m "feat(discord): /enlist with its reveal and /dogtag, over Discord's webhook API" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 12: The intel numbers

Pure functions from the public files to the four cards' inputs (spec §7): today's pace, a chain's rank, totals, week and partners (both directions, from `replay.json`), the Reserve's vault, and the five all-time records by the Records page's own `recordValue`. The fixtures are small: `today.json` and `reserve.json` trimmed from data.ccip.dev on 13 Oct 2026, and a made-up `history.json`, `replay.json` and `top/src_chain.json` whose numbers can be checked by hand.

**Files:**
- Create: `discord/src/intel.ts`
- Test: `discord/test/fixtures/intel.ts`, `discord/test/intel.test.ts`

**Interfaces:**
- Consumes: Task 1 (`type SitrepCard`, `type DossierCard`, `type VaultCard`, `type RecordsCard`, `type RecordMedal`, `type IntelChain`); live code `chainName`, `chainNameMap`, `shortChainName`, `type ChainNames` (`@ccip-dev/core/names`), `RECORD_KINDS`, `recordValue` (`@ccip-dev/core/records`), `addDays`, `dayOf`, `weekStart` (`@ccip-dev/core/time`), the public file types (`@ccip-dev/core/public`).
- Produces (`intel.ts`):
  - `sitrepCard(today: TodayFile, history: HistoryFile, chains: ChainsFile): SitrepCard` (no pace before 01:00 UTC; no yesterday unless history.json's last day is yesterday; the five biggest lanes by value);
  - `chainTotals(replay, from: string | null, to: string | null): Map<string, { messages; usd }>`;
  - `findChain(chains, query): Chain | null` (display name, " Mainnet", registry name or selector, any case);
  - `MAX_CHOICES = 25`, `chainChoices(chains, typed): { name: string; value: string }[]` (value: the selector);
  - `dossierCard(selector, replay: ReplayFile, sources: TopFile, chains): DossierCard | null`;
  - `weeklyDeposits(reserve: ReserveFile): number[]`, `vaultCard(reserve): VaultCard | null`;
  - `recordsCard(history, chains): RecordsCard`.

- [ ] **Step 1: Write the fixtures and the failing test.**

Create `discord/test/fixtures/intel.ts`:

```ts
import type { ChainsFile, HistoryFile, ReplayFile, ReserveFile, TodayFile, TopFile } from '@ccip-dev/core/public';

// Small public files for the intel math. today.json and reserve.json are trimmed from data.ccip.dev on Tue 13 Oct 2026;
// history.json, replay.json and top/src_chain.json are made up, small enough to check by hand.

export const ETH = '5009297550715157269';
export const BASE = '15971525489660198786';
export const ARB = '4949039107694359620';
export const MONAD = '8481857512324358265';
export const AVAX = '6433500567565415381';
export const PLASMA = '9335212494177455608';
export const WEMIX = '5142893604156789321';

const envelope = { schema_version: 1 as const, attribution: 'Data: Chainlink CCIP API, DefiLlama' };

export const CHAINS: ChainsFile = {
  ...envelope,
  updated_at: '2026-10-13T06:01:00.177Z',
  chains: [
    { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', family: 'EVM', chain_id: '1', first_seen: '2023-07-06T22:34:59.000Z' },
    { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet', family: 'EVM', chain_id: '8453', first_seen: '2023-09-16T23:37:29.000Z' },
    { selector: ARB, name: 'ethereum-mainnet-arbitrum-1', display_name: 'Arbitrum Mainnet', family: 'EVM', chain_id: '42161', first_seen: '2023-09-17T00:15:47.000Z' },
    { selector: MONAD, name: 'monad-mainnet', display_name: 'Monad Mainnet', family: 'EVM', chain_id: '143', first_seen: '2025-08-28T17:38:54.000Z' },
    { selector: AVAX, name: 'avalanche-mainnet', display_name: 'Avalanche Mainnet', family: 'EVM', chain_id: '43114', first_seen: '2023-07-07T00:06:34.000Z' },
    { selector: PLASMA, name: 'plasma-mainnet', display_name: 'Plasma Mainnet', family: 'EVM', chain_id: '9745', first_seen: '2025-09-25T12:00:00.000Z' },
    { selector: WEMIX, name: 'wemix-mainnet', display_name: 'WEMIX Mainnet', family: 'EVM', chain_id: '1111', first_seen: '2023-11-20T00:00:00.000Z' },
  ],
};

export const TODAY: TodayFile = {
  ...envelope,
  updated_at: '2026-10-13T11:28:01.860Z',
  day: '2026-10-13',
  totals: { day: '2026-10-13', messages: 685, token_messages: 439, usd_value: 44064348.04, fee_usd: 419.36, unique_senders: 211, median_delivery_s: 820, unpriced_messages: 15, fee_link_usd: 1.04, fee_link_share_pct: 0.25 },
  top: {
    lane: [
      { key: '8481857512324358265>5009297550715157269', messages: 9, usd: 16298903.16 },
      { key: '5009297550715157269>8481857512324358265', messages: 22, usd: 10704140.65 },
      { key: '5009297550715157269>9335212494177455608', messages: 6, usd: 6754321.91 },
      { key: '8481857512324358265>6433500567565415381', messages: 5, usd: 1999585.26 },
      { key: '8481857512324358265>9335212494177455608', messages: 3, usd: 1468701.01 },
      { key: '5009297550715157269>6433500567565415381', messages: 9, usd: 1332827.23 },
      { key: `${AVAX}>${ETH}`, messages: 40, usd: null },
    ],
    token: [],
    sender: [],
  },
  arrivals: [],
};

/**
 * Records: the busiest day 2026-02-22, the biggest 2026-04-20, the most fees 2026-07-09 (the newest), the largest fee
 * 2025-08-19 and the highest LINK share 2023-07-08 (2023-07-06's 100% is on fewer than 100 messages).
 */
export const HISTORY: HistoryFile = {
  ...envelope,
  updated_at: '2026-10-13T06:01:00.177Z',
  since: '2023-07-06',
  days: [
    { day: '2023-07-06', messages: 50, token_messages: 0, usd_value: 1_000_000, fee_usd: 100, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 100 },
    { day: '2023-07-08', messages: 120, token_messages: 0, usd_value: 2_000_000, fee_usd: 200, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 200 },
    { day: '2026-02-22', messages: 47414, token_messages: 0, usd_value: 50_000_000, fee_usd: 10_000, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 100 },
    { day: '2026-04-20', messages: 3000, token_messages: 0, usd_value: 330_226_186.84, fee_usd: 20_000, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 50 },
    { day: '2026-07-09', messages: 2500, token_messages: 0, usd_value: 40_000_000, fee_usd: 57_347.81, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 10 },
    { day: '2026-10-11', messages: 1500, token_messages: 0, usd_value: 30_000_000, fee_usd: 400, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 1 },
    { day: '2026-10-12', messages: 1625, token_messages: 0, usd_value: 35_000_000, fee_usd: 420, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 1 },
  ],
  largest_fees: [
    { message_id: '0x3265', day: '2025-08-19', src: WEMIX, dst: ETH, fee_usd: 9002.29, symbol: 'WWEMIX' },
    { message_id: '0x0059', day: '2025-10-10', src: ARB, dst: ETH, fee_usd: 1660.73, symbol: null },
  ],
};

/**
 * Lanes 0 ETH→Base, 1 Base→ETH, 2 Base→Monad, 3 Avalanche→Base, 4 ETH→Arbitrum, 5 Monad→ETH. All time, by value both
 * ways: Ethereum $44M, Arbitrum $29M, Base $12.9M (225 messages), Monad $5.5M, Avalanche $0.4M. Base's last 7 days
 * (Oct 6–12): 115 messages, $10.9M, with Ethereum $9M, Monad $1.5M and Avalanche $0.4M.
 */
export const REPLAY: ReplayFile = {
  ...envelope,
  updated_at: '2026-10-13T06:01:00.177Z',
  since: '2023-07-06',
  chains: [
    { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', first_day: '2023-07-06' },
    { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet', first_day: '2023-09-16' },
    { selector: ARB, name: 'ethereum-mainnet-arbitrum-1', display_name: 'Arbitrum Mainnet', first_day: '2023-09-17' },
    { selector: MONAD, name: 'monad-mainnet', display_name: 'Monad Mainnet', first_day: '2025-08-28' },
    { selector: AVAX, name: 'avalanche-mainnet', display_name: 'Avalanche Mainnet', first_day: '2023-07-07' },
  ],
  lanes: [[0, 1], [1, 0], [1, 3], [4, 1], [0, 2], [3, 0]],
  days: [
    { day: '2023-09-16', lanes: [[0, 10, 1_000_000]] },
    { day: '2026-10-05', lanes: [[0, 100, 1_000_000], [4, 50, 9_000_000]] },
    { day: '2026-10-06', lanes: [[1, 20, 2_000_000], [2, 5, 500_000]] },
    { day: '2026-10-07', lanes: [[3, 7, 300_000]] },
    { day: '2026-10-08', lanes: [[5, 40, 4_000_000]] },
    { day: '2026-10-09', lanes: [[0, 30, 3_000_000]] },
    { day: '2026-10-10', lanes: [[2, 10, 1_000_000], [4, 60, 20_000_000]] },
    { day: '2026-10-11', lanes: [[1, 15, 1_500_000]] },
    { day: '2026-10-12', lanes: [[0, 25, 2_500_000], [3, 3, 100_000]] },
  ],
};

const top = (key: string, fee_usd: number) => ({ key, messages: 1, usd: 1, fee_usd });

export const SOURCES: TopFile = {
  ...envelope,
  updated_at: '2026-10-13T06:01:00.177Z',
  dim: 'src_chain',
  since: '2023-07-06',
  windows: { '7d': [], '30d': [], all: [] },
  by_fees: { '7d': [top(BASE, 1851.08), top('11344663589394136015', 1512.25), top(ETH, 1140.98), top(ARB, 900)], '30d': [], all: [top(ETH, 163_207.21), top(BASE, 356_718.47)] },
};

export const RESERVE: ReserveFile = {
  ...envelope,
  updated_at: '2026-10-13T11:00:55.843Z',
  token: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  reserve: '0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6',
  latest: { ts: '2026-10-13T11:00:44.659Z', link: 6204681.79 },
  series: [],
  link_price_usd: 12.8643,
  cost_basis: { link_in: 6204682.79, link_out: 1, cost_usd: 69008608.43, value_usd: 79818684, change_usd: 10810075.58, change_pct: 15.66, avg_deposit_price_usd: 11.122, unpriced_transfers: 0 },
  pace: {
    deposits: 62,
    last_deposit: { ts: '2026-10-08T15:36:47.000Z', tx: '0xf978d26d9def696258b041d104e9ac166e492ab81802e175a0f2d50fd76598a0', link: 82480.36, price_usd: 12.4924, usd: 1030379.07 },
    days_since_last_deposit: 4.81,
    avg_weekly_link_4w: 85687.03,
    avg_weekly_usd_4w: 1078271.45,
    annualized_link: 4455725.56,
    supply_share_pct: 0.6205,
    next_milestone: { link: 7000000, eta: '2026-12-17' },
    avg_days_between_deposits: 7,
    next_expected_deposit: '2026-10-15T15:36:59.000Z',
    deposit_overdue: false,
    deposit_streak: 62,
  },
  weekly: [
    { week: '2026-04-06', deposits: 1, link: 131656.27, usd: 1172652.11 },
    { week: '2026-04-13', deposits: 1, link: 121949.84, usd: 1137534.51 },
    { week: '2026-04-20', deposits: 1, link: 123521.9, usd: 1156529.48 },
    { week: '2026-04-27', deposits: 1, link: 125525.28, usd: 1144875.13 },
    { week: '2026-05-04', deposits: 1, link: 119241.2, usd: 1175155 },
    { week: '2026-05-11', deposits: 1, link: 100908.77, usd: 1061638.22 },
    { week: '2026-05-18', deposits: 1, link: 123777.33, usd: 1192049.02 },
    { week: '2026-05-25', deposits: 1, link: 132002.93, usd: 1169235.11 },
    { week: '2026-06-01', deposits: 1, link: 148258.62, usd: 1197950.81 },
    { week: '2026-06-08', deposits: 1, link: 147197.58, usd: 1140721.6 },
    { week: '2026-06-15', deposits: 1, link: 143676.39, usd: 1137817.56 },
    { week: '2026-06-22', deposits: 1, link: 153956.18, usd: 1101508.09 },
    { week: '2026-06-29', deposits: 1, link: 151674.71, usd: 1179840.59 },
    { week: '2026-07-06', deposits: 1, link: 146110.67, usd: 1127176.37 },
    { week: '2026-07-13', deposits: 1, link: 138306.29, usd: 1168318 },
    { week: '2026-07-20', deposits: 1, link: 135168.33, usd: 1143441.8 },
    { week: '2026-07-27', deposits: 1, link: 135549.02, usd: 1145461.24 },
    { week: '2026-08-03', deposits: 1, link: 139956.08, usd: 1154197.69 },
    { week: '2026-08-10', deposits: 1, link: 127744.15, usd: 1122018.86 },
    { week: '2026-08-17', deposits: 1, link: 103041.41, usd: 1098263.79 },
    { week: '2026-08-24', deposits: 1, link: 91988.7, usd: 1099980.76 },
    { week: '2026-08-31', deposits: 1, link: 97110.77, usd: 1136712.32 },
    { week: '2026-09-07', deposits: 1, link: 91115.63, usd: 1058721.92 },
    { week: '2026-09-14', deposits: 1, link: 97459.26, usd: 1103007.14 },
    { week: '2026-09-21', deposits: 1, link: 88105.46, usd: 1114699.47 },
    { week: '2026-09-28', deposits: 1, link: 74703.04, usd: 1065000.12 },
    { week: '2026-10-05', deposits: 1, link: 82480.36, usd: 1030379.07 },
    { week: '2026-10-12', deposits: 0, link: 0, usd: 0 },
  ],
  performance: null,
  transfers: [],
  latest_transfer: null,
};
```

Create `discord/test/intel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chainChoices, chainTotals, dossierCard, findChain, MAX_CHOICES, recordsCard, sitrepCard, vaultCard, weeklyDeposits } from '../src/intel';
import { ARB, AVAX, BASE, CHAINS, ETH, HISTORY, MONAD, PLASMA, REPLAY, RESERVE, SOURCES, TODAY, WEMIX } from './fixtures/intel';

describe('/cciptoday', () => {
  it("projects today's messages over the share of the UTC day gone, against yesterday", () => {
    // #when 685 messages at 11:28:01.860, 47.78% of the day
    const card = sitrepCard(TODAY, HISTORY, CHAINS);
    // #then
    expect({ ...card, pace: { projected: Math.round(card.pace!.projected * 100) / 100, yesterday: card.pace!.yesterday } }).toEqual({
      updatedAt: '2026-10-13T11:28:01.860Z',
      messages: 685,
      pace: { projected: 1433.66, yesterday: 1625 },
      usd: 44064348.04,
      feesUsd: 419.36,
      linkSharePct: 0.25,
      senders: 211,
      medianDeliveryS: 820,
      lanes: [
        { src: { selector: MONAD, name: 'Monad' }, dst: { selector: ETH, name: 'Ethereum' }, usd: 16298903.16 },
        { src: { selector: ETH, name: 'Ethereum' }, dst: { selector: MONAD, name: 'Monad' }, usd: 10704140.65 },
        { src: { selector: ETH, name: 'Ethereum' }, dst: { selector: PLASMA, name: 'Plasma' }, usd: 6754321.91 },
        { src: { selector: MONAD, name: 'Monad' }, dst: { selector: AVAX, name: 'Avalanche' }, usd: 1999585.26 },
        { src: { selector: MONAD, name: 'Monad' }, dst: { selector: PLASMA, name: 'Plasma' }, usd: 1468701.01 },
      ],
    });
  });

  it('has no pace before 01:00 UTC, and no yesterday when history.json does not end on it', () => {
    // #when
    const early = sitrepCard({ ...TODAY, updated_at: '2026-10-13T00:59:59.000Z' }, HISTORY, CHAINS);
    const late = sitrepCard(TODAY, { ...HISTORY, days: HISTORY.days.slice(0, -1) }, CHAINS);
    // #then
    expect([early.pace, late.pace?.yesterday]).toEqual([null, null]);
  });
});

describe('/ccipchain', () => {
  it('counts each chain both ways over replay.json', () => {
    // #when
    const all = chainTotals(REPLAY, null, null);
    // #then
    expect(Object.fromEntries([...all].map(([s, t]) => [s, t.usd]))).toEqual({ [ETH]: 44_000_000, [BASE]: 12_900_000, [ARB]: 29_000_000, [MONAD]: 5_500_000, [AVAX]: 400_000 });
  });

  it("ranks the chain by all-time value, adds its top-3 fee week, and orbits its partners of the last 7 days", () => {
    // #when
    const card = dossierCard(BASE, REPLAY, SOURCES, CHAINS);
    // #then
    expect(card).toEqual({
      asOf: '2026-10-13T06:01:00.177Z',
      chain: { selector: BASE, name: 'Base' },
      rank: 3,
      ranked: 5,
      feeRank: 1,
      messages: 225,
      usd: 12_900_000,
      feesUsd: 356_718.47,
      week: { messages: 115, usd: 10_900_000 },
      days: [
        { day: '2026-10-06', messages: 25 }, { day: '2026-10-07', messages: 7 }, { day: '2026-10-08', messages: 0 }, { day: '2026-10-09', messages: 30 },
        { day: '2026-10-10', messages: 10 }, { day: '2026-10-11', messages: 15 }, { day: '2026-10-12', messages: 28 },
      ],
      partners: [{ chain: { selector: ETH, name: 'Ethereum' }, usd: 9_000_000 }, { chain: { selector: MONAD, name: 'Monad' }, usd: 1_500_000 }, { chain: { selector: AVAX, name: 'Avalanche' }, usd: 400_000 }],
      since: '2023-09-16',
    });
  });

  it('leaves out the fee rank outside the top 3, the fees of a chain without them, and has no card for a chain CCIP never saw', () => {
    // #when
    const arbitrum = dossierCard(ARB, REPLAY, SOURCES, CHAINS);
    // #then
    expect({ rank: arbitrum?.rank, feeRank: arbitrum?.feeRank, fees: arbitrum?.feesUsd, unseen: dossierCard(PLASMA, REPLAY, SOURCES, CHAINS) }).toEqual({ rank: 2, feeRank: null, fees: null, unseen: null });
  });

  it('finds a chain however it is typed: name, " Mainnet", registry name, selector, any case', () => {
    // #when
    const found = ['base', 'Base Mainnet', ' BASE ', 'ethereum-mainnet-base-1', BASE, 'Arbitrum', 'basee', ''].map((q) => findChain(CHAINS, q)?.selector ?? null);
    // #then
    expect(found).toEqual([BASE, BASE, BASE, BASE, BASE, ARB, null, null]);
  });

  it('suggests at most 25 chains whose name or registry name holds the typed text, those starting with it first', () => {
    // #given 40 more chains
    const many = { ...CHAINS, chains: [...CHAINS.chains, ...Array.from({ length: 40 }, (_, i) => ({ ...CHAINS.chains[0]!, selector: String(i), name: `chain-${i}-mainnet`, display_name: `Chain ${i} Mainnet` }))] };
    // #when
    const choices = { typed: chainChoices(CHAINS, 'as'), first: chainChoices(CHAINS, 'A').map((c) => c.name), registry: chainChoices(CHAINS, 'MONAD-main'), all: chainChoices(many, '').length };
    // #then every registry name holds an "a", in "mainnet"
    expect(choices).toEqual({
      typed: [{ name: 'Base', value: BASE }, { name: 'Plasma', value: PLASMA }],
      first: ['Arbitrum', 'Avalanche', 'Base', 'Ethereum', 'Monad', 'Plasma', 'WEMIX'],
      registry: [{ name: 'Monad', value: MONAD }],
      all: MAX_CHOICES,
    });
  });
});

describe('/linkreserve', () => {
  it("reads the vault from reserve.json, leaving out this week while it has no deposit", () => {
    // #when
    const card = vaultCard(RESERVE)!;
    // #then
    expect({ ...card, weekly: [card.weekly.length, card.weekly.at(-1)] }).toEqual({
      asOf: '2026-10-13T11:00:55.843Z',
      link: 6204681.79,
      valueUsd: 79818684,
      priceUsd: 12.8643,
      changePct: 15.66,
      costUsd: 69008608.43,
      streak: 62,
      avgWeeklyLink: 85687.03,
      lastDeposit: { link: 82480.36, day: '2026-10-08' },
      nextDue: '2026-10-15',
      overdue: false,
      weekly: [26, 82480.36],
      milestone: { link: 7_000_000, eta: '2026-12-17' },
    });
  });

  it('keeps this week once it has a deposit, and says when one is overdue', () => {
    // #given this week's deposit has come, and a Reserve whose next deposit is overdue
    const deposited = { ...RESERVE, weekly: [...RESERVE.weekly.slice(0, -1), { week: '2026-10-12', deposits: 1, link: 80_000, usd: 1_000_000 }] };
    const overdue = { ...RESERVE, pace: { ...RESERVE.pace!, deposit_overdue: true } };
    // #then
    expect([weeklyDeposits(deposited).at(-1), vaultCard(overdue)?.overdue, vaultCard({ ...RESERVE, latest: null })]).toEqual([80_000, true, null]);
  });
});

describe('/cciprecords', () => {
  it("takes the five records by the Records page's rules, the newest the one set last", () => {
    // #when
    const card = recordsCard(HISTORY, CHAINS);
    // #then
    expect(card).toEqual({
      asOf: '2026-10-13T06:01:00.177Z',
      medals: [
        { kind: 'messages', value: 47414, day: '2026-02-22', lane: null },
        { kind: 'value', value: 330_226_186.84, day: '2026-04-20', lane: null },
        { kind: 'fees', value: 57_347.81, day: '2026-07-09', lane: null },
        { kind: 'largest_fee', value: 9002.29, day: '2025-08-19', lane: { src: 'WEMIX', dst: 'Ethereum' } },
        { kind: 'link_share', value: 100, day: '2023-07-08', lane: null },
      ],
      newest: 'fees',
      messages: 56_209,
      usd: 488_226_186.84,
      since: '2023-07-06',
    });
  });

  it('makes a record set yesterday the newest', () => {
    // #given 2026-10-12 is the busiest day yet
    const history = { ...HISTORY, days: HISTORY.days.map((d) => (d.day === '2026-10-12' ? { ...d, messages: 50_000 } : d)) };
    // #then
    expect(recordsCard(history, CHAINS).newest).toBe('messages');
  });

  it('names the largest fee\'s lane by selector when chains.json lacks a chain', () => {
    // #given
    const chains = { ...CHAINS, chains: CHAINS.chains.filter((c) => c.selector !== WEMIX) };
    // #then
    expect(recordsCard(HISTORY, chains).medals[3]!.lane).toEqual({ src: WEMIX, dst: 'Ethereum' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/intel.test.ts`
Expected: FAIL: `../src/intel` does not exist.

- [ ] **Step 3: Add the intel numbers.**

Create `discord/src/intel.ts`:

```ts
import type { DossierCard, IntelChain, RecordMedal, RecordsCard, SitrepCard, VaultCard } from '@ccip-dev/core/linkmarine';
import { chainName, chainNameMap, shortChainName, type ChainNames } from '@ccip-dev/core/names';
import type { ChainsFile, HistoryFile, ReplayFile, ReserveFile, TodayFile, TopFile } from '@ccip-dev/core/public';
import { RECORD_KINDS, recordValue } from '@ccip-dev/core/records';
import { addDays, dayOf, weekStart } from '@ccip-dev/core/time';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const named = (names: ChainNames, selector: string): IntelChain => ({ selector, name: chainName(names, selector) });

/** /cciptoday from today.json, with yesterday's total from history.json when its last day is yesterday. */
export function sitrepCard(today: TodayFile, history: HistoryFile, chains: ChainsFile): SitrepCard {
  const names = chainNameMap(chains.chains);
  const elapsed = Date.parse(today.updated_at) - Date.parse(`${today.day}T00:00:00.000Z`);
  const last = history.days.at(-1);
  const yesterday = last && last.day === addDays(today.day, -1) ? last.messages : null;
  const t = today.totals;
  return {
    updatedAt: today.updated_at,
    messages: t.messages,
    pace: elapsed < HOUR_MS ? null : { projected: t.messages / (elapsed / DAY_MS), yesterday },
    usd: t.usd_value,
    feesUsd: t.fee_usd,
    linkSharePct: t.fee_link_share_pct,
    senders: t.unique_senders,
    medianDeliveryS: t.median_delivery_s,
    lanes: today.top.lane
      .filter((l) => (l.usd ?? 0) > 0)
      .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
      .slice(0, 5)
      .flatMap((l) => {
        const [src, dst] = l.key.split('>');
        return src && dst ? [{ src: named(names, src), dst: named(names, dst), usd: l.usd ?? 0 }] : [];
      }),
  };
}

interface ChainTotals {
  messages: number;
  usd: number;
}

/** Each chain's messages and value over [from, to] of replay.json, counting both directions. */
export function chainTotals(replay: ReplayFile, from: string | null, to: string | null): Map<string, ChainTotals> {
  const totals = new Map<string, ChainTotals>();
  for (const d of replay.days) {
    if ((from !== null && d.day < from) || (to !== null && d.day > to)) continue;
    for (const [lane, messages, usd] of d.lanes) {
      const ends = replay.lanes[lane];
      if (!ends) continue;
      for (const end of ends) {
        const selector = replay.chains[end]?.selector;
        if (!selector) continue;
        const t = totals.get(selector) ?? { messages: 0, usd: 0 };
        t.messages += messages;
        t.usd += usd;
        totals.set(selector, t);
      }
    }
  }
  return totals;
}

/** A chain picked by its display name, its registry name or its selector, ignoring case and " Mainnet". */
export function findChain(chains: ChainsFile, query: string): ChainsFile['chains'][number] | null {
  const q = query.trim().toLowerCase().replace(/ mainnet$/, '');
  if (!q) return null;
  return chains.chains.find((c) => c.selector === q || c.name.toLowerCase() === q || shortChainName(c).toLowerCase() === q || (c.display_name ?? '').toLowerCase().replace(/ mainnet$/, '') === q) ?? null;
}

export const MAX_CHOICES = 25;

/** /ccipchain's autocomplete: chains whose name or registry name contains the typed text, at most 25; the value is the selector. */
export function chainChoices(chains: ChainsFile, typed: string): { name: string; value: string }[] {
  const q = typed.trim().toLowerCase();
  return chains.chains
    .filter((c) => !q || shortChainName(c).toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    .map((c) => ({ name: shortChainName(c), value: c.selector }))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    })
    .slice(0, MAX_CHOICES);
}

/** /ccipchain from replay.json (all time and the last 7 finalized days) and top/src_chain.json (fees); null for a chain CCIP never saw. */
export function dossierCard(selector: string, replay: ReplayFile, sources: TopFile, chains: ChainsFile): DossierCard | null {
  const names = chainNameMap([...replay.chains, ...chains.chains]);
  const allTime = chainTotals(replay, null, null);
  const mine = allTime.get(selector);
  const lastDay = replay.days.at(-1)?.day;
  if (!mine || !lastDay) return null;
  const weekFrom = addDays(lastDay, -6);
  const ranked = replay.chains.length;
  const rank = 1 + [...allTime.values()].filter((t) => t.usd > mine.usd).length;
  const fees = sources.by_fees;
  const feeIndex = (fees?.['7d'] ?? []).slice(0, 3).findIndex((e) => e.key === selector);
  const partners = new Map<string, number>();
  for (const d of replay.days) {
    if (d.day < weekFrom) continue;
    for (const [lane, , usd] of d.lanes) {
      const ends = replay.lanes[lane];
      if (!ends) continue;
      const [src, dst] = ends.map((e) => replay.chains[e]?.selector);
      if (!src || !dst || (src !== selector && dst !== selector)) continue;
      const other = src === selector ? dst : src;
      partners.set(other, (partners.get(other) ?? 0) + usd);
    }
  }
  const byDay = new Map(replay.days.map((d) => [d.day, d]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i)).map((day) => {
    let messages = 0;
    for (const [lane, count] of byDay.get(day)?.lanes ?? []) {
      const ends = replay.lanes[lane];
      if (ends?.some((e) => replay.chains[e]?.selector === selector)) messages += count;
    }
    return { day, messages };
  });
  const week = chainTotals(replay, weekFrom, lastDay).get(selector) ?? { messages: 0, usd: 0 };
  const since = replay.chains.find((c) => c.selector === selector)?.first_day ?? null;
  return {
    asOf: replay.updated_at,
    chain: named(names, selector),
    rank,
    ranked,
    feeRank: feeIndex < 0 ? null : feeIndex + 1,
    messages: mine.messages,
    usd: mine.usd,
    feesUsd: fees?.all.find((e) => e.key === selector)?.fee_usd ?? null,
    week,
    days,
    partners: [...partners]
      .filter(([, usd]) => usd > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 4)
      .map(([s, usd]) => ({ chain: named(names, s), usd })),
    since,
  };
}

/** The last 26 weeks' deposits; the week in progress counts only once it has one. */
export function weeklyDeposits(reserve: ReserveFile): number[] {
  const last = reserve.weekly.at(-1);
  const weeks = last && last.deposits === 0 && last.week === weekStart(reserve.updated_at) ? reserve.weekly.slice(0, -1) : reserve.weekly;
  return weeks.slice(-26).map((w) => w.link);
}

/** /linkreserve from reserve.json; null while the Reserve has no balance yet. */
export function vaultCard(reserve: ReserveFile): VaultCard | null {
  if (!reserve.latest) return null;
  const pace = reserve.pace;
  const cost = reserve.cost_basis;
  return {
    asOf: reserve.updated_at,
    link: reserve.latest.link,
    valueUsd: cost?.value_usd ?? (reserve.link_price_usd === null ? null : reserve.latest.link * reserve.link_price_usd),
    priceUsd: reserve.link_price_usd,
    changePct: cost?.change_pct ?? null,
    costUsd: cost?.cost_usd ?? null,
    streak: pace?.deposit_streak ?? 0,
    avgWeeklyLink: pace?.avg_weekly_link_4w ?? null,
    lastDeposit: pace?.last_deposit ? { link: pace.last_deposit.link, day: dayOf(pace.last_deposit.ts) } : null,
    nextDue: pace?.next_expected_deposit ? dayOf(pace.next_expected_deposit) : null,
    overdue: pace?.deposit_overdue ?? false,
    weekly: weeklyDeposits(reserve),
    milestone: pace?.next_milestone ?? null,
  };
}

/** /cciprecords from history.json, by the Records page's rules; the newest is the record set on the latest day. */
export function recordsCard(history: HistoryFile, chains: ChainsFile): RecordsCard {
  const names = chainNameMap(chains.chains);
  const largest = history.largest_fees ?? [];
  const medals = RECORD_KINDS.flatMap((kind): RecordMedal[] => {
    const best = recordValue(kind, history.days, largest);
    if (!best) return [];
    const fee = kind === 'largest_fee' ? largest.find((f) => f.day === best.day && f.fee_usd === best.value) : undefined;
    return [{ kind, value: best.value, day: best.day, lane: fee ? { src: chainName(names, fee.src), dst: chainName(names, fee.dst) } : null }];
  });
  const newest = medals.reduce<RecordMedal | null>((n, m) => (n === null || m.day > n.day ? m : n), null);
  return {
    asOf: history.updated_at,
    medals,
    newest: newest?.kind ?? null,
    messages: history.days.reduce((s, d) => s + d.messages, 0),
    usd: history.days.reduce((s, d) => s + d.usd_value, 0),
    since: history.since,
  };
}
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (61 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add discord/src/intel.ts discord/test/fixtures/intel.ts discord/test/intel.test.ts
git commit -m "feat(discord): the intel cards' numbers from the public files" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 13: The intel commands, autocomplete and the caches

`/cciptoday`, `/ccipchain <chain>`, `/linkreserve` and `/cciprecords`: a card from R2 while it is under 5 minutes old (looked up before any file is read), else the numbers from the public files, drawn through `SITE`, kept and posted. A file that cannot be read or parsed answers "Intel is unavailable" privately and alerts `discord-data:<file>`; a chain CCIP never saw answers "No chain called" privately; a render that fails answers privately and alerts `discord-render:<kind>`. The public files are kept 60 s in the isolate and in the Cache API, and only once they parse. `/ccipchain`'s autocomplete reads the cached `chains.json`.

**Files:**
- Create: `discord/src/data.ts`, `discord/src/intel-commands.ts`
- Modify: `discord/src/bot.ts` (`data`), `discord/src/index.ts` (the four commands and the autocomplete), `discord/test/helpers.ts` (`fakeBot`'s `data`)
- Test: `discord/test/data.test.ts`, `discord/test/intel-commands.test.ts`

**Interfaces:**
- Consumes: Task 1 (`type IntelCards`, `type IntelKind`); Task 7 (`optionValue`, `type Interaction`); Task 11 (`type Bot`, `createBot`, `TEXT`, `botHandlers`); Task 12 (`chainChoices`, `dossierCard`, `findChain`, `recordsCard`, `sitrepCard`, `vaultCard`); live code `PUBLIC_SCHEMAS`, `type PublicFile`, `type PublicFileName` (`@ccip-dev/core/public`).
- Produces:
  - `data.ts`: `DATA_BASE` (`https://data.ccip.dev/v1`), `DATA_TTL_MS = 60_000`, `class DataError extends Error { file: PublicFileName }`, `interface PublicData { load<N extends PublicFileName>(name: N): Promise<PublicFile<N>> }`, `clearDataCache()`, `publicData(deps: { fetch; now: () => number; cache: Pick<Cache, 'match' | 'put'> | null }): PublicData`.
  - `intel-commands.ts`: `INTEL_TTL_MS = 300_000`, `INTEL_TEXT` (`noData`, `unknownChain(query)`), `COMMAND_KINDS` (`cciptoday` → `sitrep`, `ccipchain` → `dossier`, `linkreserve` → `vault`, `cciprecords` → `records`), `intelKey(kind, query): string`, `intelCommand(bot, interaction, kind): Promise<void>`.
  - `bot.ts`: `Bot.data: PublicData`.

- [ ] **Step 1: Write the failing tests.**

In `discord/test/helpers.ts`, replace:

```ts
    random: seededRandom(42),
    snapshot: SNAPSHOT,
    alerts,
    clock,
```

with:

```ts
    random: seededRandom(42),
    snapshot: SNAPSHOT,
    data: {
      load: async (name) => {
        throw new Error(`no ${name} in this test`);
      },
    },
    alerts,
    clock,
```

Create `discord/test/data.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataCache, DATA_BASE, DataError, publicData } from '../src/data';
import { CHAINS } from './fixtures/intel';

beforeEach(clearDataCache);

function server(body: () => Response) {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(url);
    return body();
  }) as unknown as typeof globalThis.fetch;
  return { urls, fetch };
}

/** The Cache API as a map. */
function memoryCache() {
  const stored = new Map<string, string>();
  return {
    stored,
    match: async (url: RequestInfo | URL) => (stored.has(String(url)) ? new Response(stored.get(String(url))) : undefined),
    put: async (url: RequestInfo | URL, res: Response) => void stored.set(String(url), await res.text()),
  };
}

describe('the public data files', () => {
  it('reads a file against its schema and keeps it 60 s in the isolate', async () => {
    // #given
    const s = server(() => new Response(JSON.stringify(CHAINS)));
    let now = 0;
    const data = publicData({ fetch: s.fetch, now: () => now, cache: null });
    // #when
    const first = await data.load('chains.json');
    now = 59_000;
    await data.load('chains.json');
    now = 61_000;
    await data.load('chains.json');
    // #then
    expect({ chains: first.chains.length, urls: s.urls }).toEqual({ chains: 7, urls: [`${DATA_BASE}/chains.json`, `${DATA_BASE}/chains.json`] });
  });

  it("shares a file through the Cache API with the colo's other isolates", async () => {
    // #given one isolate fetched it
    const cache = memoryCache();
    const s = server(() => new Response(JSON.stringify(CHAINS)));
    await publicData({ fetch: s.fetch, now: () => 0, cache }).load('chains.json');
    clearDataCache();
    // #when another reads it
    const again = await publicData({ fetch: s.fetch, now: () => 0, cache }).load('chains.json');
    // #then
    expect({ fetched: s.urls.length, chains: again.chains.length }).toEqual({ fetched: 1, chains: 7 });
  });

  it('names the file in a DataError, and keeps nothing it could not read', async () => {
    // #given
    const cache = memoryCache();
    const load = (body: () => Response) => publicData({ fetch: server(body).fetch, now: () => 0, cache }).load('today.json');
    // #when
    const errors = await Promise.all([
      load(() => new Response('down', { status: 503 })).catch((e: unknown) => e),
      load(() => new Response('<html>')).catch((e: unknown) => e),
      load(() => new Response('{"schema_version":1}')).catch((e: unknown) => e),
    ]);
    // #then
    expect({ errors: errors.map((e) => [e instanceof DataError, (e as DataError).file, (e as Error).message.split(':').slice(0, 2).join(':')]), cached: cache.stored.size }).toEqual({
      errors: [[true, 'today.json', 'today.json: HTTP 503'], [true, 'today.json', 'today.json: body is not JSON'], [true, 'today.json', 'today.json: unexpected shape at updated_at']],
      cached: 0,
    });
  });
});
```

Create `discord/test/intel-commands.test.ts`:

```ts
import type { PublicFileName } from '@ccip-dev/core/public';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { DataError, type PublicData } from '../src/data';
import { botHandlers } from '../src/index';
import { INTEL_TEXT, INTEL_TTL_MS, intelCommand, intelKey } from '../src/intel-commands';
import { TEXT } from '../src/marines';
import { command, fakeBot, fakeRenderer, resetStorage } from './helpers';
import { BASE, CHAINS, HISTORY, REPLAY, RESERVE, SOURCES, TODAY } from './fixtures/intel';

const FILES: Partial<Record<PublicFileName, unknown>> = {
  'today.json': TODAY, 'history.json': HISTORY, 'chains.json': CHAINS, 'replay.json': REPLAY, 'top/src_chain.json': SOURCES, 'reserve.json': RESERVE,
};

/** The public files from fixtures; `down` names one that fails. */
function data(down: PublicFileName | null = null): PublicData & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    loaded,
    load: async (name) => {
      loaded.push(name);
      if (name === down) throw new DataError(name, 'HTTP 503');
      return FILES[name] as never;
    },
  };
}

/** A bot whose clock runs with R2's, which stamps objects with the real time. */
function intelBot(overrides: Parameters<typeof fakeBot>[0] = {}) {
  const offset = { ms: 0 };
  const bot = fakeBot({ data: data(), now: () => new Date(Date.now() + offset.ms), ...overrides });
  return Object.assign(bot, { offset });
}

beforeEach(resetStorage);

describe('the intel commands', () => {
  it('draws /cciptoday from the public files, posts it and keeps it in R2', async () => {
    // #given
    const bot = intelBot();
    // #when
    await intelCommand(bot, command('cciptoday'), 'sitrep');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]), rendered: bot.renderer.calls, kept: (await env.MARINES.head('intel/sitrep.png'))?.httpMetadata?.contentType }).toEqual({
      calls: [['edit', '', 'sitrep.png']],
      rendered: ['renderIntelCard'],
      kept: 'image/png',
    });
  });

  it("posts R2's copy for 5 minutes without reading a file, then draws it afresh", async () => {
    // #given
    const files = data();
    const bot = intelBot({ data: files });
    await intelCommand(bot, command('linkreserve'), 'vault');
    files.loaded.length = 0;
    // #when
    await intelCommand(bot, command('linkreserve'), 'vault');
    const cached = { loaded: [...files.loaded], rendered: bot.renderer.calls.length };
    bot.offset.ms = INTEL_TTL_MS + 1000;
    await intelCommand(bot, command('linkreserve'), 'vault');
    // #then
    expect({ cached, afresh: bot.renderer.calls.length, posts: bot.discord.calls.length }).toEqual({ cached: { loaded: [], rendered: 1 }, afresh: 2, posts: 3 });
  });

  it('finds /ccipchain however it is typed, and keeps each typing apart', async () => {
    // #given
    const renderer = fakeRenderer();
    const seen: unknown[] = [];
    renderer.renderIntelCard = async (kind, card) => {
      seen.push([kind, (card as { chain: { name: string } }).chain.name]);
      return new Uint8Array([137, 80, 78, 71]);
    };
    const bot = intelBot({ renderer });
    // #when
    await intelCommand(bot, command('ccipchain', [{ name: 'chain', type: 3, value: BASE }]), 'dossier');
    await intelCommand(bot, command('ccipchain', [{ name: 'chain', type: 3, value: 'Base Mainnet' }]), 'dossier');
    // #then
    expect({ seen, keys: [intelKey('dossier', BASE), intelKey('dossier', 'Base Mainnet')] }).toEqual({ seen: [['dossier', 'Base'], ['dossier', 'Base']], keys: [`intel/dossier/${BASE}.png`, 'intel/dossier/base%20mainnet.png'] });
  });

  it('answers privately when there is no such chain, drawing nothing and alerting no one', async () => {
    // #given
    const bot = intelBot();
    // #when
    await intelCommand(bot, command('ccipchain', [{ name: 'chain', type: 3, value: 'Solana' }]), 'dossier');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), rendered: bot.renderer.calls, alerts: bot.alerts }).toEqual({ calls: [['private', INTEL_TEXT.unknownChain('Solana')]], rendered: [], alerts: [] });
  });

  it('answers privately that intel is unavailable when a file fails, and alerts discord-data:<file>', async () => {
    // #given
    const bot = intelBot({ data: data('history.json') });
    // #when
    await intelCommand(bot, command('cciprecords'), 'records');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), alerts: bot.alerts.map((a) => a.signature) }).toEqual({ calls: [['private', INTEL_TEXT.noData]], alerts: ['discord-data:history.json'] });
  });

  it('answers privately and alerts discord-render:<kind> when the card fails, keeping nothing', async () => {
    // #given
    const bot = intelBot({ renderer: fakeRenderer('renderIntelCard') });
    // #when
    await intelCommand(bot, command('cciptoday'), 'sitrep');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), alerts: bot.alerts.map((a) => a.signature), kept: await env.MARINES.head('intel/sitrep.png') }).toEqual({
      calls: [['private', TEXT.internal]],
      alerts: ['discord-render:sitrep'],
      kept: null,
    });
  });

  it('suggests chains for /ccipchain from chains.json', async () => {
    // #given
    const handlers = botHandlers(intelBot());
    // #when
    const choices = await handlers.autocomplete({ ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }]), type: 4 });
    // #then
    expect(choices).toEqual([{ name: 'Base', value: BASE }]);
  });
});
```

- [ ] **Step 2: Run the command test and confirm it fails.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/intel-commands.test.ts`
Expected: FAIL: `../src/data` and `../src/intel-commands` do not exist.

- [ ] **Step 3: Add the public files and the intel commands.**

Create `discord/src/data.ts`:

```ts
import { PUBLIC_SCHEMAS, type PublicFile, type PublicFileName } from '@ccip-dev/core/public';

export const DATA_BASE = 'https://data.ccip.dev/v1';
export const DATA_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export class DataError extends Error {
  constructor(
    readonly file: PublicFileName,
    reason: string,
  ) {
    super(`${file}: ${reason}`);
    this.name = 'DataError';
  }
}

export interface PublicData {
  load<N extends PublicFileName>(name: N): Promise<PublicFile<N>>;
}

type CacheLike = Pick<Cache, 'match' | 'put'>;

const isolateCache = new Map<string, { at: number; file: unknown }>();

/** Forgets what this isolate holds: for tests. */
export function clearDataCache(): void {
  isolateCache.clear();
}

/**
 * The public data files, checked against their schemas, kept 60 s in the isolate and in the Cache API (shared by the
 * isolates of a colo). A file that cannot be fetched or parsed is a DataError naming it.
 */
export function publicData(deps: { fetch: typeof fetch; now: () => number; cache: CacheLike | null }): PublicData {
  async function fetchText(name: PublicFileName, url: string): Promise<string> {
    let res: Response;
    try {
      res = await deps.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      throw new DataError(name, `request failed (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!res.ok) throw new DataError(name, `HTTP ${res.status}`);
    return res.text();
  }

  return {
    async load(name) {
      const hit = isolateCache.get(name);
      if (hit && deps.now() - hit.at < DATA_TTL_MS) return hit.file as PublicFile<typeof name>;
      const url = `${DATA_BASE}/${name}`;
      const cached = await deps.cache?.match(url);
      const text = cached ? await cached.text() : await fetchText(name, url);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new DataError(name, 'body is not JSON');
      }
      const parsed = PUBLIC_SCHEMAS[name].safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new DataError(name, `unexpected shape at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`);
      }
      if (!cached && deps.cache) await deps.cache.put(url, new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${DATA_TTL_MS / 1000}` } }));
      isolateCache.set(name, { at: deps.now(), file: parsed.data });
      return parsed.data as PublicFile<typeof name>;
    },
  };
}
```

Create `discord/src/intel-commands.ts`:

```ts
import type { IntelCards, IntelKind } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import { DataError } from './data';
import { dossierCard, findChain, recordsCard, sitrepCard, vaultCard } from './intel';
import { optionValue, type Interaction } from './interactions';
import { TEXT } from './marines';

/** An intel card is drawn at most once in this long per command and argument; within it, R2's copy is posted. */
export const INTEL_TTL_MS = 5 * 60_000;

export const INTEL_TEXT = {
  noData: 'Intel is unavailable right now, try again in a minute.',
  unknownChain: (query: string) => `No chain called '${query}' on CCIP.`,
} as const;

export const COMMAND_KINDS: Readonly<Record<string, IntelKind>> = { cciptoday: 'sitrep', ccipchain: 'dossier', linkreserve: 'vault', cciprecords: 'records' };

type Built = { [K in IntelKind]: { kind: K; card: IntelCards[K] } }[IntelKind];

class UnknownChain extends Error {}

async function build(bot: Bot, kind: IntelKind, query: string | null): Promise<Built> {
  switch (kind) {
    case 'sitrep': {
      const [today, history, chains] = await Promise.all([bot.data.load('today.json'), bot.data.load('history.json'), bot.data.load('chains.json')]);
      return { kind, card: sitrepCard(today, history, chains) };
    }
    case 'dossier': {
      const chains = await bot.data.load('chains.json');
      const chain = findChain(chains, query ?? '');
      if (!chain) throw new UnknownChain(query ?? '');
      const [replay, sources] = await Promise.all([bot.data.load('replay.json'), bot.data.load('top/src_chain.json')]);
      const card = dossierCard(chain.selector, replay, sources, chains);
      if (!card) throw new UnknownChain(query ?? '');
      return { kind, card };
    }
    case 'vault': {
      const card = vaultCard(await bot.data.load('reserve.json'));
      if (!card) throw new DataError('reserve.json', 'the Reserve has no balance yet');
      return { kind, card };
    }
    case 'records': {
      const [history, chains] = await Promise.all([bot.data.load('history.json'), bot.data.load('chains.json')]);
      return { kind, card: recordsCard(history, chains) };
    }
  }
}

/** The R2 key of a command's card: per command, and per typed chain for /ccipchain. */
export function intelKey(kind: IntelKind, query: string | null): string {
  return query === null ? `intel/${kind}.png` : `intel/${kind}/${encodeURIComponent(query.trim().toLowerCase())}.png`;
}

/** /cciptoday, /ccipchain, /linkreserve and /cciprecords: R2's copy while it is under 5 minutes old, else the card drawn from the public files. */
export async function intelCommand(bot: Bot, interaction: Interaction, kind: IntelKind): Promise<void> {
  const query = kind === 'dossier' ? (optionValue(interaction, 'chain') ?? '') : null;
  const post = (bytes: Uint8Array) => bot.discord.editOriginal(interaction.token, '', { name: `${kind}.png`, type: 'image/png', bytes });
  const key = intelKey(kind, query);
  const cached = await bot.bucket.get(key);
  if (cached && bot.now().getTime() - cached.uploaded.getTime() < INTEL_TTL_MS) return post(new Uint8Array(await cached.arrayBuffer()));
  let built: Built;
  try {
    built = await build(bot, kind, query);
  } catch (err) {
    if (err instanceof UnknownChain) return bot.discord.privateFollowup(interaction.token, INTEL_TEXT.unknownChain(err.message));
    if (err instanceof DataError) {
      await bot.alert(`discord-data:${err.file}`, `${err.message} (for /${interaction.data?.name})`);
      return bot.discord.privateFollowup(interaction.token, INTEL_TEXT.noData);
    }
    throw err;
  }
  let png: Uint8Array;
  try {
    png = await bot.renderer.renderIntelCard(built.kind, built.card as never);
  } catch (err) {
    await bot.alert(`discord-render:${kind}`, `the ${kind} card failed to render: ${err instanceof Error ? err.message : String(err)}`);
    return bot.discord.privateFollowup(interaction.token, TEXT.internal);
  }
  await bot.bucket.put(key, png, { httpMetadata: { contentType: 'image/png' } });
  await post(png);
}
```

- [ ] **Step 4: Give the bot its data, and route the commands and the autocomplete.**

In `discord/src/bot.ts`, replace:

```ts
import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { createAlerter, type Alert } from './alerts';
import { discordApi, type DiscordApi } from './discord-api';
import { cryptoRandom, type CallsignSnapshot } from './draw';
```

with:

```ts
import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { createAlerter, type Alert } from './alerts';
import { publicData, type PublicData } from './data';
import { discordApi, type DiscordApi } from './discord-api';
import { cryptoRandom, type CallsignSnapshot } from './draw';
```

In `discord/src/bot.ts`, replace:

```ts
  renderer: LinkMarineRenderer;
  discord: DiscordApi;
  alert: Alert;
  fetch: typeof fetch;
```

with:

```ts
  renderer: LinkMarineRenderer;
  discord: DiscordApi;
  data: PublicData;
  alert: Alert;
  fetch: typeof fetch;
```

In `discord/src/bot.ts`, replace:

```ts
    renderer: env.SITE,
    discord: discordApi(env.DISCORD_APPLICATION_ID ?? '', { fetch: fetchFn, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }),
    alert: createAlerter(env.DB, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, { fetch: fetchFn, now }),
    fetch: fetchFn,
```

with:

```ts
    renderer: env.SITE,
    discord: discordApi(env.DISCORD_APPLICATION_ID ?? '', { fetch: fetchFn, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }),
    data: publicData({ fetch: fetchFn, now: () => Date.now(), cache: caches.default }),
    alert: createAlerter(env.DB, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, { fetch: fetchFn, now }),
    fetch: fetchFn,
```

In `discord/src/index.ts`, replace:

```ts
import { createBot, type Bot } from './bot';
import type { Env } from './env';
import { deferred, InteractionType, json, privateReply, ResponseType, type Interaction } from './interactions';
import { dogtagCommand, enlistCommand, TEXT } from './marines';
```

with:

```ts
import { createBot, type Bot } from './bot';
import type { Env } from './env';
import { chainChoices } from './intel';
import { COMMAND_KINDS, intelCommand } from './intel-commands';
import { deferred, InteractionType, json, privateReply, ResponseType, type Interaction } from './interactions';
import { dogtagCommand, enlistCommand, TEXT } from './marines';
```

In `discord/src/index.ts`, replace:

```ts

export function botHandlers(bot: Bot): Handlers {
  return {
    commands: { enlist: guarded(bot, enlistCommand), dogtag: guarded(bot, dogtagCommand) },
    autocomplete: async () => [],
  };
}
```

with:

```ts

export function botHandlers(bot: Bot): Handlers {
  const intel = Object.fromEntries(Object.entries(COMMAND_KINDS).map(([name, kind]) => [name, guarded(bot, (b, i) => intelCommand(b, i, kind))]));
  return {
    commands: { enlist: guarded(bot, enlistCommand), dogtag: guarded(bot, dogtagCommand), ...intel },
    autocomplete: async (interaction) => chainChoices(await bot.data.load('chains.json'), String(interaction.data?.options?.find((o) => o.focused)?.value ?? '')),
  };
}
```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (71 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add discord/src/data.ts discord/src/intel-commands.ts discord/src/bot.ts discord/src/index.ts discord/test/helpers.ts discord/test/data.test.ts discord/test/intel-commands.test.ts
git commit -m "feat(discord): /cciptoday, /ccipchain with autocomplete, /linkreserve and /cciprecords, each card kept 5 minutes" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 14: Registration, the deploy, and the docs

The six commands as Discord's command objects, `pnpm discord:register` to PUT them to the LinkMarine server from the owner's shell (the only use of `DISCORD_BOT_TOKEN`), the two deploy steps behind the repository variable `DISCORD_BOT`, the runbook's "Discord bot (LinkMarine)" section with its alerts, and the methodology's note.

**Files:**
- Create: `discord/src/commands.ts`, `scripts/discord/commands.ts`, `scripts/discord/register.ts`
- Modify: `package.json` (`discord:register`), `.github/workflows/deploy.yml`, `docs/runbook.md` ("Discord bot (LinkMarine)", five alert rows), `docs/methodology.md` ("LinkMarine bot")
- Test: `discord/test/commands.test.ts`, `scripts/test/discord-register.test.ts`

**Interfaces:**
- Consumes: Task 11 and 13 (`botHandlers`); Task 7 (`discord/wrangler.toml`'s `DISCORD_GUILD_ID`); `smol-toml`.
- Produces:
  - `discord/src/commands.ts`: `COMMANDS` (enlist; dogtag with the optional USER option `marine`; cciptoday; ccipchain with the required, autocompleted STRING option `chain`; linkreserve; cciprecords), `type CommandName`.
  - `scripts/discord/commands.ts`: `DISCORD_API`, `guildIdFrom(wranglerToml: string): string` (throws while it is empty), `registerRequest(applicationId, guildId, botToken): { url: string; init: RequestInit }` (`PUT .../applications/{app}/guilds/{guild}/commands`, `authorization: Bot …`).
  - `pnpm discord:register` (reads `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN` from the shell; prints the registered commands, never the token).
  - The deploy: `wrangler d1 migrations apply ccip-dev-marines --remote` then `wrangler deploy` for `@ccip-dev/discord`, last in the job, `if: vars.DISCORD_BOT == 'on'`.

- [ ] **Step 1: Write the failing tests.**

Create `discord/test/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/commands';
import { botHandlers } from '../src/index';
import { fakeBot } from './helpers';

describe('the commands', () => {
  it('routes every command it registers, and registers every command it routes', () => {
    // #when
    const routed = Object.keys(botHandlers(fakeBot()).commands).sort();
    // #then
    expect(routed).toEqual(COMMANDS.map((c) => c.name).sort());
  });
});
```

Create `scripts/test/discord-register.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { guildIdFrom, registerRequest } from '../discord/commands';

describe('command registration', () => {
  it('overwrites the guild commands with a bot-token PUT of the six commands', () => {
    // #when
    const { url, init } = registerRequest('1200000000000000002', '1100000000000000001', 'secret');
    const commands = JSON.parse(init.body as string) as { name: string; options?: { name: string; type: number; required: boolean; autocomplete?: boolean }[] }[];
    // #then
    expect({ url, method: init.method, headers: init.headers, names: commands.map((c) => c.name), chain: commands[3]!.options, marine: commands[1]!.options }).toEqual({
      url: 'https://discord.com/api/v10/applications/1200000000000000002/guilds/1100000000000000001/commands',
      method: 'PUT',
      headers: { authorization: 'Bot secret', 'content-type': 'application/json' },
      names: ['enlist', 'dogtag', 'cciptoday', 'ccipchain', 'linkreserve', 'cciprecords'],
      chain: [{ type: 3, name: 'chain', description: 'The chain', required: true, autocomplete: true }],
      marine: [{ type: 6, name: 'marine', description: 'Whose tags (yours if left out)', required: false }],
    });
  });

  it("reads the server id from the Worker's config, and refuses an empty one", () => {
    // #then
    expect(guildIdFrom('name = "x"\n[vars]\nDISCORD_GUILD_ID = "1100000000000000001"\n')).toBe('1100000000000000001');
    expect(() => guildIdFrom('[vars]\nDISCORD_GUILD_ID = ""\n')).toThrow('set [vars] DISCORD_GUILD_ID to the LinkMarine server id first');
  });
});
```

- [ ] **Step 2: Run the registration test and confirm it fails.**

Run: `pnpm exec vitest run scripts/test/discord-register.test.ts`
Expected: FAIL: `../discord/commands` does not exist.

- [ ] **Step 3: Add the commands and the registration.**

Create `discord/src/commands.ts`:

```ts
/** The six guild commands, as pnpm discord:register PUTs them (discord.com/developers/docs/interactions/application-commands). */
const STRING = 3;
const USER = 6;

export const COMMANDS = [
  { name: 'enlist', description: 'Enlist: draw your permanent LinkMarine callsign and get your dog tags', type: 1 },
  { name: 'dogtag', description: "Show a Marine's dog tags", type: 1, options: [{ type: USER, name: 'marine', description: 'Whose tags (yours if left out)', required: false }] },
  { name: 'cciptoday', description: "Today's CCIP SITREP", type: 1 },
  { name: 'ccipchain', description: "A chain's CCIP dossier", type: 1, options: [{ type: STRING, name: 'chain', description: 'The chain', required: true, autocomplete: true }] },
  { name: 'linkreserve', description: 'The Chainlink Reserve vault', type: 1 },
  { name: 'cciprecords', description: "CCIP's hall of records", type: 1 },
] as const;

export type CommandName = (typeof COMMANDS)[number]['name'];
```

Create `scripts/discord/commands.ts`:

```ts
import { parse } from 'smol-toml';
import { COMMANDS } from '../../discord/src/commands';

export const DISCORD_API = 'https://discord.com/api/v10';

/** The LinkMarine server's id, from discord/wrangler.toml's [vars], so the Worker and the commands agree on it. */
export function guildIdFrom(wranglerToml: string): string {
  const id = (parse(wranglerToml) as { vars?: { DISCORD_GUILD_ID?: unknown } }).vars?.DISCORD_GUILD_ID;
  if (typeof id !== 'string' || !/^\d{17,20}$/.test(id)) throw new Error('discord/wrangler.toml: set [vars] DISCORD_GUILD_ID to the LinkMarine server id first');
  return id;
}

/** Bulk Overwrite Guild Application Commands: the six commands become the server's whole list. */
export function registerRequest(applicationId: string, guildId: string, botToken: string): { url: string; init: RequestInit } {
  return {
    url: `${DISCORD_API}/applications/${applicationId}/guilds/${guildId}/commands`,
    init: { method: 'PUT', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify(COMMANDS) },
  };
}
```

Create `scripts/discord/register.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guildIdFrom, registerRequest } from './commands';

/** `pnpm discord:register`: PUTs the six commands to the LinkMarine server, with the owner's DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN. */
const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
if (!applicationId || !botToken) throw new Error('set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in this shell first (see docs/runbook.md, "Discord bot")');
const guildId = guildIdFrom(readFileSync(join(import.meta.dirname, '..', '..', 'discord', 'wrangler.toml'), 'utf8'));
const { url, init } = registerRequest(applicationId, guildId, botToken);
const res = await fetch(url, init);
if (!res.ok) throw new Error(`Discord returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const registered = (await res.json()) as { name: string }[];
console.log(`registered ${registered.map((c) => `/${c.name}`).join(', ')} in server ${guildId}`);
```

In `package.json`, replace:

```json
    "typecheck": "pnpm -r typecheck && tsc --noEmit",
    "canary": "tsx scripts/canary.ts",
    "discord:snapshot": "tsx scripts/discord/snapshot.ts",
    "backfill:crawl": "tsx scripts/backfill/crawl.ts",
```

with:

```json
    "typecheck": "pnpm -r typecheck && tsc --noEmit",
    "canary": "tsx scripts/canary.ts",
    "discord:register": "tsx scripts/discord/register.ts",
    "discord:snapshot": "tsx scripts/discord/snapshot.ts",
    "backfill:crawl": "tsx scripts/backfill/crawl.ts",
```

- [ ] **Step 4: Deploy the bot once the owner switches it on.**

The new steps come last, after the data Worker and the watchdog, so nothing they do can hold those back.

In `.github/workflows/deploy.yml`, replace:

```yaml
      - run: pnpm --filter @ccip-dev/worker exec wrangler deploy -c wrangler.watchdog.toml
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

with:

```yaml
      - run: pnpm --filter @ccip-dev/worker exec wrangler deploy -c wrangler.watchdog.toml
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
      # The LinkMarine bot deploys once the owner has created its database and bucket and set DISCORD_BOT (docs/runbook.md, "Discord bot").
      - run: pnpm --filter @ccip-dev/discord exec wrangler d1 migrations apply ccip-dev-marines --remote
        if: vars.DISCORD_BOT == 'on'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
      - run: pnpm --filter @ccip-dev/discord exec wrangler deploy
        if: vars.DISCORD_BOT == 'on'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

Run: `actionlint .github/workflows/deploy.yml`
Expected: no output (skip the step when `actionlint` is not installed).

- [ ] **Step 5: Document the bot.**

The runbook section goes before "Incidents and alerts", its alert rows before the watchdog's, and the methodology note before "Coverage".

In `docs/runbook.md`, replace:

```markdown
- **Alerts:** `monthly-video-missing:<YYYY-MM>`, `monthly-video-size:<YYYY-MM>`, `broadcast-video:<key>` and `broadcast-run:monthly` (in the `broadcast-run` row), below. A failed workflow run also shows in GitHub Actions, which emails the owner.

## Incidents and alerts

```

with:

```markdown
- **Alerts:** `monthly-video-missing:<YYYY-MM>`, `monthly-video-size:<YYYY-MM>`, `broadcast-video:<key>` and `broadcast-run:monthly` (in the `broadcast-run` row), below. A failed workflow run also shows in GitHub Actions, which emails the owner.

## Discord bot (LinkMarine)

LinkMarine is a Discord app for the LinkMarine server: `/enlist` draws a permanent callsign of three meme tags and stamps it on a pair of dog tags, `/dogtag [marine]` shows a Marine's card, and `/cciptoday`, `/ccipchain <chain>`, `/linkreserve` and `/cciprecords` post CCIP intel as cards. Spec: `docs/superpowers/specs/2026-10-13-linkmarine-bot-design.md`.

- **How it runs:** the `ccip-dev-discord` Worker (`discord/`) answers `POST https://discord.ccip.dev/interactions`. It checks Discord's Ed25519 signature (401 without it), answers PING and `/ccipchain` autocomplete at once, and defers every command (Discord shows "thinking"), doing the work after the reply. Cards are drawn by the site Worker's `LinkMarineCards` entrypoint over the private `SITE` service binding; no route serves them. Marines live in D1 `ccip-dev-marines`; cards, memes and avatars in R2 `ccip-dev-marines` (`cards/<serial>.png`, and `.gif` for Rare and up; `memes/<file>.png`, each meme as a 240 px PNG; `avatars/<serial>.png`; `intel/…png`, each intel card kept 5 minutes). Intel comes from `https://data.ccip.dev/v1/`, kept 60 s. Replies are public; errors are private.
- **Callsigns:** `docs/callsigns/tags.toml` (the allowed tags) and `docs/callsigns/lore.toml` (the BLOOD and FAITH lines, by weight) are read with the `../chainlinkmeme` checkout into `discord/src/data/callsigns.json` by `pnpm discord:snapshot` (add `--archive <path>` when the checkout is elsewhere). Commit that file; the deploy ships it. A new snapshot changes the odds of future draws only: a Marine's callsign, serial, tier, memes, lore and stamped name never change.
- **Look at the cards:** `pnpm --filter @ccip-dev/site cards:linkmarine` writes every tier of the dog tag card, the Rare and Legendary glints and the four intel cards to `site/linkmarine-cards/` (git-ignored), from fixtures and the mockup's three memes in `../chainlinkmeme`.
- **One-time setup (the owner, in order):**
  1. Create the app at https://discord.com/developers/applications: name it LinkMarine. Note its Application ID and Public Key (General Information). Under Bot, reset the token once and keep it for step 7 only.
  2. Create the database and the bucket: `pnpm --filter @ccip-dev/discord exec wrangler d1 create ccip-dev-marines` (copy the printed `database_id` into `discord/wrangler.toml`, replacing the zeros) and `pnpm --filter @ccip-dev/discord exec wrangler r2 bucket create ccip-dev-marines`.
  3. Put the LinkMarine server's id (Discord: Developer Mode on, right-click the server, Copy Server ID) in `discord/wrangler.toml` as `DISCORD_GUILD_ID`. Commit both edits and push. Until `DISCORD_GUILD_ID` is set the Worker turns every command away.
  4. Switch the deploy on: `gh variable set DISCORD_BOT --body on`, then `gh workflow run deploy`. It applies `discord/migrations/` and deploys the Worker at `discord.ccip.dev`.
  5. Secrets: `pnpm --filter @ccip-dev/discord exec wrangler secret put DISCORD_PUBLIC_KEY`, then `DISCORD_APPLICATION_ID`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` (the alert chat's, as the data Worker has them).
  6. In the app's General Information, set Interactions Endpoint URL to `https://discord.ccip.dev/interactions` and save; Discord checks it with a PING.
  7. Register the commands from your machine, the token never on a command line (bash/zsh: `read -rs DISCORD_BOT_TOKEN && export DISCORD_BOT_TOKEN`; fish: `read -s -x DISCORD_BOT_TOKEN`), then `DISCORD_APPLICATION_ID=<application id> pnpm discord:register`, then clear the token (`unset DISCORD_BOT_TOKEN`; fish: `set -e DISCORD_BOT_TOKEN`). It prints the six commands. Run it again after any change to `discord/src/commands.ts`.
  8. Invite the app with no permissions: `https://discord.com/oauth2/authorize?client_id=<application id>&scope=applications.commands`.
  9. Enlist first, as Marine #0001, in a test channel; then announce.
- **Re-stamp a card** (for example after a fix to the card): clear it and the next `/dogtag` stamps it again.
  `pnpm --filter @ccip-dev/discord exec wrangler d1 execute ccip-dev-marines --remote --command "UPDATE marines SET card_key = NULL WHERE serial = <serial>"`
  `pnpm --filter @ccip-dev/discord exec wrangler r2 object delete ccip-dev-marines/cards/<serial>.png --remote` (and `cards/<serial>.gif` for Rare and up).
- **Turn it off:** remove the Interactions Endpoint URL in the Developer Portal (Discord stops sending commands), or `gh variable set DISCORD_BOT --body off` to stop deploying it.
- **Alerts:** `discord-data:<file>`, `discord-render:<kind>`, `discord-memes`, `discord-draw` and `discord-command:<name>`, below, in the same chat as the other Workers' alerts, each at most once an hour.

## Incidents and alerts

```

In `docs/runbook.md`, replace:

```markdown
| `reserve-outflow:<tx>` | LINK left the Reserve. Open the transaction on Etherscan. See "Missed Reserve outflow alert" if a crash may have eaten one. |
| `reserve-mismatch` | Transfers do not net to the balance. Re-scan from an earlier block (see "Health checks"). |
| `ccip.dev watchdog: …` | `status.json` is old, unreadable, or ingest lag is high. Check the Worker and the CCIP API. |

```

with:

```markdown
| `reserve-outflow:<tx>` | LINK left the Reserve. Open the transaction on Etherscan. See "Missed Reserve outflow alert" if a crash may have eaten one. |
| `reserve-mismatch` | Transfers do not net to the balance. Re-scan from an earlier block (see "Health checks"). |
| `discord-data:<file>` | An intel command could not read or parse the public file. The Marine was told "Intel is unavailable right now". Open `https://data.ccip.dev/v1/<file>`; check `status.json` and the data Worker. |
| `discord-render:<kind>` | The site Worker's `LinkMarineCards` entrypoint failed to draw a card (`marine` or an intel kind). An intel command answered privately; an enlistment kept its draw and said the tag is being stamped, and the Marine's next `/dogtag` tries again. Read the error in the alert and `pnpm --filter @ccip-dev/site exec wrangler tail ccip-dev-site`. |
| `discord-memes` | A meme could not be copied from `raw.githubusercontent.com` at the snapshot's commit. The enlistment is saved; the next `/dogtag` copies it again. If it repeats, check the file is in the chainlinkmeme repository at that commit. |
| `discord-draw` | Twenty draws in a row clashed with callsigns already taken; the Marine was told something went wrong and may run `/enlist` again. Many Marines for few tags: allow more tags in `docs/callsigns/tags.toml` and run `pnpm discord:snapshot`. |
| `discord-command:<name>` | A command failed in a way its own checks did not catch (for example a D1 error). The Marine got the private "Something went wrong". Read the error in the alert and `pnpm --filter @ccip-dev/discord exec wrangler tail ccip-dev-discord`. |
| `ccip.dev watchdog: …` | `status.json` is old, unreadable, or ingest lag is high. Check the Worker and the CCIP API. |

```

In `docs/methodology.md`, replace:

```markdown

On the 1st of each month @ccipdev posts a 30-second video of the month before: the replay, cut to that month. It shows only the month's days and the chains and lanes that moved in it. Its value counter, its fees counter and its leaderboard count the month alone, from zero. A chain whose first CCIP message came that month gets its "joins" beat, and an all-time milestone or record crossed that month gets its beat. The end card gives the month's messages, value moved, fees paid and the share of fees paid in LINK, the all-time records set that month (by the Records page's rules) and the chains that joined (three of each, then "+N more"), and the month's busiest lane by value. The value moved is rounded down there and in the post, as the counter shows it. The post's caption is written from the same month summary the end card shows, recorded with the video.

## Coverage
```

with:

```markdown

On the 1st of each month @ccipdev posts a 30-second video of the month before: the replay, cut to that month. It shows only the month's days and the chains and lanes that moved in it. Its value counter, its fees counter and its leaderboard count the month alone, from zero. A chain whose first CCIP message came that month gets its "joins" beat, and an all-time milestone or record crossed that month gets its beat. The end card gives the month's messages, value moved, fees paid and the share of fees paid in LINK, the all-time records set that month (by the Records page's rules) and the chains that joined (three of each, then "+N more"), and the month's busiest lane by value. The value moved is rounded down there and in the post, as the counter shows it. The post's caption is written from the same month summary the end card shows, recorded with the video.

## LinkMarine bot

The LinkMarine Discord app's intel cards read the same public files as this site, so their numbers match its pages.
- **SITREP** (`/cciptoday`): today's totals from `today.json`, as of its `updated_at`. "On pace for" divides today's messages by the share of the UTC day gone, rounded to three figures; it compares with yesterday's total from `history.json`, and is left out before 01:00 UTC. The top lanes are today's five biggest by value.
- **Chain dossier** (`/ccipchain`): all-time messages and value count both directions (messages from the chain and to it), from `replay.json`; the rank is by that value among every chain CCIP has seen. Fees are those paid on the chain as the source (`top/src_chain.json`), with its rank by the last 7 days' fees when in the top 3. The week and the partners are the last 7 finalized days.
- **The vault** (`/linkreserve`): `reserve.json` as the Reserve page reads it. The weekly bars leave out the current week until it has a deposit.
- **Hall of records** (`/cciprecords`): the five all-time records by the Records page's rules; the newest is the one set on the latest day.
- **Callsigns:** three different tags from `docs/callsigns/tags.toml`, each drawn with a chance proportional to the square root of its number of SFW memes in the chainlinkme.me archive. The rarity score is the sum of −ln(chance) over the three tags; the tier cut-offs and the percentile ("rarer than N in 100 Marines") come from 200,000 simulated draws, so that about 60% of Marines are Common, 25% Uncommon, 12% Rare and 3% Legendary.

## Coverage
```

Run: `grep -c "^## Discord bot (LinkMarine)" docs/runbook.md && grep -c "^## LinkMarine bot" docs/methodology.md && grep -c "^| .discord-" docs/runbook.md`
Expected: `1`, `1`, then `5` (the five alert rows).

- [ ] **Step 6: Run everything and the typecheck.**

Run: `pnpm test`
Expected: PASS: core, site (Node and workerd), the bot (72 tests), the data Worker and the scripts.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add discord/src/commands.ts scripts/discord/commands.ts scripts/discord/register.ts package.json .github/workflows/deploy.yml docs/runbook.md docs/methodology.md discord/test/commands.test.ts scripts/test/discord-register.test.ts
git commit -m "feat(discord): pnpm discord:register, the deploy behind DISCORD_BOT, and the bot in the runbook and the methodology" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:**
  - §1 goal and owner decisions: the six commands (Tasks 11, 13, 14); public replies and private errors (Tasks 11, 13; Review Focus 1); installed with `applications.commands` only (runbook, Task 14); one card per platform, callsigns and serials shared (the `platform` column and `UNIQUE (platform, user_id)`, `tag_key` unique across platforms, Task 10); the dog tag card's tags, chain, metals, lore, rim, planets, sky, halo and corners (Task 3); effects by tier (Tasks 3, 4); chain icons filling their hexagon (Task 5); approach A (Tasks 7–14).
  - §2 success criteria: the 3-second acknowledgement (Task 7; only autocomplete awaits a cached file); an intel card in about 5 s (about 1 s to draw, Decisions); the reveal in about 8 s (four 1 s edits while a 3 s render runs, Task 11); permanence (Tasks 10, 11; Review Focus 4); honest numbers and "as of" (Tasks 5, 6, 12; the site's own formatters and `recordValue`); kino (Tasks 2–6, the renders in Decisions); safe (signatures, the server check, no mentions, throws instead of half cards: Tasks 7, 11, 13); isolated (its own Worker, D1 and R2; the site gains only an export).
  - §3 scope: everything "In" has a task; nothing "Out" is built.
  - §4 commands and their texts: Tasks 11 and 13, verbatim in `TEXT` and `INTEL_TEXT`; autocomplete of at most 25, name or registry name, any case (Tasks 12, 13).
  - §5.1 the snapshot (Task 9); §5.2 the draw (Task 8; the meme pick, lore, rim text and sky seed in Tasks 1, 3, 8); §5.3 storage (Tasks 7, 10, 11; memes as PNGs and avatars kept, see Decisions); §5.4 the reveal (Task 11).
  - §6 the dog tag card (Task 3) and the glint (Task 4); §7 the four intel cards (Tasks 5, 6, 12), cached 5 minutes in R2 (Task 13).
  - §8 architecture: the Worker, `POST /interactions`, 401, PONG, type 5 and `waitUntil`, type 8 (Task 7); the webhook edits and private followups (Task 11); the data files and their 60 s caches (Task 13); the entrypoint over a service binding (Tasks 3, 4, 6, 7); registration, secrets, vars, the deploy and the migrations (Tasks 7, 14).
  - §9 failures and alerts: the bad signature (Task 7), `discord-data:<file>` and the render failures (Tasks 11, 13), `discord-memes` (Task 11), the concurrent `/enlist` (Task 10), the same alert chat and dedupe (Task 11).
  - §10 testing: signatures and PING (Task 7); routing, deferral, autocomplete and its 25 (Tasks 7, 12, 13); the draw on a seeded source (Task 8); the generator on a fixture archive (Task 9); D1 uniqueness, serial order, double enlistment (Task 10); the reveal's edits and timing on a fake Discord, the render failure keeping the draw (Task 11); intel math from fixture files, before 01:00, a missing yesterday, rank and partners, the Reserve with overdue, records with the newest (Task 12); every card a 1200×675 PNG and the glint a bounded animated image (Tasks 3, 4, 6); the visual check script (Task 6 Step 6).
  - §11 rollout: step 1 is in "Decisions" and pinned in Task 2; steps 2–4 are the runbook's owner steps (Task 14), step 2 behind `DISCORD_BOT` (see "Decisions").
  - §12 risks: the animated format (GIF, measured), renderer features (Satori's own filter and clip-path), GitHub's availability (copy at enlistment, retry on `/dogtag`), Discord's rate limits (1 s spacing, one `retry_after`).
- **Not mapped:** the live checks no test can make before an app exists: that Discord creates the private followup as a new ephemeral message once the loading message is deleted (Review Focus 1; the runbook's launch step checks it with `/ccipchain` and a chain that does not exist), and the glint's autoplay in a real Discord client. Global installation and Telegram enlistment are out of scope.
- **Placeholders:** none. The fill-ins are `<your model>` in the commit trailers and, by design, the all-zero `database_id` and the empty `DISCORD_GUILD_ID` in `discord/wrangler.toml`, which the owner fills (runbook, Task 14) before switching `DISCORD_BOT` on.
- **Names across tasks:**
  - Task 1: `TIERS`, `Tier`, `TIER_SHARE_PCT`, `tierTopPct`, `hasGlint`, `filledPips`, `callsignSeed`, `seededRandom`, `RIM_PHRASES`, `rimText`, `serialText`, `MarineCardMeme`, `MarineCard`, `IntelChain`, `IntelLane`, `SitrepCard`, `DossierCard`, `VaultCard`, `RecordMedal`, `RecordsCard`, `IntelCards`, `IntelKind`, `INTEL_KINDS`, `LinkMarineRenderer`.
  - Task 2: `INTER_900`, `MONO_700`, `KINO_FONTS`, `Rendered`, `renderKino`, `KINO_SIZE`, `MOCK`, `S`, `MONO`, `INK`, `r1`, `px`, `MONTHS`, `utcDate`, `capDay`, `hexPoints`, `HEX_CLIP`, `svgDataUri`, `artLayer`, `at`, `font`, `skyLayer`, `HaloRing`, `halo`, `pulse`, `DOT_FILTER`, `onCurve`, `hexImage`, `drawable`, `pips`, `hexBullet`.
  - Task 3: `Stop`, `cssLinear`, `cssRadialSpot`, `TierLook`, `TIER_LOOKS`, `HOLO_STOPS`, `TagBox`, `BACK_TAG`, `FRONT_TAG`, `TAG_RADIUS`, `ETCH_FILTER`, `PLANET_LAYOUTS`, `onTag`, `skyChoices`, `loreSize`, `loreRows`, `cardName`, `marineTree`, `MEME_SIZE`, `sniffImage`, `memeTree`, `LinkMarineCards` (`prepareMeme`, `renderMarineCard`), the fixtures `DRAWABLE_TEXT`, `MARINES`, `marine`.
  - Task 4: `gifenc`'s declaration, `GLINT`, `TRANSPARENT`, `tagFrame`, `glintAt`, `GlintFrames`, `glintFrames`, `glintGif`, `LinkMarineCards.renderMarineGlint`.
  - Task 5: `ChainArt`, `iconBackground`, `glowColor`, `chainArt`, `chainArts`, `NO_ART`, `chainHexUnder`, `chainHexFrame`, `chainHexIcon`, `capWeekday`, `plainDay`, `shortWeekday`, `clock`, `BLUE_TEXT`, `GOLD_TEXT`, `daySeed`, `intelFrame`, `eyebrow`, `caption`, `asOf`, `b`, `textRow`, `bulletRow`, `change`, `bend`, `LANE_SLOTS`, `roughCount`, `dayFraction`, `placeLanes`, `laneLabel`, `sitrepTree`, `PARTNER_SLOTS`, `titleSize`, `highlight`, `dossierTree`, the fixtures `AVALANCHE`, `BASE`, `ETHEREUM`, `MONAD`, `PLASMA`, `ROBINHOOD`, `SITREP`, `DOSSIER`.
  - Task 6: `dueText`, `vaultTree`, `MEDAL_X`, `medalValue`, `medalSize`, `recordsTree`, `intelSelectors`, `intelTree`, `LinkMarineEnv`, `LinkMarineCards.renderIntelCard`, `cards:linkmarine`, the fixtures `VAULT`, `RECORDS`.
  - Task 7: `Env`, `verifyDiscordRequest`, `InteractionType`, `ResponseType`, `EPHEMERAL`, `DiscordUser`, `DiscordMember`, `CommandOption`, `Interaction`, `json`, `privateReply`, `deferred`, `optionValue`, `invoker`, `displayName`, `avatarUrl`, `ONLY_HERE`, `Handlers`, `handleInteraction`, `NO_HANDLERS` (gone in Task 11), the helpers `GUILD`, `APP`, `command`.
  - Task 8: `CallsignSnapshot`, `LoreLine`, `Draw`, `MAX_CLASHES`, `TIER_CUTS`, `tagChances`, `drawTags`, `scoreOf`, `tierOf`, `percentileOf`, `tagKey`, `drawCallsign`, `drawLore`, `pickMemes`, `cutAt`, `simulate`, `cryptoRandom`, the helper `SNAPSHOT`.
  - Task 9: `SIMULATED_DRAWS`, `SIMULATION_SEED`, `MAX_TAG_LENGTH`, `MAX_LORE_LENGTH`, `ArchiveMeme`, `SnapshotInput`, `buildSnapshot`, `readArchive`, `readAllowedTags`, `readLore`, `discord:snapshot`, `callsigns.json`.
  - Task 10: `MarineMeme`, `Marine`, `findMarine`, `Recruit`, `Drafted`, `EnlistResult`, `enlist`, `setCardKey`, `rawMemeUrl`, `memeKey`, `MEME_TIMEOUT_MS`, `stockMemes`, `loadMemes`, the helpers `resetStorage`, `PNG_BYTES`, `GIF_BYTES`, `fakeRenderer`, `fakeFetch`.
  - Task 11: `DISCORD_API`, `Attachment`, `DiscordApi`, `DiscordError`, `discordApi`, `Alert`, `createAlerter`, `Bot`, `SNAPSHOT` (bot), `createBot`, `PLATFORM`, `STEP_MS`, `TEXT`, `revealSteps`, `cardKey`, `stampCard`, `marineCard`, `reveal`, `enlistCommand`, `dogtagCommand`, `botHandlers`, the helpers `DiscordCall`, `fakeDiscord`, `ARCHIVE_ROUTES`, `FakeBot`, `fakeBot`.
  - Task 12: `sitrepCard`, `chainTotals`, `findChain`, `MAX_CHOICES`, `chainChoices`, `dossierCard`, `weeklyDeposits`, `vaultCard`, `recordsCard`, the fixtures `ETH`, `BASE`, `ARB`, `MONAD`, `AVAX`, `PLASMA`, `WEMIX`, `CHAINS`, `TODAY`, `HISTORY`, `REPLAY`, `SOURCES`, `RESERVE`.
  - Task 13: `DATA_BASE`, `DATA_TTL_MS`, `DataError`, `PublicData`, `clearDataCache`, `publicData`, `Bot.data`, `INTEL_TTL_MS`, `INTEL_TEXT`, `COMMAND_KINDS`, `intelKey`, `intelCommand`.
  - Task 14: `COMMANDS`, `CommandName`, `guildIdFrom`, `registerRequest`, `discord:register`, `DISCORD_BOT`.
- **Checked on 2026-10-13:**
  - Every task's code was prototyped in a scratch worktree of this repository and its tests run there; the measurements and renders in "Decisions" come from it. The plan's code blocks are generated from fourteen commits rebuilt from that prototype, one per task, each built by writing the task's tests, seeing them fail, writing its code and seeing every listed run pass; every "replace" block's old text occurs exactly once in its file at that point.
  - The plan was then replayed on a fresh worktree of `main` by a script that applies each step's blocks, runs each `Run:` and checks it against its `Expected:` PASS or FAIL, and makes each commit with its explicit `git add` paths. Every new test failed before its implementation (all 14 red runs), every one of the 54 runs matched its `Expected:`, every commit left nothing unstaged, and the end state matched the prototype file for file. At the end: core 552, site 1,193 (Node) and 21 (workerd), the bot 72, the data Worker 518 and the scripts 354 tests, and `pnpm typecheck` clean. The snapshot came out byte for byte the same from the archive at `ec873ea`. These notes were written after the replay; nothing above them changed.
  - The Discord docs were read at discord/discord-api-docs commit 37148620; the Cloudflare docs through their search and pages (service bindings, RPC, Web Crypto, `waitUntil`, limits); Wrangler's `config-schema.json` 4.147.0 for `services[].entrypoint`. `.github/workflows/deploy.yml` passes `actionlint`, and `wrangler deploy --dry-run` binds `env.SITE (ccip-dev-site#LinkMarineCards)`, `env.DB` and `env.MARINES` (979.55 KiB).
  - The scratch worktrees and their branches are deleted.
