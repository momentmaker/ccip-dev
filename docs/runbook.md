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
9. Schema: `… wrangler d1 migrations apply ccip-dev --remote`.
10. Deploy: `… wrangler deploy`.

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

Run this once, after the Worker is deployed. The import makes D1 unavailable while each SQL file runs, so the Worker's jobs fail during the upload. Do it in one sitting, well away from 00:10 and 06:00 UTC (finalize), and expect `job-failed` and watchdog alerts while it runs.

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
| `fee-version:<v>` | A message uses a CCIP version whose fee format is unknown. Add support for it. |
| `archive-count:<day>` | The day's archive and D1 disagree on the message count. Re-finalize the day (below). |
| `coingecko-ids` | CoinGecko ids could not be refreshed. Retried hourly. |
| `coingecko-ids-read` | CoinGecko ids could not be read from D1. Tokens the group cannot price stay unpriced this run. |
| `token-groups` | Token groups could not be read. Tokens without a price stay unpriced this run. |
| `replay-publish` | `replay.json` was not published; the other history files still were. Check the D1 lane rows (`daily_breakdown`) and the finalize logs. |
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
  - Each run redoes at most 3 days: the 00:10 run from `last_finalize_day`, and the 06:00 run from `last_archived_day`.
  - Each day adds one new day, so a rewind of N days catches up by about 2 days a day. Yesterday's 00:10 finalize, which the 00:15 daily post reads, is late by about N/2 days.
  - Until the 06:00 run catches up, it skips its usual re-finalize of yesterday. Each day still gets its full late run when its archive turn comes.
  - Rewind no further than you need.
- **Cost:** each day is collected by its own walk from the newest message down to that day, so redoing old days pages through every newer day again (about 1–3 pages of 1000 per day of depth). A walk stops at 200 pages, so a rewind deeper than about 60 days cannot be walked; use the backfill instead.
- **Detail budget:**
  - Detail fills share one 5-minute budget, which starts when the run starts and also covers the list walks. In a deep catch-up, the later days of a run may get little or none of it. They roll up with list values for the messages still missing details, and the log says "detail fill stopped at its deadline".
  - The 06:00 run re-fills a day's missing details when it archives that day. For a day already archived, rewind `last_archived_day` too.
- **A day that fails** (`job-failed:finalize` names it) holds its own run's pointer: `last_finalize_day` for the 00:10 run, `last_archived_day` for the 06:00 run. The later days in the same run still finalize and publish, and the next run of that kind retries it.

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
