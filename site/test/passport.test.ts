import { PassportIndexFileSchema, PassportShardFileSchema, PassportSingleKeySchema, type PassportChainRow, type PassportIndexFile, type PassportLane, type PassportToken } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { filterPassportRows } from '../src/lib/passport-filter';
import {
  passportContact, passportIndexView, passportLog, passportNavItems, passportPage, passportPaths, passportShardNames, passportTitles, reasonNote, resultChip,
} from '../src/lib/passport';
import indexJson from './fixtures/passport/passport.json';
import shard0Json from './fixtures/passport/passport-0.json';
import shard3Json from './fixtures/passport/passport-3.json';

const INDEX = PassportIndexFileSchema.parse(indexJson);
const SHARD_0 = PassportShardFileSchema.parse(shard0Json);
const SHARD_3 = PassportShardFileSchema.parse(shard3Json);
const SOLANA = '124615329519749607';
const ETHEREUM = '5009297550715157269';
const BASE = '15971525489660198786';
const ARBITRUM = '4949039107694359620';
const NAMES = new Map([
  [SOLANA, 'Solana'],
  [ETHEREUM, 'Ethereum'],
  [BASE, 'Base'],
  [ARBITRUM, 'Arbitrum'],
  ['4426351306075016396', '0G'],
  ['8481857512324358265', 'Ronin'],
  ['11344663589394136015', 'BNB Chain'],
]);
const BMT = SHARD_0.tokens.find((t) => t.id === '0e5901c9-23ca-5cde-b023-63d82251fe7f')!;
const CLEAR = SHARD_3.tokens[0]!;
const PAGE_URL = 'https://ccip.dev/passport/0e5901c9-23ca-5cde-b023-63d82251fe7f/';
const page = (token: PassportToken, day = '2026-11-26') => passportPage(token, { names: NAMES, day, pageUrl: PAGE_URL });
const rowOn = (token: PassportToken, chain: string) => token.rows.find((r) => r.chain === chain)!;
const withRow = (token: PassportToken, chain: string, patch: Partial<PassportChainRow>): PassportToken => ({ ...token, rows: token.rows.map((r) => (r.chain === chain ? { ...r, ...patch } : r)) });
let nextId = 0;
const indexToken = (name: string, results: PassportIndexFile['tokens'][number]['results'], extra: Partial<PassportIndexFile['tokens'][number]> = {}) => ({
  id: `${String(++nextId).padStart(8, '0')}-0000-5000-8000-000000000000`,
  name,
  symbol: name.slice(0, 3).toUpperCase(),
  project: null,
  chains: [ETHEREUM],
  results,
  addresses: [`0x${name.toLowerCase().padEnd(40, '0').slice(0, 40)}`],
  ...extra,
});
const CLEAR_ALL = { 'single-key': 'clear', 'rate-limit': 'clear', 'pool-pointer': 'clear' } as const;

describe('passport static paths', () => {
  it('yields one static path per token in the index, each with its own detail', () => {
    // #when
    const paths = passportPaths(INDEX, [SHARD_0, SHARD_3]);
    // #then
    expect(paths.map((p) => [p.params.id, p.props.token.name])).toEqual([
      ['0e5901c9-23ca-5cde-b023-63d82251fe7f', 'BMT Token'],
      ['0f000000-0000-5000-8000-000000000002', 'BMT Token'],
      ['3a000000-0000-5000-8000-000000000003', 'Clear Coin'],
    ]);
  });

  it('loads only the shards that hold the index tokens', () => {
    // #then
    expect(passportShardNames(INDEX)).toEqual(['passport/0.json', 'passport/3.json']);
  });

  it('fails the build when an index token has no detail in its shard', () => {
    // #then
    expect(() => passportPaths(INDEX, [SHARD_0])).toThrow(/3a000000-0000-5000-8000-000000000003/);
  });

  it('builds no pages before passport.json is published', () => {
    // #then
    expect(passportPaths(null, [])).toEqual([]);
  });
});

describe('passport titles', () => {
  it('gives two tokens that share a symbol and name different titles, and every other title no id suffix', () => {
    // #when
    const titles = passportTitles(INDEX.tokens);
    // #then
    expect([...titles.values()]).toEqual(['BMT Token (BMT) · Token Passport · 0e5901c9', 'BMT Token (BMT) · Token Passport · 0f000000', 'Clear Coin (CLR) · Token Passport']);
  });

  it('suffixes a row with no group by its short address', () => {
    // #given
    const row = { id: `${ETHEREUM}:0x00000000000000000000000000000000000000c1`, name: 'Clear Coin', symbol: 'CLR' };
    // #when
    const titles = passportTitles([CLEAR, row]);
    // #then
    expect(titles.get(row.id)).toBe('Clear Coin (CLR) · Token Passport · 0x0000…00c1');
  });
});

describe('passport index', () => {
  const index = (tokens: PassportIndexFile['tokens']): PassportIndexFile => ({ ...INDEX, tokens });

  it('lists tokens in name order whatever flags each carries', () => {
    // #given
    const tokens = [
      indexToken('Zed', { 'single-key': 'flagged', 'rate-limit': 'flagged', 'pool-pointer': 'flagged' }),
      indexToken('Alpha', CLEAR_ALL),
      indexToken('Mid', { ...CLEAR_ALL, 'rate-limit': 'flagged' }),
    ];
    // #when
    const view = passportIndexView(index(tokens), NAMES);
    // #then
    expect(view.published && view.rows.map((r) => r.name)).toEqual(['Alpha', 'Mid', 'Zed']);
  });

  it('keeps a token with one flagged result under the flag filter and drops clear and not readable ones', () => {
    // #given
    const tokens = [indexToken('Flagged', { ...CLEAR_ALL, 'pool-pointer': 'flagged' }), indexToken('Clear', CLEAR_ALL), indexToken('Unread', { 'single-key': 'not readable', 'rate-limit': 'not readable', 'pool-pointer': null })];
    const view = passportIndexView(index(tokens), NAMES);
    // #when
    const kept = view.published ? filterPassportRows(view.rows, { query: '', flaggedOnly: true }) : [];
    // #then
    expect(kept.map((r) => r.name)).toEqual(['Flagged']);
  });

  it.each([
    ['a symbol', 'clr', ['Clear Coin']],
    ['a name', 'bmt tok', ['BMT Token', 'BMT Token']],
    ['an address', '0x4C1DAB3B', ['BMT Token']],
    ['a Solana address', 'Unrelated111', ['BMT Token']],
  ])('matches the text filter on %s', (_what, query, names) => {
    // #given
    const view = passportIndexView(INDEX, NAMES);
    // #when
    const kept = view.published ? filterPassportRows(view.rows, { query, flaggedOnly: false }) : [];
    // #then
    expect(kept.map((r) => r.name)).toEqual(names);
  });

  it('combines the text filter with the flag filter', () => {
    // #given
    const view = passportIndexView(INDEX, NAMES);
    // #when
    const kept = view.published ? filterPassportRows(view.rows, { query: 'bmt', flaggedOnly: true }) : [];
    // #then
    expect(kept.map((r) => r.id)).toEqual(['0e5901c9-23ca-5cde-b023-63d82251fe7f']);
  });

  it('matches nothing for an input no token has', () => {
    // #given
    const view = passportIndexView(INDEX, NAMES);
    // #then
    expect(view.published ? filterPassportRows(view.rows, { query: 'nothing-like-this', flaggedOnly: false }) : null).toEqual([]);
  });

  it('describes the latest post records and links only tokens that have a page', () => {
    // #when
    const view = passportIndexView(INDEX, NAMES);
    // #then
    expect(view.published && view.latest.map((l) => [l.day, l.text, l.links.map((x) => x.href)])).toEqual([
      ['2026-11-26', 'BMT Token (BMT): Single key flag raised on Ethereum', ['/passport/0e5901c9-23ca-5cde-b023-63d82251fe7f/']],
      ['2026-11-25', 'BMT Token (BMT): new token on Solana', ['/passport/0f000000-0000-5000-8000-000000000002/']],
      ['2026-11-20', '2 more tokens: 1 flag raised, 1 new token', ['/passport/3a000000-0000-5000-8000-000000000003/']],
    ]);
  });

  it('shows the not-yet-published line and no Passport menu entry before passport.json is published', () => {
    // #then
    expect({ view: passportIndexView(null, NAMES), nav: passportNavItems(null) }).toEqual({ view: { published: false }, nav: [] });
  });

  it('adds the Passport menu entry once passport.json is published', () => {
    // #then
    expect(passportNavItems(INDEX)).toEqual([{ href: '/passport/', label: 'Passport' }]);
  });
});

describe('passport results', () => {
  it('renders flagged, clear and not readable as three different text labels', () => {
    // #when
    const labels = (['flagged', 'clear', 'not readable'] as const).map((v) => resultChip('single-key', v).label);
    // #then
    expect(labels).toEqual(['Flagged', 'Clear', 'Not readable']);
  });

  it('maps every reason code the fixtures carry, and every code the schema allows, to a plain note', () => {
    // #given
    const fromFixtures = JSON.stringify([shard0Json, shard3Json]).match(/"reason":"[^"]+"/g)!.map((m) => m.slice(10, -1));
    const codes = [...new Set([...fromFixtures, ...PassportSingleKeySchema.shape.reason.options])];
    // #then
    expect(codes.filter((c) => !/^\S.{20,}\.$/.test(reasonNote(c)))).toEqual([]);
  });

  it('fails on a reason code it has no note for', () => {
    // #then
    expect(() => reasonNote('made-up-code')).toThrow(/made-up-code/);
  });

  it('links every check note to its methodology anchor', () => {
    // #when
    const view = page(BMT);
    const hrefs = view.sections.flatMap((s) => [s.singleKey, ...s.lanes.flatMap((l) => [l.rateLimit, ...l.pointers])]).filter((r) => r !== null).map((r) => [r.check, r.href]);
    // #then
    expect(new Set(hrefs.map(([check, href]) => `${check} ${href}`))).toEqual(
      new Set(['single-key /methodology/#single-key-check', 'rate-limit /methodology/#rate-limit-check', 'pool-pointer /methodology/#pool-pointer-check']),
    );
  });
});

describe('a token page', () => {
  it('opens with the name, the chains and the three rolled-up results, flagged first', () => {
    // #when
    const view = page(BMT);
    // #then
    expect({ name: view.name, chains: view.chains.map((c) => c.name), rollup: view.rollup.map((r) => `${r.checkLabel}: ${r.label}`) }).toEqual({
      name: 'BMT Token',
      chains: ['Solana', 'Ethereum', 'Base'],
      rollup: ['Single key: Flagged', 'Rate limit: Flagged', 'Pool pointers: Not readable'],
    });
  });

  it('covers AE1: shows Ethereum results and a plainly explained "not readable" for every Solana check', () => {
    // #when
    const sections = page(BMT).sections;
    const solana = sections.find((s) => s.chain === SOLANA)!;
    const solanaResults = [solana.singleKey!, ...[...solana.lanes, ...solana.folded].flatMap((l) => [l.rateLimit!, ...l.pointers])];
    const ethereum = sections.find((s) => s.chain === ETHEREUM)!;
    // #then
    expect({
      ethereum: ethereum.singleKey!.label,
      solana: [...new Set(solanaResults.map((r) => `${r.label}: ${r.note}`))],
    }).toEqual({ ethereum: 'Flagged', solana: [`Not readable: ${reasonNote('non-evm-chain')}`] });
  });

  it('names each party with its role, kind and signers, and marks the ones that decided the result', () => {
    // #when
    const parties = [ETHEREUM, ARBITRUM].flatMap((chain) => page(CLEAR).sections.find((s) => s.chain === chain)!.singleKey!.parties.map((p) => `${p.role}: ${p.kind}`));
    const bmtOwner = page(BMT).sections.find((s) => s.chain === ETHEREUM)!.singleKey!.parties[0]!;
    // #then
    expect({ parties, bmtOwner: [bmtOwner.kind, bmtOwner.decides] }).toEqual({
      parties: [
        'Pool owner: Safe, 2 of 3 keys',
        'Token admin in the registry: timelock, weakest member needs 4 signers',
        'Rate-limit admin: none set',
        'Proxy admin: none set',
        'Pool owner: MCMS, 3 of 5 signers',
        'Token admin in the registry: MCMS, 3 of 5 signers',
        'Rate-limit admin: burn address, no key',
        'Proxy admin: none set',
      ],
      bmtOwner: ['wallet, 1 key', true],
    });
  });

  it('covers AE5: reads "No limit" for a lane whose limit is off, and token units only without a price', () => {
    // #given
    const ethereum = rowOn(BMT, ETHEREUM);
    const unpriced = withRow(BMT, ETHEREUM, {
      lanes: ethereum.lanes.map((l): PassportLane => (l.remote_chain === ARBITRUM ? { ...l, rate_limit: { ...l.rate_limit!, per_hour: [{ finality: 'standard', limit: 'on', units: '136000000000000000000000', tokens: '136000', usd: null }] } } : l)),
    });
    const lanes = (token: PassportToken) => {
      const s = page(token).sections.find((x) => x.chain === ETHEREUM)!;
      return [...s.lanes, ...s.folded];
    };
    // #when
    const off = lanes(BMT).find((l) => l.remoteChain === SOLANA)!.perHour;
    const priced = lanes(BMT).find((l) => l.remoteChain === ARBITRUM)!.perHour;
    const plain = lanes(unpriced).find((l) => l.remoteChain === ARBITRUM)!.perHour;
    // #then
    expect({ off, priced, plain }).toEqual({ off: ['No limit'], priced: ['136,000 BMT ($340.0K)'], plain: ['136,000 BMT'] });
  });

  it('covers AE14: takes the figure from the sending side and notes a receiving side that sets no limit', () => {
    // #when
    const lane = page(CLEAR).sections.find((s) => s.chain === ETHEREUM)!.lanes[0]!;
    // #then
    expect({ result: lane.rateLimit!.label, perHour: lane.perHour, inbound: lane.inboundNote }).toEqual({
      result: 'Clear',
      perHour: ['250,000 CLR ($250.0K)', 'Fast transfers: 20,000 CLR ($20.0K)'],
      inbound: 'The receiving side sets no limit on what arrives.',
    });
  });

  it('shows what the sending side requires, any threshold verifiers, the inbound list, and 1.x lanes', () => {
    // #when
    const clear = page(CLEAR).sections.find((s) => s.chain === ETHEREUM)!.lanes[0]!.verifiers;
    const bmt = page(BMT).sections.find((s) => s.chain === ETHEREUM)!;
    const oneX = [...bmt.lanes, ...bmt.folded].find((l) => l.remoteChain === SOLANA)!.verifiers;
    // #then
    expect({ clear, oneX }).toEqual({
      clear: ['Sending requires Committee Verifier (Default); at or above 100,000 CLR also custom verifier 0x0000…00f1', 'Receiving requires Committee Verifier (Default)'],
      oneX: ['CCIP 1.x lane (no verifier set)'],
    });
  });

  it('lists flagged lanes before clear ones on every chain of a twelve-chain token and folds the rest behind a count', () => {
    // #given twelve chains, each lane flagged when its remote chain's number is a multiple of four
    const chains = Array.from({ length: 12 }, (_, i) => String(1000 + i));
    const lane = BMT.rows[1]!.lanes[2]!;
    const flaggedLane = BMT.rows[1]!.lanes[0]!;
    const row = (chain: string): PassportChainRow => ({
      ...rowOn(BMT, ETHEREUM),
      chain,
      lanes: chains.filter((c) => c !== chain).map((c) => ({ ...(Number(c) % 4 === 0 ? flaggedLane : lane), remote_chain: c, pointers: [] })),
    });
    const token: PassportToken = { ...BMT, chains, rows: chains.map(row), log: [] };
    // #when
    const sections = page(token).sections;
    // #then
    expect(sections.map((s) => [s.lanes.every((l) => l.flagged), s.folded.some((l) => l.flagged), s.lanes.length + s.folded.length, s.foldedLabel])).toEqual(
      chains.map((c) => {
        const flagged = chains.filter((x) => x !== c && Number(x) % 4 === 0).length;
        return [true, false, 11, `${11 - flagged} more lanes`];
      }),
    );
  });

  it('shows "no longer listed" with its last read date at the top of the chain section', () => {
    // #given
    const token = withRow(BMT, BASE, { read_on: '2026-11-16' });
    // #when
    const base = page(token).sections.find((s) => s.chain === BASE)!;
    // #then
    expect(base.delisted).toEqual({ label: 'No longer listed', since: 'Nov 24, 2026', lastRead: 'Last read Nov 16, 2026' });
  });

  it('shows a result held after a failed read with its original date', () => {
    // #given
    const ethereum = rowOn(BMT, ETHEREUM);
    const token = withRow(BMT, ETHEREUM, { read_on: '2026-11-23', single_key: { ...ethereum.single_key!, read_on: '2026-11-23' } });
    // #when
    const result = page(token, '2026-11-26').sections.find((s) => s.chain === ETHEREUM)!.singleKey!;
    // #then
    expect([result.label, result.date]).toEqual(['Flagged', 'Read Nov 23, 2026, the last successful reading']);
  });

  it('covers AE7: shows the statement beside the flagged result with both of its dates', () => {
    // #given
    const ethereum = rowOn(BMT, ETHEREUM);
    const statement = { ...ethereum.single_key!.statements[0]!, said_on: '2026-11-20', attached_on: '2026-11-25' };
    const token = withRow(BMT, ETHEREUM, { single_key: { ...ethereum.single_key!, statements: [statement] } });
    // #when
    const result = page(token).sections.find((s) => s.chain === ETHEREUM)!.singleKey!;
    // #then
    expect([result.label, result.statements]).toEqual([
      'Flagged',
      [{ text: 'The deployer key moves to a Safe next week.', dates: 'Said Nov 20, 2026 · attached Nov 25, 2026', how: 'Verified through the project\'s X account', source: { text: '@bmt_token', href: 'https://x.com/bmt_token' } }],
    ]);
  });

  it('covers AE7: shows a statement under its log entry once the result it answered has changed', () => {
    // #when
    const entry = passportLog(BMT, NAMES).find((e) => e.kind === 'statement')!;
    // #then
    expect([entry.label, entry.text, entry.statement]).toEqual([
      'Team statement',
      'About Single key on Ethereum, when it was Clear',
      { text: 'Our pool is owned by a 2-of-3 Safe.', dates: 'Said Nov 24, 2026 · attached Nov 24, 2026', how: 'Verified through the project\'s website', source: { text: 'https://bmt.example/security', href: 'https://bmt.example/security' } },
    ]);
  });
});

describe('the passport log', () => {
  it('renders a first reading, a change, a correction and a re-classification with four distinct labels in date order', () => {
    // #given the fixture's log with the correction first and the first reading last
    const [first, setting, reclassified, correction] = BMT.log.filter((e) => e.kind !== 'statement');
    const token = { ...BMT, log: [correction!, setting!, reclassified!, first!] };
    // #when
    const log = passportLog(token, NAMES);
    // #then
    expect(log.map((e) => [e.day, e.label])).toEqual([
      ['2026-11-24', 'First reading'],
      ['2026-11-25', 'Setting change'],
      ['2026-11-25', 'Re-classified'],
      ['2026-11-26', 'Correction'],
    ]);
  });

  it('says what each entry changed in plain words', () => {
    // #when
    const log = passportLog({ ...BMT, log: BMT.log.filter((e) => e.kind !== 'statement') }, NAMES);
    // #then
    expect(log.map((e) => e.text)).toEqual([
      'First reading on Ethereum',
      'Pool owner on Ethereum: 0x62c2…616b to 0xd4d2…57cb',
      'Rate limit, Ethereum to Ronin: Not readable to Flagged, because ccip.dev changed how it reads this',
      'Rate limit, Ethereum to 0G: Flagged to Clear, because the reading was wrong',
    ]);
  });

  it('labels a pool replacement apart from a setting change', () => {
    // #given
    const token = { ...BMT, log: [{ day: '2026-11-26', chain: ETHEREUM, address: rowOn(BMT, ETHEREUM).address, kind: 'pool-replaced' as const, setting: 'pool', from: '0xe25a97e9e2f1eeee81d4a7986a018ac3ae8d857b', to: '0x00000000000000000000000000000000000000d9' }] };
    // #then
    expect(passportLog(token, NAMES).map((e) => [e.label, e.text])).toEqual([['Pool replaced', 'Pool on Ethereum: 0xe25a…857b to 0x0000…00d9']]);
  });
});

describe('the contact block', () => {
  it('names the Passport result issue form for the page and ccip.dev\'s X account', () => {
    // #when
    const contact = passportContact(PAGE_URL);
    // #then
    expect(contact).toEqual({
      issueUrl: `https://github.com/momentmaker/ccip-dev/issues/new?template=passport.yml&token=${encodeURIComponent(PAGE_URL)}`,
      issueForm: 'Passport result',
      xHandle: '@ccipdev',
      xUrl: 'https://x.com/ccipdev',
    });
  });
});
