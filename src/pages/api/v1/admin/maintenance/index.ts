/**
 * Admin maintenance endpoints (admin-session auth).
 *   GET  /api/v1/admin/maintenance   list
 *   POST /api/v1/admin/maintenance   schedule a planned window
 */
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { maintenance } from '@/db/schema';
import { asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAdmin, ok, err } from '@/lib/admin-api';

export const GET: APIRoute = async (ctx) => {
  const who = await requireAdmin(ctx);
  if (who instanceof Response) return who;
  const rows = await db.select().from(maintenance).orderBy(asc(maintenance.scheduledStart));
  return ok(rows);
};

export const POST: APIRoute = async (ctx) => {
  const who = await requireAdmin(ctx);
  if (who instanceof Response) return who;
  const b = await ctx.request.json().catch(() => null);
  if (!b?.title || !b?.summary || !b?.scheduledStart || !b?.scheduledEnd || !Array.isArray(b.affects) || !b.affects.length) {
    return err('bad_request', 'title, summary, scheduledStart, scheduledEnd and at least one affected component are required.', 400);
  }
  const id = nanoid();
  await db.insert(maintenance).values({
    id, title: b.title, summary: b.summary,
    scheduledStart: new Date(b.scheduledStart),
    scheduledEnd: new Date(b.scheduledEnd),
    affects: b.affects,
  });
  return ok({ id }, 201);
};
