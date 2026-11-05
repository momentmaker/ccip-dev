import { LINK_TOKEN, sqlLiteral, type LinkFeeTokens, type NetworkInfo } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { meterD1 } from '../src/d1-meter';
import * as store from '../src/store';
import { liveRow, resetStorage } from './helpers';

beforeEach(resetStorage);

const NORMALIZED_FEE_TOKEN = "CASE WHEN fee_token LIKE '0x%' AND length(fee_token) = 42 THEN lower(fee_token) ELSE fee_token END";

/** The window-function query feeCosts ran before it ranked in the Worker, kept as the reference its rows must match. */
function referenceSql(linkTokens: LinkFeeTokens): string {
  const keys = [...linkTokens.keys()].map(sqlLiteral).join(', ');
  return `WITH priced AS (
      SELECT src_chain, dst_chain, fee_usd,
        CASE WHEN (src_chain || ':' || ${NORMALIZED_FEE_TOKEN}) IN (${keys}) THEN 1 ELSE 0 END AS is_link
      FROM messages WHERE day >= ?1 AND day <= ?2 AND fee_usd IS NOT NULL
    ), ranked AS (
      SELECT src_chain, dst_chain, fee_usd, is_link,
        ROW_NUMBER() OVER (PARTITION BY src_chain, dst_chain ORDER BY fee_usd) AS rn,
        COUNT(*) OVER (PARTITION BY src_chain, dst_chain) AS n,
        ROW_NUMBER() OVER (PARTITION BY src_chain, dst_chain, is_link ORDER BY fee_usd) AS split_rn,
        COUNT(*) OVER (PARTITION BY src_chain, dst_chain, is_link) AS split_n,
        SUM(is_link) OVER (PARTITION BY src_chain, dst_chain) AS link_n
      FROM priced
    )
    SELECT src_chain AS src, dst_chain AS dst, MAX(n) AS messages, MAX(link_n) AS link_messages,
      MAX(CASE WHEN rn = (10 * n + 99) / 100 THEN fee_usd END) AS p10_usd,
      MAX(CASE WHEN rn = (50 * n + 99) / 100 THEN fee_usd END) AS median_usd,
      MAX(CASE WHEN rn = (90 * n + 99) / 100 THEN fee_usd END) AS p90_usd,
      MAX(CASE WHEN is_link = 1 AND split_rn = (50 * split_n + 99) / 100 THEN fee_usd END) AS link_median_usd,
      MAX(CASE WHEN is_link = 0 AND split_rn = (50 * split_n + 99) / 100 THEN fee_usd END) AS gas_median_usd
    FROM ranked
    WHERE n >= ?3
    GROUP BY src_chain, dst_chain
    ORDER BY messages DESC, src, dst`;
}

const WETH_ETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ROUTES: [NetworkInfo, NetworkInfo][] = [
  [NETWORKS.ethereum, NETWORKS.base],
  [NETWORKS.ethereum, NETWORKS.bsc],
  [NETWORKS.base, NETWORKS.ethereum],
  [NETWORKS.bsc, NETWORKS.solana],
];

/** A deterministic spread of fees: repeated values, routes under and over the minimum, LINK and gas tokens mixed. */
function seededFees(count: number) {
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, i) => {
    const [src, dst] = ROUTES[Math.floor(next() * ROUTES.length)]!;
    const token = src === NETWORKS.ethereum && next() < 0.5 ? LINK_TOKEN : WETH_ETH;
    const fee = Math.round(next() * 40 * 100) / 100;
    return liveRow({ id: `f${i}`, sendTs: `2026-10-0${1 + (i % 7)}T10:00:00.000Z`, src, dst }, { fee_token: token, fee_amount: '1', fee_usd: fee });
  });
}

describe('feeCosts', () => {
  it('ranks every route as the window-function query did', async () => {
    // #given
    await store.upsertListRows(env.DB, [...seededFees(400), ...seededFees(3).map((r) => ({ ...r, message_id: `x${r.message_id}`, fee_usd: null }))], []);
    const linkTokens = await store.linkFeeTokens(env.DB);
    // #when
    const ranked = await store.feeCosts(env.DB, '2026-10-01', '2026-10-07', linkTokens, 5);
    const reference = (await env.DB.prepare(referenceSql(linkTokens)).bind('2026-10-01', '2026-10-07', 5).all<store.FeeCostRow>()).results;
    // #then
    expect({ ranked, someLink: ranked.some((r) => r.link_messages > 0) }).toEqual({ ranked: reference, someLink: true });
  });

  it('leaves out a route below the minimum, as the query did', async () => {
    // #given
    await store.upsertListRows(env.DB, seededFees(60), []);
    const linkTokens = await store.linkFeeTokens(env.DB);
    // #when
    const ranked = await store.feeCosts(env.DB, '2026-10-01', '2026-10-07', linkTokens, 20);
    const reference = (await env.DB.prepare(referenceSql(linkTokens)).bind('2026-10-01', '2026-10-07', 20).all<store.FeeCostRow>()).results;
    // #then
    expect(ranked).toEqual(reference);
  });

  it('reads each priced fee of the window once', async () => {
    // #given 400 priced fees in the window
    await store.upsertListRows(env.DB, seededFees(400), []);
    const meter = meterD1(env.DB);
    // #when
    await store.feeCosts(meter.db, '2026-10-01', '2026-10-07', await store.linkFeeTokens(env.DB), 5);
    // #then
    expect({ queries: meter.usage().queries, rowsRead: meter.usage().rowsRead <= 401 }).toEqual({ queries: 1, rowsRead: true });
  });
});
