/**
 * Component tree read layer (Banana Pulse model).
 *
 * One adjacency tree (organization → product → service → host). Builds the
 * ScopeView shape the existing skin consumes, for ANY node, at arbitrary depth.
 * Effective status bubbles up = worst of subtree, with the quorum engine's
 * derived status overlaid on observed leaves. URLs are relative to the scope's
 * landing root (the entry domain), so drilling never crosses domains.
 */
import { db } from '@/db';
import { components } from '@/db/schema';
import { isNull, asc } from 'drizzle-orm';
import type { ServiceStatus, Incident } from './types';
import { statusToState } from './types';
import { derivedComponentStatuses } from './quorum';
import { getActiveIncidents } from './db-incidents';
import { rootComponentId } from '@/pulse.config';
import type { ScopeView, ViewChild, CrumbItem } from './view';

type Comp = typeof components.$inferSelect;

function mapStatus(s: string): ServiceStatus {
  switch (s) {
    case 'ok': return 'operational';
    case 'deg': return 'degraded';
    case 'out': return 'outage';
    case 'maint': return 'maintenance';
    default: return 'operational';
  }
}
const WORST_ORDER: ServiceStatus[] = ['outage', 'degraded', 'maintenance', 'operational'];
function worst(a: ServiceStatus, b: ServiceStatus): ServiceStatus {
  for (const s of WORST_ORDER) if (a === s || b === s) return s;
  return 'operational';
}

/** A scope (entry domain) maps to its landing-root component (via the seam). */
export const scopeRootId = rootComponentId;

interface Tree {
  byId: Map<string, Comp>;
  kids: Map<string, Comp[]>;
  derived: Record<string, { status: 'operational' | 'degraded' | 'outage' }>;
  incidents: Incident[];
}

async function loadTree(): Promise<Tree> {
  const [rows, derived, incs] = await Promise.all([
    db.select().from(components).where(isNull(components.archivedAt)).orderBy(asc(components.sortOrder)),
    derivedComponentStatuses(),
    getActiveIncidents(),
  ]);
  const byId = new Map<string, Comp>();
  const kids = new Map<string, Comp[]>();
  for (const r of rows) byId.set(r.id, r);
  for (const r of rows) {
    if (!r.parentId) continue;
    const arr = kids.get(r.parentId) ?? [];
    arr.push(r);
    kids.set(r.parentId, arr);
  }
  return { byId, kids, derived: derived as any, incidents: incs.filter((i) => i.status !== 'resolved') };
}

function ownStatus(t: Tree, id: string): ServiceStatus {
  const d = t.derived[id];
  if (d) return d.status;
  const c = t.byId.get(id);
  return c ? mapStatus(c.status) : 'operational';
}
function effective(t: Tree, id: string): ServiceStatus {
  let s = ownStatus(t, id);
  for (const k of t.kids.get(id) ?? []) s = worst(s, effective(t, k.id));
  return s;
}
function subtreeIds(t: Tree, id: string): string[] {
  const out = [id];
  for (const k of t.kids.get(id) ?? []) out.push(...subtreeIds(t, k.id));
  return out;
}
function incidentsAt(t: Tree, id: string): Incident[] {
  return t.incidents.filter((i) => (i.affects ?? []).includes(id));
}
function issueCount(t: Tree, id: string): number {
  const ids = new Set(subtreeIds(t, id));
  return t.incidents.filter((i) => (i.affects ?? []).some((a) => ids.has(a))).length;
}
/** root..node chain. */
function chainTo(t: Tree, id: string): Comp[] {
  const out: Comp[] = [];
  let cur: Comp | undefined = t.byId.get(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? t.byId.get(cur.parentId) : undefined;
  }
  return out;
}
/** URL for a node relative to the scope root (root → '/'). */
function hrefFor(t: Tree, id: string, rootId: string): string {
  const chain = chainTo(t, id).map((c) => c.id);
  const ri = chain.indexOf(rootId);
  const segs = ri >= 0 ? chain.slice(ri + 1) : chain;
  return segs.length ? '/' + segs.join('/') : '/';
}

/** Resolve a path (relative to the scope root) → component id, or null. */
function resolvePath(t: Tree, rootId: string, segs: string[]): string | null {
  let cur = rootId;
  for (const seg of segs) {
    const child = (t.kids.get(cur) ?? []).find((c) => c.id === seg);
    if (!child) return null;
    cur = child.id;
  }
  return cur;
}

/** Build the ScopeView for a node addressed by a path under the scope root. */
export async function buildComponentView(scope: string | null, segs: string[]): Promise<ScopeView | null> {
  const t = await loadTree();
  const rootId = scopeRootId(scope);
  if (!t.byId.has(rootId)) return null;
  const id = resolvePath(t, rootId, segs);
  if (!id) return null;

  const node = t.byId.get(id)!;
  const isRoot = id === rootId;
  const status = effective(t, id);
  const kids = t.kids.get(id) ?? [];

  const children: ViewChild[] = kids.map((c) => ({
    id: c.id,
    name: c.name,
    kind: (c.tag ?? c.kind) as ViewChild['kind'],
    status: effective(t, c.id),
    issueCount: issueCount(t, c.id),
    maintCount: 0,
    href: hrefFor(t, c.id, rootId),
  }));

  const chain = chainTo(t, id);
  const ri = chain.findIndex((c) => c.id === rootId);
  const visible = ri >= 0 ? chain.slice(ri) : chain;
  const crumbs: CrumbItem[] = visible.map((c, i) => ({
    label: c.name,
    href: i < visible.length - 1 ? hrefFor(t, c.id, rootId) : undefined,
  }));

  const level: ScopeView['level'] = node.kind === 'organization' ? 'umbrella' : node.kind === 'product' ? 'product' : 'service';

  return {
    status,
    state: statusToState(status),
    isRoot,
    nodeName: node.name,
    level,
    crumbs,
    children,
    attachedIncidents: incidentsAt(t, id),
    issueCount: issueCount(t, id),
    maintCount: 0,
    affectedChildNames: children.filter((c) => c.status !== 'operational').map((c) => c.name),
  };
}

/** Crumbs + affected-path from the scope root to a component (for the incident page). */
export async function componentCrumbs(
  scope: string | null,
  componentId: string,
): Promise<{ crumbs: CrumbItem[]; affectedPath: string[] }> {
  const t = await loadTree();
  const rootId = scopeRootId(scope);
  if (!t.byId.has(componentId) || !t.byId.has(rootId)) return { crumbs: [], affectedPath: [] };
  const chain = chainTo(t, componentId);
  const ri = chain.findIndex((c) => c.id === rootId);
  const visible = ri >= 0 ? chain.slice(ri) : chain;
  return {
    crumbs: visible.map((c) => ({ label: c.name, href: hrefFor(t, c.id, rootId) })),
    affectedPath: visible.map((c) => c.name),
  };
}

/* ── nested subtree for summary.json (client-side drill / badge) ── */

export interface SummaryNode {
  id: string;
  name: string;
  kind: string;
  status: ServiceStatus;
  issueCount: number;
  incidents: { id: string; title: string; severity: string; status: string; auto: boolean; started: string }[];
  children: SummaryNode[];
}

export async function buildSummaryTree(scope: string | null): Promise<SummaryNode | null> {
  const t = await loadTree();
  const rootId = scopeRootId(scope);
  if (!t.byId.has(rootId)) return null;
  const build = (id: string): SummaryNode => {
    const c = t.byId.get(id)!;
    return {
      id,
      name: c.name,
      kind: (c.tag ?? c.kind) as string,
      status: effective(t, id),
      issueCount: issueCount(t, id),
      incidents: incidentsAt(t, id).map((i) => ({
        id: i.id, title: i.title, severity: i.severity, status: i.status, auto: i.auto !== false, started: i.started,
      })),
      children: (t.kids.get(id) ?? []).map((k) => build(k.id)),
    };
  };
  return build(rootId);
}
