// Which plan (and limits) applies to a tenant right now.
import Plan from '../../models/Plan.js';
import Subscription from '../../models/Subscription.js';
import Tenant from '../../models/Tenant.js';
import logger from '../../config/logger.js';

// Used ONLY when no plans exist in the database at all (fresh dev install before `npm run seed`).
const UNCONFIGURED_PLAN = Object.freeze({
  _id: null,
  code: 'unconfigured',
  name: 'Not configured',
  limits: { users: -1, leadsPerMonth: -1, discoverySearchesPerMonth: -1, aiRequestsPerMonth: -1, aiTokensPerMonth: -1, hashtagWatches: -1, storageMb: -1, exportsPerMonth: -1 },
  connectors: [],
  erpModules: [],
});

let warned = false;

export async function getEffectivePlan(tenantId) {
  const sub = await Subscription.findOne({ tenantId });
  let planId = sub?.planId;
  if (!planId) planId = (await Tenant.findById(tenantId).select('planId'))?.planId;
  if (planId) {
    const plan = await Plan.findById(planId);
    if (plan) return plan;
  }
  const trial = await Plan.findOne({ code: 'free-trial' });
  if (trial) return trial;

  if (!warned) {
    logger.warn('No plans exist — limits are NOT enforced. Run "npm run seed" to create plans.');
    warned = true;
  }
  return UNCONFIGURED_PLAN;
}

export const isUnlimited = (limit) => limit === -1 || limit === undefined || limit === null;
