import { iconHref } from '../../src/lib/chain-icons';

export interface AssetFetcher {
  fetch(request: Request | string): Promise<Response>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A chain's icon from the site's own static assets, as a data URI; null for a chain without one, which gets a lettermark. */
export async function coinIcon(assets: AssetFetcher, origin: string, selector: string): Promise<string | null> {
  const href = iconHref(selector);
  if (!href) return null;
  const res = await assets.fetch(new Request(`${origin}${href}`));
  if (!res.ok) return null;
  return `data:${href.endsWith('.png') ? 'image/png' : 'image/svg+xml'};base64,${bytesToBase64(new Uint8Array(await res.arrayBuffer()))}`;
}
