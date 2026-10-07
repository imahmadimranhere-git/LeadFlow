// Signed webhooks (same idea Stripe/Paddle/most gateways use):
//   header:  t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
// We check the signature over the RAW body (not parsed JSON) and reject old timestamps (replay).
import crypto from 'node:crypto';

export function signWebhook(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

export function verifyWebhookSignature({ rawBody, header, secret, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!secret) throw new Error('Webhook secret not configured');
  if (!header || typeof header !== 'string' || header.length > 500) throw new Error('Missing signature');

  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[a-f0-9]{64}$/.test(parts.v1 || '')) throw new Error('Malformed signature');
  if (Math.abs(nowSeconds - t) > toleranceSeconds) throw new Error('Signature timestamp too old');

  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('Invalid signature');
  return true;
}
