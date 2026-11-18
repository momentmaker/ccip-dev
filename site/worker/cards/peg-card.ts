import type { PegEpisodeView, PegFile, PegHistoryFile } from '@ccip-dev/core/public';
import { formatGap, linkAmount, priceText, utcStamp } from '../../src/lib/peg-view';
import { h, type VNode } from '../h';
import { bold, broadcastFrame, COLORS, eyebrow, row, type BroadcastInputs } from './broadcast-frame';
import type { Cta } from './cta';
import { TEAL } from './staking-cards';

export const PEG_CTA: Cta = { lead: 'Watch the peg:', path: 'ccip.dev/staking/#peg' };
const SPARK_W = 420;
const SPARK_H = 150;

/** The last 30 days of hourly closes around a zero line, as an <img>. */
function gapSpark(history: PegHistoryFile): VNode | null {
  const rows = history.hours.slice(-30 * 24);
  if (rows.length < 2) return null;
  const gaps = rows.map((r) => r[4] - 1);
  const reach = Math.max(history.thresholds.public, ...gaps.map(Math.abs));
  const y = (g: number) => ((reach - g) / (2 * reach)) * SPARK_H;
  const points = gaps.map((g, i) => `${((i / (gaps.length - 1)) * SPARK_W).toFixed(1)},${y(g).toFixed(1)}`).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SPARK_W}" height="${SPARK_H}"><line x1="0" x2="${SPARK_W}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(255,255,255,0.35)" stroke-dasharray="4 5"/><polyline points="${points}" fill="none" stroke="${TEAL}" stroke-width="3"/></svg>`;
  return h('img', { src: `data:image/svg+xml;base64,${btoa(svg)}`, width: SPARK_W, height: SPARK_H, style: { position: 'absolute', right: 56, top: 190 } });
}

function chip(text: string, color: string): VNode {
  return h('div', { style: { display: 'flex', fontSize: 18, fontWeight: 800, letterSpacing: 2, color: '#070a10', backgroundColor: color, borderRadius: 4, padding: '5px 12px' } }, text);
}

const LINE = { fontSize: 26, marginTop: 12, color: COLORS.soft };

function routeLines(peg: PegFile, side: 'discount' | 'premium'): VNode[] {
  const r = peg[side];
  const lines = [row(r.depth === null ? ['No Curve size beats 1:1'] : ['Curve beats 1:1 up to ', bold(`${linkAmount(r.depth)} LINK`)], LINE)];
  lines.push(
    side === 'discount'
      ? row(['Redeem at 1:1 now: ', bold(`${linkAmount(r.instant)} LINK`), ' · ', bold(`${linkAmount(r.queued_ahead)} stLINK`), ' queued'], LINE)
      : row(['Mint at 1:1 now: ', bold(`${linkAmount(r.instant)} LINK`)], LINE),
  );
  return lines;
}

function closeLines(episode: PegEpisodeView): VNode[] {
  const hours = Math.round((Date.parse(episode.closed_at!) - Date.parse(episode.opened_at)) / 3_600_000);
  const lines = [row(['Lasted ', bold(`${hours}h`), ' · peak at ', bold(utcStamp(episode.peak_at))], LINE)];
  if (episode.best_size) lines.push(row(['Best Curve size ', bold(`${linkAmount(episode.best_size)} LINK`)], LINE));
  return lines;
}

function body(peg: PegFile, episode: PegEpisodeView | null, phase: 'open' | 'close' | null, history: PegHistoryFile): VNode {
  const closing = phase === 'close' && episode !== null;
  const side = episode?.side ?? (peg.gap < 0 ? 'discount' : 'premium');
  const gap = episode ? episode.peak_gap : peg.gap;
  const color = side === 'discount' ? COLORS.down : COLORS.up;
  const label = episode ? `${side.toUpperCase()} ${closing ? 'CLOSED' : 'OPEN'}` : 'stLINK ON CURVE';
  const lines: VNode[] = [];
  if (!episode) {
    lines.push(row([bold(priceText(peg.spot))], LINE));
    if (Math.abs(peg.gap) >= history.thresholds.private) lines.push(...routeLines(peg, side));
  } else if (closing) {
    lines.push(row(['peak'], LINE), ...closeLines(episode));
  } else {
    lines.push(row(['peak so far'], LINE), row(['now: ', bold(priceText(peg.spot))], LINE), ...routeLines(peg, side));
  }
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 118, width: 640, display: 'flex', flexDirection: 'column' } },
    eyebrow('stLINK / LINK', { color: TEAL }),
    h('div', { style: { display: 'flex', marginTop: 12 } }, chip(label, color)),
    h('div', { style: { display: 'flex', fontSize: 104, fontWeight: 800, letterSpacing: -3, color, marginTop: 14, lineHeight: 1 } }, formatGap(gap)),
    ...lines,
  );
}

function insight(episode: PegEpisodeView | null, phase: 'open' | 'close' | null, history: PegHistoryFile) {
  if (episode && phase === 'close' && episode.closed_at) return ['Closed ', bold(utcStamp(episode.closed_at))];
  if (episode && phase === 'open') return ['Opened ', bold(utcStamp(episode.opened_at))];
  const last = history.records.last_end;
  return last ? ['Last episode ended ', bold(utcStamp(last))] : ['No episode yet'];
}

/** The live peg for the page's share button (`focus` null), or one episode's open or close for its public post. */
export async function pegTree(focus: { episode: number; phase: 'open' | 'close' } | null, inputs: BroadcastInputs): Promise<VNode | null> {
  const [peg, history] = await Promise.all([inputs.load('peg.json'), inputs.load('peg-history.json')]);
  const episode = focus === null ? null : (peg.recent_episodes.find((e) => e.id === focus.episode) ?? null);
  if (focus !== null && (episode === null || (focus.phase === 'close' && episode.closed_at === null))) return null;
  const spark = gapSpark(history);
  return broadcastFrame({
    background: spark ? [spark] : [],
    eyebrow: `Chainlink staking · stLINK peg · ${utcStamp(peg.updated_at)}`,
    body: body(peg, episode, focus?.phase ?? null, history),
    insight: insight(episode, focus?.phase ?? null, history),
    cta: PEG_CTA,
  });
}
