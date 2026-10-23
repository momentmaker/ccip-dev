import { formatCount, formatShare, formatUsd, formatUtcDay } from '@ccip-dev/core/format';
import { laneLabel } from '@ccip-dev/core/names';
import { recordValueText } from '@ccip-dev/core/broadcasts';
import { recordsSetOn } from '@ccip-dev/core/records';
import { addDays } from '@ccip-dev/core/time';
import { topEntries } from '../../src/lib/top';
import { h, type Child, type VNode } from '../h';
import { RECORD_TITLES } from './broadcast-cards';
import { bold, boldArrows, COLORS, eyebrow, iconsFor, namesOf, row, skyFor, STRIP_H, type BroadcastInputs } from './broadcast-frame';
import { CARD_SIZE } from './frame';
import { glyph } from './glyphs';
import { ORBIT_H, skyNodes } from './orbit-sky';

const W = CARD_SIZE.width;
const H = CARD_SIZE.height;
/** The orbit is laid out for the 675-pixel report cards; scaled to fit above this card's strip. */
const SKY_SCALE = (H - STRIP_H + 20) / (ORBIT_H - STRIP_H + 20);
const SPARK = { width: 500, height: 74 };
const SPARK_DAYS = 90;

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

function areaSpark(values: readonly number[], width: number, height: number): string | null {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a7ff0" stop-opacity="0.45"/><stop offset="1" stop-color="#4a7ff0" stop-opacity="0"/></linearGradient></defs><path d="${line}L${width},${height}L0,${height}Z" fill="url(#a)"/><path d="${line}" fill="none" stroke="#6b9bff" stroke-width="3" stroke-linejoin="round"/></svg>`;
}
const pct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

function delta(value: number | null): Child[] {
  if (value === null) return [];
  const up = value >= 0;
  return [glyph(up ? 'up' : 'down', 13, up ? COLORS.up : COLORS.down, { right: 5 }), h('span', { style: { color: up ? COLORS.up : COLORS.down } }, formatShare(Math.abs(value)))];
}

function weekStat(value: string, label: string, change: number | null): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: 250 } },
    h('div', { style: { fontSize: 34, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: -1, color: COLORS.strong } }, value),
    row([`${label} `, ...delta(change)], { fontSize: 19, color: COLORS.muted, marginTop: 2 }),
  );
}

function strip(insight: readonly Child[]): VNode {
  return h(
    'div',
    {
      style: {
        position: 'absolute', left: 0, top: H - STRIP_H, width: W, height: STRIP_H, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0 56px', backgroundImage: 'linear-gradient(90deg, #13244d, #0f1a33)', fontSize: 22, color: COLORS.soft,
      },
    },
    row(insight, { flexShrink: 1, minWidth: 0, overflow: 'hidden', marginRight: 24 }),
    row([glyph('play', 16, COLORS.soft, { right: 8 }), 'Live at ', bold('ccip.dev')], { flexShrink: 0 }),
  );
}

export async function homeTree(inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, replay, chains, lanes] = await Promise.all([inputs.load('history.json'), inputs.load('replay.json'), inputs.load('chains.json'), inputs.load('top/lane.json')]);
  const days = history.days;
  const last = days.at(-1)?.day;
  if (!last) return null;
  const names = namesOf(replay, chains);
  const week = days.slice(-7);
  const before = days.slice(-14, -7);
  const weekMessages = sum(week.map((d) => d.messages));
  const weekUsd = sum(week.map((d) => d.usd_value));
  const spark = areaSpark(days.slice(-SPARK_DAYS).map((d) => d.messages), SPARK.width, SPARK.height);
  const sky = skyFor(replay, names, addDays(last, -6), last);

  const recent = week.map((d) => d.day).reverse().flatMap((day) => recordsSetOn(days, history.largest_fees ?? [], day).map((r) => ({ day, r })))[0];
  const lane = topEntries(lanes, '7d', 'value')[0];
  const insight: Child[] = recent
    ? [glyph('star', 18, COLORS.gold, { right: 8 }), 'Record this week: ', bold(RECORD_TITLES[recent.r.kind]), ` (${recordValueText(recent.r.kind, recent.r.value)})`]
    : lane
      ? ['Busiest lane this week: ', boldArrows(laneLabel(names, lane.key)), ` · ${formatUsd(lane.usd)}`]
      : [];

  return h(
    'div',
    { style: { width: W, height: H, display: 'flex', position: 'relative', backgroundColor: '#070a10', fontFamily: 'Inter', color: '#e8eaed', overflow: 'hidden' } },
    h(
      'div',
      { style: { position: 'absolute', left: 0, top: 0, width: W, height: ORBIT_H, display: 'flex', transform: `scale(${SKY_SCALE.toFixed(3)})`, transformOrigin: 'right top' } },
      ...skyNodes(sky, await iconsFor(sky, inputs.icon)),
    ),
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: 700, height: H, display: 'flex', backgroundImage: 'linear-gradient(90deg, rgba(7,10,16,0.96) 55%, rgba(7,10,16,0))' } }),
    h(
      'div',
      { style: { position: 'absolute', left: 56, top: 40, display: 'flex', flexDirection: 'column', width: 600 } },
      h('div', { style: { fontSize: 34, fontWeight: 800, color: COLORS.brand, letterSpacing: -0.5 } }, 'ccip.dev'),
      eyebrow(history.since ? `Every CCIP message · since ${formatUtcDay(history.since)}` : 'Every CCIP message', { marginTop: 34 }),
      h('div', { style: { fontSize: 104, fontWeight: 800, letterSpacing: -4, lineHeight: 1.02, color: COLORS.strong, marginTop: 6 } }, formatCount(sum(days.map((d) => d.messages)))),
      h('div', { style: { fontSize: 30, color: COLORS.soft, marginTop: 4 } }, `messages · ${formatUsd(sum(days.map((d) => d.usd_value)))} moved`),
      spark ? h('img', { src: toDataUri(spark), width: SPARK.width, height: SPARK.height, style: { marginTop: 26 } }) : null,
      h('div', { style: { fontSize: 15, color: COLORS.muted, marginTop: 6, letterSpacing: 1 } }, `Messages a day · last ${SPARK_DAYS} days`),
      eyebrow('Last 7 days', { marginTop: 24 }),
      row([weekStat(formatCount(weekMessages), 'messages', pct(weekMessages, sum(before.map((d) => d.messages)))), weekStat(formatUsd(weekUsd), 'moved', pct(weekUsd, sum(before.map((d) => d.usd_value))))], { marginTop: 8 }),
    ),
    strip(insight),
  );
}
