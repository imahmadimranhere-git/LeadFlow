// MULTI-TENANT PLUGIN — the most important security file in the project.
// Attach to EVERY business schema: leadSchema.plugin(tenantScopePlugin)
//
// What it guarantees:
//  1. Every document gets a required, indexed, immutable `tenantId`.
//  2. Every read/update/delete query is automatically filtered by the current tenant.
//  3. Creating/updating a document for ANOTHER tenant throws an error.
//  4. Missing tenant context = error (fail securely), never "return everything".
import mongoose from 'mongoose';
import { getTenantContext, TenantContextError } from '../../utils/tenantContext.js';

const READ_WRITE_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];
const UPDATE_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate'];
const REPLACE_OPS = ['replaceOne', 'findOneAndReplace'];

/** Returns the tenant ObjectId, or null for an explicit system context. Throws if no context. */
function requireTenant(operation) {
  const ctx = getTenantContext();
  if (!ctx) {
    throw new TenantContextError(
      `No tenant context for "${operation}". Use runWithTenant() or runAsSystem().`
    );
  }
  return ctx.system ? null : ctx.tenantId;
}

/** Does an update object try to change tenantId in any way? */
function updateTouchesTenantId(update) {
  if (!update) return false;
  if (Array.isArray(update)) return true; // aggregation-pipeline updates are not allowed on tenant models
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('tenantId')) return true;
    if (key.startsWith('$') && value && typeof value === 'object') {
      for (const [innerKey, innerVal] of Object.entries(value)) {
        if (innerKey.startsWith('tenantId')) return true;
        if (key === '$rename' && String(innerVal).startsWith('tenantId')) return true;
      }
    }
  }
  return false;
}

const sameId = (a, b) => String(a) === String(b);

/**
 * @param {{ tenantIndex?: boolean }} options  tenantIndex:false when the model declares its OWN index that
 *        starts with tenantId as UNIQUE (one record per company) — two indexes on the same key with different
 *        options clash in MongoDB, and the unique rule could silently be missing.
 */
export default function tenantScopePlugin(schema, { tenantIndex = true } = {}) {
  schema.add({
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: tenantIndex,
      immutable: true,
    },
  });

  // --- Queries: always AND the current tenant into the filter ---
  schema.pre(READ_WRITE_OPS, async function () {
    const tenantId = requireTenant(this.op);

    if (UPDATE_OPS.includes(this.op) && updateTouchesTenantId(this.getUpdate())) {
      throw new TenantContextError('tenantId cannot be changed');
    }
    if (tenantId === null) return; // explicit system context

    // Overwrites any tenantId the caller put in the filter → cannot be spoofed.
    this.where({ tenantId });
  });

  // Replace ops could swap the whole document (incl. tenantId) → use updateOne instead.
  schema.pre(REPLACE_OPS, async function () {
    if (requireTenant(this.op) !== null) {
      throw new TenantContextError(`${this.op} is not allowed on tenant models; use updateOne`);
    }
  });

  // Can't be filtered by tenant → only allowed in system context.
  schema.pre('estimatedDocumentCount', async function () {
    if (requireTenant('estimatedDocumentCount') !== null) {
      throw new TenantContextError('estimatedDocumentCount is not tenant-safe; use countDocuments');
    }
  });

  // --- Aggregations: first stage is always a tenant $match ---
  schema.pre('aggregate', async function () {
    const tenantId = requireTenant('aggregate');
    if (tenantId === null) return;
    this.pipeline().unshift({ $match: { tenantId } });
  });

  // --- Creating / saving documents ---
  // 'validate' runs before 'save', so tenantId is set before the "required" check.
  schema.pre('validate', async function () {
    const tenantId = requireTenant('save');
    if (tenantId === null) return; // system must set tenantId explicitly (required check will enforce)

    if (this.isNew) {
      if (this.tenantId && !sameId(this.tenantId, tenantId)) {
        throw new TenantContextError('Cannot create a document for another tenant');
      }
      this.tenantId = tenantId;
    } else if (!sameId(this.tenantId, tenantId)) {
      throw new TenantContextError('Cannot modify a document of another tenant');
    }
  });

  // Second check in case someone calls save({ validateBeforeSave: false })
  schema.pre('save', async function () {
    const tenantId = requireTenant('save');
    if (tenantId !== null && !sameId(this.tenantId, tenantId)) {
      throw new TenantContextError('Tenant mismatch on save');
    }
  });

  schema.pre('insertMany', function (next, docs) {
    try {
      const tenantId = requireTenant('insertMany');
      if (tenantId !== null) {
        const list = Array.isArray(docs) ? docs : [docs];
        for (const doc of list) {
          if (doc.tenantId && !sameId(doc.tenantId, tenantId)) {
            throw new TenantContextError('insertMany contains a document for another tenant');
          }
          doc.tenantId = tenantId;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  });
}
