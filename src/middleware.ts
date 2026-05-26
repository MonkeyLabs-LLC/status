import { defineMiddleware } from 'astro:middleware';
import { resolveScope } from './lib/scope';

const PASSTHROUGH = new Set(['/feed.xml', '/api/status.json', '/api/subscribe']);

export const onRequest = defineMiddleware(async ({ request, locals, url, rewrite }, next) => {
  const host = request.headers.get('host') || 'localhost';
  const scope = resolveScope(host);
  (locals as any).scope = scope;

  const path = url.pathname;

  if (!scope) return next();

  // Scoped host: passthrough special paths and static assets
  if (PASSTHROUGH.has(path) || path.startsWith('/_astro/') || path.startsWith('/api/')) {
    return next();
  }

  // Rewrite all paths: / → /sessions, /incidents → /sessions/incidents, etc.
  const target = path === '/' ? `/${scope}` : `/${scope}${path}`;
  return rewrite(target);
});
