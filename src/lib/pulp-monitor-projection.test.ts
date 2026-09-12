import { describe, expect, it } from 'vitest';
import { buildPulpStatusJSON, buildPulpSummaryTree } from './pulp-monitor-projection';
import type { MonitorProjection } from './pulp-bridge';

function projection(): MonitorProjection {
  const evaluation = (id: string, status: 'operational' | 'degraded' | 'outage') => ({
    component_id: id,
    status,
    state: status === 'operational' ? 'operational' : 'declared',
    reads: [],
    non_ok_count: status === 'operational' ? 0 : 1,
    non_ok_weight: status === 'operational' ? 0 : 1,
    trusted_non_ok_count: 0,
    stale_count: 0,
    reduced_coverage: false,
    has_live_reads: true,
  });
  const component = (
    id: string,
    name: string,
    kind: string,
    parentId: string | undefined,
    status: 'operational' | 'degraded' | 'outage',
    critical = false,
    sortOrder = 0,
  ) => ({
    component: {
      id,
      parent_id: parentId,
      name,
      kind,
      sort_order: sortOrder,
      fallback_status: 'operational' as const,
      critical,
      archived: false,
    },
    own_evaluation: evaluation(id, status),
    evaluation: evaluation(id, status),
  });
  return {
    version: 'monitor.v1',
    revision: 10,
    components: [
      component('monkeylabs', 'Monkey Labs', 'organization', undefined, 'operational'),
      component('product', 'Product', 'product', 'monkeylabs', 'operational'),
      component('api', 'API', 'service', 'product', 'outage', false, 20),
      component('database', 'Database', 'critical', 'product', 'operational', true, 10),
    ],
    sources: [],
    mappings: [],
    incidents: [{
      id: 'incident-1',
      title: 'API issue',
      summary: 'Investigating',
      status: 'investigating',
      severity: 'moderate',
      affects: ['api'],
      auto: true,
      started_at_unix: 1_800_000_000,
    }],
    incident_updates: [],
    maintenance: [{
      id: 'maintenance-1',
      title: 'Database work',
      summary: 'Routine',
      kind: 'scheduled',
      scheduled_start_unix: 1_800_000_100,
      scheduled_end_unix: 1_800_000_200,
      affects: ['database'],
      cancelled: false,
    }],
  };
}

describe('Pulp monitor public projection adapter', () => {
  it('preserves the legacy partial-outage floor and summary shape', () => {
    const tree = buildPulpSummaryTree(projection(), null);
    expect(tree.id).toBe('monkeylabs');
    expect(tree.status).toBe('degraded');
    expect(tree.issueCount).toBe(1);
    expect(tree.children[0].children.map((child) => child.id)).toEqual(['database', 'api']);
    expect(tree.children[0].children[1].status).toBe('outage');
    expect(tree.children[0].children[1].incidents[0]).toMatchObject({
      id: 'incident-1',
      started: '2027-01-15T08:00:00.000Z',
    });
  });

  it('builds the exact status JSON fields without exposing owner internals', () => {
    const body = buildPulpStatusJSON(projection(), null, new Date(1_800_000_050 * 1000));
    expect(body).toEqual({
      status: 'degraded',
      state: 'degraded',
      services: [
        { id: 'database', name: 'Database', product: 'product', status: 'operational' },
        { id: 'api', name: 'API', product: 'product', status: 'outage' },
      ],
      activeIncidents: [{
        id: 'incident-1',
        title: 'API issue',
        severity: 'moderate',
        status: 'investigating',
        started: '2027-01-15T08:00:00.000Z',
      }],
      scheduledMaintenance: [{
        id: 'maintenance-1',
        title: 'Database work',
        scheduledStart: '2027-01-15T08:01:40.000Z',
        scheduledEnd: '2027-01-15T08:03:20.000Z',
      }],
    });
  });

  it('fails closed on dangling owner references', () => {
    const value = projection();
    value.incidents[0].affects = ['missing'];
    expect(() => buildPulpSummaryTree(value, null)).toThrow(/invalid component/);
  });

  it('fails closed when the configured scope root is absent', () => {
    const value = projection();
    value.components = value.components.filter((item) => item.component.id !== 'monkeylabs');
    expect(() => buildPulpSummaryTree(value, null)).toThrow();
  });
});
