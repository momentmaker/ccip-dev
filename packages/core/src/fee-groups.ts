import { FEE_TOKEN_GROUPS_FROM_DOCS } from './fee-groups-docs';
import { normalizeAddress } from './normalize';
import { linkFeeMatcher, type LinkFeeMatcher, type LinkFeeTokens } from './rollup';
import type { MessageRow } from './types';
import { toUnits } from './value';

export type FeeGroup = 'link' | 'native' | 'stable' | 'other';

export interface FeeTokenGroup {
  group: 'native' | 'stable';
  symbol: string;
}

export interface FeeTokenClass {
  group: FeeGroup;
  symbol: string | null;
  linkDecimals: number | null;
}

export type FeeClassifier = (chain: string, feeToken: string) => FeeTokenClass;

export interface FeeGroupTotals {
  link_usd: number | null;
  native_usd: number | null;
  stable_usd: number | null;
  link_amount: number | null;
}

/**
 * Fee tokens the CCIP API reports that the docs list under another address, or not at all, checked on 2026-10-09:
 * symbol() through a keyless RPC, Sui's object through Sui's GraphQL API, and Canton's CC as FEE_PRICE_ALIASES has it.
 */
const HAND_ADDED: Readonly<Record<string, FeeTokenGroup>> = {
  // Arc CCIP_USDC (wrapped native USDC), 18 decimals; the docs list only LINK for Arc
  '6370580034781731079:0x8dfa585699cb46ca2a5fa649700f09839b4b8743': { group: 'stable', symbol: 'CCIP_USDC' },
  // Arc CCIP_USDC at 6 decimals, used 2026-07-07 to 07-10
  '6370580034781731079:0xcb9a646af26069f052c1b526120facb404c3a131': { group: 'stable', symbol: 'CCIP_USDC' },
  // Blast WETH; Blast has left the docs
  '4411394078118774322:0x4300000000000000000000000000000000000004': { group: 'native', symbol: 'WETH' },
  // Canton CC as the API reports it; the docs give its Daml id (Amulet@DSO::…) instead
  '2308837218439511688:0xd573c85e64a85bc81e99641d37b160febc1581c724255604ce45ef2f99f6628b': { group: 'native', symbol: 'CC' },
  // Canton CC as the API reported it in June 2026, the zero address (see FEE_PRICE_ALIASES)
  '2308837218439511688:0x0000000000000000000000000000000000000000': { group: 'native', symbol: 'CC' },
  // Celo WCELO; the docs list the CELO token itself (0x471e…a438)
  '1346049177634351622:0x2021b12d8138e2d63cf0895eccabc0dfc92416c6': { group: 'native', symbol: 'WCELO' },
  // Metis WMETIS; the docs list the METIS precompile (0xdead…0000)
  '8805746078405598895:0x75cb093e4d61d2a2e65d8e0bbb01de8d89b53481': { group: 'native', symbol: 'WMETIS' },
  // Fraxtal WFRAX; the docs' WFRAX address (0xfc00…0006) is frxETH on chain
  '1462016016387883143:0xfc00000000000000000000000000000000000002': { group: 'native', symbol: 'WFRAX' },
  // Gravity wG; Gravity is not in the docs
  '2988178761202034333:0xbb859e225ac8fb6be1c7e38d87b767e95fef0ebd': { group: 'native', symbol: 'wG' },
  // Monad WMON; the docs list another WMON (0x3a70…8198) that only a 2026-02-21 to 02-23 burst used
  '8481857512324358265:0x3bd359c1119da7da1d913d1c4d2b7c461115433a': { group: 'native', symbol: 'WMON' },
  // Astar's older WASTR; the docs list 0x3779…d093
  '6422105447186081193:0xaeaaf0e2c81af264101b9129c00f4440ccf0f720': { group: 'native', symbol: 'WASTR' },
  // Sui SUI: the API reports SUI's CoinMetadata object id; Sui is not in the docs
  '17529533435026248318:0x9258181f5ceac8dbffb7030890243caed69a9599d2886d957a9cb7656af3bdb3': { group: 'native', symbol: 'SUI' },
  // TAC WTAC; TAC is not in the docs
  '5936861837188149645:0xb63b9f0eb4a6e6f191529d71d4d88cc8900df2c9': { group: 'native', symbol: 'WTAC' },
  // Gas tokens on chains or contracts the docs no longer list; WETH, wzkCRO and WHBAR read on chain on 2026-10-10
  '4348158687435793198:0x4f9a0e7fd2bf6067db6994cf12e4495df938e6e9': { group: 'native', symbol: 'WETH' },
  '470401360549526817:0x4200000000000000000000000000000000000006': { group: 'native', symbol: 'WETH' },
  '1804312132722180201:0x4200000000000000000000000000000000000006': { group: 'native', symbol: 'WETH' },
  '17164792800244661392:0x4200000000000000000000000000000000000006': { group: 'native', symbol: 'WETH' },
  // Kroma's WETH predeploy sits at 0x4200…0001, not the OP Stack's 0x4200…0006; DefiLlama prices it as WETH
  '3719320017875267166:0x4200000000000000000000000000000000000001': { group: 'native', symbol: 'WETH' },
  '3229138320728879060:0xfba3d32cc317cbe0c44027b11b8f791961ed2f5c': { group: 'native', symbol: 'WHBAR' },
  // Fee tokens on chains that have left the docs, identified from the docs' git history or on chain on 2026-10-11 (see FEE_PRICE_ALIASES)
  '11690709103138290329:0x3902228d6a3d2dc44731fd9d45fee6a61c722d0b': { group: 'native', symbol: 'WETH' },
  '9723842205701363942:0x2e31ebd2eb114943630db6ba8c7f7687bda5835f': { group: 'native', symbol: 'WETH' },
  '6473245816409426016:0x086917568f9317b68595b7552842de816698d7bd': { group: 'native', symbol: 'WETH' },
  '9813823125703490621:0x465db775fb91b3b81e0419f0f62c6b482c87852c': { group: 'native', symbol: 'WETH' },
  // BTC-backed gas tokens, valued as BTC
  '9043146809313071210:0xda5ddd7270381a7c2717ad10d1c0ecb19e3cdfb2': { group: 'native', symbol: 'WBTCN' },
  '4560701533377838164:0x0d2437f93fed6ea64ef01ccde385fb1263910c56': { group: 'native', symbol: 'PBTC' },
  '5214452172935136222:0x263d8f36bb8d0d9526255e205868c26690b04b88': { group: 'native', symbol: 'WMAGIC' },
};

/** Keyed `chainSelector:normalizedAddress`, as FEE_PRICE_ALIASES is. LINK is never here: it has its own matcher. */
export const FEE_TOKEN_GROUPS: Readonly<Record<string, FeeTokenGroup>> = { ...FEE_TOKEN_GROUPS_FROM_DOCS, ...HAND_ADDED };

const keyOf = (chain: string, token: string) => `${chain}:${normalizeAddress(token)}`;

export function feeTokenGroup(chain: string, feeToken: string, isLinkFee: LinkFeeMatcher): FeeGroup {
  if (isLinkFee(chain, feeToken)) return 'link';
  return FEE_TOKEN_GROUPS[keyOf(chain, feeToken)]?.group ?? 'other';
}

export function feeClassifier(linkTokens: LinkFeeTokens): FeeClassifier {
  const isLinkFee = linkFeeMatcher(linkTokens);
  return (chain, feeToken) => {
    const key = keyOf(chain, feeToken);
    const group = feeTokenGroup(chain, feeToken, isLinkFee);
    if (group === 'link') return { group, symbol: 'LINK', linkDecimals: linkTokens.get(key)! };
    return { group, symbol: FEE_TOKEN_GROUPS[key]?.symbol ?? null, linkDecimals: null };
  };
}

/**
 * A day's fees by group, shared by the Worker's finalize and the fee backfill build. Null throughout when no message has a
 * priced fee, as rollupDay's fee_usd is. LINK is also counted in LINK units, priced or not.
 */
export function feeGroupTotals(messages: MessageRow[], day: string, classify: FeeClassifier): FeeGroupTotals {
  const byId = new Map<string, MessageRow>();
  for (const m of messages) if (m.day === day) byId.set(m.message_id, m);
  const rows = [...byId.values()];
  if (!rows.some((r) => r.fee_usd !== null)) return { link_usd: null, native_usd: null, stable_usd: null, link_amount: null };
  const totals = { link_usd: 0, native_usd: 0, stable_usd: 0, link_amount: 0 };
  for (const r of rows) {
    if (r.fee_token === null) continue;
    const { group, linkDecimals } = classify(r.src_chain, r.fee_token);
    if (group === 'link' && r.fee_amount !== null) totals.link_amount += toUnits(r.fee_amount, linkDecimals!);
    if (r.fee_usd === null) continue;
    if (group === 'link') totals.link_usd += r.fee_usd;
    else if (group === 'native') totals.native_usd += r.fee_usd;
    else if (group === 'stable') totals.stable_usd += r.fee_usd;
  }
  return totals;
}
