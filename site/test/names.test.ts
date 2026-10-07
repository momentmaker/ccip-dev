import { describe, expect, it } from 'vitest';
import { chainName, chainNameMap, keyChains, laneLabel, senderLabel, shortAddress, shortChainName, tokenLabel } from '../src/lib/names';

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const names = chainNameMap([
  { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet' },
  { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet' },
  { selector: '124615329519749607', name: 'solana-mainnet', display_name: 'Solana' },
  { selector: '17529533435026248318', name: 'sui-mainnet', display_name: null },
]);

describe('names', () => {
  it('drops a trailing " Mainnet" and falls back to the registry name, then the selector', () => {
    expect(shortChainName({ selector: ETH, display_name: 'Ethereum Mainnet' })).toBe('Ethereum');
    expect(shortChainName({ selector: '1', name: 'sui-mainnet', display_name: null })).toBe('Sui');
    expect(shortChainName({ selector: '42' })).toBe('42');
    expect(chainName(names, '17529533435026248318')).toBe('Sui');
    expect(chainName(names, '999')).toBe('999');
  });

  it.each([
    ['ethereum-mainnet-kroma-1', 'Kroma'],
    ['sui-mainnet', 'Sui'],
    ['polygon-mainnet-katana', 'Katana'],
    ['mova-mainnet-2', 'Mova'],
    ['binance_smart_chain-mainnet', 'Binance Smart Chain'],
    ['bitcoin-mainnet-bsquared-1', 'Bsquared'],
  ])('prettifies the registry name %s to %s', (name, label) => {
    expect(shortChainName({ selector: '1', name, display_name: null })).toBe(label);
  });

  it.each([
    ['ethereum-mainnet-kroma-1', 'Kroma'],
    ['treasure-mainnet', 'Treasure'],
    ['sui-mainnet', 'Sui'],
  ])('treats a display name equal to the registry name %s as missing and shows %s', (name, label) => {
    expect(shortChainName({ selector: '1', name, display_name: name })).toBe(label);
  });

  it('treats a raw registry-style display name as missing even without a registry name', () => {
    expect(shortChainName({ selector: '1', name: null, display_name: 'sui-mainnet' })).toBe('Sui');
    expect(shortChainName({ selector: '1', name: 'kroma', display_name: 'ethereum-mainnet-kroma-1' })).toBe('Kroma');
  });

  it('keeps a real display name that is lowercase or hyphenated but not a registry name', () => {
    expect(shortChainName({ selector: '1', name: 'ethereum-mainnet-zksync-1', display_name: 'zkSync Era' })).toBe('zkSync Era');
    expect(shortChainName({ selector: '1', name: 'x-mainnet', display_name: 'Mind-Network' })).toBe('Mind-Network');
  });

  it('labels lanes, tokens and senders', () => {
    expect(laneLabel(names, `${ETH}>${BASE}`)).toBe('Ethereum → Base');
    expect(laneLabel(names, 'broken')).toBe('broken');
    expect(shortAddress('0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b')).toBe('0x80ac…cc0b');
    expect(shortAddress('DWNkc2yq3GSX8N2ZBcBAN6ABmHvk4VwNNW8KyVKTdftT')).toBe('DWNk…dftT');
    expect(tokenLabel(names, `${ETH}:0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b`, 'syrupUSDC')).toEqual({ primary: 'syrupUSDC', secondary: 'Ethereum' });
    expect(tokenLabel(names, `${ETH}:0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b`, null)).toEqual({ primary: '0x80ac…cc0b', secondary: 'Ethereum' });
    expect(senderLabel(names, `${BASE}:0xc6160f5bc3c673ac390f11c492e8ed0d0693579a`, 'Aave')).toEqual({ primary: 'Aave', secondary: 'Base', verified: true });
    expect(senderLabel(names, `${BASE}:0xc6160f5bc3c673ac390f11c492e8ed0d0693579a`, null)).toEqual({ primary: '0xc616…579a', secondary: 'Base', verified: false });
  });
});

describe('keyChains', () => {
  it('reads both ends of a lane key', () => {
    expect(keyChains('1>2')).toEqual(['1', '2']);
  });

  it('reads the chain of a token or sender key', () => {
    expect(keyChains('5009297550715157269:0xabc')).toEqual(['5009297550715157269']);
  });

  it('returns nothing for a key without a chain', () => {
    expect(keyChains('0xabc')).toEqual([]);
    expect(keyChains('1>2>3')).toEqual([]);
  });
});
