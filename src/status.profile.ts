/**
 * Status is an instance profile over the generic Bananapulse application.
 *
 * This is the additive cutover boundary: brand, deployment adapters and the
 * composed application boundary are explicit data. Status requires the Pulp
 * bridge and fails closed rather than returning to its retired local owners.
 */

export type StatusHTTPSource = 'legacy-copy' | 'bananapulse-pulp';
export type StatusAdapter = 'netlify' | 'node';

export interface StatusScopeProfile {
  id: string;
  host: string;
  umbrella?: boolean;
  wordmark: string;
  logo: string;
}

export interface StatusProfile {
  schemaVersion: 1;
  branding: {
    company: string;
    legal: string;
    footerDomains: readonly string[];
    supportEmail: string;
    themeStorageKey: string;
    scopes: readonly StatusScopeProfile[];
  };
  deployment: {
    site: string;
    adapterEnvironmentKey: 'STATUS_ADAPTER';
    defaultAdapter: StatusAdapter;
    supportedAdapters: readonly StatusAdapter[];
    nodeScheduler: true;
    sessionsAlertHostAdapter: true;
  };
  application: {
    name: 'bananapulse';
    httpSource: StatusHTTPSource;
    localRootEnvironmentKey: 'BANANAPULSE_ROOT';
    localRootDefault: '../Bananapulse';
    manifest: 'application/pulp.app.toml';
    orchestratorCell: 'lua-orchestrator';
    orchestratorProvider: 'orchestrator.dispatch';
    bridge: {
      urlEnvironmentKey: 'PULP_BRIDGE_URL';
      tokenEnvironmentKey: 'PULP_BRIDGE_TOKEN';
      eventPath: '/internal/v1/events/';
    };
    events: readonly string[];
    profileOwnedPaths: readonly string[];
    legacyCompatibilityOverrides: readonly string[];
    pendingEnginePaths: readonly string[];
  };
}

function defineStatusProfile(profile: StatusProfile): Readonly<StatusProfile> {
  const umbrellas = profile.branding.scopes.filter((scope) => scope.umbrella);
  if (umbrellas.length !== 1) {
    throw new Error(`status profile requires exactly one umbrella scope; found ${umbrellas.length}`);
  }
  const ids = new Set<string>();
  const hosts = new Set<string>();
  for (const scope of profile.branding.scopes) {
    if (!scope.id || !scope.host || !scope.wordmark || !scope.logo) {
      throw new Error('status profile scope fields are required');
    }
    if (ids.has(scope.id)) throw new Error(`duplicate status scope id ${scope.id}`);
    if (hosts.has(scope.host)) throw new Error(`duplicate status scope host ${scope.host}`);
    ids.add(scope.id);
    hosts.add(scope.host);
  }
  if (
    profile.application.httpSource === 'bananapulse-pulp' &&
    profile.application.legacyCompatibilityOverrides.length > 0
  ) {
    throw new Error('Bananapulse HTTP ownership requires zero legacy compatibility overrides');
  }
  return Object.freeze(profile);
}

export const STATUS_PROFILE = defineStatusProfile({
  schemaVersion: 1,
  branding: {
    company: 'Monkey Labs',
    legal: '© 2026 Monkey Labs LLC',
    footerDomains: ['monkeylabs.gg', 'sessions.gg', 'bananalabs.gg'],
    supportEmail: 'hello@monkeylabs.gg',
    themeStorageKey: 'ml-status-theme',
    scopes: [
      {
        id: 'monkeylabs',
        host: 'status.monkeylabs.gg',
        umbrella: true,
        wordmark: 'Monkey Labs',
        logo: '/brand/monkeylabs.png',
      },
      {
        id: 'sessions',
        host: 'status.sessions.gg',
        wordmark: 'Sessions',
        logo: '/brand/sessions.png',
      },
      {
        id: 'bananalabs',
        host: 'status.bananalabs.gg',
        wordmark: 'Banana Labs',
        logo: '/brand/bananalabs.png',
      },
    ],
  },
  deployment: {
    site: 'https://status.monkeylabs.gg',
    adapterEnvironmentKey: 'STATUS_ADAPTER',
    defaultAdapter: 'netlify',
    supportedAdapters: ['netlify', 'node'],
    nodeScheduler: true,
    sessionsAlertHostAdapter: true,
  },
  application: {
    name: 'bananapulse',
    httpSource: 'bananapulse-pulp',
    localRootEnvironmentKey: 'BANANAPULSE_ROOT',
    localRootDefault: '../Bananapulse',
    manifest: 'application/pulp.app.toml',
    orchestratorCell: 'lua-orchestrator',
    orchestratorProvider: 'orchestrator.dispatch',
    bridge: {
      urlEnvironmentKey: 'PULP_BRIDGE_URL',
      tokenEnvironmentKey: 'PULP_BRIDGE_TOKEN',
      eventPath: '/internal/v1/events/',
    },
    events: [
      'bananapulse.monitor.command.v1',
      'bananapulse.monitor.admin.command.v1',
      'bananapulse.monitor.migration.import.v1',
      'bananapulse.monitor.ingest.authenticated.v1',
      'bananapulse.monitor.sweep.v1',
      'bananapulse.monitor.query.v1',
      'bananapulse.monitor.projection.v1',
      'bananapulse.subscriber.subscribe.v1',
      'bananapulse.subscriber.confirm.v1',
      'bananapulse.subscriber.unsubscribe.v1',
      'bananapulse.subscriber.confirmation.resend.v1',
      'bananapulse.subscriber.projection.v1',
      'bananapulse.subscriber.admin.list.v1',
      'bananapulse.subscriber.admin.get.v1',
      'bananapulse.subscriber.admin.delete.v1',
      'bananapulse.subscriber.admin.state.set.v1',
      'bananapulse.subscriber.migration.import.v1',
      'bananapulse.incident.publish.v1',
      'bananapulse.maintenance.publish.v1',
      'bananapulse.host.email.outbox.claim.v1',
      'bananapulse.host.email.outbox.receipt.apply.v1',
    ],
    profileOwnedPaths: [
      'src/status.profile.ts',
      'src/status.profile.compatibility.test.ts',
      'src/pulse.config.ts',
      'src/middleware.ts',
      'src/components/skin/SkinML.astro',
      'src/lib/scheduler.ts',
      'src/lib/sessions-alert.ts',
      'src/lib/pulp-bridge.ts',
      'src/lib/pulp-bridge.test.ts',
      'src/lib/pulp-monitor-projection.test.ts',
      'src/lib/skin-copy.ts',
      'src/pages/admin/maintenance/new.astro',
      'src/pages/admin/maintenance/[id].astro',
      'src/pages/api/v1/admin/incidents/leaf-guard.test.ts',
      'src/styles/brand.css',
      'src/styles/skins.css',
    ],
    legacyCompatibilityOverrides: [],
    pendingEnginePaths: [],
  },
});
