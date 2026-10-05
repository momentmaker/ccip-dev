import { execFileSync } from 'node:child_process';

export function wrangler(args: string[], options: { token?: string; inherit?: boolean } = {}): string {
  const output = execFileSync('pnpm', ['--filter', '@ccip-dev/worker', 'exec', 'wrangler', ...args], {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, ...(options.token ? { CLOUDFLARE_API_TOKEN: options.token } : {}) },
  });
  return output ?? '';
}

export function d1Query<T>(sql: string): T[] {
  const parsed = JSON.parse(wrangler(['d1', 'execute', 'ccip-dev', '--remote', '--json', '--command', sql])) as { results?: T[] }[];
  return parsed[0]?.results ?? [];
}
