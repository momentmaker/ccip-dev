# ccip.dev — The viral replay

**Status:** Draft for owner review · **Date:** 2026-10-07

This replaces the time-lapse design in the website spec (`2026-10-06-website-design.md` §8) and builds on chain icons (`2026-10-07-chain-icons-design.md`). The design was approved in conversation on 2026-10-07: part 1, part 2, and controls Direction A from the visual mockups.

## 1. Context and goal

`/replay/` plays CCIP's history as a time-lapse and records it as an MP4. The owner wants a video that people share on X: "make it super dope".

The current 1:1 recording (1080×1080, 32 s) has these problems:
- no hook;
- a fixed camera;
- anonymous chains;
- captions that collide with the action;
- a tiny counter;
- a blown-out center in 2025–26;
- a flat ending;
- no sound;
- browser-default controls.

The goal is a 30-second video worth sharing: a hook in the first two seconds, a camera story from 2 chains to 92, the moments that matter, a payoff ending that loops, and a soundtrack. It also gets a your-chain version for every chain community, and controls that feel like a real video tool.

## 2. Owner decisions (2026-10-07)

- **Features:**
  - the director's cut and story layer;
  - the leaderboard race;
  - the your-chain cut with per-chain pages and cards;
  - the soundtrack;
  - all four animation groups: glow plus living space, comets plus supernovas, lanes plus heartbeat, milestones plus finale.
- **Approach:** a dedicated deterministic **director** plus a dedicated WebGL2 **cinema renderer** for the replay only. The home sky keeps its renderer.
- **Soundtrack:** a cinematic synth.
- **Default length:** 30 s.
- **Controls:** Direction A, a cinema player plus a studio row, using real chain icons. The same button and segmented styles apply site-wide.

## 3. Success criteria

1. **Hook:** frame 0 to 2 s shows the title card ("3 years of Chainlink CCIP · in 30 seconds") over the first message, Ethereum to OP.
2. **Camera story:** the camera starts tight on the first two chains and ends on the full constellation. At 30 s, every chain join, every milestone and the finale fit in.
3. **Same output everywhere:** the same `t` renders the same frame in the player and in the MP4. The soundtrack's milestone hits land within one frame of their visual beat.
4. **Readable at 1080p:**
   - no caption or card overlaps another, or overlaps the leaderboard or counter;
   - the counter is legible on a phone at feed size;
   - dense years read clearly, with no blown-out white.
5. **Formats:** 16:9, 1:1 and 9:16 at 1080p, with 15, 30 and 60 s lengths. The MP4 carries AAC audio when the browser can encode it.
6. **Your chain:** `/replay/<slug>/` exists for every replay chain, with its own title, card and focus cut. The picker switches the cut without a reload.
7. **Budgets:**
   - `/replay/` JavaScript stays ≤ 200 KB gzipped;
   - the home page is unchanged by this work;
   - the live player holds ≥ 50 fps at High on an M-series Mac and ≥ 30 fps at Low on a mid-range phone;
   - a 30 s 1080p recording finishes in about 60 s or less on an M3.
8. **Accessibility:** Lighthouse mobile accessibility stays ≥ 95 on `/replay/` and the chain pages. There is no horizontal scroll at 390 px.

## 4. Scope

**In:**
- the director;
- the cinema renderer;
- the story layer;
- the score, live and recorded;
- the Direction A player and studio controls;
- the chain picker, chain pages and chain cards;
- 15, 30 and 60 s lengths;
- the shared controls kit applied to the Share buttons, tabs and Sound toggle;
- tests.

**Out:**
- server-rendered or auto-posted videos (sub-project 2b);
- custom date ranges;
- token-focused cuts;
- music uploads.

## 5. Facts this design relies on (measured 2026-10-07)

- **Replay code:** `site/src/replay/` holds:
  - `timeline.ts` (`ReplayModel.frameAt(t)`, deterministic with coins);
  - `compose.ts` (`ReplayCompositor`: 2D overlay over the GL sky);
  - `player.tsx`;
  - `recorder.ts` (mediabunny 1.61.3, H.264 at 8 Mbps, 30 fps, 1080p; aspects 16:9, 1:1 and 9:16).
- **Audio export:** mediabunny 1.61.3 exports `AudioBufferSource(encodingConfig)`, `canEncodeAudio(codec)` and `getFirstEncodableAudioCodec(codecs)`.
- **`replay.json`:** 1,038,680 bytes (335 KB gzipped), 92 chains, days from 2023-07-06. It is too big to parse in the card Worker per render.
- **Milestones:** `computeMilestones` in `site/src/lib/records.ts` already produces message and value thresholds, chain-count steps and joins.
- **Chain icons:** 95 are vendored (`iconHref`, `hasIcon`, `iconDataUri`), and about 45 chains ever wear a replay coin (`ReplayModel.coinSelectorsEver()`).
- **Current replay JS:** 112.4 KB gzipped; the budget is 200.

## 6. Building blocks

| Unit | Path | Responsibility |
|---|---|---|
| Director | `site/src/replay/director/` | Pure, deterministic. Turns the inputs into a `Show`: time warp, camera, beats, story text, leaderboard states, finale, focus. |
| Cinema renderer | `site/src/replay/cinema/` | WebGL2 drawing of one `ShowFrame`: background, lanes, comets, stars, coins, effects, post. Has quality tiers. |
| Story layer | `site/src/replay/story/` | 2D canvas drawing of the type and cards for one `ShowFrame`, with a layout per aspect. |
| Score | `site/src/replay/score/` | A pure event schedule from the `Show`, plus a WebAudio synth that renders an `AudioBuffer`. |
| Player | `site/src/replay/player.tsx` and new components | Direction A controls, playback, the Sound toggle, the picker, recording. |
| Recorder | `site/src/replay/recorder.ts` | Video plus optional AAC audio track. |
| Chain pages | `site/src/pages/replay/[slug].astro`, `site/src/lib/chain-slug.ts` | Static per-chain pages and their build-time card data. |
| Controls kit | `site/src/styles/controls.css`, `site/src/components/controls/` | Button, segmented control, shape picker and chain picker, shared across the site. |

The **director** inputs are `replay.json`, `history.json` days, the milestones, the star layout, `length`, `aspect` and an optional `focus` selector. Its output is `Show`, with `frameAt(t): ShowFrame`. `ShowFrame` extends today's `ReplayFrameState` with:
- `camera`: `{ cx, cy, extent, rotation }`;
- `beats`: each active beat with its `kind`, `progress`, label and selector;
- `story`: counter values, the date, the timeline position and the current card;
- `leaderboard`: rows with selector, value and an interpolated rank;
- `phase`: `'hook' | 'story' | 'finale'`;
- `fx`: flash, shockwave and slow-motion strength.

## 7. Director

### 7.1 Shot structure

| Length | Hook | Story | Finale |
|---|---|---|---|
| 15 s | 0–1.5 s | 1.5–13 s | 13–15 s |
| 30 s (default) | 0–2 s | 2–27 s | 27–30 s |
| 60 s | 0–2 s | 2–57 s | 57–60 s |

The old 2 s end card is replaced by the finale, so the video length equals the chosen length exactly.

- **Hook.**
  - The title card reads "N years of Chainlink CCIP" and "in L seconds". N is a whole or half number of years from `since` to the last day, such as "3 years" or "3½ years".
  - The title sweeps in with a light sweep over a near-black sky while the first message's comet flies from Ethereum to OP.
  - In focus mode the title reads "Base × Chainlink CCIP" and "since 2023-11-…".
- **Story:** the time-warped history (§7.2).
- **Finale.**
  - The camera eases to the full wide shot.
  - Every coin lights in a wave outward from the first chain, 0.6 s from first to last.
  - The network pulses once in sync, and the counter lands on its final value.
  - "ccip.dev" forms from particles.
  - The last 0.5 s cross-fades into frame 0's composition, so an X autoplay loop is seamless.

### 7.2 Time warp

- **Day weights:** each data day `d` gets `w_d = 1 + 0.6·log10(1 + messages_d) + 1.5·join_d + 2.5·milestone_d + 1.5·record_d`. The last three terms are 0 or 1.
- **Story time:** each day gets `S · w_d / Σw` seconds, where `S` is the story duration.
- **Focus mode:** the days before the focus chain's first day take at most 15% of `S`; their weights scale down together when they would take more. A chain that joined on day one is unaffected. (Amended 2026-10-07 after the final review: unscaled, 43 of 92 chain cuts spent over half the story before their chain existed.)
- **Dwell:** milestone days also get a fixed 0.6 s dwell, scaled by `L/30`, taken from `S` before the split. During the dwell, data time advances at 10% speed, so it looks like slow motion.
- **Properties:** `dayAt(t)` is monotonic and piecewise linear, so the same `t` always maps to the same day and time within the day.
- **Tuning:** every constant is named (`WARP_*`), so tuning doesn't change structure.

### 7.3 Camera

Keyframes come from the data:
- start: centered on the first two stars, with an extent just covering them;
- each join: the extent grows to include the new star (eased, with the existing `IGNITE_S` easing);
- each milestone: a 6% push-in over 0.3 s that recovers over 0.8 s;
- a slow orbit of 20° total rotation across the story;
- the finale: the full extent, with no rotation.

In focus mode, the last 25% of the story eases the center toward the focus star, and the finale frames the whole network with the focus star near the golden point.

The camera is a pure function of `t`.

### 7.4 Beats

| Beat | Source | Visual | Card | Sound |
|---|---|---|---|---|
| Join | the chain's `first_day` | supernova at the star; the coin pops in | "[logo] Base joins" | chime |
| Milestone | `computeMilestones`, headline thresholds only: 1K, 10K, 100K and 1M messages; $1B and $10B; 25, 50 and 75 chains. A slam that would start more than 0.8 s late is dropped | shockwave plus camera punch-in; a large number slams in | none; the slam is the card | boom |
| Record day | a new all-time daily-messages high, at most 3 per video, picking the largest relative jumps | the star flashes; a golden ripple | "Record day · 12,345 messages" | rising pluck run |
| Lane opens (focus mode only) | the first day a lane between the focus chain and X has a row | a laser draws the lane | "[logo] Arbitrum ↔ Base" | chime |

**Batching and pacing.**
- Joins less than 1.0 s of video apart merge into one card: "+3 chains: Merlin · Core · Bitlayer", showing up to 3 logos.
- Only one card shows at a time; it holds at least 1.0 s and at most 2.0 s.
- Join and lane cards are scheduled first, and never start more than 1.0 s after their moment; batching absorbs bursts.
- Record cards fill gaps within 1.0 s of their moment, or are dropped.
- Milestone slams can overlap a card; the card dims to 40% while a slam is on.

### 7.5 Story values

- the counter: cumulative value moved, from `history.json`, interpolated within the day;
- the secondary lines: cumulative messages and active chain count;
- the date, from `dayAt(t)`;
- the timeline position, from 0 to 1 across the story.

In focus mode, the counters count only lanes touching the focus chain, cumulatively from `replay.json` rows.

### 7.6 Leaderboard race

- **Rows:** the top 5 chains by trailing 30-day USD, the same values that size stars, using only chains with an icon. Each row has the coin, name, value and a bar.
- **Ranks:** rows rest in integer slots. An overtake counts only when the challenger's value leads by at least 5%, so close neighbors don't flap. A swap animates over at most 0.4 s, with at least 0.4 s of rest between swaps, and the descending row dims while the two cross. The finale shows the final, settled order. Everything stays a pure function of `t`. (Amended 2026-10-07: averaged ranks left rows resting between slots in 57% of frames.)
- **Focus mode:** the focus chain's row is highlighted, and it is pinned as a 6th row if it is outside the top 5.

## 8. Cinema renderer

### 8.1 Passes (WebGL2)

1. **Background.**
   - A deep navy gradient.
   - A procedural nebula: seeded fbm noise in brand blue at 6–10% intensity, drifting 2% of its width per 10 s.
   - Three parallax dust-star layers, of 300, 180 and 90 points, offset by the camera at 0.2, 0.4 and 0.7 parallax.
2. **Lanes.** Additive filaments whose brightness follows `laneOpacity`. Each comet sends a 0.25-wide pulse along its lane.
3. **Comets.**
   - Quads stretched along their velocity, 6–14× the head size, with a motion-blur falloff.
   - Colors: pale for data, blue for tokens, gold for $1M+, following the global color rule.
   - On arrival: 8–16 seeded sparks and a ripple ring of 0.4 s at the destination star.
   - Comets are thinned when they spawn (a seeded keep test per spawn, sized so about 225 fly at once), so every drawn comet flies its whole lane and lands; the old newest-250 cap evicted every comet at 12–19% of its flight. Glows fade in over the first 10% of flight, and comet glows and arrival effects are normalized per lane and per destination star, so 2025–26 hubs glow without burning out (target ≤ 1.5% near-white pixels). (Amended 2026-10-07 after Plan B's reviews.)
4. **Stars.** A glow plus a core. A heartbeat scales brightness by `0.8 + 0.4·activity_d`, where activity is the chain's messages that day normalized by its 30-day maximum and smoothed over 0.3 s.
5. **Coins.** Textured quads from an icon atlas: the chain coin images rasterized at 128 px into one texture, built by the player before the first frame. A join pops the coin in with an elastic scale curve (0 → 1.25 → 1 over 0.5 s).
6. **Supernova on a join.** A flash sprite of 0.3 s, a shockwave ring of 0.8 s, and 40 seeded particles of 1.2 s.
7. **Post.**
   - The frame renders to an HDR target, RGBA16F when `EXT_color_buffer_float` is available and RGBA8 otherwise.
   - Bloom uses a threshold plus 5 levels of mip down- and up-sampling. The bloom chain starts at half the canvas on High and a quarter on Medium ("full" and "half" in §8.3 are relative to that chain).
   - The canvas edge feathers into the page's `#0c0f14` in the live player only; recordings have no feather.
   - The composite applies ACES-style tone mapping, a vignette and film grain (seeded by frame index).
   - A milestone shockwave is a screen-space radial distortion plus a chromatic aberration pulse lasting 0.5 s.

### 8.2 Determinism

Every random value comes from `mulberry32`, seeded by (day index, event id). Particle positions are closed-form functions of their age, with no integration over frames. The same `t` therefore gives the same pixels on the same tier.

### 8.3 Quality tiers

| Tier | Bloom | Particles | Nebula | Dust layers |
|---|---|---|---|---|
| High | full resolution | 100% | yes | 3 |
| Medium | half resolution | 50% | yes | 2 |
| Low | none | 25% | no | 1 |

- **Live player:** once per session, after the hook (so it measures the real story, not two stars), it takes the median frame time over a 2 s window of at least 20 frames, ignoring pauses (frames over 250 ms) and restarting after a gap of more than 0.5 s. Over 30 ms it goes straight to Low, over 22 ms to Medium; otherwise it stays High. It never re-evaluates and never steps up within a session, across chain and length changes. (Amended 2026-10-07: the original rolling rule could lock in a bad first window, and the hook measured nothing.)
- **Recording:** always High, with full motion even when the viewer prefers reduced motion. If the GPU context is lost mid-recording, the recording retries once on the classic renderer rather than writing frozen frames.
- **Finale:** in-flight comets, arrivals, supernova rings and coin pops keep moving with video time through the finale and settle, so the poster and the last frames hold no frozen effects. The particle title's timings are fractions of the finale, so "ccip.dev" assembles and holds at 15, 30 and 60 s.
- **No WebGL2:** the existing `ReplayCompositor` path is used, with the story layer drawn on top. The video is then "classic" but complete.

## 9. Story layer (2D)

`layoutFor(aspect, width, height)` is pure and returns the reserved boxes for the counter, date, timeline bar, card area, leaderboard and watermark. Elements never overlap, which is tested per aspect.

- **Counter:** a rolling-digit odometer for value moved, in JetBrains Mono. Each digit column rolls separately, and the value is formatted like `formatUsd`, with the unit changing at thresholds.
- **Date** and the **2023 to 2026 timeline bar,** with year ticks.
- **Cards:** a joins card with logo coins, a record card, and a lane-opens card. Each slides in and out over 0.25 s in the reserved card area.
- **Milestone slam:** the number scales from 1.4 to 1.0 with a blur-in, holds, then fades.
- **Leaderboard placement:** the right panel in 16:9, and a bottom strip in 1:1 and 9:16 with a fixed column count per cut: 3 columns, or 4 in a focus cut (the focus chain, or 4th place when the focus is already in the top 3). Rows crossing in a column crossfade in place.
- **Fit:** the hook title, subtitle and slam scale down to fit their boxes, and the slam's pop is capped so it never leaves the frame. Cards and slams end before the finale starts. Year ticks closer than 7% of the story to a later tick are dropped, on the canvas timeline and on the scrubber.
- **Watermark:** "ccip.dev · @ccipdev" stays small and constant.

## 10. Score (soundtrack)

### 10.1 Schedule (pure)

`scoreFor(show)` returns events with a time, kind and parameters. The music is D minor with a Lydian lift, at 96 BPM (beat 0.625 s).
- **Pad:** a detuned saw through a lowpass, on Dm, G, F, C, changing every 2 bars, all diatonic to D dorian (amended 2026-10-07: B♭ is outside the mode and clashed with the plucks' B natural). The filter opens as cumulative value grows.
- **Pulse:** a bass hit on each beat, with quiet 2nd and 3rd harmonics so it reads on phone speakers; its gain follows daily activity (that day's messages over the busiest day).
- **Plucks:** comet plucks quantized to 1/8 notes. Notes are chosen from the scale by the lane, at most 8 per second.
- **Joins:** a chime per join.
- **Milestones:** a boom per milestone, placed at the slam's start to the frame: a sub drop, a mid "body" sweep (180→90 Hz) so it carries on phone speakers, and a bright noise burst into the reverb.
- **Records:** a rising pluck run for a record day.
- **Finale:** a wide Dmaj9 swell into silence, always entered from a G pad (a IV→I cadence) with a short dry release, so no F♮ or C♮ rings into the D-major swell at any length. The last 0.5 s fades to match the loop. (Amended 2026-10-07 after Plan C's final review.)

### 10.2 Rendering

- An `OfflineAudioContext` (2 channels, 48 kHz, length L) synthesizes the schedule: oscillators, filters, a convolver reverb with a generated impulse, and a `DynamicsCompressor` master normalized to −1 dBFS peak.
- It renders once per (show, length) and caches the result. Renders take about 1.3 s for 30 s and 3.6 s for 60 s on a fast laptop, so the player pre-renders the current cut in idle time after the poster (debounced, skipped under Save-Data or low memory), and the Sound button shows a busy state until audio starts.
- There are no samples and nothing to license.

### 10.3 Live playback and recording

- **Live:** an `AudioBufferSourceNode` starts at the live playhead (plus output latency), stops on pause with an 8 ms fade, and restarts on scrub (throttled while dragging). It rejoins the playhead after an interruption (a hidden tab, or iOS). Sound is off by default because of autoplay rules and is not remembered across visits; the Sound button in the bar turns it on, and it plays as media even with the iPhone ringer switch on silent where `navigator.audioSession` exists.
- **Recording:**
  - The recorder asks `getFirstEncodableAudioCodec(['aac'])`. If AAC is available, it adds `AudioBufferSource({ codec: 'aac', bitrate: 128_000 })` and adds the rendered buffer.
  - If AAC isn't available, it records silent and shows "Recorded without sound — your browser can't encode audio". AAC only, because X expects it.
  - A/V sync: the recorded buffer is not shifted for AAC priming. Without an edit list, ffmpeg/Chrome play the audio about 20–56 ms after the slam frame and Safari/iOS −24…+12 ms, inside ITU-R BT.1359 and EBU R37; shifting would push Safari's audio ahead of the picture.

## 11. Player and controls (Direction A)

This is the approved mockup, `replay-a-detail-v2` in the brainstorm session.

**On the video:**
- a big glowing Play button before the first play;
- a gradient bar with Play/Pause and the **scrubber**: a brand-blue gradient fill, a glowing thumb, year ticks, and a milestone dot per milestone, with a hover tooltip such as "$10B moved · Jun 2, 2025";
- the time readout "0:13 / 0:30";
- the Sound toggle.

**The studio row under the video:**
- the **chain picker**: a combobox with search ("Search 92 chains"), "All chains" first, then chains by 30-day value, each with its real icon and value;
- the **length** segmented control: 15s, 30s, 60s;
- the **shape** control, three icon buttons drawn as rectangles for 16:9, 1:1 and 9:16;
- Share, as a ghost button;
- "● Record video", as the primary button.

**While recording:**
- a "REC 1080p · 1:1" badge on the video;
- the Record button becomes a progress pill, "Recording · 42%", with Cancel;
- the other controls dim and are disabled.

**Phone (< 640 px):**
- the video defaults to 1:1;
- the picker is full width;
- the length and shape controls sit on one row;
- full-width Record, then Share.

**Accessibility:**
- The scrubber is a real `<input type=range>`, styled, with `aria-valuetext` giving the date.
- The picker follows the ARIA combobox pattern, with keyboard search and arrows.
- The segmented controls are radio groups.
- Focus rings are visible.

**Defaults:** 30 s, 16:9 on desktop and 1:1 on phones, All chains. A `?chain=`-free URL means All chains.

## 12. Chain pages and cards

- **Slugs:** `chainSlug(chain)` is pure. It takes the display name minus " Mainnet", lowercased, with runs of non-alphanumerics turned into `-` (for example `base`, `bnb-chain`, `arbitrum`, `polygon-zkevm`). A collision appends `-2`, `-3` in selector order. `slugMap(chains)` is built once and exported for pages and the Worker.
- **Pages:** `site/src/pages/replay/[slug].astro` uses `getStaticPaths` over `replay.chains`, about 92 pages.
  - Title: "Base on Chainlink CCIP · Replay · ccip.dev".
  - Description: "Watch Base's CCIP history: …".
  - It has a canonical URL and `og:image` `/og/replay/base.png?v=<lastDay>`.
  - It renders the same player with `focus` preset.
- **Picker:** choosing a chain swaps the cut in place, calls `history.pushState` to `/replay/<slug>/` (or `/replay/` for All chains), and updates `document.title` and the Share link. Back and forward restore the cut.
- **Cards:**
  - The new card route is `replay/<slug>`.
  - The build-time asset `/replay-cards.json` holds `{ [slug]: { name, since, usd, messages, partners, coin } }`, where `partners` is the number of chains it has messaged and `coin` is the icon data URI. The Worker reads it from `ASSETS`, because `replay.json` is too large, and validates each entry (a `coin` must be a `data:image/` URI).
  - The card reads "BASE ON CHAINLINK CCIP" over the big value moved, then "moved · N messages · P chains", "since Nov 3, 2023" and the page address. The chain's coin (132 px, with a blue glow) sits over the center of the card sky, and the network's sky coins stay around it, minus any the badge would cover. Long names end in an ellipsis before the badge.
  - An unknown slug returns 404, including names that only exist on `Object.prototype`. A missing asset returns the fallback card, following the existing rules.
- **File names:** `ccip-replay-<slug>-<lastDay>-<aspect>.mp4` in focus mode; the current name otherwise.

## 13. Controls kit (site-wide)

`site/src/styles/controls.css` defines:
- `.btn` (secondary), `.btn-primary`, `.btn-ghost` and `.icon-btn`;
- `.seg`, a segmented control;
- `.shape-picker`;
- `.chain-picker`, plus its popover.

React wrappers live in `site/src/components/controls/`.

They are applied to:
- the Share button;
- the tabs: `.tabs` becomes a segmented look, with the active tab `#13244d` plus the blue-2 ring;
- the Sound toggle;
- the replay controls.

Tokens are unchanged, and the colors follow the website spec §11. Contrast stays AA; the earlier fix keeps `#13244d` with `--fg`.

## 14. Error handling

| Failure | Behavior |
|---|---|
| No WebGL2, or context creation fails | Classic compositor plus the story layer. No error UI. |
| A WebGL context is lost during play | Recreate once; on a second loss, fall back to classic. |
| The frame rate is too low | Step down a tier (§8.3). |
| `OfflineAudioContext` is unsupported or fails | No sound. The Sound button is hidden, and recordings are silent with the note. |
| AAC can't be encoded | A silent MP4 with the note. |
| Recording is unsupported | The existing message. |
| Data fetch fails | The existing poster plus retry. |
| An icon fails to load | That chain has no coin, and its leaderboard row shows the name only. |
| An unknown `/replay/<slug>/` | The site 404. An unknown card slug returns 404. |
| First load | Every visitor's player opens on the settled finale, under the big Play button; Play starts from 0. |
| Reduced motion | The page opens on the finale's last frame. Play still works, with the camera punch-in and shockwave distortion off. |

## 15. Testing and budgets

**Director (pure):**
- `dayAt` is monotonic and covers all days;
- the story duration is exact for 15, 30 and 60 s;
- milestone dwell is applied;
- beats are ordered, batched within 1.0 s, and capped at one card at a time;
- the camera is continuous, with no jump over 2% of the extent between frames 1/30 s apart;
- in focus mode the counters include only the focus lanes;
- the leaderboard is interpolated and deterministic;
- the hook and finale phases sit at the right times.

**Other pure tests:**
- **Score:** events lie within `[0, L)`; milestone booms fall within one frame of their beats; pluck density is ≤ 8/s; the final swell ends at L.
- **Story layout:** for each aspect at 1080p and at the player's phone size, no reserved boxes intersect.
- **`chainSlug` and `slugMap`:** real names, collisions, and non-Latin and odd characters.

**Integration:**
- The chain card route parses; the card content is correct; a workerd real render of a chain card, with a pixel check at the coin center.
- check-build covers all `/replay/<slug>/` pages: unique titles, `og:image` patterns and canonicals.
- The recorder adds an audio track when AAC is available, tested by mocking `getFirstEncodableAudioCodec`.

**Budgets:**
- `/replay/` ≤ 200 KB gzipped of JS, counting lazy chunks; check-budgets already scans `/_astro`;
- the home page is unchanged;
- the chain pages are ≤ 200 KB.

**Visual QA (controller):**
- record 30 s MP4s in 16:9, 1:1 and 9:16, plus one focus cut;
- check frames at 0.5, 2.5, 10, 20, 28 and 29.9 s;
- confirm audio with `ffprobe`;
- check a loop seam by comparing frame 0 with the last frame;
- the owner uploads one to X.

## 16. Changes to other specs, owner steps, follow-ups

- **Website spec §8:** superseded by this spec; add a pointer.
- **Website spec §9.1:** the card routes gain `replay/<slug>`.
- **Website spec §11:** add the controls kit.
- **Owner step:** upload a recorded 30 s 1:1 MP4 with sound to X and confirm it plays and loops.
- **Follow-ups:**
  - auto-generated weekly videos posted by the bots (2b);
  - a 9:16 vertical cut tuned for Reels and TikTok;
  - custom date ranges.
