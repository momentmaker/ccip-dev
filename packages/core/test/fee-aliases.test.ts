import { describe, expect, it } from 'vitest';
import { FEE_PRICE_ALIASES, feePriceAlias, isZeroValueFeeToken } from '../src/fee-aliases';
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
      key: 'coingecko:pharos-network', decimals: 18, beforeTrading: {},
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
    ['Arbitrum WETH, whose own history starts 2024-08-16', '4949039107694359620', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'coingecko:ethereum', 18],
    ['OP WETH, whose own history starts 2024-08-16', '3734403246176062136', '0x4200000000000000000000000000000000000006', 'coingecko:ethereum', 18],
    ['WEMIX WWEMIX as the native WEMIX coin', '5142893604156789321', '0x7D72b22a74A216Af4a002a1095C8C707d6eC1C5f', 'coingecko:wemix-token', 18],
    ['Polygon zkEVM WETH', '4348158687435793198', '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9', 'coingecko:ethereum', 18],
    ['Superseed WETH', '470401360549526817', '0x4200000000000000000000000000000000000006', 'coingecko:ethereum', 18],
    ['Hemi WETH', '1804312132722180201', '0x4200000000000000000000000000000000000006', 'coingecko:ethereum', 18],
    ['Cronos zkEVM wzkCRO', '8788096068760390840', '0xc1bf55ee54e16229d9b369a5502bfe5fc9f20b6d', 'coingecko:wrapped-zkcro', 18],
    ['Hedera older WHBAR at 8 decimals', '3229138320728879060', '0xfba3d32cc317cbe0c44027b11b8f791961ed2f5c', 'coingecko:hedera-hashgraph', 8],
    ['Plume WPLUME', '17912061998839310979', '0xea237441c92cae6fc17caaf9a7acb3f953be4bd1', 'coingecko:plume', 18],
  ])('prices %s', (_label, selector, token, key, decimals) => {
    expect(feePriceAlias({ selector }, token)).toMatchObject({ key, decimals });
  });

  it('prices Mova WMOVA as mova-2 at 18 decimals', () => {
    expect(feePriceAlias({ selector: '4215185756725900654' }, '0x911FCC80F48340864F5F94AE9A73D6296D5C2115')).toEqual({
      key: 'coingecko:mova-2', decimals: 18,
    });
  });
});

describe('aliases for fee tokens identified from the docs history and on chain', () => {
  it.each([
    ['Mind WETH', '11690709103138290329', '0x3902228d6a3d2dc44731fd9d45fee6a61c722d0b', 'coingecko:ethereum', 18],
    ['Everclear WETH', '9723842205701363942', '0x2e31ebd2eb114943630db6ba8c7f7687bda5835f', 'coingecko:ethereum', 18],
    ['Memento WETH', '6473245816409426016', '0x086917568f9317b68595b7552842de816698d7bd', 'coingecko:ethereum', 18],
    ['Katana WETH', '2459028469735686113', '0xee7d8bcfb72bc1880d0cf19822eb0a2e6577ab62', 'coingecko:ethereum', 18],
    ['Kaia WETH', '9813823125703490621', '0x465db775fb91b3b81e0419f0f62c6b482c87852c', 'coingecko:ethereum', 18],
    ['Mode WETH', '7264351850409363825', '0x4200000000000000000000000000000000000006', 'coingecko:ethereum', 18],
    ['Mint WETH', '17164792800244661392', '0x4200000000000000000000000000000000000006', 'coingecko:ethereum', 18],
    ['Blast WETH', '4411394078118774322', '0x4300000000000000000000000000000000000004', 'coingecko:ethereum', 18],
    ['zkSync WETH', '1562403441176082196', '0x5aea5775959fbc2557cc8789bc1bf90a239d9a91', 'coingecko:ethereum', 18],
    ['Corn WBTCN as BTC', '9043146809313071210', '0xda5ddd7270381a7c2717ad10d1c0ecb19e3cdfb2', 'coingecko:bitcoin', 18],
    ['Botanix PBTC as BTC', '4560701533377838164', '0x0d2437f93fed6ea64ef01ccde385fb1263910c56', 'coingecko:bitcoin', 18],
    ['Treasure WMAGIC', '5214452172935136222', '0x263d8f36bb8d0d9526255e205868c26690b04b88', 'coingecko:magic', 18],
    ['Lens WGHO', '5608378062013572713', '0x6bdc36e20d267ff0dd6097799f82e78907105e2f', 'coingecko:gho', 18],
    ['AB LINK', '4829375610284793157', '0x76a443768a5e3b8d1aed0105fc250877841deb40', 'coingecko:chainlink', 18],
    ['Memento LINK', '6473245816409426016', '0x76a443768a5e3b8d1aed0105fc250877841deb40', 'coingecko:chainlink', 18],
    ['Aptos LINK at 8 decimals', '4741433654826277614', '0x8c764993820ea735719f1ff7f1a0f80c022b18e7b5daefa35adf60a3a6556566', 'coingecko:chainlink', 8],
    ['Tempo pathUSD', '7281642695469137430', '0x20c0000000000000000000000000000000000000', 'coingecko:usd-coin', 6],
    ['Arc CCIP_USDC at 6 decimals', '6370580034781731079', '0xcb9a646af26069f052c1b526120facb404c3a131', 'coingecko:usd-coin', 6],
  ])('prices %s', (_label, selector, token, key, decimals) => {
    expect(feePriceAlias({ selector }, token)).toMatchObject({ key, decimals });
  });

  it.each([
    ['Pharos WPROS', '7801139999541420232', '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0', 'coingecko:pharos-network', {}],
    ['Monad WMON', '8481857512324358265', '0x3a704ad3e4784b935ae029171adcf57ee7988198', 'coingecko:monad', {}],
    ['0G W0G', '4426351306075016396', '0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c', 'coingecko:zero-gravity', {}],
    ['Plasma WXPL', '9335212494177455608', '0x6100e367285b01f48d07953803a2d8dca5d19873', 'coingecko:plasma', {}],
    ['Sonic wS, whose predecessor is FTM', '1673871237479749969', '0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38', 'coingecko:sonic-3', { predecessor: 'coingecko:fantom' }],
  ])('values %s before it traded at the coin\'s first price or its predecessor\'s', (_label, selector, token, key, beforeTrading) => {
    expect(feePriceAlias({ selector }, token)).toEqual({ key, decimals: 18, beforeTrading });
  });
});

describe('isZeroValueFeeToken', () => {
  it.each([
    ['Ethereum', '5009297550715157269', '0x8aa217dcb84faada02583a7922408b1d623b97c9'],
    ['Morph', '18164309074156128038', '0xb2c867cfa606adb53de02f63e6299aa081b29c97'],
    ['Ethereum', '5009297550715157269', '0x5E76486AC923F032CEA94BDBD5C86C74F104B73F'],
    ['Morph', '18164309074156128038', '0xad3f3ac522454b502213f625aac684125b7dd8e4'],
  ])('knows the %s test LINK %s', (_chain, selector, token) => {
    expect(isZeroValueFeeToken({ selector }, token)).toBe(true);
  });

  it('does not know real LINK', () => {
    expect(isZeroValueFeeToken({ selector: '5009297550715157269' }, '0x514910771AF9Ca656af840dff83E8264EcF986CA')).toBe(false);
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
