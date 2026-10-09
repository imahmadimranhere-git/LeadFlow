// Message templates: CRUD (managers+), starter import from the industry pack, preview for a lead.
import MessageTemplate from '../../models/MessageTemplate.js';
import TenantSettings from '../../models/TenantSettings.js';
import Tenant from '../../models/Tenant.js';
import User from '../../models/User.js';
import Lead from '../../models/Lead.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';
import { scopeFilter } from '../leads/leadService.js';
import { inspectTemplate, templateContext, renderTemplate } from './templateRender.js';

const MAX_TEMPLATES = 200;

function assertValidText(...texts) {
  for (const t of texts) {
    const r = inspectTemplate(t);
    if (r.unknown.length) throw ApiError.badRequest('Validation failed', [{ field: 'body', message: `Unknown variable(s): ${r.unknown.map((v) => `{{${v}}}`).join(', ')}` }]);
    if (r.broken) throw ApiError.badRequest('Validation failed', [{ field: 'body', message: 'A {{variable}} is not closed properly' }]);
  }
}
const variablesOf = (...texts) => [...new Set(texts.flatMap((t) => inspectTemplate(t).used))];

export async function listTemplates({ channel, includeInactive = false } = {}) {
  const filter = {};
  if (channel) filter.channel = channel;
  if (!includeInactive) filter.isActive = true;
  const items = await MessageTemplate.find(filter).sort({ channel: 1, name: 1 }).limit(MAX_TEMPLATES).populate('createdBy', 'name');
  return items.map((t) => t.toJSON());
}

export async function createTemplate(auth, data, source = 'MANUAL') {
  assertValidText(data.subject, data.body);
  if ((await MessageTemplate.countDocuments({})) >= MAX_TEMPLATES) throw ApiError.badRequest(`At most ${MAX_TEMPLATES} templates`);
  try {
    const t = await MessageTemplate.create({ ...data, variables: variablesOf(data.subject, data.body), source, createdBy: auth.userId, updatedBy: auth.userId });
    await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'template.created', targetType: 'MessageTemplate', targetId: t._id, metadata: { name: t.name, source } });
    return t.toJSON();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('A template with this name already exists');
    throw err;
  }
}

export async function updateTemplate(auth, id, data) {
  const t = await MessageTemplate.findById(id);
  if (!t) throw ApiError.notFound('Template not found');
  for (const [k, v] of Object.entries(data)) t.set(k, v);
  assertValidText(t.subject, t.body);
  t.variables = variablesOf(t.subject, t.body);
  t.updatedBy = auth.userId;
  try {
    await t.save();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('A template with this name already exists');
    throw err;
  }
  return t.toJSON();
}

export async function deleteTemplate(auth, id) {
  const t = await MessageTemplate.findById(id);
  if (!t) throw ApiError.notFound('Template not found');
  await t.softDelete(auth.userId);
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'template.deleted', targetType: 'MessageTemplate', targetId: t._id });
  return { deleted: true };
}

/** Copies the industry-pack starter templates (Settings) into the Templates module (skips existing names). */
export async function importStarterTemplates(auth) {
  const s = await TenantSettings.findOne({}).select('messageTemplates');
  let created = 0;
  for (const st of s?.messageTemplates || []) {
    if (await MessageTemplate.exists({ name: st.name })) continue;
    try {
      await createTemplate(auth, { name: st.name, channel: st.channel, subject: st.subject || '', body: st.body }, 'STARTER');
      created += 1;
    } catch (err) {
      if (err.statusCode !== 400 && err.statusCode !== 409) throw err; // an invalid starter is skipped
    }
  }
  return { imported: created };
}

/** Values for rendering: the lead + your company + the sender. */
export async function contextFor(auth, lead) {
  const [settings, tenant, sender] = await Promise.all([
    TenantSettings.findOne({}).select('services profile'),
    Tenant.findById(auth.tenantId).select('name'),
    User.findById(auth.userId).select('name'),
  ]);
  return templateContext({ lead, company: { name: tenant?.name, mainService: settings?.services?.[0]?.name }, sender: { name: sender?.name } });
}

export async function previewTemplate(auth, id, leadId) {
  const [t, lead] = await Promise.all([MessageTemplate.findById(id), Lead.findOne({ _id: leadId, ...scopeFilter(auth) })]);
  if (!t) throw ApiError.notFound('Template not found');
  if (!lead) throw ApiError.notFound('Lead not found');
  const ctx = await contextFor(auth, lead);
  const subject = renderTemplate(t.subject, ctx);
  const body = renderTemplate(t.body, ctx);
  return { subject: subject.text, body: body.text, missing: [...new Set([...subject.missing, ...body.missing])] };
}
