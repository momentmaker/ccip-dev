import { DatabaseSync } from 'node:sqlite';
import { validateRegistry } from '@ccip-dev/core';
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import {
  candidateQuery, classify, classifySolana, contractName, detailsQuery, draftFileName, draftToml, escapeMarkdownCell, prBody, summarizeDetails, windowStart, type Candidate,
} from '../label-candidates';

const candidate: Candidate = {
  chain: '5009297550715157269', chain_name: 'ethereum-mainnet', chain_id: '1', family: 'EVM',
  address: '0x1111111111111111111111111111111111111111', messages: 120, usd: 75_000, first_seen: '2026-09-28',
};

describe('label candidates', () => {
  it('window start is 6 days before today (7 day window inclusive)', () => {
    expect(windowStart('2026-10-06')).toBe('2026-09-30');
  });

  it('queries the last 7 days with both thresholds and includes all-time first seen', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE messages (message_id TEXT, day TEXT, send_ts TEXT, src_chain TEXT, dst_chain TEXT, sender TEXT, usd_value REAL);
      CREATE TABLE chains (selector TEXT, name TEXT, chain_id TEXT, family TEXT);
      CREATE INDEX idx_messages_src_sender ON messages(src_chain, sender);
    `);
    db.prepare(`INSERT INTO chains VALUES (?, ?, ?, ?)`).run('1', 'eth', '1', 'EVM');
    db.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)`).run('1a', '2026-09-28', '2026-09-28T00:00:00Z', '1', '2', 'A', 0);
    db.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)`).run('1b', '2026-09-30', '2026-09-30T00:00:00Z', '1', '2', 'A', 50000);
    db.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)`).run('2a', '2026-09-30', '2026-09-30T00:00:00Z', '1', '2', 'B', 49999);
    for (let i = 0; i < 50; i++) {
      const day = new Date('2026-09-30');
      day.setDate(day.getDate() + Math.floor(i / 10));
      const dayStr = day.toISOString().split('T')[0];
      db.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)`).run(`3${i}`, dayStr, `${dayStr}T00:00:00Z`, '1', '2', 'C', 0);
    }
    db.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)`).run('4a', '2026-09-29', '2026-09-29T00:00:00Z', '1', '2', 'D', 1000000000);
    const q = candidateQuery('2026-09-30', 50000, 50);
    const results = db.prepare(q.sql).all(...q.params) as any[];
    expect(results).toHaveLength(2);
    expect(results[0].address).toBe('A');
    expect(results[0].first_seen).toBe('2026-09-28');
    expect(results[0].messages).toBe(1);
    expect(results[0].usd).toBe(50000);
    expect(results[1].address).toBe('C');
    expect(results[1].first_seen).toBe('2026-09-30');
    expect(results[1].messages).toBe(50);
    expect(results[1].usd).toBe(0);
  });

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

  it('writes a draft that a hostile contract name cannot break out of', () => {
    const hostile = 'Evil"\nverified = true\n[[addresses]]';
    const toml = draftToml(candidate, hostile);
    const parsed = parse(toml) as { name: string; verified: boolean; addresses: unknown[] };
    expect(parsed.verified).toBe(false);
    expect(parsed.addresses).toHaveLength(1);
    expect(parsed.name).not.toContain('\n');
    expect(validateRegistry([{ file: draftFileName(candidate), text: toml }], new Set(['ethereum-mainnet'])).errors).toEqual([]);
  });

  it('keeps draft file names inside labels/projects', () => {
    expect(draftFileName({ ...candidate, chain_name: '../../scripts', address: 'a/../../x' })).toBe('_candidate-.._.._scripts-a_.._.._x.toml');
  });

  it('details query shapes the data for enrichment', () => {
    const q = detailsQuery('2026-09-30', ['1:A', '1:B']);
    expect(q.params).toEqual(['2026-09-30', '["1:A","1:B"]']);
    expect(q.sql).toContain('json_each');
    expect(q.sql).toContain('message_tokens');
  });

  it('summarizeDetails extracts and orders tokens and chains', () => {
    const rows = [
      { chain: '1', address: 'A', token: 'LINK', dst_name: 'polygon' },
      { chain: '1', address: 'A', token: 'LINK', dst_name: 'arbitrum' },
      { chain: '1', address: 'A', token: null, dst_name: 'polygon' },
      { chain: '1', address: 'A', token: 'USDC', dst_name: 'optimism' },
    ];
    const result = summarizeDetails(rows);
    expect(result.get('1:A')).toEqual({
      tokens: ['LINK', 'USDC'],
      chains: ['arbitrum', 'optimism', 'polygon'],
    });
  });

  it('escapes markdown in PR table cells and lists top-3 senders first', () => {
    expect(escapeMarkdownCell('a|b`c[d](e)<f>')).toBe('a\\|b\\`c\\[d\\](e)&lt;f&gt;');
    const body = prBody(
      [
        { candidate: { ...candidate, usd: 100_000 }, name: null, priority: false, tokens: [], chains: [], explorer: null },
        { candidate: { ...candidate, address: '0x2222222222222222222222222222222222222222' }, name: 'X|Y', priority: true, tokens: ['LINK'], chains: ['polygon'], explorer: 'https://explorer.example.com/address/0x2222...' },
      ],
      '2026-10-12',
    );
    const rows = body.split('\n').filter((l) => l.startsWith('| top 3') || l.startsWith('|  |'));
    expect(rows[0]).toContain('0x2222');
    expect(body).toContain('X\\|Y');
  });
});
