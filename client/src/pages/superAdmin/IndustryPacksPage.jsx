// Super admin: create and edit Industry Packs (pure data — no code change needed for a new industry).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, PageHeader, Badge, Button, Field, TextArea, SelectField, Alert, LoadingState, ErrorState, EmptyState, Icon } from '../../components/ui.jsx';
import { TagInput, ToggleChips, ServicesEditor } from '../../components/forms.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { LEAD_SOURCES, TEMPLATE_CHANNELS, SCORING_FACTORS, normalizeHashtag, normalizePhrase } from '../../utils/settingsOptions.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const DEFAULT_WEIGHTS = { explicitBuyerIntent: 30, websiteCondition: 10, businessRelevance: 10, serviceMatch: 15, industryMatch: 5, locationMatch: 10, contactability: 5, publicActivity: 5, evidenceStrength: 5, profileCompleteness: 5 };

function emptyPack() {
  return {
    code: '', name: '', description: '', icon: 'sparkles', isActive: true, sortOrder: 10,
    services: [], keywords: [], hashtags: [], intentPhrases: [], negativeKeywords: [], sources: ['CSV', 'CHROME_EXTENSION'],
    icp: { industries: [], businessTypes: [], targetRoles: [] },
    pipelineStages: ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'],
    scoringWeights: { ...DEFAULT_WEIGHTS },
    messageTemplates: [],
  };
}

function TemplatesEditor({ value, onChange }) {
  const update = (i, k, v) => onChange(value.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));
  return (
    <div className="space-y-3">
      {value.map((t, i) => (
        <div key={i} className="space-y-2 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/10">
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
            <Field label="Name" name={`tpl-name-${i}`} maxLength={80} value={t.name} onChange={(e) => update(i, 'name', e.target.value)} />
            <SelectField label="Channel" name={`tpl-ch-${i}`} value={t.channel} onChange={(e) => update(i, 'channel', e.target.value)} options={TEMPLATE_CHANNELS.map(([v, l]) => ({ value: v, label: l }))} />
            <button type="button" className="self-end rounded-lg px-2 py-2.5 text-white/40 hover:bg-red-500/10 hover:text-red-300" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label="Remove template">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
          {t.channel === 'EMAIL' && <Field label="Subject" name={`tpl-sub-${i}`} maxLength={150} value={t.subject || ''} onChange={(e) => update(i, 'subject', e.target.value)} />}
          <TextArea label="Body" name={`tpl-body-${i}`} rows={4} maxLength={2000} value={t.body} onChange={(e) => update(i, 'body', e.target.value)} hint="Placeholders: {{firstName}} {{companyName}} {{myCompany}} {{myService}} {{evidence}}" />
        </div>
      ))}
      <button type="button" className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline" onClick={() => onChange([...value, { name: '', channel: 'EMAIL', subject: '', body: '' }])}>
        <Icon name="plus" className="h-4 w-4" /> Add template
      </button>
    </div>
  );
}

function PackEditor({ pack, onClose }) {
  const isNew = !pack;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(() => {
    if (isNew) return emptyPack();
    const { id, tenantCount, createdAt, updatedAt, ...rest } = pack; // eslint-disable-line no-unused-vars
    return { ...emptyPack(), ...rest, scoringWeights: { ...DEFAULT_WEIGHTS, ...rest.scoringWeights } };
  });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const setIcp = (k) => (v) => setF((x) => ({ ...x, icp: { ...x.icp, [k]: v } }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        sortOrder: Number(f.sortOrder),
        services: f.services.filter((s) => s.name.trim()),
        messageTemplates: f.messageTemplates.filter((t) => t.name.trim() && t.body.trim()),
        scoringWeights: Object.fromEntries(Object.entries(f.scoringWeights).map(([k, v]) => [k, Number(v)])),
      };
      if (isNew) return adminApi.post('/industry-packs', body);
      const { code, ...patch } = body; // eslint-disable-line no-unused-vars
      return adminApi.patch(`/industry-packs/${pack.id}`, patch);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Industry pack created' : 'Industry pack saved');
      queryClient.invalidateQueries({ queryKey: ['admin', 'industry-packs'] });
      onClose();
    },
  });

  return (
    <Card title={isNew ? 'New industry pack' : `Edit: ${pack.name}`} action={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isNew && <Field label="Code (permanent)" name="code" value={f.code} onChange={set('code')} hint="e.g. solar-installers" />}
          <Field label="Name" name="name" maxLength={80} value={f.name} onChange={set('name')} />
          <Field label="Icon name" name="icon" value={f.icon} onChange={set('icon')} hint="e.g. building, cpu, card" />
          <Field label="Sort order" name="sortOrder" type="number" min="0" value={f.sortOrder} onChange={set('sortOrder')} />
        </div>
        <TextArea label="Description" name="description" rows={2} maxLength={500} value={f.description} onChange={set('description')} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /> Active (visible to companies)</label>

        <div>
          <p className="mb-2 text-sm font-medium text-white/80">Suggested services</p>
          <ServicesEditor value={f.services} onChange={set('services')} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TagInput label="Keywords" value={f.keywords} onChange={set('keywords')} normalize={normalizePhrase} />
          <TagInput label="Hashtags" prefix="#" value={f.hashtags} onChange={set('hashtags')} normalize={normalizeHashtag} />
          <TagInput label="Buyer-intent phrases" value={f.intentPhrases} onChange={set('intentPhrases')} normalize={normalizePhrase} />
          <TagInput label="Negative keywords" value={f.negativeKeywords} onChange={set('negativeKeywords')} normalize={normalizePhrase} />
          <TagInput label="ICP industries" value={f.icp.industries} onChange={setIcp('industries')} normalize={normalizePhrase} max={50} />
          <TagInput label="ICP business types" value={f.icp.businessTypes} onChange={setIcp('businessTypes')} normalize={normalizePhrase} max={50} />
          <TagInput label="ICP target roles" value={f.icp.targetRoles} onChange={setIcp('targetRoles')} normalize={normalizePhrase} max={50} />
          <TagInput label="Pipeline stages (in order)" value={f.pipelineStages} onChange={set('pipelineStages')} normalize={normalizePhrase} max={15} />
        </div>
        <ToggleChips label="Suggested sources" options={LEAD_SOURCES} value={f.sources} onChange={set('sources')} />

        <div>
          <p className="mb-2 text-sm font-medium text-white/80">Scoring weights <span className="text-white/40">(0–100, used in Phase 14)</span></p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {SCORING_FACTORS.map(([k, label]) => (
              <Field key={k} label={label} name={`w-${k}`} type="number" min="0" max="100" value={f.scoringWeights[k]} onChange={(e) => setF((x) => ({ ...x, scoringWeights: { ...x.scoringWeights, [k]: e.target.value } }))} />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-white/80">Message templates</p>
          <TemplatesEditor value={f.messageTemplates} onChange={set('messageTemplates')} />
        </div>

        {save.isError && (
          <Alert>
            {apiErrorMessage(save.error)}
            {(save.error?.response?.data?.errors || []).slice(0, 8).map((er) => (
              <span key={`${er.field}-${er.message}`} className="block text-xs">{er.field}: {er.message}</span>
            ))}
          </Alert>
        )}
        <Button type="submit" loading={save.isPending}>{isNew ? 'Create pack' : 'Save changes'}</Button>
      </form>
    </Card>
  );
}

export default function IndustryPacksPage() {
  useDocumentTitle('Industry packs');
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new
  const q = useQuery({ queryKey: ['admin', 'industry-packs'], queryFn: async () => (await adminApi.get('/industry-packs')).data.data.items });

  return (
    <>
      <PageHeader
        title="Industry packs"
        description="Presets companies can pick during onboarding. Adding a new industry is just data."
        actions={editing === undefined && <Button onClick={() => setEditing(null)}><Icon name="plus" className="h-4 w-4" /> New pack</Button>}
      />
      {editing !== undefined && (
        <div className="mb-6">
          <PackEditor key={editing?.id || 'new'} pack={editing} onClose={() => setEditing(undefined)} />
        </div>
      )}
      {q.isLoading && <LoadingState rows={4} />}
      {q.isError && <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />}
      {q.data?.length === 0 && <EmptyState icon="template" title="No industry packs" description='Run "npm run seed" to create the 7 default packs.' />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((p) => (
          <Card key={p.id} title={p.name} action={<Button variant="ghost" className="px-3 py-1.5" onClick={() => setEditing(p)}>Edit</Button>}>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge color={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
              <Badge color="blue">{p.code}</Badge>
              <Badge>{p.tenantCount} companies</Badge>
            </div>
            <p className="text-sm text-white/60">{p.description}</p>
            <p className="mt-3 text-xs text-white/40">
              {p.services.length} services · {p.keywords.length} keywords · {p.hashtags.length} hashtags · {p.messageTemplates.length} templates
            </p>
          </Card>
        ))}
      </div>
    </>
  );
}
