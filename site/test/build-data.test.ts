import { afterEach, describe, expect, it, vi } from 'vitest';
import passportIndex from './fixtures/passport/passport.json';
import status from './fixtures/status.json';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const COLD_IMPORT_TIMEOUT_MS = 20_000;

describe('buildData', { timeout: COLD_IMPORT_TIMEOUT_MS }, () => {
  it('fetches each file once from CCIP_DATA_BASE and shares the result', async () => {
    vi.stubEnv('CCIP_DATA_BASE', 'https://fixtures.test/v1');
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(status));
    });
    const { buildData } = await import('../src/lib/build-data');
    const [a, b] = await Promise.all([buildData('status.json'), buildData('status.json')]);
    expect(a).toBe(b);
    expect(urls).toEqual(['https://fixtures.test/v1/status.json']);
  });

  it('fails the build when a file cannot be loaded', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 500 }));
    const { buildData } = await import('../src/lib/build-data');
    await expect(buildData('status.json')).rejects.toThrow('status.json: HTTP 500');
  });

  it('returns null while the Worker has not published the file yet', async () => {
    // #given
    vi.stubGlobal('fetch', async () => new Response('missing', { status: 404 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { buildDataIfPublished } = await import('../src/lib/build-data');
    // #when
    const cost = await buildDataIfPublished('cost.json');
    warn.mockRestore();
    // #then
    expect(cost).toBeNull();
  });

  it('still fails the build when an optional file fails another way', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 500 }));
    const { buildDataIfPublished } = await import('../src/lib/build-data');
    await expect(buildDataIfPublished('cost.json')).rejects.toThrow('cost.json: HTTP 500');
  });

  it('fails the build fast when the data host never answers', async () => {
    vi.stubEnv('CCIP_DATA_TIMEOUT_MS', '20');
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    );
    const { buildData } = await import('../src/lib/build-data');
    await expect(buildData('status.json')).rejects.toThrow('status.json: request failed');
  });

  it('fetches a passport file once from CCIP_DATA_BASE and parses it with the passport schema', async () => {
    // #given
    vi.stubEnv('CCIP_DATA_BASE', 'https://fixtures.test/v1');
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(passportIndex));
    });
    const { buildPassportData } = await import('../src/lib/build-data');
    // #when
    const [a, b] = await Promise.all([buildPassportData('passport.json'), buildPassportData('passport.json')]);
    // #then
    expect({ same: a === b, since: a.since, urls }).toEqual({ same: true, since: passportIndex.since, urls: ['https://fixtures.test/v1/passport.json'] });
  });

  it('fails the build when a passport file does not match its schema', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ...passportIndex, tokens: 'none' })));
    const { buildPassportData } = await import('../src/lib/build-data');
    await expect(buildPassportData('passport.json')).rejects.toThrow('passport.json: unexpected shape at tokens');
  });

  it('returns null while the Worker has not published a passport file yet', async () => {
    // #given
    vi.stubGlobal('fetch', async () => new Response('missing', { status: 404 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { buildPassportDataIfPublished } = await import('../src/lib/build-data');
    // #when
    const index = await buildPassportDataIfPublished('passport.json');
    warn.mockRestore();
    // #then
    expect(index).toBeNull();
  });

  it('dates the build in UTC', async () => {
    const { BUILD_DATE } = await import('../src/lib/build-data');
    expect(BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
