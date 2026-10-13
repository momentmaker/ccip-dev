import { render } from '@cf-wasm/og/workerd';
import type { VNode } from '../h';
import { KINO_SIZE } from './art';
import { KINO_FONTS } from './fonts';

export interface Rendered {
  png: Uint8Array;
  /** Straight RGBA, row by row: what the glint is drawn onto. */
  pixels: Uint8Array;
  width: number;
  height: number;
}

export async function renderKino(tree: VNode, size: { width: number; height: number } = KINO_SIZE): Promise<Rendered> {
  const result = await render(tree as never, { width: size.width, height: size.height, fonts: KINO_FONTS, loadAdditionalAsset: async () => [] }).asPng();
  return { png: result.image, pixels: result.pixels, width: result.width, height: result.height };
}
