import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

export default defineConfig({
  site: 'https://status.monkeylabs.gg',
  output: 'server',
  adapter: netlify(),
});
