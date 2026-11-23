import { describe, expect, it } from 'vitest';
import { listLaneOnRamps } from '../src/ccip/lanes';
import { UpstreamSchemaError } from '../src/http';
import { fakeFetch, instantDeps, jsonResponse } from '../src/testing';

const ETHEREUM = '5009297550715157269';
const BASE = '15971525489660198786';
const SOLANA = '124615329519749607';

/** Three lanes as https://api.ccip.chain.link/v2/lanes answered them on 2026-11-23. */
const LANES = {
  lanes: [
    { sourceChainSelector: ETHEREUM, destChainSelector: BASE, onRampAddress: '0xC3423f3fB30857d9c14717B119884b1b63d250B7', offRampAddress: '0x1', version: '2.0.0', status: 'OPERATIONAL' },
    { sourceChainSelector: ETHEREUM, destChainSelector: SOLANA, onRampAddress: '0x913814782144864E523c3fdB78E3cA25d2C2aECA', offRampAddress: '0x2', version: '1.6.0', status: 'MAINTENANCE' },
    { sourceChainSelector: SOLANA, destChainSelector: ETHEREUM, onRampAddress: 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C', offRampAddress: '0x3', version: '1.6.0', status: 'OPERATIONAL' },
  ],
};

describe('listLaneOnRamps', () => {
  it('maps each source chain to its OnRamp per destination, addresses as answered', async () => {
    const f = fakeFetch(() => jsonResponse(LANES));
    expect(await listLaneOnRamps(instantDeps(f), 'https://api.ccip.chain.link/v2')).toEqual({
      [ETHEREUM]: { [BASE]: '0xC3423f3fB30857d9c14717B119884b1b63d250B7', [SOLANA]: '0x913814782144864E523c3fdB78E3cA25d2C2aECA' },
      [SOLANA]: { [ETHEREUM]: 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C' },
    });
  });

  it('asks the keyless lanes endpoint under the API base', async () => {
    const f = fakeFetch(() => jsonResponse(LANES));
    await listLaneOnRamps(instantDeps(f), 'https://api.ccip.chain.link/v2');
    expect(f.calls.map((c) => c.url)).toEqual(['https://api.ccip.chain.link/v2/lanes']);
  });

  it('rejects a lane without an OnRamp address, naming its path', async () => {
    const broken = { lanes: [{ ...LANES.lanes[0], onRampAddress: undefined }] };
    const f = fakeFetch(() => jsonResponse(broken));
    await expect(listLaneOnRamps(instantDeps(f), 'https://api.ccip.chain.link/v2')).rejects.toMatchObject({
      name: 'UpstreamSchemaError',
      path: 'lanes.0.onRampAddress',
    } satisfies Partial<UpstreamSchemaError>);
  });
});
