export const DASH = '—';
const MINUS = '−';

const SCALES: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K'], [1, '']];

const usable = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);

function compact(abs: number): string {
  for (let i = SCALES.length - 1; i >= 0; i--) {
    const [size, suffix] = SCALES[i]!;
    const digits = suffix === '' ? 0 : 1;
    const scaled = Number((abs / size).toFixed(digits));
    if (i > 0 && scaled >= 1000) continue;
    return `${scaled.toFixed(digits)}${suffix}`;
  }
  return '';
}

export function formatUsd(value: number | null | undefined): string {
  if (!usable(value)) return DASH;
  return `${value < 0 ? MINUS : ''}$${compact(Math.abs(value))}`;
}

/** A single message's fee in cents below $1,000, where formatUsd would round $0.42 to $0. */
export function formatFee(value: number | null | undefined): string {
  if (!usable(value)) return DASH;
  if (value > 0 && value < 0.01) return '<$0.01';
  return value < 1000 ? `$${value.toFixed(2)}` : formatUsd(value);
}

/** A day's take rate is usually under 1 bps, so small values keep two decimals. */
export function formatBps(value: number | null | undefined): string {
  if (!usable(value)) return DASH;
  if (value > 0 && value < 0.01) return '<0.01 bps';
  return `${value.toFixed(value < 1 ? 2 : value < 10 ? 1 : 0)} bps`;
}

/** A part of a whole, unsigned; formatPct signs changes. */
export function formatShare(pct: number | null | undefined): string {
  if (!usable(pct)) return DASH;
  if (pct === 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  return pct < 9.95 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

/** A total of fees: under a dollar keeps cents, where formatUsd would round to "$0". */
export function formatFeeTotal(value: number | null | undefined): string {
  return usable(value) && value > 0 && value < 1 ? formatFee(value) : formatUsd(value);
}

export function formatUsdFull(value: number | null | undefined): string {
  if (!usable(value)) return DASH;
  return `${value < 0 ? MINUS : ''}$${Math.round(Math.abs(value)).toLocaleString('en-US')}`;
}

export function formatCount(value: number | null | undefined): string {
  return usable(value) ? Math.round(value).toLocaleString('en-US') : DASH;
}

export function formatCompactCount(value: number | null | undefined): string {
  return usable(value) ? `${value < 0 ? MINUS : ''}${compact(Math.abs(value))}` : DASH;
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (!usable(value)) return DASH;
  const scale = 10 ** digits;
  const text = (Math.round(Math.abs(value) * scale) / scale).toFixed(digits);
  if (Number(text) === 0) return `${(0).toFixed(digits)}%`;
  return `${value > 0 ? '+' : MINUS}${text}%`;
}

export function formatLink(value: number | null | undefined): string {
  return usable(value) ? `${Math.round(value).toLocaleString('en-US')} LINK` : DASH;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!usable(seconds)) return DASH;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3_600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ${Math.floor((s % 3_600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3_600)}h`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${h}h ${pad(m)}m ${pad(s)}s`;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

export function formatUtcDay(dayOrIso: string): string {
  return DAY_FORMAT.format(new Date(dayOrIso.length === 10 ? `${dayOrIso}T00:00:00.000Z` : dayOrIso));
}

export function formatUtcTime(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`;
}

export function formatAgo(iso: string, now: Date): string {
  const seconds = Math.floor((now.getTime() - Date.parse(iso)) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

export function formatPrice(value: number | null | undefined): string {
  return value == null ? DASH : `$${value.toFixed(2)}`;
}

export function linkShareText(pct: number): string {
  if (pct === 0) return '0% paid in LINK';
  if (pct < 0.1) return '<0.1% paid in LINK';
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% paid in LINK`;
}
