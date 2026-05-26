import type { Incident, PaginatedQuery } from './types';
import { fetchEvolutionStatus } from './evolution';

export async function getIncidents(query: PaginatedQuery = {}): Promise<Incident[]> {
  const { limit = 50, offset = 0, product, service } = query;
  const data = await fetchEvolutionStatus();
  let result = data.incidents;
  if (product) result = result.filter(i => i.product === product);
  if (service) result = result.filter(i => i.affects?.includes(service));
  return result.slice(offset, offset + limit);
}

export async function getActiveIncidents(product?: string, service?: string): Promise<Incident[]> {
  const data = await fetchEvolutionStatus();
  let result = data.incidents.filter(i => i.status !== 'resolved');
  if (product) result = result.filter(i => i.product === product);
  if (service) result = result.filter(i => i.affects?.includes(service));
  return result;
}

export async function getResolvedIncidents(query: PaginatedQuery = {}): Promise<Incident[]> {
  const { limit = 10, offset = 0, product, service } = query;
  const data = await fetchEvolutionStatus();
  let result = data.incidents.filter(i => i.status === 'resolved');
  if (product) result = result.filter(i => i.product === product);
  if (service) result = result.filter(i => i.affects?.includes(service));
  return result.slice(offset, offset + limit);
}

export async function getIncident(id: string): Promise<Incident | undefined> {
  const data = await fetchEvolutionStatus();
  return data.incidents.find(i => i.id === id);
}
