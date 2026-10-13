import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')) },
        // The SITE binding's target: a stand-in for the site Worker's LinkMarineCards entrypoint.
        workers: [{ name: 'ccip-dev-site', modules: true, compatibilityDate: '2026-10-01', scriptPath: path.join(import.meta.dirname, 'test/site-stub.js') }],
      },
    })),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
});
