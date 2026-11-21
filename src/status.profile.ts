/** Instance profile for the Bananapulse Astro application. */
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
    httpSource: 'bananapulse-native';
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
    httpSource: 'bananapulse-native',
  },
});
