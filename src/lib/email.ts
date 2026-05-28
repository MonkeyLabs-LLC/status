// Resend magic-link email — matches the email path used across the
// portfolio (Sessions, Evolution, etc).

export async function sendMagicLinkEmail(to: string, magicUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');

  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'status@monkeylabs.gg';
  const fromName = process.env.RESEND_FROM_NAME ?? 'MonkeyLabs Status';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject: 'Your admin login link',
      text: `Sign in to MonkeyLabs Status:\n\n${magicUrl}\n\nThis link expires in 15 minutes. If you didn't request this, ignore this email.`,
      html: `<p>Sign in to MonkeyLabs Status:</p><p><a href="${magicUrl}">${magicUrl}</a></p><p>This link expires in 15 minutes. If you didn't request this, ignore this email.</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${body}`);
  }
}
