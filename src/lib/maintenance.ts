import type { Maintenance, PaginatedQuery } from './types';

const now = new Date();

const MAINTENANCES: Maintenance[] = [
  {
    id: 'maint-001',
    title: 'Scheduled infrastructure upgrade',
    product: 'sessions',
    scheduledStart: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    scheduledEnd: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
    body: 'We will be performing a scheduled infrastructure upgrade. Brief interruptions to game server provisioning are possible during this window.',
  },
];

export function getMaintenances(query: PaginatedQuery = {}): Maintenance[] {
  const { limit = 50, offset = 0, product } = query;
  let result = MAINTENANCES;
  if (product) {
    result = result.filter(m => m.product === product);
  }
  return result.slice(offset, offset + limit);
}

export function getUpcomingMaintenances(product?: string): Maintenance[] {
  const now = Date.now();
  let result = MAINTENANCES.filter(m => new Date(m.scheduledEnd).getTime() > now);
  if (product) {
    result = result.filter(m => m.product === product);
  }
  return result;
}
