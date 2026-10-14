import { describe, expect, it } from 'vitest';
import type { Label, LabelIndex } from '../src/labels';
import { identityResolver, labeledAddresses, mergeIdentities, parseSenderKey, projectAddresses, rankIdentities, sharePct, type SenderChains } from '../src/senders';
import {
  BASE_SENDER_1, BASE_SENDER_2, NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_CHAINS, XSTOCKS_LABEL, XSTOCKS_LABELS, XSTOCKS_SENDER_ROWS, XSTOCKS_TOTALS,
} from '../src/testing';

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const SOL = NETWORKS.solana.chainSelector;
const INK = NETWORKS.ink.chainSelector;
const XLAYER = NETWORKS.xlayer.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const HYPER = NETWORKS.hyperliquid.chainSelector;
const APTOS = '4741433654826277614';
const SVM_L2 = '9999999999999999999';
const ADDR = '0x7af7632562b6063e52788607ad56f7a60f57ce09';
const SHOUTED = `0x${ADDR.slice(2).toUpperCase()}`;
const MAPLE: Label = { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol', slug: 'maple-finance' };
const CHAINS: SenderChains = new Map([
  [ETH, { name: 'ethereum-mainnet', family: 'EVM' }],
  [BASE, { name: 'ethereum-mainnet-base-1', family: 'EVM' }],
  [SOL, { name: 'solana-mainnet', family: 'SVM' }],
  [APTOS, { name: 'aptos-mainnet', family: 'APTOS' }],
  [SVM_L2, { name: 'svm-l2-mainnet', family: 'SVM' }],
]);
const ON_ETHEREUM: LabelIndex = { [`ethereum-mainnet:${ADDR}`]: MAPLE };
const row = (selector: string, address: string, messages: number, usd_value = 0, fee_usd: number | null = null) => ({ key: `${selector}:${address}`, messages, usd_value, fee_usd });

describe('sender identity', () => {
  it('is the project a verified label names on the chain', () => {
    // #when
    const identity = identityResolver(ON_ETHEREUM, CHAINS)(ETH, ADDR);
    // #then
    expect(identity).toEqual({ key: 'project:maple-finance', project: MAPLE, inferred: false });
  });

  it('spreads a label to the same EVM address on another EVM chain, in any letter case, marked inferred', () => {
    // #when
    const identity = identityResolver(ON_ETHEREUM, CHAINS)(BASE, SHOUTED);
    // #then
    expect(identity).toEqual({ key: 'project:maple-finance', project: MAPLE, inferred: true });
  });

  it('never spreads to a chain of another family', () => {
    // #when
    const identity = identityResolver(ON_ETHEREUM, CHAINS)(APTOS, ADDR);
    // #then
    expect(identity).toEqual({ key: `address:${ADDR}`, project: null, inferred: false });
  });

  it('never spreads a Solana label, even to another SVM chain', () => {
    // #when
    const identity = identityResolver({ [`solana-mainnet:${XBRIDGE_SOLANA}`]: XSTOCKS_LABEL }, CHAINS)(SVM_L2, XBRIDGE_SOLANA);
    // #then
    expect(identity.key).toBe(`address:${XBRIDGE_SOLANA}`);
  });

  it('does not spread a project whose file sets spread = false', () => {
    // #when
    const identity = identityResolver({ [`ethereum-mainnet:${ADDR}`]: { ...MAPLE, spread: false } }, CHAINS)(BASE, ADDR);
    // #then
    expect(identity.key).toBe(`address:${ADDR}`);
  });

  it('does not spread an address two projects label on different chains', () => {
    // #given Maple on Ethereum and xStocks on Base claim the same address
    const labels: LabelIndex = { [`ethereum-mainnet:${ADDR}`]: MAPLE, [`ethereum-mainnet-base-1:${ADDR}`]: XSTOCKS_LABEL };
    const resolve = identityResolver(labels, new Map([...CHAINS, ['3', { name: 'ethereum-mainnet-arbitrum-1', family: 'EVM' }]]));
    // #when
    const keys = [resolve(ETH, ADDR).key, resolve(BASE, ADDR).key, resolve('3', ADDR).key];
    // #then
    expect(keys).toEqual(['project:maple-finance', 'project:xstocks', `address:${ADDR}`]);
  });

  it('does not spread an address another project labels, even when the first project turned spreading off', () => {
    // #given Maple (spread = false) on Ethereum and xStocks on Base claim the same address
    const labels: LabelIndex = { [`ethereum-mainnet:${ADDR}`]: { ...MAPLE, spread: false }, [`ethereum-mainnet-base-1:${ADDR}`]: XSTOCKS_LABEL };
    const resolve = identityResolver(labels, new Map([...CHAINS, ['3', { name: 'ethereum-mainnet-arbitrum-1', family: 'EVM' }]]));
    // #when
    const identity = resolve('3', ADDR);
    // #then
    expect(identity.key).toBe(`address:${ADDR}`);
  });

  it('falls back to the address: one identity across chains, lowercased for EVM, as-is for Solana', () => {
    // #given
    const resolve = identityResolver({}, CHAINS);
    // #when
    const keys = [resolve(ETH, SHOUTED).key, resolve(BASE, ADDR).key, resolve(SOL, XBRIDGE_SOLANA).key];
    // #then
    expect(keys).toEqual([`address:${ADDR}`, `address:${ADDR}`, `address:${XBRIDGE_SOLANA}`]);
  });

  it('gives a chain missing from the chains table the address, with no label and no spread', () => {
    // #when
    const identity = identityResolver(ON_ETHEREUM, CHAINS)('424242', ADDR);
    // #then
    expect(identity.key).toBe(`address:${ADDR}`);
  });
});

describe('ranking by identity', () => {
  const resolve = identityResolver(XSTOCKS_LABELS, XSTOCKS_CHAINS);

  it("credits xStocks with 319 of 2026-10-13's 1,569 messages (20.3%), across six chains and two addresses", () => {
    // #when
    const [top] = rankIdentities(mergeIdentities(XSTOCKS_SENDER_ROWS, resolve), 'messages', 1);
    // #then
    expect({ ...top, share: sharePct(top!.messages, XSTOCKS_TOTALS.messages) }).toEqual({
      key: 'project:xstocks', label: 'xStocks', slug: 'xstocks', x: 'xStocksFi', kind: 'protocol', inferred: false,
      messages: 319, usd_value: 0, fee_usd: 79.75,
      chains: [SOL, INK, XLAYER, BSC, ETH, HYPER],
      addresses: 2,
      keys: [`${INK}:${XBRIDGE_EVM}`, `${XLAYER}:${XBRIDGE_EVM}`, `${BSC}:${XBRIDGE_EVM}`, `${ETH}:${XBRIDGE_EVM}`, `${HYPER}:${XBRIDGE_EVM}`, `${SOL}:${XBRIDGE_SOLANA}`],
      share: 20.3,
    });
  });

  it('ranks the unlabeled senders behind it by their own messages', () => {
    // #when
    const ranked = rankIdentities(mergeIdentities(XSTOCKS_SENDER_ROWS, resolve), 'messages', 3);
    // #then
    expect(ranked.map((i) => [i.key, i.messages])).toEqual([['project:xstocks', 319], [`address:${BASE_SENDER_1}`, 76], [`address:${BASE_SENDER_2}`, 68]]);
  });

  it("sums one key's rows from several days, and lists the key once", () => {
    // #when
    const [merged] = mergeIdentities([row(BASE, ADDR, 5), row(BASE, ADDR, 3)], identityResolver({}, CHAINS));
    // #then
    expect([merged!.messages, merged!.keys]).toEqual([8, [`${BASE}:${ADDR}`]]);
  });

  it('marks a project inferred only when every one of its rows came from a spread label', () => {
    // #given
    const resolveMaple = identityResolver(ON_ETHEREUM, CHAINS);
    // #when
    const both = mergeIdentities([row(ETH, ADDR, 5), row(BASE, ADDR, 3)], resolveMaple)[0]!.inferred;
    const spreadOnly = mergeIdentities([row(BASE, ADDR, 3)], resolveMaple)[0]!.inferred;
    // #then
    expect([both, spreadOnly]).toEqual([false, true]);
  });

  it('ranks by value, and by fees leaves out an identity with no fee data', () => {
    // #given A moved the most value, B paid the most fees, C has no fee data
    const merged = mergeIdentities([row(BASE, '0xa', 1, 900, 1), row(BASE, '0xb', 1, 100, 9), row(BASE, '0xc', 9, 500, null)], identityResolver({}, CHAINS));
    // #when
    const ranked = [rankIdentities(merged, 'value', 3).map((i) => i.key), rankIdentities(merged, 'fees', 3).map((i) => i.key)];
    // #then
    expect(ranked).toEqual([['address:0xa', 'address:0xc', 'address:0xb'], ['address:0xb', 'address:0xa']]);
  });
});

describe('sharePct', () => {
  it('rounds to one decimal, and is null without a total rather than NaN or Infinity', () => {
    // #then
    expect([sharePct(319, 1_569), sharePct(0, 10), sharePct(5, 0), sharePct(5, null)]).toEqual([20.3, 0, null, null]);
  });
});

describe('sender keys', () => {
  it.each([
    ['project:xstocks', { kind: 'project', slug: 'xstocks' }],
    [`address:${ADDR}`, { kind: 'address', address: ADDR }],
    [`${ETH}:${ADDR}`, { kind: 'legacy', chain: ETH, address: ADDR }],
  ])('reads %s', (key, parsed) => {
    // #then
    expect(parseSenderKey(key)).toEqual(parsed);
  });

  it('lists each labeled address once, and one project’s addresses', () => {
    // #then
    expect([labeledAddresses(XSTOCKS_LABELS), projectAddresses({ ...XSTOCKS_LABELS, ...ON_ETHEREUM }, 'xstocks')]).toEqual([
      [XBRIDGE_EVM, XBRIDGE_SOLANA],
      [XBRIDGE_EVM, XBRIDGE_SOLANA],
    ]);
  });
});
