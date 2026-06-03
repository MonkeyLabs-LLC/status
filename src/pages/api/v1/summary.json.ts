/**
 * GET /api/v1/summary.json[?scope=sessions]
 *
 * The data contract: the whole component subtree under the scope's landing
 * root, with rolled-up (quorum-derived) status + attached incidents per node,
 * so the front end can drill client-side with no round-trips. Also powers the
 * marketing sites' "● Live now" badge (reads `status` / `live`). Cacheable.
 */
import type { APIRoute } from 'astro';
import { buildSummaryTree } from '../../../lib/components';
import { statusToState } from '../../../lib/types';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=30',
  'Access-Control-Allow-Origin': '*',
};

function body(scope: string | null, tree: unknown, status: 'operational' | 'degraded' | 'outage' | 'maintenance') {
  return JSON.stringify({
    scope,
    status,
    state: statusToState(status),
    live: true,
    tree,
    generatedAt: new Date().toISOString(),
  }, null, 2);
}

export const GET: APIRoute = async ({ locals, url }) => {
  const qScope = url.searchParams.get('scope');
  const scope = qScope || ((locals as any).scope as string | null) || null;
  try {
    const root = await buildSummaryTree(scope);
    if (!root) return new Response(body(scope, null, 'operational'), { status: 200, headers });
    return new Response(body(scope, root, root.status), { status: 200, headers });
  } catch (_e) {
    return new Response(body(scope, null, 'operational'), { status: 200, headers });
  }
};
