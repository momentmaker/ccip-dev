import type { HttpDeps } from '@ccip-dev/core';

export interface Deps extends HttpDeps {
  now: () => Date;
}

const FETCH_TIMEOUT_MS = 30_000;

export const realDeps: Deps = {
  fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock: () => Date.now(),
  now: () => new Date(),
};
