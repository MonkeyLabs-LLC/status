/**
 * Resolves a hostname to a product scope.
 * Returns null for the umbrella scope (all products visible).
 */
export function resolveScope(host: string): string | null {
  const hostname = host.split(':')[0];

  switch (hostname) {
    case 'status.sessions.gg':   return 'sessions';
    case 'status.bananalabs.gg': return 'bananalabs';
    case 'status.matches.gg':    return 'matches';
    case 'status.rooms.gg':      return 'rooms';
    case 'status.monkeylabs.gg': return null;
    default: return null;
  }
}
