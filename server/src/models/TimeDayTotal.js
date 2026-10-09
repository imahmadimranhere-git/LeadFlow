// Minutes per person per day — kept with an ATOMIC conditional $inc so nobody can log more than 24 h
// in one day, even with two requests at the same time.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, required: true },
    minutes: { type: Number, default: 0 },
  },
  { timestamps: false, strict: 'throw' }
);
schema.plugin(tenantScopePlugin);
schema.index({ tenantId: 1, userId: 1, day: 1 }, { unique: true });

const TimeDayTotal = mongoose.models.TimeDayTotal || mongoose.model('TimeDayTotal', schema);
export default TimeDayTotal;
