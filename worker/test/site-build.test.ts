import { fakeCcip } from '@ccip-dev/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { runFinalize } from '../src/jobs/finalize';
import { SITE_DISPATCH_URL, triggerSiteBuild } from '../src/site-build';
import * as store from '../src/store';
import { harness, resetStorage } from './helpers';

const NOW = '2026-10-11T00:10:00Z';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetch(status: number): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetch: fake };
}

describe('triggerSiteBuild', () => {
  it('does nothing without a dispatch token', async () => {
    // #given
    const net = recordingFetch(204);
    const h = harness({ now: NOW, fetch: net.fetch, env: { GITHUB_DISPATCH_TOKEN: undefined } });
    // #when
    await triggerSiteBuild(h.c);
    // #then
    expect({ calls: net.calls.length, alerts: h.alerts }).toEqual({ calls: 0, alerts: [] });
  });

  it('dispatches the site workflow on main with the token', async () => {
    // #given
    const net = recordingFetch(204);
    const h = harness({ now: NOW, fetch: net.fetch, env: { GITHUB_DISPATCH_TOKEN: 'tok' } });
    // #when
    await triggerSiteBuild(h.c);
    // #then
    const [call] = net.calls;
    const headers = new Headers(call?.init?.headers);
    expect({
      url: call?.url,
      method: call?.init?.method,
      body: call?.init?.body,
      auth: headers.get('authorization'),
      accept: headers.get('accept'),
      alerts: h.alerts,
    }).toEqual({
      url: SITE_DISPATCH_URL,
      method: 'POST',
      body: JSON.stringify({ ref: 'main' }),
      auth: 'Bearer tok',
      accept: 'application/vnd.github+json',
      alerts: [],
    });
  });

  it('alerts once, without throwing, when GitHub refuses the dispatch', async () => {
    // #given
    const net = recordingFetch(403);
    const h = harness({ now: NOW, fetch: net.fetch, env: { GITHUB_DISPATCH_TOKEN: 'tok' } });
    // #when
    await triggerSiteBuild(h.c);
    // #then
    expect(h.alerts.map((a) => a.signature)).toEqual(['site-dispatch']);
  });

  it('alerts, without throwing, when the request itself fails', async () => {
    // #given
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const h = harness({ now: NOW, fetch: failing, env: { GITHUB_DISPATCH_TOKEN: 'tok' } });
    // #when
    await triggerSiteBuild(h.c);
    // #then
    expect(h.alerts).toEqual([{ signature: 'site-dispatch', text: expect.stringContaining('network down') }]);
  });
});

describe('finalize triggers a site build', () => {
  beforeEach(resetStorage);

  it('dispatches the site workflow after publishing history', async () => {
    // #given yesterday is due, with no messages, and a dispatch token is set
    const net = recordingFetch(204);
    const h = harness({ now: NOW, ccip: fakeCcip({ messages: [] }), fetch: net.fetch, env: { GITHUB_DISPATCH_TOKEN: 'tok' } });
    await store.setMeta(h.c.env.DB, 'live_start_day', '2026-10-10');
    // #when
    await runFinalize(h.c, 'early');
    // #then
    expect(net.calls.filter((c) => c.url === SITE_DISPATCH_URL)).toHaveLength(1);
  });
});

