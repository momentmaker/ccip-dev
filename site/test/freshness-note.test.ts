import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FreshnessNote from '../src/components/FreshnessNote';

const html = (paused: boolean) => renderToString(createElement(FreshnessNote, { updatedAt: null, paused }));

describe('FreshnessNote live region', () => {
  it('is always in the page as an empty status region while data is flowing', () => {
    const out = html(false);
    expect(out).toContain('role="status"');
    expect(out).not.toContain('paused');
    expect(out).not.toContain('Live data paused');
  });

  it('fills that same region when paused', () => {
    const out = html(true);
    expect(out).toMatch(/<p[^>]*role="status"[^>]*>Live data paused/);
  });

  it('keeps the region as the first element in both states so React reuses it', () => {
    expect(html(false)).toMatch(/^<p [^>]*role="status"/);
    expect(html(true)).toMatch(/^<p [^>]*role="status"/);
  });
});
