# MonkeyLabs / Sessions Status Page

Standalone status page hosted independently of the main Sessions infrastructure. Lives at `status.monkeylabs.gg` (canonical) and `status.sessions.gg` (alias).

Design rationale and roadmap: see `../STATUS.md` in the GolandProjects workspace.

## Why this lives in its own repo

The status page must stay reachable when the main Sessions Worker is broken. Hosting it inside the Sessions repo (or any other repo that deploys to Cloudflare) recreates the SPOF this repo is meant to dodge. Separate repo + separate host = independent failure domain.

## Stack

- **Astro** static build
- **Bananapulse** for the rendering (component tree, incident timeline, Atom feed, theming)
- **Netlify** free tier hosting with multi-domain aliasing
- Polls `https://api.sessions.gg/api/status` directly (CORS allowed on that endpoint for both `status.*.gg` origins)

## Local dev

```
npm install
npm run dev
```

Opens at `http://localhost:4321`. The status page polls live Evolution data, so what you see locally matches production state unless Evolution is unreachable from your machine.

## Deploy

1. Push to `main`
2. Netlify auto-builds (`npm run build`) and publishes `dist/`
3. Both `status.monkeylabs.gg` and `status.sessions.gg` serve the new build within ~60s of cache expiry

## Posting an incident (pre-launch interim)

Until the write-API + admin panel ship (post-launch — see `../STATUS.md`), incidents are managed by editing `src/data/status-incidents.json` and committing.

Incident shape (Bananapulse canonical):
```json
{
  "id": "2026-05-23-frontend-hang",
  "title": "Sessions website unavailable",
  "status": "resolved",
  "severity": "major",
  "affects": ["website"],
  "createdAt": "2026-05-23T17:30:00Z",
  "resolvedAt": "2026-05-23T19:00:00Z",
  "updates": [
    {
      "at": "2026-05-23T17:30:00Z",
      "status": "investigating",
      "body": "Customers are unable to load sessions.gg. Investigating."
    },
    {
      "at": "2026-05-23T18:45:00Z",
      "status": "identified",
      "body": "Root cause: stale Cloudflare Worker deploy due to silent build failure. Pushing fix."
    },
    {
      "at": "2026-05-23T19:00:00Z",
      "status": "resolved",
      "body": "Site is back. Total impact ~24h, no customer data affected (pre-launch, no live customers)."
    }
  ]
}
```

## Branding

`src/styles/theme.css` overrides Bananapulse's CSS variables. Edit there to rebrand without touching the package.

## Adding a future product (e.g., second product launches under MonkeyLabs)

Bananapulse supports component nesting. To add a second product:

1. Add the product's components to Evolution's status tree (existing data model supports parent/child)
2. Add a scope rule in `astro.config.mjs` if you want hostname-aware filtering (e.g., `status.<newproduct>.gg` showing only that product's subtree)
3. Add the new domain to Netlify's domain aliases
4. CORS on Evolution `/api/status` for the new origin

No structural changes to this repo.

## CORS dependency

This page polls `https://api.sessions.gg/api/status` from the browser. Evolution must respond with:

```
Access-Control-Allow-Origin: https://status.monkeylabs.gg
Access-Control-Allow-Origin: https://status.sessions.gg
```

(Or echo the request's Origin if it matches an allowlist.) Without that, the page renders the chrome but shows "Loading status..." indefinitely.
