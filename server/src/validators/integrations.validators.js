// Request validation for the Integrations Vault. The body schema is built from the provider catalog,
// so every provider accepts exactly its own fields — nothing else.
import { z } from './common.js';
import net from 'node:net';
import { INTEGRATION_PROVIDERS, PROVIDER_KEYS } from '../config/integrationProviders.js';
import { isPublicAddress } from '../utils/safeFetch.js';
import ApiError from '../utils/ApiError.js';

export const providerParams = z
  .object({ provider: z.string().transform((s) => s.toUpperCase()).pipe(z.enum(PROVIDER_KEYS)) })
  .strict();

export const statusBody = z.object({ enabled: z.boolean() }).strict();

const httpsPublicUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
    return net.isIP(host) ? isPublicAddress(host) : true; // names are checked again by SafeFetch when used
  }, 'Must be a public https:// address (no internal hosts, no custom ports)');

function fieldSchema(field) {
  if (field.options) return z.enum(field.options);
  if (field.type === 'url') return httpsPublicUrl;
  if (field.type === 'email') return z.string().trim().toLowerCase().max(254).email();
  let s = z.string().trim().max(field.maxLength || 1000);
  if (field.pattern) s = s.regex(new RegExp(field.pattern), field.patternHint || `Invalid ${field.label}`);
  return s;
}

/** Empty string = "remove this optional value" (config) or "keep the stored secret" (credentials). */
const orEmpty = (schema) => z.union([z.literal(''), schema]);

export function saveBodyFor(providerKey) {
  const p = INTEGRATION_PROVIDERS[providerKey];
  return z
    .object({
      label: z.string().trim().max(60).optional(),
      credentials: z
        .object(Object.fromEntries(p.secretFields.map((f) => [f.key, orEmpty(fieldSchema(f)).optional()])))
        .strict()
        .optional(),
      config: z
        .object(Object.fromEntries(p.configFields.map((f) => [f.key, orEmpty(fieldSchema(f)).optional()])))
        .strict()
        .optional(),
    })
    .strict();
}

/** Express middleware: validates params, then the body with that provider's own schema. */
export function validateSaveBody(req, _res, next) {
  const parsedParams = providerParams.safeParse(req.params);
  if (!parsedParams.success) return next(ApiError.notFound('Unknown integration'));
  const schema = saveBodyFor(parsedParams.data.provider);
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(
      ApiError.badRequest(
        'Validation failed',
        parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.code === 'unrecognized_keys' ? `Unknown field(s): ${i.keys.join(', ')}` : i.message,
        }))
      )
    );
  }
  req.validated = { params: parsedParams.data, body: parsed.data };
  return next();
}
