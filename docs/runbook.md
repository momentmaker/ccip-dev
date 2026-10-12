# ccip.dev data core runbook

All `wrangler` commands run from the repo root as `pnpm --filter @ccip-dev/worker exec wrangler …`.
`pnpm --filter … exec` runs inside `worker/`, so relative file paths in these commands resolve from `worker/`.
Never paste tokens into chat or commit them.

## One-time provisioning

1. Log in: `pnpm --filter @ccip-dev/worker exec wrangler login`.
2. Create D1: `… wrangler d1 create ccip-dev`. Copy the printed `database_id` into `worker/wrangler.toml`.
3. Create the buckets: `… wrangler r2 bucket create ccip-dev-public` and `… wrangler r2 bucket create ccip-dev-archive`.
4. Serve the public bucket at `data.ccip.dev`. Take the zone id from the ccip.dev zone's Overview page in the dashboard, then run:
   `… wrangler r2 bucket domain add ccip-dev-public --domain data.ccip.dev --zone-id <the zone id from the Overview page>`.
   Never enable r2.dev or a domain on `ccip-dev-archive`.
5. CORS: `… wrangler r2 bucket cors set ccip-dev-public --file r2-cors.json`. Then `… wrangler r2 bucket cors list ccip-dev-public` shows the GET/HEAD rule.
6. Cache Rule (dashboard: ccip.dev → Caching → Cache Rules → Create rule):
   - Name: `data.ccip.dev JSON`
   - When incoming requests match: Hostname equals `data.ccip.dev`
   - Cache eligibility: Eligible for cache
   - Edge TTL: Use cache-control header if present, bypass cache if not
   - Browser TTL: Respect origin TTL
7. Telegram alert chat:
   - Send `/start` to @ccipdevbot from your account.
   - Load the token with a silent prompt (bash/zsh: `read -rs TELEGRAM_BOT_TOKEN && export TELEGRAM_BOT_TOKEN`; fish: `read -s -x TELEGRAM_BOT_TOKEN`), so it never lands on a command line or in shell history.
   - Run `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates" | jq '.result[-1].message.chat.id'`.
   - Clear it afterwards (bash/zsh: `unset TELEGRAM_BOT_TOKEN`; fish: `set -e TELEGRAM_BOT_TOKEN`).
   - Note the number it prints.
8. Worker secrets:
   - `… wrangler secret put TELEGRAM_BOT_TOKEN`
   - `… wrangler secret put TELEGRAM_ALERT_CHAT_ID`
   - Optional: `… wrangler secret put RPC_ETHEREUM` and `RPC_FALLBACKS` (comma-separated). Use them only for keyed RPC URLs; without them, a built-in list of keyless public endpoints is used.
   - Optional but recommended: `… wrangler secret put GITHUB_DISPATCH_TOKEN`, a fine-grained GitHub token for this repo with only **Actions: Read and write**. After each history publish the Worker dispatches `site.yml`, so pages refresh about 15 minutes after finalize; GitHub's scheduled runs of that workflow arrive hours late and remain the fallback. Without the secret, nothing is dispatched.
9. Schema: `… wrangler d1 migrations apply ccip-dev --remote`.
10. Deploy: `… wrangler deploy`.

## Protect data.ccip.dev

The data is open to reuse with credit, so these settings limit abuse, not access. Both are owner steps in Cloudflare.

**Rate limit** (dashboard: ccip.dev → Security → WAF → Rate limiting rules → Create rule):
- Name: `data.ccip.dev rate limit`.
- When incoming requests match: URI Path starts with `/v1/`. The Free plan matches on path only, not hostname; nothing on ccip.dev itself is under `/v1/`.
- Characteristics: IP (fixed on Free).
- When rate exceeds: 50 requests per 10 seconds.
- Then: Block, for 10 seconds.

Normal use sits far below that: pages poll each file every 30 s, a site build fetches each file once (about 20), and a share card reads one to three files.

Check it from a shell: `for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code} " https://data.ccip.dev/v1/status.json; done; echo`. The last few should be `429`, and requests work again after 10 seconds.

**Browser access stays open** (`worker/r2-cors.json` allows `*`), by choice: the rate limit does the real work, and the data is meant to be reused with credit. Restricting origins would be safe, because Cloudflare keeps a separate cached copy per `Origin` (the response carries `Vary: Origin`). Copies cached under the old policy keep their old header until they expire (up to an hour for `chains.json`), so after any CORS change purge the `data.ccip.dev` hostname (Caching → Configuration → Purge Cache → Custom Purge) or wait. Apply a policy with `pnpm --filter @ccip-dev/worker exec wrangler r2 bucket cors set ccip-dev-public --file r2-cors.json`, and when checking with curl pass the header as its own argument: `-H "Origin: https://example.com"`.

## GitHub (public repo)

The repo is public. That keeps Actions minutes unlimited (the `*/15` watchdog is about 2,880 minutes a month), and environments with branch rules and secret scanning are free. Turn on secret scanning and push protection before anything is pushed.

1. Secret scanning and push protection:
   `gh api -X PATCH repos/momentmaker/ccip-dev -f 'security_and_analysis[secret_scanning][status]=enabled' -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'`.
   Check with `gh api repos/momentmaker/ccip-dev --jq .security_and_analysis`. If the call is rejected while the repo is still empty, run it again right after step 5.
2. Create the deploy token: dashboard → My Profile → API Tokens → Create Token → a **custom token** (not a template) with exactly these permissions: Account > Workers Scripts: Edit, Account > D1: Edit, Account > Account Settings: Read. Scope it to your account and give it no zone resources, so a leaked CI token cannot reroute `data.ccip.dev` or touch the R2 buckets. The Worker has no routes (`workers_dev = false`), and deploying with D1/R2 bindings needs no rights on the bound resources. If a deploy step fails with an authentication or permission error, add only the permission it names. Then create the `production` environment so that only `main` can deploy, and store the token there:
   - `gh api -X PUT repos/momentmaker/ccip-dev/environments/production -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'`
   - `gh api -X POST repos/momentmaker/ccip-dev/environments/production/deployment-branch-policies -f name=main`
   - `gh secret set CF_DEPLOY_TOKEN --env production` (prompts for the value; never put a secret on the command line)
3. `gh variable set CLOUDFLARE_ACCOUNT_ID --body <account id from wrangler whoami>` (not a secret), then `gh secret set TELEGRAM_BOT_TOKEN` and `gh secret set TELEGRAM_ALERT_CHAT_ID`, with the same values as the Worker secrets. The last two are for the backup GitHub watchdog. Each secret command prompts for its value.
4. Commit the real `database_id`, so the first CI deploy does not migrate the placeholder id: `git add worker/wrangler.toml && git commit -m "chore: production D1 database id"`. The database id is not a secret.
5. Only now push, so the first `deploy` run already has its token and the right id: `git push -u origin main`.
6. After the first deploy from step 5 has finished and created the `ccip-dev-watchdog` Worker (the deploy workflow publishes it right after the data Worker), set its two secrets, with the same values as the data Worker's. Each command prompts for its value:
   - `pnpm --filter @ccip-dev/worker exec wrangler secret put TELEGRAM_BOT_TOKEN -c wrangler.watchdog.toml`
   - `pnpm --filter @ccip-dev/worker exec wrangler secret put TELEGRAM_ALERT_CHAT_ID -c wrangler.watchdog.toml`

## Health checks

- `curl -s https://data.ccip.dev/v1/status.json | jq '{lag_seconds, last_finalize_day, coverage_from}'`: `lag_seconds` should stay under 120.
- Freshness: `curl -s -A curl/8.7.1 'https://api.ccip.chain.link/v2/messages?environment=mainnet&limit=1' | jq -r '.data[0].messageId'` should equal `curl -s https://data.ccip.dev/v1/live.json | jq -r '.messages[0].id'`. If they differ, run both again a minute later; a match then is normal ingest delay.
- `curl -sI https://data.ccip.dev/v1/live.json | grep -iE 'cache-control|cf-cache-status'` should show `public, max-age=30`.
- `curl -sI -H 'Origin: https://example.com' https://data.ccip.dev/v1/live.json | grep -i access-control-allow-origin` should show `*`.
- Fee costs: `curl -s https://data.ccip.dev/v1/cost.json | jq '{from,to,lanes:(.lanes|length)}'` should show the last 30 complete days and a non-zero lane count, and `curl -s https://data.ccip.dev/v1/top/lane.json | jq 'has("by_fees")'` should print `true`. After the first finalize that builds them, check its D1 query duration in the logs.
- Reserve: `curl -s https://data.ccip.dev/v1/reserve.json | jq '{link_price_usd, cost_basis, unpriced: .cost_basis.unpriced_transfers, deposits: .pace.deposits}'`. About 7 hours after the first deploy with the transfer scan (the backfill), `cost_basis` is non-null, and no `reserve-mismatch` alert has arrived. A non-zero `unpriced` means the USD totals are incomplete until the next hourly pricing run.
  If `reserve-mismatch` keeps alerting, an endpoint may have skipped blocks. Re-scan from an earlier block. Inserts are idempotent, so re-scanning is safe:
  `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "UPDATE meta SET value = '<block>' WHERE key = 'reserve_scan_block'"`
  For a full re-scan, use 23039540. The next hourly runs re-scan forward from there.
- Primary watchdog: the `ccip-dev-watchdog` Worker runs on a 5-minute cron. Check that it fires in the Cloudflare dashboard (Workers & Pages → ccip-dev-watchdog → Cron triggers and Logs), or run `pnpm --filter @ccip-dev/worker exec wrangler tail -c wrangler.watchdog.toml` and wait up to 5 minutes. A healthy run logs nothing.
- Backup watchdog (GitHub Actions, best-effort schedule): `gh workflow run watchdog`, then `gh run list --workflow watchdog --limit 1` should show a success.
- Archive privacy: `… wrangler r2 bucket domain list ccip-dev-archive` lists no domains, and `… wrangler r2 bucket dev-url get ccip-dev-archive` reports the r2.dev URL as disabled.

## History crawl

Local files only; run it any time before the build. Details are in spec §9 step 1.

1. `pnpm backfill:crawl` (optional global crawl; its pages are reused).
2. `pnpm backfill:sources` crawls each source chain into `.backfill/sources/<selector>/`. Re-run until `.backfill/sources/summary.json` shows `complete: true`. Finished sources are skipped and walled ones are retried. A source whose first page returns 404 is marked `unsupported`.
3. Poison messages (the list endpoint returns HTTP 500 for any page containing them) are skipped and recorded with their search window. The build writes `.backfill/skipped.json`; list them in `docs/methodology.md`.
4. `coverage_from` is CCIP's first message if no source walls; a walled source moves it to the day after its oldest reached day.

## Backfill upload

Run this once, after the Worker is deployed. The import makes D1 unavailable while each SQL file runs, so the Worker's jobs fail during the upload. Do it in one sitting, well away from 00:07 and 06:00 UTC (finalize), and expect `job-failed` and watchdog alerts while it runs.

1. R2 API token: dashboard → R2 → Manage API tokens → Create. Give it **Object Read & Write** limited to the `ccip-dev-archive` bucket.
2. Optional D1 token: `CF_BACKFILL_TOKEN`, a custom token with D1 edit only. Without it, your `wrangler login` session is used.
3. Create `.env` in the repo root (gitignored). Type the values into the file locally; never paste them into chat. The variable names are:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `CF_BACKFILL_TOKEN` (optional)
4. Order:
   1. Wait for the Worker's first hourly run, which snapshots the token registry. The upload refuses to start until it has.
   2. `pnpm backfill:sources` until `complete: true` (see "History crawl"). Every source's crawl must start after 00:00 UTC of `live_start_day`, because a re-run does not refresh a finished source. The build enforces this: it refuses any source whose first page is older and names the directory to delete before re-running.
   3. `pnpm backfill:build --live-start <live_start_day>` (read it with `… wrangler d1 execute ccip-dev --remote --command "SELECT value FROM meta WHERE key = 'live_start_day'"`). Each build also fetches the CCIP token registry (`/chains` and every `/tokens` page, a few requests) and CoinGecko's keyless coin id lists (`/asset_platforms` and `/coins/list`, two requests; ids only, never prices) into `.backfill/registry/`. A token with no price on a day takes the price of another copy of the same token that day, then its CoinGecko coin's DefiLlama price that day: the fallback the Worker also uses. The SQL also seeds the Worker's `coingecko_ids` table with the registry tokens it maps. A price series without a point on a day uses its nearest point at most two days away (the earlier on a tie), but only when it has a point on both sides of that day.
   4. `pnpm backfill:upload`. The upload passes `--yes` to wrangler, so there are no import prompts to answer.
5. If interrupted, re-run `pnpm backfill:upload`; it resumes from `.backfill/upload-state.json`. After a rebuild, the new build id makes it apply every SQL file and replace every archive again. The upserts only touch backfill rows.

## Endpoint maps

`config/endpoints.json` holds a keyless RPC and a Blockscout explorer for each CCIP chain, plus extra Ethereum log endpoints for the Reserve scan. The `endpoints` workflow rebuilds it every day at 03:17 UTC from chainlist.org, keeps every entry that still works, and replaces or drops the ones that died. When anything changes it opens or updates one PR from `endpoints/refresh`, with a table of the changes as its body.

Review the new URLs before you merge. The label-candidates job reads the file straight away, and the `ethereumLogs` entries reach the Reserve scan after the next deploy.

To run it by hand: `gh workflow run endpoints`, or `pnpm endpoints:refresh` locally.

## Labels and handles

X posts tag only their subject with an X handle kept in `labels/`: the welcomed chain, the spotlighted chain, the movers' headline chain when the headline is a chain, and `@chainlink` on Reserve deposits. Everyone else, and a subject without a verified handle, is written as its plain name.

- **Senders:** the `x` of a project with `verified = true` in `labels/projects/*.toml`.
- **Tokens:** a `[[tokens]]` entry (`chain`, `address`, `source`) in the issuing project's file. It covers every chain in the token's CCIP registry group. The project needs `verified = true` and an `x`; a project file may hold tokens and no addresses.
- **Chains:** `labels/chain-x.json` maps a CCIP chain name, as in `labels/ccip-chains.json`, to `{ "x": "<handle>", "source": "<https URL>" }`.
- **Verifying a handle:** the `source` must be the project's or chain's own website or docs, on a page that links to the X account. For a token, use a page of the project's that lists the token's address. Leave out anything you can't verify.
- **Check and build:** `pnpm labels:check` validates both tables (CI runs it); `pnpm labels:build` writes `worker/src/generated/labels.json` and `handles.json`. The deploy also runs it.
- **Weekly gaps:** the `label-candidates` job writes `labels/handle-gaps.md`, the busiest tokens with no project entry and the busiest chains with no handle, into its pull request. Research them there.

## Broadcasts

The Worker posts yesterday's daily report after the 00:07 finalize, the weekly report on Mondays (the Monday–Sunday week just ended), a post for each record or milestone a new live day sets, and one for each new Reserve deposit. Each post is a card from the site (`https://ccip.dev/og/broadcast/…png`) with a caption and no link. Spec: `docs/superpowers/specs/2026-10-11-broadcasts-design.md`.

- **Mode** (`BROADCASTS` under `[vars]` in `worker/wrangler.toml`; change it and push):
  - `off` (the default): nothing is posted, claimed or seeded.
  - `drafts`: only the owner gets anything, in the drafts chat (`TELEGRAM_DRAFTS_CHAT_ID`, or `TELEGRAM_ALERT_CHAT_ID` when that is unset). Each broadcast arrives twice: the card with the ready-to-paste X text (`x-draft`), and the card with the caption the channel would get (`telegram-preview`), so both texts can be checked before `on`.
  - `on`: the Telegram channel post (`TELEGRAM_CHANNEL_ID`, `@ccipdev`) and the X post (`x-post`, see "X posting"); without the X keys, the X draft to the owner instead. Before switching to `on`, add the bot to @ccipdev as an administrator with "Post messages".
- **Drafts chat:** `TELEGRAM_DRAFTS_CHAT_ID` is optional. Either add it under `[vars]` in `worker/wrangler.toml`, or set it with `wrangler secret put TELEGRAM_DRAFTS_CHAT_ID`. When unset (or empty), drafts go to the alert chat.
- **Before `drafts`:** do not switch to `drafts` until the card routes are deployed on the site; otherwise every broadcast alerts `broadcast-image` every hour.
- **Testing with drafts:** set `drafts` and push. The next hourly run sends yesterday's daily to the drafts chat; the next 00:07 finalize sends the new one, and Monday's adds the weekly. Check the cards and the text for a few days, then set `on`.
  - **First drafts night:** right after 00:07, compare the daily card's numbers (messages, value, fees, LINK share) with the draft text, and on the first Monday do the same for the weekly. They must match: that confirms the card Worker's no-store data loads really bypass data.ccip.dev's cache. A card showing an older day's numbers means they did not; do not switch to `on`.
- **First run:** the first run in `drafts` or `on` marks every current record and passed milestone as announced without posting them (`broadcast:records:seeded`), and notes the latest Reserve deposit (`broadcast:reserve:since`); only later deposits are posted.
- **When:**
  - The 00:07 run posts.
  - Each hourly run retries yesterday's daily, weekly and record broadcasts that are not sent yet, and posts each new deposit once it has a price.
  - The 06:00 run posts only what the 00:07 run did not: when 00:07 failed entirely, it finalizes yesterday and sends that day's daily (and the weekly when it was a Sunday). Keys already `sent:` are never re-sent. The hourly retry of yesterday skips the 06:00 hour, so it cannot caption from rows the late run is replacing.
  - Reserve deposits older than 3 days are never posted, so turning broadcasts back on after a pause does not flood the channel.
  - Records only come from live days (from `live_start_day`) finalized within the last 3 days, so a rewind never posts old records.
- **Dedup keys** in D1 `meta`: `broadcast:daily:<day>`, `broadcast:weekly:<monday>`, `broadcast:record:<kind>:<day>`, `broadcast:milestone:<metric>:<threshold>`, `broadcast:reserve:<tx>`. A value of `pending:<time>` means a send is under way and can be retried an hour later; `sent:<time>` means every output for the mode took it (keys sent before 2026-10-12 mean at least one did); `seeded:<time>` marks a first-run record.
- **Re-post one** (say, after fixing a wrong number): delete its key and its output keys, outside 23:55–00:30 UTC. The next hourly run posts it again if it is yesterday's daily, weekly or record, or a deposit after `broadcast:reserve:since`. Older ones are not re-posted. Each output keeps its own key, `<key>#telegram-channel`, `<key>#x-post` (or `<key>#x-draft` when X posting is off or unset) and `<key>#telegram-preview`, written when that output sends; a broadcast is done only when all its outputs are. To re-post only to the channel, delete `<key>` and `<key>#telegram-channel` and keep the other `#` rows; in particular, to re-post to Telegram only, keep `<key>#x-post`. Deleting `<key>#x-post` posts to X again, at $0.015, and X refuses identical text, so delete the wrong X post by hand first. A broadcast sent before 2026-10-12 has no `#` rows, so deleting its key re-posts every output the mode has, including the X post (or the X draft to the owner's chat when X posting is off). The bot uploads the card it fetched, and the card is cached at the edge for 15 minutes, so a re-post within 15 minutes of a data fix can still show the old card; wait it out first.
  `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key = 'broadcast:daily:<day>' OR key LIKE 'broadcast:daily:<day>#%'"`
- **A card:** open its URL, for example `https://ccip.dev/og/broadcast/daily/<day>.png`. Cards are cached for 15 minutes. One that has no data answers 404, and one that fails answers 500; neither is posted.

### X posting

In `on` mode the Worker posts the card with the X text to X through the X API (pay-as-you-go). Posts never contain a link, so each costs $0.015. The X text names projects and chains in plain text and tags no account, except `@chainlink` on Reserve deposits and, on a moment, the post's subject (see "Moments"). X's automation rules ban unsolicited @mentions. The poll never goes to X.

- **Setup in the X developer console:**
  1. Under user authentication, set App permissions to "Read and write" and Type of App to "Web App, Automated App or Bot". Use `https://ccip.dev` for both the callback and the website.
  2. Under Keys and tokens, generate the API Key and Secret, and the Access Token and Secret. Generate the access token *after* setting Read and write.
  3. The access token posts as the account that owns the developer account.
  4. Turn on the account's "Automated" label, and say it's a bot in the bio.
- **Secrets** (each value is typed at the prompt; never put them in `wrangler.toml`):
  `pnpm --filter @ccip-dev/worker exec wrangler secret put X_API_KEY`, and likewise `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_SECRET`.
- **What it does:** when all four keys are set and `X_POSTS` isn't `"off"`, `on` mode posts to X and the X draft to the owner stops. `X_POSTS = "off"` (under `[vars]`) stops X posting, and the drafts come back. `drafts` mode never posts to X.
- **Cost:** $0.015 a post, with no links ever. When the balance is empty the post fails: the `broadcast-x-post:<key>` alert fires hourly and the hourly runs retry until credit is added.
- **Re-post to X only:** delete `<key>` and `<key>#x-post`, after deleting the wrong X post by hand (X refuses identical text). It only works inside the hourly retry window: yesterday's daily, weekly and record broadcasts, a moment on its due day and the 2 days after (see "Moments"), or Reserve deposits after `broadcast:reserve:since` and within 3 days. Older ones are not re-posted.
  `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key = 'broadcast:daily:<day>' OR key = 'broadcast:daily:<day>#x-post'"`
- **Stop X posting now:** `pnpm --filter @ccip-dev/worker exec wrangler secret delete X_ACCESS_TOKEN` stops it at once; `X_POSTS = "off"` needs a push. Either brings the X draft back.
- **The first live post is the first real test** of OAuth 1.0a on X's v2 media upload. If it fails, it fails safe: `broadcast-x-post:<key>` alerts and nothing is posted to X. A duplicate-content refusal from X, or a post whose id could not be read, counts as sent, since the post is on X.

## Moments

After the broadcasts of each 00:07 finalize, the Worker posts "moments": a welcome for each new chain, milestone countdowns, leaderboard movers, a weekly chain spotlight, a weekly "New on CCIP" roundup and a weekly Telegram poll. They come from `moments.json`, which the finalize publishes next to `history.json`; each post's card reads that file too. Spec: `docs/superpowers/specs/2026-10-12-moments-design.md`.

- **Rhythm** (UTC):
  - Welcome: the day after a chain's first message (its first day on either end of a lane, as in `replay.json`).
  - Countdown: on any day when the next all-time messages, value or fees milestone is 2 to 7 days away at the last 7 days' pace; once per milestone.
  - Monday: the poll, after the weekly report: its card, then the poll itself in the same chat.
  - Tuesday: movers, for the week that ended on Sunday. Thursday: the spotlight, for the same week. Saturday: New on CCIP, for Monday to Friday.
  - Movers, the spotlight and New on CCIP skip a week with nothing to say.
- **Budget:** at most 2 moments a day, taken in the order welcome, countdown, movers, spotlight, New on CCIP. A moment that misses its day is planned again on each of the next 2 days, then dropped. The daily, weekly, record, milestone and Reserve posts and the poll do not count. The count is the moment keys (not their `#` rows) whose value is `sent:` with today's date, so a moment that failed and was released gets its place back at the next hourly run.
- **Switch:** `MOMENTS` under `[vars]` in `worker/wrangler.toml` is `off`, `drafts` or `on` (shipped `on`), and works like `BROADCASTS` for moments only. A moment posts only as far as both allow: `off` in either stops moments; `drafts` in either sends them to the drafts chat only (the X draft and the preview). In `on`, a moment goes to the channel and, when X is configured (see "X posting"), to X in place of the X draft. The poll stays on Telegram: in `on` its card and the poll go to the channel, in `drafts` its card as the preview and the poll go to the drafts chat. To stop moments, set `MOMENTS = "off"` and push.
- **Tags:** an X post tags only its subject, and only when its handle is verified. Welcome tags the welcomed chain, the spotlight tags the spotlighted chain, and movers tag the headline chain (the new #1 or the top climber), when the headline is a chain. A token or lane headline tags no one. Countdown and New on CCIP tag no one; everyone else is a plain name. Welcome and countdown close with `#Chainlink`, movers and the spotlight with `#Chainlink $LINK`, and New on CCIP carries `#CCIP`.
- **First run:** without `broadcast:moments:seeded`, the first run marks every moment due or carried over that day `seeded:<time>` without posting it, then sets that key. The poll is not seeded: it posts on the first Monday.
- **Keys** in D1 `meta`, claimed and marked like the other broadcasts, with `#<output>` rows: `broadcast:welcome:<selector>`, `broadcast:countdown:<metric>:<threshold>`, `broadcast:poll:<monday>`, `broadcast:movers:<monday>`, `broadcast:spotlight:<monday>`, `broadcast:roundup:<monday>`. The output rows are `<key>#telegram-channel` and `<key>#x-post` in `on` (`<key>#x-draft` instead of the X post when X is not configured), and `<key>#x-draft` and `<key>#telegram-preview` in `drafts`. The poll's outputs are `telegram-channel` then `telegram-poll` in `on`, and `telegram-preview` then `telegram-poll` in `drafts`; the poll waits until its card has posted, so a failed poll is retried alone and its card is not posted twice. The poll is only retried on its Monday.
- **The poll's row:** `poll:<monday>` (the Monday of the week the poll asks about) holds `{ chat_id, message_id, question_kind, question, options }` once the poll is sent. Next Monday's finalize closes it with `stopPoll` before it publishes `moments.json`, and adds `voters` and `total_voters`; `moments.json` turns them into shares. The 00:07 and the 06:00 finalize both try, and the 06:00 one only closes a poll that has no counts yet; the hourly runs never close a poll. A poll that cannot be closed keeps no counts and alerts `poll-close:<monday>`; its result is posted without "N% of you called it". If both finalizes fail entirely, last week's poll stays open and its result posts without shares.
  `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "SELECT value FROM meta WHERE key = 'poll:<monday>'"`
- **Re-post one:** delete its key and its `#` rows outside 23:55–00:30 UTC, as for the other broadcasts. The next hourly run posts it again while it is still due (its day or the 2 after, for a countdown while the milestone is still 2 to 7 days away), within that day's budget. Deleting a sent moment's key also frees its place in the budget of the day it was sent. Each output keeps its own key, `<key>#telegram-channel` and `<key>#x-post`. To re-post to Telegram only, delete `<key>` and `<key>#telegram-channel` and keep `<key>#x-post`. Deleting `<key>#x-post` posts to X again, at $0.015, and X refuses identical text, so delete the wrong X post by hand first.
- **Re-send the poll:** the poll output skips sending while `poll:<monday>` holds a record for its chat, so deleting only the key and `#` rows would re-post the card and not the poll. Delete the record too, on that Monday only (the poll is planned only on its Monday): `broadcast:poll:<monday>`, its `#` rows and `poll:<monday>`. Next Monday can close only the newest poll message, so if the first poll message was deleted by hand, or you re-send while it is still up, the close of the first raises `poll-close:<monday>`.
  `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key IN ('broadcast:poll:<monday>', 'poll:<monday>') OR key LIKE 'broadcast:poll:<monday>#%'"`
  `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key = 'broadcast:movers:<monday>' OR key LIKE 'broadcast:movers:<monday>#%'"`
- **A card:** `https://ccip.dev/og/broadcast/welcome/<selector>.png`, `…/countdown/<metric>/<threshold>.png`, and `…/poll/<monday>.png`, `…/movers/<monday>.png`, `…/spotlight/<monday>.png`, `…/roundup/<monday>.png`. One that `moments.json` does not hold answers 404.

## Incidents and alerts

Alerts arrive in the Telegram chat.

| Signature | What to check |
|---|---|
| `ingest-lag` | Ingest has not succeeded for a while. Check `lag_seconds` in `status.json`, then the CCIP API (see "Poison message"). |
| `job-failed:<job>` | The named job threw. Read the message in the alert and the Worker logs (`wrangler tail`). |
| `ingest-resume` | The ingest resume walk failed and was dropped. Nothing to do unless it repeats. |
| `price-outlier` | A token amount valued above $10 billion was stored unpriced. Check the price of the listed token on DefiLlama. |
| `price-jump` | A price refresh (or a detail fill's re-fetch) rejected a jump of more than 20×. Check the listed tokens on DefiLlama; if the move is real, accept it (see "Accept a real price jump"). |
| `prices-fetch` | DefiLlama failed during detail valuation. Those tokens stay unpriced until finalize. |
| `daily-usd-anomaly:<day>` | The day's USD moved over 10× against the trailing median. Check the day's top tokens for a bad price. |
| `detail-schema:<path>` | A detail response failed validation. The raw copy is in `unparsed/<id>.json` in the archive bucket. |
| `detail-fill:<day>` | Some of the day's detail fills kept failing: an infrastructure error while filling, or a detail request that failed in a way a later retry could fix: HTTP 429, a 5xx or a network error, after the client's retries (a 404 or another 4xx does not count; that message keeps its list values). For 72 hours after the day starts, finalize holds the day (`job-failed:finalize` names it) while the hourly retries can still fill those messages, then rolls it up as they stand and sends this alert. A message never filled counts with its list values (no fee, first token only); one filled earlier but still unpriced keeps its detail values. Read the first failure in the alert and the Worker logs. If those fills succeed later, the day's totals stay stale until you re-finalize it by rewinding `last_finalize_day` (see "Re-finalize a day"). Messages whose `next_check_at` is NULL (final ones) get no hourly retry; only finalize runs retry them. |
| `finalize-collect:<day>` | The day's list sweep kept failing for 72 hours after the day started, so finalize rolled it up from the messages already in D1 and skipped its R2 archive. Usually nothing to do: the day's totals are complete if ingest saw every message, and only the archive is missing. Read the reason in the alert; if the list API recovered and you want the archive, rewind `last_archived_day` (see "Re-finalize a day"). |
| `site-dispatch` | The Worker could not start the site build after a history publish (the message gives the HTTP status or error). Pages still refresh at the next scheduled build. A 401 or 403 usually means `GITHUB_DISPATCH_TOKEN` expired or lacks Actions: Read and write; create a new one and `wrangler secret put` it. |
| `fee-version:<v>` | A message uses a CCIP version whose fee format is unknown. Add support for it. |
| `archive-count:<day>` | The day's archive and D1 disagree on the message count. Re-finalize the day (below). |
| `coingecko-ids` | CoinGecko ids could not be refreshed. Retried hourly. |
| `coingecko-ids-read` | CoinGecko ids could not be read from D1. Tokens the group cannot price stay unpriced this run. |
| `token-groups` | Token groups could not be read. Tokens without a price stay unpriced this run. |
| `replay-publish` | `replay.json` was not published; the other history files still were. Check the D1 lane rows (`daily_breakdown`) and the finalize logs. |
| `cost-publish` | `cost.json` was not published; the other history files still were, and the site keeps the previous `cost.json`. Read the error in the alert and the finalize logs. The query reads the last 30 days of priced fees from `messages` through the `messages_day` index. |
| `day-leaders-publish` | `day-leaders.json` was not published; the other history files still were. The broadcast cards read it, so that finalize's daily and weekly cards answer 404 and are not posted (the hourly runs retry them once the next publish works). Read the error in the alert and the finalize logs. |
| `moments-publish` | `moments.json` was not published; the other history files still were. The moment cards read it, so that day's moments answer 404 and are not posted until a later publish works (the hourly runs retry them while they are due). Read the error in the alert and the finalize logs. |
| `broadcast-image:<key>` | The broadcast's card answered an error or did not answer within 20 s, so nothing was posted and its key was released. Open the card URL in the alert; watch it with `pnpm --filter @ccip-dev/site exec wrangler tail ccip-dev-site --search "card"`. The hourly run retries yesterday's broadcasts. |
| `broadcast-telegram-channel:<key>` | The channel post failed. The Worker logs give Telegram's answer; a 400 "chat not found" or 403 means the bot lost its admin rights in `@ccipdev`. The key is released and the next hourly run retries the channel alone; the other outputs are not sent again. A bot that lost its admin rights alerts every hour until the day rolls over. |
| `broadcast-x-post:<key>` | The post to X failed; the Worker logs give the step (upload or post), X's HTTP status and its detail. 401 or 403 means bad keys, a token generated before Read and write was set, or a duplicate post; 402 or 403 can mean no API credit; 429 means rate-limited. It alerts every hour until fixed. |
| `broadcast-x-draft:<key>` | The X draft did not reach the drafts chat; read the Worker logs. |
| `broadcast-telegram-preview:<key>` | The drafts-mode preview of the channel caption did not reach the drafts chat; read the Worker logs. |
| `broadcast-telegram-poll:<key>` | The week's poll was not sent after its card posted. The Worker logs give Telegram's answer. The key is released and the next hourly run sends the poll alone; its card is not posted again. |
| `poll-close:<monday>` | A problem with the poll of the week of `<monday>`, with one of three causes. (1) It could not be closed at Monday's finalize: its message was deleted, the bot lost its rights in the chat, or the call failed; the 06:00 finalize retries a close that failed at 00:07. (2) It was closed, but its counts could not be saved; its result then posts without "called it". (3) It went out but its record could not be saved: close it by hand in Telegram next Monday. For (1) and (2) nothing is left to retry, and a poll that could not be closed stays open in Telegram until someone closes it by hand. Without counts, the card shows the answer without vote shares. |
| `broadcast-mark:<key>#<output>` or `broadcast-mark:<key>` | A `sent:` key could not be written, even after one retry. For `<key>#<output>`, the post went out: set that row to `sent:<time>` by hand (`INSERT … 'sent:<time>'` into `meta`) so it is not sent again. For `<key>`, every output already sent, so nothing is at risk of a re-post. |
| `broadcast-copy:<key>` | The post could not be written within X's 280 or Telegram's 1,024 even with every droppable line gone. Nothing was posted; read the alert. |
| `broadcast-run` | The broadcast step itself failed (for example a D1 error while reading its facts). Finalize and the hourly job still finished; the next hourly run retries. |
| `reserve-read` | The Reserve balance read failed several hours in a row. Check the RPC endpoints. |
| `reserve-scan` | The Reserve transfer scan failed several hours in a row. Check the RPC endpoints. |
| `reserve-outflow:<tx>` | LINK left the Reserve. Open the transaction on Etherscan. See "Missed Reserve outflow alert" if a crash may have eaten one. |
| `reserve-mismatch` | Transfers do not net to the balance. Re-scan from an earlier block (see "Health checks"). |
| `ccip.dev watchdog: …` | `status.json` is old, unreadable, or ingest lag is high. Check the Worker and the CCIP API. |

### Re-finalize a day

Set `last_finalize_day` to the day before the one to redo. Set `last_archived_day` too if the archive must be
rewritten. Finalize then redoes every day after that one, oldest first.

`pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "UPDATE meta SET value = '<day>' WHERE key = 'last_finalize_day'"`

Use `last_archived_day` in place of `last_finalize_day` for the second key.

- **Pacing:**
  - Each run redoes at most 3 days: the 00:07 run from `last_finalize_day`, and the 06:00 run from `last_archived_day`.
  - Each day adds one new day, so a rewind of N days catches up by about 2 days a day. Yesterday's 00:07 finalize, which the daily broadcast follows, is late by about N/2 days.
  - Until the 06:00 run catches up, it skips its usual re-finalize of yesterday. Each day still gets its full late run when its archive turn comes.
  - Rewind no further than you need.
- **Cost:** each day is collected by its own walk from the newest message down to that day, so redoing old days pages through every newer day again (about 1–3 pages of 1000 per day of depth). A walk stops at 200 pages, so a rewind deeper than about 60 days cannot be walked; use the backfill instead.
- **Detail budget:**
  - Detail fills share one 5-minute budget, which starts when the run starts and also covers the list walks. In a deep catch-up, the later days of a run may get little or none of it. They roll up with list values for the messages still missing details, and the log says "detail fill stopped at its deadline".
  - The 06:00 run re-fills a day's missing details when it archives that day. For a day already archived, rewind `last_archived_day` too.
- **A day that fails** (`job-failed:finalize` names it) holds its own run's pointer: `last_finalize_day` for the 00:07 run, `last_archived_day` for the 06:00 run. The later days in the same run still finalize and publish, and the next run of that kind retries it.

### Re-price live fees after an alias change

The Worker values a live message's fee once, at detail time, so live rows whose fee token was added to `FEE_PRICE_ALIASES` later keep `fee_usd` NULL. Finalize now re-prices a day's unpriced live fees (at the latest price) each time it finalizes that day. After an alias change it is enough to deploy, then rewind `last_finalize_day` to the day before the first affected day (finalize redoes at most 3 days per run at 00:07). This recipe remains for long ranges and for valuing each fee at its send day's price. It prices them from an exported list.

1. **Deploy the Worker with the new table first.** The old Worker's `applyDetail` would reset `fee_usd` on a refill.
2. **Export the candidates** (read-only), with `<from>` the first live day (2026-10-05 for the first run):
   `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --json --command "SELECT m.message_id, m.day, m.src_chain, c.chain_id, c.family, m.fee_token, m.fee_amount FROM messages m JOIN chains c ON c.selector = m.src_chain WHERE m.source = 'live' AND m.day >= '<from>' AND m.fee_usd IS NULL AND m.fee_token IS NOT NULL AND m.detail_fetched_at IS NOT NULL" > candidates.json`
3. **Generate the SQL:** `pnpm backfill:fees:reprice-live --from <from> --in candidates.json`. It keeps only rows whose chain and token together are in the table, prices each at its day's coin price, writes `.backfill/fees/reprice-live-<from>.sql` and prints per-day and per-chain counts and USD sums, the total, and the rows left unpriced with the reason. Read the totals.
4. **Owner applies it,** outside 23:55–00:30 and 05:50–06:20 UTC:
   `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --file=<absolute path to the sql>`
   Each statement only touches a row still unpriced with the same chain, token and amount, so a rerun is safe.
5. **Owner rewinds `last_finalize_day`** to the day before `<from>`, outside the same finalize windows (a rewind issued during the 00:07 run is overwritten by that run's `setMeta`), as in "Re-finalize a day":
   `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "UPDATE meta SET value = '<day before from>' WHERE key = 'last_finalize_day'"`
   Finalize redoes at most 3 days per run at 00:07, plus yesterday at 06:00, so catching up N days takes about N/2 days.
6. **Verify:** rerun the generator on a fresh export; it should price 0 rows. The export itself also lists unaliased rows (Canton, Mova), so judge by the generator.

### Accept a real price jump

A key whose price moved more than 20× keeps its stored price, and both the prices job and detail fills keep rejecting
the new one. Only keys seen in the last 30 days are guarded: a token dormant for longer takes its new price. To accept
a real move, write the new price into `prices_latest`:

`pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "UPDATE prices_latest SET usd = <new price>, ts = '<now, ISO 8601 UTC>' WHERE llama_key = '<key from the alert>'"`

The next refresh compares against that price. Messages valued while the jump was rejected keep the old price's
value. To re-value a day, mark its messages holding the token as unpriced, then re-finalize the day (above):

`pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "UPDATE messages SET unpriced = 1 WHERE day = '<day>' AND message_id IN (SELECT message_id FROM message_tokens WHERE chain = '<chain selector>' AND token = '<token address as stored, lowercase for EVM>')"`

### Missed Reserve outflow alert

The alerter writes an alert's suppression row (`alert:<signature>` in `meta`) before it sends, so overlapping runs
cannot send twice. A refused Telegram send deletes the row again, and the next hourly run retries. A crash between
writing the row and sending leaves the row, though, and the outflow check skips any transaction that has one. That
outflow is then never alerted. If the Worker logs show a crashed hourly run near an outflow, open the transaction on
Etherscan. To have it re-alerted, delete its row within 24 hours of the transfer:

`pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key = 'alert:reserve-outflow:<tx hash>'"`

### Stuck ingest resume

If the ingest resume walk never finishes, delete its two meta keys. The next run starts a fresh walk.

`pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key IN ('ingest_resume_cursor', 'ingest_resume_stop_id')"`

### Poison message

- **Symptoms:** `job-failed:ingest` or `job-failed:finalize` saying "GET /messages returned HTTP 500 … possibly a
  poison message", and `lag_seconds` rising.
- **Confirm:** `curl -s "https://api.ccip.chain.link/v2/messages?environment=mainnet&limit=1"` returns HTTP 500 or
  times out.
- **State:** live ingest cannot get past the message, and no automatic recovery exists yet (a per-source fallback is
  a planned follow-up).
- **Nothing is lost:** once the API recovers, or with the backfill crawler (`pnpm backfill:sources`, which skips
  poison messages), the gap can be filled. `status.json` shows the delay meanwhile.

## Website (ccip.dev)

- **What runs:**
  - The Worker `ccip-dev-site` serves `site/dist` (built by Astro) as static assets on `ccip.dev`.
  - It also renders share cards at `/og/*.png` from the public JSON. Only `/og/*` runs Worker code.
  - `www.ccip.dev` redirects to `https://ccip.dev` through a dashboard redirect rule.
- **Deploys:**
  - The `site` workflow runs on every push to `main` that touches `site/`, `packages/core/`, `docs/methodology.md` or the lockfile.
  - It also runs at 00:25 and 06:25 UTC, after each finalize run, so day pages and records pick up the new day.
  - Run it by hand with `gh workflow run site`.
- **Local builds:** setting `CCIP_DATA_BASE` to another base URL (for example a local mirror of the `v1/` files) builds against it.
- **First deploy:** until the owner's first `wrangler deploy` attaches `ccip.dev` as a custom domain (or the token gains Zone · Workers Routes · Edit), the `site` workflow's deploy step fails and the previous deploy, if any, stays live.
- **Build failures:**
  - The build fetches every public file and fails when one is missing or has the wrong shape.
  - `cost.json` is the one exception: before the Worker first publishes it (at the next finalize after a deploy), the build passes, the Top lanes "Typical fee (30d)" column shows "—", and the Flow picker says the data is not available.
  - The previous deploy stays live. Check the data Worker first (`curl -s https://data.ccip.dev/v1/status.json`), then re-run the workflow.
- **Budgets:**
  - `pnpm --filter @ccip-dev/site build` fails when the home page's JavaScript goes over 150 KB gzipped, or the replay page's over 200 KB.
  - Fix the size; do not raise the budget without deciding to.
- **Share cards:**
  - Cards are cached at the edge for 5 minutes (home) to 7 days (finalized days).
  - A card that fails to render serves `og-default.png` for 60 seconds.
  - Watch failures with `pnpm --filter @ccip-dev/site exec wrangler tail ccip-dev-site --search "card"`.
- **Sponsor:**
  - Set `site/sponsor.json` to `{ "name", "url" (https), "logo" (a file in site/public/sponsor/), "tagline" }` and push.
  - `{}` shows the "sponsor ccip.dev" invitation.
- **Analytics:** Umami at `analytics.jivx.com`. The website ID is `UMAMI_WEBSITE_ID` in `site/src/config.ts`. An empty ID loads no script.
- **Brand images:** `pnpm --filter @ccip-dev/site cards:static` regenerates `og-default.png`, `apple-touch-icon.png` and `favicon-32.png`. Commit the results.

## Fee backfill

Fills fees for every day before live ingest (2023-07-06 to 2026-10-04) from one CCIP detail per message. Spec: `docs/superpowers/specs/2026-10-08-fee-backfill-design.md`. Data lives in `.backfill/fees/`. The original backfill data in `.backfill/` (archive, prices, registry, sql) must be on disk; the fee scripts only read it. Run everything from the repo root.

1. **Probe** (about 19–22 minutes, up to about 4,000 requests, with no per-day ceiling): `pnpm backfill:fees:fetch --probe`. Read `.backfill/fees/probe.json`.
   - Every `versions` entry should have fees: `feeNull` and `unknownShapes` near 0, `schemaFailures` 0. If not, stop and check `.backfill/fees/unparsed/`.
   - `statuses` counts responses per HTTP status. A large share of 5xx or other 4xx means the API is unhealthy; wait and probe again.
2. **Fetch** (2.5–6 days, resumable): `caffeinate -ims pnpm backfill:fees:fetch`.
   - **Sleep:** keep the Mac on power with the lid open. `caffeinate` holds off idle sleep, and `-s` holds off system sleep while on power, but closing the lid still sleeps the Mac. After a sleep or a Wi-Fi drop the crawl may stop with `answered nothing for 15 minutes`; just rerun.
   - **Rate:** starts at 3 req/s and adds 1 after each healthy 10-minute window, up to 8. It halves and holds 10 minutes on a 429 (a burst of 429s counts once) or on an error rate over 1% (at least 3 errors in at least 100 requests). A 429 also pauses for `Retry-After`, up to 30 s (5 s when absent). Changes show as `rate X -> Y req/s (…)` lines.
   - **Retries:** a failing message is retried after 5, 10, 20, 40 and 80 s. If the API has answered anything since the message first failed, it is then recorded as a skip with the reason `failed N times over M min: …`. Otherwise it keeps retrying every 80 s, so an outage ends at the 15-minute stall check below rather than in skips, even on a day of a few messages. A message that keeps failing at the very end of a day, with nothing else in flight, holds the day until that check; if the check's re-fetch answers, the message is then skipped. The same can add up to 15 minutes to the probe. A 404 or 410 is a skip at once.
   - **Log:** one line per finished day, with counts, skips, the rate, the version histogram, unknown fee shapes (a running total), total progress and an ETA.
   - **Stops:** the crawl stops with an error, and a rerun of the same command resumes. Finished days are sealed, and a torn last line of a day's partial file is dropped and refetched.
     - `the CCIP API refused the crawl with HTTP <401|403|451>; check access, then rerun to resume`: the API is blocking you. Check access first.
     - `the CCIP API has answered nothing for 15 minutes; stopping, and a rerun resumes`: after 15 minutes without an answer it re-fetches a message known to work and stops only if that fails too (a 429 or 5xx counts as failing). That message is the latest good one of this run, or else an ok message from the day's earlier records or from the newest sealed day. With none of those (the very start of the crawl), it stops at once with no re-fetch.
     - `<day>: n of m messages kept failing (<first reason>); the CCIP API may be degraded. Rerun later to retry them`: a day is not sealed when more than max(5, 5% of its messages) are unusable. Unusable means a retried-out skip, a `schema:` skip (a response that failed validation) or an unknown fee shape. A rerun refetches the first two kinds. It keeps unknown fee shapes, since the API would give the same answer, and counts them again.
       - Reason `failed N times …`: rerun later. If the same day stops with this message again on reruns hours apart, seal it with `caffeinate -ims pnpm backfill:fees:fetch --accept-failures <day>` (repeat the flag for more days; the command carries on with the whole crawl). Its failed messages keep NULL fees and stay unfilled, which shows in its checks as `withFee` below `messages`.
       - Reason `schema: …` or `unknown fee shape, version …`: the API answered in a shape the code can't read, and reruns won't change that. Inspect the raw bodies in `.backfill/fees/unparsed/<messageId>.json`. Reading a new shape takes a code change (`normalizeDetail` in `packages/core`) and then a refetch of the day (as for a corrupt sealed file, below). To keep the crawl going meanwhile, seal the day with `--accept-failures`; the build then flags its unknown shapes.
     - A corrupt file: the error starts with the file's path, as in `<path>: line N is not valid JSON: …`, or a zlib error for a damaged gzip, as in `<path>: incorrect header check` or `<path>: unexpected end of file`. The build reads the same files, so it can stop with the same errors. `the archive for <day> has a row without a messageId` names the day instead.
       - Under `.backfill/archive/messages/`: original input. Restore it from a copy of `.backfill/`.
       - Under `.backfill/fees/details/`: derived data. Delete it. If it was sealed (`….jsonl.gz`), also remove the day from `done` in `.backfill/fees/state.json` and rerun the fetch, as in the incomplete-day recipe under Build. If the day was already uploaded, also reset its rows with the SQL under "Redo an uploaded day" before the next upload.
3. **Build** (any time, as often as you like): `pnpm backfill:fees:build`.
   - **Output:** SQL for the sealed days not built yet, or whose sealed file changed since, in `.backfill/fees/sql/B<NNNN>/` with a `BUILD` file.
   - **Checks:** logged and saved in `.backfill/fees/checks/B<NNNN>.json`.
     - `check: <day> has fees per message more than 5x away from its neighbours' median`: an outlier day, above or below, compared with the days within a week across all batches. A day with fewer than 3 neighbours in that week is never flagged, so the first and last days of the range go unchecked.
     - `check: <day> has fee tokens without a price on more than 10% of its fee messages`: a gap in price history.
     - `check: <day> has <n> messages with an unknown fee shape; hold this batch and inspect .backfill/fees/unparsed/`: the build writes no fee for those messages, so their rows stay unfilled and can be filled later. The day's rollups count them with no fee, so its fees read low.
     - `check: <n> fee messages on <token> (<chain>) have no fee group`: across the batch, a fee token in neither `FEE_TOKEN_GROUPS` nor the LINK set. Its fees count as other. Expected:
       - Everclear `0x2e31…835f` and Mind `0x3902…2d0b` (both chains are shut down);
       - Base zunETH `0x24cb…91de`;
       - Botanix `0x0d24…0c56`, Corn `0xda5d…dfb2` and Memento `0x0869…d7bd` (no reachable RPC to check them);
       - zero-amount fee tokens on Pharos, Tempo and TON.

       Check any other token as in "Fee groups, Regenerate the table", step 3.
     - `largest fee: …`: the 10 largest fees.
   - **Fee price table, fee groups and build format:** the next build rebuilds every sealed day into one new batch after a change to any of:
     - `FEE_PRICE_ALIASES` (`packages/core/src/fee-aliases.ts`);
     - `FEE_TOKEN_GROUPS` (`packages/core/src/fee-groups.ts` and the generated `fee-groups-docs.ts`);
     - the decimals in `UNLISTED_LINK_FEE_TOKENS`;
     - `FEE_BUILD_FORMAT` (`scripts/backfill/fees/build.ts`).

     It logs `the fee price table, fee groups or build format changed since the last build; building every sealed day again`. That is expected, and its upload is safe: it fills the fees still NULL, leaves priced fees alone and recomputes the rollups. The build also asks CoinGecko's free public API for the daily history of a coin DefiLlama has none for (today MOVA, once), and that API can rate-limit (HTTP 429): rerun the build if it stops on one.
   - **Fee groups in the SQL:** each day's `daily_totals` UPDATE also writes `fee_native_usd`, `fee_stable_usd` and `fee_link_amount`. Upload such a batch only once migration 0005 is on the remote database (Fee groups, Rollout).
   - **Correcting a wrong alias entry** (for example wrong decimals): priced rows are never overwritten, so first reset the fee of the affected rows, scoped by chain and token, outside the finalize windows:
     - backfill rows: `UPDATE messages SET fee_usd = NULL WHERE source = 'backfill' AND src_chain = '<sel>' AND fee_token = '<tok>';`
     - live rows: the same with `source = 'live'`.

     Then rebuild and upload the backfill, run "Re-price live fees after an alias change", and re-finalize.
   - **Read the checks before the next upload.** Upload applies every `B<NNNN>` folder that has a `BUILD` file, in order, with no per-batch choice. Don't upload a batch with an outlier, low-priced or unknown-shape day you can't explain.
   - **Hold back or redo a batch not uploaded yet:**
     1. Delete its folder, `.backfill/fees/sql/B<NNNN>/`. Never set it aside to restore later. A message keeps the fee of the first batch that prices it (a NULL fee is overwritten), while a day's rollups take the last batch applied, so the upload refuses a batch numbered below one already uploaded.
     2. Remove every day it holds from `built` in `.backfill/fees/build-state.json`. `.backfill/fees/checks/B<NNNN>.json` lists them. This command does it for `B0007`:
        `node -e 'const fs=require("fs"),f=".backfill/fees/build-state.json",s=JSON.parse(fs.readFileSync(f));for(const c of JSON.parse(fs.readFileSync(".backfill/fees/checks/"+process.argv[1]+".json")).checks)delete s.built[c.day];fs.writeFileSync(f,JSON.stringify(s))' B0007`
     3. Once the cause is fixed, build again. The days come out in a new, higher-numbered batch.

     If the upload stopped partway through the batch, some of its days are already in D1: redo those as uploaded days.
   - **Redo an uploaded day:** message updates only touch rows with `detail_fetched_at IS NULL` or `fee_usd IS NULL`, so first reset the day's rows, outside the finalize windows (23:55–00:30 and 05:50–06:20 UTC):
     `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "UPDATE messages SET fee_token = NULL, fee_amount = NULL, fee_usd = NULL, detail_fetched_at = NULL WHERE day = '<day>' AND source = 'backfill';"`
     Then remove that day from `built` in `.backfill/fees/build-state.json`, build, and upload. Rebuild only days you have reset: a rebuilt day whose rows are still filled keeps its old message fees while its rollups change. The fee-wipe path at the end of this section can't redo a day, because it never resets message fees.
   - **Stops:**
     - `<file> is missing: the fee build reuses the original backfill's price cache`, or `<file> covers X..Y, not A..B; refusing to start a new cache`: restore the original `.backfill/prices/cache.json` and archive. Never delete the cache.
     - `fee build: <day> has n archived messages with no detail record; its sealed file is incomplete`: the sealed day is in `done`, so a plain fetch rerun skips it and every later build fails on it. Delete `.backfill/fees/details/YYYY/MM/DD.jsonl.gz` for that day, remove the day from `done` in `.backfill/fees/state.json`, run `pnpm backfill:fees:fetch` again, then build.
4. **Upload** (owner): `pnpm backfill:fees:upload`.
   - **`.env`:** the file must exist (it may be empty), or `tsx` exits with `node: .env: not found` before the script runs. The fee upload reads only the optional `CF_BACKFILL_TOKEN`; without it your `wrangler login` session is used. It needs no R2 or account variables.
   - **Order and resume:** it applies batches in order and resumes after a failure from `.backfill/fees/upload-state.json`, keyed on each batch's `BUILD` id, so a rebuilt batch is applied again. A batch folder without `BUILD` is an unfinished build and is skipped. A failed file is safe to rerun: message updates only touch rows with `detail_fetched_at IS NULL` or `fee_usd IS NULL`, and the rollups are absolute sets. An `ENOENT` on `.backfill/fees/sql` means run the build first.
   - **Old batches:** `B<NNNN> was built before batches already uploaded; delete it and rebuild its days instead (see docs/runbook.md, Fee backfill)`: a batch folder numbered below one already uploaded has files not applied yet, usually an old folder put back. The upload checks this before applying anything. Delete the folder and rebuild its days as under "Hold back or redo a batch not uploaded yet".
   - **Alerts:** each file import makes D1 unavailable, as in "Backfill upload". Expect `job-failed` and watchdog alerts such as `ingest-lag` while it runs.
   - **Finalize windows:** it waits out 23:55–00:30 and 05:50–06:20 UTC (`waiting for the Worker finalize window to pass`). The wait covers file starts only, so an import that began just before can run on past 23:55 or 05:50.
   - **Publishing:** the next finalize (00:07 or 06:00 UTC) republishes `history.json` and `top/*`, and the site picks up the new coverage on its next build (00:25 or 06:25 UTC). The site takes fee coverage from `history.json`, so the "Fees are collected from …" notes move back as batches load and disappear once coverage starts at 2023-07-06.

**State files.** A corrupt one stops its script with an error that starts with the file's path. Each can be deleted:
- `.backfill/fees/state.json` (fetch): the next fetch rebuilds it from the sealed days, counting each as done, and resumes unsealed days from their partial files.
- `.backfill/fees/build-state.json` (build): the next build rebuilds every sealed day into one new batch, numbered after the last checks file. That is safe, but it means uploading everything again.
- `.backfill/fees/upload-state.json` (upload): the next upload re-applies every batch. That is safe because the SQL is idempotent, but it takes as long as the first upload.

Suggested rhythm: probe, then the full fetch under `caffeinate -ims`. After about 5 hours the last 30 days are done, so run build then upload. Repeat as more days finish.

The original `pnpm backfill:upload` refuses to apply SQL once a fee upload has started ("The fee backfill has been uploaded, and this SQL would reset daily fee totals and breakdowns to NULL"). To run it anyway, in this order: run it with `--allow-fee-wipe`, then delete `.backfill/fees/upload-state.json`, then rerun `pnpm backfill:fees:upload`.

## Fee groups

`FEE_TOKEN_GROUPS` (`packages/core/src/fee-groups.ts`) puts each non-LINK fee token in `native` (gas tokens) or `stable`. Any other token counts as other. The table merges the generated `packages/core/src/fee-groups-docs.ts` with the hand-added entries in `fee-groups.ts`.

### Regenerate the table

Do this when CCIP adds a chain or a fee token.

1. Run `pnpm fee-groups:generate`. It reads the CCIP docs' mainnet `chains.json` and `tokens.json` from GitHub and rewrites `fee-groups-docs.ts`. It prints each symbol with its group and chains, then any `left out` symbols, `skipped LINK on <n> chains`, and any `missing …` line.
2. Read every line.
   - A symbol that is neither a gas token (or its wrapped form) nor a USD stablecoin goes in `UNGROUPED_SYMBOLS` in `scripts/fee-groups/generate.ts`.
   - A new stablecoin symbol goes in `STABLE_SYMBOLS`.
   - Regenerate after either change.
3. Hand-add a fee token to `HAND_ADDED` in `fee-groups.ts` when it shows in a `missing <symbol> on <chain>` line, or when the fee build's no-group check names it (Fee backfill, Build) and it is a gas token or a stablecoin.
   - Read `symbol()` on chain through the chain's keyless RPC in `config/endpoints.json`.
   - Write a one-line comment saying what the token is and why the docs miss it.
4. Run `git diff packages/core/src/fee-groups-docs.ts`, then `pnpm --filter @ccip-dev/core test`, and commit.
5. A table change makes the next fee build rebuild every sealed day (Fee backfill, Build). The Worker uses the new table for the days it finalizes after its next deploy. To regroup earlier live days, rewind `last_finalize_day` as in "Re-finalize a day".

### Rollout (one time)

1. **Migration 0005** adds `fee_native_usd`, `fee_stable_usd` and `fee_link_amount` to `daily_totals`, and the index `idx_messages_fee_usd`. The deploy workflow applies migrations before it deploys the Worker, so merging to `main` applies it. For a deploy by hand, first run `pnpm --filter @ccip-dev/worker exec wrangler d1 migrations apply ccip-dev --remote`.
2. **Live days:** finalize writes the three columns for each day it finalizes. To fill the live days from 2026-10-05 to the deploy, rewind `last_finalize_day` to 2026-10-04, outside 23:55–00:30 and 05:50–06:20 UTC:
   `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "UPDATE meta SET value = '2026-10-04' WHERE key = 'last_finalize_day'"`
   Finalize redoes at most 3 days per 00:07 run, so N days take about N/2 days, as in "Re-finalize a day".
3. **Backfill days:** after the crawl ends, the next fee build rebuilds every sealed day with the new columns, because the pricing hash changed. Upload it as usual (Fee backfill).
4. Until every day carries the columns, the Reserve's fee mix and LINK tiles cover only the days that have them, and say from when.

`history.json` also lists `largest_fees`: the 10 largest single fees of the days it holds.
