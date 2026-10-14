import { buildLabelIndex, buildProjectRegistry, type RegistryProject } from '@ccip-dev/core';
import { PUBLIC_SCHEMAS } from '@ccip-dev/core/public';
import { NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_DAY, XSTOCKS_TOTALS, xstocksBreakdown } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProjects } from '../src/projects';
import { publishHistoryFiles } from '../src/publish';
import * as store from '../src/store';
import { harness, liveRow, readPublic, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-14T00:07:00.000Z';
const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const SOL = NETWORKS.solana.chainSelector;
const INK = NETWORKS.ink.chainSelector;
const XLAYER = NETWORKS.xlayer.chainSelector;
const HYPER = NETWORKS.hyperliquid.chainSelector;
const IDLE_ADDRESS = '0x00000000000000000000000000000000000000aa';

/** xStocks labeled on Ink and Solana only, so its other EVM chains come through label spread; Monad is not in the chains table. */
const XSTOCKS: RegistryProject = {
  name: 'xStocks', x: 'xStocksFi', url: 'https://xstocks.fi', kind: 'protocol', verified: true, spread: true, slug: 'xstocks',
  source: 'https://api.xstocks.fi/api/v2/public/bridges',
  addresses: [
    { chain: 'ethereum-mainnet-ink-1', address: XBRIDGE_EVM, note: 'xBridge (Ink)' },
    { chain: 'solana-mainnet', address: XBRIDGE_SOLANA, note: 'xBridge sender' },
    { chain: 'monad-mainnet', address: XBRIDGE_EVM },
  ],
  tokens: [],
};
const IDLE: RegistryProject = { name: 'Idle', kind: 'app', verified: true, spread: true, slug: 'idle', source: null, addresses: [{ chain: 'ethereum-mainnet', address: IDLE_ADDRESS }], tokens: [] };
const context = () => harness({ now: NOW, labels: buildLabelIndex([XSTOCKS, IDLE]), projects: buildProjectRegistry([XSTOCKS, IDLE]) });
const build = async () => buildProjects(context().c, XSTOCKS_DAY);
const xstocks = async () => (await build()).projects.find((p) => p.slug === 'xstocks')!;

beforeEach(async () => {
  // #given 2026-10-13's senders, 100 xBridge messages from Ink on Oct 1 (a day of 400), and three xStocks messages for its lanes
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc, NETWORKS.solana, NETWORKS.ink, NETWORKS.xlayer, NETWORKS.hyperliquid], []);
  await store.replaceDaily(env.DB, XSTOCKS_TOTALS, xstocksBreakdown(), NOW);
  await store.replaceDaily(env.DB, { ...XSTOCKS_TOTALS, day: '2026-10-01', messages: 400 }, [
    { day: '2026-10-01', dim: 'sender', key: `${INK}:${XBRIDGE_EVM}`, messages: 100, usd_value: 0, fee_usd: 25 },
  ], NOW);
  await store.upsertListRows(env.DB, [
    liveRow({ id: 'x1', sendTs: '2026-10-13T10:00:00.000Z', src: NETWORKS.ink, dst: NETWORKS.base, sender: XBRIDGE_EVM }),
    liveRow({ id: 'x2', sendTs: '2026-10-13T10:01:00.000Z', src: NETWORKS.ink, dst: NETWORKS.base, sender: XBRIDGE_EVM }),
    liveRow({ id: 'x3', sendTs: '2026-10-13T10:02:00.000Z', src: NETWORKS.solana, dst: NETWORKS.ethereum, sender: XBRIDGE_SOLANA }, { token_count: 1, usd_value: 500 }),
  ], []);
});

describe('projects.json', () => {
  it('gives a project its 7-day, 30-day and all-time totals and its share of all messages', async () => {
    // #then 319 of 1,569 over 7 days; 419 of 1,969 over 30 days and all time
    expect((await xstocks()).totals).toEqual({
      '7d': { messages: 319, usd: 0, fee_usd: 79.75, share_pct: 20.3 },
      '30d': { messages: 419, usd: 0, fee_usd: 104.75, share_pct: 21.3 },
      all: { messages: 419, usd: 0, fee_usd: 104.75, share_pct: 21.3 },
    });
  });

  it('gives a 30-day daily series with a zero for each quiet day', async () => {
    // #when
    const { series } = await xstocks();
    // #then
    expect({ length: series.length, first: series[0]?.day, busy: series.filter((s) => s.messages > 0) }).toEqual({
      length: 30,
      first: '2026-09-14',
      busy: [{ day: '2026-10-01', messages: 100 }, { day: XSTOCKS_DAY, messages: 319 }],
    });
  });

  it('lists its source chains busiest first, its top lanes and its data split, over 30 days', async () => {
    // #when
    const { chains, lanes, split } = await xstocks();
    // #then
    expect({ chains, lanes, split }).toEqual({
      chains: [INK, SOL, XLAYER, BSC, ETH, HYPER],
      lanes: [{ src: INK, dst: BASE, messages: 2, usd: 0 }, { src: SOL, dst: ETH, messages: 1, usd: 500 }],
      split: { data_messages: 2, token_messages: 1 },
    });
  });

  it("lists its label file's addresses on chains CCIP knows, then those a spread label credited, marked inferred", async () => {
    // #then
    expect((await xstocks()).addresses).toEqual([
      { chain: INK, address: XBRIDGE_EVM, note: 'xBridge (Ink)', inferred: false },
      { chain: SOL, address: XBRIDGE_SOLANA, note: 'xBridge sender', inferred: false },
      { chain: XLAYER, address: XBRIDGE_EVM, note: null, inferred: true },
      { chain: BSC, address: XBRIDGE_EVM, note: null, inferred: true },
      { chain: ETH, address: XBRIDGE_EVM, note: null, inferred: true },
      { chain: HYPER, address: XBRIDGE_EVM, note: null, inferred: true },
    ]);
  });

  it('lists a project with no activity after the busy ones, with zeros, an empty series and its addresses', async () => {
    // #when
    const { projects } = await build();
    const idle = projects.find((p) => p.slug === 'idle')!;
    // #then
    expect({
      order: projects.map((p) => p.slug),
      week: idle.totals['7d'],
      series: idle.series.every((s) => s.messages === 0),
      rest: [idle.chains, idle.lanes, idle.split, idle.addresses],
    }).toEqual({
      order: ['xstocks', 'idle'],
      week: { messages: 0, usd: 0, fee_usd: null, share_pct: 0 },
      series: true,
      rest: [[], [], { data_messages: 0, token_messages: 0 }, [{ chain: ETH, address: IDLE_ADDRESS, note: null, inferred: false }]],
    });
  });

  it('is published with the history files and matches its public schema', async () => {
    // #when
    await publishHistoryFiles(context().c);
    // #then
    const file = await readPublic('projects.json');
    expect({ valid: PUBLIC_SCHEMAS['projects.json'].safeParse(file).success, from: file.from, to: file.to }).toEqual({ valid: true, from: '2026-09-14', to: XSTOCKS_DAY });
  });

  it('raises one projects-publish alert when it fails, and still publishes the other history files', async () => {
    // #given
    vi.spyOn(store, 'senderLanes').mockRejectedValueOnce(new Error('D1 unavailable'));
    const { c, alerts } = context();
    // #when
    await publishHistoryFiles(c);
    // #then
    expect({
      projects: await env.PUBLIC.get('v1/projects.json'),
      history: (await env.PUBLIC.get('v1/history.json')) !== null,
      alerts: alerts.filter((a) => a.signature === 'projects-publish'),
    }).toEqual({ projects: null, history: true, alerts: [{ signature: 'projects-publish', text: 'projects.json was not published: D1 unavailable' }] });
  });

  it('does not widen a project with spread off to another chain, or mark any address inferred', async () => {
    // #given the address sends on Base too, but its file lists Ink only and sets spread = false
    const pinned: RegistryProject = { name: 'Pinned', kind: 'app', verified: true, spread: false, slug: 'pinned', source: null, addresses: [{ chain: 'ethereum-mainnet-ink-1', address: IDLE_ADDRESS }], tokens: [] };
    await store.replaceDaily(env.DB, { ...XSTOCKS_TOTALS, day: '2026-10-02', messages: 50 }, [
      { day: '2026-10-02', dim: 'sender', key: `${INK}:${IDLE_ADDRESS}`, messages: 10, usd_value: 0, fee_usd: 1 },
      { day: '2026-10-02', dim: 'sender', key: `${BASE}:${IDLE_ADDRESS}`, messages: 5, usd_value: 0, fee_usd: 1 },
    ], NOW);
    const c = harness({ now: NOW, labels: buildLabelIndex([pinned]), projects: buildProjectRegistry([pinned]) }).c;
    // #when
    const project = (await buildProjects(c, XSTOCKS_DAY)).projects.find((p) => p.slug === 'pinned')!;
    // #then
    expect({ chains: project.chains, inferred: project.addresses.filter((a) => a.inferred) }).toEqual({ chains: [INK], inferred: [] });
  });
});
