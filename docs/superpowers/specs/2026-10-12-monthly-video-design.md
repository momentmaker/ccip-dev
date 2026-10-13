# ccip.dev: the monthly video (3c)

**Status:** Draft for owner review · **Date:** 2026-10-12

3c is the last of the three broadcast projects. 3a, the core, and 3b, moments, are live. Once a month a 30 s video of that month's CCIP activity is recorded automatically and posted to @ccipdev on Telegram and on X.

It builds on:
- the viral replay (`docs/superpowers/specs/2026-10-07-viral-replay-design.md`): its director, cinema renderer, story layer, soundtrack and recorder;
- the broadcast pipeline (`docs/superpowers/specs/2026-10-11-broadcasts-design.md` and `docs/superpowers/specs/2026-10-12-moments-design.md`), including the X posting that went live on 2026-10-12.

The design was approved in conversation on 2026-10-12.

## 1. Goal

A month-in-review video is the most shareable thing @ccipdev posts. It goes out on the 1st of each month, unattended, with the same guarantees as every other broadcast:
- it posts once;
- a video that isn't there or isn't valid is never posted;
- there are no links;
- each output is retried on its own;
- the existing switches stop it.

**Owner decisions (2026-10-12):**
- **Cut:** that month only, a new "CCIP in October" cut. It is not the all-time replay re-recorded.
- **Format:** 30 s, square 1:1, with sound. The page records 1080×1080; the posted file is 1024×1024 yuv420p, because X documents a 1280×1024 maximum for video and requires 4:2:0.
- **Approach (A):** a GitHub Actions workflow records the video with headless Chrome and uploads the MP4 to R2. The data Worker posts it through the existing pipeline. The X and Telegram secrets stay in Cloudflare; GitHub only gets R2 write access.
- **Token:** the owner added Workers R2 Storage: Edit to the Cloudflare token GitHub already uses.

## 2. Success criteria

- **On time:** on the 1st, last month's video is posted once to the Telegram channel and to X. Its caption matches its end card.
- **Valid:** the video is about 30 s, 1024×1024 yuv420p, H.264 with AAC audio, under 50 MB, and plays inline on both.
- **Nothing bad goes out:** a failed or invalid recording uploads nothing and posts nothing. A missing video by 06:00 UTC on the 1st alerts once.
- **Unchanged:** the all-time replay page and its in-browser record button work exactly as before.
- **Cost:** one X post a month ($0.015).

## 3. Scope

**In:**
- the month cut in the replay;
- the unlisted month page;
- a record hook for automation;
- the recording workflow and its checks;
- the `monthly` broadcast kind: Telegram video, X chunked video upload, copy and facts;
- a missing-video alert;
- runbook and methodology sections.

**Out:**
- a public "this month" page in the site's navigation (the unlisted page can be linked later);
- other lengths and aspects for the monthly post;
- a yearly video (a later cut can reuse this);
- per-chain monthly videos.

## 4. The month cut

**Page:** `/replay/month/?m=YYYY-MM`. It is unlisted (no nav link, `noindex`, not in the sitemap). It plays the month cut in the existing player. An invalid or future month shows a short "no such month" state. It reads only the files the site already loads: `replay.json` for lanes, `history.json` for daily totals and fees, and `chains.json`.

**Shot structure for 30 s** (the director's existing hook / story / finale split):
- **Hook, 0–2 s.** A title card reading "CCIP · October 2026" over the month's sky.
- **Story, 2–26 s.**
  - The month's days only. The existing time warp (§7.2 of the replay spec) gives busy days, record days and join days more screen time.
  - Only the lanes and chains active that month appear.
  - A chain whose first CCIP message falls in the month gets the existing "joins" beat.
  - An all-time milestone or record crossed that month gets its existing beat.
- **Finale, 26–30 s.** The end card shows:
  - the month's totals: messages, value moved, fees paid, and the % of fees paid in LINK;
  - all-time records set that month (the same rules as the record broadcasts);
  - chains that joined that month;
  - the month's busiest lane by value.

  Rows with nothing to show are left out. "ccip.dev" and the loop cross-fade are kept as in the replay.

**Counters.**
- The existing value-moved odometer counts from zero over the month.
- A second, smaller **fees paid** counter is added. It counts the month's daily fee totals from `history.json` and is formatted like `formatFeeTotal`.
- The story layer's `layoutFor` reserves a box for it in every aspect. Nothing may overlap, and that is tested.

**Leaderboard race.** It ranks only the month's activity.

**Soundtrack.** The existing score generator runs on the month show unchanged.

**The all-time replay is not changed.** Its default cut, lengths, aspects, focus cuts and record button stay as they are. The month cut is a new show built with the same director, renderer, story layer and score.

## 5. Recording (GitHub Actions)

**Record hook.**
- The month page exposes a small hook for automation: `window.ccipRecord({ aspect: '1:1', length: 30 })`.
- It records with the existing offline recorder: deterministic, 30 fps, H.264 `avc1.640028` at 8 Mbps.
- It returns two files through the page's download path:
  - the video **without audio** (`video.mp4`);
  - the rendered soundtrack as **WAV** (`audio.wav`, 48 kHz stereo).
- Chrome on Linux can't encode AAC, which is why the audio comes out separately.
- When the browser can't record H.264, the hook fails with a clear message.
- The record button for people is unchanged.

**Workflow `.github/workflows/monthly-video.yml`.**
- **Triggers:** cron `15 1 1 * *` (01:15 UTC on the 1st, after the 00:07 finalize and the 00:25 site build). It also has a `workflow_dispatch` with a `month` input (default: last month) and a `dry_run` input.
- **Steps:**
  1. Check out and install. Install Playwright with **Chrome stable** (`channel: 'chrome'`), not the bundled Chromium, so WebCodecs H.264 is present.
  2. Run `pnpm video:monthly --month YYYY-MM`. The script:
     - launches headless Chrome with software WebGL (SwiftShader);
     - opens `https://ccip.dev/replay/month/?m=YYYY-MM`;
     - waits for the page to be ready and calls the hook;
     - saves both downloads.
  3. Re-encode and mux them with ffmpeg (`pnpm video:mux`): `-vf scale=1024:1024:flags=lanczos:out_range=tv,format=yuv420p -c:v libx264 -profile:v high -preset medium -crf 18 -r 30 -c:a aac -b:a 128k -shortest -movflags +faststart`. Reason: X's documented 1280×1024 limit and its 4:2:0 requirement; the in-page recording stays 1080².
  4. Validate with ffprobe. The job fails, uploading nothing, unless the file has:
     - a duration of 29.5–30.5 s;
     - 1024×1024 and `yuv420p`;
     - H.264 video;
     - AAC audio;
     - a size under 50 MB.
  5. **Dry run:** attach the MP4 to the run and stop.
  6. **Otherwise:** upload it to the private R2 archive bucket as `videos/monthly/YYYY-MM.mp4`, using `wrangler r2 object put` and the existing `CF_DEPLOY_TOKEN` (now with R2 Edit).
- **Time:** a few minutes of software rendering is expected. The job has a 30-minute timeout.
- **Feasibility first:** the plan's first task runs a short headless recording on a real GitHub runner. It confirms that Chrome stable's WebCodecs H.264 encoder and WebGL via SwiftShader work there before anything else depends on them.

## 6. Posting (data Worker)

**New broadcast kind `monthly`.**
- Target `{ kind: 'monthly', month: 'YYYY-MM' }`, with key `broadcast:monthly:YYYY-MM`.
- It uses the same atomic claim and per-output keys as every broadcast.

**When.**
- The hourly run plans last month's video on the 1st, 2nd and 3rd of the month, once `videos/monthly/YYYY-MM.mp4` exists in the archive bucket.
- It follows the `MOMENTS` switch, combined with `BROADCASTS` as for moments.
- It is outside the 2-a-day moment budget.

**No video, no post.**
- Before claiming, the Worker checks that the object exists and is under 50 MB. That takes the place of 3a's card check.
- An object that is too big alerts once and isn't posted.

**Outputs.**
- **Telegram channel:** `sendVideo` as a multipart upload, with the HTML caption, `width`, `height`, `duration` and `supports_streaming`.
- **X:**
  - Chunked media upload (initialize, append the chunks, finalize). Then poll the processing status for up to about 2 minutes. Then create the post with the media id.
  - Still processing, or a failure, means `'failed'`, and the next hourly run retries.
  - The exact v2 endpoints and fields are checked against docs.x.com while planning.
  - It shares the per-run circuit breaker. A duplicate-content refusal counts as sent, as for other X posts.
- **Drafts mode:** `x-draft` and `telegram-preview` send the video to the drafts chat with the X text and the channel caption.

**Copy.**
- No @ tags, since there is no single subject. No links.
- **X:**

  ```
  🎬 CCIP in October 2026
  47,210 messages · $1.2B moved · $64.3K in fees
  New on CCIP: Gravity, Tempo
  #CCIP #Chainlink $LINK
  ```

  The "New on CCIP" line drops first when the text is too long, then the hashtag line.
- **Telegram:** the same in fuller sentences with bold numbers, plus the records set that month.
- **Numbers:** the Worker computes the totals from the same daily rows `history.json` publishes, so the caption and the video's end card can't disagree.

**Missing video.**
- On the 1st, an hourly run at 06:00 UTC or later that finds no `videos/monthly/<last month>.mp4` alerts `monthly-video-missing:YYYY-MM` once.

**Memory.** A 30 MB video read from R2 fits within the Worker's limits.

## 7. Docs

- **Runbook, "Monthly video":**
  - the workflow and its schedule;
  - how to re-record a month (`workflow_dispatch`, with `dry_run` to check first);
  - how to re-post (delete the key and its `#` rows);
  - the alerts;
  - the token's R2 permission.
- **Runbook alert table:** add `monthly-video-missing:<month>`.
- **Methodology:** a short "Monthly video" note saying what the month cut shows.

## 8. Testing

- **Director and story layer (pure):**
  - the month show covers exactly the month's days;
  - joins, records and milestones fall inside the month;
  - the fees counter matches the month's fee sum;
  - the end card's rows, including when one is empty;
  - `layoutFor` with the new counter box never overlaps, in every aspect.
- **Month page:** an invalid month or a future month shows the empty state.
- **Record hook:** in a workerd- or node-friendly test where possible, the hook returns two files of the right types. The headless recording itself is covered by the feasibility task and a dry run.
- **Worker:**
  - planning on the 1st–3rd only, and only when the object exists;
  - the size check;
  - the missing-video alert, once;
  - the `MOMENTS` switch;
  - claims and per-output keys;
  - Telegram `sendVideo` multipart;
  - X chunked upload, processing poll and post, against a fake fetch;
  - copy within 280 and 1,024 characters, with no `@` and no URL.

## 9. Rollout

1. Merge. Run the workflow by hand with `dry_run` for last month (September 2026) and watch the video.
2. Run it again without `dry_run` while `MOMENTS` is on. The next hourly run posts September's video, or start with `MOMENTS = "drafts"` to see it in the drafts chat first.
3. From then on it runs on the 1st of each month.

## 10. Risks

- **Headless Chrome on the runner.** The H.264 encoder or WebGL could fail on GitHub's Linux runners. The feasibility task checks this first. If the H.264 encoder is missing, the fallback is to render the frames as PNG in the page and encode with ffmpeg in the workflow.
- **X video processing.** Processing time and limits vary. Retrying hourly through the 3rd covers slow processing.
- **Software rendering speed.** If it is much slower than expected, the job's 30-minute timeout and a failed run alert the owner. The quality tiers in replay §8.3 can lower cost for the recording.
