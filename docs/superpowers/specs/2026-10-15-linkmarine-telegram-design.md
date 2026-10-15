# LinkMarines on Telegram: a Mini App, a thin bot and the sticker pack

**Status:** Draft for owner review (revised: Mini App) · **Date:** 2026-10-15 · **Builds on:** `2026-10-13-linkmarine-bot-design.md` and `2026-10-13-linkmarines-roster-design.md`

The Discord LinkMarine bot enlists a member with `/enlist`. It draws three random meme tags into a callsign that is unique everywhere, sets a tier, assigns a serial and stamps a dog-tag card. That bot design called Telegram "a later, separate front door". This spec builds it as a **Telegram Mini App**: enlisting, your dog tag and the roster run inside Telegram, opened from @ccipdevbot. A thin bot supports it, and every Marine also becomes a sticker. Telegram gets no stats commands.

**Owner decisions (2026-10-15):**
- **Where to enlist:** inside the Mini App. Only members of an approved chat can enlist: the @ccipdev channel, plus LinkMarine groups on an allowlist.
- **What to build:**
  - a **Mini App with a thin bot** (no chat `/enlist` or `/dogtag`);
  - the four screens from the approved mockup: welcome and gate, the draw, your dog tag, the roster;
  - enlist links with a site call-to-action;
  - the dog-tag sticker pack;
  - a 9:16 Story card;
  - a dog tag that shimmers when you tilt the phone.
- **Out of scope:** inline sharing, group roll call, recruiting links, the Tag Vault and emoji status.

## 1. Goal and success

A LinkMarine on Telegram opens the Mini App, enlists in one tap, watches a full-screen draw and gets the same callsign, tier and dog-tag card as on Discord. They can share it to their Story and browse the shared roster without leaving Telegram. Every Marine, from either platform, also becomes a sticker in the "LinkMarines" pack.

**Success:**
- **Matching:** the draw, tiers, serials, uniqueness, card look and one-draw-forever rule are identical to Discord's, because both platforms run the same code.
- **Gated and fair:** someone outside the approved chats can't take a serial, and the draw is decided on the server, never in the app.
- **Private:** a Marine's name and photo appear only on their own card, and only that Marine is ever served it. Nothing public carries them, and nothing links a Discord account to a Telegram one.
- **Self-running:** after the owner setup, enlisting, stickers and retries need no owner step.

## 2. Architecture

| Piece | Where | Does |
|---|---|---|
| **Mini App** | `ccip.dev/tg/` (site, static Astro page with a React island) | The four screens. Talks only to the Mini App API. |
| **Mini App API** | the Discord Worker, `discord.ccip.dev/tg/*` | Verifies Telegram launch data, checks the gate, enlists, and serves your card. |
| **Thin bot** | the Discord Worker, `POST /telegram` (webhook) | Handles `/start`, the menu button, `/id`, leaving unapproved groups, and the sticker DMs. |
| **Shared enlist core** | `discord/src` (moved out of `marines.ts` and `store.ts`) | Draw, store and stamp for any platform. |
| **Renderer** | the site Worker `LinkMarineCards` | Adds two renders: the sticker (§5) and the Story card (§4). |
| **Sticker job** | the Discord Worker cron | Adds every Marine's sticker to the pack. |

The Discord Worker (`ccip-dev-discord`) already owns the Marines D1 (`ccip-dev-marines`), the R2 bucket, the `SITE` renderer binding and the alerts. The bot is the existing @ccipdevbot, whose `TELEGRAM_BOT_TOKEN` the Worker already holds.

**The shared enlist core:**
- The platform-neutral parts of `discord/src/marines.ts` and `store.ts` move into one module: find or enlist by `(platform, user_id)`, draw, store and stamp.
- `PLATFORM = 'discord'` becomes an argument. A Telegram Marine is `platform = 'telegram'`, `user_id = <Telegram user id>`, with no identity migration.
- Discord's existing tests must pass unchanged through the move.

**Identity rules (unchanged from the bot design):**
- One Marine per `(platform, user_id)`.
- Callsigns are unique across platforms (`tag_key`). Serials are shared, and so are the plank-owner seats (#1–100).
- A Telegram account and a Discord account are never linked, and each gets its own Marine.

## 3. The Mini App

**Launch:**
- The Mini App is registered with @BotFather as `marines`, so its direct link is `t.me/ccipdevbot/marines`.
- It opens from the bot's menu button, from the button the bot sends on `/start`, and from that link with a `startapp` parameter: `enlist`, `marine_<serial>` or `tag_<tag>`.
- The page loads Telegram's `telegram-web-app.js` (on `/tg/` only), calls `expand()`, and sets the header and background colors to the ccip.dev dark theme.
- Opened outside Telegram, it shows "Open in Telegram" with the direct link.

**The screens** (from the owner-approved mockup):
1. **Welcome and gate.**
   - It shows "Enlist, Marine.", one line on the draw ("Three tags from the LinkMarine meme vault become your callsign. One draw, forever."), the plank-owner seats (a 10-column hex grid of the first seats, and "98 of 100 left"), and the counts of Marines and of tags in the vault.
   - The primary action is Telegram's native **MainButton**, "ENLIST".
   - If the gate fails: "Not in @ccipdev yet? Join the channel to enlist", with **Join** (`openTelegramLink('https://t.me/ccipdev')`) and **Check again**.
   - A Marine already enlisted lands on screen 3.
2. **The draw.**
   - After `POST /tg/enlist` returns, three meme hexes spin and lock in one by one, left to right, about 0.8 s each, with `HapticFeedback.impactOccurred('medium')` at each lock. The callsign fills in below them.
   - Each tag shows its meme count and per-draw chance.
   - Rare and Legendary end with their banner and `notificationOccurred('success')`.
   - The MainButton shows "DRAWING…" and is disabled throughout.
3. **Your dog tag.**
   - It shows the tier banner (for example "RARE · RARER THAN 88%"), your card (§4), and `LINK MARINE #0042` with the callsign.
   - The buttons are **Add the LinkMarines sticker pack** (`openTelegramLink` to your volume), **Share my page** (the Telegram share sheet with `ccip.dev/marines/0042/`) and **See the roster**.
   - The gold MainButton is **SHARE TO STORY** (§4).
   - The card tilts and shimmers (§4).
4. **The roster.**
   - The site's roster pieces in a mobile layout: Wall, Constellation and Rarest tabs, the ticker, the Marine list and today's most wanted.
   - Tapping a tag opens a sheet with its meme count, per-draw chance, first discoverer and how many Marines carry it.
   - Tapping a Marine shows their public web card.
   - The MainButton is "MY DOG TAG" when you're enlisted, otherwise "ENLIST".
   - Telegram's BackButton returns to the previous screen.

**Deep links:**
- `marine_<serial>` opens the roster on that Marine.
- `tag_<tag>` opens the roster with that tag's sheet.
- `enlist` opens screen 1.

**The switch is off:** the API reports it, and the app shows "LinkMarines on Telegram opens soon" in place of the MainButton.

## 4. Your card, the Story card and the tilt

**Your card:**
- It's the same bot card as Discord's (the two dog tags, hex halo, meme hexes and right panel), stamped with your Telegram name and photo.
- **Name:** first name plus last name, trimmed. If that's empty, `@username`; failing that, "Marine". It's stamped once, as on Discord.
- **Photo:** the launch data's `photo_url` if present, otherwise `getUserProfilePhotos` (limit 1, largest size up to 640 px, through `getFile`). It's saved to R2 `avatars/<serial>.png`. If it's hidden or missing, the card uses the existing gradient disc.
- Rare and up show the glint GIF.
- Stamping runs in the background after enlisting. The app polls `POST /tg/card` and shows the reveal's last frame with "Stamping your dog tag…" until the card is ready.

**The Story card:**
- A new render, `renderMarineStory(card: MarineWebCard)`: 1080×1920, the dog tags large in the tier metal, then the serial, callsign and tier, then the three meme hexes, then "ccip.dev · LinkMarines".
- It carries no name or photo.
- It's served publicly at `discord.ccip.dev/story/<serial>.png`, stored in R2 `story/<serial>.png` and stamped with the card. A Marine without one gets it rendered on the first request, as web cards are.
- **SHARE TO STORY** calls `shareToStory(storyUrl, { text: 'LINK MARINE #0042 · <CALLSIGN> · Enlist: t.me/ccipdevbot/marines', widget_link: { url: 'https://t.me/ccipdevbot/marines', name: 'Enlist' } })`. Telegram shows the widget link to Premium users. Everyone gets the text.
- Where `shareToStory` isn't supported, the button falls back to the share sheet with the Marine's page.

**The tilt shimmer:**
- On screen 3, the card rotates up to ±8° on both axes, following `DeviceOrientation` (Telegram's, if available, otherwise the browser's).
- A light streak in the tier's metal crosses it, positioned by the tilt.
- It's off under `prefers-reduced-motion` or when orientation isn't available. Nothing leaves the device.

## 5. The dog-tag sticker pack

**The art:**
- A new renderer method, `renderMarineSticker(card: MarineWebCard)`.
- It draws the two dog tags on their ball chain, in the Marine's tier metal, with `#0042` and the callsign.
- It's 512×512 with a transparent background.
- It carries no name or photo.

**The packs:**
- Pack *n* is named `linkmarines_by_ccipdevbot` for *n* = 1, and `linkmarines<n>_by_ccipdevbot` after that. It's titled `LinkMarines Vol. <n> · ccip.dev`, with emoji 🎖.
- Telegram caps a static pack at 120 stickers, so a Marine's volume is ⌈serial / 120⌉. Plank owners are Vol. 1.

**Ownership:** the owner's Telegram user ID (`TELEGRAM_STICKER_OWNER_ID`), who has started the bot.
- The setup command creates Vol. 1.
- The job creates each later volume with `createNewStickerSet` when its first sticker is due.

**The job:**
- A new Discord Worker cron, `*/10 * * * *`, adds up to 10 missing stickers per run, oldest serial first. Each one is `uploadStickerFile`, then `addStickerToSet`.
- It covers new Marines from either platform, the backfill of every existing Marine, and retries.
- Migration `discord/migrations/0002_stickers.sql` adds `sticker_set TEXT` and `sticker_file_id TEXT`. It is schema only; the job does the backfill.
- A 429 stops the run, and the job retries next run. Any other failure alerts `telegram-sticker:<serial>` once.

**Telling people:**
- A Telegram Marine whose sticker is added gets a bot DM: "You're sticker #42 in LinkMarines Vol. 1", with the sticker and an **Add the pack** button.
- The Mini App's dog-tag screen links the pack.
- The Discord card message mentions the pack.
- The roster page links every volume.

**Wiping a test Marine** (runbook): also `deleteStickerFromSet` with the stored `sticker_file_id`.

## 6. The thin bot

**Webhook:**
- `POST /telegram`. It checks `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET` in constant time (401 otherwise).
- It answers 200 at once and does the work in `waitUntil`.
- Each `update_id` is handled once (a key in `meta`, claimed before work).
- `allowed_updates` is `["message", "my_chat_member"]`.

**What it does:**
- **`/start`** (with or without a payload) in a DM: one line ("Enlist and get your LinkMarine dog tag."), with an inline **Open LinkMarines** `web_app` button. A `start` payload carries through as the Mini App's `startapp`.
- **`/start` in an allowlisted group:** a URL button to `t.me/ccipdevbot/marines` (`web_app` buttons work only in DMs).
- **The menu button** in DMs is a `web_app` button, "LinkMarines", opening `ccip.dev/tg/`. It's set once by the setup command.
- **`/id`:** replies with the chat's ID, for allowlisted chats and the owner only. It replaces the runbook's getUpdates step, which no longer works once a webhook exists.
- **Added to a group not on the allowlist** (`my_chat_member`): it calls `leaveChat`.
- **The sticker DMs** (§5).

## 7. The Mini App API

All of these routes are on `discord.ccip.dev`:
- **CORS:** they allow only `https://ccip.dev`, and answer `OPTIONS`.
- **Requests:** each carries `{ initData }`, Telegram's raw launch string, in a POST body, so it never appears in a URL.

**Verifying the launch data:**
- Build the data-check string: every field except `hash`, sorted, as `key=value` joined by `\n`.
- `secret_key = HMAC_SHA256(key = "WebAppData", msg = TELEGRAM_BOT_TOKEN)`.
- Accept when `hex(HMAC_SHA256(secret_key, data_check_string))` equals `hash` in constant time and `auth_date` is within 24 h.
- Otherwise answer 401. The user comes from the verified `user` field.

**The routes:**
- **`POST /tg/session`** → `{ switch: 'on' | 'off', marine: MarineSummary | null, gate: 'ok' | 'join' }`.
  - `MarineSummary` is serial, callsign, tags, tier, percentile, memes, sticker volume and whether the card is ready.
  - A Marine already enlisted skips the gate.
- **`POST /tg/enlist`.**
  - Answers 403 `{ gate: 'join' }` if the user fails the gate.
  - Otherwise it runs the shared core for `('telegram', user.id)` and answers `{ already: boolean, marine: MarineSummary, banner: 'rare' | 'legendary' | null }`.
  - Stamping (the card, web card, Story card and avatar) runs in `waitUntil`.
  - A user who is already enlisted gets `already: true` and their Marine, with no draw.
- **`POST /tg/card`.** Answers the requesting user's own card image (`image/png`, or `image/gif` for the glint) with `Cache-Control: private, no-store`, or 202 while it's stamping. It never serves any other Marine's card.

**The gate:** `getChatMember` in each `TELEGRAM_GATE_CHATS` chat (`@ccipdev` plus group IDs). Member means the status `creator`, `administrator` or `member`, or `restricted` with `is_member`. If every check errors, for example because the bot was removed from the channel, the gate fails closed: the user sees the join screen, and an alert `telegram-gate` fires once.

**The switch:** `TELEGRAM_BOT` (`on` or `off`, default `off`). When it's off, the API answers `{ switch: 'off' }` and refuses enlists (409), and the webhook ignores updates.

## 8. The site

- **The Mini App page:** `site/src/pages/tg/index.astro`. It's `noindex`, uses the site's dark theme and reuses the roster components in a mobile layout.
- **Enlist buttons:** the roster page hero and each Marine page show **Enlist on Discord** and **Enlist on Telegram** side by side. The Telegram one goes to `https://t.me/ccipdevbot/marines?startapp=enlist`.
- **Copy:** text that names only Discord (the roster hero and CTA, and the `/discord` page) is generalized.
- **Sticker packs:** the roster page links them, one link per volume that has stickers.
- **`?tag=`:** the roster page reads `?tag=<tag>` and opens with that tag's wall filter applied.
- **`/roster.json`** is unchanged. Telegram Marines appear automatically, callsign only.

## 9. Config and owner setup

- **New secret:** `TELEGRAM_WEBHOOK_SECRET` (owner-set with `wrangler secret put`, never pasted).
- **New vars:** `TELEGRAM_GATE_CHATS` (comma-separated, starting `@ccipdev`), `TELEGRAM_STICKER_OWNER_ID`, and `TELEGRAM_BOT` (a GitHub variable feeding the deploy, like `DISCORD_BOT`).
- **Existing:** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID`.

**Owner setup, in order:**
1. @BotFather `/newapp` for @ccipdevbot.
   - Title: LinkMarines.
   - Short name: `marines`.
   - URL: `https://ccip.dev/tg/`.
   - Photo: the 640×360 image this work commits at `site/public/marines-app-640x360.png`.
2. Start the bot from your own account (needed to own the sticker pack).
3. `pnpm --filter @ccip-dev/discord exec wrangler secret put TELEGRAM_WEBHOOK_SECRET`.
4. Set the two variables in `discord/wrangler.toml` through a commit, or ask Claude to make that commit.
5. `pnpm telegram:setup` on your machine, with the bot token from `.env`. It runs `setWebhook` (with the URL, secret and `allowed_updates`), `setMyCommands` (`/start`), `setChatMenuButton` and `createNewStickerSet` for Vol. 1, and prints what it set.
6. `gh variable set TELEGRAM_BOT --body on` to open it.

**Alerts:** once an hour per signature through `alerts.ts`. The signatures are `telegram-update`, `telegram-gate`, `telegram-stamp:<serial>` and `telegram-sticker:<serial>`.

## 10. Testing

- **The shared core.** Discord's existing tests pass unchanged after the refactor. New core tests run the flow with `platform = 'telegram'`.
- **The API:**
  - launch-data verification: valid, stale, tampered and missing;
  - CORS;
  - the gate: each status, every check erroring, and an enlisted Marine skipping it;
  - enlist, new and already;
  - the switch off;
  - `/tg/card` serving only the requester's card, with 202 while stamping.
- **The bot:**
  - the secret header;
  - de-duplication;
  - `/start` in a DM (`web_app` button, payload carried through) and in a group (URL button);
  - `/id` for allowed and disallowed chats;
  - leaving a group that isn't allowed.
- **The sticker job:**
  - the volume for a serial (120 → 1, 121 → 2);
  - creating a new volume;
  - never adding twice;
  - a 429 stopping the run;
  - an alert on any other failure;
  - the backfill order.
- **The renders:**
  - the sticker is 512×512 with an alpha channel;
  - the Story card is 1080×1920;
  - neither carries a name or avatar.
- **The Mini App:**
  - each screen renders from fixtures: gate failing, enlisted, the switch off, and outside Telegram;
  - the deep-link routing;
  - the draw's lock order;
  - the tilt turning off under reduced motion;
  - the build passes within the site's bundle budget for `/tg/`.
- **Privacy:** no name, photo or Telegram ID appears in `/roster.json`, `/web/<n>.png`, `/story/<n>.png`, the sticker or the Marine page. `/tg/card` refuses other users.

## 11. Out of scope

- chat `/enlist` and `/dogtag` on Telegram;
- inline mode;
- group roll call;
- recruiting links;
- the Tag Vault;
- emoji status;
- stats and intel on Telegram;
- account linking;
- the Oracle game;
- animated stickers.
