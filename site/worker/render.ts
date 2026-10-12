import { render } from '@cf-wasm/og/workerd';
import type { CardSize } from './cards/frame';
import { CARD_FONTS } from './fonts';
import type { VNode } from './h';

export async function renderPng(tree: VNode, size: CardSize): Promise<Uint8Array> {
  return (await render(tree as never, { width: size.width, height: size.height, fonts: CARD_FONTS, loadAdditionalAsset: async () => [] }).asPng()).image;
}
