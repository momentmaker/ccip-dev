import type { ChainRef } from './types';

/**
 * DefiLlama chain slugs keyed by EVM chain id. Each entry was verified on 2026-10-05 by pricing
 * that chain's CCIP-registered LINK token (or its USDC for the six majors) through coins.llama.fi.
 * Chains missing here are valued as unpriced.
 */
export const EVM_LLAMA_SLUGS: Readonly<Record<string, string>> = {
  '1': 'ethereum', '10': 'optimism', '25': 'cronos', '30': 'rsk', '50': 'xdc', '56': 'bsc',
  '100': 'xdai', '109': 'shibarium', '130': 'unichain', '137': 'polygon', '143': 'monad',
  '146': 'sonic', '196': 'xlayer', '204': 'opbnb', '232': 'lens', '239': 'tac', '252': 'fraxtal',
  '324': 'era', '480': 'wc', '592': 'astar', '988': 'stable', '1088': 'metis', '1111': 'wemix',
  '1116': 'core', '1135': 'lisk', '1329': 'sei', '1672': 'pharos', '1868': 'soneium',
  '2020': 'ronin', '2741': 'abstract', '4200': 'merlin', '4217': 'tempo', '4326': 'megaeth',
  '5000': 'mantle', '5042': 'arc', '8453': 'base', '9745': 'plasma', '16661': '0g',
  '33139': 'apechain', '34443': 'mode', '36900': 'adi', '42161': 'arbitrum', '42220': 'celo',
  '43111': 'hemi', '43114': 'avax', '48900': 'zircuit', '57073': 'ink', '59144': 'linea',
  '60808': 'bob', '80094': 'berachain', '98866': 'plume', '167000': 'taiko',
  '200901': 'bitlayer', '534352': 'scroll', '747474': 'katana', '7777777': 'zora',
};

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const OTHER_ADDRESS = /^[0-9A-Za-z:_-]{1,128}$/;

export function isAddressShape(family: string, address: string): boolean {
  if (family === 'EVM') return EVM_ADDRESS.test(address);
  if (family === 'SVM') return BASE58_ADDRESS.test(address);
  return OTHER_ADDRESS.test(address);
}

export function llamaKey(chain: Pick<ChainRef, 'family' | 'chainId'>, address: string): string | null {
  if (!isAddressShape(chain.family, address)) return null;
  if (chain.family === 'EVM') {
    const slug = EVM_LLAMA_SLUGS[chain.chainId];
    return slug ? `${slug}:${address.toLowerCase()}` : null;
  }
  if (chain.family === 'SVM') return `solana:${address}`;
  return null;
}
