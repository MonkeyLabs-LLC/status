import { defineMiddleware } from 'astro:middleware';
import { resolveScope } from './lib/scope';
import { verifyCookie, COOKIE_NAME } from './lib/admin-auth';

const PASSTHROUGH = new Set(['/feed.xml', '/api/status.json', '/api/subscribe', '/history']);

export const onRequest = defineMiddleware(async ({ request, locals, url, cookies, redirect, rewrite }, next) => {
  const host = request.headers.get('host') || 'localhost';
  const scope = resolveScope(host);
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
    return next();
  }

  if (!scope) return next();

  // Passthrough special paths and static assets
  if (PASSTHROUGH.has(path) || path.startsWith('/_astro/') || path.startsWith('/api/')) {
    return next();
  }

  // Already rewritten — path starts with /scope, don't rewrite again
  if (path.startsWith(`/${scope}`)) {
    return next();
  }

  // Rewrite: / → /sessions, /incidents → /sessions/incidents, etc.
  const target = path === '/' ? `/${scope}` : `/${scope}${path}`;
  return rewrite(target);
});
