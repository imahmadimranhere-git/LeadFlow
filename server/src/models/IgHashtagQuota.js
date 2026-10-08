// Instagram allows each Business account to query at most 30 UNIQUE hashtags per rolling 7 days.
// One document per hashtag first queried; it deletes itself after 7 days (TTL) → count = hashtags in use.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

export const IG_WEEKLY_HASHTAG_LIMIT = 30;

const igHashtagQuotaSchema = new mongoose.Schema(
  {
    igUserId: { type: String, required: true, maxlength: 40 },
    hashtag: { type: String, required: true, maxlength: 60 },
    firstQueriedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

igHashtagQuotaSchema.plugin(tenantScopePlugin);
igHashtagQuotaSchema.index({ tenantId: 1, igUserId: 1, hashtag: 1 }, { unique: true });
igHashtagQuotaSchema.index({ firstQueriedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

const IgHashtagQuota = mongoose.models.IgHashtagQuota || mongoose.model('IgHashtagQuota', igHashtagQuotaSchema);
export default IgHashtagQuota;
