import { normalizeAddress } from './normalize';
import type { ChainRef } from './types';

export interface FeePriceAlias {
  key: string;
  decimals: number;
  /**
   * Fees paid before the alias coin's price history starts are valued at the predecessor coin's price that day when one is
   * given, else at the coin's first price. Only the fee backfill applies it; the live Worker prices after launch.
   */
  beforeTrading?: { predecessor?: string };
}

/**
 * Fee tokens DefiLlama has no contract price for, priced as the coin they wrap, at the token's own decimals. Keyed
 * `chainSelector:normalizedAddress`. A wrong decimals value mis-prices every fee by a power of ten, so each was read
 * on chain on 2026-10-08: `decimals()` through the chain's public RPC from chainid.network, or for Aptos the mainnet
 * fullnode's view functions.
 *
 * Canton CC and Mova WMOVA take their decimals from the CCIP docs' tokens.json instead, cross-checked against real fee
 * amounts (CC 33,999,999,999 is 3.4 CC; WMOVA fees are about 1.84 MOVA). DefiLlama has no history for `coingecko:mova-2`,
 * so only the fee backfill prices WMOVA, from CoinGecko's daily history.
 */
export const FEE_PRICE_ALIASES: Readonly<Record<string, FeePriceAlias>> = {
  // Bitlayer WBTC (wrapped native BTC); decimals() on chain
  '7937294810946806131:0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f': { key: 'coingecko:bitcoin', decimals: 18 },
  // Bittensor EVM WTAO; decimals() on chain
  '2135107236357186872:0x5f3b70e0c089a1e3020b1990823bc241a7bf3522': { key: 'coingecko:bittensor', decimals: 18 },
  // Arc CCIP_USDC (wrapped native USDC); decimals() on chain
  '6370580034781731079:0x8dfa585699cb46ca2a5fa649700f09839b4b8743': { key: 'coingecko:usd-coin', decimals: 18 },
  // Pharos WPROS (first price 2026-04-28), priced as native PROS: the wrapped listing's history starts 2026-08-07, PROS's 2026-04-28, within 0.3%
  // of each other since; decimals() on chain, matching the CCIP registry
  '7801139999541420232:0x52c48d4213107b20bc583832b0d951fb9ca8f0b0': { key: 'coingecko:pharos-network', decimals: 18, beforeTrading: {} },
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
  // WEMIX WWEMIX, priced as the native WEMIX coin: the wrapped listing's history has gaps through 2024-09; decimals() on chain
  '5142893604156789321:0x7d72b22a74a216af4a002a1095c8c707d6ec1c5f': { key: 'coingecko:wemix-token', decimals: 18 },
  // BSC LINK (CCIP fee token); decimals() on chain
  '11344663589394136015:0x404460c6a5ede2d891e8297795264fde62adbb75': { key: 'coingecko:chainlink', decimals: 18 },
  // Polygon LINK (CCIP fee token); decimals() on chain
  '4051577828743386545:0xb0897686c545045afc77cf20ec7a532e3120e0f1': { key: 'coingecko:chainlink', decimals: 18 },
  // HashKey Chain WHSK; decimals() on chain, matching the CCIP registry
  '7613811247471741961:0xb210d2120d57b758ee163cffb43e73728c471cf1': { key: 'coingecko:hashkey-ecopoints', decimals: 18 },
  // AB Core WAB (AB is the rebranded Newton token, not newton-protocol); decimals() on chain
  '4829375610284793157:0x51da03503fbba94b9d0d88c15690d840f02f15f4': { key: 'coingecko:newton-project', decimals: 18 },
  // Canton CC (Canton Coin, Canton's only CCIP fee token); decimals from the CCIP docs' tokens.json
  '2308837218439511688:0xd573c85e64a85bc81e99641d37b160febc1581c724255604ce45ef2f99f6628b': { key: 'coingecko:canton-network', decimals: 10 },
  // Canton CC as the API reported it in June 2026, the zero address, with the same 33,999,999,999 fee amounts as CC
  '2308837218439511688:0x0000000000000000000000000000000000000000': { key: 'coingecko:canton-network', decimals: 10 },
  // Robinhood WETH; decimals from the CCIP docs' tokens.json. Its own DefiLlama history starts 2026-07-09.
  '6180753054346818345:0x0bd7d308f8e1639fab988df18a8011f41eacad73': { key: 'coingecko:ethereum', decimals: 18 },
  // TON GRAM (CoinGecko's "Gram (prev. Toncoin)"), the native coin; decimals from the CCIP docs' tokens.json
  '16448340667252469081:EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd99': { key: 'coingecko:the-open-network', decimals: 9 },
  // The rest were read on chain on 2026-10-09 (symbol and decimals()). Each token's own DefiLlama key is missing or starts
  // late: Monad's docs WMON has none, Astar's second WASTR starts 2026-03-04, MegaETH WETH 2026-02-06, Soneium WETH has gaps.
  // Monad WMON; MON's first price is 2025-11-25, so earlier fees take that price
  '8481857512324358265:0x3a704ad3e4784b935ae029171adcf57ee7988198': { key: 'coingecko:monad', decimals: 18, beforeTrading: {} },
  '6422105447186081193:0x37795fdd8c165cab4d6c05771d564d80439cd093': { key: 'coingecko:astar', decimals: 18 },
  '6093540873831549674:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  '12505351618335765396:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  '6325494908023253251:0xbf10e3dd6d1303310d3bf4567595091758827bc5': { key: 'coingecko:ethereum', decimals: 18 },
  // Sui reports its fee token as SUI's CoinMetadata object id; SUI has 9 decimals
  '17529533435026248318:0x9258181f5ceac8dbffb7030890243caed69a9599d2886d957a9cb7656af3bdb3': { key: 'coingecko:sui', decimals: 9 },
  // Read on chain on 2026-10-10 (symbol and decimals()), each with no usable DefiLlama history of its own for the days its fees
  // need: Arbitrum and OP WETH start 2024-08-16; the others have none.
  '4949039107694359620:0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { key: 'coingecko:ethereum', decimals: 18 },
  '3734403246176062136:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  '4348158687435793198:0x4f9a0e7fd2bf6067db6994cf12e4495df938e6e9': { key: 'coingecko:ethereum', decimals: 18 },
  '470401360549526817:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  '1804312132722180201:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  '8788096068760390840:0xc1bf55ee54e16229d9b369a5502bfe5fc9f20b6d': { key: 'coingecko:wrapped-zkcro', decimals: 18 },
  '3229138320728879060:0xfba3d32cc317cbe0c44027b11b8f791961ed2f5c': { key: 'coingecko:hedera-hashgraph', decimals: 8 },
  '17912061998839310979:0xea237441c92cae6fc17caaf9a7acb3f953be4bd1': { key: 'coingecko:plume', decimals: 18 },
  // Mova WMOVA (WrappedMova); decimals from the CCIP docs' tokens.json
  '4215185756725900654:0x911fcc80f48340864f5f94ae9a73d6296d5c2115': { key: 'coingecko:mova-2', decimals: 18 },
  // Aptos APT (the AptosCoin fungible asset at 0xa); 0x1::fungible_asset::decimals and 0x1::coin::decimals on the fullnode
  '4741433654826277614:0x000000000000000000000000000000000000000000000000000000000000000a': { key: 'coingecko:aptos', decimals: 8 },
  // Fee tokens found by the 2026-10-11 coverage pass. Identities on chains that have left the docs come from the Chainlink
  // docs repo's git history of src/config/data/ccip/v1_2_0/mainnet/{chains,tokens}.json; the rest from decimals() and
  // symbol() on chain on 2026-10-11.
  // Mind WETH (docs history 2025-06)
  '11690709103138290329:0x3902228d6a3d2dc44731fd9d45fee6a61c722d0b': { key: 'coingecko:ethereum', decimals: 18 },
  // Everclear WETH (docs history 2025-11)
  '9723842205701363942:0x2e31ebd2eb114943630db6ba8c7f7687bda5835f': { key: 'coingecko:ethereum', decimals: 18 },
  // Memento WETH (docs history 2025-11)
  '6473245816409426016:0x086917568f9317b68595b7552842de816698d7bd': { key: 'coingecko:ethereum', decimals: 18 },
  // Katana WETH, the Vault Bridge ETH (docs)
  '2459028469735686113:0xee7d8bcfb72bc1880d0cf19822eb0a2e6577ab62': { key: 'coingecko:ethereum', decimals: 18 },
  // Kaia WETH (on chain)
  '9813823125703490621:0x465db775fb91b3b81e0419f0f62c6b482c87852c': { key: 'coingecko:ethereum', decimals: 18 },
  // Mode WETH, an OP Stack predeploy; its own DefiLlama history starts 2024-08-16
  '7264351850409363825:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  // Mint WETH, an OP Stack predeploy
  '17164792800244661392:0x4200000000000000000000000000000000000006': { key: 'coingecko:ethereum', decimals: 18 },
  // Blast WETH, the Blast predeploy
  '4411394078118774322:0x4300000000000000000000000000000000000004': { key: 'coingecko:ethereum', decimals: 18 },
  // zkSync WETH (on chain)
  '1562403441176082196:0x5aea5775959fbc2557cc8789bc1bf90a239d9a91': { key: 'coingecko:ethereum', decimals: 18 },
  // Corn WBTCN, BTC-backed, so valued as BTC (docs history 2025-06)
  '9043146809313071210:0xda5ddd7270381a7c2717ad10d1c0ecb19e3cdfb2': { key: 'coingecko:bitcoin', decimals: 18 },
  // Botanix PBTC, BTC-pegged, so valued as BTC (docs history 2025-06)
  '4560701533377838164:0x0d2437f93fed6ea64ef01ccde385fb1263910c56': { key: 'coingecko:bitcoin', decimals: 18 },
  // Treasure WMAGIC (docs history 2025-02)
  '5214452172935136222:0x263d8f36bb8d0d9526255e205868c26690b04b88': { key: 'coingecko:magic', decimals: 18 },
  // Lens WGHO (docs history 2025-11)
  '5608378062013572713:0x6bdc36e20d267ff0dd6097799f82e78907105e2f': { key: 'coingecko:gho', decimals: 18 },
  // AB LINK (docs)
  '4829375610284793157:0x76a443768a5e3b8d1aed0105fc250877841deb40': { key: 'coingecko:chainlink', decimals: 18 },
  // Memento LINK (docs)
  '6473245816409426016:0x76a443768a5e3b8d1aed0105fc250877841deb40': { key: 'coingecko:chainlink', decimals: 18 },
  // Aptos LINK fungible asset; the fullnode's Metadata says decimals 8, "ChainLink Token"
  '4741433654826277614:0x8c764993820ea735719f1ff7f1a0f80c022b18e7b5daefa35adf60a3a6556566': { key: 'coingecko:chainlink', decimals: 8 },
  // Tempo pathUSD (docs); fills the gap in its own key's history from 2026-04-05 to 04-09
  '7281642695469137430:0x20c0000000000000000000000000000000000000': { key: 'coingecko:usd-coin', decimals: 6 },
  // Arc CCIP_USDC at 6 decimals (see the 18-decimal entry above and the fee-groups notes)
  '6370580034781731079:0xcb9a646af26069f052c1b526120facb404c3a131': { key: 'coingecko:usd-coin', decimals: 6 },
  // Fee tokens paid before they traded, valued at the coin's first market price (owner decision 2026-10-11)
  // 0G W0G (docs); first price 2025-09-22
  '4426351306075016396:0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c': { key: 'coingecko:zero-gravity', decimals: 18, beforeTrading: {} },
  // Plasma WXPL (on chain); first price 2025-09-26
  '9335212494177455608:0x6100e367285b01f48d07953803a2d8dca5d19873': { key: 'coingecko:plasma', decimals: 18, beforeTrading: {} },
  // Sonic wS (on chain); S first traded 2025-01-04 and FTM converted 1:1 into S, so earlier fees take FTM's price
  '1673871237479749969:0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38': { key: 'coingecko:sonic-3', decimals: 18, beforeTrading: { predecessor: 'coingecko:fantom' } },
};

/**
 * Test "LINK" tokens with a total supply of 100 and the same 7,756-byte code, read on chain on 2026-10-09 and 10-11.
 * They are worth nothing and are not LINK. Keyed `chainSelector:normalizedAddress`.
 */
export const ZERO_VALUE_FEE_TOKENS: ReadonlySet<string> = new Set([
  // Ethereum test LINK, used 2025-12-17
  '5009297550715157269:0x8aa217dcb84faada02583a7922408b1d623b97c9',
  // Morph test LINK, used 2025-12-17
  '18164309074156128038:0xb2c867cfa606adb53de02f63e6299aa081b29c97',
  // Ethereum test LINK, used 2025-12-13
  '5009297550715157269:0x5e76486ac923f032cea94bdbd5c86c74f104b73f',
  // Morph test LINK, used 2025-12-13
  '18164309074156128038:0xad3f3ac522454b502213f625aac684125b7dd8e4',
]);

export function isZeroValueFeeToken(chain: Pick<ChainRef, 'selector'>, token: string): boolean {
  return ZERO_VALUE_FEE_TOKENS.has(`${chain.selector}:${normalizeAddress(token)}`);
}

export function feePriceAlias(chain: Pick<ChainRef, 'selector'>, token: string): FeePriceAlias | undefined {
  return FEE_PRICE_ALIASES[`${chain.selector}:${normalizeAddress(token)}`];
}
