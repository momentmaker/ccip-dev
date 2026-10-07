import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';

const today = {
  schema_version: 1, updated_at: '2026-10-07T00:00:00.000Z', attribution: 'Data: Chainlink CCIP API, DefiLlama', day: '2026-10-07',
  totals: { day: '2026-10-07', messages: 44, token_messages: 40, usd_value: 9467.03, fee_usd: 22.59, unique_senders: 20, median_delivery_s: 62, unpriced_messages: 0, fee_link_usd: 0, fee_link_share_pct: 0 },
  top: { lane: [], token: [], sender: [] },
  arrivals: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('site Worker', () => {
  it('renders the home card as a real 1200×630 PNG', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(today)));
    const env = {
      ASSETS: {
        fetch: async (req: Request | string) =>
          new URL(typeof req === 'string' ? req : req.url).pathname === '/layout.json' ? Response.json([{ selector: 'a', x: 1, y: 0 }]) : new Response('missing', { status: 404 }),
      },
    };
    const pending: Promise<unknown>[] = [];
    const res = await worker.fetch(new Request('https://ccip.dev/og/home.png'), env as never, { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as never);
    await Promise.all(pending);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(1200);
    expect(new DataView(bytes.buffer).getUint32(20)).toBe(630);
  });

  it('passes every other path to the static assets', async () => {
    const env = { ASSETS: { fetch: async () => new Response('asset') } };
    const res = await worker.fetch(new Request('https://ccip.dev/about/'), env as never, {} as never);
    expect(await res.text()).toBe('asset');
  });
});
