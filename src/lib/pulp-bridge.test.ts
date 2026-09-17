import { afterEach, describe, expect, it } from 'vitest';
import {
  pulpBridgeConfigured,
  pulpMonitorProjectionConfigured,
  pulpOwnerRouteFamilyConfigured,
  pulpSubscriberLifecycleConfigured,
} from './pulp-bridge';

const keys = [
  'PULP_BRIDGE_URL',
  'PULP_MONITOR_OWNER_ENABLED',
  'PULP_SUBSCRIBERS_OWNER_ENABLED',
  'PULP_SUBSCRIBER_TOKEN_SECRET',
  'PULP_INCIDENTS_OWNER_ENABLED',
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Pulp route-family cutover gates', () => {
  it('keeps legacy owners active when bridge configuration is absent', () => {
    delete process.env.PULP_BRIDGE_URL;
    delete process.env.PULP_INCIDENTS_OWNER_ENABLED;
    expect(pulpBridgeConfigured()).toBe(false);
    expect(pulpOwnerRouteFamilyConfigured('incidents')).toBe(false);
  });

  it('enables an owner family only with the bridge and its cutover flag', () => {
    process.env.PULP_BRIDGE_URL = 'http://127.0.0.1:8788';
    process.env.PULP_INCIDENTS_OWNER_ENABLED = 'true';
    expect(pulpOwnerRouteFamilyConfigured('incidents')).toBe(true);
    expect(pulpOwnerRouteFamilyConfigured('maintenance')).toBe(false);
    expect(pulpOwnerRouteFamilyConfigured('auth')).toBe(false);
  });

  it('keeps subscriber lifecycle on the legacy database until fully configured', () => {
    delete process.env.PULP_BRIDGE_URL;
    delete process.env.PULP_SUBSCRIBER_TOKEN_SECRET;
    expect(pulpSubscriberLifecycleConfigured()).toBe(false);
  });

  it('reads the public monitor projection from the legacy database until enabled', () => {
    delete process.env.PULP_BRIDGE_URL;
    delete process.env.PULP_MONITOR_OWNER_ENABLED;
    expect(pulpMonitorProjectionConfigured()).toBe(false);
  });
});
