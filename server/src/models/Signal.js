// A raw "signal": a public post (or an inbound form submission) matching a watch, waiting in the inbox.
// It becomes a Lead only when a person converts it. Unconverted signals are deleted after 90 days.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { captureSchema, complianceSchema } from './captureSchemas.js';
import { LEAD_SOURCES } from '../config/leadOptions.js';

export const SIGNAL_STATUSES = ['NEW', 'NEEDS_REVIEW', 'FILTERED', 'CONVERTED', 'DISMISSED'];

const signalSchema = new mongoose.Schema(
  {
    source: { type: String, enum: LEAD_SOURCES, required: true },
    externalId: { type: String, required: true, maxlength: 200 }, // post id / event id → dedupe
    capture: { type: captureSchema, default: () => ({}) },
    fullPublicText: { type: String, maxlength: 5000, default: '' },
    matchedHashtag: { type: String, maxlength: 60, default: null },
    matchedKeyword: { type: String, maxlength: 120, default: null },
    matchedIntentPhrase: { type: String, maxlength: 120, default: null },
    matchedLocation: { type: String, maxlength: 60, default: null },
    negativeKeyword: { type: String, maxlength: 120, default: null },
    filterReason: { type: String, maxlength: 120, default: null },
    intentLevel: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW', 'NONE'], default: 'NONE' },
    matchedService: { type: String, maxlength: 80, default: null },
    hasPublicContact: { type: Boolean, default: false },
    suspectedInjection: { type: Boolean, default: false },
    compliance: { type: complianceSchema, default: () => ({}) },
    formFields: { type: Map, of: String, default: {} }, // inbound webhook payload (validated, small)
    status: { type: String, enum: SIGNAL_STATUSES, default: 'NEW' },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    watchId: { type: mongoose.Schema.Types.ObjectId, ref: 'HashtagWatch', default: null },
    discoveredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true, strict: 'throw' }
);

signalSchema.plugin(tenantScopePlugin);
signalSchema.index({ tenantId: 1, source: 1, externalId: 1 }, { unique: true });
signalSchema.index({ tenantId: 1, status: 1, discoveredAt: -1 });
signalSchema.index({ tenantId: 1, watchId: 1, discoveredAt: -1 });
// Converted signals keep expiresAt = null (TTL ignores null) → only unconverted ones expire
signalSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Signal = mongoose.models.Signal || mongoose.model('Signal', signalSchema);
export default Signal;
