import type { TopFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { chainNameMap } from '../src/lib/names';
import { daySender, senderEntries, senderRows, senderView, suggestLabelUrl } from '../src/lib/senders';
import oldTopSender from './fixtures/top-sender.json';

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const SOL = '124615329519749607';
const INK = '3461204551265785888';
const CHAINS = [
  { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet' },
  { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet' },
  { selector: SOL, name: 'solana-mainnet', display_name: 'Solana' },
  { selector: INK, name: 'ethereum-mainnet-ink-1', display_name: 'Ink Mainnet' },
];
const names = chainNameMap(CHAINS);
const registry = new Map(CHAINS.map((c) => [c.selector, c.name]));
const B1 = '0x671be08d6d3c826c2f6d76915f1b54af484d4077';
const XSTOCKS = { key: 'project:xstocks', label: 'xStocks', messages: 319, usd: 0, fee_usd: 79.75, x: 'xStocksFi', kind: 'protocol', inferred: false, chains: [SOL, INK, ETH], addresses: 2, share_pct: 20.3 };
const ADDRESS = { key: `address:${B1}`, label: null, messages: 76, usd: 250_000, fee_usd: 19, chains: [BASE, ETH, INK, SOL], addresses: 1, share_pct: 4.8 };
const slugs = new Set(['xstocks']);
const params = (url: string | null) => Object.fromEntries(new URL(url!).searchParams);

describe('sender rows', () => {
  it('names a project with its tick, address and chain counts, and links its page', () => {
    // #when
    const view = senderView(XSTOCKS, names, registry, slugs);
    // #then
    expect(view).toEqual({
      primary: 'xStocks', secondary: '2 addresses · 3 chains', verified: true, inferred: false, chains: [SOL, INK, ETH], href: '/projects/xstocks/', suggestUrl: null,
    });
  });

  it('names a project without a link when the build has no page for it', () => {
    // #when
    const view = senderView(XSTOCKS, names, registry, new Set());
    // #then
    expect([view.primary, view.href]).toEqual(['xStocks', null]);
  });

  it('marks a project credited only through a spread label as inferred, without the tick', () => {
    // #when
    const view = senderView({ ...XSTOCKS, inferred: true, addresses: 1 }, names, registry, slugs);
    // #then
    expect([view.verified, view.inferred, view.secondary]).toEqual([false, true, '1 address · 3 chains']);
  });

  it('names an unlabeled address by its short form and first three chains, links the explorer, and offers a label suggestion', () => {
    // #when
    const view = senderView(ADDRESS, names, registry, slugs);
    // #then
    expect({ ...view, suggestUrl: params(view.suggestUrl) }).toEqual({
      primary: '0x671b…4077', secondary: 'Base · Ethereum · Ink +1 more', verified: false, inferred: false, chains: [BASE, ETH, INK, SOL],
      href: `https://ccip.chain.link/address/${B1}`,
      suggestUrl: { template: 'label.yml', title: 'Label: 0x671b…4077', address: B1, chain: 'ethereum-mainnet-base-1' },
    });
  });

  it('still renders a per-chain key from a file published before identities, with a suggestion when it has no label', () => {
    // #given the captured top/sender.json from before identities
    const file = oldTopSender as TopFile;
    // #when
    const [first] = senderRows(senderEntries(file, '7d', 'value'), names, registry, slugs);
    // #then
    expect({ primary: first?.primary, secondary: first?.secondary, chains: first?.chains, suggest: params(first?.suggestUrl ?? null).chain }).toEqual({
      primary: '0xc616…579a', secondary: 'Ethereum', chains: [ETH], suggest: 'ethereum-mainnet',
    });
  });

  it('reads the identities when a file has them, by value and by fees', () => {
    // #given
    const file = { ...(oldTopSender as TopFile), identities: { '7d': [XSTOCKS], '30d': [], all: [] }, identities_by_fees: { '7d': [ADDRESS], '30d': [], all: [] } };
    // #then
    expect([senderEntries(file, '7d', 'value')[0]?.key, senderEntries(file, '7d', 'fees')[0]?.key]).toEqual(['project:xstocks', `address:${B1}`]);
  });

  it('shares each row out of the listed total, as the other Top tabs do', () => {
    // #when
    const rows = senderRows([XSTOCKS, ADDRESS], names, registry, slugs, 'fees');
    // #then
    expect(rows.map((r) => [r.rank, Math.round(r.sharePct! * 10) / 10])).toEqual([[1, 80.8], [2, 19.2]]);
  });
});

describe("the day's top sender", () => {
  it('names it with its messages and share, and has none for a day without leaders', () => {
    // #given
    const day = { day: '2026-10-13', token: null, sender: XSTOCKS, lane: null, fee_lane: null, fee_chain: null };
    // #when
    const sender = daySender(day, names, registry, slugs);
    // #then
    expect([sender?.primary, sender?.messages, sender?.sharePct, daySender(undefined, names, registry, slugs)]).toEqual(['xStocks', 319, 20.3, null]);
  });
});

describe('suggestLabelUrl', () => {
  it('opens the label issue form with the chain and address filled in, and no chain when it is unknown', () => {
    // #then
    expect([params(suggestLabelUrl('ethereum-mainnet', B1)), params(suggestLabelUrl(null, B1)).chain]).toEqual([
      { template: 'label.yml', title: 'Label: 0x671b…4077', address: B1, chain: 'ethereum-mainnet' },
      undefined,
    ]);
  });
});
