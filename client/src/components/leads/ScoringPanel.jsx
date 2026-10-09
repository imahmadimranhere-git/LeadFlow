// Lead scoring UI: the score card on a lead, and the background batch bar on the leads list.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Card, Button, Badge, Alert, Modal, ProgressBar } from '../ui.jsx';
import { ScoreBadge } from './LeadBits.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

export const FACTOR_LABEL = {
  explicitBuyerIntent: 'Explicit buyer intent',
  websiteCondition: 'Website condition',
  businessRelevance: 'Business relevance',
  serviceMatch: 'Service match',
  industryMatch: 'Industry match',
  locationMatch: 'Location match',
  contactability: 'Contactability',
  publicActivity: 'Public activity',
  evidenceStrength: 'Evidence strength',
  profileCompleteness: 'Profile completeness',
};
const TYPE_LABEL = (t) => (t ? t.toLowerCase().replace(/_/g, ' ') : '—');

export function ScoreCard({ lead, canWrite }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['leads', 'score', lead.id];
  const q = useQuery({ queryKey: key, queryFn: async () => (await api.get(`/leads/${lead.id}/ai/score`)).data.data.analysis });
  const run = useMutation({
    mutationFn: async (force) => (await api.post(`/leads/${lead.id}/ai/score`, { force })).data.data.analysis,
    onSuccess: (a) => {
      if (a.cached) toast.success('Nothing changed — score recalculated from the saved analysis (no AI cost)');
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['leads', 'detail', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['leads', 'list'] });
    },
  });
  const a = q.data;
  const b = a?.breakdown;
  const notConfigured = run.error?.response?.data?.errors?.[0]?.code === 'AI_NOT_CONFIGURED';

  return (
    <Card
      title="Lead score"
      action={canWrite && (
        <Button variant={a ? 'ghost' : 'primary'} className="px-3 py-1.5" loading={run.isPending} onClick={() => run.mutate(Boolean(a))}>
          {a ? 'Re-score' : 'Score with AI'}
        </Button>
      )}
    >
      {run.isError && (
        <div className="mb-3"><Alert>{apiErrorMessage(run.error)}{notConfigured && <> <Link className="underline" to="/app/settings/integrations">Open Integrations</Link></>}</Alert></div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <ScoreBadge score={lead.score} />
        {lead.score !== null && (
          <>
            <Badge color={lead.intent === 'HIGH' ? 'green' : lead.intent === 'MEDIUM' ? 'amber' : 'gray'}>{(lead.intent || '—').toLowerCase()} intent</Badge>
            <span className="text-sm text-white/60">{TYPE_LABEL(lead.leadType)}</span>
          </>
        )}
        {lead.score === null && <span className="text-sm text-white/45">Not scored yet</span>}
      </div>
      {lead.potentialService && <p className="mt-3 text-sm"><span className="text-white/45">Matches your service:</span> {lead.potentialService}</p>}
      {lead.recommendedAction && (
        <p className="mt-2 text-sm"><span className="text-white/45">Suggested next step</span> <Badge color="amber">AI suggestion</Badge><br />{lead.recommendedAction}</p>
      )}
      {b && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-white/40">How the score was calculated — your weights × each factor (0–10)</p>
          <ul className="space-y-2">
            {Object.entries(b.factors)
              .sort((x, y) => (b.weights[y[0]] || 0) - (b.weights[x[0]] || 0))
              .map(([k, f]) => {
                const w = b.weights[k] || 0;
                return (
                  <li key={k} className={`rounded-lg bg-ink-900 px-3 py-2 text-xs ring-1 ring-white/10 ${w === 0 ? 'opacity-50' : ''}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-white/80">{FACTOR_LABEL[k] || k}</span>
                      <span className="text-white/50">
                        {f.value === null ? 'not counted (no data)' : `${f.value}/10`} · weight {w}
                        <Badge color={f.source === 'AI' ? 'blue' : 'gray'}>{f.source === 'AI' ? 'AI' : 'your data'}</Badge>
                      </span>
                    </div>
                    {f.reason && <p className="mt-1 text-white/50">{f.reason}</p>}
                    {f.quote && <p className="mt-1 text-white/45">“{f.quote}”</p>}
                    {f.unsupported && <p className="mt-1 text-amber-300">{f.suspicious ? 'Capped: the text tries to instruct the AI' : 'Capped at 3: no exact proof in the evidence'}</p>}
                  </li>
                );
              })}
          </ul>
          <p className="mt-2 text-xs text-white/40">{a.model} · {formatDateTime(a.createdAt)} · change weights in <Link className="underline" to="/app/settings/company">Settings → Company → Scoring</Link></p>
        </div>
      )}
    </Card>
  );
}

const ACTIVE = ['QUEUED', 'RUNNING'];

/** Leads list: start a background batch ("score all unscored") and watch its progress. */
export function ScoringBatchBar({ selectedIds = [], onStarted }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(null); // 'UNSCORED' | 'SELECTED'
  const batches = useQuery({
    queryKey: ['ai', 'batches'],
    queryFn: async () => (await api.get('/ai/scoring/batches')).data.data.items,
    refetchInterval: (query) => (query.state.data?.some((b) => ACTIVE.includes(b.status)) ? 3000 : false),
  });
  const active = batches.data?.find((b) => ACTIVE.includes(b.status));
  const last = batches.data?.[0];
  const start = useMutation({
    mutationFn: async (mode) => (await api.post('/ai/scoring/batches', mode === 'SELECTED' ? { mode, leadIds: selectedIds } : { mode })).data.data.batch,
    onSuccess: (b) => {
      toast.success(`Scoring ${b.stats.total} lead(s) in the background`);
      setConfirm(null);
      onStarted?.();
      queryClient.invalidateQueries({ queryKey: ['ai', 'batches'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/ai/scoring/batches/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai', 'batches'] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // when a batch finishes, refresh the leads list once
  const wasActive = useRef(false);
  useEffect(() => {
    if (active) wasActive.current = true;
    else if (wasActive.current) {
      wasActive.current = false;
      queryClient.invalidateQueries({ queryKey: ['leads', 'list'] });
    }
  }, [active, queryClient]);

  return (
    <div className="mb-4">
      {active ? (
        <div className="rounded-xl bg-ink-900 p-4 ring-1 ring-white/10">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>AI scoring: {active.stats.processed} / {active.stats.total}</span>
            <Button variant="ghost" className="px-3 py-1.5" loading={cancel.isPending} onClick={() => cancel.mutate(active.id)}>Stop</Button>
          </div>
          <div className="mt-2"><ProgressBar value={active.stats.processed} max={active.stats.total} /></div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="px-3 py-1.5" onClick={() => setConfirm('UNSCORED')}>Score unscored leads (AI)</Button>
          {selectedIds.length > 0 && <Button variant="ghost" className="px-3 py-1.5" onClick={() => setConfirm('SELECTED')}>Score {selectedIds.length} selected (AI)</Button>}
          {last && !ACTIVE.includes(last.status) && (
            <span className="text-xs text-white/40">
              Last batch: {last.stats.succeeded + last.stats.cached} scored{last.stats.failed ? `, ${last.stats.failed} failed` : ''}{last.stats.skipped ? `, ${last.stats.skipped} skipped` : ''}{last.note ? ` — ${last.note}` : ''}
            </span>
          )}
        </div>
      )}
      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="Score leads with AI?"
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button loading={start.isPending} onClick={() => start.mutate(confirm)}>Start</Button></>}
      >
        <p className="text-sm text-white/70">
          {confirm === 'SELECTED' ? `${selectedIds.length} selected lead(s)` : 'Up to 200 open leads without a score (do-not-contact leads are skipped)'} will be scored in the background.
          Each lead uses about 1 AI request from your plan (unchanged leads cost nothing). It stops by itself if your monthly AI limit is reached.
        </p>
      </Modal>
    </div>
  );
}
