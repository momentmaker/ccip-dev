import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { parse } from 'smol-toml';
import { z } from 'zod';
import { isAddressShape } from './chain-map';
import { normalizeAddress, sanitize } from './normalize';
import { CHECK_KINDS, REASON_CODES, type CheckKind, type CheckValue, type Correction, type ReasonCode } from './passport-checks';

/** A team's statement longer than this, after control characters are stripped, fails validation. */
export const STATEMENT_MAX_LENGTH = 500;
export const VERIFIED_VIA = ['x', 'website', 'signature'] as const;
export type VerifiedVia = (typeof VERIFIED_VIA)[number];

const CHECK_VALUES = ['flagged', 'clear', 'not readable'] as const satisfies readonly CheckValue[];
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date written YYYY-MM-DD').refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'must be a calendar day');
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const HTTPS_URL = /^https:\/\/\S+$/;
const APTOS_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

const Target = {
  chain: z.string(),
  token: z.string().min(1),
  check: z.enum(CHECK_KINDS),
  remote_chain: z.string().optional(),
  remote_token: z.string().min(1).optional(),
};

const StatementEntry = z.strictObject({
  ...Target,
  answers: z.enum(CHECK_VALUES),
  text: z.string().min(1),
  said_on: DAY,
  attached_on: DAY,
  verified_via: z.enum(VERIFIED_VIA),
  verified_source: z.string(),
});

const CorrectionEntry = z.strictObject({
  ...Target,
  basis: z.string().regex(/^[0-9a-f]{16}$/, 'must be the 16 hex digits of the published result\'s basis'),
  value: z.enum(CHECK_VALUES),
  reason: z.enum(REASON_CODES),
  corrected_on: DAY,
});

const NotesFile = z.strictObject({
  statements: z.array(z.unknown()).default([]),
  corrections: z.array(z.unknown()).default([]),
});

/** The result a note is about: a row, its check, and for a per-lane check the lane's remote chain (and, for a pair, the remote row). */
export interface NoteTarget {
  /** CCIP chain name, as in labels/ccip-chains.json. */
  chain: string;
  token: string;
  check: CheckKind;
  remoteChain: string | null;
  /** The pool-pointer pair's other row; null when the group has no row on the remote chain. */
  remoteToken: string | null;
}

/** R27 and R38: a team's own words beside a result; it never changes the result (R28). */
export interface PassportStatement extends NoteTarget {
  answers: CheckValue;
  text: string;
  saidOn: string;
  attachedOn: string;
  verifiedVia: VerifiedVia;
  /** The X handle, the https URL, or the signing address. */
  verifiedSource: string;
}

/** KTD15: applies only while the result's basis still matches. */
export interface PassportCorrection extends NoteTarget {
  basis: string;
  value: CheckValue;
  reason: ReasonCode;
  correctedOn: string;
}

export interface PassportNotes {
  statements: PassportStatement[];
  corrections: PassportCorrection[];
}

export const NO_PASSPORT_NOTES: PassportNotes = { statements: [], corrections: [] };

type Entry = z.output<typeof StatementEntry> | z.output<typeof CorrectionEntry>;

function targetErrors(entry: Entry, chainNames: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  for (const chain of [entry.chain, entry.remote_chain]) if (chain !== undefined && !chainNames.has(chain)) errors.push(`unknown CCIP chain "${chain}"`);
  if (entry.check === 'single-key' && (entry.remote_chain !== undefined || entry.remote_token !== undefined)) errors.push('a single-key check names no remote chain or remote token');
  if (entry.check !== 'single-key' && entry.remote_chain === undefined) errors.push(`a ${entry.check} check names its lane's remote_chain`);
  if (entry.check === 'rate-limit' && entry.remote_token !== undefined) errors.push('a rate-limit check names no remote_token');
  return errors;
}

function sourceError(via: VerifiedVia, source: string): string | null {
  if (via === 'x') return X_HANDLE.test(source) ? null : 'verified_source must be an X handle without the @';
  if (via === 'website') return HTTPS_URL.test(source) ? null : 'verified_source must be an https URL';
  const address = isAddressShape('EVM', source) || isAddressShape('SVM', source) || APTOS_ADDRESS.test(source);
  return address ? null : 'verified_source must be the signing address';
}

const target = (entry: Entry): NoteTarget => ({
  chain: entry.chain,
  token: normalizeAddress(entry.token),
  check: entry.check,
  remoteChain: entry.remote_chain ?? null,
  remoteToken: entry.remote_token === undefined ? null : normalizeAddress(entry.remote_token),
});

const compare = (a: readonly string[], b: readonly string[]) => {
  for (const [i, x] of a.entries()) {
    const y = b[i]!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};
const targetOrder = (n: NoteTarget) => [n.chain, n.token, n.check, n.remoteChain ?? '', n.remoteToken ?? ''];

/** Validates labels/passport.toml (KTD21). Every error names the file and the entry; the notes come out in a fixed order. */
export function validatePassportNotes(text: string, chainNames: ReadonlySet<string>, file = 'labels/passport.toml'): { notes: PassportNotes; errors: string[] } {
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    return { notes: { statements: [], corrections: [] }, errors: [`${file}: invalid TOML: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const root = NotesFile.safeParse(data);
  if (!root.success) return { notes: { statements: [], corrections: [] }, errors: root.error.issues.map((i) => `${file}: ${i.path.map(String).join('.') || '(root)'}: ${i.message}`) };

  const errors: string[] = [];
  const check = <T extends Entry>(schema: z.ZodType<T>, kind: string, raw: unknown, i: number): { entry: T; fail: (message: string) => void } | null => {
    const shown = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const named = [shown.chain, typeof shown.token === 'string' ? normalizeAddress(shown.token) : shown.token, shown.check, shown.remote_chain].filter((v) => typeof v === 'string').join(' ');
    const fail = (message: string) => errors.push(`${file}: ${kind}[${i}] (${named}): ${message}`);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) fail(`${issue.path.map(String).join('.') || '(entry)'}: ${issue.message}`);
      return null;
    }
    for (const e of targetErrors(parsed.data, chainNames)) fail(e);
    return { entry: parsed.data, fail };
  };

  const statements = root.data.statements.flatMap((raw, i): PassportStatement[] => {
    const checked = check(StatementEntry, 'statements', raw, i);
    if (checked === null) return [];
    const { entry, fail } = checked;
    const words = sanitize(entry.text, Number.MAX_SAFE_INTEGER).trim();
    if ([...words].length > STATEMENT_MAX_LENGTH) fail(`text is longer than ${STATEMENT_MAX_LENGTH} characters`);
    const source = sourceError(entry.verified_via, entry.verified_source);
    if (source !== null) fail(source);
    return [{ ...target(entry), answers: entry.answers, text: words, saidOn: entry.said_on, attachedOn: entry.attached_on, verifiedVia: entry.verified_via, verifiedSource: entry.verified_source }];
  });
  const corrections = root.data.corrections.flatMap((raw, i): PassportCorrection[] => {
    const checked = check(CorrectionEntry, 'corrections', raw, i);
    if (checked === null) return [];
    const { entry } = checked;
    return [{ ...target(entry), basis: entry.basis, value: entry.value, reason: entry.reason, correctedOn: entry.corrected_on }];
  });

  statements.sort((a, b) => compare([...targetOrder(a), a.attachedOn, a.saidOn, a.text], [...targetOrder(b), b.attachedOn, b.saidOn, b.text]));
  corrections.sort((a, b) => compare([...targetOrder(a), a.correctedOn, a.basis], [...targetOrder(b), b.correctedOn, b.basis]));
  return { notes: { statements, corrections }, errors };
}

const bySelectorThenToken = (a: readonly [string, string], b: readonly [string, string]) => {
  const [x, y] = [BigInt(a[0]), BigInt(b[0])];
  if (x !== y) return x < y ? -1 : 1;
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
};

/**
 * The key evaluateChecks gives the note's result, with chain names mapped to selectors by `selectors`; null when a chain
 * has no selector there. A pool-pointer pair is keyed in selector order, so either row may name it.
 */
export function passportNoteKey(note: NoteTarget, selectors: ReadonlyMap<string, string>): string | null {
  const chain = selectors.get(note.chain);
  const remote = note.remoteChain === null ? null : selectors.get(note.remoteChain);
  if (chain === undefined || remote === undefined) return null;
  const row = `${chain}:${note.token}`;
  if (note.check === 'single-key') return `single-key/${row}`;
  if (remote === null) return null;
  if (note.check === 'rate-limit') return `rate-limit/${row}/${remote}`;
  if (note.remoteToken === null) return `pool-pointer/${row}/${remote}:*`;
  const pair = ([[chain, note.token], [remote, note.remoteToken]] as const).slice().sort(bySelectorThenToken);
  return `pool-pointer/${pair.map(([c, t]) => `${c}:${t}`).join('/')}`;
}

/** The corrections evaluateChecks takes; one whose chains have no selector is left out. */
export function passportCorrections(notes: PassportNotes, selectors: ReadonlyMap<string, string>): Correction[] {
  return notes.corrections.flatMap((c) => {
    const key = passportNoteKey(c, selectors);
    return key === null ? [] : [{ key, basis: c.basis, value: c.value, reason: c.reason }];
  });
}

/** A hash of the notes, so the job can tell when the bundled notes differ from those it last evaluated with. */
export function passportNotesHash(notes: PassportNotes): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(notes))));
}
