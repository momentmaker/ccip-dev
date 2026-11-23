import { z } from 'zod';
import { getJson, parseWith, type HttpDeps } from '../http';

/** The fields of a /lanes answer the Passport reader needs; non-EVM OnRamps keep their own address format. */
export const LanesResponse = z.object({
  lanes: z.array(z.object({ sourceChainSelector: z.string(), destChainSelector: z.string(), onRampAddress: z.string() })),
});

export type LaneOnRamps = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** OnRamp addresses by source chain selector, then destination chain selector, from the keyless lanes endpoint. */
export async function listLaneOnRamps(deps: HttpDeps, baseUrl: string): Promise<LaneOnRamps> {
  const json = await getJson(deps, `${baseUrl}/lanes`, { endpoint: 'GET /lanes', maxRetries: 4 });
  const onRamps: Record<string, Record<string, string>> = {};
  for (const lane of parseWith(LanesResponse, json, 'GET /lanes').lanes) {
    (onRamps[lane.sourceChainSelector] ??= {})[lane.destChainSelector] = lane.onRampAddress;
  }
  return onRamps;
}
