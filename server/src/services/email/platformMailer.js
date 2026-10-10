// PHASE 27 — emails sent BY THE PLATFORM (not by a company mailbox): password reset, email verification.
// The SMTP server is configured by the platform owner in .env (trusted), so no SSRF checks are needed here.
// Never throws to the caller: a mail problem must not reveal whether an account exists.
import env from '../../config/env.js';
import logger from '../../config/logger.js';

let testTransport = null;
/** Tests capture emails instead of sending them. */
export function setPlatformMailTransport(fn) {
  testTransport = fn;
}

export const platformMailConfigured = () => Boolean(testTransport || (env.PLATFORM_SMTP_HOST && env.PLATFORM_EMAIL_FROM));

/**
 * @param {{to: string, subject: string, text: string, html?: string, devLink?: string}} mail
 * devLink: printed to the server log ONLY in development when SMTP is not set up (so you can test locally).
 */
export async function sendPlatformEmail({ to, subject, text, html, devLink }) {
  try {
    if (testTransport) {
      await testTransport({ to, subject, text, html });
      return { sent: true };
    }
    if (!platformMailConfigured()) {
      if (env.NODE_ENV === 'development' && devLink) logger.warn({ to, subject, link: devLink }, 'PLATFORM_SMTP not set — DEV ONLY: open this link yourself');
      else logger.warn({ subject }, 'platform email not sent: PLATFORM_SMTP_HOST / PLATFORM_EMAIL_FROM not configured');
      return { sent: false };
    }
    const nodemailer = (await import('nodemailer')).default;
    const transport = nodemailer.createTransport({
      host: env.PLATFORM_SMTP_HOST,
      port: env.PLATFORM_SMTP_PORT,
      secure: env.PLATFORM_SMTP_PORT === 465,
      requireTLS: env.PLATFORM_SMTP_PORT !== 465,
      auth: env.PLATFORM_SMTP_USER ? { user: env.PLATFORM_SMTP_USER, pass: env.PLATFORM_SMTP_PASSWORD } : undefined,
      connectionTimeout: 20_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({ from: env.PLATFORM_EMAIL_FROM, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    logger.error({ err: err.message, subject }, 'platform email failed');
    return { sent: false };
  }
}
