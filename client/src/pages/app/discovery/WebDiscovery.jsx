// Web discovery: pick queries (built from your settings) → run in the background → review results →
// import the good ones as leads. Nothing becomes a lead without a person choosing it.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useToast } from '../../../components/Toast.jsx';
import { Card, Button, Alert, Badge, LoadingState, ErrorState, EmptyState, Pager, Icon, SelectField } from '../../../components/ui.jsx';
import { ExternalLink } from '../../../components/leads/LeadBits.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { formatDateTime } from '../../../utils/platform.js';

const RUN_COLOR = { QUEUED: 'blue', RUNNING: 'blue', COMPLETED: 'green', FAILED: 'red', CANCELLED: 'gray' };
const INTENT_COLOR = { HIGH: 'green', MEDIUM: 'amber', LOW: 'gray', NONE: 'gray' };
const CAND_COLOR = { NEW: 'blue', DUPLICATE: 'amber', FILTERED: 'gray', IMPORTED: 'green', DISMISSED: 'gray' };

function NewRun({ webSource, onCreated }) {
  const toast = useToast();
  const suggestions = useQuery({ queryKey: ['discovery', 'queries'], queryFn: async () => (await api.get('/discovery/queries', { params: { source: 'GOOGLE_WEB' } })).data.data.items });
  const [queries, setQueries] = useState(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (suggestions.data && queries === null) setQueries(suggestions.data.slice(0, 5).map((q) => ({ ...q, on: true })));
  }, [suggestions.data, queries]);

  const create = useMutation({
    mutationFn: async () => (await api.post('/discovery/runs', { source: 'GOOGLE_WEB', queries: queries.filter((q) => q.on).map(({ on, ...q }) => q) })).data.data.run, // eslint-disable-line no-unused-vars
    onSuccess: (run) => {
      toast.success('Search started — results appear below in a moment');
      onCreated(run);
    },
  });

  if (!webSource?.inPlan) return <Alert>Web search is not included in your plan. Upgrade in Billing to use it.</Alert>;
  if (suggestions.isLoading || queries === null) return <LoadingState rows={3} />;

  const selected = queries.filter((q) => q.on).length;
  const all = [...queries, ...(suggestions.data || []).filter((s) => !queries.some((q) => q.query === s.query)).map((q) => ({ ...q, on: false }))];

  return (
    <Card title="New web search">
      {all.length === 0 ? (
        <EmptyState icon="search" title="No suggested searches yet" description="Add keywords, buyer-intent phrases and cities in Settings → Company → Discovery, or type your own search below." />
      ) : (
        <ul className="space-y-2">
          {all.map((q) => (
            <li key={q.query} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Use search ${q.query}`}
                checked={q.on}
                onChange={() => setQueries((list) => (list.some((x) => x.query === q.query) ? list.map((x) => (x.query === q.query ? { ...x, on: !x.on } : x)) : [...list, { ...q, on: true }]))}
              />
              <span className="font-mono text-xs text-white/80">{q.query}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim().length >= 2) { setQueries((l) => [...l, { query: draft.trim(), on: true }]); setDraft(''); } }}>
        <input aria-label="Your own search" value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} placeholder='Your own search, e.g. "need a website" Lahore' className="flex-1 rounded-lg bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500" />
        <Button type="submit" variant="ghost">Add</Button>
      </form>
      <p className="mt-3 text-xs text-white/40">Each search uses 1 “discovery search” from your monthly plan. Max 10 per run.</p>
      {create.isError && <div className="mt-3"><Alert>{apiErrorMessage(create.error)}</Alert>{/integrations/i.test(apiErrorMessage(create.error)) && <Link className="mt-2 inline-block text-sm text-brand-500 underline" to="/app/settings/integrations">Open Integrations</Link>}</div>}
      <div className="mt-4 flex justify-end">
        <Button loading={create.isPending} disabled={selected === 0 || selected > 10} onClick={() => create.mutate()}>Run {selected} search(es)</Button>
      </div>
    </Card>
  );
}

function RunResults({ run }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('NEW');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const q = useQuery({
    queryKey: ['discovery', 'candidates', run.id, status, page],
    queryFn: async () => (await api.get(`/discovery/runs/${run.id}/candidates`, { params: { page, limit: 25, ...(status && { status }) } })).data.data,
    placeholderData: keepPreviousData,
    refetchInterval: ['QUEUED', 'RUNNING'].includes(run.status) ? 4000 : false,
  });
  const refresh = () => {
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['discovery', 'candidates', run.id] });
    queryClient.invalidateQueries({ queryKey: ['leads'] });
  };
  const importSel = useMutation({
    mutationFn: async () => (await api.post('/discovery/candidates/import', { ids: [...selected] })).data.data,
    onSuccess: (r) => {
      toast.success(`${r.imported} imported${r.duplicates ? `, ${r.duplicates} were duplicates` : ''}`);
      if (r.limitReached) toast.error('Your monthly lead limit was reached — upgrade to import more.');
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const dismiss = useMutation({
    mutationFn: async () => (await api.post('/discovery/candidates/dismiss', { ids: [...selected] })).data.data,
    onSuccess: refresh,
  });
  const items = q.data?.items || [];
  const selectable = items.filter((c) => ['NEW', 'FILTERED'].includes(c.status));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Card
      title="Results"
      action={
        <SelectField name="candStatus" aria-label="Show" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); setSelected(new Set()); }} options={[
          { value: 'NEW', label: 'New' }, { value: 'FILTERED', label: 'Filtered (negative keyword)' }, { value: 'DUPLICATE', label: 'Already leads' },
          { value: 'IMPORTED', label: 'Imported' }, { value: 'DISMISSED', label: 'Dismissed' }, { value: '', label: 'All' },
        ]} />
      }
    >
      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-brand-500/10 px-4 py-3 ring-1 ring-brand-500/30">
          <span className="mr-2 text-sm">{selected.size} selected</span>
          <Button className="px-3 py-1.5" loading={importSel.isPending} onClick={() => importSel.mutate()}>Import as leads</Button>
          <Button variant="ghost" className="px-3 py-1.5" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Dismiss</Button>
        </div>
      )}
      {q.isLoading && <LoadingState rows={5} />}
      {q.isError && <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />}
      {q.data && items.length === 0 && <EmptyState icon="search" title={['QUEUED', 'RUNNING'].includes(run.status) ? 'Searching…' : 'Nothing here'} />}
      <ul className="space-y-3">
        {selectable.length > 1 && (
          <li className="text-xs text-white/50">
            <label className="flex items-center gap-2"><input type="checkbox" checked={selectable.every((c) => selected.has(c.id))} onChange={() => setSelected(selectable.every((c) => selected.has(c.id)) ? new Set() : new Set(selectable.map((c) => c.id)))} /> Select all on this page</label>
          </li>
        )}
        {items.map((c) => (
          <li key={c.id} className="flex gap-3 rounded-xl bg-ink-900 p-4 ring-1 ring-white/10">
            <input type="checkbox" className="mt-1" aria-label={`Select ${c.title}`} disabled={!['NEW', 'FILTERED'].includes(c.status)} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{c.title}</p>
                <Badge color={INTENT_COLOR[c.intentLevel]}>{c.intentLevel === 'NONE' ? 'no intent phrase' : `${c.intentLevel.toLowerCase()} intent`}</Badge>
                <Badge color={CAND_COLOR[c.status]}>{c.status.toLowerCase()}</Badge>
                {c.isPlatformPage && <Badge>platform page</Badge>}
                {c.suspectedInjection && <Badge color="amber">⚠ suspicious text</Badge>}
              </div>
              <ExternalLink href={c.url} className="text-xs" />
              {c.snippet && <p className="mt-1 text-sm text-white/65">{c.snippet}</p>}
              <p className="mt-2 text-xs text-white/40">
                Found by: <span className="font-mono">{c.searchQuery}</span>
                {c.matchedIntentPhrase && <> · intent phrase “{c.matchedIntentPhrase}”</>}
                {c.matchedKeyword && <> · keyword “{c.matchedKeyword}”</>}
                {c.matchedService && <> · matches service “{c.matchedService}”</>}
                {c.negativeKeyword && <> · contains negative keyword “{c.negativeKeyword}”</>}
              </p>
              {c.leadId && <Link to={`/app/leads/${c.leadId}`} className="mt-1 inline-block text-xs text-brand-500 underline">Open lead</Link>}
              {c.duplicateOf && <Link to={`/app/leads/${c.duplicateOf}`} className="mt-1 inline-block text-xs text-amber-300 underline">Open existing lead</Link>}
            </div>
          </li>
        ))}
      </ul>
      <Pager pagination={q.data?.pagination} onPage={(p) => { setPage(p); setSelected(new Set()); }} />
    </Card>
  );
}

export default function WebDiscovery() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeRunId, setActiveRunId] = useState(null);
  const sources = useQuery({ queryKey: ['discovery', 'sources'], queryFn: async () => (await api.get('/discovery/sources')).data.data.items });
  const runs = useQuery({
    queryKey: ['discovery', 'runs'],
    queryFn: async () => (await api.get('/discovery/runs', { params: { limit: 10 } })).data.data.items,
    refetchInterval: (query) => (query.state.data?.some((r) => ['QUEUED', 'RUNNING'].includes(r.status)) ? 3000 : false),
  });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/discovery/runs/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery', 'runs'] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (sources.isLoading || runs.isLoading) return <LoadingState rows={6} />;
  if (sources.isError || runs.isError) return <ErrorState message={apiErrorMessage(sources.error || runs.error)} onRetry={() => { sources.refetch(); runs.refetch(); }} />;

  const web = sources.data.find((s) => s.source === 'GOOGLE_WEB');
  const active = runs.data.find((r) => r.id === activeRunId) || runs.data[0];
  const busy = runs.data.some((r) => ['QUEUED', 'RUNNING'].includes(r.status));

  return (
    <div className="space-y-6">
      {!busy && <NewRun webSource={web} onCreated={(run) => { setActiveRunId(run.id); queryClient.invalidateQueries({ queryKey: ['discovery', 'runs'] }); }} />}

      {runs.data.length > 0 && (
        <Card title="Recent searches">
          <ul className="divide-y divide-white/5">
            {runs.data.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${active?.id === r.id ? 'text-white' : 'text-white/70'}`}>
                <button type="button" className="min-w-0 text-left" onClick={() => setActiveRunId(r.id)}>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge color={RUN_COLOR[r.status]}>{r.status.toLowerCase()}</Badge>
                    {r.queries.length} search(es) · {r.stats.candidates} results · {r.stats.highIntent} high intent
                  </span>
                  <span className="block text-xs text-white/40">{formatDateTime(r.createdAt)} · {r.createdBy?.name}{r.error ? ` · ${r.error}` : ''}</span>
                </button>
                {['QUEUED', 'RUNNING'].includes(r.status) ? (
                  <Button variant="ghost" className="px-3 py-1.5" loading={cancel.isPending} onClick={() => cancel.mutate(r.id)}>Cancel</Button>
                ) : (
                  active?.id !== r.id && <Icon name="chevronDown" className="h-4 w-4 -rotate-90 text-white/30" />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {active && <RunResults key={active.id} run={active} />}

      <Card title="Other sources">
        <ul className="grid gap-3 md:grid-cols-2">
          {sources.data.filter((s) => s.source !== 'GOOGLE_WEB' && s.source !== 'CSV').map((s) => (
            <li key={s.source} className="rounded-xl bg-ink-900 p-4 text-sm ring-1 ring-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{s.source.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>
                {s.availableInPhase && <Badge>Phase {s.availableInPhase}</Badge>}
              </div>
              <p className="mt-1 text-xs text-white/50">{s.note}</p>
              {s.handledBy && <Link to={s.handledBy} className="mt-2 inline-block text-xs text-brand-500 underline">Open</Link>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
