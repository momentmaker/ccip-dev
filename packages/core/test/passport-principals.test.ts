import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { openChain, type PinnedChain } from '../src/evm-read';
import type { HttpDeps } from '../src/http';
import { classifyParties, METHOD_VERSION, SAFE_SINGLETONS, type PartyClassification } from '../src/passport-principals';
import { evmCallKey, fakeEvmChain, fakeFetch, type FakeEvmChain, type FakeEvmChainOptions, type RecordedCall } from '../src/testing';
import ethereum from './fixtures/passport/principals/ethereum.json';
import zksync from './fixtures/passport/principals/zksync.json';

const RPC = 'https://rpc.example';
const selector = (signature: string) => `0x${bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, 8)}`;
const role = (name: string) => bytesToHex(keccak_256(utf8ToBytes(name)));
const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0');
const addressWord = (address: string) => address.slice(2).toLowerCase().padStart(64, '0');
const answer = (...words: string[]): `0x${string}` => `0x${words.join('')}`;
const addresses = (list: readonly string[]) => [word(0x20), word(list.length), ...list.map(addressWord)];

const ROLES = { admin: role('ADMIN_ROLE'), proposer: role('PROPOSER_ROLE'), bypasser: role('BYPASSER_ROLE') } as const;
const PROBE = {
  masterCopy: selector('masterCopy()'),
  getThreshold: selector('getThreshold()'),
  getOwners: selector('getOwners()'),
  getModules: `${selector('getModulesPaginated(address,uint256)')}${word(1)}${word(1)}`,
  getConfig: selector('getConfig()'),
  getOpCount: selector('getOpCount()'),
  getMinDelay: selector('getMinDelay()'),
  adminCount: `${selector('getRoleMemberCount(bytes32)')}${ROLES.admin}`,
  proposerCount: `${selector('getRoleMemberCount(bytes32)')}${ROLES.proposer}`,
  bypasserCount: `${selector('getRoleMemberCount(bytes32)')}${ROLES.bypasser}`,
} as const;
const roleMember = (name: keyof typeof ROLES, i: number) => `${selector('getRoleMember(bytes32,uint256)')}${ROLES[name]}${word(i)}`;

const SAFE_130 = '0xd9db270c1b5e3bd161e8c8503c55ceabee709552';
const SAFE_141 = '0x41675c099f32341bf84bfc5382af534df5c7461a';
const SAFE_130_L2 = '0x3e5c63644e683549055b9be8653de26e0b4cd36e';

const LIVE = {
  linkTimelock: '0x44835bbba9d40deda9b64858095ecfb2693c9449',
  linkProposerMcms: '0xe53289f32c8e690b7173aa33affe9b6b0cb0012f',
  linkBypasserMcms: '0x117ec8ad107976e1dbcc21717ff78407bc36aadc',
  linkProposerSafe: '0xd6597750bf74dcaec57e0f9ad2ec998d837005bf',
  safe130OneOfOne: '0x59a0f98345f54bab245a043488ece7fcecd7b596',
  safe141OneOfOne: '0x4240d629511a849d0a641600a32bdc5611d43b56',
  safe130TwoOfThree: '0x62c212084ed4d2c1451c2e778f8ea9a15a47616b',
  safe141TwoOfThree: '0xa75c21c5be284122a87a37a76cc6c4dd3e55a1d4',
  safeWithModule: '0xf433c2a2d6facecdd9edd7b8ce9ceaab96f41866',
  ozTimelock: '0xd48ea6df9d3cdb6e3a68fb12fa6c62f66e2d9a38',
  unknownContract: '0x5300a1a15135ea4dc7ad5a167152c01efc9b192a',
  wallet: '0xd4d23209aae8630bf386b7393763a5b7865e57cb',
  delegatedWallet: '0xe72f448995db2a003a1d0d28b10291ef07af814f',
} as const;
const ZKSYNC = {
  linkTimelock: '0xabb7f1aac7099a9643850a28522ebfc877f5cdc6',
  proposers: ['0x846687300606559d46d95152f677701e63fbca60', '0x0a8aef9a058930e6e4e68f5f892cea8da0941eb0'],
  bypassers: ['0x7b05365d4ca5e9af38fd27808c92594090b827e5', '0x87fd1317a7d44ea623e9166092d6905e7c1a0a9b'],
} as const;

interface Recording {
  chainId: number;
  block: number;
  timestamp: number;
  code: Record<string, string>;
  calls: Record<string, string>;
}

const recordedCalls = (recording: Recording) => recording.calls as Record<string, RecordedCall>;

function fakeFrom(recording: Recording, over: Partial<FakeEvmChainOptions> = {}): FakeEvmChain {
  return fakeEvmChain({ chainId: recording.chainId, latest: recording.block + 12, timestamp: recording.timestamp, calls: recordedCalls(recording), code: recording.code, ...over });
}

const depsFor = (fake: FakeEvmChain, recording: Recording): HttpDeps => ({ fetch: fakeFetch(fake), sleep: async () => {}, clock: () => (recording.timestamp + 60) * 1000 });

async function classify(recording: Recording, parties: readonly string[], over: Partial<FakeEvmChainOptions> = {}): Promise<Map<string, PartyClassification>> {
  const fake = fakeFrom(recording, over);
  const deps = depsFor(fake, recording);
  return classifyParties(deps, await openChain(deps, RPC, { chainId: recording.chainId }), parties);
}

async function classifyOne(recording: Recording, party: string, over: Partial<FakeEvmChainOptions> = {}): Promise<PartyClassification> {
  return (await classify(recording, [party], over)).get(party.toLowerCase())!;
}

/** A hand-built contract on the Ethereum recording: the given probes answer, every other probe reverts. */
function contract(address: string, answers: Partial<Record<keyof typeof PROBE, RecordedCall>>, extra: Record<string, RecordedCall> = {}): Record<string, RecordedCall> {
  const calls: Record<string, RecordedCall> = {};
  for (const [name, data] of Object.entries(PROBE)) calls[evmCallKey(address, data)] = answers[name as keyof typeof PROBE] ?? 'revert';
  for (const [data, value] of Object.entries(extra)) calls[evmCallKey(address, data)] = value;
  return calls;
}

function rbacTimelock(address: string, delay: number, members: { admin?: string[]; proposer?: string[]; bypasser?: string[] }): Record<string, RecordedCall> {
  const extra: Record<string, RecordedCall> = {};
  for (const name of ['admin', 'proposer', 'bypasser'] as const) (members[name] ?? []).forEach((m, i) => (extra[roleMember(name, i)] = answer(addressWord(m))));
  return contract(
    address,
    {
      getMinDelay: answer(word(delay)),
      adminCount: answer(word(members.admin?.length ?? 0)),
      proposerCount: answer(word(members.proposer?.length ?? 0)),
      bypasserCount: answer(word(members.bypasser?.length ?? 0)),
    },
    extra,
  );
}

/** getConfig()'s Config{Signer[] signers; uint8[32] groupQuorums; uint8[32] groupParents}, signers sorted by address. */
function mcmsConfig(signers: { address: string; group: number }[], quorums: number[], parents: number[]): `0x${string}` {
  const padded = (values: number[]) => Array.from({ length: 32 }, (_, i) => word(values[i] ?? 0));
  const body = signers.flatMap((s, i) => [addressWord(s.address), word(i), word(s.group)]);
  return answer(word(0x20), word(65 * 32), ...padded(quorums), ...padded(parents), word(signers.length), ...body);
}

const signerAddresses = (n: number, from = 0xb0) => Array.from({ length: n }, (_, i) => `0x${(from + i).toString(16).padStart(40, '0')}`);
const handCode = (...list: string[]) => Object.fromEntries(list.map((a) => [a, '0x6080604052']));
const withEthereum = (calls: Record<string, RecordedCall>, code: Record<string, string>): Partial<FakeEvmChainOptions> => ({
  calls: { ...recordedCalls(ethereum), ...calls },
  code: { ...ethereum.code, ...code },
});

const HAND = {
  safeOneOfThree: '0x00000000000000000000000000000000000000a1',
  bigSafe: '0x00000000000000000000000000000000000000a2',
  mcmsTwoOfThree: '0x00000000000000000000000000000000000000a3',
  mcmsOneSignerGroup: '0x00000000000000000000000000000000000000a4',
  mcmsWithoutOpCount: '0x00000000000000000000000000000000000000a5',
  outerTimelock: '0x00000000000000000000000000000000000000a6',
  middleTimelock: '0x00000000000000000000000000000000000000a7',
  innerTimelock: '0x00000000000000000000000000000000000000a8',
  shallowTimelock: '0x00000000000000000000000000000000000000a9',
  hiddenWallet: '0x00000000000000000000000000000000000000aa',
  bypassWallet: '0x00000000000000000000000000000000000000ab',
} as const;

const recordedLendSafe = (data: string) => recordedCalls(ethereum)[evmCallKey(LIVE.safe130TwoOfThree, data)]!;
const ownersOfLendSafe = recordedLendSafe(PROBE.getOwners);
const [mcmsSigners2of3, mcmsSigners1group] = [signerAddresses(3, 0xc0), signerAddresses(5, 0xd0)];

/** Each hand-built case: its party, and the Ethereum recording with the case's contracts added. */
const HAND_CASES: Record<string, { party: string; over: Partial<FakeEvmChainOptions> }> = {
  'safe-1-of-3': {
    party: HAND.safeOneOfThree,
    over: withEthereum(
      contract(HAND.safeOneOfThree, { masterCopy: answer(addressWord(SAFE_130)), getThreshold: answer(word(1)), getOwners: ownersOfLendSafe, getModules: recordedLendSafe(PROBE.getModules), getConfig: '0x' }),
      handCode(HAND.safeOneOfThree),
    ),
  },
  'safe-owners-over-cap': {
    party: HAND.bigSafe,
    over: withEthereum(
      contract(HAND.bigSafe, { masterCopy: answer(addressWord(SAFE_141)), getThreshold: answer(word(2)), getOwners: answer(...addresses(signerAddresses(1001, 0x1000))), getModules: recordedLendSafe(PROBE.getModules) }),
      handCode(HAND.bigSafe),
    ),
  },
  'mcms-2-of-3': {
    party: HAND.mcmsTwoOfThree,
    over: withEthereum(
      contract(HAND.mcmsTwoOfThree, { getConfig: mcmsConfig(mcmsSigners2of3.map((address) => ({ address, group: 0 })), [2], [0]), getOpCount: answer(word(7)) }),
      handCode(HAND.mcmsTwoOfThree),
    ),
  },
  'mcms-root-met-by-one-signer-group': {
    party: HAND.mcmsOneSignerGroup,
    over: withEthereum(
      contract(HAND.mcmsOneSignerGroup, {
        // Root (group 0) needs 1 of groups 1 and 2; group 1 needs 1 of 2 signers, group 2 needs 3 of 3.
        getConfig: mcmsConfig(
          mcmsSigners1group.map((address, i) => ({ address, group: i < 2 ? 1 : 2 })),
          [1, 1, 3],
          [0, 0, 0],
        ),
        getOpCount: answer(word(0)),
      }),
      handCode(HAND.mcmsOneSignerGroup),
    ),
  },
  'mcms-config-without-op-count': {
    party: HAND.mcmsWithoutOpCount,
    over: withEthereum(
      contract(HAND.mcmsWithoutOpCount, { getConfig: mcmsConfig(mcmsSigners2of3.map((address) => ({ address, group: 0 })), [2], [0]) }),
      handCode(HAND.mcmsWithoutOpCount),
    ),
  },
  'timelocks-nested-four-deep': {
    party: HAND.outerTimelock,
    over: withEthereum(
      {
        ...rbacTimelock(HAND.outerTimelock, 3600, { proposer: [HAND.middleTimelock] }),
        ...rbacTimelock(HAND.middleTimelock, 3600, { proposer: [HAND.innerTimelock] }),
        ...rbacTimelock(HAND.innerTimelock, 3600, { bypasser: [HAND.hiddenWallet] }),
      },
      handCode(HAND.outerTimelock, HAND.middleTimelock, HAND.innerTimelock),
    ),
  },
  'timelocks-nested-three-deep': {
    party: HAND.shallowTimelock,
    over: withEthereum(
      {
        ...rbacTimelock(HAND.shallowTimelock, 7200, { proposer: [HAND.innerTimelock], admin: [HAND.shallowTimelock] }),
        ...rbacTimelock(HAND.innerTimelock, 3600, { bypasser: [HAND.hiddenWallet] }),
      },
      handCode(HAND.shallowTimelock, HAND.innerTimelock),
    ),
  },
};

const zksyncWithWalletBypasser: Partial<FakeEvmChainOptions> = {
  calls: { ...recordedCalls(zksync), [evmCallKey(ZKSYNC.linkTimelock, roleMember('bypasser', 0))]: answer(addressWord(HAND.bypassWallet)) },
};

describe('classifyParties: wallets and burn addresses', () => {
  it('reads an address with no code as a wallet with one signer', async () => {
    expect(await classifyOne(ethereum, LIVE.wallet)).toEqual({ kind: 'wallet', signers: 1 });
  });

  it('reads 23 bytes of code starting 0xef0100 as a delegated wallet with one signer, naming the delegate', async () => {
    expect(await classifyOne(ethereum, LIVE.delegatedWallet)).toEqual({ kind: 'delegated-wallet', signers: 1, delegate: '0xda98669de7f4c4d5c2e41baf12574a67ecc25619' });
  });

  it('reads the zero address as absent and 0x…dEaD as no key, without reading the chain', async () => {
    const fake = fakeFrom(ethereum);
    const deps = depsFor(fake, ethereum);
    const pinned = await openChain(deps, RPC, { chainId: 1 });
    const before = fake.requests.length;
    const out = await classifyParties(deps, pinned, ['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dEaD']);
    expect(out.get('0x0000000000000000000000000000000000000000')).toEqual({ kind: 'absent', signers: null });
    expect(out.get('0x000000000000000000000000000000000000dead')).toEqual({ kind: 'no-key', signers: null });
    expect(fake.requests.length).toBe(before);
  });
});

describe('classifyParties: Safes', () => {
  it('counts a pinned Safe 1.3.0 that needs 2 of 3 owners as two signers', async () => {
    expect(await classifyOne(ethereum, LIVE.safe130TwoOfThree)).toEqual({ kind: 'safe', signers: 2, safe: { singleton: SAFE_130, release: '1.3.0', threshold: 2, owners: 3 } });
  });

  it('counts a pinned Safe 1.4.1 that needs 2 of 3 owners as two signers', async () => {
    expect(await classifyOne(ethereum, LIVE.safe141TwoOfThree)).toEqual({ kind: 'safe', signers: 2, safe: { singleton: SAFE_141, release: '1.4.1', threshold: 2, owners: 3 } });
  });

  it('counts 1-of-1 Safes on 1.3.0 and 1.4.1 as one signer', async () => {
    expect(await classifyOne(ethereum, LIVE.safe130OneOfOne)).toMatchObject({ kind: 'safe', signers: 1, safe: { release: '1.3.0', threshold: 1, owners: 1 } });
    expect(await classifyOne(ethereum, LIVE.safe141OneOfOne)).toMatchObject({ kind: 'safe', signers: 1, safe: { release: '1.4.1', threshold: 1, owners: 1 } });
  });

  it('counts a Safe that needs 1 of 3 owners as one signer', async () => {
    const { party, over } = HAND_CASES['safe-1-of-3']!;
    expect(await classifyOne(ethereum, party, over)).toEqual({ kind: 'safe', signers: 1, safe: { singleton: SAFE_130, release: '1.3.0', threshold: 1, owners: 3 } });
  });

  it('leaves a Safe with an enabled module unidentified', async () => {
    expect(await classifyOne(ethereum, LIVE.safeWithModule)).toMatchObject({ kind: 'unidentified', signers: null, reason: expect.stringContaining('0xed5bd8416d59b05dd643f334dc9c858abe67b973') });
  });

  it('leaves a contract that answers getOwners and getThreshold unidentified when its masterCopy is not pinned', async () => {
    const unpinned = '0x00000000000000000000000000000000000051fe';
    const over = withEthereum({ [evmCallKey(LIVE.linkProposerSafe, PROBE.masterCopy)]: answer(addressWord(unpinned)) }, {});
    expect(await classifyOne(ethereum, LIVE.linkProposerSafe, over)).toMatchObject({ kind: 'unidentified', signers: null, reason: expect.stringContaining(unpinned) });
  });

  it('counts the threshold of the LINK proposer Safe, whose self-built 1.3.0 singleton is pinned for Ethereum', async () => {
    expect(await classifyOne(ethereum, LIVE.linkProposerSafe)).toEqual({
      kind: 'safe',
      signers: 6,
      safe: { singleton: '0x2ed1a552c03f843a2db7de10ad390d24bb66cee0', release: '1.3.0', threshold: 6, owners: 12 },
    });
  });

  it('leaves a Safe whose getOwners answer is longer than the cap unidentified', async () => {
    const { party, over } = HAND_CASES['safe-owners-over-cap']!;
    expect(await classifyOne(ethereum, party, over)).toMatchObject({ kind: 'unidentified', signers: null });
  });

  it('does not take a masterCopy pinned for another chain', async () => {
    const singleton = SAFE_SINGLETONS[324]!.find((s) => !SAFE_SINGLETONS[1]!.includes(s))!;
    const party = HAND.safeOneOfThree;
    const over = withEthereum(
      contract(party, { masterCopy: answer(addressWord(singleton)), getThreshold: answer(word(2)), getOwners: ownersOfLendSafe, getModules: recordedLendSafe(PROBE.getModules) }),
      handCode(party),
    );
    expect(await classifyOne(ethereum, party, over)).toMatchObject({ kind: 'unidentified', signers: null });
  });
});

describe('SAFE_SINGLETONS', () => {
  it('pins the canonical 1.3.0, 1.3.0 L2 and 1.4.1 singletons on Ethereum, and the zkSync builds on ZKsync', () => {
    expect(SAFE_SINGLETONS[1]).toEqual(expect.arrayContaining([SAFE_130, SAFE_130_L2, SAFE_141, '0x29fcb43b46531bca003ddc8fcb67ffe91900c762', '0xff51a5898e281db6dfc7855790607438df2ca44b', '0xedd160febbd92e350d4d398fb636302fccd67c7e']));
    expect(SAFE_SINGLETONS[324]).toEqual(expect.arrayContaining(['0xb00ce5cccdef57e539ddced01df43a13855d9910', '0x1727c2c531cf966f902e5927b98490fdfb3b2b70', '0xc35f063962328ac65ced5d4c3fc5def8dec68dfa', '0x610fca2e0279fa1f8c00c8c2f71df522ad469380']));
  });
});

describe('classifyParties: MCMS', () => {
  it('counts the fewest signers that satisfy the root of a live MCMS: 2 of 3 groups that each need 2', async () => {
    expect(await classifyOne(ethereum, LIVE.linkProposerMcms)).toEqual({ kind: 'mcms', signers: 4, mcms: { rootQuorum: 2, signers: 42 } });
  });

  it('counts a nested live MCMS tree: groups costing 1, 3 and 4 under a root needing all three', async () => {
    expect(await classifyOne(ethereum, LIVE.linkBypasserMcms)).toEqual({ kind: 'mcms', signers: 8, mcms: { rootQuorum: 3, signers: 68 } });
  });

  it('counts an MCMS whose root needs 2 of 3 signers as two', async () => {
    const { party, over } = HAND_CASES['mcms-2-of-3']!;
    expect(await classifyOne(ethereum, party, over)).toEqual({ kind: 'mcms', signers: 2, mcms: { rootQuorum: 2, signers: 3 } });
  });

  it('counts an MCMS whose root is met by a group needing one signer as one', async () => {
    const { party, over } = HAND_CASES['mcms-root-met-by-one-signer-group']!;
    expect(await classifyOne(ethereum, party, over)).toEqual({ kind: 'mcms', signers: 1, mcms: { rootQuorum: 1, signers: 5 } });
  });

  it('does not name an MCMS from getConfig alone when getOpCount does not answer', async () => {
    const { party, over } = HAND_CASES['mcms-config-without-op-count']!;
    expect(await classifyOne(ethereum, party, over)).toMatchObject({ kind: 'unidentified', signers: null });
  });
});

describe('classifyParties: timelocks', () => {
  it('takes the weakest of the proposers, bypassers and admins of the live zkSync LINK timelock, with its delay', async () => {
    expect(await classifyOne(zksync, ZKSYNC.linkTimelock)).toEqual({
      kind: 'timelock',
      signers: 4,
      timelock: {
        minDelay: '10800',
        members: [
          { address: ZKSYNC.proposers[0], roles: ['proposer'], kind: 'mcms', signers: 4 },
          { address: ZKSYNC.proposers[1], roles: ['proposer'], kind: 'mcms', signers: 4 },
          { address: ZKSYNC.bypassers[0], roles: ['bypasser'], kind: 'mcms', signers: 8 },
          { address: ZKSYNC.bypassers[1], roles: ['bypasser'], kind: 'mcms', signers: 8 },
        ],
        decidedBy: [...ZKSYNC.proposers],
      },
    });
  });

  it('counts a timelock with a wallet among its bypassers as one signer', async () => {
    expect(await classifyOne(zksync, ZKSYNC.linkTimelock, zksyncWithWalletBypasser)).toMatchObject({
      kind: 'timelock',
      signers: 1,
      timelock: { minDelay: '10800', decidedBy: [HAND.bypassWallet] },
    });
  });

  it('takes the weakest member of the live Ethereum LINK timelock, its proposer Safe included', async () => {
    expect(await classifyOne(ethereum, LIVE.linkTimelock)).toMatchObject({ kind: 'timelock', signers: 4, timelock: { minDelay: '10800' } });
  });

  it('leaves a contract that answers getMinDelay but does not list role members unidentified', async () => {
    expect(await classifyOne(ethereum, LIVE.ozTimelock)).toMatchObject({ kind: 'unidentified', signers: null });
  });

  it('stops a chain of four nested contracts at depth three as unidentified', async () => {
    const { party, over } = HAND_CASES['timelocks-nested-four-deep']!;
    expect(await classifyOne(ethereum, party, over)).toMatchObject({ kind: 'unidentified', signers: null });
  });

  it('resolves the same wallet three deep, through a timelock that is its own admin', async () => {
    const { party, over } = HAND_CASES['timelocks-nested-three-deep']!;
    expect(await classifyOne(ethereum, party, over)).toMatchObject({ kind: 'timelock', signers: 1, timelock: { minDelay: '7200', decidedBy: [HAND.innerTimelock] } });
  });
});

describe('classifyParties: reading', () => {
  it('leaves a contract of no known type unidentified', async () => {
    expect(await classifyOne(ethereum, LIVE.unknownContract)).toMatchObject({ kind: 'unidentified', signers: null });
  });

  it('reads each distinct address once, whether it is given twice or also reached as a timelock member', async () => {
    const fake = fakeFrom(zksync);
    const deps = depsFor(fake, zksync);
    const out = await classifyParties(deps, await openChain(deps, RPC, { chainId: 324 }), [ZKSYNC.linkTimelock, ZKSYNC.linkTimelock.toUpperCase().replace('0X', '0x'), ZKSYNC.proposers[0]]);
    expect([...out.keys()].sort()).toEqual([ZKSYNC.linkTimelock, ZKSYNC.proposers[0]].sort());
    const codeReads = fake.requests.filter((r) => r.method === 'eth_getCode').map((r) => String(r.params[0]).toLowerCase());
    expect(codeReads.filter((a) => a === ZKSYNC.proposers[0])).toHaveLength(1);
    expect(codeReads.filter((a) => a === ZKSYNC.linkTimelock)).toHaveLength(1);
  });

  it('throws when the endpoint times out during classification instead of returning unidentified', async () => {
    const fake = fakeFrom(ethereum, { hiccups: { eth_getCode: ['timeout', 'timeout', 'timeout'] } });
    const pinned: PinnedChain = { rpcUrl: RPC, chainId: 1, block: ethereum.block, blockHash: ethereum.blockHash, timestamp: ethereum.timestamp, multicall3: true };
    await expect(classifyParties(depsFor(fake, ethereum), pinned, [LIVE.wallet])).rejects.toMatchObject({ name: 'ChainReadError', kind: 'endpoint' });
  });
});

describe('golden results', () => {
  it('match every fixture under the current method version', async () => {
    const results: Record<string, PartyClassification> = {};
    for (const [name, recording] of [['ethereum', ethereum], ['zksync', zksync]] as const) {
      const parties = Object.keys(recording.code);
      for (const [address, classification] of await classify(recording, parties)) results[`${name}/${address}`] = classification;
    }
    for (const [name, { party, over }] of Object.entries(HAND_CASES)) results[`hand/${name}`] = await classifyOne(ethereum, party, over);
    const golden = `${JSON.stringify({ methodVersion: METHOD_VERSION, results }, null, 2)}\n`;
    await expect(golden).toMatchFileSnapshot('./fixtures/passport/principals/golden.json');
  });
});
