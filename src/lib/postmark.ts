import { ServerClient } from 'postmark';

function getClient() {
  const token = process.env.POSTMARK_API_TOKEN;
  if (!token) throw new Error('POSTMARK_API_TOKEN not set');
  return new ServerClient(token);
}

export async function sendMagicLinkEmail(to: string, magicUrl: string) {
  const client = getClient();
  const fromEmail = process.env.POSTMARK_FROM_EMAIL ?? 'status@monkeylabs.gg';
  const fromName = process.env.POSTMARK_FROM_NAME ?? 'MonkeyLabs Status';

  await client.sendEmail({
    From: `${fromName} <${fromEmail}>`,
    To: to,
    Subject: 'Your admin login link',
    TextBody: `Sign in to MonkeyLabs Status:\n\n${magicUrl}\n\nThis link expires in 15 minutes. If you didn't request this, ignore this email.`,
    HtmlBody: `<p>Sign in to MonkeyLabs Status:</p><p><a href="${magicUrl}">${magicUrl}</a></p><p>This link expires in 15 minutes. If you didn't request this, ignore this email.</p>`,
    MessageStream: 'outbound',
  });
}
