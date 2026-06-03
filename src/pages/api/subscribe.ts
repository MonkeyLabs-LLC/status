import type { APIRoute } from 'astro';
import { addSubscriber } from '@/lib/subscribers';

/**
 * POST /api/subscribe — persist an email subscriber.
 * Accepts { email }. Idempotent on the unique email; always acks with {ok:true}
 * for a valid email (anti-enumeration — never reveals whether it already existed).
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : '';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'A valid email address is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      await addSubscriber(email);
    } catch (_e) {
      // Duplicate (already subscribed) or transient — still ack to avoid leaking state.
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid request body.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
