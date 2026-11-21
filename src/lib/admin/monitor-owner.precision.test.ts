import { expect, test } from 'vitest';
import { componentAdminRow, sourceAdminRow } from './monitor-owner';

// Nonsecret timestamp examples retained from the read-only Status snapshot.
// PostgreSQL stores microseconds; the existing JSON Date contract exposes milliseconds.
test('component creation and archival expose stored fractional timestamps', () => {
  expect(componentAdminRow({ id: 'fixture', name: 'Fixture', kind: 'service',
    created_at_unix: 1780517935, created_at_unix_micros: 1780517935869949,
    archived_at_unix: 1780518004, archived_at_unix_micros: 1780518004938974,
  })).toMatchObject({ createdAt: '2026-06-03T20:18:55.869Z', archivedAt: '2026-06-03T20:20:04.938Z' });
});

test('source creation and revocation retain the existing JSON millisecond representation', () => {
  expect(sourceAdminRow({ id: 'fixture', name: 'Fixture', kind: 'push', weight: 1,
    trusted: false, default_ttl_seconds: null, revoked: true,
    created_at_unix: 1780518004, created_at_unix_micros: 1780518004938974,
    revoked_at_unix: 1780517935, revoked_at_unix_micros: 1780517935869949,
  })).toMatchObject({ createdAt: '2026-06-03T20:20:04.938Z', revokedAt: '2026-06-03T20:18:55.869Z' });
});

test('existing seconds-only durable records and absent optional dates keep their meaning', () => {
  expect(componentAdminRow({ id: 'fixture', name: 'Fixture', kind: 'service', created_at_unix: 1780517935 }))
    .toMatchObject({ createdAt: '2026-06-03T20:18:55.000Z', archivedAt: null });
  expect(sourceAdminRow({ id: 'fixture', name: 'Fixture', kind: 'push', weight: 1,
    trusted: false, default_ttl_seconds: null, revoked: false,
  })).toMatchObject({ createdAt: '1970-01-01T00:00:00.000Z', revokedAt: null });
});
