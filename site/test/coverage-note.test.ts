import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CoverageNote from '../src/components/CoverageNote';

const html = (coverage: Parameters<typeof CoverageNote>[0]['coverage']) => renderToString(createElement(CoverageNote, { coverage }));

describe('coverage note', () => {
  it('says the labeled share and links to the projects', () => {
    // #given
    const coverage = { messages_pct: 81.2, usd_pct: 94.4, fees_pct: 90, window: '7d' as const };
    // #then
    expect(html(coverage)).toMatch(/Labeled senders: 81% of messages, 94% of value \(last 7 days\)(<!-- -->)?\. <a href="\/projects\/">See the projects<\/a>/);
  });

  it('renders nothing for a status.json from before coverage existed', () => {
    // #then
    expect(html(undefined)).toBe('');
  });

  it('says the part credited via a token when the coverage has it', () => {
    // #given
    const coverage = { messages_pct: 74.2, usd_pct: 61.3, fees_pct: 70, via_token_messages_pct: 45.1, via_token_usd_pct: 20, via_token_fees_pct: 30, window: '7d' as const };
    // #then
    expect(html(coverage)).toMatch(/Labeled: 74% of messages \(29% sent by a labeled project, 45% via its token\), 61% of value \(last 7 days\)(<!-- -->)?\. <a href="\/projects\/">See the projects<\/a>/);
  });
});
