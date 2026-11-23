/** GETs a JSON answer, failing on any status but 2xx; a minute is the most it waits. */
export async function getJson<T>(url: string, fetchFn: typeof fetch = fetch): Promise<T> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`);
  return (await res.json()) as T;
}
