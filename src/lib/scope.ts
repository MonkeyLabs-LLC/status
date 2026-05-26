/**
 * Resolves a hostname to a product scope.
 * Returns null for the umbrella scope (all products visible).
 */
export function resolveScope(host: string): string | null {
  // Strip port for localhost dev
  const hostname = host.split(':')[0];

  switch (hostname) {
    case 'status.sessions.gg':  return 'sessions';
    case 'status.matches.gg':   return 'matches';
    case 'status.rooms.gg':     return 'rooms';
    case 'status.monkeylabs.gg': return null;
    default: return null; // localhost, dev, etc. — all routes accessible
  }
}

/** Product detail page paths and their corresponding product IDs. */
const PRODUCT_PAGES: Record<string, string> = {
  '/sessions': 'sessions',
  '/matches':  'matches',
  '/rooms':    'rooms',
};

/**
 * Given a URL path and a scope, determine if the request should be blocked.
 * Returns true if the scope doesn't allow this path.
 */
export function isScopeBlocked(path: string, scope: string | null): boolean {
  if (scope === null) return false; // umbrella scope, nothing blocked

  const productForPath = PRODUCT_PAGES[path];
  if (productForPath && productForPath !== scope) return true;

  return false;
}
