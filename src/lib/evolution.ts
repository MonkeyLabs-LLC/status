/**
 * Fetches live status data from Evolution's /api/status endpoint.
 * Falls back to empty data if the fetch fails — the status page must
 * never depend on Evolution being up to render.
 */

import type { Service, ServiceStatus, Incident, IncidentSeverity, IncidentStatus, TimelineEntry, Maintenance } from './types';

const EVOLUTION_URL = 'https://api.sessions.gg';
const FETCH_TIMEOUT = 5000;

interface EvolutionComponent {
  id: number;
  slug: string;
  name: string;
  description?: string;
  status: string;
  message?: string;
  lastProbedAt?: string;
  children?: EvolutionComponent[];
}

interface EvolutionIncident {
  id: string;
  severity: string;
  title: string;
  body: string;
  startedAt: string;
  resolvedAt?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  affectedComponents?: string[];
  postmortemUrl?: string;
  updates: { body: string; postedAt: string }[];
}

interface EvolutionStatusResponse {
  overall: string;
  components: EvolutionComponent[];
  incidents: EvolutionIncident[];
  maintenance: EvolutionIncident[];
  updatedAt: string;
}

function mapStatus(s: string): ServiceStatus {
  switch (s) {
    case 'operational': return 'operational';
    case 'degraded': return 'degraded';
    case 'major': return 'outage';
    case 'maintenance': return 'maintenance';
    default: return 'operational';
  }
}

function mapSeverity(s: string): IncidentSeverity {
  switch (s) {
    case 'degraded': return 'moderate';
    case 'major': return 'major';
    case 'maintenance': return 'minor';
    default: return 'minor';
  }
}

function flattenComponents(components: EvolutionComponent[], product: string): Service[] {
  const services: Service[] = [];
  for (const c of components) {
    if (c.children && c.children.length > 0) {
      // Group node — recurse into children
      services.push(...flattenComponents(c.children, product));
    } else {
      // Leaf node — this is a service
      services.push({
        id: c.slug,
        name: c.name,
        product,
        status: mapStatus(c.status),
        uptime90d: [], // Evolution doesn't provide 90-day history yet
      });
    }
  }
  return services;
}

function mapIncident(i: EvolutionIncident, product: string): Incident {
  const timeline: TimelineEntry[] = i.updates.map(u => ({
    status: i.resolvedAt ? 'resolved' as IncidentStatus : 'investigating' as IncidentStatus,
    body: u.body,
    timestamp: u.postedAt,
  }));

  return {
    id: i.id,
    title: i.title,
    severity: mapSeverity(i.severity),
    status: i.resolvedAt ? 'resolved' : 'investigating',
    product,
    affects: i.affectedComponents,
    started: i.startedAt,
    resolved: i.resolvedAt,
    timeline,
  };
}

function mapMaintenance(i: EvolutionIncident, product: string): Maintenance {
  return {
    id: i.id,
    title: i.title,
    product,
    scheduledStart: i.scheduledStartAt || i.startedAt,
    scheduledEnd: i.scheduledEndAt || i.startedAt,
    body: i.body,
  };
}

let cachedData: {
  services: Service[];
  incidents: Incident[];
  maintenances: Maintenance[];
  overall: ServiceStatus;
  fetchedAt: number;
} | null = null;

const CACHE_TTL = 15_000; // 15 seconds

export async function fetchEvolutionStatus() {
  // Return cache if fresh
  if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL) {
    return cachedData;
  }

  const empty = {
    services: [] as Service[],
    incidents: [] as Incident[],
    maintenances: [] as Maintenance[],
    overall: 'operational' as ServiceStatus,
    fetchedAt: Date.now(),
  };

  try {
    const res = await fetch(`${EVOLUTION_URL}/api/status`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) throw new Error(`status ${res.status}`);

    const data: EvolutionStatusResponse = await res.json();
    const product = 'sessions';

    const services = flattenComponents(data.components || [], product);
    const incidents = (data.incidents || []).map(i => mapIncident(i, product));
    const maintenances = (data.maintenance || []).map(i => mapMaintenance(i, product));
    const overall = mapStatus(data.overall || 'operational');

    cachedData = { services, incidents, maintenances, overall, fetchedAt: Date.now() };
    return cachedData;
  } catch (_e) {
    // Evolution unreachable — return cached data or empty
    return cachedData || empty;
  }
}
