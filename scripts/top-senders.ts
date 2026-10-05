import { readFileSync } from 'node:fs';
import path from 'node:path';
import { d1Query } from './lib/d1';

const days = Number(process.argv[2] ?? '30');
if (!Number.isInteger(days) || days < 1 || days > 3650) {
  console.error('usage: pnpm report:top-senders [days, default 30]');
  process.exit(1);
}

const labels = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../worker/src/generated/labels.json'), 'utf8'),
) as Record<string, { name: string }>;
const names = new Map(d1Query<{ selector: string; name: string }>('SELECT selector, name FROM chains').map((r) => [r.selector, r.name]));
const top = d1Query<{ key: string; messages: number; usd: number }>(
  `SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd FROM daily_breakdown
   WHERE dim = 'sender' AND day >= date('now', '-${days} days') GROUP BY key ORDER BY usd DESC LIMIT 30`,
);

console.table(
  top.map((r, i) => {
    const split = r.key.indexOf(':');
    const chain = names.get(r.key.slice(0, split)) ?? r.key.slice(0, split);
    const address = r.key.slice(split + 1);
    return {
      rank: i + 1,
      chain,
      address,
      messages: r.messages,
      usd: Math.round(r.usd).toLocaleString('en-US'),
      label: labels[`${chain}:${address}`]?.name ?? '',
    };
  }),
);
