/**
 * View model for the public status front-end.
 *
 * Normalizes the existing product/service/incident data into a single
 * `ScopeView` shape that all three skins render. This is where the spec's
 * front-end rules live, in ONE place, so the three skins stay genuinely
 * different in markup but identical in truth:
 *
 *   - One level of detail per scope: a scope shows its direct children's
 *     rolled-up status, never deep incident text.
 *   - Status bubbles up: a parent's effective status is the worst of its
 *     subtree (services for a product, products for the umbrella).
 *   - A node with ONE active incident attached shows it inline; multiple →
 *     list then drill.
 *   - Breadcrumb starts at the landing root (domain-scoped) and is tappable
 *     at every level.
 *
 * It reuses worstStatus / status helpers from types.ts and consumes the same
 * Product / Service / Incident / Maintenance shapes the engine produces.
 */

import type {
  Product,
  Service,
  Incident,
  Maintenance,
  ServiceStatus,
} from './types';
import { worstStatus } from './types';

/** A node in the rolled-up status tree (product or service). */
export interface ViewChild {
  id: string;
  name: string;
  /** 'product' | 'service' — for the skin to label the kind. */
  kind: 'product' | 'service';
  /** Effective (rolled-up) status of this child. */
  status: ServiceStatus;
  /** Count of active (outage|degraded) incidents in this child's subtree. */
  issueCount: number;
  /** Count of scheduled maintenance windows in this child's subtree. */
  maintCount: number;
  /** Link to drill into this child (skin-agnostic; relative to the scope). */
  href: string;
}

export interface CrumbItem {
  label: string;
  href?: string;
}

export interface ScopeView {
  /** Effective rolled-up status for the whole scope. */
  status: ServiceStatus;
  /** Body-state class (working|degraded|outage|queued). */
  state: string;
  /** True for the landing root (umbrella or a product-scoped domain root). */
  isRoot: boolean;
  /** Display name of the current node (product or service name; '' at umbrella root). */
  nodeName: string;
  /** 'umbrella' | 'product' | 'service' — what level we're at. */
  level: 'umbrella' | 'product' | 'service';
  /** Tappable breadcrumb from landing root to here. */
  crumbs: CrumbItem[];
  /** Direct children with rolled-up status (empty for a leaf service). */
  children: ViewChild[];
  /** Active incidents attached AT this node (its own, not descendants'). */
  attachedIncidents: Incident[];
  /** Total active issue count across this scope's subtree. */
  issueCount: number;
  /** Total scheduled-maintenance count across this scope's subtree. */
  maintCount: number;
  /** Names of children that are not operational (for headline copy). */
  affectedChildNames: string[];
}

function statusToState(s: ServiceStatus): string {
  switch (s) {
    case 'operational': return 'working';
    case 'degraded':    return 'degraded';
    case 'outage':      return 'outage';
    case 'maintenance': return 'queued';
  }
}

/** Does this incident affect this service (leaf component)? */
function incidentHitsService(inc: Incident, serviceId: string): boolean {
  return (inc.affects ?? []).includes(serviceId);
}

/** Incidents attached to a given service (leaf). */
function incidentsForService(incidents: Incident[], serviceId: string): Incident[] {
  return incidents.filter((i) => incidentHitsService(i, serviceId));
}

/** Incidents that touch any service belonging to a product. */
function incidentsForProduct(incidents: Incident[], serviceIds: Set<string>): Incident[] {
  return incidents.filter((i) => (i.affects ?? []).some((a) => serviceIds.has(a)));
}

/**
 * Build the view for the UMBRELLA scope (status.monkeylabs.gg root):
 * children = launched products, each rolled up from its services.
 */
export function buildUmbrellaView(
  companyName: string,
  products: Product[],
  services: Service[],
  activeIncidents: Incident[],
  maintenances: Maintenance[],
): ScopeView {
  const launched = products.filter((p) => p.launched);

  const children: ViewChild[] = launched.map((p) => {
    const kids = services.filter((s) => s.product === p.id);
    const kidIds = new Set(kids.map((s) => s.id));
    const status = kids.length ? worstStatus(kids) : ('operational' as ServiceStatus);
    const incs = incidentsForProduct(activeIncidents, kidIds);
    const maintCount = maintenances.filter((m) => m.product === p.id).length;
    return {
      id: p.id,
      name: p.name,
      kind: 'product' as const,
      status,
      issueCount: incsCount(incs),
      maintCount,
      href: `/${p.id}`,
    };
  });

  const overall = worstStatus(services);
  const affectedChildNames = children.filter((c) => c.status !== 'operational').map((c) => c.name);

  return {
    status: overall,
    state: statusToState(overall),
    isRoot: true,
    nodeName: companyName,
    level: 'umbrella',
    crumbs: [{ label: companyName }],
    children,
    attachedIncidents: [], // umbrella never attaches incident text; it points at products
    issueCount: activeIncidents.length,
    maintCount: maintenances.length,
    affectedChildNames,
  };
}

/** Count of active (outage|degraded) incidents. */
function incsCount(incs: Incident[]): number {
  return incs.filter((i) => i.status !== 'resolved').length;
}

/**
 * Build the view for a PRODUCT scope.
 *   - On a scoped domain (status.sessions.gg), this product IS the landing root.
 *   - On the umbrella domain, it's one level down from the company.
 * children = the product's services, rolled up from their own incidents.
 */
export function buildProductView(
  product: Product,
  services: Service[],
  activeIncidents: Incident[],
  maintenances: Maintenance[],
  opts: { isRoot: boolean; companyName: string; companyHref: string },
): ScopeView {
  const kids = services.filter((s) => s.product === product.id);

  const children: ViewChild[] = kids.map((s) => {
    const incs = incidentsForService(activeIncidents, s.id);
    return {
      id: s.id,
      name: s.name,
      kind: 'service' as const,
      status: s.status,
      issueCount: incsCount(incs),
      maintCount: 0,
      href: opts.isRoot ? `/${s.id}` : `/${product.id}/${s.id}`,
    };
  });

  const overall = kids.length ? worstStatus(kids) : ('operational' as ServiceStatus);
  const affectedChildNames = children.filter((c) => c.status !== 'operational').map((c) => c.name);

  // Incidents attached directly to the product node = those whose affects span
  // the product but aren't pinned to a single service we already show. We keep
  // the simple rule: the product node lists incidents that touch it; the skin
  // decides inline-vs-list. Since incidents attach at the service leaf in this
  // model, the product node itself shows none inline — it points at services.
  const productServiceIds = new Set(kids.map((s) => s.id));
  const productIncidents = incidentsForProduct(activeIncidents, productServiceIds);

  const crumbs: CrumbItem[] = opts.isRoot
    ? [{ label: product.name }]
    : [{ label: opts.companyName, href: opts.companyHref }, { label: product.name }];

  return {
    status: overall,
    state: statusToState(overall),
    isRoot: opts.isRoot,
    nodeName: product.name,
    level: 'product',
    crumbs,
    children,
    attachedIncidents: [], // product points at affected services, never inline incident text
    issueCount: productIncidents.length,
    maintCount: maintenances.length,
    affectedChildNames,
  };
}

/**
 * Build the view for a SERVICE (leaf) scope. No children; incidents attach here.
 * A single active incident is shown inline by the skins; multiple → list+drill.
 */
export function buildServiceView(
  product: Product,
  service: Service,
  activeIncidents: Incident[],
  opts: { isRoot: boolean; companyName: string; companyHref: string; productHref: string },
): ScopeView {
  const attached = incidentsForService(activeIncidents, service.id).filter((i) => i.status !== 'resolved');

  const crumbs: CrumbItem[] = opts.isRoot
    ? [{ label: product.name, href: opts.productHref }, { label: service.name }]
    : [
        { label: opts.companyName, href: opts.companyHref },
        { label: product.name, href: opts.productHref },
        { label: service.name },
      ];

  return {
    status: service.status,
    state: statusToState(service.status),
    isRoot: false,
    nodeName: service.name,
    level: 'service',
    crumbs,
    children: [],
    attachedIncidents: attached,
    issueCount: attached.filter((i) => i.severity !== 'minor' || true).length,
    maintCount: 0,
    affectedChildNames: [],
  };
}
