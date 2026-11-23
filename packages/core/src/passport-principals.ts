import { addressWord, decodeArray, decodeTuple, decodeValue, encodeCall, uintWord, type EvmCall, type StaticType } from './evm-abi';
import { readCalls, readCode, type CallResult, type PinnedChain } from './evm-read';
import type { HttpDeps } from './http';

/** Stamps every stored reading and result (KTD13); raise it whenever a rule here or in the checklist evaluation changes. */
export const METHOD_VERSION = 2;

export type SafeRelease = '1.3.0' | '1.3.0 L2' | '1.4.1' | '1.4.1 L2' | '1.5.0' | '1.5.0 L2';

/**
 * Safe singletons from github.com/safe-global/safe-deployments (src/assets, fetched 2026-11-23): the canonical, eip155 and
 * zkSync builds of each release, listed for a chain only where that repository's networkAddresses lists them, for the
 * chains in config/ccip-directory.json. A chain left out recognises no Safe.
 */
const SAFE = {
  V130_CANONICAL: '0xd9db270c1b5e3bd161e8c8503c55ceabee709552',
  V130_EIP155: '0x69f4d1788e39c87893c980c06edf4b7f686e2938',
  V130_ZKSYNC: '0xb00ce5cccdef57e539ddced01df43a13855d9910',
  V130_L2_CANONICAL: '0x3e5c63644e683549055b9be8653de26e0b4cd36e',
  V130_L2_EIP155: '0xfb1bffc9d739b8d520daf37df666da4c687191ea',
  V130_L2_ZKSYNC: '0x1727c2c531cf966f902e5927b98490fdfb3b2b70',
  V141_CANONICAL: '0x41675c099f32341bf84bfc5382af534df5c7461a',
  V141_ZKSYNC: '0xc35f063962328ac65ced5d4c3fc5def8dec68dfa',
  V141_L2_CANONICAL: '0x29fcb43b46531bca003ddc8fcb67ffe91900c762',
  V141_L2_ZKSYNC: '0x610fca2e0279fa1f8c00c8c2f71df522ad469380',
  V150_CANONICAL: '0xff51a5898e281db6dfc7855790607438df2ca44b',
  V150_L2_CANONICAL: '0xedd160febbd92e350d4d398fb636302fccd67c7e',
} as const;

/**
 * Safe singletons outside safe-deployments, each reviewed by hand before pinning. The Ethereum one backs a proposer of
 * LINK's CCIP admin timelock: a self-compiled GnosisSafe from safe-global's main branch shortly after 1.3.0 (Sourcify exact
 * match). Its only behavioural change from 1.3.0 is that setGuard checks ERC-165, which cannot let fewer signers act.
 */
const REVIEWED_SAFE = {
  V130_SELF_BUILT_ETHEREUM: '0x2ed1a552c03f843a2db7de10ad390d24bb66cee0',
} as const;

const SAFE_SINGLETON_RELEASES: Readonly<Record<string, SafeRelease>> = {
  [SAFE.V130_CANONICAL]: '1.3.0',
  [SAFE.V130_EIP155]: '1.3.0',
  [SAFE.V130_ZKSYNC]: '1.3.0',
  [SAFE.V130_L2_CANONICAL]: '1.3.0 L2',
  [SAFE.V130_L2_EIP155]: '1.3.0 L2',
  [SAFE.V130_L2_ZKSYNC]: '1.3.0 L2',
  [SAFE.V141_CANONICAL]: '1.4.1',
  [SAFE.V141_ZKSYNC]: '1.4.1',
  [SAFE.V141_L2_CANONICAL]: '1.4.1 L2',
  [SAFE.V141_L2_ZKSYNC]: '1.4.1 L2',
  [SAFE.V150_CANONICAL]: '1.5.0',
  [SAFE.V150_L2_CANONICAL]: '1.5.0 L2',
  [REVIEWED_SAFE.V130_SELF_BUILT_ETHEREUM]: '1.3.0',
};

export const SAFE_SINGLETONS: Readonly<Record<number, readonly string[]>> = {
  1: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL, REVIEWED_SAFE.V130_SELF_BUILT_ETHEREUM],
  10: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  25: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  30: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  50: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  56: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  100: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  109: [SAFE.V130_EIP155, SAFE.V130_L2_EIP155],
  130: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  137: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  143: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  146: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  177: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  196: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  204: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  232: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_ZKSYNC, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V130_L2_ZKSYNC, SAFE.V141_CANONICAL, SAFE.V141_ZKSYNC, SAFE.V141_L2_CANONICAL, SAFE.V141_L2_ZKSYNC, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  252: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  295: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL],
  324: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_ZKSYNC, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V130_L2_ZKSYNC, SAFE.V141_CANONICAL, SAFE.V141_ZKSYNC, SAFE.V141_L2_CANONICAL, SAFE.V141_L2_ZKSYNC, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  388: [SAFE.V130_ZKSYNC, SAFE.V130_L2_ZKSYNC],
  480: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  592: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  964: [SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  988: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  999: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  1088: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155],
  1111: [SAFE.V130_EIP155, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  1116: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL],
  1329: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  1672: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  1750: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  1868: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  2020: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL],
  2741: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_ZKSYNC, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V130_L2_ZKSYNC, SAFE.V141_CANONICAL, SAFE.V141_ZKSYNC, SAFE.V141_L2_CANONICAL, SAFE.V141_L2_ZKSYNC],
  2818: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  4217: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  4326: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  4663: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  5000: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  5042: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  8217: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  8453: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  9745: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  16661: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  33139: [SAFE.V130_EIP155, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  34443: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  36888: [SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  36900: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  42161: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  42220: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  42793: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  43111: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  43114: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  47763: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  48900: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  57073: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  59144: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  60808: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  80094: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  98866: [SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  102030: [SAFE.V130_EIP155, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  127001: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  167000: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  200901: [SAFE.V130_CANONICAL, SAFE.V130_L2_CANONICAL, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
  534352: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  747474: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL, SAFE.V150_CANONICAL, SAFE.V150_L2_CANONICAL],
  7777777: [SAFE.V130_CANONICAL, SAFE.V130_EIP155, SAFE.V130_L2_CANONICAL, SAFE.V130_L2_EIP155, SAFE.V141_CANONICAL, SAFE.V141_L2_CANONICAL],
};

export type PartyKind = 'wallet' | 'delegated-wallet' | 'safe' | 'mcms' | 'timelock' | 'absent' | 'no-key' | 'unidentified';
export type TimelockRole = 'proposer' | 'bypasser' | 'admin';

export interface SafeFacts {
  singleton: string;
  release: SafeRelease;
  threshold: number;
  owners: number;
}

export interface McmsFacts {
  rootQuorum: number;
  /** Every signer in the configuration, whether or not it counts toward the fewest. */
  signers: number;
}

export interface TimelockMember {
  address: string;
  roles: TimelockRole[];
  kind: PartyKind;
  signers: number | null;
}

export interface TimelockFacts {
  /** getMinDelay() in seconds, as a decimal string. */
  minDelay: string;
  /** Proposers, bypassers and admins, each classified; the timelock itself, and any timelock above it, is left out. */
  members: TimelockMember[];
  /** The members whose signer count is the timelock's. */
  decidedBy: string[];
}

/** One party: its kind and the number of signers needed to act, null when no number can be given. */
export type PartyClassification =
  | { kind: 'wallet'; signers: 1 }
  | { kind: 'delegated-wallet'; signers: 1; delegate: string }
  | { kind: 'safe'; signers: number; safe: SafeFacts }
  | { kind: 'mcms'; signers: number; mcms: McmsFacts }
  | { kind: 'timelock'; signers: number; timelock: TimelockFacts }
  | { kind: 'absent'; signers: null }
  | { kind: 'no-key'; signers: null }
  | { kind: 'unidentified'; signers: null; reason: string };

const ZERO = '0x0000000000000000000000000000000000000000';
const BURN = '0x000000000000000000000000000000000000dead';
const SAFE_SENTINEL = '0x0000000000000000000000000000000000000001';
const TIMELOCK_DEPTH = 3;
const ROLE_MEMBER_CAP = 32;
const MCMS_GROUPS = 32;
const MCMS_MAX_SIGNERS = 200;
const DELEGATION = /^0xef0100[0-9a-f]{40}$/;

const SELECTORS = {
  masterCopy: '0xa619486e',
  getThreshold: '0xe75235b8',
  getOwners: '0xa0e67e2b',
  getModulesPaginated: '0xcc2f8452',
  getConfig: '0xc3f909d4',
  getOpCount: '0x627e8a3b',
  getMinDelay: '0xf27a0c92',
  getRoleMemberCount: '0xca15c873',
  getRoleMember: '0x9010d07c',
} as const;

/** keccak256 of each role's name, as RBACTimelock defines them. */
const ROLE_IDS = {
  proposer: 'b09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1',
  bypasser: 'a1b2b8005de234c4b8ce8cd0be058239056e0d54f6097825b5117101469d5a8d',
  admin: 'a49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775',
} as const satisfies Record<TimelockRole, string>;
const ROLES = Object.keys(ROLE_IDS) as TimelockRole[];

/** Every contract party gets the same probes in one batch; which ones decide its type follows the party diagram. */
const PROBES = {
  masterCopy: SELECTORS.masterCopy,
  getThreshold: SELECTORS.getThreshold,
  getOwners: SELECTORS.getOwners,
  getModules: encodeCall(SELECTORS.getModulesPaginated, addressWord(SAFE_SENTINEL), uintWord(1n)),
  getConfig: SELECTORS.getConfig,
  getOpCount: SELECTORS.getOpCount,
  getMinDelay: SELECTORS.getMinDelay,
  proposerCount: encodeCall(SELECTORS.getRoleMemberCount, ROLE_IDS.proposer),
  bypasserCount: encodeCall(SELECTORS.getRoleMemberCount, ROLE_IDS.bypasser),
  adminCount: encodeCall(SELECTORS.getRoleMemberCount, ROLE_IDS.admin),
} as const;
type Probe = keyof typeof PROBES;
const PROBE_NAMES = Object.keys(PROBES) as Probe[];

type Unidentified = Extract<PartyClassification, { kind: 'unidentified' }>;
type Identity =
  | Exclude<PartyClassification, { kind: 'timelock' | 'absent' | 'no-key' }>
  | { kind: 'timelock'; minDelay: string; counts: Record<TimelockRole, number> };
type Members = { address: string; roles: TimelockRole[] }[] | Unidentified;

const unidentified = (reason: string): Unidentified => ({ kind: 'unidentified', signers: null, reason });
/** A revert and a call that failed by itself are both no answer from the contract; a dead endpoint has already thrown. */
const answer = (result: CallResult | undefined): string | null => (result?.status === 'answered' ? result.data : null);

interface McmsConfig {
  signers: { address: string; index: number; group: number }[];
  quorums: number[];
  parents: number[];
}

/** The answer from `offset` bytes on, or null when the offset is not a word boundary inside it. */
function from(data: string, offset: bigint): string | null {
  if (offset % 32n !== 0n || offset * 2n > BigInt(data.length - 2)) return null;
  return `0x${data.slice(2 + Number(offset) * 2)}`;
}

const repeat = <T>(n: number, items: readonly T[]): T[] => Array.from({ length: n }, () => items).flat();

/** getConfig()'s Config{Signer[] signers; uint8[32] groupQuorums; uint8[32] groupParents}, Signer{address; uint8 index; uint8 group}. */
function decodeMcmsConfig(data: string | null): McmsConfig | null {
  if (data === null) return null;
  const tupleOffset = decodeValue(data, 'uint256');
  const tuple = tupleOffset === null ? null : from(data, tupleOffset);
  if (tuple === null) return null;
  const head = decodeTuple(tuple, ['uint256', ...repeat<StaticType>(2 * MCMS_GROUPS, ['uint8'])]);
  const list = head === null ? null : from(tuple, head[0] as bigint);
  const length = list === null ? null : decodeValue(list, 'uint256');
  if (head === null || list === null || length === null || length > BigInt(MCMS_MAX_SIGNERS)) return null;
  const words = decodeTuple(list, ['uint256', ...repeat<StaticType>(Number(length), ['address', 'uint8', 'uint8'])]);
  if (words === null) return null;
  const numbers = head.slice(1).map(Number);
  return {
    signers: Array.from({ length: Number(length) }, (_, i) => ({ address: words[1 + 3 * i] as string, index: Number(words[2 + 3 * i]), group: Number(words[3 + 3 * i]) })),
    quorums: numbers.slice(0, MCMS_GROUPS),
    parents: numbers.slice(MCMS_GROUPS),
  };
}

/**
 * The fewest distinct signers that satisfy the root group, under the rules ManyChainMultiSig.setConfig enforces: a group
 * passes when its quorum of children (signers, or enabled child groups) pass, and every signer sits in exactly one group.
 * Null when the configuration breaks those rules or the root cannot pass.
 */
function mcmsFewestSigners({ signers, quorums, parents }: McmsConfig): number | null {
  if (signers.length === 0 || quorums[0] === 0 || parents[0] !== 0) return null;
  if (parents.some((parent, group) => group > 0 && parent >= group)) return null;
  const childCosts: number[][] = Array.from({ length: MCMS_GROUPS }, () => []);
  let previous = 0n;
  for (const [i, signer] of signers.entries()) {
    if (signer.index !== i || signer.group >= MCMS_GROUPS || BigInt(signer.address) <= previous) return null;
    previous = BigInt(signer.address);
    childCosts[signer.group]!.push(1);
  }
  const costs: number[] = Array.from({ length: MCMS_GROUPS }, () => Infinity);
  for (let group = MCMS_GROUPS - 1; group >= 0; group--) {
    const quorum = quorums[group]!;
    const children = childCosts[group]!;
    if (quorum === 0) {
      if (children.length > 0) return null;
      continue;
    }
    const cheapest = [...children].sort((a, b) => a - b).slice(0, quorum);
    costs[group] = cheapest.length < quorum ? Infinity : cheapest.reduce((sum, cost) => sum + cost, 0);
    if (group > 0) childCosts[parents[group]!]!.push(costs[group]!);
  }
  return Number.isFinite(costs[0]) ? costs[0]! : null;
}

function identifySafe(singleton: string, release: SafeRelease, answers: Record<Probe, CallResult>): Identity {
  const threshold = decodeValue(answer(answers.getThreshold), 'uint256');
  const owners = decodeArray(answer(answers.getOwners), 'address');
  const modules = decodeArray(answer(answers.getModules), 'address');
  if (threshold === null || owners === null) return unidentified(`a Safe ${release} whose owners or threshold do not read within bounds`);
  if (threshold < 1n || threshold > BigInt(owners.length) || owners.includes(ZERO) || new Set(owners).size !== owners.length) {
    return unidentified(`a Safe ${release} whose threshold ${threshold} does not fit its ${owners.length} owners`);
  }
  if (modules === null) return unidentified(`a Safe ${release} whose modules do not read`);
  if (modules.length > 0) return unidentified(`a Safe ${release} with an enabled module ${modules[0]}, which can act without the owners`);
  return { kind: 'safe', signers: Number(threshold), safe: { singleton, release, threshold: Number(threshold), owners: owners.length } };
}

/** A type is named only when two probes agree: masterCopy and the owners, getConfig and getOpCount, getMinDelay and role listing. */
function identifyContract(chainId: number, answers: Record<Probe, CallResult>): Identity {
  const singleton = decodeValue(answer(answers.masterCopy), 'address');
  if (singleton !== null && (SAFE_SINGLETONS[chainId] ?? []).includes(singleton)) return identifySafe(singleton, SAFE_SINGLETON_RELEASES[singleton]!, answers);
  const config = decodeMcmsConfig(answer(answers.getConfig));
  const opCount = decodeValue(answer(answers.getOpCount), 'uint40');
  if (config !== null && opCount !== null) {
    const fewest = mcmsFewestSigners(config);
    if (fewest === null) return unidentified('an MCMS whose configuration fails the checks its own setConfig applies');
    return { kind: 'mcms', signers: fewest, mcms: { rootQuorum: config.quorums[0]!, signers: config.signers.length } };
  }
  const minDelay = decodeValue(answer(answers.getMinDelay), 'uint256');
  const counts = {
    proposer: decodeValue(answer(answers.proposerCount), 'uint256'),
    bypasser: decodeValue(answer(answers.bypasserCount), 'uint256'),
    admin: decodeValue(answer(answers.adminCount), 'uint256'),
  };
  if (minDelay !== null && ROLES.every((role) => counts[role] !== null)) {
    const over = ROLES.find((role) => counts[role]! > BigInt(ROLE_MEMBER_CAP));
    if (over) return unidentified(`a timelock whose ${over} role lists ${counts[over]} members, over the cap of ${ROLE_MEMBER_CAP}`);
    return { kind: 'timelock', minDelay: minDelay.toString(), counts: { proposer: Number(counts.proposer), bypasser: Number(counts.bypasser), admin: Number(counts.admin) } };
  }
  if (singleton !== null && decodeValue(answer(answers.getThreshold), 'uint256') !== null) {
    return unidentified(`it answers like a Safe, but its masterCopy ${singleton} is not a pinned Safe singleton on chain ${chainId}`);
  }
  if (minDelay !== null) return unidentified('it answers getMinDelay() but does not list its role members');
  if (config !== null) return unidentified('getConfig() answers like an MCMS but getOpCount() does not');
  return unidentified('its code matches no known type');
}

/** Code first, then one batch of probes for every contract. */
async function identifyAll(deps: HttpDeps, chain: PinnedChain, addresses: readonly string[], known: Map<string, Identity>): Promise<void> {
  const contracts: string[] = [];
  for (const address of addresses) {
    const result = await readCode(deps, chain, address);
    const code = answer(result);
    if (code === null) known.set(address, unidentified(`its code did not read${result.status === 'failed' ? `: ${result.reason}` : ''}`));
    else if (code === '0x') known.set(address, { kind: 'wallet', signers: 1 });
    else if (DELEGATION.test(code)) known.set(address, { kind: 'delegated-wallet', signers: 1, delegate: `0x${code.slice(8)}` });
    else contracts.push(address);
  }
  const calls: EvmCall[] = contracts.flatMap((to) => PROBE_NAMES.map((name) => ({ to, data: PROBES[name] })));
  const results = await readCalls(deps, chain, calls);
  contracts.forEach((address, c) => {
    const answers = Object.fromEntries(PROBE_NAMES.map((name, p) => [name, results[c * PROBE_NAMES.length + p]!])) as Record<Probe, CallResult>;
    known.set(address, identifyContract(chain.chainId, answers));
  });
}

/** Each timelock's members by role, merged by address in the order proposers, bypassers, admins. */
async function readMembers(deps: HttpDeps, chain: PinnedChain, timelocks: { address: string; counts: Record<TimelockRole, number> }[], members: Map<string, Members>): Promise<void> {
  const slots = timelocks.flatMap(({ address, counts }) => ROLES.flatMap((role) => Array.from({ length: counts[role] }, (_, i) => ({ timelock: address, role, i }))));
  const results = await readCalls(deps, chain, slots.map((s) => ({ to: s.timelock, data: encodeCall(SELECTORS.getRoleMember, ROLE_IDS[s.role], uintWord(BigInt(s.i))) })));
  for (const { address } of timelocks) members.set(address, []);
  slots.forEach((slot, n) => {
    const list = members.get(slot.timelock)!;
    if (!Array.isArray(list)) return;
    const member = decodeValue(answer(results[n]), 'address');
    if (member === null) {
      members.set(slot.timelock, unidentified(`a timelock whose ${slot.role} member ${slot.i} does not read`));
      return;
    }
    const entry = list.find((m) => m.address === member);
    if (entry === undefined) list.push({ address: member, roles: [slot.role] });
    else if (!entry.roles.includes(slot.role)) entry.roles.push(slot.role);
  });
}

function resolve(address: string, level: number, above: readonly string[], known: Map<string, Identity>, members: Map<string, Members>): PartyClassification {
  if (address === ZERO) return { kind: 'absent', signers: null };
  if (address === BURN) return { kind: 'no-key', signers: null };
  const identity = known.get(address);
  if (identity === undefined) throw new Error(`party ${address} was not read`);
  if (identity.kind !== 'timelock') return identity;
  if (level >= TIMELOCK_DEPTH) return unidentified(`a timelock ${level} levels deep, whose members would sit deeper than ${TIMELOCK_DEPTH}`);
  const list = members.get(address);
  if (list === undefined) throw new Error(`members of timelock ${address} were not read`);
  if (!Array.isArray(list)) return list;
  const path = [...above, address];
  // A member that is this timelock or one above it acts only through the others, so it adds no way to act.
  const resolved = list.filter((m) => !path.includes(m.address)).map((m) => ({ ...m, as: resolve(m.address, level + 1, path, known, members) }));
  const counted = resolved.filter((m) => m.as.signers !== null);
  const weakest = Math.min(...counted.map((m) => m.as.signers!));
  const unknown = resolved.find((m) => m.as.kind === 'unidentified');
  if (unknown !== undefined && weakest !== 1) {
    return unidentified(`a timelock whose ${unknown.roles.join(' and ')} ${unknown.address} is unidentified: ${(unknown.as as Unidentified).reason}`);
  }
  if (counted.length === 0) return unidentified('a timelock with no proposer, bypasser or admin that can act');
  return {
    kind: 'timelock',
    signers: weakest,
    timelock: {
      minDelay: identity.minDelay,
      members: resolved.map((m) => ({ address: m.address, roles: m.roles, kind: m.as.kind, signers: m.as.signers })),
      decidedBy: counted.filter((m) => m.as.signers === weakest).map((m) => m.address),
    },
  };
}

/**
 * Classifies the distinct party addresses of one chain at its pinned block, each read once, following the party diagram
 * (KTD7): zero is absent, 0x…dEaD has no key, no code is a wallet, a 7702 designator is a delegated wallet, then a pinned
 * Safe, an MCMS, an RBACTimelock (its proposers, bypassers and admins resolved to a depth of three), or unidentified.
 * Keys are lowercase. A ChainReadError from the endpoint propagates: the chain's reading fails rather than store a guess.
 */
export async function classifyParties(deps: HttpDeps, chain: PinnedChain, addresses: readonly string[]): Promise<Map<string, PartyClassification>> {
  const parties = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const known = new Map<string, Identity>();
  const members = new Map<string, Members>();
  let frontier = parties;
  for (let level = 1; level <= TIMELOCK_DEPTH && frontier.length > 0; level++) {
    const fresh = [...new Set(frontier)].filter((a) => a !== ZERO && a !== BURN && !known.has(a));
    await identifyAll(deps, chain, fresh, known);
    if (level === TIMELOCK_DEPTH) break;
    const timelocks = fresh.flatMap((address) => {
      const identity = known.get(address)!;
      return identity.kind === 'timelock' ? [{ address, counts: identity.counts }] : [];
    });
    await readMembers(deps, chain, timelocks, members);
    frontier = timelocks.flatMap(({ address }) => {
      const list = members.get(address)!;
      return Array.isArray(list) ? list.map((m) => m.address) : [];
    });
  }
  return new Map(parties.map((party) => [party, resolve(party, 1, [], known, members)]));
}
