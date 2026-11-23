import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChainsFileSchema } from '@ccip-dev/core/public';
import {
  PASSPORT_SHARDS, PassportShardFileSchema, type PassportChainRow, type PassportLane, type PassportToken,
} from '@ccip-dev/core/public-passport';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHAINS_URL = 'https://data.ccip.dev/v1/chains.json';
const USAGE = 'usage: pnpm passport:sample <directory holding the dry run\'s passport/<0-f>.json> [--seed <n>] [--chains <file or URL>] [--endpoints <file>]';

export interface SampleOptions {
  /** The directory the dry run's files were downloaded to; it holds passport/<0-f>.json. */
  dir: string;
  seed: number;
  /** chains.json, as a local file or an https URL. */
  chains: string;
  /** A file with an `explorer` map of chain name to Blockscout base URL, as config/endpoints.json. */
  endpoints: string;
}

type SingleKey = NonNullable<PassportChainRow['single_key']>;
type Pointer = PassportLane['pointers'][number];

interface Names {
  chain: (selector: string) => string;
  link: (selector: string, address: string | null) => string;
}

/**
 * Reads the dry run's sixteen shards and draws, with the seed, a sample that holds a token for every pool version, party
 * kind, result value per check and reason code present, then lists every pool-pointer pair flagged from one side only.
 */
export async function passportSample(options: SampleOptions): Promise<string> {
  const { day, tokens } = await readShards(options.dir);
  const names = await chainNames(options);
  const sample = drawSample(tokens, options.seed);
  return [
    `# Passport hand check: dry run of ${day}, seed ${options.seed}`,
    '',
    `${sample.length} of ${tokens.length} tokens, covering every pool version, party kind, result and reason code in the dry run.`,
    'Check each against the chain (docs/runbook.md, "Token Passport", "Hand check") and tick it; write down any wrong reading.',
    '',
    ...oneSidedPairs(tokens, names),
    ...sample.flatMap((s, i) => tokenSection(i + 1, s.token, s.covers, names)),
  ].join('\n');
}

async function readShards(dir: string): Promise<{ day: string; tokens: PassportToken[] }> {
  const shards = await Promise.all(PASSPORT_SHARDS.map(async (h) => {
    const file = path.join(dir, 'passport', `${h}.json`);
    const text = await readFile(file, 'utf8').catch((err: unknown) => {
      throw new Error(`cannot read ${file}; download all sixteen shards first (docs/runbook.md, "Token Passport"): ${String(err)}`);
    });
    const parsed = PassportShardFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${file} is not a Passport shard: ${parsed.error.message}`);
    return parsed.data;
  }));
  return { day: shards[0]!.day, tokens: shards.flatMap((s) => s.tokens).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
}

async function chainNames(options: SampleOptions): Promise<Names> {
  const text = /^https?:\/\//.test(options.chains) ? await (await fetch(options.chains)).text() : await readFile(options.chains, 'utf8');
  const byselector = new Map(ChainsFileSchema.parse(JSON.parse(text)).chains.map((c) => [c.selector, c.name]));
  const explorers = (JSON.parse(await readFile(options.endpoints, 'utf8')) as { explorer: Record<string, string> }).explorer;
  const chain = (selector: string) => byselector.get(selector) ?? selector;
  const link = (selector: string, address: string | null) => {
    if (address === null) return 'none';
    const base = explorers[chain(selector)]?.replace(/\/$/, '');
    return base === undefined ? `\`${address}\`` : `[${address}](${base}/address/${address})`;
  };
  return { chain, link };
}

/** The pool version's major and minor, as the reader takes it from typeAndVersion(): `1.6.x-dev` is 1.6. */
function poolVersion(poolType: string | null): string | null {
  if (poolType === null) return null;
  const numbers = /^(\d+)\.(\d+)/.exec(poolType.slice(poolType.lastIndexOf(' ') + 1));
  return numbers ? `${numbers[1]}.${numbers[2]}` : 'no version';
}

const results = (row: PassportChainRow) => [
  ...(row.single_key === null ? [] : [{ check: 'single-key', value: row.single_key.value, reason: row.single_key.reason }]),
  ...row.lanes.flatMap((l) => [
    ...(l.rate_limit === null ? [] : [{ check: 'rate-limit', value: l.rate_limit.value, reason: l.rate_limit.reason }]),
    ...l.pointers.map((p) => ({ check: 'pool-pointer', value: p.value, reason: p.reason })),
  ]),
];

/** What a token shows, as labels in the order the sample covers them: pool versions, party kinds, results, reason codes. */
function featuresOf(token: PassportToken): string[] {
  const features = new Set<string>();
  for (const row of token.rows) {
    const version = poolVersion(row.single_key?.pool_type ?? null);
    if (version !== null) features.add(`1 pool version ${version}`);
    for (const party of row.single_key?.parties ?? []) features.add(`2 party kind ${party.kind}`);
    for (const r of results(row)) {
      features.add(`3 ${r.check} ${r.value}`);
      features.add(`4 reason ${r.reason}`);
    }
  }
  return [...features];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tokens in seeded order; for each feature no token taken so far shows, the first token in that order that shows it. */
function drawSample(tokens: readonly PassportToken[], seed: number): { token: PassportToken; covers: string[] }[] {
  const random = mulberry32(seed);
  const order = [...tokens];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const features = new Map(order.map((t) => [t, featuresOf(t)]));
  const taken = new Set<PassportToken>();
  for (const feature of [...new Set([...features.values()].flat())].sort()) {
    if ([...taken].some((t) => features.get(t)!.includes(feature))) continue;
    taken.add(order.find((t) => features.get(t)!.includes(feature))!);
  }
  return order.filter((t) => taken.has(t)).map((token) => ({ token, covers: features.get(token)!.sort().map((f) => f.slice(2)) }));
}

const BROKEN = new Set(['wrong-token', 'pool-not-listed']);

/** A flagged pair where at least one side points at the other, has no lane to it or could not be read. */
const flaggedFromOneSide = (p: Pointer) => p.value === 'flagged' && !p.sides.every((s) => BROKEN.has(s.state));

function oneSidedPairs(tokens: readonly PassportToken[], names: Names): string[] {
  const seen = new Set<string>();
  const lines = tokens.flatMap((t) => t.rows.flatMap((r) => r.lanes.flatMap((l) => l.pointers.flatMap((p) => {
    if (!flaggedFromOneSide(p) || seen.has(p.key)) return [];
    seen.add(p.key);
    const sides = p.sides.map((s) => `${names.chain(s.from.chain)} ${names.link(s.from.chain, s.from.address)} to ${names.chain(s.to)}: ${s.state}`);
    return [`- [ ] ${t.name} \`${t.id}\`: ${sides.join('; ')}`];
  }))));
  return [
    '## Pairs flagged from one side only',
    '',
    'Confirm each row belongs to its group: the token on both chains is the same token, bridged by the same project.',
    '',
    ...(lines.length === 0 ? ['None.'] : lines),
    '',
  ];
}

function party(p: SingleKey['parties'][number], selector: string, names: Names): string {
  const signers = p.signers === null ? '' : p.keys === null ? `, ${p.signers} signer${p.signers === 1 ? '' : 's'}` : `, ${p.signers} of ${p.keys} signers`;
  return `  - ${p.role}: ${p.kind}${signers}, ${names.link(selector, p.address)}`;
}

function singleKeyLines(row: PassportChainRow, names: Names): string[] {
  const sk = row.single_key;
  if (sk === null) return ['- Single key: no result'];
  return [
    `- Single key: ${sk.value} (${sk.reason}), basis \`${sk.basis}\`${sk.decided_by.length > 0 ? `, decided by ${sk.decided_by.join(', ')}` : ''}`,
    ...sk.parties.map((p) => party(p, row.chain, names)),
  ];
}

function perHourText(figure: NonNullable<PassportLane['rate_limit']>['per_hour'][number]): string {
  if (figure.limit === 'off') return `${figure.finality} limit off`;
  return `${figure.finality} limit on, ${figure.tokens ?? '?'} tokens (${figure.units} units) an hour, capacity plus rate x 3600`;
}

function verifierText(line: NonNullable<PassportLane['rate_limit']>['verifiers'][number], selector: string, names: Names): string {
  if (line.state !== 'listed') return `    - ${line.direction}: ${line.state}`;
  const list = (vs: { address: string; name: string | null }[]) => vs.map((v) => `${v.name ?? 'custom'} ${names.link(selector, v.address)}`).join(', ') || 'none';
  const threshold = line.threshold === null ? '' : `; and at or above ${line.threshold.tokens ?? line.threshold.units ?? '?'}: ${list(line.threshold.verifiers)}`;
  return `    - ${line.direction}: ${list(line.verifiers)}${threshold}`;
}

function laneLines(row: PassportChainRow, lane: PassportLane, token: PassportToken, names: Names): string[] {
  const remote = lane.remote_chain === null ? 'unknown chains' : names.chain(lane.remote_chain);
  const rl = lane.rate_limit;
  const rate = rl === null ? [] : [
    `  - Rate limit: ${rl.value} (${rl.reason}), basis \`${rl.basis}\`; receiving side's inbound limit ${rl.receiving_inbound ?? 'not read'}`,
    ...rl.per_hour.map((f) => `    - ${perHourText(f)}`),
    ...(rl.verifiers.length > 0 ? ['  - Verifiers:', ...rl.verifiers.map((v) => verifierText(v, row.chain, names))] : []),
  ];
  const pointers = lane.pointers.flatMap((p) => {
    const other = p.other.address === null ? undefined : token.rows.find((r) => r.chain === p.other.chain && r.address === p.other.address);
    const expects = p.other.address === null
      ? 'the group has no row there'
      : `remote token ${p.other.address}, remote pools include ${other?.pool ?? 'its pool (not read)'}`;
    return [
      `  - Pool pointer: ${p.value} (${p.reason}), basis \`${p.basis}\`; expects ${expects}`,
      ...p.sides.map((s) => `    - ${names.chain(s.from.chain)} to ${names.chain(s.to)}: ${s.state}`),
    ];
  });
  return [`- [ ] Lane to ${remote}`, ...rate, ...pointers];
}

function rowLines(row: PassportChainRow, token: PassportToken, names: Names): string[] {
  const pool = row.pool === null ? 'none' : names.link(row.chain, row.pool);
  const status = [
    row.read_on === null ? 'never read' : `read ${row.read_on}`,
    ...(row.unreadable === null ? [] : [`not readable by design (${row.unreadable})`]),
    ...(row.delisted_on === null ? [] : [`no longer listed since ${row.delisted_on}`]),
  ].join(', ');
  return [
    `### ${names.chain(row.chain) === row.chain ? row.chain : `${names.chain(row.chain)} (${row.chain})`}`,
    '',
    `- [ ] Token ${names.link(row.chain, row.address)}; ${status}`,
    `- Pool ${pool}${row.single_key?.pool_type ? ` (${row.single_key.pool_type})` : ''}`,
    ...singleKeyLines(row, names),
    ...row.lanes.flatMap((l) => laneLines(row, l, token, names)),
    '',
  ];
}

function tokenSection(n: number, token: PassportToken, covers: readonly string[], names: Names): string[] {
  const rolled = Object.entries(token.results).map(([check, value]) => `${check} ${value ?? 'none'}`).join(', ');
  return [
    `## ${n}. ${token.name}${token.symbol === null ? '' : ` (${token.symbol})`} \`${token.id}\``,
    '',
    `Covers: ${covers.join('; ')}.`,
    `Page results: ${rolled}.`,
    '',
    ...token.rows.flatMap((r) => rowLines(r, token, names)),
  ];
}

function parseArgs(argv: readonly string[]): SampleOptions {
  const [dir, ...rest] = argv;
  if (dir === undefined || dir.startsWith('--')) throw new Error(USAGE);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at < 0 ? undefined : rest[at + 1];
  };
  const seed = Number(flag('--seed') ?? '1');
  if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer\n${USAGE}`);
  return { dir: path.resolve(dir), seed, chains: flag('--chains') ?? CHAINS_URL, endpoints: flag('--endpoints') ?? path.join(ROOT, 'config/endpoints.json') };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  Promise.resolve()
    .then(() => passportSample(parseArgs(process.argv.slice(2))))
    .then((text) => console.log(text))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
