import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { ROSTER_URL } from '../src/config';
import { fetchRoster, rosterSource } from '../src/lib/roster';

const answering = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('fetchRoster', () => {
  it('returns a valid roster', async () => {
    // #then
    expect((await fetchRoster(ROSTER_URL, answering(ROSTER_FIXTURE))).marines.length).toBe(4);
  });

  it('refuses a roster carrying a field beyond the allowlist', async () => {
    // #given a Marine with a leaked name
    const leaked = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0], displayName: 'x' }] };
    // #then
    await expect(fetchRoster(ROSTER_URL, answering(leaked))).rejects.toThrow('roster.json: unexpected shape at marines.0');
  });

  it('fails on an HTTP error', async () => {
    // #then
    await expect(fetchRoster(ROSTER_URL, answering({ error: 'roster unavailable' }, 503))).rejects.toThrow('roster.json: HTTP 503');
  });
});

describe('rosterSource', () => {
  it('honours ?roster= on localhost only, for a visual check', () => {
    // #then
    expect([
      rosterSource({ hostname: 'localhost', search: '?roster=http://localhost:4322/roster.json' }),
      rosterSource({ hostname: '127.0.0.1', search: '' }),
      rosterSource({ hostname: 'ccip.dev', search: '?roster=https://evil.example/roster.json' }),
    ]).toEqual(['http://localhost:4322/roster.json', ROSTER_URL, ROSTER_URL]);
  });
});
