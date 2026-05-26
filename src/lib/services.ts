import type { Service, PaginatedQuery } from './types';
import { fetchEvolutionStatus } from './evolution';

export async function getServices(query: PaginatedQuery = {}): Promise<Service[]> {
  const { limit = 50, offset = 0, product } = query;
  const data = await fetchEvolutionStatus();
  let result = data.services;
  if (product) result = result.filter(s => s.product === product);
  return result.slice(offset, offset + limit);
}

export async function getService(id: string): Promise<Service | undefined> {
  const data = await fetchEvolutionStatus();
  return data.services.find(s => s.id === id);
}

export async function getServicesByProduct(product: string): Promise<Service[]> {
  const data = await fetchEvolutionStatus();
  return data.services.filter(s => s.product === product);
}
