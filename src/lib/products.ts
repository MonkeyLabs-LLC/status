import type { Product } from './types';

const PRODUCTS: Product[] = [
  {
    id: 'sessions',
    name: 'Sessions',
    tag: 'game servers',
    launched: true,
    domain: 'status.sessions.gg',
  },
  {
    id: 'bananalabs',
    name: 'BananaLabs',
    tag: 'infrastructure',
    launched: true,
    domain: 'status.bananalabs.gg',
  },
];

export function getProducts(): Product[] {
  return PRODUCTS;
}

export function getLaunchedProducts(): Product[] {
  return PRODUCTS.filter(p => p.launched);
}

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find(p => p.id === id);
}
