export function archiveKey(day: string): string {
  const [year, month, date] = day.split('-');
  return `messages/${year}/${month}/${date}.jsonl.gz`;
}

export function toJsonl(objects: unknown[]): string {
  return objects.map((o) => `${JSON.stringify(o)}\n`).join('');
}

export function dedupeRawById(raws: unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  for (const raw of raws) byId.set(String((raw as { messageId?: unknown }).messageId), raw);
  return [...byId.values()];
}

export async function gzipText(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function gunzipText(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
