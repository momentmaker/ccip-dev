import { PUBLIC_SCHEMAS, type PublicFile, type PublicFileName } from '@ccip-dev/core/public';
import type { z } from 'zod';

export const DATA_BASE = 'https://data.ccip.dev/v1';
export const POLL_DELAYS_MS = [30_000, 60_000, 120_000, 300_000] as const;

export interface FetchOptions {
  fetch?: typeof fetch;
  base?: string;
}

export class DataError extends Error {
  constructor(
    readonly file: string,
    reason: string,
    readonly status: number | null = null,
  ) {
    super(`${file}: ${reason}`);
    this.name = 'DataError';
  }
}

export async function fetchParsed<S extends z.ZodType>(name: string, schema: S, opts: FetchOptions = {}): Promise<z.infer<S>> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.base ?? DATA_BASE}/${name}`);
  } catch (err) {
    throw new DataError(name, `request failed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) throw new DataError(name, `HTTP ${res.status}`, res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new DataError(name, 'body is not JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DataError(name, `unexpected shape at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`);
  }
  return parsed.data;
}

export function fetchPublic<N extends PublicFileName>(name: N, opts: FetchOptions = {}): Promise<PublicFile<N>> {
  return fetchParsed(name, PUBLIC_SCHEMAS[name], opts) as Promise<PublicFile<N>>;
}

export function pollDelay(failures: number): number {
  return POLL_DELAYS_MS[Math.min(failures, POLL_DELAYS_MS.length - 1)]!;
}
