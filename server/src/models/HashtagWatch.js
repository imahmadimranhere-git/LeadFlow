// A scheduled hashtag/keyword watch (e.g. #needaplot every 6 hours on Instagram).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

export const WATCH_PLATFORMS = ['INSTAGRAM'];
export const WATCH_SCHEDULES = [6, 12, 24];

const hashtagWatchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    platform: { type: String, enum: WATCH_PLATFORMS, default: 'INSTAGRAM' },
    hashtags: { type: [String], required: true },
    keywords: { type: [String], default: [] }, // extra words to look for in captions
    locations: { type: [String], default: [] }, // keep only posts mentioning one of these (empty = all)
    scheduleHours: { type: Number, enum: WATCH_SCHEDULES, default: 6 },
    maxResultsPerHashtag: { type: Number, min: 5, max: 50, default: 50 },
    isActive: { type: Boolean, default: true },
    hashtagIds: { type: Map, of: String, default: {} }, // Instagram's ids, cached
    nextRunAt: { type: Date, default: Date.now, index: true },
    lockedUntil: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
    lastRunStatus: { type: String, enum: ['OK', 'PARTIAL', 'FAILED', null], default: null },
    lastError: { type: String, maxlength: 300, default: null },
    totals: {
      runs: { type: Number, default: 0 },
      postsSeen: { type: Number, default: 0 },
      signals: { type: Number, default: 0 },
      highIntent: { type: Number, default: 0 },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

hashtagWatchSchema.plugin(tenantScopePlugin);
hashtagWatchSchema.index({ tenantId: 1, createdAt: -1 });
hashtagWatchSchema.index({ isActive: 1, nextRunAt: 1 });

const HashtagWatch = mongoose.models.HashtagWatch || mongoose.model('HashtagWatch', hashtagWatchSchema);
export default HashtagWatch;
