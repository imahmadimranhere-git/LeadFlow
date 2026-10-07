import env from '../config/env.js';
import logger from '../config/logger.js';

export function notFound(_req, res) {
  res.status(404).json({ success: false, message: 'Route not found', errors: [] });
}

/** Turn known library errors into safe, user-friendly ApiError-like objects. */
function normalize(err) {
  if (err.isOperational) return err;

  // Body parser errors
  if (err.type === 'entity.too.large') return { statusCode: 413, message: 'Request body too large', errors: [] };
  if (err.type === 'entity.parse.failed') return { statusCode: 400, message: 'Invalid JSON body', errors: [] };
  if (err.expose && err.status >= 400 && err.status < 500) {
    return { statusCode: err.status, message: 'Invalid request', errors: [] };
  }

  // Mongoose errors
  if (err.name === 'CastError') return { statusCode: 400, message: 'Invalid id or value', errors: [] };
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((e) => ({ field: e.path, message: e.kind === 'required' ? 'is required' : 'is invalid' }));
    return { statusCode: 400, message: 'Validation failed', errors };
  }
  if (err.code === 11000) {
    // Show which FIELD is duplicate, never the value
    const fields = Object.keys(err.keyPattern || {}).filter((f) => f !== 'tenantId');
    return { statusCode: 409, message: 'Record already exists', errors: fields.map((f) => ({ field: f, message: 'already exists' })) };
  }

  return null; // unknown → 500
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const known = normalize(err);
  const statusCode = known?.statusCode ?? 500;

  // Full details ONLY in server logs
  if (statusCode >= 500) logger.error({ err, reqId: req.id, path: req.originalUrl }, 'Server error');
  else logger.warn({ reqId: req.id, path: req.originalUrl, status: statusCode, msg: err.message }, 'Client error');

  const body = {
    success: false,
    message: known?.message ?? 'Something went wrong. Please try again.',
    errors: known?.errors ?? [],
    errorId: req.id,
  };

  // Debug message only in development, NEVER in production
  if (env.NODE_ENV === 'development' && !known) body.debug = err.message;

  res.status(statusCode).json(body);
}
