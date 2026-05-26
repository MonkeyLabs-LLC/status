import type { APIRoute } from 'astro';
import { getServices } from '../../lib/services';
import { getActiveIncidents } from '../../lib/incidents';
import { getUpcomingMaintenances } from '../../lib/maintenance';
import { worstStatus, statusToState } from '../../lib/types';

export const GET: APIRoute = async ({ locals }) => {
  const scope = (locals as any).scope as string | null;

  const services = await getServices({ product: scope || undefined });
  const overall = worstStatus(services);
  const activeIncidents = await getActiveIncidents(scope || undefined);
  const maintenances = await getUpcomingMaintenances(scope || undefined);

  const body = {
    status: overall,
    state: statusToState(overall),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      product: s.product,
      status: s.status,
    })),
    activeIncidents: activeIncidents.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      started: i.started,
    })),
    scheduledMaintenance: maintenances.map((m) => ({
      id: m.id,
      title: m.title,
      scheduledStart: m.scheduledStart,
      scheduledEnd: m.scheduledEnd,
    })),
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
