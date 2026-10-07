import { describe, expect, it } from 'vitest';
import { checkIcon, cleanIcon, MAX_ICON_BYTES } from '../scripts/chain-icons/clean';

const ICON = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="paint0_linear_1460" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stop-color="#627EEA"/><stop offset="1" stop-color="#3C3C3D"/></linearGradient></defs>
<rect width="32" height="32" rx="4" fill="url(#paint0_linear_1460)"/><path d="M16 4L9 16L16 13Z" fill="white"/></svg>`;

describe('cleanIcon', () => {
  it('prefixes ids and rewrites the references to them', () => {
    const out = cleanIcon(ICON, 'ethereum-mainnet');
    const id = /\sid="([^"]+)"/.exec(out)?.[1];
    expect(id?.startsWith('ethereum-mainnet-')).toBe(true);
    expect(out).toContain(`url(#${id})`);
    expect(out).not.toContain('paint0_linear_1460');
  });

  it('keeps the viewBox and the 32 px size', () => {
    const out = cleanIcon(ICON, 'x');
    expect(out).toContain('viewBox="0 0 32 32"');
    expect(out).toContain('width="32"');
    expect(out).toContain('height="32"');
  });

  it('derives the viewBox from the size and scales the icon to 32 px', () => {
    const out = cleanIcon('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path d="M0 0h200v200z"/></svg>', 'x');
    expect(out).toContain('viewBox="0 0 200 200"');
    expect(out).toContain('width="32"');
    expect(out).toContain('height="32"');
  });

  it('strips scripts, event handlers and outside links', () => {
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="32" viewBox="0 0 32 32" onload="steal()">
<script>alert(1)</script><a href="https://evil.example/"><rect width="32" height="32" fill="red" onclick="steal()"/></a>
<image xlink:href="https://evil.example/x.png" width="4" height="4"/></svg>`;
    const out = cleanIcon(hostile, 'x');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/\son[a-z]+=/i);
    expect(out).not.toContain('evil.example');
  });
});

describe('checkIcon', () => {
  it('accepts a small icon with a viewBox', () => {
    expect(() => checkIcon('<svg viewBox="0 0 32 32"/>', 'x')).not.toThrow();
  });

  it('rejects an icon without a viewBox', () => {
    expect(() => checkIcon('<svg width="32"/>', 'x')).toThrow('x: cleaned icon has no viewBox');
  });

  it('rejects an icon over the size limit', () => {
    expect(() => checkIcon(`<svg viewBox="0 0 32 32">${' '.repeat(MAX_ICON_BYTES)}</svg>`, 'x')).toThrow(/over 20000/);
  });
});
