// ERP modules are switched on per PLAN (Super Admin → Plans). Checked on the server for every request.
import ApiError from '../../utils/ApiError.js';
import { getEffectivePlan } from '../billing/planResolver.js';
import { MODULE_FOR } from '../../config/erpOptions.js';

export async function assertModule(tenantId, area) {
  const plan = await getEffectivePlan(tenantId);
  if (plan.code === 'unconfigured') return; // fresh install without plans (dev) — same rule as other plan checks
  const needed = MODULE_FOR[area] || [];
  if (!needed.some((m) => (plan.erpModules || []).includes(m))) {
    throw new ApiError(402, `This module is not included in your ${plan.name} plan. Please upgrade.`, [{ code: 'PLAN_MODULE', field: '', message: needed.join('|') }]);
  }
}

/** Express middleware: requireModule('quotes') */
export const requireModule = (area) => async (req, _res, next) => {
  try {
    await assertModule(req.auth.tenantId, area);
    next();
  } catch (err) {
    next(err);
  }
};
