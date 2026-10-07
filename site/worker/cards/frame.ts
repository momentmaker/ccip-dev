import { h, type VNode } from '../h';
import type { CardCoin } from '../../src/sky/card-coins';
import type { CardSpec } from './content';

export const CARD_W = 1200;
export const CARD_H = 630;
const SKY_W = 640;

export function bigFontSize(text: string): number {
  if (text.length <= 7) return 120;
  if (text.length <= 12) return 96;
  if (text.length <= 18) return 72;
  return 56;
}

export function sparkSvg(values: readonly number[], width: number, height: number): string | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path d="${d}" fill="none" stroke="#4a7ff0" stroke-width="4" stroke-linejoin="round"/></svg>`;
}

export function cardTree(spec: CardSpec, opts: { skyDataUri: string | null; coins: readonly CardCoin[]; sparkDataUri: string | null; sponsorLine: string | null }): VNode {
  return h(
    'div',
    {
      style: {
        width: CARD_W,
        height: CARD_H,
        display: 'flex',
        position: 'relative',
        backgroundColor: '#0c0f14',
        backgroundImage: 'radial-gradient(ellipse at top, rgba(47,98,223,0.20), rgba(12,15,20,0) 65%)',
        fontFamily: 'Inter',
        color: '#e8eaed',
      },
    },
    opts.skyDataUri ? h('img', { src: opts.skyDataUri, width: SKY_W, height: 630, style: { position: 'absolute', right: 0, top: 0, opacity: 0.6 } }) : null,
    ...opts.coins.map((c) =>
      h('img', {
        src: c.src,
        width: c.d,
        height: c.d,
        style: { position: 'absolute', left: CARD_W - SKY_W + c.x - c.d / 2, top: c.y - c.d / 2, width: c.d, height: c.d, borderRadius: c.d / 2, boxShadow: '0 0 0 1px rgba(255,255,255,0.18)' },
      }),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', width: '100%', height: '100%' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { style: { fontSize: 22, fontWeight: 700, letterSpacing: 4, color: '#8892a0' } }, spec.eyebrow),
        h('div', { style: { fontSize: bigFontSize(spec.big), fontWeight: 700, lineHeight: 1.05, marginTop: 18, maxWidth: 860 } }, spec.big),
        h('div', { style: { fontSize: 34, marginTop: 14 } }, spec.label),
        spec.date ? h('div', { style: { fontSize: 26, marginTop: 10, color: '#8892a0' } }, spec.date) : null,
        ...spec.extra.map((line) => h('div', { style: { fontSize: 26, marginTop: 10, color: '#8892a0' } }, line)),
        opts.sparkDataUri ? h('img', { src: opts.sparkDataUri, width: 560, height: 110, style: { marginTop: 24 } }) : null,
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 22, color: '#8892a0' } },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column' } },
          h('div', { style: { fontSize: 36, fontWeight: 700, color: '#4a7ff0' } }, 'ccip.dev'),
          h('div', { style: { marginTop: 6 } }, 'Data: Chainlink CCIP API, DefiLlama'),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' } },
          opts.sponsorLine ? h('div', null, opts.sponsorLine) : null,
        ),
      ),
    ),
  );
}
