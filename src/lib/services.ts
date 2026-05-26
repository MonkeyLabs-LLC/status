import type { Service, PaginatedQuery, DayStatus } from './types';

/** Generate a 90-day uptime array: mostly ok, a few degraded days scattered in. */
function makeUptime(degradedDays: number[]): DayStatus[] {
  const days: DayStatus[] = [];
  for (let i = 0; i < 90; i++) {
    days.push(degradedDays.includes(i) ? 'deg' : 'ok');
  }
  return days;
}

const SERVICES: Service[] = [
  {
    id: 'sessions-api',
    name: 'API',
    product: 'sessions',
    status: 'operational',
    uptime90d: makeUptime([12, 47]),
  },
  {
    id: 'sessions-provisioner',
    name: 'Provisioner',
    product: 'sessions',
    status: 'operational',
    uptime90d: makeUptime([47]),
  },
  {
    id: 'sessions-game-servers',
    name: 'Game Servers',
    product: 'sessions',
    status: 'operational',
    uptime90d: makeUptime([30, 47, 88]),
  },
  {
    id: 'sessions-payments',
    name: 'Payments',
    product: 'sessions',
    status: 'operational',
    uptime90d: makeUptime([]),
  },
  {
    id: 'sessions-email',
    name: 'Email',
    product: 'sessions',
    status: 'operational',
    uptime90d: makeUptime([5]),
  },
  {
    id: 'sessions-frontend',
    name: 'Frontend',
    product: 'sessions',
    status: 'operational',
    uptime90d: makeUptime([47, 48]),
  },
];

export function getServices(query: PaginatedQuery = {}): Service[] {
  const { limit = 50, offset = 0, product } = query;
  let result = SERVICES;
  if (product) {
    result = result.filter(s => s.product === product);
  }
  return result.slice(offset, offset + limit);
}

export function getServicesByProduct(product: string): Service[] {
  return SERVICES.filter(s => s.product === product);
}
