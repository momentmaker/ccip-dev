import { BREAKDOWN_CONFLICT } from './sql';

/** A CRE DON node's sending key on one chain, as the forwarder transactions it signed show it. */
export interface CreKey {
  address: string;
  first_seen: string;
}

export interface CreChain {
  selector: string;
  forwarder: string;
  keys: CreKey[];
}

/** config/cre-keys.json, keyed by CCIP chain name. */
export interface CreKeyFile {
  source: string;
  chains: Record<string, CreChain>;
}

/** worker/src/generated/cre-keys.json: every `<selector>:<address>` key, sorted, and a version that changes with the list. */
export interface GeneratedCreKeys {
  version: string;
  keys: string[];
}

export interface CreKeySet {
  version: string;
  keys: ReadonlySet<string>;
}

/** The CRE Workflow Registry's first record: no CCIP message before it was sent by a CRE workflow. */
export const CRE_FIRST_DAY = '2025-10-17';

export const NO_CRE_KEYS: CreKeySet = { version: 'none', keys: new Set() };

/** Only these strings are ever written into SQL, so a key list can be inlined safely. */
const CRE_KEY = /^\d+:0x[0-9a-f]{40}$/;

export const creKeyOf = (selector: string, address: string): string => `${selector}:${address.toLowerCase()}`;

function assertKey(key: string, where: string): string {
  if (!CRE_KEY.test(key)) throw new Error(`${where} has a malformed CRE key ${JSON.stringify(key)}`);
  return key;
}

export function generatedCreKeys(file: CreKeyFile): GeneratedCreKeys {
  const keys = [...new Set(Object.values(file.chains).flatMap((c) => c.keys.map((k) => creKeyOf(c.selector, k.address))))].sort();
  for (const key of keys) assertKey(key, 'config/cre-keys.json');
  return { version: `${keys.length}-${fnv1a(keys.join('\n'))}`, keys };
}

export function creKeySet(generated: GeneratedCreKeys): CreKeySet {
  for (const key of generated.keys) assertKey(key, 'worker/src/generated/cre-keys.json');
  return { version: generated.version, keys: new Set(generated.keys) };
}

/** A CCIP message was sent by a CRE workflow when a CRE node key on its source chain signed the source transaction. */
export function isCreOrigin(set: CreKeySet, srcChain: string, origin: string | null): boolean {
  return origin !== null && set.keys.has(creKeyOf(srcChain, origin));
}

/** The keys as SQL string literals; `NULL` for none, so `IN (NULL)` matches nothing. */
function keysSql(set: CreKeySet): string {
  if (set.keys.size === 0) return 'NULL';
  return [...set.keys].map((k) => `'${assertKey(k, 'the CRE key set')}'`).join(', ');
}

/**
 * Sets one day's `cre` flags (?1 = day) from the key set. The list is inlined: binding it in PARAM_CHUNK pieces would
 * need a statement a piece, and a later piece's ELSE 0 would clear an earlier piece's matches. Only changed rows are written.
 */
export function creRetagDaySql(set: CreKeySet): string {
  const flag = `CASE WHEN src_chain || ':' || origin IN (${keysSql(set)}) THEN 1 ELSE 0 END`;
  return `UPDATE messages SET cre = ${flag} WHERE day = ?1 AND cre <> ${flag}`;
}

/** One rolled-up day's `cre` breakdown rows (?1 = day), as rollupDay writes them; a day not rolled up yet gets none. */
export const CRE_BREAKDOWN_DAY_SQL = `INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT day, 'cre', src_chain || ':' || sender, COUNT(*), SUM(usd_value), SUM(fee_usd)
FROM messages
WHERE day = ?1 AND cre = 1 AND EXISTS (SELECT 1 FROM daily_totals d WHERE d.day = ?1)
GROUP BY src_chain, sender
${BREAKDOWN_CONFLICT}`;

/** One rolled-up day's `cre_lane` rows (?1 = day), as rollupDay writes them; a day not rolled up yet gets none. */
export const CRE_LANE_DAY_SQL = `INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT day, 'cre_lane', src_chain || '>' || dst_chain, COUNT(*), SUM(usd_value), SUM(fee_usd)
FROM messages
WHERE day = ?1 AND cre = 1 AND EXISTS (SELECT 1 FROM daily_totals d WHERE d.day = ?1)
GROUP BY src_chain, dst_chain
${BREAKDOWN_CONFLICT}`;

/** One day's CRE totals (?1 = day) from its `cre` breakdown rows: a message has one sender, so the rows sum to the day. */
export const CRE_TOTALS_DAY_SQL = `UPDATE daily_totals SET
  cre_messages = COALESCE((SELECT SUM(messages) FROM daily_breakdown WHERE day = ?1 AND dim = 'cre'), 0),
  cre_usd = COALESCE((SELECT SUM(usd_value) FROM daily_breakdown WHERE day = ?1 AND dim = 'cre'), 0)
WHERE day = ?1`;

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
