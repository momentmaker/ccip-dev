import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlerter } from '../src/alerts';
import type { Deps } from '../src/deps';
import { resetStorage } from './helpers';

beforeEach(resetStorage);

function setup(token?: string, respond: () => Response = () => jsonResponse({ ok: true })) {
  let now = new Date('2026-10-08T12:00:00.000Z');
  const f = fakeFetch(respond);
  const deps: Deps = { fetch: f, sleep: async () => {}, clock: () => 0, now: () => now };
  const alert = createAlerter(env.DB, { token, chatId: '42' }, deps);
  return { alert, f, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

describe('createAlerter', () => {
  it('sends a Telegram message to the configured chat', async () => {
    const { alert, f } = setup('TOKEN');
    await alert('ingest-lag', 'Ingest is 12 minutes behind');
    expect(f.calls[0]!.url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(JSON.parse(String(f.calls[0]!.init?.body))).toEqual({ chat_id: '42', text: 'ccip.dev alert: Ingest is 12 minutes behind' });
  });

  it('suppresses the same signature for one hour but not other signatures', async () => {
    const { alert, f, advance } = setup('TOKEN');
    await alert('a', 'one');
    await alert('a', 'two');
    await alert('b', 'three');
    expect(f.calls).toHaveLength(2);
    advance(3_600_001);
    await alert('a', 'four');
    expect(f.calls).toHaveLength(3);
  });

  it('sends once when two runs raise the same signature at the same time', async () => {
    const first = setup('TOKEN');
    const second = setup('TOKEN');
    await Promise.all([first.alert('a', 'from one cron'), second.alert('a', 'from another cron')]);
    expect(first.f.calls.length + second.f.calls.length).toBe(1);
  });

  it('sends again once the hour has passed since the last send', async () => {
    const { alert, f, advance } = setup('TOKEN');
    await alert('a', 'one');
    advance(3_599_999);
    await alert('a', 'two');
    advance(1);
    await alert('a', 'three');
    expect(f.calls.map((c) => JSON.parse(String(c.init?.body)).text)).toEqual(['ccip.dev alert: one', 'ccip.dev alert: three']);
  });

  it('logs instead of sending when no bot token is configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { alert, f } = setup(undefined);
    await alert('a', 'no token');
    expect(f.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[alert] no token');
    warn.mockRestore();
  });

  it('does not suppress a signature when Telegram answers with an error status', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { alert, f } = setup('TOKEN', () => new Response('boom', { status: 500 }));
    await alert('a', 'one');
    await alert('a', 'two');
    expect(f.calls).toHaveLength(2);
    expect(error).toHaveBeenCalledWith('[alert] Telegram returned HTTP 500 for signature a');
    error.mockRestore();
  });

  it('resolves without throwing when the fetch fails, and retries on the next alert', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let attempts = 0;
    const { alert, f } = setup('TOKEN', () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('network down for https://api.telegram.org/botTOKEN');
      return jsonResponse({ ok: true });
    });
    await expect(alert('a', 'one')).resolves.toBeUndefined();
    await alert('a', 'two');
    expect(f.calls).toHaveLength(2);
    expect(JSON.stringify(error.mock.calls)).not.toContain('TOKEN');
    error.mockRestore();
  });
});
