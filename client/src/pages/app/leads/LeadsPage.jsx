import { useMemo, useState } from 'react';
import { ScoringBatchBar } from '../../../components/leads/ScoringPanel.jsx';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import useDebounce from '../../../hooks/useDebounce.js';
import useTeamOptions from '../../../hooks/useTeamOptions.js';
import useTenantSettings from '../../../hooks/useTenantSettings.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { Card, PageHeader, Button, SelectField, Pager, EmptyState, ErrorState, LoadingState, Icon, Modal } from '../../../components/ui.jsx';
import AddLeadModal from '../../../components/leads/AddLeadModal.jsx';
import { StatusBadge, ScoreBadge, SafetyFlags } from '../../../components/leads/LeadBits.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { LEAD_STATUSES, PRIORITIES, LEAD_SOURCE_OPTIONS, SOURCE_LABEL } from '../../../utils/leadOptions.js';
import { formatDate } from '../../../utils/platform.js';

const opt = (pairs, all) => [{ value: '', label: all }, ...pairs.map(([v, l]) => ({ value: v, label: l }))];

function BulkBar({ ids, onDone, stages }) {
  const { can } = useAuth();
  const toast = useToast();
  const team = useTeamOptions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = useMutation({
    mutationFn: async ({ action, value }) => (await api.post('/leads/bulk', { ids, action, value })).data.data,
    onSuccess: (r) => {
      toast.success(`${r.modified} lead(s) updated`);
      setConfirmDelete(false);
      onDone();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const pick = (action) => (e) => e.target.value && run.mutate({ action, value: e.target.value === '__none' ? null : e.target.value });
  const selectClass = 'rounded-lg bg-ink-900 px-2 py-1.5 text-sm text-white ring-1 ring-white/10';

  return (
    <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-brand-500/10 px-4 py-3 ring-1 ring-brand-500/30">
      <span className="mr-2 text-sm font-medium">{ids.length} selected</span>
      <select aria-label="Set status" className={selectClass} value="" onChange={pick('status')}>
        <option value="">Set status…</option>
        {LEAD_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select aria-label="Move to stage" className={selectClass} value="" onChange={pick('stage')}>
        <option value="">Move to stage…</option>
        {stages.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {can('leads:assign') && (
        <select aria-label="Assign to" className={selectClass} value="" onChange={pick('assign')}>
          <option value="">Assign to…</option>
          <option value="__none">Unassigned</option>
          {team.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )}
      {can('leads:delete') && <Button variant="danger" className="px-3 py-1.5" onClick={() => setConfirmDelete(true)}>Delete</Button>}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${ids.length} lead(s)?`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={run.isPending} onClick={() => run.mutate({ action: 'delete' })}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-white/70">Deleted leads are hidden from all lists. This is recorded in the audit log.</p>
      </Modal>
    </div>
  );
}

export default function LeadsPage() {
  useDocumentTitle('Leads');
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useTenantSettings();
  const stages = settings.data?.pipelineStages || [];
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({ status: '', pipelineStage: searchParams.get('stage') || '', priority: '', source: '', assignedTo: '', sort: '-createdAt' });
  const debounced = useDebounce(search.trim());

  const params = useMemo(
    () => ({ page, limit: 25, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), ...(debounced && { search: debounced }) }),
    [page, filters, debounced]
  );
  const q = useQuery({ queryKey: ['leads', 'list', params], queryFn: async () => (await api.get('/leads', { params })).data.data, placeholderData: keepPreviousData });

  const setFilter = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
    setSelected(new Set());
  };
  const items = q.data?.items || [];
  const allChecked = items.length > 0 && items.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(items.map((l) => l.id)));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const canWrite = can('leads:write');

  return (
    <>
      <PageHeader
        title="Leads"
        description={q.data ? `${q.data.pagination.total} leads` : 'Your potential customers.'}
        actions={canWrite && <Button onClick={() => setAddOpen(true)}><Icon name="plus" className="h-4 w-4" /> Add lead</Button>}
      />

      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search name, company, email, city…"
            value={search}
            maxLength={60}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="rounded-lg bg-ink-900 px-3 py-2.5 text-sm text-white placeholder-white/30 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500 md:col-span-3 xl:col-span-2"
          />
          <SelectField name="status" aria-label="Status" value={filters.status} onChange={setFilter('status')} options={opt(LEAD_STATUSES, 'All statuses')} />
          <SelectField name="pipelineStage" aria-label="Stage" value={filters.pipelineStage} onChange={setFilter('pipelineStage')} options={opt(stages.map((s) => [s, s]), 'All stages')} />
          <SelectField name="priority" aria-label="Priority" value={filters.priority} onChange={setFilter('priority')} options={opt(PRIORITIES, 'All priorities')} />
          <SelectField name="source" aria-label="Source" value={filters.source} onChange={setFilter('source')} options={opt(LEAD_SOURCE_OPTIONS, 'All sources')} />
          <SelectField
            name="sort"
            aria-label="Sort"
            value={filters.sort}
            onChange={setFilter('sort')}
            options={[
              { value: '-createdAt', label: 'Newest first' },
              { value: '-score', label: 'Highest score' },
              { value: '-lastActivityAt', label: 'Recent activity' },
              { value: 'followUpDate', label: 'Follow-up date' },
              { value: 'name', label: 'Name A–Z' },
            ]}
          />
        </div>
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {[['', 'Everyone'], ['me', 'Assigned to me'], ['unassigned', 'Unassigned']].map(([v, l]) => (
            <button key={l} type="button" onClick={() => setFilter('assignedTo')({ target: { value: v } })} className={`rounded-full px-3 py-1 ring-1 ${filters.assignedTo === v ? 'bg-brand-500/15 text-brand-500 ring-brand-500/40' : 'text-white/60 ring-white/10'}`}>
              {l}
            </button>
          ))}
        </div>

        {canWrite && <ScoringBatchBar selectedIds={[...selected]} onStarted={() => setSelected(new Set())} />}
        {selected.size > 0 && canWrite && <BulkBar ids={[...selected]} stages={stages} onDone={() => { setSelected(new Set()); queryClient.invalidateQueries({ queryKey: ['leads'] }); }} />}

        {q.isLoading && <LoadingState rows={8} />}
        {q.isError && <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />}
        {q.data && items.length === 0 && (
          <EmptyState
            icon="target"
            title={debounced || Object.values(filters).some((v) => v && v !== '-createdAt') ? 'No leads match these filters' : 'No leads yet'}
            description="Add a lead by hand, import a CSV file, or search the web in Discovery."
            action={canWrite && <Button onClick={() => setAddOpen(true)}>Add lead</Button>}
          />
        )}
        {items.length > 0 && (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-white/50">
                <tr>
                  {canWrite && (
                    <th className="w-8 px-2 py-2"><input type="checkbox" aria-label="Select all" checked={allChecked} onChange={toggleAll} /></th>
                  )}
                  <th className="px-2 py-2 font-medium">Lead</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Stage</th>
                  <th className="px-2 py-2 font-medium">Score</th>
                  <th className="px-2 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 font-medium">Assigned</th>
                  <th className="px-2 py-2 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((l) => (
                  <tr key={l.id} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => navigate(`/app/leads/${l.id}`)}>
                    {canWrite && (
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                      </td>
                    )}
                    <td className="px-2 py-3">
                      <Link to={`/app/leads/${l.id}`} className="font-medium hover:text-brand-500" onClick={(e) => e.stopPropagation()}>{l.name}</Link>
                      <p className="text-xs text-white/45">{[l.companyName !== l.name && l.companyName, l.personName, l.city].filter(Boolean).join(' · ')}</p>
                      <div className="mt-1 flex flex-wrap gap-1"><SafetyFlags lead={l} /></div>
                    </td>
                    <td className="px-2 py-3"><StatusBadge status={l.status} /></td>
                    <td className="px-2 py-3 text-white/70">{l.pipelineStage || '—'}</td>
                    <td className="px-2 py-3"><ScoreBadge score={l.score} /></td>
                    <td className="px-2 py-3 text-white/60">{SOURCE_LABEL[l.source] || l.source}</td>
                    <td className="px-2 py-3 text-white/60">{l.assignedTo?.name || '—'}</td>
                    <td className="px-2 py-3 text-white/50">{formatDate(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager pagination={q.data?.pagination} onPage={(p) => { setPage(p); setSelected(new Set()); }} />
      </Card>

      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={(lead) => navigate(`/app/leads/${lead.id}`)} />
    </>
  );
}
