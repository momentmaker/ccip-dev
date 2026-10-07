import { afterEach, describe, expect, it, vi } from 'vitest';
import status from './fixtures/status.json';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('buildData', () => {
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

  it('dates the build in UTC', async () => {
    const { BUILD_DATE } = await import('../src/lib/build-data');
    expect(BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
