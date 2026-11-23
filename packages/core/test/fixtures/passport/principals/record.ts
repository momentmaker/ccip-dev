/**
 * Records the chain answers the party classifier reads, for every party below and the timelock members behind them, at
 * one pinned block. Run from packages/core: `pnpm exec tsx test/fixtures/passport/principals/record.ts ethereum > test/fixtures/passport/principals/ethereum.json`.
 * The probes are encoded here from their signatures, apart from the classifier, so a fixture says what the chain answered.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const CHAINS = {
  ethereum: {
    chainId: 1,
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    parties: {
      '0x44835bbba9d40deda9b64858095ecfb2693c9449': 'RBACTimelock: owner of the LINK pool 0x1b7492c3bd23a4adb448710e4275ff14a5288932 and LINK registry administrator',
      '0x59a0f98345f54bab245a043488ece7fcecd7b596': 'Safe 1.3.0, 1 of 1: owner of the WLD pool 0x10c9a3c76bdbdb8600d726de621b941fd26f6058',
      '0x4240d629511a849d0a641600a32bdc5611d43b56': 'Safe 1.4.1, 1 of 1: owner of the DOBO pool 0x817404e98d28b8065c6e1c76e6bcd9088aefb31a',
      '0x62c212084ed4d2c1451c2e778f8ea9a15a47616b': 'Safe 1.3.0, 2 of 3: owner of the LEND pool 0x934635de453a1161d02ce395f2f59e775597fe13',
      '0xa75c21c5be284122a87a37a76cc6c4dd3e55a1d4': 'Safe 1.4.1, 2 of 3: owner of the DOLO pool 0xc69e7a187fa739028ee613426795d91b610932c7',
      '0xf433c2a2d6facecdd9edd7b8ce9ceaab96f41866': 'Safe 1.3.0 L2, 3 of 7 with a module: owner of the mBTC pool 0x476eefef46e0d65e1e371fe093696259b1240b93',
      '0xd48ea6df9d3cdb6e3a68fb12fa6c62f66e2d9a38': 'OpenZeppelin TimelockController: owner of the yzPrime pool 0x0f44e67be6d04288dc57aae4397fd18d2ac7218a',
      '0x5300a1a15135ea4dc7ad5a167152c01efc9b192a': 'unknown contract: owner of the GHO pool 0x06179f7c1be40863405f374e7f5f8806c728660a',
      '0xd4d23209aae8630bf386b7393763a5b7865e57cb': 'wallet: owner of the avUSD pool 0x81b72171642fab457aa815c0b8412a22b63a6af8',
      '0xe72f448995db2a003a1d0d28b10291ef07af814f': 'EIP-7702 delegated wallet: owner of the SAS pool 0x89f39cdbad48b6531ddbd38ea0d84e9c9cbcda27',
    },
  },
  zksync: {
    chainId: 324,
    rpcUrl: 'https://mainnet.era.zksync.io',
    parties: {
      '0xabb7f1aac7099a9643850a28522ebfc877f5cdc6': 'RBACTimelock: owner of the LINK pool 0xff170ad8f1d86efac90ca7a2e1204ba64ac5e0f9',
    },
  },
} as const;

const DEPTH = 3;
const ROLE_MEMBER_CAP = 32;
const CODE_KEPT_BYTES = 200;

const selector = (signature: string) => `0x${bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, 8)}`;
const roleId = (name: string) => bytesToHex(keccak_256(utf8ToBytes(name)));
const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0');
const ROLES = ['ADMIN_ROLE', 'PROPOSER_ROLE', 'BYPASSER_ROLE'].map(roleId);

const PROBES = [
  selector('masterCopy()'),
  selector('getThreshold()'),
  selector('getOwners()'),
  `${selector('getModulesPaginated(address,uint256)')}${word(1)}${word(1)}`,
  selector('getConfig()'),
  selector('getOpCount()'),
  selector('getMinDelay()'),
  ...ROLES.map((role) => `${selector('getRoleMemberCount(bytes32)')}${role}`),
];

const chainName = (globalThis as unknown as { process: { argv: string[] } }).process.argv[2] as keyof typeof CHAINS;
const chain = CHAINS[chainName];
if (!chain) throw new Error(`name a chain: ${Object.keys(CHAINS).join(', ')}`);

async function rpc(method: string, params: unknown[]): Promise<{ result?: string; error?: { message: string } }> {
  const res = await fetch(chain.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${method}`);
  return (await res.json()) as { result?: string; error?: { message: string } };
}

const latest = Number(BigInt((await rpc('eth_blockNumber', [])).result!));
const block = latest - 12;
const tag = `0x${block.toString(16)}`;
const header = (await rpc('eth_getBlockByNumber', [tag, false])) as unknown as { result: { hash: string; timestamp: string } };

const code: Record<string, string> = {};
const calls: Record<string, string> = {};

async function call(to: string, data: string): Promise<string | null> {
  const answer = await rpc('eth_call', [{ to, data }, tag]);
  if (answer.result !== undefined) {
    calls[`${to}:${data}`] = answer.result.toLowerCase();
    return answer.result.toLowerCase();
  }
  if (!/revert/i.test(answer.error?.message ?? '')) throw new Error(`${to} ${data}: ${answer.error?.message}`);
  calls[`${to}:${data}`] = 'revert';
  return null;
}

const asNumber = (answer: string | null) => (answer !== null && answer.length === 66 ? Number(BigInt(answer)) : null);

async function membersOf(address: string): Promise<string[]> {
  const counts = await Promise.all(ROLES.map((role) => call(address, `${selector('getRoleMemberCount(bytes32)')}${role}`)));
  const members: string[] = [];
  for (const [r, role] of ROLES.entries()) {
    const count = asNumber(counts[r]!);
    if (count === null || count > ROLE_MEMBER_CAP) return [];
    for (let i = 0; i < count; i++) {
      const member = await call(address, `${selector('getRoleMember(bytes32,uint256)')}${role}${word(i)}`);
      if (member !== null) members.push(`0x${member.slice(-40)}`);
    }
  }
  return members;
}

const seen = new Set<string>();
let frontier: string[] = Object.keys(chain.parties);
for (let level = 1; level <= DEPTH && frontier.length > 0; level++) {
  const next: string[] = [];
  for (const address of frontier) {
    if (seen.has(address) || /^0x0{40}$/.test(address) || address === '0x000000000000000000000000000000000000dead') continue;
    seen.add(address);
    const answer = (await rpc('eth_getCode', [address, tag])).result!.toLowerCase();
    code[address] = answer.length > 2 + CODE_KEPT_BYTES * 2 ? answer.slice(0, 2 + CODE_KEPT_BYTES * 2) : answer;
    if (answer === '0x' || answer.startsWith('0xef0100')) continue;
    for (const data of PROBES) await call(address, data);
    const delay = calls[`${address}:${selector('getMinDelay()')}`];
    if (level < DEPTH && delay !== undefined && delay !== 'revert') next.push(...(await membersOf(address)));
  }
  frontier = next;
}

console.log(
  JSON.stringify(
    {
      recorded: `answers from ${chain.rpcUrl} on ${new Date().toISOString().slice(0, 10)}, every read at block ${block} (${tag}); contract code longer than ${CODE_KEPT_BYTES} bytes is cut to its first ${CODE_KEPT_BYTES}`,
      chainId: chain.chainId,
      block,
      blockHash: header.result.hash,
      timestamp: Number(BigInt(header.result.timestamp)),
      parties: chain.parties,
      code,
      calls,
    },
    null,
    2,
  ),
);
