import type { Incident, PaginatedQuery } from './types';

const now = new Date();

const INCIDENTS: Incident[] = [
  {
    id: 'inc-001',
    title: 'Elevated API response times',
    severity: 'minor',
    status: 'investigating',
    product: 'sessions',
    started: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    timeline: [
      {
        status: 'investigating',
        body: 'We are investigating reports of elevated API response times affecting some requests. No data loss expected.',
        timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    id: 'inc-002',
    title: 'Game server deployment delays',
    severity: 'moderate',
    status: 'resolved',
    product: 'sessions',
    started: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    resolved: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    timeline: [
      {
        status: 'investigating',
        body: 'We are investigating delays in game server provisioning. New sessions may take longer than usual to start.',
        timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        status: 'identified',
        body: 'The issue has been identified as a capacity bottleneck in our provisioning pipeline. We are scaling up resources.',
        timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
      },
      {
        status: 'monitoring',
        body: 'Additional capacity has been deployed. Provisioning times are returning to normal. We are monitoring.',
        timestamp: new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        status: 'resolved',
        body: 'Provisioning times have been stable for over 6 hours. This incident is resolved.',
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
];

export function getIncidents(query: PaginatedQuery = {}): Incident[] {
  const { limit = 50, offset = 0, product } = query;
  let result = INCIDENTS;
  if (product) {
    result = result.filter(i => i.product === product);
  }
  return result.slice(offset, offset + limit);
}

export function getActiveIncidents(product?: string): Incident[] {
  let result = INCIDENTS.filter(i => i.status !== 'resolved');
  if (product) {
    result = result.filter(i => i.product === product);
  }
  return result;
}

export function getResolvedIncidents(query: PaginatedQuery = {}): Incident[] {
  const { limit = 10, offset = 0, product } = query;
  let result = INCIDENTS.filter(i => i.status === 'resolved');
  if (product) {
    result = result.filter(i => i.product === product);
  }
  return result.slice(offset, offset + limit);
}

export function getIncident(id: string): Incident | undefined {
  return INCIDENTS.find(i => i.id === id);
}
