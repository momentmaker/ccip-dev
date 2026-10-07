import { render } from '@cf-wasm/og/node';
import { INTER_700 } from '../../worker/fonts';

export const LETTERMARK_BG = '#2a3446';

export function lettermarkLetter(displayName: string): string {
  return /[a-z0-9]/i.exec(displayName)?.[0]?.toUpperCase() ?? '?';
}

export async function lettermarkSvg(displayName: string): Promise<string> {
  const tree = {
    type: 'div',
    props: {
      style: {
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LETTERMARK_BG,
        borderRadius: 4,
        color: '#ffffff',
        fontSize: 18,
        fontWeight: 700,
        fontFamily: 'Inter',
      },
      children: lettermarkLetter(displayName),
    },
  };
  const fonts = [{ name: 'Inter', data: INTER_700, weight: 700, style: 'normal' }];
  const result = await render(tree as never, { width: 32, height: 32, fonts: fonts as never, loadAdditionalAsset: async () => [] }).asSvg();
  return result.image;
}
