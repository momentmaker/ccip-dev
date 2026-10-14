import { describe, expect, it } from 'vitest';
import type { Label, ProjectRegistry, RegistryEntry, TokenLabels } from '../src/labels';
import type { SenderChains } from '../src/senders';
import {
  claimedTokenKeys, NO_TOKEN_GROUPS, parseViaTokenKey, splitViaToken, tokenClaims, tokenGroupLookup, viaTokenCredits, viaTokenGroup, viaTokenKey, type TokenClaims,
} from '../src/via-token';

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const CHAINS: SenderChains = new Map([
  [ETH, { name: 'ethereum-mainnet', family: 'EVM' }],
  [BASE, { name: 'ethereum-mainnet-base-1', family: 'EVM' }],
]);
const SYRUP_ETH = '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b';
const SYRUP_BASE = '0x660975730059246a68521a3e2fbd4740173100f5';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const entry = (name: string, x: string | null): RegistryEntry => ({ name, x, url: null, kind: 'issuer', source: null, addresses: [], tokens: [] });
const PROJECTS: ProjectRegistry = { maple: entry('Maple Finance', 'maplefinance'), rival: entry('Rival', null) };
const MAPLE: Label = { name: 'Maple Finance', x: 'maplefinance', kind: 'issuer', slug: 'maple' };
const RIVAL: Label = { name: 'Rival', kind: 'issuer', slug: 'rival' };
const ON_ETHEREUM: TokenLabels = { [`ethereum-mainnet:${SYRUP_ETH}`]: 'maple' };
const GROUPS = new Map([[`${ETH}:${SYRUP_ETH}`, 'g-syrup'], [`${BASE}:${SYRUP_BASE}`, 'g-syrup'], [`${BASE}:${USDC_BASE}`, 'g-usdc']]);
/** The claim a message's first token reaches: its registry group, or the token itself when it has none. */
const claimOf = (claims: TokenClaims, chain: string, token: string) => claims.get(viaTokenGroup(chain, token, tokenGroupLookup(GROUPS)));

describe('token claims', () => {
  it('claims a token outside the registry by its exact chain and address', () => {
    // #given the entry's token has no registry row, so its messages are keyed by the token itself
    const claims = tokenClaims(ON_ETHEREUM, PROJECTS, CHAINS, new Map());
    // #then
    expect(claims.get(viaTokenGroup(ETH, SYRUP_ETH, NO_TOKEN_GROUPS))).toEqual(MAPLE);
  });

  it("claims the token on a sibling chain through the entry's registry group", () => {
    // #given the entry names the Ethereum token, and the message moves its Base sibling
    const claims = tokenClaims(ON_ETHEREUM, PROJECTS, CHAINS, GROUPS);
    // #then
    expect(claimOf(claims, BASE, SYRUP_BASE)).toEqual(MAPLE);
  });

  it('claims nothing for a token no entry names, grouped or not', () => {
    // #given
    const claims = tokenClaims(ON_ETHEREUM, PROJECTS, CHAINS, GROUPS);
    // #then
    expect([claimOf(claims, BASE, USDC_BASE), claimOf(claims, BASE, '0x00000000000000000000000000000000000000ff')]).toEqual([undefined, undefined]);
  });

  it('leaves out a group two projects claim, and keeps each exact token', () => {
    // #given Rival names the Base sibling of Maple's token
    const claims = tokenClaims({ ...ON_ETHEREUM, [`ethereum-mainnet-base-1:${SYRUP_BASE}`]: 'rival' }, PROJECTS, CHAINS, GROUPS);
    // #then
    expect([claims.has('g-syrup'), claims.get(`${ETH}:${SYRUP_ETH}`), claims.get(`${BASE}:${SYRUP_BASE}`)]).toEqual([false, MAPLE, RIVAL]);
  });

  it('skips an entry on a chain the chains table does not know, or of a project the registry lacks', () => {
    // #when
    const claims = tokenClaims({ [`monad-mainnet:${SYRUP_ETH}`]: 'maple', [`ethereum-mainnet-base-1:${USDC_BASE}`]: 'gone' }, PROJECTS, CHAINS, GROUPS);
    // #then
    expect(claims.size).toBe(0);
  });

  it("asks the registry for each known entry's group by selector and address", () => {
    // #then
    expect(claimedTokenKeys({ ...ON_ETHEREUM, [`monad-mainnet:${SYRUP_ETH}`]: 'maple' }, CHAINS)).toEqual([`${ETH}:${SYRUP_ETH}`]);
  });
});

describe('via-token keys', () => {
  it('keys a direct send by sender and group, and reads back a fallback group that holds a colon', () => {
    // #when
    const key = viaTokenKey(BASE, '0xwallet', viaTokenGroup(BASE, '0xloose', NO_TOKEN_GROUPS));
    // #then
    expect({ key, parts: parseViaTokenKey(key) }).toEqual({
      key: `${BASE}:0xwallet|${BASE}:0xloose`,
      parts: { selector: BASE, address: '0xwallet', senderKey: `${BASE}:0xwallet`, group: `${BASE}:0xloose` },
    });
  });
});

describe('via-token credits', () => {
  const claims = tokenClaims(ON_ETHEREUM, PROJECTS, CHAINS, GROUPS);
  const row = (key: string, messages: number, fee_usd: number | null = null) => ({ key, messages, usd_value: messages * 10, fee_usd });

  it("gives each claimed group's credit row its project, and drops the rest", () => {
    // #then
    expect(viaTokenCredits([row(`${BASE}|g-syrup`, 6, 0.6), row(`${BASE}|g-usdc`, 9)], claims)).toEqual([
      { selector: BASE, project: MAPLE, messages: 6, usd_value: 60, fee_usd: 0.6 },
    ]);
  });

  it('moves the claimed direct sends of unlabeled senders to credit rows, keeps the rest, and drops a sender with nothing left', () => {
    // #given W1 only bridged syrup; W2 bridged syrup once and USDC once of its 3; the labeled W3 bridged syrup twice
    const senders = [row(`${BASE}:0xw1`, 5, 0.5), row(`${BASE}:0xw2`, 3), row(`${BASE}:0xw3`, 2)];
    const via = [row(`${BASE}:0xw1|g-syrup`, 5, 0.5), row(`${BASE}:0xw2|g-syrup`, 1), row(`${BASE}:0xw2|g-usdc`, 1), row(`${BASE}:0xw3|g-syrup`, 2)];
    // #when
    const split = splitViaToken(senders, via, claims, new Set(['0xw3']));
    // #then
    expect(split).toEqual({
      senders: [row(`${BASE}:0xw2`, 2), row(`${BASE}:0xw3`, 2)],
      credits: [{ key: `${BASE}|g-syrup`, messages: 6, usd_value: 60, fee_usd: 0.5 }],
    });
  });
});
