import { describe, expect, it } from 'vitest';
import { FEE_PRICE_ALIASES, feePriceAlias } from '../src/fee-aliases';
import { normalizeAddress } from '../src/normalize';

const BITLAYER = { selector: '7937294810946806131' };

describe('feePriceAlias', () => {
  it('finds an aliased fee token by its chain and a mixed-case address', () => {
    // #given
    const token = '0xFF204E2681a6fa0e2c3fADE68a1B28fb90E4FC5F';
    // #when
    const alias = feePriceAlias(BITLAYER, token);
    // #then
    expect(alias).toEqual({ key: 'coingecko:bitcoin', decimals: 18 });
  });

  it('has no alias for the same token on another chain', () => {
    // #when
    const alias = feePriceAlias({ selector: '15971525489660198786' }, '0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f');
    // #then
    expect(alias).toBeUndefined();
  });
});

describe('Canton, Mova and Pharos aliases', () => {
  it('prices Canton CC as canton-network at 10 decimals, leaving its 64-hex id as is', () => {
    // #given
    const cc = '0xd573c85e64a85bc81e99641d37b160febc1581c724255604ce45ef2f99f6628b';
    // #then
    expect(feePriceAlias({ selector: '2308837218439511688' }, cc)).toEqual({ key: 'coingecko:canton-network', decimals: 10 });
  });

  it('leaves the other Canton fee token unaliased', () => {
    expect(feePriceAlias({ selector: '2308837218439511688' }, '0xa218e95e')).toBeUndefined();
  });

  it('prices Pharos WPROS as the native PROS coin, whose history starts months before the wrapped listing', () => {
    expect(feePriceAlias({ selector: '7801139999541420232' }, '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0')).toEqual({
      key: 'coingecko:pharos-network', decimals: 18,
    });
  });

  it.each([
    ['Canton CC reported as the zero address', '2308837218439511688', '0x0000000000000000000000000000000000000000', 'coingecko:canton-network', 10],
    ['Robinhood WETH', '6180753054346818345', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', 'coingecko:ethereum', 18],
    ['TON GRAM, its case-sensitive native address kept as is', '16448340667252469081', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd99', 'coingecko:the-open-network', 9],
    ['Monad WMON at the docs address', '8481857512324358265', '0x3A704ad3E4784b935AE029171AdCF57ee7988198', 'coingecko:monad', 18],
    ['Astar WASTR at 0x3779', '6422105447186081193', '0x37795FDD8C165CaB4D6c05771D564d80439CD093', 'coingecko:astar', 18],
    ['MegaETH WETH', '6093540873831549674', '0x4200000000000000000000000000000000000006', 'coingecko:ethereum', 18],
    ['Soneium WETH', '12505351618335765396', '0x4200000000000000000000000000000000000006', 'coingecko:ethereum', 18],
    ['Edge WETH', '6325494908023253251', '0xbf10e3dd6d1303310d3bf4567595091758827bc5', 'coingecko:ethereum', 18],
    ['Sui SUI by its CoinMetadata object id', '17529533435026248318', '0x9258181f5ceac8dbffb7030890243caed69a9599d2886d957a9cb7656af3bdb3', 'coingecko:sui', 9],
  ])('prices %s', (_label, selector, token, key, decimals) => {
    expect(feePriceAlias({ selector }, token)).toEqual({ key, decimals });
  });

  it('prices Mova WMOVA as mova-2 at 18 decimals', () => {
    expect(feePriceAlias({ selector: '4215185756725900654' }, '0x911FCC80F48340864F5F94AE9A73D6296D5C2115')).toEqual({
      key: 'coingecko:mova-2', decimals: 18,
    });
  });
});

describe('FEE_PRICE_ALIASES', () => {
  const entries = Object.entries(FEE_PRICE_ALIASES);

  it('prices every entry through a coingecko: key', () => {
    // #then
    expect(entries.filter(([, a]) => !/^coingecko:[a-z0-9-]+$/.test(a.key))).toEqual([]);
  });

  it('gives every entry integer decimals between 0 and 36', () => {
    // #then
    expect(entries.filter(([, a]) => !Number.isInteger(a.decimals) || a.decimals < 0 || a.decimals > 36)).toEqual([]);
  });

  it('keys every entry by chain selector and normalized address, so a lookup can find it', () => {
    // #then
    const misKeyed = entries.filter(([k]) => {
      const [selector, address, ...rest] = k.split(':');
      return rest.length > 0 || !/^\d+$/.test(selector ?? '') || address === undefined || normalizeAddress(address) !== address;
    });
    expect(misKeyed).toEqual([]);
  });
});
