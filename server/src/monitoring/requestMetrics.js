// PHASE 30 — measures every API request (route pattern, status, duration). Stores NO ids, query strings,
// bodies or user data — only "GET /api/v1/leads/:id 200 34ms".
import { metrics } from './monitorState.js';
import { routeLabel } from './metricsCore.js';

export default function requestMetrics(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.record({ route: routeLabel(req.baseUrl, req.route?.path, req.method), status: res.statusCode, ms });
  });
  next();
}
