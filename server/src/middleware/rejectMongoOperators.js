// Blocks NoSQL operator injection BEFORE anything reaches a controller.
// Example attack: POST /login { "email": { "$ne": null } } → would match the first user.
// We reject any key that starts/contains "$", contains ".", or is a prototype-pollution key.
import ApiError from '../utils/ApiError.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 20;

export function hasForbiddenKey(value, depth = 0) {
  if (depth > MAX_DEPTH) return true; // absurdly nested input = reject
  if (Array.isArray(value)) return value.some((v) => hasForbiddenKey(v, depth + 1));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.includes('$') || key.includes('.') || DANGEROUS_KEYS.has(key)) return true;
      if (hasForbiddenKey(value[key], depth + 1)) return true;
    }
  }
  return false;
}

export default function rejectMongoOperators(req, _res, next) {
  if ([req.body, req.query, req.params].some((part) => hasForbiddenKey(part))) {
    return next(ApiError.badRequest('Request contains forbidden characters in field names'));
  }
  next();
}
