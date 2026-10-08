// One row per connected integration per company. The secret part is encrypted (AES-256-GCM) and
// marked select:false + private → it is never loaded by accident and never sent to the browser.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { PROVIDER_KEYS, INTEGRATION_STATUSES } from '../config/integrationProviders.js';

const encryptedValue = new mongoose.Schema(
  { ciphertext: String, iv: String, authTag: String, keyVersion: Number },
  { _id: false }
);

const tenantIntegrationSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: PROVIDER_KEYS, required: true },
    label: { type: String, trim: true, maxlength: 60, default: '' },
    encryptedCredentials: { type: encryptedValue, required: true, select: false, private: true },
    maskedHints: { type: Map, of: String, default: {} }, // e.g. { apiKey: 'sk-••••1234' }
    config: { type: Map, of: String, default: {} }, // non-secret settings
    status: { type: String, enum: INTEGRATION_STATUSES, default: 'NOT_TESTED' },
    lastTestedAt: { type: Date, default: null },
    lastError: { type: String, maxlength: 200, default: null },
    lastUsedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

tenantIntegrationSchema.plugin(tenantScopePlugin);
tenantIntegrationSchema.index({ tenantId: 1, provider: 1 }, { unique: true });
// Public webhook URLs are looked up by key (no tenant yet) → indexed + unique
tenantIntegrationSchema.index({ 'config.publicKey': 1 }, { unique: true, partialFilterExpression: { provider: 'INBOUND_WEBHOOK' } });

const TenantIntegration = mongoose.models.TenantIntegration || mongoose.model('TenantIntegration', tenantIntegrationSchema);
export default TenantIntegration;
