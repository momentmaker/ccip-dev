import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function headersFor(file: string, path: string): Map<string, string> {
  const found = new Map<string, string>();
  let active = false;
  for (const line of file.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      active = line.trim() === path;
      continue;
    }
    if (!active) continue;
    const colon = line.indexOf(':');
    found.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return found;
}

describe('public/_headers', () => {
  const headers = headersFor(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'), '/*');

  it('sends HSTS without includeSubDomains or preload', () => {
    expect(headers.get('strict-transport-security')).toBe('max-age=31536000');
  });
  it('blocks content sniffing', () => {
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('limits the referrer', () => {
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
  it('forbids framing in both header generations', () => {
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });
  it('turns off unused powerful features', () => {
    expect(headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(), payment=()');
  });
});
