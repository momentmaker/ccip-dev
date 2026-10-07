import { isDay } from './days';

export const HISTORY_RANGES = ['30d', '90d', '1y', 'all'] as const;
export const TOP_DIMS = ['lane', 'token', 'sender'] as const;
export const WINDOWS = ['7d', '30d', 'all'] as const;
const SIMPLE = ['home', 'daily', 'reserve', 'replay', 'records'] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number];
export type TopDim = (typeof TOP_DIMS)[number];
export type Window = (typeof WINDOWS)[number];

export type CardRoute =
  | { kind: (typeof SIMPLE)[number] }
  | { kind: 'day'; day: string }
  | { kind: 'history'; range: HistoryRange }
  | { kind: 'top'; dim: TopDim; window: Window }
  | { kind: 'flow'; window: Window }
  | { kind: 'replay-chain'; slug: string };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DEFAULT_CARD_URL = 'https://ccip.dev/og-default.png';
const OG_RE = /^https:\/\/ccip\.dev\/og\/(.+)\.png\?v=(\d{4}-\d{2}-\d{2})$/;

const oneOf = <T extends string>(list: readonly T[], value: string | undefined): value is T =>
  value !== undefined && (list as readonly string[]).includes(value);

export function parseCardPath(path: string): CardRoute | null {
  const parts = path.split('/');
  const [head, a, b] = parts;
  if (head === 'replay' && parts.length === 2) return a !== undefined && SLUG.test(a) ? { kind: 'replay-chain', slug: a } : null;
  if (oneOf(SIMPLE, head)) return parts.length === 1 ? { kind: head } : null;
  if (head === 'day') return parts.length === 2 && a !== undefined && isDay(a) ? { kind: 'day', day: a } : null;
  if (head === 'history') return parts.length === 2 && oneOf(HISTORY_RANGES, a) ? { kind: 'history', range: a } : null;
  if (head === 'top') return parts.length === 3 && oneOf(TOP_DIMS, a) && oneOf(WINDOWS, b) ? { kind: 'top', dim: a, window: b } : null;
  if (head === 'flow') return parts.length === 2 && oneOf(WINDOWS, a) ? { kind: 'flow', window: a } : null;
  return null;
}

export function cardPathOf(route: CardRoute): string {
  switch (route.kind) {
    case 'day':
      return `day/${route.day}`;
    case 'history':
      return `history/${route.range}`;
    case 'top':
      return `top/${route.dim}/${route.window}`;
    case 'flow':
      return `flow/${route.window}`;
    case 'replay-chain':
      return `replay/${route.slug}`;
    default:
      return route.kind;
  }
}

export function ogImageUrl(cardPath: string | null, buildDate: string): string {
  return cardPath === null ? DEFAULT_CARD_URL : `https://ccip.dev/og/${cardPath}.png?v=${buildDate}`;
}

export function isOgImageUrl(url: string): boolean {
  if (url === DEFAULT_CARD_URL) return true;
  const match = OG_RE.exec(url);
  return match !== null && isDay(match[2]!) && parseCardPath(match[1]!) !== null;
}
