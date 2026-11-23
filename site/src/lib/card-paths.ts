import { broadcastCardPath, parseBroadcastPath, type BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { isDay } from './days';

export const HISTORY_RANGES = ['30d', '90d', '1y', 'all'] as const;
export const TOP_DIMS = ['lane', 'token', 'sender', 'chain', 'cre'] as const;
/** Tokens have no fee ranking: a fee is paid per message, so token rows carry no fees. CRE senders are ranked by messages only. */
export const FEE_TOP_DIMS = ['lane', 'sender', 'chain'] as const;
export const TOP_ORDERS = ['value', 'fees'] as const;
export const WINDOWS = ['7d', '30d', 'all'] as const;
const SIMPLE = ['home', 'daily', 'reserve', 'staking', 'replay', 'records'] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number];
export type TopDim = (typeof TOP_DIMS)[number];
export type Window = (typeof WINDOWS)[number];
export type TopOrder = (typeof TOP_ORDERS)[number];

export type CardRoute =
  | { kind: (typeof SIMPLE)[number] }
  | { kind: 'day'; day: string }
  | { kind: 'history'; range: HistoryRange }
  | { kind: 'top'; dim: TopDim; window: Window; order: TopOrder }
  | { kind: 'flow'; window: Window }
  | { kind: 'replay-chain'; slug: string }
  | { kind: 'project'; slug: string }
  | { kind: 'staker'; address: string }
  | { kind: 'peg' }
  | { kind: 'passport'; id: string }
  | { kind: 'broadcast'; target: BroadcastTarget };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAKER_ADDRESS = /^0x[0-9a-f]{40}$/;
const GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_ID = /^(\d+):(.+)$/;
const ROW_SLUG = /^(\d+)-((?:[A-Za-z0-9]|_[0-9a-f]{2})+)$/;
const PLAIN = /^[A-Za-z0-9]$/;
export const DEFAULT_CARD_URL = 'https://ccip.dev/og-default.png';
const OG_RE = /^https:\/\/ccip\.dev\/og\/(.+)\.png\?v=(\d{4}-\d{2}-\d{2})$/;

const oneOf = <T extends string>(list: readonly T[], value: string | undefined): value is T =>
  value !== undefined && (list as readonly string[]).includes(value);

/**
 * A Token Passport page id as a URL path segment: a registry group id as it is, and a row with no group,
 * `<selector>:<address>`, as `<selector>-<address>` with every byte of the address outside [A-Za-z0-9] written `_xx`,
 * so Canton's `Amulet@DSO::…` and Sui's `0x…::coin::COIN` stay one safe, reversible segment.
 */
export function passportSlug(id: string): string {
  if (GROUP_ID.test(id)) return id;
  const row = ROW_ID.exec(id);
  if (row === null) throw new Error(`passport page id ${JSON.stringify(id)} is neither a registry group id nor <selector>:<address>`);
  const address = [...row[2]!].map((c) => (PLAIN.test(c) ? c : [...new TextEncoder().encode(c)].map((b) => `_${b.toString(16).padStart(2, '0')}`).join(''))).join('');
  return `${row[1]}-${address}`;
}

/** The page id a passport slug names; null for anything passportSlug cannot have written. */
export function passportIdFromSlug(slug: string): string | null {
  if (GROUP_ID.test(slug)) return slug;
  const row = ROW_SLUG.exec(slug);
  if (row === null) return null;
  const bytes = [...row[2]!.matchAll(/_([0-9a-f]{2})|([A-Za-z0-9])/g)].map((m) => (m[1] !== undefined ? parseInt(m[1], 16) : m[2]!.charCodeAt(0)));
  let address: string;
  try {
    address = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
  return passportSlug(`${row[1]}:${address}`) === slug ? `${row[1]}:${address}` : null;
}

function parsePassport(slug: string | undefined): CardRoute | null {
  const id = slug === undefined ? null : passportIdFromSlug(slug);
  return id === null ? null : { kind: 'passport', id };
}

export function topOrders(dim: TopDim): readonly TopOrder[] {
  return oneOf(FEE_TOP_DIMS, dim) ? TOP_ORDERS : ['value'];
}

function parseTop(parts: readonly string[]): CardRoute | null {
  const [, dim, window, order, ...rest] = parts;
  if (rest.length > 0 || !oneOf(TOP_DIMS, dim) || !oneOf(WINDOWS, window)) return null;
  if (order === undefined) return { kind: 'top', dim, window, order: 'value' };
  return order === 'fees' && topOrders(dim).includes('fees') ? { kind: 'top', dim, window, order: 'fees' } : null;
}

export function parseCardPath(path: string): CardRoute | null {
  const parts = path.split('/');
  const [head, a] = parts;
  if (head === 'replay' && parts.length === 2) return a !== undefined && SLUG.test(a) ? { kind: 'replay-chain', slug: a } : null;
  if (head === 'project' && parts.length === 2) return a !== undefined && SLUG.test(a) ? { kind: 'project', slug: a } : null;
  if (head === 'staker' && parts.length === 2) return a !== undefined && STAKER_ADDRESS.test(a) ? { kind: 'staker', address: a } : null;
  if (head === 'passport') return parts.length === 2 ? parsePassport(a) : null;
  if (head === 'peg') return parts.length === 1 ? { kind: 'peg' } : null;
  if (oneOf(SIMPLE, head)) return parts.length === 1 ? { kind: head } : null;
  if (head === 'day') return parts.length === 2 && a !== undefined && isDay(a) ? { kind: 'day', day: a } : null;
  if (head === 'history') return parts.length === 2 && oneOf(HISTORY_RANGES, a) ? { kind: 'history', range: a } : null;
  if (head === 'top') return parseTop(parts);
  if (head === 'flow') return parts.length === 2 && oneOf(WINDOWS, a) ? { kind: 'flow', window: a } : null;
  if (head === 'broadcast') {
    const target = parseBroadcastPath(parts);
    return target ? { kind: 'broadcast', target } : null;
  }
  return null;
}

export function cardPathOf(route: CardRoute): string {
  switch (route.kind) {
    case 'day':
      return `day/${route.day}`;
    case 'history':
      return `history/${route.range}`;
    case 'top':
      return `top/${route.dim}/${route.window}${route.order === 'fees' ? '/fees' : ''}`;
    case 'flow':
      return `flow/${route.window}`;
    case 'replay-chain':
      return `replay/${route.slug}`;
    case 'project':
      return `project/${route.slug}`;
    case 'staker':
      return `staker/${route.address}`;
    case 'passport':
      return `passport/${passportSlug(route.id)}`;
    case 'broadcast':
      return broadcastCardPath(route.target);
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
