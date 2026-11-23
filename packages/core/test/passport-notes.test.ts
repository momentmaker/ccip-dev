import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateChecks, type PassportRow } from '../src/passport-checks';
import { passportCorrections, passportNoteKey, STATEMENT_MAX_LENGTH, validatePassportNotes, type NoteTarget } from '../src/passport-notes';

const chains = new Set(['ethereum-mainnet', 'ethereum-mainnet-base-1', 'solana-mainnet']);
const FILE = 'labels/passport.toml';
const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const SELECTORS = new Map([['ethereum-mainnet', ETH], ['ethereum-mainnet-base-1', BASE]]);
const TOKEN = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
const BASE_TOKEN = '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196';

const statement = (fields: Record<string, string> = {}, drop: string[] = []) => {
  const entry: Record<string, string> = {
    chain: 'ethereum-mainnet',
    token: TOKEN,
    check: 'single-key',
    answers: 'flagged',
    text: 'The deployer key moves to a 3-of-5 Safe next week.',
    said_on: '2026-11-20',
    attached_on: '2026-11-21',
    verified_via: 'x',
    verified_source: 'chainlink',
    ...fields,
  };
  for (const key of drop) delete entry[key];
  return `[[statements]]\n${Object.entries(entry).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')}\n`;
};

const correction = (fields: Record<string, string> = {}, drop: string[] = []) => {
  const entry: Record<string, string> = {
    chain: 'ethereum-mainnet',
    token: TOKEN,
    check: 'single-key',
    basis: '0123456789abcdef',
    value: 'clear',
    reason: 'multi-signer',
    corrected_on: '2026-11-22',
    ...fields,
  };
  for (const key of drop) delete entry[key];
  return `[[corrections]]\n${Object.entries(entry).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')}\n`;
};

const errorsOf = (text: string) => validatePassportNotes(text, chains).errors;

describe('validatePassportNotes', () => {
  it('accepts the committed file', () => {
    // #given
    const text = readFileSync(path.resolve(import.meta.dirname, '../../../labels/passport.toml'), 'utf8');
    // #when
    const { errors } = validatePassportNotes(text, new Set(JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../labels/ccip-chains.json'), 'utf8'))));
    // #then
    expect(errors).toEqual([]);
  });

  it('accepts a statement and a correction with their fields as written', () => {
    // #when
    const result = validatePassportNotes(statement() + correction(), chains);
    // #then
    expect(result).toEqual({
      errors: [],
      notes: {
        statements: [{
          chain: 'ethereum-mainnet', token: TOKEN.toLowerCase(), check: 'single-key', remoteChain: null, remoteToken: null, answers: 'flagged',
          text: 'The deployer key moves to a 3-of-5 Safe next week.', saidOn: '2026-11-20', attachedOn: '2026-11-21', verifiedVia: 'x', verifiedSource: 'chainlink',
        }],
        corrections: [{
          chain: 'ethereum-mainnet', token: TOKEN.toLowerCase(), check: 'single-key', remoteChain: null, remoteToken: null, basis: '0123456789abcdef', value: 'clear', reason: 'multi-signer', correctedOn: '2026-11-22',
        }],
      },
    });
  });

  it('rejects a statement without a verification source, naming the entry', () => {
    // #when
    const errors = errorsOf(statement({}, ['verified_via', 'verified_source']));
    // #then
    expect(errors).toEqual([
      `${FILE}: statements[0] (ethereum-mainnet ${TOKEN.toLowerCase()} single-key): verified_via: Invalid option: expected one of "x"|"website"|"signature"`,
      `${FILE}: statements[0] (ethereum-mainnet ${TOKEN.toLowerCase()} single-key): verified_source: Invalid input: expected string, received undefined`,
    ]);
  });

  it.each([
    ['x', 'not a handle!'],
    ['website', 'http://example.com'],
    ['signature', 'someone'],
  ])('rejects a %s source that is not one', (via, source) => {
    // #when
    const errors = errorsOf(statement({ verified_via: via, verified_source: source }));
    // #then
    expect(errors).toHaveLength(1);
  });

  it.each([
    ['a statement', statement({ chain: 'not-a-chain' })],
    ['a correction', correction({ chain: 'not-a-chain' })],
    ['a lane', correction({ check: 'rate-limit', remote_chain: 'not-a-chain' })],
  ])('rejects %s naming an unknown chain', (_, text) => {
    // #when
    const errors = errorsOf(text);
    // #then
    expect(errors).toEqual([expect.stringMatching(/: unknown CCIP chain "not-a-chain"$/)]);
  });

  it('rejects a correction without a basis, naming the entry', () => {
    // #when
    const errors = errorsOf(correction({}, ['basis']));
    // #then
    expect(errors).toEqual([`${FILE}: corrections[0] (ethereum-mainnet ${TOKEN.toLowerCase()} single-key): basis: Invalid input: expected string, received undefined`]);
  });

  it('rejects a basis that is not the 16 hex digits a result carries', () => {
    // #when
    const errors = errorsOf(correction({ basis: 'abc' }));
    // #then
    expect(errors).toHaveLength(1);
  });

  it('rejects statement text over the cap', () => {
    // #when
    const errors = errorsOf(statement({ text: 'a'.repeat(STATEMENT_MAX_LENGTH + 1) }));
    // #then
    expect(errors).toEqual([`${FILE}: statements[0] (ethereum-mainnet ${TOKEN.toLowerCase()} single-key): text is longer than ${STATEMENT_MAX_LENGTH} characters`]);
  });

  it('strips control characters from statement text before measuring it', () => {
    // #when
    const result = validatePassportNotes(statement({ text: `${'a'.repeat(STATEMENT_MAX_LENGTH)}‮\u0007` }), chains);
    // #then
    expect({ errors: result.errors, text: result.notes.statements[0]?.text }).toEqual({ errors: [], text: 'a'.repeat(STATEMENT_MAX_LENGTH) });
  });

  it.each([
    ['a single-key check with a remote chain', correction({ remote_chain: 'ethereum-mainnet-base-1' })],
    ['a rate-limit check without a remote chain', correction({ check: 'rate-limit' })],
    ['a rate-limit check with a remote token', correction({ check: 'rate-limit', remote_chain: 'ethereum-mainnet-base-1', remote_token: BASE_TOKEN })],
    ['a pool-pointer check without a remote chain', correction({ check: 'pool-pointer' })],
  ])('rejects %s', (_, text) => {
    // #when
    const errors = errorsOf(text);
    // #then
    expect(errors).toHaveLength(1);
  });

  it('rejects a date that is not a calendar day', () => {
    // #when
    const errors = errorsOf(statement({ said_on: '2026-02-30' }));
    // #then
    expect(errors).toHaveLength(1);
  });

  it('reports invalid TOML with the file name', () => {
    // #when
    const errors = errorsOf('[[statements]\n');
    // #then
    expect(errors[0]).toMatch(/^labels\/passport\.toml: invalid TOML/);
  });

  it('gives the validated entries in a fixed order whatever their order in the file', () => {
    // #given
    const entries = [
      statement({ chain: 'ethereum-mainnet-base-1', token: BASE_TOKEN }),
      statement({ attached_on: '2026-11-23' }),
      statement(),
      correction({ check: 'rate-limit', remote_chain: 'ethereum-mainnet-base-1' }),
      correction(),
    ];
    // #when
    const forward = validatePassportNotes(entries.join(''), chains).notes;
    const backward = validatePassportNotes([...entries].reverse().join(''), chains).notes;
    // #then
    expect({ same: backward, statements: forward.statements.map((s) => [s.chain, s.attachedOn]), corrections: forward.corrections.map((c) => c.check) }).toEqual({
      same: forward,
      statements: [['ethereum-mainnet', '2026-11-21'], ['ethereum-mainnet', '2026-11-23'], ['ethereum-mainnet-base-1', '2026-11-21']],
      corrections: ['rate-limit', 'single-key'],
    });
  });
});

const designRow = (chain: string, token: string): PassportRow => ({ chain, token, symbol: 'LINK', name: 'Chainlink', decimals: 18, priceUsd: null, unreadableByDesign: 'no-endpoint', reading: null });

describe('passportNoteKey', () => {
  const results = evaluateChecks({
    rows: [designRow(BASE, BASE_TOKEN), designRow(ETH, TOKEN.toLowerCase())],
    corrections: [],
    previous: [],
    verifierNames: {},
    today: '2026-11-22',
  });
  const target = (check: NoteTarget['check'], remote: Partial<NoteTarget> = {}): NoteTarget => ({ chain: 'ethereum-mainnet', token: TOKEN.toLowerCase(), check, remoteChain: null, remoteToken: null, ...remote });

  it.each([
    ['single-key', target('single-key'), `single-key/${ETH}:${TOKEN.toLowerCase()}`],
    ['rate-limit', target('rate-limit', { remoteChain: 'ethereum-mainnet-base-1' }), `rate-limit/${ETH}:${TOKEN.toLowerCase()}/${BASE}`],
    ['pool-pointer named from either row', target('pool-pointer', { remoteChain: 'ethereum-mainnet-base-1', remoteToken: BASE_TOKEN }), `pool-pointer/${ETH}:${TOKEN.toLowerCase()}/${BASE}:${BASE_TOKEN}`],
  ])('names the %s result evaluateChecks gives', (_, note, key) => {
    // #when
    const built = passportNoteKey(note, SELECTORS);
    // #then
    expect({ built, evaluated: results.some((r) => r.key === key) }).toEqual({ built: key, evaluated: true });
  });

  it('names the pool-pointer result of a lane to a chain where the group has no row', () => {
    // #when
    const built = passportNoteKey(target('pool-pointer', { remoteChain: 'ethereum-mainnet-base-1' }), SELECTORS);
    // #then
    expect(built).toBe(`pool-pointer/${ETH}:${TOKEN.toLowerCase()}/${BASE}:*`);
  });

  it('gives null for a chain with no selector', () => {
    // #when
    const built = passportNoteKey({ ...target('single-key'), chain: 'solana-mainnet' }, SELECTORS);
    // #then
    expect(built).toBeNull();
  });
});

describe('passportCorrections', () => {
  it('turns a correction into one evaluateChecks applies while its basis matches', () => {
    // #given
    const rows = [designRow(ETH, TOKEN.toLowerCase())];
    const raw = evaluateChecks({ rows, corrections: [], previous: [], verifierNames: {}, today: '2026-11-22' }).find((r) => r.check === 'single-key')!;
    const { notes } = validatePassportNotes(correction({ basis: raw.basis, value: 'clear' }), chains);
    // #when
    const corrected = evaluateChecks({ rows, corrections: passportCorrections(notes, SELECTORS), previous: [], verifierNames: {}, today: '2026-11-22' }).find((r) => r.check === 'single-key')!;
    // #then
    expect({ value: corrected.value, reason: corrected.reason, corrected: corrected.corrected }).toEqual({ value: 'clear', reason: 'multi-signer', corrected: true });
  });
});
