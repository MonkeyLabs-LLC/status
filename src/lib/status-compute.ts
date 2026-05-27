const STATUS_RANK: Record<string, number> = {
  ok: 0,
  maint: 1,
  deg: 2,
  out: 3,
};

export function worstStatus(statuses: string[]): string {
  if (statuses.length === 0) return 'ok';
  let worst = 'ok';
  for (const s of statuses) {
    if ((STATUS_RANK[s] ?? 0) > (STATUS_RANK[worst] ?? 0)) worst = s;
  }
  return worst;
}

export function statusToBodyClass(status: string): string {
  switch (status) {
    case 'deg': return 'state-degraded';
    case 'out': return 'state-outage';
    case 'maint': return 'state-queued';
    default: return 'state-working';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'ok': return 'OPERATIONAL';
    case 'deg': return 'DEGRADED';
    case 'out': return 'OUTAGE';
    case 'maint': return 'MAINTENANCE';
    default: return 'UNKNOWN';
  }
}

export function statusHeadline(status: string): string {
  switch (status) {
    case 'ok': return 'All systems operational';
    case 'deg': return 'Some services are experiencing issues';
    case 'out': return 'Major service disruption';
    case 'maint': return 'Scheduled maintenance in progress';
    default: return 'System status unknown';
  }
}
