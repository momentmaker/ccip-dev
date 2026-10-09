import { PUBLIC_SCHEMAS, type PublicFile, type PublicFileName } from '@ccip-dev/core/public';

export const DATA_BASE = 'https://data.ccip.dev/v1';
export const POLL_DELAYS_MS = [30_000, 60_000, 120_000, 300_000] as const;

export class DataError extends Error {
  constructor(
    readonly file: PublicFileName,
    reason: string,
    readonly status: number | null = null,
  ) {
    super(`${file}: ${reason}`);
    this.name = 'DataError';
  }
}

export async function fetchPublic<N extends PublicFileName>(
  name: N,
  opts: { fetch?: typeof fetch; base?: string } = {},
): Promise<PublicFile<N>> {
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
  const parsed = PUBLIC_SCHEMAS[name].safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DataError(name, `unexpected shape at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`);
  }
  return parsed.data as PublicFile<N>;
}

export function pollDelay(failures: number): number {
  return POLL_DELAYS_MS[Math.min(failures, POLL_DELAYS_MS.length - 1)]!;
}
