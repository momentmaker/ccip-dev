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
   - Optional: `… wrangler secret put RPC_ETHEREUM` and `RPC_FALLBACKS` (comma-separated). Use them only for keyed RPC URLs; without them, the public endpoint is used.
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
3. `gh variable set CLOUDFLARE_ACCOUNT_ID --body <account id from wrangler whoami>` (not a secret), then `gh secret set TELEGRAM_BOT_TOKEN` and `gh secret set TELEGRAM_ALERT_CHAT_ID`, with the same values as the Worker secrets. The last two are for the watchdog. Each secret command prompts for its value.
4. Commit the real `database_id`, so the first CI deploy does not migrate the placeholder id: `git add worker/wrangler.toml && git commit -m "chore: production D1 database id"`. The database id is not a secret.
5. Only now push, so the first `deploy` run already has its token and the right id: `git push -u origin main`.

## Health checks

- `curl -s https://data.ccip.dev/v1/status.json | jq '{lag_seconds, last_finalize_day, coverage_from}'`: `lag_seconds` should stay under 120.
- Freshness: `curl -s -A curl/8.7.1 'https://api.ccip.chain.link/v2/messages?environment=mainnet&limit=1' | jq -r '.data[0].messageId'` should equal `curl -s https://data.ccip.dev/v1/live.json | jq -r '.messages[0].id'`. If they differ, run both again a minute later; a match then is normal ingest delay.
- `curl -sI https://data.ccip.dev/v1/live.json | grep -iE 'cache-control|cf-cache-status'` should show `public, max-age=30`.
- `curl -sI -H 'Origin: https://example.com' https://data.ccip.dev/v1/live.json | grep -i access-control-allow-origin` should show `*`.
- `gh workflow run watchdog`, then `gh run list --workflow watchdog --limit 1` should show a success.
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
   3. `pnpm backfill:build --live-start <live_start_day>` (read it with `… wrangler d1 execute ccip-dev --remote --command "SELECT value FROM meta WHERE key = 'live_start_day'"`). Each build also fetches the CCIP token registry (`/chains` and every `/tokens` page, a few requests) and CoinGecko's keyless coin id lists (`/asset_platforms` and `/coins/list`, two requests; ids only, never prices) into `.backfill/registry/`. A token with no price on a day takes the price of another copy of the same token that day, then its CoinGecko coin's DefiLlama price that day: the fallback the Worker also uses. A price series without a point on a day uses its nearest point at most two days away, the earlier one on a tie.
   4. `pnpm backfill:upload`. Answer `y` if wrangler asks to confirm a remote import.
5. If interrupted, re-run `pnpm backfill:upload`; it resumes from `.backfill/upload-state.json`. After a rebuild, the new build id makes it apply every SQL file and replace every archive again. The upserts only touch backfill rows.
