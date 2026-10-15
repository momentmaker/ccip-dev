# LinkMarines on Telegram: enlist, dog tags and the sticker pack

**Status:** Approved by the owner, 2026-10-15 · **Date:** 2026-10-15 · **Builds on:** `2026-10-13-linkmarine-bot-design.md` and `2026-10-13-linkmarines-roster-design.md`

The Discord LinkMarine bot enlists a member with `/enlist`. It draws three random meme tags into a callsign that is unique everywhere, sets a tier, assigns a serial and stamps a dog-tag card. That bot design called Telegram "a later, separate front door". This spec builds it: a Telegram twin of the enlist flow, plus three things only Telegram can do. Telegram gets no stats commands.

**Owner decisions (2026-10-15):**
- **Where to enlist:** in a DM with the bot. Only members of an approved chat can enlist: the @ccipdev channel, plus LinkMarine groups on an allowlist.
- **What to build:** the core enlist and dogtag twin, card buttons, enlist links with a site call-to-action, and the dog-tag sticker pack.
- **Out of scope:** inline sharing and group roll call.

## 1. Goal and success

A LinkMarine on Telegram can enlist in a few taps and get the same draw, rarity and dog-tag card as on Discord. Their Marine joins the shared roster under a serial and callsign unique across both platforms. Every Marine, from either platform, also becomes a sticker in the "LinkMarines" pack.

**Success:**
- **Matching:** the draw, tiers, serials, uniqueness, card look and one-draw-forever rule are identical to Discord's, because both platforms run the same code.
- **Gated:** someone outside the approved chats can't take a serial.
- **Private:** a Marine's name and photo appear only on their own bot card. Nothing public carries them, and nothing links a Discord account to a Telegram one.
- **Self-running:** after one owner setup command, enlisting, stickers and retries need no owner step.

## 2. Architecture

The design uses the existing Discord Worker (`ccip-dev-discord`, `discord.ccip.dev`). It already owns the Marines D1 (`ccip-dev-marines`), the R2 bucket, the `SITE` card-renderer binding and the alerts. The bot is the existing @ccipdevbot. It already posts the channel and alerts with `TELEGRAM_BOT_TOKEN`, which the Discord Worker already holds.

**The shared enlist core:**
- The platform-neutral parts of `discord/src/marines.ts` and `store.ts` move into one module: find or enlist by `(platform, user_id)`, draw, store, stamp, and the reveal steps. Discord and Telegram become thin adapters over it.
- `PLATFORM = 'discord'` becomes an argument. A Telegram Marine is `platform = 'telegram'`, `user_id = <Telegram user id>`, with no migration for identity.
- Discord's existing tests must pass unchanged through the move.

**Identity rules (unchanged from the bot design):**
- One Marine per `(platform, user_id)`.
- Callsigns are unique across platforms (`tag_key`). Serials are shared, and so are the plank-owner seats (#1–100).
- A Telegram account and a Discord account are never linked, and each gets its own Marine.

## 3. The Telegram flow

**The gate:**
- `/start`, `/enlist` and the deep link `t.me/ccipdevbot?start=enlist` first check membership with `getChatMember` in each gate chat (`TELEGRAM_GATE_CHATS`: `@ccipdev` plus group IDs). A Marine already enlisted skips the check.
- **Member** means the status `creator`, `administrator` or `member`, or `restricted` with `is_member`. The bot must be an admin in the channel (it already is) and a member of each group.
- A non-member gets: "Join t.me/ccipdev to enlist", with a **Join** URL button and an **I've joined, enlist me** button that runs the check again.

**Enlisting happens in a DM:**
- **The reveal.** It mirrors Discord's `revealSteps`: the bot sends "Drawing…", then edits the message to reveal the tags one at a time, ending with the RARE or LEGENDARY banner where one applies.
- **The card.**
  - The stamped card is sent with `sendPhoto`, or, for Rare and up, as the glint GIF with `sendAnimation` (multipart, from R2).
  - The caption is `LINK MARINE #0042 · PEPE-MOON-ORACLE · Rare, rarer than 88%`, in the same wording as Discord's.
  - If the card isn't stamped 18 s after the update arrived, the last edit says it's being stamped (`STAMP_DEADLINE_MS`, as on Discord), and `/dogtag` shows it later.
- **The stamped name and photo.**
  - The name is first name plus last name, trimmed. If that's empty, it's `@username`; failing that, "Marine". It's stamped once, as on Discord.
  - The photo comes from `getUserProfilePhotos` (limit 1), using its largest size up to 640 px, through `getFile`, and is saved to R2 `avatars/<serial>.png`. If it's hidden or missing, the card uses the existing gradient disc.
- **Already enlisted:** "You're already enlisted, Marine.", plus the card. There's no re-draw, no edit and no cooldown, as on Discord.

**`/dogtag`:**
- With no argument it shows your own bot card, stamping it if missing.
- With a serial or callsign argument (`/dogtag 42`, `/dogtag PEPE-MOON-ORACLE`) it shows that Marine's **public web card** (`web/<serial>.png`): callsign only, with no name or photo, whatever platform the Marine came from.

**In groups (allowlisted only):**
- `/enlist` replies "Enlisting happens in a DM", with a URL button to `t.me/ccipdevbot?start=enlist`.
- `/dogtag` works in place, with the same rules.
- Added to a group that isn't on the allowlist, the bot calls `leaveChat` straight away.

**Card buttons** (an inline keyboard under every card the bot sends):
- **Share my tag:** `https://t.me/share/url?url=https://ccip.dev/marines/0042/&text=…`, the Telegram share sheet with the Marine's public page, whose OG image is the web card. This button appears only under your own card.
- **See the roster:** `https://ccip.dev/marines/`.
- **Who else drew PEPE?**, one button per tag, with callback data `tag:<tag>`. The bot answers with:
  - the tag's first discoverer (the lowest serial carrying it): `#0007 PEPE-…`;
  - how many Marines carry it;
  - the tag's chance in the current snapshot;
  - a roster link filtered to that tag.

**The command menu** is set with `setMyCommands`: `/enlist`, `/dogtag`, `/help`. `/help` explains enlisting, dog tags, the stickers and the roster.

## 4. The dog-tag sticker pack

**The art:**
- A new renderer method on `LinkMarineCards`, `renderMarineSticker(marine)`.
- It draws the card's two dog tags on their ball chain, in the Marine's tier metal, showing `#0042` and the callsign.
- It's 512×512 with a transparent background, rendered by the card renderer (Satori/resvg).
- It carries no name or photo, so it's safe to be public, like the web card.

**The packs:**
- Pack *n* is named `linkmarines_by_ccipdevbot` for *n* = 1, and `linkmarines<n>_by_ccipdevbot` after that. It's titled `LinkMarines Vol. <n> · ccip.dev`.
- Telegram caps a static pack at 120 stickers, so a Marine's pack is fixed by their serial: Vol. ⌈serial / 120⌉. Plank owners are Vol. 1.
- The emoji is 🎖.

**Ownership.** Telegram requires each pack to have a user owner who has started the bot. That's the owner's Telegram user ID (`TELEGRAM_STICKER_OWNER_ID`).
- The owner setup command creates Vol. 1.
- The job creates each later volume with `createNewStickerSet` when its first sticker is due.

**The job:**
- A new cron on the Discord Worker, `*/10 * * * *`, adds up to `STICKERS_PER_RUN = 10` missing stickers, oldest serial first. Each one is `uploadStickerFile`, then `addStickerToSet`.
- It covers new enlistments from either platform, the backfill of every existing Marine, and retries.
- Each Marine's sticker is stored, so nothing is added twice. A new migration, `discord/migrations/0002_stickers.sql`, adds `sticker_set TEXT` and `sticker_file_id TEXT` to `marines`. This is a schema-only change.
- A Telegram 429 stops the run and retries next run. Any other failure alerts `telegram-sticker:<serial>` once.

**Telling people:**
- A Telegram Marine whose sticker is added gets a DM: "You're sticker #42 in LinkMarines Vol. 1", with the sticker and an **Add the pack** button (`https://t.me/addstickers/<set>`).
- The Discord card message mentions the pack.
- The roster page links every volume.

**Wiping a test Marine** (runbook): also `deleteStickerFromSet` with the stored `sticker_file_id`.

## 5. Plumbing, security and config

**Webhook:**
- `POST /telegram` on the Discord Worker. It accepts a request only if `X-Telegram-Bot-Api-Secret-Token` equals `TELEGRAM_WEBHOOK_SECRET`, compared in constant time; anything else gets 401.
- It answers 200 at once and handles the update in `waitUntil`, as the Discord route does.
- Each `update_id` is handled once (a key in `meta`, claimed before work), because Telegram redelivers updates.
- `allowed_updates` is `["message", "callback_query", "my_chat_member"]`. The last one is what tells the bot it was added to a group.

**Switch:** `TELEGRAM_BOT` (`on` or `off`, default `off`), like `DISCORD_BOT`. When it's off, the route answers 200 and ignores the update.

**Config:**
- **Secret:** `TELEGRAM_WEBHOOK_SECRET`, new and owner-set.
- **Vars:** `TELEGRAM_GATE_CHATS` (comma-separated, starting `@ccipdev`) and `TELEGRAM_STICKER_OWNER_ID`.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` already exist on this Worker.

**Owner setup** is one command run on the owner's machine with the bot token from `.env`, never pasted anywhere: `pnpm telegram:setup`. It calls `setWebhook` (URL, secret and `allowed_updates`), `setMyCommands` and `createNewStickerSet` for Vol. 1, and prints what it set.
- After a webhook exists, the runbook's "find a chat ID with getUpdates" step no longer works. The runbook gets an alternative: the bot replies to `/id` in a DM or group with that chat's ID, for allowlisted chats and the owner only.

**Alerts:** through the existing `alerts.ts` path, once an hour per signature. The signatures are `telegram-update`, `telegram-stamp:<serial>` and `telegram-sticker:<serial>`.

**Limits:**
- A few message edits per enlistment is well inside Telegram's limits.
- The sticker job's 10 per run, every 10 minutes, keeps clear of sticker rate limits. The backfill of the current roster takes a few hours.

## 6. The site

- The roster page hero and each Marine page show **Enlist on Discord** and **Enlist on Telegram** side by side. The Telegram button goes to `t.me/ccipdevbot?start=enlist`.
- Copy that names only Discord (the roster spec's hero and CTA, and the `/discord` page) is generalized.
- The roster page links the sticker packs, one link per volume that has stickers.
- The roster page reads `?tag=<tag>` and opens with that tag's wall filter applied. Today the filter can only be set by clicking. This is the link the "Who else drew PEPE?" reply uses.
- `/roster.json` is unchanged. Telegram Marines appear in it automatically, callsign only.

## 7. Testing

- **The shared core.** Discord's existing enlist, dogtag, store and draw tests pass unchanged after the refactor. New core tests run the same flow with `platform = 'telegram'`.
- **The Telegram adapter,** against a fake Telegram API (the `fakeFetch` pattern):
  - the secret header (rejected without it);
  - `update_id` de-duplication;
  - the gate, with each member status, plus the "I've joined" re-check;
  - the reveal edits in order;
  - photo vs animation by tier;
  - the stamp deadline;
  - already enlisted;
  - `/dogtag` own vs public card;
  - group `/enlist` redirecting to the DM;
  - leaving a group that isn't allowed;
  - the `tag:` callback reply;
  - the share URL;
  - the switch being off.
- **The sticker job:**
  - the pack for a serial (120 → Vol. 1, 121 → Vol. 2);
  - creating a new volume;
  - never adding twice;
  - a 429 stopping the run;
  - other failures alerting once;
  - the backfill order.
- **The renderer:** the sticker is 512×512 with an alpha channel, carrying the callsign and serial, with no name or avatar.
- **Privacy:** the roster privacy test extends to a Telegram Marine. No name, photo or user ID appears in `/roster.json`, `/web/<n>.png`, the sticker or the Marine page.
- **The site:** the enlist buttons and the pack links render, and the build passes.

## 8. Out of scope

- inline mode (`@ccipdevbot` in any chat);
- group roll-call announcements;
- stats and intel commands on Telegram;
- linking a Telegram account to a Discord Marine;
- the Oracle game;
- animated or video stickers.
