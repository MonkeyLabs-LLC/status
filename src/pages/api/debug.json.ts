import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  try {
    const res = await fetch('https://api.sessions.gg/api/status', {
      headers: { 'Accept': 'application/json' },
    });
    const text = await res.text();
    return new Response(JSON.stringify({
      httpStatus: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      bodyLength: text.length,
      bodyPreview: text.slice(0, 2000),
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({
      error: e.message || String(e),
      stack: e.stack,
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};
