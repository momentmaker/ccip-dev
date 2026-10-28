# ccip.dev: the home page as a briefing

**Status:** Built · **Date:** 2026-10-28

The home page kept its live sky but everything under it was a feed list, five tiles and three flat cards. The bot's intel cards (SITREP, VAULT, Hall of Records, Chain Dossier) were better designed than the page itself, and the LinkMarines were nowhere on it. This redesign turns the page into a briefing for LinkMarines, told top to bottom: the network is alive, it is growing, every message pays, the Reserve stacks, and you can join the Corps.

The owner approved all twelve ideas on 2026-10-28 from a clickable mockup with numbered notes, built on that day's data.

## 1. Sections, in page order

1. **Hero HUD** (`components/home/Hud.tsx`). A corner-bracket panel, as on the intel cards:
   - "LIVE · SITREP" with the UTC date-time group;
   - an **all-time value odometer** on rolling digit wheels (`Odometer.tsx`), with all-time messages under it;
   - a **milestone bar** to the nearest milestone by ETA, with a "Crossed $25B moved today" chip on the day one falls;
   - today's messages, value and fees, the pace, yesterday, all-time fees and the 30-day run-rate;
   - a 00:00–24:00 UTC day clock.
   It leads with all-time rather than today, because today's count resets at midnight and reads small early in the day. The home OG card made the same switch in 7a7914b.
2. **Milestone celebration** (`Celebration.tsx`). Gold hexagon sparks from the odometer, and a banner with Share, gone after 16 s or on Close. It plays once per visitor per milestone: a crossing during the visit, or on a first visit the same UTC day. The key is `localStorage` `ccip:milestone:<metric>:<threshold>`.
3. **Big-transfer alerts.** A $1M+ comet (`GOLD_USD`) lands with two wider gold rings after its ring (`SHOCKWAVE` in `sky/scene.ts`). A callout sits beside the destination star at the first corner clear of the HUD, toolbar, ticker and banner (`whalePosition` in `sky/overlay.ts`).
4. **COMMS ticker and on-watch counter.** The live feed crawls along the hero's foot (`HomeTicker.tsx`); a new feed swaps in only when a lap ends. "On watch 04:09 · 37 messages · $1.2M witnessed" (`OnWatch.tsx`) replaces "Since you arrived".
5. **The next milestones** (`Milestones.tsx`). Four cards: value, messages, fees and the Reserve's next million LINK. Each has a 20-hex progress bar from the last milestone, the ETA at the 7-day pace, and where it started. Under a day away a card turns gold and says IMMINENT.
6. **Today, so far** (SITREP):
   - a 90-day pulse chart (`PulseChart.tsx`, `lib/pulse.ts`) for messages, value or fees, with a gold pin on the 90-day high, today's live point, and a dashed line to where today is heading;
   - the five tiles as one stat strip;
   - today's four biggest lanes as bars;
   - the feed as a COMMS log that slides each message in as its comet launches.
7. **The Vault** (`HomeVault.tsx`, hydrated when visible):
   - a strip: messages today → fees today → the Reserve;
   - a gold hex vault filling toward the next million LINK;
   - LINK held, value and cost basis, the deposit streak, the last deposit and the share of supply;
   - the next deposit counting down in seconds;
   - 26 weeks of deposits as bars, this week's due one dashed.
8. **The Board** (`Board.astro`):
   - last week's top 5 fee chains, tokens and lanes from `moments.json`, with ▲▼/NEW against the week before;
   - the network's chain and lane counts, and what is new (`arrivalRows`);
   - the weekly poll, which links to the Telegram channel, where the native poll is the vote;
   - last week's answer and the share of voters who called it.
9. **Dossier** (`Dossier.astro`). The week's fastest-growing chain and fastest-growing labeled project from `moments.json`. The chain links to its replay, and the project to its page when `projects.json` has one.
10. **Hall of Records** (`HallOfRecords.astro`). Gold hex medals for:
    - most messages in a day;
    - most value moved in a day;
    - most fees in a day;
    - the largest single fee;
    - most senders in a day.
    The newest record is enlarged. Each medal links to its day.
11. **The Corps** (`HomeCorps.tsx`, hydrated when visible). The roster's counts, the plank-owner seats with the next one blinking, the newest recruit's dog tag (it flips to its memes on hover, as on the wall), today's most wanted, and the enlist call. It reuses the roster page's `PlankSeats`, `DogTag`, `WantedPosters` and `EnlistCta`. Callsigns only, as the roster spec requires. The roster spec dropped a "plank-owner seats left" pill from `/marines/`; the owner approved one for the home page on 2026-10-28.
12. **Stay briefed** (`Briefed.astro`). X, Telegram, the Discord bot and the data API, with the sponsor slot as a strip below them.

`Headline.tsx`, `ReserveTeaser.tsx` and the home page's records and sponsor cards are gone.

## 2. Live totals

- `allTimeBase` sums `history.json`.
- `liveAllTime` adds the live days `history.json` does not hold yet: today, and yesterday between 00:00 UTC and the next site build.
- On top of that it adds the messages that landed since the `today.json` on screen (`landedSince`).
- **Which landed messages count.** The Worker writes `live.json` and `today.json` in one ingest run with one timestamp. So a message first seen in a `live.json` newer than the `today.json` on screen is not in today's totals yet, and counts. Every other message is already in them.
- The first poll's messages never count: `today.json` has them.
- The shown totals never step back within a visit (`useRatchet`), because a fresh `today.json` can price a message lower than the sky did.

## 3. Milestones

- **Ladders**, as on the Records page (`milestoneBounds` reuses `messageThresholds`, `valueThresholds` and `feeThresholds`):
  - messages step 1·2·5;
  - value steps 1·2.5·5 from $1B;
  - fees step 1·2.5·5 from $1M.
- **Paces** come from `moments.json` countdowns (7-day pace), else the average of history's last 7 days.
- **"Crossed today"** means a milestone sits above the total without today, and at or below the total with it (`crossedToday`).

## 4. Budget, motion and access

- **JavaScript.** The home page ships 135.6 KB of its 150 KB gzipped budget, up from 118.2 KB. The Board, Dossier, Hall of Records and Stay briefed sections render at build time with no JavaScript.
- **Sharing totals between islands.** The Vault reads today's live totals from the live island through `lib/live-store.ts`, instead of polling `today.json` a second time.
- **Reduced motion.** It stops the ticker crawl, the vault's wave, the sparks, the blinking and the comets (comets fall back to the existing star flashes).
- **Screen readers.** The odometer's wheels are hidden from them; the value is read once. The ticker is hidden too, since the COMMS log lists the same messages.
- **Hero layout.** On wide screens the sky starts at 26% of the width, so the constellation centres in the open sky beside the HUD. Below 1100 px the HUD stacks above the sky. No horizontal overflow at 390 px.

## 5. Tests

- `all-time.test.ts`: totals, ladders, goals, paces, crossings, ETA text and the landed-message rule.
- `pulse.test.ts`: ticks and chart geometry.
- `briefing.test.ts`: rank moves, arrivals, polls and medals.
- `home-sections.test.ts`: the HUD, milestones, stat strip, feed and ticker, the Vault, the Corps and the celebration text.
- `scene.test.ts`: the shockwave.
- `overlay.test.ts`: the callout's placement.
