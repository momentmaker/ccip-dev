import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addDays, buildHandles, buildLabelIndex, buildProjectRegistry, buildTokenLabels, claimedTokenKeys, dayOf, identityResolver, isAddressShape, labelCoverage,
  labeledAddresses, labelKey, mergeIdentities, normalizeAddress, REGISTRY_GROUPS_SQL, sanitize, SENDER_ADDRESS, senderKeyAddress, tokenClaims, unlabeledSenderRowsSql,
  validateChainHandles, validateRegistry, VIA_GROUP, VIA_SELECTOR, VIA_TOKEN_CREDITS_SQL, viaTokenCredits, type Handles, type IdentityResolver, type LabelCoverage,
  type RegistryProject, type SenderRow,
} from '@ccip-dev/core';
import { dataSharePct, formatShare, labelCoverageLine } from '@ccip-dev/core/format';
import { shortAddress } from '@ccip-dev/core/names';
import { byName } from '@ccip-dev/core/roster';
import { stringify } from 'smol-toml';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Senders rank by identity, an address summed across its chains: the top 100 by messages and the top 100 by value. */
export const CANDIDATES_PER_ORDER = 100;
/** A wallet sending this many messages in a week is an operator, not a user, so it stays a candidate. */
export const BUSY_WALLET_MESSAGES = 100;

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

export interface CandidateRow {
  address: string;
  chain: string;
  chain_name: string | null;
  chain_id: string | null;
  family: string | null;
  messages: number;
  usd: number;
}

export interface CandidateChain {
  selector: string;
  name: string | null;
  chain_id: string | null;
  family: string | null;
  messages: number;
}

export interface Candidate {
  address: string;
  /** The family of its busiest chain. */
  family: string | null;
  /** Its source chains, busiest first. */
  chains: CandidateChain[];
  messages: number;
  usd: number;
  /** Its messages in the window that carried no tokens. */
  data_messages: number;
  first_seen: string;
}

/** This week is the 7 complete days before today, as the Worker computes coverage, and last week the 7 before them. */
export function coverageWindows(today: string) {
  return {
    week: { from: addDays(today, -7), to: addDays(today, -1) },
    before: { from: addDays(today, -14), to: addDays(today, -8) },
  };
}

/** What netting a sender's rows needs: the addresses a verified label names, which keep every send, and the claimed via-token keys. */
export interface Credits {
  labeled: readonly string[];
  claimed: readonly string[];
}

/**
 * Each sender key's sums over [?1, ?2], as the Worker ranks senders: an address a label names (?3) whole, any other net
 * of its claimed direct sends (?4) through the Worker's own SQL, and a key with nothing left out. A wallet whose sends
 * are credited to a token's project is not drafted for them.
 */
const NET_SENDER_KEYS = `SELECT key, address, SUM(messages) AS messages, SUM(usd_value) AS usd_value FROM (
    ${unlabeledSenderRowsSql(false, '?4')}
    UNION ALL
    SELECT key, ${SENDER_ADDRESS}, messages, usd_value, fee_usd FROM daily_breakdown
    WHERE dim = 'sender' AND day >= ?1 AND day <= ?2 AND ${SENDER_ADDRESS} IN (SELECT value FROM json_each(?3))
  ) GROUP BY key HAVING SUM(messages) > 0`;

const netParams = (fromDay: string, toDay: string, credits: Credits) => [fromDay, toDay, JSON.stringify(credits.labeled), JSON.stringify(credits.claimed)];

/**
 * Each (address, chain) row of the addresses in the top ?7 by messages or the top ?7 by value over [?1, ?2], net of
 * their credited sends, each address summed across its chains and held to the thresholds (?5 dollars or ?6 messages).
 */
export function identityCandidateQuery(fromDay: string, toDay: string, credits: Credits, minUsd: number, minMessages: number, limit = CANDIDATES_PER_ORDER) {
  return {
    sql: `WITH rows AS (
            SELECT substr(key, 1, instr(key, ':') - 1) AS chain, address, messages, usd_value FROM (${NET_SENDER_KEYS})
          ), by_address AS (
            SELECT address, SUM(messages) AS messages, SUM(usd_value) AS usd FROM rows GROUP BY address
            HAVING SUM(usd_value) >= ?5 OR SUM(messages) >= ?6
          ), picked AS (
            SELECT address FROM (SELECT address FROM by_address ORDER BY messages DESC, address LIMIT ?7)
            UNION
            SELECT address FROM (SELECT address FROM by_address ORDER BY usd DESC, address LIMIT ?7)
          )
          SELECT r.address AS address, r.chain AS chain, c.name AS chain_name, c.chain_id AS chain_id, c.family AS family,
            r.messages AS messages, r.usd_value AS usd
          FROM rows r JOIN picked p ON p.address = r.address LEFT JOIN chains c ON c.selector = r.chain
          ORDER BY r.address, messages DESC, r.chain`,
    params: [...netParams(fromDay, toDay, credits), minUsd, minMessages, limit],
  };
}

/**
 * Each address's first day ever, on any chain, and its messages without tokens over [?1, ?4] on the given (chain, address)
 * pairs only, so a share is taken over the same days and chains its candidate's finalized message count sums.
 */
export function messageStatsQuery(fromDay: string, toDay: string, pairs: readonly { chain: string; address: string }[]) {
  return {
    sql: `SELECT sender AS address,
            SUM(CASE WHEN day >= ?1 AND day <= ?4 AND token_count = 0 AND (src_chain || ':' || sender) IN (SELECT value FROM json_each(?3)) THEN 1 ELSE 0 END) AS data_messages,
            MIN(day) AS first_seen
          FROM messages WHERE src_chain IN (SELECT selector FROM chains) AND sender IN (SELECT value FROM json_each(?2))
          GROUP BY sender`,
    params: [fromDay, JSON.stringify([...new Set(pairs.map((p) => p.address))]), JSON.stringify(pairs.map((p) => `${p.chain}:${p.address}`)), toDay],
  };
}

/** Each (address, chain) row over [?1, ?2] of the addresses in ?5, net of their credited sends, with no threshold: the rows of senders new on CCIP. */
export function newcomerRowsQuery(fromDay: string, toDay: string, credits: Credits, addresses: readonly string[]) {
  return {
    sql: `SELECT r.address AS address, substr(r.key, 1, instr(r.key, ':') - 1) AS chain, c.name AS chain_name, c.chain_id AS chain_id,
            c.family AS family, r.messages AS messages, r.usd_value AS usd
          FROM (${NET_SENDER_KEYS}) r LEFT JOIN chains c ON c.selector = substr(r.key, 1, instr(r.key, ':') - 1)
          WHERE r.address IN (SELECT value FROM json_each(?5))
          ORDER BY address, messages DESC, chain`,
    params: [...netParams(fromDay, toDay, credits), JSON.stringify(addresses)],
  };
}

/** The unlabeled addresses the Worker recorded as new on CCIP since ?1, which the PR lists first. */
export function newcomerQuery(sinceDay: string) {
  return {
    sql: `SELECT substr(key, 9) AS address FROM arrivals WHERE kind = 'sender' AND key LIKE 'address:%' AND first_seen >= ?1`,
    params: [`${sinceDay}T00:00:00.000Z`],
  };
}

/** Per-key sender sums over [?1, ?2], for label coverage and the spread report. */
export function senderRowsQuery(fromDay: string, toDay: string) {
  return {
    sql: `SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
          FROM daily_breakdown WHERE dim = 'sender' AND day >= ?1 AND day <= ?2 GROUP BY key`,
    params: [fromDay, toDay],
  };
}

export function windowTotalsQuery(fromDay: string, toDay: string) {
  return {
    sql: `SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(usd_value), 0) AS usd_value, SUM(fee_usd) AS fee_usd
          FROM daily_totals WHERE day >= ?1 AND day <= ?2`,
    params: [fromDay, toDay],
  };
}

/** A row a label names (a draft included), or one a label spreads to, belongs to a project; the rest are candidates' rows. */
export function unlabeledRows(rows: readonly CandidateRow[], labeled: ReadonlySet<string>, resolve: IdentityResolver): CandidateRow[] {
  return rows.filter((r) => !(r.chain_name !== null && labeled.has(labelKey(r.chain_name, r.address))) && resolve(r.chain, r.address).project === null);
}

/** The ranked rows plus the unlabeled rows of every newcomer the ranking missed, so a quiet new sender is still a candidate. */
export function withNewcomerRows(
  ranked: readonly CandidateRow[],
  newcomerRows: readonly CandidateRow[],
  labeled: ReadonlySet<string>,
  resolve: IdentityResolver,
): CandidateRow[] {
  const rankedAddresses = new Set(ranked.map((r) => r.address));
  return [...ranked, ...unlabeledRows(newcomerRows, labeled, resolve).filter((r) => !rankedAddresses.has(r.address))];
}

/** One candidate per address, its chains busiest first, busiest candidates first. */
export function groupCandidates(rows: readonly CandidateRow[], stats: ReadonlyMap<string, { data_messages: number; first_seen: string }>): Candidate[] {
  const byAddress = new Map<string, CandidateRow[]>();
  for (const r of rows) {
    const list = byAddress.get(r.address);
    if (list) list.push(r);
    else byAddress.set(r.address, [r]);
  }
  return [...byAddress]
    .map(([address, list]): Candidate => {
      const chains = [...list]
        .sort((a, b) => b.messages - a.messages || byName(a.chain, b.chain))
        .map((r) => ({ selector: r.chain, name: r.chain_name, chain_id: r.chain_id, family: r.family, messages: r.messages }));
      const stat = stats.get(address);
      return {
        address,
        family: chains[0]?.family ?? null,
        chains,
        messages: sum(list.map((r) => r.messages)),
        usd: sum(list.map((r) => r.usd)),
        data_messages: stat?.data_messages ?? 0,
        first_seen: stat?.first_seen ?? '-',
      };
    })
    .sort((a, b) => b.messages - a.messages || b.usd - a.usd || byName(a.address, b.address));
}

export function priorityQuery(sinceDay: string) {
  return {
    sql: `SELECT DISTINCT key FROM (
            SELECT key, ROW_NUMBER() OVER (PARTITION BY day ORDER BY usd_value DESC) AS rank
            FROM daily_breakdown WHERE dim = 'sender' AND day >= ?
          ) WHERE rank <= 3`,
    params: [sinceDay],
  };
}

export type AddressKind = 'contract' | 'wallet' | 'unknown' | 'error';

const RPC_TIMEOUT_MS = 15_000;

const EIP7702_MATCH = /^0xef0100[0-9a-f]{40}$/i;
const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111';

export async function classify(fetchFn: typeof fetch, rpcUrl: string | undefined, address: string): Promise<AddressKind> {
  if (!rpcUrl || !/^0x[0-9a-f]{40}$/.test(address)) return 'unknown';
  try {
    const res = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) return 'error';
    const body = (await res.json()) as { result?: unknown };
    if (typeof body.result !== 'string') return 'error';
    if (body.result === '0x' || body.result === '0x0' || EIP7702_MATCH.test(body.result)) return 'wallet';
    return 'contract';
  } catch {
    return 'error';
  }
}

export async function classifySolana(fetchFn: typeof fetch, rpcUrl: string | undefined, address: string): Promise<AddressKind> {
  if (!rpcUrl) return 'unknown';
  try {
    const res = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [address, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }],
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) return 'error';
    const body = (await res.json()) as { result?: { value?: { owner?: unknown; executable?: unknown } | null } };
    if (typeof body.result !== 'object' || body.result === null || !('value' in body.result)) return 'error';
    const account = body.result.value;
    if (account === null) return 'unknown';
    if (typeof account !== 'object' || typeof account.owner !== 'string') return 'error';
    return account.owner === SOLANA_SYSTEM_PROGRAM && account.executable !== true ? 'wallet' : 'contract';
  } catch {
    return 'error';
  }
}

/** Programs nearly every Solana transaction calls; the program that says who the sender is is the first one after them. */
const COMMON_PROGRAMS = new Set([
  '11111111111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);

/** Chainlink's CCIP router program on Solana mainnet: every CCIP send reaches it, directly or through the sender's own program. */
export const CCIP_ROUTER_SOLANA = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C';
/** How many of a sender's latest successful transactions to read looking for a CCIP send. */
const SOLANA_SENDS_CHECKED = 5;

interface SolanaTransaction {
  transaction?: { message?: { accountKeys?: unknown; instructions?: unknown } };
  meta?: { loadedAddresses?: { writable?: string[]; readonly?: string[] } };
}

/** Every account a transaction loads, static keys first, and the programs its top-level instructions call. */
function transactionPrograms(tx: SolanaTransaction | null | undefined): { keys: unknown[]; topLevel: unknown[] } | null {
  const message = tx?.transaction?.message;
  if (!message || !Array.isArray(message.accountKeys) || !Array.isArray(message.instructions)) return null;
  const keys: unknown[] = [...message.accountKeys, ...(tx?.meta?.loadedAddresses?.writable ?? []), ...(tx?.meta?.loadedAddresses?.readonly ?? [])];
  const topLevel = (message.instructions as { programIdIndex?: unknown }[]).map((i) => (typeof i.programIdIndex === 'number' ? keys[i.programIdIndex] : undefined));
  return { keys, topLevel };
}

/**
 * The program a system-owned Solana sender's latest CCIP send invokes at the top level, past the common ones: its own program,
 * or CCIP_ROUTER_SOLANA when it calls the router directly. Its latest transactions that never reach the router are skipped.
 */
export async function solanaSendProgram(fetchFn: typeof fetch, rpcUrl: string | undefined, address: string): Promise<string | null> {
  if (!rpcUrl) return null;
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    const res = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`Solana RPC ${method} for ${address} returned HTTP ${res.status}`);
    return res.ok ? ((await res.json()) as { result?: unknown }).result : undefined;
  };
  try {
    const signatures = await call('getSignaturesForAddress', [address, { limit: 10 }]);
    if (!Array.isArray(signatures)) return null;
    const succeeded = (signatures as { signature?: unknown; err?: unknown }[]).filter((s) => s.err === null && typeof s.signature === 'string');
    for (const { signature } of succeeded.slice(0, SOLANA_SENDS_CHECKED)) {
      const tx = (await call('getTransaction', [signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }])) as SolanaTransaction | null | undefined;
      const programs = transactionPrograms(tx);
      if (programs === null || !programs.keys.includes(CCIP_ROUTER_SOLANA)) continue;
      const program = programs.topLevel.find((p) => typeof p === 'string' && !COMMON_PROGRAMS.has(p));
      return typeof program === 'string' ? program : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Who each address sent to since ?1, for pairing candidates. */
export function receiversQuery(sinceDay: string, addresses: readonly string[]) {
  return {
    sql: `SELECT sender AS address, receiver, COUNT(*) AS messages FROM messages
          WHERE day >= ?1 AND sender IN (SELECT value FROM json_each(?2)) AND receiver IS NOT NULL
          GROUP BY sender, receiver`,
    params: [sinceDay, JSON.stringify(addresses)],
  };
}

/** Two candidates pair when one sends to the other, or to the program the other sends through. */
export function pairHints(addresses: readonly string[], sends: readonly { address: string; receiver: string }[], programs: ReadonlyMap<string, string>): Map<string, string[]> {
  const candidates = new Set(addresses);
  const ownerOf = new Map<string, string>([...addresses.map((a) => [a, a] as const), ...[...programs].map(([a, program]) => [program, a] as const)]);
  const pairs = new Map<string, Set<string>>();
  const link = (a: string, b: string) => pairs.set(a, (pairs.get(a) ?? new Set<string>()).add(b));
  for (const s of sends) {
    const other = ownerOf.get(s.receiver);
    if (!candidates.has(s.address) || other === undefined || other === s.address) continue;
    link(s.address, other);
    link(other, s.address);
  }
  return new Map([...pairs].map(([a, others]) => [a, [...others].sort().map((o) => `pairs with ${shortAddress(o)}`)]));
}

const programHints = (program: string | undefined): string[] =>
  program === undefined ? [] : [program === CCIP_ROUTER_SOLANA ? 'calls the CCIP router directly' : `sends via program ${shortAddress(program)}`];

export function candidateHints(address: string, program: string | undefined, pairs: ReadonlyMap<string, string[]>): string[] {
  return [...programHints(program), ...(pairs.get(address) ?? [])];
}

/** A wallet is a user unless it is busy enough to be an operator or new on CCIP; an address the RPC could not check is skipped. */
export function keepCandidate(kind: AddressKind, messages: number, newcomer = false): boolean {
  if (kind === 'error') return false;
  return kind !== 'wallet' || newcomer || messages >= BUSY_WALLET_MESSAGES;
}

export async function contractName(
  fetchFn: typeof fetch,
  opts: { chainId: string | null; address: string; etherscanKey?: string; blockscoutBase?: string },
): Promise<string | null> {
  if (opts.etherscanKey && opts.chainId) {
    const url =
      `https://api.etherscan.io/v2/api?chainid=${encodeURIComponent(opts.chainId)}&module=contract&action=getsourcecode` +
      `&address=${encodeURIComponent(opts.address)}&apikey=${encodeURIComponent(opts.etherscanKey)}`;
    const res = await fetchFn(url);
    if (res.ok) {
      const body = (await res.json()) as { result?: unknown };
      const name = Array.isArray(body.result) ? (body.result[0] as { ContractName?: string } | undefined)?.ContractName : undefined;
      if (name) return sanitize(name);
    }
  }
  if (opts.blockscoutBase) {
    const res = await fetchFn(`${opts.blockscoutBase.replace(/\/$/, '')}/api/v2/smart-contracts/${encodeURIComponent(opts.address)}`);
    if (res.ok) {
      const body = (await res.json()) as { name?: unknown };
      if (typeof body.name === 'string' && body.name.length > 0) return sanitize(body.name);
    }
  }
  return null;
}

export function detailsQuery(sinceDay: string, addresses: readonly string[]) {
  return {
    sql: `SELECT m.sender AS address, COALESCE(tk.symbol, mt.token) AS token, d.name AS dst_name
          FROM messages m
          LEFT JOIN message_tokens mt ON mt.message_id = m.message_id
          LEFT JOIN tokens tk ON tk.chain = mt.chain AND lower(tk.address) = lower(mt.token)
          LEFT JOIN chains d ON d.selector = m.dst_chain
          WHERE m.day >= ? AND m.sender IN (SELECT value FROM json_each(?))`,
    params: [sinceDay, JSON.stringify(addresses)],
  };
}

/** Each address's five most-sent tokens and every destination chain, across all its source chains. */
export function summarizeDetails(rows: readonly { address: string; token: string | null; dst_name: string | null }[]): Map<string, { tokens: string[]; destinations: string[] }> {
  const tokenCounts = new Map<string, Map<string, number>>();
  const destinations = new Map<string, Set<string>>();
  for (const row of rows) {
    const counts = tokenCounts.get(row.address) ?? new Map<string, number>();
    tokenCounts.set(row.address, counts);
    const dsts = destinations.get(row.address) ?? new Set<string>();
    destinations.set(row.address, dsts);
    if (row.token) counts.set(row.token, (counts.get(row.token) ?? 0) + 1);
    if (row.dst_name) dsts.add(row.dst_name);
  }
  return new Map(
    [...tokenCounts].map(([address, counts]) => [
      address,
      {
        tokens: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([token]) => sanitize(token)),
        destinations: [...(destinations.get(address) ?? [])].sort(),
      },
    ]),
  );
}

const fileSafe = (text: string) => text.replace(/[^A-Za-z0-9._-]/g, '_');

export function draftFileName(c: Candidate): string {
  const busiest = c.chains[0];
  return `_candidate-${fileSafe(busiest?.name ?? busiest?.selector ?? 'unknown')}-${fileSafe(c.address)}.toml`;
}

export function draftToml(c: Candidate, name: string | null): string {
  const body = stringify({
    name: sanitize(name ?? `Unknown ${c.address.slice(0, 10)}`),
    kind: 'unknown',
    verified: false,
    addresses: c.chains.flatMap((ch) =>
      ch.name === null
        ? []
        : [{ chain: ch.name, address: c.address, note: sanitize(`candidate: ${ch.messages} of ${c.messages} messages in the last 7 days, $${Math.round(c.usd)} in all, first seen ${c.first_seen}`, 120) }],
    ),
  });
  return `# Draft from the weekly candidate pipeline. Fill in name, x and kind; set verified = true only with public proof.\n${body}\n`;
}

export function escapeMarkdownCell(text: string): string {
  return sanitize(text, 200)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface CandidateReportRow {
  candidate: Candidate;
  name: string | null;
  priority: 'new on CCIP' | 'top 3' | null;
  tokens: string[];
  destinations: string[];
  /** Short clues to who the sender is, such as "sends via program F2ZY…KcZN" or "pairs with 0x9ec0…846b". */
  hints: string[];
  explorer: string | null;
}

const PRIORITY_ORDER = { 'new on CCIP': 0, 'top 3': 1 } as const;
const dataShare = (c: Candidate) => formatShare(dataSharePct(c.messages, c.data_messages));

export function prBody(rows: readonly CandidateReportRow[], weekOf: string, coverage: string, spread: string): string {
  const rank = (r: CandidateReportRow) => (r.priority === null ? 2 : PRIORITY_ORDER[r.priority]);
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || b.candidate.messages - a.candidate.messages || b.candidate.usd - a.candidate.usd);
  const lines = sorted.map(({ candidate: c, name, priority, tokens, destinations, hints, explorer }) =>
    [
      priority ?? '',
      escapeMarkdownCell(c.chains.map((ch) => ch.name ?? ch.selector).join(', ')),
      escapeMarkdownCell(c.address),
      escapeMarkdownCell(name ?? '-'),
      String(c.messages),
      Math.round(c.usd).toLocaleString('en-US'),
      dataShare(c),
      escapeMarkdownCell(c.first_seen),
      escapeMarkdownCell(tokens.join(', ')),
      escapeMarkdownCell(destinations.join(', ')),
      escapeMarkdownCell(hints.join('; ')),
      explorer ? `[link](${explorer})` : '-',
    ].join(' | '),
  ).map((cells) => `| ${cells} |`);
  return [
    coverage,
    '',
    `Label candidates for the week of ${weekOf}: senders ranked by identity (an address summed across its chains), the top ${CANDIDATES_PER_ORDER} by messages and the top ${CANDIDATES_PER_ORDER} by value.`,
    '',
    'Each file is a draft with `verified = false`. Fill in the real name, `x` and `kind`, and set `verified = true` only if the project publicly confirms the address. Otherwise delete the file. Then merge.',
    '',
    '| Priority | Chains | Address | Contract name | Messages (7d) | USD (7d) | Data share | First seen | Tokens | Destinations | Hints | Explorer |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...lines,
    '',
    spread,
    '',
  ].join('\n');
}

const points = (delta: number) => {
  const rounded = Math.round(delta * 10) / 10;
  const size = Math.abs(rounded);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${size} ${size === 1 ? 'point' : 'points'}`;
};

/** The line the PR leads with: the status page's coverage line, then each share's change in points from last week. */
export function coverageMarkdown(now: LabelCoverage, before: LabelCoverage): string {
  const line = labelCoverageLine(now);
  if (line === null) return 'Labeled senders: no messages in the last 7 days.';
  const change = (what: string, a: number | null, b: number | null) => (a === null || b === null ? [] : [`${points(a - b)} of ${what}`]);
  const changes = [...change('messages', now.messages_pct, before.messages_pct), ...change('value', now.usd_pct, before.usd_pct), ...change('fees', now.fees_pct, before.fees_pct)];
  return changes.length === 0 ? `${line}.` : `${line}. Since last week: ${changes.join(', ')}.`;
}

/** The via-token credits over [fromDay, toDay], through the Worker's own query, so the coverage matches the status page's. */
export function viaTokenCreditsQuery(fromDay: string, toDay: string, claimed: readonly string[], labeled: readonly string[]) {
  return { sql: VIA_TOKEN_CREDITS_SQL, params: [fromDay, toDay, JSON.stringify(claimed), JSON.stringify(labeled)] };
}

/** Registry rows of `<selector>:<address>` keys, for resolving the claims. */
export function registryGroupsQuery(keys: readonly string[]) {
  return { sql: REGISTRY_GROUPS_SQL, params: [JSON.stringify(keys)] };
}

export function registryGroupMap(rows: readonly { chain: string; address: string; group_id: string | null }[]): Map<string, string | null> {
  return new Map(rows.map((r) => [`${r.chain}:${normalizeAddress(r.address)}`, r.group_id]));
}

export interface SpreadRow {
  project: string;
  chain: string;
  address: string;
  messages: number;
}

/** The week's rows credited to a project through label spread, busiest first. */
export function spreadReport(rows: readonly SenderRow[], resolve: IdentityResolver, chainNames: ReadonlyMap<string, string>): SpreadRow[] {
  return rows
    .flatMap((r) => {
      const selector = r.key.slice(0, r.key.indexOf(':'));
      const identity = resolve(selector, senderKeyAddress(r.key));
      return identity.inferred && identity.project !== null
        ? [{ project: identity.project.name, chain: chainNames.get(selector) ?? selector, address: senderKeyAddress(r.key), messages: r.messages }]
        : [];
    })
    .sort((a, b) => b.messages - a.messages || byName(a.chain, b.chain));
}

export function spreadMarkdown(rows: readonly SpreadRow[]): string {
  const intro = [
    '## Label spread this week',
    '',
    "Addresses credited to a project because the same address is labeled on another EVM chain. Confirm each by adding it to the project's file, or turn the project's spread off with `spread = false`.",
    '',
  ];
  if (rows.length === 0) return [...intro, 'No label spread this week.', ''].join('\n');
  return [
    ...intro,
    '| Project | Chain | Address | Messages (7d) |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${escapeMarkdownCell(r.project)} | ${escapeMarkdownCell(r.chain)} | ${escapeMarkdownCell(r.address)} | ${r.messages} |`),
    '',
  ].join('\n');
}

export interface TokenGap {
  key: string;
  usd: number;
  symbol: string | null;
  name: string | null;
  group_id: string | null;
  chain_name: string | null;
}

export interface ChainGap {
  selector: string;
  chain_name: string | null;
}

export interface HandleGroup {
  chain_name: string;
  address: string;
  group_id: string | null;
}

export const GAP_TOKENS = 10;
export const GAP_CHAINS_BY_VALUE = 12;
export const GAP_CHAINS_BY_FEES = 5;

export function tokenGapQuery(sinceDay: string, limit: number) {
  return {
    sql: `WITH top AS (
            SELECT key, SUM(usd_value) AS usd FROM daily_breakdown WHERE dim = 'token' AND day >= ?1 GROUP BY key ORDER BY usd DESC LIMIT ?2
          )
          SELECT top.key AS key, top.usd AS usd, t.symbol AS symbol, t.name AS name, t.group_id AS group_id, c.name AS chain_name
          FROM top
          LEFT JOIN tokens t ON t.chain || ':' || lower(t.address) = lower(top.key)
          LEFT JOIN chains c ON c.selector = substr(top.key, 1, instr(top.key, ':') - 1)
          ORDER BY top.usd DESC`,
    params: [sinceDay, limit],
  };
}

export function chainGapQuery(sinceDay: string, byValue: number, byFees: number) {
  return {
    sql: `WITH by_value AS (
            SELECT key FROM daily_breakdown WHERE dim IN ('src_chain', 'dst_chain') AND day >= ?1
            GROUP BY key ORDER BY SUM(usd_value) DESC LIMIT ?2
          ), by_fees AS (
            SELECT key FROM daily_breakdown WHERE dim = 'src_chain' AND day >= ?1
            GROUP BY key HAVING SUM(fee_usd) IS NOT NULL ORDER BY SUM(fee_usd) DESC LIMIT ?3
          )
          SELECT k.key AS selector, c.name AS chain_name
          FROM (SELECT key FROM by_value UNION SELECT key FROM by_fees) k LEFT JOIN chains c ON c.selector = k.key
          ORDER BY c.name`,
    params: [sinceDay, byValue, byFees],
  };
}

export function handleGroupQuery(tokens: readonly { chain: string; address: string }[]) {
  return {
    sql: `SELECT c.name AS chain_name, lower(t.address) AS address, t.group_id AS group_id
          FROM tokens t JOIN chains c ON c.selector = t.chain
          WHERE c.name || ':' || lower(t.address) IN (SELECT value FROM json_each(?))`,
    params: [JSON.stringify(tokens.map((t) => `${t.chain}:${t.address.toLowerCase()}`))],
  };
}

/** A token is covered when an entry shares its registry group or its address; a chain when chain-x.json names it. */
export function handleGaps(
  tokens: readonly TokenGap[],
  chains: readonly ChainGap[],
  handles: Handles,
  groups: readonly HandleGroup[],
): { tokens: TokenGap[]; chains: ChainGap[] } {
  const coveredGroups = new Set(groups.flatMap((g) => (g.group_id === null ? [] : [g.group_id])));
  const coveredKeys = new Set(handles.tokens.map((t) => `${t.chain}:${t.address.toLowerCase()}`));
  const address = (key: string) => key.slice(key.indexOf(':') + 1).toLowerCase();
  return {
    tokens: tokens.filter((t) => !(t.group_id !== null && coveredGroups.has(t.group_id)) && !coveredKeys.has(`${t.chain_name}:${address(t.key)}`)),
    chains: chains.filter((c) => c.chain_name === null || !Object.hasOwn(handles.chains, c.chain_name)),
  };
}

export function handleGapsMarkdown(gaps: { chains: readonly ChainGap[] }): string {
  const intro = [
    '## Handles to research',
    '',
    'Regenerated by the weekly label-candidates job.',
    '',
    "Add a chain's handle only with a source: the chain's own website or docs, on a page that links to the X account. Chains go in `labels/chain-x.json`. Leave out anything you cannot verify; it stays a plain name. See docs/runbook.md, \"Labels and handles\".",
    '',
  ];
  if (gaps.chains.length === 0) return [...intro, 'Nothing to research this week.', ''].join('\n');
  return [
    ...intro,
    '### Chains without an X handle',
    '',
    '| Chain | Selector |',
    '|---|---|',
    ...gaps.chains.map((c) => `| ${escapeMarkdownCell(c.chain_name ?? '-')} | ${escapeMarkdownCell(c.selector)} |`),
    '',
  ].join('\n');
}

export const CLAIM_TOKENS = 15;

export interface ClaimRow {
  /** The via_token key's group: a registry group id, or `<selector>:<address>` for a token with none. */
  group_key: string;
  messages: number;
  usd: number;
  /** The source chain with the most direct sends of the group. */
  selector: string;
  chain_name: string | null;
  address: string | null;
  symbol: string | null;
  name: string | null;
  group_id: string | null;
}

/**
 * The ?4 token groups with the most direct sends (via_token rows) over [?1, ?2] that no claimed key in ?3 covers, each
 * with its token on its busiest source chain: the registry's symbol, name and group, or a group-less token's own address.
 */
export function tokensToClaimQuery(fromDay: string, toDay: string, claimed: readonly string[], limit = CLAIM_TOKENS) {
  return {
    sql: `WITH via AS (
            SELECT ${VIA_GROUP} AS group_key, ${VIA_SELECTOR} AS selector, SUM(messages) AS messages, SUM(usd_value) AS usd
            FROM daily_breakdown WHERE dim = 'via_token' AND day >= ?1 AND day <= ?2 GROUP BY group_key, selector
          ), top AS (
            SELECT group_key, SUM(messages) AS messages, SUM(usd) AS usd FROM via
            WHERE group_key NOT IN (SELECT value FROM json_each(?3))
            GROUP BY group_key ORDER BY SUM(messages) DESC, SUM(usd) DESC, group_key LIMIT ?4
          ), busiest AS (
            SELECT v.group_key, v.selector, ROW_NUMBER() OVER (PARTITION BY v.group_key ORDER BY v.messages DESC, v.selector) AS rn
            FROM via v JOIN top ON top.group_key = v.group_key
          ), tok AS (
            SELECT chain, address, symbol, name, group_id, lower(COALESCE(group_id, chain || ':' || address)) AS group_key,
              ROW_NUMBER() OVER (PARTITION BY chain, lower(COALESCE(group_id, chain || ':' || address)) ORDER BY address) AS rn
            FROM tokens
          )
          SELECT top.group_key AS group_key, top.messages AS messages, top.usd AS usd, b.selector AS selector, c.name AS chain_name,
            COALESCE(t.address, CASE WHEN instr(top.group_key, ':') > 0 THEN substr(top.group_key, instr(top.group_key, ':') + 1) END) AS address,
            t.symbol AS symbol, t.name AS name, t.group_id AS group_id
          FROM top JOIN busiest b ON b.group_key = top.group_key AND b.rn = 1
          LEFT JOIN tok t ON t.rn = 1 AND t.chain = b.selector AND t.group_key = lower(top.group_key)
          LEFT JOIN chains c ON c.selector = b.selector
          ORDER BY top.messages DESC, top.usd DESC, top.group_key`,
    params: [fromDay, toDay, JSON.stringify(claimed), limit],
  };
}

function explorerBase(explorerMap: Record<string, string>, chainName: string | null): string | undefined {
  const base = chainName === null ? undefined : explorerMap[chainName];
  return base?.replace(/\/$/, '');
}

/** The Blockscout page of a token on its chain, when the chain has one. */
export function tokenExplorerLink(explorerMap: Record<string, string>, chainName: string | null, address: string | null): string | null {
  const base = explorerBase(explorerMap, chainName);
  return base === undefined || address === null ? null : `${base}/token/${address}`;
}

export function tokensToClaimMarkdown(rows: readonly ClaimRow[], byValue: readonly TokenGap[], explorerMap: Record<string, string>): string {
  const cell = (text: string | null) => escapeMarkdownCell(text ?? '-');
  const link = (chain: string | null, address: string | null) => {
    const url = tokenExplorerLink(explorerMap, chain, address);
    return url === null ? '-' : `[link](${url})`;
  };
  const dollars = (usd: number) => Math.round(usd).toLocaleString('en-US');
  const sends =
    rows.length === 0
      ? ['No unclaimed direct sends this week.']
      : [
          '| Token | Name | Chain | Address | Group | Direct sends (7d) | USD (7d) | Explorer |',
          '|---|---|---|---|---|---|---|---|',
          ...rows.map(
            (r) =>
              `| ${cell(r.symbol)} | ${cell(r.name)} | ${cell(r.chain_name ?? r.selector)} | ${cell(r.address)} | ${cell(r.group_id)} | ${r.messages} | ` +
              `${dollars(r.usd)} | ${link(r.chain_name, r.address)} |`,
          ),
        ];
  const value =
    byValue.length === 0
      ? ['Every busy token has a handle.']
      : [
          '| Token | Name | Chain | Address | Group | USD (7d) | Explorer |',
          '|---|---|---|---|---|---|---|',
          ...byValue.map((t) => {
            const address = t.key.slice(t.key.indexOf(':') + 1);
            return `| ${cell(t.symbol)} | ${cell(t.name)} | ${cell(t.chain_name)} | ${cell(address)} | ${cell(t.group_id)} | ${dollars(t.usd)} | ${link(t.chain_name, address)} |`;
          }),
        ];
  return [
    '## Tokens to claim',
    '',
    'Regenerated by the weekly label-candidates job.',
    '',
    "A wallet that calls the CCIP router itself is the sender of its message, so its sends are credited to the project that claims the message's first token, \"via its token\". Claim a token with a `[[tokens]]` entry (`chain`, `address`, `source`) in the project's file, and only for the project that put the token on CCIP: the source is the project's own docs or announcement naming CCIP and the token's address. General-purpose assets that no single app's users bridge (USDC, USDT, LINK, cbBTC, WETH and the like) are not claimed. A claim needs `verified = true`; tagging the token in posts also needs the project's `x`. See docs/runbook.md, \"Labels and handles\".",
    '',
    '### By direct sends',
    '',
    ...sends,
    '',
    '### By value, with no handle',
    '',
    ...value,
    '',
  ].join('\n');
}

async function d1<T>(sql: string, params: unknown[]): Promise<T[]> {
  const { CLOUDFLARE_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_READ_TOKEN } = process.env;
  if (!CLOUDFLARE_ACCOUNT_ID || !CF_D1_DATABASE_ID || !CF_D1_READ_TOKEN) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID, CF_D1_DATABASE_ID and CF_D1_READ_TOKEN must be set');
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${CF_D1_READ_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  );
  if (!res.ok) throw new Error(`D1 query returned HTTP ${res.status}`);
  const body = (await res.json()) as { result?: { results?: T[] }[] };
  return body.result?.[0]?.results ?? [];
}

async function loadProjects(knownChains: ReadonlySet<string>): Promise<RegistryProject[]> {
  const dir = path.join(ROOT, 'labels/projects');
  const files = await Promise.all(
    (await readdir(dir)).filter((f) => f.endsWith('.toml')).map(async (f) => ({ file: f, text: await readFile(path.join(dir, f), 'utf8') })),
  );
  return validateRegistry(files, knownChains).projects;
}

async function currentHandles(projects: RegistryProject[], knownChains: ReadonlySet<string>): Promise<Handles> {
  const chainHandles = validateChainHandles(await readFile(path.join(ROOT, 'labels/chain-x.json'), 'utf8'), knownChains).handles;
  return buildHandles(projects, chainHandles);
}

function classifyCandidate(c: Candidate, rpcMap: Record<string, string>): Promise<AddressKind> {
  if (c.family === 'EVM') return classify(fetch, rpcMap[c.chains[0]?.name ?? ''], c.address);
  if (c.family === 'SVM') return classifySolana(fetch, rpcMap['solana-mainnet'], c.address);
  return Promise.resolve('unknown');
}

/** The Blockscout page of the address on the first of its chains that has one. */
export function explorerLink(explorerMap: Record<string, string>, c: Candidate): string | null {
  const base = c.chains.map((ch) => explorerBase(explorerMap, ch.name)).find((b) => b !== undefined);
  return base === undefined ? null : `${base}/address/${c.address}`;
}

export async function loadEndpointMaps(rootDir: string): Promise<{ rpcMap: Record<string, string>; explorerMap: Record<string, string> }> {
  const endpoints = JSON.parse(await readFile(path.join(rootDir, 'config/endpoints.json'), 'utf8')) as {
    rpc: Record<string, string>;
    explorer: Record<string, string>;
  };
  return { rpcMap: endpoints.rpc, explorerMap: endpoints.explorer };
}

async function main(): Promise<void> {
  const today = dayOf(new Date());
  const windows = coverageWindows(today);
  const since = windows.week.from;
  const minUsd = Number(process.env.CANDIDATE_MIN_USD_7D ?? '50000');
  const minMessages = Number(process.env.CANDIDATE_MIN_MESSAGES_7D ?? '50');
  const { rpcMap, explorerMap } = await loadEndpointMaps(ROOT);
  const knownChains = new Set<string>(JSON.parse(await readFile(path.join(ROOT, 'labels/ccip-chains.json'), 'utf8')));
  const projects = await loadProjects(knownChains);
  const labeled = new Set(projects.flatMap((p) => p.addresses.map((a) => labelKey(a.chain, a.address))));
  const chainRows = await d1<{ selector: string; name: string; family: string }>('SELECT selector, name, family FROM chains', []);
  const chainNames = new Map(chainRows.map((c) => [c.selector, c.name]));
  const senderChains = new Map(chainRows.map((c) => [c.selector, { name: c.name, family: c.family }]));
  const labelIndex = buildLabelIndex(projects);
  const resolve = identityResolver(labelIndex, senderChains);
  const tokenLabels = buildTokenLabels(projects);
  const rgq = registryGroupsQuery(claimedTokenKeys(tokenLabels, senderChains));
  const groups = registryGroupMap(await d1<{ chain: string; address: string; group_id: string | null }>(rgq.sql, rgq.params));
  const claims = tokenClaims(tokenLabels, buildProjectRegistry(projects), senderChains, groups);
  const claimed = [...claims.keys()];
  const labeledList = labeledAddresses(labelIndex);
  const credits: Credits = { labeled: labeledList, claimed };

  const nq = newcomerQuery(since);
  const newcomers = new Set((await d1<{ address: string }>(nq.sql, nq.params)).map((r) => r.address));
  const cq = identityCandidateQuery(since, windows.week.to, credits, minUsd, minMessages);
  const ranked = unlabeledRows(await d1<CandidateRow>(cq.sql, cq.params), labeled, resolve);
  const nrq = newcomerRowsQuery(since, windows.week.to, credits, [...newcomers]);
  const newcomerRows = newcomers.size === 0 ? [] : await d1<CandidateRow>(nrq.sql, nrq.params);
  const rows = withNewcomerRows(ranked, newcomerRows, labeled, resolve).filter((r) => {
    if (r.chain_name !== null && knownChains.has(r.chain_name)) return true;
    console.warn(`skipping ${r.chain}:${r.address}: ${r.chain_name ?? 'its chain'} is not in labels/ccip-chains.json yet`);
    return false;
  });
  const sq = messageStatsQuery(since, windows.week.to, rows);
  const stats = new Map((await d1<{ address: string; data_messages: number; first_seen: string }>(sq.sql, sq.params)).map((s) => [s.address, s]));
  const pq = priorityQuery(since);
  const top3 = new Set((await d1<{ key: string }>(pq.sql, pq.params)).map((r) => senderKeyAddress(r.key)));

  const report: CandidateReportRow[] = [];
  const kinds = new Map<string, AddressKind>();
  for (const c of groupCandidates(rows, stats)) {
    if (!isAddressShape(c.family ?? '', c.address)) {
      console.warn(`skipping ${c.address}: not a valid ${c.family} address`);
      continue;
    }
    const kind = await classifyCandidate(c, rpcMap);
    kinds.set(c.address, kind);
    if (kind === 'error') console.warn(`skipping ${c.address}: RPC check failed`);
    if (!keepCandidate(kind, c.messages, newcomers.has(c.address))) continue;
    const busiest = c.chains[0]!;
    const name =
      c.family === 'EVM'
        ? await contractName(fetch, { chainId: busiest.chain_id, address: c.address, etherscanKey: process.env.ETHERSCAN_API_KEY, blockscoutBase: explorerMap[busiest.name ?? ''] })
        : null;
    await writeFile(path.join(ROOT, 'labels/projects', draftFileName(c)), draftToml(c, name));
    report.push({
      candidate: c,
      name,
      priority: newcomers.has(c.address) ? 'new on CCIP' : top3.has(c.address) ? 'top 3' : null,
      tokens: [],
      destinations: [],
      hints: [],
      explorer: explorerLink(explorerMap, c),
    });
  }

  if (report.length > 0) {
    const dq = detailsQuery(since, report.map((r) => r.candidate.address));
    const details = summarizeDetails(await d1<{ address: string; token: string | null; dst_name: string | null }>(dq.sql, dq.params));
    for (const row of report) {
      const found = details.get(row.candidate.address);
      if (found) {
        row.tokens = found.tokens;
        row.destinations = found.destinations;
      }
    }
  }

  const programs = new Map<string, string>();
  for (const row of report) {
    if (row.candidate.family !== 'SVM' || kinds.get(row.candidate.address) !== 'wallet') continue;
    const program = await solanaSendProgram(fetch, rpcMap['solana-mainnet'], row.candidate.address);
    if (program !== null) programs.set(row.candidate.address, program);
  }
  const addresses = report.map((r) => r.candidate.address);
  const rq = receiversQuery(since, addresses);
  const pairs = addresses.length === 0 ? new Map<string, string[]>() : pairHints(addresses, await d1<{ address: string; receiver: string }>(rq.sql, rq.params), programs);
  for (const row of report) row.hints = candidateHints(row.candidate.address, programs.get(row.candidate.address), pairs);

  const windowRows = (from: string, to: string) => {
    const q = senderRowsQuery(from, to);
    return d1<SenderRow>(q.sql, q.params);
  };
  const windowTotals = async (from: string, to: string) => {
    const q = windowTotalsQuery(from, to);
    return (await d1<{ messages: number; usd_value: number; fee_usd: number | null }>(q.sql, q.params))[0] ?? { messages: 0, usd_value: 0, fee_usd: null };
  };
  const weekRows = await windowRows(windows.week.from, windows.week.to);
  const windowCredits = async (from: string, to: string) => {
    const q = viaTokenCreditsQuery(from, to, claimed, labeledList);
    return viaTokenCredits(await d1<SenderRow>(q.sql, q.params), claims);
  };
  const coverage = coverageMarkdown(
    labelCoverage(mergeIdentities(weekRows, resolve, await windowCredits(windows.week.from, windows.week.to)), await windowTotals(windows.week.from, windows.week.to)),
    labelCoverage(
      mergeIdentities(await windowRows(windows.before.from, windows.before.to), resolve, await windowCredits(windows.before.from, windows.before.to)),
      await windowTotals(windows.before.from, windows.before.to),
    ),
  );
  const spread = spreadMarkdown(spreadReport(weekRows, resolve, chainNames));

  const handles = await currentHandles(projects, knownChains);
  const tq = tokenGapQuery(since, GAP_TOKENS);
  const gq2 = chainGapQuery(since, GAP_CHAINS_BY_VALUE, GAP_CHAINS_BY_FEES);
  const hq = handleGroupQuery(handles.tokens);
  const gaps = handleGaps(
    await d1<TokenGap>(tq.sql, tq.params),
    await d1<ChainGap>(gq2.sql, gq2.params),
    handles,
    handles.tokens.length === 0 ? [] : await d1<HandleGroup>(hq.sql, hq.params),
  );
  const ctq = tokensToClaimQuery(since, windows.week.to, claimed);
  const toClaim = await d1<ClaimRow>(ctq.sql, ctq.params);
  const tokensMarkdown = tokensToClaimMarkdown(toClaim, gaps.tokens, explorerMap);
  const gapsMarkdown = handleGapsMarkdown(gaps);
  await writeFile(path.join(ROOT, 'labels/handle-gaps.md'), `${tokensMarkdown}\n${gapsMarkdown}`);
  await writeFile(path.join(ROOT, 'pr-body.md'), `${prBody(report, today, coverage, spread)}\n${tokensMarkdown}\n${gapsMarkdown}`);
  console.log(`${report.length} candidate draft(s) written; ${toClaim.length} token(s) to claim; ${gaps.tokens.length} token and ${gaps.chains.length} chain handle gap(s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
