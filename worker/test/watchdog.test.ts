import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectProblem, runWatchdog, shouldAlert, type WatchdogEnv } from '../src/watchdog';

const NOW = new Date('2026-10-08T12:17:00.000Z');
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();
const statusFetch = (body: unknown) => fakeFetch(() => jsonResponse(body));
const at = (minute: number) => new Date(`2026-10-08T12:${String(minute).padStart(2, '0')}:00.000Z`);

afterEach(() => vi.restoreAllMocks());

describe('detectProblem', () => {
  it('finds nothing when status.json is fresh and ingest is current', async () => {
    const f = statusFetch({ updated_at: secondsAgo(60), lag_seconds: 30 });
    expect(await detectProblem('https://x/status.json', f, NOW)).toBeNull();
  });

  it('reports a status.json older than 900 seconds', async () => {
    const f = statusFetch({ updated_at: secondsAgo(901), lag_seconds: 30 });
    expect(await detectProblem('https://x/status.json', f, NOW)).toEqual({ reason: 'status.json is 901s old', measured: 901 });
  });

  it('reports a null lag_seconds', async () => {
    const f = statusFetch({ updated_at: secondsAgo(60), lag_seconds: null });
    expect(await detectProblem('https://x/status.json', f, NOW)).toEqual({ reason: 'ingest has never succeeded (lag_seconds is null)' });
  });

  it('reports lag_seconds above 900', async () => {
    const f = statusFetch({ updated_at: secondsAgo(60), lag_seconds: 901.7 });
    expect(await detectProblem('https://x/status.json', f, NOW)).toEqual({ reason: 'ingest lag is 901s', measured: 901.7 });
  });

  it('prefers the age problem when both age and lag are bad', async () => {
    const f = statusFetch({ updated_at: secondsAgo(1000), lag_seconds: 5000 });
    expect((await detectProblem('https://x/status.json', f, NOW))?.reason).toBe('status.json is 1000s old');
  });

  it.each([
    ['fetch throws', fakeFetch(() => { throw new TypeError('down'); })],
    ['HTTP 500', fakeFetch(() => new Response('boom', { status: 500 }))],
    ['non-JSON body', fakeFetch(() => new Response('<html>', { status: 200 }))],
    ['missing updated_at', statusFetch({ lag_seconds: 1 })],
    ['unparseable updated_at', statusFetch({ updated_at: 'yesterday', lag_seconds: 1 })],
  ])('reports unreachable or unreadable on %s', async (_name, f) => {
    expect(await detectProblem('https://x/status.json', f, NOW)).toEqual({ reason: 'status.json is unreachable or unreadable' });
  });
});

describe('shouldAlert', () => {
  const stale = (measured: number) => ({ reason: 'x', measured });

  it('alerts when age first crosses the threshold', () => {
    expect(shouldAlert(stale(1000), at(17))).toBe(true);
  });

  it('stays quiet for an old problem outside the hourly reminder', () => {
    expect(shouldAlert(stale(2000), at(17))).toBe(false);
  });

  it('sends the hourly reminder for an old problem', () => {
    expect(shouldAlert(stale(2000), at(2))).toBe(true);
  });

  it('alerts when lag first crosses the threshold', () => {
    expect(shouldAlert(stale(1100), at(17))).toBe(true);
  });

  it('alerts on a measured value at the slack boundary but not beyond it', () => {
    expect(shouldAlert(stale(1260), at(17))).toBe(true);
    expect(shouldAlert(stale(1261), at(17))).toBe(false);
  });

  it('alerts a problem without a measured value only on the hourly reminder', () => {
    const unreadable = { reason: 'x' };
    expect(shouldAlert(unreadable, at(17))).toBe(false);
    expect(shouldAlert(unreadable, at(0))).toBe(true);
  });
});

describe('runWatchdog', () => {
  const env: WatchdogEnv = { STATUS_URL: 'https://x/status.json', TELEGRAM_BOT_TOKEN: 'TOKEN', TELEGRAM_ALERT_CHAT_ID: '42' };

  function routed(status: unknown) {
    return fakeFetch(
      (url) => (url === env.STATUS_URL ? jsonResponse(status) : undefined),
      (url) => (url.startsWith('https://api.telegram.org/') ? jsonResponse({ ok: true }) : undefined),
    );
  }

  it('posts one Telegram message for a newly stale status', async () => {
    const f = routed({ updated_at: secondsAgo(1000), lag_seconds: 1 });
    await runWatchdog(env, { fetch: f, now: () => NOW });
    const posts = f.calls.filter((c) => c.url.startsWith('https://api.telegram.org/'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    const body = JSON.parse(String(posts[0]!.init?.body));
    expect(body.chat_id).toBe('42');
    expect(body.text).toBe('ccip.dev watchdog: status.json is 1000s old');
  });

  it('sends nothing for a healthy status', async () => {
    const f = routed({ updated_at: secondsAgo(30), lag_seconds: 5 });
    await runWatchdog(env, { fetch: f, now: () => NOW });
    expect(f.calls.filter((c) => c.url.startsWith('https://api.telegram.org/'))).toHaveLength(0);
  });

  it('logs instead of throwing when Telegram secrets are missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = routed({ updated_at: secondsAgo(1000), lag_seconds: 1 });
    await expect(runWatchdog({ STATUS_URL: env.STATUS_URL }, { fetch: f, now: () => NOW })).resolves.toBeUndefined();
    expect(f.calls.filter((c) => c.url.startsWith('https://api.telegram.org/'))).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[watchdog] ccip.dev watchdog: status.json is 1000s old');
  });
});

describe('boundaries', () => {
  it('treats age exactly 900 as healthy', async () => {
    const f = statusFetch({ updated_at: secondsAgo(900), lag_seconds: 0 });
    expect(await detectProblem('https://x/status.json', f, NOW)).toBeNull();
  });

  it('treats lag exactly 900 as healthy', async () => {
    const f = statusFetch({ updated_at: secondsAgo(0), lag_seconds: 900 });
    expect(await detectProblem('https://x/status.json', f, NOW)).toBeNull();
  });

  it('reports a non-numeric lag_seconds as unreadable', async () => {
    const f = statusFetch({ updated_at: secondsAgo(0), lag_seconds: 'slow' });
    expect((await detectProblem('https://x/status.json', f, NOW))?.reason).toBe('ingest lag is unreadable (lag_seconds is not a number)');
  });

  it('stops the hourly reminder at minute 5 but not minute 4', () => {
    expect(shouldAlert({ reason: 'x', measured: 2000 }, at(5))).toBe(false);
    expect(shouldAlert({ reason: 'x', measured: 2000 }, at(4))).toBe(true);
  });
});

describe('runWatchdog gating and failures', () => {
  const env: WatchdogEnv = { STATUS_URL: 'https://x/status.json', TELEGRAM_BOT_TOKEN: 'TOKEN', TELEGRAM_ALERT_CHAT_ID: '42' };
  const isTelegram = (c: { url: string }) => c.url.startsWith('https://api.telegram.org/');

  it('sends nothing for an old problem outside the hourly reminder', async () => {
    const f = fakeFetch((url) => (url === env.STATUS_URL ? jsonResponse({ updated_at: secondsAgo(2000), lag_seconds: 1 }) : jsonResponse({ ok: true })));
    await runWatchdog(env, { fetch: f, now: () => NOW });
    expect(f.calls.filter(isTelegram)).toHaveLength(0);
  });

  it.each([
    ['HTTP 500', () => new Response('boom', { status: 500 })],
    ['a thrown fetch', () => { throw new TypeError('down'); }],
  ])('logs and resolves when Telegram fails with %s', async (_name, telegram) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeFetch((url) => (url === env.STATUS_URL ? jsonResponse({ updated_at: secondsAgo(1000), lag_seconds: 1 }) : telegram()));
    await expect(runWatchdog(env, { fetch: f, now: () => NOW })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('does not alert when the retry after an unreadable status is healthy', async () => {
    let reads = 0;
    const f = fakeFetch((url) => {
      if (url !== env.STATUS_URL) return jsonResponse({ ok: true });
      reads += 1;
      return reads === 1 ? new Response('boom', { status: 500 }) : jsonResponse({ updated_at: secondsAgo(10), lag_seconds: 1 });
    });
    await runWatchdog(env, { fetch: f, now: () => at(0) });
    expect(reads).toBe(2);
    expect(f.calls.filter(isTelegram)).toHaveLength(0);
  });

  it('alerts once at minute 0 when the status is unreadable twice', async () => {
    const f = fakeFetch((url) => (url === env.STATUS_URL ? new Response('boom', { status: 500 }) : jsonResponse({ ok: true })));
    await runWatchdog(env, { fetch: f, now: () => at(0) });
    expect(f.calls.filter(isTelegram)).toHaveLength(1);
  });
});
