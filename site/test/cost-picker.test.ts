import type { CostFile } from '@ccip-dev/core/public';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CostPicker, { COST_TITLE, COST_UNAVAILABLE, CostPanel, NO_ROUTES, NOT_ENOUGH, type CostState } from '../src/components/CostPicker';
import { chainIndex, routeOf } from '../src/lib/cost';

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const SOL = '124615329519749607';
const ARB = '4949039107694359620';
const chains = [
  { selector: ETH, name: 'Ethereum', slug: 'ethereum' },
  { selector: BASE, name: 'Base', slug: 'base' },
  { selector: SOL, name: 'Solana', slug: 'solana' },
  { selector: ARB, name: 'Arbitrum', slug: 'arbitrum' },
];
const index = chainIndex(chains);
const cost: CostFile = {
  schema_version: 1, updated_at: '2026-10-08T00:10:00.000Z', attribution: 'x', from: '2026-09-08', to: '2026-10-07',
  lanes: [
    { src: ETH, dst: BASE, messages: 1234, median_usd: 0.42, p10_usd: 0.08, p90_usd: 2.1, link: { messages: 300, median_usd: 0.35 }, gas: { messages: 934, median_usd: 0.47 } },
    { src: SOL, dst: ETH, messages: 40, median_usd: 0.3, p10_usd: 0.2, p90_usd: 0.9, link: { messages: 40, median_usd: 0.3 } },
    { src: BASE, dst: ETH, messages: 6, median_usd: 0.12, p10_usd: 0.1, p90_usd: 0.2 },
  ],
};
const text = (html: string) => html.replace(/<[^>]+>/g, '');
const panel = (state: CostState) => renderToString(createElement(CostPanel, { state, index, onChange: () => {} }));
const ready = (src: string, dst: string): CostState => ({ status: 'ready', cost, route: routeOf(cost, src, dst) });

describe('CostPanel', () => {
  it('shows the typical fee, its range, and the messages and days it rests on', () => {
    // #when
    const t = text(panel(ready(ETH, BASE)));
    // #then
    expect(['Ethereum → Base', 'Typical fee', '$0.42', 'most between $0.08 and $2.10', 'based on 1,234 messages, Sep 8, 2026–Oct 7, 2026'].filter((s) => !t.includes(s))).toEqual([]);
  });

  it('adds the LINK and gas-token medians when the route has them', () => {
    expect(text(panel(ready(ETH, BASE)))).toContain('Paid in LINK: $0.35 · in gas tokens: $0.47');
  });

  it('shows only the LINK median for a route paid entirely in LINK', () => {
    // #when
    const t = text(panel(ready(SOL, ETH)));
    // #then
    expect({ link: t.includes('Paid in LINK: $0.30'), gas: t.includes('gas tokens') }).toEqual({ link: true, gas: false });
  });

  it('shows no split for a route under the LINK threshold', () => {
    expect(text(panel(ready(BASE, ETH)))).not.toContain('Paid in LINK');
  });

  it('says when a route has too few messages', () => {
    // #when
    const t = text(panel(ready(ARB, BASE)));
    // #then
    expect({ notEnough: t.includes(NOT_ENOUGH), fee: t.includes('Typical fee') }).toEqual({ notEnough: true, fee: false });
  });

  it('announces the result politely', () => {
    expect(panel(ready(ETH, BASE))).toMatch(/class="cost-result" aria-live="polite"/);
  });

  it('labels both selects and gives each a name and an id', () => {
    // #when
    const html = panel(ready(ETH, BASE));
    // #then
    const ids = [...html.matchAll(/<select[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    const fors = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]);
    expect({ ids: ids.length, labelled: ids.every((id) => fors.includes(id)), names: [...html.matchAll(/name="(cost-[a-z]+)"/g)].map((m) => m[1]) }).toEqual({
      ids: 2,
      labelled: true,
      names: ['cost-from', 'cost-to'],
    });
  });

  it('says the data is not available when cost.json could not be read', () => {
    expect(text(panel({ status: 'failed' }))).toContain(COST_UNAVAILABLE);
  });

  it('says so when cost.json lists no route', () => {
    expect(text(panel({ status: 'ready', cost: { ...cost, lanes: [] }, route: null }))).toContain(NO_ROUTES);
  });
});

describe('CostPicker', () => {
  it('shows its title and a skeleton until cost.json arrives', () => {
    // #when
    const html = renderToString(createElement(CostPicker, { chains }));
    // #then
    expect({ title: text(html).includes(COST_TITLE), busy: html.includes('aria-busy="true"'), skeleton: html.includes('cost-skeleton') }).toEqual({
      title: true,
      busy: true,
      skeleton: true,
    });
  });
});
