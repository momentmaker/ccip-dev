export const COIN_RASTER_PX = 128;
export const COIN_WAIT_MS = 5_000;

export function sizedSvg(svg: string, size: number): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, '').replace(/^<svg/, `<svg width="${size}" height="${size}"`));
}

async function sizedSvgUrl(href: string, size: number): Promise<string> {
  const res = await fetch(href);
  if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`);
  return URL.createObjectURL(new Blob([sizedSvg(await res.text(), size)], { type: 'image/svg+xml' }));
}

export async function loadCoinImage(href: string, size = COIN_RASTER_PX): Promise<HTMLCanvasElement> {
  const blobUrl = href.endsWith('.svg') ? await sizedSvgUrl(href, size) : null;
  try {
    const img = new Image(size, size);
    img.src = blobUrl ?? href;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, 0, 0, size, size);
    return canvas;
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

export async function loadCoinImages(
  hrefs: ReadonlyMap<string, string>,
  load: (href: string) => Promise<CanvasImageSource> = loadCoinImage,
): Promise<Map<string, CanvasImageSource>> {
  const entries = [...hrefs];
  const settled = await Promise.allSettled(entries.map(([, href]) => load(href)));
  const images = new Map<string, CanvasImageSource>();
  settled.forEach((result, i) => {
    const [selector, href] = entries[i]!;
    if (result.status === 'fulfilled') images.set(selector, result.value);
    else console.warn(`coin icon ${href} failed to load`, result.reason);
  });
  return images;
}

export function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
