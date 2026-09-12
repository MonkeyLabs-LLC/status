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

import { STATUS_PROFILE, type StatusScopeProfile } from './status.profile';

export type ScopeConfig = StatusScopeProfile;

export { STATUS_PROFILE };

export const COMPANY = STATUS_PROFILE.branding.company;
export const COMPANY_LEGAL = STATUS_PROFILE.branding.legal;
export const FOOTER_DOMAINS = [...STATUS_PROFILE.branding.footerDomains];

/** Feed/page metadata, derived from the spaced company name (NOT a second source). */
export const SITE_TITLE = `${COMPANY} Status`;
export const SITE_DESCRIPTION = `Real-time status and incident history for ${COMPANY} services.`;
export const SUPPORT_EMAIL = STATUS_PROFILE.branding.supportEmail;
/** localStorage key for the public page's light/dark preference. */
export const THEME_STORAGE_KEY = STATUS_PROFILE.branding.themeStorageKey;

export const SCOPES: ScopeConfig[] = STATUS_PROFILE.branding.scopes.map((scope) => ({ ...scope }));

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
