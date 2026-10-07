import { render } from '@cf-wasm/og/node';
import { INTER_400 } from '../../worker/fonts';

export const RASTER_PX = 128;
const EMBEDDED_RASTER = /data:image\/(png|jpe?g|webp);/;

export function embedsRaster(svg: string): boolean {
  return EMBEDDED_RASTER.test(svg);
}

export async function rasterizeIcon(svg: string, size = RASTER_PX): Promise<Uint8Array> {
  const tree = {
    type: 'div',
    props: {
      style: { width: size, height: size, display: 'flex' },
      children: [{ type: 'img', props: { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width: size, height: size } }],
    },
  };
  const fonts = [{ name: 'Inter', data: INTER_400, weight: 400, style: 'normal' }];
  return (await render(tree as never, { width: size, height: size, fonts: fonts as never, loadAdditionalAsset: async () => [] }).asPng()).image;
}
