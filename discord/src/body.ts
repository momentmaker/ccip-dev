/** Discord's interactions and Telegram's updates run to a few KB: a body past this is refused before it is checked. */
export const MAX_BODY_BYTES = 64 * 1024;

/** The body as text, or null past `maxBytes`, whether its Content-Length says so or its bytes do. */
export async function cappedBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
