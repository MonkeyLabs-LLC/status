import type { APIRoute } from 'astro';
import { getPublicServices } from '../../lib/db-services';
import { getActiveIncidents } from '../../lib/db-incidents';
import { getUpcomingMaintenance } from '../../lib/db-maintenance';
import { worstStatus, statusToState } from '../../lib/types';

export const GET: APIRoute = async ({ locals }) => {
  const scope = (locals as any).scope as string | null;

  try {
    const services = await getPublicServices({ product: scope || undefined });
    const overall = worstStatus(services);
    const activeIncidents = await getActiveIncidents(scope || undefined);
    const maintenances = await getUpcomingMaintenance(scope || undefined);

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
  } catch (_e) {
    // DB unreachable — return empty operational state
    const body = {
      status: 'operational',
      state: 'working',
      services: [],
      activeIncidents: [],
      scheduledMaintenance: [],
    };

    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
