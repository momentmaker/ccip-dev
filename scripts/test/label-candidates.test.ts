import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { identityResolver, validateRegistry } from '@ccip-dev/core';
import { BASE_SENDER_1, BASE_SENDER_2, fakeFetch, jsonResponse, NETWORKS, XBRIDGE_EVM, XBRIDGE_PROGRAM, XBRIDGE_SOLANA, XSTOCKS_CHAINS, XSTOCKS_DAY, XSTOCKS_LABEL, XSTOCKS_SENDER_ROWS } from '@ccip-dev/core/testing';
import { parse } from 'smol-toml';
import { describe, expect, it, vi } from 'vitest';
import {
  BUSY_WALLET_MESSAGES, candidateHints, chainGapQuery, classify, classifySolana, contractName, coverageMarkdown, coverageWindows, detailsQuery, draftFileName, draftToml, escapeMarkdownCell, groupCandidates,
  handleGaps, handleGapsMarkdown, handleGroupQuery, identityCandidateQuery, keepCandidate, loadEndpointMaps, messageStatsQuery, newcomerQuery, newcomerRowsQuery, pairHints, prBody, receiversQuery, solanaSendProgram, CCIP_ROUTER_SOLANA, spreadMarkdown,
  spreadReport, summarizeDetails, tokenGapQuery, unlabeledRows, withNewcomerRows, type Candidate, type CandidateReportRow, type CandidateRow,
} from '../label-candidates';

const candidate: Candidate = {
  address: '0x1111111111111111111111111111111111111111',
  family: 'EVM',
  chains: [
    { selector: '5009297550715157269', name: 'ethereum-mainnet', chain_id: '1', family: 'EVM', messages: 90 },
    { selector: '15971525489660198786', name: 'ethereum-mainnet-base-1', chain_id: '8453', family: 'EVM', messages: 30 },
  ],
  messages: 120,
  usd: 75_000,
  data_messages: 90,
  first_seen: '2026-09-28',
};

describe('label candidates', () => {
  it('classify handles fetch errors as error state', async () => {
    const badStatus = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: null }, 500));
    const notString = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: 123 }));
    const throws = fakeFetch(async () => { throw new Error('network'); });
    expect(await classify(badStatus, 'https://rpc', candidate.address)).toBe('error');
    expect(await classify(notString, 'https://rpc', candidate.address)).toBe('error');
    expect(await classify(throws, 'https://rpc', candidate.address)).toBe('error');
  });

  it('classify distinguishes unknown (no rpc or invalid address) from wallet and contract', async () => {
    const wallet = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x' }));
    const contract = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x6080' }));
    expect(await classify(wallet, 'https://rpc', candidate.address)).toBe('wallet');
    expect(await classify(contract, 'https://rpc', candidate.address)).toBe('contract');
    expect(await classify(contract, undefined, candidate.address)).toBe('unknown');
    expect(await classify(contract, 'https://rpc', 'not-an-address')).toBe('unknown');
  });

  it('classify treats an EIP-7702 delegation designator as a wallet', async () => {
    const delegated = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: '0xef0100' + 'ab'.repeat(20) }));
    expect(await classify(delegated, 'https://rpc', candidate.address)).toBe('wallet');
  });

  it('classify treats an overlong EIP-7702 prefix as a contract', async () => {
    const overlongPrefix = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: '0xef0100' + 'ab'.repeat(20) + '00' }));
    expect(await classify(overlongPrefix, 'https://rpc', candidate.address)).toBe('contract');
  });

  describe('classifySolana', () => {
    const address = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
    const account = (value: unknown) => fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: { value } }));
    const system = '11111111111111111111111111111111';

    it('calls getAccountInfo with an empty data slice', async () => {
      let body: any;
      const spy = fakeFetch(async (_url, init) => { body = JSON.parse(String(init?.body)); return jsonResponse({ result: { value: null } }); });
      await classifySolana(spy, 'https://rpc', address);
      expect(body.method).toBe('getAccountInfo');
      expect(body.params).toEqual([address, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
    });

    it('returns wallet for a System-owned, non-executable account', async () => {
      expect(await classifySolana(account({ owner: system, executable: false }), 'https://rpc', address)).toBe('wallet');
    });

    it('returns contract for an executable account', async () => {
      expect(await classifySolana(account({ owner: 'BPFLoaderUpgradeab1e11111111111111111111111', executable: true }), 'https://rpc', address)).toBe('contract');
    });

    it('returns contract for an account owned by a program', async () => {
      expect(await classifySolana(account({ owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', executable: false }), 'https://rpc', address)).toBe('contract');
    });

    it('returns unknown for a missing account or rpc', async () => {
      expect(await classifySolana(account(null), 'https://rpc', address)).toBe('unknown');
      expect(await classifySolana(account({ owner: system, executable: false }), undefined, address)).toBe('unknown');
    });

    it('returns error for HTTP failures, thrown fetches and malformed bodies', async () => {
      expect(await classifySolana(fakeFetch(() => jsonResponse({}, 500)), 'https://rpc', address)).toBe('error');
      expect(await classifySolana(fakeFetch(async () => { throw new Error('network'); }), 'https://rpc', address)).toBe('error');
      expect(await classifySolana(fakeFetch(() => jsonResponse({ result: 'nope' })), 'https://rpc', address)).toBe('error');
    });
  });

  it('takes the contract name from Etherscan, falling back to Blockscout', async () => {
    const etherscan = fakeFetch(() => jsonResponse({ status: '1', result: [{ ContractName: 'CCIPSender' }] }));
    expect(await contractName(etherscan, { chainId: '1', address: candidate.address, etherscanKey: 'k' })).toBe('CCIPSender');
    const blockscout = fakeFetch((url) =>
      url.includes('etherscan') ? jsonResponse({ status: '0', result: 'Unsupported chain' }) : jsonResponse({ name: 'BridgeRouter' }),
    );
    expect(
      await contractName(blockscout, { chainId: '57073', address: candidate.address, etherscanKey: 'k', blockscoutBase: 'https://explorer.ink' }),
    ).toBe('BridgeRouter');
  });

});

describe('loadEndpointMaps', () => {
  it('reads the rpc and explorer maps from config/endpoints.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'endpoints-'));
    await mkdir(path.join(root, 'config'));
    await writeFile(
      path.join(root, 'config/endpoints.json'),
      JSON.stringify({ source: 's', rpc: { base: 'https://rpc.example' }, explorer: { base: 'https://scout.example' }, ethereumLogs: [] }),
    );
    expect(await loadEndpointMaps(root)).toEqual({ rpcMap: { base: 'https://rpc.example' }, explorerMap: { base: 'https://scout.example' } });
  });
});

describe('handle gaps', () => {
  const tables = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE daily_breakdown (day TEXT, dim TEXT, key TEXT, messages INTEGER, usd_value REAL, fee_usd REAL);
      CREATE TABLE tokens (chain TEXT, address TEXT, symbol TEXT, group_id TEXT);
      CREATE TABLE chains (selector TEXT, name TEXT);
    `);
    const breakdown = db.prepare('INSERT INTO daily_breakdown VALUES (?, ?, ?, 1, ?, ?)');
    return { db, breakdown };
  };

  it('lists the busiest tokens of the window with their symbol, group and chain', () => {
    // #given two tokens this week and a bigger one before the window
    const { db, breakdown } = tables();
    db.prepare('INSERT INTO chains VALUES (?, ?)').run('1', 'ethereum-mainnet');
    db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?)').run('1', '0xAbC', 'syrupUSDC', 'syrup');
    breakdown.run('2026-10-01', 'token', '1:0xabc', 600, null);
    breakdown.run('2026-10-02', 'token', '1:0xabc', 400, null);
    breakdown.run('2026-10-02', 'token', '1:0xdef', 900, null);
    breakdown.run('2026-09-01', 'token', '1:0x999', 5000, null);
    // #when
    const q = tokenGapQuery('2026-09-30', 10);
    const rows = db.prepare(q.sql).all(...q.params) as any[];
    // #then
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { key: '1:0xabc', usd: 1000, symbol: 'syrupUSDC', group_id: 'syrup', chain_name: 'ethereum-mainnet' },
      { key: '1:0xdef', usd: 900, symbol: null, group_id: null, chain_name: 'ethereum-mainnet' },
    ]);
  });

  it('lists the chains that move the most value or pay the most fees', () => {
    // #given chain 3 moves little value but pays the most fees
    const { db, breakdown } = tables();
    for (const [selector, name] of [['1', 'ethereum-mainnet'], ['2', 'ethereum-mainnet-base-1'], ['3', 'binance_smart_chain-mainnet']]) {
      db.prepare('INSERT INTO chains VALUES (?, ?)').run(selector, name);
    }
    breakdown.run('2026-10-01', 'src_chain', '1', 1000, 1);
    breakdown.run('2026-10-01', 'dst_chain', '2', 500, null);
    breakdown.run('2026-10-01', 'src_chain', '3', 10, 99);
    // #when
    const q = chainGapQuery('2026-09-30', 2, 1);
    const rows = db.prepare(q.sql).all(...q.params) as any[];
    // #then
    expect(rows.map((r) => r.chain_name)).toEqual(['binance_smart_chain-mainnet', 'ethereum-mainnet', 'ethereum-mainnet-base-1']);
  });

  it('reads the registry group of each token entry by chain name and address', () => {
    // #given
    const { db } = tables();
    db.prepare('INSERT INTO chains VALUES (?, ?)').run('1', 'ethereum-mainnet');
    db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?)').run('1', '0xAbC', 'syrupUSDC', 'syrup');
    // #when
    const q = handleGroupQuery([{ chain: 'ethereum-mainnet', address: '0xABC' }]);
    const rows = db.prepare(q.sql).all(...q.params) as any[];
    // #then
    expect(rows.map((r) => ({ ...r }))).toEqual([{ chain_name: 'ethereum-mainnet', address: '0xabc', group_id: 'syrup' }]);
  });

  it('keeps only the tokens no entry covers, by group or by address, and the chains with no handle', () => {
    // #given
    const token = (key: string, group: string | null) => ({ key, usd: 1, symbol: 'T', group_id: group, chain_name: 'ethereum-mainnet' });
    const handles = { chains: { 'ethereum-mainnet': 'ethereum' }, tokens: [{ chain: 'ethereum-mainnet', address: '0xbbb', project: 'B', x: 'b' }] };
    // #when
    const gaps = handleGaps(
      [token('1:0xaaa', 'syrup'), token('1:0xBBB', null), token('1:0xccc', null)],
      [{ selector: '1', chain_name: 'ethereum-mainnet' }, { selector: '2', chain_name: 'ethereum-mainnet-base-1' }, { selector: '9', chain_name: null }],
      handles,
      [{ chain_name: 'ethereum-mainnet', address: '0xbbb', group_id: 'syrup' }],
    );
    // #then
    expect({ tokens: gaps.tokens.map((t) => t.key), chains: gaps.chains.map((c) => c.selector) }).toEqual({ tokens: ['1:0xccc'], chains: ['2', '9'] });
  });

  it('writes the gaps for the pull request with escaped cells, and says when there are none', () => {
    // #when
    const some = handleGapsMarkdown(
      { tokens: [{ key: '1:0xccc', usd: 1234.5, symbol: 'T|X', group_id: null, chain_name: 'ethereum-mainnet' }], chains: [{ selector: '2', chain_name: 'ethereum-mainnet-base-1' }] },
    );
    const none = handleGapsMarkdown({ tokens: [], chains: [] });
    // #then
    expect({
      heading: some.startsWith('## Handles to research'),
      token: some.includes('| T\\|X | ethereum-mainnet | 0xccc | - | 1,235 |'),
      chain: some.includes('| ethereum-mainnet-base-1 | 2 |'),
      none: none.includes('Nothing to research this week.'),
      dated: /\d{4}-\d{2}-\d{2}/.test(some + none),
    }).toEqual({ heading: true, token: true, chain: true, none: true, dated: false });
  });
});

describe('candidates by identity', () => {
  const database = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE daily_breakdown (day TEXT, dim TEXT, key TEXT, messages INTEGER, usd_value REAL, fee_usd REAL);
      CREATE TABLE daily_totals (day TEXT, messages INTEGER, usd_value REAL, fee_usd REAL);
      CREATE TABLE chains (selector TEXT, name TEXT, chain_id TEXT, family TEXT);
      CREATE TABLE messages (message_id TEXT, day TEXT, src_chain TEXT, sender TEXT, receiver TEXT, token_count INTEGER);
      CREATE TABLE arrivals (kind TEXT, key TEXT, first_seen TEXT, announced_at TEXT);
    `);
    const chain = db.prepare('INSERT INTO chains VALUES (?, ?, ?, ?)');
    for (const n of Object.values(NETWORKS)) chain.run(n.chainSelector, n.name, n.chainId, n.chainFamily);
    return db;
  };
  const rows = (db: DatabaseSync, q: { sql: string; params: unknown[] }) => (db.prepare(q.sql).all(...(q.params as (string | number)[])) as Record<string, unknown>[]).map((r) => ({ ...r }));
  const FILLER_1 = `0x${'0'.repeat(39)}1`;

  it("finds xStocks's xBridge by its messages summed across five chains, though they carry no value", () => {
    // #given 2026-10-13's senders, before xStocks had a label
    const db = database();
    const insert = db.prepare("INSERT INTO daily_breakdown VALUES (?, 'sender', ?, ?, ?, ?)");
    for (const r of XSTOCKS_SENDER_ROWS) insert.run(XSTOCKS_DAY, r.key, r.messages, r.usd_value, r.fee_usd);
    // #when the top 2 by messages and the top 2 by value
    const candidates = groupCandidates(rows(db, identityCandidateQuery('2026-10-07', 50_000, 50, 2)) as unknown as CandidateRow[], new Map());
    // #then
    expect(candidates.map((c) => [c.address, c.messages, c.chains.length])).toEqual([[XBRIDGE_EVM, 170, 5], [XBRIDGE_SOLANA, 149, 1], [BASE_SENDER_1, 76, 1], [FILLER_1, 50, 1]]);
  });

  it("reads each address's data messages in the window and its first day ever, on any chain", () => {
    // #given
    const db = database();
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, NULL, ?)');
    insert.run('a', '2026-08-01', NETWORKS.ink.chainSelector, XBRIDGE_EVM, 1);
    insert.run('b', XSTOCKS_DAY, NETWORKS.ink.chainSelector, XBRIDGE_EVM, 0);
    insert.run('c', XSTOCKS_DAY, NETWORKS.xlayer.chainSelector, XBRIDGE_EVM, 0);
    insert.run('d', XSTOCKS_DAY, NETWORKS.xlayer.chainSelector, XBRIDGE_EVM, 1);
    // #then
    expect(rows(db, messageStatsQuery('2026-10-07', '2026-10-13', [NETWORKS.ink, NETWORKS.xlayer].map((n) => ({ chain: n.chainSelector, address: XBRIDGE_EVM }))))).toEqual([{ address: XBRIDGE_EVM, data_messages: 2, first_seen: '2026-08-01' }]);
  });

  it('groups an address’s chains busiest first, with its data messages and first day', () => {
    // #given
    const row = (chain: string, name: string, messages: number): CandidateRow => ({ address: XBRIDGE_EVM, chain, chain_name: name, chain_id: '1', family: 'EVM', messages, usd: 1 });
    // #when
    const [c] = groupCandidates([row('9', 'b', 10), row('8', 'a', 30)], new Map([[XBRIDGE_EVM, { data_messages: 40, first_seen: '2026-10-09' }]]));
    // #then
    expect({ chains: c!.chains.map((ch) => ch.name), messages: c!.messages, usd: c!.usd, data: c!.data_messages, first: c!.first_seen }).toEqual({ chains: ['a', 'b'], messages: 40, usd: 2, data: 40, first: '2026-10-09' });
  });

  it("leaves out the rows a label names, a draft included, and the rows a label spreads to", () => {
    // #given xStocks labeled on Ink (so X Layer is spread), and a draft naming the first Base sender
    const resolve = identityResolver({ [`ethereum-mainnet-ink-1:${XBRIDGE_EVM}`]: XSTOCKS_LABEL }, XSTOCKS_CHAINS);
    const row = (n: (typeof NETWORKS)[keyof typeof NETWORKS], address: string): CandidateRow => ({ address, chain: n.chainSelector, chain_name: n.name, chain_id: n.chainId, family: n.chainFamily, messages: 1, usd: 0 });
    const labeled = new Set([`ethereum-mainnet-ink-1:${XBRIDGE_EVM}`, `ethereum-mainnet-base-1:${BASE_SENDER_1}`]);
    // #when
    const left = unlabeledRows([row(NETWORKS.ink, XBRIDGE_EVM), row(NETWORKS.xlayer, XBRIDGE_EVM), row(NETWORKS.base, BASE_SENDER_1), row(NETWORKS.base, BASE_SENDER_2)], labeled, resolve);
    // #then
    expect(left.map((r) => r.address)).toEqual([BASE_SENDER_2]);
  });

  it.each([
    ['wallet', BUSY_WALLET_MESSAGES - 1, false],
    ['wallet', 149, true],
    ['contract', 1, true],
    ['unknown', 1, true],
    ['error', 500, false],
  ] as const)('keeps a %s with %i messages in the week: %s (a busy wallet, like xStocks’s Solana sender, is an operator)', (kind, messages, kept) => {
    // #then
    expect(keepCandidate(kind, messages)).toBe(kept);
  });

  it('writes one draft with an address entry per known chain, which a hostile contract name cannot break out of', () => {
    // #when
    const toml = draftToml(candidate, 'Evil"\nverified = true\n[[addresses]]');
    const parsed = parse(toml) as { name: string; verified: boolean; addresses: { chain: string }[] };
    // #then
    expect({
      verified: parsed.verified,
      chains: parsed.addresses.map((a) => a.chain),
      newline: parsed.name.includes('\n'),
      errors: validateRegistry([{ file: draftFileName(candidate), text: toml }], new Set(['ethereum-mainnet', 'ethereum-mainnet-base-1'])).errors,
    }).toEqual({ verified: false, chains: ['ethereum-mainnet', 'ethereum-mainnet-base-1'], newline: false, errors: [] });
  });

  it('names a draft after its busiest chain, and keeps the name inside labels/projects', () => {
    // #then
    expect([draftFileName(candidate), draftFileName({ ...candidate, address: 'a/../../x', chains: [{ ...candidate.chains[0]!, name: '../../scripts' }] })]).toEqual([
      '_candidate-ethereum-mainnet-0x1111111111111111111111111111111111111111.toml',
      '_candidate-.._.._scripts-a_.._.._x.toml',
    ]);
  });

  it('reads tokens and destinations by address, across all of a candidate’s chains', () => {
    // #when
    const q = detailsQuery('2026-09-30', ['0xa', 'A8JP']);
    const summary = summarizeDetails([
      { address: '0xa', token: 'LINK', dst_name: 'polygon' },
      { address: '0xa', token: 'LINK', dst_name: 'arbitrum' },
      { address: '0xa', token: null, dst_name: 'polygon' },
      { address: '0xa', token: 'USDC', dst_name: 'optimism' },
    ]);
    // #then
    expect({ params: q.params, json: q.sql.includes('json_each'), summary: summary.get('0xa') }).toEqual({
      params: ['2026-09-30', '["0xa","A8JP"]'],
      json: true,
      summary: { tokens: ['LINK', 'USDC'], destinations: ['arbitrum', 'optimism', 'polygon'] },
    });
  });

  it('fast-tracks the unlabeled addresses recorded as new on CCIP this week', () => {
    // #given
    const db = database();
    const insert = db.prepare('INSERT INTO arrivals VALUES (?, ?, ?, NULL)');
    insert.run('sender', `address:${BASE_SENDER_1}`, '2026-10-13T00:00:00.000Z');
    insert.run('sender', 'project:xstocks', '2026-10-13T00:00:00.000Z');
    insert.run('sender', `address:${BASE_SENDER_2}`, '2026-09-01T00:00:00.000Z');
    insert.run('lane', 'a>b', '2026-10-13T00:00:00.000Z');
    // #then
    expect(rows(db, newcomerQuery('2026-10-07')).map((r) => r.address)).toEqual([BASE_SENDER_1]);
  });
  it('counts data messages only on the chains the candidate keeps, so its share stays within 100%', () => {
    // #given an address labeled on Ink (left out) with data messages on both chains
    const db = database();
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, NULL, 0)');
    for (const id of ['a', 'b', 'c']) insert.run(id, XSTOCKS_DAY, NETWORKS.ink.chainSelector, XBRIDGE_EVM);
    insert.run('d', XSTOCKS_DAY, NETWORKS.xlayer.chainSelector, XBRIDGE_EVM);
    // #when the candidate keeps X Layer only
    const [stat] = rows(db, messageStatsQuery('2026-10-07', '2026-10-13', [{ chain: NETWORKS.xlayer.chainSelector, address: XBRIDGE_EVM }]));
    // #then
    expect(stat!.data_messages).toBe(1);
  });

  it("counts no data messages from today, which the finalized message counts don't include yet", () => {
    // #given a data message in the window and two sent today
    const db = database();
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, NULL, 0)');
    insert.run('a', XSTOCKS_DAY, NETWORKS.xlayer.chainSelector, XBRIDGE_EVM);
    insert.run('b', '2026-10-14', NETWORKS.xlayer.chainSelector, XBRIDGE_EVM);
    insert.run('c', '2026-10-14', NETWORKS.xlayer.chainSelector, XBRIDGE_EVM);
    // #when the window ends yesterday
    const [stat] = rows(db, messageStatsQuery('2026-10-07', '2026-10-13', [{ chain: NETWORKS.xlayer.chainSelector, address: XBRIDGE_EVM }]));
    // #then
    expect(stat!.data_messages).toBe(1);
  });

  it('reads a newcomer’s rows with no threshold, by address', () => {
    // #given
    const db = database();
    const insert = db.prepare("INSERT INTO daily_breakdown VALUES (?, 'sender', ?, ?, 0, 0)");
    insert.run(XSTOCKS_DAY, `${NETWORKS.base.chainSelector}:${BASE_SENDER_1}`, 3);
    insert.run(XSTOCKS_DAY, `${NETWORKS.base.chainSelector}:${BASE_SENDER_2}`, 9);
    // #then
    expect(rows(db, newcomerRowsQuery('2026-10-07', [BASE_SENDER_1])).map((r) => [r.address, r.messages])).toEqual([[BASE_SENDER_1, 3]]);
  });

  describe('fast-tracking newcomers', () => {
    const row = (n: (typeof NETWORKS)[keyof typeof NETWORKS], address: string, messages: number): CandidateRow => ({ address, chain: n.chainSelector, chain_name: n.name, chain_id: n.chainId, family: n.chainFamily, messages, usd: 0 });
    const none = identityResolver({}, XSTOCKS_CHAINS);

    it('adds a newcomer below every threshold that the ranking missed', () => {
      expect(withNewcomerRows([], [row(NETWORKS.base, BASE_SENDER_1, 1)], new Set(), none).map((r) => r.address)).toEqual([BASE_SENDER_1]);
    });

    it('does not add a newcomer a label names or spreads to', () => {
      // #given xStocks labeled on Ink, so X Layer is spread
      const resolve = identityResolver({ [`ethereum-mainnet-ink-1:${XBRIDGE_EVM}`]: XSTOCKS_LABEL }, XSTOCKS_CHAINS);
      const labeled = new Set([`ethereum-mainnet-base-1:${BASE_SENDER_1}`]);
      // #then
      expect(withNewcomerRows([], [row(NETWORKS.xlayer, XBRIDGE_EVM, 1), row(NETWORKS.base, BASE_SENDER_1, 1)], labeled, resolve)).toEqual([]);
    });

    it('lists a newcomer that is also ranked once', () => {
      const ranked = [row(NETWORKS.base, BASE_SENDER_1, 80)];
      expect(withNewcomerRows(ranked, [row(NETWORKS.base, BASE_SENDER_1, 80), row(NETWORKS.ink, BASE_SENDER_1, 2)], new Set(), none)).toEqual(ranked);
    });

    it.each([
      ['a newcomer wallet with 3 messages', 'wallet', 3, true, true],
      ['the same wallet, not new', 'wallet', 3, false, false],
      ['a newcomer the RPC could not check', 'error', 3, true, false],
    ] as const)('keeps %s: %s', (_what, kind, messages, newcomer, kept) => {
      expect(keepCandidate(kind, messages, newcomer)).toBe(kept);
    });
  });
});

describe('the candidates pull request', () => {
  it('leads with label coverage and its change in points from last week', () => {
    // #given
    const now = { messages_pct: 81.2, usd_pct: 94.4, fees_pct: 90, window: '7d' as const };
    const before = { messages_pct: 78.2, usd_pct: 95.4, fees_pct: 90, window: '7d' as const };
    const none = { messages_pct: null, usd_pct: null, fees_pct: null, window: '7d' as const };
    // #then
    expect([coverageMarkdown(now, before), coverageMarkdown(now, none), coverageMarkdown(none, before)]).toEqual([
      'Labeled senders: 81% of messages (+3 points), 94% of value (−1 point), 90% of fees (±0 points) over the last 7 days.',
      'Labeled senders: 81% of messages, 94% of value, 90% of fees over the last 7 days.',
      'Labeled senders: no messages in the last 7 days.',
    ]);
  });

  it("reports the rows a label spread to this week, busiest first, for the owner to confirm or block", () => {
    // #given xStocks labeled on Ink only
    const resolve = identityResolver({ [`ethereum-mainnet-ink-1:${XBRIDGE_EVM}`]: XSTOCKS_LABEL }, XSTOCKS_CHAINS);
    // #when
    const report = spreadReport(XSTOCKS_SENDER_ROWS, resolve, new Map([...XSTOCKS_CHAINS].map(([selector, c]) => [selector, c.name])));
    // #then
    expect({ report, table: spreadMarkdown(report).includes(`| xStocks | ethereum-mainnet-xlayer-1 | ${XBRIDGE_EVM} | 58 |`), none: spreadMarkdown([]).includes('No label spread this week.') }).toEqual({
      report: [
        { project: 'xStocks', chain: 'ethereum-mainnet-xlayer-1', address: XBRIDGE_EVM, messages: 58 },
        { project: 'xStocks', chain: 'binance_smart_chain-mainnet', address: XBRIDGE_EVM, messages: 22 },
        { project: 'xStocks', chain: 'ethereum-mainnet', address: XBRIDGE_EVM, messages: 6 },
        { project: 'xStocks', chain: 'hyperliquid-mainnet', address: XBRIDGE_EVM, messages: 3 },
      ],
      table: true,
      none: true,
    });
  });

  it('lists new-on-CCIP addresses first, then the top 3, with chains, data share and hints, and escapes every cell', () => {
    // #given
    expect(escapeMarkdownCell('a|b`c[d](e)<f>')).toBe('a\\|b\\`c\\[d\\](e)&lt;f&gt;');
    const row = (address: string, priority: CandidateReportRow['priority'], messages: number): CandidateReportRow => ({
      candidate: { ...candidate, address, messages, data_messages: messages * 0.75 }, name: address === '0xaaa' ? 'X|Y' : null, priority, tokens: [], destinations: [], hints: ['pairs with 0x9ec0…846b'], explorer: null,
    });
    // #when
    const body = prBody([row('0xaaa', null, 500), row('0xbbb', 'top 3', 10), row('0xccc', 'new on CCIP', 5)], '2026-10-19', 'Labeled senders: 81% of messages over the last 7 days.', 'No label spread this week.');
    const table = body.split('\n').filter((l) => /^\| (new on CCIP|top 3|) \|/.test(l));
    // #then
    expect({
      lead: body.split('\n')[0],
      order: table.map((l) => l.split(' | ')[2]),
      cells: table[0]!.includes('| ethereum-mainnet, ethereum-mainnet-base-1 |') && table[0]!.includes('| 75% |') && table[0]!.includes('| pairs with 0x9ec0…846b |'),
      escaped: body.includes('X\\|Y'),
      spread: body.trimEnd().endsWith('No label spread this week.'),
    }).toEqual({ lead: 'Labeled senders: 81% of messages over the last 7 days.', order: ['0xccc', '0xbbb', '0xaaa'], cells: true, escaped: true, spread: true });
  });
});

describe('Solana program hints', () => {
  const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
  const SWAP_PROGRAM = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
  const tx = (accountKeys: string[], programIdIndexes: number[], readonly: string[] = []) => ({
    transaction: { message: { accountKeys, instructions: programIdIndexes.map((programIdIndex) => ({ programIdIndex })) } },
    meta: { loadedAddresses: { writable: [], readonly } },
  });
  const rpc = (signatures: unknown, transactions: Record<string, unknown>, seen: string[] = []) =>
    fakeFetch((_url, init) => {
      const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      seen.push(method === 'getTransaction' ? `${method} ${String(params[0])}` : method);
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: method === 'getSignaturesForAddress' ? signatures : (transactions[String(params[0])] ?? null) });
    });
  const XBRIDGE_SEND = tx([XBRIDGE_SOLANA, COMPUTE_BUDGET, XBRIDGE_PROGRAM], [1, 2], [CCIP_ROUTER_SOLANA]);

  it("names the program xStocks's Solana sender sends through, skipping compute budget, from its latest successful send", async () => {
    // #given a failed send, then a successful one that sets a compute budget and calls the xBridge program, which reaches the router
    const seen: string[] = [];
    const fetchFn = rpc([{ signature: 'failed', err: { InstructionError: [0, 'Custom'] } }, { signature: 'sent', err: null }], { sent: XBRIDGE_SEND }, seen);
    // #when
    const program = await solanaSendProgram(fetchFn, 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect({ program, seen }).toEqual({ program: XBRIDGE_PROGRAM, seen: ['getSignaturesForAddress', 'getTransaction sent'] });
  });

  it('skips its latest transactions that never reach the CCIP router, such as a swap', async () => {
    // #given a swap after its latest CCIP send
    const seen: string[] = [];
    const fetchFn = rpc([{ signature: 'swap', err: null }, { signature: 'sent', err: null }], { swap: tx([XBRIDGE_SOLANA, SWAP_PROGRAM], [1]), sent: XBRIDGE_SEND }, seen);
    // #when
    const program = await solanaSendProgram(fetchFn, 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect({ program, seen }).toEqual({ program: XBRIDGE_PROGRAM, seen: ['getSignaturesForAddress', 'getTransaction swap', 'getTransaction sent'] });
  });

  it('names the CCIP router for a wallet that calls it directly, and the hint says so', async () => {
    // #when
    const program = await solanaSendProgram(rpc([{ signature: 'sent', err: null }], { sent: tx([XBRIDGE_SOLANA, COMPUTE_BUDGET, CCIP_ROUTER_SOLANA], [1, 2]) }), 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect({ program, hints: candidateHints(XBRIDGE_SOLANA, program ?? undefined, new Map()) }).toEqual({ program: CCIP_ROUTER_SOLANA, hints: ['calls the CCIP router directly'] });
  });

  it('finds a program held in the transaction’s loaded addresses', async () => {
    // #when the program sits in a lookup table, after the two static keys
    const program = await solanaSendProgram(rpc([{ signature: 'sent', err: null }], { sent: tx([XBRIDGE_SOLANA, COMPUTE_BUDGET], [1, 2], [XBRIDGE_PROGRAM, CCIP_ROUTER_SOLANA]) }), 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect(program).toBe(XBRIDGE_PROGRAM);
  });

  it('reads at most 5 transactions, and has no hint when none of them reaches the router', async () => {
    // #given 8 swaps
    const seen: string[] = [];
    const swaps = Array.from({ length: 8 }, (_, i) => `swap${i}`);
    const fetchFn = rpc(swaps.map((signature) => ({ signature, err: null })), Object.fromEntries(swaps.map((s) => [s, tx([XBRIDGE_SOLANA, SWAP_PROGRAM], [1])])), seen);
    // #when
    const program = await solanaSendProgram(fetchFn, 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect({ program, reads: seen.filter((m) => m.startsWith('getTransaction')).length }).toEqual({ program: null, reads: 5 });
  });

  it('has no hint when the CCIP send only calls common programs at the top level', async () => {
    // #when
    const program = await solanaSendProgram(rpc([{ signature: 'sent', err: null }], { sent: tx([XBRIDGE_SOLANA, COMPUTE_BUDGET, '11111111111111111111111111111111'], [1, 2], [CCIP_ROUTER_SOLANA]) }), 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect(program).toBeNull();
  });

  it('has no hint without an RPC, without a successful send, or when the RPC fails', async () => {
    // #when
    const results = await Promise.all([
      solanaSendProgram(rpc([], {}), undefined, XBRIDGE_SOLANA),
      solanaSendProgram(rpc([{ signature: 'failed', err: {} }], {}), 'https://rpc', XBRIDGE_SOLANA),
      solanaSendProgram(fakeFetch(() => jsonResponse({}, 500)), 'https://rpc', XBRIDGE_SOLANA),
      solanaSendProgram(fakeFetch(async () => { throw new Error('network'); }), 'https://rpc', XBRIDGE_SOLANA),
    ]);
    // #then
    expect(results).toEqual([null, null, null, null]);
  });
});

describe('coverage windows', () => {
  it('compares the 7 complete days before today with the 7 before them, as the Worker does', () => {
    // #then
    expect(coverageWindows('2026-10-14')).toEqual({ week: { from: '2026-10-07', to: '2026-10-13' }, before: { from: '2026-09-30', to: '2026-10-06' } });
  });
});

describe('RPC hardening', () => {
  const timeouts = async (call: (fetchFn: typeof fetch) => Promise<unknown>) => {
    const signals: (AbortSignal | null | undefined)[] = [];
    await call(fakeFetch((_url, init) => {
      signals.push(init?.signal);
      return jsonResponse({ result: [] });
    }));
    return signals.every((s) => s instanceof AbortSignal) && signals.length > 0;
  };

  it.each([
    ['classify', (f: typeof fetch) => classify(f, 'https://rpc', XBRIDGE_EVM)],
    ['classifySolana', (f: typeof fetch) => classifySolana(f, 'https://rpc', XBRIDGE_SOLANA)],
    ['solanaSendProgram', (f: typeof fetch) => solanaSendProgram(f, 'https://rpc', XBRIDGE_SOLANA)],
  ])('gives every %s request a timeout', async (_name, call) => {
    expect(await timeouts(call)).toBe(true);
  });

  it('warns with the status when the RPC answers a send lookup with an error', async () => {
    // #given
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // #when
    await solanaSendProgram(fakeFetch(() => jsonResponse({}, 429)), 'https://rpc', XBRIDGE_SOLANA);
    // #then
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('429'));
    warn.mockRestore();
  });
});

describe('pair hints', () => {
  it('does not pair a candidate with its own program', () => {
    // #when A8JP sends to the xBridge program it sends through
    const pairs = pairHints([XBRIDGE_SOLANA], [{ address: XBRIDGE_SOLANA, receiver: XBRIDGE_PROGRAM }], new Map([[XBRIDGE_SOLANA, XBRIDGE_PROGRAM]]));
    // #then
    expect([...pairs]).toEqual([]);
  });

  it("pairs xStocks's two senders: A8JP sends to the xBridge, and the xBridge sends to A8JP's program", () => {
    // #when
    const pairs = pairHints(
      [XBRIDGE_EVM, XBRIDGE_SOLANA, BASE_SENDER_1],
      [{ address: XBRIDGE_SOLANA, receiver: XBRIDGE_EVM }, { address: XBRIDGE_EVM, receiver: XBRIDGE_PROGRAM }, { address: BASE_SENDER_1, receiver: '0x2222222222222222222222222222222222222222' }],
      new Map([[XBRIDGE_SOLANA, XBRIDGE_PROGRAM]]),
    );
    // #then
    expect([...pairs]).toEqual([
      [XBRIDGE_SOLANA, ['pairs with 0x9ec0…846b']],
      [XBRIDGE_EVM, ['pairs with A8JP…in3u']],
    ]);
  });

  it('writes the program hint first, then the pairs', () => {
    // #then
    expect(candidateHints(XBRIDGE_SOLANA, XBRIDGE_PROGRAM, new Map([[XBRIDGE_SOLANA, ['pairs with 0x9ec0…846b']]]))).toEqual(['sends via program F2ZY…KcZN', 'pairs with 0x9ec0…846b']);
  });

  it('reads who each candidate sent to over the week', () => {
    // #given
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE messages (message_id TEXT, day TEXT, src_chain TEXT, sender TEXT, receiver TEXT, token_count INTEGER)');
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, 0)');
    insert.run('a', '2026-10-13', '1', XBRIDGE_SOLANA, XBRIDGE_EVM);
    insert.run('b', '2026-10-13', '1', XBRIDGE_SOLANA, XBRIDGE_EVM);
    insert.run('c', '2026-09-01', '1', XBRIDGE_SOLANA, '0xold');
    insert.run('d', '2026-10-13', '1', BASE_SENDER_1, null);
    // #when
    const q = receiversQuery('2026-10-07', [XBRIDGE_SOLANA, BASE_SENDER_1]);
    // #then
    expect((db.prepare(q.sql).all(...(q.params as string[])) as Record<string, unknown>[]).map((r) => ({ ...r }))).toEqual([{ address: XBRIDGE_SOLANA, receiver: XBRIDGE_EVM, messages: 2 }]);
  });
});
