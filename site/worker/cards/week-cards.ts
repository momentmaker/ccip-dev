import { formatCount, formatFeeTotal, formatUsd, formatUtcDay } from '@ccip-dev/core/format';
import { calledShare, roundupOf } from '@ccip-dev/core/moments';
import { chainName, laneLabel, shortAddress, type ChainNames } from '@ccip-dev/core/names';
import type { Poll, PollKind } from '@ccip-dev/core/public';
import { addDays } from '@ccip-dev/core/time';
import { h, type Child, type VNode } from '../h';
import {
  bold, broadcastFrame, cardDays, COLORS, ellipsized, eyebrow, fitName, hasReplayDay, iconsFor, loadMomentFiles, momentColumn, namesOf, pill, PILLS, row, skyFor, TEXT_COLUMN, type BroadcastInputs,
} from './broadcast-frame';
import { HISTORY_CTA, REPLAY_CTA } from './cta';
import { glyph } from './glyphs';
import { skyNodes } from './orbit-sky';

export const ROUNDUP_SHOWN = 5;

const plural = (n: number, word: string) => `${formatCount(n)} new ${word}${n === 1 ? '' : 's'}`;

function roundupColumn(title: string, items: readonly VNode[], total: number, width: number): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width } },
    eyebrow(title, { fontSize: 18 }),
    ...items,
    total > items.length ? row([`+${total - items.length} more`], { fontSize: 22, marginTop: 10, color: COLORS.muted }) : null,
  );
}

const ITEM_INSET = 10;
/** Lanes need the room, so they get the wider column; a list alone takes the whole text column. */
const columnWidths = (hasLanes: boolean, hasTokens: boolean) => (hasLanes && hasTokens ? { lanes: 380, tokens: 280 } : { lanes: 640, tokens: 640 });
const item = (children: readonly Child[], width: number) => row(children, { fontSize: 24, marginTop: 10, color: COLORS.soft, width });

const symbolOf = (key: string) => shortAddress(key.slice(key.indexOf(':') + 1));

/** Monday to Friday's new lanes and tokens, up to 5 of each, over a dimmed sky of those days. */
export async function roundupTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const files = await loadMomentFiles(inputs);
  if (files === null) return null;
  const { moments, replay, chains } = files;
  const roundup = roundupOf(moments, monday);
  const friday = addDays(monday, 4);
  if (roundup === null || !hasReplayDay(replay, friday)) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, monday, friday, { dim: true, starFree: [TEXT_COLUMN] });
  const { lanes: laneWidth, tokens: tokenWidth } = columnWidths(roundup.lanes.length > 0, roundup.tokens.length > 0);
  const lanes = roundup.lanes.slice(0, ROUNDUP_SHOWN).map((l) => item([fitName(laneLabel(names, l.key), 24, COLORS.strong, 700, { flex: 1 })], laneWidth - ITEM_INSET));
  const tokens = roundup.tokens.slice(0, ROUNDUP_SHOWN).map((t) =>
    item(
      [
        h('div', { style: { ...ellipsized, whiteSpace: 'pre', maxWidth: 150, fontWeight: 700, color: COLORS.strong } }, `${t.symbol ?? symbolOf(t.key)} `),
        h('div', { style: ellipsized }, `on ${chainName(names, t.chains[0] ?? '')}`),
      ],
      tokenWidth - ITEM_INSET,
    ),
  );
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `This week · ${cardDays(monday, friday)}`,
    body: momentColumn(
      pill('NEW ON CCIP', PILLS.green),
      h(
        'div',
        { style: { display: 'flex', marginTop: 24 } },
        lanes.length === 0 ? null : roundupColumn(plural(roundup.lanes.length, 'lane'), lanes, roundup.lanes.length, laneWidth),
        tokens.length === 0 ? null : roundupColumn(plural(roundup.tokens.length, 'token'), tokens, roundup.tokens.length, tokenWidth),
      ),
    ),
    insight: ['CCIP now runs ', bold(`${formatCount(moments.network.lanes)} lanes`), ' between ', bold(`${formatCount(moments.network.chains)} chains`)],
    cta: REPLAY_CTA,
  });
}

const PAST_QUESTION: Record<PollKind, string> = {
  fee_chain: 'Which chain paid the most fees?',
  fees_change: 'Did CCIP fees beat the week before?',
  lane: 'Which lane moved the most value?',
};

function answerRow(poll: Poll): VNode | null {
  const o = poll.outcome;
  if (o === null) return null;
  const label = poll.question_kind === 'fees_change' ? (poll.options.find((x) => x.key === poll.answer)?.label ?? o.label) : o.label;
  const value = poll.question_kind === 'lane' ? formatUsd(o.value) : formatFeeTotal(o.value);
  const size = poll.question_kind === 'lane' ? 28 : 34;
  return row(
    [glyph('star', 20, COLORS.gold, { right: 10 }), fitName(label, size, COLORS.strong, 800), h('span', { style: { color: COLORS.muted, marginLeft: 8, flexShrink: 0 } }, `· ${value}`)],
    { fontSize: size, fontWeight: 800, marginTop: 10 },
  );
}

function shareBar(label: string, pct: number, answer: boolean): VNode {
  return row(
    [
      h('div', { style: { display: 'flex', width: 240, marginRight: 12, flexShrink: 0 } }, fitName(label, 20, answer ? COLORS.strong : COLORS.soft, 700)),
      h('div', { style: { display: 'flex', width: 130, height: 14, borderRadius: 7, backgroundColor: '#18202e', flexShrink: 0 } }, h('div', { style: { width: Math.round(1.3 * pct), height: 14, borderRadius: 7, backgroundColor: answer ? COLORS.gold : '#3a4a68' } })),
      h('span', { style: { marginLeft: 12, color: answer ? COLORS.gold : COLORS.muted, fontWeight: 700 } }, `${pct}%`),
    ],
    { fontSize: 20, marginTop: 8 },
  );
}

const MAX_OPTIONS = 4;

const PANEL = { display: 'flex', flexDirection: 'column', padding: '24px 28px', borderRadius: 22 };

function lastWeekPanel(last: Poll): VNode {
  const called = calledShare(last);
  return h(
    'div',
    { style: { ...PANEL, width: 500, backgroundColor: 'rgba(10,13,19,0.82)', border: '1px solid #233047' } },
    eyebrow('Last week', { fontSize: 18 }),
    h('div', { style: { fontSize: 24, color: COLORS.soft, marginTop: 10 } }, PAST_QUESTION[last.question_kind]),
    answerRow(last),
    ...(last.votes === null ? [] : last.options.map((o, i) => shareBar(o.label, last.votes![i] ?? 0, o.key === last.answer))),
    called === null ? null : h('div', { style: { fontSize: 22, color: COLORS.gold, fontWeight: 700, marginTop: 14 } }, `${called}% of you called it`),
  );
}

/** A question wraps over as many lines as it needs, in a size that shrinks as it grows to the 300 characters a poll allows. */
const questionSize = (text: string) => (text.length <= 50 ? 34 : text.length <= 100 ? 28 : 22);

function thisWeekPanel(poll: Poll, width: number): VNode {
  const letter = (i: number) =>
    h('div', { style: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1d2a44', color: '#9cc0ff', fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 } }, String.fromCharCode(65 + i));
  return h(
    'div',
    { style: { ...PANEL, width, backgroundColor: 'rgba(16,24,44,0.85)', border: '1px solid #2c4a8a' } },
    eyebrow('This week', { fontSize: 18, color: '#9cc0ff' }),
    h('div', { style: { fontSize: questionSize(poll.question), fontWeight: 800, color: COLORS.strong, marginTop: 10, lineHeight: 1.2 } }, poll.question),
    ...poll.options.slice(0, MAX_OPTIONS).map((o, i) => row([letter(i), fitName(o.label, 24, COLORS.strong, 700, { flex: 1 })], { marginTop: 10 })),
  );
}

/** Last week's answer and how the votes went beside this week's question; the first poll shows its question alone, wider. */
export async function pollTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const files = await loadMomentFiles(inputs);
  if (files === null) return null;
  const { moments, replay, chains } = files;
  const poll = moments.polls.find((p) => p.week === monday);
  const last = moments.polls.find((p) => p.week === addDays(monday, -7) && p.answer !== null) ?? null;
  const sunday = addDays(monday, -1);
  if (poll === undefined || !hasReplayDay(replay, sunday)) return null;
  const names: ChainNames = namesOf(replay, chains);
  const sky = skyFor(replay, names, addDays(monday, -7), sunday, { dim: true, starFree: [{ x: 40, y: 40, width: 1120, height: 560 }] });
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Prediction · Week of ${formatUtcDay(monday)}`,
    body: h(
      'div',
      { style: { position: 'absolute', left: 52, top: 112, width: 1096, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
      last === null ? null : lastWeekPanel(last),
      thisWeekPanel(poll, last === null ? 1096 : 560),
    ),
    insight: ['Vote in the poll below · results next Monday'],
    cta: HISTORY_CTA,
  });
}
