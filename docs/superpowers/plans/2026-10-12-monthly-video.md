# The Monthly Video (3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the 1st of each month, record a 30 s, 1080×1080 video of last month's CCIP activity in GitHub Actions and post it once to @ccipdev on Telegram and X through the live broadcast pipeline, with the same guarantees as every other broadcast, while the all-time replay stays exactly as it is.

**Architecture:** A pure month module in `@ccip-dev/core` sums a month from the rows `history.json` and `replay.json` publish, for both the site and the Worker. On the site, the replay's `Show` learns a month cut (that month's days, chains and lanes, its own fees counter, a longer finale with an end card); a characterization test pins the all-time cut's frames, story layer and score before any of it changes. An unlisted page, `/replay/month/?m=YYYY-MM`, plays the cut and installs `window.ccipRecord`, which records it with the existing offline recorder (silent H.264) and hands over the video and a WAV soundtrack as two downloads. A workflow drives that page in headless Chrome stable with Playwright, muxes the sound in with ffmpeg, checks the file with ffprobe and puts it in the private archive bucket. The data Worker's hourly run, on the 1st to the 3rd, finds the file, claims `broadcast:monthly:YYYY-MM` and sends it through the existing outputs, now able to send a video: Telegram `sendVideo` and X's v2 chunked upload.

**Tech Stack:** TypeScript (ESM), Vitest 4 (Node for core, site and scripts; `@cloudflare/vitest-plugin` with real D1 and R2 for the Worker), Astro 7 and React 19, WebGL2 and WebCodecs through mediabunny 1.61.3 (already in the site), the Telegram Bot API (`sendVideo`), the X API v2 media upload, GitHub Actions on `ubuntu-24.04`, Playwright 1.64.0 with Chrome stable, ffmpeg and ffprobe (workflow-only), `wrangler r2 object put`. One new dev dependency, Playwright, at the repo root only.

**Spec:** `docs/superpowers/specs/2026-10-12-monthly-video-design.md`. Background: the replay spec `docs/superpowers/specs/2026-10-07-viral-replay-design.md` (§7 director, §9 story layer, §10 score, §11 player), and the broadcast specs and plans `docs/superpowers/specs/2026-10-11-broadcasts-design.md`, `docs/superpowers/specs/2026-10-12-moments-design.md`, `docs/superpowers/plans/2026-10-12-moments.md`.

## Global Constraints

- **The guarantees** (spec §1): "it posts once; a video that isn't there or isn't valid is never posted; there are no links; each output is retried on its own; the existing switches stop it."
- **Format:** "30 s, square 1:1 (1080×1080), with sound." **Valid:** "about 30 s, 1080×1080, H.264 with AAC audio, under 50 MB, and plays inline on both."
- **The month page:** "`/replay/month/?m=YYYY-MM`. It is unlisted (no nav link, `noindex`, not in the sitemap). It plays the month cut in the existing player. An invalid or future month shows a short "no such month" state."
- **Unchanged:** "The all-time replay is not changed. Its default cut, lengths, aspects, focus cuts and record button stay as they are." "The record button for people is unchanged."
- **Record hook:** "`window.ccipRecord({ aspect: '1:1', length: 30 })`", recording "with the existing offline recorder: deterministic, 30 fps, H.264 `avc1.640028` at 8 Mbps", returning "the video **without audio** (`video.mp4`)" and "the rendered soundtrack as **WAV** (`audio.wav`, 48 kHz stereo)" through the page's download path. "When the browser can't record H.264, the hook fails with a clear message."
- **Workflow:** `.github/workflows/monthly-video.yml`, "cron `15 1 1 * *`", "a `workflow_dispatch` with a `month` input (default: last month) and a `dry_run` input"; "Chrome stable (`channel: 'chrome'`), not the bundled Chromium"; mux "`-c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart`"; the job "fails, uploading nothing, unless the file has: a duration of 29.5–30.5 s; 1080×1080; H.264 video; AAC audio; a size under 50 MB"; upload "to the private R2 archive bucket as `videos/monthly/YYYY-MM.mp4`, using `wrangler r2 object put` and the existing `CF_DEPLOY_TOKEN`"; "a 30-minute timeout".
- **Broadcast:** "Target `{ kind: 'monthly', month: 'YYYY-MM' }`, with key `broadcast:monthly:YYYY-MM`." "the same atomic claim and per-output keys as every broadcast." "It follows the `MOMENTS` switch, combined with `BROADCASTS` as for moments. It is outside the 2-a-day moment budget." "Before claiming, the Worker checks that the object exists and is under 50 MB."
- **Outputs:** Telegram "`sendVideo` as a multipart upload, with the HTML caption, `width`, `height`, `duration` and `supports_streaming`." X: "Chunked media upload (initialize, append the chunks, finalize). Then poll the processing status for up to about 2 minutes. Then create the post with the media id." "Still processing, or a failure, means `'failed'`, and the next hourly run retries." "It shares the per-run circuit breaker. A duplicate-content refusal counts as sent." Drafts: "`x-draft` and `telegram-preview` send the video to the drafts chat with the X text and the channel caption."
- **Copy:** "No @ tags, since there is no single subject. No links." "The "New on CCIP" line drops first when the text is too long, then the hashtag line." Telegram: "the same in fuller sentences with bold numbers, plus the records set that month." "the Worker computes the totals from the same daily rows `history.json` publishes, so the caption and the video's end card can't disagree." X at most 280 by `xLength`; Telegram captions at most 1,024 on the raw HTML.
- **Alert, verbatim:** "`monthly-video-missing:YYYY-MM` once", "On the 1st, an hourly run at 06:00 UTC or later".
- **No links, no tags:** every chain name goes through `noLinks` (and `tgText` on Telegram). X posts tag only their subject (standing rule); this one has none, so it tags no one.
- **No new runtime dependencies** in the Worker or the site bundles. Playwright and ffmpeg are workflow-only dev tools; Playwright is a root `devDependency`.
- **Free data only:** every figure comes from D1 and the public files the Worker already writes.
- **`.backfill/` is the owner's.** Never write to it.
- **Remote operations are owner steps.** Never run a `wrangler … --remote` command yourself; the workflow's own upload step carries `--remote` because wrangler 4's `r2 object put` writes to local storage without it. A push to `main` deploys.
- **Commits:** conventional subjects (`feat(core): …`, `feat(site): …`, `feat(worker): …`, `test(site): …`, `ci: …`, `docs: …`). Stage explicit paths only; never `git add -A`, `git add .` or `git commit -a`. End each message with a `Co-Authored-By:` trailer naming the model you are (shown below as `<your model>`).
- **Tests:**
  - Core: `pnpm --filter @ccip-dev/core test`.
  - Site: `pnpm --filter @ccip-dev/site test` (the Node and the workerd configs).
  - Worker: `pnpm --filter @ccip-dev/worker test` (real D1 and R2 through `@cloudflare/vitest-plugin`).
  - Scripts: `pnpm exec vitest run scripts/test/monthly-video.test.ts` from the repo root.
  - Types: `pnpm typecheck`.
  - New tests use the BDD comments `// #given`, `// #when` and `// #then`.
- **Comments:** only where the why is not obvious from the code.

## Review Focus

1. **A month that is not over when it is recorded.** At 01:15 on the 1st the month page must not play a month whose last day the 00:07 finalize has not published yet (a late finalize), nor the current month asked for by hand. A reader would expect "No such month", a failed workflow that uploads nothing, and one alert at 06:00, never a partial month posted as the whole one.
   - Tests: Task 2 "plays a month only once its last day is in the data and CCIP had begun by then"; Task 3 "plays a month that is over and in the data, and no other"; Task 9 "alerts a missing video once, on the 1st from 06:00, and never on the 2nd". The workflow side is the `dataset.month === 'missing'` branch of `scripts/video/monthly.ts`, checked by hand in Task 6 Step 7.
2. **The value moved disagreeing between the counter, the end card and the caption.** The replay's odometer rounds down ("$1.3B" for $1.37B) and `formatUsd` rounds to nearest ("$1.4B"); the prototype's first recording showed both in the same last frame. A reader expects one number.
   - Tests: Task 2 `formatUsdDown`; Task 3 "writes the value moved as the counter stops on it, rounded down" and "rounds %s down exactly as the counter does"; Task 8 "writes the X post as the spec shows it, with the value rounded down as the video counts it" and "agrees with the month summary of the history.json and replay.json the month page reads".
3. **The all-time replay changing by accident** while the director and the story layer learn the month cut (a moved default, a new field in every frame, a new draw call).
   - Tests: Task 3 Step 1 "the all-time replay is unchanged by the month cut" (15 digests of frames, story-layer calls and score events, taken on unchanged code), run again in Tasks 3, 4 and 5.
4. **X slow or down during the video.** Processing longer than 2 minutes, processing that fails, or a 5xx mid-upload must fail only `x-post`, stop X for the rest of the run, keep the Telegram post, and retry X alone the next hour.
   - Tests: Task 7 "gives up after 120 s of processing, and on processing that failed, neither an outage" and "names the step that failed, and calls a 5xx an outage"; Task 9 "stops calling X for the run once the upload hits an outage, and the next run retries X alone" and "retries only the output that failed, under the same claim and output keys".
5. **An alert flood or a bad file from the bucket.** A missing video is checked every hour for 3 days; c.alert only holds a signature back for an hour. A file put there by hand can be too big, and a file can vanish between the size check and the read.
   - Tests: Task 9 "alerts a missing video once, on the 1st from 06:00, and never on the 2nd", "alerts once and posts nothing when the video is 50 MB or more", "alerts and releases its claim when the video is gone by the time it is read".

Also checked and pinned, but less likely to bite: beats from outside the month (Task 3 "beats only the joins, records and all-time milestones that fall in the month"); a chain named like a handle or a domain (Task 8 "never mentions anyone or links anything"); the new boxes overlapping (Task 4 layout tests in six sizes); a second hook call while one records, and a bad aspect or length (Task 5); both downloads arriving (Task 5 hook test, the spike, Task 6 Step 7).

## Decisions the spec leaves open or gets wrong

- **The runner spike (2026-10-12),** GitHub Actions run 38324705843 on the throwaway branch `spike/monthly-video-runner` (since deleted), on `ubuntu-latest` = image `ubuntu24/20261004.327`, 4 vCPUs, 15 GB:
  - Chrome 154 is preinstalled; `playwright install --with-deps chrome` (Playwright 1.64.0) upgraded it to Chrome stable 155.0.8059.39 in 24 s. ffmpeg is not preinstalled; `apt-get install ffmpeg` (6.1.1) took 12 s.
  - Headless Chrome stable with `--use-angle=swiftshader --enable-unsafe-swiftshader`: WebGL2 works (ANGLE, Vulkan SwiftShader "Subzero"), in a canvas and an OffscreenCanvas, with float render targets.
  - `VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1080, height: 1080, bitrate: 8e6, framerate: 30 })` is supported (software; `prefer-hardware` is not). **H.264: yes.**
  - `AudioEncoder` AAC (`mp4a.40.2`, 48 kHz stereo, 128 kbps) is **not** supported (Opus is); mediabunny's `getFirstEncodableAudioCodec(['aac'])` is null; mediabunny's PCM WAV output works. The spec's split (silent video, WAV, ffmpeg) is required.
  - A synthetic WebGL2 scene encoded through mediabunny's `CanvasSource` at 1080×1080 and 8 Mbps: 169 ms a frame over 60 frames and 157 ms over 300; drawing takes under 1 ms, the H.264 encoder about 152 ms (median).
  - The live replay's own record button (cinema renderer, 1:1, 15 s = 450 frames) on `https://ccip.dev/replay/`: 161 s, **359 ms a frame**, 14.9 MB, H.264 High 1080×1080 `yuv420p` 30 fps, silent. Projected for the 30 s cut: about 5.4 minutes and 30 MB.
  - Two downloads triggered from one `page.evaluate` call, after the recording, both reached Playwright (again after 3 minutes of recording in the local run below). ffmpeg muxed the WAV as AAC LC 48 kHz stereo at the exact duration, and ffprobe read it back.
  - ccip.dev serves headless Chrome normally (HTTP 200).
  - **Chosen path:** WebCodecs H.264 in the page through the existing recorder, with the WAV muxed by ffmpeg. The PNG-frames fallback is not needed.
  - The runner log warns that `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19, so the workflow pins `ubuntu-24.04`, the image measured.
- **Checked by a local end-to-end run of the prototype** (macOS, Chrome 154, the built site served locally): September 2026 recorded in 205 s; muxed, it is 30.000 s, 30.7 MB, H.264 1080×1080, AAC; the last frames show the end card under the particle title. That run found Review Focus 2.
- **Rulings from the owner's brief (2026-10-12):**
  - The month cut is the same `Show` with a `month` input; the all-time cut is pinned by digests first (Task 3 Step 1).
  - The hook is `window.ccipRecord({ aspect: '1:1', length: 30 })` and hands the files to Playwright as downloads.
  - The monthly broadcast follows `MOMENTS` (with `BROADCASTS`), sits outside the budget, is planned only by the hourly run on the 1st to the 3rd and only when the object exists, uses the existing claim, `#` rows, X circuit breaker and duplicate rule, and tags no one.
  - `monthly-video-missing:YYYY-MM` alerts once, on the 1st from 06:00 UTC.
- **X API, checked on docs.x.com (2026-10-12):** `POST /2/media/upload/initialize` with JSON `{ media_type: 'video/mp4', total_bytes, media_category: 'tweet_video' }` answers `data.id`; `POST /2/media/upload/{id}/append`, multipart `media` and `segment_index` (0–9999), each segment at most 5 MB; `POST /2/media/upload/{id}/finalize` with no body answers `data.processing_info { state, check_after_secs }`; `GET /2/media/upload?command=STATUS&media_id={id}` answers the same, `state` one of `pending`, `in_progress`, `failed`, `succeeded`. All take OAuth 1.0a user context ("UserToken"), like the image upload already live. Video must be H.264 High, 4:2:0, AAC LC, aspect 1:3 to 3:1, at most 60 fps. Sources: https://docs.x.com/x-api/media/quickstart/media-upload-chunked, https://docs.x.com/x-api/media/initialize-media-upload, https://docs.x.com/x-api/media/append-media-upload, https://docs.x.com/x-api/media/finalize-media-upload, https://docs.x.com/x-api/media/get-media-upload-status, https://docs.x.com/x-api/media/quickstart/best-practices.
  - Segments are 4 MB, under the 5 MB cap with room for the multipart envelope. The wait between polls is X's `check_after_secs` (at least 1 s), for at most 120 s in all; a finalize without `processing_info` counts as ready.
- **Telegram, checked on core.telegram.org/bots/api (Bot API 10.3, Aug 24, 2026):** `sendVideo` takes `chat_id`, `video` (multipart upload: "Bots can currently send video files of up to 50 MB in size"), `duration`, `width`, `height`, `caption` (0–1,024 characters), `parse_mode` and `supports_streaming`. The upload gets a 120 s timeout (a card's is 30 s) and the same single 429 retry.
- **R2:** the Worker reads the bucket as `c.env.ARCHIVE` (`head` for the size check before the claim, `get(...).blob()` after it, so the 30 MB file is one Blob that Telegram's form and X's 4 MB slices share). The workflow's upload is `pnpm --filter @ccip-dev/worker exec wrangler r2 object put "ccip-dev-archive/videos/monthly/${MONTH}.mp4" --file "${GITHUB_WORKSPACE}/out/video/${MONTH}.mp4" --content-type video/mp4 --remote`, with `CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}` and `CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}`. `CF_DEPLOY_TOKEN` is a secret of the `production` environment (checked with `gh api`), so the upload is its own job with `environment: production`; the recording job holds no secret.
- **Rollout step 2 conflicts with the 1st–3rd window.** The spec has "The next hourly run posts September's video" right after merge (mid-October), but the monthly broadcast is planned only on the 1st to the 3rd. This plan keeps the owner's window: September is recorded as a dry run to watch, and the first post is October's video on November 1. The runbook says so. Posting September in October would need a one-off override, which this plan does not build.
- **The month page:**
  - It reads `replay.json` and `history.json` only; `chains.json` is not needed, since `replay.json` holds every chain's names and first day.
  - A month plays once its last day is in `replay.json`; the current month counts as "no such month", so a late finalize cannot produce a partial video. A month that starts before CCIP's first message plays from it on (July 2023).
  - The page is `ReplayPage.astro` with `month`: no poster, a static head the player retitles "CCIP in September 2026", `noindex`, the `replay` share card. The site has no sitemap, so it is in none. The player hides the chain picker and the share button; the record button stays and names its file `ccip-month-YYYY-MM-1x1.mp4`.
  - `<html data-month="ready">` once the hook is installed, `"missing"` for no such month: the recording script waits for one or the other.
- **The month cut:**
  - Timing: hook 2 s and finale 4 s at 30 s (the spec's 0–2, 2–26, 26–30); 1.5 and 3 s at 15 s; 2 and 4 s at 60 s.
  - Title "CCIP · September 2026" with no subtitle. No year ticks on its timeline (a month has none).
  - `monthReplay` keeps the month's days (an empty row for a quiet day) and the chains and lanes that moved in it, re-indexed in their original order, so the sky shows only the month.
  - Beats are all-time ones as of the month's end, whatever day the page is opened: joins (`first_day` in the month), headline milestones of all chains and all history, and record days by the existing beat rule (a busiest-day record after CCIP's first 30 days, a record beside a bigger one left out) limited to the month's 3 biggest jumps.
  - The leaderboard counts the whole month to date (its window is the month's length, not 30 days). Stars and coins keep their 30-day window.
  - The fees counter counts each day's `fee_usd` (null as 0), formatted by `formatFeeTotal`, under the value line; only the month cut draws it (`frame.story.fees` exists only there, so all-time frames are unchanged).
  - The end card (`frame.endCard`, finale only) lists, leaving out empty rows: "N messages · $X moved"; "$F in fees · P% paid in LINK"; "Records: …" (the record broadcasts' rules: for each kind the month's last record, as `recordsSetOn` finds them); "New on CCIP: A · B"; "Busiest lane: A → B · $Y". It fades in over the finale's first 20%, centred under the end title, each row shrunk to fit.
  - **The value moved is rounded down** on the end card and in both captions (`formatUsdDown`, the odometer's rounding), so it reads as the counter stops. Every other figure uses the site's formatters.
- **Recording:**
  - The hook records its own `Show` (the page's input at the requested length, motion not reduced), as the record button does but without sound, through `recordCut`, and renders the score apart. `wavBytes` writes 16-bit PCM WAV; the hook re-types the video `video/mp4` and the WAV `audio/wav`.
  - It accepts the replay's aspects and lengths; the workflow asks for 1:1 and 30 s.
  - It logs "ccipRecord: N%" each tenth, which the script prints, so the run's log shows progress.
  - Scripts: `pnpm video:smoke` (can this Chrome record?), `pnpm video:monthly --month YYYY-MM [--base URL] [--out DIR]` (record and save the two files), `pnpm video:check FILE` (ffprobe). The check also requires 4:2:0 pixels (`yuv420p` or `yuvj420p`), which X requires.
  - The workflow attaches every video that passes the check to its run for 7 days, dry run or not; `dry_run` only skips the upload job.
- **Posting:**
  - `PostTarget = BroadcastTarget | MonthlyTarget` in core: `BroadcastTarget` stays the set of broadcasts with a card, so the site's card code is untouched and `broadcastCardPath` never sees a monthly target.
  - `Broadcast.image` becomes `Broadcast.media`, `{ kind: 'image'; png } | { kind: 'video'; mp4; filename; width; height; durationS }`; five existing test lines change with it. The same four outputs send a video when they get one, so names, `#` rows and the X circuit stay as they are.
  - The video posts as `ccip-YYYY-MM.mp4`, 1080×1080, 30 s (`MONTHLY_VIDEO`).
  - "Under 50 MB" is `size < 50,000,000` bytes, in the workflow and the Worker.
  - Alerts beyond the spec's one: `monthly-video-size:YYYY-MM` (once) for a file of 50 MB or more, and `broadcast-video:<key>` when the file cannot be read after the claim (the card's `broadcast-image` counterpart; the claim is released).
  - "Once" is an `alerted:<signature>` row in `meta`, written with `claimMeta` against an empty cutoff; `c.alert` alone repeats hourly.
  - Nothing alerts while `MOMENTS` or `BROADCASTS` is off. A set of outputs with nothing configured warns and claims nothing, as the finalize does.
  - The monthly run comes last in the hourly run and runs in the 06:00 hour too (the yesterday retry still skips it).
  - The facts read D1 through `historyDays`, `largestFeeEntries` (as of the month's last day, as `history.json` was when the video was recorded on the 1st) and `buildReplay(laneHistory, chainDisplayNames)`, so they equal the month summary of the published files (Task 8 tests this through a real publish).
  - Copy: the X text as the spec's example; Telegram in sentences, then "New on CCIP", "New all-time highs: …" and the busiest lane. Those three and New on CCIP on X are the detail lines that drop first, then the hashtags.

## File map

| File | Task | Responsibility |
|---|---|---|
| `package.json`, `pnpm-lock.yaml`, `scripts/video/{browser,smoke}.ts` | 1 | Playwright, Chrome stable with SwiftShader, the probe and `pnpm video:smoke` |
| `.github/workflows/monthly-video.yml` | 1, 6 | The smoke job, then the record and upload jobs |
| `packages/core/src/{month,format,broadcasts}.ts`, `packages/core/package.json` | 2 | Months, `monthSummary`, `formatUsdDown`, `MonthlyTarget` and `PostTarget` |
| `site/test/{replay-pin.test.ts,fixtures/months.ts}` | 3 | The all-time pin and a ten-week fixture |
| `site/src/replay/director/{month,show,phases,leaderboard,beats,story}.ts` | 3 | The month cut |
| `site/src/replay/story/{layout,draw}.ts` | 4 | The fees counter and the end card |
| `site/src/{layouts/Base.astro,components/ReplayPage.astro,pages/replay/month.astro}`, `site/src/replay/{player.tsx,recorder.ts,wav.ts,record-hook.ts,record-cut.ts}` | 5 | The month page and `window.ccipRecord` |
| `scripts/video/{monthly,check}.ts` | 6 | Recording the page, checking the file |
| `worker/src/{telegram,x}.ts` | 7 | `sendTelegramVideo`, `uploadVideo` |
| `worker/src/broadcasts/{monthly,monthly-copy}.ts` | 8 | Monthly facts from D1, the X text and Telegram caption |
| `worker/src/broadcasts/{outputs,run}.ts` | 9 | Video media in the outputs; planning, checks and alerts |
| `docs/{runbook,methodology}.md` | 10 | Monthly video |

---

### Task 1: The recording smoke

The spike already showed Chrome stable on the runner can do this (see "Decisions"). This task turns its probe into a step the workflow runs first, so a runner image that loses WebGL2 or the H.264 encoder fails in seconds with a clear reason instead of minutes into a recording. Task 6 builds the rest of the workflow around it.

**Files:**
- Modify: `package.json` (the Playwright dev dependency, `video:smoke`), `pnpm-lock.yaml`
- Create: `scripts/video/browser.ts`, `scripts/video/smoke.ts`, `.github/workflows/monthly-video.yml`
- Test: `scripts/test/monthly-video.test.ts`

**Interfaces:**
- Consumes: `playwright` 1.64.0 (`chromium.launch`, `Browser`, `Page`).
- Produces (`scripts/video/browser.ts`):
  - `CHROME_ARGS: string[]` (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`);
  - `launchChrome(): Promise<Browser>` (Chrome stable, headless);
  - `interface BrowserProbe { webgl2: boolean; renderer: string | null; h264: boolean | string }`;
  - `probePage(page: Page): Promise<BrowserProbe>`;
  - `probeProblems(probe: BrowserProbe): string[]`.
  - `pnpm video:smoke [--base URL]` (default `https://ccip.dev`): prints the probe; exit code 1 when Chrome cannot record.

- [ ] **Step 1: Add Playwright as a root dev tool.**

Run: `pnpm add -D -w playwright@1.64.0`
Expected: `package.json` gains `"playwright": "1.64.0"` under `devDependencies`, and `pnpm-lock.yaml` gains `playwright@1.64.0` and `playwright-core@1.64.0`. No browser is downloaded.

- [ ] **Step 2: Write the failing test.**

Create `scripts/test/monthly-video.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { probeProblems } from '../video/browser';

describe('probeProblems', () => {
  it('passes a browser with WebGL2 and an H.264 encoder, and names what another lacks', () => {
    expect([
      probeProblems({ webgl2: true, renderer: 'SwiftShader', h264: true }),
      probeProblems({ webgl2: false, renderer: null, h264: false }),
      probeProblems({ webgl2: true, renderer: null, h264: 'NotSupportedError: unsupported codec' }),
    ]).toEqual([
      [],
      ['WebGL2 is unavailable', 'H.264 (avc1.640028) at 1080×1080 cannot be encoded'],
      ['H.264 (avc1.640028) at 1080×1080 cannot be encoded: NotSupportedError: unsupported codec'],
    ]);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails.**

Run: `pnpm exec vitest run scripts/test/monthly-video.test.ts`
Expected: FAIL: `../video/browser` does not exist.

- [ ] **Step 4: Add the launcher, the probe, the smoke script and the workflow.**

Create `scripts/video/browser.ts`:

```ts
import { chromium, type Browser, type Page } from 'playwright';

/** Chrome stable (Playwright's own Chromium has no H.264 encoder), headless, with SwiftShader for WebGL on a runner without a GPU. */
export const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: 'chrome', headless: true, args: CHROME_ARGS });
}

export interface BrowserProbe {
  webgl2: boolean;
  renderer: string | null;
  /** true, false, or the error isConfigSupported threw. */
  h264: boolean | string;
}

/** What the recording needs from the browser, read in `page` (a secure context: WebCodecs needs one). */
export function probePage(page: Page): Promise<BrowserProbe> {
  return page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info') ?? null;
    let h264: boolean | string;
    try {
      h264 =
        typeof VideoEncoder !== 'undefined' &&
        (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1080, height: 1080, bitrate: 8_000_000, framerate: 30 })).supported === true;
    } catch (err) {
      h264 = String(err);
    }
    return { webgl2: gl !== null, renderer: gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null, h264 };
  });
}

export function probeProblems(probe: BrowserProbe): string[] {
  const problems: string[] = [];
  if (!probe.webgl2) problems.push('WebGL2 is unavailable');
  if (probe.h264 !== true) problems.push(`H.264 (avc1.640028) at 1080×1080 cannot be encoded${typeof probe.h264 === 'string' ? `: ${probe.h264}` : ''}`);
  return problems;
}
```

Create `scripts/video/smoke.ts`:

```ts
import { parseArgs } from 'node:util';
import { launchChrome, probePage, probeProblems } from './browser';

/** `pnpm video:smoke`: can this machine's Chrome record the monthly video? Prints what it found; exits 1 when it cannot. */
const { values } = parseArgs({ options: { base: { type: 'string', default: 'https://ccip.dev' } } });
const browser = await launchChrome();
try {
  const page = await browser.newPage();
  await page.goto(values.base, { waitUntil: 'load' });
  const probe = await probePage(page);
  console.log(`Chrome ${browser.version()}: ${JSON.stringify(probe)}`);
  const problems = probeProblems(probe);
  if (problems.length > 0) {
    console.error(`Chrome cannot record the monthly video: ${problems.join('; ')}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
```

In `package.json`, replace:

```json
    "report:top-senders": "tsx scripts/top-senders.ts"
```

with:

```json
    "report:top-senders": "tsx scripts/top-senders.ts",
    "video:smoke": "tsx scripts/video/smoke.ts"
```

Create `.github/workflows/monthly-video.yml` with the smoke job only; Task 6 grows it into the monthly recording. `workflow_dispatch` only runs a workflow that is on `main`, so it can be tried once merged.

```yaml
name: monthly-video
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  smoke:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Install Chrome stable
        run: pnpm exec playwright install --with-deps chrome
      - name: Check Chrome can record
        run: pnpm video:smoke
```

- [ ] **Step 5: Run the test and the typecheck.**

Run: `pnpm exec vitest run scripts/test/monthly-video.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Run the smoke on this machine.**

It needs Google Chrome; if it is missing, `pnpm exec playwright install chrome` installs it.

Run: `pnpm video:smoke`
Expected: one line such as `Chrome 154.0.8037.98: {"webgl2":true,"renderer":"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver)","h264":true}` and exit code 0. On the GitHub runner the same line reads Chrome 155 and "SwiftShader Device (Subzero)".

- [ ] **Step 7: Commit.**

```bash
git add package.json pnpm-lock.yaml scripts/video/browser.ts scripts/video/smoke.ts scripts/test/monthly-video.test.ts .github/workflows/monthly-video.yml
git commit -m "ci: a recording smoke that checks Chrome stable has WebGL2 and an H.264 encoder" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: Months, the month summary, the round-down formatter and the monthly target

Pure core, shared by the site (the month cut, its end card) and the Worker (the facts, the copy, the schedule).

**Files:**
- Create: `packages/core/src/month.ts`
- Modify: `packages/core/package.json` (the `./month` export), `packages/core/src/format.ts` (`formatUsdDown`), `packages/core/src/broadcasts.ts` (`MonthlyTarget`, `PostTarget`, the monthly key)
- Test: `packages/core/test/month.test.ts`, `packages/core/test/format.test.ts`, `packages/core/test/broadcasts.test.ts`

**Interfaces:**
- Consumes (live code): `recordsSetOn`, `RECORD_KINDS`, `type RecordSet` (`records.ts`); `shortChainName` (`names.ts`); `addDays`, `daysBetween` (`time.ts`); `type DayTotals`, `type LargestFee`, `type ReplayFile` (`public.ts`).
- Produces:
  - `@ccip-dev/core/month`:
    - `MONTHLY_VIDEO = { width: 1080, height: 1080, durationS: 30, maxBytes: 50_000_000 } as const`, `MONTHLY_POST_DAYS = 3`, `monthlyVideoKey(month: string): string` (`videos/monthly/<month>.mp4`);
    - `isMonth(value: string): boolean`, `monthBounds(month): { first: string; last: string }`, `monthDays(month): string[]`, `nextMonth(month): string`, `previousMonth(month): string`, `monthLabel(month): string` ("October 2026");
    - `isPlayableMonth(month: string, data: { first: string | null; lastDay: string | null }): boolean`;
    - `monthlyDue(now: Date): string | null` (the month before, on the 1st to the 3rd UTC);
    - `interface MonthChain { selector: string; name: string }`, `interface MonthLane { key: string; src: MonthChain; dst: MonthChain; usd: number }`;
    - `interface MonthSummary { month; label; messages; usd; fees: number | null; linkSharePct: number | null; records: RecordSet[]; joined: MonthChain[]; busiestLane: MonthLane | null }`;
    - `interface MonthSource { days: readonly DayTotals[]; largest: readonly LargestFee[]; replay: Pick<ReplayFile, 'chains' | 'lanes' | 'days'> }`, `monthSummary(month: string, src: MonthSource): MonthSummary`.
  - `@ccip-dev/core/format`: `formatUsdDown(value: number): string` (the replay odometer's rounding: "$1.3B" for $1.37B).
  - `@ccip-dev/core/broadcasts`: `interface MonthlyTarget { kind: 'monthly'; month: string }`, `type PostTarget = BroadcastTarget | MonthlyTarget`; `broadcastKey(t: PostTarget)` keys it `broadcast:monthly:<month>`. `BroadcastTarget`, `broadcastCardPath` and `parseBroadcastPath` are unchanged.

- [ ] **Step 1: Write the failing tests.**

Create `packages/core/test/month.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isMonth, isPlayableMonth, monthBounds, monthDays, monthLabel, monthlyDue, monthlyVideoKey, monthSummary, nextMonth, previousMonth, type MonthSource,
} from '../src/month';
import type { DayTotals, ReplayFile } from '../src/public';

const totals = (day: string, messages: number, usd: number, fee: number | null = null, link: number | null = null): DayTotals => ({
  day, messages, token_messages: 0, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: link,
});

describe('months', () => {
  it('knows a month, its days, its neighbours and its name', () => {
    expect({
      valid: ['2026-10', '2026-12', '2026-1', '2026-13', '2026-10-01', 'x'].map(isMonth),
      bounds: monthBounds('2028-02'),
      days: monthDays('2026-09').length,
      next: [nextMonth('2026-12'), nextMonth('2026-09')],
      previous: [previousMonth('2027-01'), previousMonth('2026-10')],
      label: monthLabel('2026-10'),
      key: monthlyVideoKey('2026-09'),
    }).toEqual({
      valid: [true, true, false, false, false, false],
      bounds: { first: '2028-02-01', last: '2028-02-29' },
      days: 30,
      next: ['2027-01', '2026-10'],
      previous: ['2026-12', '2026-09'],
      label: 'October 2026',
      key: 'videos/monthly/2026-09.mp4',
    });
  });

  it('plays a month only once its last day is in the data and CCIP had begun by then', () => {
    // #given data from 2023-07-06 to 2026-10-11
    const data = { first: '2023-07-06', lastDay: '2026-10-11' };
    // #then September is over, October is not, and June 2023 came before the first message
    expect(['2026-09', '2023-07', '2026-10', '2026-11', '2023-06', '2026-13', 'soon'].map((m) => isPlayableMonth(m, data))).toEqual([
      true, true, false, false, false, false, false,
    ]);
    expect(isPlayableMonth('2026-09', { first: null, lastDay: null })).toBe(false);
  });

  it("is due on the 1st to the 3rd for the month before, and not after", () => {
    expect(['2026-10-01T00:30:00Z', '2026-10-03T23:59:00Z', '2026-10-04T00:00:00Z', '2027-01-02T12:00:00Z', '2026-10-31T12:00:00Z'].map((iso) => monthlyDue(new Date(iso)))).toEqual([
      '2026-09', '2026-09', null, '2026-12', null,
    ]);
  });
});

const chain = (selector: string, display: string, first: string): ReplayFile['chains'][number] => ({ selector, name: null, display_name: display, first_day: first });

const SOURCE: MonthSource = {
  days: [
    totals('2026-08-30', 100, 1e6),
    totals('2026-08-31', 120, 2e6),
    totals('2026-09-01', 150, 1.5e6, 10, 4),
    totals('2026-09-02', 110, 5e6, 20, 10),
    totals('2026-09-03', 160, 1e6, 30, 15),
    totals('2026-10-01', 300, 9e6, 5, 1),
  ],
  largest: [
    { message_id: '0x1', day: '2026-09-02', src: '1', dst: '2', fee_usd: 3, symbol: 'LINK' },
    { message_id: '0x2', day: '2026-08-31', src: '1', dst: '2', fee_usd: 1, symbol: null },
  ],
  replay: {
    chains: [chain('1', 'Ethereum Mainnet', '2026-08-30'), chain('2', 'Base Mainnet', '2026-08-30'), chain('3', 'Gravity', '2026-09-02'), chain('4', 'Tempo', '2026-10-01')],
    lanes: [[0, 1], [1, 0], [2, 0], [3, 0]],
    days: [
      { day: '2026-08-31', lanes: [[0, 120, 2e6]] },
      { day: '2026-09-01', lanes: [[0, 100, 1e6], [1, 50, 5e5]] },
      { day: '2026-09-02', lanes: [[0, 60, 4e6], [2, 50, 1e6]] },
      { day: '2026-09-03', lanes: [[2, 160, 1e6]] },
      { day: '2026-10-01', lanes: [[3, 300, 9e6]] },
    ],
  },
};

describe('monthSummary', () => {
  it("adds up the month's messages, value and fees, with the share of fees paid in LINK", () => {
    // #when
    const s = monthSummary('2026-09', SOURCE);
    // #then 29 of 60 in fees were paid in LINK
    expect({ month: s.month, label: s.label, messages: s.messages, usd: s.usd, fees: s.fees, link: s.linkSharePct?.toFixed(2) }).toEqual({
      month: '2026-09', label: 'September 2026', messages: 420, usd: 7.5e6, fees: 60, link: '48.33',
    });
  });

  it('lists the all-time records set in the month, the last one of each kind, by the record broadcasts\' rules', () => {
    // #when
    const s = monthSummary('2026-09', SOURCE);
    // #then fees' first day has nothing before it to beat, and the LINK share tied on 09-03 keeps 09-02
    expect(s.records.map((r) => [r.kind, r.day, r.value])).toEqual([
      ['messages', '2026-09-03', 160],
      ['value', '2026-09-02', 5e6],
      ['fees', '2026-09-03', 30],
      ['largest_fee', '2026-09-02', 3],
      ['link_share', '2026-09-02', 50],
    ]);
  });

  it('names the chains that joined in the month and its busiest lane by value', () => {
    // #when
    const s = monthSummary('2026-09', SOURCE);
    // #then
    expect({ joined: s.joined, lane: s.busiestLane }).toEqual({
      joined: [{ selector: '3', name: 'Gravity' }],
      lane: { key: '1>2', src: { selector: '1', name: 'Ethereum' }, dst: { selector: '2', name: 'Base' }, usd: 5e6 },
    });
  });

  it('has no fees, records, arrivals or lane for a month without them', () => {
    // #when August's two days have no fee data and set no record against nothing before them
    const s = monthSummary('2026-08', { ...SOURCE, days: SOURCE.days.slice(0, 1), largest: [] });
    // #then
    expect({ messages: s.messages, fees: s.fees, link: s.linkSharePct, records: s.records, joined: s.joined.map((c) => c.name) }).toEqual({
      messages: 100, fees: null, link: null, records: [], joined: ['Ethereum', 'Base'],
    });
    expect(monthSummary('2026-07', SOURCE).busiestLane).toBeNull();
  });
});
```

In `packages/core/test/format.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import {
  DASH, formatAgo, formatBps, formatCompactCount, formatCount, formatCountdown, formatDuration, formatFee, formatFeeTotal, formatLink, formatLinkAmount, formatPct, formatPrice, formatShare, formatUsd, formatUsdFull, formatUtcDay, formatUtcTime, linkShareText,
} from '../src/format';

```

with:

```ts
import { describe, expect, it } from 'vitest';
import {
  DASH, formatAgo, formatBps, formatCompactCount, formatCount, formatCountdown, formatDuration, formatFee, formatFeeTotal, formatLink, formatLinkAmount, formatPct, formatPrice, formatShare, formatUsd, formatUsdDown, formatUsdFull, formatUtcDay, formatUtcTime, linkShareText,
} from '../src/format';

```

In `packages/core/test/format.test.ts`, replace:

```ts
});

describe('formatLinkAmount', () => {
  it.each([[0.29, '0.29 LINK'], [12.346, '12.35 LINK'], [100, '100 LINK'], [82_480.4, '82,480 LINK'], [null, '—']])('%s → %s', (value, text) => {
```

with:

```ts
});

describe('formatUsdDown', () => {
  it.each([
    [0, '$0'],
    [999.6, '$999'],
    [1_399_999_999, '$1.3B'],
    [1_400_000_000, '$1.4B'],
    [999_999, '$999.9K'],
    [-5, '$0'],
  ])('rounds %s down to %s', (value, text) => {
    expect(formatUsdDown(value)).toBe(text);
  });
});

describe('formatLinkAmount', () => {
  it.each([[0.29, '0.29 LINK'], [12.346, '12.35 LINK'], [100, '100 LINK'], [82_480.4, '82,480 LINK'], [null, '—']])('%s → %s', (value, text) => {
```

In `packages/core/test/broadcasts.test.ts`, replace:

```ts
  ])('rejects %s', (path) => {
    expect(parseBroadcastPath(path.split('/'))).toBeNull();
  });
});
```

with:

```ts
  ])('rejects %s', (path) => {
    expect(parseBroadcastPath(path.split('/'))).toBeNull();
  });

  it('keys the monthly video, which has no card path', () => {
    expect(broadcastKey({ kind: 'monthly', month: '2026-09' })).toBe('broadcast:monthly:2026-09');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/month.test.ts test/format.test.ts test/broadcasts.test.ts`
Expected: FAIL: `../src/month` does not exist, `formatUsdDown` is not a function, and `broadcastKey` returns `undefined` for the monthly target.

- [ ] **Step 3: Add the month module, the formatter and the target.**

Create `packages/core/src/month.ts`:

```ts
import { shortChainName } from './names';
import type { DayTotals, LargestFee, ReplayFile } from './public';
import { RECORD_KINDS, recordsSetOn, type RecordSet } from './records';
import { addDays, daysBetween } from './time';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

/** The monthly video: 30 s, square, under 50 MB (Telegram's limit for a bot's upload), at this key in the archive bucket. */
export const MONTHLY_VIDEO = { width: 1080, height: 1080, durationS: 30, maxBytes: 50_000_000 } as const;
/** The monthly video posts on the 1st to the 3rd of the next month (UTC). */
export const MONTHLY_POST_DAYS = 3;

export const monthlyVideoKey = (month: string) => `videos/monthly/${month}.mp4`;

export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

export function monthBounds(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  return { first, last: addDays(`${nextMonth(month)}-01`, -1) };
}

export function monthDays(month: string): string[] {
  const { first, last } = monthBounds(month);
  return daysBetween(first, last);
}

export function nextMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  return addDays(`${month}-01`, -1).slice(0, 7);
}

/** "October 2026". */
export function monthLabel(month: string): string {
  return LABEL.format(new Date(`${month}-01T00:00:00.000Z`));
}

/** A month can be shown once it is over and in the data: its last day is finalized, and CCIP had begun by then. */
export function isPlayableMonth(month: string, data: { first: string | null; lastDay: string | null }): boolean {
  if (!isMonth(month) || data.first === null || data.lastDay === null) return false;
  const { last } = monthBounds(month);
  return last <= data.lastDay && last >= data.first;
}

/** The month whose video is due on `now`'s day: the month before, from the 1st to the 3rd (UTC); otherwise null. */
export function monthlyDue(now: Date): string | null {
  const day = now.toISOString().slice(0, 10);
  return Number(day.slice(8)) <= MONTHLY_POST_DAYS ? previousMonth(day.slice(0, 7)) : null;
}

export interface MonthChain {
  selector: string;
  name: string;
}

export interface MonthLane {
  key: string;
  src: MonthChain;
  dst: MonthChain;
  usd: number;
}

export interface MonthSummary {
  month: string;
  label: string;
  messages: number;
  usd: number;
  /** null when no day of the month has fee data. */
  fees: number | null;
  linkSharePct: number | null;
  /** The all-time records set in the month, by the record broadcasts' rules: for each kind, the month's last one. */
  records: RecordSet[];
  /** The chains whose first CCIP message falls in the month, in the order they arrived. */
  joined: MonthChain[];
  /** The lane that moved the most value in the month; a tie goes to the lower lane key. */
  busiestLane: MonthLane | null;
}

/** What history.json and replay.json publish: the site reads these files, and the Worker builds the same rows from D1. */
export interface MonthSource {
  days: readonly DayTotals[];
  largest: readonly LargestFee[];
  replay: Pick<ReplayFile, 'chains' | 'lanes' | 'days'>;
}

const sumOf = (values: readonly (number | null | undefined)[]): number | null => {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
};

function monthRecords(src: MonthSource, first: string, last: string): RecordSet[] {
  const latest = new Map<RecordSet['kind'], RecordSet>();
  for (const d of src.days) {
    if (d.day < first || d.day > last) continue;
    for (const record of recordsSetOn(src.days, src.largest, d.day)) {
      const kept = latest.get(record.kind);
      if (!kept || record.day > kept.day) latest.set(record.kind, record);
    }
  }
  return RECORD_KINDS.flatMap((kind) => latest.get(kind) ?? []);
}

function busiestLane(replay: MonthSource['replay'], first: string, last: string): MonthLane | null {
  const usd = new Map<number, number>();
  for (const d of replay.days) {
    if (d.day < first || d.day > last) continue;
    for (const [lane, , value] of d.lanes) usd.set(lane, (usd.get(lane) ?? 0) + value);
  }
  const chain = (index: number): MonthChain => {
    const c = replay.chains[index]!;
    return { selector: c.selector, name: shortChainName(c) };
  };
  const lanes = [...usd].flatMap(([lane, value]) => {
    const ends = replay.lanes[lane];
    if (!ends) return [];
    const src = chain(ends[0]);
    const dst = chain(ends[1]);
    return [{ key: `${src.selector}>${dst.selector}`, src, dst, usd: value }];
  });
  lanes.sort((a, b) => b.usd - a.usd || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return lanes[0] ?? null;
}

/** The month's totals and highlights, from the same rows as the files the month page plays, so a caption and the video's end card agree. */
export function monthSummary(month: string, src: MonthSource): MonthSummary {
  const { first, last } = monthBounds(month);
  const rows = src.days.filter((d) => d.day >= first && d.day <= last);
  const fees = sumOf(rows.map((d) => d.fee_usd));
  const link = sumOf(rows.map((d) => d.fee_link_usd));
  return {
    month,
    label: monthLabel(month),
    messages: rows.reduce((sum, d) => sum + d.messages, 0),
    usd: rows.reduce((sum, d) => sum + d.usd_value, 0),
    fees,
    linkSharePct: link === null || fees === null || fees === 0 ? null : (link / fees) * 100,
    records: monthRecords(src, first, last),
    joined: src.replay.chains
      .filter((c) => c.first_day >= first && c.first_day <= last)
      .sort((a, b) => (a.first_day < b.first_day ? -1 : a.first_day > b.first_day ? 1 : a.selector < b.selector ? -1 : 1))
      .map((c) => ({ selector: c.selector, name: shortChainName(c) })),
    busiestLane: busiestLane(src.replay, first, last),
  };
}
```

In `packages/core/package.json`, replace:

```json
    "./records": "./src/records.ts",
    "./broadcasts": "./src/broadcasts.ts",
    "./moments": "./src/moments.ts"
  },
  "scripts": {
```

with:

```json
    "./records": "./src/records.ts",
    "./broadcasts": "./src/broadcasts.ts",
    "./moments": "./src/moments.ts",
    "./month": "./src/month.ts"
  },
  "scripts": {
```

`formatUsdDown` repeats the odometer's rounding (`site/src/replay/story/odometer.ts`) on core's scale table, so the Worker can use it; Task 3 pins the two together.

In `packages/core/src/format.ts`, replace:

```ts
export function formatFeeTotal(value: number | null | undefined): string {
  return usable(value) && value > 0 && value < 1 ? formatFee(value) : formatUsd(value);
}

```

with:

```ts
export function formatFeeTotal(value: number | null | undefined): string {
  return usable(value) && value > 0 && value < 1 ? formatFee(value) : formatUsd(value);
}

/**
 * A compact dollar amount rounded down to its last digit, as the replay's value counter shows it: "$1.3B" for $1.37B,
 * where formatUsd says "$1.4B". The month video's end card and caption use it, so they read as its counter stops.
 */
export function formatUsdDown(value: number): string {
  const v = Math.max(0, value);
  const [size, suffix] = SCALES.find(([s]) => v >= s) ?? [1, ''];
  const step = suffix === '' ? 1 : 0.1;
  const shown = Math.floor(v / size / step + 1e-9) * step;
  return `$${suffix === '' ? String(shown) : shown.toFixed(1)}${suffix}`;
}

```

In `packages/core/src/broadcasts.ts`, replace:

```ts
export type MomentTarget = Extract<BroadcastTarget, { kind: BudgetedMoment | 'poll' }>;

export function broadcastKey(t: BroadcastTarget): string {
  switch (t.kind) {
    case 'daily':
      return `broadcast:daily:${t.day}`;
```

with:

```ts
export type MomentTarget = Extract<BroadcastTarget, { kind: BudgetedMoment | 'poll' }>;

/** The month in review, posted as a video: it has no card, so it is not a BroadcastTarget and has no card path. */
export interface MonthlyTarget {
  kind: 'monthly';
  month: string;
}

/** Everything the Worker posts: a broadcast with a card, or the monthly video. */
export type PostTarget = BroadcastTarget | MonthlyTarget;

export function broadcastKey(t: PostTarget): string {
  switch (t.kind) {
    case 'monthly':
      return `broadcast:monthly:${t.month}`;
    case 'daily':
      return `broadcast:daily:${t.day}`;
```

- [ ] **Step 4: Run the core suite and the typecheck.**

Run: `pnpm --filter @ccip-dev/core test && pnpm typecheck`
Expected: PASS, the existing broadcast and format tests included.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/month.ts packages/core/package.json packages/core/src/format.ts packages/core/src/broadcasts.ts packages/core/test/month.test.ts packages/core/test/format.test.ts packages/core/test/broadcasts.test.ts
git commit -m "feat(core): months, the month summary, a round-down dollar format and the monthly broadcast target" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Pin the all-time replay, then the month cut

The pin comes first and is committed on its own, on unchanged code: it records 15 digests (frames, story-layer draw calls and score events, for the default cut at 15, 30 and 60 s, a focus cut and the small fixture) that every later site task must keep. Then the director learns the month cut.

**Files:**
- Create: `site/test/fixtures/months.ts`, `site/test/replay-pin.test.ts`, `site/src/replay/director/month.ts`
- Modify: `site/src/replay/director/phases.ts`, `site/src/replay/director/leaderboard.ts`, `site/src/replay/director/beats.ts`, `site/src/replay/director/story.ts`, `site/src/replay/director/show.ts`
- Test: `site/test/director-month.test.ts`

**Interfaces:**
- Consumes: Task 2 (`isPlayableMonth`, `monthBounds`, `monthLabel`, `monthSummary`, `type MonthSummary`, `formatUsdDown`); live code `Show`, `ShowInput`, `ShowFrame`, `StoryCounter`, `Leaderboard`, `recordEvents`, `shotTiming`, `phaseAt`, `scoreFor`, `drawStory`, `layoutFor`, `odometer`, `buildLayout`, `daysBetween`.
- Produces:
  - `site/test/fixtures/months.ts`: `FIRST_DAY = '2026-07-25'`, `LAST_DAY = '2026-10-05'`, `RECORD_DAY = '2026-09-15'`, `FEES_FROM = '2026-08-01'`, `CHAINS: ReplayFile['chains']`, `monthsReplay(): ReplayFile`, `monthsHistory(replay?: ReplayFile): DayTotals[]`, `LARGEST_FEES: LargestFee[]`.
  - `site/src/replay/director/month.ts`:
    - `interface MonthInput { month: string; chains: ReplayFile['chains']; summary: MonthSummary }`;
    - `monthReplay(replay: ReplayFile, month: string): ReplayFile`;
    - `interface MonthData { replay: ReplayFile; history: readonly DayTotals[]; largest: readonly LargestFee[] }`, `monthCut(data: MonthData, month: string): { replay: ReplayFile; month: MonthInput } | null`;
    - `monthCardRows(s: MonthSummary): string[]`.
  - `show.ts`: `ShowInput.month?: MonthInput`; `ShowFrame.endCard?: readonly string[]` (the month cut's finale only); `Show.month: string | null`; `yearTicks()` is `[]` for the month cut.
  - `story.ts`: `StoryValues.fees?: number` (the month cut only); `StoryCounter.feesAt(t: number, warp: Warp): number`; the constructor's history rows may carry `fee_usd`.
  - `phases.ts`: `monthTiming(length: number): ShotTiming`; `phaseAt(t, length, timing = shotTiming(length))`.
  - `leaderboard.ts`: `WINDOW_DAYS` exported; `new Leaderboard(replay, days, eligible, warp, windowDays = WINDOW_DAYS)`.
  - `beats.ts`: `windowRecordEvents(history, days): DayEvent[]`; `recordEvents` unchanged.

- [ ] **Step 1: Pin the all-time replay as it is.**

The fixture is ten made-up weeks with joins, a record and two headline milestones; the pin and the month tests both use it.

Create `site/test/fixtures/months.ts`:

```ts
import type { DayTotals, LargestFee, ReplayFile } from '@ccip-dev/core/public';

/**
 * About ten weeks of made-up CCIP activity, from 2026-07-25 to 2026-10-05, built so a month cut has something to show:
 * chains join in August, September and October; in September value crosses $1B (on 2026-09-15, which is also an
 * all-time busiest day) and total messages cross 10,000 (on 2026-09-19); fees start on 2026-08-01.
 */
export const FIRST_DAY = '2026-07-25';
export const LAST_DAY = '2026-10-05';
export const RECORD_DAY = '2026-09-15';
export const FEES_FROM = '2026-08-01';

export const CHAINS: ReplayFile['chains'] = [
  { selector: '5009297550715157269', name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', first_day: '2026-07-25' },
  { selector: '15971525489660198786', name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet', first_day: '2026-07-25' },
  { selector: '4949039107694359620', name: 'ethereum-mainnet-arbitrum-1', display_name: 'Arbitrum One', first_day: '2026-08-10' },
  { selector: '11344663589394136015', name: 'binance_smart_chain-mainnet', display_name: 'BNB Chain', first_day: '2026-09-03' },
  { selector: '7264351850409363825', name: 'ethereum-mainnet-mode-1', display_name: 'Mode', first_day: '2026-09-20' },
  { selector: '9478124434908827753', name: 'gravity-mainnet', display_name: 'Gravity', first_day: '2026-10-02' },
];

const LANES: [number, number][] = [[0, 1], [1, 0], [0, 2], [2, 1], [3, 0], [4, 3], [5, 0]];

function days(): string[] {
  const out: string[] = [];
  for (let ms = Date.parse(`${FIRST_DAY}T00:00:00Z`); ms <= Date.parse(`${LAST_DAY}T00:00:00Z`); ms += 86_400_000) out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}

const laneMessages = (k: number, lane: number, day: string) => (20 + ((k * 7 + lane * 13) % 17) * 3) * (day === RECORD_DAY ? 4 : 1);

export function monthsReplay(): ReplayFile {
  return {
    schema_version: 1,
    updated_at: '2026-10-06T00:07:00.000Z',
    attribution: 'Data: Chainlink CCIP API, DefiLlama',
    since: FIRST_DAY,
    chains: CHAINS.map((c) => ({ ...c })),
    lanes: LANES.map((l) => [l[0], l[1]] as [number, number]),
    days: days().map((day, k) => ({
      day,
      lanes: LANES.flatMap(([a, b], lane): [number, number, number][] => {
        if (CHAINS[a]!.first_day > day || CHAINS[b]!.first_day > day) return [];
        const messages = laneMessages(k, lane, day);
        return [[lane, messages, messages * 100_000 * (1 + lane / 10)]];
      }),
    })),
  };
}

export function monthsHistory(replay: ReplayFile = monthsReplay()): DayTotals[] {
  return replay.days.map((d) => {
    const messages = d.lanes.reduce((sum, [, m]) => sum + m, 0);
    const usd = d.lanes.reduce((sum, [, , u]) => sum + u, 0);
    const fee = d.day >= FEES_FROM ? messages / 2 : null;
    return {
      day: d.day,
      messages,
      token_messages: messages,
      usd_value: usd,
      fee_usd: fee,
      unique_senders: 10,
      median_delivery_s: 60,
      unpriced_messages: 0,
      fee_link_usd: fee === null ? null : fee * 0.4,
    };
  });
}

export const LARGEST_FEES: LargestFee[] = [
  { message_id: '0xaa', day: '2026-09-22', src: CHAINS[0]!.selector, dst: CHAINS[1]!.selector, fee_usd: 900, symbol: 'LINK' },
  { message_id: '0xbb', day: '2026-08-12', src: CHAINS[0]!.selector, dst: CHAINS[2]!.selector, fee_usd: 400, symbol: 'ETH' },
];
```

The digests round every number to 6 decimals before hashing; they were taken on unchanged code and are the same on Node 22 (CI) and Node 26.

Create `site/test/replay-pin.test.ts`:

```ts
import { createHash } from 'node:crypto';
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { Show } from '../src/replay/director/show';
import { scoreFor } from '../src/replay/score/schedule';
import { drawStory } from '../src/replay/story/draw';
import { layoutFor } from '../src/replay/story/layout';
import { chainNameMap } from '../src/lib/names';
import { buildLayout } from '../src/sky/layout';
import { CHAINS, monthsHistory, monthsReplay } from './fixtures/months';
import replayJson from './fixtures/replay.json';

/**
 * Pins the all-time replay as it was before the month cut: every frame the director makes, every call the story layer
 * draws and every note of the score, for the default cut and a focus cut. A change to any of them changes a digest.
 */
const round = (_key: string, value: unknown) => (typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, round)).digest('hex').slice(0, 16);

const small = replayJson as ReplayFile;
const smallHistory: DayTotals[] = small.days.map((d, i) => ({
  day: d.day, messages: [2, 35, 15, 8][i]!, token_messages: 0, usd_value: [0, 1500, 1_502_000, 1000][i]!, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null,
}));
const months = monthsReplay();
const monthsDays = monthsHistory(months);

function allTime(replay: ReplayFile, history: DayTotals[], length: number, focus: string | null = null): Show {
  return new Show({ replay, history, stars: buildLayout(replay.chains), length, focus, eligible: () => true });
}

interface Pinned {
  make: () => Show;
  replay: ReplayFile;
  frames: string;
  calls: string;
  score: string;
}

const SHOWS: [string, Pinned][] = [
  ['small, 30 s', { make: () => allTime(small, smallHistory, 30), replay: small, frames: '63bbeaed5460a86b', calls: '87211383fb15b611', score: 'f846779fe55bdc71' }],
  ['ten weeks, 15 s', { make: () => allTime(months, monthsDays, 15), replay: months, frames: 'ff33bef118858d2e', calls: '73c21c0253a2ce37', score: '5d5f8419f52fadde' }],
  ['ten weeks, 30 s', { make: () => allTime(months, monthsDays, 30), replay: months, frames: 'b87efc300486cdfa', calls: 'c846c27192cbb0ef', score: 'b06b7b7355ebf58e' }],
  ['ten weeks, 60 s', { make: () => allTime(months, monthsDays, 60), replay: months, frames: '8ed82c0ece5d3751', calls: '3314bee3c99c8120', score: '78d3ea6d2f8efaa5' }],
  [
    'ten weeks, Arbitrum, 30 s',
    { make: () => allTime(months, monthsDays, 30, CHAINS[2]!.selector), replay: months, frames: 'b0d557440007655a', calls: '66c8c55b1c796008', score: 'a1801e455ef93098' },
  ],
];

function frames(show: Show): unknown[] {
  return Array.from({ length: show.length * 8 + 1 }, (_, i) => show.frameAt(i / 8));
}

function recordingCtx(log: unknown[]): CanvasRenderingContext2D {
  const plain = (v: unknown) => (typeof v === 'object' && v !== null ? 'object' : v);
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') {
          return (...args: unknown[]) => {
            log.push([key, ...args]);
            return { addColorStop: (...stop: unknown[]) => log.push(['addColorStop', ...stop]) };
          };
        }
        return (...args: unknown[]) => log.push([String(key), ...args.map(plain)]);
      },
      set: (_target, key, value) => {
        log.push(['set', String(key), plain(value)]);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

function drawCalls(show: Show, replay: ReplayFile): unknown[] {
  const log: unknown[] = [];
  const assets = { names: chainNameMap(replay.chains), coins: new Map<string, CanvasImageSource>(), ticks: show.yearTicks().map((y) => ({ at: y.time / show.length, label: y.label })) };
  for (const [w, h] of [[1920, 1080], [1080, 1080], [1080, 1920]] as const) {
    for (let i = 0; i <= show.length * 4; i++) drawStory(recordingCtx(log), show.frameAt(i / 4), layoutFor(w, h), assets);
  }
  return log;
}

describe('the all-time replay is unchanged by the month cut', () => {
  it.each(SHOWS)('makes the same frames (%s)', (_name, pin) => {
    expect(digest(frames(pin.make()))).toBe(pin.frames);
  });

  it.each(SHOWS)('draws the same story layer (%s)', (_name, pin) => {
    expect(digest(drawCalls(pin.make(), pin.replay))).toBe(pin.calls);
  });

  it.each(SHOWS)('plays the same score (%s)', (_name, pin) => {
    expect(digest(scoreFor(pin.make()))).toBe(pin.score);
  });
});
```

- [ ] **Step 2: Run the pin on unchanged code.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/replay-pin.test.ts`
Expected: PASS, 15 tests. If a digest differs here, before any change, stop: the pin was taken on a different `main`; report it rather than editing the digests.

- [ ] **Step 3: Commit the pin.**

```bash
git add site/test/fixtures/months.ts site/test/replay-pin.test.ts
git commit -m "test(site): pin the all-time replay's frames, story layer and score before the month cut" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing month tests.**

Create `site/test/director-month.test.ts`:

```ts
import { formatUsdDown } from '@ccip-dev/core/format';
import { monthDays, monthSummary } from '@ccip-dev/core/month';
import { describe, expect, it } from 'vitest';
import { monthCardRows, monthCut, monthReplay } from '../src/replay/director/month';
import { Show } from '../src/replay/director/show';
import { scoreFor } from '../src/replay/score/schedule';
import { odometer } from '../src/replay/story/odometer';
import { buildLayout } from '../src/sky/layout';
import { CHAINS, LARGEST_FEES, monthsHistory, monthsReplay } from './fixtures/months';

const replay = monthsReplay();
const history = monthsHistory(replay);
const data = { replay, history, largest: LARGEST_FEES };

function monthShow(month: string, length = 30): Show {
  const cut = monthCut(data, month)!;
  return new Show({ replay: cut.replay, history, stars: buildLayout(cut.replay.chains), length, focus: null, eligible: () => true, month: cut.month });
}

const name = (i: number) => CHAINS[i]!.selector;

describe('monthReplay', () => {
  it('keeps every day of the month and only the chains and lanes that moved in it, re-indexed', () => {
    // #when
    const cut = monthReplay(replay, '2026-09');
    // #then Gravity's first lane is in October, so it is left out
    expect({
      since: cut.since,
      days: cut.days.map((d) => d.day),
      chains: cut.chains.map((c) => c.selector),
      lanes: cut.lanes,
      firstDay: cut.days[0]!.lanes.map(([lane]) => lane),
    }).toEqual({
      since: '2026-09-01',
      days: monthDays('2026-09'),
      chains: [name(0), name(1), name(2), name(3), name(4)],
      lanes: [[0, 1], [1, 0], [0, 2], [2, 1], [3, 0], [4, 3]],
      firstDay: [0, 1, 2, 3],
    });
  });

  it('has empty days for a month with nothing on some days', () => {
    // #given only October's first 5 days are in the data
    const cut = monthReplay(replay, '2026-10');
    // #then
    expect({ days: cut.days.length, empty: cut.days.filter((d) => d.lanes.length === 0).length }).toEqual({ days: 31, empty: 26 });
  });
});

describe('monthCut', () => {
  it('plays a month that is over and in the data, and no other', () => {
    // #given data from 2026-07-25 to 2026-10-05
    // #then July counts from its first message on; October is not over, and June came before the data
    expect(['2026-07', '2026-08', '2026-09', '2026-10', '2026-06', '2026-13', ''].map((m) => monthCut(data, m) !== null)).toEqual([true, true, true, false, false, false, false]);
  });
});

describe('the month show', () => {
  it("covers exactly the month's days, opens on its title and ends on a 4 s finale", () => {
    // #when
    const s = monthShow('2026-09');
    // #then
    expect({
      days: s.days,
      timing: s.timing,
      hook: s.frameAt(1).hook?.title,
      first: s.frameAt(2.01).story.day,
      last: s.frameAt(25.99).story.day,
      phases: [s.frameAt(1.9).phase, s.frameAt(2).phase, s.frameAt(25.9).phase, s.frameAt(26).phase],
    }).toEqual({
      days: monthDays('2026-09'),
      timing: { hook: 2, finale: 4 },
      hook: 'CCIP · September 2026',
      first: '2026-09-01',
      last: '2026-09-30',
      phases: ['hook', 'story', 'story', 'finale'],
    });
  });

  it('beats only the joins, records and all-time milestones that fall in the month', () => {
    // #when
    const s = monthShow('2026-09');
    // #then Arbitrum joined and 5,000 messages passed in August, Gravity joins in October; BNB Chain's lane set a record on its first day
    expect({ cards: s.cards.map((c) => c.label), slams: s.slams.map((m) => m.label) }).toEqual({
      cards: ['BNB Chain joins', 'Record day · 256 messages', 'Record day · 952 messages', 'Mode joins'],
      slams: ['$1B moved', '10,000 messages'],
    });
  });

  it("counts the month's fees from zero up to the month's fee sum, and the value moved from zero too", () => {
    // #when
    const s = monthShow('2026-09');
    const september = history.filter((d) => d.day.startsWith('2026-09'));
    // #then
    expect({ start: s.frameAt(1).story.fees, end: s.frameAt(30).story.fees, usd: s.frameAt(30).story.usd }).toEqual({
      start: 0,
      end: september.reduce((sum, d) => sum + (d.fee_usd ?? 0), 0),
      usd: september.reduce((sum, d) => sum + d.usd_value, 0),
    });
  });

  it('ranks only the month on its leaderboard', () => {
    // #when
    const top = monthShow('2026-09').frameAt(25.99).board[0]!;
    // #then Ethereum's value is the month's, its August lanes left out
    const ethereum = replay.days
      .filter((d) => d.day.startsWith('2026-09'))
      .flatMap((d) => d.lanes)
      .filter(([lane]) => replay.lanes[lane]!.includes(0))
      .reduce((sum, [, , usd]) => sum + usd, 0);
    expect({ selector: top.selector, value: top.value }).toEqual({ selector: name(0), value: ethereum });
  });

  it('shows the end card during the finale only', () => {
    // #when
    const s = monthShow('2026-09');
    // #then
    expect({ story: s.frameAt(20).endCard, finale: s.frameAt(28).endCard }).toEqual({
      story: undefined,
      finale: monthCardRows(monthSummary('2026-09', { days: history, largest: LARGEST_FEES, replay })),
    });
  });

  it('runs the score unchanged, its swell on the finale', () => {
    // #when
    const swell = scoreFor(monthShow('2026-09')).find((e) => e.kind === 'swell');
    // #then
    expect(swell).toMatchObject({ time: 26, duration: 4 });
  });
});

describe('monthCardRows', () => {
  it("lists the month's totals, fees and LINK share, records, new chains and busiest lane", () => {
    // #when
    const rows = monthCardRows(monthSummary('2026-09', { days: history, largest: LARGEST_FEES, replay }));
    // #then
    expect(rows).toEqual([
      '7,725 messages · $940.1M moved',
      '$3.9K in fees · 40% paid in LINK',
      'Records: 952 messages · $115.6M moved · $476 in fees · $900.00 single fee',
      'New on CCIP: BNB Chain · Mode',
      'Busiest lane: Arbitrum One → Base · $195.0M',
    ]);
  });

  const empty = { month: '2026-06', label: 'June 2026', messages: 0, usd: 0, fees: null, linkSharePct: null, records: [], joined: [], busiestLane: null };

  it('leaves out every row with nothing to show', () => {
    expect(monthCardRows(empty)).toEqual(['0 messages · $0 moved']);
  });

  it('writes the value moved as the counter stops on it, rounded down', () => {
    // #given $1.37B, which formatUsd would round up to $1.4B
    const rows = monthCardRows({ ...empty, usd: 1_370_000_000 });
    // #then
    expect({ row: rows[0], counter: odometer(1_370_000_000).text }).toEqual({ row: '0 messages · $1.3B moved', counter: '$1.3B' });
  });

  it.each([0, 0.4, 999.99, 1_000, 1_049_999, 940_120_000, 25_349_999_999, 999_999_999_999.9, 1.2e13])('rounds %s down exactly as the counter does', (usd) => {
    expect(formatUsdDown(usd)).toBe(odometer(usd).text);
  });
});
```

- [ ] **Step 5: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-month.test.ts`
Expected: FAIL: `../src/replay/director/month` does not exist.

- [ ] **Step 6: Teach the director the month cut.**

The month's finale is a second longer, for the end card:

In `site/src/replay/director/phases.ts`, replace:

```ts
};

export function shotTiming(length: number): ShotTiming {
  return TIMING[length] ?? { hook: Math.min(2, length * 0.1), finale: Math.min(3, length * 0.1) };
}

export function phaseAt(t: number, length: number): Phase {
  const { hook, finale } = shotTiming(length);
  return t < hook ? 'hook' : t < length - finale ? 'story' : 'finale';
}
```

with:

```ts
};

/** The month cut's end card has more to say, so its finale runs a second longer. */
const MONTH_TIMING: Record<number, ShotTiming> = {
  15: { hook: 1.5, finale: 3 },
  30: { hook: 2, finale: 4 },
  60: { hook: 2, finale: 4 },
};

export function shotTiming(length: number): ShotTiming {
  return TIMING[length] ?? { hook: Math.min(2, length * 0.1), finale: Math.min(3, length * 0.1) };
}

export function monthTiming(length: number): ShotTiming {
  return MONTH_TIMING[length] ?? shotTiming(length);
}

export function phaseAt(t: number, length: number, timing: ShotTiming = shotTiming(length)): Phase {
  return t < timing.hook ? 'hook' : t < length - timing.finale ? 'story' : 'finale';
}
```

The month's leaderboard counts the whole month, so its window is the month's length:

In `site/src/replay/director/leaderboard.ts`, replace:

```ts
export const BOARD_REST_S = 0.4;
export const BOARD_OVERTAKE = 1.05;
const WINDOW_DAYS = 30;

export interface BoardRow {
```

with:

```ts
export const BOARD_REST_S = 0.4;
export const BOARD_OVERTAKE = 1.05;
export const WINDOW_DAYS = 30;

export interface BoardRow {
```

In `site/src/replay/director/leaderboard.ts`, replace:

```ts
    eligible: (selector: string) => boolean,
    private readonly warp: Warp,
  ) {
    const lanesByDay = new Map(replay.days.map((d) => [d.day, d.lanes]));
```

with:

```ts
    eligible: (selector: string) => boolean,
    private readonly warp: Warp,
    windowDays: number = WINDOW_DAYS,
  ) {
    const lanesByDay = new Map(replay.days.map((d) => [d.day, d.lanes]));
```

In `site/src/replay/director/leaderboard.ts`, replace:

```ts
    days.forEach((_, d) => {
      shift(d, 1);
      if (d >= WINDOW_DAYS) shift(d - WINDOW_DAYS, -1);
      const snapshot = new Map([...running].filter(([, v]) => v > 0));
      this.values.push(snapshot);
```

with:

```ts
    days.forEach((_, d) => {
      shift(d, 1);
      if (d >= windowDays) shift(d - windowDays, -1);
      const snapshot = new Map([...running].filter(([, v]) => v > 0));
      this.values.push(snapshot);
```

Record beats: the same jumps as before; the month keeps its own 3 biggest instead of the all-time 3 that fall in it.

In `site/src/replay/director/beats.ts`, replace:

```ts
}

export function recordEvents(history: readonly { day: string; messages: number }[], days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  let best = 0;
  const jumps: Jump[] = [];
```

with:

```ts
}

/** Every busiest-day record after the first 30 days, a record beside a bigger one left out, the biggest jumps first. */
function recordJumps(history: readonly { day: string; messages: number }[]): Jump[] {
  let best = 0;
  const jumps: Jump[] = [];
```

In `site/src/replay/director/beats.ts`, replace:

```ts
    best = d.messages;
  });
  return withoutAdjacentDays(jumps)
    .sort((a, b) => b.ratio - a.ratio || byDay(a, b))
    .slice(0, MAX_RECORDS)
    .flatMap((j) => {
      const i = at.get(j.day);
```

with:

```ts
    best = d.messages;
  });
  return withoutAdjacentDays(jumps).sort((a, b) => b.ratio - a.ratio || byDay(a, b));
}

function recordDayEvents(jumps: readonly Jump[], at: ReadonlyMap<string, number>): DayEvent[] {
  return jumps
    .flatMap((j) => {
      const i = at.get(j.day);
```

In `site/src/replay/director/beats.ts`, replace:

```ts
    })
    .sort((a, b) => a.dayIndex - b.dayIndex);
}

```

with:

```ts
    })
    .sort((a, b) => a.dayIndex - b.dayIndex);
}

/** The 3 biggest record jumps of all time, as beats when they fall among `days`. */
export function recordEvents(history: readonly { day: string; messages: number }[], days: readonly string[]): DayEvent[] {
  return recordDayEvents(recordJumps(history).slice(0, MAX_RECORDS), indexOf(days));
}

/** The 3 biggest record jumps among `days` (a month), measured against all of `history` before them. */
export function windowRecordEvents(history: readonly { day: string; messages: number }[], days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  return recordDayEvents(recordJumps(history).filter((j) => at.has(j.day)).slice(0, MAX_RECORDS), at);
}

```

The counter adds up fees too; only the month cut asks for them:

In `site/src/replay/director/story.ts`, replace:

```ts
  day: string;
  timeline: number;
}

```

with:

```ts
  day: string;
  timeline: number;
  /** Fees paid so far; only the month cut counts them. */
  fees?: number;
}

```

In `site/src/replay/director/story.ts`, replace:

```ts
  private readonly cumUsd: number[];
  private readonly cumMessages: number[];
  private readonly chainsByDay: number[];

  constructor(
    private readonly days: readonly string[],
    history: readonly { day: string; messages: number; usd_value: number }[],
    replay: Source,
    focus: string | null,
```

with:

```ts
  private readonly cumUsd: number[];
  private readonly cumMessages: number[];
  private readonly cumFees: number[];
  private readonly chainsByDay: number[];

  constructor(
    private readonly days: readonly string[],
    history: readonly { day: string; messages: number; usd_value: number; fee_usd?: number | null }[],
    replay: Source,
    focus: string | null,
```

In `site/src/replay/director/story.ts`, replace:

```ts
    this.cumUsd = this.daily.map((d) => (usd += d.usd_value));
    this.cumMessages = this.daily.map((d) => (messages += d.messages));
  }

```

with:

```ts
    this.cumUsd = this.daily.map((d) => (usd += d.usd_value));
    this.cumMessages = this.daily.map((d) => (messages += d.messages));
    const feeByDay = new Map(history.map((h) => [h.day, h.fee_usd ?? 0]));
    let fees = 0;
    this.cumFees = days.map((day) => (fees += feeByDay.get(day) ?? 0));
  }

```

In `site/src/replay/director/story.ts`, replace:

```ts

  at(t: number, warp: Warp): StoryValues {
    const { index, progress } = warp.dayAt(t);
    const p = t <= warp.start ? 0 : progress;
    const lerp = (cum: number[]) => {
      const before = index > 0 ? cum[index - 1]! : 0;
      return before + ((cum[index] ?? before) - before) * p;
    };
    return {
      usd: lerp(this.cumUsd),
```

with:

```ts

  at(t: number, warp: Warp): StoryValues {
    const lerp = this.lerpAt(t, warp);
    const { index } = warp.dayAt(t);
    return {
      usd: lerp(this.cumUsd),
```

In `site/src/replay/director/story.ts`, replace:

```ts
    };
  }
}
```

with:

```ts
    };
  }

  /** The fees paid in the days so far, counted up through each day like the value moved. */
  feesAt(t: number, warp: Warp): number {
    return this.lerpAt(t, warp)(this.cumFees);
  }

  private lerpAt(t: number, warp: Warp): (cum: readonly number[]) => number {
    const { index, progress } = warp.dayAt(t);
    const p = t <= warp.start ? 0 : progress;
    return (cum) => {
      const before = index > 0 ? cum[index - 1]! : 0;
      return before + ((cum[index] ?? before) - before) * p;
    };
  }
}
```

The month module: the cut replay, the show input and the end card's rows.

Create `site/src/replay/director/month.ts`:

```ts
import { formatCount, formatFee, formatFeeTotal, formatShare, formatUsd, formatUsdDown, linkShareText } from '@ccip-dev/core/format';
import { isPlayableMonth, monthBounds, monthSummary, type MonthSummary } from '@ccip-dev/core/month';
import type { DayTotals, LargestFee, ReplayFile } from '@ccip-dev/core/public';
import type { RecordKind } from '@ccip-dev/core/records';
import { daysBetween } from '../../lib/days';

export interface MonthInput {
  month: string;
  /** Every chain in replay.json: the chain-count milestones count them all, not just the month's. */
  chains: ReplayFile['chains'];
  summary: MonthSummary;
}

/**
 * replay.json cut to one month: every day of the month (empty when nothing moved), and only the lanes that moved in it and
 * their chains, re-indexed in their original order.
 */
export function monthReplay(replay: ReplayFile, month: string): ReplayFile {
  const { first, last } = monthBounds(month);
  const inMonth = new Map(replay.days.filter((d) => d.day >= first && d.day <= last).map((d) => [d.day, d.lanes]));
  const laneIds = [...new Set([...inMonth.values()].flatMap((lanes) => lanes.map(([lane]) => lane)))].sort((a, b) => a - b);
  const chainIds = [...new Set(laneIds.flatMap((lane) => replay.lanes[lane] ?? []))].sort((a, b) => a - b);
  const chainAt = new Map(chainIds.map((c, i) => [c, i]));
  const laneAt = new Map(laneIds.map((l, i) => [l, i]));
  return {
    ...replay,
    since: first,
    chains: chainIds.map((c) => replay.chains[c]!),
    lanes: laneIds.map((lane) => {
      const [src, dst] = replay.lanes[lane]!;
      return [chainAt.get(src)!, chainAt.get(dst)!];
    }),
    days: daysBetween(first, last).map((day) => ({
      day,
      lanes: (inMonth.get(day) ?? []).map(([lane, messages, usd]): [number, number, number] => [laneAt.get(lane)!, messages, usd]),
    })),
  };
}

export interface MonthData {
  replay: ReplayFile;
  history: readonly DayTotals[];
  largest: readonly LargestFee[];
}

/** The month's replay and its show input, or null when the month is not one the page can play (see isPlayableMonth). */
export function monthCut(data: MonthData, month: string): { replay: ReplayFile; month: MonthInput } | null {
  const first = data.replay.since ?? data.replay.days[0]?.day ?? null;
  const lastDay = data.replay.days.at(-1)?.day ?? null;
  if (!isPlayableMonth(month, { first, lastDay })) return null;
  return {
    replay: monthReplay(data.replay, month),
    month: { month, chains: data.replay.chains, summary: monthSummary(month, { days: data.history, largest: data.largest, replay: data.replay }) },
  };
}

/** A record's value, short: the end card's "Records:" row says what kind of high each one is. */
const RECORD_TEXT: Record<RecordKind, (value: number) => string> = {
  messages: (v) => `${formatCount(v)} messages`,
  value: (v) => `${formatUsd(v)} moved`,
  fees: (v) => `${formatFeeTotal(v)} in fees`,
  largest_fee: (v) => `${formatFee(v)} single fee`,
  link_share: (v) => `${formatShare(v)} paid in LINK`,
};

/**
 * The end card's rows: the month's totals always, then fees, records, new chains and the busiest lane when it has them.
 * The value moved is rounded down, as the counter above it stops.
 */
export function monthCardRows(s: MonthSummary): string[] {
  const rows = [`${formatCount(s.messages)} messages · ${formatUsdDown(s.usd)} moved`];
  if (s.fees !== null) rows.push(`${formatFeeTotal(s.fees)} in fees${s.linkSharePct === null ? '' : ` · ${linkShareText(s.linkSharePct)}`}`);
  if (s.records.length > 0) rows.push(`Records: ${s.records.map((r) => RECORD_TEXT[r.kind](r.value)).join(' · ')}`);
  if (s.joined.length > 0) rows.push(`New on CCIP: ${s.joined.map((c) => c.name).join(' · ')}`);
  if (s.busiestLane) rows.push(`Busiest lane: ${s.busiestLane.src.name} → ${s.busiestLane.dst.name} · ${formatUsd(s.busiestLane.usd)}`);
  return rows;
}
```

The show: a `month` input switches the timing, the beats, the board's window, the title, the fees and the end card. Without it, every line runs as before.

In `site/src/replay/director/show.ts`, replace:

```ts
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { daysBetween } from '../../lib/days';
```

with:

```ts
import { monthBounds, monthLabel } from '@ccip-dev/core/month';
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { daysBetween } from '../../lib/days';
```

In `site/src/replay/director/show.ts`, replace:

```ts
  milestoneEvents,
  recordEvents,
  scheduleCards,
  scheduleSlams,
```

with:

```ts
  milestoneEvents,
  recordEvents,
  windowRecordEvents,
  scheduleCards,
  scheduleSlams,
```

In `site/src/replay/director/show.ts`, replace:

```ts
import { cameraAt, punch, type Camera } from './camera';
import { Leaderboard, type BoardRow } from './leaderboard';
import { phaseAt, shotTiming, type Phase, type ShotTiming } from './phases';
import { StoryCounter, type StoryValues } from './story';
import { storyWarp, WARP_PRE_JOIN_SHARE, type Warp } from './warp';
```

with:

```ts
import { cameraAt, punch, type Camera } from './camera';
import { Leaderboard, type BoardRow } from './leaderboard';
import { monthCardRows, type MonthInput } from './month';
import { monthTiming, phaseAt, shotTiming, type Phase, type ShotTiming } from './phases';
import { StoryCounter, type StoryValues } from './story';
import { storyWarp, WARP_PRE_JOIN_SHARE, type Warp } from './warp';
```

In `site/src/replay/director/show.ts`, replace:

```ts
  eligible: (selector: string) => boolean;
  reducedMotion?: boolean;
}

```

with:

```ts
  eligible: (selector: string) => boolean;
  reducedMotion?: boolean;
  /** The month cut: `replay` is then that month's (monthReplay), and `history` stays whole for the all-time beats. */
  month?: MonthInput;
}

```

In `site/src/replay/director/show.ts`, replace:

```ts
  focus: string | null;
  focusStar: number;
}

```

with:

```ts
  focus: string | null;
  focusStar: number;
  /** The month cut's end card rows, during its finale. */
  endCard?: readonly string[];
}

```

In `site/src/replay/director/show.ts`, replace:

```ts
  private readonly hookLane: { from: number; to: number } | null;
  private readonly reducedMotion: boolean;

  constructor(input: ShowInput) {
```

with:

```ts
  private readonly hookLane: { from: number; to: number } | null;
  private readonly reducedMotion: boolean;
  readonly month: string | null;
  private readonly endCard: readonly string[] | null;

  constructor(input: ShowInput) {
```

In `site/src/replay/director/show.ts`, replace:

```ts
    this.days = first && last ? daysBetween(first, last) : [];
    this.length = length;
    this.timing = shotTiming(length);
    const focusChain = input.focus ? replay.chains.find((c) => c.selector === input.focus) ?? null : null;
    this.focus = focusChain?.selector ?? null;
    this.focusName = focusChain ? shortChainName(focusChain) : null;
    this.counter = new StoryCounter(this.days, history, replay, this.focus);
    const milestones = this.focus
      ? computeMilestones(this.counter.dailyTotals(), [])
      : computeMilestones(history, replay.chains);
    const events = [
      ...(this.focus ? laneOpenEvents(replay, this.focus, this.days) : joinEvents(replay.chains, this.days)),
      ...milestoneEvents(milestones, this.days),
      ...(this.focus ? [] : recordEvents(history, this.days)),
    ];
    const preJoin = focusChain ? { preDays: Math.max(0, this.days.indexOf(focusChain.first_day)), preShareMax: WARP_PRE_JOIN_SHARE } : undefined;
```

with:

```ts
    this.days = first && last ? daysBetween(first, last) : [];
    this.length = length;
    const month = input.month ?? null;
    this.month = month?.month ?? null;
    this.timing = month ? monthTiming(length) : shotTiming(length);
    const focusChain = input.focus ? replay.chains.find((c) => c.selector === input.focus) ?? null : null;
    this.focus = focusChain?.selector ?? null;
    this.focusName = focusChain ? shortChainName(focusChain) : null;
    this.counter = new StoryCounter(this.days, history, replay, this.focus);
    // The month cut's beats are all-time ones, as of the month's end, whenever the page is opened.
    const known = month ? history.filter((d) => d.day <= monthBounds(month.month).last) : history;
    const milestones = this.focus
      ? computeMilestones(this.counter.dailyTotals(), [])
      : computeMilestones(known, month?.chains ?? replay.chains);
    const records = month ? windowRecordEvents(known, this.days) : recordEvents(history, this.days);
    const events = [
      ...(this.focus ? laneOpenEvents(replay, this.focus, this.days) : joinEvents(replay.chains, this.days)),
      ...milestoneEvents(milestones, this.days),
      ...(this.focus ? [] : records),
    ];
    const preJoin = focusChain ? { preDays: Math.max(0, this.days.indexOf(focusChain.first_day)), preShareMax: WARP_PRE_JOIN_SHARE } : undefined;
```

In `site/src/replay/director/show.ts`, replace:

```ts
    this.cards = scheduleCards(events, this.warp, this.focusName);
    this.slams = scheduleSlams(events, this.warp);
    this.board = new Leaderboard(replay, this.days, input.eligible, this.warp);
    this.fullExtent = Math.max(1e-6, ...stars.map((s) => Math.hypot(s.x, s.y)));
    this.focusPoint = this.focus ? stars.find((s) => s.selector === this.focus) ?? null : null;
    this.focusStar = this.focus ? stars.findIndex((s) => s.selector === this.focus) : -1;
    this.title = focusChain
      ? { title: `${this.focusName} × Chainlink CCIP`, subtitle: `since ${formatUtcDay(focusChain.first_day)}` }
      : { title: `${yearsLabel(first ?? '', last ?? '')} of Chainlink CCIP`, subtitle: `in ${length} seconds` };
    const starOf = new Map(stars.map((s, i) => [s.selector, i]));
    const firstDay = [...replay.days].sort((a, b) => (a.day < b.day ? -1 : 1))[0];
```

with:

```ts
    this.cards = scheduleCards(events, this.warp, this.focusName);
    this.slams = scheduleSlams(events, this.warp);
    this.board = new Leaderboard(replay, this.days, input.eligible, this.warp, month ? this.days.length : undefined);
    this.fullExtent = Math.max(1e-6, ...stars.map((s) => Math.hypot(s.x, s.y)));
    this.focusPoint = this.focus ? stars.find((s) => s.selector === this.focus) ?? null : null;
    this.focusStar = this.focus ? stars.findIndex((s) => s.selector === this.focus) : -1;
    this.title = month
      ? { title: `CCIP · ${monthLabel(month.month)}`, subtitle: '' }
      : focusChain
        ? { title: `${this.focusName} × Chainlink CCIP`, subtitle: `since ${formatUtcDay(focusChain.first_day)}` }
        : { title: `${yearsLabel(first ?? '', last ?? '')} of Chainlink CCIP`, subtitle: `in ${length} seconds` };
    this.endCard = month ? monthCardRows(month.summary) : null;
    const starOf = new Map(stars.map((s, i) => [s.selector, i]));
    const firstDay = [...replay.days].sort((a, b) => (a.day < b.day ? -1 : 1))[0];
```

In `site/src/replay/director/show.ts`, replace:

```ts
  frameAt(t: number): ShowFrame {
    const time = Math.max(0, Math.min(t, this.length));
    const phase = phaseAt(time, this.length);
    const modelT = Math.min(Math.max(time, this.warp.start), this.warp.end - 1e-6);
    const raw = this.model.frameAt(modelT);
```

with:

```ts
  frameAt(t: number): ShowFrame {
    const time = Math.max(0, Math.min(t, this.length));
    const phase = phaseAt(time, this.length, this.timing);
    const modelT = Math.min(Math.max(time, this.warp.start), this.warp.end - 1e-6);
    const raw = this.model.frameAt(modelT);
```

In `site/src/replay/director/show.ts`, replace:

```ts
      card: cardHit ? { ...cardHit, progress: (time - cardHit.start) / (cardHit.end - cardHit.start) } : null,
      slam: slamHit ? { ...slamHit, progress: (time - slamHit.start) / SLAM_S } : null,
      story: this.counter.at(time, this.warp),
      board: this.board.at(time, this.focus),
      hook: phase === 'hook' ? { ...this.title, progress: clamp01(time / this.timing.hook) } : null,
```

with:

```ts
      card: cardHit ? { ...cardHit, progress: (time - cardHit.start) / (cardHit.end - cardHit.start) } : null,
      slam: slamHit ? { ...slamHit, progress: (time - slamHit.start) / SLAM_S } : null,
      story: this.month ? { ...this.counter.at(time, this.warp), fees: this.counter.feesAt(time, this.warp) } : this.counter.at(time, this.warp),
      board: this.board.at(time, this.focus),
      hook: phase === 'hook' ? { ...this.title, progress: clamp01(time / this.timing.hook) } : null,
```

In `site/src/replay/director/show.ts`, replace:

```ts
      focus: this.focus,
      focusStar: this.focusStar,
    };
  }
```

with:

```ts
      focus: this.focus,
      focusStar: this.focusStar,
      ...(this.endCard && phase === 'finale' ? { endCard: this.endCard } : {}),
    };
  }
```

In `site/src/replay/director/show.ts`, replace:

```ts

  yearTicks(): { time: number; label: string }[] {
    const years = this.days.flatMap((day, i) => (i === 0 || day.endsWith('-01-01') ? [{ time: this.warp.dayStart(i), label: day.slice(0, 4) }] : []));
    const gap = YEAR_TICK_GAP * (this.warp.end - this.warp.start);
```

with:

```ts

  yearTicks(): { time: number; label: string }[] {
    if (this.month) return [];
    const years = this.days.flatMap((day, i) => (i === 0 || day.endsWith('-01-01') ? [{ time: this.warp.dayStart(i), label: day.slice(0, 4) }] : []));
    const gap = YEAR_TICK_GAP * (this.warp.end - this.warp.start);
```

- [ ] **Step 7: Run the director tests, the pin and the typecheck.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-month.test.ts test/replay-pin.test.ts test/director-show.test.ts test/director-beats.test.ts test/director-board.test.ts test/director-story.test.ts test/director-warp.test.ts && pnpm typecheck`
Expected: PASS. The 15 pin digests are unchanged.

- [ ] **Step 8: Commit.**

```bash
git add site/src/replay/director/month.ts site/src/replay/director/phases.ts site/src/replay/director/leaderboard.ts site/src/replay/director/beats.ts site/src/replay/director/story.ts site/src/replay/director/show.ts site/test/director-month.test.ts
git commit -m "feat(site): the month cut: one month's days, chains and beats, a fees counter and an end card" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: The story layer: the fees counter and the end card

**Files:**
- Modify: `site/src/replay/story/layout.ts` (the `fees` and `endCard` boxes), `site/src/replay/story/draw.ts` (`drawFees`, `drawEndCard`)
- Test: `site/test/story-layout.test.ts`, `site/test/story-draw.test.ts`

**Interfaces:**
- Consumes: Task 3 (`StoryValues.fees`, `ShowFrame.endCard`, `monthCut`, the months fixture); live code `layoutFor`, `intersects`, `END_TITLE_PX`, `drawStory`, `setFittedFont`, `roundRect`, `formatFeeTotal`.
- Produces: `StoryLayout.fees: Box` (under the value line, reserved in every aspect) and `StoryLayout.endCard: Box` (under the end title, in the beat card's place, which is free in the finale). `drawStory` draws the fees counter when `frame.story.fees` exists and the end card when `frame.endCard` does; for all-time frames it makes the same calls as before.

- [ ] **Step 1: Write the failing tests.**

The fees box joins the reserved boxes that may never overlap, in all six sizes; the end card must stay clear of every box the finale shows and below the end title.

In `site/test/story-layout.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { aspectOf, intersects, layoutFor, type Box } from '../src/replay/story/layout';
import { odometer, rollOf } from '../src/replay/story/odometer';

```

with:

```ts
import { describe, expect, it } from 'vitest';
import { aspectOf, END_TITLE_PX, intersects, layoutFor, type Box } from '../src/replay/story/layout';
import { odometer, rollOf } from '../src/replay/story/odometer';

```

In `site/test/story-layout.test.ts`, replace:

```ts
describe.each(sizes)('layoutFor(%s, %s)', (w, h) => {
  const l = layoutFor(w, h);
  const reserved = [l.date, l.counter, l.sub, l.board, l.watermark, l.timeline, l.card];

  it('keeps every box inside the canvas', () => {
    for (const b of [...reserved, l.slam, l.title]) expect(inside(b, w, h)).toBe(true);
  });

```

with:

```ts
describe.each(sizes)('layoutFor(%s, %s)', (w, h) => {
  const l = layoutFor(w, h);
  const reserved = [l.date, l.counter, l.sub, l.fees, l.board, l.watermark, l.timeline, l.card];

  it('keeps every box inside the canvas', () => {
    for (const b of [...reserved, l.slam, l.title, l.endCard]) expect(inside(b, w, h)).toBe(true);
  });

```

In `site/test/story-layout.test.ts`, replace:

```ts
  });

  it('keeps the milestone slam clear of the counter, card, board and timeline', () => {
    for (const b of [l.counter, l.card, l.board, l.timeline]) expect(intersects(l.slam, b)).toBe(false);
  });
});
```

with:

```ts
  });

  it('keeps the milestone slam clear of the counter, fees, card, board and timeline', () => {
    for (const b of [l.counter, l.fees, l.card, l.board, l.timeline]) expect(intersects(l.slam, b)).toBe(false);
  });

  it('keeps the end card clear of every box the finale shows, and below the end title', () => {
    // #then the beat card's box is free in the finale: every card ends with the story
    for (const b of [l.date, l.counter, l.sub, l.fees, l.board, l.watermark, l.timeline]) expect(intersects(l.endCard, b)).toBe(false);
    expect(l.endCard.y).toBeGreaterThanOrEqual(h / 2 + (END_TITLE_PX * l.unit) / 2);
  });
});
```

In `site/test/story-draw.test.ts`, replace:

```ts
import { drawStory, endTitleAlpha, loadCanvasFonts } from '../src/replay/story/draw';
import { layoutFor } from '../src/replay/story/layout';
import { chainNameMap } from '../src/lib/names';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

```

with:

```ts
import { drawStory, endTitleAlpha, loadCanvasFonts } from '../src/replay/story/draw';
import { layoutFor } from '../src/replay/story/layout';
import { formatFeeTotal } from '../src/lib/format';
import { chainNameMap } from '../src/lib/names';
import { monthCut } from '../src/replay/director/month';
import { buildLayout } from '../src/sky/layout';
import { LARGEST_FEES, monthsHistory, monthsReplay } from './fixtures/months';
import replayJson from './fixtures/replay.json';

```

In `site/test/story-draw.test.ts`, replace:

```ts
    await expect(loadCanvasFonts({ load: async () => Promise.reject(new Error('offline')) })).resolves.toBeUndefined();
  });
});
```

with:

```ts
    await expect(loadCanvasFonts({ load: async () => Promise.reject(new Error('offline')) })).resolves.toBeUndefined();
  });
});

describe('drawStory for the month cut', () => {
  const data = { replay: monthsReplay(), history: monthsHistory(), largest: LARGEST_FEES };
  const cut = monthCut(data, '2026-09')!;
  const month = new Show({ replay: cut.replay, history: data.history, stars: buildLayout(cut.replay.chains), length: 30, focus: null, eligible: () => true, month: cut.month });
  const monthAssets = { names: chainNameMap(data.replay.chains), coins: new Map<string, CanvasImageSource>(), ticks: [] };

  it('draws the fees counter under the value moved, and the all-time cut does not', () => {
    // #given
    const frame = month.frameAt(15);
    const drawn: Drawn[] = [];
    const allTime: string[] = [];
    // #when
    drawStory(fontCtx(drawn), frame, layoutFor(1080, 1080), monthAssets);
    drawStory(fakeCtx(allTime), show.frameAt(15), layoutFor(1080, 1080), assets);
    // #then
    expect({
      value: fontOf(drawn, formatFeeTotal(frame.story.fees!)),
      label: drawn.some((d) => d.text === 'in fees'),
      allTime: allTime.includes('in fees'),
    }).toEqual({ value: '600 40px "JetBrains Mono", monospace', label: true, allTime: false });
  });

  it('draws every end card row once the finale is under way, and none as it starts', () => {
    // #given
    const rows = month.frameAt(28).endCard!;
    const late: string[] = [];
    const early: string[] = [];
    // #when
    drawStory(fakeCtx(late), month.frameAt(28), layoutFor(1080, 1080), monthAssets);
    drawStory(fakeCtx(early), month.frameAt(26), layoutFor(1080, 1080), monthAssets);
    // #then
    expect({ rows: rows.length, late: rows.every((r) => late.includes(r)), early: rows.some((r) => early.includes(r)) }).toEqual({ rows: 5, late: true, early: false });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/story-layout.test.ts test/story-draw.test.ts`
Expected: FAIL: `l.fees` and `l.endCard` are undefined, and nothing draws "in fees" or the end card's rows.

- [ ] **Step 3: Reserve the boxes and draw them.**

In `site/src/replay/story/layout.ts`, replace:

```ts
  counter: Box;
  sub: Box;
  board: Box;
  watermark: Box;
```

with:

```ts
  counter: Box;
  sub: Box;
  /** The month cut's fees counter, under the value moved. */
  fees: Box;
  board: Box;
  watermark: Box;
```

In `site/src/replay/story/layout.ts`, replace:

```ts
  slam: Box;
  title: Box;
}

```

with:

```ts
  slam: Box;
  title: Box;
  /** The month cut's end card, under the end title, where the beat cards were. */
  endCard: Box;
}

```

In `site/src/replay/story/layout.ts`, replace:

```ts
  const counter: Box = { x: pad, y: pad + 64 * u, w: 640 * u, h: 110 * u };
  const sub: Box = { x: pad, y: pad + 180 * u, w: 640 * u, h: 34 * u };
  const timelineH = 40 * u;
  const slam = centered(width, Math.min(900 * u, width - 2 * pad), height / 2 - 100 * u, 200 * u);
  const title = centered(width, Math.min(1200 * u, width - 2 * pad), height / 2 - 130 * u, 260 * u);
  if (aspect === 'wide') {
    const boardW = 380 * u;
```

with:

```ts
  const counter: Box = { x: pad, y: pad + 64 * u, w: 640 * u, h: 110 * u };
  const sub: Box = { x: pad, y: pad + 180 * u, w: 640 * u, h: 34 * u };
  const fees: Box = { x: pad, y: pad + 226 * u, w: 640 * u, h: 48 * u };
  const timelineH = 40 * u;
  const slam = centered(width, Math.min(900 * u, width - 2 * pad), height / 2 - 100 * u, 200 * u);
  const title = centered(width, Math.min(1200 * u, width - 2 * pad), height / 2 - 130 * u, 260 * u);
  const endCard = centered(width, Math.min(900 * u, width - 2 * pad), title.y + title.h, 176 * u);
  if (aspect === 'wide') {
    const boardW = 380 * u;
```

In `site/src/replay/story/layout.ts`, replace:

```ts
    const timeline: Box = { x: pad, y: height - pad - timelineH, w: width - 2 * pad - boardW - 40 * u, h: timelineH };
    const card = centered(width, 640 * u, timeline.y - 24 * u - 90 * u, 90 * u);
    return { aspect, unit: u, width, height, date, counter, sub, board, watermark, timeline, card, slam, title };
  }
  const watermark: Box = { x: width - pad - 300 * u, y: pad, w: 300 * u, h: 30 * u };
```

with:

```ts
    const timeline: Box = { x: pad, y: height - pad - timelineH, w: width - 2 * pad - boardW - 40 * u, h: timelineH };
    const card = centered(width, 640 * u, timeline.y - 24 * u - 90 * u, 90 * u);
    return { aspect, unit: u, width, height, date, counter, sub, fees, board, watermark, timeline, card, slam, title, endCard };
  }
  const watermark: Box = { x: width - pad - 300 * u, y: pad, w: 300 * u, h: 30 * u };
```

In `site/src/replay/story/layout.ts`, replace:

```ts
  const board: Box = { x: pad, y: timeline.y - 16 * u - 120 * u, w: width - 2 * pad, h: 120 * u };
  const card = centered(width, 640 * u, board.y - 24 * u - 90 * u, 90 * u);
  return { aspect, unit: u, width, height, date, counter, sub, board, watermark, timeline, card, slam, title };
}
```

with:

```ts
  const board: Box = { x: pad, y: timeline.y - 16 * u - 120 * u, w: width - 2 * pad, h: 120 * u };
  const card = centered(width, 640 * u, board.y - 24 * u - 90 * u, 90 * u);
  return { aspect, unit: u, width, height, date, counter, sub, fees, board, watermark, timeline, card, slam, title, endCard };
}
```

In `site/src/replay/story/draw.ts`, replace:

```ts
import { formatCount, formatUtcDay } from '../../lib/format';
import { chainName, type ChainNames } from '../../lib/names';
import { stripCells, stripColumns, type BoardRow } from '../director/leaderboard';
```

with:

```ts
import { formatCount, formatFeeTotal, formatUtcDay } from '../../lib/format';
import { chainName, type ChainNames } from '../../lib/names';
import { stripCells, stripColumns, type BoardRow } from '../director/leaderboard';
```

In `site/src/replay/story/draw.ts`, replace:

```ts
  ctx.fillStyle = MUTED;
  ctx.fillText(`moved · ${formatCount(frame.story.messages)} messages · ${chainCount(frame.story.chains)}`, l.sub.x, l.sub.y);
  ctx.restore();
}
```

with:

```ts
  ctx.fillStyle = MUTED;
  ctx.fillText(`moved · ${formatCount(frame.story.messages)} messages · ${chainCount(frame.story.chains)}`, l.sub.x, l.sub.y);
  ctx.restore();
}

function drawFees(ctx: Ctx, fees: number, l: StoryLayout): void {
  const u = l.unit;
  const value = formatFeeTotal(fees);
  const baseline = l.fees.y + 40 * u;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `600 ${40 * u}px ${MONO}`;
  ctx.fillStyle = FG;
  ctx.fillText(value, l.fees.x, baseline);
  const after = l.fees.x + ctx.measureText(value).width + 12 * u;
  ctx.font = `400 ${26 * u}px ${SANS}`;
  ctx.fillStyle = MUTED;
  ctx.fillText('in fees', after, baseline);
  ctx.restore();
}
```

In `site/src/replay/story/draw.ts`, replace:

```ts
}

export function endTitleAlpha(finale: number, afterParticles: boolean): number {
  return afterParticles ? ease((finale - 0.6) / 0.2) : ease((finale - 0.3) / 0.4);
```

with:

```ts
}

/** The month cut's end card: its rows fade in as the finale starts, the totals first and brightest, each shrunk to fit. */
function drawEndCard(ctx: Ctx, rows: readonly string[], frame: ShowFrame, l: StoryLayout): void {
  const alpha = ease((frame.finale - 0.05) / 0.15);
  if (alpha <= 0 || rows.length === 0) return;
  const u = l.unit;
  const b = l.endCard;
  const rowH = Math.min(32 * u, (b.h - 20 * u) / rows.length);
  const top = b.y + (b.h - rowH * rows.length) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, b, 18 * u);
  ctx.fillStyle = CARD;
  ctx.fill();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  rows.forEach((row, i) => {
    ctx.fillStyle = i === 0 ? FG : MUTED;
    setFittedFont(ctx, row, i === 0 ? 800 : 600, 24 * u, SANS, b.w - 48 * u);
    ctx.fillText(row, l.width / 2, top + rowH * (i + 0.5));
  });
  ctx.restore();
}

export function endTitleAlpha(finale: number, afterParticles: boolean): number {
  return afterParticles ? ease((finale - 0.6) / 0.2) : ease((finale - 0.3) / 0.4);
```

In `site/src/replay/story/draw.ts`, replace:

```ts
  drawDate(ctx, frame, layout);
  drawCounter(ctx, frame, layout);
  if (chrome) drawTimeline(ctx, frame, layout, assets);
  drawBoard(ctx, frame, layout, assets);
```

with:

```ts
  drawDate(ctx, frame, layout);
  drawCounter(ctx, frame, layout);
  if (frame.story.fees !== undefined) drawFees(ctx, frame.story.fees, layout);
  if (chrome) drawTimeline(ctx, frame, layout, assets);
  drawBoard(ctx, frame, layout, assets);
```

In `site/src/replay/story/draw.ts`, replace:

```ts
  if (frame.slam) drawSlam(ctx, frame, layout);
  if (chrome) drawWatermark(ctx, layout);
  if (frame.phase === 'finale') drawEndTitle(ctx, frame, layout, opts.titleAfterParticles ?? false);
}
```

with:

```ts
  if (frame.slam) drawSlam(ctx, frame, layout);
  if (chrome) drawWatermark(ctx, layout);
  if (frame.endCard) drawEndCard(ctx, frame.endCard, frame, layout);
  if (frame.phase === 'finale') drawEndTitle(ctx, frame, layout, opts.titleAfterParticles ?? false);
}
```

- [ ] **Step 4: Run the story tests, the pin and the typecheck.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/story-layout.test.ts test/story-draw.test.ts test/replay-pin.test.ts test/cinema-compositor.test.ts test/compose.test.ts && pnpm typecheck`
Expected: PASS. The 15 pin digests are unchanged: all-time frames have neither `story.fees` nor `endCard`.

- [ ] **Step 5: Commit.**

```bash
git add site/src/replay/story/layout.ts site/src/replay/story/draw.ts site/test/story-layout.test.ts site/test/story-draw.test.ts
git commit -m "feat(site): the month cut's fees counter and end card, in boxes that never overlap" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: The month page and its record hook

**Files:**
- Create: `site/src/pages/replay/month.astro`, `site/src/replay/wav.ts`, `site/src/replay/record-hook.ts`, `site/src/replay/record-cut.ts`
- Modify: `site/src/layouts/Base.astro` (`noindex`), `site/src/components/ReplayPage.astro` (`month`), `site/src/replay/player.tsx` (month mode, the hook), `site/src/replay/recorder.ts` (`monthRecordingFilename`)
- Test: `site/test/record-hook.test.ts`, `site/test/recorder.test.ts`

**Interfaces:**
- Consumes: Task 3 (`monthCut`, `ShowInput.month`); Task 4 (the drawing); live code `canRecord`, `recordReplay`, `ASPECT_SIZE`, `AVC_CODEC`, `REPLAY_LENGTHS`, `recordWithFallback`, `buildCompositor`, `CinemaCompositor`, `ReplayCompositor`, `RECORDING_CINEMA_OPTIONS`, `recordingDraw`, `renderScore`, `scoreFor`, `loadCanvasFonts`, `settleWithin`, `COIN_WAIT_MS`.
- Produces:
  - `site/src/replay/wav.ts`: `interface PcmAudio { channels: readonly Float32Array[]; sampleRate: number }`, `wavBytes(audio: PcmAudio): Uint8Array<ArrayBuffer>` (16-bit PCM).
  - `site/src/replay/record-hook.ts`: `VIDEO_FILE = 'video.mp4'`, `AUDIO_FILE = 'audio.wav'`, `interface RecordRequest { aspect: string; length: number }`, `interface RecordedFiles { video: string; audio: string }`, `interface RecordHookDeps { canRecord(aspect: Aspect): Promise<boolean>; record(aspect: Aspect, length: ReplayLength, onProgress: (fraction: number) => void): Promise<{ video: Blob; audio: PcmAudio }>; download(blob: Blob, filename: string): void; log(line: string): void }`, `createRecordHook(deps: RecordHookDeps): (request: RecordRequest) => Promise<RecordedFiles>`, and `Window.ccipRecord?`.
  - `site/src/replay/record-cut.ts` (browser only): `interface CutInputs { showInput: ShowInput; stars: readonly StarPoint[]; assets: CompositorAssets; coins: () => Promise<ReadonlyMap<string, CanvasImageSource>> }`, `recordCut(inputs: CutInputs, aspect: Aspect, length: ReplayLength, onProgress: (fraction: number) => void): Promise<{ video: Blob; audio: PcmAudio }>`, `downloadBlob(blob: Blob, filename: string): void`.
  - `recorder.ts`: `monthRecordingFilename(month: string, aspect: Aspect): string`.
  - `ReplayPlayer`'s prop `month?: boolean`, `ReplayPage.astro`'s prop `month?: boolean`, `Base.astro`'s prop `noindex?: boolean`; the page `/replay/month/?m=YYYY-MM`; `document.documentElement.dataset.month` is `'ready'` once `window.ccipRecord` is installed and `'missing'` for no such month (Task 6's script waits for it).

- [ ] **Step 1: Write the failing tests.**

The hook's logic is tested in Node with fakes: two downloads of the right names and types, a clear failure without H.264, no second recording at once. The recording itself (`recordCut`) needs a browser; Task 6 Step 7 runs it, as the spike did on the runner.

Create `site/test/record-hook.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AUDIO_FILE, createRecordHook, VIDEO_FILE, type RecordHookDeps } from '../src/replay/record-hook';
import { wavBytes } from '../src/replay/wav';

const MP4 = new Blob([new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112])], { type: 'video/mp4' });

function deps(o: Partial<RecordHookDeps> = {}) {
  const files: { name: string; type: string; size: number }[] = [];
  const lines: string[] = [];
  const record = vi.fn<RecordHookDeps['record']>(async (_aspect, _length, onProgress) => {
    for (const f of [0.05, 0.1, 0.12, 0.5, 1]) onProgress(f);
    return { video: MP4, audio: { channels: [new Float32Array([0, 0.5]), new Float32Array([0, -0.5])], sampleRate: 48_000 } };
  });
  const d: RecordHookDeps = {
    canRecord: async () => true,
    record,
    download: (blob, name) => files.push({ name, type: blob.type, size: blob.size }),
    log: (line) => lines.push(line),
    ...o,
  };
  return { d, files, lines, record };
}

describe('the record hook', () => {
  it('records the cut and hands over a silent MP4 and a WAV soundtrack, logging each tenth once', async () => {
    // #given
    const { d, files, lines, record } = deps();
    // #when
    const result = await createRecordHook(d)({ aspect: '1:1', length: 30 });
    // #then 2 frames of 2 channels of 16 bits after the 44-byte header
    expect({ result, files, lines, asked: record.mock.calls[0]?.slice(0, 2) }).toEqual({
      result: { video: VIDEO_FILE, audio: AUDIO_FILE },
      files: [
        { name: 'video.mp4', type: 'video/mp4', size: MP4.size },
        { name: 'audio.wav', type: 'audio/wav', size: 44 + 8 },
      ],
      lines: ['ccipRecord: 0%', 'ccipRecord: 10%', 'ccipRecord: 50%', 'ccipRecord: 100%'],
      asked: ['1:1', 30],
    });
  });

  it('fails with a clear message when the browser cannot encode H.264, and records nothing', async () => {
    // #given
    const { d, files, record } = deps({ canRecord: async () => false });
    // #when
    const failure = await createRecordHook(d)({ aspect: '1:1', length: 30 }).catch((e: Error) => e.message);
    // #then
    expect({ failure, files, recorded: record.mock.calls.length }).toEqual({
      failure: 'ccipRecord: this browser cannot encode H.264 (avc1.640028) at 1080×1080',
      files: [],
      recorded: 0,
    });
  });

  it('refuses an aspect or a length the replay does not have', async () => {
    // #given
    const hook = createRecordHook(deps().d);
    // #when
    const failures = await Promise.all([hook({ aspect: '4:3', length: 30 }), hook({ aspect: '1:1', length: 45 })].map((p) => p.catch((e: Error) => e.message)));
    // #then
    expect(failures).toEqual(['ccipRecord: aspect must be one of 16:9, 1:1, 9:16, not 4:3', 'ccipRecord: length must be one of 15, 30, 60 seconds, not 45']);
  });

  it('runs one recording at a time', async () => {
    // #given a recording that has not finished
    let finish: () => void = () => {};
    const slow = deps({ record: () => new Promise((resolve) => (finish = () => resolve({ video: MP4, audio: { channels: [new Float32Array(1)], sampleRate: 48_000 } }))) });
    const hook = createRecordHook(slow.d);
    const first = hook({ aspect: '1:1', length: 30 });
    await Promise.resolve();
    // #when
    const second = await hook({ aspect: '1:1', length: 30 }).catch((e: Error) => e.message);
    finish();
    // #then
    expect({ second, first: await first }).toEqual({ second: 'ccipRecord: a recording is already running', first: { video: VIDEO_FILE, audio: AUDIO_FILE } });
  });
});

describe('wavBytes', () => {
  it('writes a 16-bit PCM WAV header and the channels interleaved, clipped to ±1', () => {
    // #when
    const bytes = wavBytes({ channels: [new Float32Array([1, -1]), new Float32Array([0.5, 2])], sampleRate: 48_000 });
    const view = new DataView(bytes.buffer);
    const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    // #then
    expect({
      riff: text(0, 4), wave: text(8, 12), fmt: text(12, 16), data: text(36, 40),
      format: view.getUint16(20, true), channels: view.getUint16(22, true), rate: view.getUint32(24, true), bits: view.getUint16(34, true),
      size: view.getUint32(40, true),
      samples: [0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)),
    }).toEqual({
      riff: 'RIFF', wave: 'WAVE', fmt: 'fmt ', data: 'data', format: 1, channels: 2, rate: 48_000, bits: 16, size: 8, samples: [32767, 16384, -32768, 32767],
    });
  });
});
```

In `site/test/recorder.test.ts`, replace:

```ts
});

import { AudioEncodeError, audioCodecAvailable, canRecord, raceAbort, recordingFilename, recordReplay, recordWithAudioFallback, totalFrames } from '../src/replay/recorder';

class FakeOffscreenCanvas {
```

with:

```ts
});

import {
  AudioEncodeError, audioCodecAvailable, canRecord, monthRecordingFilename, raceAbort, recordingFilename, recordReplay, recordWithAudioFallback, totalFrames,
} from '../src/replay/recorder';

class FakeOffscreenCanvas {
```

In `site/test/recorder.test.ts`, replace:

```ts
    expect(recordingFilename('2026-10-06', '1:1', 'base')).toBe('ccip-replay-base-2026-10-06-1x1.mp4');
    expect(recordingFilename('2026-10-06', '16:9', null)).toBe('ccip-replay-2026-10-06-16x9.mp4');
  });

```

with:

```ts
    expect(recordingFilename('2026-10-06', '1:1', 'base')).toBe('ccip-replay-base-2026-10-06-1x1.mp4');
    expect(recordingFilename('2026-10-06', '16:9', null)).toBe('ccip-replay-2026-10-06-16x9.mp4');
  });

  it("names a month page's recording after its month", () => {
    expect(monthRecordingFilename('2026-09', '1:1')).toBe('ccip-month-2026-09-1x1.mp4');
  });

```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/site exec vitest run test/record-hook.test.ts test/recorder.test.ts`
Expected: FAIL: `../src/replay/record-hook` and `../src/replay/wav` do not exist, and `monthRecordingFilename` is not a function.

- [ ] **Step 3: Add the WAV writer, the hook and the browser recording.**

Create `site/src/replay/wav.ts`:

```ts
export interface PcmAudio {
  channels: readonly Float32Array[];
  sampleRate: number;
}

/** A 16-bit PCM WAV of the channels, interleaved: the soundtrack ffmpeg muxes into the silent video as AAC. */
export function wavBytes({ channels, sampleRate }: PcmAudio): Uint8Array<ArrayBuffer> {
  const frames = channels[0]?.length ?? 0;
  const blockAlign = channels.length * 2;
  const dataBytes = frames * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let f = 0; f < frames; f++) {
    channels.forEach((channel, c) => {
      const v = Math.max(-1, Math.min(1, channel[f] ?? 0));
      view.setInt16(44 + (f * channels.length + c) * 2, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
    });
  }
  return new Uint8Array(view.buffer);
}
```

Create `site/src/replay/record-hook.ts`:

```ts
import type { Aspect } from './player';
import { ASPECT_SIZE, AVC_CODEC } from './recorder';
import { REPLAY_LENGTHS, type ReplayLength } from './timeline';
import { wavBytes, type PcmAudio } from './wav';

export const VIDEO_FILE = 'video.mp4';
export const AUDIO_FILE = 'audio.wav';

export interface RecordRequest {
  aspect: string;
  length: number;
}

export interface RecordedFiles {
  video: string;
  audio: string;
}

export interface RecordHookDeps {
  canRecord: (aspect: Aspect) => Promise<boolean>;
  /** Records the cut without sound, and renders its soundtrack apart. */
  record: (aspect: Aspect, length: ReplayLength, onProgress: (fraction: number) => void) => Promise<{ video: Blob; audio: PcmAudio }>;
  download: (blob: Blob, filename: string) => void;
  log: (line: string) => void;
}

declare global {
  interface Window {
    /** The month page's hook for the monthly video workflow: the silent MP4 and the WAV soundtrack arrive as two downloads. */
    ccipRecord?: (request: RecordRequest) => Promise<RecordedFiles>;
  }
}

const isAspect = (value: string): value is Aspect => Object.hasOwn(ASPECT_SIZE, value);
const isLength = (value: number): value is ReplayLength => (REPLAY_LENGTHS as readonly number[]).includes(value);

/** Logs each tenth of the recording once, so the workflow's log shows it moving. */
function progressLog(log: (line: string) => void): (fraction: number) => void {
  let shown = -1;
  return (fraction) => {
    const tenth = Math.floor(fraction * 10);
    if (tenth <= shown) return;
    shown = tenth;
    log(`ccipRecord: ${tenth * 10}%`);
  };
}

/**
 * The record hook: checks the request and the browser, records, then hands over the video and its soundtrack as
 * `video.mp4` and `audio.wav`. One recording at a time; a request it cannot serve fails with the reason.
 */
export function createRecordHook(deps: RecordHookDeps): (request: RecordRequest) => Promise<RecordedFiles> {
  let busy = false;
  return async ({ aspect, length }) => {
    if (!isAspect(aspect)) throw new Error(`ccipRecord: aspect must be one of ${Object.keys(ASPECT_SIZE).join(', ')}, not ${String(aspect)}`);
    if (!isLength(length)) throw new Error(`ccipRecord: length must be one of ${REPLAY_LENGTHS.join(', ')} seconds, not ${String(length)}`);
    if (busy) throw new Error('ccipRecord: a recording is already running');
    const { width, height } = ASPECT_SIZE[aspect];
    if (!(await deps.canRecord(aspect))) throw new Error(`ccipRecord: this browser cannot encode H.264 (${AVC_CODEC}) at ${width}×${height}`);
    busy = true;
    try {
      const { video, audio } = await deps.record(aspect, length, progressLog(deps.log));
      deps.download(new Blob([video], { type: 'video/mp4' }), VIDEO_FILE);
      deps.download(new Blob([wavBytes(audio)], { type: 'audio/wav' }), AUDIO_FILE);
      return { video: VIDEO_FILE, audio: AUDIO_FILE };
    } finally {
      busy = false;
    }
  };
}
```

`recordCut` is the record button's recording (the same compositors, the same fallback, the same recorder) without sound, plus the soundtrack rendered apart:

Create `site/src/replay/record-cut.ts`:

```ts
import type { StarPoint } from '../sky/layout';
import { CinemaCompositor } from './cinema/compositor';
import { ReplayCompositor, type CompositorAssets } from './compose';
import { buildCompositor, RECORDING_CINEMA_OPTIONS, recordingDraw, recordWithFallback, type Compositor } from './compositors';
import { Show, type ShowInput } from './director/show';
import type { Aspect } from './player';
import { recordReplay } from './recorder';
import { scoreFor } from './score/schedule';
import { renderScore } from './score/synth';
import { loadCanvasFonts } from './story/draw';
import type { ReplayLength } from './timeline';
import type { PcmAudio } from './wav';

export interface CutInputs {
  showInput: ShowInput;
  stars: readonly StarPoint[];
  assets: CompositorAssets;
  coins: () => Promise<ReadonlyMap<string, CanvasImageSource>>;
}

/**
 * Records a cut as the record button does (the cinema renderer, the classic one if WebGL is lost), but without sound, and
 * renders its soundtrack apart: Chrome on Linux cannot encode AAC, so the workflow muxes the two with ffmpeg.
 */
export async function recordCut(inputs: CutInputs, aspect: Aspect, length: ReplayLength, onProgress: (fraction: number) => void): Promise<{ video: Blob; audio: PcmAudio }> {
  const show = new Show({ ...inputs.showInput, length, reducedMotion: false });
  const coins = await inputs.coins();
  await loadCanvasFonts(document.fonts);
  const detached = () => document.createElement('canvas');
  const recorders: Compositor[] = [];
  try {
    const video = await recordWithFallback((kind) => {
      const recorder = buildCompositor(kind, () => CinemaCompositor.isSupported(detached), {
        cinema: () => new CinemaCompositor(show, inputs.stars, inputs.assets, detached, RECORDING_CINEMA_OPTIONS),
        classic: () => new ReplayCompositor(show, inputs.stars, inputs.assets, detached, { preferGl: kind === 'cinema' }),
      });
      recorders.push(recorder);
      recorder.setCoinImages(coins);
      if (recorder instanceof CinemaCompositor) recorder.refreshTitle();
      return recordReplay({ draw: recordingDraw(recorder), aspect, lengthS: length, onProgress, signal: new AbortController().signal, audio: null });
    });
    const buffer = await renderScore(scoreFor(show), show.length);
    return { video, audio: { channels: [buffer.getChannelData(0), buffer.getChannelData(1)], sampleRate: buffer.sampleRate } };
  } finally {
    for (const r of recorders) r.destroy();
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
```

In `site/src/replay/recorder.ts`, replace:

```ts
export function recordingFilename(lastDay: string, aspect: Aspect, slug: string | null = null): string {
  return `ccip-replay-${slug ? `${slug}-` : ''}${lastDay}-${aspect.replace(':', 'x')}.mp4`;
}

```

with:

```ts
export function recordingFilename(lastDay: string, aspect: Aspect, slug: string | null = null): string {
  return `ccip-replay-${slug ? `${slug}-` : ''}${lastDay}-${aspect.replace(':', 'x')}.mp4`;
}

export function monthRecordingFilename(month: string, aspect: Aspect): string {
  return `ccip-month-${month}-${aspect.replace(':', 'x')}.mp4`;
}

```

- [ ] **Step 4: Give the player its month mode.**

With `month`, the player reads `?m=`, plays the month cut, says "No such month" for a month it cannot play, hides the chain picker and the share button, retitles the page, names its own recordings after the month and installs `window.ccipRecord`. Without it, nothing changes.

In `site/src/replay/player.tsx`, replace:

```tsx
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { track, trackDataError } from '../lib/analytics';
```

with:

```tsx
import type { DayTotals, LargestFee, ReplayFile } from '@ccip-dev/core/public';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { track, trackDataError } from '../lib/analytics';
```

In `site/src/replay/player.tsx`, replace:

```tsx
  type CompositorKind,
} from './compositors';
import { audioCodecAvailable, canRecord, raceAbort, recordingFilename, recordReplay, recordWithAudioFallback } from './recorder';
import { scoreFor } from './score/schedule';
import { renderScore } from './score/synth';
```

with:

```tsx
  type CompositorKind,
} from './compositors';
import { monthCut } from './director/month';
import { downloadBlob, recordCut } from './record-cut';
import { createRecordHook } from './record-hook';
import { audioCodecAvailable, canRecord, monthRecordingFilename, raceAbort, recordingFilename, recordReplay, recordWithAudioFallback } from './recorder';
import { scoreFor } from './score/schedule';
import { renderScore } from './score/synth';
```

In `site/src/replay/player.tsx`, replace:

```tsx
  replay: ReplayFile;
  history: DayTotals[];
}

export default function ReplayPlayer({ focus: initialFocus, slugs }: { focus: string | null; slugs: Record<string, string> }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
```

with:

```tsx
  replay: ReplayFile;
  history: DayTotals[];
  largest: LargestFee[];
}

/** `month` makes this the unlisted month page: it plays the month cut of `?m=YYYY-MM` and installs the record hook. */
export default function ReplayPlayer({ focus: initialFocus, slugs, month = false }: { focus: string | null; slugs: Record<string, string>; month?: boolean }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
```

In `site/src/replay/player.tsx`, replace:

```tsx
        loadFailuresRef.current = 0;
        setLoadFailed(false);
        setData({ replay, history: history.days });
      })
      .catch((err: unknown) => {
```

with:

```tsx
        loadFailuresRef.current = 0;
        setLoadFailed(false);
        setData({ replay, history: history.days, largest: history.largest_fees ?? [] });
      })
      .catch((err: unknown) => {
```

In `site/src/replay/player.tsx`, replace:

```tsx
  }, [attempt]);

  const stars = useMemo(() => (data ? buildLayout(data.replay.chains) : []), [data]);

  useEffect(() => {
    if (!data) return;
    let alive = true;
    const hrefs = new Map(
      data.replay.chains.flatMap((c) => {
        const href = iconHref(c.selector);
        return href ? [[c.selector, href] as const] : [];
```

with:

```tsx
  }, [attempt]);

  const monthParam = useMemo(() => (month ? new URLSearchParams(window.location.search).get('m') ?? '' : null), [month]);
  const monthView = useMemo(() => (data && monthParam !== null ? monthCut(data, monthParam) : null), [data, monthParam]);
  const noSuchMonth = monthParam !== null && data !== null && monthView === null;
  const played = monthView?.replay ?? data?.replay ?? null;
  const stars = useMemo(() => (played ? buildLayout(played.chains) : []), [played]);

  useEffect(() => {
    if (!played) return;
    let alive = true;
    const hrefs = new Map(
      played.chains.flatMap((c) => {
        const href = iconHref(c.selector);
        return href ? [[c.selector, href] as const] : [];
```

In `site/src/replay/player.tsx`, replace:

```tsx
      alive = false;
    };
  }, [data]);

  const names = useMemo(() => (data ? chainNameMap(data.replay.chains) : new Map<string, string>()), [data]);
  const showInput = useMemo<ShowInput | null>(
    () => (data ? { replay: data.replay, history: data.history, stars, length, focus, eligible: hasIcon, reducedMotion } : null),
    [data, stars, length, focus, reducedMotion],
  );
  const show = useMemo(() => (showInput ? new Show(showInput) : null), [showInput]);
  const assets = useMemo(
```

with:

```tsx
      alive = false;
    };
  }, [played]);

  const names = useMemo(() => (data ? chainNameMap(data.replay.chains) : new Map<string, string>()), [data]);
  const showInput = useMemo<ShowInput | null>(() => {
    if (!data || noSuchMonth) return null;
    if (monthView) return { replay: monthView.replay, history: data.history, stars, length, focus: null, eligible: hasIcon, reducedMotion, month: monthView.month };
    return { replay: data.replay, history: data.history, stars, length, focus, eligible: hasIcon, reducedMotion };
  }, [data, monthView, noSuchMonth, stars, length, focus, reducedMotion]);
  const show = useMemo(() => (showInput ? new Show(showInput) : null), [showInput]);
  const assets = useMemo(
```

In `site/src/replay/player.tsx`, replace:

```tsx
  const headSkippedRef = useRef(true);
  useEffect(() => {
    if (!data || !show) return;
    if (headSkippedRef.current) {
      headSkippedRef.current = false;
```

with:

```tsx
  const headSkippedRef = useRef(true);
  useEffect(() => {
    if (!data || !show || month) return;
    if (headSkippedRef.current) {
      headSkippedRef.current = false;
```

In `site/src/replay/player.tsx`, replace:

```tsx
    if (lead) lead.textContent = head.lead;
  }, [data, show]);

  const since = data?.replay.since ?? '';
```

with:

```tsx
    if (lead) lead.textContent = head.lead;
  }, [data, show]);

  useEffect(() => {
    if (!monthView) return;
    const title = document.getElementById('replay-title');
    if (title) title.textContent = `CCIP in ${monthView.month.summary.label}`;
    document.title = `CCIP in ${monthView.month.summary.label} · Replay · ccip.dev`;
  }, [monthView]);

  useEffect(() => {
    if (noSuchMonth) document.documentElement.dataset.month = 'missing';
  }, [noSuchMonth]);

  useEffect(() => {
    if (!monthView || !showInput || !assets) return;
    const noCoins: ReadonlyMap<string, CanvasImageSource> = new Map();
    window.ccipRecord = createRecordHook({
      canRecord,
      record: (aspect, lengthS, onProgress) =>
        recordCut({ showInput, stars, assets, coins: () => settleWithin(coinLoadRef.current ?? Promise.resolve(noCoins), COIN_WAIT_MS, noCoins) }, aspect, lengthS, onProgress),
      download: downloadBlob,
      log: (line) => console.log(line),
    });
    document.documentElement.dataset.month = 'ready';
    return () => {
      delete window.ccipRecord;
      delete document.documentElement.dataset.month;
    };
  }, [monthView, showInput, assets, stars]);

  const since = data?.replay.since ?? '';
```

In `site/src/replay/player.tsx`, replace:

```tsx
      const link = document.createElement('a');
      link.href = href;
      link.download = recordingFilename(lastDay, aspect, slug);
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 5_000);
```

with:

```tsx
      const link = document.createElement('a');
      link.href = href;
      link.download = monthView ? monthRecordingFilename(monthView.month.month, aspect) : recordingFilename(lastDay, aspect, slug);
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 5_000);
```

In `site/src/replay/player.tsx`, replace:

```tsx

  if (error) return <p className="card">{error}</p>;
  if (!data || !show) {
    if (!loadFailed) return null;
```

with:

```tsx

  if (error) return <p className="card">{error}</p>;
  if (noSuchMonth) {
    return (
      <p className="card" role="status">
        No such month. Pick one that is over, as <code>?m=2026-09</code>.
      </p>
    );
  }
  if (!data || !show) {
    if (!loadFailed) return null;
```

In `site/src/replay/player.tsx`, replace:

```tsx
      </div>
      <div className="studio">
        <ChainPicker chains={pickerChains} value={focus} onChange={chooseChain} disabled={recording !== null} />
        <Segmented
          label="Length"
```

with:

```tsx
      </div>
      <div className="studio">
        {!month && <ChainPicker chains={pickerChains} value={focus} onChange={chooseChain} disabled={recording !== null} />}
        <Segmented
          label="Length"
```

In `site/src/replay/player.tsx`, replace:

```tsx
        <ShapePicker value={aspect} onChange={setAspect} disabled={recording !== null} />
        <span className="spacer" />
        <ShareButton
          view={slug ? `replay/${slug}` : 'replay'}
          headline={focusName ? `Watch ${focusName} on Chainlink CCIP` : 'Watch CCIP grow from the first message to today'}
          url={pageUrl}
          cardUrl={`/og/replay${slug ? `/${slug}` : ''}.png`}
          disabled={recording !== null}
        />
        {recordable && !recording && (
          <button type="button" className="btn btn-primary" onClick={() => void record()}>
```

with:

```tsx
        <ShapePicker value={aspect} onChange={setAspect} disabled={recording !== null} />
        <span className="spacer" />
        {!month && (
          <ShareButton
            view={slug ? `replay/${slug}` : 'replay'}
            headline={focusName ? `Watch ${focusName} on Chainlink CCIP` : 'Watch CCIP grow from the first message to today'}
            url={pageUrl}
            cardUrl={`/og/replay${slug ? `/${slug}` : ''}.png`}
            disabled={recording !== null}
          />
        )}
        {recordable && !recording && (
          <button type="button" className="btn btn-primary" onClick={() => void record()}>
```

- [ ] **Step 5: Add the unlisted page.**

In `site/src/layouts/Base.astro`, replace:

```astro
  description: string;
  cardPath?: string | null;
}

const { title, description, cardPath = null } = Astro.props;
const fullTitle = title === 'ccip.dev' ? title : `${title} · ccip.dev`;
const canonical = new URL(Astro.url.pathname, SITE_URL).href;
```

with:

```astro
  description: string;
  cardPath?: string | null;
  /** Keeps an unlisted page out of search results. */
  noindex?: boolean;
}

const { title, description, cardPath = null, noindex = false } = Astro.props;
const fullTitle = title === 'ccip.dev' ? title : `${title} · ccip.dev`;
const canonical = new URL(Astro.url.pathname, SITE_URL).href;
```

In `site/src/layouts/Base.astro`, replace:

```astro
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <meta name="theme-color" content="#2f62df" />
    <meta name="color-scheme" content="dark" />
```

with:

```astro
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    {noindex && <meta name="robots" content="noindex" />}
    <meta name="theme-color" content="#2f62df" />
    <meta name="color-scheme" content="dark" />
```

In `site/src/components/ReplayPage.astro`, replace:

```astro
  focus: string | null;
  slugs: Record<string, string>;
}

const { focus, slugs } = Astro.props;
const [replay, history] = await Promise.all([buildData('replay.json'), buildData('history.json')]);
const last = lastReplayDay(replay) ?? '';
```

with:

```astro
  focus: string | null;
  slugs: Record<string, string>;
  /** The unlisted month page: the player plays the month in `?m=YYYY-MM`. */
  month?: boolean;
}

const { focus, slugs, month = false } = Astro.props;
const [replay, history] = await Promise.all([buildData('replay.json'), buildData('history.json')]);
const last = lastReplayDay(replay) ?? '';
```

In `site/src/components/ReplayPage.astro`, replace:

```astro
}
const head = replayHead({ focusName: name, firstDay: focusChain?.first_day ?? null, messages, chains });
const description = name
  ? `Watch ${name} on Chainlink CCIP: every lane and message since ${formatUtcDay(focusChain!.first_day)}, as a 30-second video.`
  : 'Watch CCIP grow: every chain and lane from 2023-07-06 to today in 30 seconds, recordable as a video.';
---
<Base title={name ? `${name} on Chainlink CCIP · Replay` : 'Replay'} description={description} cardPath={focusChain ? `replay/${slugs[focusChain.selector]}` : 'replay'}>
  <div class="page-head">
    <div>
      <p class="label">{replay.since} → {last}</p>
      <h1 id="replay-title">{head.title}</h1>
      <p id="replay-lead" class="muted">{head.lead}</p>
    </div>
  </div>
  <div class="replay-shell">
    <figure class="card poster" set:html={poster} />
    <ReplayPlayer client:only="react" focus={focus} slugs={slugs} />
  </div>
</Base>
```

with:

```astro
}
const head = replayHead({ focusName: name, firstDay: focusChain?.first_day ?? null, messages, chains });
const description = month
  ? 'One month of Chainlink CCIP, every chain and lane that moved, in 30 seconds.'
  : name
    ? `Watch ${name} on Chainlink CCIP: every lane and message since ${formatUtcDay(focusChain!.first_day)}, as a 30-second video.`
    : 'Watch CCIP grow: every chain and lane from 2023-07-06 to today in 30 seconds, recordable as a video.';
const pageTitle = month ? 'Month in review · Replay' : name ? `${name} on Chainlink CCIP · Replay` : 'Replay';
---
<Base title={pageTitle} description={description} cardPath={focusChain ? `replay/${slugs[focusChain.selector]}` : 'replay'} noindex={month}>
  <div class="page-head">
    <div>
      <p class="label">{month ? 'Month in review' : `${replay.since} → ${last}`}</p>
      <h1 id="replay-title">{month ? 'CCIP month in review' : head.title}</h1>
      <p id="replay-lead" class="muted">{month ? 'Every chain and lane that moved in one month, in 30 seconds.' : head.lead}</p>
    </div>
  </div>
  <div class="replay-shell">
    {!month && <figure class="card poster" set:html={poster} />}
    <ReplayPlayer client:only="react" focus={focus} slugs={slugs} month={month} />
  </div>
</Base>
```

Create `site/src/pages/replay/month.astro`:

```astro
---
import ReplayPage from '../../components/ReplayPage.astro';
---
<ReplayPage focus={null} slugs={{}} month />
```

- [ ] **Step 6: Run the site tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/site test && pnpm typecheck`
Expected: PASS, the 15 pin digests included.

- [ ] **Step 7: Build the site and check the page.**

Run: `pnpm --filter @ccip-dev/site build && grep -c 'name="robots" content="noindex"' site/dist/replay/month/index.html && ! grep -q 'name="robots"' site/dist/replay/index.html`
Expected: the build passes its own checks (`check-build: … pages OK`, both budgets), then `1`; the all-time page has no robots tag.

- [ ] **Step 8: Commit.**

```bash
git add site/src/pages/replay/month.astro site/src/replay/wav.ts site/src/replay/record-hook.ts site/src/replay/record-cut.ts site/src/replay/recorder.ts site/src/replay/player.tsx site/src/layouts/Base.astro site/src/components/ReplayPage.astro site/test/record-hook.test.ts site/test/recorder.test.ts
git commit -m "feat(site): the unlisted month page and window.ccipRecord, which hands over the silent video and a WAV soundtrack" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: The recording workflow: record, mux, check, upload

**Files:**
- Create: `scripts/video/monthly.ts`, `scripts/video/check.ts`
- Modify: `package.json` (`video:monthly`, `video:check`), `.github/workflows/monthly-video.yml` (the whole recording)
- Test: `scripts/test/monthly-video.test.ts`

**Interfaces:**
- Consumes: Task 1 (`launchChrome`, `probePage`, `probeProblems`, the smoke job); Task 2 (`isMonth`, `previousMonth`, `MONTHLY_VIDEO`); Task 5 (`/replay/month/?m=`, `window.ccipRecord`, `dataset.month`).
- Produces:
  - `scripts/video/check.ts`: `interface ProbeStream { codec_type?; codec_name?; width?; height?; pix_fmt? }`, `interface Probe { streams?: ProbeStream[]; format?: { duration?: string; size?: string } }`, `DURATION_S = { min: 29.5, max: 30.5 }`, `videoProblems(probe: Probe): string[]`; `pnpm video:check FILE` exits 1 with the reasons.
  - `scripts/video/monthly.ts`: `RECORDED_FILES = ['video.mp4', 'audio.wav']`, `pickMonth(arg: string | undefined, now: Date): string`, `monthPageUrl(base: string, month: string): string`; `pnpm video:monthly --month YYYY-MM [--base URL] [--out DIR]` saves `video.mp4` and `audio.wav` in `DIR` (default `out/video`).
  - `.github/workflows/monthly-video.yml`: the `record` job (smoke, record, mux, check, attach) and the `upload` job (`environment: production`, skipped on `dry_run`).

- [ ] **Step 1: Write the failing tests.**

In `scripts/test/monthly-video.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { probeProblems } from '../video/browser';

describe('probeProblems', () => {
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { probeProblems } from '../video/browser';
import { videoProblems, type Probe } from '../video/check';
import { monthPageUrl, pickMonth } from '../video/monthly';

describe('probeProblems', () => {
```

In `scripts/test/monthly-video.test.ts`, replace:

```ts
  });
});
```

with:

```ts
  });
});

const GOOD: Probe = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1080, pix_fmt: 'yuv420p' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '30.000000', size: '30123456' },
};

describe('videoProblems', () => {
  it('passes a 30 s 1080×1080 H.264 video with AAC sound under 50 MB', () => {
    expect(videoProblems(GOOD)).toEqual([]);
  });

  it('names every way a video can be wrong', () => {
    // #given a long, small, VP9, silent, 4:4:4 video over 50 MB
    const bad: Probe = { streams: [{ codec_type: 'video', codec_name: 'vp9', width: 720, height: 720, pix_fmt: 'yuv444p' }], format: { duration: '31.2', size: '52000000' } };
    // #then
    expect(videoProblems(bad)).toEqual([
      'it lasts 31.2 s, not 29.5–30.5 s',
      'its video is 720×720, not 1080×1080',
      'its video is vp9, not H.264',
      'its pixels are yuv444p, not 4:2:0',
      'it has no audio',
      'it is 52000000 bytes, not under 50 MB',
    ]);
  });

  it('fails an empty probe, as ffprobe gives for a file that is not a video', () => {
    expect(videoProblems({})).toEqual(['it lasts no s, not 29.5–30.5 s', 'it has no video', 'it has no audio', 'it is of no bytes, not under 50 MB']);
  });

  it('accepts 29.5 and 30.5 s, and a full-range 4:2:0 video', () => {
    const at = (duration: string, pix_fmt = 'yuv420p'): Probe => ({ ...GOOD, streams: [{ ...GOOD.streams![0]!, pix_fmt }, GOOD.streams![1]!], format: { ...GOOD.format, duration } });
    expect([at('29.5'), at('30.5'), at('30', 'yuvj420p')].map(videoProblems)).toEqual([[], [], []]);
  });
});

describe('pickMonth', () => {
  it('records the month asked for, or the month before today', () => {
    expect([pickMonth('2026-09', new Date('2026-12-05T00:00:00Z')), pickMonth(undefined, new Date('2026-10-01T01:15:00Z')), pickMonth(undefined, new Date('2027-01-01T01:15:00Z'))]).toEqual([
      '2026-09', '2026-09', '2026-12',
    ]);
  });

  it('refuses a month that is not YYYY-MM', () => {
    expect(() => pickMonth('2026-9', new Date())).toThrow('--month must be YYYY-MM, not 2026-9');
  });
});

describe('monthPageUrl', () => {
  it('opens the unlisted month page on the base, with or without a trailing slash', () => {
    expect([monthPageUrl('https://ccip.dev', '2026-09'), monthPageUrl('http://localhost:4321/', '2026-09')]).toEqual([
      'https://ccip.dev/replay/month/?m=2026-09', 'http://localhost:4321/replay/month/?m=2026-09',
    ]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm exec vitest run scripts/test/monthly-video.test.ts`
Expected: FAIL: `../video/check` and `../video/monthly` do not exist.

- [ ] **Step 3: Add the check and the recording script.**

Create `scripts/video/check.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { MONTHLY_VIDEO } from '@ccip-dev/core/month';

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
}

/** ffprobe's JSON for `-show_entries format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt`. */
export interface Probe {
  streams?: ProbeStream[];
  format?: { duration?: string; size?: string };
}

export const DURATION_S = { min: 29.5, max: 30.5 } as const;
/** X takes only 4:2:0 video; Chrome writes yuv420p on Linux and yuvj420p (full range) on a Mac. */
const PIXEL_FORMATS = ['yuv420p', 'yuvj420p'];

/** Why the muxed video must not be uploaded; empty when it may. */
export function videoProblems(probe: Probe): string[] {
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  const audio = probe.streams?.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format?.duration);
  const size = Number(probe.format?.size);
  const problems: string[] = [];
  if (!(duration >= DURATION_S.min && duration <= DURATION_S.max)) problems.push(`it lasts ${probe.format?.duration ?? 'no'} s, not ${DURATION_S.min}–${DURATION_S.max} s`);
  if (!video) problems.push('it has no video');
  else {
    if (video.width !== MONTHLY_VIDEO.width || video.height !== MONTHLY_VIDEO.height) problems.push(`its video is ${video.width}×${video.height}, not ${MONTHLY_VIDEO.width}×${MONTHLY_VIDEO.height}`);
    if (video.codec_name !== 'h264') problems.push(`its video is ${video.codec_name ?? 'of no codec'}, not H.264`);
    if (!PIXEL_FORMATS.includes(video.pix_fmt ?? '')) problems.push(`its pixels are ${video.pix_fmt ?? 'of no format'}, not 4:2:0`);
  }
  if (audio?.codec_name !== 'aac') problems.push(audio ? `its audio is ${audio.codec_name ?? 'of no codec'}, not AAC` : 'it has no audio');
  if (!(size > 0 && size < MONTHLY_VIDEO.maxBytes)) problems.push(`it is ${probe.format?.size ?? 'of no'} bytes, not under ${MONTHLY_VIDEO.maxBytes / 1_000_000} MB`);
  return problems;
}

/** `pnpm video:check <file>`: fails the workflow, so nothing is uploaded, unless the file is the video the Worker may post. */
function main(file: string | undefined): void {
  if (!file) throw new Error('usage: pnpm video:check <file.mp4>');
  const json = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', file], { encoding: 'utf8' });
  const problems = videoProblems(JSON.parse(json) as Probe);
  if (problems.length > 0) {
    console.error(`${file} is not a valid monthly video: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log(`${file} is valid: ${json.replace(/\s+/g, ' ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv[2]);
```

`monthly.ts` probes Chrome on the page itself, waits for the page to say `ready` or `missing`, calls the hook (no timeout of its own: the job has 30 minutes) and saves the two downloads.

Create `scripts/video/monthly.ts`:

```ts
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Download } from 'playwright';
import { isMonth, previousMonth } from '@ccip-dev/core/month';
import { launchChrome, probePage, probeProblems } from './browser';

const READY_TIMEOUT_MS = 120_000;
const DOWNLOAD_WAIT_MS = 30_000;
export const RECORDED_FILES = ['video.mp4', 'audio.wav'] as const;

/** The month to record: `--month`, or the month before `now`'s (UTC). */
export function pickMonth(arg: string | undefined, now: Date): string {
  const month = arg ? arg : previousMonth(now.toISOString().slice(0, 7));
  if (!isMonth(month)) throw new Error(`--month must be YYYY-MM, not ${month}`);
  return month;
}

export function monthPageUrl(base: string, month: string): string {
  return `${base.replace(/\/+$/, '')}/replay/month/?m=${month}`;
}

/** `pnpm video:monthly --month YYYY-MM`: records the month page's cut in Chrome and saves video.mp4 and audio.wav to `--out`. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { month: { type: 'string' }, base: { type: 'string', default: 'https://ccip.dev' }, out: { type: 'string', default: 'out/video' } } });
  const month = pickMonth(values.month, new Date());
  const out = path.resolve(values.out);
  await mkdir(out, { recursive: true });
  const browser = await launchChrome();
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.on('console', (m) => console.log(`[page] ${m.text()}`));
    const downloads: Download[] = [];
    page.on('download', (d) => downloads.push(d));
    const url = monthPageUrl(values.base, month);
    console.log(`Recording ${url} in Chrome ${browser.version()}`);
    await page.goto(url, { waitUntil: 'load' });
    const problems = probeProblems(await probePage(page));
    if (problems.length > 0) throw new Error(`Chrome cannot record the monthly video: ${problems.join('; ')}`);
    await page.waitForFunction(() => document.documentElement.dataset.month !== undefined, undefined, { timeout: READY_TIMEOUT_MS });
    if ((await page.evaluate(() => document.documentElement.dataset.month)) !== 'ready') {
      throw new Error(`${url} shows no such month: the month is not over, or its last day is not finalized yet`);
    }
    const started = Date.now();
    await page.evaluate(() => (window as unknown as { ccipRecord: (r: { aspect: string; length: number }) => Promise<unknown> }).ccipRecord({ aspect: '1:1', length: 30 }));
    for (const deadline = Date.now() + DOWNLOAD_WAIT_MS; downloads.length < RECORDED_FILES.length && Date.now() < deadline; ) await new Promise((r) => setTimeout(r, 200));
    const names = downloads.map((d) => d.suggestedFilename());
    if (!RECORDED_FILES.every((f) => names.includes(f))) throw new Error(`the page handed over ${names.join(', ') || 'nothing'}, not ${RECORDED_FILES.join(' and ')}`);
    for (const d of downloads) await d.saveAs(path.join(out, d.suggestedFilename()));
    console.log(`Recorded ${month} in ${Math.round((Date.now() - started) / 1000)} s: ${RECORDED_FILES.map((f) => path.join(out, f)).join(', ')}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
```

In `package.json`, replace:

```json
    "report:day": "tsx scripts/day-report.ts",
    "report:top-senders": "tsx scripts/top-senders.ts",
    "video:smoke": "tsx scripts/video/smoke.ts"
  },
  "devDependencies": {
```

with:

```json
    "report:day": "tsx scripts/day-report.ts",
    "report:top-senders": "tsx scripts/top-senders.ts",
    "video:smoke": "tsx scripts/video/smoke.ts",
    "video:monthly": "tsx scripts/video/monthly.ts",
    "video:check": "tsx scripts/video/check.ts"
  },
  "devDependencies": {
```

- [ ] **Step 4: Grow the workflow into the monthly recording.**

The `record` job holds no secret. It picks the month (the input, or the month before today in UTC, checked as `YYYY-MM` through an environment variable, never interpolated into the script), runs the smoke, records, muxes with the spec's ffmpeg flags, checks, and attaches the MP4 for 7 days. The `upload` job runs only without `dry_run` (on the schedule, `inputs.dry_run` is empty, so it runs), in the `production` environment where `CF_DEPLOY_TOKEN` lives. Replace the whole file:

Create `.github/workflows/monthly-video.yml`:

```yaml
name: monthly-video
on:
  schedule:
    - cron: '15 1 1 * *'
  workflow_dispatch:
    inputs:
      month:
        description: 'Month to record, as YYYY-MM (empty: last month)'
        required: false
        default: ''
      dry_run:
        description: 'Attach the video to the run without uploading it'
        type: boolean
        default: false
permissions:
  contents: read
concurrency: monthly-video
jobs:
  record:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    outputs:
      month: ${{ steps.month.outputs.month }}
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Pick the month
        id: month
        env:
          INPUT_MONTH: ${{ inputs.month }}
        run: |
          set -euo pipefail
          month="${INPUT_MONTH:-$(date -u -d "$(date -u +%Y-%m-01) -1 day" +%Y-%m)}"
          if ! [[ "${month}" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]]; then
            echo "month must be YYYY-MM, not ${month}"
            exit 1
          fi
          echo "month=${month}" >> "${GITHUB_OUTPUT}"
      - name: Install Chrome stable and ffmpeg
        run: |
          set -euo pipefail
          pnpm exec playwright install --with-deps chrome
          sudo apt-get install -y -qq ffmpeg
      - name: Check Chrome can record
        run: pnpm video:smoke
      - name: Record the month
        env:
          MONTH: ${{ steps.month.outputs.month }}
        run: pnpm video:monthly --month "${MONTH}" --out out/video
      - name: Mux the soundtrack
        env:
          MONTH: ${{ steps.month.outputs.month }}
        run: ffmpeg -y -v error -i out/video/video.mp4 -i out/video/audio.wav -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "out/video/${MONTH}.mp4"
      - name: Check the video
        env:
          MONTH: ${{ steps.month.outputs.month }}
        run: pnpm video:check "out/video/${MONTH}.mp4"
      - uses: actions/upload-artifact@v7
        with:
          name: monthly-video-${{ steps.month.outputs.month }}
          path: out/video/${{ steps.month.outputs.month }}.mp4
          retention-days: 7
          if-no-files-found: error
  upload:
    needs: record
    if: ${{ !inputs.dry_run }}
    runs-on: ubuntu-24.04
    environment: production
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@v8
        with:
          name: monthly-video-${{ needs.record.outputs.month }}
          path: out/video
      - name: Upload to the archive bucket
        env:
          MONTH: ${{ needs.record.outputs.month }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
        run: pnpm --filter @ccip-dev/worker exec wrangler r2 object put "ccip-dev-archive/videos/monthly/${MONTH}.mp4" --file "${GITHUB_WORKSPACE}/out/video/${MONTH}.mp4" --content-type video/mp4 --remote
```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `pnpm exec vitest run scripts/test/monthly-video.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add scripts/video/monthly.ts scripts/video/check.ts scripts/test/monthly-video.test.ts package.json .github/workflows/monthly-video.yml
git commit -m "ci: record the month page in headless Chrome on the 1st, mux the sound, check the file and upload it to the archive bucket" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

- [ ] **Step 7: Record September on this machine (not committed).**

This runs the whole recording against the site built in Task 5 Step 7, as the workflow will on the runner. It takes 3 to 4 minutes on a recent Mac (about 5.5 on the runner).

1. Serve the build in the background: `python3 -m http.server 4329 --bind 127.0.0.1 --directory site/dist` (any static server will do).
2. Run: `pnpm video:monthly --month 2026-09 --base http://127.0.0.1:4329 --out <scratch>/video`. Expected: `Recording http://127.0.0.1:4329/replay/month/?m=2026-09 in Chrome …`, the page's `ccipRecord: 0%` to `100%`, then `Recorded 2026-09 in … s: <scratch>/video/video.mp4, <scratch>/video/audio.wav`.
3. Run: `ffmpeg -y -v error -i <scratch>/video/video.mp4 -i <scratch>/video/audio.wav -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart <scratch>/video/2026-09.mp4 && pnpm video:check <scratch>/video/2026-09.mp4`. Expected: `… is valid: …`, a duration of `30.000000`, about 30 MB.
4. Check that a month that is not over fails without a file: `pnpm video:monthly --month $(date -u +%Y-%m) --base http://127.0.0.1:4329 --out <scratch>/current` (the current month). Expected: exit code 1 and `… shows no such month: the month is not over, or its last day is not finalized yet`.
5. Grab frames: `for t in 1 10 27.5 29.4; do ffmpeg -v error -y -ss $t -i <scratch>/video/2026-09.mp4 -frames:v 1 -vf scale=540:540 <scratch>/video/f-$t.png; done`, and open each PNG with the Read tool. Expected: at 1 s the title "CCIP · September 2026" over the sky; at 10 s the date, the value counter, "… messages · N chains", the fees counter "$… in fees" under it, and the leaderboard strip; at 27.5 s the end card under the particle title, its first row's value the same as the counter's; at 29.4 s the "ccip.dev" title above the end card. Report any overlap or cut-off text. Stop the server afterwards; commit nothing.

---

### Task 7: Telegram `sendVideo` and X's chunked video upload

**Files:**
- Modify: `worker/src/telegram.ts` (`sendTelegramVideo`), `worker/src/x.ts` (`uploadVideo`; `signedPost` becomes `signedRequest`, for the status GET)
- Test: `worker/test/telegram.test.ts`, `worker/test/x.test.ts`

**Interfaces:**
- Consumes (live code): `TelegramConfig`, `withRetryAfter`, `description`, `failedRequest`, `Deps` (`telegram.ts`); `oauth1Header`, `freshNonce`, `detail`, `secondsUntilReset`, `idOf`, `XCredentials`, `XProblem`, `X_TIMEOUT_MS` (`x.ts`).
- Produces:
  - `telegram.ts`: `TELEGRAM_VIDEO_TIMEOUT_MS = 120_000`, `interface TelegramVideo { video: Blob; filename: string; caption: string; parseMode?: 'HTML'; width: number; height: number; durationS: number }`, `sendTelegramVideo(deps: Pick<Deps, 'fetch' | 'sleep'>, config: TelegramConfig, msg: TelegramVideo, timeoutMs?): Promise<string | null>` (null, or what went wrong).
  - `x.ts`: `X_VIDEO_CHUNK_BYTES = 4 * 1024 * 1024`, `X_PROCESSING_WAIT_S = 120`, `uploadVideo(deps: XDeps, creds: XCredentials, mp4: Blob, timeoutMs?): Promise<{ mediaId: string } | XProblem>`. Each problem names its step (`initialize`, `append <n>`, `finalize`, `status`); a timeout, a network error or a 5xx is `outage: true`; still processing after 120 s, or processing that failed, is `outage: false`.

- [ ] **Step 1: Write the failing tests.**

In `worker/test/telegram.test.ts`, replace:

```ts
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { sendTelegramPhoto, sendTelegramPoll, stopTelegramPoll } from '../src/telegram';

const CONFIG = { token: 'secret-token', chatId: '@ccipdev' };
```

with:

```ts
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { sendTelegramPhoto, sendTelegramPoll, sendTelegramVideo, stopTelegramPoll } from '../src/telegram';

const CONFIG = { token: 'secret-token', chatId: '@ccipdev' };
```

In `worker/test/telegram.test.ts`, replace:

```ts
    ]);
  });
});
```

with:

```ts
    ]);
  });
});

describe('sendTelegramVideo', () => {
  const MP4 = new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], { type: 'video/mp4' });
  const VIDEO = { video: MP4, filename: 'ccip-2026-09.mp4', caption: '<b>CCIP in September 2026</b>', parseMode: 'HTML' as const, width: 1080, height: 1080, durationS: 30 };
  const fields = async (init?: RequestInit) => {
    const form = init?.body as FormData;
    const video = form.get('video') as File;
    return {
      chat_id: form.get('chat_id'), caption: form.get('caption'), parse_mode: form.get('parse_mode'), width: form.get('width'), height: form.get('height'),
      duration: form.get('duration'), supports_streaming: form.get('supports_streaming'), filename: video.name, bytes: video.size,
    };
  };

  it('uploads the video as multipart with its caption, size, duration and streaming flag', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: true, result: { message_id: 5 } }));
    // #when
    const failure = await sendTelegramVideo({ fetch, sleep: async () => {} }, CONFIG, VIDEO);
    // #then
    expect({ failure, url: fetch.calls[0]?.url, body: await fields(fetch.calls[0]?.init) }).toEqual({
      failure: null,
      url: 'https://api.telegram.org/botsecret-token/sendVideo',
      body: {
        chat_id: '@ccipdev', caption: '<b>CCIP in September 2026</b>', parse_mode: 'HTML', width: '1080', height: '1080', duration: '30', supports_streaming: 'true',
        filename: 'ccip-2026-09.mp4', bytes: 8,
      },
    });
  });

  it("re-sends the whole video once after a 429, and names Telegram's refusal but not the token", async () => {
    // #given
    let calls = 0;
    const retried = fakeFetch(() => (++calls === 1 ? jsonResponse({ ok: false, parameters: { retry_after: 2 } }, 429) : jsonResponse({ ok: true, result: {} })));
    const refused = fakeFetch(() => jsonResponse({ ok: false, description: 'Request Entity Too Large' }, 413));
    const sleep = vi.fn(async () => {});
    // #when
    const results = [await sendTelegramVideo({ fetch: retried, sleep }, CONFIG, VIDEO), await sendTelegramVideo({ fetch: refused, sleep }, CONFIG, VIDEO)];
    // #then
    expect({ results, waits: sleep.mock.calls, second: await fields(retried.calls[1]?.init) }).toEqual({
      results: [null, 'Telegram returned HTTP 413: Request Entity Too Large'],
      waits: [[2000]],
      second: expect.objectContaining({ filename: 'ccip-2026-09.mp4', bytes: 8 }),
    });
  });
});
```

In `worker/test/x.test.ts`, replace:

```ts
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { createPost, oauth1Header, uploadImage, X_RETRY_CAP_S, type XCredentials } from '../src/x';

const CREDS: XCredentials = { apiKey: 'api-key-1', apiSecret: 'api-secret-2', accessToken: 'access-token-3', accessSecret: 'access-secret-4' };
```

with:

```ts
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { createPost, oauth1Header, uploadImage, uploadVideo, X_PROCESSING_WAIT_S, X_RETRY_CAP_S, X_VIDEO_CHUNK_BYTES, type XCredentials } from '../src/x';

const CREDS: XCredentials = { apiKey: 'api-key-1', apiSecret: 'api-secret-2', accessToken: 'access-token-3', accessSecret: 'access-secret-4' };
```

In `worker/test/x.test.ts`, replace:

```ts
    expect({ calls: fetch.calls.length, result }).toEqual({ calls: 2, result: { problem: 'X returned HTTP 429', outage: false } });
  });
});
```

with:

```ts
    expect({ calls: fetch.calls.length, result }).toEqual({ calls: 2, result: { problem: 'X returned HTTP 429', outage: false } });
  });
});

describe('uploadVideo', () => {
  /** 9 MB: two full 4 MB segments and a 1 MB one. */
  const MP4 = new Blob([new Uint8Array(2 * X_VIDEO_CHUNK_BYTES + 1024 * 1024)], { type: 'video/mp4' });
  const UPLOAD = 'https://api.x.com/2/media/upload';
  const processing = (state: string, check_after_secs?: number, error?: string) => ({ data: { id: '77', processing_info: { state, check_after_secs, ...(error ? { error: { message: error } } : {}) } } });

  /** X's answers to each step; `status` answers the STATUS polls in turn, its last answer repeating. */
  function xVideo(o: { finalize?: unknown; status?: unknown[]; append?: Response } = {}) {
    let polls = 0;
    return fakeFetch((url) => {
      if (url === `${UPLOAD}/initialize`) return jsonResponse({ data: { id: '77', media_key: '7_77', expires_after_secs: 86_400 } });
      if (url === `${UPLOAD}/77/append`) return o.append?.clone() ?? jsonResponse({ data: { expires_at: 1 } });
      if (url === `${UPLOAD}/77/finalize`) return jsonResponse(o.finalize ?? processing('pending', 5));
      if (url === `${UPLOAD}?command=STATUS&media_id=77`) {
        const answers = o.status ?? [processing('succeeded')];
        return jsonResponse(answers[Math.min(polls++, answers.length - 1)]);
      }
      return undefined;
    });
  }

  it('initializes a tweet_video, appends it in 4 MB segments, finalizes, waits for processing and returns its id', async () => {
    // #given
    const fetch = xVideo({ status: [processing('in_progress', 10), processing('succeeded')] });
    const sleep = vi.fn(async () => {});
    // #when
    const result = await uploadVideo(deps(fetch, sleep), CREDS, MP4);
    // #then
    const appends = fetch.calls.filter((c) => c.url.endsWith('/append')).map((c) => c.init?.body as FormData);
    expect({
      result,
      steps: fetch.calls.map((c) => `${c.init?.method} ${c.url.slice(UPLOAD.length)}`),
      init: JSON.parse(String(fetch.calls[0]?.init?.body)),
      segments: appends.map((f) => [f.get('segment_index'), (f.get('media') as Blob).size]),
      signed: fetch.calls.every((c) => authOf(c.init).startsWith('OAuth ')),
      waits: sleep.mock.calls,
    }).toEqual({
      result: { mediaId: '77' },
      steps: ['POST /initialize', 'POST /77/append', 'POST /77/append', 'POST /77/append', 'POST /77/finalize', 'GET ?command=STATUS&media_id=77', 'GET ?command=STATUS&media_id=77'],
      init: { media_type: 'video/mp4', total_bytes: MP4.size, media_category: 'tweet_video' },
      segments: [['0', X_VIDEO_CHUNK_BYTES], ['1', X_VIDEO_CHUNK_BYTES], ['2', 1024 * 1024]],
      signed: true,
      waits: [[5000], [10_000]],
    });
  });

  it('takes a finalize without processing info as ready', async () => {
    // #given
    const fetch = xVideo({ finalize: { data: { id: '77' } } });
    // #when
    const result = await uploadVideo(deps(fetch), CREDS, MP4);
    // #then
    expect({ result, polled: fetch.calls.some((c) => c.url.includes('STATUS')) }).toEqual({ result: { mediaId: '77' }, polled: false });
  });

  it(`gives up after ${X_PROCESSING_WAIT_S} s of processing, and on processing that failed, neither an outage`, async () => {
    // #given
    const slow = xVideo({ status: [processing('in_progress', 50)] });
    const broken = xVideo({ status: [processing('failed', undefined, 'Unsupported video format')] });
    const sleep = vi.fn(async () => {});
    // #when
    const results = [await uploadVideo(deps(slow, sleep), CREDS, MP4), await uploadVideo(deps(broken), CREDS, MP4)];
    // #then 5 s, then 50, 50 and the last 15 s of the 2 minutes
    expect({ results, waits: sleep.mock.calls.flat() }).toEqual({
      results: [
        { problem: 'X was still processing the video after 120 s', outage: false },
        { problem: 'X could not process the video: Unsupported video format', outage: false },
      ],
      waits: [5000, 50_000, 50_000, 15_000],
    });
  });

  it('names the step that failed, and calls a 5xx an outage', async () => {
    // #given
    const fetch = xVideo({ append: jsonResponse({ title: 'Service Unavailable' }, 503) });
    // #when
    const result = await uploadVideo(deps(fetch), CREDS, MP4);
    // #then nothing after the failed segment is sent
    expect({ result, calls: fetch.calls.length }).toEqual({ result: { problem: 'append 0: X returned HTTP 503: Service Unavailable', outage: true }, calls: 2 });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/telegram.test.ts test/x.test.ts`
Expected: FAIL: `sendTelegramVideo` and `uploadVideo` are not exported.

- [ ] **Step 3: Add `sendTelegramVideo`.**

Checked against the Bot API (see "Decisions"): a multipart `sendVideo` with `chat_id`, `caption`, `parse_mode`, `width`, `height`, `duration`, `supports_streaming` and the file as `video`, at most 50 MB.

In `worker/src/telegram.ts`, replace:

```ts
    form.append('photo', new Blob([msg.photo], { type: 'image/png' }), 'card.png');
    return deps.fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  };
  try {
```

with:

```ts
    form.append('photo', new Blob([msg.photo], { type: 'image/png' }), 'card.png');
    return deps.fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  };
  try {
    const res = await withRetryAfter(deps, post);
    return res.ok ? null : `Telegram returned HTTP ${res.status}${await description(res)}`;
  } catch (error) {
    return failedRequest(error);
  }
}

/** A 30 MB upload gets longer than a card: Telegram must take it all before it answers. */
export const TELEGRAM_VIDEO_TIMEOUT_MS = 120_000;

export interface TelegramVideo {
  video: Blob;
  filename: string;
  caption: string;
  parseMode?: 'HTML';
  width: number;
  height: number;
  durationS: number;
}

/**
 * Uploads an MP4 that plays inline (Bot API sendVideo, multipart, at most 50 MB), with sendTelegramPhoto's 429 retry.
 * Returns null, or what went wrong.
 */
export async function sendTelegramVideo(
  deps: Pick<Deps, 'fetch' | 'sleep'>,
  { token, chatId }: TelegramConfig,
  msg: TelegramVideo,
  timeoutMs = TELEGRAM_VIDEO_TIMEOUT_MS,
): Promise<string | null> {
  const post = () => {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', msg.caption);
    if (msg.parseMode) form.append('parse_mode', msg.parseMode);
    form.append('width', String(msg.width));
    form.append('height', String(msg.height));
    form.append('duration', String(msg.durationS));
    form.append('supports_streaming', 'true');
    form.append('video', msg.video, msg.filename);
    return deps.fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  };
  try {
```

- [ ] **Step 4: Add `uploadVideo`.**

Checked against docs.x.com (see "Decisions"). `signedPost` becomes `signedRequest`, so the status poll is a signed GET (its query is part of the OAuth signature, which `oauth1Header` already handles); `signedPost` stays as a one-line wrapper, so `uploadImage` and `createPost` are unchanged.

In `worker/src/x.ts`, replace:

```ts

/**
 * A signed POST. `request` runs per attempt because a retry must re-send the whole body, and each attempt gets its own nonce.
 * A 429 is retried once when x-rate-limit-reset is at most 30 s away; with a later reset or none it is given up at once. Returns the response
 * body of a 2xx, or what went wrong. The problem text never holds a key, the Authorization header or the URL.
 */
async function signedPost(
  deps: XDeps,
  creds: XCredentials,
  path: string,
  request: () => { body: BodyInit; headers?: Record<string, string> },
  timeoutMs: number,
): Promise<{ json: unknown } | (XProblem & { duplicate: boolean })> {
```

with:

```ts

/**
 * A signed request. `request` runs per attempt because a retry must re-send the whole body, and each attempt gets its own nonce.
 * A 429 is retried once when x-rate-limit-reset is at most 30 s away; with a later reset or none it is given up at once. Returns the response
 * body of a 2xx, or what went wrong. The problem text never holds a key, the Authorization header or the URL.
 */
async function signedRequest(
  deps: XDeps,
  creds: XCredentials,
  method: 'GET' | 'POST',
  path: string,
  request: () => { body: BodyInit | null; headers?: Record<string, string> },
  timeoutMs: number,
): Promise<{ json: unknown } | (XProblem & { duplicate: boolean })> {
```

In `worker/src/x.ts`, replace:

```ts
  const attempt = async () => {
    const { body, headers } = request();
    const authorization = await oauth1Header('POST', url, creds, { nonce: freshNonce(), timestamp: String(Math.floor(deps.clock() / 1000)) });
    return deps.fetch(url, { method: 'POST', headers: { ...headers, authorization }, body, signal: AbortSignal.timeout(timeoutMs) });
  };
  try {
```

with:

```ts
  const attempt = async () => {
    const { body, headers } = request();
    const authorization = await oauth1Header(method, url, creds, { nonce: freshNonce(), timestamp: String(Math.floor(deps.clock() / 1000)) });
    return deps.fetch(url, { method, headers: { ...headers, authorization }, body, signal: AbortSignal.timeout(timeoutMs) });
  };
  try {
```

In `worker/src/x.ts`, replace:

```ts
  }
}

/** Ids are strings only: a 19-digit JSON number has already lost precision. */
```

with:

```ts
  }
}

const signedPost = (deps: XDeps, creds: XCredentials, path: string, request: () => { body: BodyInit | null; headers?: Record<string, string> }, timeoutMs: number) =>
  signedRequest(deps, creds, 'POST', path, request, timeoutMs);

/** Ids are strings only: a 19-digit JSON number has already lost precision. */
```

In `worker/src/x.ts`, replace:

```ts
  const mediaId = idOf(json.data?.id) ?? idOf(json.id) ?? idOf(json.media_id_string);
  return mediaId === null ? { problem: 'X accepted the upload but sent no media id', outage: false } : { mediaId };
}

```

with:

```ts
  const mediaId = idOf(json.data?.id) ?? idOf(json.id) ?? idOf(json.media_id_string);
  return mediaId === null ? { problem: 'X accepted the upload but sent no media id', outage: false } : { mediaId };
}

/** X takes appended segments of at most 5 MB; 4 MB leaves room for the multipart envelope. */
export const X_VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;
/** How long one run waits for X to process a video; past it the post fails and the next hourly run uploads it again. */
export const X_PROCESSING_WAIT_S = 120;

type Processing = { state?: unknown; check_after_secs?: unknown; error?: { message?: unknown } } | undefined;
const processingOf = (json: unknown): Processing => (json as { data?: { processing_info?: Processing } } | null)?.data?.processing_info;
const stillProcessing = (info: Processing) => info?.state === 'pending' || info?.state === 'in_progress';

/**
 * Uploads an MP4 for a post with X's v2 chunked upload: initialize (tweet_video), append it in 4 MB segments, finalize,
 * then poll the processing status for up to 2 minutes. Each failure names its step; a timeout, a network error or a 5xx
 * is an outage. Still processing, or processing that failed, is a problem but not an outage.
 */
export async function uploadVideo(deps: XDeps, creds: XCredentials, mp4: Blob, timeoutMs = X_TIMEOUT_MS): Promise<{ mediaId: string } | XProblem> {
  const started = await signedPost(
    deps,
    creds,
    '/media/upload/initialize',
    () => ({ body: JSON.stringify({ media_type: 'video/mp4', total_bytes: mp4.size, media_category: 'tweet_video' }), headers: { 'content-type': 'application/json' } }),
    timeoutMs,
  );
  if ('problem' in started) return { problem: `initialize: ${started.problem}`, outage: started.outage };
  const mediaId = idOf((started.json as { data?: { id?: unknown } } | null)?.data?.id);
  if (mediaId === null) return { problem: 'X started the upload but sent no media id', outage: false };
  for (let segment = 0; segment * X_VIDEO_CHUNK_BYTES < mp4.size; segment++) {
    const chunk = mp4.slice(segment * X_VIDEO_CHUNK_BYTES, (segment + 1) * X_VIDEO_CHUNK_BYTES);
    const appended = await signedPost(
      deps,
      creds,
      `/media/upload/${mediaId}/append`,
      () => {
        const form = new FormData();
        form.append('segment_index', String(segment));
        form.append('media', chunk, 'video.mp4');
        return { body: form };
      },
      timeoutMs,
    );
    if ('problem' in appended) return { problem: `append ${segment}: ${appended.problem}`, outage: appended.outage };
  }
  const finalized = await signedPost(deps, creds, `/media/upload/${mediaId}/finalize`, () => ({ body: null }), timeoutMs);
  if ('problem' in finalized) return { problem: `finalize: ${finalized.problem}`, outage: finalized.outage };
  let info = processingOf(finalized.json);
  let waited = 0;
  while (stillProcessing(info)) {
    if (waited >= X_PROCESSING_WAIT_S) return { problem: `X was still processing the video after ${waited} s`, outage: false };
    const wait = Math.min(Math.max(1, Number(info?.check_after_secs) || 1), X_PROCESSING_WAIT_S - waited);
    await deps.sleep(wait * 1000);
    waited += wait;
    const status = await signedRequest(deps, creds, 'GET', `/media/upload?command=STATUS&media_id=${mediaId}`, () => ({ body: null }), timeoutMs);
    if ('problem' in status) return { problem: `status: ${status.problem}`, outage: status.outage };
    info = processingOf(status.json);
  }
  if (info?.state === 'failed') {
    const why = typeof info.error?.message === 'string' ? `: ${info.error.message.slice(0, 200)}` : '';
    return { problem: `X could not process the video${why}`, outage: false };
  }
  return { mediaId };
}

```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/telegram.test.ts test/x.test.ts && pnpm typecheck`
Expected: PASS, the existing photo, poll, OAuth, image upload, post and 429 tests included.

- [ ] **Step 6: Commit.**

```bash
git add worker/src/telegram.ts worker/src/x.ts worker/test/telegram.test.ts worker/test/x.test.ts
git commit -m "feat(worker): Telegram sendVideo, and X's v2 chunked video upload with its processing poll" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 8: Monthly facts and copy

**Files:**
- Create: `worker/src/broadcasts/monthly.ts`, `worker/src/broadcasts/monthly-copy.ts`
- Test: `worker/test/monthly-facts.test.ts` (real D1 and R2), `worker/test/monthly-copy.test.ts`

**Interfaces:**
- Consumes: Task 2 (`monthBounds`, `monthSummary`, `type MonthSummary`, `formatUsdDown`); live code `historyDays`, `largestFeeEntries`, `LARGEST_FEES_LIMIT`, `publishHistoryFiles` (`publish.ts`), `store.linkFeeTokens`, `store.laneHistory`, `store.chainDisplayNames`, `buildReplay`, `feeClassifier`, `recordValueText`; from `copy.ts` `bold`, `fitLines`, `noLinks`, `plural`, `shortDay`, `tgText`, `X_MAX`, `TELEGRAM_CAPTION_MAX`, `type Copy`, `type Line`; `xLength`.
- Produces:
  - `monthly.ts`: `interface MonthlyFacts { kind: 'monthly'; month: string; summary: MonthSummary }`, `loadMonthlyFacts(c: RunContext, month: string): Promise<MonthlyFacts>`.
  - `monthly-copy.ts`: `MONTHLY_DROP = { detail: 1, closing: 2 }`, `composeMonthlyCopy(f: MonthlyFacts): Copy`.

- [ ] **Step 1: Write the failing tests.**

The facts are checked twice: against figures summed by hand from seeded D1 rows, and against the month summary of the `history.json` and `replay.json` a real `publishHistoryFiles` writes, which is what the month page reads.

Create `worker/test/monthly-facts.test.ts`:

```ts
import { monthSummary } from '@ccip-dev/core/month';
import type { HistoryFile, ReplayFile } from '@ccip-dev/core/public';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMonthlyFacts } from '../src/broadcasts/monthly';
import { publishHistoryFiles } from '../src/publish';
import * as store from '../src/store';
import { harness, readPublic, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const NOW = '2026-10-02T01:00:00.000Z';

/** Aug 30 to Oct 1: Ethereum → Base every day, BNB Chain → Ethereum from Sep 10; fees from Sep 1, 40% of them in LINK. */
async function seedMonths(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc], []);
  for (let ms = Date.parse('2026-08-30T00:00:00Z'); ms <= Date.parse('2026-10-01T00:00:00Z'); ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10);
    const fee = day >= '2026-09-01' ? 10 : null;
    const lanes = [{ day, dim: 'lane' as const, key: `${ETH}>${BASE}`, messages: 100, usd_value: 1e6, fee_usd: fee }];
    if (day >= '2026-09-10') lanes.push({ day, dim: 'lane' as const, key: `${BSC}>${ETH}`, messages: 50, usd_value: 3e6, fee_usd: fee });
    const messages = lanes.reduce((s, l) => s + l.messages, 0);
    const usd = lanes.reduce((s, l) => s + l.usd_value, 0);
    await store.replaceDaily(env.DB, { day, messages, token_messages: 0, usd_value: usd, fee_usd: fee === null ? null : fee * lanes.length, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 }, lanes, NOW);
    if (fee !== null) await store.setFeeGroupTotals(env.DB, day, { link_usd: fee * lanes.length * 0.4, native_usd: fee * lanes.length * 0.6, stable_usd: 0, link_amount: 1 });
  }
}

describe('loadMonthlyFacts', () => {
  it("sums the month from D1: its totals, LINK share, new chains and busiest lane", async () => {
    // #given
    await seedMonths();
    const h = harness({ now: NOW });
    // #when
    const { summary } = await loadMonthlyFacts(h.c, '2026-09');
    // #then 9 days of one lane and 21 of two
    expect({
      label: summary.label, messages: summary.messages, usd: summary.usd, fees: summary.fees, link: summary.linkSharePct,
      joined: summary.joined.map((c) => c.name), lane: summary.busiestLane && [summary.busiestLane.src.name, summary.busiestLane.dst.name, summary.busiestLane.usd],
    }).toEqual({
      label: 'September 2026', messages: 9 * 100 + 21 * 150, usd: 9 * 1e6 + 21 * 4e6, fees: 9 * 10 + 21 * 20, link: 40,
      joined: ['BNB Chain'], lane: ['BNB Chain', 'Ethereum', 21 * 3e6],
    });
  });

  it('agrees with the month summary of the history.json and replay.json the month page reads', async () => {
    // #given the files the finalize publishes
    await seedMonths();
    const h = harness({ now: NOW });
    await publishHistoryFiles(h.c);
    const history = (await readPublic('history.json')) as HistoryFile;
    const replay = (await readPublic('replay.json')) as ReplayFile;
    // #when
    const { summary } = await loadMonthlyFacts(h.c, '2026-09');
    // #then
    expect(summary).toEqual(monthSummary('2026-09', { days: history.days, largest: history.largest_fees ?? [], replay }));
  });
});
```

Create `worker/test/monthly-copy.test.ts`:

```ts
import type { MonthSummary } from '@ccip-dev/core/month';
import { describe, expect, it } from 'vitest';
import { TELEGRAM_CAPTION_MAX, X_MAX } from '../src/broadcasts/copy';
import type { MonthlyFacts } from '../src/broadcasts/monthly';
import { composeMonthlyCopy } from '../src/broadcasts/monthly-copy';
import { xLength } from '../src/broadcasts/x-length';

const LINKLIKE = /\b[a-z0-9-]+\.[a-z]{2,}\b/i;
const chain = (selector: string, name: string) => ({ selector, name });
const record = (kind: MonthSummary['records'][number]['kind'], day: string, value: number) => ({ kind, day, value, previous: { day: '2026-09-01', value: 1 }, stoodDays: 30 });

const OCTOBER: MonthSummary = {
  month: '2026-10',
  label: 'October 2026',
  messages: 47_210,
  usd: 1_249_000_000,
  fees: 64_321,
  linkSharePct: 38.2,
  records: [record('messages', '2026-10-14', 1_800), record('value', '2026-10-20', 90_100_000)],
  joined: [chain('1', 'Gravity'), chain('2', 'Tempo')],
  busiestLane: { key: '3>4', src: chain('3', 'Ethereum'), dst: chain('4', 'Base'), usd: 310_200_000 },
};
const facts = (summary: Partial<MonthSummary> = {}): MonthlyFacts => ({ kind: 'monthly', month: '2026-10', summary: { ...OCTOBER, ...summary } });

describe('composeMonthlyCopy', () => {
  it('writes the X post as the spec shows it, with the value rounded down as the video counts it', () => {
    expect(composeMonthlyCopy(facts()).xText).toBe(['🎬 CCIP in October 2026', '47,210 messages · $1.2B moved · $64.3K in fees', 'New on CCIP: Gravity, Tempo', '#CCIP #Chainlink $LINK'].join('\n'));
  });

  it('writes the Telegram caption in sentences with bold numbers, the records set that month and the busiest lane', () => {
    expect(composeMonthlyCopy(facts()).telegramHtml).toBe(
      [
        '<b>🎬 CCIP in October 2026</b>',
        'In October, <b>47,210</b> CCIP messages moved <b>$1.2B</b>.',
        'Senders paid <b>$64.3K</b> in fees, <b>38%</b> of it in LINK.',
        'New on CCIP: Gravity and Tempo.',
        'New all-time highs: <b>1,800</b> messages in one day (Oct 14); <b>$90.1M</b> moved in one day (Oct 20).',
        'Busiest lane: Ethereum → Base, with <b>$310.2M</b> moved.',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
    );
  });

  it('leaves out the fees, the arrivals, the records and the lane when the month has none', () => {
    // #when
    const copy = composeMonthlyCopy(facts({ fees: null, linkSharePct: null, records: [], joined: [], busiestLane: null }));
    // #then
    expect(copy).toEqual({
      xText: '🎬 CCIP in October 2026\n47,210 messages · $1.2B moved\n#CCIP #Chainlink $LINK',
      telegramHtml: '<b>🎬 CCIP in October 2026</b>\nIn October, <b>47,210</b> CCIP messages moved <b>$1.2B</b>.\n\n#CCIP #Chainlink $LINK',
    });
  });

  it('drops the New on CCIP line first when the X post is too long, and keeps the hashtags', () => {
    // #given 30 new chains with long names
    const joined = Array.from({ length: 30 }, (_, i) => chain(String(i), `Very Long Chain Name ${i}`));
    // #when
    const copy = composeMonthlyCopy(facts({ joined }));
    // #then
    expect({ x: copy.xText, xFits: xLength(copy.xText) <= X_MAX, tgFits: copy.telegramHtml.length <= TELEGRAM_CAPTION_MAX }).toEqual({
      x: '🎬 CCIP in October 2026\n47,210 messages · $1.2B moved · $64.3K in fees\n#CCIP #Chainlink $LINK',
      xFits: true,
      tgFits: true,
    });
  });

  it('never mentions anyone or links anything, even for a chain named like a handle or a domain', () => {
    // #when
    const copy = composeMonthlyCopy(facts({ joined: [chain('1', '@scam'), chain('2', 'pump.fun')], busiestLane: { ...OCTOBER.busiestLane!, src: chain('5', 'claim.io') } }));
    // #then
    expect([copy.xText, copy.telegramHtml].map((t) => ({ at: /@[A-Za-z0-9_]/.test(t), link: LINKLIKE.test(t) || t.includes('://') }))).toEqual([
      { at: false, link: false },
      { at: false, link: false },
    ]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/monthly-facts.test.ts test/monthly-copy.test.ts`
Expected: FAIL: `../src/broadcasts/monthly` and `../src/broadcasts/monthly-copy` do not exist.

- [ ] **Step 3: Add the facts and the copy.**

Create `worker/src/broadcasts/monthly.ts`:

```ts
import { buildReplay, feeClassifier } from '@ccip-dev/core';
import { monthBounds, monthSummary, type MonthSummary } from '@ccip-dev/core/month';
import type { RunContext } from '../context';
import { historyDays, LARGEST_FEES_LIMIT, largestFeeEntries } from '../publish';
import * as store from '../store';

export interface MonthlyFacts {
  kind: 'monthly';
  month: string;
  summary: MonthSummary;
}

/**
 * The month's totals and highlights, from D1 through the functions that write history.json and replay.json, with the
 * largest fees as of the month's last day: the files the month page read when the video was recorded on the 1st. So the
 * caption and the video's end card agree.
 */
export async function loadMonthlyFacts(c: RunContext, month: string): Promise<MonthlyFacts> {
  const db = c.env.DB;
  const days = await historyDays(c);
  const largest = await largestFeeEntries(c, monthBounds(month).last, LARGEST_FEES_LIMIT, feeClassifier(await store.linkFeeTokens(db)));
  const replay = buildReplay(await store.laneHistory(db), await store.chainDisplayNames(db));
  return { kind: 'monthly', month, summary: monthSummary(month, { days, largest, replay }) };
}
```

Create `worker/src/broadcasts/monthly-copy.ts`:

```ts
import { recordValueText } from '@ccip-dev/core/broadcasts';
import { formatCount, formatFeeTotal, formatShare, formatUsd, formatUsdDown } from '@ccip-dev/core/format';
import type { RecordKind } from '@ccip-dev/core/records';
import { bold, fitLines, noLinks, plural, shortDay, TELEGRAM_CAPTION_MAX, tgText, X_MAX, type Copy, type Line } from './copy';
import type { MonthlyFacts } from './monthly';
import { xLength } from './x-length';

/** When the post is too long, its detail lines (New on CCIP, and on Telegram the records and the lane) go first, then the hashtags. */
export const MONTHLY_DROP = { detail: 1, closing: 2 } as const;

const HIGH: Record<RecordKind, (value: string) => string> = {
  messages: (v) => `${v} messages in one day`,
  value: (v) => `${v} moved in one day`,
  fees: (v) => `${v} in fees in one day`,
  largest_fee: (v) => `${v}, the largest single fee`,
  link_share: (v) => `${v} of fees paid in LINK in one day`,
};

const CLOSING = '#CCIP #Chainlink $LINK';

function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** The video tags no one: there is no single subject. The value moved is rounded down, as the video's counter and end card show it. */
function monthlyX(f: MonthlyFacts): Line[] {
  const s = f.summary;
  const fees = s.fees === null ? '' : ` · ${formatFeeTotal(s.fees)} in fees`;
  return [
    { text: `🎬 CCIP in ${s.label}` },
    { text: `${plural(s.messages, 'message')} · ${formatUsdDown(s.usd)} moved${fees}` },
    ...(s.joined.length > 0 ? [{ text: `New on CCIP: ${s.joined.map((c) => noLinks(c.name)).join(', ')}`, drop: MONTHLY_DROP.detail }] : []),
    { text: CLOSING, drop: MONTHLY_DROP.closing },
  ];
}

function monthlyTelegram(f: MonthlyFacts): Line[] {
  const s = f.summary;
  const month = s.label.split(' ')[0]!;
  const lines: Line[] = [
    { text: bold(`🎬 CCIP in ${s.label}`) },
    { text: `In ${month}, ${bold(formatCount(s.messages))} CCIP message${s.messages === 1 ? '' : 's'} moved ${bold(formatUsdDown(s.usd))}.` },
  ];
  if (s.fees !== null) {
    const link = s.linkSharePct === null ? '' : `, ${bold(formatShare(s.linkSharePct))} of it in LINK`;
    lines.push({ text: `Senders paid ${bold(formatFeeTotal(s.fees))} in fees${link}.` });
  }
  if (s.joined.length > 0) lines.push({ text: `New on CCIP: ${andList(s.joined.map((c) => tgText(c.name)))}.`, drop: MONTHLY_DROP.detail });
  if (s.records.length > 0) {
    const highs = s.records.map((r) => `${HIGH[r.kind](bold(recordValueText(r.kind, r.value)))} (${shortDay(r.day)})`);
    lines.push({ text: `New all-time highs: ${highs.join('; ')}.`, drop: MONTHLY_DROP.detail });
  }
  if (s.busiestLane) {
    const lane = s.busiestLane;
    lines.push({ text: `Busiest lane: ${tgText(lane.src.name)} → ${tgText(lane.dst.name)}, with ${bold(formatUsd(lane.usd))} moved.`, drop: MONTHLY_DROP.detail });
  }
  return [...lines, { text: '' }, { text: CLOSING, drop: MONTHLY_DROP.closing }];
}

/** The monthly video's X text and Telegram caption: no @ tags and no links. */
export function composeMonthlyCopy(f: MonthlyFacts): Copy {
  return {
    xText: fitLines(monthlyX(f), (t) => xLength(t) <= X_MAX),
    telegramHtml: fitLines(monthlyTelegram(f), (t) => t.length <= TELEGRAM_CAPTION_MAX),
  };
}
```

- [ ] **Step 4: Run the tests and the typecheck.**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/monthly-facts.test.ts test/monthly-copy.test.ts test/broadcast-copy.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add worker/src/broadcasts/monthly.ts worker/src/broadcasts/monthly-copy.ts worker/test/monthly-facts.test.ts worker/test/monthly-copy.test.ts
git commit -m "feat(worker): the monthly video's facts from the rows history.json publishes, and its untagged, linkless copy" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 9: Planning and delivering the monthly video

**Files:**
- Modify: `worker/src/broadcasts/outputs.ts` (`Broadcast.media`, video sends), `worker/src/broadcasts/run.ts` (`broadcastMonthly`, `alertOnce`, the media loaders, `broadcastHourly`)
- Test: `worker/test/monthly.test.ts`, `worker/test/broadcasts.test.ts`, `worker/test/poll.test.ts`

**Interfaces:**
- Consumes: Task 2 (`MONTHLY_VIDEO`, `monthLabel`, `monthlyDue`, `monthlyVideoKey`, `type PostTarget`); Task 7 (`sendTelegramVideo`, `uploadVideo`); Task 8 (`loadMonthlyFacts`, `type MonthlyFacts`, `composeMonthlyCopy`); live code `deliver`, `broadcastSafely`, `momentMode`, `selectOutputs`, `broadcastOutputs`, `store.claimMeta`, `store.releaseMeta`, `store.getMeta`, `LATE_FINALIZE_HOUR_UTC`.
- Produces:
  - `outputs.ts`: `type BroadcastMedia = { kind: 'image'; png: Uint8Array } | { kind: 'video'; mp4: Blob; filename: string; width: number; height: number; durationS: number }`; `Broadcast` is `{ key; kind: PostTarget['kind']; media: BroadcastMedia; facts: BroadcastFacts | MomentFacts | MonthlyFacts; xText; telegramHtml }` (its `image` field is gone); the channel, drafts and preview outputs send a video with `sendTelegramVideo` and the X output with `uploadVideo`.
  - `run.ts`: `BroadcastRequest` gains `{ kind: 'monthly' }`; `MONTHLY_MISSING_HOUR_UTC = 6`; `broadcastHourly` runs the monthly request last, every hour; alerts `monthly-video-missing:<month>` and `monthly-video-size:<month>` (once each, through `alerted:<signature>` rows) and `broadcast-video:<key>`.

- [ ] **Step 1: Write the failing tests.**

The existing tests build a `Broadcast` with `image`; they move to `media`:

In `worker/test/broadcasts.test.ts`, replace:

```ts
      channel: keys(channel),
      drafts: keys(drafts),
      image: [...(channel[0]?.image ?? [])],
      x: drafts[0]?.xText.startsWith('#CCIP · Sat, Oct 10'),
      html: channel[0]?.telegramHtml.startsWith('<b>CCIP daily report · Sat, Oct 10, 2026</b>'),
```

with:

```ts
      channel: keys(channel),
      drafts: keys(drafts),
      image: channel[0]?.media.kind === 'image' ? [...channel[0].media.png] : null,
      x: drafts[0]?.xText.startsWith('#CCIP · Sat, Oct 10'),
      html: channel[0]?.telegramHtml.startsWith('<b>CCIP daily report · Sat, Oct 10, 2026</b>'),
```

In `worker/test/broadcasts.test.ts`, replace:

```ts
    });
    const c = harness({ now: NOW, fetch: f, env: { ...ENV, ...extra } }).c;
    await telegramOutputs(c).drafts[0]?.send({ key: 'k', kind: 'daily', image: new Uint8Array(PNG), facts: {} as never, xText: 't', telegramHtml: 't' });
    return sent;
  };
```

with:

```ts
    });
    const c = harness({ now: NOW, fetch: f, env: { ...ENV, ...extra } }).c;
    await telegramOutputs(c).drafts[0]?.send({ key: 'k', kind: 'daily', media: { kind: 'image', png: new Uint8Array(PNG) }, facts: {} as never, xText: 't', telegramHtml: 't' });
    return sent;
  };
```

In `worker/test/broadcasts.test.ts`, replace:

```ts
    // #when
    const preview = telegramOutputs(c).preview;
    await preview[0]?.send({ key: 'k', kind: 'daily', image: new Uint8Array(PNG), facts: {} as never, xText: 'x', telegramHtml: '<b>t</b>' });
    // #then
    expect({ names: preview.map((o) => o.name), bodies }).toEqual({ names: ['telegram-preview'], bodies: [{ chat_id: '99', photo: PNG, caption: '<b>t</b>', parse_mode: 'HTML' }] });
```

with:

```ts
    // #when
    const preview = telegramOutputs(c).preview;
    await preview[0]?.send({ key: 'k', kind: 'daily', media: { kind: 'image', png: new Uint8Array(PNG) }, facts: {} as never, xText: 'x', telegramHtml: '<b>t</b>' });
    // #then
    expect({ names: preview.map((o) => o.name), bodies }).toEqual({ names: ['telegram-preview'], bodies: [{ chat_id: '99', photo: PNG, caption: '<b>t</b>', parse_mode: 'HTML' }] });
```

In `worker/test/broadcasts.test.ts`, replace:

```ts
  const X_KEYS = { X_API_KEY: 'k-key', X_API_SECRET: 'k-secret', X_ACCESS_TOKEN: 't-token', X_ACCESS_SECRET: 't-secret' };
  const ENV = { TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_ALERT_CHAT_ID: '42' };
  const BROADCAST: Broadcast = { key: 'broadcast:daily:2026-10-10', kind: 'daily', image: new Uint8Array(PNG), facts: {} as never, xText: '#CCIP daily', telegramHtml: '<b>t</b>' };
  const xPostOf = (extra: Record<string, string>, f?: typeof fetch) => broadcastOutputs(harness({ now: NOW, fetch: f, env: { ...ENV, ...extra } }).c).xPost ?? [];

```

with:

```ts
  const X_KEYS = { X_API_KEY: 'k-key', X_API_SECRET: 'k-secret', X_ACCESS_TOKEN: 't-token', X_ACCESS_SECRET: 't-secret' };
  const ENV = { TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_ALERT_CHAT_ID: '42' };
  const BROADCAST: Broadcast = { key: 'broadcast:daily:2026-10-10', kind: 'daily', media: { kind: 'image', png: new Uint8Array(PNG) }, facts: {} as never, xText: '#CCIP daily', telegramHtml: '<b>t</b>' };
  const xPostOf = (extra: Record<string, string>, f?: typeof fetch) => broadcastOutputs(harness({ now: NOW, fetch: f, env: { ...ENV, ...extra } }).c).xPost ?? [];

```

In `worker/test/poll.test.ts`, replace:

```ts
    last: null,
  };
  const broadcast: Broadcast = { key: POLL_KEY, kind: 'poll', image: new Uint8Array(PNG), facts, xText: '', telegramHtml: 'caption' };

  it('follows the card in its own chat, sends the poll with no link in it, and keeps its message id for next Monday', async () => {
```

with:

```ts
    last: null,
  };
  const broadcast: Broadcast = { key: POLL_KEY, kind: 'poll', media: { kind: 'image', png: new Uint8Array(PNG) }, facts, xText: '', telegramHtml: 'caption' };

  it('follows the card in its own chat, sends the poll with no link in it, and keeps its message id for next Monday', async () => {
```

The monthly tests run against real D1 and R2: the video is put in `env.ARCHIVE`, and a stand-in bucket plays the oversized and the vanishing file.

Create `worker/test/monthly.test.ts`:

```ts
import { NETWORKS, fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broadcast, BroadcastOutput, OutputSet } from '../src/broadcasts/outputs';
import { broadcastHourly, runBroadcasts } from '../src/broadcasts/run';
import type { Env } from '../src/env';
import type { ReserveBody } from '../src/publish';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const KEY = 'broadcast:monthly:2026-09';
const VIDEO_KEY = 'videos/monthly/2026-09.mp4';
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
const ON = { BROADCASTS: 'on', MOMENTS: 'on' };

/** Aug 31 through September, every day 200 messages and $8M on Ethereum → Base, with $4 in fees: no chain joins in September. */
async function seedSeptember(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base], []);
  for (let d = 0; d <= 30; d++) {
    const day = d === 0 ? '2026-08-31' : `2026-09-${String(d).padStart(2, '0')}`;
    await store.replaceDaily(
      env.DB,
      { day, messages: 200, token_messages: 0, usd_value: 8e6, fee_usd: 4, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 },
      [{ day, dim: 'lane', key: `${ETH}>${BASE}`, messages: 200, usd_value: 8e6, fee_usd: 4 }],
      '2026-10-01T00:07:00.000Z',
    );
  }
}

function recorder(name: string, results: ('sent' | 'failed')[] = ['sent']) {
  const sent: Broadcast[] = [];
  const output: BroadcastOutput = {
    name,
    send: async (b) => {
      sent.push(b);
      return results[Math.min(sent.length - 1, results.length - 1)]!;
    },
  };
  return { output, sent };
}

function outputSet(o: { channel?: ('sent' | 'failed')[] } = {}) {
  const channel = recorder('telegram-channel', o.channel);
  const xPost = recorder('x-post');
  const drafts = recorder('x-draft');
  const preview = recorder('telegram-preview');
  const set: OutputSet = { channel: [channel.output], xPost: [xPost.output], drafts: [drafts.output], preview: [preview.output] };
  return { set, channel: channel.sent, xPost: xPost.sent, drafts: drafts.sent, preview: preview.sent };
}

async function monthlyRun(now: string, o: { env?: Partial<Env>; outputs?: ReturnType<typeof outputSet> } = {}) {
  const outputs = o.outputs ?? outputSet();
  const h = harness({ now, env: { ...ON, ...o.env } });
  await runBroadcasts(h.c, { kind: 'monthly' }, outputs.set);
  return { ...outputs, alerts: h.alerts.map((a) => a.signature) };
}

const keys = (sent: Broadcast[]) => sent.map((b) => b.key);

describe('the monthly video', () => {
  it("posts last month's video once, on the channel and X, with its caption and no tag, once the archive bucket holds it", async () => {
    // #given
    await seedSeptember();
    await env.ARCHIVE.put(VIDEO_KEY, MP4);
    // #when two hourly runs on the 1st
    const first = await monthlyRun('2026-10-01T02:00:00.000Z');
    const again = await monthlyRun('2026-10-01T03:00:00.000Z');
    // #then
    const sent = first.channel[0]!;
    expect({
      channel: keys(first.channel),
      x: keys(first.xPost),
      drafts: keys(first.drafts),
      media: sent.media.kind === 'video' ? { name: sent.media.filename, type: sent.media.mp4.type, bytes: [...new Uint8Array(await sent.media.mp4.arrayBuffer())], size: [sent.media.width, sent.media.height, sent.media.durationS] } : null,
      x_text: first.xPost[0]?.xText,
      caption: sent.telegramHtml.split('\n')[0],
      claims: await store.getMetas(env.DB, [KEY, `${KEY}#telegram-channel`, `${KEY}#x-post`]).then((m) => [...m.values()].map((v) => v.slice(0, 5))),
      again: [...keys(again.channel), ...keys(again.xPost)],
    }).toEqual({
      channel: [KEY],
      x: [KEY],
      drafts: [],
      media: { name: 'ccip-2026-09.mp4', type: 'video/mp4', bytes: [...MP4], size: [1080, 1080, 30] },
      x_text: '🎬 CCIP in September 2026\n6,000 messages · $240.0M moved · $120 in fees\n#CCIP #Chainlink $LINK',
      caption: '<b>🎬 CCIP in September 2026</b>',
      claims: ['sent:', 'sent:', 'sent:'],
      again: [],
    });
  });

  it('plans nothing while the video is not in the bucket, and nothing after the 3rd', async () => {
    // #given
    await seedSeptember();
    // #when
    const missing = await monthlyRun('2026-10-01T02:00:00.000Z');
    await env.ARCHIVE.put(VIDEO_KEY, MP4);
    const late = await monthlyRun('2026-10-04T00:00:00.000Z');
    const third = await monthlyRun('2026-10-03T23:00:00.000Z');
    // #then
    expect({ missing: keys(missing.channel), late: keys(late.channel), third: keys(third.channel) }).toEqual({ missing: [], late: [], third: [KEY] });
  });

  it('alerts a missing video once, on the 1st from 06:00, and never on the 2nd', async () => {
    // #given no video
    await seedSeptember();
    // #when
    const runs = [];
    for (const now of ['2026-10-01T05:00:00.000Z', '2026-10-01T06:00:00.000Z', '2026-10-01T07:00:00.000Z', '2026-10-02T06:00:00.000Z']) runs.push((await monthlyRun(now)).alerts);
    // #then
    expect(runs).toEqual([[], ['monthly-video-missing:2026-09'], [], []]);
  });

  it('alerts once and posts nothing when the video is 50 MB or more', async () => {
    // #given an archive bucket whose video is 50,000,000 bytes
    await seedSeptember();
    const big = { head: async (key: string) => (key === VIDEO_KEY ? { size: 50_000_000 } : null) } as unknown as R2Bucket;
    // #when
    const runs = [await monthlyRun('2026-10-01T02:00:00.000Z', { env: { ARCHIVE: big } }), await monthlyRun('2026-10-01T03:00:00.000Z', { env: { ARCHIVE: big } })];
    // #then
    expect(runs.map((r) => ({ sent: r.channel.length + r.xPost.length, alerts: r.alerts }))).toEqual([
      { sent: 0, alerts: ['monthly-video-size:2026-09'] },
      { sent: 0, alerts: [] },
    ]);
  });

  it('follows the MOMENTS switch, with BROADCASTS: off posts nothing, and drafts sends it to the drafts chat only', async () => {
    // #given
    await seedSeptember();
    await env.ARCHIVE.put(VIDEO_KEY, MP4);
    // #when
    const off = await monthlyRun('2026-10-01T02:00:00.000Z', { env: { MOMENTS: 'off' } });
    const broadcastsOff = await monthlyRun('2026-10-01T02:00:00.000Z', { env: { BROADCASTS: 'off' } });
    const drafts = await monthlyRun('2026-10-01T02:00:00.000Z', { env: { MOMENTS: 'drafts' } });
    // #then
    expect({
      off: off.channel.length + off.xPost.length + off.drafts.length,
      broadcastsOff: broadcastsOff.channel.length + broadcastsOff.xPost.length + broadcastsOff.drafts.length,
      drafts: { channel: drafts.channel.length, x: drafts.xPost.length, draft: drafts.drafts[0]?.xText.startsWith('🎬'), preview: drafts.preview[0]?.telegramHtml.startsWith('<b>🎬') },
    }).toEqual({ off: 0, broadcastsOff: 0, drafts: { channel: 0, x: 0, draft: true, preview: true } });
  });

  it('retries only the output that failed, under the same claim and output keys', async () => {
    // #given the channel fails once
    await seedSeptember();
    await env.ARCHIVE.put(VIDEO_KEY, MP4);
    const outputs = outputSet({ channel: ['failed', 'sent'] });
    // #when
    const first = await monthlyRun('2026-10-01T02:00:00.000Z', { outputs });
    const between = await store.getMetas(env.DB, [KEY, `${KEY}#x-post`, `${KEY}#telegram-channel`]);
    await monthlyRun('2026-10-01T03:00:00.000Z', { outputs });
    // #then
    expect({
      alerts: first.alerts,
      between: Object.fromEntries([...between].map(([k, v]) => [k, v.slice(0, 5)])),
      channel: outputs.channel.length,
      x: outputs.xPost.length,
      done: (await store.getMeta(env.DB, KEY))?.startsWith('sent:'),
    }).toEqual({ alerts: [`broadcast-telegram-channel:${KEY}`], between: { [`${KEY}#x-post`]: 'sent:' }, channel: 2, x: 1, done: true });
  });

  it('alerts and releases its claim when the video is gone by the time it is read', async () => {
    // #given head finds the video, get does not
    await seedSeptember();
    const vanishing = { head: async () => ({ size: MP4.length }), get: async () => null } as unknown as R2Bucket;
    // #when
    const run = await monthlyRun('2026-10-01T02:00:00.000Z', { env: { ARCHIVE: vanishing } });
    // #then
    expect({ alerts: run.alerts, sent: run.channel.length, claim: await store.getMeta(env.DB, KEY) }).toEqual({ alerts: [`broadcast-video:${KEY}`], sent: 0, claim: null });
  });
});

describe('the monthly video through the real outputs', () => {
  const ENV = { ...ON, TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHANNEL_ID: '@ccipdev', X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_SECRET: 'a' };
  const RESERVE = { transfers: [], weekly: [], cost_basis: null } as unknown as ReserveBody;
  const routes = () =>
    fakeFetch(
      (url) => (url.endsWith('/sendVideo') ? jsonResponse({ ok: true, result: { message_id: 1 } }) : undefined),
      (url) => (url.endsWith('/media/upload/initialize') ? jsonResponse({ data: { id: '77' } }) : undefined),
      (url) => (url.endsWith('/77/append') ? jsonResponse({ data: { expires_at: 1 } }) : undefined),
      (url) => (url.endsWith('/77/finalize') ? jsonResponse({ data: { id: '77', processing_info: { state: 'succeeded' } } }) : undefined),
      (url) => (url.endsWith('/2/tweets') ? jsonResponse({ data: { id: 'post-1' } }, 201) : undefined),
    );

  it('posts it in the 06:00 hourly run, the late finalize hour, with sendVideo and the chunked X upload', async () => {
    // #given
    await seedSeptember();
    await env.ARCHIVE.put(VIDEO_KEY, MP4);
    const fetch = routes();
    const h = harness({ now: '2026-10-01T06:00:00.000Z', fetch, env: ENV });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // #when
    await broadcastHourly(h.c, RESERVE);
    vi.restoreAllMocks();
    // #then
    const video = fetch.calls.find((c) => c.url.endsWith('/sendVideo'))?.init?.body as FormData;
    const posted = JSON.parse(String(fetch.calls.find((c) => c.url.endsWith('/2/tweets'))?.init?.body));
    expect({
      steps: fetch.calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, '').replace(/bot[^/]+/, 'bot')),
      chat: video.get('chat_id'),
      duration: video.get('duration'),
      posted,
      alerts: h.alerts,
    }).toEqual({
      steps: ['/bot/sendVideo', '/2/media/upload/initialize', '/2/media/upload/77/append', '/2/media/upload/77/finalize', '/2/tweets'],
      chat: '@ccipdev',
      duration: '30',
      posted: { text: '🎬 CCIP in September 2026\n6,000 messages · $240.0M moved · $120 in fees\n#CCIP #Chainlink $LINK', media: { media_ids: ['77'] } },
      alerts: [],
    });
  });

  it('stops calling X for the run once the upload hits an outage, and the next run retries X alone', async () => {
    // #given X answers 503 to the upload
    await seedSeptember();
    await env.ARCHIVE.put(VIDEO_KEY, MP4);
    const down = fakeFetch(
      (url) => (url.endsWith('/sendVideo') ? jsonResponse({ ok: true, result: { message_id: 1 } }) : undefined),
      (url) => (url.includes('api.x.com') ? jsonResponse({ title: 'Service Unavailable' }, 503) : undefined),
    );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const h = harness({ now: '2026-10-01T02:00:00.000Z', fetch: down, env: ENV });
    await runBroadcasts(h.c, { kind: 'monthly' });
    const retried = routes();
    await runBroadcasts(harness({ now: '2026-10-01T03:00:00.000Z', fetch: retried, env: ENV }).c, { kind: 'monthly' });
    err.mockRestore();
    // #then
    expect({
      xCalls: down.calls.filter((c) => c.url.includes('api.x.com')).length,
      alerts: h.alerts.map((a) => a.signature),
      retried: retried.calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, '')),
    }).toEqual({
      xCalls: 1,
      alerts: [`broadcast-x-post:${KEY}`],
      retried: ['/2/media/upload/initialize', '/2/media/upload/77/append', '/2/media/upload/77/finalize', '/2/tweets'],
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/monthly.test.ts test/broadcasts.test.ts test/poll.test.ts`
Expected: FAIL: the outputs still read `b.image`, and a `{ kind: 'monthly' }` request runs as a finalize and posts nothing.

- [ ] **Step 3: Let the outputs send a video.**

In `worker/src/broadcasts/outputs.ts`, replace:

```ts
import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { clip, parsePollRecord, POLL_OPTION_MAX, POLL_QUESTION_MAX, pollRecordKey, type PollRecord } from '@ccip-dev/core/moments';
import type { RunContext } from '../context';
import type { Env } from '../env';
import * as store from '../store';
import { sendTelegramPhoto, sendTelegramPoll, type TelegramConfig } from '../telegram';
import { createPost, uploadImage, type XCredentials } from '../x';
import { noLinks } from './copy';
import type { BroadcastFacts } from './facts';
import type { MomentFacts } from './moment-facts';

export interface Broadcast {
  key: string;
  kind: BroadcastTarget['kind'];
  image: Uint8Array;
  facts: BroadcastFacts | MomentFacts;
  xText: string;
  telegramHtml: string;
```

with:

```ts
import type { PostTarget } from '@ccip-dev/core/broadcasts';
import { clip, parsePollRecord, POLL_OPTION_MAX, POLL_QUESTION_MAX, pollRecordKey, type PollRecord } from '@ccip-dev/core/moments';
import type { RunContext } from '../context';
import type { Env } from '../env';
import * as store from '../store';
import { sendTelegramPhoto, sendTelegramPoll, sendTelegramVideo, type TelegramConfig } from '../telegram';
import { createPost, uploadImage, uploadVideo, type XCredentials } from '../x';
import { noLinks } from './copy';
import type { BroadcastFacts } from './facts';
import type { MomentFacts } from './moment-facts';
import type { MonthlyFacts } from './monthly';

/** What a broadcast posts: its card, or for the monthly broadcast its video. */
export type BroadcastMedia =
  | { kind: 'image'; png: Uint8Array }
  | { kind: 'video'; mp4: Blob; filename: string; width: number; height: number; durationS: number };

export interface Broadcast {
  key: string;
  kind: PostTarget['kind'];
  media: BroadcastMedia;
  facts: BroadcastFacts | MomentFacts | MonthlyFacts;
  xText: string;
  telegramHtml: string;
```

In `worker/src/broadcasts/outputs.ts`, replace:

```ts
}

function photoOutput(c: RunContext, name: string, config: TelegramConfig, caption: (b: Broadcast) => { caption: string; parseMode?: 'HTML' }): BroadcastOutput {
  return {
    name,
    async send(b) {
      const failure = await sendTelegramPhoto(c.deps, config, { photo: b.image, ...caption(b) });
      if (failure === null) return 'sent';
      console.error(`[broadcast] ${name} failed for ${b.key}: ${failure}`);
```

with:

```ts
}

/** Sends the card as a photo, or the monthly video as a video that plays inline. */
function mediaOutput(c: RunContext, name: string, config: TelegramConfig, caption: (b: Broadcast) => { caption: string; parseMode?: 'HTML' }): BroadcastOutput {
  return {
    name,
    async send(b) {
      const { media } = b;
      const failure =
        media.kind === 'video'
          ? await sendTelegramVideo(c.deps, config, { video: media.mp4, filename: media.filename, width: media.width, height: media.height, durationS: media.durationS, ...caption(b) })
          : await sendTelegramPhoto(c.deps, config, { photo: media.png, ...caption(b) });
      if (failure === null) return 'sent';
      console.error(`[broadcast] ${name} failed for ${b.key}: ${failure}`);
```

In `worker/src/broadcasts/outputs.ts`, replace:

```ts
  return {
    xPost: [],
    channel: token && channel ? [photoOutput(c, 'telegram-channel', { token, chatId: channel }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    drafts: token && drafts ? [photoOutput(c, 'x-draft', { token, chatId: drafts }, (b) => ({ caption: b.xText }))] : [],
    preview: token && drafts ? [photoOutput(c, 'telegram-preview', { token, chatId: drafts }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    channelPoll: token && channel ? [pollOutput(c, { token, chatId: channel }, 'telegram-channel')] : [],
    draftsPoll: token && drafts ? [pollOutput(c, { token, chatId: drafts }, 'telegram-preview')] : [],
```

with:

```ts
  return {
    xPost: [],
    channel: token && channel ? [mediaOutput(c, 'telegram-channel', { token, chatId: channel }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    drafts: token && drafts ? [mediaOutput(c, 'x-draft', { token, chatId: drafts }, (b) => ({ caption: b.xText }))] : [],
    preview: token && drafts ? [mediaOutput(c, 'telegram-preview', { token, chatId: drafts }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    channelPoll: token && channel ? [pollOutput(c, { token, chatId: channel }, 'telegram-channel')] : [],
    draftsPoll: token && drafts ? [pollOutput(c, { token, chatId: drafts }, 'telegram-preview')] : [],
```

In `worker/src/broadcasts/outputs.ts`, replace:

```ts
      if (b.xText.trim() === '') return failed(name, b.key, 'the broadcast has no X text, so it is not posted to X');
      if (circuit.down) return failed(name, b.key, 'X failed earlier in this run, so it is not called again');
      const uploaded = await uploadImage(c.deps, creds, b.image);
      if ('problem' in uploaded) {
        circuit.down = uploaded.outage;
```

with:

```ts
      if (b.xText.trim() === '') return failed(name, b.key, 'the broadcast has no X text, so it is not posted to X');
      if (circuit.down) return failed(name, b.key, 'X failed earlier in this run, so it is not called again');
      const uploaded = b.media.kind === 'video' ? await uploadVideo(c.deps, creds, b.media.mp4) : await uploadImage(c.deps, creds, b.media.png);
      if ('problem' in uploaded) {
        circuit.down = uploaded.outage;
```

- [ ] **Step 4: Plan the monthly video and read it for `deliver`.**

`broadcastMonthly` checks, in order: the switch and the date, the key already `sent:`, configured outputs, the object (missing: alert once on the 1st from 06:00), its size (alert once) and then hands it to `deliver`, which claims the key and reads the file where it used to fetch the card. The card path and its `broadcast-image` alert text are unchanged.

In `worker/src/broadcasts/run.ts`, replace:

```ts
import { addDays, dayOf, weekStart } from '@ccip-dev/core';
import { broadcastCardPath, broadcastKey, isDepositTransfer, type BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { milestonesOn, RECORD_KINDS, recordsSetOn, recordValue, trackedMilestones } from '@ccip-dev/core/records';
import type { RunContext } from '../context';
```

with:

```ts
import { addDays, dayOf, weekStart } from '@ccip-dev/core';
import { broadcastCardPath, broadcastKey, isDepositTransfer, type BroadcastTarget, type PostTarget } from '@ccip-dev/core/broadcasts';
import { MONTHLY_VIDEO, monthLabel, monthlyDue, monthlyVideoKey } from '@ccip-dev/core/month';
import { milestonesOn, RECORD_KINDS, recordsSetOn, recordValue, trackedMilestones } from '@ccip-dev/core/records';
import type { RunContext } from '../context';
```

In `worker/src/broadcasts/run.ts`, replace:

```ts
import { isMomentFacts, loadMomentsSource, momentFacts, type MomentFacts, type MomentsSource } from './moment-facts';
import { dueMoments, pickMoments, type DueMoment } from './moment-plan';
import { broadcastMode, broadcastOutputs, momentMode, selectOutputs, selectPollOutputs, type Broadcast, type BroadcastOutput, type OutputSet } from './outputs';

export const SITE_ORIGIN = 'https://ccip.dev';
```

with:

```ts
import { isMomentFacts, loadMomentsSource, momentFacts, type MomentFacts, type MomentsSource } from './moment-facts';
import { dueMoments, pickMoments, type DueMoment } from './moment-plan';
import { loadMonthlyFacts, type MonthlyFacts } from './monthly';
import { composeMonthlyCopy } from './monthly-copy';
import {
  broadcastMode, broadcastOutputs, momentMode, selectOutputs, selectPollOutputs, type Broadcast, type BroadcastMedia, type BroadcastOutput, type OutputSet,
} from './outputs';

export const SITE_ORIGIN = 'https://ccip.dev';
```

In `worker/src/broadcasts/run.ts`, replace:

```ts
export const RESERVE_MAX_AGE_DAYS = 3;
export const MOMENTS_SEED_KEY = 'broadcast:moments:seeded';

export type BroadcastRequest = { kind: 'finalize'; days: readonly string[] } | { kind: 'reserve'; reserve: ReserveBody };

interface Planned {
  target: BroadcastTarget;
  facts: BroadcastFacts | MomentFacts;
}

export async function runBroadcasts(c: RunContext, request: BroadcastRequest, outputs: OutputSet = broadcastOutputs(c)): Promise<void> {
  const mode = broadcastMode(c.env);
  if (mode === 'off') return;
```

with:

```ts
export const RESERVE_MAX_AGE_DAYS = 3;
export const MOMENTS_SEED_KEY = 'broadcast:moments:seeded';
/** The workflow records last month's video at 01:15 on the 1st; one still missing from this hour on alerts. */
export const MONTHLY_MISSING_HOUR_UTC = 6;

export type BroadcastRequest = { kind: 'finalize'; days: readonly string[] } | { kind: 'reserve'; reserve: ReserveBody } | { kind: 'monthly' };

interface Planned {
  target: PostTarget;
  facts: BroadcastFacts | MomentFacts | MonthlyFacts;
}

export async function runBroadcasts(c: RunContext, request: BroadcastRequest, outputs: OutputSet = broadcastOutputs(c)): Promise<void> {
  if (request.kind === 'monthly') return broadcastMonthly(c, outputs);
  const mode = broadcastMode(c.env);
  if (mode === 'off') return;
```

In `worker/src/broadcasts/run.ts`, replace:

```ts
      await c.alert(`broadcast-run:${key}`, `${key} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

```

with:

```ts
      await c.alert(`broadcast-run:${key}`, `${key} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Last month's video, on the 1st to the 3rd, once the workflow has put it in the archive bucket. It follows the MOMENTS
 * switch, outside the moments' daily budget, and is claimed and sent like every broadcast. A video still missing on the
 * 1st from 06:00, or one of 50 MB or more, alerts once and is not posted.
 */
async function broadcastMonthly(c: RunContext, outputs: OutputSet): Promise<void> {
  const mode = momentMode(c.env);
  const now = c.deps.now();
  const month = monthlyDue(now);
  if (mode === 'off' || month === null) return;
  const target: PostTarget = { kind: 'monthly', month };
  if ((await store.getMeta(c.env.DB, broadcastKey(target)))?.startsWith('sent:')) return;
  const enabled = selectOutputs(outputs, mode);
  if (enabled.length === 0) {
    console.warn(`[broadcast] MOMENTS is ${mode} but no output is configured`);
    return;
  }
  const video = await c.env.ARCHIVE.head(monthlyVideoKey(month));
  if (video === null) {
    if (now.getUTCDate() === 1 && now.getUTCHours() >= MONTHLY_MISSING_HOUR_UTC) {
      await alertOnce(c, `monthly-video-missing:${month}`, `The ${monthLabel(month)} video is not in the archive bucket (${monthlyVideoKey(month)}), so it is not posted. Check the monthly-video workflow's run.`);
    }
    return;
  }
  if (video.size >= MONTHLY_VIDEO.maxBytes) {
    await alertOnce(c, `monthly-video-size:${month}`, `The ${monthLabel(month)} video is ${(video.size / 1e6).toFixed(1)} MB, over the 50 MB Telegram takes, so it is not posted.`);
    return;
  }
  await deliver(c, { target, facts: await loadMonthlyFacts(c, month) }, enabled);
}

/** Alerts `signature` once ever, where c.alert repeats hourly: an `alerted:<signature>` row in meta remembers it. */
async function alertOnce(c: RunContext, signature: string, text: string): Promise<void> {
  if (await store.claimMeta(c.env.DB, `alerted:${signature}`, c.deps.now().toISOString(), '')) await c.alert(signature, text);
}

```

In `worker/src/broadcasts/run.ts`, replace:

```ts
}

/** New Reserve deposits, then yesterday's finalize broadcasts again: the ones already sent hold their keys, so only the rest go out. */
export async function broadcastHourly(c: RunContext, reserve: ReserveBody): Promise<void> {
  await broadcastSafely(c, { kind: 'reserve', reserve });
  if (c.deps.now().getUTCHours() === LATE_FINALIZE_HOUR_UTC) return;
  const yesterday = addDays(dayOf(c.deps.now()), -1);
  await broadcastSafely(c, { kind: 'finalize', days: [yesterday] }, async () => (await store.getMeta(c.env.DB, 'last_finalize_day')) === yesterday);
}

```

with:

```ts
}

/**
 * New Reserve deposits, then yesterday's finalize broadcasts again (the ones already sent hold their keys, so only the rest
 * go out), then last month's video while it is due, the 06:00 hour included.
 */
export async function broadcastHourly(c: RunContext, reserve: ReserveBody): Promise<void> {
  await broadcastSafely(c, { kind: 'reserve', reserve });
  if (c.deps.now().getUTCHours() !== LATE_FINALIZE_HOUR_UTC) {
    const yesterday = addDays(dayOf(c.deps.now()), -1);
    await broadcastSafely(c, { kind: 'finalize', days: [yesterday] }, async () => (await store.getMeta(c.env.DB, 'last_finalize_day')) === yesterday);
  }
  await broadcastSafely(c, { kind: 'monthly' });
}

```

In `worker/src/broadcasts/run.ts`, replace:

```ts
}

async function checkImage(c: RunContext, url: string): Promise<{ png: Uint8Array } | { problem: string }> {
  try {
```

with:

```ts
}

type Media = { media: BroadcastMedia } | { alert: string; problem: string };

async function cardMedia(c: RunContext, target: BroadcastTarget): Promise<Media> {
  const cardUrl = `${SITE_ORIGIN}/og/${broadcastCardPath(target)}.png`;
  const checked = await checkImage(c, cardUrl);
  return 'problem' in checked ? { alert: 'broadcast-image', problem: `its card ${cardUrl} ${checked.problem}` } : { media: { kind: 'image', png: checked.png } };
}

/** The video the workflow put in the archive bucket, posted under the month's name. */
async function videoMedia(c: RunContext, month: string): Promise<Media> {
  const key = monthlyVideoKey(month);
  try {
    const object = await c.env.ARCHIVE.get(key);
    if (object === null) return { alert: 'broadcast-video', problem: `its video ${key} is no longer in the archive bucket` };
    const blob = await object.blob();
    const { width, height, durationS } = MONTHLY_VIDEO;
    return { media: { kind: 'video', mp4: blob.slice(0, blob.size, 'video/mp4'), filename: `ccip-${month}.mp4`, width, height, durationS } };
  } catch (err) {
    return { alert: 'broadcast-video', problem: `its video ${key} could not be read (${err instanceof Error ? err.name : 'error'})` };
  }
}

async function checkImage(c: RunContext, url: string): Promise<{ png: Uint8Array } | { problem: string }> {
  try {
```

In `worker/src/broadcasts/run.ts`, replace:

```ts

/**
 * Claims the key, then sends the checked card to each output that has not sent yet; every output that sends is marked under
 * `${key}#${name}`. The broadcast is marked sent only once all its outputs are, otherwise the claim is released and the next
 * run sends just the missing ones.
```

with:

```ts

/**
 * Claims the key, then sends the checked card (the read video, for the monthly broadcast) to each output that has not sent yet; every output that sends is marked under
 * `${key}#${name}`. The broadcast is marked sent only once all its outputs are, otherwise the claim is released and the next
 * run sends just the missing ones.
```

In `worker/src/broadcasts/run.ts`, replace:

```ts
  let copy: Copy;
  try {
    copy = isMomentFacts(p.facts) ? composeMomentCopy(p.facts) : composeCopy(p.facts);
  } catch (err) {
    await c.alert(`broadcast-copy:${key}`, `${key} was not posted: ${err instanceof Error ? err.message : String(err)}`);
```

with:

```ts
  let copy: Copy;
  try {
    copy = p.facts.kind === 'monthly' ? composeMonthlyCopy(p.facts) : isMomentFacts(p.facts) ? composeMomentCopy(p.facts) : composeCopy(p.facts);
  } catch (err) {
    await c.alert(`broadcast-copy:${key}`, `${key} was not posted: ${err instanceof Error ? err.message : String(err)}`);
```

In `worker/src/broadcasts/run.ts`, replace:

```ts
    return;
  }
  const cardUrl = `${SITE_ORIGIN}/og/${broadcastCardPath(p.target)}.png`;
  const checked = await checkImage(c, cardUrl);
  if ('problem' in checked) {
    await store.releaseMeta(db, key, claim);
    await c.alert(`broadcast-image:${key}`, `${key} was not posted: its card ${cardUrl} ${checked.problem}`);
    return;
  }
  const broadcast: Broadcast = { key, kind: p.target.kind, image: checked.png, facts: p.facts, ...copy };
  const sentNames = new Set(outputs.filter((o) => !remaining.includes(o)).map((o) => o.name));
  const failedOutputs: string[] = [];
```

with:

```ts
    return;
  }
  const loaded = p.target.kind === 'monthly' ? await videoMedia(c, p.target.month) : await cardMedia(c, p.target);
  if ('problem' in loaded) {
    await store.releaseMeta(db, key, claim);
    await c.alert(`${loaded.alert}:${key}`, `${key} was not posted: ${loaded.problem}`);
    return;
  }
  const broadcast: Broadcast = { key, kind: p.target.kind, media: loaded.media, facts: p.facts, ...copy };
  const sentNames = new Set(outputs.filter((o) => !remaining.includes(o)).map((o) => o.name));
  const failedOutputs: string[] = [];
```

- [ ] **Step 5: Run the Worker suite and the typecheck.**

Run: `pnpm --filter @ccip-dev/worker test && pnpm typecheck`
Expected: PASS, every broadcast, moment and poll test included.

- [ ] **Step 6: Commit.**

```bash
git add worker/src/broadcasts/outputs.ts worker/src/broadcasts/run.ts worker/test/monthly.test.ts worker/test/broadcasts.test.ts worker/test/poll.test.ts
git commit -m "feat(worker): post last month's video from the archive bucket on the 1st to the 3rd, under MOMENTS, once" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 10: Runbook and methodology

**Files:**
- Modify: `docs/runbook.md` ("Monthly video", three alert rows), `docs/methodology.md` ("Monthly video")

**Interfaces:**
- Consumes: the behavior of Tasks 1–9: the workflow and its inputs, the page, the key `broadcast:monthly:<YYYY-MM>` and its `#` rows, the alerts `monthly-video-missing:<YYYY-MM>`, `monthly-video-size:<YYYY-MM>` and `broadcast-video:<key>`.
- Produces: docs only. `docs/methodology.md` is in the `site` workflow's paths, so merging this rebuilds the site.

- [ ] **Step 1: Document the monthly video.**

The runbook section goes before "Incidents and alerts"; the alert rows go before `broadcast-run:<key>`; the methodology note goes before "Coverage".

In `docs/runbook.md`, replace:

```markdown
- **A card:** `https://ccip.dev/og/broadcast/welcome/<selector>.png`, `…/countdown/<metric>/<threshold>.png`, and `…/poll/<monday>.png`, `…/movers/<monday>.png`, `…/spotlight/<monday>.png`, `…/roundup/<monday>.png`. One that `moments.json` does not hold answers 404, and so does every one while `moments.json` is more than 10 minutes older than `replay.json` (see `moments-publish`).

## Incidents and alerts

```

with:

```markdown
- **A card:** `https://ccip.dev/og/broadcast/welcome/<selector>.png`, `…/countdown/<metric>/<threshold>.png`, and `…/poll/<monday>.png`, `…/movers/<monday>.png`, `…/spotlight/<monday>.png`, `…/roundup/<monday>.png`. One that `moments.json` does not hold answers 404, and so does every one while `moments.json` is more than 10 minutes older than `replay.json` (see `moments-publish`).

## Monthly video

On the 1st of each month a 30-second square video of last month's CCIP activity is recorded in GitHub Actions and posted to @ccipdev on Telegram and X. Spec: `docs/superpowers/specs/2026-10-12-monthly-video-design.md`.

- **Recording:** the `monthly-video` workflow (`.github/workflows/monthly-video.yml`) runs at 01:15 UTC on the 1st, after the 00:07 finalize. Its `record` job opens the unlisted month page, `https://ccip.dev/replay/month/?m=<YYYY-MM>`, in headless Chrome stable with software WebGL, and records the month cut through the page's `window.ccipRecord` hook: the silent H.264 video and the soundtrack as WAV, about 5 minutes on GitHub's runner. ffmpeg muxes them (AAC sound), and `pnpm video:check` passes only a file of 29.5–30.5 s, 1080×1080, H.264 with 4:2:0 pixels, AAC and under 50 MB. A video that passes is attached to the run for 7 days, and the `upload` job puts it in the private archive bucket as `videos/monthly/<YYYY-MM>.mp4`; a failed step uploads nothing.
- **The month page** plays a month once its last day is finalized. For the current month, a future one or a malformed `m`, it says "No such month", and the recording fails without uploading anything. It has no nav link and a `noindex` tag.
- **Posting:** on the 1st, 2nd and 3rd, each hourly run of the data Worker (the 06:00 one included) looks for last month's video in the archive bucket. Once it is there and under 50 MB, it posts it as the broadcast `broadcast:monthly:<YYYY-MM>`: a video in the Telegram channel (`sendVideo`) and an X post with the video (X's chunked upload; the Worker waits up to 2 minutes for X to process it, and a video still processing fails `x-post` and is uploaded again the next hour). The caption has the month's messages, value moved and fees, the chains that joined and, on Telegram, the records set and the busiest lane. It tags no one and has no link, and its numbers come from the same daily rows as the video's end card. After the 3rd a month's video is not posted.
- **Switch and keys:** it follows `MOMENTS`, as far as `BROADCASTS` allows (see "Moments"): `off` in either stops it; `drafts` in either sends the video to the drafts chat twice, with the X text (`x-draft`) and with the channel caption (`telegram-preview`). It does not count toward the moments' daily budget. It is claimed and marked like every broadcast, with `#telegram-channel`, `#x-post` (or `#x-draft`) and `#telegram-preview` rows, and shares the run's X circuit breaker; X refusing a duplicate counts as sent.
- **Record a month again:** `gh workflow run monthly-video -f month=<YYYY-MM> -f dry_run=true`, then download the MP4 with `gh run download <run-id>` and watch it. Run it again without `dry_run` to upload it; that replaces the file in the bucket. Do this after a failed run, or when the 00:07 finalize ran late, so that at 01:15 the month page had no such month yet.
- **Post again:** on the 1st to the 3rd only, delete the key and its `#` rows; the next hourly run posts the video in the bucket. As for the other broadcasts, delete the X post by hand first (X refuses identical text), or keep `<key>#x-post` to post to Telegram only.
  `pnpm --filter @ccip-dev/worker exec wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key = 'broadcast:monthly:<YYYY-MM>' OR key LIKE 'broadcast:monthly:<YYYY-MM>#%'"`
- **Token:** the `upload` job runs in the `production` environment and uses `CF_DEPLOY_TOKEN` with `wrangler r2 object put … --remote`. The token needs Workers R2 Storage: Edit, which the owner added on 2026-10-12. GitHub gets no X or Telegram secret; those stay in the Worker.
- **Alerts:** `monthly-video-missing:<YYYY-MM>`, `monthly-video-size:<YYYY-MM>` and `broadcast-video:<key>`, below. A failed workflow run also shows in GitHub Actions, which emails the owner.

## Incidents and alerts

```

In `docs/runbook.md`, replace:

```markdown
| `broadcast-copy:<key>` | The post could not be written within X's 280 or Telegram's 1,024 even with every droppable line gone. Nothing was posted; read the alert. |
| `broadcast-run` | The broadcast step itself failed (for example a D1 error while reading its facts). Finalize and the hourly job still finished; the next hourly run retries. |
| `broadcast-run:<key>` | One moment failed in a way its own alerts did not catch (for example a D1 error while claiming its key); the moments after it were still posted. Read the error in the alert and the Worker logs. The hourly runs retry it while it is due; a key it left `pending:` is retried once the claim is an hour old. |
| `reserve-read` | The Reserve balance read failed several hours in a row. Check the RPC endpoints. |
```

with:

```markdown
| `broadcast-copy:<key>` | The post could not be written within X's 280 or Telegram's 1,024 even with every droppable line gone. Nothing was posted; read the alert. |
| `broadcast-run` | The broadcast step itself failed (for example a D1 error while reading its facts). Finalize and the hourly job still finished; the next hourly run retries. |
| `monthly-video-missing:<YYYY-MM>` | On the 1st, from 06:00, last month's video is still not in the archive bucket, so it is not posted. Open the `monthly-video` workflow's run: a failed check, a recording that hit the 30-minute timeout, or "No such month" because the month's last day was finalized late. Record it again by hand (see "Monthly video") before the 3rd ends. Fires once a month. |
| `monthly-video-size:<YYYY-MM>` | Last month's video in the archive bucket is 50 MB or more, more than Telegram takes from a bot, so it is not posted. The workflow's check never uploads such a file, so it was put there by other means: record it again with the workflow. Fires once a month. |
| `broadcast-video:<key>` | The monthly video was in the archive bucket when the run looked, but could not be read back to post it. Nothing was posted and the key was released; the next hourly run retries until the 3rd. |
| `broadcast-run:<key>` | One moment failed in a way its own alerts did not catch (for example a D1 error while claiming its key); the moments after it were still posted. Read the error in the alert and the Worker logs. The hourly runs retry it while it is due; a key it left `pending:` is retried once the claim is an hour old. |
| `reserve-read` | The Reserve balance read failed several hours in a row. Check the RPC endpoints. |
```

In `docs/methodology.md`, replace:

```markdown
- **The poll** asks, in turn by week, which chain will pay the most fees, whether fees will beat last week's total (by more than 10%, within 10%, or less), or which lane will move the most value. The answer is taken from our data once the week is complete.
- **Tags:** an X post tags only the chain it is about (the welcomed chain, the spotlighted chain, or the headline chain of the movers, when the headline is a chain; a token or lane headline tags no one), and only with a verified handle. Everyone else is named in plain text.

## Coverage
```

with:

```markdown
- **The poll** asks, in turn by week, which chain will pay the most fees, whether fees will beat last week's total (by more than 10%, within 10%, or less), or which lane will move the most value. The answer is taken from our data once the week is complete.
- **Tags:** an X post tags only the chain it is about (the welcomed chain, the spotlighted chain, or the headline chain of the movers, when the headline is a chain; a token or lane headline tags no one), and only with a verified handle. Everyone else is named in plain text.

## Monthly video

On the 1st of each month @ccipdev posts a 30-second video of the month before: the replay, cut to that month. It shows only the month's days and the chains and lanes that moved in it. Its value counter, its fees counter and its leaderboard count the month alone, from zero. A chain whose first CCIP message came that month gets its "joins" beat, and an all-time milestone or record crossed that month gets its beat. The end card gives the month's messages, value moved, fees paid and the share of fees paid in LINK, the all-time records set that month (by the Records page's rules), the chains that joined and the month's busiest lane by value. The value moved is rounded down there and in the post, as the counter shows it. The post's caption comes from the same daily rows as the video.

## Coverage
```

- [ ] **Step 2: Check the new sections.**

Run: `grep -c "^## Monthly video" docs/runbook.md docs/methodology.md && grep -c "monthly-video-missing:<YYYY-MM>\|monthly-video-size:<YYYY-MM>\|broadcast-video:<key>" docs/runbook.md`
Expected: `docs/runbook.md:1`, `docs/methodology.md:1`, then `4` (the three alert rows and the section's "Alerts" line).

- [ ] **Step 3: Commit.**

```bash
git add docs/runbook.md docs/methodology.md
git commit -m "docs: the monthly video in the runbook and the methodology" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:**
  - §1 goal and owner decisions: the month cut, not a re-recorded all-time replay (Tasks 3–4); 30 s, 1:1, with sound (Tasks 5–6); approach A, GitHub records and only writes R2, the Worker posts (Tasks 6, 9); the token's R2 permission (Task 10 runbook).
  - §2 success criteria: posted once on the 1st with a caption matching the end card (Tasks 2, 8, 9; Review Focus 2); valid file (Task 6 `videoProblems`, Step 7); nothing bad goes out, one missing alert from 06:00 (Tasks 6, 9); unchanged replay (Task 3 pin, run in Tasks 3–5); cost, one X post a month (the claim, Task 9).
  - §3 scope: everything "In" has a task; nothing "Out" is built (no nav link, only the 30 s 1:1 post, no yearly or per-chain video).
  - §4 the month cut: the page and its empty state (Tasks 2, 3, 5); hook 0–2 s, story 2–26 s, finale 26–30 s (Task 3 `monthTiming`); the month's days, the warp, active lanes and chains only, joins, milestones and records (Task 3); the end card's rows, left out when empty, with "ccip.dev" and the loop kept (Tasks 3–4); the value odometer from zero and the fees counter, `formatFeeTotal`, its box in every aspect, no overlap, tested (Tasks 3–4); the leaderboard ranks the month only (Task 3); the score unchanged (Task 3 "runs the score unchanged"); the all-time replay unchanged (Task 3 pin).
  - §5 recording: the hook, its two files, its clear H.264 failure, the record button unchanged (Task 5); the workflow's triggers, inputs, steps, checks, dry run, upload and 30-minute timeout (Tasks 1, 6); feasibility first (the spike in "Decisions", Task 1's smoke).
  - §6 posting: the target and key (Task 2), the claim and `#` rows (Task 9); the 1st–3rd window, the object check, `MOMENTS` with `BROADCASTS`, outside the budget (Task 9); the size check before the claim and its alert (Task 9); `sendVideo` with its fields (Task 7); X's chunked upload, the 2-minute poll, failure and retry, the shared circuit, duplicates as sent (Tasks 7, 9); drafts mode (Task 9); copy with no tags and no links, the X example, the drop order, Telegram sentences with records, numbers from the same rows (Task 8); the missing alert once (Task 9); memory (Task 9 reads one Blob, shared by Telegram's form and X's slices).
  - §7 docs: Task 10 (the workflow and schedule, re-recording with `dry_run`, re-posting, the alerts, the token; the alert table; the methodology note).
  - §8 testing: every listed test has a home (director and story layer: Tasks 3–4; month page: Tasks 2–3 for the empty state and Task 6 Step 7 for the page itself; record hook: Task 5 in Node; Worker: Tasks 7–9; copy limits, no `@` and no URL: Task 8).
  - §9 rollout: steps 1 and 3 are in the runbook; step 2 conflicts with the 1st–3rd window (see "Decisions") and is not built.
  - §10 risks: headless Chrome (the spike, Task 1, Task 6 Step 7); X processing (Tasks 7, 9); rendering speed (measured: about 5.4 minutes of 30).
- **Not mapped:** rollout step 2 (posting September right after merge). The React render of "No such month" has no unit test (the player is not rendered in the site's Node tests); its rule (`monthCut`) is tested and Task 6 Step 7 checks the page end to end.
- **Placeholders:** none. The only fill-ins are `<your model>` in the commit trailers and `<scratch>` (a scratch directory) in Task 6 Step 7, by design.
- **Names across tasks:**
  - Task 1: `CHROME_ARGS`, `launchChrome`, `BrowserProbe`, `probePage`, `probeProblems`, `video:smoke`.
  - Task 2: `MONTHLY_VIDEO`, `MONTHLY_POST_DAYS`, `monthlyVideoKey`, `isMonth`, `monthBounds`, `monthDays`, `nextMonth`, `previousMonth`, `monthLabel`, `isPlayableMonth`, `monthlyDue`, `MonthChain`, `MonthLane`, `MonthSummary`, `MonthSource`, `monthSummary`, `formatUsdDown`, `MonthlyTarget`, `PostTarget`.
  - Task 3: the months fixture (`FIRST_DAY`, `LAST_DAY`, `RECORD_DAY`, `FEES_FROM`, `CHAINS`, `monthsReplay`, `monthsHistory`, `LARGEST_FEES`), `MonthInput`, `MonthData`, `monthReplay`, `monthCut`, `monthCardRows`, `ShowInput.month`, `ShowFrame.endCard`, `StoryValues.fees`, `Show.month`, `StoryCounter.feesAt`, `monthTiming`, `WINDOW_DAYS`, `windowRecordEvents`.
  - Task 4: `StoryLayout.fees`, `StoryLayout.endCard`, `drawFees`, `drawEndCard`.
  - Task 5: `PcmAudio`, `wavBytes`, `VIDEO_FILE`, `AUDIO_FILE`, `RecordRequest`, `RecordedFiles`, `RecordHookDeps`, `createRecordHook`, `Window.ccipRecord`, `CutInputs`, `recordCut`, `downloadBlob`, `monthRecordingFilename`, `ReplayPlayer`'s `month`, `ReplayPage`'s `month`, `Base`'s `noindex`, `dataset.month`.
  - Task 6: `Probe`, `ProbeStream`, `DURATION_S`, `videoProblems`, `RECORDED_FILES`, `pickMonth`, `monthPageUrl`, `video:monthly`, `video:check`.
  - Task 7: `TELEGRAM_VIDEO_TIMEOUT_MS`, `TelegramVideo`, `sendTelegramVideo`, `X_VIDEO_CHUNK_BYTES`, `X_PROCESSING_WAIT_S`, `uploadVideo`, `signedRequest`.
  - Task 8: `MonthlyFacts`, `loadMonthlyFacts`, `MONTHLY_DROP`, `composeMonthlyCopy`.
  - Task 9: `BroadcastMedia`, `Broadcast.media`, `mediaOutput`, `MONTHLY_MISSING_HOUR_UTC`, `broadcastMonthly`, `alertOnce`, `cardMedia`, `videoMedia`.
- **Checked on 2026-10-12:**
  - The spike ran on a real `ubuntu-latest` runner (run 38324705843); its branch, worktree and local branch are deleted.
  - Every task's code was prototyped in a scratch worktree of this repo, and its tests run there. The plan's code blocks are generated from that prototype: each "replace" block's old text occurs exactly once in the file at that point.
  - The plan was then replayed task by task on a fresh worktree of `main` by a script that applies each step's blocks, runs each `Run:` and checks it against its `Expected:` PASS or FAIL, and makes each commit with its explicit `git add` paths: every new test failed before its implementation, every step passed after it, every commit left nothing unstaged, and the end state matched the prototype file for file. At the end: core 542, site 1,152 (Node) and 9 (workerd), Worker 509, scripts 338 tests, and `pnpm typecheck` clean. The 15 pin digests held on Node 22 and Node 26.
  - Task 6 Step 7 ran on the replayed build: September 2026 recorded in 176 s and checked valid (30.000 s, 1080×1080, H.264, AAC, 30.7 MB); the current month failed with "no such month" and no file; the frames showed the title, the fees counter and an end card whose value matches the counter.
  - Both versions of the workflow pass `actionlint`.
  - X's media endpoints were read on docs.x.com, `sendVideo` on core.telegram.org/bots/api (Bot API 10.3), and `wrangler r2 object put`'s flags on developers.cloudflare.com; `CF_DEPLOY_TOKEN`'s environment was read with `gh api`.
