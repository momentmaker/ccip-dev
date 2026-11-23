import {
  passportShard, type PassportChainRow, type PassportEvent, type PassportIndexFile, type PassportLane, type PassportLogEntry, type PassportShardFile, type PassportShardName,
  type PassportStatementView, type PassportToken,
} from '@ccip-dev/core/public-passport';
import { REPO_URL, X_HANDLE, X_URL } from '../config';
import { buildPassportDataIfPublished } from './build-data';
import { passportSlug } from './card-paths';
import { formatUsd, formatUtcDay } from './format';
import { methodologyHref, type MetricKey } from './metric-anchors';
import { chainName, shortAddress, type ChainNames } from './names';
import type { PassportFilterRow } from './passport-filter';
import { addressExplorerUrl, xProfileUrl } from './projects';

export type CheckKind = 'single-key' | 'rate-limit' | 'pool-pointer';
export type CheckValue = 'flagged' | 'clear' | 'not readable';
type SingleKey = NonNullable<PassportChainRow['single_key']>;
type RateLimit = NonNullable<PassportLane['rate_limit']>;
type Pointer = PassportLane['pointers'][number];
type Party = SingleKey['parties'][number];
type Result = SingleKey | RateLimit | Pointer;
export type ReasonCode = SingleKey['reason'];

const CHECKS: readonly CheckKind[] = ['single-key', 'rate-limit', 'pool-pointer'];
export const CHECK_LABEL: Record<CheckKind, string> = { 'single-key': 'Single key', 'rate-limit': 'Rate limit', 'pool-pointer': 'Pool pointers' };
const CHECK_ANCHOR: Record<CheckKind, MetricKey> = { 'single-key': 'passport_single_key', 'rate-limit': 'passport_rate_limit', 'pool-pointer': 'passport_pool_pointer' };
export const RESULT_LABEL: Record<CheckValue, string> = { flagged: 'Flagged', clear: 'Clear', 'not readable': 'Not readable' };
const NO_RESULT = 'No result';
const TONE: Record<CheckValue, string> = { flagged: 'flagged', clear: 'clear', 'not readable': 'unread' };
const RANK: Record<CheckValue, number> = { flagged: 0, 'not readable': 1, clear: 2 };
/** A chain with more lanes than this shows its flagged lanes and folds the rest. */
const FOLD_LANES_OVER = 6;

/** R13: one line per reason, for a reader who has never read a pool contract. */
const NOTES: Record<ReasonCode, string> = {
  'non-evm-chain': 'ccip.dev reads EVM chains only so far, so this chain\'s settings are not read.',
  'no-endpoint': 'ccip.dev has no free endpoint for this chain, so its settings are not read.',
  'no-registry': 'ccip.dev does not know this chain\'s token registry, so its settings are not read.',
  'never-read': 'There has been no successful reading of this yet.',
  'reading-too-old': 'The last successful reading is more than seven days old, so it no longer counts.',
  'single-key': 'One key can change this token\'s bridge settings on its own.',
  'multi-signer': 'Everyone who can change the bridge settings needs two or more signers to act.',
  'no-party-can-act': 'Nobody holds a key that can change the bridge settings.',
  'party-unidentified': 'Someone who can change the settings is a contract ccip.dev cannot identify, so its number of signers is unknown.',
  'proxy-status-unknown': 'The pool did not say whether it can be upgraded, so who could upgrade it is unknown.',
  'pool-type-not-recognised': 'The pool is not a standard type, so it may have other roles ccip.dev cannot see.',
  'limit-on': 'The sending side caps how much can leave in an hour.',
  'limit-off': 'The sending side sets no cap: any amount can leave at once.',
  'limit-not-readable': 'The sending side\'s rate limit could not be read.',
  'proxy-pool': 'The pool sits behind a proxy whose lane settings ccip.dev cannot read yet.',
  'lanes-not-readable': 'The pool\'s list of lanes could not be read.',
  'pools-point-at-each-other': 'The pools on both chains name each other\'s token and pool.',
  'pointer-broken': 'One side does not name the other side\'s token or pool, so transfers between them may fail or go elsewhere.',
  'pointer-not-readable': 'One side\'s lane settings could not be read, so the pair cannot be compared.',
  'remote-chain-not-in-group': 'The registry lists no token of this group on the other chain, so there is no pool to compare with.',
  'read-on-different-days': 'The two chains have not yet been read on the same day, so the pair cannot be compared.',
};

const ROLE_LABEL: Record<Party['role'], string> = {
  poolOwner: 'Pool owner',
  registryAdministrator: 'Token admin in the registry',
  rateLimitAdmin: 'Rate-limit admin',
  hooksOwner: 'Hooks owner',
  proxyAdmin: 'Proxy admin',
};

export const LOG_LABEL: Record<PassportLogEntry['kind'], string> = {
  'first-reading': 'First reading',
  setting: 'Setting change',
  'pool-replaced': 'Pool replaced',
  're-classified': 'Re-classified',
  correction: 'Correction',
  statement: 'Team statement',
};

const SETTING_LABEL: Record<string, string> = {
  administrator: 'Token admin in the registry',
  pendingAdministrator: 'Pending token admin in the registry',
  pool: 'Pool',
  poolType: 'Pool type',
  hooks: 'Hooks contract',
  allowedFinality: 'Allowed finality',
  lanes: 'Lanes',
};

const LANE_SETTING_LABEL: Record<string, string> = {
  remoteToken: 'Remote token',
  remotePools: 'Remote pools',
  outbound: 'Outbound rate limit',
  inbound: 'Inbound rate limit',
  fastOutbound: 'Fast-transfer outbound limit',
  fastInbound: 'Fast-transfer inbound limit',
  poolVerifiers: 'Pool\'s verifiers',
  laneVerifiers: 'Lane\'s verifiers',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function reasonNote(code: string): string {
  if (!Object.hasOwn(NOTES, code)) throw new Error(`no plain note for the passport reason code "${code}"`);
  return NOTES[code as ReasonCode];
}

export const passportHref = (id: string): string => `/passport/${passportSlug(id)}/`;

let published: Promise<PassportIndexFile | null> | undefined;
/** passport.json once per build, null before its first publish; every page's header asks, so it is read and warned about once. */
export const publishedPassportIndex = (): Promise<PassportIndexFile | null> => (published ??= buildPassportDataIfPublished('passport.json'));

export function passportNavItems(index: PassportIndexFile | null): { href: string; label: string }[] {
  return index === null ? [] : [{ href: '/passport/', label: 'Passport' }];
}

export interface ResultChip {
  check: CheckKind;
  checkLabel: string;
  value: CheckValue | null;
  label: string;
  tone: string;
  href: string;
}

export function resultChip(check: CheckKind, value: CheckValue | null): ResultChip {
  return {
    check,
    checkLabel: CHECK_LABEL[check],
    value,
    label: value === null ? NO_RESULT : RESULT_LABEL[value],
    tone: value === null ? 'none' : TONE[value],
    href: methodologyHref(CHECK_ANCHOR[check]),
  };
}

const rank = (value: CheckValue | null) => (value === null ? 3 : RANK[value]);

function rollup(results: PassportToken['results']): ResultChip[] {
  return CHECKS.map((c) => resultChip(c, results[c])).sort((a, b) => rank(a.value) - rank(b.value));
}

function shortId(id: string): string {
  const split = id.indexOf(':');
  return split < 0 ? id.slice(0, 8) : shortAddress(id.slice(split + 1));
}

/** KTD2: a title is unique across the build; two tokens sharing a symbol and name each add a short id. */
export function passportTitles(tokens: readonly Pick<PassportToken, 'id' | 'name' | 'symbol'>[]): Map<string, string> {
  const base = (t: Pick<PassportToken, 'name' | 'symbol'>) => `${t.symbol ? `${t.name} (${t.symbol})` : t.name} · Token Passport`;
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(base(t), (counts.get(base(t)) ?? 0) + 1);
  return new Map(tokens.map((t) => [t.id, counts.get(base(t))! > 1 ? `${base(t)} · ${shortId(t.id)}` : base(t)]));
}

export function passportShardNames(index: PassportIndexFile | null): PassportShardName[] {
  return [...new Set((index?.tokens ?? []).map((t) => passportShard(t.id)))];
}

export interface PassportPath {
  params: { id: string };
  props: { token: PassportToken; title: string; day: string; since: string };
}

export function passportPaths(index: PassportIndexFile | null, shards: readonly PassportShardFile[]): PassportPath[] {
  if (index === null) return [];
  const titles = passportTitles(index.tokens);
  const detail = new Map(shards.flatMap((s) => s.tokens.map((t) => [t.id, t] as const)));
  return index.tokens.map((t) => {
    const token = detail.get(t.id);
    if (token === undefined) throw new Error(`passport.json lists token ${t.id} but ${passportShard(t.id)} has no detail for it`);
    return { params: { id: passportSlug(t.id) }, props: { token, title: titles.get(t.id)!, day: index.day, since: index.since } };
  });
}

export interface PassportIndexRow extends PassportFilterRow {
  id: string;
  href: string;
  name: string;
  symbol: string | null;
  chains: string[];
  results: ResultChip[];
}

export interface LatestView {
  day: string;
  date: string;
  text: string;
  links: { href: string; text: string }[];
}

export type PassportIndexView = { published: false } | { published: true; day: string; since: string; rows: PassportIndexRow[]; latest: LatestView[] };

function unitPlace(u: { check: CheckKind; chain: string; remote_chain: string | null }, names: ChainNames): string {
  const chain = chainName(names, u.chain);
  if (u.check === 'single-key' || u.remote_chain === null) return `on ${chain}`;
  return u.check === 'rate-limit' ? `${chain} to ${chainName(names, u.remote_chain)}` : `${chain} and ${chainName(names, u.remote_chain)}`;
}

function latestView(event: PassportEvent, names: ChainNames, pages: ReadonlyMap<string, string>): LatestView {
  const link = (id: string, text: string) => (pages.has(id) ? [{ href: pages.get(id)!, text }] : []);
  if (event.kind === 'summary') {
    const c = event.counts;
    const parts = [
      c.raised > 0 ? `${plural(c.raised, 'flag')} raised` : null,
      c.cleared > 0 ? `${plural(c.cleared, 'flag')} cleared` : null,
      c.new_token > 0 ? plural(c.new_token, 'new token') : null,
      c.new_chain > 0 ? plural(c.new_chain, 'new chain') : null,
    ].filter((p) => p !== null);
    return { day: event.day, date: formatUtcDay(event.day), text: `${plural(event.tokens.length, 'more token')}: ${parts.join(', ')}`, links: event.tokens.flatMap((t) => link(t.token_id, t.name ?? 'Unnamed token')) };
  }
  const parts = [
    ...event.changes.map((ch) => `${CHECK_LABEL[ch.check]} flag ${ch.correction ? `${ch.kind} by a correction` : ch.kind} ${unitPlace(ch, names)}`),
    ...event.arrivals.map((a) => `${a.kind} on ${a.chains.map((x) => chainName(names, x.chain)).join(', ')}`),
  ];
  return { day: event.day, date: formatUtcDay(event.day), text: `${event.name}: ${parts.join('; ')}`, links: link(event.token_id, event.name) };
}

export function passportIndexView(index: PassportIndexFile | null, names: ChainNames): PassportIndexView {
  if (index === null) return { published: false };
  const rows = index.tokens
    .map((t) => {
      const results = CHECKS.map((c) => resultChip(c, t.results[c]));
      return {
        id: t.id,
        href: passportHref(t.id),
        name: t.name,
        symbol: t.symbol,
        chains: t.chains,
        results,
        flagged: results.some((r) => r.value === 'flagged'),
        search: [t.symbol ?? '', t.name, ...t.addresses].join(' ').toLowerCase(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.symbol ?? '').localeCompare(b.symbol ?? '') || a.id.localeCompare(b.id));
  const pages = new Map(rows.map((r) => [r.id, r.href]));
  return { published: true, day: index.day, since: index.since, rows, latest: index.latest.map((e) => latestView(e, names, pages)) };
}

export interface StatementView {
  text: string;
  dates: string;
  how: string;
  source: { text: string; href: string | null };
}

function statementView(s: PassportStatementView): StatementView {
  const dates = `Said ${formatUtcDay(s.said_on)} · attached ${formatUtcDay(s.attached_on)}`;
  if (s.verified_via === 'x') return { text: s.text, dates, how: 'Verified through the project\'s X account', source: { text: `@${s.verified_source}`, href: xProfileUrl(s.verified_source) } };
  if (s.verified_via === 'website') return { text: s.text, dates, how: 'Verified through the project\'s website', source: { text: s.verified_source, href: s.verified_source.startsWith('https://') ? s.verified_source : null } };
  return { text: s.text, dates, how: 'Verified by a message signed by the address that controls the pool', source: { text: s.verified_source, href: null } };
}

export interface ResultView extends ResultChip {
  note: string;
  date: string;
  held: boolean;
  corrected: boolean;
  statements: StatementView[];
}

function resultView(check: CheckKind, r: Result, day: string): ResultView {
  const held = r.read_on !== null && r.read_on < day;
  const date = r.read_on === null ? 'No reading' : `Read ${formatUtcDay(r.read_on)}${held ? ', the last successful reading' : ''}`;
  return { ...resultChip(check, r.value), note: reasonNote(r.reason), date, held, corrected: r.corrected, statements: r.statements.map(statementView) };
}

export interface PartyView {
  role: string;
  kind: string;
  address: string | null;
  href: string | null;
  decides: boolean;
}

function partyKind(p: Party): string {
  switch (p.kind) {
    case 'wallet':
      return 'wallet, 1 key';
    case 'delegated-wallet':
      return 'wallet with delegated code (EIP-7702), 1 key';
    case 'safe':
      return p.keys === null ? `Safe, needs ${plural(p.signers ?? 0, 'key')}` : `Safe, ${p.signers} of ${p.keys} keys`;
    case 'mcms':
      return p.keys === null ? `MCMS, needs ${plural(p.signers ?? 0, 'signer')}` : `MCMS, ${p.signers} of ${p.keys} signers`;
    case 'timelock':
      return `timelock, weakest member needs ${plural(p.signers ?? 0, 'signer')}`;
    case 'absent':
      return 'none set';
    case 'no-key':
      return 'burn address, no key';
    case 'unidentified':
      return 'a contract ccip.dev cannot identify';
    case 'unanswered':
      return p.role === 'proxyAdmin' ? 'no answer on whether the pool can be upgraded' : 'no answer';
  }
}

export interface SingleKeyView extends ResultView {
  poolType: string | null;
  parties: PartyView[];
}

function singleKeyView(r: SingleKey, day: string): SingleKeyView {
  return {
    ...resultView('single-key', r, day),
    poolType: r.pool_type,
    parties: r.parties.map((p) => ({ role: ROLE_LABEL[p.role], kind: partyKind(p), address: p.address, href: p.address === null ? null : addressExplorerUrl(p.address), decides: r.decided_by.includes(p.role) })),
  };
}

/** "136000" as "136,000"; a fraction keeps two places, or six below one token. */
function formatTokens(tokens: string): string {
  const [whole = '0', fraction = ''] = tokens.split('.');
  const kept = (whole === '0' ? fraction.slice(0, 6) : fraction.slice(0, 2)).replace(/0+$/, '');
  return `${BigInt(whole).toLocaleString('en-US')}${kept === '' ? '' : `.${kept}`}`;
}

const amount = (units: string | null, tokens: string | null, symbol: string) => (tokens !== null ? `${formatTokens(tokens)} ${symbol}` : units !== null ? `${units} base units` : 'a set amount');

function perHour(figures: RateLimit['per_hour'], symbol: string): string[] {
  return figures.map((f) => {
    const figure = f.limit === 'off' ? 'No limit' : `${amount(f.units, f.tokens, symbol)}${f.usd === null ? '' : ` (${formatUsd(f.usd)})`}`;
    return f.finality === 'fast' ? `Fast transfers: ${figure}` : figure;
  });
}

const INBOUND_NOTE: Record<NonNullable<RateLimit['receiving_inbound']>, string> = {
  on: 'The receiving side also caps what arrives.',
  off: 'The receiving side sets no limit on what arrives.',
  'not readable': 'The receiving side\'s limit could not be read.',
};

type VerifierRef = { address: string; name: string | null };
const verifierNames = (refs: readonly VerifierRef[]) => (refs.length === 0 ? 'no verifier' : refs.map((v) => v.name ?? `custom verifier ${shortAddress(v.address)}`).join(', '));

/** KTD11: what the sending side requires, any verifiers added at or above an amount, then the pool's inbound list. */
function verifierLines(lines: RateLimit['verifiers'], symbol: string): string[] {
  return lines.map((line) => {
    const side = line.direction === 'outbound' ? 'Sending' : 'Receiving';
    if (line.state === 'ccip-1x') return 'CCIP 1.x lane (no verifier set)';
    if (line.state === 'not readable') return `${side} verifiers could not be read`;
    const extra = line.threshold === null ? '' : `; at or above ${amount(line.threshold.units, line.threshold.tokens, symbol)} also ${verifierNames(line.threshold.verifiers)}`;
    return `${side} requires ${verifierNames(line.verifiers)}${extra}`;
  });
}

export interface PointerView extends ResultView {
  other: string;
}

export interface LaneView {
  remoteChain: string | null;
  remoteName: string;
  flagged: boolean;
  rateLimit: ResultView | null;
  perHour: string[];
  inboundNote: string | null;
  pointers: PointerView[];
  verifiers: string[];
}

function laneView(lane: PassportLane, ctx: PageContext, symbol: string): LaneView {
  const rl = lane.rate_limit;
  const pointers = lane.pointers.map((p) => ({ ...resultView('pool-pointer', p, ctx.day), other: `with ${chainName(ctx.names, p.other.chain)}${p.other.address === null ? '' : ` ${shortAddress(p.other.address)}`}` }));
  const rateLimit = rl === null ? null : resultView('rate-limit', rl, ctx.day);
  return {
    remoteChain: lane.remote_chain,
    remoteName: lane.remote_chain === null ? 'Other chains' : chainName(ctx.names, lane.remote_chain),
    flagged: rateLimit?.value === 'flagged' || pointers.some((p) => p.value === 'flagged'),
    rateLimit,
    perHour: rl === null ? [] : perHour(rl.per_hour, symbol),
    inboundNote: rl?.receiving_inbound ? INBOUND_NOTE[rl.receiving_inbound] : null,
    pointers,
    verifiers: rl === null ? [] : verifierLines(rl.verifiers, symbol),
  };
}

const laneRank = (l: LaneView) => (l.flagged ? 0 : l.rateLimit?.value === 'not readable' || l.pointers.some((p) => p.value === 'not readable') ? 1 : 2);

export interface ChainSectionView {
  chain: string;
  chainName: string;
  address: string;
  addressHref: string;
  pool: string | null;
  poolHref: string | null;
  delisted: { label: string; since: string; lastRead: string } | null;
  unreadableNote: string | null;
  singleKey: SingleKeyView | null;
  lanes: LaneView[];
  folded: LaneView[];
  foldedLabel: string | null;
}

function chainSection(row: PassportChainRow, ctx: PageContext, symbol: string): ChainSectionView {
  const all = row.lanes.map((l) => laneView(l, ctx, symbol)).sort((a, b) => laneRank(a) - laneRank(b) || a.remoteName.localeCompare(b.remoteName));
  const fold = all.length > FOLD_LANES_OVER;
  const lanes = fold ? all.filter((l) => l.flagged) : all;
  const folded = fold ? all.filter((l) => !l.flagged) : [];
  return {
    chain: row.chain,
    chainName: chainName(ctx.names, row.chain),
    address: row.address,
    addressHref: addressExplorerUrl(row.address),
    pool: row.pool,
    poolHref: row.pool === null ? null : addressExplorerUrl(row.pool),
    delisted: row.delisted_on === null ? null : { label: 'No longer listed', since: formatUtcDay(row.delisted_on), lastRead: row.read_on === null ? 'Never read' : `Last read ${formatUtcDay(row.read_on)}` },
    unreadableNote: row.unreadable === null ? null : reasonNote(row.unreadable),
    singleKey: row.single_key === null ? null : singleKeyView(row.single_key, ctx.day),
    lanes,
    folded,
    foldedLabel: folded.length === 0 ? null : lanes.length === 0 ? `${plural(folded.length, 'lane')}, none flagged` : `${plural(folded.length, 'more lane')}`,
  };
}

export interface LogEntryView {
  day: string;
  date: string;
  kind: PassportLogEntry['kind'];
  label: string;
  text: string;
  statement: StatementView | null;
}

/** A result key, `<check>/<chain>:<token>[/<remote chain>[:<token>|:*]]`, in words. */
function unitText(unit: string, names: ChainNames): string {
  const [check, ...refs] = unit.split('/');
  const chainOf = (ref: string | undefined) => (ref === undefined || ref === '*' ? 'other chains' : chainName(names, ref.split(':')[0]!));
  const label = CHECK_LABEL[check as CheckKind] ?? check;
  if (check === 'single-key') return `${label} on ${chainOf(refs[0])}`;
  return `${label}, ${chainOf(refs[0])} ${check === 'rate-limit' ? 'to' : 'and'} ${chainOf(refs[1])}`;
}

function settingSubject(setting: string, chain: string, names: ChainNames): string {
  const [head, key, field] = setting.split('.');
  const on = chainName(names, chain);
  if (head === 'parties' && key !== undefined) return `${ROLE_LABEL[key as Party['role']] ?? key} on ${on}`;
  if (head === 'signers' && key !== undefined) return `Signers behind the ${(ROLE_LABEL[key as Party['role']] ?? key).toLowerCase()} on ${on}`;
  if (head === 'lanes' && key !== undefined) return `${field === undefined ? 'Lane' : (LANE_SETTING_LABEL[field] ?? field)}, ${on} to ${chainName(names, key)}`;
  return `${SETTING_LABEL[setting] ?? setting} on ${on}`;
}

const ADDRESS_LIKE = /^(0x[0-9a-fA-F]{40,}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

/** A stored setting value in a few words, or null when it has no short form and the entry just says it changed. */
function describeValue(value: unknown): string | null {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return ADDRESS_LIKE.test(value) ? shortAddress(value) : value.length <= 40 ? value : null;
  if (Array.isArray(value)) {
    const items = value.map(describeValue);
    return items.length === 0 ? 'none' : items.some((i) => i === null) ? null : items.join(', ');
  }
  if (typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.state === 'address' && typeof v.address === 'string') return shortAddress(v.address);
  if (v.state === 'absent' || v.state === 'missing') return 'none';
  if (v.state === 'unanswered') return 'no answer';
  if ('value' in v) return describeValue(v.value);
  if ('reason' in v) return 'not readable';
  if (typeof v.isEnabled === 'boolean') return v.isEnabled ? 'limit on' : 'limit off';
  if (typeof v.kind === 'string' && (typeof v.signers === 'number' || v.signers === null)) return v.signers === null ? v.kind : `${v.kind}, ${plural(v.signers as number, 'signer')}`;
  return null;
}

function logText(e: PassportLogEntry, names: ChainNames): string {
  const label = (v: CheckValue | null) => (v === null ? NO_RESULT : RESULT_LABEL[v]);
  switch (e.kind) {
    case 'first-reading':
      return `First reading on ${chainName(names, e.chain)}`;
    case 'setting':
    case 'pool-replaced': {
      const subject = settingSubject(e.setting, e.chain, names);
      const [from, to] = [describeValue(e.from), describeValue(e.to)];
      return from === null || to === null ? `${subject} changed` : `${subject}: ${from} to ${to}`;
    }
    case 're-classified':
      return `${unitText(e.unit, names)}: ${label(e.from)} to ${label(e.to)}, because ccip.dev changed how it reads this`;
    case 'correction':
      return `${unitText(e.unit, names)}: ${label(e.from)} to ${label(e.to)}, because the reading was wrong`;
    case 'statement':
      return `About ${unitText(e.unit, names)}, when it was ${label(e.statement.answers)}`;
  }
}

/** R16, R17, R32: the dated log in date order, each kind under its own label. */
export function passportLog(token: PassportToken, names: ChainNames): LogEntryView[] {
  return [...token.log]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((e) => ({ day: e.day, date: formatUtcDay(e.day), kind: e.kind, label: LOG_LABEL[e.kind], text: logText(e, names), statement: e.kind === 'statement' ? statementView(e.statement) : null }));
}

export interface PassportContact {
  issueUrl: string;
  issueForm: string;
  xHandle: string;
  xUrl: string;
}

/** R26 and KTD21: the "Passport result" issue form, with the page filled in, and ccip.dev's X account for direct messages. */
export function passportContact(pageUrl: string): PassportContact {
  return { issueUrl: `${REPO_URL}/issues/new?template=passport.yml&token=${encodeURIComponent(pageUrl)}`, issueForm: 'Passport result', xHandle: `@${X_HANDLE}`, xUrl: X_URL };
}

interface PageContext {
  names: ChainNames;
  /** The evaluated day of the published files. */
  day: string;
  pageUrl: string;
}

export interface PassportPageView {
  name: string;
  symbol: string | null;
  project: string | null;
  chains: { selector: string; name: string }[];
  rollup: ResultChip[];
  sections: ChainSectionView[];
  log: LogEntryView[];
  contact: PassportContact;
}

export function passportPage(token: PassportToken, ctx: PageContext): PassportPageView {
  const symbol = token.symbol ?? 'tokens';
  return {
    name: token.name,
    symbol: token.symbol,
    project: token.project,
    chains: token.chains.map((selector) => ({ selector, name: chainName(ctx.names, selector) })),
    rollup: rollup(token.results),
    sections: token.rows.map((r) => chainSection(r, ctx, symbol)),
    log: passportLog(token, ctx.names),
    contact: passportContact(ctx.pageUrl),
  };
}
