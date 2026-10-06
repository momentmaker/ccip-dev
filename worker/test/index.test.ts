import { UpstreamHttpError } from '@ccip-dev/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { JOBS, runJobsFor, type Job } from '../src/index';
import { harness, resetStorage } from './helpers';

beforeEach(resetStorage);

describe('runJobsFor', () => {
  it('runs every job for the cron and keeps going after one fails', async () => {
    const ran: string[] = [];
    const jobs: Record<string, Job[]> = {
      '* * * * *': [
        ['first', async () => { ran.push('first'); throw new Error('boom'); }],
        ['second', async () => { ran.push('second'); }],
      ],
    };
    const { c, alerts } = harness({ now: '2026-10-08T12:00:00.000Z' });
    await runJobsFor('* * * * *', c, jobs);
    expect(ran).toEqual(['first', 'second']);
    expect(alerts).toEqual([{ signature: 'job-failed:first', text: 'first failed: boom' }]);
  });

  it('flags a list HTTP 500 as a possible poison message', async () => {
    const jobs: Record<string, Job[]> = {
      '* * * * *': [['ingest', async () => { throw new UpstreamHttpError('GET /messages', 500); }]],
    };
    const { c, alerts } = harness({ now: '2026-10-08T12:00:00.000Z' });
    await runJobsFor('* * * * *', c, jobs);
    expect(alerts[0]!.signature).toBe('job-failed:ingest');
    expect(alerts[0]!.text).toContain('poison message');
  });

  it('does not flag other upstream failures as a poison message', async () => {
    const jobs: Record<string, Job[]> = {
      '* * * * *': [['ingest', async () => { throw new UpstreamHttpError('GET /messages', 503); }]],
      '*/5 * * * *': [['prices', async () => { throw new UpstreamHttpError('GET /prices/current', 500); }]],
    };
    const { c, alerts } = harness({ now: '2026-10-08T12:00:00.000Z' });
    await runJobsFor('* * * * *', c, jobs);
    await runJobsFor('*/5 * * * *', c, jobs);
    expect(alerts.some((a) => a.text.includes('poison message'))).toBe(false);
  });

  it('has jobs for exactly the crons declared in wrangler.toml', () => {
    expect(Object.keys(JOBS).sort()).toEqual(['* * * * *', '*/5 * * * *', '0 * * * *', '0 6 * * *', '10 0 * * *']);
  });
});
