import type { PublicFile, PublicFileName } from '@ccip-dev/core/public';
import { DATA_BASE, fetchPublic } from './data';

const loaded = new Map<PublicFileName, Promise<unknown>>();

export const BUILD_DATE = new Date().toISOString().slice(0, 10);

export function buildData<N extends PublicFileName>(name: N): Promise<PublicFile<N>> {
  let pending = loaded.get(name);
  if (!pending) {
    pending = fetchPublic(name, { base: process.env.CCIP_DATA_BASE ?? DATA_BASE });
    loaded.set(name, pending);
  }
  return pending as Promise<PublicFile<N>>;
}
