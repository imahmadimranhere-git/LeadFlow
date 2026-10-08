// Small binary files owned by a tenant (logo now). Stored in MongoDB because they are tiny (≤256 KB).
// Larger uploads (documents, attachments) will go to object storage (S3/R2) later.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']; // NO SVG: SVG can contain scripts

const tenantAssetSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['LOGO'], required: true },
    contentType: { type: String, enum: ALLOWED_IMAGE_TYPES, required: true },
    size: { type: Number, required: true, min: 1, max: 256 * 1024 },
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    data: { type: Buffer, required: true, select: false, private: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

tenantAssetSchema.plugin(tenantScopePlugin);
tenantAssetSchema.index({ tenantId: 1, kind: 1 });

const TenantAsset = mongoose.models.TenantAsset || mongoose.model('TenantAsset', tenantAssetSchema);
export default TenantAsset;
