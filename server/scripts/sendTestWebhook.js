// Sends ONE signed test lead to your webhook URL — to check the "Website forms" integration works.
// Usage (PowerShell / terminal):
//   $env:WEBHOOK_SECRET="whsec_..."          (Windows PowerShell)
//   npm run webhook:test -- http://localhost:5000/api/v1/webhooks/leads/wh_xxxx
// The secret is read from the environment (not typed as an argument → it doesn't land in shell history).
import crypto from 'node:crypto';
import { signWebhook } from '../src/utils/webhookSignature.js';

const url = process.argv[2];
const secret = process.env.WEBHOOK_SECRET;
if (!url || !/^https?:\/\/.+\/api\/v1\/webhooks\/leads\/wh_[A-Za-z0-9_-]{32}$/.test(url) || !secret) {
  console.error('Usage: set WEBHOOK_SECRET, then: npm run webhook:test -- <your webhook URL>');
  process.exit(1);
}

const body = JSON.stringify({
  id: `test-${crypto.randomUUID()}`,
  name: 'Test Person',
  email: 'test.person@example.com',
  phone: '+92 300 0000000',
  company: 'Test Company',
  city: 'Lahore',
  message: 'This is a test lead from sendTestWebhook.js',
  formName: 'Test form',
  consent: true,
  consentText: 'Test consent',
});

const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-LeadFlow-Signature': signWebhook(secret, body) }, body });
console.log(res.status, await res.text());
console.log(res.ok ? '✔ Sent — open Signals inbox → "New (forms)"' : '✘ Not accepted (check the URL/secret)');
