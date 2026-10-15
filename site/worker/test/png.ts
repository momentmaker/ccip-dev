type Rgba = [number, number, number, number];

async function decode(png: Uint8Array, lastRow: number): Promise<{ width: number; channels: number; rows: Uint8Array[] }> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = png[24];
  const colorType = png[25];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG: depth ${bitDepth}, color type ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IDAT') idat.push(png.slice(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = width * channels;
  const rows: Uint8Array[] = [];
  let prev = new Uint8Array(stride);
  for (let r = 0; r <= Math.min(lastRow, height - 1); r++) {
    const base = r * (stride + 1);
    const filter = raw[base]!;
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels]! : 0;
      const up = prev[i]!;
      const upLeft = i >= channels ? prev[i - channels]! : 0;
      const p = left + up - upLeft;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter]!;
      row[i] = (raw[base + 1 + i]! + predictor) & 0xff;
    }
    rows.push(row);
    prev = row;
  }
  return { width, channels, rows };
}

const rgbaAt = (row: Uint8Array, x: number, channels: number): Rgba => [row[x * channels]!, row[x * channels + 1]!, row[x * channels + 2]!, channels === 4 ? row[x * channels + 3]! : 255];

/** A pixel's red, green, blue and alpha; alpha is 255 in a PNG without an alpha channel. */
export async function pngRgba(png: Uint8Array, x: number, y: number): Promise<Rgba> {
  const { channels, rows } = await decode(png, y);
  return rgbaAt(rows[y]!, x, channels);
}

export async function pngPixel(png: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const [r, g, b] = await pngRgba(png, x, y);
  return [r, g, b];
}

/** The whole image decoded once, for a test that reads many pixels. */
export async function pngImage(png: Uint8Array): Promise<{ width: number; height: number; at: (x: number, y: number) => Rgba; rowsWhere: (from: number, to: number, accepts: (r: number, g: number, b: number) => boolean) => number[] }> {
  const { width, channels, rows } = await decode(png, Infinity);
  const hasPixel = (row: Uint8Array, accepts: (r: number, g: number, b: number) => boolean) => {
    for (let x = 0; x < width; x++) if (accepts(row[x * channels]!, row[x * channels + 1]!, row[x * channels + 2]!)) return true;
    return false;
  };
  return {
    width,
    height: rows.length,
    at: (x, y) => rgbaAt(rows[y]!, x, channels),
    rowsWhere: (from, to, accepts) => Array.from({ length: to - from }, (_, i) => from + i).filter((y) => hasPixel(rows[y]!, accepts)),
  };
}
