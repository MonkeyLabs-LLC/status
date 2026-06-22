import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import node from '@astrojs/node';

// Selectable adapter — this instance's deploy seam (keeps the Pulse engine generic).
//   STATUS_ADAPTER=netlify  (default) → @astrojs/netlify, the live Netlify deploy.
//   STATUS_ADAPTER=node               → @astrojs/node standalone, the self-host path
//                                       (Docker + traefik + Cloudflare; see deploy/status/).
// Default is netlify so the existing Netlify build is unchanged when the flag is unset.
const target = process.env.STATUS_ADAPTER ?? 'netlify';

const adapter =
  target === 'node'
    ? node({ mode: 'standalone' })
    : netlify();

export default defineConfig({
  site: 'https://status.monkeylabs.gg',
  output: 'server',
  adapter,
});
