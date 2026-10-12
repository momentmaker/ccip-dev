# ccip.dev: moments and community (3b)

**Status:** Draft for owner review · **Date:** 2026-10-12

3b is the second of the three broadcast projects (3a, the core, is live; 3c, the monthly video, comes later). It adds six post types to the 3a pipeline: welcome posts for new chains, leaderboard movers, milestone countdowns, a weekly chain spotlight, a weekly "New on CCIP" roundup and a weekly Telegram prediction poll.

The design was approved in conversation on 2026-10-12. The chosen card mockups, drawn with the real 3a card code and live data, are in `docs/superpowers/specs/assets/2026-10-12-moments/` (`mockups.mts` draws them).

## 1. Goal

Give people more reasons to follow @ccipdev and to reshare its posts. Each moment is about a chain, a token or the community, and on X it tags the chain it is about with its verified @handle, so that chain has a reason to repost.

**Owner decisions (2026-10-12):**
- **Approach:** the data Worker computes the moments after each finalize and publishes them as one public file, `moments.json`. The broadcast pipeline plans posts from it, and the card Worker draws each card from it, so a card and its caption cannot disagree (the `day-leaders.json` pattern from 3a).
- **Volume:** budget and bundling. Big moments get their own post; small ones are bundled into one weekly post. Roughly 1–3 posts on a normal day, counting 3a's.
- **Weekly rhythm:** Monday the poll (after the weekly report), Tuesday the movers, Thursday the spotlight, Saturday "New on CCIP". A new chain or a countdown can come on any day.
- **Poll:** three questions take turns by week. It is Telegram-only: there is no X draft for it.
- **Spotlight:** the fastest grower by messages, week over week.
- **Cards:** the six mockups in the assets folder, in the 3a C2 orbit-hub style.
- **Copy:** the X text in §5.3 as approved; the Telegram captions say the same in fuller sentences.

## 2. Success criteria

- Each moment posts at most once, with its card, on the right day, and only when its data holds.
- No post contains a link. Every @handle comes from the verified handle tables, and an X post tags only the chain it is about (§5.3).
- The six cards match the approved mockups.
- A moment failure never stops the data run, the 3a posts or the other moments.
- The first run after deploy does not flood the channel with old moments.
- The owner can switch moments off on their own (§4.4).

## 3. Scope

**In:**
- `moments.json`: its schema, its computation from D1, its publish after each finalize.
- Six post kinds with their facts, copy, cards and dedup keys.
- The Telegram poll: sending it, closing it the next Monday, reading its votes.
- A daily budget for moment posts.
- The `MOMENTS` switch.
- Runbook and methodology sections.

**Out:**
- A moments section on the site (the file makes it possible later).
- X polls (Telegram only, by owner decision).
- 3c (the monthly video), Be The Oracle, the username onboarding.

## 4. Pipeline

### 4.1 What runs when

All moments are planned by the 00:07 finalize run, after the 3a broadcasts, and retried by the hourly run exactly as 3a retries yesterday's posts.

| Moment | When it's planned | Covers |
|---|---|---|
| Welcome | any day, the day after a chain's first message | that chain |
| Countdown | any day, when the next milestone is 7 days away or less | that milestone |
| Poll | Monday, after the weekly report | last complete week, and the new week |
| Movers | Tuesday | last complete week vs the week before |
| Spotlight | Thursday | last complete week vs the week before |
| New on CCIP | Saturday | Monday to Friday of this week |

A complete week is Monday to Sunday (UTC), as in 3a.

### 4.2 Budget

- At most **2 moment posts a day**. 3a's posts and the poll don't count: the poll always posts on Monday, because it resolves the week before, and it is never deferred.
- When more are due, they go in this order: welcome, countdown, movers, spotlight, New on CCIP.
- A moment that misses its day is still planned on each of the next 2 days, then dropped.
- The budget is counted from the moment keys sent today (the `sent:` values carry the time).

### 4.3 Dedup

Each moment has a key in D1 `meta`, claimed and marked exactly as 3a's (atomic claim, per-output keys `<key>#<output>`, release on failure):
- `broadcast:welcome:<selector>`
- `broadcast:countdown:<metric>:<threshold>`
- `broadcast:poll:<monday>`
- `broadcast:movers:<monday>`
- `broadcast:spotlight:<monday>`
- `broadcast:roundup:<monday>`

**First run:** without `meta.broadcast:moments:seeded`, the step marks every moment that would be due today as `seeded:` without posting it, then sets the seed key. The next day starts fresh.

### 4.4 Mode

- `MOMENTS` (a Worker var) is `off`, `drafts` or `on`, and works like `BROADCASTS` for the six moment kinds only. It ships as `on`, matching `BROADCASTS`, and `off` is the kill switch.
- A moment posts only when both `BROADCASTS` and `MOMENTS` allow it: `off` in either means nothing; `drafts` in either means drafts.

## 5. Moments

### 5.1 Rules

**Welcome (new chain)**
- A chain arrives on the day of its first CCIP message: the earliest day it appears on either side of a lane in `daily_breakdown`. That matches `first_day` in `replay.json`. (The `arrivals` table records when a chain enters the CCIP registry, which can be long before its first message, so it isn't used.)
- The chain's number on CCIP is the count of chains whose first message day is on or before it.
- Its first partners are the chains on its lanes on its first day, by value.
- Posted the day after its first day, after the daily.

**Countdown**
- For each milestone metric already tracked in core (`messages`, `value`, `fees`), the next threshold not yet crossed, from the same threshold lists the records page uses.
- Pace is the average of the last 7 finalized days. Days left = ⌈(threshold − total) ÷ pace⌉.
- Planned when days left is 2 to 7. Under 2, the record or milestone post is about to come anyway.
- One countdown per milestone, ever.

**Movers (Tuesday)**
- Three boards over complete weeks: chains by fees (`src_chain` by fee), tokens by value, lanes by value.
- For each board, the top 10 of last week and each entry's rank the week before (null when it was outside the top 10).
- **Headline:** a new #1 on any board, in the order fees, tokens, lanes. With no new #1, the top climber is the headline.
- **Climbers:** entries that gained 3 places or more, or entered the top 10 from outside it, up to 3 across the boards, largest gain first.
- No post when there's no new #1 and no climber.

**Spotlight (Thursday)**
- A chain's messages are those it sent or received (`src_chain` + `dst_chain`).
- Candidates had at least 100 messages last week and at least 50 the week before.
- The pick has the largest percentage rise. A chain spotlighted in the 4 weeks before is skipped. Ties go to more messages, then the selector.
- The card shows its rank by messages, the week's messages, value and fees with their changes, its top 3 partner chains by value and its top token by value.
- No post when no chain qualifies or no chain rose.

**New on CCIP (Saturday)**
- Lanes and token groups whose first message was Monday to Friday of this week (a token without a registry group counts on its own).
- A lane that involves a chain welcomed this week is left out.
- Up to 5 of each on the card and in the text, then "+N more".
- The strip gives the network's size: lanes and chains with any message so far.
- No post when there's nothing new.

**Poll (Monday)**
- The question turns by week: ISO week number mod 3 picks one of:
  1. "Which chain will pay the most CCIP fees this week?" Options: last week's top 3 fee chains and "Another chain".
  2. "Will CCIP fees beat last week's $8.0K?", with last week's fee total. Options: "Up more than 10%", "Within 10%", "Down more than 10%".
  3. "Which lane will move the most value this week?" Options: last week's top 3 lanes by value and "Another lane".
- The answer is computed from our own data once the week is complete, the next Monday.
- See §6 for the poll's life cycle.

### 5.2 `moments.json`

Published after each finalize, next to `history.json` and `day-leaders.json`, in its own try/catch with its own alert (`moments-publish`), so a failure can't block the other files. Schema (version 1):

```ts
{
  schema_version: 1, updated_at, attribution,
  network: { chains: number, lanes: number },                 // with any message so far
  arrivals: {                                                  // first message in the last 30 days
    chains: { selector, day, number, partners: string[] }[],
    lanes:  { key, day, messages, usd }[],                     // key `src>dst`, first-day totals
    tokens: { key, symbol, day, chains: string[] }[],          // key: group id, or `chain:address` without a group
  },
  weeks: {                                                      // the last 8 complete weeks
    week,                                                       // its Monday
    boards: {
      fee_chains: { key, label, value, rank, previous_rank }[], // top 10; previous_rank null outside the top 10
      tokens:     { key, label, value, rank, previous_rank }[],
      lanes:      { key, label, value, rank, previous_rank }[],
    },
    spotlight: null | {
      selector, rank, messages, previous_messages, usd, previous_usd, fee_usd, previous_fee_usd,
      partners: string[], token: { key, label, usd } | null,
    },
  }[],
  countdowns: { metric, threshold, total, per_day, days_left }[], // next threshold per metric
  polls: {                                                         // the last 8
    week, question_kind, question, options: { key, label }[],
    answer: string | null,                                         // option key, once the week is complete
    votes: number[] | null,                                        // shares, once the poll is closed
    total_votes: number | null,
  }[],
}
```

Moments are computed from D1 through the same functions that write `history.json` and `day-leaders.json`, so the numbers match the rest of the site.

### 5.3 Copy

As in 3a: no links, X counted the way X counts, @handles only on the subject and only when verified, plain names otherwise. New:
- **An X post tags only its subject.** A welcome tags the welcomed chain; movers tag the headline (the new #1, or the top climber when there's no new #1) when it is a chain; a spotlight tags the spotlighted chain. A subject without a verified handle is a plain name. Everyone else is a plain name: partners, the dethroned leader, the other climbers, lanes, token symbols and token projects. Countdowns and New on CCIP tag no one, and the poll has no X text.
- Why: X's automation rules ban unsolicited @mentions (owner decision, 2026-10-12, replacing the earlier cap of 5 @handles a post).
- `#Chainlink` closes welcome and countdown posts; `#Chainlink $LINK` closes movers and spotlight; New on CCIP carries `#CCIP` only.
- The Telegram captions say the same in fuller sentences, with bold numbers and plain names, like 3a's.
- Drop order when too long: the climbers or partners line first, then the closing hashtag line.

**X, as approved:**

```
🎉 Welcome to #CCIP, @<chain>
Chain #93 on CCIP: first message on Oct 11, to Ethereum
First day: 38 messages · $412.5K moved
#Chainlink
```

```
New #1 on #CCIP: @base paid the most fees last week ($1.8K), taking the top spot from BNB Chain
Climbers: Arbitrum ▲6 to #3 by fees · syrupUSDT ▲9 to #7 by value · Ink → Ethereum ▲14 to #9
#Chainlink $LINK
```

```
⏳ $2.5M in all-time #CCIP fees is about 6 days away
$2.43M now, adding about $11.6K a day
#Chainlink
```

```
Chain spotlight: @base is the fastest-growing chain on #CCIP this week
3,412 messages (▲ 85% vs last week) · $96.4M moved · $1.8K in fees
Top partners: Ethereum · Arbitrum · BNB Chain
#Chainlink $LINK
```

```
New on #CCIP this week
Lanes: Ethereum → Tempo · Base → Monad · Plasma → Arc
Tokens: USDat on Ethereum (Saturn) · PST on Base (Huma Finance)
CCIP now runs 933 lanes between 93 chains
```

**Poll card caption (Telegram only):**

```
🔮 Last week: Base paid the most fees ($1.8K). 38% of you called it.
This week: will CCIP fees beat last week's $8.0K? Vote below.
```

The first poll has no "Last week" line.

## 6. The poll

1. **Close last week's poll.** On Monday, the run calls Telegram `stopPoll` on the message id saved in `meta` (`poll:<monday>` holds `{ chat_id, message_id, question_kind, options }`). Telegram returns each option's `voter_count`; the shares go into `moments.json`. A poll that can't be closed (deleted, or the call fails) keeps `votes: null`, and the card shows the answer without "called it".
2. **Work out last week's answer** from our data, and publish it.
3. **Post the card** (last week's result, if any, and this week's question).
4. **Send the poll** with `sendPoll` right after the card. Polls in a channel are anonymous. No close time is set; step 1 closes it a week later with `stopPoll`. Save its message id.

- **Outputs:**
  - `telegram-poll` is a new output, posted only to the chat the card went to: the channel in `on`, the drafts chat in `drafts`.
  - It has its own per-output key, so a failed poll is retried on its own and the card is not posted twice.
  - The poll has no X draft.
- **Limits:** a question is at most 300 characters and an option at most 100. Names are shortened to fit, with "…".

## 7. Cards

### 7.1 Routes

The card Worker's broadcast route gains six kinds, at 1200×675, with 3a's rules: no-store data loads, 404 when the data doesn't hold the moment, 500 with no-store on a failure, never the fallback card.
- `/og/broadcast/welcome/<selector>.png`
- `/og/broadcast/countdown/<metric>/<threshold>.png`
- `/og/broadcast/poll/<monday>.png`
- `/og/broadcast/movers/<monday>.png`
- `/og/broadcast/spotlight/<monday>.png`
- `/og/broadcast/roundup/<monday>.png`

Each card reads `moments.json`, plus `replay.json` and `chains.json` for its sky, and 404s when `moments.json` doesn't hold its moment or `replay.json` lacks the day it draws.

### 7.2 Per type (see the mockups)

- **Welcome:** a light-blue "★ Welcome to CCIP" pill; "Chain #N on CCIP"; the chain's name large; its first message and first-day totals. The new chain sits gold at the centre of its own sky, linked to its first partners. Strip: "Connected to …" and "Every chain: ccip.dev/chains".
- **Movers:** a gold "★ New #1" pill (or "▲ Top climber"); the board's title; the leader's name large; "took #1 from …"; up to 3 climbers with rank, board and places gained. The week's sky with the leader gold. Strip: the week's top token and busiest lane, and "Every board: ccip.dev/top/chain/7d/fees".
- **Countdown:** a violet "Countdown" pill; the metric's title; the milestone large; the days left at the pace; a progress bar from the last milestone to this one. A dimmed sky. Strip: the last milestone and "Every record: ccip.dev/records".
- **Spotlight:** the chain gold at the centre of its own sky, its partners around it. A glass panel: "▲ Fastest grower · vs last week", its name and rank, messages, value and fees with changes, top partners, top token. Strip: "Fastest-growing chain on CCIP this week" and "Every chain: ccip.dev/chains".
- **New on CCIP:** a green "New on CCIP" pill; up to 5 new lanes and 5 new tokens in two columns, "+N more" beyond. A dimmed sky. Strip: the network's size and "Watch every lane: ccip.dev/replay".
- **Poll:** two glass panels. Left, "Last week": the question, the answer with a ★, each option's share as a bar with the right answer gold, and "N% of you called it". Right, "This week": the question and lettered options. The first poll shows only the right panel, wider. Strip: "Vote in the poll below · results next Monday" and "Every week: ccip.dev/history".

Every ▲ ▼ ★ → is drawn as a glyph, as in 3a.

## 8. Docs

- **Runbook, "Moments":** the rhythm, the budget, the `MOMENTS` switch, the keys, how to re-post one, and the poll's `poll:<monday>` row.
- **Runbook, alerts:** `moments-publish`, `broadcast-telegram-poll:<key>`, `poll-close:<monday>`.
- **Methodology, "Moments":** how each moment is chosen (§5.1), in plain words.

## 9. Testing

- **Core and the Worker (real D1):**
  - arrivals on the first message day (not the registry day), the chain number, first partners;
  - countdown days left and the 2–7 window;
  - movers' boards, previous ranks, the headline order, the climber rule and the no-post case;
  - the spotlight's floors, the 4-week skip and the tie-break;
  - New on CCIP's Monday–Friday window and the welcomed-chain exclusion;
  - the poll's question turn, options and answer for all three kinds;
  - the `moments.json` schema, and its isolated publish.
- **Pipeline:**
  - the day each kind is planned;
  - the budget and its order, the 2-day carry-over, and the poll never deferred;
  - first-run seeding;
  - `MOMENTS` off/drafts/on combined with `BROADCASTS`;
  - the poll flow: close, answer, card, `sendPoll` and the saved id; a failed close; a poll retried alone.
- **Copy:** each kind within 280 for X and 1,024 for Telegram, the drop order, the subject-only tag rule, no URL, and escaping.
- **Cards:** each kind renders, 404s without its data, never needs a missing glyph, and matches its mockup.

## 10. Rollout

1. Deploy (moments ship `on`). The first run seeds what's due that day without posting. Moments also post publicly to X, up to 2 × $0.015 a day; the poll stays on Telegram.
2. The owner watches the channel through one full week: a Monday poll, Tuesday movers, Thursday spotlight, Saturday roundup.
3. `MOMENTS = "off"` in `worker/wrangler.toml` and a push stops them at any time.

## 10a. Risks

- **A wrong @handle is public.** Only verified handles are used, and an X post tags only its subject, which limits the spread.
- **Poll votes are only as good as Telegram's answer.** If `stopPoll` fails, the result posts without vote shares.
- **Quiet weeks.** Movers, spotlight and New on CCIP skip themselves when there's nothing to say, so some weeks will have fewer posts. That's by design.
