import { PegFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse, pegAmountWord, PEG_WORD, pegRpc } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PEG_RPC_ALERT_AFTER, runPeg } from '../src/jobs/peg';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-11-18T01:35:00.000Z';
const RPC_ENV = { RPC_ETHEREUM: 'https://rpc.one', RPC_FALLBACKS: '' };

describe('runPeg', () => {
  it('publishes peg.json from the live read', async () => {
    await runPeg(harness({ now: NOW, fetch: fakeFetch(pegRpc()), env: RPC_ENV }).c);
    const peg = PegFileSchema.parse(await readPublic('peg.json'));
    expect(peg.spot).toBeCloseTo(0.999751, 6);
    expect(peg.discount.depth).toBe(10_000);
    expect(peg.premium.instant).toBeCloseTo(1541.044687, 6);
    expect(peg.thresholds).toEqual({ private: 0.003, public: 0.0075 });
    expect(peg.episode).toBeNull();
  });

  it('drops a read outside 0.5–1.5 and alerts, publishing nothing', async () => {
    const h = harness({ now: NOW, fetch: fakeFetch(pegRpc({ [PEG_WORD.spot]: pegAmountWord(2) })), env: RPC_ENV });
    await runPeg(h.c);
    expect(h.alerts.map((a) => a.signature)).toEqual(['peg-bad-read']);
    expect(await env.PUBLIC.get('v1/peg.json')).toBeNull();
  });

  it(`alerts once the RPC has failed ${PEG_RPC_ALERT_AFTER} runs in a row, and resets on success`, async () => {
    const down = fakeFetch(() => jsonResponse({}, 503));
    const signatures: string[][] = [];
    for (let run = 0; run < PEG_RPC_ALERT_AFTER; run++) {
      const h = harness({ now: NOW, fetch: down, env: RPC_ENV });
      await runPeg(h.c);
      signatures.push(h.alerts.map((a) => a.signature));
    }
    expect(signatures).toEqual([[], [], ['peg-rpc']]);
    await runPeg(harness({ now: NOW, fetch: fakeFetch(pegRpc()), env: RPC_ENV }).c);
    expect(await store.getMeta(env.DB, 'peg_failures')).toBe('0');
  });

  it('asks once for the mint-cap check the first time the pool has room', async () => {
    const roomy = fakeFetch(pegRpc({ [PEG_WORD.canDeposit]: pegAmountWord(800) }));
    const first = harness({ now: NOW, fetch: roomy, env: RPC_ENV });
    await runPeg(first.c);
    const second = harness({ now: NOW, fetch: roomy, env: RPC_ENV });
    await runPeg(second.c);
    expect(first.alerts.map((a) => a.signature)).toEqual(['peg-mint-check']);
    expect(second.alerts).toEqual([]);
  });
});
