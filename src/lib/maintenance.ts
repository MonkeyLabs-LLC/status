import type { Maintenance } from './types';
import { fetchEvolutionStatus } from './evolution';

export async function getUpcomingMaintenances(product?: string): Promise<Maintenance[]> {
  const data = await fetchEvolutionStatus();
  let result = data.maintenances;
  if (product) result = result.filter(m => m.product === product);
  return result;
}
