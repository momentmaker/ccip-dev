import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCcipClient } from '@ccip-dev/core';

const ROOT = path.resolve(import.meta.dirname, '..');

const client = createCcipClient({
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock: () => Date.now(),
});
const names = (await client.listChains()).map((c) => c.name).sort();
await writeFile(path.join(ROOT, 'labels/ccip-chains.json'), `${JSON.stringify(names, null, 2)}\n`);
console.log(`wrote ${names.length} chain names to labels/ccip-chains.json`);
