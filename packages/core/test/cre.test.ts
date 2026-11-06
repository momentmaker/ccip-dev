import { describe, expect, it } from 'vitest';
import { CRE_LANE_DAY_SQL, creKeyOf, creKeySet, creRetagDaySql, generatedCreKeys, isCreOrigin, NO_CRE_KEYS, type CreKeyFile } from '../src/cre';

const BASE = '15971525489660198786';
const ETH = '5009297550715157269';
const KEY = '0x1d07e028aaaaaaaaaaaaaaaaaaaaaaaaaaaa6327';

const file = (keys: { chain: string; selector: string; address: string }[]): CreKeyFile => ({
  source: 'test',
  chains: Object.fromEntries(
    keys.map((k) => [k.chain, { selector: k.selector, forwarder: '0xf8344cfd5c43616a4366c34e3eee75af79a74482', keys: [{ address: k.address, first_seen: '2026-11-05' }] }]),
  ),
});

describe('generatedCreKeys', () => {
  it('lists each chain key once, lowercased and sorted, with a version that changes with the list', () => {
    // #given
    const one = file([{ chain: 'ethereum-mainnet-base-1', selector: BASE, address: KEY.toUpperCase().replace('0X', '0x') }]);
    const two = file([
      { chain: 'ethereum-mainnet-base-1', selector: BASE, address: KEY },
      { chain: 'ethereum-mainnet', selector: ETH, address: KEY },
    ]);
    // #when
    const a = generatedCreKeys(one);
    const b = generatedCreKeys(two);
    // #then
    expect(a.keys).toEqual([`${BASE}:${KEY}`]);
    expect(b.keys).toEqual([`${BASE}:${KEY}`, `${ETH}:${KEY}`]);
    expect(a.version).not.toBe(b.version);
    expect(generatedCreKeys(one).version).toBe(a.version);
  });

  it('refuses a malformed address', () => {
    // #given
    const bad = file([{ chain: 'ethereum-mainnet-base-1', selector: BASE, address: "0x12'; DROP TABLE messages; --" }]);
    // #then
    expect(() => generatedCreKeys(bad)).toThrow(/malformed/);
  });
});

describe('isCreOrigin', () => {
  const set = creKeySet({ version: 'v', keys: [`${BASE}:${KEY}`] });

  it('matches a node key on its own chain, in any letter case', () => {
    expect(isCreOrigin(set, BASE, KEY.toUpperCase().replace('0X', '0x'))).toBe(true);
  });

  it('does not match the same address on another chain', () => {
    expect(isCreOrigin(set, ETH, KEY)).toBe(false);
  });

  it('never matches a null or non-EVM origin', () => {
    expect(isCreOrigin(set, BASE, null)).toBe(false);
    expect(isCreOrigin(set, BASE, 'bpfe9tJukfJWf4M8SPVR1kzby6NCfH45zA87vbYgtG5')).toBe(false);
  });
});

describe('creKeySet', () => {
  it('refuses a generated key that is not a selector and lowercase address', () => {
    expect(() => creKeySet({ version: 'v', keys: [`${BASE}:0xABC`] })).toThrow(/malformed/);
  });
});

describe('creRetagDaySql', () => {
  it('inlines every key as a literal and only writes rows whose flag changes', () => {
    // #given
    const set = creKeySet({ version: 'v', keys: [`${BASE}:${KEY}`, `${ETH}:${KEY}`] });
    // #when
    const sql = creRetagDaySql(set);
    // #then
    expect(sql).toContain(`'${BASE}:${KEY}', '${ETH}:${KEY}'`);
    expect(sql).toMatch(/WHERE day = \?1 AND cre <> /);
  });

  it('tags nothing with an empty set', () => {
    expect(creRetagDaySql(NO_CRE_KEYS)).toContain('IN (NULL)');
  });
});

describe('CRE_LANE_DAY_SQL', () => {
  it('rebuilds a rolled-up day\u2019s CRE lanes keyed src>dst', () => {
    // #then
    expect(CRE_LANE_DAY_SQL).toContain("'cre_lane', src_chain || '>' || dst_chain");
    expect(CRE_LANE_DAY_SQL).toMatch(/WHERE day = \?1 AND cre = 1 AND EXISTS \(SELECT 1 FROM daily_totals d WHERE d\.day = \?1\)/);
    expect(CRE_LANE_DAY_SQL).toContain('GROUP BY src_chain, dst_chain');
  });
});

describe('creKeyOf', () => {
  it('joins the selector and the lowercase address', () => {
    expect(creKeyOf(BASE, '0xABCDEF0000000000000000000000000000000001')).toBe(`${BASE}:0xabcdef0000000000000000000000000000000001`);
  });
});
