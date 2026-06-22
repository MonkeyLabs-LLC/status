import { defineMiddleware } from 'astro:middleware';
import { resolveScope } from './lib/scope';
import { verifyCookie, COOKIE_NAME } from './lib/admin-auth';
import { SCOPES, UMBRELLA_ID } from './pulse.config';
import { startScheduler } from './lib/scheduler';

// Internal scheduler boot — no-op unless STATUS_ADAPTER === 'node' (self-host).
// Lives here because middleware is the one module guaranteed to load in the
// running SSR server process; idempotent so it only ever starts the timers once.
startScheduler();

// Paths that must NEVER be edge-cached: mutations, admin, ingest, sweep,
// subscribe/unsubscribe. Everything else (public pages + status.json) is
// cacheable so Cloudflare absorbs an outage-time refresh spike.
function isNoStorePath(path: string): boolean {
  return (
    path.startsWith('/admin') ||
    path.startsWith('/api/admin') ||
    path.startsWith('/api/v1/admin') ||
    path.startsWith('/api/v1/ingest') ||
    path.startsWith('/api/v1/sweep') ||
    path.startsWith('/api/subscribe') ||
    path.startsWith('/api/unsubscribe')
  );
}

export const onRequest = defineMiddleware(async ({ request, locals, url, cookies, redirect }, next) => {
  const host = request.headers.get('host') || 'localhost';
  let scope = resolveScope(host);

  // DEV-ONLY: preview any configured brand locally via ?scope=<scope id>
  // (real deploys pick the brand from the Host header). Persisted in a cookie so
  // it survives the internal rewrite that re-runs this middleware. import.meta.env
  // .DEV is false in production builds, so this is dead code there.
  if (import.meta.env.DEV) {
    const s = url.searchParams.get('scope');
    if (s === UMBRELLA_ID) cookies.delete('__scope', { path: '/' });
    else if (s) cookies.set('__scope', s, { path: '/', httpOnly: false });
    const ov = s ?? cookies.get('__scope')?.value ?? null;
    if (ov === UMBRELLA_ID) scope = null;
    else if (ov && SCOPES.some((sc) => sc.id === ov)) scope = ov;
  }

  (locals as any).scope = scope;

  const path = url.pathname;

  // Admin auth — protect /admin/* except login and verify
  if (path.startsWith('/admin') && path !== '/admin/login' && path !== '/admin/verify') {
    const sessionCookie = cookies.get(COOKIE_NAME)?.value;

    if (!sessionCookie) {
      return redirect('/admin/login');
    }

    const secret = process.env.ADMIN_SESSION_SECRET;
    if (!secret) {
      return redirect('/admin/login');
    }

    const sessionId = verifyCookie(sessionCookie, secret);
    if (!sessionId) {
      return redirect('/admin/login');
    }

    const { validateSession } = await import('./lib/admin-auth');
    const email = await validateSession(sessionId);
    if (!email) {
      cookies.delete(COOKIE_NAME, { path: '/' });
      return redirect('/admin/login');
    }

    (locals as any).adminEmail = email;
    const adminRes = await next();
    adminRes.headers.set('Cache-Control', 'no-store');
    return adminRes;
  }

  // Node routing is relative to the scope's landing root (resolved in
  // lib/components from locals.scope), so no host-based path rewrite is needed.
  const res = await next();

  // Cache-Control policy (per SELFHOST-MIGRATION.md "Cache headers to set"):
  //  - mutations/admin/ingest/sweep/subscribe → no-store (never cache).
  //  - everything else (public page + status.json) → CDN-cacheable so Cloudflare
  //    absorbs an outage-time refresh spike with ≤30s update lag.
  // status.json sets its own (richer, with the 503 fail-closed branch) header, so
  // don't clobber an already-set Cache-Control.
  if (isNoStorePath(path)) {
    res.headers.set('Cache-Control', 'no-store');
  } else if (!res.headers.has('Cache-Control')) {
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  }
  return res;
});
