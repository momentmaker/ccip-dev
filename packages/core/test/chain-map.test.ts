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

  it('keeps Solana mint addresses exactly as given (base58 is case-sensitive)', () => {
    expect(llamaKey(solana, 'So11111111111111111111111111111111111111112')).toBe(
      'solana:So11111111111111111111111111111111111111112',
    );
  });

  it('returns null for an EVM chain DefiLlama does not price', () => {
    expect(llamaKey({ family: 'EVM', chainId: '1750' }, '0xabc')).toBeNull();
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
