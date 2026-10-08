import { normalizeAddress } from './normalize';
import type { ChainRef } from './types';

export interface FeePriceAlias {
  key: string;
  decimals: number;
}

/**
 * Fee tokens DefiLlama has no contract price for, priced as the coin they wrap, at the token's own decimals. Keyed
 * `chainSelector:normalizedAddress`. A wrong decimals value mis-prices every fee by a power of ten, so each was read
 * on chain on 2026-10-08: `decimals()` through the chain's public RPC from chainid.network, or for Aptos the mainnet
 * fullnode's view functions.
 *
 * Still unpriced, for want of a verified free price or verified decimals: Canton CC, Mova, HashKey HSK and AB.
 */
export const FEE_PRICE_ALIASES: Readonly<Record<string, FeePriceAlias>> = {
  // Bitlayer WBTC (wrapped native BTC); decimals() on chain
  '7937294810946806131:0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f': { key: 'coingecko:bitcoin', decimals: 18 },
  // Bittensor EVM WTAO; decimals() on chain
  '2135107236357186872:0x5f3b70e0c089a1e3020b1990823bc241a7bf3522': { key: 'coingecko:bittensor', decimals: 18 },
  // Arc CCIP_USDC (wrapped native USDC); decimals() on chain
  '6370580034781731079:0x8dfa585699cb46ca2a5fa649700f09839b4b8743': { key: 'coingecko:usd-coin', decimals: 18 },
  // Pharos WPROS; decimals() on chain, matching the CCIP registry
  '7801139999541420232:0x52c48d4213107b20bc583832b0d951fb9ca8f0b0': { key: 'coingecko:wrapped-pros-pharos', decimals: 18 },
  // Gravity wG; decimals() on chain
  '2988178761202034333:0xbb859e225ac8fb6be1c7e38d87b767e95fef0ebd': { key: 'coingecko:g-token', decimals: 18 },
  // Stable WUSDT0; decimals() on chain
  '16978377838628290997:0xb23540d08122c634a839f0143267bea9936dd466': { key: 'coingecko:usdt0', decimals: 18 },
  // Celo WCELO; decimals() on chain
  '1346049177634351622:0x2021b12d8138e2d63cf0895eccabc0dfc92416c6': { key: 'coingecko:celo', decimals: 18 },
  // Zircuit WETH; decimals() on chain
  '17198166215261833993:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  // Jovay WETH; decimals() on chain
  '1523760397290643893:0xea29cbb2808cf848c185e4405bb002f53f92a241': { key: 'coingecko:ethereum', decimals: 18 },
  // Metal WETH; decimals() on chain
  '13447077090413146373:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  // Creditcoin WCTC; decimals() on chain
  '18240105181246962294:0x1f40d7292cfbe5ed4c66afc60c72f7b1012673df': { key: 'coingecko:creditcoin-2', decimals: 18 },
  // Shibarium WBONE; decimals() on chain
  '3993510008929295315:0xc76f4c819d820369fb2d7c1531ab3bb18e6fe8d8': { key: 'coingecko:bone-shibaswap', decimals: 18 },
  // Hedera WHBAR; decimals() on chain (8, like HBAR itself)
  '3229138320728879060:0xb1f616b8134f602c3bb465fb5b5e6565ccad37ed': { key: 'coingecko:hedera-hashgraph', decimals: 8 },
  // TAC WTAC; decimals() on chain
  '5936861837188149645:0xb63b9f0eb4a6e6f191529d71d4d88cc8900df2c9': { key: 'coingecko:tac', decimals: 18 },
  // Nexon Henesys WNXPC; decimals() on chain
  '12657445206920369324:0x150869eac5c58d3655f860c4316107fb626244d0': { key: 'coingecko:nexpace', decimals: 18 },
  // WEMIX WWEMIX; decimals() on chain
  '5142893604156789321:0x7d72b22a74a216af4a002a1095c8c707d6ec1c5f': { key: 'coingecko:wwemix', decimals: 18 },
  // BSC LINK (CCIP fee token); decimals() on chain
  '11344663589394136015:0x404460c6a5ede2d891e8297795264fde62adbb75': { key: 'coingecko:chainlink', decimals: 18 },
  // Polygon LINK (CCIP fee token); decimals() on chain
  '4051577828743386545:0xb0897686c545045afc77cf20ec7a532e3120e0f1': { key: 'coingecko:chainlink', decimals: 18 },
  // Aptos APT (the AptosCoin fungible asset at 0xa); 0x1::fungible_asset::decimals and 0x1::coin::decimals on the fullnode
  '4741433654826277614:0x000000000000000000000000000000000000000000000000000000000000000a': { key: 'coingecko:aptos', decimals: 8 },
};

export function feePriceAlias(chain: Pick<ChainRef, 'selector'>, token: string): FeePriceAlias | undefined {
  return FEE_PRICE_ALIASES[`${chain.selector}:${normalizeAddress(token)}`];
}
