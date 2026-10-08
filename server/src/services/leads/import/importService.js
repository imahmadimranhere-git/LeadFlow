// CSV import: upload → map columns → preview (valid / invalid / duplicates) → import.
// Every row goes through the SAME validation as a lead typed by hand (createLeadBody),
// duplicates are checked against the file itself AND the company's existing leads,
// and the plan's monthly lead limit is enforced for the whole batch at once.
import mongoose from '../../../config/mongoose.js';
import ImportJob from '../../../models/ImportJob.js';
import Lead from '../../../models/Lead.js';
import LeadActivity from '../../../models/LeadActivity.js';
import TenantSettings from '../../../models/TenantSettings.js';
import ApiError from '../../../utils/ApiError.js';
import { hasPermission, PERMISSIONS as P } from '../../../config/permissions.js';
import { createLeadBody } from '../../../validators/leads.validators.js';
import { identityKeys, looksLikePromptInjection } from '../normalize.js';
import { loadDncMatcher } from '../dncService.js';
import { consumeQuota, releaseQuota } from '../../billing/quotaService.js';
import { getEffectivePlan } from '../../billing/planResolver.js';
import { recordAudit } from '../../audit/auditService.js';
import { parseCsv, suggestMapping, IMPORT_FIELDS, CsvError } from './csvParser.js';

const MAX_ISSUES = 500;
const STRONG = ['emailNormalized', 'websiteNormalized', 'phoneNormalized', 'socialNormalized'];

const safeFileName = (name) => String(name || 'import.csv').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'import.csv';

function publicJob(job, extra = {}) {
  const j = job.toJSON();
  return { ...j, mapping: Object.fromEntries(job.mapping || []), ...extra };
}

async function loadJob(auth, id, { withRows = false } = {}) {
  const q = ImportJob.findOne({ _id: id, createdBy: auth.userId }); // only the person who uploaded it
  if (withRows) q.select('+rows');
  const job = await q;
  if (!job) throw ApiError.notFound('Import not found or expired');
  return job;
}

// ---------------------------------------------------------------- step 1: upload

export async function uploadCsv(auth, { buffer, fileName }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ApiError(415, 'Upload a .csv file (comma, semicolon or tab separated)');
  let parsed;
  try {
    parsed = parseCsv(buffer.toString('utf8'));
  } catch (err) {
    if (err instanceof CsvError) throw ApiError.badRequest(err.message);
    throw err;
  }
  const job = await ImportJob.create({
    fileName: safeFileName(fileName),
    headers: parsed.headers,
    rows: parsed.rows,
    rowCount: parsed.rows.length,
    mapping: suggestMapping(parsed.headers),
    createdBy: auth.userId,
  });
  return publicJob(job, { sampleRows: parsed.rows.slice(0, 10), fields: IMPORT_FIELDS });
}

// ---------------------------------------------------------------- shared: analyse all rows

/** Turns one CSV row into lead input using the column mapping. */
function rowToInput(headers, row, mapping, fileName) {
  const input = {};
  headers.forEach((h, i) => {
    const field = mapping[h];
    if (field && row[i] !== '') input[field] = row[i];
  });
  const { notes, source, ...rest } = input;
  return {
    ...rest,
    ...(notes && { description: notes }),
    source: 'CSV',
    evidenceSnippet: `Imported from file "${fileName}"${source ? ` (source column: ${String(source).slice(0, 80)})` : ''}`,
  };
}

async function analyse(job, { importPossibleDuplicates }) {
  const mapping = Object.fromEntries(job.mapping || []);
  const issues = [];
  const addIssue = (issue) => issues.length < MAX_ISSUES && issues.push(issue);
  const prepared = [];
  const summary = { total: job.rows.length, valid: 0, invalid: 0, duplicatesInDb: 0, duplicatesInFile: 0, possibleDuplicates: 0, toImport: 0 };

  // 1) validate every row with the same rules as the "Add lead" form
  job.rows.forEach((row, idx) => {
    const parsed = createLeadBody.safeParse(rowToInput(job.headers, row, mapping, job.fileName));
    if (!parsed.success) {
      summary.invalid += 1;
      const first = parsed.error.issues[0];
      addIssue({ row: idx + 1, type: 'INVALID', field: first.path.join('.') || '-', message: first.message });
      return;
    }
    summary.valid += 1;
    prepared.push({ row: idx + 1, data: parsed.data, keys: identityKeys(parsed.data) });
  });

  // 2) duplicates inside the file (first occurrence wins)
  const seen = new Map();
  const afterFile = [];
  for (const p of prepared) {
    const hit = STRONG.find((k) => p.keys[k] && seen.has(`${k}:${p.keys[k]}`));
    if (hit) {
      summary.duplicatesInFile += 1;
      addIssue({ row: p.row, type: 'DUPLICATE_FILE', field: hit.replace('Normalized', ''), message: `Same as row ${seen.get(`${hit}:${p.keys[hit]}`)}` });
      continue;
    }
    STRONG.forEach((k) => p.keys[k] && seen.set(`${k}:${p.keys[k]}`, p.row));
    afterFile.push(p);
  }

  // 3) duplicates against existing leads — a few $in queries instead of one query per row
  const existing = new Set();
  for (const k of [...STRONG, 'companyCityKey']) {
    const values = [...new Set(afterFile.map((p) => p.keys[k]).filter(Boolean))];
    for (let i = 0; i < values.length; i += 1000) {
      const found = await Lead.find({ [k]: { $in: values.slice(i, i + 1000) } }).select(k).limit(5000);
      found.forEach((d) => existing.add(`${k}:${d[k]}`));
    }
  }
  const toImport = [];
  for (const p of afterFile) {
    const strongHit = STRONG.find((k) => p.keys[k] && existing.has(`${k}:${p.keys[k]}`));
    if (strongHit) {
      summary.duplicatesInDb += 1;
      addIssue({ row: p.row, type: 'DUPLICATE_DB', field: strongHit.replace('Normalized', ''), message: 'A lead with this already exists' });
      continue;
    }
    if (p.keys.companyCityKey && existing.has(`companyCityKey:${p.keys.companyCityKey}`)) {
      summary.possibleDuplicates += 1;
      addIssue({ row: p.row, type: 'POSSIBLE_DUPLICATE', field: 'companyName', message: 'Same company name + city as an existing lead' });
      if (!importPossibleDuplicates) continue;
    }
    toImport.push(p);
  }
  summary.toImport = toImport.length;
  return { summary, issues, toImport };
}

// ---------------------------------------------------------------- step 2: preview

export async function previewImport(auth, id, { mapping, options = {} }) {
  const job = await loadJob(auth, id, { withRows: true });
  if (!['UPLOADED', 'PREVIEWED'].includes(job.status)) throw ApiError.conflict('This import was already used');

  // mapping keys must be real headers; each lead field used at most once
  const cleanMapping = {};
  const used = new Set();
  for (const [header, field] of Object.entries(mapping)) {
    if (!job.headers.includes(header)) throw ApiError.badRequest(`Unknown column "${header.slice(0, 60)}"`);
    if (!field) continue;
    if (used.has(field)) throw ApiError.badRequest(`"${field}" is mapped to more than one column`);
    used.add(field);
    cleanMapping[header] = field;
  }
  if (!['name', 'companyName', 'personName'].some((f) => used.has(f))) {
    throw ApiError.badRequest('Map at least one of: name, companyName or personName');
  }

  job.mapping = cleanMapping;
  job.options = { importPossibleDuplicates: Boolean(options.importPossibleDuplicates), assignToMe: Boolean(options.assignToMe) };
  const { summary, issues } = await analyse(job, job.options);
  job.summary = { ...summary, imported: 0, failed: 0 };
  job.issues = issues;
  job.status = 'PREVIEWED';
  await job.save();
  return publicJob(job);
}

// ---------------------------------------------------------------- step 3: commit

export async function commitImport(auth, id) {
  // Atomic claim → clicking "Import" twice (or two tabs) can only import once
  const claimed = await ImportJob.findOneAndUpdate(
    { _id: id, createdBy: auth.userId, status: 'PREVIEWED' },
    { $set: { status: 'IMPORTING' } },
    { new: true }
  ).select('+rows');
  if (!claimed) {
    const exists = await ImportJob.exists({ _id: id, createdBy: auth.userId });
    throw exists ? ApiError.conflict('Preview first, or this import was already done') : ApiError.notFound('Import not found or expired');
  }

  try {
    // Re-check everything: leads may have been added since the preview
    const { summary, issues, toImport } = await analyse(claimed, claimed.options);
    if (toImport.length === 0) throw ApiError.badRequest('Nothing to import — all rows are invalid or duplicates');

    try {
      await consumeQuota(auth.tenantId, 'leads', toImport.length);
    } catch (err) {
      if (err.statusCode === 402) {
        const plan = await getEffectivePlan(auth.tenantId);
        err.message = `This file has ${toImport.length} new leads, but your ${plan.name} plan's monthly lead limit doesn't have room for all of them. Import a smaller file or upgrade.`;
      }
      throw err;
    }

    const settings = await TenantSettings.findOne({}).select('pipelineStages');
    const stage = settings?.pipelineStages?.[0] || 'New';
    const isDnc = await loadDncMatcher();
    const assignedTo = !hasPermission(auth.role, P.LEADS_ASSIGN) || claimed.options.assignToMe ? new mongoose.Types.ObjectId(auth.userId) : null;
    const now = new Date();

    const docs = toImport.map(({ data, keys }) => {
      const { force, ...input } = data; // eslint-disable-line no-unused-vars
      return {
        ...input,
        ...keys,
        name: input.name || input.companyName || input.personName,
        pipelineStage: stage,
        assignedTo,
        createdBy: auth.userId,
        discoveryTimestamp: now,
        lastActivityAt: now,
        sourcesHistory: [{ source: 'CSV', evidenceSnippet: input.evidenceSnippet, discoveredAt: now, addedBy: auth.userId }],
        suspectedInjection: looksLikePromptInjection(input.name, input.description, input.evidenceSnippet),
        doNotContact: isDnc(keys),
      };
    });

    let inserted = [];
    for (let i = 0; i < docs.length; i += 200) {
      try {
        inserted = inserted.concat(await Lead.insertMany(docs.slice(i, i + 200), { ordered: false }));
      } catch (err) {
        // ordered:false → the rest of the batch still goes in; failures are usually duplicates created meanwhile
        if (err.code !== 11000 && !err.writeErrors) throw err;
        inserted = inserted.concat(err.insertedDocs || []);
      }
    }
    const failed = docs.length - inserted.length;
    if (failed > 0) await releaseQuota(auth.tenantId, 'leads', failed);

    if (inserted.length) {
      await LeadActivity.insertMany(inserted.map((l) => ({ leadId: l._id, type: 'CREATED', meta: { source: 'CSV', importId: String(claimed._id) }, actorId: auth.userId })));
    }

    claimed.summary = { ...summary, imported: inserted.length, failed };
    claimed.issues = issues;
    claimed.status = 'COMPLETED';
    claimed.completedAt = new Date();
    claimed.rows = []; // personal data no longer needed
    await claimed.save();
    await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'leads.imported', targetType: 'ImportJob', targetId: claimed._id, metadata: { imported: inserted.length, failed, file: claimed.fileName } });
    return publicJob(claimed);
  } catch (err) {
    // Give the job back so the user can fix things and try again (quota errors, nothing to import…)
    await ImportJob.updateOne({ _id: claimed._id, status: 'IMPORTING' }, { $set: { status: 'PREVIEWED' } });
    throw err;
  }
}

export async function getImport(auth, id) {
  return publicJob(await loadJob(auth, id));
}
