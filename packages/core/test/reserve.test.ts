import { describe, expect, it } from 'vitest';
import { LINK_RESERVE, LINK_TOKEN, readLinkBalance } from '../src/reserve';
import { fakeFetch, jsonResponse } from '../src/testing';

const BALANCE = 6122201n * 10n ** 18n;

describe('readLinkBalance', () => {
  it('calls balanceOf(reserve) on the LINK token', async () => {
    const f = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: `0x${BALANCE.toString(16)}` }));
    await expect(readLinkBalance({ fetch: f }, ['https://rpc.one'])).resolves.toBe(BALANCE);
    const body = JSON.parse(String(f.calls[0]!.init?.body));
    expect(body.params[0]).toEqual({ to: LINK_TOKEN, data: `0x70a08231${LINK_RESERVE.slice(2).toLowerCase().padStart(64, '0')}` });
  });

  it('falls back to the next endpoint', async () => {
    const f = fakeFetch((url) =>
      url.includes('one') ? jsonResponse({}, 500) : jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' }),
    );
    await expect(readLinkBalance({ fetch: f }, ['https://rpc.one', 'https://rpc.two'])).resolves.toBe(1n);
  });

  it('never puts endpoint URLs (which may contain API keys) in its error', async () => {
    const f = fakeFetch(() => jsonResponse({ error: { message: 'boom' } }));
    const err = await readLinkBalance({ fetch: f }, ['https://key-SECRET.example/v1']).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('SECRET');
  });
});
