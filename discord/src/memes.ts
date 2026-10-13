import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import type { MarineMeme } from './store';

/** The archive at the snapshot's commit, so a file's bytes can never change under a Marine. */
export const rawMemeUrl = (repo: string, sha: string, file: string) => `https://raw.githubusercontent.com/${repo}/${sha}/memes/${encodeURIComponent(file)}`;

/** Memes are kept as the 240 px PNG the site makes of them, never the original (some are 8 MB GIFs). */
export const memeKey = (file: string) => `memes/${file}.png`;

/** The reveal runs in waitUntil, which ends 30 s after the deferred reply: three copies at once, each given 8 s. */
export const MEME_TIMEOUT_MS = 8_000;

/** Copies the memes missing from R2 from the pinned archive URL, at once, through the site's prepareMeme. Throws when any fails. */
export async function stockMemes(
  bucket: R2Bucket,
  renderer: Pick<LinkMarineRenderer, 'prepareMeme'>,
  fetchFn: typeof fetch,
  archive: { repo: string; sha: string },
  memes: readonly MarineMeme[],
  timeoutMs = MEME_TIMEOUT_MS,
): Promise<void> {
  await Promise.all(
    memes.map(async (meme) => {
      try {
        if (await bucket.head(meme.key)) return;
        const res = await fetchFn(rawMemeUrl(archive.repo, archive.sha, meme.file), { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const png = await renderer.prepareMeme(new Uint8Array(await res.arrayBuffer()));
        await bucket.put(meme.key, png, { httpMetadata: { contentType: 'image/png' } });
      } catch (err) {
        throw new Error(`meme ${meme.file}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
    }),
  );
}

/** The three memes' PNGs from R2, or null while any is missing. */
export async function loadMemes(bucket: R2Bucket, memes: readonly MarineMeme[]): Promise<Uint8Array[] | null> {
  const objects = await Promise.all(memes.map((m) => bucket.get(m.key)));
  if (objects.some((o) => o === null)) return null;
  return Promise.all(objects.map(async (o) => new Uint8Array(await o!.arrayBuffer())));
}
