import { pgTable, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const services = pgTable('services', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  product: text('product').notNull(),
  tag: text('tag'),
  status: text('status').notNull().default('ok'),
  uptime90d: jsonb('uptime_90d').notNull().default('[]'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const incidents = pgTable('incidents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  status: text('status').notNull(),
  severity: text('severity').notNull(),
  affects: text('affects').array().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('incidents_status_idx').on(table.status),
  index('incidents_started_at_idx').on(table.startedAt),
]);

export const incidentTimeline = pgTable('incident_timeline', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').references(() => incidents.id, { onDelete: 'cascade' }),
  at: timestamp('at', { withTimezone: true }).notNull(),
  label: text('label').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('incident_timeline_incident_at_idx').on(table.incidentId, table.at),
]);

export const maintenance = pgTable('maintenance', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  scheduledStart: timestamp('scheduled_start', { withTimezone: true }).notNull(),
  scheduledEnd: timestamp('scheduled_end', { withTimezone: true }).notNull(),
  affects: text('affects').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscribers = pgTable('subscribers', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminSessions = pgTable('admin_sessions', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminMagicLinks = pgTable('admin_magic_links', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiTokens = pgTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  scope: text('scope').notNull().default('full'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('api_tokens_hash_active_idx').on(table.tokenHash),
]);
