// Payment provider registry (adapter pattern).
// Every gateway implements the same small interface, so adding Safepay / Paddle / PayFast later
// means adding ONE file — billing logic doesn't change.
//
// interface PaymentProvider {
//   name: string                       // 'MANUAL', 'SAFEPAY', ...
//   supportsWebhooks: boolean
//   createCheckout({ invoice, tenant, settings }) → { type, url?, instructions?, reference }
//   verifyWebhook(rawBody: Buffer, headers) → { id, type, invoiceNumber, providerPaymentId, amountMinor, currency }
//                                            (MUST verify the signature and throw if invalid)
// }
import manualProvider from './manualProvider.js';

const registry = new Map();

export function registerProvider(provider) {
  if (!provider?.name) throw new Error('Provider must have a name');
  registry.set(provider.name, provider);
}

export function getProvider(name) {
  return registry.get(String(name || '').toUpperCase()) || null;
}

export const listProviders = () => [...registry.keys()];

registerProvider(manualProvider);
