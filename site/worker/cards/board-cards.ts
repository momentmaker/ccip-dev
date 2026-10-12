import { formatCount, formatFeeTotal, formatShare, formatUsd } from '@ccip-dev/core/format';
import { moversOf, type BoardName, type Climber } from '@ccip-dev/core/moments';
import { chainName, laneLabel, shortAddress, type ChainNames } from '@ccip-dev/core/names';
import type { BoardEntry } from '@ccip-dev/core/public';
import { addDays } from '@ccip-dev/core/time';
import { h, type Child, type VNode } from '../h';
import {
  bigText, bold, boldArrows, broadcastFrame, cardWeek, COLORS, columnLine, eyebrow, hasReplayDay, hubSky, iconsFor, momentColumn, nameSize, namesOf, pill, PILLS, row,
  skyFor, TEXT_COLUMN, type BroadcastInputs,
} from './broadcast-frame';
import { BOARDS_CTA, CHAINS_CTA } from './cta';
import { glyph, withArrows } from './glyphs';
import { skyNodes } from './orbit-sky';

const BOARD_TITLES: Record<BoardName, string> = {
  fee_chains: 'Most fees paid to CCIP this week',
  tokens: 'Most value moved by a token this week',
  lanes: 'Most value moved on a lane this week',
};
const BY: Record<BoardName, string> = { fee_chains: 'by fees', tokens: 'by value', lanes: 'by value' };

/** Characters the insight strip holds beside the call to action before its text is cut. */
const INSIGHT_ROOM = { both: 56, lane: 48 };

const addressOf = (key: string) => key.slice(key.indexOf(':') + 1);

function entryName(board: BoardName, entry: BoardEntry, names: ChainNames): string {
  if (board === 'fee_chains') return chainName(names, entry.key);
  if (board === 'tokens') return entry.label ?? shortAddress(addressOf(entry.key));
  return laneLabel(names, entry.key);
}

/** The chain to light gold: a token's chain, a lane's source. */
function goldOf(board: BoardName, key: string): string {
  if (board === 'fee_chains') return key;
  return board === 'tokens' ? key.slice(0, key.indexOf(':')) : (key.split('>')[0] ?? key);
}

const valueText = (board: BoardName, value: number) => (board === 'fee_chains' ? `${formatFeeTotal(value)} in fees` : `${formatUsd(value)} moved`);

/** A name at headline size; a lane's arrow is drawn as a glyph, since the card fonts have none. */
function headlineName(text: string): VNode {
  const size = nameSize(text);
  if (!text.includes(' → ')) return bigText(text, size, 'rgba(255,207,90,0.35)');
  return row(withArrows(text, Math.round(size * 0.55), '#ffffff'), { fontSize: size, fontWeight: 800, letterSpacing: -2, color: '#ffffff', marginTop: 6, flexWrap: 'wrap', maxWidth: 660 });
}

const ellipsized = { display: 'flex', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 } as const;
const climberSize = (text: string) => (text.length <= 22 ? 22 : text.length <= 34 ? 20 : 18);

/** A name that gives way to an ellipsis rather than a cut glyph; a lane's two ends shrink separately around their arrow. */
function climberName(text: string): VNode {
  const size = climberSize(text);
  const parts = text.split(' → ');
  const style = { ...ellipsized, fontWeight: 700, color: COLORS.strong, fontSize: size };
  return row(
    parts.flatMap((part, i): Child[] => [...(i > 0 ? [glyph('right', Math.round(size * 0.8), COLORS.strong, { left: 8, right: 8 })] : []), h('div', { style }, part)]),
    { flex: 1, minWidth: 0 },
  );
}

function climberRow(c: Climber, names: ChainNames): VNode {
  const gain: Child[] = c.gain === null ? ['new'] : [glyph('up', 16, COLORS.up, { right: 6 }), String(c.gain)];
  return row(
    [
      h('div', { style: { width: 56, flexShrink: 0, fontFamily: 'JetBrains Mono', fontWeight: 800, color: COLORS.strong, fontSize: 26 } }, `#${c.entry.rank}`),
      climberName(entryName(c.board, c.entry, names)),
      h('div', { style: { width: 110, flexShrink: 0, marginLeft: 16, color: COLORS.muted } }, BY[c.board]),
      row(gain, { width: 56, flexShrink: 0, color: COLORS.up }),
    ],
    { fontSize: 24, marginTop: 10 },
  );
}

/** The week's new #1 (or top climber) big, gold in the week's sky, with up to 3 climbers under it. */
export async function moversTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [moments, replay, chains] = await Promise.all([inputs.load('moments.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const movers = moversOf(moments.weeks, monday);
  const week = moments.weeks.find((w) => w.week === monday);
  const sunday = addDays(monday, 6);
  if (movers === null || week === undefined || !hasReplayDay(replay, sunday)) return null;
  const names = namesOf(replay, chains);
  const head = movers.headline;
  const lead = head.kind === 'leader' ? { board: head.board, entry: head.entry } : { board: head.climber.board, entry: head.climber.entry };
  const sky = skyFor(replay, names, monday, sunday, { gold: goldOf(lead.board, lead.entry.key), starFree: [TEXT_COLUMN] });
  const detail: Child[] =
    head.kind === 'leader'
      ? [valueText(head.board, head.entry.value), ...(head.dethroned ? [' · took #1 from ', boldArrows(entryName(head.board, head.dethroned, names), 18)] : [])]
      : [head.climber.gain === null ? `New in the top 10 at #${head.climber.entry.rank}` : `Up ${head.climber.gain} places to #${head.climber.entry.rank}`, ` · ${valueText(head.climber.board, head.climber.entry.value)}`];
  const topToken = week.boards.tokens[0];
  const busiest = week.boards.lanes[0];
  const tokenName = topToken ? entryName('tokens', topToken, names) : '';
  const laneName = busiest ? laneLabel(names, busiest.key) : '';
  const showLane = busiest !== undefined && INSIGHT_ROOM.lane >= `Busiest lane: ${laneName}`.length;
  const showToken = topToken !== undefined && INSIGHT_ROOM.both >= `Top token: ${tokenName} · Busiest lane: ${showLane ? laneName : ''}`.length;
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Leaderboards · ${cardWeek(monday)}`,
    body: momentColumn(
      head.kind === 'leader' ? pill('NEW #1', PILLS.gold, 'star') : pill('TOP CLIMBER', PILLS.gold, 'up'),
      eyebrow(head.kind === 'leader' ? BOARD_TITLES[lead.board] : `Biggest climb ${BY[lead.board]} this week`, { marginTop: 24 }),
      headlineName(entryName(lead.board, lead.entry, names)),
      columnLine(detail),
      movers.climbers.length === 0
        ? null
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', marginTop: 22, paddingTop: 12, borderTop: '1px solid #1f2a3c', width: 600 } },
            eyebrow(head.kind === 'leader' ? 'Climbers' : 'Also climbing', { fontSize: 16 }),
            ...movers.climbers.map((c) => climberRow(c, names)),
          ),
    ),
    insight: [
      ...(showToken ? ['Top token: ', bold(tokenName)] : []),
      ...(showToken && showLane ? [' · '] : []),
      ...(showLane ? ['Busiest lane: ', boldArrows(laneName, 16)] : []),
    ],
    cta: BOARDS_CTA,
  });
}

const chainSize = (text: string) => (text.length <= 10 ? 56 : text.length <= 15 ? 48 : 40);

const pctOf = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : ((now - before) / before) * 100);

function spotlightStat(label: string, value: string, pct: number | null): VNode {
  const up = pct !== null && pct >= 0;
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: 160, marginTop: 10 } },
    h('div', { style: { fontSize: 15, fontWeight: 700, letterSpacing: 2, color: COLORS.muted, textTransform: 'uppercase' } }, label),
    h('div', { style: { fontSize: 36, fontWeight: 800, fontFamily: 'JetBrains Mono', marginTop: 4 } }, value),
    row(pct === null ? [] : [glyph(up ? 'up' : 'down', 13, up ? COLORS.up : COLORS.down, { right: 5 }), formatShare(Math.abs(pct))], { fontSize: 17, color: up ? COLORS.up : COLORS.down, marginTop: 2, height: 22 }),
  );
}

const sideLabel = (text: string) => h('span', { style: { color: COLORS.muted, fontSize: 16, letterSpacing: 2, fontWeight: 700, width: 160, flexShrink: 0 } }, text);

/** The week's fastest grower gold at the hub of its own sky, its week against the one before in a glass panel. */
export async function spotlightTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [moments, replay, chains] = await Promise.all([inputs.load('moments.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const s = moments.weeks.find((w) => w.week === monday)?.spotlight ?? null;
  const sunday = addDays(monday, 6);
  if (s === null || !hasReplayDay(replay, sunday)) return null;
  const names = namesOf(replay, chains);
  const sky = hubSky(replay, names, s.selector, monday, sunday, { gold: s.selector });
  const partners = s.partners.map((p) => chainName(names, p));
  const spotlightName = chainName(names, s.selector);
  const panel = h(
    'div',
    {
      style: {
        position: 'absolute', left: 52, top: 112, width: 540, display: 'flex', flexDirection: 'column', padding: '24px 30px',
        backgroundColor: 'rgba(10,13,19,0.8)', border: '1px solid #233047', borderRadius: 22,
      },
    },
    row([glyph('up', 16, COLORS.up, { right: 8 }), 'FASTEST GROWER · VS LAST WEEK'], { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: COLORS.up }),
    h('div', { style: { ...ellipsized, flexShrink: 0, maxWidth: 480, fontSize: chainSize(spotlightName), fontWeight: 800, color: COLORS.strong, letterSpacing: -1.5, marginTop: 6 } }, spotlightName),
    h('div', { style: { fontSize: 24, color: COLORS.muted } }, `#${s.rank} by messages`),
    h(
      'div',
      { style: { display: 'flex', marginTop: 4 } },
      spotlightStat('Messages', formatCount(s.messages), pctOf(s.messages, s.previous_messages)),
      spotlightStat('Value moved', formatUsd(s.usd), pctOf(s.usd, s.previous_usd)),
      spotlightStat('Fees', formatFeeTotal(s.fee_usd), pctOf(s.fee_usd, s.previous_fee_usd)),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', marginTop: 16, paddingTop: 12, borderTop: '1px solid #1f2a3c' } },
      partners.length === 0 ? null : row([sideLabel('TOP PARTNERS'), row(partners.map((p, i) => row([h('div', { style: { ...ellipsized, maxWidth: 320, fontWeight: 700, color: COLORS.strong } }, p), ...(i < partners.length - 1 ? [' · '] : [])])), { flex: 1, minWidth: 0, flexWrap: 'wrap' })], { fontSize: 20, alignItems: 'flex-start' }),
      s.token === null ? null : row([sideLabel('TOP TOKEN'), bold(`${s.token.label ?? shortAddress(addressOf(s.token.key))} `), h('span', { style: { color: COLORS.muted } }, `· ${formatUsd(s.token.usd)} moved`)], { fontSize: 20, marginTop: 8 }),
    ),
  );
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Chain spotlight · ${cardWeek(monday)}`,
    body: panel,
    insight: [glyph('up', 16, COLORS.up, { right: 8 }), 'Fastest-growing chain on CCIP this week'],
    cta: CHAINS_CTA,
  });
}
