import { z } from 'zod';
import { issuePath } from './http';
import { shortChainName } from './names';
import type { DayTotals, LargestFee, ReplayFile } from './public';
import { RECORD_KINDS, recordsSetOn, type RecordSet } from './records';
import { addDays, daysBetween } from './time';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

/** The monthly video: 30 s, square, under 50 MB (Telegram's limit for a bot's upload), at this key in the archive bucket. */
export const MONTHLY_VIDEO = { width: 1024, height: 1024, durationS: 30, maxBytes: 50_000_000 } as const;
/** The monthly video posts on the 1st to the 3rd of the next month (UTC). */
export const MONTHLY_POST_DAYS = 3;

export const monthlyVideoKey = (month: string) => `videos/monthly/${month}.mp4`;
/** The month summary the video's end card was drawn from, recorded with it: the post's caption is written from it. */
export const monthlySummaryKey = (month: string) => `videos/monthly/${month}.json`;

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

/** What history.json and replay.json publish, as the month page reads them. */
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
  const chain = (index: number | undefined): MonthChain | null => {
    const c = index === undefined ? undefined : replay.chains[index];
    return c ? { selector: c.selector, name: shortChainName(c) } : null;
  };
  const lanes = [...usd].flatMap(([lane, value]) => {
    const ends = replay.lanes[lane];
    const src = chain(ends?.[0]);
    const dst = chain(ends?.[1]);
    return src && dst ? [{ key: `${src.selector}>${dst.selector}`, src, dst, usd: value }] : [];
  });
  lanes.sort((a, b) => b.usd - a.usd || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return lanes[0] ?? null;
}

/** The month's totals and highlights, from the files the month page plays: its end card shows them. */
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

/** What the record hook hands over as summary.json, and the workflow puts at monthlySummaryKey. */
export interface MonthlySummaryFile {
  month: string;
  summary: MonthSummary;
}

const MonthChainSchema = z.object({ selector: z.string(), name: z.string() });
const RecordValueSchema = z.object({ day: z.string(), value: z.number() });

export const MonthlySummaryFileSchema = z.object({
  month: z.string(),
  summary: z.object({
    month: z.string(),
    label: z.string(),
    messages: z.number(),
    usd: z.number(),
    fees: z.number().nullable(),
    linkSharePct: z.number().nullable(),
    records: z.array(RecordValueSchema.extend({ kind: z.enum(RECORD_KINDS), previous: RecordValueSchema, stoodDays: z.number() })),
    joined: z.array(MonthChainSchema),
    busiestLane: z.object({ key: z.string(), src: MonthChainSchema, dst: MonthChainSchema, usd: z.number() }).nullable(),
  }),
});

/** The summary in a summary.json for `month`, or what is wrong with the file. */
export function parseMonthlySummary(text: string, month: string): { summary: MonthSummary } | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problem: 'is not JSON' };
  }
  const parsed = MonthlySummaryFileSchema.safeParse(json);
  if (!parsed.success) return { problem: `is not a month summary (${issuePath(parsed.error)}: ${parsed.error.issues[0]?.message ?? 'invalid'})` };
  const named = [parsed.data.month, parsed.data.summary.month].find((m) => m !== month);
  if (named !== undefined) return { problem: `is for ${named}, not ${month}` };
  return { summary: parsed.data.summary };
}
