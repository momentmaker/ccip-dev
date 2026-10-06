import { validateRegistry } from '@ccip-dev/core';
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import {
  candidateQuery, classify, contractName, draftFileName, draftToml, escapeMarkdownCell, prBody, type Candidate,
} from '../label-candidates';

const candidate: Candidate = {
  chain: '5009297550715157269', chain_name: 'ethereum-mainnet', chain_id: '1', family: 'EVM',
  address: '0x1111111111111111111111111111111111111111', messages: 120, usd: 75_000, first_seen: '2026-10-01T00:00:00.000Z',
};

describe('label candidates', () => {
  it('queries the last 7 days with both thresholds', () => {
    expect(candidateQuery('2026-10-05', 50_000, 50).params).toEqual(['2026-10-05', 50_000, 50]);
  });

  it('treats an address without code as a wallet and never labels it', async () => {
    const wallet = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x' }));
    const contract = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x6080' }));
    expect(await classify(wallet, 'https://rpc', candidate.address)).toBe('wallet');
    expect(await classify(contract, 'https://rpc', candidate.address)).toBe('contract');
    expect(await classify(contract, undefined, candidate.address)).toBe('unknown');
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

  it('escapes markdown in PR table cells and lists top-3 senders first', () => {
    expect(escapeMarkdownCell('a|b`c[d](e)<f>')).toBe('a\\|b\\`c\\[d\\](e)&lt;f&gt;');
    const body = prBody(
      [
        { candidate: { ...candidate, usd: 100_000 }, name: null, priority: false },
        { candidate: { ...candidate, address: '0x2222222222222222222222222222222222222222' }, name: 'X|Y', priority: true },
      ],
      '2026-10-12',
    );
    const rows = body.split('\n').filter((l) => l.startsWith('| top 3') || l.startsWith('|  |'));
    expect(rows[0]).toContain('0x2222');
    expect(body).toContain('X\\|Y');
  });
});
