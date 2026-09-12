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
  it('requires the composed Pulp owner even when bridge configuration is absent', () => {
    delete process.env.PULP_BRIDGE_URL;
    delete process.env.PULP_INCIDENTS_OWNER_ENABLED;
    expect(pulpBridgeConfigured()).toBe(true);
    expect(pulpOwnerRouteFamilyConfigured('incidents')).toBe(true);
  });

  it('enables every owner family from the final Status profile', () => {
    delete process.env.PULP_BRIDGE_URL;
    expect(pulpOwnerRouteFamilyConfigured('incidents')).toBe(true);
    expect(pulpOwnerRouteFamilyConfigured('maintenance')).toBe(true);
    expect(pulpOwnerRouteFamilyConfigured('auth')).toBe(true);
  });

  it('never falls subscriber lifecycle back to the legacy database', () => {
    delete process.env.PULP_BRIDGE_URL;
    delete process.env.PULP_SUBSCRIBER_TOKEN_SECRET;
    expect(pulpSubscriberLifecycleConfigured()).toBe(true);
  });

  it('always reads the public monitor projection from Pulp', () => {
    delete process.env.PULP_BRIDGE_URL;
    delete process.env.PULP_MONITOR_OWNER_ENABLED;
    expect(pulpMonitorProjectionConfigured()).toBe(true);
  });
});
