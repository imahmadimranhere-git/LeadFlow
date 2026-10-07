// Tenant context = "is request kis tenant ki taraf se chal rahi hai?"
// AsyncLocalStorage carries this value through every await in the request,
// so the Mongoose tenant plugin can read it WITHOUT us passing tenantId by hand.
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';

const storage = new AsyncLocalStorage();

export class TenantContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantContextError';
    this.code = 'TENANT_CONTEXT_ERROR';
  }
}

/**
 * Mongoose queries are "lazy": they only run when awaited. If fn returns an un-awaited
 * query, we start it HERE (inside the context) so tenant scoping can never be lost.
 */
function executeInContext(fn) {
  const result = fn();
  if (result && typeof result.then === 'function' && !(result instanceof Promise)) {
    return Promise.resolve(result);
  }
  return result;
}

/** Run fn as a specific tenant. tenantId MUST come from the verified token, never from req.body. */
export function runWithTenant({ tenantId, userId = null }, fn) {
  if (!tenantId || !mongoose.isValidObjectId(tenantId)) {
    throw new TenantContextError('runWithTenant requires a valid tenantId');
  }
  const ctx = Object.freeze({
    system: false,
    tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    userId: userId ? String(userId) : null,
  });
  return storage.run(ctx, () => executeInContext(fn));
}

/**
 * Run fn WITHOUT tenant scoping (super-admin screens, platform jobs, migrations).
 * A reason is mandatory so every bypass is intentional and can be audit-logged.
 */
export function runAsSystem(reason, fn) {
  if (!reason || typeof reason !== 'string') {
    throw new TenantContextError('runAsSystem requires a reason string');
  }
  return storage.run(Object.freeze({ system: true, reason }), () => executeInContext(fn));
}

export function getTenantContext() {
  return storage.getStore() || null;
}
