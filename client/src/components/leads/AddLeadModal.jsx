// "Add lead" with duplicate handling: if the server says it already exists we show the match and offer
// to open it, add this as an extra source on it, or (only for a weak company+city match) create anyway.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Modal, Button, Field, SelectField, TextArea, Alert, Badge } from '../ui.jsx';
import { TagInput } from '../forms.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { LEAD_SOURCE_OPTIONS, PRIORITIES } from '../../utils/leadOptions.js';
import { normalizeHashtag } from '../../utils/settingsOptions.js';

const EMPTY = {
  name: '', companyName: '', personName: '', email: '', phone: '', website: '', city: '', country: '', industry: '', socialProfileUrl: '',
  source: 'MANUAL', sourceUrl: '', postUrl: '', matchedKeyword: '', matchedHashtag: '', matchedIntentPhrase: '', evidenceSnippet: '',
  description: '', requiredService: '', priority: 'MEDIUM', tags: [],
};

/** Removes empty strings so the server applies its defaults */
const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => !(v === '' || (Array.isArray(v) && v.length === 0))));

export default function AddLeadModal({ open, onClose, onCreated }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [duplicates, setDuplicates] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const close = () => {
    setF(EMPTY);
    setDuplicates(null);
    create.reset();
    onClose();
  };

  const create = useMutation({
    mutationFn: async (force) => (await api.post('/leads', { ...clean(f), ...(force && { force: true }) })).data.data.lead,
    onSuccess: (lead) => {
      toast.success('Lead added');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      close();
      onCreated?.(lead);
    },
    onError: (err) => {
      if (err.response?.status === 409) setDuplicates(err.response.data.details?.duplicates || []);
    },
  });

  const addAsSource = useMutation({
    mutationFn: async (leadId) => {
      const src = clean({ source: f.source, sourceUrl: f.sourceUrl, postUrl: f.postUrl, matchedKeyword: f.matchedKeyword, matchedHashtag: f.matchedHashtag, matchedIntentPhrase: f.matchedIntentPhrase, evidenceSnippet: f.evidenceSnippet });
      return (await api.post(`/leads/${leadId}/sources`, src)).data.data.lead;
    },
    onSuccess: () => {
      toast.success('Added as a new source on the existing lead');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      close();
    },
  });

  const errs = apiFieldErrors(create.error);
  const onlyWeak = duplicates && duplicates.length > 0 && duplicates.every((d) => !d.strong);
  const hasSourceInfo = f.sourceUrl || f.postUrl || f.evidenceSnippet;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add lead"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          {onlyWeak && <Button variant="ghost" loading={create.isPending} onClick={() => create.mutate(true)}>Create anyway</Button>}
          <Button loading={create.isPending} onClick={() => create.mutate(false)}>Add lead</Button>
        </>
      }
    >
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); create.mutate(false); }} noValidate>
        {duplicates && (
          <Alert>
            <p className="font-medium">{onlyWeak ? 'A lead with the same company name in the same city already exists.' : 'This lead already exists.'}</p>
            <ul className="mt-2 space-y-2">
              {duplicates.map((d, i) => (
                <li key={d.id || i} className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge color={d.strong ? 'red' : 'amber'}>same {d.matchedOn.join(' + ')}</Badge>
                  {d.visible ? (
                    <>
                      <Link to={`/app/leads/${d.id}`} className="text-brand-500 underline" onClick={close}>{d.name}</Link>
                      {hasSourceInfo && (
                        <button type="button" className="text-white/80 underline" disabled={addAsSource.isPending} onClick={() => addAsSource.mutate(d.id)}>
                          add this as a new source on it
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-white/60">owned by a colleague — ask your manager</span>
                  )}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {create.isError && create.error.response?.status !== 409 && !Object.keys(errs).length && <Alert>{apiErrorMessage(create.error)}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead name" name="name" placeholder="e.g. Acme Bakery — new website" maxLength={150} value={f.name} onChange={set('name')} error={errs.name} />
          <Field label="Company" name="companyName" maxLength={150} value={f.companyName} onChange={set('companyName')} />
          <Field label="Person" name="personName" maxLength={120} value={f.personName} onChange={set('personName')} />
          <Field label="Email" name="email" type="email" value={f.email} onChange={set('email')} error={errs.email} />
          <Field label="Phone" name="phone" value={f.phone} onChange={set('phone')} error={errs.phone} />
          <Field label="Website" name="website" placeholder="acme.com" value={f.website} onChange={set('website')} error={errs.website} />
          <Field label="City" name="city" maxLength={60} value={f.city} onChange={set('city')} />
          <Field label="Country" name="country" maxLength={60} value={f.country} onChange={set('country')} />
          <Field label="Industry" name="industry" maxLength={80} value={f.industry} onChange={set('industry')} />
          <Field label="Social profile URL" name="socialProfileUrl" placeholder="https://" value={f.socialProfileUrl} onChange={set('socialProfileUrl')} error={errs.socialProfileUrl} />
          <Field label="Required service" name="requiredService" maxLength={150} value={f.requiredService} onChange={set('requiredService')} />
          <SelectField label="Priority" name="priority" value={f.priority} onChange={set('priority')} options={PRIORITIES.map(([v, l]) => ({ value: v, label: l }))} />
        </div>
        <TextArea label="Description" name="description" rows={2} maxLength={3000} value={f.description} onChange={set('description')} />
        <TagInput label="Tags" value={f.tags} onChange={set('tags')} max={20} normalize={(s) => s.trim().toLowerCase().replace(/\s+/g, '-')} />

        <fieldset className="space-y-4 rounded-xl p-4 ring-1 ring-white/10">
          <legend className="px-1 text-sm font-medium text-white/80">Where did you find this lead?</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Source" name="source" value={f.source} onChange={set('source')} options={LEAD_SOURCE_OPTIONS.map(([v, l]) => ({ value: v, label: l }))} />
            <Field label="Post / page URL" name="postUrl" placeholder="https://" value={f.postUrl} onChange={set('postUrl')} error={errs.postUrl} />
            <Field label="Matched hashtag" name="matchedHashtag" placeholder="#needwebsite" value={f.matchedHashtag} onChange={(e) => setF((x) => ({ ...x, matchedHashtag: normalizeHashtag(e.target.value) }))} error={errs.matchedHashtag} />
            <Field label="Matched keyword / intent phrase" name="matchedIntentPhrase" maxLength={120} value={f.matchedIntentPhrase} onChange={set('matchedIntentPhrase')} />
          </div>
          <TextArea label="Evidence (what they actually wrote / what you saw)" name="evidenceSnippet" rows={2} maxLength={1000} value={f.evidenceSnippet} onChange={set('evidenceSnippet')} hint="Only real, observed text. This is what AI will rely on later." />
        </fieldset>
      </form>
    </Modal>
  );
}
