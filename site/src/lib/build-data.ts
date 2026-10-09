import type { PublicFile, PublicFileName } from '@ccip-dev/core/public';
import { DATA_BASE, DataError, fetchPublic } from './data';

const loaded = new Map<PublicFileName, Promise<unknown>>();

const DEFAULT_TIMEOUT_MS = 30_000;

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(Number(process.env.CCIP_DATA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)) });

export const BUILD_DATE = new Date().toISOString().slice(0, 10);

export function buildData<N extends PublicFileName>(name: N): Promise<PublicFile<N>> {
  let pending = loaded.get(name);
  if (!pending) {
    pending = fetchPublic(name, { fetch: timedFetch, base: process.env.CCIP_DATA_BASE ?? DATA_BASE });
    loaded.set(name, pending);
  }
  return pending as Promise<PublicFile<N>>;
}

/** For a new file the Worker publishes only from its next finalize: null on HTTP 404, and any other failure still fails the build. */
export async function buildDataIfPublished<N extends PublicFileName>(name: N): Promise<PublicFile<N> | null> {
  try {
    return await buildData(name);
  } catch (err) {
    if (!(err instanceof DataError) || err.status !== 404) throw err;
    console.warn(`${name} is not published yet; building without it`);
    return null;
  }
}
