import { formatCount, formatDuration, formatUtcDay } from '@ccip-dev/core/format';
import { HOLDER_KINDS, type StakingFile } from '@ccip-dev/core/public';
import { HIVE_RINGS, hiveCenters, hiveKinds, type HiveKind } from '../../src/lib/staking-view';
import { h, type VNode } from '../h';
import { CARD_H, CARD_W } from './frame';
import { glyph } from './glyphs';
import { svgDataUri } from './orbit-sky';

const TEAL = '#2ed3c3';
const TEAL_2 = '#8ff3e6';
const GOLD = '#ffcf5a';
const MUTED = '#8892a0';
const HIVE = { x: 936, y: 286, cell: 14.2 } as const;
const FILL: Record<HiveKind, string> = { wallet: TEAL, smart: TEAL_2, stakelink: '#4a7ff0', contract: '#5d6b82', open: 'none' };
const LEGEND: Record<(typeof HOLDER_KINDS)[number], string> = { wallet: 'Wallets', smart: 'Smart wallets', stakelink: 'stake.link', contract: 'Multisigs' };
/** The two cells the card singles out, as the page's replay does: a gap just opened, and the cell that just refilled. */
const GAP_CELL = 24;
const FRESH_CELL = 70;

const hexPoints = (r: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = ((60 * k - 90) * Math.PI) / 180;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');

/** The background: night sky, the page's faint hex ground, a teal glow, and the community pool's honeycomb by holder. */
export function stakingPageSvg(staking: Pick<StakingFile, 'community' | 'holders'>): string {
  const centers = hiveCenters(HIVE_RINGS);
  const kinds = hiveKinds(staking, centers.length);
  const hex = hexPoints(HIVE.cell * 0.9);
  const cells = centers.map((c, i) => {
    const at = `translate(${(HIVE.x + c.x * HIVE.cell).toFixed(1)} ${(HIVE.y + c.y * HIVE.cell).toFixed(1)})`;
    if (i === GAP_CELL) return `<polygon points="${hex}" transform="${at}" fill="#070a10" stroke="${GOLD}" stroke-width="2"/>`;
    if (i === FRESH_CELL) return `<polygon points="${hex}" transform="${at}" fill="#f4fffd" filter="url(#glow)"/>`;
    const kind = kinds[i]!;
    return kind === 'open'
      ? `<polygon points="${hex}" transform="${at}" fill="none" stroke="${GOLD}" stroke-dasharray="3 3"/>`
      : `<polygon points="${hex}" transform="${at}" fill="${FILL[kind]}" opacity="0.88"/>`;
  });
  const ground = hexPoints(16);
  const tiles: string[] = [];
  for (let y = -20; y < CARD_H + 40; y += 24) {
    for (let x = ((y + 20) / 24) % 2 === 0 ? 0 : 13.9; x < CARD_W + 28; x += 27.7) tiles.push(`<polygon points="${ground}" transform="translate(${x} ${y})"/>`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">` +
    '<defs>' +
    `<radialGradient id="glowR" cx="${HIVE.x / CARD_W}" cy="${HIVE.y / CARD_H}" r="0.42"><stop offset="0" stop-color="${TEAL}" stop-opacity="0.32"/><stop offset="1" stop-color="${TEAL}" stop-opacity="0"/></radialGradient>` +
    '<radialGradient id="glowL" cx="0.05" cy="0" r="0.7"><stop offset="0" stop-color="#2f62df" stop-opacity="0.16"/><stop offset="1" stop-color="#2f62df" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="fade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070a10" stop-opacity="0.2"/><stop offset="1" stop-color="#070a10" stop-opacity="0.85"/></linearGradient>' +
    '<filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '</defs>' +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="#070a10"/>` +
    `<g fill="none" stroke="#4a8eff" stroke-opacity="0.07" stroke-width="1">${tiles.join('')}</g>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#fade)"/>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#glowL)"/>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#glowR)"/>` +
    cells.join('') +
    '</svg>'
  );
}

function tile(label: string, value: string, accent = '#ffffff'): VNode {
  return h(
    'div',
    {
      style: {
        display: 'flex', flexDirection: 'column', width: 142, marginRight: 12, padding: '12px 14px', borderRadius: 12,
        border: '1px solid rgba(46,211,195,0.28)', backgroundColor: 'rgba(46,211,195,0.07)',
      },
    },
    h('div', { style: { fontSize: 13, fontWeight: 700, letterSpacing: 1.6, color: MUTED, textTransform: 'uppercase' } }, label),
    h('div', { style: { fontSize: 30, fontWeight: 800, fontFamily: 'JetBrains Mono', color: accent, marginTop: 4, letterSpacing: -0.5 } }, value),
  );
}

function legend(): VNode {
  return h(
    'div',
    { style: { position: 'absolute', left: 706, top: 512, width: 460, display: 'flex', justifyContent: 'center' } },
    ...HOLDER_KINDS.map((k) =>
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', marginLeft: 10, marginRight: 10, fontSize: 16, color: '#c9cfda' } },
        h('div', { style: { width: 12, height: 12, borderRadius: 3, backgroundColor: FILL[k], marginRight: 7 } }),
        LEGEND[k],
      ),
    ),
  );
}

/** The /staking share card: the page's hero in one frame. */
export function stakingPageTree(staking: StakingFile, now: Date): VNode {
  const c = staking.community;
  const full = c.total >= c.cap - 0.001;
  const days = c.full_since === null ? null : Math.floor((now.getTime() - Date.parse(c.full_since)) / 86_400_000);
  const rate = staking.rewards?.community_rate_pct ?? null;
  return h(
    'div',
    { style: { width: CARD_W, height: CARD_H, display: 'flex', position: 'relative', backgroundColor: '#070a10', fontFamily: 'Inter', color: '#e8eaed' } },
    h('img', { src: svgDataUri(stakingPageSvg(staking)), width: CARD_W, height: CARD_H, style: { position: 'absolute', left: 0, top: 0 } }),
    h(
      'div',
      { style: { position: 'absolute', left: 56, top: 44, display: 'flex', flexDirection: 'column', width: 680 } },
      h('div', { style: { fontSize: 34, fontWeight: 800, color: '#4a7ff0', letterSpacing: -0.5 } }, 'ccip.dev'),
      h('div', { style: { fontSize: 17, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: 3.5, color: TEAL, marginTop: 34, textTransform: 'uppercase' } }, 'Chainlink staking · community pool'),
      h(
        'div',
        {
          style: {
            fontSize: 104, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: -5, lineHeight: 1, marginTop: 12,
            backgroundImage: `linear-gradient(180deg, #ffffff 25%, ${TEAL_2} 72%, ${TEAL})`, backgroundClip: 'text', color: 'transparent',
          },
        },
        formatCount(c.total),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', marginTop: 14 } },
        full
          ? h('div', { style: { display: 'flex', fontSize: 18, fontWeight: 800, letterSpacing: 3, color: '#032a27', backgroundColor: TEAL, borderRadius: 6, padding: '5px 11px', marginRight: 14 } }, 'FULL')
          : h('div', { style: { display: 'flex', fontSize: 18, fontWeight: 800, letterSpacing: 2, color: '#2a2116', backgroundColor: GOLD, borderRadius: 6, padding: '5px 11px', marginRight: 14 } }, `${formatCount(c.cap - c.total)} LINK OPEN`),
        h('div', { style: { fontSize: 24, color: '#c9cfda' } }, full && c.full_since && days !== null ? `LINK staked · full since ${formatUtcDay(c.full_since)}, ${formatCount(days)} days` : `of ${formatCount(c.cap)} LINK staked`),
      ),
      h(
        'div',
        { style: { display: 'flex', marginTop: 34 } },
        tile('Stakers', formatCount(c.stakers)),
        tile('At the max', formatCount(c.at_max), GOLD),
        tile('Gaps refill', formatDuration(staking.refills.median_s), TEAL_2),
        tile('Rewards', rate === null ? '—' : `${rate.toFixed(2)}%`),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', marginTop: 34, fontSize: 21, color: '#c9cfda' } },
        glyph('play', 15, TEAL, { right: 10 }),
        h('span', { style: { color: '#ffffff', fontWeight: 700 } }, 'ccip.dev/staking'),
        h('span', { style: { color: MUTED, marginLeft: 12 } }, '· exit queue · gap hunt · operators'),
      ),
    ),
    legend(),
  );
}
