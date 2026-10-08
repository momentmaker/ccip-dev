import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FreshnessNote from '../src/components/FreshnessNote';

const html = (paused: boolean, updatedAt: string | null = null) => renderToString(createElement(FreshnessNote, { updatedAt, paused }));

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

  it('keeps the age out of the announced text, which would otherwise change every second', () => {
    const out = html(true, '2026-10-07T12:00:00.000Z');
    expect(out).toMatch(/role="status"[^>]*>Live data paused — retrying<\/p>/);
  });
});
