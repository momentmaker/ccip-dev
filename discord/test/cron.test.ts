import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { resetStorage } from './helpers';

/** A sticker-run lock left by a run that died 20 minutes ago: a run that starts takes it over, and lets it go when done. */
async function staleLock(): Promise<void> {
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('sticker-run', ?)").bind(new Date(Date.now() - 20 * 60_000).toISOString()).run();
}

async function cron(environment: typeof env): Promise<string | null> {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: '*/10 * * * *' }), environment, ctx);
  await waitOnExecutionContext(ctx);
  return (await env.DB.prepare("SELECT value FROM meta WHERE key = 'sticker-run'").first<{ value: string }>())?.value ?? null;
}

beforeEach(resetStorage);

describe('the cron', () => {
  it('runs the sticker job once LinkMarines on Telegram is on and has its owner', async () => {
    // #given
    await staleLock();
    // #when the roster is empty, so the run has nothing to send
    const lock = await cron({ ...env, TELEGRAM_BOT: 'on', TELEGRAM_STICKER_OWNER_ID: '42', TELEGRAM_WEBHOOK_SECRET: 'secret' });
    // #then
    expect(lock).toBeNull();
  });

  it('leaves the sticker job alone while TELEGRAM_BOT is off', async () => {
    // #given
    await staleLock();
    // #when
    const lock = await cron(env);
    // #then
    expect(lock).not.toBeNull();
  });
});
