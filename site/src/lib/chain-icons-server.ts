import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { iconHref } from './chain-icons';

export function iconDataUri(selector: string, publicDir = join(process.cwd(), 'public')): string | null {
  const href = iconHref(selector);
  if (!href) return null;
  const mime = href.endsWith('.png') ? 'image/png' : 'image/svg+xml';
  return `data:${mime};base64,${readFileSync(join(publicDir, href), 'base64')}`;
}
