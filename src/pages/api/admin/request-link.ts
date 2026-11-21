import type { APIRoute } from 'astro';
import { issueMagicLinkWithOwner } from '@/lib/admin-auth';
import { sendMagicLinkEmail } from '@/lib/email';
import {StatusServiceError} from '@/lib/status-client';
export const POST: APIRoute = async ({ request, url }) => {
    try {
        const body = await request.json();
        const email = body?.email?.toLowerCase?.()?.trim?.();
        const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase?.()?.trim?.();
        // Always return same response shape (anti-enumeration)
        const okResponse = new Response(JSON.stringify({ data: { sent: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (!email || !adminEmail || email !== adminEmail) {
            return okResponse;
        }

        const ownerResult = await issueMagicLinkWithOwner(email);
        // The auth owner intentionally returns `deliver: false` for an unknown or
        // disabled identity. Keep the public response indistinguishable.
        if (!ownerResult?.deliver)
            return okResponse;
        const token = ownerResult.token;
        const magicUrl = `${url.origin}/admin/verify?token=${token}`;
        await sendMagicLinkEmail(email, magicUrl);
        return okResponse;
    }
    catch (error) {
        if (error instanceof StatusServiceError) return new Response(JSON.stringify({error:{code:"owner_unavailable",message:"Status authentication service is unavailable."}}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
        return new Response(JSON.stringify({ error: { code: 'server_error', message: 'Something went wrong.' } }), { status: 500 });
    }
};
