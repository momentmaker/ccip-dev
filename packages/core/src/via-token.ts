import type { Label, ProjectRegistry, TokenLabels } from './labels';
import { addRowSums, emptyRowSums, type RowSums } from './row-sums';
import { senderKeyAddress, type SenderChains, type SenderRow } from './senders';

/** A token's registry group id by its chain selector and address as message_tokens stores them; null for none. */
export type TokenGroupOf = (chain: string, token: string) => string | null;

/** For a rollup whose groups don't matter: tests that read only totals, and the fee backfill, whose rollup carries no tokens. */
export const NO_TOKEN_GROUPS: TokenGroupOf = () => null;

/** Takes the `<selector>:<address>` to group_id map `tokenGroupIds` returns; a token missing from it has no group. */
export function tokenGroupLookup(groups: ReadonlyMap<string, string | null>): TokenGroupOf {
  return (chain, token) => groups.get(`${chain}:${token}`) ?? null;
}

/** The token's registry group, or for a token with none, or outside the registry, its own `<chain>:<address>`. */
export function viaTokenGroup(chain: string, token: string, groupOf: TokenGroupOf): string {
  return groupOf(chain, token) ?? `${chain}:${token}`;
}

export const viaTokenKey = (selector: string, sender: string, group: string): string => `${selector}:${sender}|${group}`;

export interface ViaTokenKeyParts {
  selector: string;
  address: string;
  /** `<selector>:<address>`, as the sender dimension keys the same sender. */
  senderKey: string;
  group: string;
}

/** Selectors hold no colon and addresses no bar, so the first of each splits the key, even when the group is `<chain>:<address>`. */
export function parseViaTokenKey(key: string): ViaTokenKeyParts {
  const colon = key.indexOf(':');
  const bar = key.indexOf('|');
  return { selector: key.slice(0, colon), address: key.slice(colon + 1, bar), senderKey: key.slice(0, bar), group: key.slice(bar + 1) };
}

/** The project each via-token group key is credited to: an entry's own `<selector>:<address>`, and its registry group. */
export type TokenClaims = ReadonlyMap<string, Label>;

const entryChain = (key: string) => key.slice(0, key.indexOf(':'));
const selectorsByName = (chains: SenderChains) => new Map([...chains].map(([selector, chain]) => [chain.name, selector]));

/** Each entry on a chain the chains table knows, as `<selector>:<address>`: the keys whose registry groups a claim needs. */
export function claimedTokenKeys(tokenLabels: TokenLabels, chains: SenderChains): string[] {
  const selectorOf = selectorsByName(chains);
  return Object.keys(tokenLabels)
    .flatMap((key) => {
      const selector = selectorOf.get(entryChain(key));
      return selector === undefined ? [] : [`${selector}:${senderKeyAddress(key)}`];
    })
    .sort();
}

/**
 * A first token is claimed when its own `<selector>:<address>` is an entry, which covers tokens outside the registry, or
 * when its registry group is the group of an entry's token, which covers every chain of the group. A key two projects
 * claim is left out: whose it is is unknown.
 */
export function tokenClaims(tokenLabels: TokenLabels, projects: ProjectRegistry, chains: SenderChains, groups: ReadonlyMap<string, string | null>): TokenClaims {
  const selectorOf = selectorsByName(chains);
  const claims = new Map<string, Label>();
  const contested = new Set<string>();
  const claim = (key: string, label: Label) => {
    const held = claims.get(key);
    if (held !== undefined && held.slug !== label.slug) contested.add(key);
    else claims.set(key, label);
  };
  for (const [key, slug] of Object.entries(tokenLabels)) {
    const entry = projects[slug];
    const selector = selectorOf.get(entryChain(key));
    if (entry === undefined || selector === undefined) continue;
    const label: Label = { name: entry.name, ...(entry.x ? { x: entry.x } : {}), kind: entry.kind, slug };
    const exact = `${selector}:${senderKeyAddress(key)}`;
    claim(exact, label);
    const group = groups.get(exact);
    if (group) claim(group, label);
  }
  for (const key of contested) claims.delete(key);
  return claims;
}

/** One source chain's claimed direct sends, credited to the project that claims the token. */
export interface ViaTokenCredit {
  selector: string;
  project: Label;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

/** A credit row's key: one source chain's direct sends of one group, summed over the senders no label names. */
export const viaCreditKey = (selector: string, group: string): string => `${selector}|${group}`;

/** Credit rows keyed `<selector>|<group>`, each with the project that claims its group; a group no project claims credits nobody. */
export function viaTokenCredits(rows: readonly SenderRow[], claims: TokenClaims): ViaTokenCredit[] {
  return rows.flatMap((r) => {
    const bar = r.key.indexOf('|');
    const project = claims.get(r.key.slice(bar + 1));
    return project === undefined ? [] : [{ selector: r.key.slice(0, bar), project, messages: r.messages, usd_value: r.usd_value, fee_usd: r.fee_usd }];
  });
}

/**
 * Moves the claimed direct sends of senders no label names out of their sender rows: a row keeps what is left, a row
 * with nothing left is dropped, and the moved part comes back as credit rows. `senderRows` holds one row per key, as one
 * day's breakdown does.
 */
export function splitViaToken(
  senderRows: readonly SenderRow[],
  viaRows: readonly SenderRow[],
  claims: TokenClaims,
  labeled: ReadonlySet<string>,
): { senders: SenderRow[]; credits: SenderRow[] } {
  const moved = new Map<string, RowSums>();
  const credited = new Map<string, RowSums>();
  const into = (sums: Map<string, RowSums>, key: string) => {
    const found = sums.get(key);
    if (found !== undefined) return found;
    const created = emptyRowSums();
    sums.set(key, created);
    return created;
  };
  for (const row of viaRows) {
    const { selector, address, senderKey, group } = parseViaTokenKey(row.key);
    if (!claims.has(group) || labeled.has(address)) continue;
    addRowSums(into(moved, senderKey), row);
    addRowSums(into(credited, viaCreditKey(selector, group)), row);
  }
  const senders = senderRows.flatMap((row): SenderRow[] => {
    const part = moved.get(row.key);
    if (part === undefined) return [row];
    const messages = row.messages - part.messages;
    return messages > 0 ? [{ key: row.key, messages, usd_value: row.usd_value - part.usd, fee_usd: row.fee_usd === null ? null : row.fee_usd - part.fee }] : [];
  });
  const credits = [...credited].map(([key, s]) => ({ key, messages: s.messages, usd_value: s.usd, fee_usd: s.anyFee ? s.fee : null }));
  return { senders, credits };
}

/** SQL over a via_token key `<selector>:<sender>|<group>`: its sender key, its address and its group. */
export const VIA_SENDER_KEY = "substr(key, 1, instr(key, '|') - 1)";
export const VIA_ADDRESS = "substr(key, instr(key, ':') + 1, instr(key, '|') - instr(key, ':') - 1)";
export const VIA_GROUP = "substr(key, instr(key, '|') + 1)";
const VIA_SELECTOR = "substr(key, 1, instr(key, ':') - 1)";

const viaTokenCreditsSql = (withDay: boolean) => {
  const day = withDay ? 'day, ' : '';
  return `SELECT ${day}credit AS key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd FROM (
    SELECT day, ${VIA_SELECTOR} || '|' || ${VIA_GROUP} AS credit, messages, usd_value, fee_usd FROM daily_breakdown
    WHERE dim = 'via_token' AND day >= ?1 AND day <= ?2
      AND ${VIA_GROUP} IN (SELECT value FROM json_each(?3)) AND ${VIA_ADDRESS} NOT IN (SELECT value FROM json_each(?4))
  ) GROUP BY ${day}credit ORDER BY ${day}credit`;
};

/**
 * Credit rows `<selector>|<group>` over [?1, ?2] for the claimed keys in the JSON list ?3, from senders outside the
 * labeled addresses ?4. The Worker and the candidates job both read coverage through it, so their numbers match.
 */
export const VIA_TOKEN_CREDITS_SQL = viaTokenCreditsSql(false);
export const VIA_TOKEN_CREDIT_DAYS_SQL = viaTokenCreditsSql(true);
