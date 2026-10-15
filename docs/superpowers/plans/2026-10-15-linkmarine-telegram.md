# LinkMarines on Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LinkMarines on Telegram: a Mini App at `ccip.dev/tg/` that enlists members of @ccipdev and approved groups through the same enlist core as Discord, plays the draw, shows the Marine's own dog tag (tilting, shareable to a Story) and the roster; a thin @ccipdevbot webhook; and a sticker job that puts every Marine, from either platform, in the LinkMarines sticker packs. All of it stays shut behind the `TELEGRAM_BOT` switch until the owner opens it.

**Architecture:** The Discord Worker (`ccip-dev-discord`) gets the platform-neutral enlist core, moved out of `marines.ts` as a pure refactor, then the Mini App API (`POST /tg/session`, `/tg/enlist`, `/tg/card`; CORS for `https://ccip.dev`; launch data verified with Web Crypto HMAC), the webhook (`POST /telegram`), a public `/story/<serial>.png` route and a `*/10` cron for the stickers, all through a small Bot API client of its own. The site Worker's `LinkMarineCards` renderer gets `renderMarineSticker` and `renderMarineStory`, both drawn from a new tags-only tree in two Satori passes. The site gets the static `/tg/` page (one React island that reuses the roster components) and the Telegram enlist links, which its build turns on from the same `TELEGRAM_BOT` variable.

**Tech Stack:** TypeScript (ESM), pnpm workspace, Vitest 4 (Node for core, the site and the scripts; `@cloudflare/vitest-plugin`'s workerd pool for the Discord Worker, with real D1 and R2, and for the site's renders), Web Crypto (HMAC-SHA256, `crypto.subtle.timingSafeEqual`), `@cf-wasm/og` 0.5.0 (Satori and resvg), Astro 7 with React 19, the Telegram Bot API and Mini Apps (`telegram-web-app.js`). No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-15-linkmarine-telegram-design.md`. **The screens' target:** the owner-approved mockup `.superpowers/brainstorm/6380-1792081577/content/miniapp-screens.html` (four phone screens, inline CSS; never stage it). Background: `docs/superpowers/specs/2026-10-13-linkmarine-bot-design.md`, `docs/superpowers/specs/2026-10-13-linkmarines-roster-design.md`, `docs/runbook.md` ("Discord bot (LinkMarine)", "The public roster").

## Global Constraints

- **Free services only.** The Telegram Bot API, Mini Apps and sticker sets are free, and Workers Paid is already in place. No paid API and no new dependency.
- **Secrets are never pasted, printed, logged or committed.** The owner sets them through prompts or pipes, and every owner step is an exact command in the runbook (Task 13). Never run `wrangler … --remote`, `wrangler secret put`, `gh variable set` or a call to the real bot; never create a Telegram or Cloudflare resource. Code that holds the bot token never puts it in an error, an alert or a log line.
- **Privacy** (spec §1): "a Marine's name and photo appear only on their own card, and only that Marine is ever served it. Nothing public carries them, and nothing links a Discord account to a Telegram one." So `/roster.json`, `/web/`, `/story/`, the sticker, the Mini App's `MarineSummary` and the site never carry a name, a photo or a Telegram id; `/tg/card` serves only the user the verified launch data names; the launch data travels in a POST body, never in a URL or a log; `/tg/` loads no analytics.
- **One draw forever** (spec §1): "the draw, tiers, serials, uniqueness, card look and one-draw-forever rule are identical to Discord's, because both platforms run the same code." One Marine per `(platform, user_id)`; callsigns unique across platforms (`tag_key`); serials and the plank-owner seats shared.
- **The switch** `TELEGRAM_BOT` (`on` or `off`, default `off`) stays off until the owner turns it on, so nothing is user-visible early: the API answers `{ switch: 'off' }` and refuses enlists with 409, the webhook drops every update, the sticker job and the Discord card's sticker line stay off, and the site shows no Telegram link. The `/tg/` page and `/story/<n>.png` exist from their tasks on, linked from nowhere.
- **Migrations are schema only.** `discord/migrations/0002_stickers.sql` adds two columns; the sticker job does the backfill. A big data-backfill D1 migration timed out in production before.
- **D1:** at most 100 bound parameters per statement. The most any statement here binds is 14 (the existing insert).
- **The shared enlist core is a pure refactor** (Task 1): Discord's existing tests pass unchanged. No existing `*.test.ts` file changes anywhere in this plan; only the test helpers (`discord/test/helpers.ts`, `discord/test/site-stub.js`, `site/worker/test/png.ts`, `site/test/fixtures/linkmarine.ts`) gain things.
- **The mockup's four screens are the target** in structure, copy and look (its colours and sizes are copied into `site/src/styles/tg.css`). Two lines in it are notes to the owner, not copy: "(Shown only if the gate fails.)" and "Each hex spins and locks in with a haptic tap. The draw is decided on the server; the app only plays it."
- **Telegram's limits:** a static sticker is a 512×512 PNG of at most 512 KB, 120 to a set; set names `linkmarines_by_ccipdevbot`, then `linkmarines<n>_by_ccipdevbot`, title `LinkMarines Vol. <n> · ccip.dev`, emoji 🎖; the webhook secret is 1–256 of `A-Z a-z 0-9 _ -`; the Mini App's `startapp` values are `enlist`, `marine_<serial>` and `tag_<tag>` (tags are `[a-z0-9_]{1,13}`).
- **Comments** only where the why is not obvious from the code; none that restate it.
- **Commits:** conventional subjects. Stage explicit paths only: never `git add -A`, `git add .` or `git commit -a`, and never stage `.superpowers/` or `.DS_Store`. Every message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests and checks:**
  - Core: `pnpm --filter @ccip-dev/core exec vitest run test/<file>`.
  - Discord Worker (workerd, real D1 and R2): `pnpm --filter @ccip-dev/discord exec vitest run test/<file>`, all of it `pnpm --filter @ccip-dev/discord test`.
  - Site, Node: `pnpm --filter @ccip-dev/site exec vitest run test/<file>`; the renders, workerd: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/<file>`.
  - Scripts: `pnpm exec vitest run scripts/test/<file>` from the repo root.
  - Everything: `pnpm test` and `pnpm typecheck` at the root, green after every task. A heavy existing site test (`test/linkmarine-glint.test.ts`, 5 s timeout) can time out when `pnpm test` runs every package at once; if it does, run `pnpm --filter @ccip-dev/site test` alone before concluding anything.
  - New tests use the comments `// #given`, `// #when` and `// #then`.

## Review Focus

The inputs and conditions most likely to bite a Marine, each pinned by a test in the task that owns the code:

1. **Launch data replayed, or a valid launch for another user.** A Marine expects nobody else to enlist as them or see their card. Launch data is signed per user and lives 24 hours; any change to it breaks the HMAC; the API takes the user from it alone, and no route takes a serial. Replaying your own launch data within the day is allowed by design: it already holds your name and photo, and it is never logged or echoed.
   - Tests: Task 4 "refuses tampered launch data: another user swapped in after signing", "refuses launch data older than 24 hours, or from more than five minutes ahead", "refuses launch data signed with another bot's token"; Task 6 "answers 404 to someone not enlisted, whatever Marine the body names" and "answers 500 and alerts telegram-api:<route> when the database fails, without the launch data".
2. **A Telegram user with no last name or username, or no `photo_url` and a hidden profile photo.** They expect a card anyway: their name, else `@username`, else "Marine"; their photo, else the gradient disc. `photo_url` comes only from attachment-menu launches and may be an SVG.
   - Tests: Task 5 'is the first and last name, else @username, else "Marine"', "else asks for the newest profile photo, at the largest size up to 640 px", "is the gradient disc when the photo is hidden or there is none, keeping nothing"; Task 6 "stamps the Telegram name, never the Discord one of an account with the same id".
3. **The webhook redelivering while the first delivery is still running.** A member expects one answer to `/start`.
   - Tests: Task 8 "handles each update once, even when Telegram redelivers it while the first is still running".
4. **The sticker job racing a new enlistment, or losing Telegram's answer mid-add.** Every Marine expects to be in the pack exactly once.
   - Tests: Task 7 "leaves a Marine who enlists during a run for the next run, after the ones already queued", "settles a sticker whose answer was lost from the pack itself on the next run, adding nothing again", "makes a Marine due again when a lost add never reached the pack", "never adds a sticker twice", and "does nothing while LinkMarines on Telegram is off or has no sticker owner, or while another run holds the lock".
5. **The bot removed from @ccipdev** (or a wrong id in the gate list). A newcomer expects the join screen, and the owner expects to hear about it.
   - Tests: Task 5 "fails closed and alerts telegram-gate when no chat can be checked, as when the bot was removed from @ccipdev" and "turns away without an alert when one chat fails but another answers".
6. **`shareToStory` unsupported** in Telegram Desktop, on the web and in old clients. A Marine expects SHARE TO STORY to share something.
   - Tests: Task 10 "shares to Story on Telegram for phones from Bot API 7.8, and falls back everywhere else".
7. **The Mini App opened in a normal browser,** where `telegram-web-app.js` still loads, with empty launch data. A visitor expects to be pointed to Telegram, and the API is never called.
   - Tests: Task 10 "is the outside screen in a plain browser, where Telegram’s script loads without launch data" and "points to the Mini App in Telegram".
8. **The bundle size of `/tg/` with the roster components.** A Marine on a phone expects it to open fast. The budget is 130 KB of gzipped JavaScript; the prototype measured 108.4 KB.
   - Tests: Task 11 "has a bundle budget" and its build step, which runs `check-budgets.ts`.

Also checked and pinned, less likely to bite: Telegram's web clients frame the Mini App, which the site's `X-Frame-Options: DENY` would blank (Task 11 "may be framed by Telegram’s web clients, unlike the rest of the site"); Telegram passes the launch data in the URL's hash, which analytics would record, so `/tg/` loads none (Task 11's build step); the tilt under `prefers-reduced-motion` (Task 10 "stays off under prefers-reduced-motion, and where the phone reports no orientation"); a sticker over Telegram's 512 KB (Task 2 "stays under Telegram's 512 KB for a sticker"); ENLIST tapped twice (the store's `UNIQUE (platform, user_id)`, and Task 6 "answers an enlisted Marine with their own Marine, drawing nothing and checking no gate"); polling the card while it stamps (Task 6 "answers 202 while the card is stamping, starting one stamp however often it is asked").

## Decisions the spec leaves open or gets wrong

- **One Telegram client of the Discord Worker's own** (`discord/src/telegram-api.ts`), neither the data Worker's `worker/src/telegram.ts` nor a new one in `packages/core`. Core's boundaries would allow it (`packages/core/src/http.ts` and `reserve.ts` already make injected fetch calls), but the semantics differ: the data Worker's `withRetryAfter` sleeps out one 429 for up to 30 s inside a cron with minutes to spare, while here a request a Marine waits on can't sleep, the webhook answers at once, and the sticker job must stop its run on a 429. Moving the data Worker's helpers into core would also touch ingest-adjacent code for no gain. The new client never retries, never throws, never puts the token in a result, and returns Telegram's `retry_after` for the caller to act on. The Discord Worker's existing `alerts.ts` keeps its own `sendMessage` call.
- **Vol. 1 is created by the sticker job, not by `pnpm telegram:setup`.** The spec has the setup command run `createNewStickerSet` for Vol. 1, but the Bot API's `createNewStickerSet` takes "a JSON-serialized list of 1-50 initial stickers": a pack can't exist without a sticker, and a Marine's sticker is drawn by the Worker from memes in its R2 through the `SITE` binding, none of which the owner's machine has. Creating Vol. 1 from a sticker drawn elsewhere would also leave the job unaware of it, so it would add Marine #1 twice. So the job creates every volume the same way, Vol. 1 included, with the first sticker due in it; setup instead checks, with `getChat`, that the owner has started the bot (the requirement for owning a pack), and reports whether Vol. 1 exists yet.
- **Never adding twice:** a Marine is marked (`sticker_set` set, `sticker_file_id` NULL) before its sticker is added and recorded after, one at a time under a run lock (`meta` key `sticker-run`, 15 minutes). The pack then holds exactly one sticker per recorded Marine, in the order they were added. When Telegram's answer to an add is lost, the run stops and the next run counts the pack: one sticker more than recorded Marines is this Marine's; none more, and the Marine is due again. Packs are appended in serial order, but a Marine who fails is retried later, so the count, not the serial, places a sticker.
- **The sticker and Story card are drawn in two passes.** `tagsTree` draws the two tags and the chain alone, at the card's size on a transparent ground (lowered 24 mockup units so the chain's top stays in frame); the sticker and the Story card then place that PNG, scaled, with their own text. Satori's CSS `transform: scale()` on the tree was tried first: it drops the etched memes on the back tag. Measured in the prototype: stickers 186–206 KB (Telegram allows 512 KB); Story cards 1.32–1.44 MB, rendered in about 3–3.5 s; the tags upscaled 1.43× on the Story card stay sharp enough at phone size.
- **A Telegram Marine's photo:** `photo_url` is sent only for attachment-menu launches, and can be an SVG, which the card can't draw. So a JPEG `photo_url` on `t.me` is used when present, else `getUserProfilePhotos` (limit 1, the largest size up to 640 px, through `getFile`). The bytes, a JPEG, go through the site's existing `prepareMeme` to the 240 px PNG the card draws (the card's avatar element reads PNG only), kept in R2 `avatars/<serial>.png` as Discord's are. A hidden photo gives `total_count: 0`: the gradient disc.
- **The gate:** every chat is asked at once (4 s each). Telegram's 400 "user not found" means "not in the chat", an answer, not a failure. The gate fails closed with `telegram-gate` only when no chat at all could be checked.
- **Stamping and `/tg/card`:** a stamp claims `meta` key `tg-stamp:<serial>` for 60 s, so the Mini App's polling never stamps twice at once; a poll that finds no card after a claim has lapsed (a failed stamp) stamps again. `/tg/card` answers the GIF for Rare and up when there is one, else the PNG, with `Cache-Control: private, no-store`.
- **Alerts beyond the spec's four:** `telegram-api:<route>` for an unexpected failure of a Mini App request (a D1 error), which answers 500, and for twenty clashing draws on `enlist` (Discord's `discord-draw` case).
- **The switch on the site:** the site is static, so its build reads the same GitHub variable (`site.yml` passes `TELEGRAM_BOT` to `pnpm --filter @ccip-dev/site build`, and the pages read `process.env.TELEGRAM_BOT` in their frontmatter, which Astro evaluates at build). Off, the site renders exactly what it renders today. The owner's step 6 therefore also runs `gh workflow run site`. The Worker gets the switch from the deploy: `wrangler deploy --var "TELEGRAM_BOT:<on|off>"` (Wrangler 4.147 has `--var`; `wrangler deploy --dry-run` lists `env.TELEGRAM_BOT ("(hidden)")`). `discord/wrangler.toml` keeps `TELEGRAM_BOT = "off"` for local runs and tests.
- **`/id` and the owner:** the bot stays in a group the owner adds it to (anyone else's, not on the list, it leaves), so the owner can run `/id` there before allowlisting it. In a DM, `/id` answers the owner only. The owner's own id, needed before the webhook exists, comes from `getUpdates`, which works until the webhook is set (runbook step 2).
- **The bot's buttons:** `/start` in a DM answers with a `web_app` button to `https://ccip.dev/tg/` (`?startapp=<payload>` when the payload is one the app knows); in a group, a URL button to `https://t.me/ccipdevbot/marines` (`?startapp=` likewise). The app reads `start_param`, else `?startapp=`.
- **The sticker DM** is a text message, "You're sticker #<serial> in LinkMarines Vol. <n>", then the sticker with an **Add the pack** URL button. A Marine who opened the Mini App by link and never started the bot can't be messaged; that answer is ignored, not alerted.
- **The Discord card's sticker line** (spec §5, "The Discord card message mentions the pack"): once the switch is on, the text over a posted card (the reveal's last edit and `/dogtag`) is the callsign, a newline and `🎖 Sticker: LinkMarines Vol. <n> <https://t.me/addstickers/…>`; the angle brackets keep Discord from adding a preview.
- **The site's sticker pack links** are Vol. 1 to ⌈newest serial / 120⌉, since `/roster.json` is unchanged and carries no sticker state; the newest volume can be missing for the up to 10 minutes before its first sticker lands.
- **The screens, where the mockup is silent:**
  - Screen 1 shows 30 seats (the mockup's three rows of ten) and "—" until the roster loads; its MainButton ENLIST is shown but inactive while the gate says join.
  - Screen 2's hexes spin from the tap, and lock once the answer is in; a Rare or Legendary ends on "⚠ RARE DRAW" or "⚠ LEGENDARY DRAW", as Discord's reveal does, and the dog tag follows 1.4 s later. An enlisted Marine's ENLIST answer skips the draw.
  - Screen 3, while the card stamps, shows the draw's last frame and "Stamping your dog tag…", polling every 2 s; after about a minute it shows the public web card.
  - Screen 4's Wall tab is the mockup's compact list, newest first, 40 at a time; the ticker is the site's `Ticker`, restyled small and gold; Constellation and Rarest are the site's components (`RarestTen` gains an optional `onPickMarine`, so a row opens the Marine's sheet in the app instead of leaving it); the sheets close with ✕ or Telegram's BackButton.
  - Outside Telegram: "LinkMarines lives in Telegram." and an **Open in Telegram** link.
- **The tilt:** Telegram's `DeviceOrientation` (Bot API 8.0) when the client has it, else the browser's `deviceorientation`; ±8° on both axes for ±24° of phone tilt from where it was first held; a streak in the tier's metal crosses with it. Off under `prefers-reduced-motion`, and simply still where no orientation arrives.
- **`/tg/` may be framed:** `site/public/_headers` sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` everywhere, and Telegram's web clients run Mini Apps in an iframe. A `/tg/*` rule detaches both (Cloudflare's `! Header` syntax for Workers static assets). The page does nothing outside Telegram, so framing it elsewhere gains nothing.
- **No analytics on `/tg/`:** Telegram puts the launch data (name, id, photo URL, hash) in the URL's hash, and Umami's tracker can record the hash. `Base.astro` gets a `bare` mode for the Mini App: no header, footer, background pattern or analytics, and a `head` slot for Telegram's script.
- **The roster page's call to enlist** moves from `marines/index.astro` into `RosterPage` (the same markup while the switch is off), so it can list the sticker packs from the loaded roster.
- **Shared answer types** (`MarineSummary`, `Gate`, `SessionAnswer`, `EnlistAnswer`) live in `@ccip-dev/core/linkmarine`, so the Worker and the Mini App agree on them.
- **Checked, not assumed:**
  - Telegram's Mini App docs (`core.telegram.org/bots/webapps`): the data-check string is every received field but `hash`, sorted, as `key=value` lines; `secret_key = HMAC_SHA256(<bot_token>, "WebAppData")` with "WebAppData" as the key; `auth_date` to check freshness; `photo_url` "can be in .jpeg or .svg formats"; `shareToStory` Bot API 7.8+, `widget_link.name` 0–48 characters, text 0–200; `DeviceOrientation` 8.0+ with `refresh_rate` 20–1000 ms; `setBottomBarColor` 7.10+. The verification is also pinned to the published example from the telegram-apps project (token `5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8`), which verifies.
  - Cloudflare's Workers static assets headers docs: "You may wish to remove a default header or a header which has been added by a more pervasive rule. This can be done by prepending the header name with an exclamation mark and space (`! `)."
  - Every task's code was prototyped in a scratch worktree of this repository, its tests run there, and the plan's code blocks are taken from that prototype; see "Self-review notes".

## Shipping order and checkpoints

The Discord Worker reaches the renderer through the `SITE` service binding, resolved when a method is called: a Worker that calls `renderMarineSticker` or `renderMarineStory` before the site Worker has them gets a runtime error, not a deploy error. So the renderer ships first. A push to `main` runs `site.yml` (on `site/**` and `packages/core/**` changes) and `deploy.yml` (the Discord Worker, while `DISCORD_BOT` is on, with its D1 migrations).

1. **Checkpoint push 1, after Task 3:** the renderer. Wait for `gh run list --workflow site --limit 1` to show success before pushing anything that calls it.
2. **Checkpoint push 2, after Task 9:** the Worker. `deploy.yml` applies `0002_stickers.sql` and deploys with `TELEGRAM_BOT` off (the variable is unset, so `--var TELEGRAM_BOT:off`). The new routes answer "off"; `/story/<n>.png` works but nothing links to it.
3. **Checkpoint push 3, after Task 12:** the site: `/tg/` (saying "opens soon" to anyone who finds it) and the Telegram links, which the build leaves out while the switch is off.
4. **Checkpoint push 4, after Task 13:** the runbook. The owner then follows "LinkMarines on Telegram", which ends by turning the switch on.

## File map

| File | Task | Responsibility |
|---|---|---|
| `discord/src/enlistment.ts`, `discord/src/marines.ts` | 1 | The platform-neutral enlist core: draw, store, stamp; Discord keeps its reveal and commands |
| `packages/core/src/linkmarine.ts`, `site/worker/linkmarine/{marine-card,sticker,entrypoint}.ts`, `site/worker/test/png.ts`, `discord/test/{helpers.ts,site-stub.js}` | 2 | `tagsTree` and `renderMarineSticker` |
| `site/worker/linkmarine/{story,app-image}.ts`, `site/scripts/{render-marines-app-image,render-linkmarine-cards}.ts`, `site/public/marines-app-640x360.png` | 3 | `renderMarineStory` and the @BotFather photo |
| `packages/core/src/linkmarine.ts`, `discord/src/{telegram-api,telegram-auth}.ts` | 4 | Telegram's names, links, volumes and `startapp` grammar; the Bot API client; launch data |
| `discord/src/{telegram-marines,public,enlistment,env}.ts` | 5 | Telegram Marines: name, photo, gate, stamping, the summary; the public Story route |
| `discord/src/{miniapp,body,index}.ts`, `discord/wrangler.toml` | 6 | The Mini App API and the switch |
| `discord/migrations/0002_stickers.sql`, `discord/src/{stickers,store,bot,marines,index}.ts` | 7 | The sticker job, its cron and the Discord card's sticker line |
| `discord/src/telegram-bot.ts`, `discord/src/index.ts` | 8 | The thin bot's webhook |
| `scripts/telegram/{requests,setup}.ts`, `package.json`, `.github/workflows/{deploy,site}.yml` | 9 | `pnpm telegram:setup`; the switch in both deploys |
| `site/src/lib/{tg,telegram-webapp}.ts`, `site/src/components/tg/{Welcome,Draw,DogTagScreen,Outside}.tsx` | 10 | The Mini App's rules and screens 1–3 |
| `site/src/components/tg/{TgRoster,Sheets,MiniApp,use-telegram}.tsx/ts`, `site/src/components/marines/RarestTen.tsx`, `site/src/pages/tg/index.astro`, `site/src/layouts/Base.astro`, `site/src/styles/tg.css`, `site/public/_headers`, `site/scripts/check-budgets.ts` | 11 | Screen 4, the island, the page |
| `site/src/lib/telegram.ts`, `site/src/components/marines/{Enlist,RosterView,MarineView}.tsx`, `site/src/pages/{marines/index,marines/marine,discord}.astro`, `site/src/styles/marines.css` | 12 | Enlist on Telegram, the packs, `?tag=` |
| `docs/runbook.md` | 13 | The owner's steps, the switch, `/id`, wiping, the alerts |

---

### Task 1: The shared enlist core, moved out of `marines.ts` (a pure refactor)

Everything an enlistment does that is not Discord's moves into one module: drawing (`draft`), finding or enlisting by `(platform, user_id)` (`enlistMarine`, over `store.ts`'s `enlist`, which already takes the platform), and stamping the card (`stampCard`, which now takes the avatar as a function, so each platform brings its own). `PLATFORM = 'discord'` stays Discord's, passed in as an argument. Discord keeps its avatar fetch, its reveal and its commands. `store.ts` is already the platform-neutral D1 layer and stays where it is, so `findMarine` and `enlist` keep their import paths. Discord's tests pass unchanged; a new test runs the core with `platform = 'telegram'`.

**Files:**
- Create: `discord/src/enlistment.ts`
- Modify: `discord/src/marines.ts` (the imports; `cardKey`, `avatarKey`, `snapshotCount`, `draft`, `readBytes`, `Report`, `reason`, `flush`, `isPng`, `Cards`, `render`, `keep` and `stampCard` move out; the two `stampCard` calls and `/enlist`'s `enlist` call)
- Test: `discord/test/enlistment.test.ts`

**Interfaces:**
- Consumes: `store.ts`'s `enlist(db, recruit, draft)`, `setCardKey`, `type Drafted`, `type EnlistResult`, `type Marine`; `memes.ts`'s `stockMemes`, `loadMemes`, `memeKey`; `draw.ts`'s `drawCallsign`, `drawLore`, `pickMemes`; `bot.ts`'s `type Bot`.
- Produces (`discord/src/enlistment.ts`):
  - `cardKey(serial, ext: 'png' | 'gif')`, `avatarKey(serial)`, `snapshotCount(bot: Pick<Bot, 'snapshot'>, tag): number`.
  - `draft(bot: Bot): Drafted`.
  - `interface Enlistee { platform: string; userId: string; displayName: string }`, `enlistMarine(bot: Bot, who: Enlistee): Promise<EnlistResult>`.
  - `readBytes(bucket, key): Promise<Uint8Array | null>`, `interface Report { signature; text }`, `reason(err): string`, `flush(bot: Pick<Bot, 'alert'>, reports): Promise<void>`, `isPng(bytes): boolean`.
  - `type Cards = Attachment[]`, `type AvatarSource = () => Promise<Uint8Array | null>`, `stampCard(bot: Bot, marine: Marine, avatar: AvatarSource, reports: Report[]): Promise<Cards | null>`.
  - `marines.ts` still exports `PLATFORM`, `STEP_MS`, `TEXT`, `revealSteps`, `STAMP_DEADLINE_MS`, `FINAL_EDIT_BY_MS`, `marineCard`, `reveal`, `replyBudget`, `enlistCommand`, `dogtagCommand` (no longer `cardKey` or `stampCard`; nothing outside it imported them).

- [ ] **Step 1: Write the failing test.**

Create `discord/test/enlistment.test.ts`:

```ts
import type { MarineCard } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cardKey, enlistMarine, stampCard, type Report } from '../src/enlistment';
import { findMarine } from '../src/store';
import { fakeBot, fakeRenderer, PNG_BYTES, resetStorage } from './helpers';

const TELEGRAM_ID = '777000111';

beforeEach(resetStorage);

describe('enlistment on any platform', () => {
  it('enlists a Telegram account as its own Marine, after a Discord one with the same id', async () => {
    // #given
    const bot = fakeBot();
    await enlistMarine(bot, { platform: 'discord', userId: TELEGRAM_ID, displayName: 'on discord' });
    // #when
    const result = await enlistMarine(bot, { platform: 'telegram', userId: TELEGRAM_ID, displayName: 'Ada Lovelace' });
    // #then
    const discord = (await findMarine(env.DB, 'discord', TELEGRAM_ID))!;
    expect(result.kind === 'enlisted' && [result.marine.serial, result.marine.platform, result.marine.displayName, result.marine.callsign !== discord.callsign]).toEqual([2, 'telegram', 'Ada Lovelace', true]);
  });

  it('never draws twice for one Telegram account', async () => {
    // #given
    const bot = fakeBot();
    const first = await enlistMarine(bot, { platform: 'telegram', userId: TELEGRAM_ID, displayName: 'Ada' });
    // #when
    const again = await enlistMarine(bot, { platform: 'telegram', userId: TELEGRAM_ID, displayName: 'Someone Else' });
    // #then
    expect([again.kind, again.kind !== 'clashed' && again.marine.callsign, again.kind !== 'clashed' && again.marine.displayName]).toEqual([
      'already',
      first.kind === 'enlisted' && first.marine.callsign,
      'Ada',
    ]);
  });

  it('stamps a Telegram Marine with the name and the avatar it is handed, and records the card', async () => {
    // #given
    const drawn: MarineCard[] = [];
    const renderer = fakeRenderer();
    const bot = fakeBot({
      renderer: {
        ...renderer,
        renderMarineCards: async (card) => {
          drawn.push(card);
          return renderer.renderMarineCards(card);
        },
      },
    });
    const result = await enlistMarine(bot, { platform: 'telegram', userId: TELEGRAM_ID, displayName: 'Ada Lovelace' });
    const marine = result.kind === 'enlisted' ? result.marine : null;
    const reports: Report[] = [];
    // #when
    const cards = await stampCard(bot, marine!, async () => PNG_BYTES, reports);
    // #then
    expect({
      posted: cards?.map((c) => c.name).at(-1),
      name: drawn[0]?.name,
      avatar: drawn[0]?.avatar && [...drawn[0].avatar],
      kept: (await env.MARINES.head(cardKey(1, 'png')))?.httpMetadata?.contentType,
      recorded: (await findMarine(env.DB, 'telegram', TELEGRAM_ID))?.cardKey,
      reports,
    }).toEqual({ posted: 'marine-1.png', name: 'Ada Lovelace', avatar: [...PNG_BYTES], kept: 'image/png', recorded: 'cards/1.png', reports: [] });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/enlistment.test.ts`
Expected: FAIL: `../src/enlistment` does not exist.

- [ ] **Step 3: Move the core.**

Create `discord/src/enlistment.ts`:

```ts
import { hasGlint, type MarineCard } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import type { Attachment } from './discord-api';
import { drawCallsign, drawLore, pickMemes } from './draw';
import { loadMemes, memeKey, stockMemes } from './memes';
import { enlist, setCardKey, type Drafted, type EnlistResult, type Marine } from './store';

/**
 * Enlistment for any platform: the draw, the record and the stamped card. A Marine is one per (platform, user id);
 * callsigns and serials are shared by every platform.
 */

export const cardKey = (serial: number, ext: 'png' | 'gif') => `cards/${serial}.${ext}`;
export const avatarKey = (serial: number) => `avatars/${serial}.png`;

/** A tag's SFW meme count in the bot's snapshot. */
export const snapshotCount = (bot: Pick<Bot, 'snapshot'>, tag: string) => bot.snapshot.tags.find((t) => t.tag === tag)?.count ?? 1;

export function draft(bot: Bot): Drafted {
  const draw = drawCallsign(bot.snapshot, bot.random);
  const files = pickMemes(bot.snapshot, draw.tags, draw.callsign);
  return {
    draw,
    memes: draw.tags.map((tag, i) => ({ tag, file: files[i]!, key: memeKey(files[i]!), count: snapshotCount(bot, tag), sha: bot.snapshot.archive.sha })),
    blood: drawLore(bot.snapshot.lore.blood, bot.random),
    faith: drawLore(bot.snapshot.lore.faith, bot.random),
  };
}

export interface Enlistee {
  platform: string;
  userId: string;
  /** The name stamped on the card, once. */
  displayName: string;
}

/** Finds the account's Marine, or draws and records one: never two per account, never a callsign another Marine holds. */
export function enlistMarine(bot: Bot, who: Enlistee): Promise<EnlistResult> {
  return enlist(bot.db, { ...who, enlistedAt: bot.now().toISOString(), snapshotVersion: bot.snapshot.version }, () => draft(bot));
}

export async function readBytes(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

/** What to tell the alert chat, held back until the Marine has their reply. */
export interface Report {
  signature: string;
  text: string;
}

export const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Each signature once, so one failure seen twice is one alert. */
export async function flush(bot: Pick<Bot, 'alert'>, reports: Report[]): Promise<void> {
  const first = [...new Map(reports.map((r) => [r.signature, r])).values()];
  await Promise.allSettled(first.map((r) => bot.alert(r.signature, r.text)));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);

/** The card to post, best first: the glint when there is one, then the static PNG. */
export type Cards = Attachment[];

/** The avatar to stamp as PNG bytes, or null for the gradient disc. Never rejects. */
export type AvatarSource = () => Promise<Uint8Array | null>;

/** The card, and the glint for Rare and up; a failed glint is reported and leaves the static card to post. */
async function render(bot: Bot, marine: Marine, pngs: Uint8Array[], avatarBytes: Uint8Array | null, reports: Report[]): Promise<{ png: Uint8Array; gif: Uint8Array | null }> {
  const card: MarineCard = {
    serial: marine.serial,
    callsign: marine.callsign,
    tier: marine.tier,
    percentile: marine.percentile,
    memes: marine.memes.map((m, i) => ({ tag: m.tag, count: m.count ?? snapshotCount(bot, m.tag), png: pngs[i]! })),
    blood: marine.blood,
    faith: marine.faith,
    name: marine.displayName,
    enlistedAt: marine.enlistedAt,
    avatar: avatarBytes,
  };
  const glintFailed = (why: string) => reports.push({ signature: 'discord-render:marine', text: `glint for Marine #${marine.serial} failed: ${why}` });
  try {
    const images = await bot.renderer.renderMarineCards(card);
    if (images.glintError !== null) glintFailed(images.glintError);
    return { png: images.png, gif: images.gif };
  } catch (err) {
    if (!hasGlint(marine.tier)) throw err;
    // The glint can take the whole call down with it (the site isolate's memory, a deploy): the static card alone still stands.
    const png = await bot.renderer.renderMarineCard(card);
    glintFailed(reason(err));
    return { png, gif: null };
  }
}

async function keep(bot: Bot, serial: number, rendered: { png: Uint8Array; gif: Uint8Array | null }): Promise<void> {
  await bot.bucket.put(cardKey(serial, 'png'), rendered.png, { httpMetadata: { contentType: 'image/png' } });
  if (rendered.gif) await bot.bucket.put(cardKey(serial, 'gif'), rendered.gif, { httpMetadata: { contentType: 'image/gif' } });
  await setCardKey(bot.db, serial, cardKey(serial, 'png'));
}

/**
 * Stamps a Marine's card: copies the memes (while getting the avatar), renders the card (and the glint for Rare and
 * up), keeps them in R2 and records the card. Never throws: returns the images to post, or null when it could not,
 * adding what to alert to `reports`. A card that rendered is returned even when R2 would not keep it.
 */
export async function stampCard(bot: Bot, marine: Marine, avatar: AvatarSource, reports: Report[]): Promise<Cards | null> {
  try {
    let copyFailure: unknown = null;
    const [, avatarBytes] = await Promise.all([
      stockMemes(bot.bucket, bot.renderer, bot.fetch, bot.snapshot.archive, marine.memes).catch((err: unknown) => void (copyFailure = err)),
      avatar(),
    ]);
    if (copyFailure) {
      reports.push({ signature: 'discord-memes', text: `memes for Marine #${marine.serial} could not be copied: ${reason(copyFailure)}` });
      return null;
    }
    const pngs = await loadMemes(bot.bucket, marine.memes);
    if (!pngs) {
      reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s memes were missing from storage right after copying` });
      return null;
    }
    let rendered;
    try {
      rendered = await render(bot, marine, pngs, avatarBytes, reports);
    } catch (err) {
      reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s card failed to render: ${reason(err)}` });
      return null;
    }
    try {
      await keep(bot, marine.serial, rendered);
    } catch (err) {
      reports.push({ signature: 'discord-store:marine', text: `Marine #${marine.serial}'s card could not be kept in storage: ${reason(err)}` });
    }
    const still: Attachment = { name: `marine-${marine.serial}.png`, type: 'image/png', bytes: rendered.png };
    return rendered.gif ? [{ name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: rendered.gif }, still] : [still];
  } catch (err) {
    reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s card could not be stamped: ${reason(err)}` });
    return null;
  }
}
```

Then take it out of `marines.ts`.

In `discord/src/marines.ts`, replace:

```ts
import { hasGlint, serialText, type MarineCard, type Tier } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import type { Attachment } from './discord-api';
import { drawCallsign, drawLore, pickMemes } from './draw';
import { avatarUrl, displayName, escapeMarkdown, invoker, optionValue, type DiscordMember, type DiscordUser, type Interaction } from './interactions';
import { loadMemes, memeKey, stockMemes } from './memes';
import { enlist, findMarine, setCardKey, type Drafted, type Marine } from './store';
```

with:

```ts
import { hasGlint, serialText, type Tier } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import { avatarKey, cardKey, enlistMarine, flush, isPng, readBytes, reason, stampCard, type Cards, type Report } from './enlistment';
import { avatarUrl, displayName, escapeMarkdown, invoker, optionValue, type DiscordMember, type DiscordUser, type Interaction } from './interactions';
import { findMarine, type Marine } from './store';
```

In `discord/src/marines.ts`, replace:

```ts
export const cardKey = (serial: number, ext: 'png' | 'gif') => `cards/${serial}.${ext}`;
const AVATAR_TIMEOUT_MS = 5_000;
const avatarKey = (serial: number) => `avatars/${serial}.png`;

/** A tag's SFW meme count in the bot's snapshot. */
const snapshotCount = (bot: Bot, tag: string) => bot.snapshot.tags.find((t) => t.tag === tag)?.count ?? 1;

function draft(bot: Bot): Drafted {
  const draw = drawCallsign(bot.snapshot, bot.random);
  const files = pickMemes(bot.snapshot, draw.tags, draw.callsign);
  return {
    draw,
    memes: draw.tags.map((tag, i) => ({ tag, file: files[i]!, key: memeKey(files[i]!), count: snapshotCount(bot, tag), sha: bot.snapshot.archive.sha })),
    blood: drawLore(bot.snapshot.lore.blood, bot.random),
    faith: drawLore(bot.snapshot.lore.faith, bot.random),
  };
}

async function readBytes(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

/** What to tell the alert chat, held back until the Marine has their reply. */
export interface Report {
  signature: string;
  text: string;
}
```

with:

```ts
const AVATAR_TIMEOUT_MS = 5_000;
```

In `discord/src/marines.ts`, replace:

```ts
export const FINAL_EDIT_BY_MS = 28_000;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function flush(bot: Bot, reports: Report[]): Promise<void> {
  const first = [...new Map(reports.map((r) => [r.signature, r])).values()];
  await Promise.allSettled(first.map((r) => bot.alert(r.signature, r.text)));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);
```

with:

```ts
export const FINAL_EDIT_BY_MS = 28_000;
```

In `discord/src/marines.ts`, replace:

```ts
/** The card to post, best first: the glint when there is one, then the static PNG. */
type Cards = Attachment[];

/** The card, and the glint for Rare and up; a failed glint is reported and leaves the static card to post. */
async function render(bot: Bot, marine: Marine, pngs: Uint8Array[], avatarBytes: Uint8Array | null, reports: Report[]): Promise<{ png: Uint8Array; gif: Uint8Array | null }> {
  const card: MarineCard = {
    serial: marine.serial,
    callsign: marine.callsign,
    tier: marine.tier,
    percentile: marine.percentile,
    memes: marine.memes.map((m, i) => ({ tag: m.tag, count: m.count ?? snapshotCount(bot, m.tag), png: pngs[i]! })),
    blood: marine.blood,
    faith: marine.faith,
    name: marine.displayName,
    enlistedAt: marine.enlistedAt,
    avatar: avatarBytes,
  };
  const glintFailed = (why: string) => reports.push({ signature: 'discord-render:marine', text: `glint for Marine #${marine.serial} failed: ${why}` });
  try {
    const images = await bot.renderer.renderMarineCards(card);
    if (images.glintError !== null) glintFailed(images.glintError);
    return { png: images.png, gif: images.gif };
  } catch (err) {
    if (!hasGlint(marine.tier)) throw err;
    // The glint can take the whole call down with it (the site isolate's memory, a deploy): the static card alone still stands.
    const png = await bot.renderer.renderMarineCard(card);
    glintFailed(reason(err));
    return { png, gif: null };
  }
}

async function keep(bot: Bot, serial: number, rendered: { png: Uint8Array; gif: Uint8Array | null }): Promise<void> {
  await bot.bucket.put(cardKey(serial, 'png'), rendered.png, { httpMetadata: { contentType: 'image/png' } });
  if (rendered.gif) await bot.bucket.put(cardKey(serial, 'gif'), rendered.gif, { httpMetadata: { contentType: 'image/gif' } });
  await setCardKey(bot.db, serial, cardKey(serial, 'png'));
}

/**
 * Stamps a Marine's card: copies the memes (while fetching the avatar), renders the card (and the glint for Rare and
 * up), keeps them in R2 and records the card. Never throws: returns the images to post, or null when it could not,
 * adding what to alert to `reports`. A card that rendered is returned even when R2 would not keep it.
 */
export async function stampCard(bot: Bot, marine: Marine, avatarSource: string | null, reports: Report[]): Promise<Cards | null> {
  try {
    let copyFailure: unknown = null;
    const [, avatarBytes] = await Promise.all([
      stockMemes(bot.bucket, bot.renderer, bot.fetch, bot.snapshot.archive, marine.memes).catch((err: unknown) => void (copyFailure = err)),
      avatar(bot, marine.serial, avatarSource),
    ]);
    if (copyFailure) {
      reports.push({ signature: 'discord-memes', text: `memes for Marine #${marine.serial} could not be copied: ${reason(copyFailure)}` });
      return null;
    }
    const pngs = await loadMemes(bot.bucket, marine.memes);
    if (!pngs) {
      reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s memes were missing from storage right after copying` });
      return null;
    }
    let rendered;
    try {
      rendered = await render(bot, marine, pngs, avatarBytes, reports);
    } catch (err) {
      reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s card failed to render: ${reason(err)}` });
      return null;
    }
    try {
      await keep(bot, marine.serial, rendered);
    } catch (err) {
      reports.push({ signature: 'discord-store:marine', text: `Marine #${marine.serial}'s card could not be kept in storage: ${reason(err)}` });
    }
    const still: Attachment = { name: `marine-${marine.serial}.png`, type: 'image/png', bytes: rendered.png };
    return rendered.gif ? [{ name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: rendered.gif }, still] : [still];
  } catch (err) {
    reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s card could not be stamped: ${reason(err)}` });
    return null;
  }
}

/** The stamped card, animated when there is a glint; stamped now when it is missing. */
```

with:

```ts
/** The stamped card, animated when there is a glint; stamped now when it is missing. */
```

In `discord/src/marines.ts`, replace:

```ts
  return stampCard(bot, marine, avatarSource, reports);
```

with:

```ts
  return stampCard(bot, marine, () => avatar(bot, marine.serial, avatarSource), reports);
```

In `discord/src/marines.ts`, replace:

```ts
  const stamping = stampCard(bot, marine, avatarSource, reports);
```

with:

```ts
  const stamping = stampCard(bot, marine, () => avatar(bot, marine.serial, avatarSource), reports);
```

In `discord/src/marines.ts`, replace:

```ts
  const result = await enlist(
    bot.db,
    { platform: PLATFORM, userId: who.user.id, displayName: displayName(who.user, who.member), enlistedAt: bot.now().toISOString(), snapshotVersion: bot.snapshot.version },
    () => draft(bot),
  );
```

with:

```ts
  const result = await enlistMarine(bot, { platform: PLATFORM, userId: who.user.id, displayName: displayName(who.user, who.member) });
```

- [ ] **Step 4: Run the Worker's tests and the typecheck, and check no test changed.**

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (183 tests: Discord's 180, untouched, and the core's 3).

Run: `git status --short discord/test`
Expected: only `?? discord/test/enlistment.test.ts`.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add discord/src/enlistment.ts discord/src/marines.ts discord/test/enlistment.test.ts
git commit -m "refactor(discord): move the platform-neutral enlist core out of marines.ts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The sticker render

The renderer gets `renderMarineSticker(card: MarineWebCard)`: the two dog tags on their ball chain in the Marine's tier metal, with the callsign and `LM 0042` on the front tag and a `LINK MARINE #0042` plate under them, 512×512 on a transparent ground, never a name or an avatar. A new `tagsTree` draws the tags alone, at the card's size, lowered 24 mockup units so the chain's top shows; the sticker places that PNG, scaled by about 0.66, over the plate. The bot's fakes learn the new method, so the Worker still typechecks.

**Files:**
- Create: `site/worker/linkmarine/sticker.ts`
- Modify: `packages/core/src/linkmarine.ts` (`LinkMarineRenderer.renderMarineSticker`), `site/worker/linkmarine/marine-card.ts` (`TAGS_DROP`, `tagsTree`), `site/worker/linkmarine/entrypoint.ts`, `site/worker/test/png.ts` (`pngRgba`), `discord/test/helpers.ts` (`fakeRenderer`), `discord/test/site-stub.js`
- Test: `site/worker/test/linkmarine-sticker.test.ts`

**Interfaces:**
- Consumes: `marine-card.ts`'s private `tagSvg`, `chainSvg`, `sparkles`, `backEtch`, `frontText`, and `BACK_TAG`, `FRONT_TAG`, `webCardOf`; `art.ts`'s `artLayer`, `px`, `KINO_SIZE`, `INK`, `MONO`, `DOT_FILTER`; `metal.ts`'s `TIER_LOOKS`; `render.ts`'s `renderKino(tree, size?)`; `bytesToBase64` from `../cards/coin-icons`.
- Produces:
  - `LinkMarineRenderer.renderMarineSticker(card: MarineWebCard): Promise<Uint8Array>` (core), implemented by `LinkMarineCards`.
  - `marine-card.ts`: `TAGS_DROP = 24`, `tagsTree(card: MarineWebCard): VNode` (1200×675, transparent).
  - `sticker.ts`: `STICKER_SIZE = { width: 512, height: 512 }`, `TAGS_BOX = { width: 700, height: 675 }`, `STICKER_FIT = { scale, left }`, `pngUri(bytes): string`, `stickerTree(card: MarineWebCard, tagsPng: Uint8Array): VNode`.
  - `site/worker/test/png.ts`: `pngRgba(png, x, y): Promise<[r, g, b, a]>` beside `pngPixel`.
  - `discord/test/helpers.ts`: `fakeRenderer()` also records `.stickers: MarineWebCard[]`.

- [ ] **Step 1: Write the failing test, with an alpha-reading helper.**

In `site/worker/test/png.ts`, replace:

```ts
export async function pngPixel(png: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
```

with:

```ts
/** A pixel's red, green, blue and alpha; alpha is 255 in a PNG without an alpha channel. */
export async function pngRgba(png: Uint8Array, x: number, y: number): Promise<[number, number, number, number]> {
```

In `site/worker/test/png.ts`, replace:

```ts
  return [row[x * channels]!, row[x * channels + 1]!, row[x * channels + 2]!];
}
```

with:

```ts
  return [row[x * channels]!, row[x * channels + 1]!, row[x * channels + 2]!, channels === 4 ? row[x * channels + 3]! : 255];
}

export async function pngPixel(png: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const [r, g, b] = await pngRgba(png, x, y);
  return [r, g, b];
}
```

Create `site/worker/test/linkmarine-sticker.test.ts`:

```ts
import { TIERS, type MarineWebCard } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine, webMarine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { px } from '../linkmarine/art';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { FRONT_TAG, onTag, TAGS_DROP } from '../linkmarine/marine-card';
import { renderKino } from '../linkmarine/render';
import { STICKER_FIT } from '../linkmarine/sticker';
import { pngRgba } from './png';

const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];
const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;
const cards = () => new LinkMarineCards(createExecutionContext(), {} as never);
/** A point on a tag, in the mockups' units, where it lands in the sticker. */
const inSticker = (p: { x: number; y: number }) => [Math.round(STICKER_FIT.left + px(p.x) * STICKER_FIT.scale), Math.round(px(p.y + TAGS_DROP) * STICKER_FIT.scale)] as const;

describe('the LinkMarineCards entrypoint: the sticker', () => {
  it('draws a 512×512 PNG with an alpha channel: clear around the tags, solid tier metal on them', async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const pngs = await Promise.all(TIERS.map((tier) => cards().renderMarineSticker(webMarine(tier, [red]))));
    // #then the corner is clear, and the front tag's bare metal is opaque and differs tier by tier, gold warm
    const [x, y] = inSticker(onTag(FRONT_TAG, 250, 40));
    const corners = await Promise.all(pngs.map((png) => pngRgba(png, 2, 2)));
    const metals = await Promise.all(pngs.map((png) => pngRgba(png, x, y)));
    const gold = metals[3]!;
    expect({
      sizes: pngs.map(size),
      colorTypes: pngs.map((png) => png[25]),
      clear: corners.map((c) => c[3]),
      opaque: metals.map((m) => m[3]),
      distinct: new Set(metals.map((m) => m.slice(0, 3).join())).size,
      gold: gold[0]! > gold[2]! + 60,
    }).toEqual({ sizes: TIERS.map(() => [512, 512]), colorTypes: [6, 6, 6, 6], clear: [0, 0, 0, 0], opaque: [255, 255, 255, 255], distinct: 4, gold: true });
  });

  it("stays under Telegram's 512 KB for a sticker", async () => {
    // #given
    const [red, blue] = await Promise.all([solid('#d01818'), solid('#1f6fb2')]);
    // #when
    const png = await cards().renderMarineSticker(webMarine('legendary', [red, blue]));
    // #then
    expect(png.byteLength).toBeLessThan(512 * 1024);
  });

  it('draws no name and no avatar, even when handed a whole card', async () => {
    // #given the full card of the same Marine, with a name and an avatar
    const red = await solid('#d01818');
    const full = marine('rare', [red], await solid('#00ff00')) as MarineWebCard;
    // #when
    const [fromFull, fromWeb] = await Promise.all([cards().renderMarineSticker(full), cards().renderMarineSticker(webMarine('rare', [red]))]);
    // #then
    expect([...fromFull]).toEqual([...fromWeb]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/linkmarine-sticker.test.ts`
Expected: FAIL: `../linkmarine/sticker` does not exist.

- [ ] **Step 3: Add the method to the renderer's interface, the tags-only tree, the sticker, and the bot's fakes.**

In `packages/core/src/linkmarine.ts`, replace:

```ts
  renderMarineWebCard(card: MarineWebCard): Promise<Uint8Array>;
  renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array>;
```

with:

```ts
  renderMarineWebCard(card: MarineWebCard): Promise<Uint8Array>;
  /** The Telegram sticker: the two tags on their chain with the serial, 512×512 on a transparent ground, no name or avatar. */
  renderMarineSticker(card: MarineWebCard): Promise<Uint8Array>;
  renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array>;
```

At the end of `site/worker/linkmarine/marine-card.ts`, add:

```ts
/** How far the tags come down from where the card hangs them, in the mockups' units, so the ball chain's top stays in frame. */
export const TAGS_DROP = 24;

/**
 * The two tags on their ball chain and nothing else, at the card's size on a transparent ground: the art of the
 * sticker and the Story card. It draws the callsign, the serial and the lore, never a name or an avatar.
 */
export function tagsTree(card: MarineWebCard): VNode {
  const look = TIER_LOOKS[card.tier];
  const back = tagSvg('back', BACK_TAG, look);
  const front = tagSvg('front', FRONT_TAG, look);
  return h(
    'div',
    { style: { width: KINO_SIZE.width, height: KINO_SIZE.height, display: 'flex', position: 'relative', fontFamily: 'Inter', color: INK.text } },
    h(
      'div',
      { style: { position: 'absolute', left: 0, top: px(TAGS_DROP), width: KINO_SIZE.width, height: KINO_SIZE.height, display: 'flex' } },
      artLayer(back.body, back.defs),
      backEtch(card, look),
      artLayer(front.body, front.defs),
      frontText(card, look),
      artLayer(chainSvg() + (look.sparkles ? sparkles() : ''), DOT_FILTER),
    ),
  );
}
```

Create `site/worker/linkmarine/sticker.ts`:

```ts
import { serialText, type MarineWebCard } from '@ccip-dev/core/linkmarine';
import { bytesToBase64 } from '../cards/coin-icons';
import { h, type VNode } from '../h';
import { INK, KINO_SIZE, MONO } from './art';
import { TIER_LOOKS } from './metal';

/** Telegram's static stickers: 512 px on a side, a PNG with transparency, at most 512 KB. */
export const STICKER_SIZE = { width: 512, height: 512 } as const;
/** What tagsTree draws on, in card pixels from its top left: the tags, the chain and the tags' shadow all fall inside. */
export const TAGS_BOX = { width: 700, height: 675 } as const;
const PLATE_H = 64;
const SCALE = Math.min(STICKER_SIZE.width / TAGS_BOX.width, (STICKER_SIZE.height - PLATE_H) / TAGS_BOX.height);
/** Where tagsTree's canvas lands in the sticker: scaled by `scale`, `left` pixels in, at the top. */
export const STICKER_FIT = { scale: SCALE, left: Math.round((STICKER_SIZE.width - TAGS_BOX.width * SCALE) / 2) } as const;

export const pngUri = (bytes: Uint8Array) => `data:image/png;base64,${bytesToBase64(bytes)}`;

/** The tags as tagsTree drew them, scaled into the sticker above a plate with the serial. */
export function stickerTree(card: MarineWebCard, tagsPng: Uint8Array): VNode {
  const width = Math.round(KINO_SIZE.width * STICKER_FIT.scale);
  const height = Math.round(KINO_SIZE.height * STICKER_FIT.scale);
  const look = TIER_LOOKS[card.tier];
  return h(
    'div',
    { style: { width: STICKER_SIZE.width, height: STICKER_SIZE.height, display: 'flex', position: 'relative' } },
    h('img', { src: pngUri(tagsPng), width, height, style: { position: 'absolute', left: STICKER_FIT.left, top: 0, width, height } }),
    h(
      'div',
      { style: { position: 'absolute', left: 0, top: STICKER_SIZE.height - PLATE_H, width: STICKER_SIZE.width, height: PLATE_H - 8, display: 'flex', justifyContent: 'center', alignItems: 'center' } },
      h(
        'div',
        { style: { display: 'flex', padding: '6px 18px', borderRadius: 28, backgroundColor: '#0a0f1ee6', border: `3px solid ${look.color}`, fontFamily: MONO, fontWeight: 700, fontSize: 30, color: INK.paleGold, letterSpacing: 2 } },
        `LINK MARINE #${serialText(card.serial)}`,
      ),
    ),
  );
}
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
import { marineTree, webCardOf } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
import { renderKino } from './render';
```

with:

```ts
import { marineTree, tagsTree, webCardOf } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
import { renderKino } from './render';
import { STICKER_SIZE, stickerTree } from './sticker';
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
  async renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array> {
```

with:

```ts
  /** Two passes: the tags alone at the card's size, then scaled into the 512 px sticker. Never a name or an avatar. */
  async renderMarineSticker(card: MarineWebCard): Promise<Uint8Array> {
    const web = webCardOf(card);
    const tags = await renderKino(tagsTree(web));
    return (await renderKino(stickerTree(web, tags.png), STICKER_SIZE)).png;
  }

  async renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array> {
```

The bot's fake renderer and its stand-in site Worker get the method:

In `discord/test/helpers.ts`, replace:

```ts
export function fakeRenderer(failing: keyof LinkMarineRenderer | null = null): LinkMarineRenderer & { calls: string[]; webCards: MarineWebCard[] } {
  const calls: string[] = [];
  const webCards: MarineWebCard[] = [];
```

with:

```ts
export function fakeRenderer(failing: keyof LinkMarineRenderer | null = null): LinkMarineRenderer & { calls: string[]; webCards: MarineWebCard[]; stickers: MarineWebCard[] } {
  const calls: string[] = [];
  const webCards: MarineWebCard[] = [];
  const stickers: MarineWebCard[] = [];
```

In `discord/test/helpers.ts`, replace:

```ts
    calls,
    webCards,
    async prepareMeme() {
```

with:

```ts
    calls,
    webCards,
    stickers,
    async prepareMeme() {
```

In `discord/test/helpers.ts`, replace:

```ts
      return call('renderMarineWebCard', PNG_BYTES);
    },
```

with:

```ts
      return call('renderMarineWebCard', PNG_BYTES);
    },
    async renderMarineSticker(card) {
      stickers.push(card);
      return call('renderMarineSticker', PNG_BYTES);
    },
```

In `discord/test/site-stub.js`, replace:

```js
  async renderMarineWebCard() {
    return new Uint8Array(PNG);
  }
```

with:

```js
  async renderMarineWebCard() {
    return new Uint8Array(PNG);
  }

  async renderMarineSticker() {
    return new Uint8Array(PNG);
  }
```

- [ ] **Step 4: Run the renders, the bot and the typecheck.**

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/linkmarine-sticker.test.ts`
Expected: PASS (3 tests). Each renders four or more stickers in workerd: about 40 s.

Run: `pnpm --filter @ccip-dev/site test`
Expected: PASS: Node 1,346 tests, workerd 33.

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (183 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/linkmarine.ts site/worker/linkmarine/marine-card.ts site/worker/linkmarine/sticker.ts site/worker/linkmarine/entrypoint.ts site/worker/test/png.ts site/worker/test/linkmarine-sticker.test.ts discord/test/helpers.ts discord/test/site-stub.js
git commit -m "feat(site): renderMarineSticker, the two dog tags on a transparent 512 px sticker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Story card render, and the Mini App's @BotFather photo

`renderMarineStory(card: MarineWebCard)` draws the 1080×1920 Story card from the same tags pass: the tags large in the tier metal (the tags box 1,000 px wide) over the tier's halo, then `LINK MARINE #0042`, the callsign (sized to fit, down to 35 px for a 41-character callsign), the tier word in its metal with the odds line, the three meme hexes framed in the tier colour with their tags, and "ccip.dev · LinkMarines". No name or avatar. The 640×360 photo @BotFather asks for is drawn the same way by a script and committed, and `cards:linkmarine` now also writes every tier's sticker and Story card for a human look.

**Files:**
- Create: `site/worker/linkmarine/story.ts`, `site/worker/linkmarine/app-image.ts`, `site/scripts/render-marines-app-image.ts`, `site/public/marines-app-640x360.png` (generated)
- Modify: `packages/core/src/linkmarine.ts` (`LinkMarineRenderer.renderMarineStory`), `site/worker/linkmarine/entrypoint.ts`, `site/test/fixtures/linkmarine.ts` (`MOCKUP_MEMES`), `site/scripts/render-linkmarine-cards.ts`, `site/package.json` (`cards:app`), `discord/test/helpers.ts`, `discord/test/site-stub.js`
- Test: `site/worker/test/linkmarine-story.test.ts`, `site/test/marines-app-image.test.ts`

**Interfaces:**
- Consumes: Task 2's `tagsTree`, `TAGS_DROP`, `TAGS_BOX`, `pngUri`, `STICKER_SIZE`, `stickerTree`; `art.ts`'s `halo`, `HEX_CLIP`, `hexPoints`, `svgDataUri`; core's `marineOdds`, `serialText`.
- Produces:
  - `LinkMarineRenderer.renderMarineStory(card: MarineWebCard): Promise<Uint8Array>` (core), implemented by `LinkMarineCards`.
  - `story.ts`: `STORY_SIZE = { width: 1080, height: 1920 }`, `STORY_TAGS = { left: 40, top: 150, scale }`, `callsignSize(callsign): number`, `storyTree(card, tagsPng): VNode`.
  - `app-image.ts`: `APP_IMAGE_SIZE = { width: 640, height: 360 }`, `appImageTree(card, tagsPng): VNode`.
  - `pnpm --filter @ccip-dev/site cards:app [--archive ../chainlinkmeme]` writes `site/public/marines-app-640x360.png`.
  - `site/test/fixtures/linkmarine.ts`: `MOCKUP_MEMES` (the painting, space and prophecy files).
  - `discord/test/helpers.ts`: `fakeRenderer()` also records `.stories: MarineWebCard[]`.

- [ ] **Step 1: Write the failing tests.**

Create `site/worker/test/linkmarine-story.test.ts`:

```ts
import type { MarineWebCard } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine, webMarine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { px } from '../linkmarine/art';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { FRONT_TAG, onTag, TAGS_DROP } from '../linkmarine/marine-card';
import { renderKino } from '../linkmarine/render';
import { callsignSize, STORY_TAGS } from '../linkmarine/story';
import { pngPixel } from './png';

const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];
const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;
const cards = () => new LinkMarineCards(createExecutionContext(), {} as never);
/** A point on a tag, in the mockups' units, where it lands on the Story card. */
const inStory = (p: { x: number; y: number }) => [Math.round(STORY_TAGS.left + px(p.x) * STORY_TAGS.scale), Math.round(STORY_TAGS.top + px(p.y + TAGS_DROP) * STORY_TAGS.scale)] as const;

describe('the LinkMarineCards entrypoint: the Story card', () => {
  it('draws a 1080×1920 card with the tags large in the tier metal', async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const png = await cards().renderMarineStory(webMarine('legendary', [red]));
    // #then the front tag's bare metal is gold
    const [x, y] = inStory(onTag(FRONT_TAG, 250, 40));
    const metal = await pngPixel(png, x, y);
    expect({ size: size(png), gold: metal[0]! > metal[2]! + 60 }).toEqual({ size: [1080, 1920], gold: true });
  });

  it('draws no name and no avatar, even when handed a whole card', async () => {
    // #given the full card of the same Marine, with a name and an avatar
    const red = await solid('#d01818');
    const full = marine('common', [red], await solid('#00ff00')) as MarineWebCard;
    // #when
    const [fromFull, fromWeb] = await Promise.all([cards().renderMarineStory(full), cards().renderMarineStory(webMarine('common', [red]))]);
    // #then
    expect([...fromFull]).toEqual([...fromWeb]);
  });

  it('sets the callsign in the column, the longest one smaller', () => {
    // #then 23 characters, and three 13-character tags with their hyphens
    expect([callsignSize('painting-space-prophecy'), callsignSize('abcdefghijklm-abcdefghijklm-abcdefghijklm')]).toEqual([66, 35]);
  });
});
```

Create `site/test/marines-app-image.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe("the Mini App's @BotFather photo", () => {
  it('is committed as a 640×360 PNG', () => {
    // #given
    const png = readFileSync(join(import.meta.dirname, '..', 'public', 'marines-app-640x360.png'));
    // #then
    expect({ signature: [...png.subarray(0, 4)], width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ signature: [137, 80, 78, 71], width: 640, height: 360 });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/linkmarine-story.test.ts`
Expected: FAIL: `../linkmarine/story` does not exist.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/marines-app-image.test.ts`
Expected: FAIL: ENOENT, no `public/marines-app-640x360.png`.

- [ ] **Step 3: Add the Story card.**

In `packages/core/src/linkmarine.ts`, replace:

```ts
  renderMarineSticker(card: MarineWebCard): Promise<Uint8Array>;
```

with:

```ts
  renderMarineSticker(card: MarineWebCard): Promise<Uint8Array>;
  /** The 1080×1920 Story card: the tags large, the serial, callsign and tier, the three memes. No name or avatar. */
  renderMarineStory(card: MarineWebCard): Promise<Uint8Array>;
```

Create `site/worker/linkmarine/story.ts`:

```ts
import { marineOdds, serialText, type MarineWebCard, type Tier } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { halo, HEX_CLIP, hexPoints, INK, KINO_SIZE, MONO, svgDataUri } from './art';
import { TIER_LOOKS } from './metal';
import { pngUri, TAGS_BOX } from './sticker';

/** A Telegram Story: 9:16. */
export const STORY_SIZE = { width: 1080, height: 1920 } as const;
/** tagsTree's box scaled to 1,000 px wide, 150 px from the top. */
export const STORY_TAGS = { left: 40, top: 150, scale: 1000 / TAGS_BOX.width } as const;
const HEX = { width: 220, height: 254, gap: 50, top: 1470 } as const;
const TEXT_WIDTH = 960;
/** JetBrains Mono advances 0.6 em, and the callsign's letter-spacing adds 2 px. */
const MONO_ADVANCE = 0.6;
const CALLSIGN_TRACKING = 2;

const TIER_WORD: Readonly<Record<Tier, string>> = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', legendary: 'LEGENDARY' };

/** The callsign's type size: 76 px, smaller when a long callsign would run past the text column. */
export function callsignSize(callsign: string): number {
  return Math.min(76, Math.floor((TEXT_WIDTH / callsign.length - CALLSIGN_TRACKING) / MONO_ADVANCE));
}

const centred = (top: number, style: Record<string, unknown>, ...children: (VNode | string)[]): VNode =>
  h('div', { style: { position: 'absolute', left: 0, top, width: STORY_SIZE.width, display: 'flex', justifyContent: 'center', ...style } }, ...children);

function haloImage(tier: Tier): VNode {
  const look = TIER_LOOKS[tier];
  const rings = [
    { r: 330, width: 5, opacity: 0.55 },
    { r: 440, width: 3.5, opacity: 0.35 },
    { r: 560, width: 2.5, opacity: 0.22 },
    { r: 690, width: 2, opacity: 0.12 },
  ].map((r) => ({ ...r, opacity: Math.round(r.opacity * look.halo.strength * 100) / 100 }));
  const art = halo('story', 540, 560, look.color, rings, look.halo.glow ? { r: 520, opacity: 0.3 * look.halo.strength } : null);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_SIZE.width}" height="${STORY_SIZE.height}" viewBox="0 0 ${STORY_SIZE.width} ${STORY_SIZE.height}"><defs>${art.defs}</defs>${art.body}</svg>`;
  return h('img', { src: svgDataUri(svg), width: STORY_SIZE.width, height: STORY_SIZE.height, style: { position: 'absolute', left: 0, top: 0, width: STORY_SIZE.width, height: STORY_SIZE.height } });
}

function memeHex(png: Uint8Array, left: number, color: string): VNode {
  const frame = svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HEX.width + 20}" height="${HEX.height + 20}" viewBox="0 0 ${HEX.width + 20} ${HEX.height + 20}"><polygon points="${hexPoints((HEX.width + 20) / 2, (HEX.height + 20) / 2, HEX.height / 2 + 8)}" fill="none" stroke="${color}" stroke-width="5"/></svg>`,
  );
  return h(
    'div',
    { style: { position: 'absolute', left: left - 10, top: HEX.top - 10, width: HEX.width + 20, height: HEX.height + 20, display: 'flex' } },
    h('img', { src: pngUri(png), width: HEX.width, height: HEX.height, style: { position: 'absolute', left: 10, top: 10, width: HEX.width, height: HEX.height, objectFit: 'cover', clipPath: HEX_CLIP } }),
    h('img', { src: frame, width: HEX.width + 20, height: HEX.height + 20, style: { position: 'absolute', left: 0, top: 0, width: HEX.width + 20, height: HEX.height + 20 } }),
  );
}

/**
 * The Story card: the tags as tagsTree drew them, large, then the serial, the callsign and the tier, then the three
 * memes, then the site. It carries no name and no avatar.
 */
export function storyTree(card: MarineWebCard, tagsPng: Uint8Array): VNode {
  const look = TIER_LOOKS[card.tier];
  const odds = marineOdds(card.tier, card.percentile);
  const tagsWidth = Math.round(KINO_SIZE.width * STORY_TAGS.scale);
  const tagsHeight = Math.round(KINO_SIZE.height * STORY_TAGS.scale);
  const row = 3 * HEX.width + 2 * HEX.gap;
  const lefts = [0, 1, 2].map((i) => (STORY_SIZE.width - row) / 2 + i * (HEX.width + HEX.gap));
  return h(
    'div',
    { style: { width: STORY_SIZE.width, height: STORY_SIZE.height, display: 'flex', position: 'relative', backgroundColor: INK.navy, fontFamily: 'Inter', color: INK.text } },
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: STORY_SIZE.width, height: STORY_SIZE.height, display: 'flex', backgroundImage: 'radial-gradient(circle at 50% 100%, #1d3a7a 0%, #1d3a7a00 55%)' } }),
    haloImage(card.tier),
    h('img', { src: pngUri(tagsPng), width: tagsWidth, height: tagsHeight, style: { position: 'absolute', left: STORY_TAGS.left, top: STORY_TAGS.top, width: tagsWidth, height: tagsHeight } }),
    centred(1060, { fontFamily: MONO, fontWeight: 700, fontSize: 52, color: INK.paleGold, letterSpacing: 6 }, `LINK MARINE #${serialText(card.serial)}`),
    centred(1140, { fontFamily: MONO, fontWeight: 700, fontSize: callsignSize(card.callsign), color: INK.text, letterSpacing: CALLSIGN_TRACKING }, card.callsign.toUpperCase()),
    centred(1240, { fontFamily: 'Inter', fontWeight: 900, fontSize: 120, color: 'transparent', backgroundImage: look.word, backgroundClip: 'text', lineHeight: 1 }, TIER_WORD[card.tier]),
    ...(odds === null ? [] : [centred(1380, { fontFamily: MONO, fontWeight: 700, fontSize: 34, color: look.accent }, odds)]),
    ...card.memes.map((m, i) => memeHex(m.png, lefts[i]!, look.color)),
    ...card.memes.map((m, i) =>
      h('div', { style: { position: 'absolute', left: lefts[i]! - 40, top: HEX.top + HEX.height + 24, width: HEX.width + 80, display: 'flex', justifyContent: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 32, color: INK.text } }, m.tag),
    ),
    centred(1840, { fontFamily: MONO, fontWeight: 700, fontSize: 36, color: INK.blue, letterSpacing: 4 }, 'ccip.dev · LinkMarines'),
  );
}
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
import { STICKER_SIZE, stickerTree } from './sticker';
```

with:

```ts
import { STICKER_SIZE, stickerTree } from './sticker';
import { STORY_SIZE, storyTree } from './story';
```

In `site/worker/linkmarine/entrypoint.ts`, replace:

```ts
  async renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array> {
```

with:

```ts
  /** The Story card, 1080×1920, from the same tags pass as the sticker. Never a name or an avatar. */
  async renderMarineStory(card: MarineWebCard): Promise<Uint8Array> {
    const web = webCardOf(card);
    const tags = await renderKino(tagsTree(web));
    return (await renderKino(storyTree(web, tags.png), STORY_SIZE)).png;
  }

  async renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array> {
```

In `discord/test/helpers.ts`, replace:

```ts
export function fakeRenderer(failing: keyof LinkMarineRenderer | null = null): LinkMarineRenderer & { calls: string[]; webCards: MarineWebCard[]; stickers: MarineWebCard[] } {
```

with:

```ts
export function fakeRenderer(failing: keyof LinkMarineRenderer | null = null): LinkMarineRenderer & { calls: string[]; webCards: MarineWebCard[]; stickers: MarineWebCard[]; stories: MarineWebCard[] } {
```

In `discord/test/helpers.ts`, replace:

```ts
  const stickers: MarineWebCard[] = [];
```

with:

```ts
  const stickers: MarineWebCard[] = [];
  const stories: MarineWebCard[] = [];
```

In `discord/test/helpers.ts`, replace:

```ts
    stickers,
    async prepareMeme() {
```

with:

```ts
    stickers,
    stories,
    async prepareMeme() {
```

In `discord/test/helpers.ts`, replace:

```ts
      return call('renderMarineSticker', PNG_BYTES);
    },
```

with:

```ts
      return call('renderMarineSticker', PNG_BYTES);
    },
    async renderMarineStory(card) {
      stories.push(card);
      return call('renderMarineStory', PNG_BYTES);
    },
```

In `discord/test/site-stub.js`, replace:

```js
  async renderMarineSticker() {
    return new Uint8Array(PNG);
  }
```

with:

```js
  async renderMarineSticker() {
    return new Uint8Array(PNG);
  }

  async renderMarineStory() {
    return new Uint8Array(PNG);
  }
```

- [ ] **Step 4: Run the Story card's tests.**

Run: `pnpm --filter @ccip-dev/site exec vitest run -c vitest.worker.config.ts worker/test/linkmarine-story.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the @BotFather photo, its script and the visual check.**

Create `site/worker/linkmarine/app-image.ts`:

```ts
import type { MarineWebCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { INK, KINO_SIZE, MONO } from './art';
import { TIER_LOOKS } from './metal';
import { pngUri, TAGS_BOX } from './sticker';

/** The Mini App's photo in @BotFather: 640×360. */
export const APP_IMAGE_SIZE = { width: 640, height: 360 } as const;
const TAGS_SCALE = 340 / TAGS_BOX.height;

/** The tags of a sample Marine on the left, the app's name and its one line on the right. */
export function appImageTree(card: MarineWebCard, tagsPng: Uint8Array): VNode {
  const look = TIER_LOOKS[card.tier];
  const width = Math.round(KINO_SIZE.width * TAGS_SCALE);
  const height = Math.round(KINO_SIZE.height * TAGS_SCALE);
  return h(
    'div',
    { style: { width: APP_IMAGE_SIZE.width, height: APP_IMAGE_SIZE.height, display: 'flex', position: 'relative', backgroundColor: INK.navy, fontFamily: 'Inter', color: INK.text } },
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: APP_IMAGE_SIZE.width, height: APP_IMAGE_SIZE.height, display: 'flex', backgroundImage: `radial-gradient(circle at 28% 50%, ${look.color}55 0%, ${look.color}00 60%)` } }),
    h('img', { src: pngUri(tagsPng), width, height, style: { position: 'absolute', left: 4, top: 10, width, height } }),
    h(
      'div',
      { style: { position: 'absolute', left: 356, top: 100, width: 268, display: 'flex', flexDirection: 'column' } },
      h('div', { style: { fontFamily: MONO, fontWeight: 700, fontSize: 15, color: INK.blue, letterSpacing: 3 } }, 'ccip.dev'),
      h('div', { style: { fontFamily: 'Inter', fontWeight: 900, fontSize: 38, lineHeight: 1.1, marginTop: 8, color: 'transparent', backgroundImage: look.word, backgroundClip: 'text' } }, 'LinkMarines'),
      h('div', { style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 20, lineHeight: 1.35, marginTop: 14, color: INK.text } }, 'Enlist, Marine.'),
      h('div', { style: { fontFamily: 'Inter', fontWeight: 400, fontSize: 16, lineHeight: 1.4, marginTop: 6, color: INK.sub } }, 'Three meme tags become your callsign. One draw, forever.'),
    ),
  );
}
```

In `site/test/fixtures/linkmarine.ts`, replace:

```ts
/** A tier's sample Marine as the site draws it
```

with:

```ts
/** The mockup's memes in the chainlinkmeme archive: painting, space and prophecy. */
export const MOCKUP_MEMES = ['a3ccf753ffd27a408d0d5d974faecf2f.jpeg', 'e572d111223722c3d6cce9d52b90f45e.jpeg', 'aabd55f53e8aea9de4665be183d5bb7d.jpeg'];

/** A tier's sample Marine as the site draws it
```

Create `site/scripts/render-marines-app-image.ts`:

```ts
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { render } from '@cf-wasm/og/node';
import { MOCKUP_MEMES, webMarine } from '../test/fixtures/linkmarine';
import type { VNode } from '../worker/h';
import { APP_IMAGE_SIZE, appImageTree } from '../worker/linkmarine/app-image';
import { KINO_FONTS } from '../worker/linkmarine/fonts';
import { tagsTree } from '../worker/linkmarine/marine-card';
import { MEME_SIZE, memeTree } from '../worker/linkmarine/meme';

/**
 * `pnpm --filter @ccip-dev/site cards:app [--archive ../chainlinkmeme]`: draws the LinkMarines Mini App's 640×360
 * photo for @BotFather into site/public/marines-app-640x360.png, from the Legendary sample Marine and the mockup's memes.
 */
const site = join(import.meta.dirname, '..');
const { values } = parseArgs({ options: { archive: { type: 'string', default: join(site, '..', '..', 'chainlinkmeme') } } });
const dir = join(resolve(values.archive), 'memes');
if (!MOCKUP_MEMES.every((f) => existsSync(join(dir, f)))) throw new Error(`the mockup's memes are not in ${dir}: pass --archive <your chainlinkmeme checkout>`);

const draw = async (tree: VNode, width: number, height: number) => (await render(tree as never, { width, height, fonts: KINO_FONTS, loadAdditionalAsset: async () => [] }).asPng()).image;
const memes = await Promise.all(MOCKUP_MEMES.map(async (f) => draw(memeTree(new Uint8Array(await readFile(join(dir, f)))), MEME_SIZE, MEME_SIZE)));
const card = webMarine('legendary', memes);
const tags = await draw(tagsTree(card), 1200, 675);
const image = await draw(appImageTree(card, tags), APP_IMAGE_SIZE.width, APP_IMAGE_SIZE.height);
const out = join(site, 'public', 'marines-app-640x360.png');
await writeFile(out, image);
console.log(`wrote ${out} (${image.byteLength} bytes)`);
```

In `site/package.json`, replace:

```json
    "cards:linkmarine": "tsx scripts/render-linkmarine-cards.ts",
```

with:

```json
    "cards:app": "tsx scripts/render-marines-app-image.ts",
    "cards:linkmarine": "tsx scripts/render-linkmarine-cards.ts",
```

The visual check script takes `MOCKUP_MEMES` from the fixtures and also writes each tier's sticker and Story card:

In `site/scripts/render-linkmarine-cards.ts`, replace:

```ts
import { DOSSIER, marine, RECORDS, SITREP, VAULT } from '../test/fixtures/linkmarine';
```

with:

```ts
import { DOSSIER, marine, MOCKUP_MEMES, RECORDS, SITREP, VAULT } from '../test/fixtures/linkmarine';
```

In `site/scripts/render-linkmarine-cards.ts`, replace:

```ts
import { marineTree, webCardOf } from '../worker/linkmarine/marine-card';
import { MEME_SIZE, memeTree } from '../worker/linkmarine/meme';
```

with:

```ts
import { marineTree, tagsTree, webCardOf } from '../worker/linkmarine/marine-card';
import { MEME_SIZE, memeTree } from '../worker/linkmarine/meme';
import { STICKER_SIZE, stickerTree } from '../worker/linkmarine/sticker';
import { STORY_SIZE, storyTree } from '../worker/linkmarine/story';
```

In `site/scripts/render-linkmarine-cards.ts`, replace:

```ts
 * `pnpm --filter @ccip-dev/site cards:linkmarine [--out DIR] [--archive ../chainlinkmeme]`: draws every tier of the dog
 * tag card (and the glint of Rare and Legendary) and the four intel cards from fixtures, for a human look before launch.
```

with:

```ts
 * `pnpm --filter @ccip-dev/site cards:linkmarine [--out DIR] [--archive ../chainlinkmeme]`: draws every tier of the dog
 * tag card (and the glint of Rare and Legendary, the sticker and the Story card) and the four intel cards from fixtures,
 * for a human look before launch.
```

In `site/scripts/render-linkmarine-cards.ts`, replace:

```ts
const out = resolve(values.out);
/** The mockup's memes: painting, space and prophecy. */
const MOCKUP_MEMES = ['a3ccf753ffd27a408d0d5d974faecf2f.jpeg', 'e572d111223722c3d6cce9d52b90f45e.jpeg', 'aabd55f53e8aea9de4665be183d5bb7d.jpeg'];
```

with:

```ts
const out = resolve(values.out);
```

In `site/scripts/render-linkmarine-cards.ts`, replace:

```ts
  await writeFile(join(out, `marine-${tier}-web.png`), (await draw(marineTree(web))).image);
```

with:

```ts
  await writeFile(join(out, `marine-${tier}-web.png`), (await draw(marineTree(web))).image);
  const tags = (await draw(tagsTree(web))).image;
  await writeFile(join(out, `marine-${tier}-sticker.png`), (await draw(stickerTree(web, tags), STICKER_SIZE.width, STICKER_SIZE.height)).image);
  await writeFile(join(out, `marine-${tier}-story.png`), (await draw(storyTree(web, tags), STORY_SIZE.width, STORY_SIZE.height)).image);
```

Draw the photo. It needs the `../chainlinkmeme` checkout (the owner's machine has it beside this repository; elsewhere pass `--archive <path>`):

Run: `pnpm --filter @ccip-dev/site cards:app`
Expected: `wrote …/site/public/marines-app-640x360.png (… bytes)`, about 167 KB: the Legendary sample's gold tags on the left over a gold glow, and on the right "ccip.dev", "LinkMarines" in the gold wordmark gradient, "Enlist, Marine." and "Three meme tags become your callsign. One draw, forever."

Run: `pnpm --filter @ccip-dev/site cards:linkmarine`
Expected: `site/linkmarine-cards/` (git-ignored) now also holds `marine-<tier>-sticker.png` (about 190–210 KB each: the tags on their chain, the plate `LINK MARINE #0007` under them, transparent around) and `marine-<tier>-story.png` (about 1.3–1.4 MB: the tags over the tier's halo, `LINK MARINE #0007`, `PAINTING-SPACE-PROPHECY`, the tier word, the odds line, the three framed memes, "ccip.dev · LinkMarines"). Open them and look before committing.

- [ ] **Step 6: Run the site, the bot and the typecheck.**

Run: `pnpm --filter @ccip-dev/site test`
Expected: PASS: Node 1,347 tests, workerd 36.

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (183 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/linkmarine.ts site/worker/linkmarine/story.ts site/worker/linkmarine/app-image.ts site/worker/linkmarine/entrypoint.ts site/worker/test/linkmarine-story.test.ts site/test/marines-app-image.test.ts site/test/fixtures/linkmarine.ts site/scripts/render-marines-app-image.ts site/scripts/render-linkmarine-cards.ts site/package.json site/public/marines-app-640x360.png discord/test/helpers.ts discord/test/site-stub.js
git commit -m "feat(site): renderMarineStory, the 9:16 Story card, and the Mini App's 640x360 photo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Checkpoint push 1.** Push now (`git push`), and wait for `gh run list --workflow site --limit 1` to show the site deployed: the Worker's later tasks call these two methods through the `SITE` binding.

---

### Task 4: Telegram's names, the Bot API client and the launch data

The shared vocabulary both sides need (the bot's username, the Mini App's links, the sticker packs' names and volumes, and the `startapp` grammar) goes into core. The Worker gets a Bot API client that never retries, never throws and never lets the token into a result, and a verifier for the Mini App's launch data: the HMAC Telegram signs it with, in constant time through `crypto.subtle.verify`, and a 24-hour age limit.

**Files:**
- Create: `discord/src/telegram-api.ts`, `discord/src/telegram-auth.ts`
- Modify: `packages/core/src/linkmarine.ts` (the Telegram section), `discord/test/helpers.ts` (`BOT_TOKEN`, `TG_USER`, `signedLaunch`)
- Test: `packages/core/test/linkmarine-telegram.test.ts`, `discord/test/telegram-auth.test.ts`, `discord/test/telegram-api.test.ts`

**Interfaces:**
- Produces (core, `@ccip-dev/core/linkmarine`): `TELEGRAM_BOT_USERNAME = 'ccipdevbot'`, `MINI_APP_LINK = 'https://t.me/ccipdevbot/marines'`, `MINI_APP_URL = 'https://ccip.dev/tg/'`, `miniAppLink(startapp?): string`, `STICKERS_PER_PACK = 120`, `stickerVolume(serial): number`, `stickerPackName(volume)`, `stickerPackTitle(volume)`, `stickerPackUrl(volume)`, `type StartParam = { kind: 'enlist' } | { kind: 'marine'; serial } | { kind: 'tag'; tag }`, `parseStartParam(param: string | null | undefined): StartParam | null`.
- Produces (`discord/src/telegram-api.ts`): `TELEGRAM_API`, `TELEGRAM_TIMEOUT_MS = 5_000`, `type TelegramResult<T> = { ok: true; result: T } | { ok: false; status: number; description: string; retryAfter: number | null }` (status 0 when no answer came back), `interface TelegramFile { field; name; type; bytes }`, `interface TelegramApi { call<T>(method, body, timeoutMs?); upload<T>(method, fields, file, timeoutMs?); download(filePath, timeoutMs?): Promise<Uint8Array | null> }`, `telegramApi(token, fetchFn): TelegramApi`.
- Produces (`discord/src/telegram-auth.ts`): `interface TelegramUser { id: number; first_name: string; last_name?; username?; photo_url? }`, `interface LaunchData { user: TelegramUser; authDate: number }`, `LAUNCH_MAX_AGE_S = 86_400`, `verifyLaunchData(initData, botToken, nowMs): Promise<LaunchData | null>`.
- Produces (`discord/test/helpers.ts`): `BOT_TOKEN`, `TG_USER`, `signedLaunch(user, authDate, token?, extra?): Promise<string>`.

- [ ] **Step 1: Write the failing tests.**

Create `packages/core/test/linkmarine-telegram.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { miniAppLink, parseStartParam, stickerPackName, stickerPackTitle, stickerPackUrl, stickerVolume } from '../src/linkmarine';

describe('the LinkMarines sticker packs', () => {
  it('puts 120 Marines in a volume, the plank owners in Vol. 1', () => {
    // #then
    expect([1, 100, 120, 121, 240, 241].map(stickerVolume)).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it('names Vol. 1 linkmarines_by_ccipdevbot and the rest by number', () => {
    // #then
    expect([stickerPackName(1), stickerPackName(2), stickerPackTitle(2), stickerPackUrl(1)]).toEqual([
      'linkmarines_by_ccipdevbot',
      'linkmarines2_by_ccipdevbot',
      'LinkMarines Vol. 2 · ccip.dev',
      'https://t.me/addstickers/linkmarines_by_ccipdevbot',
    ]);
  });
});

describe('the Mini App links', () => {
  it('reads enlist, a Marine and a tag, and nothing else', () => {
    // #then
    expect(['enlist', 'marine_42', 'tag_pepe', 'tag_based_af', 'marine_0', 'marine_007', 'tag_Pepe', 'tag_', 'marine_', 'roster', '', null, undefined].map(parseStartParam)).toEqual([
      { kind: 'enlist' },
      { kind: 'marine', serial: 42 },
      { kind: 'tag', tag: 'pepe' },
      { kind: 'tag', tag: 'based_af' },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('builds the direct link, with startapp when given', () => {
    // #then
    expect([miniAppLink(), miniAppLink('enlist')]).toEqual(['https://t.me/ccipdevbot/marines', 'https://t.me/ccipdevbot/marines?startapp=enlist']);
  });
});
```

The Worker's tests sign launch data the way Telegram does:

At the end of `discord/test/helpers.ts`, add:

```ts
/** The bot token the Telegram tests sign launch data with. */
export const BOT_TOKEN = '123456:TEST-bot-token';
/** A Telegram account, as launch data names it. */
export const TG_USER = { id: 777000111, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' };

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Launch data as Telegram signs it, for `user` at `authDate` (Unix seconds), with any other fields in `extra`. */
export async function signedLaunch(user: Record<string, unknown>, authDate: number, token = BOT_TOKEN, extra: Record<string, string> = {}): Promise<string> {
  const fields: Record<string, string> = { query_id: 'AAHdF6IQAAAAAN0XohDhrOrc', user: JSON.stringify(user), auth_date: String(authDate), ...extra };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const encode = (s: string) => new TextEncoder().encode(s);
  const hmac = async (key: BufferSource, data: string) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encode(data));
  const hash = toHex(await hmac(await hmac(encode('WebAppData'), token), check));
  return new URLSearchParams({ ...fields, hash }).toString();
}
```

Create `discord/test/telegram-auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LAUNCH_MAX_AGE_S, verifyLaunchData } from '../src/telegram-auth';
import { BOT_TOKEN, signedLaunch, TG_USER } from './helpers';

const NOW_S = 1_791_892_245;
const NOW_MS = NOW_S * 1000;

describe('Mini App launch data', () => {
  it("accepts Telegram's own example, signed with its example token", async () => {
    // #given the example from the telegram-apps docs (docs.telegram-mini-apps.com, init data validation)
    const initData =
      'query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2';
    // #when
    const launch = await verifyLaunchData(initData, '5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8', 1_662_771_708_000);
    // #then
    expect([launch?.user.id, launch?.user.first_name, launch?.authDate]).toEqual([279058397, 'Vladislav', 1662771648]);
  });

  it('accepts fresh launch data with every field signed, the signature field included', async () => {
    // #given
    const initData = await signedLaunch(TG_USER, NOW_S - 60, BOT_TOKEN, { signature: 'abc', start_param: 'enlist' });
    // #when
    const launch = await verifyLaunchData(initData, BOT_TOKEN, NOW_MS);
    // #then
    expect(launch).toEqual({ user: TG_USER, authDate: NOW_S - 60 });
  });

  it('refuses launch data older than 24 hours, or from more than five minutes ahead', async () => {
    // #given
    const [stale, edge, ahead] = await Promise.all([signedLaunch(TG_USER, NOW_S - LAUNCH_MAX_AGE_S - 1), signedLaunch(TG_USER, NOW_S - LAUNCH_MAX_AGE_S), signedLaunch(TG_USER, NOW_S + 301)]);
    // #when
    const results = await Promise.all([stale, edge, ahead].map((d) => verifyLaunchData(d, BOT_TOKEN, NOW_MS)));
    // #then
    expect(results.map((r) => r?.user.id ?? null)).toEqual([null, TG_USER.id, null]);
  });

  it('refuses tampered launch data: another user swapped in after signing', async () => {
    // #given
    const signed = new URLSearchParams(await signedLaunch(TG_USER, NOW_S));
    signed.set('user', JSON.stringify({ ...TG_USER, id: 1 }));
    // #then
    expect(await verifyLaunchData(signed.toString(), BOT_TOKEN, NOW_MS)).toBeNull();
  });

  it("refuses launch data signed with another bot's token", async () => {
    // #given
    const initData = await signedLaunch(TG_USER, NOW_S, '999:another-bot');
    // #then
    expect(await verifyLaunchData(initData, BOT_TOKEN, NOW_MS)).toBeNull();
  });

  it('refuses missing launch data, a missing or malformed hash, and a missing token', async () => {
    // #given
    const signed = new URLSearchParams(await signedLaunch(TG_USER, NOW_S));
    const noHash = new URLSearchParams(signed);
    noHash.delete('hash');
    const shortHash = new URLSearchParams(signed);
    shortHash.set('hash', 'abc');
    // #when
    const results = await Promise.all([
      verifyLaunchData('', BOT_TOKEN, NOW_MS),
      verifyLaunchData(noHash.toString(), BOT_TOKEN, NOW_MS),
      verifyLaunchData(shortHash.toString(), BOT_TOKEN, NOW_MS),
      verifyLaunchData(signed.toString(), '', NOW_MS),
    ]);
    // #then
    expect(results).toEqual([null, null, null, null]);
  });

  it('refuses signed launch data without a usable user', async () => {
    // #given
    const [noName, textId] = await Promise.all([signedLaunch({ id: 5 }, NOW_S), signedLaunch({ id: '5', first_name: 'x' }, NOW_S)]);
    // #then
    expect([await verifyLaunchData(noName, BOT_TOKEN, NOW_MS), await verifyLaunchData(textId, BOT_TOKEN, NOW_MS)]).toEqual([null, null]);
  });
});
```

Create `discord/test/telegram-api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { telegramApi } from '../src/telegram-api';

const TOKEN = '123456:SECRET';

/** A fetch answering one canned response, recording each request. */
function answering(res: () => Response | Promise<Response>) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return res();
  }) as typeof fetch;
  return { requests, fetchFn };
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the Telegram Bot API client', () => {
  it('posts JSON to the method and hands back the result', async () => {
    // #given
    const t = answering(() => reply({ ok: true, result: { status: 'member' } }));
    // #when
    const got = await telegramApi(TOKEN, t.fetchFn).call<{ status: string }>('getChatMember', { chat_id: '@ccipdev', user_id: 7 });
    // #then
    expect({ got, url: t.requests[0]!.url, body: JSON.parse(t.requests[0]!.init!.body as string) }).toEqual({
      got: { ok: true, result: { status: 'member' } },
      url: `https://api.telegram.org/bot${TOKEN}/getChatMember`,
      body: { chat_id: '@ccipdev', user_id: 7 },
    });
  });

  it("reports Telegram's refusal and a 429's retry_after, never waiting", async () => {
    // #given
    const refused = answering(() => reply({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400));
    const limited = answering(() => reply({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }, 429));
    // #when
    const results = [await telegramApi(TOKEN, refused.fetchFn).call('getChat', {}), await telegramApi(TOKEN, limited.fetchFn).call('addStickerToSet', {})];
    // #then
    expect({ results, calls: limited.requests.length }).toEqual({
      results: [
        { ok: false, status: 400, description: 'Bad Request: chat not found', retryAfter: null },
        { ok: false, status: 429, description: 'Too Many Requests: retry after 7', retryAfter: 7 },
      ],
      calls: 1,
    });
  });

  it('turns a failed request into a result that never names the token', async () => {
    // #given
    const t = answering(() => Promise.reject(new TypeError(`fetch to https://api.telegram.org/bot${TOKEN}/x failed`)));
    // #when
    const got = await telegramApi(TOKEN, t.fetchFn).call('getMe', {});
    // #then
    expect([got, JSON.stringify(got).includes('SECRET')]).toEqual([{ ok: false, status: 0, description: 'request failed (TypeError)', retryAfter: null }, false]);
  });

  it('uploads a file as multipart beside its fields', async () => {
    // #given
    const t = answering(() => reply({ ok: true, result: { file_id: 'F1' } }));
    // #when
    await telegramApi(TOKEN, t.fetchFn).upload('uploadStickerFile', { user_id: '42', sticker_format: 'static' }, { field: 'sticker', name: 'marine-7.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    // #then
    const form = t.requests[0]!.init!.body as FormData;
    const file = form.get('sticker') as File;
    expect([form.get('user_id'), form.get('sticker_format'), file.name, file.type, [...new Uint8Array(await file.arrayBuffer())]]).toEqual(['42', 'static', 'marine-7.png', 'image/png', [1, 2, 3]]);
  });

  it("downloads a file by getFile's path, or gives null", async () => {
    // #given
    const found = answering(() => new Response(new Uint8Array([9, 8])));
    const missing = answering(() => new Response('no', { status: 404 }));
    // #when
    const got = [await telegramApi(TOKEN, found.fetchFn).download('photos/file_1.jpg'), await telegramApi(TOKEN, missing.fetchFn).download('photos/x.jpg')];
    // #then
    expect([got[0] && [...got[0]], got[1], found.requests[0]!.url]).toEqual([[9, 8], null, `https://api.telegram.org/file/bot${TOKEN}/photos/file_1.jpg`]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/linkmarine-telegram.test.ts`
Expected: FAIL: `stickerVolume is not a function` (and the like): core has none of these names yet.

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/telegram-auth.test.ts test/telegram-api.test.ts`
Expected: FAIL: `../src/telegram-auth` and `../src/telegram-api` do not exist.

- [ ] **Step 3: Add the vocabulary, the client and the verifier.**

At the end of `packages/core/src/linkmarine.ts`, add:

```ts
/** LinkMarines on Telegram: the bot, its Mini App and the sticker packs, as the bot and the site both name them. */
export const TELEGRAM_BOT_USERNAME = 'ccipdevbot';
/** The Mini App's direct link: registered with @BotFather as `marines`. */
export const MINI_APP_LINK = `https://t.me/${TELEGRAM_BOT_USERNAME}/marines`;
/** Where the Mini App is served from. */
export const MINI_APP_URL = 'https://ccip.dev/tg/';

/** The direct link, opening the Mini App with `startapp` when given. */
export const miniAppLink = (startapp?: string) => (startapp ? `${MINI_APP_LINK}?startapp=${startapp}` : MINI_APP_LINK);

/** Telegram caps a static sticker set at 120 stickers. */
export const STICKERS_PER_PACK = 120;
/** A Marine's sticker volume: serials 1–120 are Vol. 1, 121–240 Vol. 2, and so on. */
export const stickerVolume = (serial: number) => Math.ceil(serial / STICKERS_PER_PACK);
export const stickerPackName = (volume: number) => `linkmarines${volume === 1 ? '' : volume}_by_${TELEGRAM_BOT_USERNAME}`;
export const stickerPackTitle = (volume: number) => `LinkMarines Vol. ${volume} · ccip.dev`;
export const stickerPackUrl = (volume: number) => `https://t.me/addstickers/${stickerPackName(volume)}`;

/** Where a Mini App link opens: screen 1, a Marine on the roster, or a tag's sheet on the roster. */
export type StartParam = { kind: 'enlist' } | { kind: 'marine'; serial: number } | { kind: 'tag'; tag: string };

const START_MARINE = /^marine_([1-9]\d{0,8})$/;
const START_TAG = /^tag_([a-z0-9_]{1,13})$/;

/** A `startapp` value as the Mini App reads it; anything else is null, so a link can only ever open a known screen. */
export function parseStartParam(param: string | null | undefined): StartParam | null {
  if (param === 'enlist') return { kind: 'enlist' };
  const marine = START_MARINE.exec(param ?? '');
  if (marine) return { kind: 'marine', serial: Number(marine[1]) };
  const tag = START_TAG.exec(param ?? '');
  return tag ? { kind: 'tag', tag: tag[1]! } : null;
}
```

Create `discord/src/telegram-api.ts`:

```ts
/**
 * The Bot API calls LinkMarines on Telegram makes (core.telegram.org/bots/api). It never retries and never sleeps: a
 * request a Marine waits on can't wait out a 429, and the sticker job stops its run on one. It never throws, and no
 * answer it gives carries the token.
 */
export const TELEGRAM_API = 'https://api.telegram.org';
export const TELEGRAM_TIMEOUT_MS = 5_000;

export type TelegramResult<T> = { ok: true; result: T } | { ok: false; status: number; description: string; retryAfter: number | null };

export interface TelegramFile {
  field: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface TelegramApi {
  /** A JSON Bot API method. */
  call<T>(method: string, body: Record<string, unknown>, timeoutMs?: number): Promise<TelegramResult<T>>;
  /** A Bot API method with one file, as multipart; `fields` are its other parameters. */
  upload<T>(method: string, fields: Record<string, string>, file: TelegramFile, timeoutMs?: number): Promise<TelegramResult<T>>;
  /** A file's bytes by the `file_path` getFile gave, or null. */
  download(filePath: string, timeoutMs?: number): Promise<Uint8Array | null>;
}

const failed = (err: unknown): TelegramResult<never> => ({ ok: false, status: 0, description: `request failed (${err instanceof Error ? err.name : 'unknown error'})`, retryAfter: null });

async function answer<T>(res: Response): Promise<TelegramResult<T>> {
  let body: { ok?: boolean; result?: T; description?: unknown; parameters?: { retry_after?: unknown } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // A body that isn't JSON (a proxy's error page) leaves only the status to report.
  }
  if (res.ok && body.ok === true) return { ok: true, result: body.result as T };
  const retryAfter = typeof body.parameters?.retry_after === 'number' ? body.parameters.retry_after : null;
  return { ok: false, status: res.status, description: typeof body.description === 'string' ? body.description.slice(0, 200) : `HTTP ${res.status}`, retryAfter };
}

export function telegramApi(token: string, fetchFn: typeof fetch): TelegramApi {
  const url = (method: string) => `${TELEGRAM_API}/bot${token}/${method}`;
  return {
    async call<T>(method: string, body: Record<string, unknown>, timeoutMs = TELEGRAM_TIMEOUT_MS) {
      try {
        const res = await fetchFn(url(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        return await answer<T>(res);
      } catch (err) {
        return failed(err);
      }
    },
    async upload<T>(method: string, fields: Record<string, string>, file: TelegramFile, timeoutMs = TELEGRAM_TIMEOUT_MS) {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.append(name, value);
      form.append(file.field, new Blob([file.bytes], { type: file.type }), file.name);
      try {
        return await answer<T>(await fetchFn(url(method), { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) }));
      } catch (err) {
        return failed(err);
      }
    },
    async download(filePath: string, timeoutMs = TELEGRAM_TIMEOUT_MS) {
      try {
        const res = await fetchFn(`${TELEGRAM_API}/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(timeoutMs) });
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      } catch {
        return null;
      }
    },
  };
}
```

Create `discord/src/telegram-auth.ts`:

```ts
/** The Telegram user a Mini App's launch data names (core.telegram.org/bots/webapps#webappuser). */
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export interface LaunchData {
  user: TelegramUser;
  /** Unix seconds, when Telegram opened the Mini App. */
  authDate: number;
}

/** Launch data older than this is refused: a copied launch string can't be used for long. */
export const LAUNCH_MAX_AGE_S = 86_400;
/** Telegram's clock and ours may disagree by a little; a launch from further in the future is refused. */
const CLOCK_SKEW_S = 300;

const encoder = new TextEncoder();
const HASH = /^[0-9a-f]{64}$/;

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));

async function hmacKey(secret: Uint8Array, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function parseUser(raw: string | null): TelegramUser | null {
  try {
    const user = JSON.parse(raw ?? '') as Partial<TelegramUser>;
    if (!Number.isSafeInteger(user.id) || typeof user.first_name !== 'string') return null;
    return user as TelegramUser;
  } catch {
    return null;
  }
}

/**
 * The verified launch data, or null. Telegram signs every field but `hash`: sorted by key as `key=value` lines, with
 * HMAC-SHA256 under the key HMAC-SHA256("WebAppData", bot token). crypto.subtle.verify compares in constant time.
 */
export async function verifyLaunchData(initData: string, botToken: string, nowMs: number): Promise<LaunchData | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') ?? '';
  if (!HASH.test(hash)) return null;
  const dataCheck = [...params]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(encoder.encode('WebAppData'), 'sign'), encoder.encode(botToken)));
  if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), hexBytes(hash), encoder.encode(dataCheck)))) return null;
  const authDate = Number(params.get('auth_date'));
  const age = nowMs / 1000 - authDate;
  if (!Number.isInteger(authDate) || age > LAUNCH_MAX_AGE_S || age < -CLOCK_SKEW_S) return null;
  const user = parseUser(params.get('user'));
  return user ? { user, authDate } : null;
}
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/core test`
Expected: PASS (682 tests).

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (195 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/linkmarine.ts packages/core/test/linkmarine-telegram.test.ts discord/src/telegram-api.ts discord/src/telegram-auth.ts discord/test/helpers.ts discord/test/telegram-auth.test.ts discord/test/telegram-api.test.ts
git commit -m "feat(discord): the Telegram Bot API client and Mini App launch data verification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Telegram Marines: the name, the photo, the gate and stamping; the public Story card

What the Mini App API needs to know about a Telegram Marine, in `telegram-marines.ts`: the settings from the Worker's env, the name stamped on the card, the photo (the launch data's JPEG, else the newest profile photo up to 640 px, made a 240 px PNG by the site's `prepareMeme`), the gate across `TELEGRAM_GATE_CHATS`, the Mini App's summary of a Marine, and the stamp: the card with the name and photo, then the public web card and Story card with neither. The public routes get `/story/<serial>.png`, kept in R2 `story/` and rendered on first request like the web card, through one shared route builder.

**Files:**
- Create: `discord/src/telegram-marines.ts`
- Modify: `packages/core/src/linkmarine.ts` (`MarineSummary`, `Gate`), `discord/src/env.ts`, `discord/src/enlistment.ts` (`publicCard`), `discord/src/public.ts` (`storyKey`, `keptCard`, the Story route), `discord/test/helpers.ts` (`fakeTelegram`, `tgOk`, `tgError`, `OWNER_ID`, `TG_SETTINGS`, `fakeTelegramBot`)
- Test: `discord/test/telegram-marines.test.ts`, `discord/test/story.test.ts`

**Interfaces:**
- Consumes: Task 1's `enlistMarine`, `stampCard`, `avatarKey`, `readBytes`, `reason`, `snapshotCount`, `type Report`; Task 3's `renderMarineStory`; Task 4's `telegramApi`, `type TelegramApi`, `type TelegramUser`, `stickerVolume`.
- Produces (core): `interface MarineSummary { serial; callsign; tags: string[]; tier: Tier; percentile; memes: { tag; file; count }[]; volume: number; cardReady: boolean }`, `type Gate = 'ok' | 'join'`.
- Produces (`discord/src/env.ts`): `TELEGRAM_BOT?`, `TELEGRAM_GATE_CHATS?`, `TELEGRAM_STICKER_OWNER_ID?`.
- Produces (`discord/src/enlistment.ts`): `publicCard(bot: Pick<Bot, 'snapshot'>, marine, pngs): MarineWebCard`.
- Produces (`discord/src/public.ts`): `storyKey(serial)` (`story/<serial>.png`), the route `GET /story/<serial>.png`.
- Produces (`discord/src/telegram-marines.ts`): `TELEGRAM_PLATFORM = 'telegram'`, `interface TelegramSettings { open: boolean; gateChats: string[]; ownerId: number | null; botToken: string }`, `interface TelegramBot extends Bot { tg: TelegramApi; settings: TelegramSettings }`, `telegramSettings(env)`, `createTelegramBot(env): TelegramBot`, `telegramName(user): string`, `telegramAvatar(bot, serial, user): Promise<Uint8Array | null>`, `STAMP_CLAIM_MS = 60_000`, `claimStamp(db, serial, now): Promise<boolean>`, `stampTelegram(bot, marine, user): Promise<void>`, `marineSummary(bot, marine): MarineSummary`, `checkGate(bot, userId): Promise<Gate>`.
- Produces (`discord/test/helpers.ts`): `interface TelegramCall { method; body; file? }`, `fakeTelegram(answers?, files?)` (records `.calls`; an unlisted method answers `true`), `tgOk(result)`, `tgError(status, description, retryAfter?)`, `OWNER_ID = 42`, `TG_SETTINGS`, `interface FakeTelegramBot`, `fakeTelegramBot(overrides?)`.

- [ ] **Step 1: Write the failing tests, with a fake Bot API.**

In `discord/test/helpers.ts`, replace:

```ts
import { enlist, type MarineMeme } from '../src/store';
```

with:

```ts
import { enlist, type MarineMeme } from '../src/store';
import type { TelegramApi, TelegramResult } from '../src/telegram-api';
import type { TelegramBot, TelegramSettings } from '../src/telegram-marines';
```

At the end of `discord/test/helpers.ts`, add:

```ts
export interface TelegramCall {
  method: string;
  body: Record<string, unknown>;
  /** An upload's file name. */
  file?: string;
}

type Answer = (body: Record<string, unknown>) => TelegramResult<unknown>;

/** The Bot API as the bot calls it: each method answered from `answers` (true when unlisted), every call recorded. `files` are what download serves. */
export function fakeTelegram(answers: Record<string, Answer> = {}, files: Record<string, Uint8Array> = {}): TelegramApi & { calls: TelegramCall[] } {
  const calls: TelegramCall[] = [];
  const answer = (method: string, body: Record<string, unknown>) => (answers[method] ?? (() => ({ ok: true, result: true })))(body) as TelegramResult<never>;
  return {
    calls,
    async call(method, body) {
      calls.push({ method, body });
      return answer(method, body);
    },
    async upload(method, fields, file) {
      calls.push({ method, body: fields, file: file.name });
      return answer(method, fields);
    },
    async download(path) {
      return files[path] ?? null;
    },
  };
}

export const tgOk = (result: unknown): TelegramResult<unknown> => ({ ok: true, result });
export const tgError = (status: number, description: string, retryAfter: number | null = null): TelegramResult<unknown> => ({ ok: false, status, description, retryAfter });

export const OWNER_ID = 42;
export const TG_SETTINGS: TelegramSettings = { open: true, gateChats: ['@ccipdev'], ownerId: OWNER_ID, botToken: BOT_TOKEN };

export interface FakeTelegramBot extends FakeBot {
  tg: ReturnType<typeof fakeTelegram>;
  settings: TelegramSettings;
}

/** fakeBot with a fake Bot API and LinkMarines on Telegram switched on. */
export function fakeTelegramBot(overrides: Partial<TelegramBot> = {}): FakeTelegramBot {
  return { ...fakeBot(), tg: fakeTelegram(), settings: TG_SETTINGS, ...overrides } as FakeTelegramBot;
}
```

Create `discord/test/telegram-marines.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { enlistMarine } from '../src/enlistment';
import { storyKey, webCardKey } from '../src/public';
import type { Marine } from '../src/store';
import { checkGate, claimStamp, marineSummary, stampTelegram, STAMP_CLAIM_MS, TELEGRAM_PLATFORM, telegramAvatar, telegramName } from '../src/telegram-marines';
import { fakeFetch, fakeRenderer, fakeTelegram, fakeTelegramBot, PNG_BYTES, resetStorage, TG_SETTINGS, TG_USER, tgError, tgOk } from './helpers';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const PHOTOS = tgOk({ total_count: 1, photos: [[{ file_id: 'small', width: 160 }, { file_id: 'mid', width: 640 }, { file_id: 'big', width: 1280 }]] });

async function enlisted(bot: ReturnType<typeof fakeTelegramBot>): Promise<Marine> {
  const result = await enlistMarine(bot, { platform: TELEGRAM_PLATFORM, userId: String(TG_USER.id), displayName: telegramName(TG_USER) });
  if (result.kind !== 'enlisted') throw new Error(result.kind);
  return result.marine;
}

beforeEach(resetStorage);

describe('a Telegram Marine’s stamped name', () => {
  it('is the first and last name, else @username, else "Marine"', () => {
    // #then
    expect([
      telegramName({ first_name: 'Ada', last_name: 'Lovelace', username: 'ada' }),
      telegramName({ first_name: 'Ada' }),
      telegramName({ first_name: ' ', last_name: ' ', username: 'ada' }),
      telegramName({ first_name: '' }),
    ]).toEqual(['Ada Lovelace', 'Ada', '@ada', 'Marine']);
  });
});

describe('a Telegram Marine’s photo', () => {
  it('takes the launch photo when it is a JPEG on t.me, as the 240 px PNG the site makes, and keeps it', async () => {
    // #given
    const renderer = fakeRenderer();
    const bot = fakeTelegramBot({ renderer, fetch: fakeFetch({ 'https://t.me/i/userpic/': () => new Response(JPEG) }) });
    // #when
    const avatar = await telegramAvatar(bot, 3, { ...TG_USER, photo_url: 'https://t.me/i/userpic/320/abc.jpg' });
    // #then
    expect({ avatar: avatar && [...avatar], prepared: renderer.calls, kept: (await env.MARINES.head('avatars/3.png'))?.httpMetadata?.contentType, asked: bot.tg.calls }).toEqual({
      avatar: [...PNG_BYTES],
      prepared: ['prepareMeme'],
      kept: 'image/png',
      asked: [],
    });
  });

  it('else asks for the newest profile photo, at the largest size up to 640 px', async () => {
    // #given
    const bot = fakeTelegramBot({ tg: fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: (b) => tgOk({ file_path: `photos/${b.file_id}.jpg` }) }, { 'photos/mid.jpg': JPEG }) });
    // #when an SVG launch photo, which the card can't draw
    const avatar = await telegramAvatar(bot, 3, { ...TG_USER, photo_url: 'https://t.me/i/userpic/320/abc.svg' });
    // #then
    expect({ avatar: avatar && [...avatar], asked: bot.tg.calls.map((c) => [c.method, c.body.file_id ?? c.body.user_id]) }).toEqual({
      avatar: [...PNG_BYTES],
      asked: [['getUserProfilePhotos', TG_USER.id], ['getFile', 'mid']],
    });
  });

  it('is the gradient disc when the photo is hidden or there is none, keeping nothing', async () => {
    // #given a profile whose photo only contacts may see: the bot gets no photos
    const bot = fakeTelegramBot({ tg: fakeTelegram({ getUserProfilePhotos: () => tgOk({ total_count: 0, photos: [] }) }) });
    // #when
    const avatar = await telegramAvatar(bot, 3, TG_USER);
    // #then
    expect([avatar, await env.MARINES.head('avatars/3.png')]).toEqual([null, null]);
  });
});

describe('the gate', () => {
  const member = (status: string, extra: Record<string, unknown> = {}) => fakeTelegram({ getChatMember: () => tgOk({ status, ...extra }) });

  it('lets in a creator, an administrator, a member and a restricted member', async () => {
    // #when
    const gates = await Promise.all([member('creator'), member('administrator'), member('member'), member('restricted', { is_member: true })].map((tg) => checkGate(fakeTelegramBot({ tg }), TG_USER.id)));
    // #then
    expect(gates).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('turns away one who left, was banned, or is restricted outside the chat, alerting no one', async () => {
    // #given
    const bots = [member('left'), member('kicked'), member('restricted', { is_member: false }), fakeTelegram({ getChatMember: () => tgError(400, 'Bad Request: user not found') })].map((tg) => fakeTelegramBot({ tg }));
    // #when
    const gates = await Promise.all(bots.map((b) => checkGate(b, TG_USER.id)));
    // #then
    expect({ gates, alerts: bots.flatMap((b) => b.alerts) }).toEqual({ gates: ['join', 'join', 'join', 'join'], alerts: [] });
  });

  it('asks every gate chat, and a member of any one gets in', async () => {
    // #given
    const tg = fakeTelegram({ getChatMember: (b) => tgOk({ status: b.chat_id === '-1001' ? 'member' : 'left' }) });
    const bot = fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, gateChats: ['@ccipdev', '-1001'] } });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, tg.calls.map((c) => c.body.chat_id)]).toEqual(['ok', ['@ccipdev', '-1001']]);
  });

  it('fails closed and alerts telegram-gate when no chat can be checked, as when the bot was removed from @ccipdev', async () => {
    // #given
    const bot = fakeTelegramBot({ tg: fakeTelegram({ getChatMember: () => tgError(403, 'Forbidden: bot is not a member of the channel chat') }) });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts.map((a) => a.signature), bot.alerts[0]?.text.includes('@ccipdev: Forbidden')]).toEqual(['join', ['telegram-gate'], true]);
  });

  it('turns away without an alert when one chat fails but another answers', async () => {
    // #given
    const tg = fakeTelegram({ getChatMember: (b) => (b.chat_id === '@ccipdev' ? tgError(0, 'request failed (TimeoutError)') : tgOk({ status: 'left' })) });
    const bot = fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, gateChats: ['@ccipdev', '-1001'] } });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts]).toEqual(['join', []]);
  });
});

describe('stamping a Telegram Marine', () => {
  it('stamps the card with the name and photo, and the web and Story cards with neither', async () => {
    // #given
    const renderer = fakeRenderer();
    const bot = fakeTelegramBot({ renderer, tg: fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: () => tgOk({ file_path: 'photos/mid.jpg' }) }, { 'photos/mid.jpg': JPEG }) });
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    const kept = await Promise.all(['cards/1.png', webCardKey(1), storyKey(1), 'avatars/1.png'].map(async (k) => (await env.MARINES.head(k))?.httpMetadata?.contentType));
    const publicCards = JSON.stringify([...renderer.webCards, ...renderer.stories]);
    expect({ kept, named: publicCards.includes('Ada') || publicCards.includes('avatar'), alerts: bot.alerts }).toEqual({ kept: Array(4).fill('image/png'), named: false, alerts: [] });
  });

  it('alerts telegram-stamp:<serial> once when a card fails, keeping what did render', async () => {
    // #given
    const bot = fakeTelegramBot({ renderer: fakeRenderer('renderMarineStory') });
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    expect({ alerts: bot.alerts.map((a) => a.signature), card: (await env.MARINES.head('cards/1.png')) !== null }).toEqual({ alerts: ['telegram-stamp:1'], card: true });
  });

  it('runs one stamp a minute per Marine, however often it is asked', async () => {
    // #given
    const t0 = new Date('2026-10-15T10:00:00.000Z');
    // #when
    const claims = [await claimStamp(env.DB, 1, t0), await claimStamp(env.DB, 1, new Date(t0.getTime() + 2_000)), await claimStamp(env.DB, 2, t0), await claimStamp(env.DB, 1, new Date(t0.getTime() + STAMP_CLAIM_MS))];
    // #then
    expect(claims).toEqual([true, false, true, true]);
  });
});

describe('the Mini App’s view of a Marine', () => {
  it('carries the draw and the sticker volume, never the name or the account', async () => {
    // #given
    const bot = fakeTelegramBot();
    const marine = await enlisted(bot);
    // #when
    const summary = marineSummary(bot, marine);
    // #then
    expect({ keys: Object.keys(summary).sort(), volume: summary.volume, leaks: JSON.stringify(summary).includes('Ada') || JSON.stringify(summary).includes(String(TG_USER.id)) }).toEqual({
      keys: ['callsign', 'cardReady', 'memes', 'percentile', 'serial', 'tags', 'tier', 'volume'],
      volume: 1,
      leaks: false,
    });
  });
});

```

Create `discord/test/story.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { publicRoute, storyKey } from '../src/public';
import { fakeRenderer, publicDeps, resetStorage, seedMarine } from './helpers';

const PRIVATE_NAME = 'Zed PRIVATE-NAME 991';
const get = (path: string) => new Request(`https://discord.ccip.dev${path}`);

beforeEach(resetStorage);

describe('/story/<serial>.png', () => {
  it('renders a Marine’s Story card once, keeps it in R2, and serves the copy after, to any site', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { tier: 'legendary' });
    const deps = publicDeps();
    // #when
    const first = (await publicRoute(get('/story/1.png'), deps))!;
    const second = (await publicRoute(get('/story/1.png'), deps))!;
    // #then
    expect([first.status, second.status, first.headers.get('content-type'), first.headers.get('access-control-allow-origin'), deps.renderer.calls.filter((c) => c === 'renderMarineStory').length, (await env.MARINES.head(storyKey(1)))?.httpMetadata?.contentType]).toEqual([
      200, 200, 'image/png', '*', 1, 'image/png',
    ]);
  });

  it('hands the renderer no name or avatar', async () => {
    // #given
    await seedMarine('999888777666555444', PRIVATE_NAME, 'painting-space-prophecy');
    const deps = publicDeps();
    // #when
    await publicRoute(get('/story/1.png'), deps);
    // #then
    expect([Object.keys(deps.renderer.stories[0]!).sort(), JSON.stringify(deps.renderer.stories[0]).includes(PRIVATE_NAME)]).toEqual([
      ['blood', 'callsign', 'enlistedAt', 'faith', 'memes', 'percentile', 'serial', 'tier'],
      false,
    ]);
  });

  it('answers 404 for an unknown or padded serial, and 503 when the card fails to render', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    // #when
    const answers = await Promise.all([publicRoute(get('/story/9.png'), publicDeps()), publicRoute(get('/story/01.png'), publicDeps()), publicRoute(get('/story/1.png'), publicDeps({ renderer: fakeRenderer('renderMarineStory') }))]);
    // #then
    expect(answers.map((r) => r!.status)).toEqual([404, 404, 503]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/telegram-marines.test.ts test/story.test.ts`
Expected: FAIL: `../src/telegram-marines` does not exist, and `/story/1.png` is not a public path yet (`publicRoute` answers null).

- [ ] **Step 3: Add the summary types, the settings, the public card, the Story route and the Telegram Marine.**

At the end of `packages/core/src/linkmarine.ts`, add:

```ts
/** What the Mini App is told of a Marine: never the name, the photo or the account. */
export interface MarineSummary {
  serial: number;
  callsign: string;
  tags: string[];
  tier: Tier;
  percentile: number;
  memes: { tag: string; file: string; count: number }[];
  /** The sticker pack volume the Marine's sticker is in, or will be. */
  volume: number;
  cardReady: boolean;
}

/** ok: a member of a gate chat, or already enlisted. join: not yet in one. */
export type Gate = 'ok' | 'join';
```

In `discord/src/env.ts`, replace:

```ts
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALERT_CHAT_ID?: string;
}
```

with:

```ts
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALERT_CHAT_ID?: string;
  /** "on" opens LinkMarines on Telegram; anything else keeps it shut. The deploy sets it from the TELEGRAM_BOT variable. */
  TELEGRAM_BOT?: string;
  /** The chats whose members may enlist, comma-separated: "@ccipdev", then LinkMarine group ids. */
  TELEGRAM_GATE_CHATS?: string;
  /** The owner's Telegram user id: owns the sticker packs, may run /id anywhere. */
  TELEGRAM_STICKER_OWNER_ID?: string;
}
```

In `discord/src/enlistment.ts`, replace:

```ts
import { hasGlint, type MarineCard } from '@ccip-dev/core/linkmarine';
```

with:

```ts
import { hasGlint, type MarineCard, type MarineWebCard } from '@ccip-dev/core/linkmarine';
```

In `discord/src/enlistment.ts`, replace:

```ts
/** The card to post, best first
```

with:

```ts
/** A Marine's card as the public sees it: the stamped name and avatar left out. */
export function publicCard(bot: Pick<Bot, 'snapshot'>, marine: Marine, pngs: Uint8Array[]): MarineWebCard {
  return {
    serial: marine.serial,
    callsign: marine.callsign,
    tier: marine.tier,
    percentile: marine.percentile,
    memes: marine.memes.map((m, i) => ({ tag: m.tag, count: m.count ?? snapshotCount(bot, m.tag), png: pngs[i]! })),
    blood: marine.blood,
    faith: marine.faith,
    enlistedAt: marine.enlistedAt,
  };
}

/** The card to post, best first
```

The web card's route becomes a builder that serves the Story card too:

In `discord/src/public.ts`, replace:

```ts
import type { MarineWebCard, Tier } from '@ccip-dev/core/linkmarine';
```

with:

```ts
import type { LinkMarineRenderer, MarineWebCard, Tier } from '@ccip-dev/core/linkmarine';
```

In `discord/src/public.ts`, replace:

```ts
 * The bot's public, read-only routes, which the site's /marines/ pages read: the roster, the meme images and the web
 * cards. Callsigns only. Every query names PUBLIC_COLUMNS, so a Discord name, avatar or id never leaves the bot.
```

with:

```ts
 * The bot's public, read-only routes, which the site's /marines/ pages and the Mini App read: the roster, the meme
 * images, the web cards and the Story cards. Callsigns only. Every query names PUBLIC_COLUMNS, so a name, an avatar or
 * an account id never leaves the bot.
```

In `discord/src/public.ts`, replace:

```ts
const WEB_PATH = /^\/web\/([^/]+)\.png$/;
const SERIAL = /^[1-9][0-9]{0,8}$/;

export const webCardKey = (serial: number) => `web/${serial}.png`;
```

with:

```ts
const WEB_PATH = /^\/web\/([^/]+)\.png$/;
const STORY_PATH = /^\/story\/([^/]+)\.png$/;
const SERIAL = /^[1-9][0-9]{0,8}$/;

export const webCardKey = (serial: number) => `web/${serial}.png`;
export const storyKey = (serial: number) => `story/${serial}.png`;
```

In `discord/src/public.ts`, replace:

```ts
/** A Marine's web card: from R2, else rendered once through the site (never with a name or avatar) and kept. */
async function webCardResponse(path: string, deps: PublicDeps): Promise<Response> {
  const digits = WEB_PATH.exec(path)![1]!;
  if (!SERIAL.test(digits)) return missing();
  const serial = Number(digits);
  const kept = await deps.bucket.get(webCardKey(serial));
  if (kept) return png(kept.body, `public, max-age=${WEB_MAX_AGE}`);
  const row = await deps.db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM marines WHERE serial = ?`).bind(serial).first<PublicRow>();
  if (!row) return missing();
  try {
    const stored = JSON.parse(row.memes) as MarineMeme[];
    await stockMemes(deps.bucket, deps.renderer, deps.fetch, deps.snapshot.archive, stored);
    const pngs = await loadMemes(deps.bucket, stored);
    if (!pngs) throw new Error('memes missing from storage right after copying');
    const marine = rosterMarine(row, deps.snapshot);
    const card: MarineWebCard = {
      serial,
      callsign: marine.callsign,
      tier: marine.tier,
      percentile: marine.percentile,
      memes: marine.memes.map((m, i) => ({ tag: m.tag, count: m.count, png: pngs[i]! })),
      blood: marine.blood,
      faith: marine.faith,
      enlistedAt: row.enlisted_at,
    };
    const bytes = await deps.renderer.renderMarineWebCard(card);
    await deps.bucket.put(webCardKey(serial), bytes, { httpMetadata: { contentType: 'image/png' } });
    return png(bytes, `public, max-age=${WEB_MAX_AGE}`);
  } catch (err) {
    console.error(`web card #${serial}: ${reason(err)}`);
    return unavailable('card');
  }
}
```

with:

```ts
/**
 * A public card of a Marine: from R2, else rendered once through the site from the public columns (never with a name or
 * avatar) and kept. The web card and the Story card are both served this way.
 */
function keptCard(path: RegExp, key: (serial: number) => string, what: string, draw: (renderer: LinkMarineRenderer, card: MarineWebCard) => Promise<Uint8Array>): Route {
  return async (requested, deps) => {
    const digits = path.exec(requested)![1]!;
    if (!SERIAL.test(digits)) return missing();
    const serial = Number(digits);
    const kept = await deps.bucket.get(key(serial));
    if (kept) return png(kept.body, `public, max-age=${WEB_MAX_AGE}`);
    const row = await deps.db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM marines WHERE serial = ?`).bind(serial).first<PublicRow>();
    if (!row) return missing();
    try {
      const stored = JSON.parse(row.memes) as MarineMeme[];
      await stockMemes(deps.bucket, deps.renderer, deps.fetch, deps.snapshot.archive, stored);
      const pngs = await loadMemes(deps.bucket, stored);
      if (!pngs) throw new Error('memes missing from storage right after copying');
      const marine = rosterMarine(row, deps.snapshot);
      const card: MarineWebCard = {
        serial,
        callsign: marine.callsign,
        tier: marine.tier,
        percentile: marine.percentile,
        memes: marine.memes.map((m, i) => ({ tag: m.tag, count: m.count, png: pngs[i]! })),
        blood: marine.blood,
        faith: marine.faith,
        enlistedAt: row.enlisted_at,
      };
      const bytes = await draw(deps.renderer, card);
      await deps.bucket.put(key(serial), bytes, { httpMetadata: { contentType: 'image/png' } });
      return png(bytes, `public, max-age=${WEB_MAX_AGE}`);
    } catch (err) {
      console.error(`${what} #${serial}: ${reason(err)}`);
      return unavailable('card');
    }
  };
}
```

In `discord/src/public.ts`, replace:

```ts
  [WEB_PATH, webCardResponse],
```

with:

```ts
  [WEB_PATH, keptCard(WEB_PATH, webCardKey, 'web card', (renderer, card) => renderer.renderMarineWebCard(card))],
  [STORY_PATH, keptCard(STORY_PATH, storyKey, 'Story card', (renderer, card) => renderer.renderMarineStory(card))],
```

Create `discord/src/telegram-marines.ts`:

```ts
import { stickerVolume, type Gate, type MarineSummary } from '@ccip-dev/core/linkmarine';
import { createBot, type Bot } from './bot';
import { avatarKey, publicCard, readBytes, reason, snapshotCount, stampCard, type Report } from './enlistment';
import type { Env } from './env';
import { loadMemes } from './memes';
import { storyKey, webCardKey } from './public';
import type { Marine } from './store';
import type { TelegramUser } from './telegram-auth';
import { telegramApi, type TelegramApi } from './telegram-api';

export const TELEGRAM_PLATFORM = 'telegram';

export interface TelegramSettings {
  /** TELEGRAM_BOT is "on". */
  open: boolean;
  /** TELEGRAM_GATE_CHATS: a member of any of them may enlist. */
  gateChats: string[];
  /** TELEGRAM_STICKER_OWNER_ID, or null while unset. */
  ownerId: number | null;
  botToken: string;
}

/** The bot as LinkMarines on Telegram uses it: the shared enlistment's dependencies, the Bot API and the settings. */
export interface TelegramBot extends Bot {
  tg: TelegramApi;
  settings: TelegramSettings;
}

export function telegramSettings(env: Env): TelegramSettings {
  const owner = Number(env.TELEGRAM_STICKER_OWNER_ID ?? '');
  return {
    open: env.TELEGRAM_BOT === 'on',
    gateChats: (env.TELEGRAM_GATE_CHATS ?? '').split(',').map((c) => c.trim()).filter((c) => c !== ''),
    ownerId: Number.isSafeInteger(owner) && owner > 0 ? owner : null,
    botToken: env.TELEGRAM_BOT_TOKEN ?? '',
  };
}

export function createTelegramBot(env: Env): TelegramBot {
  const bot = createBot(env);
  const settings = telegramSettings(env);
  return { ...bot, tg: telegramApi(settings.botToken, bot.fetch), settings };
}

/** The name stamped on a Telegram Marine's card: first and last name, else @username, else "Marine". */
export function telegramName(user: Pick<TelegramUser, 'first_name' | 'last_name' | 'username'>): string {
  const full = [user.first_name, user.last_name ?? ''].join(' ').trim();
  if (full !== '') return full;
  return user.username ? `@${user.username}` : 'Marine';
}

const PHOTO_TIMEOUT_MS = 5_000;
/** The largest profile photo size fetched: the card draws the avatar at 41 px, from a 240 px copy. */
const PHOTO_MAX_PX = 640;

interface PhotoSize {
  file_id: string;
  width: number;
}

/** The launch data's photo, when it is a JPEG on Telegram's own host (it can also be an SVG, which the card can't draw). */
function launchPhotoUrl(user: TelegramUser): string | null {
  try {
    const url = new URL(user.photo_url ?? '');
    return url.protocol === 'https:' && url.hostname === 't.me' && /\.jpe?g$/i.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

/** The user's profile photo bytes: the launch data's photo, else the newest profile photo up to 640 px. Null when hidden or missing. */
async function profilePhoto(bot: TelegramBot, user: TelegramUser): Promise<Uint8Array | null> {
  const fromLaunch = launchPhotoUrl(user);
  if (fromLaunch) {
    const res = await bot.fetch(fromLaunch, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
  }
  const photos = await bot.tg.call<{ photos: PhotoSize[][] }>('getUserProfilePhotos', { user_id: user.id, limit: 1 }, PHOTO_TIMEOUT_MS);
  const sizes = photos.ok ? (photos.result.photos[0] ?? []) : [];
  const fits = sizes.filter((s) => s.width <= PHOTO_MAX_PX);
  const best = fits.length > 0 ? fits.reduce((a, b) => (b.width > a.width ? b : a)) : sizes.reduce<PhotoSize | null>((a, b) => (a === null || b.width < a.width ? b : a), null);
  if (!best) return null;
  const file = await bot.tg.call<{ file_path?: string }>('getFile', { file_id: best.file_id }, PHOTO_TIMEOUT_MS);
  return file.ok && file.result.file_path ? bot.tg.download(file.result.file_path, PHOTO_TIMEOUT_MS) : null;
}

/**
 * The avatar to stamp: the profile photo as the 240 px PNG the site makes of a meme, kept in R2 as the Discord
 * avatars are; else the one kept before; else null, the gradient disc. Never rejects.
 */
export async function telegramAvatar(bot: TelegramBot, serial: number, user: TelegramUser): Promise<Uint8Array | null> {
  try {
    const photo = await profilePhoto(bot, user);
    if (photo) {
      const png = await bot.renderer.prepareMeme(photo);
      await bot.bucket.put(avatarKey(serial), png, { httpMetadata: { contentType: 'image/png' } });
      return png;
    }
    return await readBytes(bot.bucket, avatarKey(serial));
  } catch (err) {
    console.warn(`telegram avatar for Marine ${serial}: ${reason(err)}`);
    return null;
  }
}

/** A stamp runs at most once a minute per Marine, however often the Mini App asks for the card. */
export const STAMP_CLAIM_MS = 60_000;

/** Claims the Marine's stamp; false while another started less than a minute ago is still running. */
export async function claimStamp(db: D1Database, serial: number, now: Date): Promise<boolean> {
  const res = await db
    .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?3')
    .bind(`tg-stamp:${serial}`, now.toISOString(), new Date(now.getTime() - STAMP_CLAIM_MS).toISOString())
    .run();
  return res.meta.changes > 0;
}

/**
 * Stamps a Telegram Marine: the card with their name and photo (and the glint), then the public web card and the
 * Story card, which carry neither. Anything that fails is told to the alert chat as telegram-stamp:<serial>, once.
 */
export async function stampTelegram(bot: TelegramBot, marine: Marine, user: TelegramUser): Promise<void> {
  const reports: Report[] = [];
  await stampCard(bot, marine, () => telegramAvatar(bot, marine.serial, user), reports);
  try {
    const pngs = await loadMemes(bot.bucket, marine.memes);
    if (pngs) {
      const card = publicCard(bot, marine, pngs);
      const [web, story] = await Promise.all([bot.renderer.renderMarineWebCard(card), bot.renderer.renderMarineStory(card)]);
      await Promise.all([
        bot.bucket.put(webCardKey(marine.serial), web, { httpMetadata: { contentType: 'image/png' } }),
        bot.bucket.put(storyKey(marine.serial), story, { httpMetadata: { contentType: 'image/png' } }),
      ]);
    }
  } catch (err) {
    reports.push({ signature: 'telegram-stamp', text: `the web and Story cards failed: ${reason(err)}` });
  }
  if (reports.length > 0) await bot.alert(`telegram-stamp:${marine.serial}`, `Marine #${marine.serial}: ${reports.map((r) => r.text).join('; ')}`);
}

export function marineSummary(bot: Pick<Bot, 'snapshot'>, marine: Marine): MarineSummary {
  return {
    serial: marine.serial,
    callsign: marine.callsign,
    tags: marine.tags,
    tier: marine.tier,
    percentile: marine.percentile,
    memes: marine.memes.map((m) => ({ tag: m.tag, file: m.file, count: m.count ?? snapshotCount(bot, m.tag) })),
    volume: stickerVolume(marine.serial),
    cardReady: marine.cardKey !== null,
  };
}

const GATE_TIMEOUT_MS = 4_000;
const MEMBER = new Set(['creator', 'administrator', 'member']);
/** Telegram's answers for a user who is simply not in the chat: an answer, not a failure of the check. */
const NOT_IN_CHAT = /user not found|participant_id_invalid|member not found/i;

/**
 * Whether the user is in any gate chat. Every check runs at once. When none could be checked at all (the bot was
 * removed from the channel, a chat id is wrong, Telegram is down), the gate fails closed and alerts telegram-gate.
 */
export async function checkGate(bot: TelegramBot, userId: number): Promise<Gate> {
  const chats = bot.settings.gateChats;
  const answers = await Promise.all(chats.map((chat) => bot.tg.call<{ status: string; is_member?: boolean }>('getChatMember', { chat_id: chat, user_id: userId }, GATE_TIMEOUT_MS)));
  if (answers.some((a) => a.ok && (MEMBER.has(a.result.status) || (a.result.status === 'restricted' && a.result.is_member === true)))) return 'ok';
  const failures = answers.flatMap((a, i) => (!a.ok && !(a.status === 400 && NOT_IN_CHAT.test(a.description)) ? [`${chats[i]}: ${a.description}`] : []));
  if (failures.length === chats.length) await bot.alert('telegram-gate', `no gate chat could be checked, so nobody can enlist: ${failures.join('; ') || 'TELEGRAM_GATE_CHATS is empty'}`);
  return 'join';
}
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/telegram-marines.test.ts test/story.test.ts test/public.test.ts`
Expected: PASS (13, 3 and 23 tests: the web card's tests pass through the new builder unchanged).

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (211 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/linkmarine.ts discord/src/env.ts discord/src/enlistment.ts discord/src/public.ts discord/src/telegram-marines.ts discord/test/helpers.ts discord/test/telegram-marines.test.ts discord/test/story.test.ts
git commit -m "feat(discord): Telegram Marines' name, photo, gate and stamp, and the public Story card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Mini App API

`POST /tg/session`, `/tg/enlist` and `/tg/card` on the Discord Worker. Each takes `{ initData }` in a JSON body, answers `https://ccip.dev` only (and its preflight), and works for the user the verified launch data names, never another. `session` reports the switch, the Marine and the gate (an enlisted Marine skips it); `enlist` checks the gate, runs the shared core for `('telegram', user id)` and stamps after answering; `card` serves the requester's own card, or 202 while it stamps, starting at most one stamp a minute. While `TELEGRAM_BOT` is off, `session` says so and the others answer 409. The body cap moves out of `index.ts` so both platforms share it.

**Files:**
- Create: `discord/src/body.ts`, `discord/src/miniapp.ts`
- Modify: `packages/core/src/linkmarine.ts` (`SessionAnswer`, `EnlistAnswer`), `discord/src/index.ts` (the body cap moves to `body.ts`; `/tg/*` is routed), `discord/wrangler.toml` (`TELEGRAM_BOT`, `TELEGRAM_GATE_CHATS`, `TELEGRAM_STICKER_OWNER_ID`)
- Test: `discord/test/miniapp.test.ts`

**Interfaces:**
- Consumes: Task 4's `verifyLaunchData`, `type TelegramUser`; Task 5's `checkGate`, `claimStamp`, `marineSummary`, `stampTelegram`, `TELEGRAM_PLATFORM`, `telegramName`, `createTelegramBot`, `type TelegramBot`; Task 1's `enlistMarine`, `cardKey`, `readBytes`, `reason`; `store.ts`'s `findMarine`.
- Produces (core): `type SessionAnswer = { switch: 'off' } | { switch: 'on'; marine: MarineSummary | null; gate: Gate }`, `interface EnlistAnswer { already: boolean; marine: MarineSummary; banner: 'rare' | 'legendary' | null }`.
- Produces (`discord/src/body.ts`): `MAX_BODY_BYTES = 64 * 1024`, `cappedBody(request): Promise<string | null>` (moved from `index.ts`, unchanged).
- Produces (`discord/src/miniapp.ts`): `MINI_APP_ORIGIN = 'https://ccip.dev'`, `miniAppRoute(request, bot: TelegramBot, waitUntil): Promise<Response>`. The answers: `session` 200 `SessionAnswer`; `enlist` 200 `EnlistAnswer`, 403 `{ gate: 'join' }`, 409 `{ switch: 'off' }`, 503 `{ error: 'draw' }`; `card` 200 `image/png` or `image/gif` (`Cache-Control: private, no-store`), 202 `{ stamping: true }`, 404 `{ error: 'not enlisted' }`, 409 off; every route 400 for a body without `initData`, 401 `{ error: 'launch' }`, 405 for anything but POST and OPTIONS, 413 past 64 KB, 500 `{ error: 'internal' }` with the alert `telegram-api:<route>`.
- `discord/wrangler.toml` `[vars]`: `TELEGRAM_BOT = "off"`, `TELEGRAM_GATE_CHATS = "@ccipdev"`, `TELEGRAM_STICKER_OWNER_ID = ""` (the owner fills it, runbook).

- [ ] **Step 1: Write the failing test.**

Create `discord/test/miniapp.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { miniAppRoute } from '../src/miniapp';
import { fakeRenderer, fakeTelegram, fakeTelegramBot, GIF_BYTES, PNG_BYTES, resetStorage, signedLaunch, TG_SETTINGS, TG_USER, tgOk, type FakeTelegramBot } from './helpers';

const OTHER = { id: 888000222, first_name: 'Grace' };
const memberOf = (status: string) => fakeTelegram({ getChatMember: () => tgOk({ status }) });

/** The bot's fake clock in Unix seconds: launch data signed at it is fresh. */
const nowS = (bot: FakeTelegramBot) => Math.floor(bot.clock.ms / 1000);

async function ask(bot: FakeTelegramBot, path: string, user: Record<string, unknown> = TG_USER, extra: Record<string, unknown> = {}) {
  const work: Promise<unknown>[] = [];
  const initData = await signedLaunch(user, nowS(bot));
  const res = await miniAppRoute(new Request(`https://discord.ccip.dev${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://ccip.dev' }, body: JSON.stringify({ initData, ...extra }) }), bot, (p) => void work.push(p));
  await Promise.all(work);
  return res;
}

const body = async (res: Response): Promise<any> => res.json();

beforeEach(resetStorage);

describe('the Mini App API: requests', () => {
  it('answers a preflight from ccip.dev, and allows ccip.dev alone on every answer', async () => {
    // #given
    const bot = fakeTelegramBot();
    // #when
    const preflight = await miniAppRoute(new Request('https://discord.ccip.dev/tg/enlist', { method: 'OPTIONS', headers: { origin: 'https://ccip.dev' } }), bot, () => {});
    const answer = await ask(bot, '/tg/session');
    // #then
    expect([preflight.status, preflight.headers.get('access-control-allow-origin'), preflight.headers.get('access-control-allow-methods'), preflight.headers.get('access-control-allow-headers'), answer.headers.get('access-control-allow-origin')]).toEqual([
      204,
      'https://ccip.dev',
      'POST, OPTIONS',
      'content-type',
      'https://ccip.dev',
    ]);
  });

  it('refuses missing, stale and tampered launch data with 401, a body without it with 400, and a GET with 405', async () => {
    // #given
    const bot = fakeTelegramBot();
    const stale = await signedLaunch(TG_USER, nowS(bot) - 86_401);
    const tampered = new URLSearchParams(await signedLaunch(TG_USER, nowS(bot)));
    tampered.set('user', JSON.stringify(OTHER));
    const post = (body: string) => miniAppRoute(new Request('https://discord.ccip.dev/tg/session', { method: 'POST', body }), bot, () => {});
    // #when
    const answers = await Promise.all([
      post(JSON.stringify({ initData: '' })),
      post(JSON.stringify({ initData: stale })),
      post(JSON.stringify({ initData: tampered.toString() })),
      post('not json'),
      post(JSON.stringify({})),
      miniAppRoute(new Request('https://discord.ccip.dev/tg/session'), bot, () => {}),
      miniAppRoute(new Request('https://discord.ccip.dev/tg/other', { method: 'POST' }), bot, () => {}),
    ]);
    // #then
    expect(answers.map((r) => r.status)).toEqual([401, 401, 401, 400, 400, 405, 404]);
  });

  it('is reached through the Worker at /tg/, which keeps it shut while TELEGRAM_BOT is off', async () => {
    // #given the test config, whose TELEGRAM_BOT is "off"
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const initData = await signedLaunch(TG_USER, Math.floor(Date.now() / 1000), 'test-token');
    // #when
    const res = await worker.fetch(new Request('https://discord.ccip.dev/tg/session', { method: 'POST', body: JSON.stringify({ initData }) }) as Parameters<typeof worker.fetch>[0], { ...env, TELEGRAM_BOT_TOKEN: 'test-token' }, ctx);
    // #then
    expect([res.status, await res.json()]).toEqual([200, { switch: 'off' }]);
  });
});

describe('the Mini App API: /tg/session', () => {
  it('says only that it is off while the switch is off', async () => {
    // #when
    const res = await ask(fakeTelegramBot({ settings: { ...TG_SETTINGS, open: false } }), '/tg/session');
    // #then
    expect(await body(res)).toEqual({ switch: 'off' });
  });

  it('checks the gate for someone not yet enlisted', async () => {
    // #when
    const [inside, outside] = await Promise.all([ask(fakeTelegramBot({ tg: memberOf('member') }), '/tg/session'), ask(fakeTelegramBot({ tg: memberOf('left') }), '/tg/session')]);
    // #then
    expect([await body(inside), await body(outside)]).toEqual([
      { switch: 'on', marine: null, gate: 'ok' },
      { switch: 'on', marine: null, gate: 'join' },
    ]);
  });

  it('lets an enlisted Marine skip the gate, even one who has since left @ccipdev', async () => {
    // #given
    await ask(fakeTelegramBot({ tg: memberOf('member') }), '/tg/enlist');
    const tg = memberOf('left');
    // #when
    const res = await ask(fakeTelegramBot({ tg }), '/tg/session');
    // #then
    const answer = await body(res);
    expect([answer.gate, answer.marine.serial, tg.calls.length]).toEqual(['ok', 1, 0]);
  });
});

describe('the Mini App API: /tg/enlist', () => {
  it('draws, answers the Marine with its banner, and stamps the card, web card and Story card after answering', async () => {
    // #given every draw is Legendary
    const bot = fakeTelegramBot({ tg: memberOf('member') });
    bot.snapshot = { ...bot.snapshot, cutoffs: { uncommon: 0, rare: 0, legendary: 0 } };
    // #when
    const answer = await body(await ask(bot, '/tg/enlist'));
    // #then
    const kept = await Promise.all(['cards/1.png', 'cards/1.gif', 'web/1.png', 'story/1.png'].map(async (k) => (await env.MARINES.head(k)) !== null));
    expect({ already: answer.already, banner: answer.banner, serial: answer.marine.serial, tier: answer.marine.tier, volume: answer.marine.volume, kept }).toEqual({
      already: false,
      banner: 'legendary',
      serial: 1,
      tier: 'legendary',
      volume: 1,
      kept: [true, true, true, true],
    });
  });

  it('answers an enlisted Marine with their own Marine, drawing nothing and checking no gate', async () => {
    // #given
    const first = await body(await ask(fakeTelegramBot({ tg: memberOf('member') }), '/tg/enlist'));
    const tg = memberOf('member');
    // #when
    const again = await body(await ask(fakeTelegramBot({ tg }), '/tg/enlist'));
    // #then
    expect([again.already, again.banner, again.marine.callsign, tg.calls.length]).toEqual([true, null, first.marine.callsign, 0]);
  });

  it('refuses someone outside the gate chats with 403, taking no serial', async () => {
    // #when
    const res = await ask(fakeTelegramBot({ tg: memberOf('left') }), '/tg/enlist');
    // #then
    expect([res.status, await body(res), (await env.DB.prepare('SELECT COUNT(*) AS n FROM marines').first<{ n: number }>())?.n]).toEqual([403, { gate: 'join' }, 0]);
  });

  it('refuses with 409 while the switch is off', async () => {
    // #when
    const res = await ask(fakeTelegramBot({ settings: { ...TG_SETTINGS, open: false } }), '/tg/enlist');
    // #then
    expect([res.status, await body(res)]).toEqual([409, { switch: 'off' }]);
  });

  it('stamps the Telegram name, never the Discord one of an account with the same id', async () => {
    // #given
    const renderer = fakeRenderer();
    const drawn: string[] = [];
    const bot = fakeTelegramBot({
      tg: memberOf('member'),
      renderer: { ...renderer, renderMarineCards: async (c) => (drawn.push(c.name), renderer.renderMarineCards(c)) },
    });
    // #when
    await ask(bot, '/tg/enlist', { id: TG_USER.id, first_name: '', username: 'ada' });
    // #then
    expect(drawn).toEqual(['@ada']);
  });
});

describe('the Mini App API: /tg/card', () => {
  it("serves the requester's own card, privately, the glint for Rare and up", async () => {
    // #given
    const bot = fakeTelegramBot({ tg: memberOf('member') });
    bot.snapshot = { ...bot.snapshot, cutoffs: { uncommon: 0, rare: 0, legendary: 0 } };
    await ask(bot, '/tg/enlist');
    // #when
    const res = await ask(bot, '/tg/card');
    // #then
    expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control'), [...new Uint8Array(await res.arrayBuffer())]]).toEqual([200, 'image/gif', 'private, no-store', [...GIF_BYTES]]);
  });

  it('answers 202 while the card is stamping, starting one stamp however often it is asked', async () => {
    // #given a Marine whose stamp failed at enlistment
    const failing = fakeTelegramBot({ tg: memberOf('member'), renderer: fakeRenderer('renderMarineCard') });
    await ask(failing, '/tg/enlist');
    const renderer = fakeRenderer();
    const bot = fakeTelegramBot({ renderer });
    bot.clock.ms += 61_000;
    // #when the app polls twice
    const [first, second] = [await ask(bot, '/tg/card'), await ask(bot, '/tg/card')];
    // #then the first poll started a stamp, which has finished by the second
    expect([first.status, second.status, second.headers.get('content-type'), renderer.calls.filter((c) => c === 'renderMarineCards').length]).toEqual([202, 200, 'image/png', 1]);
  });

  it('answers 404 to someone not enlisted, whatever Marine the body names', async () => {
    // #given a Marine, and another user asking for it by serial
    await ask(fakeTelegramBot({ tg: memberOf('member') }), '/tg/enlist');
    // #when
    const res = await ask(fakeTelegramBot(), '/tg/card', OTHER, { serial: 1 });
    // #then
    expect([res.status, await body(res)]).toEqual([404, { error: 'not enlisted' }]);
  });

  it('serves the static card to a Common Marine', async () => {
    // #given
    const bot = fakeTelegramBot({ tg: memberOf('member') });
    bot.snapshot = { ...bot.snapshot, cutoffs: { uncommon: 99, rare: 99, legendary: 99 } };
    await ask(bot, '/tg/enlist');
    // #when
    const res = await ask(bot, '/tg/card');
    // #then
    expect([res.status, res.headers.get('content-type'), [...new Uint8Array(await res.arrayBuffer())]]).toEqual([200, 'image/png', [...PNG_BYTES]]);
  });
});

describe('the Mini App API: failures', () => {
  it('answers 500 and alerts telegram-api:<route> when the database fails, without the launch data', async () => {
    // #given
    const bot = fakeTelegramBot({ db: { prepare: () => { throw new Error('D1 is down'); } } as unknown as D1Database });
    // #when
    const res = await ask(bot, '/tg/session');
    // #then
    expect([res.status, bot.alerts.map((a) => a.signature), bot.alerts.some((a) => a.text.includes('hash='))]).toEqual([500, ['telegram-api:session'], false]);
  });
});

```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/miniapp.test.ts`
Expected: FAIL: `../src/miniapp` does not exist.

- [ ] **Step 3: Add the answers' types, move the body cap, and add the API.**

At the end of `packages/core/src/linkmarine.ts`, add:

```ts
/** POST /tg/session. */
export type SessionAnswer = { switch: 'off' } | { switch: 'on'; marine: MarineSummary | null; gate: Gate };
/** POST /tg/enlist, when it enlists or finds the Marine. */
export interface EnlistAnswer {
  already: boolean;
  marine: MarineSummary;
  banner: 'rare' | 'legendary' | null;
}
```

Create `discord/src/body.ts`:

```ts
/** Discord's interactions and Telegram's updates and launch data run to a few KB: a body past this is refused before it is checked. */
export const MAX_BODY_BYTES = 64 * 1024;

/** The body as text, or null past MAX_BODY_BYTES, whether its Content-Length says so or its bytes do. */
export async function cappedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
```

In `discord/src/index.ts`, replace:

```ts
/** Discord's interactions run to a few KB: a body past this is refused before its signature is checked. */
export const MAX_BODY_BYTES = 64 * 1024;

/** The body as text, or null past MAX_BODY_BYTES, whether its Content-Length says so or its bytes do. */
async function cappedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** A verified body as an interaction; null when it is not a JSON object. */
```

with:

```ts
/** A verified body as an interaction; null when it is not a JSON object. */
```

In `discord/src/index.ts`, replace:

```ts
import { createBot, SNAPSHOT, type Bot } from './bot';
```

with:

```ts
import { createBot, SNAPSHOT, type Bot } from './bot';
import { cappedBody } from './body';
```

Create `discord/src/miniapp.ts`:

```ts
import { hasGlint, type EnlistAnswer, type SessionAnswer, type Tier } from '@ccip-dev/core/linkmarine';
import { cappedBody } from './body';
import { cardKey, enlistMarine, readBytes, reason } from './enlistment';
import { findMarine, type Marine } from './store';
import { verifyLaunchData, type TelegramUser } from './telegram-auth';
import { checkGate, claimStamp, marineSummary, stampTelegram, TELEGRAM_PLATFORM, telegramName, type TelegramBot } from './telegram-marines';

/**
 * The Mini App's API on discord.ccip.dev: POST /tg/session, /tg/enlist and /tg/card. Each request carries Telegram's
 * launch data in its body, never in a URL; the user is the one the verified launch data names, and no route takes any
 * other. Only https://ccip.dev may call it from a browser.
 */
export const MINI_APP_ORIGIN = 'https://ccip.dev';

const CORS = { 'Access-Control-Allow-Origin': MINI_APP_ORIGIN, Vary: 'Origin' } as const;
const PREFLIGHT = { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' } as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const OFF = () => json({ switch: 'off' }, 409);
const banner = (tier: Tier): EnlistAnswer['banner'] => (tier === 'rare' || tier === 'legendary' ? tier : null);

type Waiter = (work: Promise<unknown>) => void;

/** Stamps the Marine in the background unless a stamp started within the last minute. */
async function stampLater(bot: TelegramBot, marine: Marine, user: TelegramUser, waitUntil: Waiter): Promise<void> {
  if (await claimStamp(bot.db, marine.serial, bot.now())) waitUntil(stampTelegram(bot, marine, user));
}

async function session(bot: TelegramBot, user: TelegramUser): Promise<Response> {
  if (!bot.settings.open) return json({ switch: 'off' } satisfies SessionAnswer);
  const marine = await findMarine(bot.db, TELEGRAM_PLATFORM, String(user.id));
  if (marine) return json({ switch: 'on', marine: marineSummary(bot, marine), gate: 'ok' } satisfies SessionAnswer);
  return json({ switch: 'on', marine: null, gate: await checkGate(bot, user.id) } satisfies SessionAnswer);
}

async function enlist(bot: TelegramBot, user: TelegramUser, waitUntil: Waiter): Promise<Response> {
  if (!bot.settings.open) return OFF();
  const existing = await findMarine(bot.db, TELEGRAM_PLATFORM, String(user.id));
  if (existing) {
    if (existing.cardKey === null) await stampLater(bot, existing, user, waitUntil);
    return json({ already: true, marine: marineSummary(bot, existing), banner: null } satisfies EnlistAnswer);
  }
  if ((await checkGate(bot, user.id)) === 'join') return json({ gate: 'join' }, 403);
  const result = await enlistMarine(bot, { platform: TELEGRAM_PLATFORM, userId: String(user.id), displayName: telegramName(user) });
  if (result.kind === 'clashed') {
    await bot.alert('telegram-api:enlist', 'every one of 20 draws for a Telegram recruit clashed with a callsign already taken');
    return json({ error: 'draw' }, 503);
  }
  if (result.marine.cardKey === null) await stampLater(bot, result.marine, user, waitUntil);
  const already = result.kind === 'already';
  return json({ already, marine: marineSummary(bot, result.marine), banner: already ? null : banner(result.marine.tier) } satisfies EnlistAnswer);
}

/** The requester's own card, the glint for Rare and up; 202 while it is being stamped. */
async function card(bot: TelegramBot, user: TelegramUser, waitUntil: Waiter): Promise<Response> {
  if (!bot.settings.open) return OFF();
  const marine = await findMarine(bot.db, TELEGRAM_PLATFORM, String(user.id));
  if (!marine) return json({ error: 'not enlisted' }, 404);
  if (marine.cardKey) {
    const gif = hasGlint(marine.tier) ? await readBytes(bot.bucket, cardKey(marine.serial, 'gif')) : null;
    const image = gif ?? (await readBytes(bot.bucket, marine.cardKey));
    if (image) return new Response(image, { headers: { ...CORS, 'Content-Type': gif ? 'image/gif' : 'image/png', 'Cache-Control': 'private, no-store' } });
  }
  await stampLater(bot, marine, user, waitUntil);
  return json({ stamping: true }, 202);
}

const ROUTES: Record<string, (bot: TelegramBot, user: TelegramUser, waitUntil: Waiter) => Promise<Response>> = {
  '/tg/session': (bot, user) => session(bot, user),
  '/tg/enlist': enlist,
  '/tg/card': card,
};

async function launchUser(request: Request, bot: TelegramBot): Promise<TelegramUser | Response> {
  const body = await cappedBody(request);
  if (body === null) return json({ error: 'too large' }, 413);
  let initData: unknown;
  try {
    initData = (JSON.parse(body) as { initData?: unknown }).initData;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (typeof initData !== 'string') return json({ error: 'bad request' }, 400);
  const launch = await verifyLaunchData(initData, bot.settings.botToken, bot.now().getTime());
  return launch ? launch.user : json({ error: 'launch' }, 401);
}

/** Answers a request under /tg/. A failure nobody expected answers 500 and alerts telegram-api:<route>; the launch data is never logged. */
export async function miniAppRoute(request: Request, bot: TelegramBot, waitUntil: Waiter): Promise<Response> {
  const path = new URL(request.url).pathname;
  const route = ROUTES[path];
  if (!route) return new Response('Not found', { status: 404, headers: CORS });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PREFLIGHT });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
  try {
    const user = await launchUser(request, bot);
    if (user instanceof Response) return user;
    return await route(bot, user, waitUntil);
  } catch (err) {
    const name = path.slice('/tg/'.length);
    console.error(`/tg/${name} failed: ${reason(err)}`);
    await bot.alert(`telegram-api:${name}`, `/tg/${name} failed: ${reason(err)}`);
    return json({ error: 'internal' }, 500);
  }
}
```

Route `/tg/*` to it:

In `discord/src/index.ts`, replace:

```ts
import { dogtagCommand, enlistCommand, replyBudget, TEXT } from './marines';
import { publicRoute, type PublicDeps } from './public';
```

with:

```ts
import { dogtagCommand, enlistCommand, replyBudget, TEXT } from './marines';
import { miniAppRoute } from './miniapp';
import { publicRoute, type PublicDeps } from './public';
import { createTelegramBot } from './telegram-marines';
```

In `discord/src/index.ts`, replace:

```ts
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname !== '/interactions') return (await publicRoute(request, publicDeps(env, ctx))) ?? new Response('Not found', { status: 404 });
```

with:

```ts
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/tg/')) return miniAppRoute(request, createTelegramBot(env), (work) => ctx.waitUntil(work));
    if (path !== '/interactions') return (await publicRoute(request, publicDeps(env, ctx))) ?? new Response('Not found', { status: 404 });
```

In `discord/wrangler.toml`, replace:

```toml
[vars]
DISCORD_SERVERS = "all"
```

with:

```toml
[vars]
DISCORD_SERVERS = "all"
# LinkMarines on Telegram (docs/runbook.md, "LinkMarines on Telegram"). The deploy sets TELEGRAM_BOT from the GitHub variable.
TELEGRAM_BOT = "off"
TELEGRAM_GATE_CHATS = "@ccipdev"
TELEGRAM_STICKER_OWNER_ID = ""
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/miniapp.test.ts test/index.test.ts`
Expected: PASS (16 and 15 tests; the 413 test still passes through `body.ts`).

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (227 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/linkmarine.ts discord/src/body.ts discord/src/miniapp.ts discord/src/index.ts discord/wrangler.toml discord/test/miniapp.test.ts
git commit -m "feat(discord): the Mini App API, /tg/session, /tg/enlist and /tg/card, behind TELEGRAM_BOT" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The sticker job

Every Marine, from either platform, becomes a sticker in their volume's pack. A `*/10` cron runs `stickerJob`: under a run lock, it settles a Marine a cut-short run left marked, then takes up to ten Marines without a sticker, oldest first. Each sticker is drawn by `renderMarineSticker`, uploaded with `uploadStickerFile` as the owner, and added with `createNewStickerSet` for a volume's first sticker (Vol. 1 included; see "Decisions") or `addStickerToSet`, the Marine marked before and recorded after. A 429 ends the run; any other failure alerts `telegram-sticker:<serial>` and the run goes on, unless a Marine is left marked. A Telegram Marine hears about their sticker. Once the switch is on, Discord's posted card names the pack. The migration only adds the two columns.

**Files:**
- Create: `discord/migrations/0002_stickers.sql`, `discord/src/stickers.ts`
- Modify: `discord/src/store.ts` (`stickerQueue`), `discord/src/bot.ts` (`telegramOpen`), `discord/src/marines.ts` (`cardText`), `discord/src/index.ts` (`scheduled`), `discord/wrangler.toml` (`[triggers]`), `discord/test/helpers.ts` (`telegramOpen: false`)
- Test: `discord/test/stickers.test.ts`, `discord/test/sticker-line.test.ts`, `discord/test/cron.test.ts`

**Interfaces:**
- Consumes: Task 2's `renderMarineSticker`; Task 4's `stickerVolume`, `stickerPackName`, `stickerPackTitle`, `stickerPackUrl`, `type TelegramResult`; Task 5's `publicCard`, `TELEGRAM_PLATFORM`, `createTelegramBot`, `type TelegramBot`; `memes.ts`'s `stockMemes`, `loadMemes`.
- Produces:
  - `marines.sticker_set TEXT`, `marines.sticker_file_id TEXT` (both NULL until the job records the sticker).
  - `store.ts`: `stickerQueue(db, limit): Promise<{ marine: Marine; set: string | null }[]>`.
  - `stickers.ts`: `STICKERS_PER_RUN = 10`, `STICKER_EMOJI = '🎖'`, `stickerJob(bot: TelegramBot): Promise<void>`.
  - `bot.ts`: `Bot.telegramOpen: boolean` (`TELEGRAM_BOT === 'on'`).
  - `marines.ts`: `cardText(bot: Pick<Bot, 'telegramOpen'>, marine: Pick<Marine, 'callsign' | 'serial'>): string`.
  - `index.ts`: the default export's `scheduled`, on `[triggers] crons = ["*/10 * * * *"]`.
  - `meta` keys: `sticker-run` (the run lock, 15 minutes).

- [ ] **Step 1: Write the failing tests.**

Create `discord/test/stickers.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { STICKERS_PER_RUN, stickerJob } from '../src/stickers';
import type { TelegramResult } from '../src/telegram-api';
import { fakeRenderer, fakeTelegram, fakeTelegramBot, OWNER_ID, resetStorage, seedMarine, TG_SETTINGS, tgError, tgOk } from './helpers';

/**
 * Telegram's sticker packs, held in memory: uploads get file ids, packs hold their stickers in order. `fail` answers a
 * method from a table first, by call count, so a test can fail the nth call.
 */
function packs(fail: Record<string, (n: number) => TelegramResult<unknown> | null> = {}) {
  const sets = new Map<string, string[]>();
  const counts: Record<string, number> = {};
  let uploads = 0;
  const failing = (method: string) => fail[method]?.((counts[method] = (counts[method] ?? 0) + 1)) ?? null;
  const tg = fakeTelegram({
    uploadStickerFile: () => failing('uploadStickerFile') ?? tgOk({ file_id: `up${++uploads}` }),
    createNewStickerSet: (b) => {
      const name = String(b.name);
      if (sets.has(name)) return tgError(400, 'Bad Request: sticker set name is already occupied');
      const failed = failing('createNewStickerSet');
      if (failed) return failed;
      sets.set(name, [`in-${(b.stickers as { sticker: string }[])[0]!.sticker}`]);
      return tgOk(true);
    },
    addStickerToSet: (b) => {
      const failed = failing('addStickerToSet');
      if (failed && !(failed.ok === false && failed.status === 0 && failed.description === 'lost')) return failed;
      sets.get(String(b.name))!.push(`in-${(b.sticker as { sticker: string }).sticker}`);
      return failed ?? tgOk(true);
    },
    getStickerSet: (b) => failing('getStickerSet') ?? (sets.has(String(b.name)) ? tgOk({ stickers: sets.get(String(b.name))!.map((file_id) => ({ file_id })) }) : tgError(400, 'Bad Request: STICKERSET_INVALID')),
  });
  return { tg, sets };
}

const LOST = tgError(0, 'lost');

async function stickers(): Promise<[number, string | null, string | null][]> {
  const { results } = await env.DB.prepare('SELECT serial, sticker_set, sticker_file_id FROM marines ORDER BY serial').all<{ serial: number; sticker_set: string | null; sticker_file_id: string | null }>();
  return results.map((r) => [r.serial, r.sticker_set, r.sticker_file_id]);
}

const CALLSIGNS = ['sergey-pepe-comfy', 'painting-space-prophecy', 'sergey-painting-space'];
const MEMES = JSON.stringify([
  { tag: 'sergey', file: 's1.jpeg', key: 'memes/s1.jpeg.png' },
  { tag: 'pepe', file: 'p1.jpeg', key: 'memes/p1.jpeg.png' },
  { tag: 'comfy', file: 'c1.png', key: 'memes/c1.png.png' },
]);

/** A Marine straight into D1, its callsign its own tag key, so any number of them can be enlisted. */
async function insertMarine(platform: string, userId: string, callsign: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO marines (platform, user_id, callsign, tag_key, tags, tier, score, percentile, memes, blood, faith, display_name, snapshot_version, enlisted_at)
     VALUES (?1, ?2, ?3, ?3, '["sergey","pepe","comfy"]', 'common', 15, 40, ?4, 'LINK+', '4IR', 'Ada', 3, '2026-10-13T10:40:00.000Z')`,
  )
    .bind(platform, userId, callsign, MEMES)
    .run();
}

beforeEach(resetStorage);

describe('the sticker job', () => {
  it('creates Vol. 1 with the first sticker, as the owner, then adds the next, recording each', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    await seedMarine('b', 'rory', CALLSIGNS[1]!);
    const { tg, sets } = packs();
    // #when
    await stickerJob(fakeTelegramBot({ tg }));
    // #then
    const create = tg.calls.find((c) => c.method === 'createNewStickerSet')!.body;
    expect({
      create: [create.user_id, create.name, create.title, create.stickers],
      added: tg.calls.filter((c) => c.method === 'addStickerToSet').map((c) => c.body.name),
      pack: sets.get('linkmarines_by_ccipdevbot'),
      recorded: await stickers(),
    }).toEqual({
      create: [OWNER_ID, 'linkmarines_by_ccipdevbot', 'LinkMarines Vol. 1 · ccip.dev', [{ sticker: 'up1', format: 'static', emoji_list: ['🎖'] }]],
      added: ['linkmarines_by_ccipdevbot'],
      pack: ['in-up1', 'in-up2'],
      recorded: [
        [1, 'linkmarines_by_ccipdevbot', 'in-up1'],
        [2, 'linkmarines_by_ccipdevbot', 'in-up2'],
      ],
    });
  });

  it('starts Vol. 2 at serial 121', async () => {
    // #given the next Marine is #121
    await env.DB.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('marines', 120)").run();
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const { tg, sets } = packs();
    // #when
    await stickerJob(fakeTelegramBot({ tg }));
    // #then
    expect([[...sets.keys()], await stickers()]).toEqual([['linkmarines2_by_ccipdevbot'], [[121, 'linkmarines2_by_ccipdevbot', 'in-up1']]]);
  });

  it('never adds a sticker twice', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const { tg } = packs();
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    await stickerJob(bot);
    // #then
    expect(tg.calls.filter((c) => c.method === 'uploadStickerFile').length).toBe(1);
  });

  it('settles a sticker whose answer was lost from the pack itself on the next run, adding nothing again', async () => {
    // #given the add reaches Telegram, but its answer is lost
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    await seedMarine('b', 'rory', CALLSIGNS[1]!);
    const { tg, sets } = packs({ addStickerToSet: (n) => (n === 1 ? LOST : null) });
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    const afterFirst = await stickers();
    await stickerJob(bot);
    // #then
    expect({ afterFirst, after: await stickers(), pack: sets.get('linkmarines_by_ccipdevbot'), alerts: bot.alerts.map((a) => a.signature) }).toEqual({
      afterFirst: [
        [1, 'linkmarines_by_ccipdevbot', 'in-up1'],
        [2, 'linkmarines_by_ccipdevbot', null],
      ],
      after: [
        [1, 'linkmarines_by_ccipdevbot', 'in-up1'],
        [2, 'linkmarines_by_ccipdevbot', 'in-up2'],
      ],
      pack: ['in-up1', 'in-up2'],
      alerts: ['telegram-sticker:2'],
    });
  });

  it('makes a Marine due again when a lost add never reached the pack', async () => {
    // #given an add whose answer is lost before Telegram acts
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    await seedMarine('b', 'rory', CALLSIGNS[1]!);
    const { tg, sets } = packs({ addStickerToSet: (n) => (n === 1 ? tgError(0, 'request failed (TimeoutError)') : null) });
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    await stickerJob(bot);
    await stickerJob(bot);
    // #then
    expect([await stickers(), sets.get('linkmarines_by_ccipdevbot')]).toEqual([
      [
        [1, 'linkmarines_by_ccipdevbot', 'in-up1'],
        [2, 'linkmarines_by_ccipdevbot', 'in-up3'],
      ],
      ['in-up1', 'in-up3'],
    ]);
  });

  it('leaves a Marine who enlists during a run for the next run, after the ones already queued', async () => {
    // #given two Marines, and a third who enlists while the first sticker is drawn
    await insertMarine('discord', 'u1', 'marine-1');
    await insertMarine('discord', 'u2', 'marine-2');
    const { tg, sets } = packs();
    const renderer = fakeRenderer();
    let enlisted = false;
    const bot = fakeTelegramBot({
      tg,
      renderer: {
        ...renderer,
        renderMarineSticker: async (card) => {
          if (!enlisted) await insertMarine('telegram', '777000111', 'marine-3');
          enlisted = true;
          return renderer.renderMarineSticker(card);
        },
      },
    });
    // #when
    await stickerJob(bot);
    const firstRun = (await stickers()).map((s) => s[2]);
    await stickerJob(bot);
    // #then
    expect([firstRun, sets.get('linkmarines_by_ccipdevbot')]).toEqual([['in-up1', 'in-up2', null], ['in-up1', 'in-up2', 'in-up3']]);
  });

  it('stops the run at a 429, quietly, for the next run to go on', async () => {
    // #given
    for (const [i, c] of CALLSIGNS.slice(0, 3).entries()) await seedMarine(`m${i}`, 'x', c);
    const { tg } = packs({ uploadStickerFile: (n) => (n === 2 ? tgError(429, 'Too Many Requests: retry after 30', 30) : null) });
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    // #then
    expect({ uploads: tg.calls.filter((c) => c.method === 'uploadStickerFile').length, recorded: (await stickers()).map((s) => s[2] !== null), alerts: bot.alerts }).toEqual({
      uploads: 2,
      recorded: [true, false, false],
      alerts: [],
    });
  });

  it('alerts telegram-sticker:<serial> on any other failure, and goes on with the next Marine', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    await seedMarine('b', 'rory', CALLSIGNS[1]!);
    const { tg } = packs({ createNewStickerSet: (n) => (n === 1 ? tgError(400, 'Bad Request: STICKER_PNG_DIMENSIONS') : null) });
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    // #then
    expect({ alerts: bot.alerts.map((a) => [a.signature, a.text.includes('STICKER_PNG_DIMENSIONS')]), recorded: await stickers() }).toEqual({
      alerts: [['telegram-sticker:1', true]],
      recorded: [
        [1, null, null],
        [2, 'linkmarines_by_ccipdevbot', 'in-up2'],
      ],
    });
  });

  it('alerts and goes on when a sticker cannot be drawn', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const bot = fakeTelegramBot({ tg: packs().tg, renderer: fakeRenderer('renderMarineSticker') });
    // #when
    await stickerJob(bot);
    // #then
    expect([bot.alerts.map((a) => a.signature), await stickers()]).toEqual([['telegram-sticker:1'], [[1, null, null]]]);
  });

  it(`backfills oldest first, ${STICKERS_PER_RUN} a run`, async () => {
    // #given twelve Marines
    for (let i = 1; i <= 12; i++) await insertMarine('discord', `u${i}`, `marine-${i}`);
    const { tg } = packs();
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    const firstRun = (await stickers()).filter((s) => s[2] !== null).map((s) => s[0]);
    await stickerJob(bot);
    // #then
    expect([firstRun, (await stickers()).filter((s) => s[2] !== null).length]).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 12]);
  });

  it('tells a Telegram Marine their sticker number, with the sticker and the pack, and tells a Discord Marine nothing', async () => {
    // #given a Discord Marine, then a Telegram one
    await insertMarine('discord', 'a', 'marine-1');
    await insertMarine('telegram', '777000111', 'marine-2');
    const { tg } = packs();
    // #when
    await stickerJob(fakeTelegramBot({ tg }));
    // #then
    expect(tg.calls.filter((c) => c.method.startsWith('send')).map((c) => [c.method, c.body.chat_id, c.body.text ?? c.body.sticker, c.body.reply_markup])).toEqual([
      ['sendMessage', '777000111', "You're sticker #2 in LinkMarines Vol. 1", undefined],
      ['sendSticker', '777000111', 'in-up2', { inline_keyboard: [[{ text: 'Add the pack', url: 'https://t.me/addstickers/linkmarines_by_ccipdevbot' }]] }],
    ]);
  });

  it('does nothing while LinkMarines on Telegram is off or has no sticker owner, or while another run holds the lock', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const { tg } = packs();
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('sticker-run', '2026-10-13T10:39:00.000Z')").run();
    // #when
    await stickerJob(fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, open: false } }));
    await stickerJob(fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, ownerId: null } }));
    await stickerJob(fakeTelegramBot({ tg }));
    // #then
    expect(tg.calls).toEqual([]);
  });
});
```

Create `discord/test/sticker-line.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { cardText, dogtagCommand, enlistCommand } from '../src/marines';
import { command, fakeBot, resetStorage } from './helpers';

beforeEach(resetStorage);

describe('the sticker pack on a posted Discord card', () => {
  it('names the Marine’s pack under the callsign once LinkMarines is on Telegram, with no preview', async () => {
    // #given
    const bot = fakeBot({ telegramOpen: true });
    // #when
    await enlistCommand(bot, command('enlist'));
    await dogtagCommand(bot, command('dogtag'));
    // #then
    const posted = bot.discord.calls.filter((c) => c.file).map((c) => c.content.split('\n')[1]);
    expect(posted).toEqual(Array(2).fill('🎖 Sticker: LinkMarines Vol. 1 <https://t.me/addstickers/linkmarines_by_ccipdevbot>'));
  });

  it('carries the callsign alone while it is off, and names Vol. 2 from serial 121', () => {
    // #then
    expect([cardText({ telegramOpen: false }, { callsign: 'sergey-pepe-comfy', serial: 7 }), cardText({ telegramOpen: true }, { callsign: 'sergey-pepe-comfy', serial: 121 })]).toEqual([
      'sergey-pepe-comfy',
      'sergey-pepe-comfy\n🎖 Sticker: LinkMarines Vol. 2 <https://t.me/addstickers/linkmarines2_by_ccipdevbot>',
    ]);
  });
});
```

Create `discord/test/cron.test.ts`:

```ts
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { resetStorage } from './helpers';

/** A sticker-run lock left by a run that died 20 minutes ago: a run that starts takes it over, and lets it go when done. */
async function staleLock(): Promise<void> {
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('sticker-run', ?)").bind(new Date(Date.now() - 20 * 60_000).toISOString()).run();
}

async function cron(environment: typeof env): Promise<string | null> {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: '*/10 * * * *' }), environment, ctx);
  await waitOnExecutionContext(ctx);
  return (await env.DB.prepare("SELECT value FROM meta WHERE key = 'sticker-run'").first<{ value: string }>())?.value ?? null;
}

beforeEach(resetStorage);

describe('the cron', () => {
  it('runs the sticker job once LinkMarines on Telegram is on and has its owner', async () => {
    // #given
    await staleLock();
    // #when the roster is empty, so the run has nothing to send
    const lock = await cron({ ...env, TELEGRAM_BOT: 'on', TELEGRAM_STICKER_OWNER_ID: '42' });
    // #then
    expect(lock).toBeNull();
  });

  it('leaves the sticker job alone while TELEGRAM_BOT is off', async () => {
    // #given
    await staleLock();
    // #when
    const lock = await cron(env);
    // #then
    expect(lock).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/stickers.test.ts test/sticker-line.test.ts test/cron.test.ts`
Expected: FAIL: `../src/stickers` does not exist, `cardText` is not exported by `../src/marines`, and `worker.scheduled` is not a function.

- [ ] **Step 3: Add the columns, the queue, the job and the cron.**

Create `discord/migrations/0002_stickers.sql`:

```sql
-- Each Marine's sticker: the pack it is in, and its file id there. Both stay NULL until the sticker job adds it;
-- the job does the backfill, so this migration changes no rows.
ALTER TABLE marines ADD COLUMN sticker_set TEXT;
ALTER TABLE marines ADD COLUMN sticker_file_id TEXT;
```

At the end of `discord/src/store.ts`, add:

```ts
/**
 * The sticker job's queue, at most `limit`: first a Marine a cut-short run left marked (sticker_set set, no file id),
 * then the Marines without a sticker, oldest serial first.
 */
export async function stickerQueue(db: D1Database, limit: number): Promise<{ marine: Marine; set: string | null }[]> {
  const { results } = await db
    .prepare('SELECT * FROM marines WHERE sticker_file_id IS NULL ORDER BY sticker_set IS NULL, serial LIMIT ?')
    .bind(limit)
    .all<MarineRow & { sticker_set: string | null }>();
  return results.map((r) => ({ marine: toMarine(r), set: r.sticker_set }));
}
```

Create `discord/src/stickers.ts`:

```ts
import { stickerPackName, stickerPackTitle, stickerPackUrl, stickerVolume } from '@ccip-dev/core/linkmarine';
import { publicCard, reason } from './enlistment';
import { loadMemes, stockMemes } from './memes';
import { stickerQueue, type Marine } from './store';
import type { TelegramResult } from './telegram-api';
import { TELEGRAM_PLATFORM, type TelegramBot } from './telegram-marines';

/**
 * The sticker job: every Marine, from either platform, becomes a sticker in their volume's LinkMarines pack, oldest
 * serial first. A Marine is marked (sticker_set set, sticker_file_id NULL) before its sticker is added and recorded
 * after, one at a time, so the pack holds exactly one sticker per recorded Marine, in the order they were added. A run
 * that loses Telegram's answer leaves the Marine marked, and the next run counts the pack to settle it: never twice.
 */
export const STICKERS_PER_RUN = 10;
export const STICKER_EMOJI = '🎖';
const UPLOAD_TIMEOUT_MS = 15_000;
/** One run at a time: a run holds this lock until it ends, or for 15 minutes at most. */
const RUN_LOCK_MS = 15 * 60_000;
const RUN_LOCK = 'sticker-run';
/** Telegram's answer to creating a pack that exists. */
const NAME_TAKEN = /name is already occupied/i;

/** added: recorded. limited: a 429, so the run ends quietly. failed: alert and go on. stalled: alert and end the run, a Marine still marked. */
type Outcome = { kind: 'added' } | { kind: 'limited' } | { kind: 'failed'; why: string } | { kind: 'stalled'; why: string };

const isLimited = (r: TelegramResult<unknown>) => !r.ok && r.status === 429;
/** No answer came back: whether Telegram acted is not known. */
const isUnknown = (r: TelegramResult<unknown>) => !r.ok && r.status === 0;
const why = (r: TelegramResult<unknown>) => (r.ok ? 'ok' : `${r.status} ${r.description}`);

async function claimRun(db: D1Database, now: Date): Promise<string | null> {
  const claim = now.toISOString();
  const res = await db
    .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?3')
    .bind(RUN_LOCK, claim, new Date(now.getTime() - RUN_LOCK_MS).toISOString())
    .run();
  return res.meta.changes > 0 ? claim : null;
}

const mark = (db: D1Database, serial: number, set: string | null) => db.prepare('UPDATE marines SET sticker_set = ? WHERE serial = ?').bind(set, serial).run();
const record = (db: D1Database, serial: number, fileId: string) => db.prepare('UPDATE marines SET sticker_file_id = ? WHERE serial = ?').bind(fileId, serial).run();

async function recordedIn(db: D1Database, set: string): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM marines WHERE sticker_set = ? AND sticker_file_id IS NOT NULL').bind(set).first<{ n: number }>())?.n ?? 0;
}

/** A Telegram Marine hears about their sticker. One who never started the bot can't be messaged, which is fine. */
async function tellMarine(bot: TelegramBot, marine: Marine, fileId: string): Promise<void> {
  if (marine.platform !== TELEGRAM_PLATFORM) return;
  const volume = stickerVolume(marine.serial);
  const told = await bot.tg.call('sendMessage', { chat_id: marine.userId, text: `You're sticker #${marine.serial} in LinkMarines Vol. ${volume}` });
  if (!told.ok) return;
  await bot.tg.call('sendSticker', { chat_id: marine.userId, sticker: fileId, reply_markup: { inline_keyboard: [[{ text: 'Add the pack', url: stickerPackUrl(volume) }]] } });
}

/**
 * Records a marked Marine's sticker: the pack's sticker after the recorded ones. Right after Telegram said it added the
 * sticker, a pack without it stalls the job for the owner to look; on a later run it means the add never happened, and
 * the Marine is due again.
 */
async function settle(bot: TelegramBot, marine: Marine, set: string, justAdded: boolean): Promise<Outcome> {
  const pack = await bot.tg.call<{ stickers: { file_id: string }[] }>('getStickerSet', { name: set });
  if (isLimited(pack)) return { kind: 'limited' };
  if (!pack.ok && (justAdded || isUnknown(pack))) return { kind: 'stalled', why: `getStickerSet ${set}: ${why(pack)}; the next run settles it` };
  const stickers = pack.ok ? pack.result.stickers : [];
  const recorded = await recordedIn(bot.db, set);
  const ours = stickers[recorded];
  if (ours) {
    await record(bot.db, marine.serial, ours.file_id);
    await tellMarine(bot, marine, ours.file_id);
    return { kind: 'added' };
  }
  if (justAdded) return { kind: 'stalled', why: `${set} holds ${stickers.length} stickers for ${recorded} recorded Marines right after an add` };
  await mark(bot.db, marine.serial, null);
  return { kind: 'failed', why: `${set} does not hold the sticker (${pack.ok ? `${stickers.length} stickers` : why(pack)}); it is due again` };
}

/** The sticker's PNG, or why it could not be drawn. */
async function drawSticker(bot: TelegramBot, marine: Marine): Promise<Uint8Array | string> {
  try {
    await stockMemes(bot.bucket, bot.renderer, bot.fetch, bot.snapshot.archive, marine.memes);
    const pngs = await loadMemes(bot.bucket, marine.memes);
    return pngs ? await bot.renderer.renderMarineSticker(publicCard(bot, marine, pngs)) : 'memes missing from storage right after copying';
  } catch (err) {
    return `the sticker could not be drawn: ${reason(err)}`;
  }
}

async function addSticker(bot: TelegramBot, marine: Marine, owner: number): Promise<Outcome> {
  const png = await drawSticker(bot, marine);
  if (typeof png === 'string') return { kind: 'failed', why: png };
  const upload = await bot.tg.upload<{ file_id: string }>('uploadStickerFile', { user_id: String(owner), sticker_format: 'static' }, { field: 'sticker', name: `marine-${marine.serial}.png`, type: 'image/png', bytes: png }, UPLOAD_TIMEOUT_MS);
  if (!upload.ok) return isLimited(upload) ? { kind: 'limited' } : { kind: 'failed', why: `uploadStickerFile ${why(upload)}` };
  const volume = stickerVolume(marine.serial);
  const set = stickerPackName(volume);
  const sticker = { sticker: upload.result.file_id, format: 'static', emoji_list: [STICKER_EMOJI] };
  const packExists = (await bot.db.prepare('SELECT 1 FROM marines WHERE sticker_set = ? LIMIT 1').bind(set).first()) !== null;
  await mark(bot.db, marine.serial, set);
  let added = packExists ? null : await bot.tg.call('createNewStickerSet', { user_id: owner, name: set, title: stickerPackTitle(volume), stickers: [sticker] });
  if (added === null || (!added.ok && added.status === 400 && NAME_TAKEN.test(added.description))) added = await bot.tg.call('addStickerToSet', { user_id: owner, name: set, sticker });
  if (isUnknown(added)) return { kind: 'stalled', why: `adding to ${set}: ${why(added)}; the next run settles it` };
  if (!added.ok) {
    await mark(bot.db, marine.serial, null);
    return isLimited(added) ? { kind: 'limited' } : { kind: 'failed', why: `adding to ${set}: ${why(added)}` };
  }
  return settle(bot, marine, set, true);
}

/**
 * One run of the sticker job: the queue (a Marine a cut-short run left marked, then the next Marines), at most
 * STICKERS_PER_RUN. A 429 ends the run for the next to pick up. Any other failure alerts telegram-sticker:<serial>; the
 * run goes on unless a Marine is left marked. Nothing runs while LinkMarines on Telegram is off or has no owner.
 */
export async function stickerJob(bot: TelegramBot): Promise<void> {
  const owner = bot.settings.ownerId;
  if (!bot.settings.open || owner === null) return;
  const claim = await claimRun(bot.db, bot.now());
  if (!claim) return;
  try {
    for (const { marine, set } of await stickerQueue(bot.db, STICKERS_PER_RUN)) {
      let outcome: Outcome;
      try {
        outcome = set ? await settle(bot, marine, set, false) : await addSticker(bot, marine, owner);
      } catch (err) {
        outcome = { kind: 'stalled', why: reason(err) };
      }
      if (outcome.kind === 'limited') break;
      if (outcome.kind === 'failed' || outcome.kind === 'stalled') await bot.alert(`telegram-sticker:${marine.serial}`, `Marine #${marine.serial}'s sticker: ${outcome.why}`);
      if (outcome.kind === 'stalled') break;
    }
  } finally {
    await bot.db.prepare('DELETE FROM meta WHERE key = ? AND value = ?').bind(RUN_LOCK, claim).run();
  }
}
```

In `discord/src/index.ts`, replace:

```ts
import { publicRoute, type PublicDeps } from './public';
import { createTelegramBot } from './telegram-marines';
```

with:

```ts
import { publicRoute, type PublicDeps } from './public';
import { stickerJob } from './stickers';
import { createTelegramBot } from './telegram-marines';
```

In `discord/src/index.ts`, replace:

```ts
    return handleInteraction(interaction, env.DISCORD_SERVERS, botHandlers(createBot(env)), (work) => ctx.waitUntil(work));
  },
} satisfies ExportedHandler<Env>;
```

with:

```ts
    return handleInteraction(interaction, env.DISCORD_SERVERS, botHandlers(createBot(env)), (work) => ctx.waitUntil(work));
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(stickerJob(createTelegramBot(env)));
  },
} satisfies ExportedHandler<Env>;
```

In `discord/wrangler.toml`, replace:

```toml
bucket_name = "ccip-dev-marines"

[[services]]
```

with:

```toml
bucket_name = "ccip-dev-marines"

# The sticker job (docs/runbook.md, "LinkMarines on Telegram"): it does nothing while TELEGRAM_BOT is off.
[triggers]
crons = ["*/10 * * * *"]

[[services]]
```

- [ ] **Step 4: Name the pack on Discord's posted card once the switch is on.**

In `discord/src/bot.ts`, replace:

```ts
  random: () => number;
  snapshot: CallsignSnapshot;
}
```

with:

```ts
  random: () => number;
  snapshot: CallsignSnapshot;
  /** LinkMarines on Telegram is open (TELEGRAM_BOT is "on"): a posted card names the Marine's sticker pack. */
  telegramOpen: boolean;
}
```

In `discord/src/bot.ts`, replace:

```ts
    random: cryptoRandom,
    snapshot: SNAPSHOT,
  };
```

with:

```ts
    random: cryptoRandom,
    snapshot: SNAPSHOT,
    telegramOpen: env.TELEGRAM_BOT === 'on',
  };
```

In `discord/test/helpers.ts`, replace:

```ts
    snapshot: SNAPSHOT,
    data: {
```

with:

```ts
    snapshot: SNAPSHOT,
    telegramOpen: false,
    data: {
```

In `discord/src/marines.ts`, replace:

```ts
import { hasGlint, serialText, type Tier } from '@ccip-dev/core/linkmarine';
```

with:

```ts
import { hasGlint, serialText, stickerPackUrl, stickerVolume, type Tier } from '@ccip-dev/core/linkmarine';
```

In `discord/src/marines.ts`, replace:

```ts
const AVATAR_TIMEOUT_MS = 5_000;
```

with:

```ts
/** The text a posted card carries: the callsign, and once LinkMarines is on Telegram, the Marine's sticker pack. */
export function cardText(bot: Pick<Bot, 'telegramOpen'>, marine: Pick<Marine, 'callsign' | 'serial'>): string {
  if (!bot.telegramOpen) return marine.callsign;
  const volume = stickerVolume(marine.serial);
  return `${marine.callsign}\n🎖 Sticker: LinkMarines Vol. ${volume} <${stickerPackUrl(volume)}>`;
}

const AVATAR_TIMEOUT_MS = 5_000;
```

In `discord/src/marines.ts`, replace:

```ts
    await postCard(bot, token, marine.callsign, cards, TEXT.stamping(marine), marine, startedAt, reports);
```

with:

```ts
    await postCard(bot, token, cardText(bot, marine), cards, TEXT.stamping(marine), marine, startedAt, reports);
```

In `discord/src/marines.ts`, replace:

```ts
    if (cards) await postCard(bot, interaction.token, marine.callsign, cards === 'late' ? null : cards, fallback, marine, startedAt, reports);
```

with:

```ts
    if (cards) await postCard(bot, interaction.token, cardText(bot, marine), cards === 'late' ? null : cards, fallback, marine, startedAt, reports);
```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/stickers.test.ts test/sticker-line.test.ts test/cron.test.ts test/marines.test.ts`
Expected: PASS (12, 2, 2 and 39 tests; Discord's reveal and `/dogtag` tests still see the callsign alone, since `fakeBot` keeps the switch off).

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (243 tests; the test D1 applies `0002_stickers.sql` with the first migration).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add discord/migrations/0002_stickers.sql discord/src/stickers.ts discord/src/store.ts discord/src/bot.ts discord/src/marines.ts discord/src/index.ts discord/wrangler.toml discord/test/helpers.ts discord/test/stickers.test.ts discord/test/sticker-line.test.ts discord/test/cron.test.ts
git commit -m "feat(discord): the LinkMarines sticker packs, filled every 10 minutes, and the pack on Discord's card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The thin bot

@ccipdevbot's webhook, `POST /telegram`: 401 without `X-Telegram-Bot-Api-Secret-Token` matching `TELEGRAM_WEBHOOK_SECRET` (compared in constant time, through SHA-256 digests and `crypto.subtle.timingSafeEqual`), else 200 at once with the work in `waitUntil`; each `update_id` claimed in `meta` before any work, so a redelivery does nothing. `/start` answers with the Mini App's button (a `web_app` button in a DM, a link in a group, a known payload carried as `startapp`); `/id` names the chat for the owner, anywhere, and in a chat on the gate list; the bot leaves a group it was added to by anyone but the owner unless the group is on the list. While the switch is off every update is dropped. The cron also prunes day-old update and stamp claims.

**Files:**
- Create: `discord/src/telegram-bot.ts`
- Modify: `discord/src/index.ts` (`/telegram`; the cron prunes), `discord/src/env.ts` (`TELEGRAM_WEBHOOK_SECRET`)
- Test: `discord/test/telegram-bot.test.ts`

**Interfaces:**
- Consumes: Task 4's `MINI_APP_URL`, `miniAppLink`, `parseStartParam`, `TELEGRAM_BOT_USERNAME`; Task 5's `type TelegramBot`; Task 6's `cappedBody`; Task 1's `reason`.
- Produces (`discord/src/telegram-bot.ts`): `interface TelegramChat { id; type: 'private' | 'group' | 'supergroup' | 'channel'; username? }`, `interface TelegramUpdate { update_id; message?; my_chat_member? }`, `START_TEXT = 'Enlist and get your LinkMarine dog tag.'`, `OPEN_BUTTON = 'Open LinkMarines'`, `webhookSecretMatches(expected, got): Promise<boolean>`, `onGateList(chat, gateChats): boolean`, `parseCommand(text): { name; payload } | null`, `claimUpdate(db, updateId, now): Promise<boolean>`, `pruneClaims(db, now): Promise<void>`, `handleUpdate(bot, update): Promise<void>`, `telegramWebhook(request, bot, secret, waitUntil): Promise<Response>`.
- `meta` keys: `tg-update:<update_id>` (pruned after a day, with `tg-stamp:<serial>`).

- [ ] **Step 1: Write the failing test.**

Create `discord/test/telegram-bot.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { claimUpdate, handleUpdate, pruneClaims, telegramWebhook, webhookSecretMatches, type TelegramChat, type TelegramUpdate } from '../src/telegram-bot';
import { fakeTelegram, fakeTelegramBot, OWNER_ID, resetStorage, TG_SETTINGS, tgError } from './helpers';

const SECRET = 'webhook-secret_123';
const DM: TelegramChat = { id: 777000111, type: 'private' };
const CCIPDEV: TelegramChat = { id: -1001234, type: 'channel', username: 'ccipdev' };
const MARINE_GROUP: TelegramChat = { id: -1005555, type: 'supergroup' };
const STRANGERS: TelegramChat = { id: -1009999, type: 'group' };
const SETTINGS = { ...TG_SETTINGS, gateChats: ['@ccipdev', String(MARINE_GROUP.id)] };

const message = (chat: TelegramChat, text: string, from = 777000111, update_id = 1): TelegramUpdate => ({ update_id, message: { from: { id: from }, chat, text } });
const added = (chat: TelegramChat, from: number, status = 'member'): TelegramUpdate => ({ update_id: 2, my_chat_member: { from: { id: from }, chat, new_chat_member: { status } } });
const hook = (update: unknown, secret: string | null = SECRET) =>
  new Request('https://discord.ccip.dev/telegram', { method: 'POST', body: JSON.stringify(update), headers: secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret } });

beforeEach(resetStorage);

describe('the webhook', () => {
  it('answers 401 without the secret header, or with a wrong one, and 200 at once with it, working after', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    const work: Promise<unknown>[] = [];
    // #when
    const answers = await Promise.all([telegramWebhook(hook(message(DM, '/start'), null), bot, SECRET, () => {}), telegramWebhook(hook(message(DM, '/start'), 'wrong'), bot, SECRET, () => {}), telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p))]);
    const before = bot.tg.calls.length;
    await Promise.all(work);
    // #then
    expect([answers.map((r) => r.status), before, bot.tg.calls.map((c) => c.method)]).toEqual([[401, 401, 200], 0, ['sendMessage']]);
  });

  it('compares the secret in constant time, and refuses everything while no secret is set', async () => {
    // #then
    expect(await Promise.all([webhookSecretMatches(SECRET, SECRET), webhookSecretMatches(SECRET, `${SECRET}x`), webhookSecretMatches('', ''), webhookSecretMatches(SECRET, null)])).toEqual([true, false, false, false]);
  });

  it('drops every update while TELEGRAM_BOT is off', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: { ...SETTINGS, open: false } });
    const work: Promise<unknown>[] = [];
    // #when
    const res = await telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p));
    // #then
    expect([res.status, work.length]).toEqual([200, 0]);
  });

  it('handles each update once, even when Telegram redelivers it while the first is still running', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    const work: Promise<unknown>[] = [];
    // #when the same update arrives three times, two at once
    await Promise.all([telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p)), telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p))]);
    await Promise.all(work);
    await telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p));
    await Promise.all(work);
    // #then
    expect(bot.tg.calls.length).toBe(1);
  });

  it('alerts telegram-update when an update fails', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS, db: { prepare: () => { throw new Error('D1 is down'); } } as unknown as D1Database });
    const work: Promise<unknown>[] = [];
    // #when
    await telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p));
    await Promise.all(work);
    // #then
    expect(bot.alerts.map((a) => a.signature)).toEqual(['telegram-update']);
  });

  it('is reached at /telegram through the Worker, which needs TELEGRAM_WEBHOOK_SECRET', async () => {
    // #given
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const handle = (environment: typeof env) => worker.fetch(hook(message(DM, '/start')) as Parameters<typeof worker.fetch>[0], environment, ctx);
    // #when
    const answers = await Promise.all([handle(env), handle({ ...env, TELEGRAM_WEBHOOK_SECRET: SECRET })]);
    // #then
    expect(answers.map((r) => r.status)).toEqual([401, 200]);
  });

  it('drops claims older than a day', async () => {
    // #given
    const now = new Date('2026-10-15T12:00:00.000Z');
    await claimUpdate(env.DB, 1, new Date(now.getTime() - 86_400_001));
    await claimUpdate(env.DB, 2, new Date(now.getTime() - 1_000));
    // #when
    await pruneClaims(env.DB, now);
    // #then
    expect((await env.DB.prepare("SELECT key FROM meta WHERE key LIKE 'tg-update:%'").all<{ key: string }>()).results.map((r) => r.key)).toEqual(['tg-update:2']);
  });
});

describe('the thin bot', () => {
  it('answers /start in a DM with a button that opens the Mini App, carrying a known payload as startapp', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    for (const text of ['/start', '/start marine_42', '/start whatever']) await handleUpdate(bot, message(DM, text));
    // #then
    expect(bot.tg.calls.map((c) => [c.body.chat_id, c.body.text, c.body.reply_markup])).toEqual(
      ['https://ccip.dev/tg/', 'https://ccip.dev/tg/?startapp=marine_42', 'https://ccip.dev/tg/'].map((url) => [
        DM.id,
        'Enlist and get your LinkMarine dog tag.',
        { inline_keyboard: [[{ text: 'Open LinkMarines', web_app: { url } }]] },
      ]),
    );
  });

  it('answers /start in a LinkMarine group with a link to the Mini App, and ignores a command for another bot', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, message(MARINE_GROUP, '/start@ccipdevbot tag_pepe'));
    await handleUpdate(bot, message(MARINE_GROUP, '/start@otherbot'));
    // #then
    expect(bot.tg.calls.map((c) => c.body.reply_markup)).toEqual([{ inline_keyboard: [[{ text: 'Open LinkMarines', url: 'https://t.me/ccipdevbot/marines?startapp=tag_pepe' }]] }]);
  });

  it('tells /id to the owner anywhere and in a LinkMarine chat, and to nobody else', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, message(MARINE_GROUP, '/id'));
    await handleUpdate(bot, message(DM, '/id', OWNER_ID));
    await handleUpdate(bot, message(STRANGERS, '/id', OWNER_ID));
    await handleUpdate(bot, message(DM, '/id'));
    // #then
    expect(bot.tg.calls.map((c) => [c.method, c.body.text])).toEqual([
      ['sendMessage', `This chat's ID: ${MARINE_GROUP.id}`],
      ['sendMessage', `This chat's ID: ${DM.id}`],
      ['sendMessage', `This chat's ID: ${STRANGERS.id}`],
    ]);
  });

  it('leaves a group it is added to by anyone but the owner, unless the group is on the list', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, added(STRANGERS, 777000111));
    await handleUpdate(bot, added(STRANGERS, OWNER_ID));
    await handleUpdate(bot, added(MARINE_GROUP, 777000111, 'administrator'));
    await handleUpdate(bot, added(CCIPDEV, 777000111, 'administrator'));
    await handleUpdate(bot, added(STRANGERS, 777000111, 'left'));
    // #then
    expect(bot.tg.calls.map((c) => [c.method, c.body.chat_id])).toEqual([['leaveChat', STRANGERS.id]]);
  });

  it('leaves a group not on the list where a command reaches it', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS, tg: fakeTelegram({ leaveChat: () => tgError(400, 'Bad Request: chat not found') }) });
    // #when
    await handleUpdate(bot, message(STRANGERS, '/start'));
    // #then
    expect(bot.tg.calls.map((c) => [c.method, c.body.chat_id])).toEqual([['leaveChat', STRANGERS.id]]);
  });

  it('says nothing to plain text', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, message(DM, 'hello'));
    await handleUpdate(bot, { update_id: 9 });
    // #then
    expect(bot.tg.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/discord exec vitest run test/telegram-bot.test.ts`
Expected: FAIL: `../src/telegram-bot` does not exist.

- [ ] **Step 3: Add the bot and route the webhook.**

Create `discord/src/telegram-bot.ts`:

```ts
import { MINI_APP_URL, miniAppLink, parseStartParam, TELEGRAM_BOT_USERNAME } from '@ccip-dev/core/linkmarine';
import { cappedBody } from './body';
import { reason } from './enlistment';
import type { TelegramBot } from './telegram-marines';

/**
 * The thin bot behind @ccipdevbot's webhook, POST /telegram: /start opens the Mini App, /id names a chat for the
 * owner, and the bot leaves any group it was not invited to. Everything else happens in the Mini App.
 */
export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  username?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { from?: { id: number }; chat: TelegramChat; text?: string };
  my_chat_member?: { from: { id: number }; chat: TelegramChat; new_chat_member: { status: string } };
}

export const START_TEXT = 'Enlist and get your LinkMarine dog tag.';
export const OPEN_BUTTON = 'Open LinkMarines';
/** A handled update's claim is kept this long; Telegram stops redelivering long before. */
const CLAIM_KEEP_MS = 86_400_000;

const sha256 = async (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

/** Telegram's X-Telegram-Bot-Api-Secret-Token against TELEGRAM_WEBHOOK_SECRET, compared in constant time. */
export async function webhookSecretMatches(expected: string, got: string | null): Promise<boolean> {
  if (!expected || got === null) return false;
  const [a, b] = await Promise.all([sha256(expected), sha256(got)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** On TELEGRAM_GATE_CHATS: a channel or group by its @username, or by its id. */
export function onGateList(chat: TelegramChat, gateChats: readonly string[]): boolean {
  return gateChats.some((entry) => (entry.startsWith('@') ? chat.username?.toLowerCase() === entry.slice(1).toLowerCase() : entry === String(chat.id)));
}

/** "/start marine_42", "/start@ccipdevbot", "/id": the command and its payload; null for text that isn't one of ours. */
export function parseCommand(text: string): { name: string; payload: string | null } | null {
  const match = /^\/([a-z]+)(?:@(\w+))?(?:\s+(\S+))?/i.exec(text.trim());
  if (!match || (match[2] !== undefined && match[2].toLowerCase() !== TELEGRAM_BOT_USERNAME)) return null;
  return { name: match[1]!.toLowerCase(), payload: match[3] ?? null };
}

/** Claims an update before any work, so a redelivery, even one arriving while the first is still running, does nothing. */
export async function claimUpdate(db: D1Database, updateId: number, now: Date): Promise<boolean> {
  const res = await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(`tg-update:${updateId}`, now.toISOString()).run();
  return res.meta.changes > 0;
}

/** Drops update and stamp claims older than a day: the cron keeps meta small. */
export async function pruneClaims(db: D1Database, now: Date): Promise<void> {
  const before = new Date(now.getTime() - CLAIM_KEEP_MS).toISOString();
  await db.prepare("DELETE FROM meta WHERE (key LIKE 'tg-update:%' OR key LIKE 'tg-stamp:%') AND value < ?").bind(before).run();
}

/** /start: a web_app button in a DM, a link in a group (Telegram allows web_app buttons only in private chats). A known payload rides along as startapp. */
async function start(bot: TelegramBot, chat: TelegramChat, payload: string | null): Promise<void> {
  const startapp = payload !== null && parseStartParam(payload) ? payload : undefined;
  const button = chat.type === 'private' ? { text: OPEN_BUTTON, web_app: { url: startapp ? `${MINI_APP_URL}?startapp=${startapp}` : MINI_APP_URL } } : { text: OPEN_BUTTON, url: miniAppLink(startapp) };
  await bot.tg.call('sendMessage', { chat_id: chat.id, text: START_TEXT, reply_markup: { inline_keyboard: [[button]] } });
}

export async function handleUpdate(bot: TelegramBot, update: TelegramUpdate): Promise<void> {
  const owner = bot.settings.ownerId;
  const allowed = (chat: TelegramChat, from: number | undefined) => chat.type === 'private' || onGateList(chat, bot.settings.gateChats) || (owner !== null && from === owner);
  const joined = update.my_chat_member;
  if (joined) {
    const inChat = joined.new_chat_member.status === 'member' || joined.new_chat_member.status === 'administrator';
    if (inChat && !allowed(joined.chat, joined.from.id)) await bot.tg.call('leaveChat', { chat_id: joined.chat.id });
    return;
  }
  const message = update.message;
  const command = message?.text ? parseCommand(message.text) : null;
  if (!message || !command) return;
  if (!allowed(message.chat, message.from?.id)) {
    await bot.tg.call('leaveChat', { chat_id: message.chat.id });
    return;
  }
  if (command.name === 'start') await start(bot, message.chat, command.payload);
  const mayAskId = (owner !== null && message.from?.id === owner) || (message.chat.type !== 'private' && onGateList(message.chat, bot.settings.gateChats));
  if (command.name === 'id' && mayAskId) await bot.tg.call('sendMessage', { chat_id: message.chat.id, text: `This chat's ID: ${message.chat.id}` });
}

/** Handles an update once; anything that throws is told to the alert chat as telegram-update. */
async function processUpdate(bot: TelegramBot, update: TelegramUpdate): Promise<void> {
  try {
    if (!(await claimUpdate(bot.db, update.update_id, bot.now()))) return;
    await handleUpdate(bot, update);
  } catch (err) {
    console.error(`telegram update ${update.update_id}: ${reason(err)}`);
    await bot.alert('telegram-update', `update ${update.update_id} failed: ${reason(err)}`);
  }
}

/** POST /telegram: 401 without the secret, else 200 at once, the work in waitUntil. While TELEGRAM_BOT is off every update is dropped. */
export async function telegramWebhook(request: Request, bot: TelegramBot, secret: string, waitUntil: (work: Promise<unknown>) => void): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  if (!(await webhookSecretMatches(secret, request.headers.get('X-Telegram-Bot-Api-Secret-Token')))) return new Response('Unauthorized', { status: 401 });
  const body = await cappedBody(request);
  if (body === null) return new Response('Request body too large', { status: 413 });
  let update: TelegramUpdate;
  try {
    update = JSON.parse(body) as TelegramUpdate;
  } catch {
    return new Response('ok');
  }
  if (bot.settings.open && Number.isSafeInteger(update?.update_id)) waitUntil(processUpdate(bot, update));
  return new Response('ok');
}
```

In `discord/src/env.ts`, replace:

```ts
  TELEGRAM_STICKER_OWNER_ID?: string;
}
```

with:

```ts
  TELEGRAM_STICKER_OWNER_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}
```

In `discord/src/index.ts`, replace:

```ts
import { stickerJob } from './stickers';
```

with:

```ts
import { stickerJob } from './stickers';
import { pruneClaims, telegramWebhook } from './telegram-bot';
```

In `discord/src/index.ts`, replace:

```ts
    if (path.startsWith('/tg/')) return miniAppRoute(request, createTelegramBot(env), (work) => ctx.waitUntil(work));
```

with:

```ts
    if (path.startsWith('/tg/')) return miniAppRoute(request, createTelegramBot(env), (work) => ctx.waitUntil(work));
    if (path === '/telegram') return telegramWebhook(request, createTelegramBot(env), env.TELEGRAM_WEBHOOK_SECRET ?? '', (work) => ctx.waitUntil(work));
```

In `discord/src/index.ts`, replace:

```ts
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(stickerJob(createTelegramBot(env)));
  },
```

with:

```ts
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.all([stickerJob(createTelegramBot(env)), pruneClaims(env.DB, new Date(controller.scheduledTime))]));
  },
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/discord test`
Expected: PASS (256 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add discord/src/telegram-bot.ts discord/src/index.ts discord/src/env.ts discord/test/telegram-bot.test.ts
git commit -m "feat(discord): @ccipdevbot's webhook: /start, /id and leaving groups not on the list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `pnpm telegram:setup`, and the switch in both deploys

The owner's one-shot setup, run on their machine with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` from `.env`: `setWebhook` (the URL, the secret, `allowed_updates: ["message", "my_chat_member"]`, pending updates dropped), `setMyCommands` (`/start`), `setChatMenuButton` (a `web_app` button "LinkMarines" opening `https://ccip.dev/tg/`), then two checks: `getChat` on the sticker owner (who must have started the bot to own a pack) and `getStickerSet` for Vol. 1, which the job creates (see "Decisions"). It prints what it did, never the token or the secret. The deploys pass the switch on: the Worker as a `--var`, the site's build as an env variable.

**Files:**
- Create: `scripts/telegram/requests.ts`, `scripts/telegram/setup.ts`
- Modify: `package.json` (`telegram:setup`), `.github/workflows/deploy.yml`, `.github/workflows/site.yml`
- Test: `scripts/test/telegram-setup.test.ts`

**Interfaces:**
- Consumes: Task 4's `MINI_APP_URL`, `stickerPackName`, `stickerPackUrl`; `smol-toml` (a root dev dependency already); Task 6's `TELEGRAM_STICKER_OWNER_ID` in `discord/wrangler.toml`.
- Produces: `scripts/telegram/requests.ts`: `WEBHOOK_URL = 'https://discord.ccip.dev/telegram'`, `ALLOWED_UPDATES`, `BOT_COMMANDS`, `interface SetupCall { method; body }`, `ownerIdFrom(wranglerToml): number` (throws while it is empty), `checkSecret(secret): string` (throws unless 1–256 of `A-Za-z0-9_-`), `setupCalls(secret, ownerId): SetupCall[]`, `botUrl(token, method)`; the root script `pnpm telegram:setup` (`tsx --env-file=.env scripts/telegram/setup.ts`); the Worker's deploy `wrangler deploy --var "TELEGRAM_BOT:<on|off>"`; the site build's `TELEGRAM_BOT` env.

- [ ] **Step 1: Write the failing test.**

Create `scripts/test/telegram-setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { botUrl, checkSecret, ownerIdFrom, setupCalls } from '../telegram/requests';

describe('pnpm telegram:setup', () => {
  it('sets the webhook with its secret and two update kinds, the /start command and the menu button, then checks the owner and Vol. 1', () => {
    // #when
    const calls = setupCalls('s3cret_-', 4242424242);
    // #then
    expect(calls).toEqual([
      { method: 'setWebhook', body: { url: 'https://discord.ccip.dev/telegram', secret_token: 's3cret_-', allowed_updates: ['message', 'my_chat_member'], drop_pending_updates: true } },
      { method: 'setMyCommands', body: { commands: [{ command: 'start', description: 'Enlist and get your LinkMarine dog tag' }] } },
      { method: 'setChatMenuButton', body: { menu_button: { type: 'web_app', text: 'LinkMarines', web_app: { url: 'https://ccip.dev/tg/' } } } },
      { method: 'getChat', body: { chat_id: 4242424242 } },
      { method: 'getStickerSet', body: { name: 'linkmarines_by_ccipdevbot' } },
    ]);
  });

  it("reads the owner's id from the Worker's config, and refuses an empty one", () => {
    // #then
    expect(ownerIdFrom('[vars]\nTELEGRAM_STICKER_OWNER_ID = "4242424242"\n')).toBe(4242424242);
    expect(() => ownerIdFrom('[vars]\nTELEGRAM_STICKER_OWNER_ID = ""\n')).toThrow('set [vars] TELEGRAM_STICKER_OWNER_ID');
  });

  it('refuses a webhook secret Telegram would refuse', () => {
    // #then
    expect(checkSecret('a'.repeat(64))).toBe('a'.repeat(64));
    for (const bad of [undefined, 'has space', 'x'.repeat(257)]) expect(() => checkSecret(bad)).toThrow('TELEGRAM_WEBHOOK_SECRET');
  });

  it("calls the bot's own URL", () => {
    // #then
    expect(botUrl('123:abc', 'getMe')).toBe('https://api.telegram.org/bot123:abc/getMe');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run scripts/test/telegram-setup.test.ts`
Expected: FAIL: `../telegram/requests` does not exist.

- [ ] **Step 3: Add the requests and the script.**

Create `scripts/telegram/requests.ts`:

```ts
import { MINI_APP_URL, stickerPackName } from '@ccip-dev/core/linkmarine';
import { parse } from 'smol-toml';

/** What `pnpm telegram:setup` asks the Bot API, in order (core.telegram.org/bots/api). */
export const WEBHOOK_URL = 'https://discord.ccip.dev/telegram';
export const ALLOWED_UPDATES = ['message', 'my_chat_member'];
export const BOT_COMMANDS = [{ command: 'start', description: 'Enlist and get your LinkMarine dog tag' }];
/** Telegram's rule for a webhook's secret_token. */
const SECRET = /^[A-Za-z0-9_-]{1,256}$/;

export interface SetupCall {
  method: string;
  body: Record<string, unknown>;
}

/** The sticker owner's Telegram user id, from discord/wrangler.toml's [vars], so the Worker and the setup agree on it. */
export function ownerIdFrom(wranglerToml: string): number {
  const id = (parse(wranglerToml) as { vars?: { TELEGRAM_STICKER_OWNER_ID?: unknown } }).vars?.TELEGRAM_STICKER_OWNER_ID;
  if (typeof id !== 'string' || !/^[1-9]\d{4,15}$/.test(id)) throw new Error('discord/wrangler.toml: set [vars] TELEGRAM_STICKER_OWNER_ID to your Telegram user id first (send /id to @ccipdevbot)');
  return Number(id);
}

export function checkSecret(secret: string | undefined): string {
  if (!secret || !SECRET.test(secret)) throw new Error('.env: TELEGRAM_WEBHOOK_SECRET must be 1-256 letters, digits, _ or - (see docs/runbook.md, "LinkMarines on Telegram")');
  return secret;
}

/** The webhook, the commands, the menu button, then two checks: that the owner has started the bot, and whether Vol. 1 exists yet. */
export function setupCalls(secret: string, ownerId: number): SetupCall[] {
  return [
    { method: 'setWebhook', body: { url: WEBHOOK_URL, secret_token: secret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: true } },
    { method: 'setMyCommands', body: { commands: BOT_COMMANDS } },
    { method: 'setChatMenuButton', body: { menu_button: { type: 'web_app', text: 'LinkMarines', web_app: { url: MINI_APP_URL } } } },
    { method: 'getChat', body: { chat_id: ownerId } },
    { method: 'getStickerSet', body: { name: stickerPackName(1) } },
  ];
}

export const botUrl = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;
```

Create `scripts/telegram/setup.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stickerPackName, stickerPackUrl } from '@ccip-dev/core/linkmarine';
import { botUrl, checkSecret, ownerIdFrom, setupCalls } from './requests';

/**
 * `pnpm telegram:setup`: points @ccipdevbot at the Worker and sets its command and menu button, with
 * TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .env. It prints what it set, never the token or the secret.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('.env: set TELEGRAM_BOT_TOKEN first (see docs/runbook.md, "LinkMarines on Telegram")');
const secret = checkSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
const ownerId = ownerIdFrom(readFileSync(join(import.meta.dirname, '..', '..', 'discord', 'wrangler.toml'), 'utf8'));

for (const { method, body } of setupCalls(secret, ownerId)) {
  const res = await fetch(botUrl(token, method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const answer = (await res.json()) as { ok: boolean; description?: string };
  if (method === 'getStickerSet') {
    console.log(answer.ok ? `${stickerPackName(1)} exists: ${stickerPackUrl(1)}` : `${stickerPackName(1)} does not exist yet: the sticker job creates it with Marine #1's sticker once TELEGRAM_BOT is on`);
  } else if (method === 'getChat' && !answer.ok) {
    throw new Error(`the sticker owner ${ownerId} has not started @ccipdevbot: send it /start from that account, then run this again`);
  } else if (!answer.ok) {
    throw new Error(`${method}: Telegram said ${answer.description ?? `HTTP ${res.status}`}`);
  } else {
    console.log(method === 'getChat' ? `sticker owner ${ownerId} has started the bot` : `${method}: done`);
  }
}
```

In `package.json`, replace:

```json
    "discord:snapshot": "tsx scripts/discord/snapshot.ts",
```

with:

```json
    "discord:snapshot": "tsx scripts/discord/snapshot.ts",
    "telegram:setup": "tsx --env-file=.env scripts/telegram/setup.ts",
```

Run: `pnpm exec vitest run scripts/test/telegram-setup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Pass the switch through both deploys.**

The Worker gets `TELEGRAM_BOT` as a deploy-time var (anything but `on` deploys `off`); `discord/wrangler.toml`'s `TELEGRAM_BOT = "off"` stays the default for local runs and tests.

In `.github/workflows/deploy.yml`, replace:

```yaml
      - run: pnpm --filter @ccip-dev/discord exec wrangler deploy
        if: vars.DISCORD_BOT == 'on'
```

with:

```yaml
      # TELEGRAM_BOT opens LinkMarines on Telegram (docs/runbook.md, "LinkMarines on Telegram"); anything but "on" keeps it shut.
      - run: pnpm --filter @ccip-dev/discord exec wrangler deploy --var "TELEGRAM_BOT:${{ vars.TELEGRAM_BOT == 'on' && 'on' || 'off' }}"
        if: vars.DISCORD_BOT == 'on'
```

The site's pages read it at build time (Task 12):

In `.github/workflows/site.yml`, replace:

```yaml
      - run: pnpm --filter @ccip-dev/site build
```

with:

```yaml
      - run: pnpm --filter @ccip-dev/site build
        env:
          TELEGRAM_BOT: ${{ vars.TELEGRAM_BOT }}
```

Run: `actionlint .github/workflows/deploy.yml .github/workflows/site.yml`
Expected: no output (skip when `actionlint` is not installed).

Run: `pnpm --filter @ccip-dev/discord exec wrangler deploy --dry-run --outdir /tmp/ccip-dev-discord-dry --var "TELEGRAM_BOT:on"`
Expected: the bindings list ends with `env.DISCORD_SERVERS ("all")`, `env.TELEGRAM_BOT ("(hidden)")`, `env.TELEGRAM_GATE_CHATS ("@ccipdev")`, `env.TELEGRAM_STICKER_OWNER_ID ("")`, then `--dry-run: exiting now.` Nothing is deployed.

- [ ] **Step 5: Run everything and the typecheck.**

Run: `pnpm test`
Expected: PASS: core 682, the Discord Worker 256, the site (Node 1,347, workerd 36), the data Worker 657, the scripts 424 (see Global Constraints about the glint test's timeout under load).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add scripts/telegram/requests.ts scripts/telegram/setup.ts scripts/test/telegram-setup.test.ts package.json .github/workflows/deploy.yml .github/workflows/site.yml
git commit -m "feat: pnpm telegram:setup, and TELEGRAM_BOT through the Worker's and the site's deploys" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Checkpoint push 2.** Push now. With the site from checkpoint 1 live, `deploy.yml` applies `0002_stickers.sql` and deploys the Worker with `TELEGRAM_BOT` off. Check: `curl -s -X POST https://discord.ccip.dev/tg/session -H 'content-type: application/json' -d '{"initData":""}'` answers `{"error":"launch"}` (401: nothing past the launch-data check), and `curl -sI https://discord.ccip.dev/story/1.png` answers 200 with `content-type: image/png`.

---

### Task 10: The Mini App's rules, and screens 1 to 3

The Mini App's logic, kept pure so it is tested without Telegram: where it opens (deep links, enlisted or not), the `startapp` value, the draw's timing and callsign, the tier banner, the bottom button per screen, the tilt, when Share to Story works, the Story's text and the share sheet's link, and the API client (launch data in the POST body). A typed slice of Telegram's `WebApp` object. Then the first three screens and the outside screen, as the mockup draws them; Task 11 wires them to Telegram.

**Files:**
- Create: `site/src/lib/telegram-webapp.ts`, `site/src/lib/tg.ts`, `site/src/components/tg/Welcome.tsx`, `site/src/components/tg/Draw.tsx`, `site/src/components/tg/DogTagScreen.tsx`, `site/src/components/tg/Outside.tsx`
- Test: `site/test/tg.test.ts`, `site/test/tg-screens.test.ts`

**Interfaces:**
- Consumes: Task 4's `MINI_APP_LINK`, `parseStartParam`, `type StartParam`; Tasks 5–6's `MarineSummary`, `Gate`, `SessionAnswer`, `EnlistAnswer`; core's `rarerThan`; the site's `BOT_ORIGIN`, `marineTitle`, `marineUrl`, `memeUrl`, `shareLine`; core roster's `plankSeats`, `PLANK_SEATS`.
- Produces (`site/src/lib/telegram-webapp.ts`): `interface BottomButtonParams`, `interface TelegramWebApp` (the methods used), `telegramWebApp(win): TelegramWebApp | null` (null without launch data).
- Produces (`site/src/lib/tg.ts`): `TG_API`, `TG_BACKGROUND = '#0a0f1e'`, `MAIN_BLUE`, `MAIN_GOLD`, `MAIN_GOLD_TEXT`, `CCIPDEV_LINK`, `type Screen = { name: 'welcome' } | { name: 'draw' } | { name: 'dogtag' } | { name: 'roster'; marine: number | null; tag: string | null }`, `startParam(app, search)`, `firstScreen(start, session): Screen`, `DRAW_STEP_MS = 800`, `DRAW_HOLD_MS = 1_400`, `lockedAt(ms)`, `callsignParts(tags, locked)`, `chanceText(chance)`, `tierBanner(tier, percentile)`, `canShareToStory(app)` (a type guard), `storyUrl(serial)`, `storyText(marine)`, `STORY_WIDGET`, `shareLink(marine)`, `MAX_TILT = 8`, `tilt(beta, gamma, rest)`, `tiltOn(reducedMotion, orientation)`, `interface MainButtonState { text; color; textColor; active; visible; action: 'enlist' | 'story' | 'dogtag' | null }`, `mainButton(screen, session)`, `type EnlistReply = EnlistAnswer | { gate: 'join' } | { switch: 'off' }`, `tgApi(initData, fetchFn?)` with `session()`, `enlist()` and `card(): Promise<Blob | null>`.
- Produces (components): `Welcome({ roster, gate, open, onJoin, onCheck })`, `OpensSoon()`, `SEAT_PREVIEW = 30`; `Draw({ marine, roster, locked, banner })`, `Hexes({ marine, locked })`; `DogTagScreen({ marine, cardUrl, tilt, onPack, onShare, onRoster })`, `interface Tilt { x; y; streak }`; `Outside()`. The class names they use are styled in Task 11's `tg.css`.

- [ ] **Step 1: Write the failing tests.**

Create `site/test/tg.test.ts`:

```ts
import type { MarineSummary, SessionAnswer } from '@ccip-dev/core/linkmarine';
import { describe, expect, it } from 'vitest';
import { callsignParts, canShareToStory, chanceText, firstScreen, lockedAt, mainButton, MAX_TILT, shareLink, startParam, storyText, storyUrl, tgApi, tierBanner, tilt, tiltOn } from '../src/lib/tg';
import { telegramWebApp, type TelegramWebApp } from '../src/lib/telegram-webapp';

const MARINE: MarineSummary = {
  serial: 42,
  callsign: 'sergey-pepe-linkpilled',
  tags: ['sergey', 'pepe', 'linkpilled'],
  tier: 'rare',
  percentile: 88.4,
  memes: [
    { tag: 'sergey', file: 's1.jpeg', count: 653 },
    { tag: 'pepe', file: 'p1.jpeg', count: 426 },
    { tag: 'linkpilled', file: 'l1.jpeg', count: 3 },
  ],
  volume: 1,
  cardReady: true,
};
const ON_NEW: SessionAnswer = { switch: 'on', marine: null, gate: 'ok' };
const ON_ENLISTED: SessionAnswer = { switch: 'on', marine: MARINE, gate: 'ok' };
const OFF: SessionAnswer = { switch: 'off' };

describe('where the Mini App opens', () => {
  it('opens a Marine’s or a tag’s link on the roster, and enlist or nothing on the welcome or your dog tag', () => {
    // #then
    expect([
      firstScreen({ kind: 'marine', serial: 7 }, ON_ENLISTED),
      firstScreen({ kind: 'tag', tag: 'pepe' }, ON_NEW),
      firstScreen({ kind: 'enlist' }, ON_NEW),
      firstScreen({ kind: 'enlist' }, ON_ENLISTED),
      firstScreen(null, ON_ENLISTED),
      firstScreen(null, OFF),
    ]).toEqual([{ name: 'roster', marine: 7, tag: null }, { name: 'roster', marine: null, tag: 'pepe' }, { name: 'welcome' }, { name: 'dogtag' }, { name: 'dogtag' }, { name: 'welcome' }]);
  });

  it("reads startapp from Telegram's start_param, else from the URL the bot's button opens", () => {
    // #then
    expect([startParam({ initDataUnsafe: { start_param: 'marine_42' } }, '?startapp=enlist'), startParam({ initDataUnsafe: {} }, '?startapp=tag_pepe'), startParam({ initDataUnsafe: {} }, '?startapp=evil')]).toEqual([
      { kind: 'marine', serial: 42 },
      { kind: 'tag', tag: 'pepe' },
      null,
    ]);
  });

  it('is the outside screen in a plain browser, where Telegram’s script loads without launch data', () => {
    // #then
    expect([telegramWebApp({}), telegramWebApp({ Telegram: { WebApp: { initData: '' } as TelegramWebApp } }), telegramWebApp({ Telegram: { WebApp: { initData: 'x' } as TelegramWebApp } })?.initData]).toEqual([null, null, 'x']);
  });
});

describe('the draw', () => {
  it('locks one hex every 0.8 s, left to right, after the answer', () => {
    // #then
    expect([0, 799, 800, 1600, 2399, 2400, 9000].map(lockedAt)).toEqual([0, 0, 1, 2, 2, 3, 3]);
  });

  it('fills the callsign in as the hexes lock', () => {
    // #then
    expect([1, 3].map((n) => callsignParts(MARINE.tags, n).map((p) => p.text).join('-'))).toEqual(['SERGEY-······-······', 'SERGEY-PEPE-LINKPILLED']);
  });

  it('prints a chance per draw and the tier banner', () => {
    // #then
    expect([chanceText(0.04412), tierBanner('rare', 88.4), tierBanner('common', 55.9)]).toEqual(['4.4%', 'RARE · RARER THAN 88%', 'COMMON · RARER THAN 55%']);
  });
});

describe('the bottom button', () => {
  it('is ENLIST on the welcome, DRAWING… and disabled in the draw, gold SHARE TO STORY on your dog tag', () => {
    // #then
    expect(['welcome', 'draw', 'dogtag'].map((s) => { const b = mainButton(s as 'welcome', ON_ENLISTED); return [b.text, b.active, b.color]; })).toEqual([
      ['ENLIST', true, '#2f62df'],
      ['DRAWING…', false, '#2f62df'],
      ['SHARE TO STORY', true, '#f5c451'],
    ]);
  });

  it('is MY DOG TAG on the roster once enlisted, else ENLIST, which waits for the gate', () => {
    // #then
    expect([mainButton('roster', ON_ENLISTED).text, mainButton('roster', ON_NEW).text, mainButton('welcome', { switch: 'on', marine: null, gate: 'join' }).active]).toEqual(['MY DOG TAG', 'ENLIST', false]);
  });

  it('hides while LinkMarines on Telegram is off, or before the session is in', () => {
    // #then
    expect([mainButton('welcome', OFF).visible, mainButton('roster', OFF).visible, mainButton('welcome', null).visible]).toEqual([false, false, false]);
  });
});

describe('the tilt', () => {
  it('turns the card up to ±8° each way from where the phone was first held, the streak crossing with it', () => {
    // #given
    const rest = { beta: 40, gamma: 0 };
    // #then
    expect([tilt(40, 0, rest), tilt(52, 12, rest), tilt(100, -90, rest)]).toEqual([
      { x: 0, y: 0, streak: 50 },
      { x: -4, y: 4, streak: 75 },
      { x: -MAX_TILT, y: -MAX_TILT, streak: 0 },
    ]);
  });

  it('stays off under prefers-reduced-motion, and where the phone reports no orientation', () => {
    // #then
    expect([tiltOn(false, true), tiltOn(true, true), tiltOn(false, false)]).toEqual([true, false, false]);
  });
});

describe('sharing', () => {
  const app = (platform: string, version: number, story = true) => ({ platform, isVersionAtLeast: (v: string) => version >= Number(v), shareToStory: story ? () => {} : undefined });

  it('shares to Story on Telegram for phones from Bot API 7.8, and falls back everywhere else', () => {
    // #then
    expect([app('ios', 8), app('android', 7.8), app('android_x', 8), app('tdesktop', 8), app('macos', 9), app('weba', 8), app('ios', 7.7), app('android', 8, false)].map(canShareToStory)).toEqual([true, true, true, false, false, false, false, false]);
  });

  it('posts the public Story card with the serial, the callsign and the enlist link', () => {
    // #then
    expect([storyUrl(42), storyText(MARINE)]).toEqual(['https://discord.ccip.dev/story/42.png', 'LINK MARINE #0042 · SERGEY-PEPE-LINKPILLED · Enlist: t.me/ccipdevbot/marines']);
  });

  it('shares the Marine’s page through Telegram’s share sheet', () => {
    // #then
    expect(shareLink(MARINE)).toBe(`https://t.me/share/url?url=${encodeURIComponent('https://ccip.dev/marines/0042/')}&text=${encodeURIComponent('LINK MARINE #0042 · sergey-pepe-linkpilled · RARE')}`);
  });
});

describe('the Mini App API client', () => {
  it('sends the launch data in a POST body, never in the URL', async () => {
    // #given
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(ON_NEW));
    }) as unknown as typeof fetch;
    // #when
    const answer = await tgApi('query_id=1&hash=abc', fetchFn).session();
    // #then
    expect([answer, seen[0]!.url, seen[0]!.init.method, JSON.parse(seen[0]!.init.body as string)]).toEqual([ON_NEW, 'https://discord.ccip.dev/tg/session', 'POST', { initData: 'query_id=1&hash=abc' }]);
  });

  it('gives null for the card while it is stamping, and the gate or the switch as answers, not errors', async () => {
    // #given
    const answering = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    // #when
    const results = [await tgApi('x', answering(202, { stamping: true })).card(), await tgApi('x', answering(403, { gate: 'join' })).enlist(), await tgApi('x', answering(409, { switch: 'off' })).enlist()];
    // #then
    expect(results).toEqual([null, { gate: 'join' }, { switch: 'off' }]);
  });
});
```

Create `site/test/tg-screens.test.ts`:

```ts
import type { MarineSummary } from '@ccip-dev/core/linkmarine';
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DogTagScreen from '../src/components/tg/DogTagScreen';
import Draw from '../src/components/tg/Draw';
import Outside from '../src/components/tg/Outside';
import Welcome from '../src/components/tg/Welcome';

const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** The text with no spaces at all: the callsign is set in parts. */
const squashed = (out: string) => text(out).replace(/\s+/g, '');
const noop = () => {};
const MARINE: MarineSummary = {
  serial: 4,
  callsign: 'comfy-painting-sergey',
  tags: ['comfy', 'painting', 'sergey'],
  tier: 'rare',
  percentile: 88.2,
  memes: [
    { tag: 'comfy', file: 'comfy.jpeg', count: 25 },
    { tag: 'painting', file: 'painting.jpeg', count: 1 },
    { tag: 'sergey', file: 'sergey.jpeg', count: 400 },
  ],
  volume: 1,
  cardReady: true,
};

describe('screen 1: welcome and gate', () => {
  const welcome = (props: Partial<Parameters<typeof Welcome>[0]> = {}) => renderToString(createElement(Welcome, { roster: ROSTER_FIXTURE, gate: 'ok', open: true, onJoin: noop, onCheck: noop, ...props }));

  it('says what enlisting is, seats the plank owners and counts the Marines and the tags', () => {
    // #when
    const out = welcome();
    // #then
    expect({
      copy: text(out).includes('ccip.dev · LinkMarines Enlist, Marine. Three tags from the LinkMarine meme vault become your callsign. One draw, forever. Rarer tags, rarer tier.'),
      seats: out.match(/class="tg-seat[ "]/g)?.length,
      taken: out.match(/class="tg-seat mr-metal-/g)?.length,
      left: text(out).includes('Plank-owner seats: 96 of 100 left'),
      counts: text(out).includes('4 Marines 8 tags in the vault'),
      gate: text(out).includes('Not in @ccipdev'),
    }).toEqual({ copy: true, seats: 30, taken: 4, left: true, counts: true, gate: false });
  });

  it('asks someone outside the gate chats to join @ccipdev, then check again', () => {
    // #then
    expect(text(welcome({ gate: 'join' }))).toContain('Not in @ccipdev yet? Join the channel to enlist, then Check again . Join Check again');
  });

  it('says it opens soon while the switch is off, and asks nobody to join', () => {
    // #when
    const out = text(welcome({ open: false, gate: 'join' }));
    // #then
    expect([out.includes('LinkMarines on Telegram opens soon'), out.includes('Not in @ccipdev')]).toEqual([true, false]);
  });
});

describe('screen 2: the draw', () => {
  const draw = (locked: number, marine: MarineSummary | null = MARINE, banner: 'rare' | 'legendary' | null = 'rare') => renderToString(createElement(Draw, { marine, roster: ROSTER_FIXTURE, locked, banner }));

  it('spins all three hexes until the draw is in', () => {
    // #when
    const out = draw(0, null);
    // #then
    expect([out.match(/tg-hex tg-spin/g)?.length, squashed(out).includes('······-······-······')]).toEqual([3, true]);
  });

  it('locks the hexes left to right, each with its meme, count and chance', () => {
    // #when
    const out = draw(2);
    // #then
    expect({ spinning: out.match(/tg-hex tg-spin/g)?.length, memes: [...out.matchAll(/memes\/([a-z]+)\.jpeg\.png/g)].map((m) => m[1]), copy: text(out) }).toMatchObject({ spinning: 1, memes: ['comfy', 'painting'] });
    expect(squashed(out)).toContain('COMFY-PAINTING-······');
    expect(text(out)).toContain('comfy · 25 memes · 10.0% painting · 1 meme · 5.0%');
  });

  it('ends a Rare draw on its banner, and a Common one without', () => {
    // #then
    expect([text(draw(3)).includes('⚠ RARE DRAW'), text(draw(2)).includes('RARE DRAW'), text(draw(3, MARINE, null)).includes('DRAW ')]).toEqual([true, false, false]);
  });
});

describe('screen 3: your dog tag', () => {
  const dogtag = (cardUrl: string | null) => renderToString(createElement(DogTagScreen, { marine: MARINE, cardUrl, tilt: null, onPack: noop, onShare: noop, onRoster: noop }));

  it('shows the tier banner, your card, the serial and callsign, the three buttons and who sees this card', () => {
    // #when
    const out = dogtag('blob:https://ccip.dev/card');
    // #then
    expect(text(out)).toContain('RARE · RARER THAN 88% LINK MARINE #0004 COMFY-PAINTING-SERGEY 🎖 Add the LinkMarines sticker pack 🔗 Share my page 🪖 See the roster Your card here shows your Telegram name and photo; only you see this version.');
    expect(out).toContain('src="blob:https://ccip.dev/card"');
  });

  it('shows the draw’s last frame while the card is being stamped', () => {
    // #when
    const out = dogtag(null);
    // #then
    expect([squashed(out).includes('COMFY-PAINTING-SERGEYStampingyourdogtag…'), out.includes('tg-spin'), out.includes('<img')]).toEqual([true, false, false]);
  });
});

describe('outside Telegram', () => {
  it('points to the Mini App in Telegram', () => {
    // #when
    const out = renderToString(createElement(Outside));
    // #then
    expect([text(out).includes('Open in Telegram'), out.includes('href="https://t.me/ccipdevbot/marines"')]).toEqual([true, true]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/tg.test.ts test/tg-screens.test.ts`
Expected: FAIL: `../src/lib/tg` and `../src/components/tg/…` do not exist.

- [ ] **Step 3: Add the rules.**

Create `site/src/lib/telegram-webapp.ts`:

```ts
/** The slice of Telegram's Mini App API (telegram-web-app.js; core.telegram.org/bots/webapps) the LinkMarines app uses. */
export interface BottomButtonParams {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
  has_shine_effect?: boolean;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  /** ios, android, android_x, tdesktop, macos, weba, webk, unigram, unknown. */
  platform: string;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  MainButton: { setParams(params: BottomButtonParams): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: { impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void; notificationOccurred(type: 'error' | 'success' | 'warning'): void };
  openTelegramLink(url: string): void;
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  DeviceOrientation?: { start(params: { refresh_rate?: number }, cb?: (started: boolean) => void): void; stop(): void; beta: number | null; gamma: number | null };
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
}

/** Telegram's Mini App object when the page runs inside Telegram with launch data; null in a plain browser, where the script still loads. */
export function telegramWebApp(win: { Telegram?: { WebApp?: TelegramWebApp } }): TelegramWebApp | null {
  const app = win.Telegram?.WebApp;
  return app && app.initData ? app : null;
}
```

Create `site/src/lib/tg.ts`:

```ts
import { MINI_APP_LINK, parseStartParam, rarerThan, type EnlistAnswer, type MarineSummary, type SessionAnswer, type StartParam, type Tier } from '@ccip-dev/core/linkmarine';
import { BOT_ORIGIN } from '../config';
import { marineTitle, marineUrl, shareLine } from './marines';
import type { TelegramWebApp } from './telegram-webapp';

/** The LinkMarines Mini App's rules: where it opens, how the draw plays, the tilt, sharing, and its API. */

export const TG_API = `${BOT_ORIGIN}/tg`;
/** The ccip.dev dark theme, for Telegram's header, background and bottom bar. */
export const TG_BACKGROUND = '#0a0f1e';
export const MAIN_BLUE = '#2f62df';
export const MAIN_GOLD = '#f5c451';
export const MAIN_GOLD_TEXT = '#1a1205';
export const CCIPDEV_LINK = 'https://t.me/ccipdev';

export type Screen = { name: 'welcome' } | { name: 'draw' } | { name: 'dogtag' } | { name: 'roster'; marine: number | null; tag: string | null };

/** The startapp value: Telegram's start_param for a direct link, else ?startapp= on the URL the bot's button opens. */
export function startParam(app: Pick<TelegramWebApp, 'initDataUnsafe'>, search: string): StartParam | null {
  return parseStartParam(app.initDataUnsafe.start_param ?? new URLSearchParams(search).get('startapp'));
}

/** Where the app opens: a Marine's or a tag's link opens the roster; otherwise an enlisted Marine's dog tag, else the welcome. */
export function firstScreen(start: StartParam | null, session: SessionAnswer): Screen {
  if (start?.kind === 'marine') return { name: 'roster', marine: start.serial, tag: null };
  if (start?.kind === 'tag') return { name: 'roster', marine: null, tag: start.tag };
  return session.switch === 'on' && session.marine ? { name: 'dogtag' } : { name: 'welcome' };
}

/** One hex locks every 0.8 s, left to right, once the draw's answer is in. */
export const DRAW_STEP_MS = 800;
/** After the last lock, the callsign (and a Rare or Legendary banner) holds this long before the dog tag. */
export const DRAW_HOLD_MS = 1_400;
export const lockedAt = (elapsedMs: number) => Math.max(0, Math.min(3, Math.floor(elapsedMs / DRAW_STEP_MS)));

/** The callsign as the draw fills it in, part by part: the locked tags in capitals, the rest dots. */
export function callsignParts(tags: readonly string[], locked: number): { text: string; locked: boolean }[] {
  return [0, 1, 2].map((i) => (i < locked && tags[i] ? { text: tags[i]!.toUpperCase(), locked: true } : { text: '······', locked: false }));
}

/** A tag's per-draw chance: "4.4%". */
export const chanceText = (chance: number) => `${(chance * 100).toFixed(1)}%`;

/** "RARE · RARER THAN 88%". */
export const tierBanner = (tier: Tier, percentile: number) => `${tier.toUpperCase()} · RARER THAN ${rarerThan(percentile)}%`;

/** Stories are in Telegram's phone apps only, from Bot API 7.8; anywhere else Share to Story becomes the share sheet. */
export function canShareToStory<T extends Pick<TelegramWebApp, 'platform' | 'isVersionAtLeast' | 'shareToStory'>>(app: T): app is T & Required<Pick<TelegramWebApp, 'shareToStory'>> {
  return typeof app.shareToStory === 'function' && app.isVersionAtLeast('7.8') && ['ios', 'android', 'android_x'].includes(app.platform);
}

export const storyUrl = (serial: number) => `${BOT_ORIGIN}/story/${serial}.png`;
export const storyText = (m: Pick<MarineSummary, 'serial' | 'callsign'>) => `${marineTitle(m.serial)} · ${m.callsign.toUpperCase()} · Enlist: ${MINI_APP_LINK.replace('https://', '')}`;
export const STORY_WIDGET = { url: MINI_APP_LINK, name: 'Enlist' } as const;

/** Telegram's share sheet with the Marine's page. */
export function shareLink(m: Pick<MarineSummary, 'serial' | 'callsign' | 'tier'>): string {
  return `https://t.me/share/url?url=${encodeURIComponent(marineUrl(m.serial))}&text=${encodeURIComponent(shareLine(m))}`;
}

/** The card turns at most this many degrees each way. */
export const MAX_TILT = 8;
/** Degrees of phone tilt for one degree of card tilt. */
const TILT_RATIO = 3;
const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
/** To a tenth of a degree, and never -0. */
const tenth = (v: number) => Math.round(v * 10) / 10 || 0;

/** The card's turn and the light streak's place (0–100%) for the phone's tilt off where it was first held. */
export function tilt(beta: number, gamma: number, rest: { beta: number; gamma: number }): { x: number; y: number; streak: number } {
  const x = clamp(-(beta - rest.beta) / TILT_RATIO, MAX_TILT);
  const y = clamp((gamma - rest.gamma) / TILT_RATIO, MAX_TILT);
  return { x: tenth(x), y: tenth(y), streak: Math.round(50 + (y / MAX_TILT) * 50) };
}

/** The tilt runs only where motion is welcome and the phone reports its orientation. */
export const tiltOn = (reducedMotion: boolean, orientation: boolean) => !reducedMotion && orientation;

export interface MainButtonState {
  text: string;
  color: string;
  textColor: string;
  active: boolean;
  visible: boolean;
  action: 'enlist' | 'story' | 'dogtag' | null;
}

const hidden: MainButtonState = { text: '', color: MAIN_BLUE, textColor: '#ffffff', active: false, visible: false, action: null };
const blue = (text: string, active: boolean, action: MainButtonState['action']): MainButtonState => ({ text, color: MAIN_BLUE, textColor: '#ffffff', active, visible: true, action });

/** Telegram's own bottom button for each screen; hidden while LinkMarines on Telegram is off, where "opens soon" stands instead. */
export function mainButton(screen: Screen['name'], session: SessionAnswer | null): MainButtonState {
  if (session?.switch !== 'on') return hidden;
  const enlist = blue('ENLIST', session.gate === 'ok', 'enlist');
  switch (screen) {
    case 'welcome':
      return enlist;
    case 'draw':
      return blue('DRAWING…', false, null);
    case 'dogtag':
      return { text: 'SHARE TO STORY', color: MAIN_GOLD, textColor: MAIN_GOLD_TEXT, active: true, visible: true, action: 'story' };
    case 'roster':
      return session.marine ? blue('MY DOG TAG', true, 'dogtag') : enlist;
  }
}

export type EnlistReply = EnlistAnswer | { gate: 'join' } | { switch: 'off' };

/** The Mini App API. Every call carries the launch data in its body, never in the URL. */
export function tgApi(initData: string, fetchFn: typeof fetch = (input, init) => fetch(input, init)) {
  const post = (path: string) => fetchFn(`${TG_API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData }) });
  return {
    async session(): Promise<SessionAnswer> {
      const res = await post('session');
      if (!res.ok) throw new Error(`session: HTTP ${res.status}`);
      return (await res.json()) as SessionAnswer;
    },
    async enlist(): Promise<EnlistReply> {
      const res = await post('enlist');
      if (!res.ok && res.status !== 403 && res.status !== 409) throw new Error(`enlist: HTTP ${res.status}`);
      return (await res.json()) as EnlistReply;
    },
    /** Your card's image, or null while it is still being stamped. */
    async card(): Promise<Blob | null> {
      const res = await post('card');
      if (res.status === 202) return null;
      if (!res.ok) throw new Error(`card: HTTP ${res.status}`);
      return res.blob();
    },
  };
}
```

- [ ] **Step 4: Add the screens.**

Screen 1, welcome and gate (the mockup's first phone):

Create `site/src/components/tg/Welcome.tsx`:

```tsx
import type { Gate } from '@ccip-dev/core/linkmarine';
import { PLANK_SEATS, plankSeats, type RosterFile } from '@ccip-dev/core/roster';

/** The welcome shows the first three rows of the hundred plank-owner seats. */
export const SEAT_PREVIEW = 30;

export function OpensSoon() {
  return (
    <p className="tg-soon" role="status">
      LinkMarines on Telegram opens soon
    </p>
  );
}

/** Screen 1: enlist, the plank-owner seats, the counts, and the gate's notice when it fails. */
export default function Welcome({ roster, gate, open, onJoin, onCheck }: { roster: RosterFile | null; gate: Gate; open: boolean; onJoin: () => void; onCheck: () => void }) {
  const seats = roster ? plankSeats(roster.marines) : [];
  const left = seats.filter((s) => s === null).length;
  return (
    <section className="tg-body" aria-labelledby="tg-welcome">
      <p className="tg-eyebrow">ccip.dev · LinkMarines</p>
      <h1 id="tg-welcome" className="tg-big">
        Enlist, Marine.
      </h1>
      <p className="tg-muted">Three tags from the LinkMarine meme vault become your callsign. One draw, forever. Rarer tags, rarer tier.</p>
      <ol className="tg-seats" aria-label={`The first ${SEAT_PREVIEW} plank-owner seats`}>
        {Array.from({ length: SEAT_PREVIEW }, (_, i) => {
          const m = seats[i] ?? null;
          return <li key={i} className={m ? `tg-seat mr-metal-${m.tier}` : 'tg-seat tg-open'} title={m?.callsign} />;
        })}
      </ol>
      <p className="tg-muted tg-center">
        Plank-owner seats: <b>{!roster ? '—' : left === 0 ? `all ${PLANK_SEATS} taken` : `${left} of ${PLANK_SEATS} left`}</b>
      </p>
      <div className="tg-stat">
        <div>
          <b>{roster ? roster.marines.length : '—'}</b>
          <span className="tg-muted">Marines</span>
        </div>
        <div>
          <b>{roster ? roster.snapshot.tags.length : '—'}</b>
          <span className="tg-muted">tags in the vault</span>
        </div>
      </div>
      {open && gate === 'join' && (
        <div className="tg-gate" role="status">
          <p>
            Not in @ccipdev yet? <b>Join the channel</b> to enlist, then <b>Check again</b>.
          </p>
          <div className="tg-gate-actions">
            <button type="button" className="tg-btn2" onClick={onJoin}>
              Join
            </button>
            <button type="button" className="tg-btn2" onClick={onCheck}>
              Check again
            </button>
          </div>
        </div>
      )}
      {!open && <OpensSoon />}
    </section>
  );
}
```

Screen 2, the draw:

Create `site/src/components/tg/Draw.tsx`:

```tsx
import type { MarineSummary } from '@ccip-dev/core/linkmarine';
import type { RosterFile } from '@ccip-dev/core/roster';
import { memeUrl } from '../../lib/marines';
import { callsignParts, chanceText } from '../../lib/tg';

/** The three meme hexes and the callsign under them, `locked` of them in: the draw, and the frame it ends on. */
export function Hexes({ marine, locked }: { marine: MarineSummary | null; locked: number }) {
  const shown = marine ? locked : 0;
  return (
    <>
      <div className="tg-hexes">
        {[0, 1, 2].map((i) => (i < shown ? <div key={i} className="tg-hex" style={{ backgroundImage: `url("${memeUrl(marine!.memes[i]!.file)}")` }} /> : <div key={i} className="tg-hex tg-spin" />))}
      </div>
      <div className="tg-tagrow">
        {[0, 1, 2].map((i) => (
          <span key={i}>{i < shown ? marine!.tags[i] : '· · ·'}</span>
        ))}
      </div>
      <p className="tg-callsign">
        {callsignParts(marine?.tags ?? [], shown).map((part, i) => (
          <span key={i}>
            {i > 0 && '-'}
            {part.locked ? part.text : <span className="tg-dim">{part.text}</span>}
          </span>
        ))}
      </p>
    </>
  );
}

/** Screen 2: the hexes spin until the draw is in, then lock one by one; each tag's memes and per-draw chance follow. */
export default function Draw({ marine, roster, locked, banner }: { marine: MarineSummary | null; roster: RosterFile | null; locked: number; banner: 'rare' | 'legendary' | null }) {
  const chances = new Map(roster?.snapshot.tags.map((t) => [t.tag, t.chance]) ?? []);
  const shown = marine ? locked : 0;
  return (
    <section className="tg-body" aria-live="polite">
      <p className="tg-eyebrow tg-center">Drawing your callsign…</p>
      <Hexes marine={marine} locked={locked} />
      {shown === 3 && banner && (
        <p className="tg-center">
          <span className={`tg-pill tg-pill-${banner}`}>⚠ {banner.toUpperCase()} DRAW</span>
        </p>
      )}
      <p className="tg-muted tg-center tg-odds">
        {marine?.memes.slice(0, shown).map((m) => (
          <span key={m.tag}>
            {m.tag} · {m.count} {m.count === 1 ? 'meme' : 'memes'}
            {chances.has(m.tag) ? ` · ${chanceText(chances.get(m.tag)!)}` : ''}
          </span>
        ))}
      </p>
    </section>
  );
}
```

Screen 3, your dog tag:

Create `site/src/components/tg/DogTagScreen.tsx`:

```tsx
import type { MarineSummary } from '@ccip-dev/core/linkmarine';
import type { CSSProperties } from 'react';
import { marineTitle } from '../../lib/marines';
import { tierBanner } from '../../lib/tg';
import { Hexes } from './Draw';

export interface Tilt {
  x: number;
  y: number;
  streak: number;
}

/** Screen 3: the tier banner, your own card (tilting when the phone does), and what to do with it. */
export default function DogTagScreen({ marine, cardUrl, tilt, onPack, onShare, onRoster }: { marine: MarineSummary; cardUrl: string | null; tilt: Tilt | null; onPack: () => void; onShare: () => void; onRoster: () => void }) {
  const turn = tilt ? ({ '--tilt-x': `${tilt.x}deg`, '--tilt-y': `${tilt.y}deg`, '--streak': `${tilt.streak}%` } as CSSProperties) : undefined;
  return (
    <section className="tg-body" aria-labelledby="tg-dogtag">
      <p className="tg-center">
        <span className={`tg-pill tg-pill-${marine.tier}`}>{tierBanner(marine.tier, marine.percentile)}</span>
      </p>
      {cardUrl ? (
        <div className={`tg-tilt${tilt ? ' tg-tilting' : ''} tg-streak-${marine.tier}`} style={turn}>
          <img className="tg-card" src={cardUrl} width={1200} height={675} alt={`Your dog tags: ${marineTitle(marine.serial)}, ${marine.callsign}`} />
        </div>
      ) : (
        <div className="tg-stamping" aria-busy="true">
          <Hexes marine={marine} locked={3} />
          <p className="tg-muted tg-center">Stamping your dog tag…</p>
        </div>
      )}
      <p id="tg-dogtag" className="tg-callsign tg-small">
        {marineTitle(marine.serial)}
        <br />
        <b>{marine.callsign.toUpperCase()}</b>
      </p>
      <button type="button" className="tg-btn2" onClick={onPack}>
        🎖 Add the LinkMarines sticker pack
      </button>
      <button type="button" className="tg-btn2" onClick={onShare}>
        🔗 Share my page
      </button>
      <button type="button" className="tg-btn2" onClick={onRoster}>
        🪖 See the roster
      </button>
      <p className="tg-muted tg-center">Your card here shows your Telegram name and photo; only you see this version.</p>
    </section>
  );
}
```

Outside Telegram:

Create `site/src/components/tg/Outside.tsx`:

```tsx
import { MINI_APP_LINK } from '@ccip-dev/core/linkmarine';

/** The Mini App opened in a plain browser: it lives in Telegram, so point there. */
export default function Outside() {
  return (
    <section className="tg-body tg-outside" aria-labelledby="tg-outside">
      <p className="tg-eyebrow">ccip.dev · LinkMarines</p>
      <h1 id="tg-outside" className="tg-big">
        LinkMarines lives in Telegram.
      </h1>
      <p className="tg-muted">Enlist, get your dog tag and browse the roster inside Telegram.</p>
      <a className="tg-main" href={MINI_APP_LINK}>
        Open in Telegram
      </a>
    </section>
  );
}
```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/tg.test.ts test/tg-screens.test.ts`
Expected: PASS (16 and 9 tests).

Run: `pnpm --filter @ccip-dev/site test`
Expected: PASS: Node 1,372 tests, workerd 36.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add site/src/lib/telegram-webapp.ts site/src/lib/tg.ts site/src/components/tg/Welcome.tsx site/src/components/tg/Draw.tsx site/src/components/tg/DogTagScreen.tsx site/src/components/tg/Outside.tsx site/test/tg.test.ts site/test/tg-screens.test.ts
git commit -m "feat(site): the LinkMarines Mini App's rules and its welcome, draw and dog tag screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The roster screen, and the Mini App's page

Screen 4 from the site's own roster pieces in a phone's column: the Wall, Constellation and Rarest tabs over the ticker, the compact Marine list (newest first), and today's most wanted as chips; a tag's sheet and a Marine's public web card as bottom sheets. The island ties the screens to Telegram: colours, the session, the deep link, the draw's timeline and haptics, the card's polling, the tilt, the MainButton and the BackButton. The page `/tg/` uses a new `bare` mode of the site's layout (no header, footer, pattern or analytics; Telegram's script in the head), may be framed by Telegram's web clients, and has a bundle budget.

**Files:**
- Create: `site/src/components/tg/TgRoster.tsx`, `site/src/components/tg/Sheets.tsx`, `site/src/components/tg/use-telegram.ts`, `site/src/components/tg/MiniApp.tsx`, `site/src/pages/tg/index.astro`, `site/src/styles/tg.css`
- Modify: `site/src/components/marines/RarestTen.tsx` (`onPickMarine`), `site/src/layouts/Base.astro` (`bare`, the `head` slot), `site/public/_headers` (`/tg/*`), `site/scripts/check-budgets.ts` (`tg/index.html`)
- Test: `site/test/tg-roster.test.ts`

**Interfaces:**
- Consumes: Task 10's whole `lib/tg.ts`, `telegramWebApp`, `type TelegramWebApp`, the screens; the site's `Ticker`, `Constellation`, `RarestTen`, `useRoster`, `useNow`, `memeUrl`, `tierName`, `marineTitle`, `webCardUrl`; core roster's `ALL_MARINES`, `wallMarines`, `mostWanted`, `tagBoard`; core's `stickerPackUrl`, `rarerThan`, `serialText`.
- Produces: `TgRoster({ roster, tab, now, open, onTab, onPickTag, onPickMarine })`, `type RosterTab = 'wall' | 'constellation' | 'rarest'`, `TG_WALL_PAGE = 40`; `TagSheet({ roster, tag, onClose })`, `MarineSheet({ roster, serial, onClose })`; `useMainButton(app, state, onClick)`, `useBackButton(app, visible, onBack)`, `useOwnCard(card, serial): string | null`, `useTilt(app, active): Tilt | null`; `MiniApp` (default export, the `client:load` island); `RarestTen({ roster, onPickMarine? })`; `Base` prop `bare?: boolean` and slot `head`; the page `https://ccip.dev/tg/`; `BUDGETS` gains `{ page: 'tg/index.html', maxGzipBytes: 130 * 1024 }`.

- [ ] **Step 1: Write the failing test.**

Create `site/test/tg-roster.test.ts`:

```ts
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RarestTen from '../src/components/marines/RarestTen';
import { MarineSheet, TagSheet } from '../src/components/tg/Sheets';
import TgRoster from '../src/components/tg/TgRoster';
import { BUDGETS } from '../scripts/check-budgets';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const noop = () => {};
const roster = (tab: 'wall' | 'constellation' | 'rarest', open = true) => renderToString(createElement(TgRoster, { roster: ROSTER_FIXTURE, tab, now: NOW, open, onTab: noop, onPickTag: noop, onPickMarine: noop }));

describe('screen 4: the roster', () => {
  it('has the Wall, Constellation and Rarest tabs over the ticker, the Wall on', () => {
    // #when
    const out = roster('wall');
    // #then
    expect({ tabs: [...out.matchAll(/role="tab"[^>]*>([A-Za-z]+)</g)].map((m) => m[1]), on: /aria-selected="true" class="on">Wall/.test(out), ticker: out.includes('mr-ticker') }).toEqual({
      tabs: ['Wall', 'Constellation', 'Rarest'],
      on: true,
      ticker: true,
    });
  });

  it('lists the Marines newest first, each with its first meme, tier and odds', () => {
    // #when
    const rows = [...roster('wall').matchAll(/class="tg-cs">(.*?)<\/span><span class="tg-muted">(.*?)<\/span>/g)].map((m) => text(`${m[1]} / ${m[2]}`).trim());
    // #then
    expect(rows).toEqual(['#0004 COMFY-PAINTING-SERGEY / Rare · rarer than 88%', '#0003 PEPE-SERGEY-PROPHECY / Uncommon · rarer than 66%', '#0002 PAINTING-SPACE-PROPHECY / Legendary · rarer than 97%', '#0001 SERGEY-PEPE-COMFY / Common · rarer than 31%']);
  });

  it('shows the site’s constellation and rarest ten on their tabs', () => {
    // #then
    expect([text(roster('constellation')).includes('The meme constellation.'), text(roster('rarest')).includes('The hardest draws in the corps.')]).toEqual([true, true]);
  });

  it('chips today’s most wanted tags, and says it opens soon while the switch is off', () => {
    // #when
    const out = roster('wall', false);
    // #then
    expect([text(out).includes('Today’s most wanted'), out.match(/class="tg-chip"/g)?.length, text(out).includes('LinkMarines on Telegram opens soon')]).toEqual([true, 2, true]);
  });
});

describe('the roster’s sheets', () => {
  it('gives a tag its memes, its chance per draw, its first discoverer and its carriers', () => {
    // #then
    expect(text(renderToString(createElement(TagSheet, { roster: ROSTER_FIXTURE, tag: 'pepe', onClose: noop })))).toContain('pepe · 100 memes · 20.0% per draw First discoverer: #0001 SERGEY-PEPE-COMFY · 2 Marines carry it');
  });

  it('says nobody has drawn an undrawn tag yet', () => {
    // #then
    expect(text(renderToString(createElement(TagSheet, { roster: ROSTER_FIXTURE, tag: 'zoomer', onClose: noop })))).toContain('zoomer · 1 meme · 5.0% per draw Nobody has drawn it yet.');
  });

  it('shows a Marine’s public web card, never their name', () => {
    // #when
    const out = renderToString(createElement(MarineSheet, { roster: ROSTER_FIXTURE, serial: 2, onClose: noop }));
    // #then
    expect([out.includes('src="https://discord.ccip.dev/web/2.png"'), text(out).includes('#0002 PAINTING-SPACE-PROPHECY Legendary · rarer than 97%')]).toEqual([true, true]);
  });

  it('opens nothing for a tag or a Marine the roster lacks', () => {
    // #then
    expect([renderToString(createElement(TagSheet, { roster: ROSTER_FIXTURE, tag: 'nope', onClose: noop })), renderToString(createElement(MarineSheet, { roster: ROSTER_FIXTURE, serial: 99, onClose: noop }))]).toEqual(['', '']);
  });
});

describe('the rarest ten, shared with the site', () => {
  it('still links each row to the Marine’s page', () => {
    // #then
    expect(renderToString(createElement(RarestTen, { roster: ROSTER_FIXTURE, onPickMarine: noop }))).toContain('href="/marines/0002/"');
  });
});

describe('the Mini App page', () => {
  it('has a bundle budget', () => {
    // #then
    expect(BUDGETS.find((b) => b.page === 'tg/index.html')?.maxGzipBytes).toBe(130 * 1024);
  });

  it('may be framed by Telegram’s web clients, unlike the rest of the site', () => {
    // #given
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    // #then
    expect(headers).toContain('/tg/*\n  ! X-Frame-Options\n  ! Content-Security-Policy\n');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/tg-roster.test.ts`
Expected: FAIL: `../src/components/tg/Sheets` and `../src/components/tg/TgRoster` do not exist.

- [ ] **Step 3: Let the rarest ten open a Marine in place.**

In `site/src/components/marines/RarestTen.tsx`, replace:

```tsx
export default function RarestTen({ roster }: { roster: RosterFile }) {
```

with:

```tsx
/** The ten rarest Marines. With `onPickMarine`, a row opens the Marine where it is instead of going to their page. */
export default function RarestTen({ roster, onPickMarine }: { roster: RosterFile; onPickMarine?: (serial: number) => void }) {
```

In `site/src/components/marines/RarestTen.tsx`, replace:

```tsx
            <a className="mr-rarest-row" href={marinePath(m.serial)}>
```

with:

```tsx
            <a
              className="mr-rarest-row"
              href={marinePath(m.serial)}
              onClick={
                onPickMarine &&
                ((e) => {
                  e.preventDefault();
                  onPickMarine(m.serial);
                })
              }
            >
```

- [ ] **Step 4: Add screen 4 and its sheets.**

Create `site/src/components/tg/TgRoster.tsx`:

```tsx
import { rarerThan, serialText } from '@ccip-dev/core/linkmarine';
import { ALL_MARINES, mostWanted, wallMarines, type RosterFile } from '@ccip-dev/core/roster';
import { useState } from 'react';
import { memeUrl, tierName } from '../../lib/marines';
import Constellation from '../marines/Constellation';
import RarestTen from '../marines/RarestTen';
import Ticker from '../marines/Ticker';
import { OpensSoon } from './Welcome';

export type RosterTab = 'wall' | 'constellation' | 'rarest';
const TABS: { id: RosterTab; label: string }[] = [
  { id: 'wall', label: 'Wall' },
  { id: 'constellation', label: 'Constellation' },
  { id: 'rarest', label: 'Rarest' },
];
/** The wall shows this many Marines at a time, newest first. */
export const TG_WALL_PAGE = 40;

/** Screen 4: the site's roster pieces in a phone's column: the tabs, the ticker, the Marines and today's most wanted. */
export default function TgRoster({ roster, tab, now, open, onTab, onPickTag, onPickMarine }: { roster: RosterFile; tab: RosterTab; now: Date; open: boolean; onTab: (tab: RosterTab) => void; onPickTag: (tag: string) => void; onPickMarine: (serial: number) => void }) {
  const [shown, setShown] = useState(TG_WALL_PAGE);
  const marines = wallMarines(roster.marines, { ...ALL_MARINES, order: 'newest' });
  return (
    <section className="tg-body tg-roster" aria-label="The roster">
      <div className="tg-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : undefined} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <Ticker roster={roster} />
      {tab === 'wall' && (
        <>
          {marines.length === 0 && <p className="tg-muted">No Marines yet. Be #0001.</p>}
          <ul className="tg-marines">
            {marines.slice(0, shown).map((m) => (
              <li key={m.serial}>
                <button type="button" className="tg-marine" onClick={() => onPickMarine(m.serial)}>
                  <span className="tg-sq" style={{ backgroundImage: `url("${memeUrl(m.memes[0].file)}")` }} aria-hidden="true" />
                  <span>
                    <span className="tg-cs">
                      #{serialText(m.serial)} {m.callsign.toUpperCase()}
                    </span>
                    <span className="tg-muted">
                      {tierName(m.tier)} · rarer than {rarerThan(m.percentile)}%
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {marines.length > shown && (
            <button type="button" className="tg-btn2" onClick={() => setShown(shown + TG_WALL_PAGE)}>
              Show more
            </button>
          )}
        </>
      )}
      {tab === 'constellation' && <Constellation roster={roster} onPickTag={onPickTag} />}
      {tab === 'rarest' && <RarestTen roster={roster} onPickMarine={onPickMarine} />}
      <p className="tg-eyebrow tg-wanted">Today’s most wanted</p>
      <div className="tg-chips">
        {mostWanted(roster, now).map((t) => (
          <button key={t.tag} type="button" className="tg-chip" onClick={() => onPickTag(t.tag)}>
            {t.tag}
          </button>
        ))}
      </div>
      {!open && <OpensSoon />}
    </section>
  );
}
```

Create `site/src/components/tg/Sheets.tsx`:

```tsx
import { rarerThan, serialText } from '@ccip-dev/core/linkmarine';
import { tagBoard, type RosterFile } from '@ccip-dev/core/roster';
import { marineTitle, tierName, webCardUrl } from '../../lib/marines';
import { chanceText } from '../../lib/tg';

function Close({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="tg-close" onClick={onClose} aria-label="Close">
      ✕
    </button>
  );
}

/** A tag's sheet: its memes, its chance per draw, who drew it first and how many carry it. */
export function TagSheet({ roster, tag, onClose }: { roster: RosterFile; tag: string; onClose: () => void }) {
  const t = tagBoard(roster).find((b) => b.tag === tag);
  if (!t) return null;
  return (
    <div className="tg-sheet" role="dialog" aria-label={`The ${tag} tag`}>
      <Close onClose={onClose} />
      <p>
        <b>{t.tag}</b> · {t.count} {t.count === 1 ? 'meme' : 'memes'} · {chanceText(t.chance)} per draw
      </p>
      <p className="tg-muted">
        {t.discoverer
          ? `First discoverer: #${serialText(t.discoverer.serial)} ${t.discoverer.callsign.toUpperCase()} · ${t.carriers} ${t.carriers === 1 ? 'Marine carries' : 'Marines carry'} it`
          : 'Nobody has drawn it yet. Draw it first and you’re its discoverer.'}
      </p>
    </div>
  );
}

/** A Marine's public web card: never their name or photo. */
export function MarineSheet({ roster, serial, onClose }: { roster: RosterFile; serial: number; onClose: () => void }) {
  const m = roster.marines.find((x) => x.serial === serial);
  if (!m) return null;
  return (
    <div className="tg-sheet tg-sheet-card" role="dialog" aria-label={marineTitle(serial)}>
      <Close onClose={onClose} />
      <img className="tg-card" src={webCardUrl(serial)} width={1200} height={675} alt={`The dog tags of ${marineTitle(serial)}, ${m.callsign}`} />
      <p className="tg-cs">
        #{serialText(serial)} {m.callsign.toUpperCase()}
      </p>
      <p className="tg-muted">
        {tierName(m.tier)} · rarer than {rarerThan(m.percentile)}%
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Add the island.**

Telegram's buttons, the card's polling and the tilt, as hooks:

Create `site/src/components/tg/use-telegram.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { webCardUrl } from '../../lib/marines';
import { tilt, tiltOn, type MainButtonState } from '../../lib/tg';
import type { TelegramWebApp } from '../../lib/telegram-webapp';
import type { Tilt } from './DogTagScreen';

/** Telegram's bottom button, set for the screen; one click handler, kept current. */
export function useMainButton(app: TelegramWebApp, state: MainButtonState, onClick: () => void): void {
  const click = useRef(onClick);
  click.current = onClick;
  useEffect(() => {
    app.MainButton.setParams({ text: state.text || ' ', color: state.color, text_color: state.textColor, is_active: state.active, is_visible: state.visible });
  }, [app, state.text, state.color, state.textColor, state.active, state.visible]);
  useEffect(() => {
    const handler = () => click.current();
    app.MainButton.onClick(handler);
    return () => app.MainButton.offClick(handler);
  }, [app]);
}

/** Telegram's back button, shown while there is somewhere to go back to. */
export function useBackButton(app: TelegramWebApp, visible: boolean, onBack: () => void): void {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const handler = () => back.current();
    app.BackButton.onClick(handler);
    return () => app.BackButton.offClick(handler);
  }, [app]);
  useEffect(() => (visible ? app.BackButton.show() : app.BackButton.hide()), [app, visible]);
}

const CARD_POLL_MS = 2_000;
/** About a minute of polling; after that the public web card stands in. */
const CARD_POLLS = 30;

/** Your own card as an object URL, polled while it is being stamped; the public web card if it never comes. */
export function useOwnCard(card: () => Promise<Blob | null>, serial: number | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (serial === null) return;
    let stopped = false;
    let made: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (left: number) => {
      try {
        const blob = await card();
        if (stopped) return;
        if (blob) {
          made = URL.createObjectURL(blob);
          setUrl(made);
          return;
        }
      } catch (err) {
        console.warn(`card: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (stopped) return;
      if (left <= 1) setUrl(webCardUrl(serial));
      else timer = setTimeout(() => void poll(left - 1), CARD_POLL_MS);
    };
    void poll(CARD_POLLS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (made) URL.revokeObjectURL(made);
    };
  }, [card, serial]);
  return url;
}

/** The tilt shimmer: Telegram's DeviceOrientation where it has one (Bot API 8.0), else the browser's; never under reduced motion. */
export function useTilt(app: TelegramWebApp, active: boolean): Tilt | null {
  const [state, setState] = useState<Tilt | null>(null);
  useEffect(() => {
    if (!active) return;
    const telegram = app.isVersionAtLeast('8.0') ? app.DeviceOrientation : undefined;
    if (!tiltOn(window.matchMedia('(prefers-reduced-motion: reduce)').matches, Boolean(telegram) || 'DeviceOrientationEvent' in window)) return;
    let rest: { beta: number; gamma: number } | null = null;
    const apply = (beta: number | null, gamma: number | null) => {
      if (beta === null || gamma === null) return;
      rest ??= { beta, gamma };
      setState(tilt(beta, gamma, rest));
    };
    if (telegram) {
      const changed = () => apply(telegram.beta, telegram.gamma);
      app.onEvent('deviceOrientationChanged', changed);
      telegram.start({ refresh_rate: 50 });
      return () => {
        app.offEvent('deviceOrientationChanged', changed);
        telegram.stop();
      };
    }
    const changed = (e: DeviceOrientationEvent) => apply(e.beta, e.gamma);
    window.addEventListener('deviceorientation', changed);
    return () => window.removeEventListener('deviceorientation', changed);
  }, [app, active]);
  return state;
}
```

The app: inside Telegram the four screens, in a plain browser the pointer to Telegram:

Create `site/src/components/tg/MiniApp.tsx`:

```tsx
import { stickerPackUrl, type EnlistAnswer, type SessionAnswer } from '@ccip-dev/core/linkmarine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CCIPDEV_LINK, canShareToStory, DRAW_HOLD_MS, DRAW_STEP_MS, firstScreen, mainButton, shareLink, startParam, STORY_WIDGET, storyText, storyUrl, TG_BACKGROUND, tgApi, type EnlistReply, type Screen } from '../../lib/tg';
import { telegramWebApp, type TelegramWebApp } from '../../lib/telegram-webapp';
import { useNow } from '../hooks';
import { useRoster } from '../marines/use-roster';
import DogTagScreen from './DogTagScreen';
import Draw from './Draw';
import Outside from './Outside';
import { MarineSheet, TagSheet } from './Sheets';
import TgRoster, { type RosterTab } from './TgRoster';
import { useBackButton, useMainButton, useOwnCard, useTilt } from './use-telegram';
import Welcome from './Welcome';

type Sheet = { tag: string } | { marine: number } | null;

function InTelegram({ app }: { app: TelegramWebApp }) {
  const api = useMemo(() => tgApi(app.initData), [app]);
  const { roster } = useRoster();
  const now = useNow(60_000) ?? new Date();
  const [session, setSession] = useState<SessionAnswer | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [stack, setStack] = useState<Screen[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tab, setTab] = useState<RosterTab>('wall');
  const [drawn, setDrawn] = useState<EnlistAnswer | null>(null);
  const [locked, setLocked] = useState(0);
  const screen = stack.at(-1) ?? null;
  const open = session?.switch === 'on';
  const marine = session?.switch === 'on' ? session.marine : null;

  useEffect(() => {
    app.ready();
    app.expand();
    app.setHeaderColor(TG_BACKGROUND);
    app.setBackgroundColor(TG_BACKGROUND);
    app.setBottomBarColor?.(TG_BACKGROUND);
  }, [app]);

  const loadSession = useCallback(async () => {
    try {
      const answer = await api.session();
      setSession(answer);
      setUnreachable(false);
      return answer;
    } catch (err) {
      console.warn(`session: ${err instanceof Error ? err.message : String(err)}`);
      setUnreachable(true);
      return null;
    }
  }, [api]);

  useEffect(() => {
    void loadSession().then((answer) => {
      if (!answer) return;
      const first = firstScreen(startParam(app, window.location.search), answer);
      setStack([first]);
      if (first.name === 'roster') setSheet(first.marine !== null ? { marine: first.marine } : first.tag !== null ? { tag: first.tag } : null);
    });
  }, [app, loadSession]);

  const go = (next: Screen) => setStack((s) => [...s, next]);
  const back = () => (sheet ? setSheet(null) : setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)));

  const enlist = async () => {
    setDrawn(null);
    setLocked(0);
    go({ name: 'draw' });
    let reply: EnlistReply;
    try {
      reply = await api.enlist();
    } catch (err) {
      console.warn(`enlist: ${err instanceof Error ? err.message : String(err)}`);
      setStack([{ name: 'welcome' }]);
      return;
    }
    if ('switch' in reply || 'gate' in reply) {
      setSession('switch' in reply ? reply : { switch: 'on', marine: null, gate: 'join' });
      setStack([{ name: 'welcome' }]);
      return;
    }
    setSession({ switch: 'on', marine: reply.marine, gate: 'ok' });
    if (reply.already) setStack([{ name: 'dogtag' }]);
    else setDrawn(reply);
  };

  useEffect(() => {
    if (!drawn) return;
    const timers = [1, 2, 3].map((n) =>
      setTimeout(() => {
        setLocked(n);
        app.HapticFeedback.impactOccurred('medium');
        if (n === 3 && drawn.banner) app.HapticFeedback.notificationOccurred('success');
      }, n * DRAW_STEP_MS),
    );
    timers.push(setTimeout(() => setStack([{ name: 'dogtag' }]), 3 * DRAW_STEP_MS + DRAW_HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [drawn, app]);

  const onDogTag = screen?.name === 'dogtag' && marine !== null;
  const cardUrl = useOwnCard(api.card, onDogTag ? marine.serial : null);
  const tilt = useTilt(app, onDogTag && cardUrl !== null);

  const button = mainButton(screen?.name ?? 'welcome', screen ? session : null);
  useMainButton(app, button, () => {
    if (button.action === 'enlist') void enlist();
    else if (button.action === 'dogtag') go({ name: 'dogtag' });
    else if (button.action === 'story' && marine) {
      if (canShareToStory(app)) app.shareToStory(storyUrl(marine.serial), { text: storyText(marine), widget_link: STORY_WIDGET });
      else app.openTelegramLink(shareLink(marine));
    }
  });
  useBackButton(app, stack.length > 1 || sheet !== null, back);

  if (!screen) {
    return unreachable ? (
      <p className="tg-state" role="status">
        LinkMarines is out of reach right now. Close the app and open it again in a minute.
      </p>
    ) : (
      <p className="tg-state" aria-busy="true">
        Loading…
      </p>
    );
  }
  return (
    <>
      {screen.name === 'welcome' && <Welcome roster={roster} gate={session?.switch === 'on' ? session.gate : 'join'} open={open} onJoin={() => app.openTelegramLink(CCIPDEV_LINK)} onCheck={() => void loadSession()} />}
      {screen.name === 'draw' && <Draw marine={drawn?.marine ?? null} roster={roster} locked={locked} banner={drawn?.banner ?? null} />}
      {screen.name === 'dogtag' && marine && (
        <DogTagScreen
          marine={marine}
          cardUrl={cardUrl}
          tilt={tilt}
          onPack={() => app.openTelegramLink(stickerPackUrl(marine.volume))}
          onShare={() => app.openTelegramLink(shareLink(marine))}
          onRoster={() => go({ name: 'roster', marine: null, tag: null })}
        />
      )}
      {screen.name === 'roster' &&
        (roster ? (
          <TgRoster roster={roster} tab={tab} now={now} open={open} onTab={setTab} onPickTag={(tag) => setSheet({ tag })} onPickMarine={(serial) => setSheet({ marine: serial })} />
        ) : (
          <p className="tg-state" aria-busy="true">
            Loading the roster…
          </p>
        ))}
      {sheet && roster && ('tag' in sheet ? <TagSheet roster={roster} tag={sheet.tag} onClose={() => setSheet(null)} /> : <MarineSheet roster={roster} serial={sheet.marine} onClose={() => setSheet(null)} />)}
    </>
  );
}

/** The LinkMarines Mini App: inside Telegram the four screens, in a plain browser a pointer to Telegram. */
export default function MiniApp() {
  const [app, setApp] = useState<TelegramWebApp | null | undefined>(undefined);
  useEffect(() => setApp(telegramWebApp(window as unknown as Parameters<typeof telegramWebApp>[0])), []);
  if (app === undefined) return null;
  return <div className="tg">{app ? <InTelegram app={app} /> : <Outside />}</div>;
}
```

- [ ] **Step 6: Add the page, its look, its headers and its budget.**

The layout's bare mode leaves out the header, the footer, the background pattern and Umami, and takes Telegram's script in a `head` slot:

In `site/src/layouts/Base.astro`, replace:

```astro
  /** Keeps an unlisted page out of search results. */
  noindex?: boolean;
}

const { title, description, cardPath = null, noindex = false } = Astro.props;
```

with:

```astro
  /** Keeps an unlisted page out of search results. */
  noindex?: boolean;
  /** The page alone: no header, footer, background pattern or analytics (the Telegram Mini App). */
  bare?: boolean;
}

const { title, description, cardPath = null, noindex = false, bare = false } = Astro.props;
```

In `site/src/layouts/Base.astro`, replace:

```astro
    {UMAMI_WEBSITE_ID && <script is:inline defer src={UMAMI_SRC} data-website-id={UMAMI_WEBSITE_ID}></script>}
  </head>
  <body>
    <div class="ground" aria-hidden="true"></div>
    <Header />
    <main class="page"><slot /></main>
    <Footer />
  </body>
```

with:

```astro
    {UMAMI_WEBSITE_ID && !bare && <script is:inline defer src={UMAMI_SRC} data-website-id={UMAMI_WEBSITE_ID}></script>}
    <slot name="head" />
  </head>
  {bare ? (
    <body class="bare"><slot /></body>
  ) : (
    <body>
      <div class="ground" aria-hidden="true"></div>
      <Header />
      <main class="page"><slot /></main>
      <Footer />
    </body>
  )}
```

Create `site/src/pages/tg/index.astro`:

```astro
---
import MiniApp from '../../components/tg/MiniApp';
import Base from '../../layouts/Base.astro';
import '../../styles/marines.css';
import '../../styles/tg.css';
---
<Base title="LinkMarines on Telegram" description="The LinkMarines Mini App: enlist, your dog tag and the roster, inside Telegram." noindex bare>
  <script is:inline slot="head" src="https://telegram.org/js/telegram-web-app.js"></script>
  <MiniApp client:load />
</Base>
```

The mockup's CSS, for the app's own classes, and the roster pieces narrowed to the column:

Create `site/src/styles/tg.css`:

```css
/* The LinkMarines Mini App (/tg/): the four screens of the approved mockup, in Telegram's webview. */
body.bare { min-height: 100vh; background: radial-gradient(ellipse at 30% 0%, #1d3a7a 0%, transparent 55%), #0a0f1e; color: #e8eaed; font-family: var(--font-sans); }
.tg { max-width: 480px; margin: 0 auto; padding: 0 0 24px; }
.tg-body { padding: 16px 18px; }
.tg-state { padding: 40px 18px; color: #8a96ad; text-align: center; }
.tg-eyebrow { margin: 0; font-size: 10px; letter-spacing: 0.18em; color: #8a96ad; text-transform: uppercase; }
.tg-big { font-size: 28px; font-weight: 800; letter-spacing: 0.02em; margin: 6px 0 4px; }
.tg-muted { color: #8a96ad; font-size: 12px; line-height: 1.5; margin: 0; }
.tg-muted b { color: #e8eaed; }
.tg-center { text-align: center; }
.tg-dim { color: #8a96ad; }

.tg-seats { display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; margin: 14px 0 6px; padding: 0; list-style: none; }
.tg-seat { aspect-ratio: 1; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
.tg-open { background: #1b2540; }
.tg-stat { display: flex; gap: 10px; margin: 14px 0; }
.tg-stat div { flex: 1; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 10px; padding: 10px; }
.tg-stat b { display: block; font-size: 18px; }
.tg-gate { border: 1px solid rgba(245, 196, 81, 0.35); border-radius: 10px; padding: 10px; color: #f5c451; font-size: 12px; }
.tg-gate p { margin: 0 0 8px; }
.tg-gate-actions { display: flex; gap: 8px; }
.tg-gate-actions .tg-btn2 { flex: 1; margin: 0; }
.tg-soon { margin: 18px 12px 0; padding: 14px; border-radius: 12px; text-align: center; font-weight: 700; letter-spacing: 0.04em; font-size: 14px; background: rgba(255, 255, 255, 0.06); color: #9fb0d0; }

.tg-hexes { display: flex; justify-content: center; gap: 10px; margin: 22px 0 14px; }
.tg-hex { width: 74px; height: 84px; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); background: #1b2540 center / cover no-repeat; }
.tg-spin { background: repeating-linear-gradient(180deg, #26355e 0 14px, #1b2540 14px 28px); filter: blur(1.2px); animation: tg-spin 0.35s linear infinite; }
@keyframes tg-spin { from { background-position: 0 0; } to { background-position: 0 28px; } }
.tg-tagrow { display: flex; justify-content: center; gap: 10px; font: 11px var(--font-mono); color: #c9d6f5; }
.tg-tagrow span { width: 74px; text-align: center; }
.tg-callsign { font: 16px var(--font-mono); text-align: center; letter-spacing: 0.06em; margin: 16px 0 0; }
.tg-callsign.tg-small { font-size: 13px; margin: 10px 0; }
.tg-odds { margin-top: 28px; }
.tg-odds span { display: block; }

.tg-pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: 0.16em; color: #fff; }
.tg-pill-common { background: linear-gradient(120deg, #4a5260, #c9d1dc 50%, #5b6472); color: #1d2430; }
.tg-pill-uncommon { background: linear-gradient(120deg, #5a3416, #c98a4b 40%, #f0c08a 60%, #4e2c12); }
.tg-pill-rare { background: linear-gradient(120deg, #2b3a8f, #4f7cff 30%, #b07cff 60%, #ffd27a); }
.tg-pill-legendary { background: linear-gradient(120deg, #6e4a0c, #f5c451 35%, #fff6cf 55%, #c8901e); color: #1a1205; }
.tg-card { width: 100%; height: auto; border-radius: 10px; display: block; border: 1px solid rgba(255, 255, 255, 0.08); }
.tg-tilt { position: relative; border-radius: 10px; overflow: hidden; transform: perspective(700px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)); transition: transform 0.12s linear; }
.tg-tilting::after { content: ''; position: absolute; inset: -20%; pointer-events: none; mix-blend-mode: screen; background: linear-gradient(105deg, transparent calc(var(--streak, 50%) - 12%), var(--metal, rgba(255, 255, 255, 0.35)) var(--streak, 50%), transparent calc(var(--streak, 50%) + 12%)); }
.tg-streak-common { --metal: rgba(228, 233, 240, 0.4); } .tg-streak-uncommon { --metal: rgba(240, 192, 138, 0.4); } .tg-streak-rare { --metal: rgba(195, 184, 255, 0.45); } .tg-streak-legendary { --metal: rgba(255, 233, 168, 0.5); }
.tg-btn2 { display: block; width: 100%; margin: 8px 0; padding: 11px; border-radius: 10px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #e8eaed; font: 13px var(--font-sans); text-align: center; cursor: pointer; }

.tg-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.tg-tabs button { flex: 1; font: 11px var(--font-sans); padding: 7px 0; border: 0; border-radius: 8px; background: rgba(255, 255, 255, 0.05); color: #9fb0d0; cursor: pointer; }
.tg-tabs button.on { background: #2f62df; color: #fff; }
.tg .mr-ticker { height: auto; margin: 0 0 12px; background: none; border-block: 1px solid rgba(255, 255, 255, 0.06); }
.tg .mr-ticker-label { display: none; }
.tg .mr-tk, .tg .mr-tk small { font: 600 10px/28px var(--font-mono); color: #f5c451; }
.tg .mr-tk::after { margin: 0 12px; }
.tg .mr-tk-k { font-size: 9px; color: #8a96ad; }
.tg .mr-section { padding: 0; margin: 0 0 12px; }
.tg .mr-section h2 { font-size: 16px; margin: 4px 0; }
.tg .mr-lead { font-size: 12px; }
.tg .mr-stars-wide { display: none; }
.tg .mr-stars-narrow { display: block; }
.tg .mr-rarest-row { grid-template-columns: 28px minmax(0, 1fr) auto; font-size: 11px; }
.tg .mr-rarest-row .mr-score, .tg .mr-rarest-row .mr-odds { display: none; }
.tg-marines { margin: 0; padding: 0; list-style: none; }
.tg-marine { display: flex; gap: 10px; align-items: center; width: 100%; padding: 9px; margin-bottom: 8px; border: 0; border-radius: 10px; background: rgba(255, 255, 255, 0.04); color: #e8eaed; text-align: left; cursor: pointer; }
.tg-marine > span:last-child { display: flex; flex-direction: column; }
.tg-sq { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 8px; background: #1b2540 center / cover; }
.tg-cs { font: 11px var(--font-mono); }
.tg-wanted { margin-top: 10px; }
.tg-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.tg-chip { font-size: 10px; padding: 4px 8px; border-radius: 999px; border: 1px dashed #f5c451; background: none; color: #f5c451; cursor: pointer; }
.tg-sheet { position: fixed; left: 10px; right: 10px; bottom: 16px; max-width: 460px; margin: 0 auto; background: #121a30; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 14px; padding: 12px 36px 12px 12px; font-size: 12px; box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5); }
.tg-sheet p { margin: 0 0 4px; }
.tg-sheet-card { padding: 12px; }
.tg-sheet-card .tg-card { margin-bottom: 8px; }
.tg-close { position: absolute; top: 6px; right: 8px; border: 0; background: none; color: #8a96ad; font-size: 14px; cursor: pointer; }
.tg-outside { padding-top: 48px; }
.tg-main { display: block; margin: 24px 0 0; padding: 14px; border-radius: 12px; text-align: center; font-weight: 700; letter-spacing: 0.04em; background: #2f62df; color: #fff; }

@media (prefers-reduced-motion: reduce) {
  .tg-spin { animation: none; }
  .tg-tilt { transform: none; transition: none; }
  .tg-tilting::after { display: none; }
}
```

At the end of `site/public/_headers`, add:

```text
# The Telegram Mini App runs in an iframe on Telegram's web clients, so it may be framed. It does nothing outside Telegram.
/tg/*
  ! X-Frame-Options
  ! Content-Security-Policy
```

In `site/scripts/check-budgets.ts`, replace:

```ts
  { page: 'replay/index.html', maxGzipBytes: 200 * 1024 },
];
```

with:

```ts
  { page: 'replay/index.html', maxGzipBytes: 200 * 1024 },
  { page: 'tg/index.html', maxGzipBytes: 130 * 1024 },
];
```

- [ ] **Step 7: Run the tests, build the site, and look at the page.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/tg-roster.test.ts test/roster-view.test.ts test/headers.test.ts`
Expected: PASS (11, 15 and 5 tests: the site's roster and its headers are unchanged).

Run: `pnpm --filter @ccip-dev/site build`
Expected: `check-build: … pages OK` and the budgets, among them `tg/index.html: 108.4 KB gzipped JavaScript in 12 files (budget 130 KB)` (within a few KB).

Run: `grep -o '<script[^>]*telegram[^>]*>' site/dist/tg/index.html; grep -c 'analytics.jivx.com' site/dist/tg/index.html site/dist/marines/index.html; grep -o '<meta name="robots"[^>]*>' site/dist/tg/index.html; grep -o '<body[^>]*>' site/dist/tg/index.html`
Expected: `<script src="https://telegram.org/js/telegram-web-app.js">`; `site/dist/tg/index.html:0` and `site/dist/marines/index.html:1`; `<meta name="robots" content="noindex">`; `<body class="bare">`.

Run: `pnpm --filter @ccip-dev/site dev`, then open `http://localhost:4321/tg/` in a browser.
Expected: the outside screen: "ccip.dev · LinkMarines", "LinkMarines lives in Telegram.", and a blue **Open in Telegram** button to `https://t.me/ccipdevbot/marines`, on the mockup's dark blue ground, with no site header or footer. Stop the dev server.

- [ ] **Step 8: Run the site's tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site test`
Expected: PASS: Node 1,383 tests, workerd 36.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add site/src/components/tg/TgRoster.tsx site/src/components/tg/Sheets.tsx site/src/components/tg/use-telegram.ts site/src/components/tg/MiniApp.tsx site/src/pages/tg/index.astro site/src/styles/tg.css site/src/components/marines/RarestTen.tsx site/src/layouts/Base.astro site/public/_headers site/scripts/check-budgets.ts site/test/tg-roster.test.ts
git commit -m "feat(site): the LinkMarines Mini App at /tg/, with the roster screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The site: Enlist on Telegram, the sticker packs, and `?tag=`

Once the switch is on, the roster page's hero and its call to enlist, and every Marine's page, show **Enlist on Discord** (`/discord/`) and **Enlist on Telegram** (`https://t.me/ccipdevbot/marines?startapp=enlist`) side by side; the hero's line names both platforms; the call to enlist links every sticker pack that holds Marines; and `/discord` offers the Mini App. The roster page reads `?tag=<tag>` and opens the wall on that tag. While the switch is off the site renders what it renders today. The roster page's call to enlist moves into `RosterPage`, unchanged when off, so it can read the roster.

**Files:**
- Create: `site/src/lib/telegram.ts`, `site/src/components/marines/Enlist.tsx`
- Modify: `site/src/components/marines/RosterView.tsx`, `site/src/components/marines/MarineView.tsx`, `site/src/pages/marines/index.astro`, `site/src/pages/marines/marine.astro`, `site/src/pages/discord.astro`, `site/src/styles/marines.css`
- Test: `site/test/enlist.test.ts`

**Interfaces:**
- Consumes: Task 4's `miniAppLink`, `stickerPackUrl`, `stickerVolume`; Task 9's `TELEGRAM_BOT` in the site build's env; the site's `DISCORD_INSTALL_URL`, `DISCORD_PATH`.
- Produces: `site/src/lib/telegram.ts`: `telegramOpen(value: string | undefined): boolean`, `TELEGRAM_ENLIST_URL`, `stickerPacks(roster): { volume; url }[]`, `tagFromSearch(search): string | null`; `Enlist.tsx`: `EnlistButtons()`, `EnlistCta({ roster, telegram })`; `RosterPage({ roster, failed, now, telegram?, tag? })`, `RosterView({ telegram? })`; `MarinePage({ roster, failed, serial, telegram? })`, `MarineView({ telegram? })`.

- [ ] **Step 1: Write the failing test.**

Create `site/test/enlist.test.ts`:

```ts
import type { RosterFile } from '@ccip-dev/core/roster';
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarinePage } from '../src/components/marines/MarineView';
import { RosterPage } from '../src/components/marines/RosterView';
import { stickerPacks, tagFromSearch, telegramOpen } from '../src/lib/telegram';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const roster = (props: Partial<Parameters<typeof RosterPage>[0]> = {}) => renderToString(createElement(RosterPage, { roster: ROSTER_FIXTURE, failed: false, now: NOW, ...props }));
const TELEGRAM = 'href="https://t.me/ccipdevbot/marines?startapp=enlist"';
/** The fixture with one more Marine, #121: the first of Vol. 2. */
const VOL2: RosterFile = { ...ROSTER_FIXTURE, marines: [...ROSTER_FIXTURE.marines, { ...ROSTER_FIXTURE.marines[0]!, serial: 121, callsign: 'samurai-zoomer-pepe', tags: ['samurai', 'zoomer', 'pepe'] }] };

describe('enlisting from the site', () => {
  it('keeps the roster page as it is, Discord alone, until LinkMarines opens on Telegram', () => {
    // #when
    const out = roster();
    // #then
    expect([text(out).includes('Enlist in any server with /enlist'), out.includes(TELEGRAM), text(out).includes('Add ccip.dev to Discord'), out.includes('t.me/addstickers')]).toEqual([true, false, true, false]);
  });

  it('then names both platforms in the hero and the call to enlist, with Enlist on Discord and Enlist on Telegram side by side', () => {
    // #when
    const out = roster({ telegram: true });
    // #then
    expect({
      lead: text(out).includes('Every Marine who has enlisted with the ccip.dev bot, on Discord or Telegram, by callsign.'),
      discordOnly: text(out).includes('Enlist in any server'),
      telegram: out.split(TELEGRAM).length - 1,
      discord: out.split('href="/discord/">Enlist on Discord').length - 1,
    }).toEqual({ lead: true, discordOnly: false, telegram: 2, discord: 2 });
  });

  it('links every sticker pack that holds Marines', () => {
    // #when
    const out = roster({ roster: VOL2, telegram: true });
    // #then
    expect(text(out)).toContain('Every Marine is a sticker: LinkMarines Vol. 1 · LinkMarines Vol. 2');
    expect(out).toContain('href="https://t.me/addstickers/linkmarines2_by_ccipdevbot"');
  });

  it('offers both on a Marine’s page', () => {
    // #when
    const [off, on] = [false, true].map((telegram) => renderToString(createElement(MarinePage, { roster: ROSTER_FIXTURE, failed: false, serial: 2, telegram })));
    // #then
    expect([text(off!).includes('Enlist yours'), off!.includes(TELEGRAM), text(on!).includes('Enlist on Discord Enlist on Telegram'), text(on!).includes('Enlist yours')]).toEqual([true, false, true, false]);
  });

  it('reads the build’s TELEGRAM_BOT', () => {
    // #then
    expect([telegramOpen('on'), telegramOpen('off'), telegramOpen(undefined)]).toEqual([true, false, false]);
  });
});

describe('the roster page’s ?tag=', () => {
  it('opens the wall on the tag', () => {
    // #then
    expect(text(roster({ tag: 'pepe' }))).toContain('2 Marines carry “pepe”');
  });

  it('reads only what can be a tag', () => {
    // #then
    expect(['?tag=pepe', '?tag=based_af', '?tag=Pepe', '?tag=%3Cscript%3E', '?other=1', ''].map(tagFromSearch)).toEqual(['pepe', 'based_af', null, null, null, null]);
  });
});

describe('the sticker packs', () => {
  it('runs from Vol. 1 to the newest Marine’s volume, and none on an empty roster', () => {
    // #then
    expect([stickerPacks(ROSTER_FIXTURE).map((p) => p.volume), stickerPacks(VOL2).map((p) => p.volume), stickerPacks({ ...ROSTER_FIXTURE, marines: [] })]).toEqual([[1], [1, 2], []]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/enlist.test.ts`
Expected: FAIL: `../src/lib/telegram` does not exist.

- [ ] **Step 3: Add the switch, the links and the buttons.**

Create `site/src/lib/telegram.ts`:

```ts
import { miniAppLink, stickerPackUrl, stickerVolume } from '@ccip-dev/core/linkmarine';
import type { RosterFile } from '@ccip-dev/core/roster';

/** LinkMarines on Telegram shows on the site once the TELEGRAM_BOT GitHub variable is "on": the site build reads it. */
export const telegramOpen = (value: string | undefined) => value === 'on';

export const TELEGRAM_ENLIST_URL = miniAppLink('enlist');

/** Each sticker pack that holds Marines: Vol. 1 up to the newest Marine's. */
export function stickerPacks(roster: RosterFile): { volume: number; url: string }[] {
  const newest = Math.max(0, ...roster.marines.map((m) => m.serial));
  return Array.from({ length: newest === 0 ? 0 : stickerVolume(newest) }, (_, i) => ({ volume: i + 1, url: stickerPackUrl(i + 1) }));
}

/** ?tag=<tag>, as the wall filters on it; null for anything that can't be a tag. */
export function tagFromSearch(search: string): string | null {
  const tag = new URLSearchParams(search).get('tag');
  return tag !== null && /^[a-z0-9_]{1,13}$/.test(tag) ? tag : null;
}
```

Create `site/src/components/marines/Enlist.tsx`:

```tsx
import type { RosterFile } from '@ccip-dev/core/roster';
import { DISCORD_INSTALL_URL } from '../../config';
import { DISCORD_PATH } from '../../lib/socials';
import { stickerPacks, TELEGRAM_ENLIST_URL } from '../../lib/telegram';

/** Enlist on Discord and on Telegram, side by side. */
export function EnlistButtons() {
  return (
    <div className="mr-actions">
      <a className="mr-btn mr-btn-discord" href="/discord/">
        Enlist on Discord
      </a>
      <a className="mr-btn mr-btn-telegram" href={TELEGRAM_ENLIST_URL}>
        Enlist on Telegram
      </a>
    </div>
  );
}

/** The roster page's closing call to enlist: Discord alone until LinkMarines opens on Telegram, then both and the sticker packs. */
export function EnlistCta({ roster, telegram }: { roster: RosterFile | null; telegram: boolean }) {
  const packs = telegram && roster ? stickerPacks(roster) : [];
  return (
    <section className="mr-cta" aria-labelledby="cta-title">
      <p className="mr-eyebrow">enlist</p>
      <h2 id="cta-title">Your callsign is waiting.</h2>
      {telegram ? (
        <div className="mr-cta-buttons">
          <EnlistButtons />
        </div>
      ) : (
        <a className="mr-add" href={DISCORD_INSTALL_URL}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
            <path d={DISCORD_PATH} />
          </svg>
          Add ccip.dev to Discord
        </a>
      )}
      {packs.length > 0 && (
        <p className="mr-packs">
          Every Marine is a sticker:{' '}
          {packs.map((p, i) => (
            <span key={p.volume}>
              {i > 0 && ' · '}
              <a href={p.url}>LinkMarines Vol. {p.volume}</a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
```

The roster page: the hero, the call to enlist moved in, and `?tag=`:

In `site/src/components/marines/RosterView.tsx`, replace:

```tsx
import { useState } from 'react';
import { useNow } from '../hooks';
import Census from './Census';
import Constellation from './Constellation';
```

with:

```tsx
import { useEffect, useState } from 'react';
import { tagFromSearch } from '../../lib/telegram';
import { useNow } from '../hooks';
import Census from './Census';
import Constellation from './Constellation';
import { EnlistButtons, EnlistCta } from './Enlist';
```

In `site/src/components/marines/RosterView.tsx`, replace:

```tsx
function Hero({ roster }: { roster: RosterFile | null }) {
```

with:

```tsx
function Hero({ roster, telegram }: { roster: RosterFile | null; telegram: boolean }) {
```

In `site/src/components/marines/RosterView.tsx`, replace:

```tsx
        <p className="mr-lead">
          Every Marine who has enlisted with the ccip.dev bot, by callsign. One draw each, stamped forever. Enlist in any server with <code>/enlist</code>.
        </p>
```

with:

```tsx
        {telegram ? (
          <>
            <p className="mr-lead">Every Marine who has enlisted with the ccip.dev bot, on Discord or Telegram, by callsign. One draw each, stamped forever.</p>
            <EnlistButtons />
          </>
        ) : (
          <p className="mr-lead">
            Every Marine who has enlisted with the ccip.dev bot, by callsign. One draw each, stamped forever. Enlist in any server with <code>/enlist</code>.
          </p>
        )}
```

In `site/src/components/marines/RosterView.tsx`, replace:

```tsx
/** The roster page's sections, from the roster as loaded: pure, so it renders on the server for tests and as the loading shell. */
export function RosterPage({ roster, failed, now }: { roster: RosterFile | null; failed: boolean; now: Date }) {
  const [query, setQuery] = useState<WallQuery>(ALL_MARINES);
  const pickTag = (tag: string) => {
    setQuery({ ...ALL_MARINES, tag });
    document.getElementById('wall')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
```

with:

```tsx
/**
 * The roster page's sections, from the roster as loaded: pure, so it renders on the server for tests and as the loading
 * shell. `telegram` adds LinkMarines on Telegram; `tag` (from ?tag=) opens the wall on that tag once the roster is in.
 */
export function RosterPage({ roster, failed, now, telegram = false, tag = null }: { roster: RosterFile | null; failed: boolean; now: Date; telegram?: boolean; tag?: string | null }) {
  const [query, setQuery] = useState<WallQuery>(() => (tag === null ? ALL_MARINES : { ...ALL_MARINES, tag }));
  const pickTag = (picked: string) => {
    setQuery({ ...ALL_MARINES, tag: picked });
    document.getElementById('wall')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const loaded = roster !== null;
  useEffect(() => {
    if (tag !== null && loaded) pickTag(tag);
  }, [tag, loaded]);
```

In `site/src/components/marines/RosterView.tsx`, replace:

```tsx
        <Hero roster={null} />
```

with:

```tsx
        <Hero roster={null} telegram={telegram} />
```

In `site/src/components/marines/RosterView.tsx`, replace:

```tsx
            Loading the roster…
          </p>
        )}
      </>
```

with:

```tsx
            Loading the roster…
          </p>
        )}
        <EnlistCta roster={null} telegram={telegram} />
      </>
```

In `site/src/components/marines/RosterView.tsx`, replace:

```tsx
      <Hero roster={roster} />
```

with:

```tsx
      <Hero roster={roster} telegram={telegram} />
```

In `site/src/components/marines/RosterView.tsx`, replace:

```tsx
      <Constellation roster={roster} onPickTag={pickTag} />
    </>
  );
}

export default function RosterView() {
  const { roster, failed } = useRoster();
  const now = useNow(60_000);
  return <RosterPage roster={roster} failed={failed} now={now ?? new Date()} />;
}
```

with:

```tsx
      <Constellation roster={roster} onPickTag={pickTag} />
      <EnlistCta roster={roster} telegram={telegram} />
    </>
  );
}

export default function RosterView({ telegram = false }: { telegram?: boolean }) {
  const { roster, failed } = useRoster();
  const now = useNow(60_000);
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => setTag(tagFromSearch(window.location.search)), []);
  return <RosterPage roster={roster} failed={failed} now={now ?? new Date()} telegram={telegram} tag={tag} />;
}
```

A Marine's page:

In `site/src/components/marines/MarineView.tsx`, replace:

```tsx
import DogTag from './DogTag';
```

with:

```tsx
import DogTag from './DogTag';
import { EnlistButtons } from './Enlist';
```

In `site/src/components/marines/MarineView.tsx`, replace:

```tsx
/** A Marine's page. `serial` is undefined until the browser has read it from the path, null when the path holds none. */
export function MarinePage({ roster, failed, serial }: { roster: RosterFile | null; failed: boolean; serial: number | null | undefined }) {
```

with:

```tsx
/**
 * A Marine's page. `serial` is undefined until the browser has read it from the path, null when the path holds none.
 * `telegram` offers enlisting on Discord and on Telegram.
 */
export function MarinePage({ roster, failed, serial, telegram = false }: { roster: RosterFile | null; failed: boolean; serial: number | null | undefined; telegram?: boolean }) {
```

In `site/src/components/marines/MarineView.tsx`, replace:

```tsx
          <CopyLink url={marineUrl(serial)} />
          <a className="mr-btn mr-btn-discord" href="/discord/">
            Enlist yours
          </a>
        </div>
```

with:

```tsx
          <CopyLink url={marineUrl(serial)} />
          {!telegram && (
            <a className="mr-btn mr-btn-discord" href="/discord/">
              Enlist yours
            </a>
          )}
        </div>
        {telegram && <EnlistButtons />}
```

In `site/src/components/marines/MarineView.tsx`, replace:

```tsx
export default function MarineView() {
  const { roster, failed } = useRoster();
  const [serial, setSerial] = useState<number | null | undefined>(undefined);
  useEffect(() => setSerial(serialFromPath(window.location.pathname)), []);
  return <MarinePage roster={roster} failed={failed} serial={serial} />;
}
```

with:

```tsx
export default function MarineView({ telegram = false }: { telegram?: boolean }) {
  const { roster, failed } = useRoster();
  const [serial, setSerial] = useState<number | null | undefined>(undefined);
  useEffect(() => setSerial(serialFromPath(window.location.pathname)), []);
  return <MarinePage roster={roster} failed={failed} serial={serial} telegram={telegram} />;
}
```

The pages pass the build's switch to their islands, and the roster page's call to enlist now comes from `RosterPage`:

In `site/src/pages/marines/index.astro`, replace:

```astro
---
import { DISCORD_INSTALL_URL } from '../../config';
import RosterView from '../../components/marines/RosterView';
import Base from '../../layouts/Base.astro';
import { DISCORD_PATH } from '../../lib/socials';
import '../../styles/marines.css';
---
<Base title="LinkMarines" description="Every LinkMarine who has enlisted with the ccip.dev bot, by callsign: the dog tags, the rarest draws and the tags still undrawn.">
  <div class="mr-page">
    <RosterView client:load />
    <section class="mr-cta" aria-labelledby="cta-title">
      <p class="mr-eyebrow">enlist</p>
      <h2 id="cta-title">Your callsign is waiting.</h2>
      <a class="mr-add" href={DISCORD_INSTALL_URL}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d={DISCORD_PATH} /></svg>
        Add ccip.dev to Discord
      </a>
    </section>
  </div>
</Base>
```

with:

```astro
---
import RosterView from '../../components/marines/RosterView';
import Base from '../../layouts/Base.astro';
import { telegramOpen } from '../../lib/telegram';
import '../../styles/marines.css';

const telegram = telegramOpen(process.env.TELEGRAM_BOT);
---
<Base title="LinkMarines" description="Every LinkMarine who has enlisted with the ccip.dev bot, by callsign: the dog tags, the rarest draws and the tags still undrawn.">
  <div class="mr-page">
    <RosterView client:load telegram={telegram} />
  </div>
</Base>
```

In `site/src/pages/marines/marine.astro`, replace:

```astro
---
import MarineView from '../../components/marines/MarineView';
import Base from '../../layouts/Base.astro';
import '../../styles/marines.css';
---
<Base title="LinkMarine" description="A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it." noindex>
  <div class="mr-page">
    <MarineView client:load />
  </div>
</Base>
```

with:

```astro
---
import MarineView from '../../components/marines/MarineView';
import Base from '../../layouts/Base.astro';
import { telegramOpen } from '../../lib/telegram';
import '../../styles/marines.css';

const telegram = telegramOpen(process.env.TELEGRAM_BOT);
---
<Base title="LinkMarine" description="A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it." noindex>
  <div class="mr-page">
    <MarineView client:load telegram={telegram} />
  </div>
</Base>
```

`/discord`:

In `site/src/pages/discord.astro`, replace:

```astro
import { DISCORD_PATH } from '../lib/socials';
```

with:

```astro
import { DISCORD_PATH } from '../lib/socials';
import { TELEGRAM_ENLIST_URL, telegramOpen } from '../lib/telegram';

const telegram = telegramOpen(process.env.TELEGRAM_BOT);
```

In `site/src/pages/discord.astro`, replace:

```astro
        <p class="fine"><b>No permissions.</b> It reads no messages and changes nothing in your server.</p>
```

with:

```astro
        <p class="fine"><b>No permissions.</b> It reads no messages and changes nothing in your server.</p>
        {telegram && <p class="fine">On Telegram? <a href={TELEGRAM_ENLIST_URL}>Enlist in the LinkMarines Mini App</a>: the same draw, the same roster.</p>}
```

In `site/src/pages/discord.astro`, replace:

```astro
          Add to Discord
        </a>
      </div>
      <p class="roster-line">
```

with:

```astro
          Add to Discord
        </a>
        {telegram && <a class="btn telegram" href={TELEGRAM_ENLIST_URL}>Enlist on Telegram</a>}
      </div>
      <p class="roster-line">
```

In `site/src/pages/discord.astro`, replace:

```astro
  .btn.ghost { background: var(--card); border: 1px solid var(--border); color: var(--fg); }
```

with:

```astro
  .btn.ghost { background: var(--card); border: 1px solid var(--border); color: var(--fg); }
  .btn.telegram { background: linear-gradient(180deg, #2aabee, #229ed9); }
```

In `site/src/styles/marines.css`, replace:

```css
.mr-btn-x { background: #000; } .mr-btn-discord { background: #5865f2; border-color: #5865f2; color: #fff; }
```

with:

```css
.mr-btn-x { background: #000; } .mr-btn-discord { background: #5865f2; border-color: #5865f2; color: #fff; } .mr-btn-telegram { background: #2aabee; border-color: #2aabee; color: #fff; }
.mr-cta-buttons .mr-actions { justify-content: center; }
.mr-packs { margin: 16px 0 0; color: #aab3c0; font-size: 14px; }
```

- [ ] **Step 4: Run the tests, then build with the switch off and on.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/enlist.test.ts test/roster-view.test.ts test/marine-view.test.ts`
Expected: PASS (8, 15 and 9 tests: the roster page and the Marine page render as before with the switch off).

Run: `pnpm --filter @ccip-dev/site build && grep -c 'startapp=enlist' site/dist/discord/index.html site/dist/marines/index.html`
Expected: the build passes its checks, then `site/dist/discord/index.html:0` and `site/dist/marines/index.html:0`.

Run: `TELEGRAM_BOT=on pnpm --filter @ccip-dev/site build && grep -c 'startapp=enlist' site/dist/discord/index.html site/dist/marines/index.html && grep -o 'props="{&quot;telegram&quot;:\[0,true\]}"' site/dist/marines/marine/index.html`
Expected: `site/dist/discord/index.html:1`, `site/dist/marines/index.html:1`, and `props="{&quot;telegram&quot;:[0,true]}"` (the Marine page renders its buttons once the roster loads in the browser).

Run: `pnpm --filter @ccip-dev/site build`
Expected: PASS; this leaves `site/dist` built as `main` ships it, with the switch off.

- [ ] **Step 5: Run the site's tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site test`
Expected: PASS: Node 1,391 tests, workerd 36.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add site/src/lib/telegram.ts site/src/components/marines/Enlist.tsx site/src/components/marines/RosterView.tsx site/src/components/marines/MarineView.tsx site/src/pages/marines/index.astro site/src/pages/marines/marine.astro site/src/pages/discord.astro site/src/styles/marines.css site/test/enlist.test.ts
git commit -m "feat(site): Enlist on Telegram, the sticker packs and ?tag= on the roster, behind TELEGRAM_BOT" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Checkpoint push 3.** Push now. `site.yml` deploys `/tg/` and the switch-gated links (left out while `TELEGRAM_BOT` is unset). Check: `curl -s https://ccip.dev/tg/ | grep -c telegram-web-app.js` prints `1`, and `curl -sI https://ccip.dev/tg/ | grep -ci x-frame-options` prints `0`.

---

### Task 13: The runbook

The owner's side, as exact commands: a new "LinkMarines on Telegram" section (how it runs, the switch, the settings, the one-time setup in order, launch checks, allowing a group with `/id`, the sticker packs, wiping a test Marine's sticker and Story card, turning it off, the alerts); the five alert rows; the Story route and the sticker in "The public roster"; and the provisioning step that reads a chat id with `getUpdates`, which stops working once the webhook exists.

**Files:**
- Modify: `docs/runbook.md`

**Interfaces:**
- Consumes: every name above, as the owner meets it: `pnpm telegram:setup` (Task 9), `TELEGRAM_BOT`, `TELEGRAM_GATE_CHATS`, `TELEGRAM_STICKER_OWNER_ID`, `TELEGRAM_WEBHOOK_SECRET` (Tasks 6, 8, 9), `site/public/marines-app-640x360.png` (Task 3), `marines.sticker_set` and `sticker_file_id` (Task 7), the alerts `telegram-update` (Task 8), `telegram-gate` (Task 5), `telegram-api:<route>` (Task 6), `telegram-stamp:<serial>` (Task 5) and `telegram-sticker:<serial>` (Task 7).

- [ ] **Step 1: Check the runbook has none of it yet.**

Run: `grep -c "^## LinkMarines on Telegram" docs/runbook.md; grep -c "^| .telegram-" docs/runbook.md`
Expected: `0`, then `0`.

- [ ] **Step 2: Write it.**

In `docs/runbook.md`, replace:

```markdown
   - Clear it afterwards (bash/zsh: `unset TELEGRAM_BOT_TOKEN`; fish: `set -e TELEGRAM_BOT_TOKEN`).
   - Note the number it prints.
```

with:

```markdown
   - Clear it afterwards (bash/zsh: `unset TELEGRAM_BOT_TOKEN`; fish: `set -e TELEGRAM_BOT_TOKEN`).
   - Note the number it prints.
   - Once LinkMarines on Telegram has set the bot's webhook (see "LinkMarines on Telegram"), `getUpdates` answers 409 Conflict. Send `/id` to @ccipdevbot from the owner's account instead, in the chat whose id you need.
```

In `docs/runbook.md`, replace:

```markdown
The bot also answers three public, read-only routes on `discord.ccip.dev`, which `ccip.dev/marines/` reads (spec: `docs/superpowers/specs/2026-10-13-linkmarines-roster-design.md`):
```

with:

```markdown
The bot also answers four public, read-only routes on `discord.ccip.dev`, which `ccip.dev/marines/` and the Telegram Mini App read (spec: `docs/superpowers/specs/2026-10-13-linkmarines-roster-design.md`):
```

In `docs/runbook.md`, replace:

```markdown
| `/web/<serial>.png` | The dog tag card without the name and avatar row, rendered once into R2 `web/` | a day |
```

with:

```markdown
| `/web/<serial>.png` | The dog tag card without the name and avatar row, rendered once into R2 `web/` | a day |
| `/story/<serial>.png` | The 1080×1920 Story card a Telegram Marine shares: the tags, serial, callsign, tier and memes, never a name or photo. Stamped at a Telegram enlistment, else rendered once into R2 `story/` | a day |
```

In `docs/runbook.md`, replace:

```markdown
**Wiping test Marines** must also delete R2 `web/` (as well as `cards/` and `avatars/`).
```

with:

```markdown
**Wiping test Marines** must also delete R2 `web/` and `story/` (as well as `cards/` and `avatars/`), and each Marine's sticker first (see "LinkMarines on Telegram").
```

In `docs/runbook.md`, replace:

```markdown
with `https://discord.ccip.dev/roster.json` and `https://discord.ccip.dev/web/<n>.png` for each wiped serial.
```

with:

```markdown
with `https://discord.ccip.dev/roster.json`, `https://discord.ccip.dev/web/<n>.png` and `https://discord.ccip.dev/story/<n>.png` for each wiped serial.
```

In `docs/runbook.md`, replace:

```markdown
## Incidents and alerts

Alerts arrive in the Telegram chat.
```

with:

```markdown
## LinkMarines on Telegram

LinkMarines as a Telegram Mini App on @ccipdevbot: enlisting, your dog tag and the roster inside Telegram, a thin bot behind it, and every Marine, from either platform, as a sticker. Spec: `docs/superpowers/specs/2026-10-15-linkmarine-telegram-design.md`.

- **How it runs:**
  - The Mini App is `https://ccip.dev/tg/`, a static page of the site: not indexed, no analytics, and the only page that loads Telegram's `telegram-web-app.js`. Opened outside Telegram it says "Open in Telegram".
  - It calls the Discord Worker, `POST https://discord.ccip.dev/tg/session`, `/tg/enlist` and `/tg/card`, which answer `https://ccip.dev` only. Each request carries Telegram's signed launch data in its body; the Worker checks it with the bot token and refuses it after 24 hours.
  - Enlisting needs membership of a chat in `TELEGRAM_GATE_CHATS`, checked with Telegram's `getChatMember` (so @ccipdevbot must stay an administrator of @ccipdev). A Marine already enlisted skips the check.
  - A Telegram Marine is a D1 `marines` row with `platform = 'telegram'`. The draw, the serials and the callsigns are shared with Discord, and a Telegram account is never linked to a Discord one. Their card, with their Telegram name and photo (R2 `avatars/<serial>.png`), is served only to them, by `/tg/card`. The Story card they share, `story/<serial>.png`, carries neither.
  - The bot's webhook is `POST https://discord.ccip.dev/telegram`: `/start` opens the Mini App, `/id` tells the owner a chat's id, and the bot leaves a group anyone but the owner adds it to unless the group is on the list.
  - Every 10 minutes the Worker's cron adds up to 10 Marines' stickers (see "The sticker packs").
- **The switch** is the GitHub variable `TELEGRAM_BOT`, off until you set it. The deploy passes it to the Worker and the site's build reads it, so a change takes effect at the next deploy of each: `gh workflow run deploy` and `gh workflow run site`. While it is off, the Mini App says "LinkMarines on Telegram opens soon", enlisting answers 409, the webhook drops every update, the sticker job and the Discord card's sticker line stay off, and the site shows no Telegram button.
- **Settings:** `discord/wrangler.toml` `[vars]` holds `TELEGRAM_GATE_CHATS` (comma-separated: `@ccipdev`, then each LinkMarine group's id) and `TELEGRAM_STICKER_OWNER_ID` (your Telegram user id: you own the sticker packs, and `/id` answers you anywhere). Secrets: `TELEGRAM_WEBHOOK_SECRET` (new), and `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` as before.
- **One-time setup (the owner, in order).** Nothing here is user-visible until step 6.
  1. In @BotFather send `/newapp` and choose @ccipdevbot. Title: `LinkMarines`. Description: `Enlist and get your LinkMarine dog tag.` Photo: `site/public/marines-app-640x360.png`. GIF: `/empty`. Web App URL: `https://ccip.dev/tg/`. Short name: `marines`. The Mini App's link is then `https://t.me/ccipdevbot/marines`.
  2. Send `/start` to @ccipdevbot from your own account: the owner of a sticker pack must have started the bot. Then read your user id. Load the token with a silent prompt (bash/zsh: `read -rs TELEGRAM_BOT_TOKEN && export TELEGRAM_BOT_TOKEN`; fish: `read -s -x TELEGRAM_BOT_TOKEN`), run
     `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates" | jq '.result[-1].message.from.id'`
     and clear it (bash/zsh: `unset TELEGRAM_BOT_TOKEN`; fish: `set -e TELEGRAM_BOT_TOKEN`). This works only until step 5 sets the webhook.
  3. Set `TELEGRAM_STICKER_OWNER_ID = "<your id>"` in `discord/wrangler.toml`, then commit and push (or ask Claude to make the commit): `git add discord/wrangler.toml && git commit -m "chore: LinkMarines on Telegram sticker owner" && git push`.
  4. Make the webhook secret straight into `.env`, which is git-ignored, so you never see or paste it (bash/zsh: `printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env`; fish: `printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' (openssl rand -hex 32) >> .env`). Add the line `TELEGRAM_BOT_TOKEN=<the bot token>` to `.env` in your editor. Give the Worker the same secret:
     `grep '^TELEGRAM_WEBHOOK_SECRET=' .env | cut -d= -f2- | tr -d '\n' | pnpm --filter @ccip-dev/discord exec wrangler secret put TELEGRAM_WEBHOOK_SECRET`
  5. Once the deploy from step 3 has finished (`gh run list --workflow deploy --limit 1`), run `pnpm telegram:setup`. It prints `setWebhook: done`, `setMyCommands: done`, `setChatMenuButton: done`, `sticker owner <id> has started the bot`, and that `linkmarines_by_ccipdevbot` does not exist yet: Telegram creates a pack only with a first sticker in it, so the sticker job creates Vol. 1 with Marine #1's sticker once the switch is on.
  6. Open it: `gh variable set TELEGRAM_BOT --body on`, then `gh workflow run deploy` and `gh workflow run site`.
  7. Launch checks:
     - On your phone, open `https://t.me/ccipdevbot/marines` and enlist. Watch the draw; your dog tag shows your Telegram name and photo; SHARE TO STORY opens the story editor with the Story card.
     - Within 10 minutes the bot sends you "You're sticker #N in LinkMarines Vol. 1" with your sticker. Every Marine so far joins `https://t.me/addstickers/linkmarines_by_ccipdevbot` at 10 per 10 minutes. A Discord `/dogtag` names the pack under the card.
     - In Telegram Desktop, SHARE TO STORY opens the share sheet instead. At `https://web.telegram.org` the Mini App must load inside the page; a blank frame means the `/tg/*` rule in `site/public/_headers` did not apply.
     - `https://t.me/ccipdevbot/marines?startapp=tag_pepe` opens the roster on pepe's sheet; `https://ccip.dev/marines/` shows Enlist on Telegram and the pack.
     - Add @ccipdevbot to a test group from another account: it leaves at once.
- **Allow a LinkMarine group:** add @ccipdevbot to the group from your own account (it stays when the owner adds it), send `/id` there, append the id it prints to `TELEGRAM_GATE_CHATS` (for example `"@ccipdev,-1001234567890"`), commit and push. Its members can then enlist, and `/start` there links to the Mini App.
- **The sticker packs:** Vol. *n* holds serials 120(*n*−1)+1 to 120*n*: `linkmarines_by_ccipdevbot`, then `linkmarines2_by_ccipdevbot`, and so on, titled "LinkMarines Vol. *n* · ccip.dev" and owned by `TELEGRAM_STICKER_OWNER_ID`. The job takes the Marines without a sticker oldest first, Discord Marines included, and records each in `marines.sticker_set` and `sticker_file_id`. A 429 ends a run early, quietly. A Marine with `sticker_set` set and no `sticker_file_id` lost Telegram's answer while being added; the next run settles it by counting the pack. Where the job is:
  `pnpm --filter @ccip-dev/discord exec wrangler d1 execute ccip-dev-marines --remote --command "SELECT serial, sticker_set, sticker_file_id FROM marines WHERE sticker_file_id IS NULL ORDER BY serial LIMIT 20"`
- **Wiping a test Marine** (either platform, beside the deletes in "The public roster"): take its sticker out of the pack before deleting its row, so the pack keeps one sticker per recorded Marine, and do it between the job's runs (it runs at :00, :10, :20 … each hour). With the token loaded silently as in step 2:
  `pnpm --filter @ccip-dev/discord exec wrangler d1 execute ccip-dev-marines --remote --command "SELECT sticker_file_id FROM marines WHERE serial = <serial>"`
  `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteStickerFromSet" -d sticker=<sticker_file_id>` (skip it when `sticker_file_id` is empty)
  `pnpm --filter @ccip-dev/discord exec wrangler r2 object delete ccip-dev-marines/story/<serial>.png --remote`
- **Turn it off:** `gh variable set TELEGRAM_BOT --body off`, then `gh workflow run deploy` and `gh workflow run site`. To unhook the bot as well, with the token loaded silently: `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"`.
- **Alerts:** `telegram-update`, `telegram-gate`, `telegram-api:<route>`, `telegram-stamp:<serial>` and `telegram-sticker:<serial>`, below, in the same chat, each at most once an hour.

## Incidents and alerts

Alerts arrive in the Telegram chat.
```

In `docs/runbook.md`, replace:

```markdown
| `ccip.dev watchdog: …` | `status.json` is old, unreadable, or ingest lag is high. Check the Worker and the CCIP API. |
```

with:

```markdown
| `telegram-update` | The bot's webhook could not handle an update (a D1 error, say). Telegram does not send it again; someone whose `/start` went unanswered can send it again. Read the error in the alert and `pnpm --filter @ccip-dev/discord exec wrangler tail ccip-dev-discord`. |
| `telegram-gate` | No gate chat could be checked, so nobody new can enlist on Telegram: they see "Not in @ccipdev yet". Usually @ccipdevbot was removed from @ccipdev or lost its administrator rights there, or an id in `TELEGRAM_GATE_CHATS` is wrong; the alert names each chat and Telegram's answer. Make the bot an administrator of @ccipdev again, or fix the list. |
| `telegram-api:<route>` | A Mini App request (`session`, `enlist` or `card`) failed unexpectedly and answered 500, for example on a D1 error; for `enlist` it can also mean twenty draws in a row clashed (see `discord-draw`). Read the error and tail `ccip-dev-discord`. |
| `telegram-stamp:<serial>` | A Telegram Marine's card, web card or Story card failed to stamp after they enlisted. The Mini App keeps asking for the card and stamps it again at most once a minute; the web and Story cards also render on their first request. If it repeats, read the error and tail `ccip-dev-site`. |
| `telegram-sticker:<serial>` | The sticker job could not add that Marine's sticker: it could not be drawn, or Telegram refused it (the alert has Telegram's answer). The next run tries again. "the next run settles it": an add lost its answer and the run stopped there on purpose; it clears within 10 minutes. "right after an add": the pack disagrees with the records; look at the pack in Telegram and run the query in "The sticker packs" before anything else. |
| `ccip.dev watchdog: …` | `status.json` is old, unreadable, or ingest lag is high. Check the Worker and the CCIP API. |
```

- [ ] **Step 3: Check it.**

Run: `grep -c "^## LinkMarines on Telegram" docs/runbook.md; grep -c "^| .telegram-" docs/runbook.md; grep -c "story/<serial>.png" docs/runbook.md`
Expected: `1`, `5`, then `3`.

Read the new section top to bottom as the owner will: every step is a command or a click, no secret is ever typed on a command line, and step 6 is the only one that makes anything visible.

- [ ] **Step 4: Run everything and the typecheck one last time.**

Run: `pnpm test`
Expected: PASS: core 682, the Discord Worker 256, the site (Node 1,391, workerd 36), the data Worker 657, the scripts 424.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add docs/runbook.md
git commit -m "docs: LinkMarines on Telegram in the runbook: setup, the switch, /id, stickers, alerts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Checkpoint push 4.** Push the runbook. The owner then follows "LinkMarines on Telegram", whose step 6 turns the switch on.

---

## Self-review notes

- **Spec coverage:**
  - §1 goal and success. Matching: both platforms run `enlistMarine` and `stampCard` (Task 1; Task 6 enlists through them). Gated and fair: the gate (Task 5), the draw on the server, the app only playing it (Tasks 6, 10). Private: Tasks 2, 3, 5, 6 and 11 (see Global Constraints). Self-running: the card re-stamps from the Mini App's polling (Task 6), the sticker job settles and retries (Task 7), claims are pruned (Task 8).
  - §2 architecture: the Mini App (Tasks 10, 11), its API (6), the thin bot (8), the shared core (1), the two renders (2, 3), the sticker job (7). Identity: one Marine per `(platform, user_id)`, never linked (Task 1 "enlists a Telegram account as its own Marine, after a Discord one with the same id").
  - §3 the Mini App: launch, `expand()`, the colours and the script on `/tg/` only (Task 11); "Open in Telegram" (Task 10); the four screens (Tasks 10, 11); the MainButton (Task 10 `mainButton`, Task 11 `useMainButton`), the BackButton and haptics (Task 11); the deep links (Task 10 `firstScreen`, `startParam`; Task 11 opens the sheets); the switch off (Task 10 `OpensSoon`, the hidden MainButton).
  - §4 the card, the Story card and the tilt: the name and photo (Task 5), the glint (Task 1's `stampCard`), stamping after enlisting and the polling (Tasks 6, 11), `renderMarineStory` (Task 3), `story/<serial>.png` stamped and rendered on first request (Task 5), Share to Story with its text and widget link and the fallback (Tasks 10, 11), the tilt and the streak, off under reduced motion (Tasks 10, 11).
  - §5 the sticker pack: the art (Task 2), the names, titles and volumes (Task 4), ownership and creation (Task 7; Vol. 1 too, see "Decisions"; Task 9 checks the owner), the job, the migration, the 429 and the alerts (Task 7), telling people: the DM (7), the dog tag screen's button (10), Discord's card (7), the roster's links (12), wiping (13).
  - §6 the thin bot: the webhook, its secret, de-duplication, `allowed_updates`, `/start` both ways, `/id`, leaving (Task 8); the menu button (Task 9).
  - §7 the API: CORS, launch data, the three routes and their answers, the gate failing closed, the switch (Tasks 4–6).
  - §8 the site: the page (Task 11), the enlist buttons, the copy, the packs, `?tag=` (Task 12); `/roster.json` unchanged (no task touches `buildRoster` or `PUBLIC_COLUMNS`).
  - §9 config and owner setup: the vars (Task 6), the secret (Task 8), the setup command and the deploy variable (Task 9), the owner's steps in order and the alerts (Task 13).
  - §10 testing: every item has its test in the owning task; the privacy line is covered by the roster's existing strict-schema tests, Task 5's "hands the renderer no name or avatar" and summary test, Tasks 2 and 3's "draws no name and no avatar, even when handed a whole card", and Task 6's `/tg/card` tests.
  - §11 out of scope: nothing of it is built.
- **Where the plan departs from the spec, deliberately** (all in "Decisions"): Vol. 1 is created by the sticker job, not by `pnpm telegram:setup` (a pack can't be created without a sticker); the extra alert `telegram-api:<route>`; the site's switch is read at build time, so turning it on also takes `gh workflow run site`; the mockup's two owner notes are not copy.
- **Placeholders:** none. The owner fills `TELEGRAM_STICKER_OWNER_ID = ""` and `.env` by design (runbook steps 2–4).
- **Names across tasks:**
  - Task 1: `cardKey`, `avatarKey`, `snapshotCount`, `draft`, `Enlistee`, `enlistMarine`, `readBytes`, `Report`, `reason`, `flush`, `isPng`, `Cards`, `AvatarSource`, `stampCard`.
  - Task 2: `LinkMarineRenderer.renderMarineSticker`, `TAGS_DROP`, `tagsTree`, `STICKER_SIZE`, `TAGS_BOX`, `STICKER_FIT`, `pngUri`, `stickerTree`, `pngRgba`, `fakeRenderer().stickers`.
  - Task 3: `LinkMarineRenderer.renderMarineStory`, `STORY_SIZE`, `STORY_TAGS`, `callsignSize`, `storyTree`, `APP_IMAGE_SIZE`, `appImageTree`, `MOCKUP_MEMES`, `cards:app`, `fakeRenderer().stories`.
  - Task 4: `TELEGRAM_BOT_USERNAME`, `MINI_APP_LINK`, `MINI_APP_URL`, `miniAppLink`, `STICKERS_PER_PACK`, `stickerVolume`, `stickerPackName`, `stickerPackTitle`, `stickerPackUrl`, `StartParam`, `parseStartParam`; `TELEGRAM_API`, `TELEGRAM_TIMEOUT_MS`, `TelegramResult`, `TelegramFile`, `TelegramApi`, `telegramApi`; `TelegramUser`, `LaunchData`, `LAUNCH_MAX_AGE_S`, `verifyLaunchData`; the helpers `BOT_TOKEN`, `TG_USER`, `signedLaunch`.
  - Task 5: `MarineSummary`, `Gate`; `Env.TELEGRAM_BOT`, `TELEGRAM_GATE_CHATS`, `TELEGRAM_STICKER_OWNER_ID`; `publicCard`; `storyKey`, `keptCard`; `TELEGRAM_PLATFORM`, `TelegramSettings`, `TelegramBot`, `telegramSettings`, `createTelegramBot`, `telegramName`, `telegramAvatar`, `STAMP_CLAIM_MS`, `claimStamp`, `stampTelegram`, `marineSummary`, `checkGate`; the helpers `TelegramCall`, `fakeTelegram`, `tgOk`, `tgError`, `OWNER_ID`, `TG_SETTINGS`, `FakeTelegramBot`, `fakeTelegramBot`.
  - Task 6: `SessionAnswer`, `EnlistAnswer`; `MAX_BODY_BYTES`, `cappedBody` (moved); `MINI_APP_ORIGIN`, `miniAppRoute`.
  - Task 7: `sticker_set`, `sticker_file_id`; `stickerQueue`; `STICKERS_PER_RUN`, `STICKER_EMOJI`, `stickerJob`; `Bot.telegramOpen`; `cardText`; the default export's `scheduled`.
  - Task 8: `Env.TELEGRAM_WEBHOOK_SECRET`; `TelegramChat`, `TelegramUpdate`, `START_TEXT`, `OPEN_BUTTON`, `webhookSecretMatches`, `onGateList`, `parseCommand`, `claimUpdate`, `pruneClaims`, `handleUpdate`, `telegramWebhook`.
  - Task 9: `WEBHOOK_URL`, `ALLOWED_UPDATES`, `BOT_COMMANDS`, `SetupCall`, `ownerIdFrom`, `checkSecret`, `setupCalls`, `botUrl`, `telegram:setup`.
  - Task 10: `BottomButtonParams`, `TelegramWebApp`, `telegramWebApp`; `TG_API`, `TG_BACKGROUND`, `MAIN_BLUE`, `MAIN_GOLD`, `MAIN_GOLD_TEXT`, `CCIPDEV_LINK`, `Screen`, `startParam`, `firstScreen`, `DRAW_STEP_MS`, `DRAW_HOLD_MS`, `lockedAt`, `callsignParts`, `chanceText`, `tierBanner`, `canShareToStory`, `storyUrl`, `storyText`, `STORY_WIDGET`, `shareLink`, `MAX_TILT`, `tilt`, `tiltOn`, `MainButtonState`, `mainButton`, `EnlistReply`, `tgApi`; `Welcome`, `OpensSoon`, `SEAT_PREVIEW`, `Draw`, `Hexes`, `DogTagScreen`, `Tilt`, `Outside`.
  - Task 11: `TgRoster`, `RosterTab`, `TG_WALL_PAGE`, `TagSheet`, `MarineSheet`, `useMainButton`, `useBackButton`, `useOwnCard`, `useTilt`, `MiniApp`; `RarestTen`'s `onPickMarine`; `Base`'s `bare` and `head` slot.
  - Task 12: `telegramOpen`, `TELEGRAM_ENLIST_URL`, `stickerPacks`, `tagFromSearch`, `EnlistButtons`, `EnlistCta`; `RosterPage`'s `telegram` and `tag`, `RosterView`'s and `MarineView`'s `telegram`, `MarinePage`'s `telegram`.
- **Checked on 2026-10-15:**
  - Every task's code was prototyped in a scratch worktree of this repository at `5e55f2a` and its tests run there. The plan's code blocks are generated from that prototype by a script that applies every Create and replace block, in plan order, to a copy of `HEAD`, checks each replace's old text occurs exactly once at that point, and checks the result equals the prototype file for file: 79 files, 149 blocks.
  - The plan was then replayed task by task on a fresh worktree of `HEAD`: after each task's Step 1 its new tests failed for the reason its Step 2 names (15 red runs), and at each task's end its listed runs passed (the Discord Worker 183, 195, 211, 227, 243, 256; core 682; scripts 424; the site's Node suite 1,372, 1,383, 1,391; `pnpm typecheck` after every task; the site build after Tasks 11 and 12, `tg/index.html` 108.3 then 108.4 KB of 130; `actionlint` after Task 9), then `pnpm test` whole. 0 mismatches.
  - Looked at, not only tested: every tier's sticker and Story card and the @BotFather photo, rendered from the mockup's memes; the four screens rendered from the fixtures with `tg.css` beside the mockup; `wrangler dev` on the built site answering `/tg/` without `X-Frame-Options` or the CSP and `/marines/` with both; `wrangler deploy --dry-run --var TELEGRAM_BOT:on` listing `env.TELEGRAM_BOT ("(hidden)")`.
  - The scratch worktrees and their files are deleted.

