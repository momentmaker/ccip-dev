import { describe, expect, it, vi } from 'vitest';
import { createCcipClient, listAllTokens } from '../src/ccip/client';
import { DetailMessage } from '../src/ccip/schemas';
import { UpstreamSchemaError } from '../src/http';
import { fakeCcip, fakeFetch, instantDeps, jsonResponse } from '../src/testing';
import listPage from './fixtures/list-page.json';
import detailToken from './fixtures/detail-token.json';
import detailV16 from './fixtures/detail-v16.json';

describe('createCcipClient', () => {
  it('lists mainnet messages with limit and cursor and keeps raw objects aligned', async () => {
    const f = fakeFetch(() => jsonResponse(listPage));
    const client = createCcipClient(instantDeps(f), { minIntervalMs: 0 });
    const page = await client.listMessages({ limit: 4, cursor: 'abc' });
    const url = new URL(f.calls[0]!.url);
    expect(url.pathname).toBe('/v2/messages');
    expect(url.searchParams.get('environment')).toBe('mainnet');
    expect(url.searchParams.get('limit')).toBe('4');
    expect(url.searchParams.get('cursor')).toBe('abc');
    expect(page.messages).toHaveLength(4);
    expect(page.raw[0]).toEqual(listPage.data[0]);
    expect(page.cursor).toBe('CURSOR_PAGE_2');
  });

  it('filters by source chain on the first page only, because later cursors carry the filter', async () => {
    const f = fakeFetch(() => jsonResponse(listPage));
    const client = createCcipClient(instantDeps(f), { minIntervalMs: 0 });
    await client.listMessages({ limit: 4, sourceChainSelector: '5009297550715157269' });
    await client.listMessages({ limit: 4, cursor: 'abc', sourceChainSelector: '5009297550715157269' });
    const [first, next] = f.calls.map((c) => new URL(c.url).searchParams);
    expect(first!.get('sourceChainSelector')).toBe('5009297550715157269');
    expect(next!.has('sourceChainSelector')).toBe(false);
    expect(next!.get('cursor')).toBe('abc');
  });

  it('accepts a null destination displayName and returns the message with it null', async () => {
    const suiDest = { ...listPage.data[0]!.destNetworkInfo, name: 'sui-mainnet', displayName: null };
    const body = { ...listPage, data: [{ ...listPage.data[0], destNetworkInfo: suiDest }, ...listPage.data.slice(1)] };
    const client = createCcipClient(instantDeps(fakeFetch(() => jsonResponse(body))), { minIntervalMs: 0 });
    const page = await client.listMessages({ limit: 4 });
    expect(page.messages[0]!.destNetworkInfo.displayName).toBeNull();
  });

  it('reports no next page when hasNextPage is true but the cursor is missing', async () => {
    const body = { ...listPage, pagination: { hasNextPage: true } };
    const client = createCcipClient(instantDeps(fakeFetch(() => jsonResponse(body))), { minIntervalMs: 0 });
    expect((await client.listMessages({ limit: 4 })).cursor).toBeNull();
  });

  it('rejects a page whose message lacks messageId with the failing path', async () => {
    const broken = { ...listPage, data: [{ ...listPage.data[0], messageId: undefined }] };
    const client = createCcipClient(instantDeps(fakeFetch(() => jsonResponse(broken))), { minIntervalMs: 0 });
    await expect(client.listMessages({ limit: 1 })).rejects.toMatchObject({
      name: 'UpstreamSchemaError',
      path: 'data.0.messageId',
    } satisfies Partial<UpstreamSchemaError>);
  });

  it('rejects a token amount that is not an unsigned integer string', async () => {
    const broken = { ...listPage, data: [{ ...listPage.data[0], sourceTokenAmount: { tokenAddress: '0x1', tokenAmount: '1.5' } }] };
    const client = createCcipClient(instantDeps(fakeFetch(() => jsonResponse(broken))), { minIntervalMs: 0 });
    await expect(client.listMessages({ limit: 1 })).rejects.toBeInstanceOf(UpstreamSchemaError);
  });

  it('returns raw detail JSON that DetailMessage parses for v2.0 and v1.6 shapes', async () => {
    const client = createCcipClient(
      instantDeps(fakeFetch((url) => jsonResponse(url.endsWith(detailToken.messageId) ? detailToken : detailV16))),
      { minIntervalMs: 0 },
    );
    const raw = await client.getMessageRaw(detailToken.messageId);
    expect(DetailMessage.parse(raw).tokenAmounts[0]!.amount).toBe('24000580226526875891506');
    expect(DetailMessage.parse(await client.getMessageRaw(detailV16.messageId)).tokenAmounts).toEqual([]);
  });

  it('lists chains (dropping fields we do not read) and paginates tokens', async () => {
    const upstream = listPage.data[0]!.sourceNetworkInfo;
    const { isPrivate: _isPrivate, deprecated: _deprecated, ...chain } = upstream;
    const token = { chainSelector: '1', address: '0xA', symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'g' };
    const f = fakeFetch((url) =>
      url.includes('/chains')
        ? jsonResponse({ chains: [upstream] })
        : jsonResponse({ data: [token], pagination: { hasNextPage: true, cursor: 'T2' } }),
    );
    const client = createCcipClient(instantDeps(f), { minIntervalMs: 0 });
    expect(await client.listChains()).toEqual([chain]);
    expect(await client.listTokens({ limit: 1 })).toEqual({ tokens: [token], cursor: 'T2' });
  });
});

describe('listTokens with a bad registry entry', () => {
  const good = { chainSelector: '1', address: '0xA', symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'g' };
  const xGold = { chainSelector: '3229138320728879060', address: '0x3FA41d2b29c69F8DA6E2D0bFc4f83C62D6582750', symbol: 'xGold', name: 'xGold', decimals: null, groupId: 'x' };

  it('skips an entry that fails validation, as xGold with null decimals did, and keeps the rest of the page', async () => {
    // #given
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = createCcipClient(instantDeps(fakeFetch(() => jsonResponse({ data: [good, xGold], pagination: { hasNextPage: false } }))), { minIntervalMs: 0 });
    // #when
    const page = await client.listTokens({ limit: 2 });
    const warned = warn.mock.calls.map((c) => String(c[0]).includes('xGold') && String(c[0]).includes('0x3FA41d2b29c69F8DA6E2D0bFc4f83C62D6582750'));
    warn.mockRestore();
    // #then
    expect({ tokens: page.tokens, warned }).toEqual({
      tokens: [good],
      warned: [true],
    });
  });

  it('still fails when the page itself is malformed', async () => {
    // #given
    const client = createCcipClient(instantDeps(fakeFetch(() => jsonResponse({ data: [good] }))), { minIntervalMs: 0 });
    // #then
    await expect(client.listTokens({ limit: 1 })).rejects.toBeInstanceOf(UpstreamSchemaError);
  });
});

describe('listAllTokens', () => {
  it('follows the cursor through every page of the registry', async () => {
    const tokens = Array.from({ length: 501 }, (_, i) => ({
      chainSelector: '1', address: `0x${i.toString(16).padStart(40, '0')}`, symbol: 'T', name: 'T', decimals: 18, groupId: null,
    }));
    expect(await listAllTokens(fakeCcip({ tokens }))).toEqual(tokens);
  });
});
