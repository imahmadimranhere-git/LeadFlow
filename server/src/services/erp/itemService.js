// Items catalog (products / services / properties). Everyone on the team can READ prices;
// only people with catalog:manage (owner, admin, manager) can create or change them.
import Item from '../../models/Item.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import { buildPagination, escapeRegex } from '../../utils/queryBuilder.js';
import { recordAudit } from '../audit/auditService.js';

const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function companyCurrency() {
  const s = await TenantSettings.findOne({}).select('sales');
  return s?.sales?.currency || 'USD';
}

function duplicate(err) {
  if (err?.code !== 11000) return err;
  const sku = /sku/.test(err.message || JSON.stringify(err.keyPattern || {}));
  return ApiError.conflict(sku ? 'Another item already has this SKU.' : 'An item with this name already exists.');
}

export async function listItems({ page, limit, q, type, status, availability }) {
  const { skip } = buildPagination(page, limit);
  const filter = {};
  if (type) filter.type = type;
  filter.status = status || 'ACTIVE';
  if (availability) filter.availability = availability;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { description: rx }];
  }
  const [items, total] = await Promise.all([Item.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(limit), Item.countDocuments(filter)]);
  return { items: items.map((i) => i.toJSON()), total };
}

export async function getItem(id) {
  const item = await Item.findOne({ _id: id });
  if (!item) throw ApiError.notFound('Item not found');
  return item.toJSON();
}

export async function createItem(auth, data) {
  const currency = await companyCurrency();
  try {
    const item = await Item.create({ ...data, nameKey: nameKey(data.name), currency, createdBy: auth.userId, updatedBy: auth.userId });
    await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'item.created', targetType: 'Item', targetId: item._id, metadata: { priceMinor: item.priceMinor } });
    return item.toJSON();
  } catch (err) {
    throw duplicate(err);
  }
}

export async function updateItem(auth, id, data) {
  const item = await Item.findOne({ _id: id });
  if (!item) throw ApiError.notFound('Item not found');
  const before = { priceMinor: item.priceMinor, taxBp: item.taxBp };
  for (const [k, v] of Object.entries(data)) item.set(k, v);
  if (data.name) item.nameKey = nameKey(data.name);
  if (data.priceMinor !== undefined) item.currency = await companyCurrency(); // a new price is in today's company currency
  item.updatedBy = auth.userId;
  try {
    await item.save();
  } catch (err) {
    throw duplicate(err);
  }
  if (data.priceMinor !== undefined && data.priceMinor !== before.priceMinor) {
    // price changes are audited (who changed what, when) — existing quotes keep their old price
    await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'item.price_changed', targetType: 'Item', targetId: item._id, metadata: { from: before.priceMinor, to: item.priceMinor } });
  }
  return item.toJSON();
}

export async function deleteItem(auth, id) {
  const r = await Item.updateOne({ _id: id }, { $set: { deletedAt: new Date(), deletedBy: auth.userId } });
  if (!r.matchedCount) throw ApiError.notFound('Item not found');
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'item.deleted', targetType: 'Item', targetId: id });
  return { deleted: true }; // quotes that used it keep their own copy of the line
}
