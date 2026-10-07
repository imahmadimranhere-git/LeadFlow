// Validates params / query / body with Zod schemas.
// Validated (and type-converted) values are put on req.validated — controllers use ONLY that.
// If a route has no body schema, any body content is rejected (no unexpected input).
import ApiError from '../utils/ApiError.js';

const PARTS = ['params', 'query', 'body'];

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === 'object' && Object.keys(value).length === 0);
}

export default function validate(schemas = {}) {
  return (req, _res, next) => {
    const errors = [];
    req.validated = {};

    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) {
        if (part !== 'params' && !isEmpty(req[part])) {
          errors.push({ location: part, field: '', message: `No ${part} is accepted on this endpoint` });
        }
        continue;
      }
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        req.validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          errors.push({
            location: part,
            field: issue.path.join('.'),
            // unrecognized_keys → tell which fields are not allowed
            message: issue.code === 'unrecognized_keys' ? `Unknown field(s): ${issue.keys.join(', ')}` : issue.message,
          });
        }
      }
    }

    if (errors.length) return next(ApiError.badRequest('Validation failed', errors));
    next();
  };
}
