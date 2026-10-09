// Local businesses via Google Places — results are LIVE (Google's terms limit storing them).
// Import keeps only the place ID, a Maps link and the name you confirm.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useToast } from '../../../components/Toast.jsx';
import { Card, Button, Badge, Alert, LoadingState, EmptyState } from '../../../components/ui.jsx';
import { ExternalLink } from '../../../components/leads/LeadBits.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';

export default function LocalBusiness() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [city, setCity] = useState('');
  const [results, setResults] = useState(null);
  const [nextPageToken, setNext] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const suggestions = useQuery({ queryKey: ['discovery', 'queries', 'LOCAL_BUSINESS'], queryFn: async () => (await api.get('/discovery/queries', { params: { source: 'LOCAL_BUSINESS' } })).data.data.items });

  const search = useMutation({
    mutationFn: async ({ q, pageToken }) => (await api.post('/discovery/local/search', { query: q, ...(pageToken && { pageToken }) })).data.data,
    onSuccess: (d, vars) => {
      setResults((prev) => (vars.pageToken && prev ? [...prev, ...d.results] : d.results));
      setNext(d.nextPageToken);
      setLastQuery(vars.q);
      if (!vars.pageToken) setSelected(new Set());
    },
  });
  const importSel = useMutation({
    mutationFn: async () => (await api.post('/discovery/local/import', { query: lastQuery, ...(city && { city }), places: results.filter((r) => selected.has(r.placeId)).map((r) => ({ placeId: r.placeId, name: r.name })) })).data.data,
    onSuccess: (r) => {
      toast.success(`${r.imported} imported${r.duplicates ? `, ${r.duplicates} already leads` : ''}`);
      if (r.limitReached) toast.error('Monthly lead limit reached — upgrade to import more.');
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      search.mutate({ q: lastQuery }); // refresh the "already a lead" marks (1 more search)
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const run = (q) => {
    if (q.trim().length >= 2) search.mutate({ q: q.trim() });
  };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const notConnected = search.error?.response?.data?.errors?.[0]?.code === 'NOT_CONNECTED';

  return (
    <div className="space-y-6">
      <Card title="Find local businesses">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(query); }}>
          <input aria-label="Search" value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Dentist in Islamabad, Pakistan" className="min-w-[220px] flex-1 rounded-lg bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500" />
          <input aria-label="City for imported leads" value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} placeholder="City (saved on the lead)" className="w-48 rounded-lg bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500" />
          <Button type="submit" loading={search.isPending && !search.variables?.pageToken}>Search</Button>
        </form>
        {suggestions.data?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.data.slice(0, 6).map((s) => (
              <button key={s.query} type="button" onClick={() => { setQuery(s.query); setCity(s.location || ''); run(s.query); }} className="rounded-full px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 hover:bg-white/5">{s.query}</button>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-white/40">Each search uses 1 discovery search from your plan (Google also bills your API key). Results are shown live and not saved.</p>
        {search.isError && <div className="mt-3"><Alert>{apiErrorMessage(search.error)}{notConnected && <> <Link className="underline" to="/app/settings/integrations">Open Integrations</Link></>}</Alert></div>}
      </Card>

      {results && (
        <Card title={`Results for “${lastQuery}”`} action={<span className="text-xs text-white/50">Google Maps</span>}>
          {selected.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-brand-500/10 px-4 py-3 ring-1 ring-brand-500/30">
              <span className="mr-2 text-sm">{selected.size} selected</span>
              <Button className="px-3 py-1.5" loading={importSel.isPending} onClick={() => importSel.mutate()}>Import as leads</Button>
            </div>
          )}
          {results.length === 0 && <EmptyState icon="search" title="No businesses found" />}
          <ul className="space-y-2">
            {results.map((r) => (
              <li key={r.placeId} className="flex gap-3 rounded-xl bg-ink-900 p-3 ring-1 ring-white/10">
                <input type="checkbox" className="mt-1" aria-label={`Select ${r.name}`} disabled={Boolean(r.existing)} checked={selected.has(r.placeId)} onChange={() => toggle(r.placeId)} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.businessStatus && r.businessStatus !== 'OPERATIONAL' && <Badge color="amber">{r.businessStatus.toLowerCase().replace(/_/g, ' ')}</Badge>}
                    {r.existing?.leadId && <Link to={`/app/leads/${r.existing.leadId}`} className="text-xs text-brand-500 underline">already a lead</Link>}
                    {r.existing?.colleague && <Badge>a colleague's lead</Badge>}
                  </div>
                  <p className="text-xs text-white/50">{[r.address, r.phone, r.rating !== null && `★ ${r.rating} (${r.ratingCount})`].filter(Boolean).join(' · ')}</p>
                  <div className="mt-1 flex flex-wrap gap-3">
                    <ExternalLink href={r.googleMapsUri} className="text-xs">Open on Google Maps</ExternalLink>
                    {r.websiteUri && <ExternalLink href={r.websiteUri} className="text-xs">Website</ExternalLink>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {nextPageToken && <div className="mt-4 flex justify-center"><Button variant="ghost" loading={search.isPending && Boolean(search.variables?.pageToken)} onClick={() => search.mutate({ q: lastQuery, pageToken: nextPageToken })}>More results</Button></div>}
          <p className="mt-4 text-xs text-white/40">Import saves only the Google place ID, a Maps link and the business name. Phone, website and address are not copied (Google's terms) — open the Maps page or the business website and add what you need, or use the Chrome extension.</p>
        </Card>
      )}
      {search.isPending && !results && <LoadingState rows={3} />}
    </div>
  );
}
