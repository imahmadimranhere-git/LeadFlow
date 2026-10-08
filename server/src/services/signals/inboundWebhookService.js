// Inbound webhook connector: a company's website form / WordPress / Zapier / Make POSTs a lead to us.
//
//  - The platform GENERATES a public key (part of the URL) + a secret (shown ONCE, stored encrypted).
//  - Every request must be signed:  X-LeadFlow-Signature: t=<unix>,v1=<HMAC-SHA256(secret, `${t}.${rawBody}`)>
//    → nobody without the secret can post fake leads; old requests (> 5 min) are rejected.
//  - The event "id" is INSIDE the signed body → a captured request can't be replayed with a new id,
//    and the same id is only ever processed once (unique index).
//  - The result is a Signal (inbox), not a Lead — a person still decides.
import crypto from 'node:crypto';
import { z } from 'zod';
import TenantIntegration from '../../models/TenantIntegration.js';
import Signal from '../../models/Signal.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import env from '../../config/env.js';
import { encrypt, decrypt, maskSecret } from '../../utils/crypto.js';
import { verifyWebhookSignature } from '../../utils/webhookSignature.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { recordAudit } from '../audit/auditService.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';
import { getEffectivePlan } from '../billing/planResolver.js';
import { toPublic } from '../integrations/vaultService.js';
import { detectIntent } from '../leads/discovery/intentDetector.js';
import { matchService } from '../leads/discovery/serviceMatcher.js';
import { looksLikePromptInjection } from '../leads/normalize.js';
import { dataCompleteness } from './extract.js';

const PROVIDER = 'INBOUND_WEBHOOK';
export const PUBLIC_KEY_RE = /^wh_[A-Za-z0-9_-]{32}$/;

const newPublicKey = () => `wh_${crypto.randomBytes(24).toString('base64url')}`;
const newSecret = () => `whsec_${crypto.randomBytes(32).toString('base64url')}`;

export const endpointUrl = (publicKey) => `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/webhooks/leads/${publicKey}`;

async function assertWebhookInPlan(tenantId) {
  const plan = await getEffectivePlan(tenantId);
  if (plan.code !== 'unconfigured' && !(plan.connectors || []).includes('WEBHOOK')) {
    throw new ApiError(402, `Website form webhooks are not included in your ${plan.name} plan. Please upgrade.`, [{ code: 'PLAN_FEATURE', field: 'source', message: 'WEBHOOK' }]);
  }
}

/** Create the endpoint. The secret is returned ONCE — we only keep it encrypted. */
export async function createInboundWebhook(auth) {
  await assertWebhookInPlan(auth.tenantId);
  if (await TenantIntegration.exists({ provider: PROVIDER })) throw ApiError.conflict('Webhook already exists — use "Rotate secret" for a new secret');
  const publicKey = newPublicKey();
  const secret = newSecret();
  const doc = await TenantIntegration.create({
    provider: PROVIDER,
    label: 'Website forms',
    encryptedCredentials: encrypt(JSON.stringify({ secret })),
    maskedHints: { secret: maskSecret(secret) },
    config: { publicKey },
    status: 'CONNECTED',
    createdBy: auth.userId,
    updatedBy: auth.userId,
  });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'integration.connected', targetType: 'TenantIntegration', targetId: doc._id, metadata: { provider: PROVIDER } });
  return { integration: toPublic(doc), endpointUrl: endpointUrl(publicKey), secret };
}

/** New secret (old one stops working immediately). The URL stays the same. */
export async function rotateInboundWebhookSecret(auth) {
  const doc = await TenantIntegration.findOne({ provider: PROVIDER });
  if (!doc) throw ApiError.notFound('Webhook not created yet');
  const secret = newSecret();
  doc.encryptedCredentials = encrypt(JSON.stringify({ secret }));
  doc.maskedHints = { secret: maskSecret(secret) };
  doc.updatedBy = auth.userId;
  await doc.save();
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'integration.secret_rotated', targetType: 'TenantIntegration', targetId: doc._id, metadata: { provider: PROVIDER } });
  return { integration: toPublic(doc), endpointUrl: endpointUrl(doc.config.get('publicKey')), secret };
}

export async function getInboundWebhook() {
  const doc = await TenantIntegration.findOne({ provider: PROVIDER });
  if (!doc) return null;
  return { integration: toPublic(doc), endpointUrl: endpointUrl(doc.config.get('publicKey')) };
}

// ------------------------------------------------------------------ receiving

const field = (max) => z.string().trim().max(max).optional();
export const inboundPayload = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/, 'id: 1-100 letters, numbers, _ . : -'),
    name: field(120),
    email: z.string().trim().toLowerCase().max(254).email().optional(),
    phone: z.string().trim().regex(/^\+?[0-9][0-9\s\-().]{5,24}$/, 'Invalid phone').optional(),
    company: field(150),
    city: field(60),
    website: z.string().trim().max(2048).url().refine((u) => /^https?:\/\//i.test(u), 'http/https only').optional(),
    message: field(3000),
    pageUrl: z.string().trim().max(2048).url().refine((u) => /^https?:\/\//i.test(u), 'http/https only').optional(),
    formName: field(80),
    consent: z.boolean().optional(),
    consentText: field(500),
    fields: z
      .record(z.string().regex(/^[A-Za-z][\w ]{0,39}$/), z.string().trim().max(500))
      .refine((o) => Object.keys(o).length <= 20, 'At most 20 extra fields')
      .optional(),
  })
  .strict()
  .refine((d) => d.email || d.phone || d.name, 'Send at least a name, email or phone');

const reject = (status, message) => new ApiError(status, message);

/**
 * Public endpoint handler. Returns { received: true, duplicate? }.
 * Unknown key, disabled endpoint and bad signature all look the same to the caller (401/404, short message).
 */
export async function receiveInboundLead(publicKey, rawBody, headers, meta = {}) {
  if (!PUBLIC_KEY_RE.test(publicKey || '')) throw reject(404, 'Unknown webhook');
  const doc = await runAsSystem('webhook:inbound-lookup', () =>
    TenantIntegration.findOne({ provider: PROVIDER, 'config.publicKey': publicKey }).select('+encryptedCredentials')
  );
  if (!doc || doc.status === 'DISABLED') throw reject(404, 'Unknown webhook');

  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const { secret } = JSON.parse(decrypt(doc.encryptedCredentials));
  try {
    verifyWebhookSignature({ rawBody: raw, header: headers['x-leadflow-signature'], secret });
  } catch (err) {
    logSecurityEvent('inbound_webhook_bad_signature', { tenantId: String(doc.tenantId), ip: meta.ip, reason: err.message });
    throw reject(401, 'Invalid signature');
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw ApiError.badRequest('Body must be JSON');
  }
  const parsed = inboundPayload.safeParse(json);
  if (!parsed.success) {
    throw ApiError.badRequest('Validation failed', parsed.error.issues.slice(0, 10).map((i) => ({ field: i.path.join('.'), message: i.code === 'unrecognized_keys' ? `Unknown field(s): ${i.keys.join(', ')}` : i.message })));
  }
  const p = parsed.data;

  return runWithTenant({ tenantId: doc.tenantId }, async () => {
    await assertWebhookInPlan(doc.tenantId);
    const settings = (await TenantSettings.findOne({}))?.toObject() || {};
    const d = settings.discovery || {};
    const text = [p.message, p.company, p.formName, ...Object.values(p.fields || {})].filter(Boolean).join('\n').slice(0, 5000);
    const intent = detectIntent(text, { keywords: d.keywords || [], intentPhrases: d.intentPhrases || [], hashtags: [], negativeKeywords: d.negativeKeywords || [] });

    const now = new Date();
    const contacts = [];
    const add = (type, value) => value && contacts.push({ type, value, provenance: 'LEAD_FORM', provenanceUrl: p.pageUrl || null, capturedAt: now, publiclyStatedByAuthor: false });
    add('EMAIL', p.email);
    add('PHONE', p.phone);
    add('WEBSITE', p.website);
    const completeness = dataCompleteness({ authorProvided: Boolean(p.name), contactCount: contacts.length });

    try {
      await Signal.create({
        source: 'WEBHOOK',
        externalId: p.id,
        capture: {
          platform: 'WEBSITE_FORM',
          postId: p.id,
          postType: 'form',
          postUrl: p.pageUrl || null,
          captionSnippet: (p.message || '').slice(0, 1000) || null,
          postTimestamp: now,
          author: p.name ? { status: 'PROVIDED', displayName: p.name } : { status: 'NOT_PROVIDED_BY_SOURCE' },
          contacts,
          dataCompleteness: completeness.level,
          completenessReasons: completeness.reasons,
        },
        fullPublicText: text,
        matchedKeyword: intent.matchedKeyword,
        matchedIntentPhrase: intent.matchedIntentPhrase,
        matchedLocation: p.city || null,
        negativeKeyword: intent.negativeKeyword,
        intentLevel: intent.intentLevel === 'NONE' ? 'MEDIUM' : intent.intentLevel, // they contacted US → at least medium
        matchedService: matchService(text, settings.services || []),
        hasPublicContact: contacts.length > 0,
        suspectedInjection: looksLikePromptInjection(text),
        compliance: p.consent
          ? { lawfulBasis: 'CONSENT', consentStatus: 'GIVEN', consentProof: `Form ${p.formName || ''} ${p.pageUrl || ''} at ${now.toISOString()}: ${p.consentText || 'consent checkbox ticked'}`.replace(/\s+/g, ' ').slice(0, 500) }
          : { lawfulBasis: 'LEGITIMATE_INTEREST', consentStatus: 'NONE' },
        formFields: { ...(p.company ? { company: p.company } : {}), ...(p.formName ? { formName: p.formName } : {}), ...(p.fields || {}) },
        status: 'NEW',
      });
    } catch (err) {
      if (err.code === 11000) return { received: true, duplicate: true }; // same id again → ignored (idempotent)
      throw err;
    }
    await TenantIntegration.updateOne({ _id: doc._id }, { $set: { lastUsedAt: now } });
    return { received: true };
  });
}
