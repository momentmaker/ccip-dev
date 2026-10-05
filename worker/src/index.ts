import { UpstreamSchemaError } from '@ccip-dev/core';
import { createRunContext, type RunContext } from './context';
import { realDeps } from './deps';
import type { Env } from './env';
import { runDetails } from './jobs/details';
import { runFinalize } from './jobs/finalize';
import { runHourly } from './jobs/hourly';
import { runIngest } from './jobs/ingest';
import { runPrices } from './jobs/prices';

export type Job = [name: string, run: (c: RunContext) => Promise<void>];

export const JOBS: Readonly<Record<string, Job[]>> = {
  '* * * * *': [
    ['ingest', (c) => runIngest(c)],
    ['details', (c) => runDetails(c, { limit: 10 })],
  ],
  '*/5 * * * *': [['prices', runPrices]],
  '0 * * * *': [['hourly', runHourly]],
  '10 0 * * *': [['finalize', (c) => runFinalize(c, 'early')]],
  '0 6 * * *': [['finalize', (c) => runFinalize(c, 'late')]],
};

export async function runJobsFor(cron: string, c: RunContext, jobs: Readonly<Record<string, Job[]>> = JOBS): Promise<void> {
  const scheduled = jobs[cron];
  if (!scheduled) {
    console.error(`no jobs registered for cron "${cron}"`);
    return;
  }
  for (const [name, run] of scheduled) {
    try {
      await run(c);
    } catch (err) {
      const sample = err instanceof UpstreamSchemaError ? ` (response sample: ${err.sample.slice(0, 200)})` : '';
      const message = `${err instanceof Error ? err.message : String(err)}${sample}`;
      console.error(`job ${name} failed: ${message}`);
      try {
        await c.alert(`job-failed:${name}`, `${name} failed: ${message}`);
      } catch (alertErr) {
        console.error(`alert for job ${name} also failed: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`);
      }
    }
  }
}

export default {
  async scheduled(controller, env) {
    await runJobsFor(controller.cron, createRunContext(env, realDeps));
  },
} satisfies ExportedHandler<Env>;
