// AI models + prices (platform-wide). ModelPricing is NOT tenant data → no tenant plugin; only the
// super admin can change it, companies can only READ the active list.
import ModelPricing from '../../models/ModelPricing.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';

const pub = (m) => ({ id: String(m._id), provider: m.provider, modelId: m.modelId, displayName: m.displayName, inputPerMTok: m.inputPerMTok, outputPerMTok: m.outputPerMTok, isDefault: m.isDefault, verified: m.verified });

/** For company settings: active models only. */
export async function listActiveModels() {
  const items = await ModelPricing.find({ isActive: true }).sort({ provider: 1, isDefault: -1, displayName: 1 }).limit(100);
  return items.map(pub);
}

export async function findActiveModel(provider, modelId) {
  return ModelPricing.findOne({ provider, modelId, isActive: true });
}

export async function defaultModel(provider) {
  return ModelPricing.findOne({ provider, isActive: true, isDefault: true });
}

// ---------------------------------------------------------------- super admin

export async function adminListModels() {
  const items = await ModelPricing.find({}).sort({ provider: 1, isDefault: -1, displayName: 1 }).limit(200);
  return items.map((m) => ({ ...pub(m), isActive: m.isActive, notes: m.notes, updatedAt: m.updatedAt }));
}

async function clearOtherDefaults(provider, keepId) {
  await ModelPricing.updateMany({ provider, isDefault: true, _id: { $ne: keepId } }, { $set: { isDefault: false } });
}

export async function adminCreateModel(admin, data, meta = {}) {
  if (await ModelPricing.exists({ provider: data.provider, modelId: data.modelId })) throw ApiError.conflict('This model already exists');
  const doc = new ModelPricing({ ...data, isDefault: false });
  await doc.save();
  if (data.isDefault) {
    await clearOtherDefaults(doc.provider, doc._id);
    doc.isDefault = true;
    await doc.save();
  }
  await recordAudit({ actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, action: 'ai_model.created', targetType: 'ModelPricing', targetId: doc._id, metadata: { provider: doc.provider, modelId: doc.modelId, inputPerMTok: doc.inputPerMTok, outputPerMTok: doc.outputPerMTok }, ip: meta.ip });
  return pub(doc);
}

export async function adminUpdateModel(admin, id, data, meta = {}) {
  const doc = await ModelPricing.findById(id);
  if (!doc) throw ApiError.notFound('Model not found');
  const before = { inputPerMTok: doc.inputPerMTok, outputPerMTok: doc.outputPerMTok, isActive: doc.isActive };
  if (data.isDefault === false && doc.isDefault) throw ApiError.badRequest('Choose another default model instead (each provider needs one)');
  if (data.isActive === false && doc.isDefault) throw ApiError.badRequest('The default model cannot be turned off — make another model the default first');
  for (const [k, v] of Object.entries(data)) if (k !== 'isDefault') doc.set(k, v);
  if (data.isDefault === true && !doc.isDefault) {
    await clearOtherDefaults(doc.provider, doc._id);
    doc.isDefault = true;
  }
  await doc.save();
  await recordAudit({ actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, action: 'ai_model.updated', targetType: 'ModelPricing', targetId: doc._id, metadata: { modelId: doc.modelId, before, changes: data }, ip: meta.ip });
  return pub(doc);
}
