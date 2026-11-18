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

function body(peg: PegFile, episode: PegEpisodeView | null, phase: 'open' | 'close' | null): VNode {
  const closing = phase === 'close' && episode !== null;
  const side = episode?.side ?? (peg.gap < 0 ? 'discount' : 'premium');
  const big = closing ? formatGap(episode.peak_gap) : formatGap(peg.gap);
  const color = (closing ? episode.peak_gap : peg.gap) < 0 ? COLORS.down : COLORS.up;
  const label = episode ? `${side.toUpperCase()} ${closing ? 'CLOSED' : 'OPEN'}` : 'stLINK ON CURVE';
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 118, width: 640, display: 'flex', flexDirection: 'column' } },
    eyebrow('stLINK / LINK', { color: TEAL }),
    h('div', { style: { display: 'flex', marginTop: 12 } }, chip(label, color)),
    h('div', { style: { display: 'flex', fontSize: 104, fontWeight: 800, letterSpacing: -3, color, marginTop: 14, lineHeight: 1 } }, big),
    row([closing ? 'peak · now ' : '', bold(priceText(peg.spot))], { fontSize: 26, marginTop: 16, color: COLORS.soft }),
  );
}

function insight(peg: PegFile, episode: PegEpisodeView | null, phase: 'open' | 'close' | null, history: PegHistoryFile) {
  if (phase === 'close' && episode?.closed_at) {
    const hours = Math.round((Date.parse(episode.closed_at) - Date.parse(episode.opened_at)) / 3_600_000);
    return ['Lasted ', bold(`${hours}h`), ` · peak at ${utcStamp(episode.peak_at)}`, ...(episode.best_size ? [' · best Curve size ', bold(`${linkAmount(episode.best_size)} LINK`)] : [])];
  }
  const side = peg.gap < 0 ? 'discount' : 'premium';
  const r = peg[side];
  if (episode || Math.abs(peg.gap) >= history.thresholds.private) {
    return ['Curve beats 1:1 up to ', bold(r.depth === null ? 'no size' : `${linkAmount(r.depth)} LINK`), ` · ${side === 'discount' ? 'redeem' : 'mint'} at 1:1 now: `, bold(`${linkAmount(r.instant)} LINK`)];
  }
  const last = history.records.last_end;
  return last ? ['Last episode ended ', bold(utcStamp(last))] : ['No episode yet'];
}

/** The live peg for the page's share button (`focus` null), or one episode's open or close for its public post. */
export async function pegTree(focus: { episode: number; phase: 'open' | 'close' } | null, inputs: BroadcastInputs): Promise<VNode | null> {
  const [peg, history] = await Promise.all([inputs.load('peg.json'), inputs.load('peg-history.json')]);
  const episode = focus === null ? peg.episode : (peg.recent_episodes.find((e) => e.id === focus.episode) ?? null);
  if (focus !== null && (episode === null || (focus.phase === 'close' && episode.closed_at === null))) return null;
  const spark = gapSpark(history);
  return broadcastFrame({
    background: spark ? [spark] : [],
    eyebrow: `Chainlink staking · stLINK peg · ${utcStamp(peg.updated_at)}`,
    body: body(peg, episode, focus?.phase ?? null),
    insight: insight(peg, episode, focus?.phase ?? null, history),
    cta: PEG_CTA,
  });
}
