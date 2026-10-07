// Payment gateway webhooks: verify signature → store event id (replay protection) → apply once.
import WebhookEvent from '../../models/WebhookEvent.js';
import ApiError from '../../utils/ApiError.js';
import { getProvider } from './providers/index.js';
import { markInvoicePaid } from './subscriptionService.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';
import { runAsSystem } from '../../utils/tenantContext.js';

export async function handlePaymentWebhook(providerName, rawBody, headers, meta) {
  const provider = getProvider(providerName);
  if (!provider || !provider.supportsWebhooks) throw ApiError.notFound('Unknown webhook');
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) throw ApiError.badRequest('Empty body');

  let event;
  try {
    event = await provider.verifyWebhook(rawBody, headers);
  } catch (err) {
    logSecurityEvent('webhook_rejected', { provider: provider.name, reason: err.message, ip: meta.ip });
    throw ApiError.badRequest('Invalid webhook signature');
  }
  if (!event?.id || typeof event.id !== 'string' || event.id.length > 200) throw ApiError.badRequest('Invalid event');

  // Replay protection: the unique index makes a second delivery of the same event a no-op
  try {
    await WebhookEvent.create({ provider: provider.name, eventId: event.id, type: event.type || null });
  } catch (err) {
    if (err.code === 11000) return { received: true, duplicate: true };
    throw err;
  }

  try {
    let status = 'IGNORED';
    if (event.type === 'payment.succeeded') {
      await runAsSystem(`webhook:${provider.name}`, () =>
        markInvoicePaid({
          invoiceNumber: event.invoiceNumber,
          provider: provider.name,
          providerPaymentId: event.providerPaymentId,
          method: event.method || 'CARD',
          reference: event.providerPaymentId,
          amountMinor: event.amountMinor,
          currency: event.currency,
        })
      );
      status = 'PROCESSED';
    }
    await WebhookEvent.updateOne({ provider: provider.name, eventId: event.id }, { $set: { status } });
    return { received: true, status };
  } catch (err) {
    // Remove the marker so the gateway's automatic retry can try again
    await WebhookEvent.deleteOne({ provider: provider.name, eventId: event.id });
    throw err;
  }
}
