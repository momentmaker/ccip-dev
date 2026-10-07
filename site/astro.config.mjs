import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://ccip.dev',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  redirects: { '/history': '/history/30d/' },
  integrations: [react()],
});
