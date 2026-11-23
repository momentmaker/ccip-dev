import { PASSPORT_SCHEMAS, type PassportFile, type PassportFileName } from '@ccip-dev/core/public-passport';
import { fetchParsed, type FetchOptions } from './data';

/** Kept apart from fetchPublic so no browser island bundles the passport schemas: only the build and the site Worker read these files. */
export function fetchPassport<N extends PassportFileName>(name: N, opts: FetchOptions = {}): Promise<PassportFile<N>> {
  return fetchParsed(name, PASSPORT_SCHEMAS[name], opts) as Promise<PassportFile<N>>;
}
