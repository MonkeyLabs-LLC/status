import { defineMiddleware } from 'astro:middleware';
import { resolveScope, isScopeBlocked } from './lib/scope';

export const onRequest = defineMiddleware(async ({ request, locals, url, rewrite }, next) => {
  const host = request.headers.get('host') || 'localhost';
  const scope = resolveScope(host);

  // Store scope on locals for pages to read.
  (locals as any).scope = scope;

  const path = url.pathname;

  // Scope-lock: if a scoped host requests a different product's detail page, 404.
  if (isScopeBlocked(path, scope)) {
    return new Response('Not found', { status: 404 });
  }

  // If scope is set and the user hits /, rewrite to serve the product detail
  // page at root (e.g. status.sessions.gg/ renders as /sessions).
  if (scope && path === '/') {
    return rewrite(`/${scope}`);
  }

  return next();
});
