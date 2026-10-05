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

  it('has jobs for exactly the crons declared in wrangler.toml', () => {
    expect(Object.keys(JOBS).sort()).toEqual(['* * * * *', '*/5 * * * *', '0 * * * *', '0 6 * * *', '10 0 * * *']);
  });
});
