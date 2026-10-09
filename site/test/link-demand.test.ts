import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LinkDemandCharts, { DEPOSITS_CAPTION } from '../src/components/LinkDemandCharts';

const text = (html: string) => html.replace(/<[^>]+>/g, '');
const mix = [
  { week: '2026-09-28', link: 100, native: 300, stable: 50, other: 10 },
  { week: '2026-10-05', link: 120, native: 280, stable: 60, other: 5 },
];
const beside = [{ week: '2026-09-28', fees_usd: 460, deposits_usd: 15000 }];
const render = (props: Parameters<typeof LinkDemandCharts>[0]) => renderToString(createElement(LinkDemandCharts, props));

describe('LinkDemandCharts', () => {
  it('renders the weekly fee mix with its four groups', () => {
    // #when
    const t = text(render({ mix, beside, mixFrom: null }));
    // #then
    expect(['Weekly fee mix (USD)', 'LINK', 'Gas tokens', 'Stablecoins', 'Other'].filter((s) => !t.includes(s))).toEqual([]);
  });

  it('renders the weekly fees beside the Reserve deposits, with the caption', () => {
    const t = text(render({ mix, beside, mixFrom: null }));
    expect(['Weekly fees and Reserve deposits (USD)', 'CCIP fees', 'Reserve deposits', DEPOSITS_CAPTION].filter((s) => !t.includes(s))).toEqual([]);
  });

  it('offers a data table for each chart', () => {
    expect(render({ mix, beside, mixFrom: null }).match(/<table/g)?.length).toBe(2);
  });

  it('describes the fee mix in text for screen readers', () => {
    expect(render({ mix, beside, mixFrom: null })).toContain(
      'aria-label="Weekly fee mix (USD), weeks of Sep 28, 2026 to Oct 5, 2026. Latest week: LINK $120, Gas tokens $280, Stablecoins $60, Other $5"',
    );
  });

  it('says when no week has a mix yet', () => {
    expect(text(render({ mix: [], beside: [], mixFrom: null }))).toContain('No complete weeks with this data yet.');
  });

  it('notes the week the mix starts', () => {
    expect(text(render({ mix, beside, mixFrom: '2026-10-05' }))).toContain('Fee mix from the week of Oct 5, 2026 onward.');
  });
});
