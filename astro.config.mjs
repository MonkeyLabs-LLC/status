import { defineConfig } from 'astro/config';
import bananapulse from 'bananapulse';

// Standalone status site for MonkeyLabs / Sessions. Hosted on Netlify with
// multi-domain aliasing: `status.monkeylabs.gg` (canonical) and
// `status.sessions.gg` both serve this build. Client-side scope logic in
// the layout reads `window.location.hostname` to scope the view per product
// (today: one product = no actual filtering; ready for product #2 without
// repo changes).
//
// Polls Evolution's canonical status endpoint directly (CORS must be open
// on `api.sessions.gg/api/status` for both origins). No same-origin proxy
// because there is no Worker here — this is pure static.
export default defineConfig({
  site: 'https://status.monkeylabs.gg',
  output: 'static',
  integrations: [
    bananapulse({
      // Mount at root: this whole site IS the status page. Routes injected:
      //   /                  → overall status + component tree
      //   /incidents         → incident history (lean: last 14 days)
      //   /incidents.xml     → Atom feed
      mountPath: '/',
      name: 'MonkeyLabs',
      domain: 'status.monkeylabs.gg',

      // Evolution's canonical /api/status, hit directly with CORS allowed.
      // The `canonical` source type means Bananapulse trusts the upstream
      // shape and skips per-consumer mapping.
      sources: [{ url: 'https://api.sessions.gg/api/status', type: 'canonical' }],

      // Committed-to-repo incidents file. Bananapulse materializes
      // /incidents and /incidents.xml from this at build time. Posting an
      // incident = commit + push (until the write-API + admin panel ship
      // post-launch).
      incidentsPath: './src/data/status-incidents.json',

      // MonkeyLabs theme (CSS variable overrides). Edit
      // src/styles/theme.css to rebrand without touching the package.
      themeCssPath: './src/styles/theme.css',
    }),
  ],
});
