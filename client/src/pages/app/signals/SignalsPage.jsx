// Signals inbox: public posts (hashtag watches) and form submissions (webhook), waiting for a person.
// A signal becomes a lead only when someone clicks "Convert".
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useToast } from '../../../components/Toast.jsx';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import useDebounce from '../../../hooks/useDebounce.js';
import { PageHeader, Card, Button, Badge, Field, SelectField, Modal, Alert, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import { ExternalLink } from '../../../components/leads/LeadBits.jsx';
import { AuthorLine, ContactList, CompletenessBadge, LAWFUL_BASES } from '../../../components/signals/CaptureBits.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { formatDateTime } from '../../../utils/platform.js';

const STATUS_TABS = [
  ['NEEDS_REVIEW', 'Needs review'],
  ['NEW', 'New (forms)'],
  ['FILTERED', 'Filtered'],
  ['CONVERTED', 'Converted'],
  ['DISMISSED', 'Dismissed'],
  ['', 'All'],
];
const INTENT_COLOR = { HIGH: 'green', MEDIUM: 'amber', LOW: 'gray', NONE: 'gray' };
const SOURCE_LABEL = { INSTAGRAM: 'Instagram', WEBHOOK: 'Website form' };
const OPEN = ['NEW', 'NEEDS_REVIEW', 'FILTERED'];

function ConvertModal({ signal, onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const needsProfile = signal.capture?.author?.status === 'NOT_PROVIDED_BY_SOURCE';
  const [f, setF] = useState({ displayName: '', handle: '', profileUrl: '', profileType: 'UNKNOWN', phone: '', email: '', publiclyStated: false, city: signal.matchedLocation || '', lawfulBasis: signal.compliance?.lawfulBasis || 'LEGITIMATE_INTEREST' });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const convert = useMutation({
    mutationFn: async (force = false) => {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== null));
      if (body.profileType === 'UNKNOWN') delete body.profileType;
      return (await api.post(`/signals/${signal.id}/convert`, { ...body, force })).data.data.lead;
    },
    onSuccess: (lead) => {
      toast.success('Lead created');
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      navigate(`/app/leads/${lead.id}`);
    },
  });
  const errs = apiFieldErrors(convert.error);
  const dups = convert.error?.response?.data?.details?.duplicates || [];
  const onlyWeak = dups.length > 0 && dups.every((d) => !d.strong);

  return (
    <Modal
      open
      onClose={onClose}
      title="Convert to lead"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {onlyWeak && <Button variant="ghost" loading={convert.isPending} onClick={() => convert.mutate(true)}>Create anyway</Button>}
          <Button loading={convert.isPending} onClick={() => convert.mutate(false)}>Create lead</Button>
        </>
      }
    >
      <div className="space-y-4">
        {needsProfile && (
          <Alert type="info">
            <strong>Needs manual profile review.</strong> Instagram does not tell apps who wrote a post. Open the post
            {signal.capture?.postUrl && <> (<ExternalLink href={signal.capture.postUrl}>open</ExternalLink>)</>}, look at the public profile,
            and type only what you can see there. It is saved as “typed in by your team”, not as data from Instagram.
            Tip: with the <Link className="underline" to="/app/settings/extension">Chrome extension</Link> you can do this right on the post — saving it there converts this signal.
          </Alert>
        )}
        {convert.isError && !Object.keys(errs).length && (
          <Alert>
            {apiErrorMessage(convert.error)}
            {dups.filter((d) => d.id).map((d) => (
              <Link key={d.id} to={`/app/leads/${d.id}`} className="ml-2 underline">Open existing lead</Link>
            ))}
          </Alert>
        )}
        {needsProfile && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name shown on profile" name="displayName" maxLength={120} value={f.displayName} onChange={set('displayName')} error={errs.displayName} />
            <Field label="Instagram handle" name="handle" placeholder="@username" maxLength={31} value={f.handle} onChange={set('handle')} error={errs.handle} />
            <Field label="Profile link" name="profileUrl" placeholder="https://www.instagram.com/username/" value={f.profileUrl} onChange={set('profileUrl')} error={errs.profileUrl} />
            <SelectField label="Profile type" name="profileType" value={f.profileType} onChange={set('profileType')} options={[['UNKNOWN', "Don't know"], ['PERSONAL', 'Personal'], ['BUSINESS', 'Business'], ['CREATOR', 'Creator']].map(([value, label]) => ({ value, label }))} />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Extra phone (optional)" name="phone" value={f.phone} onChange={set('phone')} error={errs.phone} />
          <Field label="Extra email (optional)" name="email" type="email" value={f.email} onChange={set('email')} error={errs.email} />
          <Field label="City" name="city" maxLength={60} value={f.city} onChange={set('city')} error={errs.city} />
          <SelectField label="Lawful basis for contacting" name="lawfulBasis" value={f.lawfulBasis} onChange={set('lawfulBasis')} options={LAWFUL_BASES.map(([value, label]) => ({ value, label }))} />
        </div>
        {(f.phone || f.email) && (
          <label className="flex items-start gap-2 text-sm text-white/70">
            <input type="checkbox" className="mt-1" checked={f.publiclyStated} onChange={set('publiclyStated')} />
            The person published this contact publicly themselves (in the post, bio or contact button).
          </label>
        )}
        <p className="text-xs text-white/40">Contacts already in the post: they are copied with their source. Nothing is guessed or looked up elsewhere.</p>
      </div>
    </Modal>
  );
}

function SignalCard({ s, selected, onToggle, onConvert }) {
  const cap = s.capture || {};
  const open = OPEN.includes(s.status);
  return (
    <li className="flex gap-3 rounded-xl bg-ink-900 p-4 ring-1 ring-white/10">
      <input type="checkbox" className="mt-1" aria-label="Select signal" disabled={!open} checked={selected} onChange={onToggle} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="blue">{SOURCE_LABEL[s.source] || s.source}</Badge>
          {s.matchedHashtag && <span className="text-sm font-medium">#{s.matchedHashtag}</span>}
          <Badge color={INTENT_COLOR[s.intentLevel]}>{s.intentLevel === 'NONE' ? 'no intent phrase' : `${s.intentLevel.toLowerCase()} intent`}</Badge>
          <CompletenessBadge level={cap.dataCompleteness} />
          {s.status === 'FILTERED' && <Badge>filtered</Badge>}
          {s.status === 'CONVERTED' && <Badge color="green">converted</Badge>}
          {s.status === 'DISMISSED' && <Badge>dismissed</Badge>}
          {s.compliance?.consentStatus === 'GIVEN' && <Badge color="green">consent given</Badge>}
          {s.suspectedInjection && <Badge color="amber">⚠ suspicious text</Badge>}
        </div>
        {cap.captionSnippet && <p className="whitespace-pre-wrap text-sm text-white/75">{cap.captionSnippet}</p>}
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-white/40">Posted by</dt><dd className="mt-0.5 text-sm"><AuthorLine author={cap.author} /></dd></div>
          <div><dt className="text-white/40">Public contact</dt><dd className="mt-0.5"><ContactList contacts={cap.contacts} /></dd></div>
        </dl>
        <p className="text-xs text-white/40">
          {cap.postTimestamp && <>Posted {formatDateTime(cap.postTimestamp)} · </>}
          Found {formatDateTime(s.discoveredAt)}
          {s.watchId?.name && <> · watch “{s.watchId.name}”</>}
          {s.matchedIntentPhrase && <> · phrase “{s.matchedIntentPhrase}”</>}
          {s.matchedLocation && <> · {s.matchedLocation}</>}
          {s.matchedService && <> · service “{s.matchedService}”</>}
          {s.filterReason && <> · <span className="text-amber-300">{s.filterReason}</span></>}
          {cap.engagement?.likes != null && <> · {cap.engagement.likes} likes</>}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {cap.postUrl && <ExternalLink href={cap.postUrl} className="text-xs">Open post</ExternalLink>}
          {s.leadId && <Link to={`/app/leads/${s.leadId}`} className="text-xs text-brand-500 underline">Open lead</Link>}
          {open && <Button className="px-3 py-1.5" onClick={onConvert}>Convert to lead</Button>}
        </div>
      </div>
    </li>
  );
}

export default function SignalsPage() {
  useDocumentTitle('Signals inbox');
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('NEEDS_REVIEW');
  const [intentLevel, setIntent] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [converting, setConverting] = useState(null);
  const q = useDebounce(search);

  const list = useQuery({
    queryKey: ['signals', status, intentLevel, q, page],
    queryFn: async () => (await api.get('/signals', { params: { page, limit: 20, ...(status && { status }), ...(intentLevel && { intentLevel }), ...(q && { search: q }) } })).data.data,
    placeholderData: keepPreviousData,
  });
  const dismiss = useMutation({
    mutationFn: async () => (await api.post('/signals/dismiss', { ids: [...selected] })).data.data,
    onSuccess: (r) => {
      toast.success(`${r.dismissed} dismissed`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['signals'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const reset = () => { setPage(1); setSelected(new Set()); };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const items = list.data?.items || [];

  return (
    <>
      <PageHeader title="Signals inbox" description="Public posts and form submissions that match your watches. Review them, then convert the real buyers into leads." />
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {STATUS_TABS.map(([k, l]) => (
          <button key={k || 'all'} type="button" role="tab" aria-selected={status === k} onClick={() => { setStatus(k); reset(); }} className={`rounded-lg px-3 py-2 text-sm ${status === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>
        ))}
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input aria-label="Search text" value={search} maxLength={60} onChange={(e) => { setSearch(e.target.value); reset(); }} placeholder="Search in post text…" className="min-w-[200px] flex-1 rounded-lg bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500" />
          <SelectField name="intent" aria-label="Intent" value={intentLevel} onChange={(e) => { setIntent(e.target.value); reset(); }} options={[{ value: '', label: 'Any intent' }, { value: 'HIGH', label: 'High intent' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'LOW', label: 'Low' }, { value: 'NONE', label: 'None' }]} />
        </div>
        {selected.size > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-brand-500/10 px-4 py-3 ring-1 ring-brand-500/30">
            <span className="mr-2 text-sm">{selected.size} selected</span>
            <Button variant="ghost" className="px-3 py-1.5" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Dismiss</Button>
          </div>
        )}
        {list.isLoading && <LoadingState rows={5} />}
        {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
        {list.data && items.length === 0 && (
          <EmptyState icon="inbox" title="Nothing here yet" description={<>Set up a <Link className="text-brand-500 underline" to="/app/hashtag-watches">hashtag watch</Link> or the website-forms webhook in Integrations.</>} />
        )}
        <ul className="space-y-3">
          {items.map((s) => (
            <SignalCard key={s.id} s={s} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} onConvert={() => setConverting(s)} />
          ))}
        </ul>
        <Pager pagination={list.data?.pagination} onPage={(p) => { setPage(p); setSelected(new Set()); }} />
      </Card>
      {converting && <ConvertModal key={converting.id} signal={converting} onClose={() => setConverting(null)} />}
    </>
  );
}
