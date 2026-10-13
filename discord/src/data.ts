import { PUBLIC_SCHEMAS, type PublicFile, type PublicFileName } from '@ccip-dev/core/public';

export const DATA_BASE = 'https://data.ccip.dev/v1';
export const DATA_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export class DataError extends Error {
  constructor(
    readonly file: PublicFileName,
    reason: string,
  ) {
    super(`${file}: ${reason}`);
    this.name = 'DataError';
  }
}

export interface PublicData {
  load<N extends PublicFileName>(name: N): Promise<PublicFile<N>>;
}

type CacheLike = Pick<Cache, 'match' | 'put'>;

const isolateCache = new Map<string, { at: number; file: unknown }>();

/** Forgets what this isolate holds: for tests. */
export function clearDataCache(): void {
  isolateCache.clear();
}

/**
 * The public data files, checked against their schemas, kept 60 s in the isolate and in the Cache API (shared by the
 * isolates of a colo). A file that cannot be fetched or parsed is a DataError naming it.
 */
export function publicData(deps: { fetch: typeof fetch; now: () => number; cache: CacheLike | null }): PublicData {
  async function fetchText(name: PublicFileName, url: string): Promise<string> {
    let res: Response;
    try {
      res = await deps.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      throw new DataError(name, `request failed (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!res.ok) throw new DataError(name, `HTTP ${res.status}`);
    return res.text();
  }

  return {
    async load(name) {
      const hit = isolateCache.get(name);
      if (hit && deps.now() - hit.at < DATA_TTL_MS) return hit.file as PublicFile<typeof name>;
      const url = `${DATA_BASE}/${name}`;
      const cached = await deps.cache?.match(url).catch(() => undefined);
      const text = cached ? await cached.text() : await fetchText(name, url);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new DataError(name, 'body is not JSON');
      }
      const parsed = PUBLIC_SCHEMAS[name].safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new DataError(name, `unexpected shape at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`);
      }
      if (!cached && deps.cache) {
        const entry = new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${DATA_TTL_MS / 1000}` } });
        await deps.cache.put(url, entry).catch((err: unknown) => console.warn(`${name} was not kept in the Cache API: ${err instanceof Error ? err.message : String(err)}`));
      }
      isolateCache.set(name, { at: deps.now(), file: parsed.data });
      return parsed.data as PublicFile<typeof name>;
    },
  };
}
