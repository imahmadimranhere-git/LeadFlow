import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import useTeamOptions from '../../../hooks/useTeamOptions.js';
import useTenantSettings from '../../../hooks/useTenantSettings.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { Card, Button, Field, SelectField, TextArea, Alert, Modal, LoadingState, ErrorState, Badge, Icon, Pager } from '../../../components/ui.jsx';
import { TagInput } from '../../../components/forms.jsx';
import { StatusBadge, PriorityBadge, SafetyFlags, ExternalLink } from '../../../components/leads/LeadBits.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { LEAD_STATUSES, PRIORITIES, LEAD_SOURCE_OPTIONS, SOURCE_LABEL, STATUS_LABEL } from '../../../utils/leadOptions.js';
import { normalizeHashtag } from '../../../utils/settingsOptions.js';
import { formatDate, formatDateTime } from '../../../utils/platform.js';
import AiFactsCard from '../../../components/leads/AiFactsCard.jsx';
import { ScoreCard } from '../../../components/leads/ScoringPanel.jsx';
import LeadMessages from '../../../components/messages/LeadMessages.jsx';
import WebsiteAuditCard from '../../../components/audit/WebsiteAuditCard.jsx';
import FollowUpCard from '../../../components/followUps/FollowUpCard.jsx';
import LeadSalesActions from '../../../components/erp/LeadSalesActions.jsx';
import { AuthorLine, ContactList, CompletenessBadge, LAWFUL_BASES, CONSENT_STATUSES } from '../../../components/signals/CaptureBits.jsx';

const EDIT_FIELDS = ['name', 'companyName', 'personName', 'email', 'phone', 'website', 'socialProfileUrl', 'city', 'country', 'industry', 'language', 'requiredService', 'budgetStated', 'description', 'businessProblem'];

function useLeadMutation(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body) => (await api.patch(`/leads/${id}`, body)).data.data.lead,
    onSuccess: (lead) => {
      queryClient.setQueryData(['leads', 'detail', id], lead);
      queryClient.invalidateQueries({ queryKey: ['leads', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['leads', 'activities', id] });
    },
  });
}

// ---------------------------------------------------------------- A28 capture record + compliance

function CaptureRecord({ capture }) {
  if (!capture) return null;
  return (
    <Card title="Capture record" action={<CompletenessBadge level={capture.dataCompleteness} />}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-white/45">Platform</dt><dd className="mt-0.5">{capture.platform || '—'}{capture.postType && <span className="text-white/45"> · {capture.postType}</span>}</dd></div>
        <div><dt className="text-white/45">Posted</dt><dd className="mt-0.5">{formatDateTime(capture.postTimestamp)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-white/45">Posted by</dt><dd className="mt-0.5"><AuthorLine author={capture.author} /></dd></div>
        <div className="sm:col-span-2"><dt className="text-white/45">Contacts (with where each came from)</dt><dd className="mt-1"><ContactList contacts={capture.contacts} /></dd></div>
        {capture.hashtagsUsed?.length > 0 && <div className="sm:col-span-2"><dt className="text-white/45">Hashtags in the post</dt><dd className="mt-0.5 text-brand-500">{capture.hashtagsUsed.map((h) => `#${h}`).join(' ')}</dd></div>}
        {capture.engagement?.likes != null && <div><dt className="text-white/45">Engagement (when found)</dt><dd className="mt-0.5">{capture.engagement.likes} likes · {capture.engagement.comments ?? '—'} comments</dd></div>}
      </dl>
      {capture.completenessReasons?.length > 0 && <p className="mt-3 text-xs text-white/40">{capture.completenessReasons.join(' · ')}</p>}
    </Card>
  );
}

function ComplianceCard({ lead, canWrite }) {
  const update = useLeadMutation(lead.id);
  const toast = useToast();
  const c = lead.compliance || {};
  const [f, setF] = useState({ lawfulBasis: c.lawfulBasis || '', consentStatus: c.consentStatus || 'NONE', consentProof: c.consentProof || '', contactPolicyNotes: c.contactPolicyNotes || '' });
  const dirty = f.lawfulBasis !== (c.lawfulBasis || '') || f.consentStatus !== (c.consentStatus || 'NONE') || f.consentProof !== (c.consentProof || '') || f.contactPolicyNotes !== (c.contactPolicyNotes || '');
  const save = () =>
    update.mutate(
      { compliance: { lawfulBasis: f.lawfulBasis || null, consentStatus: f.consentStatus, consentProof: f.consentProof, contactPolicyNotes: f.contactPolicyNotes } },
      { onSuccess: () => toast.success('Saved'), onError: (e) => toast.error(apiErrorMessage(e)) }
    );
  return (
    <Card title="Compliance & consent">
      <fieldset disabled={!canWrite || update.isPending} className="space-y-3">
        <SelectField label="Lawful basis" name="lawfulBasis" value={f.lawfulBasis} onChange={(e) => setF({ ...f, lawfulBasis: e.target.value })} options={[{ value: '', label: 'Not set' }, ...LAWFUL_BASES.map(([value, label]) => ({ value, label }))]} />
        <SelectField label="Consent" name="consentStatus" value={f.consentStatus} onChange={(e) => setF({ ...f, consentStatus: e.target.value })} options={CONSENT_STATUSES.map(([value, label]) => ({ value, label }))} />
        <Field label="Proof / note" name="consentProof" maxLength={500} value={f.consentProof} onChange={(e) => setF({ ...f, consentProof: e.target.value })} />
        <Field label="Contact rules" name="contactPolicyNotes" maxLength={500} placeholder="e.g. WhatsApp only, after 10am" value={f.contactPolicyNotes} onChange={(e) => setF({ ...f, contactPolicyNotes: e.target.value })} />
        {c.optOutAt && <p className="text-xs text-red-300">Opted out on {formatDateTime(c.optOutAt)} — do not contact.</p>}
        {f.consentStatus === 'WITHDRAWN' && c.consentStatus !== 'WITHDRAWN' && <p className="text-xs text-amber-300">Saving marks this lead “Do not contact”.</p>}
        {canWrite && dirty && <Button className="w-full" loading={update.isPending} onClick={save}>Save</Button>}
      </fieldset>
    </Card>
  );
}

// ---------------------------------------------------------------- "why discovered"

function WhyDiscovered({ lead, canWrite }) {
  const [open, setOpen] = useState(false);
  const rows = [
    ['Source', SOURCE_LABEL[lead.source] || lead.source],
    ['Search query', lead.searchQuery],
    ['Matched keyword', lead.matchedKeyword],
    ['Matched hashtag', lead.matchedHashtag && `#${lead.matchedHashtag}`],
    ['Matched intent phrase', lead.matchedIntentPhrase],
    ['Discovered', formatDateTime(lead.discoveryTimestamp)],
  ].filter(([, v]) => v);

  return (
    <Card title="Why was this lead discovered?" action={canWrite && <Button variant="ghost" className="px-3 py-1.5" onClick={() => setOpen(true)}>Add source</Button>}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="text-white/45">{k}</dt><dd className="mt-0.5">{v}</dd></div>
        ))}
        {lead.postUrl && <div className="sm:col-span-2"><dt className="text-white/45">Post URL</dt><dd className="mt-0.5"><ExternalLink href={lead.postUrl} /></dd></div>}
        {lead.sourceUrl && <div className="sm:col-span-2"><dt className="text-white/45">Source URL</dt><dd className="mt-0.5"><ExternalLink href={lead.sourceUrl} /></dd></div>}
      </dl>
      {(lead.evidenceSnippet || lead.evidence) && (
        <blockquote className="mt-4 whitespace-pre-wrap rounded-xl border-l-2 border-brand-500 bg-ink-900 p-4 text-sm text-white/80">
          {lead.evidenceSnippet || lead.evidence}
        </blockquote>
      )}
      {!lead.evidenceSnippet && !lead.evidence && <p className="mt-4 text-sm text-white/40">No evidence recorded — this lead was added by hand.</p>}

      {lead.sourcesHistory?.length > 1 && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-white/70">All sources ({lead.sourcesHistory.length})</p>
          <ol className="space-y-2">
            {lead.sourcesHistory.map((s, i) => (
              <li key={i} className="rounded-lg bg-white/[0.03] p-3 text-xs ring-1 ring-white/5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{SOURCE_LABEL[s.source] || s.source}</Badge>
                  <span className="text-white/40">{formatDateTime(s.discoveredAt)}</span>
                  {s.matchedHashtag && <span className="text-white/60">#{s.matchedHashtag}</span>}
                </div>
                {(s.postUrl || s.sourceUrl) && <div className="mt-1"><ExternalLink href={s.postUrl || s.sourceUrl} /></div>}
                {s.evidenceSnippet && <p className="mt-1 whitespace-pre-wrap text-white/70">“{s.evidenceSnippet}”</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {open && <AddSourceModal leadId={lead.id} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function AddSourceModal({ leadId, onClose }) {
  const queryClient = useQueryClient();
  const [f, setF] = useState({ source: 'MANUAL', sourceUrl: '', postUrl: '', searchQuery: '', matchedHashtag: '', evidenceSnippet: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: async () => (await api.post(`/leads/${leadId}/sources`, Object.fromEntries(Object.entries(f).filter(([, v]) => v)))).data.data.lead,
    onSuccess: (lead) => {
      queryClient.setQueryData(['leads', 'detail', leadId], lead);
      queryClient.invalidateQueries({ queryKey: ['leads', 'activities', leadId] });
      onClose();
    },
  });
  const errs = apiFieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title="Add a discovery source" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Add source</Button></>}>
      <div className="space-y-4">
        {m.isError && !Object.keys(errs).length && <Alert>{apiErrorMessage(m.error)}</Alert>}
        <SelectField label="Source" name="srcSource" value={f.source} onChange={set('source')} options={LEAD_SOURCE_OPTIONS.map(([v, l]) => ({ value: v, label: l }))} />
        <Field label="Post / page URL" name="srcPost" placeholder="https://" value={f.postUrl} onChange={set('postUrl')} error={errs.postUrl} />
        <Field label="Search query used" name="srcQuery" maxLength={300} value={f.searchQuery} onChange={set('searchQuery')} />
        <Field label="Matched hashtag" name="srcTag" value={f.matchedHashtag} onChange={(e) => setF((x) => ({ ...x, matchedHashtag: normalizeHashtag(e.target.value) }))} error={errs.matchedHashtag} />
        <TextArea label="Evidence" name="srcEvidence" rows={3} maxLength={1000} value={f.evidenceSnippet} onChange={set('evidenceSnippet')} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- details form

function DetailsForm({ lead, canWrite }) {
  const toast = useToast();
  const save = useLeadMutation(lead.id);
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(EDIT_FIELDS.map((k) => [k, lead[k] || ''])),
    tags: lead.tags || [],
    customFields: Object.entries(lead.customFields || {}),
  }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const errs = apiFieldErrors(save.error);

  function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(EDIT_FIELDS.map((k) => [k, f[k]]));
    body.tags = f.tags;
    body.customFields = Object.fromEntries(f.customFields.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]));
    save.mutate(body, { onSuccess: () => toast.success('Lead saved') });
  }

  return (
    <Card title="Details">
      <form className="space-y-4" onSubmit={submit} noValidate>
        {save.isError && (
          <Alert>
            {apiErrorMessage(save.error)}
            {Object.entries(errs).map(([k, m]) => <span key={k} className="block text-xs">{k}: {m}</span>)}
          </Alert>
        )}
        <fieldset disabled={!canWrite} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ['name', 'Lead name'], ['companyName', 'Company'], ['personName', 'Person'], ['email', 'Email'], ['phone', 'Phone'], ['website', 'Website'],
              ['socialProfileUrl', 'Social profile URL'], ['city', 'City'], ['country', 'Country'], ['industry', 'Industry'], ['requiredService', 'Required service'], ['language', 'Language'],
            ].map(([k, label]) => (
              <Field key={k} label={label} name={`lead-${k}`} value={f[k]} onChange={set(k)} error={errs[k]} />
            ))}
            <Field label="Budget (only if they actually said it)" name="lead-budget" maxLength={120} value={f.budgetStated} onChange={set('budgetStated')} />
          </div>
          <TextArea label="Description" name="lead-description" rows={3} maxLength={3000} value={f.description} onChange={set('description')} />
          <TextArea label="Business problem (observed / stated)" name="lead-problem" rows={2} maxLength={1000} value={f.businessProblem} onChange={set('businessProblem')} />
          <TagInput label="Tags" value={f.tags} onChange={set('tags')} max={20} disabled={!canWrite} normalize={(s) => s.trim().toLowerCase().replace(/\s+/g, '-')} />

          <div>
            <p className="mb-2 text-sm font-medium text-white/80">Custom fields</p>
            <div className="space-y-2">
              {f.customFields.map(([k, v], i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                  <input aria-label="Field name" className="rounded-lg bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/10" placeholder="Field" maxLength={40} value={k} onChange={(e) => setF((x) => ({ ...x, customFields: x.customFields.map((p, j) => (j === i ? [e.target.value, p[1]] : p)) }))} />
                  <input aria-label="Field value" className="rounded-lg bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/10" placeholder="Value" maxLength={500} value={v} onChange={(e) => setF((x) => ({ ...x, customFields: x.customFields.map((p, j) => (j === i ? [p[0], e.target.value] : p)) }))} />
                  {canWrite && <button type="button" aria-label="Remove field" className="px-2 text-white/40 hover:text-red-300" onClick={() => setF((x) => ({ ...x, customFields: x.customFields.filter((_, j) => j !== i) }))}><Icon name="x" className="h-4 w-4" /></button>}
                </div>
              ))}
              {canWrite && f.customFields.length < 20 && (
                <button type="button" className="text-sm text-brand-500 hover:underline" onClick={() => setF((x) => ({ ...x, customFields: [...x.customFields, ['', '']] }))}>+ Add field</button>
              )}
            </div>
          </div>
        </fieldset>
        {canWrite && <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save changes</Button></div>}
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- activity

const ACTIVITY_TEXT = {
  CREATED: () => 'created this lead',
  UPDATED: (a) => `updated ${(a.meta?.fields || []).join(', ')}`,
  STATUS_CHANGED: (a) => `changed status ${STATUS_LABEL[a.meta?.from] || a.meta?.from} → ${STATUS_LABEL[a.meta?.to] || a.meta?.to}`,
  STAGE_CHANGED: (a) => `moved to ${a.meta?.to}`,
  ASSIGNED: (a) => (a.meta?.to ? 'reassigned this lead' : 'unassigned this lead'),
  SOURCE_ADDED: (a) => `added a source (${SOURCE_LABEL[a.meta?.source] || a.meta?.source})`,
  MERGED: (a) => `merged “${a.meta?.mergedName}” into this lead`,
  DELETED: () => 'deleted this lead',
};

function Activity({ leadId, canWrite }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user, can } = useAuth();
  const [page, setPage] = useState(1);
  const [note, setNote] = useState('');
  const key = ['leads', 'activities', leadId];
  const q = useQuery({ queryKey: [...key, page], queryFn: async () => (await api.get(`/leads/${leadId}/activities`, { params: { page, limit: 20 } })).data.data, placeholderData: keepPreviousData });
  const add = useMutation({
    mutationFn: () => api.post(`/leads/${leadId}/notes`, { body: note }),
    onSuccess: () => { setNote(''); queryClient.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (noteId) => api.delete(`/leads/${leadId}/notes/${noteId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Card title="Activity & notes">
      {canWrite && (
        <form className="mb-5 space-y-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) add.mutate(); }}>
          <TextArea label="Add a note" name="note" rows={2} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end"><Button type="submit" loading={add.isPending} disabled={!note.trim()}>Add note</Button></div>
        </form>
      )}
      {q.isLoading && <LoadingState rows={3} />}
      {q.isError && <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />}
      <ol className="space-y-3">
        {q.data?.items.map((a) => (
          <li key={a.id} className="flex gap-3 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.type === 'NOTE' ? 'bg-brand-500' : 'bg-white/20'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-white/60">
                <span className="text-white/90">{a.actorId?.name || 'System'}</span>{' '}
                {a.type === 'NOTE' ? 'wrote' : (ACTIVITY_TEXT[a.type] || (() => a.type.toLowerCase()))(a)}
                <span className="ml-2 text-xs text-white/30">{formatDateTime(a.createdAt)}</span>
              </p>
              {a.type === 'NOTE' && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-ink-900 p-3 text-white/85">{a.body}</p>}
            </div>
            {a.type === 'NOTE' && (a.actorId?.id === user.id || can('leads:delete')) && (
              <button type="button" aria-label="Delete note" className="self-start text-white/30 hover:text-red-300" onClick={() => del.mutate(a.id)}><Icon name="x" className="h-4 w-4" /></button>
            )}
          </li>
        ))}
      </ol>
      <Pager pagination={q.data?.pagination} onPage={setPage} />
    </Card>
  );
}

// ---------------------------------------------------------------- page

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const team = useTeamOptions();
  const settings = useTenantSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const q = useQuery({ queryKey: ['leads', 'detail', id], queryFn: async () => (await api.get(`/leads/${id}`)).data.data.lead });
  const update = useLeadMutation(id);
  const remove = useMutation({
    mutationFn: () => api.delete(`/leads/${id}`),
    onSuccess: () => { toast.success('Lead deleted'); navigate('/app/leads', { replace: true }); },
  });
  useDocumentTitle(q.data?.name || 'Lead');

  if (q.isLoading) return <LoadingState rows={10} />;
  if (q.isError) return <ErrorState title={q.error.response?.status === 404 ? 'Lead not found' : undefined} message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  const lead = q.data;
  const canWrite = can('leads:write');
  const quick = (body) => update.mutate(body, { onError: (e) => toast.error(apiErrorMessage(e)) });
  const stages = settings.data?.pipelineStages || [lead.pipelineStage].filter(Boolean);

  return (
    <>
      <Link to="/app/leads" className="text-sm text-white/50 hover:text-white">← All leads</Link>
      <div className="mb-6 mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{lead.name}</h1>
          <p className="mt-1 text-sm text-white/50">{[lead.companyName !== lead.name && lead.companyName, lead.personName, lead.city, lead.country].filter(Boolean).join(' · ')}</p>
          <div className="mt-2 flex flex-wrap gap-2"><StatusBadge status={lead.status} /><PriorityBadge priority={lead.priority} /><SafetyFlags lead={lead} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && <LeadSalesActions lead={lead} />}
          {can('leads:delete') && <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>}
        </div>
      </div>

      {lead.suspectedInjection && (
        <div className="mb-6"><Alert>Some text on this lead looks like an attempt to manipulate AI (e.g. “ignore previous instructions”). It is stored as plain data, and AI features will treat it as untrusted. Review before contacting.</Alert></div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <WhyDiscovered lead={lead} canWrite={canWrite} />
          <CaptureRecord capture={lead.capture} />
          <AiFactsCard leadId={lead.id} canWrite={canWrite} />
          <FollowUpCard lead={lead} canWrite={canWrite} />
          <WebsiteAuditCard lead={lead} canWrite={canWrite} />
          <LeadMessages lead={lead} canWrite={canWrite} />
          <DetailsForm key={lead.updatedAt} lead={lead} canWrite={canWrite} />
          <Activity leadId={lead.id} canWrite={canWrite} />
        </div>
        <div className="space-y-6">
          <Card title="Pipeline">
            <fieldset disabled={!canWrite || update.isPending} className="space-y-3">
              <SelectField label="Status" name="q-status" value={lead.status} onChange={(e) => quick({ status: e.target.value })} options={LEAD_STATUSES.map(([v, l]) => ({ value: v, label: l }))} />
              <SelectField label="Stage" name="q-stage" value={lead.pipelineStage || ''} onChange={(e) => quick({ pipelineStage: e.target.value })} options={stages.map((s) => ({ value: s, label: s }))} />
              <SelectField label="Priority" name="q-priority" value={lead.priority} onChange={(e) => quick({ priority: e.target.value })} options={PRIORITIES.map(([v, l]) => ({ value: v, label: l }))} />
              {can('leads:assign') ? (
                <SelectField
                  label="Assigned to"
                  name="q-assign"
                  value={lead.assignedTo?.id || ''}
                  onChange={(e) => quick({ assignedTo: e.target.value || null })}
                  options={[{ value: '', label: 'Unassigned' }, ...(team.data || []).map((u) => ({ value: u.id, label: u.name }))]}
                />
              ) : (
                <p className="text-sm text-white/60">Assigned to: {lead.assignedTo?.name || 'Unassigned'}</p>
              )}
            </fieldset>
          </Card>
          <ComplianceCard key={lead.updatedAt} lead={lead} canWrite={canWrite} />
          <Card title="Contact">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-white/45">Email</dt><dd className="break-all">{lead.email || '—'}</dd></div>
              <div><dt className="text-white/45">Phone</dt><dd>{lead.phone || '—'}</dd></div>
              <div><dt className="text-white/45">Website</dt><dd>{lead.website ? <ExternalLink href={lead.website} /> : '—'}</dd></div>
              <div><dt className="text-white/45">Social</dt><dd>{lead.socialProfileUrl ? <ExternalLink href={lead.socialProfileUrl} /> : '—'}</dd></div>
            </dl>
            {lead.doNotContact && <p className="mt-3 text-xs text-red-300">On your do-not-contact list — outreach is blocked.</p>}
          </Card>
          <ScoreCard lead={lead} canWrite={canWrite} />
          <Card title="Info">
            <dl className="space-y-2 text-xs text-white/50">
              <div className="flex justify-between"><dt>Created</dt><dd>{formatDateTime(lead.createdAt)}</dd></div>
              <div className="flex justify-between"><dt>Created by</dt><dd>{lead.createdBy?.name || '—'}</dd></div>
              <div className="flex justify-between"><dt>Last activity</dt><dd>{formatDateTime(lead.lastActivityAt)}</dd></div>
              <div className="flex justify-between"><dt>Follow-up</dt><dd>{formatDate(lead.followUpDate)}</dd></div>
            </dl>
          </Card>
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this lead?"
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button></>}
      >
        <p className="text-sm text-white/70">The lead is hidden everywhere. This is recorded in the audit log.</p>
      </Modal>
    </>
  );
}
