import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addDays, dayOf, isAddressShape, labelKey, sanitize, validateRegistry } from '@ccip-dev/core';
import { stringify } from 'smol-toml';

const ROOT = path.resolve(import.meta.dirname, '..');

export interface Candidate {
  chain: string;
  chain_name: string | null;
  chain_id: string | null;
  family: string | null;
  address: string;
  messages: number;
  usd: number;
  first_seen: string;
}

export function windowStart(today: string): string {
  return addDays(today, -6);
}

export function candidateQuery(sinceDay: string, minUsd: number, minMessages: number) {
  return {
    sql: `SELECT m.src_chain AS chain, c.name AS chain_name, c.chain_id AS chain_id, c.family AS family, m.sender AS address,
            COUNT(*) AS messages, SUM(m.usd_value) AS usd,
            (SELECT MIN(m2.day) FROM messages m2 WHERE m2.src_chain = m.src_chain AND m2.sender = m.sender) AS first_seen
          FROM messages m LEFT JOIN chains c ON c.selector = m.src_chain
          WHERE m.day >= ?
          GROUP BY m.src_chain, m.sender
          HAVING SUM(m.usd_value) >= ? OR COUNT(*) >= ?
          ORDER BY usd DESC LIMIT 200`,
    params: [sinceDay, minUsd, minMessages],
  };
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

type AddressKind = 'contract' | 'wallet' | 'unknown' | 'error';

const EIP7702_PREFIX = '0xef0100';
const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111';

export async function classify(fetchFn: typeof fetch, rpcUrl: string | undefined, address: string): Promise<AddressKind> {
  if (!rpcUrl || !/^0x[0-9a-f]{40}$/.test(address)) return 'unknown';
  try {
    const res = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
    });
    if (!res.ok) return 'error';
    const body = (await res.json()) as { result?: unknown };
    if (typeof body.result !== 'string') return 'error';
    if (body.result === '0x' || body.result === '0x0' || body.result.startsWith(EIP7702_PREFIX)) return 'wallet';
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

export function detailsQuery(sinceDay: string, keys: string[]) {
  return {
    sql: `SELECT m.src_chain AS chain, m.sender AS address, COALESCE(tk.symbol, mt.token) AS token, d.name AS dst_name
          FROM messages m
          LEFT JOIN message_tokens mt ON mt.message_id = m.message_id
          LEFT JOIN tokens tk ON tk.chain = mt.chain AND lower(tk.address) = lower(mt.token)
          LEFT JOIN chains d ON d.selector = m.dst_chain
          WHERE m.day >= ? AND (m.src_chain || ':' || m.sender) IN (SELECT value FROM json_each(?))`,
    params: [sinceDay, JSON.stringify(keys)],
  };
}

export function summarizeDetails(rows: Array<{ chain: string; address: string; token: string | null; dst_name: string | null }>): Map<string, { tokens: string[]; chains: string[] }> {
  const result = new Map<string, { tokens: string[]; chains: string[] }>();
  const tokenCountsMap = new Map<string, Map<string, number>>();
  const chainSets = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = `${row.chain}:${row.address}`;
    if (!tokenCountsMap.has(key)) tokenCountsMap.set(key, new Map());
    if (!chainSets.has(key)) chainSets.set(key, new Set());

    if (row.token) {
      const counts = tokenCountsMap.get(key)!;
      counts.set(row.token, (counts.get(row.token) ?? 0) + 1);
    }
    if (row.dst_name) {
      chainSets.get(key)!.add(row.dst_name);
    }
  }

  for (const [key, tokenCounts] of tokenCountsMap) {
    const tokenEntries = Array.from(tokenCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const tokens: string[] = tokenEntries.map(([token]) => sanitize(token));
    const chainSet = chainSets.get(key) ?? (new Set<string>());
    const chains: string[] = Array.from(chainSet).sort();
    result.set(key, { tokens, chains });
  }

  return result;
}

const fileSafe = (text: string) => text.replace(/[^A-Za-z0-9._-]/g, '_');

export function draftFileName(c: Candidate): string {
  return `_candidate-${fileSafe(c.chain_name ?? c.chain)}-${fileSafe(c.address)}.toml`;
}

export function draftToml(c: Candidate, name: string | null): string {
  const body = stringify({
    name: sanitize(name ?? `Unknown ${c.address.slice(0, 10)}`),
    kind: 'unknown',
    verified: false,
    addresses: [
      {
        chain: c.chain_name ?? c.chain,
        address: c.address,
        note: sanitize(`candidate: ${c.messages} messages, $${Math.round(c.usd)} in the last 7 days, first seen ${c.first_seen}`, 120),
      },
    ],
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

export function prBody(rows: { candidate: Candidate; name: string | null; priority: boolean; tokens: string[]; chains: string[]; explorer: string | null }[], weekOf: string): string {
  const sorted = [...rows].sort((a, b) => Number(b.priority) - Number(a.priority) || b.candidate.usd - a.candidate.usd);
  const lines = sorted.map(
    ({ candidate: c, name, priority, tokens, chains, explorer }) => {
      const explorerCell = explorer ? `[link](${explorer})` : '-';
      return `| ${priority ? 'top 3' : ''} | ${escapeMarkdownCell(c.chain_name ?? c.chain)} | ${escapeMarkdownCell(c.address)} | ` +
        `${escapeMarkdownCell(name ?? '-')} | ${c.messages} | ${Math.round(c.usd).toLocaleString('en-US')} | ` +
        `${escapeMarkdownCell(c.first_seen)} | ${escapeMarkdownCell(tokens.join(', '))} | ${escapeMarkdownCell(chains.join(', '))} | ${explorerCell} |`;
    },
  );
  return [
    `Label candidates for the week of ${weekOf}.`,
    '',
    'Each file is a draft with `verified = false`. Fill in the real name, `x` and `kind`, and set `verified = true` only if the project publicly confirms the address. Otherwise delete the file. Then merge.',
    '',
    '| Priority | Chain | Address | Contract name | Messages (7d) | USD (7d) | First seen | Tokens | Chains | Explorer |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...lines,
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

async function labeledKeys(): Promise<Set<string>> {
  const dir = path.join(ROOT, 'labels/projects');
  const files = await Promise.all(
    (await readdir(dir)).filter((f) => f.endsWith('.toml')).map(async (f) => ({ file: f, text: await readFile(path.join(dir, f), 'utf8') })),
  );
  const chains = new Set<string>(JSON.parse(await readFile(path.join(ROOT, 'labels/ccip-chains.json'), 'utf8')));
  return new Set(validateRegistry(files, chains).projects.flatMap((p) => p.addresses.map((a) => labelKey(a.chain, a.address))));
}

function classifyCandidate(c: Candidate, rpcMap: Record<string, string>): Promise<AddressKind> {
  if (c.family === 'EVM') return classify(fetch, rpcMap[c.chain_name ?? ''], c.address);
  if (c.family === 'SVM') return classifySolana(fetch, rpcMap['solana-mainnet'], c.address);
  return Promise.resolve('unknown');
}

async function main(): Promise<void> {
  const today = dayOf(new Date());
  const since = windowStart(today);
  const minUsd = Number(process.env.CANDIDATE_MIN_USD_7D ?? '50000');
  const minMessages = Number(process.env.CANDIDATE_MIN_MESSAGES_7D ?? '50');
  const rpcMap = JSON.parse(process.env.RPC_MAP ?? '{}') as Record<string, string>;
  const explorerMap = JSON.parse(process.env.EXPLORER_MAP ?? '{}') as Record<string, string>;
  const labeled = await labeledKeys();
  const knownChains = new Set<string>(JSON.parse(await readFile(path.join(ROOT, 'labels/ccip-chains.json'), 'utf8')));

  const q = candidateQuery(since, minUsd, minMessages);
  const candidates = await d1<Candidate>(q.sql, q.params);
  const p = priorityQuery(since);
  const priority = new Set((await d1<{ key: string }>(p.sql, p.params)).map((r) => r.key));

  const rows: { candidate: Candidate; name: string | null; priority: boolean; tokens: string[]; chains: string[]; explorer: string | null }[] = [];
  const candidateKeys: string[] = [];
  for (const c of candidates) {
    if (!c.chain_name) {
      console.warn(`skipping ${c.chain}:${c.address}: chain not in the chains table yet`);
      continue;
    }
    if (!knownChains.has(c.chain_name)) {
      console.warn(`skipping ${c.chain}:${c.address}: ${c.chain_name} is not in labels/ccip-chains.json`);
      continue;
    }
    if (!isAddressShape(c.family ?? '', c.address)) {
      console.warn(`skipping ${c.chain}:${c.address}: not a valid ${c.family} address`);
      continue;
    }
    if (labeled.has(labelKey(c.chain_name, c.address))) continue;
    const kind = await classifyCandidate(c, rpcMap);
    if (kind === 'wallet') continue;
    if (kind === 'error') {
      console.warn(`skipping ${c.chain}:${c.address}: RPC check failed`);
      continue;
    }
    const name =
      c.family === 'EVM'
        ? await contractName(fetch, {
            chainId: c.chain_id,
            address: c.address,
            etherscanKey: process.env.ETHERSCAN_API_KEY,
            blockscoutBase: explorerMap[c.chain_name],
          })
        : null;
    await writeFile(path.join(ROOT, 'labels/projects', draftFileName(c)), draftToml(c, name));
    candidateKeys.push(`${c.chain}:${c.address}`);
    rows.push({ candidate: c, name, priority: priority.has(`${c.chain}:${c.address}`), tokens: [], chains: [], explorer: null });
  }

  if (candidateKeys.length > 0) {
    const dq = detailsQuery(since, candidateKeys);
    const detailRows = await d1<{ chain: string; address: string; token: string | null; dst_name: string | null }>(dq.sql, dq.params);
    const enrichment = summarizeDetails(detailRows);
    for (const row of rows) {
      const key = `${row.candidate.chain}:${row.candidate.address}`;
      const details = enrichment.get(key);
      if (details) {
        row.tokens = details.tokens;
        row.chains = details.chains;
      }
      if (explorerMap[row.candidate.chain_name ?? '']) {
        row.explorer = `${explorerMap[row.candidate.chain_name ?? ''].replace(/\/$/, '')}/address/${row.candidate.address}`;
      }
    }
  }

  await writeFile(path.join(ROOT, 'pr-body.md'), prBody(rows, today));
  console.log(`${rows.length} candidate draft(s) written`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
