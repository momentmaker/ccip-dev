import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasIcon, iconFiles, iconHref, iconHrefs, missingIcons } from '../src/lib/chain-icons';
import { iconDataUri } from '../src/lib/chain-icons-server';
import manifest from '../src/data/chain-icons.json';

const ETHEREUM = '5009297550715157269';
const PUBLIC = join(import.meta.dirname, '..', 'public');

describe('chain icons', () => {
  it('maps a selector to its vendored file', () => {
    expect(iconHref(ETHEREUM)).toBe('/chains/ethereum-mainnet.svg');
    expect(hasIcon(ETHEREUM)).toBe(true);
  });

  it('returns nothing for a chain the manifest does not know', () => {
    expect(iconHref('1')).toBeNull();
    expect(hasIcon('1')).toBe(false);
  });

  it('lists the hrefs of known selectors in order and skips unknown ones', () => {
    expect(iconHrefs(['1', ETHEREUM, '2', ETHEREUM])).toEqual(['/chains/ethereum-mainnet.svg', '/chains/ethereum-mainnet.svg']);
    expect(iconHrefs(['1'])).toEqual([]);
  });

  it('names the chains that have no icon', () => {
    expect(missingIcons([{ selector: ETHEREUM, name: 'ethereum-mainnet' }, { selector: '1', name: 'brand-new-mainnet' }, { selector: '2', name: null }])).toEqual(['brand-new-mainnet', '2']);
  });

  it('has a file in public/chains for every manifest entry', () => {
    const missing = iconFiles().filter((f) => !existsSync(join(PUBLIC, 'chains', f)));
    expect(missing).toEqual([]);
  });

  it('inlines an icon as a base64 SVG data URI at build time', () => {
    const uri = iconDataUri(ETHEREUM, PUBLIC)!;
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(uri.split(',')[1]!, 'base64').toString('utf8')).toBe(readFileSync(join(PUBLIC, 'chains', 'ethereum-mainnet.svg'), 'utf8'));
    expect(iconDataUri('1', PUBLIC)).toBeNull();
  });

  it('inlines a rasterized icon as a PNG data URI', () => {
    const raster = Object.values(manifest.icons as Record<string, { selector: string; file: string }>).find((e) => e.file.endsWith('.png'))!;
    const uri = iconDataUri(raster.selector, PUBLIC)!;
    expect(uri.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
    expect(Buffer.from(uri.split(',')[1]!, 'base64').equals(readFileSync(join(PUBLIC, 'chains', raster.file)))).toBe(true);
  });
});
