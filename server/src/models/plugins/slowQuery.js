// PHASE 30 — logs database operations slower than SLOW_QUERY_MS: model + operation + time only
// (never the filter values — they can contain personal data). Counted for the System page + alerts.
import logger from '../../config/logger.js';
import { metrics } from '../../monitoring/monitorState.js';

const OPS = ['find', 'findOne', 'countDocuments', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany'];
const limitMs = () => Number(process.env.SLOW_QUERY_MS) || 500;

function report(kind, op, started) {
  if (!started) return;
  const ms = Date.now() - started;
  if (ms < limitMs()) return;
  metrics.slowQuery();
  logger.warn({ model: kind, op, ms }, 'slow query');
}

export default function slowQueryPlugin(schema) {
  schema.pre(OPS, function markStart() {
    this._lfStartedAt = Date.now();
  });
  schema.post(OPS, function markEnd() {
    report(this.model?.modelName, this.op, this._lfStartedAt);
  });
  schema.pre('aggregate', function markStart() {
    this._lfStartedAt = Date.now();
  });
  schema.post('aggregate', function markEnd() {
    report(this._model?.modelName, 'aggregate', this._lfStartedAt);
  });
}
