import type { PublicFile, PublicFileName } from '@ccip-dev/core/public';
import type { PassportFile, PassportFileName } from '@ccip-dev/core/public-passport';
import { DATA_BASE, DataError, fetchPublic, type FetchOptions } from './data';
import { fetchPassport } from './passport-data';

const loaded = new Map<string, Promise<unknown>>();

const DEFAULT_TIMEOUT_MS = 30_000;

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(Number(process.env.CCIP_DATA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)) });

export const BUILD_DATE = new Date().toISOString().slice(0, 10);

function memoised<T>(name: string, load: (opts: FetchOptions) => Promise<T>): Promise<T> {
  let pending = loaded.get(name);
  if (!pending) {
    pending = load({ fetch: timedFetch, base: process.env.CCIP_DATA_BASE ?? DATA_BASE });
    loaded.set(name, pending);
  }
  return pending as Promise<T>;
}

async function nullIfUnpublished<T>(name: string, pending: Promise<T>): Promise<T | null> {
  try {
    return await pending;
  } catch (err) {
    if (!(err instanceof DataError) || err.status !== 404) throw err;
    console.warn(`${name} is not published yet; building without it`);
    return null;
  }
}

export function buildData<N extends PublicFileName>(name: N): Promise<PublicFile<N>> {
  return memoised(name, (opts) => fetchPublic(name, opts));
}

/** For a new file the Worker publishes only from its next finalize: null on HTTP 404, and any other failure still fails the build. */
export function buildDataIfPublished<N extends PublicFileName>(name: N): Promise<PublicFile<N> | null> {
  return nullIfUnpublished(name, buildData(name));
}

export function buildPassportData<N extends PassportFileName>(name: N): Promise<PassportFile<N>> {
  return memoised(name, (opts) => fetchPassport(name, opts));
}

export function buildPassportDataIfPublished<N extends PassportFileName>(name: N): Promise<PassportFile<N> | null> {
  return nullIfUnpublished(name, buildPassportData(name));
}
