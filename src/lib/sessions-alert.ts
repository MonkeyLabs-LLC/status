/**
 * Drive the Sessions.gg storefront site-alert (Evolution's SiteAlert) from the
 * status system — so the "Emergency maintenance" button posts to the storefront
 * too, not just the status page.
 *
 * Calls Evolution's token-gated POST /internal/site-alert. No-ops silently if the
 * env isn't wired (EVOLUTION_INTERNAL_URL + INTERNAL_SECRET), so a status deploy
 * without these set never errors — it just won't drive the storefront banner.
 */
const EVO = (process.env.EVOLUTION_INTERNAL_URL || process.env.PUBLIC_EVOLUTION_URL || '').replace(/\/$/, '');
const SECRET = process.env.INTERNAL_SECRET || '';

export async function setSessionsSiteAlert(opts: { active: boolean; level?: string; message?: string }): Promise<boolean> {
  if (!EVO || !SECRET) return false; // not wired in this environment — skip
  try {
    const res = await fetch(`${EVO}/internal/site-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': SECRET },
      body: JSON.stringify({
        active: opts.active,
        level: opts.level ?? 'critical',
        message: opts.message ?? '',
        maintenance: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (e) {
    console.error('[sessions-alert] failed to reach Evolution', e);
    return false;
  }
}
