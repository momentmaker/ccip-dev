import type { RunContext } from './context';

export const SITE_DISPATCH_URL = 'https://api.github.com/repos/momentmaker/ccip-dev/actions/workflows/site.yml/dispatches';

/**
 * Starts the site build right after a history publish, so pages refresh within minutes. GitHub's scheduled runs of the
 * same workflow arrive hours late; they stay as the fallback, so a failed dispatch only alerts.
 */
export async function triggerSiteBuild(c: RunContext): Promise<void> {
  const token = c.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return;
  try {
    const res = await c.deps.fetch(SITE_DISPATCH_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'ccip.dev-worker',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (res.status !== 204) await c.alert('site-dispatch', `Site build dispatch failed: HTTP ${res.status}; the scheduled build will catch up`);
  } catch (err) {
    await c.alert('site-dispatch', `Site build dispatch failed: ${err instanceof Error ? err.message : String(err)}; the scheduled build will catch up`);
  }
}
