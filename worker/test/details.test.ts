import { COIN_PRICE_DECIMALS, coingeckoKey, UpstreamHttpError } from '@ccip-dev/core';
import { fakeCcip, fakePrices, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import detailToken from '../../packages/core/test/fixtures/detail-token.json';
import { DetailFillError, runDetails } from '../src/jobs/details';
import * as store from '../src/store';
import { COINGECKO_IDS_SQL, harness, liveRow, resetStorage, seedRegistry, TOKEN_GROUPS_SQL, watchedDb } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-05T11:20:00.000Z';
const TOKEN_KEY = 'base:0x9818b6c09f5ecc843060927e8587c427c7c93583';
const FEE_KEY = 'base:0x4200000000000000000000000000000000000006';
const due = (id: string, extras = {}) => liveRow({ id, sendTs: '2026-10-05T11:14:53.000Z' }, { next_check_at: '2026-10-05T11:16:53.000Z', ...extras });
const row = (id: string) => env.DB.prepare('SELECT * FROM messages WHERE message_id = ?').bind(id).first<Record<string, unknown>>();
const SIBLING = '0xcccccccccccccccccccccccccccccccccccccccc';
const SIBLING_KEY = `ethereum:${SIBLING}`;
const seenAt = (key: string) => env.DB.prepare('SELECT seen_at FROM prices_latest WHERE llama_key = ?').bind(key).first<{ seen_at: string }>();

/** The detail fixture's base token (18 decimals) and a 6-decimal copy on Ethereum, in one CCIP token group. */
async function seedTokenGroup(): Promise<void> {
  await seedRegistry([NETWORKS.base, NETWORKS.ethereum], [
    { chainSelector: NETWORKS.base.chainSelector, address: '0x9818B6c09f5ECc843060927E8587c427C7C93583', symbol: 'TKN', name: 'Token', decimals: 18, groupId: 'g' },
    { chainSelector: NETWORKS.ethereum.chainSelector, address: SIBLING, symbol: 'TKN', name: 'Token', decimals: 6, groupId: 'g' },
  ]);
}

describe('runDetails', () => {
  it('fills tokens, fee and value from the detail and schedules the next check', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = fakePrices({ latest: { [TOKEN_KEY]: { price: 1, decimals: 18 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(await row(detailToken.messageId)).toMatchObject({
      token_count: 1,
      unpriced: 0,
      fee_token: '0x4200000000000000000000000000000000000006',
      fee_amount: '106697113670237',
      detail_fetched_at: NOW,
      next_check_at: '2026-10-05T11:30:00.000Z',
    });
    expect((await row(detailToken.messageId))!.usd_value).toBeCloseTo(24000.580226526876, 6);
    expect((await row(detailToken.messageId))!.fee_usd).toBeCloseTo(0.26674278417559, 9);
    expect(prices.latestCalls).toEqual([[TOKEN_KEY, FEE_KEY]]);
    expect(await store.getPrices(env.DB, [TOKEN_KEY])).toEqual(new Map([[TOKEN_KEY, { price: 1, decimals: 18 }]]));
  });

  it('fetches again a price stored more than 15 minutes ago and values the message with the newer one', async () => {
    await store.upsertPrices(env.DB, new Map([[TOKEN_KEY, { price: 0.5, decimals: 18 }]]), '2026-10-05T09:20:00.000Z');
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = fakePrices({ latest: { [TOKEN_KEY]: { price: 1, decimals: 18 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(prices.latestCalls).toEqual([[TOKEN_KEY, FEE_KEY]]);
    expect((await row(detailToken.messageId))!.usd_value).toBeCloseTo(24000.580226526876, 6);
    expect(await env.DB.prepare('SELECT usd, ts FROM prices_latest WHERE llama_key = ?').bind(TOKEN_KEY).first()).toEqual({ usd: 1, ts: NOW });
  });

  it('rejects a re-fetched price that jumps over 20x from the stored one, values with the stored price and alerts', async () => {
    const STALE = '2026-10-05T09:20:00.000Z';
    await store.upsertPrices(env.DB, new Map([[TOKEN_KEY, { price: 0.04, decimals: 18 }]]), STALE);
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = fakePrices({ latest: { [TOKEN_KEY]: { price: 1, decimals: 18 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect({
      stored: await env.DB.prepare('SELECT usd, ts FROM prices_latest WHERE llama_key = ?').bind(TOKEN_KEY).first(),
      usdValue: (await row(detailToken.messageId))!.usd_value,
      alerts,
    }).toEqual({
      stored: { usd: 0.04, ts: STALE },
      usdValue: expect.closeTo(24000.580226526876 * 0.04, 6),
      alerts: [{ signature: 'price-jump', text: `Detail price fetch rejected 1 jump(s) over 20×: ${TOKEN_KEY} 0.04 → 1` }],
    });
  });

  it('still applies the detail, without a misleading prices-fetch alert, when the price-jump alert itself fails', async () => {
    await store.upsertPrices(env.DB, new Map([[TOKEN_KEY, { price: 0.04, decimals: 18 }]]), '2026-10-05T09:20:00.000Z');
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = fakePrices({ latest: { [TOKEN_KEY]: { price: 1, decimals: 18 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    const raised: string[] = [];
    const alert = async (signature: string) => {
      if (signature === 'price-jump') throw new Error('D1 unavailable');
      raised.push(signature);
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runDetails({ ...c, alert }, { limit: 10 });
    const errors = logged.mock.calls.map((args) => String(args[0]));
    logged.mockRestore();
    expect({ filled: (await row(detailToken.messageId))!.detail_fetched_at, raised, errors }).toEqual({
      filled: NOW,
      raised: [],
      errors: ['price-jump alert failed: D1 unavailable'],
    });
  });

  describe('the jump guard against a price the prices job no longer tracks', () => {
    const DORMANT = '2026-08-20T00:00:00.000Z';
    const fillAt1 = async () => {
      await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
      const prices = fakePrices({ latest: { [TOKEN_KEY]: { price: 1, decimals: 18 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
      const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
      await runDetails(c, { limit: 10 });
      return {
        stored: await env.DB.prepare('SELECT usd, ts FROM prices_latest WHERE llama_key = ?').bind(TOKEN_KEY).first(),
        usdValue: (await row(detailToken.messageId))!.usd_value,
        alerts: alerts.map((a) => a.signature),
      };
    };

    it('accepts the new price of a token last seen more than 30 days ago, however far it moved', async () => {
      await store.upsertPrices(env.DB, new Map([[TOKEN_KEY, { price: 0.04, decimals: 18 }]]), DORMANT);
      expect(await fillAt1()).toEqual({
        stored: { usd: 1, ts: NOW },
        usdValue: expect.closeTo(24000.580226526876, 6),
        alerts: [],
      });
    });

    it('still rejects the jump when the stored price is old but the token was seen within 30 days', async () => {
      await store.upsertPrices(env.DB, new Map([[TOKEN_KEY, { price: 0.04, decimals: 18 }]]), DORMANT);
      await store.touchPrices(env.DB, [TOKEN_KEY], '2026-10-05T11:00:00.000Z');
      expect(await fillAt1()).toEqual({
        stored: { usd: 0.04, ts: DORMANT },
        usdValue: expect.closeTo(24000.580226526876 * 0.04, 6),
        alerts: ['price-jump'],
      });
    });
  });

  it('uses a price stored within the last 15 minutes without fetching it', async () => {
    await store.upsertPrices(env.DB, new Map([[TOKEN_KEY, { price: 1, decimals: 18 }]]), '2026-10-05T11:10:00.000Z');
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = fakePrices({ latest: { [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(prices.latestCalls).toEqual([[FEE_KEY]]);
  });

  it('fetches a group sibling\'s price for a token DefiLlama does not price and values the token with its own decimals', async () => {
    await seedTokenGroup();
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = fakePrices({ latest: { [SIBLING_KEY]: { price: 2, decimals: 6 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(prices.latestCalls).toEqual([[TOKEN_KEY, FEE_KEY], [SIBLING_KEY]]);
    expect(await row(detailToken.messageId)).toMatchObject({ unpriced: 0 });
    expect((await row(detailToken.messageId))!.usd_value).toBeCloseTo(48001.16045305375, 6);
    expect(await env.DB.prepare('SELECT usd_value FROM message_tokens WHERE message_id = ?').bind(detailToken.messageId).first<{ usd_value: number }>())
      .toEqual({ usd_value: expect.closeTo(48001.16045305375, 6) });
    expect(await seenAt(SIBLING_KEY)).toEqual({ seen_at: NOW });
  });

  it('marks a stored sibling price as seen so the prices job keeps it fresh', async () => {
    await seedTokenGroup();
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    await store.upsertPrices(env.DB, new Map([[SIBLING_KEY, { price: 2, decimals: 6 }]]), '2026-10-05T11:15:00.000Z');
    const prices = fakePrices({ latest: { [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(prices.latestCalls).toEqual([[TOKEN_KEY, FEE_KEY]]);
    expect(await seenAt(SIBLING_KEY)).toEqual({ seen_at: NOW });
    expect((await row(detailToken.messageId))!.usd_value).toBeCloseTo(48001.16045305375, 6);
  });

  it('reads the token groups only when a fill needs the fallback, once per run', async () => {
    await seedTokenGroup();
    const pricedDetail = { ...detailToken, messageId: 'priced' };
    const prices = fakePrices({ latest: { [TOKEN_KEY]: { price: 1, decimals: 18 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    await store.upsertListRows(env.DB, [due('priced')], []);
    const allPriced = watchedDb(TOKEN_GROUPS_SQL);
    await runDetails(harness({ now: NOW, ccip: fakeCcip({ details: { priced: pricedDetail } }), prices, db: allPriced.db }).c, { limit: 10 });

    await resetStorage();
    await seedTokenGroup();
    await store.upsertListRows(env.DB, [due('a'), due('b', { next_check_at: '2026-10-05T11:17:00.000Z' })], []);
    const details = { a: { ...detailToken, messageId: 'a' }, b: { ...detailToken, messageId: 'b' } };
    const needsFallback = watchedDb(TOKEN_GROUPS_SQL);
    const siblingOnly = fakePrices({ latest: { [SIBLING_KEY]: { price: 2, decimals: 6 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    await runDetails(harness({ now: NOW, ccip: fakeCcip({ details }), prices: siblingOnly, db: needsFallback.db }).c, { limit: 10 });

    expect([allPriced.prepared(), needsFallback.prepared()]).toEqual([0, 1]);
    expect((await row('b'))!.usd_value).toBeCloseTo(48001.16045305375, 6);
  });

  describe('through a CoinGecko coin', () => {
    const COIN_KEY = coingeckoKey('tkn');
    const TOKEN = '0x9818b6c09f5ecc843060927e8587c427c7c93583';
    const coinPrices = () => fakePrices({ latest: { [COIN_KEY]: { price: 2, decimals: COIN_PRICE_DECIMALS }, [FEE_KEY]: { price: 2500, decimals: 18 } } });

    /** The detail fixture's base token, alone in the registry, mapped to the CoinGecko coin `tkn`. */
    async function seedCoin(): Promise<void> {
      await seedRegistry([NETWORKS.base], [
        { chainSelector: NETWORKS.base.chainSelector, address: TOKEN, symbol: 'TKN', name: 'Token', decimals: 18, groupId: null },
      ]);
      await store.replaceCoingeckoIds(env.DB, [{ chain: NETWORKS.base.chainSelector, address: TOKEN, coinId: 'tkn' }], NOW);
    }

    it('fetches the coin\'s price for a token neither its own key nor a sibling prices, values it, and marks it seen', async () => {
      await seedCoin();
      await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
      const prices = coinPrices();
      const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
      await runDetails(c, { limit: 10 });
      expect(prices.latestCalls).toEqual([[TOKEN_KEY, FEE_KEY], [COIN_KEY]]);
      expect(await row(detailToken.messageId)).toMatchObject({ unpriced: 0, usd_value: expect.closeTo(48001.16045305375, 6) });
      expect(await seenAt(COIN_KEY)).toEqual({ seen_at: NOW });
    });

    it('reads the CoinGecko ids only when a fill is still unpriced after its group, once per run', async () => {
      await seedTokenGroup();
      await store.upsertListRows(env.DB, [due('priced')], []);
      const siblingOnly = fakePrices({ latest: { [SIBLING_KEY]: { price: 2, decimals: 6 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
      const groupPriced = watchedDb(COINGECKO_IDS_SQL);
      const pricedDetails = { priced: { ...detailToken, messageId: 'priced' } };
      const groupRun = harness({ now: NOW, ccip: fakeCcip({ details: pricedDetails }), prices: siblingOnly, db: groupPriced.db });
      await runDetails(groupRun.c, { limit: 10 });

      await resetStorage();
      await seedCoin();
      await store.upsertListRows(env.DB, [due('a'), due('b', { next_check_at: '2026-10-05T11:17:00.000Z' })], []);
      const details = { a: { ...detailToken, messageId: 'a' }, b: { ...detailToken, messageId: 'b' } };
      const needsCoin = watchedDb(COINGECKO_IDS_SQL);
      await runDetails(harness({ now: NOW, ccip: fakeCcip({ details }), prices: coinPrices(), db: needsCoin.db }).c, { limit: 10 });

      expect([groupPriced.prepared(), needsCoin.prepared()]).toEqual([0, 1]);
      expect((await row('b'))!.usd_value).toBeCloseTo(48001.16045305375, 6);
    });
  });

  describe('a fee token priced through its fee price alias', () => {
    const BITLAYER = { ...NETWORKS.base, name: 'bitcoin-mainnet-bitlayer-1', displayName: 'Bitlayer', chainSelector: '7937294810946806131', chainId: '200901' };
    const WBTC = '0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f';
    const BTC_KEY = coingeckoKey('bitcoin');
    const bitlayerDetail = {
      ...detailToken,
      sourceNetworkInfo: { ...detailToken.sourceNetworkInfo, name: BITLAYER.name, displayName: BITLAYER.displayName, chainSelector: BITLAYER.chainSelector, chainId: BITLAYER.chainId },
      tokenAmounts: [],
      fees: { fixedFeesDetails: { ...detailToken.fees.fixedFeesDetails, tokenAddress: '0xff204E2681A6fA0e2C3FaDe68a1B28fb90E4Fc5F', totalAmount: '1500000000000000' } },
    };

    it('stores the fee valued at the wrapped coin, at the token decimals', async () => {
      // #given
      await store.upsertListRows(env.DB, [liveRow({ id: detailToken.messageId, sendTs: '2026-10-05T11:14:53.000Z', src: BITLAYER }, { next_check_at: '2026-10-05T11:16:53.000Z' })], []);
      const prices = fakePrices({ latest: { [BTC_KEY]: { price: 80_000, decimals: COIN_PRICE_DECIMALS } } });
      const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: bitlayerDetail } }), prices });
      // #when
      await runDetails(c, { limit: 10 });
      // #then
      expect(prices.latestCalls).toEqual([[`bitlayer:${WBTC}`, BTC_KEY]]);
      expect(await row(detailToken.messageId)).toMatchObject({ fee_token: WBTC, fee_amount: '1500000000000000', fee_usd: expect.closeTo((1.5e15 / 1e18) * 80_000, 9) });
    });
  });

  it('stores a token valued above MAX_TRANSFER_USD unpriced and raises one price-outlier alert for the run', async () => {
    const second = { ...detailToken, messageId: 'second' };
    await store.upsertListRows(env.DB, [due(detailToken.messageId), due('second')], []);
    const prices = fakePrices({ latest: { [TOKEN_KEY]: { price: 1_000_000, decimals: 18 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const ccip = fakeCcip({ details: { [detailToken.messageId]: detailToken, second } });
    const { c, alerts } = harness({ now: NOW, ccip, prices });
    await runDetails(c, { limit: 10 });
    expect(await row(detailToken.messageId)).toMatchObject({ usd_value: 0, unpriced: 1, detail_fetched_at: NOW });
    expect(await row('second')).toMatchObject({ usd_value: 0, unpriced: 1 });
    expect(await env.DB.prepare('SELECT usd_value FROM message_tokens WHERE message_id = ?').bind('second').first()).toEqual({ usd_value: null });
    expect(alerts.map((a) => a.signature)).toEqual(['price-outlier']);
    expect(alerts[0]!.text).toContain(TOKEN_KEY);
  });

  it('applies the detail unpriced and alerts when the token groups cannot be read', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const { db } = watchedDb(TOKEN_GROUPS_SQL, { fail: true });
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), db });
    await runDetails(c, { limit: 10 });
    expect(await row(detailToken.messageId)).toMatchObject({ detail_fetched_at: NOW, unpriced: 1 });
    expect(alerts.map((a) => a.signature)).toEqual(['token-groups']);
  });

  it('archives an invalid detail, pushes it back an hour, alerts once and keeps going', async () => {
    await store.upsertListRows(env.DB, [due('bad'), due(detailToken.messageId, { next_check_at: '2026-10-05T11:17:00.000Z' })], []);
    const ccip = fakeCcip({ details: { bad: { messageId: 'bad', status: 5 }, [detailToken.messageId]: detailToken } });
    const { c, alerts } = harness({ now: NOW, ccip });
    await runDetails(c, { limit: 10 });
    expect(await env.ARCHIVE.get('unparsed/bad.json')).not.toBeNull();
    expect((await row('bad'))!.next_check_at).toBe('2026-10-05T12:20:00.000Z');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.signature).toMatch(/^detail-schema:/);
    expect((await row(detailToken.messageId))!.detail_fetched_at).toBe(NOW);
  });

  describe('when one message hits an infrastructure error', () => {
    /** 'bad' fails validation, so its raw detail goes to an archive that is down; the valid detail is due after it. */
    async function runWithArchiveDown() {
      await store.upsertListRows(env.DB, [due('bad'), due(detailToken.messageId, { next_check_at: '2026-10-05T11:17:00.000Z' })], []);
      const ccip = fakeCcip({ details: { bad: { messageId: 'bad', status: 5 }, [detailToken.messageId]: detailToken } });
      const { c } = harness({ now: NOW, ccip });
      const archiveDown = { ...env.ARCHIVE, put: async () => { throw new Error('R2 unavailable'); } } as unknown as R2Bucket;
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const outcome = await runDetails({ ...c, env: { ...c.env, ARCHIVE: archiveDown } }, { limit: 10 }).then(
        () => null,
        (err: unknown) => err,
      );
      const errors = logged.mock.calls.map((args) => String(args[0]));
      logged.mockRestore();
      return { outcome, errors };
    }

    it('still fills the other due messages', async () => {
      await runWithArchiveDown();
      expect((await row(detailToken.messageId))!.detail_fetched_at).toBe(NOW);
    });

    it('logs the failure with the message id and fails the run once the batch is done', async () => {
      const { outcome, errors } = await runWithArchiveDown();
      expect({ outcome: String(outcome), errors }).toEqual({
        outcome: 'DetailFillError: 1 detail fill(s) failed; the first: bad: R2 unavailable',
        errors: ['detail fill failed for bad: R2 unavailable'],
      });
    });

    it('pushes the failed message back an hour, so a fill that keeps failing is not retried every minute', async () => {
      await runWithArchiveDown();
      expect(await row('bad')).toMatchObject({ next_check_at: '2026-10-05T12:20:00.000Z', detail_fetched_at: null });
    });

    it('stops polling a message whose fill still fails 48 hours after send', async () => {
      const old = liveRow({ id: 'old', sendTs: '2026-10-03T10:00:00.000Z' }, { next_check_at: '2026-10-05T11:00:00.000Z' });
      await store.upsertListRows(env.DB, [old], []);
      const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { old: { messageId: 'old', status: 5 } } }) });
      const archiveDown = { ...env.ARCHIVE, put: async () => { throw new Error('R2 unavailable'); } } as unknown as R2Bucket;
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      await runDetails({ ...c, env: { ...c.env, ARCHIVE: archiveDown } }, { limit: 10 }).catch(() => {});
      logged.mockRestore();
      expect(await row('old')).toMatchObject({ status: 'UNRESOLVED', next_check_at: null });
    });
  });

  it('alerts once per CCIP version when the fee format is unknown', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const odd = { ...detailToken, fees: { somethingNew: true } };
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: odd } }) });
    await runDetails(c, { limit: 10 });
    expect(alerts.map((a) => a.signature)).toEqual(['fee-version:2.0.0']);
    expect((await row(detailToken.messageId))!.fee_usd).toBeNull();
  });

  it('pushes a message back 10 minutes when the detail request fails', async () => {
    await store.upsertListRows(env.DB, [due('missing')], []);
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: {} }) });
    await runDetails(c, { limit: 10 });
    expect((await row('missing'))!.next_check_at).toBe('2026-10-05T11:30:00.000Z');
    expect(alerts).toEqual([]);
  });

  it('leaves a finalized SUCCESS message out of the queue when its re-fill fetch fails', async () => {
    const detailed = due('done', {
      status: 'SUCCESS', unpriced: 1, detail_fetched_at: '2026-10-05T11:17:00.000Z', next_check_at: null,
    });
    await store.upsertListRows(env.DB, [detailed], []);
    await runDetails(harness({ now: NOW, ccip: fakeCcip({ details: {} }) }).c, { day: '2026-10-05' });
    expect(await row('done')).toMatchObject({ status: 'SUCCESS', next_check_at: null });
  });

  it('still pushes a due SUCCESS message back 10 minutes when its first detail fetch fails', async () => {
    await store.upsertListRows(env.DB, [due('fresh', { status: 'SUCCESS' })], []);
    await runDetails(harness({ now: NOW, ccip: fakeCcip({ details: {} }) }).c, { limit: 10 });
    expect(await row('fresh')).toMatchObject({ status: 'SUCCESS', next_check_at: '2026-10-05T11:30:00.000Z' });
  });

  describe('a detail request the API answers with an error', () => {
    const apiError = () => new UpstreamHttpError('GET /messages/{id}', 503);

    it('in the per-minute run, pushes the message back 10 minutes and carries on', async () => {
      await store.upsertListRows(env.DB, [due('flaky')], []);
      await runDetails(harness({ now: NOW, ccip: fakeCcip({ details: { flaky: apiError() } }) }).c, { limit: 10 });
      expect((await row('flaky'))!.next_check_at).toBe('2026-10-05T11:30:00.000Z');
    });

    it('in day mode, pushes the message back and fails the run as a fill failure', async () => {
      await store.upsertListRows(env.DB, [due('flaky')], []);
      const outcome = await runDetails(harness({ now: NOW, ccip: fakeCcip({ details: { flaky: apiError() } }) }).c, { day: '2026-10-05' })
        .then(() => null, (err: unknown) => String(err));
      expect({ outcome, next: (await row('flaky'))!.next_check_at }).toEqual({
        outcome: 'DetailFillError: 1 detail fill(s) failed; the first: flaky: GET /messages/{id} returned HTTP 503',
        next: '2026-10-05T11:30:00.000Z',
      });
    });

    it('in day mode, does not count a 404, since the API has no detail to retry for', async () => {
      await store.upsertListRows(env.DB, [due('missing')], []);
      await expect(runDetails(harness({ now: NOW, ccip: fakeCcip({ details: {} }) }).c, { day: '2026-10-05' })).resolves.toBeUndefined();
    });

    it.each([400, 403, 410])('in day mode, does not count a permanent HTTP %i, which no retry would change', async (status) => {
      await store.upsertListRows(env.DB, [due('refused')], []);
      const ccip = fakeCcip({ details: { refused: new UpstreamHttpError('GET /messages/{id}', status) } });
      await expect(runDetails(harness({ now: NOW, ccip }).c, { day: '2026-10-05' })).resolves.toBeUndefined();
    });

    it.each([
      ['HTTP 429', new UpstreamHttpError('GET /messages/{id}', 429)],
      ['network error', new TypeError('fetch failed')],
    ])('in day mode, counts a %s as a fill failure, since a later retry can succeed', async (_, error) => {
      await store.upsertListRows(env.DB, [due('flaky')], []);
      const ccip = fakeCcip({ details: { flaky: error } });
      await expect(runDetails(harness({ now: NOW, ccip }).c, { day: '2026-10-05' })).rejects.toBeInstanceOf(DetailFillError);
    });
  });

  it('processes at most `limit` due messages, oldest first', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => due(`m${String(i).padStart(2, '0')}`, { next_check_at: `2026-10-05T11:${String(i).padStart(2, '0')}:00.000Z` }));
    await store.upsertListRows(env.DB, rows, []);
    const ccip = fakeCcip({ details: Object.fromEntries(rows.map((r) => [r.message_id, { ...detailToken, messageId: r.message_id }])) });
    await runDetails(harness({ now: NOW, ccip }).c, { limit: 10 });
    const done = await env.DB.prepare('SELECT message_id FROM messages WHERE detail_fetched_at IS NOT NULL ORDER BY message_id').all<{ message_id: string }>();
    expect(done.results.map((r) => r.message_id)).toEqual(rows.slice(0, 10).map((r) => r.message_id));
  });

  it('in day mode fills every live message of that day that lacks a detail, regardless of next_check_at', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId, { next_check_at: null })], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }) });
    await runDetails(c, { day: '2026-10-05' });
    expect((await row(detailToken.messageId))!.detail_fetched_at).toBe(NOW);
  });

  it('finalizes a detail that keeps failing once 48 hours have passed since send', async () => {
    const old = liveRow({ id: 'old', sendTs: '2026-10-03T10:00:00.000Z' }, { next_check_at: '2026-10-05T11:00:00.000Z' });
    await store.upsertListRows(env.DB, [old], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: {} }) });
    await runDetails(c, { limit: 10 });
    expect(await row('old')).toMatchObject({ status: 'UNRESOLVED', next_check_at: null });
  });

  it('keeps FAILED status but stops checking when its detail keeps failing past 48 hours', async () => {
    const old = liveRow({ id: 'old', sendTs: '2026-10-03T10:00:00.000Z' }, { status: 'FAILED', next_check_at: '2026-10-05T11:00:00.000Z' });
    await store.upsertListRows(env.DB, [old], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: {} }) });
    await runDetails(c, { limit: 10 });
    expect(await row('old')).toMatchObject({ status: 'FAILED', next_check_at: null });
  });

  it('finalizes a schema-invalid detail past 48 hours', async () => {
    const old = liveRow({ id: 'bad', sendTs: '2026-10-03T10:00:00.000Z' }, { next_check_at: '2026-10-05T11:00:00.000Z' });
    await store.upsertListRows(env.DB, [old], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { bad: { messageId: 'bad', status: 5 } } }) });
    await runDetails(c, { limit: 10 });
    expect(await row('bad')).toMatchObject({ status: 'UNRESOLVED', next_check_at: null });
  });

  it('does not demote a SUCCESS message to UNRESOLVED when its detail re-fetch fails past 48 hours', async () => {
    const old = liveRow({ id: 'old', sendTs: '2026-10-03T10:00:00.000Z' }, { status: 'SUCCESS', next_check_at: '2026-10-05T11:00:00.000Z' });
    await store.upsertListRows(env.DB, [old], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: {} }) });
    await runDetails(c, { limit: 10 });
    expect(await row('old')).toMatchObject({ status: 'SUCCESS', next_check_at: null });
  });

  it('still demotes a non-final message to UNRESOLVED when its detail fails past 48 hours', async () => {
    const old = liveRow({ id: 'old', sendTs: '2026-10-03T10:00:00.000Z' }, { next_check_at: '2026-10-05T11:00:00.000Z' });
    await store.upsertListRows(env.DB, [old], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: {} }) });
    await runDetails(c, { limit: 10 });
    expect(await row('old')).toMatchObject({ status: 'UNRESOLVED', next_check_at: null });
  });

  it('still applies the detail unpriced and alerts when the price fetch fails', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = {
      latest: async () => { throw new Error('prices down'); },
      dailyHistory: async () => new Map(),
      historicalAt: async () => new Map(),
    };
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(await row(detailToken.messageId)).toMatchObject({ detail_fetched_at: NOW, unpriced: 1 });
    expect(alerts.map((a) => a.signature)).toEqual(['prices-fetch']);
    expect(alerts[0]!.text).toContain('prices down');
  });

  it('does not alert again for the same unknown fee version after the alerter window', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const odd = { ...detailToken, fees: { somethingNew: true } };
    const { c, alerts, setNow } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: odd } }) });
    await runDetails(c, { limit: 10 });
    setNow('2026-10-05T13:30:00.000Z');
    await runDetails(c, { limit: 10 });
    expect(alerts.map((a) => a.signature)).toEqual(['fee-version:2.0.0']);
  });
});
