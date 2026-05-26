# MonkeyLabs Status

Custom-built status page for MonkeyLabs products. Astro SSR on Netlify with host-based scope locking. Lives at `status.monkeylabs.gg` (canonical) and `status.sessions.gg` (alias).

## Why this lives in its own repo

The status page must stay reachable when the main Sessions infrastructure is broken. Separate repo + separate host = independent failure domain.

## Local development

```
npm install
npm run dev
```

## Scope-lock testing

The middleware reads the Host header to scope the view:

- `status.monkeylabs.gg` — umbrella, all routes
- `status.sessions.gg` — Sessions only, `/` renders Sessions detail
- `localhost:*` — dev mode, all routes

Test with curl:
```
curl -H "Host: status.sessions.gg" http://localhost:4321/
curl -H "Host: status.sessions.gg" http://localhost:4321/matches  # should 404
```

## Build and deploy

```
npm run build
```

Deploy to Netlify. Configure domain aliases in Site settings (both `status.monkeylabs.gg` and `status.sessions.gg`).

## Adding a new product

1. Add entry to `src/lib/products.ts`
2. Add services to `src/lib/services.ts`
3. Add a detail page at `src/pages/{product-id}.astro`
4. Update scope map in `src/lib/scope.ts`
5. Set `launched: true` when ready

## Wiring real data

Replace the seeded arrays in `src/lib/services.ts`, `incidents.ts`, and `maintenance.ts` with fetches to your status data source. The getter function signatures stay the same.

## DNS

- `status.monkeylabs.gg` CNAME to Netlify site
- `status.sessions.gg` CNAME to same Netlify site
- Future product subdomains follow the same pattern
