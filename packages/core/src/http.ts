import type { z } from 'zod';

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  clock: () => number;
}

const MAX_RETRY_AFTER_MS = 30_000;

export const USER_AGENT = 'curl/8.7.1';

export class UpstreamHttpError extends Error {
  constructor(readonly endpoint: string, readonly status: number) {
    super(`${endpoint} returned HTTP ${status}`);
    this.name = 'UpstreamHttpError';
  }
}

export class UpstreamSchemaError extends Error {
  constructor(readonly endpoint: string, readonly path: string, readonly sample: string) {
    super(`${endpoint} response failed validation at ${path}`);
    this.name = 'UpstreamSchemaError';
  }
}

export type Throttle = () => Promise<void>;

export function createThrottle(deps: HttpDeps, minIntervalMs: number): Throttle {
  let last: number | null = null;
  return async () => {
    if (last !== null) {
      const wait = last + minIntervalMs - deps.clock();
      if (wait > 0) await deps.sleep(wait);
    }
    last = deps.clock();
  };
}

export interface GetJsonOptions {
  endpoint: string;
  maxRetries: number;
  throttle?: Throttle;
}

export async function getJson(deps: HttpDeps, url: string, opts: GetJsonOptions): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    await opts.throttle?.();
    let res: Response;
    try {
      res = await deps.fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    } catch (err) {
      if (attempt >= opts.maxRetries) throw err;
      await deps.sleep(backoffMs(attempt));
      continue;
    }
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= opts.maxRetries) throw new UpstreamHttpError(opts.endpoint, res.status);
    await deps.sleep(retryAfterMs(res) ?? backoffMs(attempt));
  }
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

export function issuePath(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue && issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
}

export function parseWith<S extends z.ZodType>(schema: S, json: unknown, endpoint: string): z.output<S> {
  const result = schema.safeParse(json);
  if (result.success) return result.data;
  throw new UpstreamSchemaError(endpoint, issuePath(result.error), (JSON.stringify(json) ?? '').slice(0, 300));
}
