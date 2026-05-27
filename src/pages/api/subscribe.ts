import type { APIRoute } from 'astro';

/**
 * POST /api/subscribe — email subscription stub.
 *
 * Accepts { email: string } in the request body. Returns success.
 * When wired to a real service (Resend, webhook), read SUBSCRIBE_WEBHOOK_URL
 * from env and POST the email there.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const email = body?.email;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'A valid email address is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // TODO: Add rate limiting when deployed behind a reverse proxy with IP tracking.
    // TODO: Wire to SUBSCRIBE_WEBHOOK_URL from env for real email delivery.
    // const webhookUrl = import.meta.env.SUBSCRIBE_WEBHOOK_URL;
    // if (webhookUrl) {
    //   await fetch(webhookUrl, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ email }),
    //   });
    // }

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
