import type { ReserveFile } from '@ccip-dev/core/public';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReserveView from '../src/components/ReserveView';
import reserveJson from './fixtures/reserve.json';

const RESERVE = reserveJson as unknown as ReserveFile;
const html = (reserve: ReserveFile) => renderToString(createElement(ReserveView, { initial: reserve }));

describe('the /reserve page', () => {
  it('draws the Vault with the balance as the page heading', () => {
    // #when
    const page = html(RESERVE);
    // #then
    expect(page).toMatch(/<h1 class="vault-big">[\d,]+<\/h1>/);
  });

  it('draws without a pace, a cost basis, a price or transfers yet', () => {
    // #given
    const bare: ReserveFile = { ...RESERVE, pace: null, cost_basis: null, link_price_usd: null, performance: null, transfers: [] };
    // #when
    const page = html(bare);
    // #then
    expect(page).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('draws before the Reserve holds anything', () => {
    // #given
    const empty: ReserveFile = { ...RESERVE, latest: null, series: [], weekly: [], pace: null, cost_basis: null, performance: null, transfers: [] };
    // #when
    const page = html(empty);
    // #then
    expect(page).not.toMatch(/NaN|undefined|Infinity/);
  });
});
