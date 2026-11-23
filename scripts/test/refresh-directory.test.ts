import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fakeFetch, jsonResponse, type FakeRoute } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { buildDirectory, refreshDirectoryFile, type DirectoryAnswer, type VerifiersAnswer } from '../refresh-directory';
import chainsAnswer from './fixtures/ccip-directory/chains-mainnet.json';
import verifiersAnswer from './fixtures/ccip-directory/verifiers.json';

const CHAINS_URL = 'https://docs.chain.link/api/ccip/v1/chains?environment=mainnet';
const VERIFIERS_URL = 'https://api.ccip.chain.link/v2/verifiers';

const recordedChains = chainsAnswer as unknown as DirectoryAnswer;
const recordedVerifiers = verifiersAnswer as unknown as VerifiersAnswer;

const route = (url: string, body: unknown): FakeRoute => (u) => (u === url ? jsonResponse(body) : undefined);
const tempFile = async () => path.join(await mkdtemp(path.join(tmpdir(), 'ccip-directory-')), 'ccip-directory.json');

const evmChain = (chainId: number, internalId: string, selector: string, tokenAdminRegistry?: string) => ({
  chainId, displayName: internalId, selector, internalId, router: `0x${'1'.repeat(40)}`, tokenAdminRegistry,
});

describe('buildDirectory', () => {
  it('holds one entry per EVM chain of the recorded directory answer', () => {
    // #when
    const { directory } = buildDirectory(recordedChains, recordedVerifiers);
    // #then the recorded answer lists 73 EVM mainnet chains, all with a registry
    expect(Object.keys(directory.chains).length).toBe(73);
  });

  it('keys Ethereum by its selector with its router and registry', () => {
    // #when
    const { directory } = buildDirectory(recordedChains, recordedVerifiers);
    // #then
    expect(directory.chains['5009297550715157269']).toEqual({
      chainId: 1,
      name: 'ethereum-mainnet',
      router: '0x80226fc0ee2b096224eeac085bb9a8cba1146f7d',
      tokenAdminRegistry: '0xb22764f98dd05c789929716d677382df22c05cb6',
    });
  });

  it('carries the Arbitrum and Base registries', () => {
    // #when
    const { directory } = buildDirectory(recordedChains, recordedVerifiers);
    // #then
    expect([directory.chains['4949039107694359620']?.tokenAdminRegistry, directory.chains['15971525489660198786']?.tokenAdminRegistry]).toEqual([
      '0x39ae1032cf4b334a1ed41cdd0833bdd7c7e7751e',
      '0x6f6c373d09c07425baae72317863d7f6bb731e37',
    ]);
  });

  it('leaves out a chain with no registry address and names it, with the chains the directory itself set aside', () => {
    // #given
    const answer: DirectoryAnswer = {
      data: { evm: { '1': evmChain(1, 'ethereum-mainnet', '5009297550715157269', `0x${'2'.repeat(40)}`), '7': evmChain(7, 'bare-mainnet', '77') } },
      ignored: [{ networkId: 'ton-mainnet', reason: 'Missing required chain configuration data', missingFields: ['registryModule', 'tokenAdminRegistry'] }],
    };
    // #when
    const { directory, omitted } = buildDirectory(answer, { verifiers: [] });
    // #then
    expect({ chains: Object.keys(directory.chains), omitted }).toEqual({ chains: ['5009297550715157269'], omitted: ['bare-mainnet', 'ton-mainnet'] });
  });

  it('maps each chain selector and verifier address to the verifier name', () => {
    // #when
    const { directory } = buildDirectory(recordedChains, recordedVerifiers);
    // #then
    expect(directory.verifiers['5009297550715157269']).toEqual({
      '0x2caafd3b4cf606220580c885bd2b448fb93dc03b': 'Committee Verifier (Default)',
      '0xbfd2109d3ff5b6f09281bdb52ca6b56d7bb1ff12': 'CCTP Verifier',
    });
  });

  it('keeps a non-EVM verifier address in its original case', () => {
    // #when
    const { directory } = buildDirectory(recordedChains, recordedVerifiers);
    // #then
    expect(directory.verifiers['124615329519749607']?.['CCiTPESGEevd7TBU8EGBKrcxuRq7jx3YtW6tPidnscaZ']).toBe('CCTP Verifier');
  });
});

describe('refreshDirectoryFile', () => {
  it('writes byte-identical files from the same answers, whatever order they list chains and verifiers in', async () => {
    // #given the same answers, the second listed in reverse order
    const reversedChains: DirectoryAnswer = { ...recordedChains, data: { evm: Object.fromEntries(Object.entries(recordedChains.data.evm).reverse()) } };
    const reversedVerifiers: VerifiersAnswer = {
      verifiers: [...recordedVerifiers.verifiers].reverse().map((v) => ({ ...v, addresses: [...v.addresses].reverse() })),
    };
    const first = await tempFile();
    const second = await tempFile();
    // #when
    await refreshDirectoryFile({ fetch: fakeFetch(route(CHAINS_URL, recordedChains), route(VERIFIERS_URL, recordedVerifiers)), file: first });
    await refreshDirectoryFile({ fetch: fakeFetch(route(CHAINS_URL, reversedChains), route(VERIFIERS_URL, reversedVerifiers)), file: second });
    // #then
    expect(await readFile(second)).toEqual(await readFile(first));
  });

  it('leaves the existing file untouched and fails when a fetch fails', async () => {
    // #given
    const file = await tempFile();
    await writeFile(file, 'existing directory\n');
    const failing = fakeFetch(route(CHAINS_URL, recordedChains), (u) => (u === VERIFIERS_URL ? new Response('down', { status: 503 }) : undefined));
    // #when
    const run = refreshDirectoryFile({ fetch: failing, file });
    // #then
    await expect(run).rejects.toThrow(/HTTP 503/);
    expect(await readFile(file, 'utf8')).toBe('existing directory\n');
  });
});
