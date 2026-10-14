# ccip.dev: crediting direct sends to the token's project (via token)

**Status:** Draft for owner review · **Date:** 2026-10-14 · **Builds on:** `2026-10-14-sender-attribution-design.md`

In the week of 2026-10-07 to 2026-10-13 (12,401 messages, public CCIP API):
- **28.9%** came from labeled senders.
- **19.9%** came from unlabeled app contracts.
- **51.2%** came from wallets calling the CCIP router themselves (`sender = origin`).

99% of those direct sends move a token. Most are people bridging a token through its issuer's own bridge page, which has the wallet call the router directly. The project behind the activity is the token's issuer, but by sender those messages can only ever be "an address". The top 40 token groups carry 45% of all messages, and elizaOS alone carries 15.2%.

**Owner decision (2026-10-14):** credit those messages to the token's project, marked "via token", and aim label coverage at 80%.

## 1. The rule

A message is credited, in this order of precedence:
1. **Sent by:** its sender has a verified label (as now).
2. **Inferred:** its EVM sender is labeled on another EVM chain (as now).
3. **Via token:** its sender is the wallet that signed it (`sender = origin`, normalized), and its first token (`message_tokens.idx = 0`) belongs to a registry group that a verified project claims with a `[[tokens]]` entry.
4. **Address:** otherwise, its sender address across chains (as now).

Two consequences:
- A labeled wallet keeps its own label, because rule 1 wins.
- A message sent through an app contract is never credited via token: the contract is the sender.

**Who may claim a token:** the project that put the token on CCIP, i.e. the issuer whose token is a Cross-Chain Token. The proof is the project's own docs or announcement naming CCIP and the token's address, under the existing labeling rules (`docs/runbook.md`, "Labels and handles").
- General-purpose assets that no single app's users bridge (USDC, LINK, cbBTC and the like) are not claimed by their issuers. Their direct sends stay addresses.
- A `[[tokens]]` entry no longer needs an `x` to count for attribution. The `x` is still needed for a token's project to be tagged in posts.

## 2. Storage

The rollup adds one breakdown dimension, `via_token`, keyed `<src_selector>:<sender>|<token_group_or_token>`.
- It covers the day's direct sends (`sender = origin`) that carry a token. Each row holds messages, usd_value and fee_usd.
- The key uses the token's registry group id. A token with no group falls back to `<chain>:<address>`.
- The `sender` dimension is unchanged. At publish time, a sender row's via-token part is moved from the address to the project, so the per-chain keys and every old file keep their meaning.

**Backfill:** a migration fills `via_token` from `messages` joined with `message_tokens` and `tokens`, one month per statement. It goes back to the first day with an `origin`. Days before that stay sender-only, and the methodology says so.

## 3. Ranking, coverage and surfaces

**Identity merge (core `senders.ts`):**
- An identity gains `via_token_messages` (plus usd and fees), alongside its sent-by totals.
- Its `inferred` stays as it is. It gains `via_token: true` when every one of its messages came via token.
- A project's totals are sent-by plus via-token. The address identities lose the moved messages.

**Coverage:** `label_coverage` gains `via_token_messages_pct`, `via_token_usd_pct` and `via_token_fees_pct`. `messages_pct` becomes sent-by plus inferred plus via token. The status line reads:

> Labeled: 74% of messages (29% sent by a labeled project, 45% via its token), 61% of value (last 7 days).

**Top › Senders, the day page and the cards:**
- A row whose project has via-token messages shows a "via token" mark: "via token" or "incl. 1,889 via token".
- The title text says what that means.

**Daily and weekly copy:**
- `Top sender: elizaOS · 1,889 messages (15%)`.
- When at least half its messages came via token, the name gets " via its token": `Top sender: elizaOS via its token · …`.

**Mentions policy:** unchanged. The daily and weekly top sender is never tagged. A via-token-only identity is never tagged in any post, like an inferred one. The New on CCIP and spotlight moments tag a project only when it has sent-by messages and a verified `x`.

**projects.json and the project pages:** totals include via token. Each page shows the split ("sent by its contracts" and "via its token, by wallets bridging it") and lists its claimed tokens.

**Candidates job:**
- Its coverage line matches the status page's.
- A new section, "Tokens to claim", lists the busiest token groups by direct sends whose group no project claims, with symbol, name and an explorer link.
- The existing token handle gaps fold into that section.

## 4. Testing

- **Core:**
  - precedence: sent by, then inferred, then via token, then address;
  - a labeled wallet keeps its label;
  - a contract sender is never credited via token;
  - a token with no group falls back to its own key;
  - the merge moves a direct send from the address to the project;
  - coverage maths with the via-token split.
- **Worker:**
  - the rollup writes `via_token` rows for direct sends only;
  - the migration backfill on a fixture equals the rollup;
  - publish moves via-token messages and writes the new fields;
  - copy says "via its token" at 50% or more;
  - a via-token-only project is never tagged.
- **Site:** the via-token mark, the coverage line and the project page split.
- **Script:** the "Tokens to claim" section.

## 5. Shipping

- **The Worker first.** A new migration adds the backfill, the rollup and publish follow, and the old fields are kept. The site follows.
- **Labels.** A label sprint claims the top token groups for their issuers, under §1's proof rule, in one pull request for the owner.
- **No other owner step.**

## 6. Out of scope

- Attributing direct sends of general-purpose assets (USDC, LINK, cbBTC).
- Crediting by the app a wallet used, when that app isn't the sender (front-ends that build the router call client-side). Only the token says who's behind it.
- Re-keying the `sender` dimension.
