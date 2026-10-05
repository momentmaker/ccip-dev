import { d1Query } from './lib/d1';

const days = process.argv.slice(2);
if (days.length === 0 || days.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
  console.error('usage: pnpm report:day YYYY-MM-DD [YYYY-MM-DD ...]');
  process.exit(1);
}

interface Totals {
  day: string;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
  unique_senders: number;
  unpriced_messages: number;
  median_delivery_s: number | null;
}

const rows = d1Query<Totals>(
  `SELECT day, messages, usd_value, fee_usd, unique_senders, unpriced_messages, median_delivery_s FROM daily_totals WHERE day IN (${days.map((d) => `'${d}'`).join(', ')}) ORDER BY day`,
);
console.table(
  rows.map((r) => ({
    day: r.day,
    messages: r.messages,
    usd: Math.round(r.usd_value).toLocaleString('en-US'),
    fees_usd: r.fee_usd === null ? 'n/a (backfill)' : r.fee_usd.toFixed(2),
    unique_senders: r.unique_senders,
    unpriced: r.unpriced_messages,
    median_delivery_s: r.median_delivery_s,
  })),
);
