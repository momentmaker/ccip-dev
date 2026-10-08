import { describe, expect, it } from 'vitest';
import { llamaKey } from '../src/chain-map';

const base = { family: 'EVM', chainId: '8453' };
const solana = { family: 'SVM', chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' };

describe('llamaKey', () => {
  it('maps a verified EVM chain to its DefiLlama slug with a lowercased address', () => {
    expect(llamaKey(base, '0x9818B6c09f5ECc843060927E8587c427C7C93583')).toBe(
      'base:0x9818b6c09f5ecc843060927e8587c427c7c93583',
    );
  });

  it.each([
    ['964', '0xC5B6c1632d34901239396f5e1bde54b342900256', 'bittensor_evm'],
    ['4663', '0xC6911796042b15d7fa4f6cde69e245ddcd3d9c31', 'robinhood'],
    ['8217', '0x87e617c7484ade79fcd90db58beb82b057facb48', 'kaia'],
  ])('prices chain %s tokens under its verified slug %s', (chainId, address, slug) => {
    expect(llamaKey({ family: 'EVM', chainId }, address)).toBe(`${slug}:${address.toLowerCase()}`);
  });

  it('keeps Solana mint addresses exactly as given (base58 is case-sensitive)', () => {
    expect(llamaKey(solana, 'So11111111111111111111111111111111111111112')).toBe(
      'solana:So11111111111111111111111111111111111111112',
    );
  });

  const wellFormed = '0x9818B6c09f5ECc843060927E8587c427C7C93583';

  it('returns null for a well-formed address on an EVM chain DefiLlama does not price', () => {
    expect(llamaKey({ family: 'EVM', chainId: '1750' }, wellFormed)).toBeNull();
  });

  it('prices the same well-formed address once the chain has a slug', () => {
    expect(llamaKey({ family: 'EVM', chainId: '1' }, wellFormed)).toBe(`ethereum:${wellFormed.toLowerCase()}`);
  });

  it('returns null for a malformed address even on a priced chain', () => {
    expect(llamaKey(base, '0xabc')).toBeNull();
  });

  it('returns null for chain families it does not know', () => {
    expect(llamaKey({ family: 'APTOS', chainId: '1' }, '0x1')).toBeNull();
  });

  it('returns null for malformed addresses instead of building a bad price key', () => {
    expect(llamaKey(base, '0x9818b6c09f5ecc843060927e8587c427c7c9358')).toBeNull();
    expect(llamaKey(base, 'base:0x9818b6c09f5ecc843060927e8587c427c7c93583')).toBeNull();
    expect(llamaKey(solana, 'So1111111111111111111111111111111/../x')).toBeNull();
  });
});
