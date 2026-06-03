/**
 * ── THE INSTANCE SEAM (Banana Pulse) ───────────────────────────────────────
 *
 * Everything Monkey-Labs-specific lives HERE, plus two siblings:
 *   - /public/brand/*.png   (the logos)
 *   - src/styles/brand.css  (the per-scope accent palette)
 *
 * The rest of the codebase is brandless **Pulse** — the quorum engine, the
 * ingest contract, the one-design skin, the resource-driven admin. It knows
 * nothing about "Monkey Labs", "Sessions", or any brand; it reads this config.
 *
 * To run a different company's status page: edit this file + swap brand.css +
 * the /public/brand assets. To physically extract the OSS `pulse` package:
 * move everything EXCEPT this file, brand.css, and /public/brand into the
 * package — this file is the instance's only code.
 */

export interface ScopeConfig {
  /** Scope id — also the id of this scope's landing-root component. */
  id: string;
  /** Host header that lands on this scope. */
  host: string;
  /** The umbrella/root scope (resolveScope returns null for it publicly). */
  umbrella?: boolean;
  wordmark: string;
  /** Logo served from /public/brand. */
  logo: string;
}

export const COMPANY = 'Monkey Labs';
export const COMPANY_LEGAL = '© 2026 Monkey Labs LLC';
export const FOOTER_DOMAINS = ['monkeylabs.gg', 'sessions.gg', 'bananalabs.gg'];

/** Feed/page metadata, derived from the spaced company name (NOT a second source). */
export const SITE_TITLE = `${COMPANY} Status`;
export const SITE_DESCRIPTION = `Real-time status and incident history for ${COMPANY} services.`;
export const SUPPORT_EMAIL = 'hello@monkeylabs.gg';

export const SCOPES: ScopeConfig[] = [
  { id: 'monkeylabs', host: 'status.monkeylabs.gg', umbrella: true, wordmark: 'Monkey Labs', logo: '/brand/monkeylabs.png' },
  { id: 'sessions',   host: 'status.sessions.gg',   wordmark: 'Sessions',    logo: '/brand/sessions.png' },
  { id: 'bananalabs', host: 'status.bananalabs.gg', wordmark: 'Banana Labs', logo: '/brand/bananalabs.png' },
];

export const UMBRELLA_ID = SCOPES.find((s) => s.umbrella)!.id;
/** The umbrella status host (for absolute URLs in feeds / permalinks). */
export const STATUS_DOMAIN = SCOPES.find((s) => s.umbrella)!.host;

const byHost = new Map(SCOPES.map((s) => [s.host, s]));
const byId = new Map(SCOPES.map((s) => [s.id, s]));

/** Host → public scope id ('sessions'|'bananalabs'|…); null = umbrella. */
export function scopeForHost(host: string): string | null {
  const hostname = host.split(':')[0];
  const s = byHost.get(hostname);
  return !s || s.umbrella ? null : s.id;
}

/** Public scope (null = umbrella) → the landing-root component id. */
export function rootComponentId(scope: string | null): string {
  return scope && byId.has(scope) ? scope : UMBRELLA_ID;
}

/** Public scope (null = umbrella) → brand identity (wordmark + logo). */
export function scopeBrand(scope: string | null): ScopeConfig {
  return byId.get(scope ?? UMBRELLA_ID) ?? SCOPES[0];
}
