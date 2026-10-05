import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UpstreamHttpError, UpstreamSchemaError, type NetworkInfo } from '@ccip-dev/core';
import { fakeKeysetApi, listMessage, NETWORKS } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { crawlSources } from '../backfill/sources';

const from = (src: NetworkInfo, seed: string, sendTs: string, dst: NetworkInfo = NETWORKS.ethereum) =>
  listMessage({ id: `0x${createHash('sha256').update(seed).digest('hex')}`, sendTs, src, dst });

const eth = [
  from(NETWORKS.ethereum, 'e1', '2026-01-15T03:00:00.000Z', NETWORKS.base),
  from(NETWORKS.ethereum, 'e2', '2026-01-15T01:28:06.000Z', NETWORKS.base),
  from(NETWORKS.ethereum, 'e3', '2025-06-01T00:00:00.000Z', NETWORKS.base),
  from(NETWORKS.ethereum, 'e4', '2023-08-01T12:00:00.000Z', NETWORKS.base),
];
const base = [from(NETWORKS.base, 'b1', '2026-01-15T02:00:00.000Z'), from(NETWORKS.base, 'b2', '2024-05-01T00:00:00.000Z')];
const poison = eth[1]!;
const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const SUI = NETWORKS.sui.chainSelector;
const SOLANA = NETWORKS.solana.chainSelector;
type ListOpts = { limit: number; cursor?: string | null; sourceChainSelector?: string };

const api = (extra: ReturnType<typeof listMessage>[] = []) =>
  fakeKeysetApi({ messages: [...eth, ...base, ...extra], poison: [poison.messageId], chains: [NETWORKS.ethereum, NETWORKS.base] });
const tempDir = () => mkdtemp(path.join(tmpdir(), 'sources-'));
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const noSleep = async () => {};
const idsOf = (messages: { messageId: string }[]) => messages.map((m) => m.messageId);

async function crawledIds(dir: string): Promise<string[]> {
  const files = (await readdir(path.join(dir, 'pages'))).sort();
  const pages = await Promise.all(files.map((f) => readJson(path.join(dir, 'pages', f))));
  return idsOf(pages.flat());
}

async function writePage(dir: string, folder: string, messages: unknown[]): Promise<void> {
  await mkdir(path.join(dir, folder), { recursive: true });
  await writeFile(path.join(dir, folder, '00000.json'), JSON.stringify(messages));
}

describe('crawlSources', () => {
  it('crawls each source into its own directory, skipping the poison message, and writes a complete summary', async () => {
    const dir = await tempDir();
    const summary = await crawlSources({ dir, client: api(), sleep: noSleep });
    expect(await crawledIds(path.join(dir, 'sources', ETH))).toEqual(idsOf([eth[0]!, eth[2]!, eth[3]!]));
    expect(await crawledIds(path.join(dir, 'sources', BASE))).toEqual(idsOf(base));
    expect(summary).toEqual({
      complete: true,
      sources: [
        {
          selector: BASE,
          name: 'ethereum-mainnet-base-1',
          done: true,
          stopped_at_depth_wall: false,
          coverage_from: base[1]!.sendTimestamp,
          messages: 2,
          pages: 1,
          skipped: [],
        },
        {
          selector: ETH,
          name: 'ethereum-mainnet',
          done: true,
          stopped_at_depth_wall: false,
          coverage_from: eth[3]!.sendTimestamp,
          messages: 3,
          pages: 2,
          skipped: [
            {
              messageId: poison.messageId,
              sendTimestamp: poison.sendTimestamp,
              after: { messageId: eth[0]!.messageId, sendTimestamp: eth[0]!.sendTimestamp },
            },
          ],
        },
      ],
    });
    expect(await readJson(path.join(dir, 'sources', 'summary.json'))).toEqual(summary);
  });

  it('adds the sources seen in the global crawl pages and top-up, named from their messages', async () => {
    const dir = await tempDir();
    const bsc = from(NETWORKS.bsc, 'n1', '2025-01-01T00:00:00.000Z');
    const sol = from(NETWORKS.solana, 's1', '2025-02-01T00:00:00.000Z');
    await writePage(dir, 'pages', [eth[0], bsc]);
    await writePage(dir, 'topup', [sol, base[0]]);
    const summary = await crawlSources({ dir, client: api([bsc, sol]), sleep: noSleep });
    expect(await readJson(path.join(dir, 'sources', 'sources.json'))).toEqual([
      { selector: NETWORKS.bsc.chainSelector, name: 'binance_smart_chain-mainnet' },
      { selector: NETWORKS.solana.chainSelector, name: 'solana-mainnet' },
      { selector: BASE, name: 'ethereum-mainnet-base-1' },
      { selector: ETH, name: 'ethereum-mainnet' },
    ]);
    expect(await crawledIds(path.join(dir, 'sources', NETWORKS.solana.chainSelector))).toEqual([sol.messageId]);
    expect(summary.complete).toBe(true);
  });

  it('skips the finished sources on a re-run', async () => {
    const dir = await tempDir();
    await crawlSources({ dir, client: api(), sleep: noSleep });
    const again = api();
    const summary = await crawlSources({ dir, client: again, sleep: noSleep });
    expect(again.listCalls).toEqual([]);
    expect(summary.complete).toBe(true);
  });

  it('re-crawls a walled source on the next run', async () => {
    const dir = await tempDir();
    const healthy = api();
    const baseDown = {
      ...healthy,
      listMessages: async (opts: ListOpts) => {
        if (opts.sourceChainSelector === BASE) throw new UpstreamHttpError('GET /messages', 503);
        return healthy.listMessages(opts);
      },
    };
    const walled = await crawlSources({ dir, client: baseDown, sleep: noSleep });
    expect(walled.complete).toBe(false);
    expect(walled.sources.find((s) => s.selector === BASE)).toMatchObject({ done: true, stopped_at_depth_wall: true });

    const again = api();
    const summary = await crawlSources({ dir, client: again, sleep: noSleep });
    expect(again.listCalls.every((c) => c.sourceChainSelector === BASE)).toBe(true);
    expect(summary.complete).toBe(true);
  });

  it('records an erroring source and carries on with the others', async () => {
    const dir = await tempDir();
    await writePage(dir, 'pages', [from(NETWORKS.sui, 'r1', '2025-03-01T00:00:00.000Z')]);
    const healthy = api();
    const client = {
      ...healthy,
      listMessages: async (opts: ListOpts) => {
        if (opts.sourceChainSelector === SUI) throw new UpstreamSchemaError('GET /messages', 'data.0.sender', '{}');
        return healthy.listMessages(opts);
      },
    };
    const summary = await crawlSources({ dir, client, sleep: noSleep });
    expect(summary.complete).toBe(false);
    expect(summary.sources.find((s) => s.selector === SUI)).toEqual({
      selector: SUI,
      name: 'sui-mainnet',
      done: false,
      stopped_at_depth_wall: false,
      coverage_from: null,
      messages: 0,
      pages: 0,
      skipped: [],
      error: 'GET /messages response failed validation at data.0.sender',
    });
    expect(summary.sources.filter((s) => s.selector !== SUI).every((s) => s.done && s.error === undefined)).toBe(true);
  });

  it('records a source whose first page is a 404 as unsupported, which does not block completeness', async () => {
    const dir = await tempDir();
    await writePage(dir, 'pages', [from(NETWORKS.sui, 'r1', '2025-03-01T00:00:00.000Z')]);
    const healthy = api();
    const client = {
      ...healthy,
      listMessages: async (opts: ListOpts) => {
        if (opts.sourceChainSelector === SUI) throw new UpstreamHttpError('GET /messages', 404);
        return healthy.listMessages(opts);
      },
    };
    const summary = await crawlSources({ dir, client, sleep: noSleep });
    expect(summary.sources.find((s) => s.selector === SUI)).toEqual({
      selector: SUI,
      name: 'sui-mainnet',
      done: false,
      stopped_at_depth_wall: false,
      coverage_from: null,
      messages: 0,
      pages: 0,
      skipped: [],
      unsupported: true,
    });
    expect(summary.complete).toBe(true);
  });

  it('crawls destination chains missing from the source list, until no new one appears', async () => {
    const dir = await tempDir();
    const toSui = from(NETWORKS.ethereum, 'e-sui', '2025-07-01T00:00:00.000Z', NETWORKS.sui);
    const suiToSolana = from(NETWORKS.sui, 'sui-sol', '2025-07-02T00:00:00.000Z', NETWORKS.solana);
    const solanaToEth = from(NETWORKS.solana, 'sol-eth', '2025-07-03T00:00:00.000Z');
    const summary = await crawlSources({ dir, client: api([toSui, suiToSolana, solanaToEth]), sleep: noSleep });
    expect(await readJson(path.join(dir, 'sources', 'sources.json'))).toEqual([
      { selector: SOLANA, name: 'solana-mainnet' },
      { selector: BASE, name: 'ethereum-mainnet-base-1' },
      { selector: SUI, name: 'sui-mainnet' },
      { selector: ETH, name: 'ethereum-mainnet' },
    ]);
    expect(await crawledIds(path.join(dir, 'sources', SUI))).toEqual([suiToSolana.messageId]);
    expect(await crawledIds(path.join(dir, 'sources', SOLANA))).toEqual([solanaToEth.messageId]);
    expect(summary.complete).toBe(true);
  });

  it('leaves a source whose newest message is poison at a depth wall, with no coverage', async () => {
    const dir = await tempDir();
    const client = fakeKeysetApi({
      messages: [...eth, ...base],
      poison: [poison.messageId, base[0]!.messageId],
      chains: [NETWORKS.ethereum, NETWORKS.base],
    });
    const summary = await crawlSources({ dir, client, sleep: noSleep });
    expect(summary.sources.find((s) => s.selector === BASE)).toMatchObject({
      done: true,
      stopped_at_depth_wall: true,
      coverage_from: null,
      messages: 0,
    });
    expect(summary.complete).toBe(false);
  });

  it('is not complete when there is no source at all', async () => {
    const dir = await tempDir();
    const summary = await crawlSources({ dir, client: fakeKeysetApi({ messages: [] }), sleep: noSleep });
    expect(summary).toEqual({ complete: false, sources: [] });
  });
});
