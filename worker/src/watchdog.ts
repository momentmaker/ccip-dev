import { sendTelegramMessage } from './telegram';

export interface WatchdogEnv {
  STATUS_URL: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALERT_CHAT_ID?: string;
}

export interface WatchdogDeps {
  fetch: typeof fetch;
  now: () => Date;
}

export interface Problem {
  reason: string;
  measured?: number;
}

const STALE_AFTER_SECONDS = 900;
const NEW_PROBLEM_WINDOW_SECONDS = 1260;
const FETCH_TIMEOUT_MS = 20_000;
const UNREADABLE: Problem = { reason: 'status.json is unreachable or unreadable' };

async function readStatus(url: string, fetchFn: typeof fetch): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function detectProblem(url: string, fetchFn: typeof fetch, now: Date): Promise<Problem | null> {
  const status = await readStatus(url, fetchFn);
  const updatedAt = typeof status?.updated_at === 'string' ? Date.parse(status.updated_at) : NaN;
  if (!status || Number.isNaN(updatedAt)) return UNREADABLE;

  const age = Math.floor((now.getTime() - updatedAt) / 1000);
  if (age > STALE_AFTER_SECONDS) return { reason: `status.json is ${age}s old`, measured: age };

  const lag = status.lag_seconds;
  if (typeof lag !== 'number') return { reason: 'ingest has never succeeded (lag_seconds is null)' };
  if (lag > STALE_AFTER_SECONDS) return { reason: `ingest lag is ${Math.floor(lag)}s`, measured: lag };
  return null;
}

export function shouldAlert(problem: Problem, now: Date): boolean {
  const isNew =
    problem.measured !== undefined &&
    problem.measured > STALE_AFTER_SECONDS &&
    problem.measured <= NEW_PROBLEM_WINDOW_SECONDS;
  return isNew || now.getUTCMinutes() < 5;
}

export async function runWatchdog(env: WatchdogEnv, deps: WatchdogDeps): Promise<void> {
  const now = deps.now();
  const problem = await detectProblem(env.STATUS_URL, deps.fetch, now);
  if (!problem || !shouldAlert(problem, now)) return;

  const text = `ccip.dev watchdog: ${problem.reason}`;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALERT_CHAT_ID) {
    console.warn(`[watchdog] ${text}`);
    return;
  }
  const failure = await sendTelegramMessage(deps.fetch, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, text);
  if (failure) console.error(`[watchdog] ${failure}`);
}

export default {
  async scheduled(_controller, env) {
    await runWatchdog(env, { fetch: (input, init) => fetch(input, init), now: () => new Date() });
  },
} satisfies ExportedHandler<WatchdogEnv>;
