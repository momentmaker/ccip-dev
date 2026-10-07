import { optimize, type CustomPlugin } from 'svgo';

export const MAX_ICON_BYTES = 20_000;
const ICON_PX = 32;
const SAFE_HREF = /^(#|data:image\/(png|jpeg|webp);)/;

const stripUnsafe: CustomPlugin = {
  name: 'stripUnsafe',
  fn: () => ({
    element: {
      enter: (node) => {
        for (const key of Object.keys(node.attributes)) {
          const value = node.attributes[key] ?? '';
          const outsideLink = (key === 'href' || key === 'xlink:href') && !SAFE_HREF.test(value);
          if (/^on/i.test(key) || outsideLink) delete node.attributes[key];
        }
      },
    },
  }),
};

const normalizeRoot: CustomPlugin = {
  name: 'normalizeRoot',
  fn: () => ({
    element: {
      enter: (node, parent) => {
        if (node.name !== 'svg' || parent.type !== 'root') return;
        const { width, height, viewBox } = node.attributes;
        if (!viewBox && Number.parseFloat(width ?? '') > 0 && Number.parseFloat(height ?? '') > 0) {
          node.attributes.viewBox = `0 0 ${Number.parseFloat(width ?? '')} ${Number.parseFloat(height ?? '')}`;
        }
        node.attributes.width = String(ICON_PX);
        node.attributes.height = String(ICON_PX);
      },
    },
  }),
};

export function checkIcon(svg: string, prefix: string): void {
  if (!/\sviewBox="/.test(svg)) throw new Error(`${prefix}: cleaned icon has no viewBox`);
  if (svg.length > MAX_ICON_BYTES) throw new Error(`${prefix}: cleaned icon is ${svg.length} bytes, over ${MAX_ICON_BYTES}`);
}

export function cleanIcon(svg: string, prefix: string): string {
  const { data } = optimize(svg, {
    multipass: false,
    floatPrecision: 2,
    plugins: [normalizeRoot, 'preset-default', 'removeScripts', 'removeXlink', stripUnsafe, { name: 'prefixIds', params: { prefix, delim: '-' } }],
  });
  checkIcon(data, prefix);
  return `${data}\n`;
}
