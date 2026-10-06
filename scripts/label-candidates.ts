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

export function candidateQuery(sinceDay: string, minUsd: number, minMessages: number) {
  return {
    sql: `SELECT m.src_chain AS chain, c.name AS chain_name, c.chain_id AS chain_id, c.family AS family, m.sender AS address,
            COUNT(*) AS messages, SUM(m.usd_value) AS usd, MIN(m.send_ts) AS first_seen
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

export async function classify(fetchFn: typeof fetch, rpcUrl: string | undefined, address: string): Promise<'contract' | 'wallet' | 'unknown'> {
  if (!rpcUrl || !/^0x[0-9a-f]{40}$/.test(address)) return 'unknown';
  const res = await fetchFn(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
  });
  if (!res.ok) return 'unknown';
  const body = (await res.json()) as { result?: unknown };
  if (typeof body.result !== 'string') return 'unknown';
  return body.result === '0x' || body.result === '0x0' ? 'wallet' : 'contract';
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
        note: sanitize(`candidate: ${c.messages} messages, $${Math.round(c.usd)} in the last 7 days`, 120),
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

export function prBody(rows: { candidate: Candidate; name: string | null; priority: boolean }[], weekOf: string): string {
  const sorted = [...rows].sort((a, b) => Number(b.priority) - Number(a.priority) || b.candidate.usd - a.candidate.usd);
  const lines = sorted.map(
    ({ candidate: c, name, priority }) =>
      `| ${priority ? 'top 3' : ''} | ${escapeMarkdownCell(c.chain_name ?? c.chain)} | ${escapeMarkdownCell(c.address)} | ` +
      `${escapeMarkdownCell(name ?? '-')} | ${c.messages} | ${Math.round(c.usd).toLocaleString('en-US')} |`,
  );
  return [
    `Label candidates for the week of ${weekOf}.`,
    '',
    'Each file is a draft with `verified = false`. Fill in the real name, `x` and `kind`, and set `verified = true` only if the project publicly confirms the address. Otherwise delete the file. Then merge.',
    '',
    '| Priority | Chain | Address | Contract name | Messages (7d) | USD (7d) |',
    '|---|---|---|---|---|---|',
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

async function main(): Promise<void> {
  const since = addDays(dayOf(new Date()), -7);
  const minUsd = Number(process.env.CANDIDATE_MIN_USD_7D ?? '50000');
  const minMessages = Number(process.env.CANDIDATE_MIN_MESSAGES_7D ?? '50');
  const rpcMap = JSON.parse(process.env.RPC_MAP ?? '{}') as Record<string, string>;
  const explorerMap = JSON.parse(process.env.EXPLORER_MAP ?? '{}') as Record<string, string>;
  const labeled = await labeledKeys();

  const q = candidateQuery(since, minUsd, minMessages);
  const candidates = await d1<Candidate>(q.sql, q.params);
  const p = priorityQuery(since);
  const priority = new Set((await d1<{ key: string }>(p.sql, p.params)).map((r) => r.key));

  const rows: { candidate: Candidate; name: string | null; priority: boolean }[] = [];
  for (const c of candidates) {
    if (!c.chain_name) {
      console.warn(`skipping ${c.chain}:${c.address}: chain not in the chains table yet`);
      continue;
    }
    if (!isAddressShape(c.family ?? '', c.address)) {
      console.warn(`skipping ${c.chain}:${c.address}: not a valid ${c.family} address`);
      continue;
    }
    if (labeled.has(labelKey(c.chain_name, c.address))) continue;
    const kind = c.family === 'EVM' ? await classify(fetch, rpcMap[c.chain_name], c.address) : 'unknown';
    if (kind === 'wallet') continue;
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
    rows.push({ candidate: c, name, priority: priority.has(`${c.chain}:${c.address}`) });
  }
  await writeFile(path.join(ROOT, 'pr-body.md'), prBody(rows, dayOf(new Date())));
  console.log(`${rows.length} candidate draft(s) written`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
