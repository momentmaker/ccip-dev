import { z } from 'zod';
import { formatFeeTotal } from './format';
import { POLL_KINDS, type BoardEntry, type DayTotals, type MomentsFile, type MomentsWeek, type Poll, type PollKind } from './public';
import { feeCoverageComplete, feeThresholds, messageThresholds, MILESTONE_METRICS, trackedMilestones, valueThresholds, type MilestoneMetric } from './records';
import { addDays, dayStartIso } from './time';

export type MomentsBody = Omit<MomentsFile, 'schema_version' | 'updated_at' | 'attribution'>;
export type ChainArrival = MomentsFile['arrivals']['chains'][number];
export type LaneArrival = MomentsFile['arrivals']['lanes'][number];
export type TokenArrival = MomentsFile['arrivals']['tokens'][number];
export type Countdown = MomentsFile['countdowns'][number];

const DAY_MS = 86_400_000;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cents = (v: number) => Math.round(v * 100) / 100;

/** The ISO 8601 week number: the week holding the year's first Thursday is week 1. */
export function isoWeek(day: string): number {
  const date = Date.parse(dayStartIso(day));
  const thursday = new Date(date + (3 - ((new Date(date).getUTCDay() + 6) % 7)) * DAY_MS);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1;
}

/** Shortens `text` to at most `max` UTF-16 units, as Telegram counts, ending it with "…". */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length + 1 > max) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

export const BOARDS = ['fee_chains', 'tokens', 'lanes'] as const;
export type BoardName = (typeof BOARDS)[number];
export const BOARD_SIZE = 10;
export const CLIMB_MIN = 3;
export const MAX_CLIMBERS = 3;

/** This week's top 10, each with its rank the week before, or null when it was outside that week's top 10. */
export function rankBoard(current: readonly { key: string; label: string | null; value: number }[], previous: readonly { key: string }[]): BoardEntry[] {
  const before = new Map(previous.slice(0, BOARD_SIZE).map((e, i) => [e.key, i + 1]));
  return current.slice(0, BOARD_SIZE).map((e, i) => ({ key: e.key, label: e.label, value: e.value, rank: i + 1, previous_rank: before.get(e.key) ?? null }));
}

export interface Climber {
  board: BoardName;
  entry: BoardEntry;
  /** Places gained; null for an entry that came from outside the top 10. */
  gain: number | null;
}

export type MoversHeadline =
  | { kind: 'leader'; board: BoardName; entry: BoardEntry; dethroned: BoardEntry | null }
  | { kind: 'climber'; climber: Climber };

export interface Movers {
  monday: string;
  headline: MoversHeadline;
  climbers: Climber[];
}

/** An entry from outside the top 10 climbed at least from #11. */
const climbed = (c: Climber) => c.gain ?? BOARD_SIZE + 1 - c.entry.rank;

/**
 * The week's movers against the week before: a new #1 (fees, then tokens, then lanes) or else the top climber leads,
 * and up to 3 climbers follow. A board empty in either week is not compared, so a week without data names no mover.
 */
export function moversOf(weeks: readonly MomentsWeek[], monday: string): Movers | null {
  const week = weeks.find((w) => w.week === monday);
  const before = weeks.find((w) => w.week === addDays(monday, -7));
  if (!week || !before) return null;
  const boards = BOARDS.filter((b) => week.boards[b].length > 0 && before.boards[b].length > 0);
  const climbers = boards
    .flatMap((board) =>
      week.boards[board]
        .filter((e) => e.previous_rank === null || e.previous_rank - e.rank >= CLIMB_MIN)
        .map((entry): Climber => ({ board, entry, gain: entry.previous_rank === null ? null : entry.previous_rank - entry.rank })),
    )
    .sort((a, b) => climbed(b) - climbed(a) || BOARDS.indexOf(a.board) - BOARDS.indexOf(b.board) || a.entry.rank - b.entry.rank);
  for (const board of boards) {
    const top = week.boards[board][0]!;
    if (top.previous_rank === 1) continue;
    const others = climbers.filter((c) => !(c.board === board && c.entry.key === top.key));
    return { monday, headline: { kind: 'leader', board, entry: top, dethroned: before.boards[board][0] ?? null }, climbers: others.slice(0, MAX_CLIMBERS) };
  }
  const [first, ...rest] = climbers;
  return first ? { monday, headline: { kind: 'climber', climber: first }, climbers: rest.slice(0, MAX_CLIMBERS) } : null;
}

/** The first week whose spotlight can be posted; a pick before it was never posted, so it never makes a chain skip a week. */
export const SPOTLIGHT_SINCE = '2026-10-05';
export const SPOTLIGHT_MIN_MESSAGES = 100;
export const SPOTLIGHT_MIN_PREVIOUS = 50;
export const SPOTLIGHT_SKIP_WEEKS = 4;

export interface ChainCount {
  selector: string;
  messages: number;
  previous: number;
  firstDay: string;
}

export interface SpotlightWeek {
  monday: string;
  chains: readonly ChainCount[];
}

/**
 * The fastest grower by messages, week over week. A chain needs 100 messages this week and 50 the week before, and a
 * first message before that week began (a partial first week would inflate its rise). Ties go to more messages, then
 * the selector.
 */
export function spotlightPick(week: SpotlightWeek, recent: ReadonlySet<string>): string | null {
  const weekBefore = addDays(week.monday, -7);
  const candidates = week.chains.filter(
    (c) =>
      c.messages >= SPOTLIGHT_MIN_MESSAGES && c.previous >= SPOTLIGHT_MIN_PREVIOUS && c.firstDay <= weekBefore && c.messages > c.previous && !recent.has(c.selector),
  );
  candidates.sort((a, b) => b.messages * a.previous - a.messages * b.previous || b.messages - a.messages || compare(a.selector, b.selector));
  return candidates[0]?.selector ?? null;
}

/** Each week's pick, in week order, skipping a chain picked in the 4 weeks before from SPOTLIGHT_SINCE on. */
export function spotlightPicks(weeks: readonly SpotlightWeek[]): Map<string, string | null> {
  const picks = new Map<string, string | null>();
  for (const week of [...weeks].sort((a, b) => compare(a.monday, b.monday))) {
    const recent = new Set<string>();
    for (let i = 1; i <= SPOTLIGHT_SKIP_WEEKS; i++) {
      const monday = addDays(week.monday, -7 * i);
      const pick = monday >= SPOTLIGHT_SINCE ? picks.get(monday) : undefined;
      if (pick) recent.add(pick);
    }
    picks.set(week.monday, spotlightPick(week, recent));
  }
  return picks;
}

export const COUNTDOWN_PACE_DAYS = 7;

const METRIC_OF: Record<MilestoneMetric, (d: DayTotals) => number> = {
  messages: (d) => d.messages,
  value: (d) => d.usd_value,
  fees: (d) => d.fee_usd ?? 0,
};

/** The Records page's thresholds, far enough past the total to hold the next one. */
const THRESHOLDS: Record<MilestoneMetric, (total: number) => number[]> = {
  messages: (total) => messageThresholds(Math.max(total, 1_000) * 10),
  value: (total) => valueThresholds(Math.max(total, 1e9) * 10),
  fees: (total) => feeThresholds(Math.max(total, 1e6) * 10, 1e6),
};

/** For each tracked metric, the next threshold not yet crossed, at the pace of the last 7 finalized days. */
export function countdownsOf(days: readonly DayTotals[]): Countdown[] {
  const sorted = [...days].sort((a, b) => compare(a.day, b.day));
  const recent = sorted.slice(-COUNTDOWN_PACE_DAYS);
  if (recent.length < COUNTDOWN_PACE_DAYS) return [];
  const milestones = trackedMilestones(sorted);
  return MILESTONE_METRICS.flatMap((metric) => {
    if (metric === 'fees' && !feeCoverageComplete(sorted)) return [];
    const pick = METRIC_OF[metric];
    const total = sorted.reduce((sum, d) => sum + pick(d), 0);
    const perDay = recent.reduce((sum, d) => sum + pick(d), 0) / COUNTDOWN_PACE_DAYS;
    const threshold = THRESHOLDS[metric](total).find((t) => t > total);
    if (threshold === undefined || perDay <= 0) return [];
    const last = milestones.filter((m) => m.metric === metric).at(-1);
    return [{
      metric,
      threshold,
      total: cents(total),
      per_day: cents(perDay),
      days_left: Math.ceil((threshold - total) / perDay),
      previous: last ? { threshold: last.threshold, day: last.day } : null,
    }];
  });
}

export const ROUNDUP_DAYS = 5;

/** Monday to Friday's new lanes and tokens, by first-day value; a lane of a chain whose welcome falls in the week is left out. */
export function roundupOf(m: Pick<MomentsBody, 'arrivals'>, monday: string): { lanes: LaneArrival[]; tokens: TokenArrival[] } | null {
  const friday = addDays(monday, ROUNDUP_DAYS - 1);
  const inWeek = (day: string) => day >= monday && day <= friday;
  const welcomed = new Set(m.arrivals.chains.filter((c) => c.day >= addDays(monday, -1) && c.day <= friday).map((c) => c.selector));
  const byValue = <T extends { usd: number; key: string }>(a: T, b: T) => b.usd - a.usd || compare(a.key, b.key);
  const lanes = m.arrivals.lanes.filter((l) => inWeek(l.day) && !l.key.split('>').some((s) => welcomed.has(s))).sort(byValue);
  const tokens = m.arrivals.tokens.filter((t) => inWeek(t.day)).sort(byValue);
  return lanes.length + tokens.length === 0 ? null : { lanes, tokens };
}

export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 100;
export const POLL_CHOICES = 3;
export const FEES_BAND_PCT = 10;
export const OTHER = 'other';

export interface PollChoice {
  key: string;
  label: string;
}

/** Last week's figures a poll asks about: the top fee chains and lanes, best first, and the fee total. */
export interface PollData {
  feeChains: readonly PollChoice[];
  lanes: readonly PollChoice[];
  feeTotal: number | null;
}

export type PollQuestion = Pick<Poll, 'week' | 'question_kind' | 'question' | 'options'>;

export function pollKindFor(monday: string): PollKind {
  return POLL_KINDS[isoWeek(monday) % POLL_KINDS.length]!;
}

const QUESTIONS: Record<PollKind, (d: PollData) => { question: string; options: PollChoice[] } | null> = {
  fee_chain: (d) =>
    d.feeChains.length === 0
      ? null
      : { question: 'Which chain will pay the most CCIP fees this week?', options: [...d.feeChains.slice(0, POLL_CHOICES), { key: OTHER, label: 'Another chain' }] },
  fees_change: (d) =>
    d.feeTotal === null || d.feeTotal <= 0
      ? null
      : {
          question: `Will CCIP fees beat last week's ${formatFeeTotal(d.feeTotal)}?`,
          options: [
            { key: 'up', label: `Up more than ${FEES_BAND_PCT}%` },
            { key: 'within', label: `Within ${FEES_BAND_PCT}%` },
            { key: 'down', label: `Down more than ${FEES_BAND_PCT}%` },
          ],
        },
  lane: (d) =>
    d.lanes.length === 0
      ? null
      : { question: 'Which lane will move the most value this week?', options: [...d.lanes.slice(0, POLL_CHOICES), { key: OTHER, label: 'Another lane' }] },
};

/** The week's question: ISO week mod 3 picks the kind, and a kind last week's data cannot ask falls through to the next. */
export function pollQuestion(monday: string, data: PollData): PollQuestion | null {
  const first = POLL_KINDS.indexOf(pollKindFor(monday));
  for (let i = 0; i < POLL_KINDS.length; i++) {
    const kind = POLL_KINDS[(first + i) % POLL_KINDS.length]!;
    const asked = QUESTIONS[kind](data);
    if (asked) {
      return {
        week: monday,
        question_kind: kind,
        question: clip(asked.question, POLL_QUESTION_MAX),
        options: asked.options.map((o) => ({ key: o.key, label: clip(o.label, POLL_OPTION_MAX) })),
      };
    }
  }
  return null;
}

export interface PollLeader {
  key: string;
  label: string;
  value: number;
}

/** What the poll's own week turned out to be. */
export interface PollResult {
  feeChain: PollLeader | null;
  lane: PollLeader | null;
  feeTotal: number | null;
  previousFeeTotal: number | null;
}

const optionFor = (options: readonly PollChoice[], key: string) => (options.some((o) => o.key === key) ? key : OTHER);

export function pollAnswer(poll: Pick<Poll, 'question_kind' | 'options'>, result: PollResult): Pick<Poll, 'answer' | 'outcome'> {
  const none = { answer: null, outcome: null };
  if (poll.question_kind === 'fees_change') {
    const { feeTotal, previousFeeTotal } = result;
    if (feeTotal === null || previousFeeTotal === null || previousFeeTotal <= 0) return none;
    const pct = ((feeTotal - previousFeeTotal) / previousFeeTotal) * 100;
    const answer = pct > FEES_BAND_PCT ? 'up' : pct < -FEES_BAND_PCT ? 'down' : 'within';
    return { answer, outcome: { key: 'fees', label: 'CCIP fees', value: feeTotal, change_pct: Math.round(pct * 10) / 10 } };
  }
  const leader = poll.question_kind === 'fee_chain' ? result.feeChain : result.lane;
  if (leader === null) return none;
  return { answer: optionFor(poll.options, leader.key), outcome: { key: leader.key, label: leader.label, value: leader.value, change_pct: null } };
}

/** The share of voters who picked the answer, once the poll is answered and was closed with votes. */
export function calledShare(poll: Pick<Poll, 'options' | 'answer' | 'votes' | 'total_votes'>): number | null {
  const at = poll.options.findIndex((o) => o.key === poll.answer);
  return at < 0 || poll.votes === null || !poll.total_votes ? null : (poll.votes[at] ?? null);
}

/** Each option's share of the votes, in whole percent. */
export function voteShares(voters: readonly number[]): number[] {
  const total = voters.reduce((sum, n) => sum + n, 0);
  return voters.map((n) => (total === 0 ? 0 : Math.round((n * 100) / total)));
}

/**
 * What the Worker keeps in D1 `meta` under `poll:<monday>` once a poll is sent, with its voter counts once it is closed.
 * `closed: 'unavailable'` marks a poll Telegram had already closed, or whose message was deleted: it has no counts and is
 * never tried again.
 */
export const PollRecordSchema = z.object({
  chat_id: z.string(),
  message_id: z.number().int(),
  question_kind: z.enum(POLL_KINDS),
  question: z.string(),
  options: z.array(z.object({ key: z.string(), label: z.string() })),
  voters: z.array(z.number()).optional(),
  total_voters: z.number().optional(),
  closed: z.literal('unavailable').optional(),
});
export type PollRecord = z.infer<typeof PollRecordSchema>;

export const pollRecordKey = (monday: string) => `poll:${monday}`;

/** A row that is missing, not JSON or not a poll record reads as no poll. */
export function parsePollRecord(raw: string | null): PollRecord | null {
  if (raw === null) return null;
  try {
    const parsed = PollRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
