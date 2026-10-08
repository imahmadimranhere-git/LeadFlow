// Kanban pipeline. Drag a card to another column (mouse), or use the "Move to" menu on each card
// (keyboard / touch friendly). The move is shown immediately and rolled back if the server refuses.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { PageHeader, LoadingState, ErrorState, Button } from '../../../components/ui.jsx';
import { ScoreBadge, StatusBadge } from '../../../components/leads/LeadBits.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';

const KEY = ['leads', 'pipeline'];

function moveInBoard(board, leadId, toStage) {
  let moved = null;
  const columns = board.columns.map((c) => {
    const hit = c.items.find((l) => l.id === leadId);
    if (hit) moved = { ...hit, pipelineStage: toStage };
    return hit ? { ...c, total: c.total - 1, items: c.items.filter((l) => l.id !== leadId) } : c;
  });
  if (!moved) return board;
  return { ...board, columns: columns.map((c) => (c.stage === toStage ? { ...c, total: c.total + 1, items: [moved, ...c.items] } : c)) };
}

export default function PipelinePage() {
  useDocumentTitle('Pipeline');
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(null);
  const q = useQuery({ queryKey: KEY, queryFn: async () => (await api.get('/leads/pipeline')).data.data });
  const canWrite = can('leads:write');

  const move = useMutation({
    mutationFn: ({ leadId, stage }) => api.patch(`/leads/${leadId}/stage`, { pipelineStage: stage }),
    onMutate: async ({ leadId, stage }) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const previous = queryClient.getQueryData(KEY);
      queryClient.setQueryData(KEY, (b) => (b ? moveInBoard(b, leadId, stage) : b));
      return { previous };
    },
    onError: (err, _v, ctx) => {
      queryClient.setQueryData(KEY, ctx.previous);
      toast.error(apiErrorMessage(err));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ['leads', 'list'] });
    },
  });

  if (q.isLoading) return <LoadingState rows={8} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  const { columns, stages } = q.data;

  return (
    <>
      <PageHeader title="Pipeline" description="Drag leads between stages. Stage names are set in Settings → Company → Pipeline." actions={<Link to="/app/leads"><Button variant="ghost">List view</Button></Link>} />
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max gap-4">
          {columns.map((col) => (
            <section
              key={col.stage}
              aria-label={`${col.stage} (${col.total})`}
              onDragOver={(e) => { if (canWrite) { e.preventDefault(); setDragOver(col.stage); } }}
              onDragLeave={() => setDragOver((s) => (s === col.stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const leadId = e.dataTransfer.getData('text/lead-id');
                const from = e.dataTransfer.getData('text/from-stage');
                if (leadId && from !== col.stage) move.mutate({ leadId, stage: col.stage });
              }}
              className={`flex w-72 shrink-0 flex-col rounded-2xl bg-ink-800 ring-1 transition ${dragOver === col.stage ? 'ring-brand-500' : 'ring-white/10'}`}
            >
              <header className="flex items-center justify-between px-4 py-3">
                <h2 className="text-sm font-semibold">{col.stage}</h2>
                <span className="rounded-full bg-white/10 px-2 text-xs text-white/60">{col.total}</span>
              </header>
              <ul className="flex max-h-[70vh] flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
                {col.items.length === 0 && <li className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-white/30">Drop leads here</li>}
                {col.items.map((l) => (
                  <li
                    key={l.id}
                    draggable={canWrite}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/lead-id', l.id);
                      e.dataTransfer.setData('text/from-stage', col.stage);
                    }}
                    className={`rounded-xl bg-ink-900 p-3 ring-1 ring-white/10 ${canWrite ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/app/leads/${l.id}`} className="min-w-0 text-sm font-medium hover:text-brand-500">{l.name}</Link>
                      <ScoreBadge score={l.score} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-white/45">{[l.companyName !== l.name && l.companyName, l.city].filter(Boolean).join(' · ')}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <StatusBadge status={l.status} />
                      <span className="truncate text-xs text-white/40">{l.assignedTo?.name}</span>
                    </div>
                    {canWrite && (
                      <select
                        aria-label={`Move ${l.name} to stage`}
                        className="mt-2 w-full rounded-md bg-white/5 px-2 py-1 text-xs text-white/70 ring-1 ring-white/10"
                        value=""
                        onChange={(e) => e.target.value && move.mutate({ leadId: l.id, stage: e.target.value })}
                      >
                        <option value="">Move to…</option>
                        {stages.filter((s) => s !== col.stage).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                  </li>
                ))}
                {col.total > col.items.length && (
                  <li className="text-center text-xs text-white/40">
                    <Link to={`/app/leads?stage=${encodeURIComponent(col.stage)}`} className="hover:text-white">+{col.total - col.items.length} more in list view</Link>
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
