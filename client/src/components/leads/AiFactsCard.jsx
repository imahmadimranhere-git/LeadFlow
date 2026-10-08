// "What does the evidence actually say?" — AI facts, each with its exact quote from the evidence.
// The summary is labelled as an AI INFERENCE. All AI text is rendered as plain text (React escapes it).
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Card, Button, Badge, Alert } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const LABEL = { REQUIREMENT: 'Requirement', LOCATION: 'Location', BUDGET: 'Budget', TIMELINE: 'Timeline', SIZE: 'Size', CONTACT_PREFERENCE: 'Contact preference', OTHER: 'Other' };

export default function AiFactsCard({ leadId, canWrite }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['leads', 'ai', leadId];
  const list = useQuery({ queryKey: key, queryFn: async () => (await api.get(`/leads/${leadId}/ai/analyses`)).data.data.items });
  const run = useMutation({
    mutationFn: async (force) => (await api.post(`/leads/${leadId}/ai/evidence-facts`, { force })).data.data.analysis,
    onSuccess: (a) => {
      if (a.cached) toast.success('Evidence unchanged — showing the saved result (no new AI cost)');
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['leads', 'detail', leadId] });
    },
  });

  const latest = (list.data || []).find((a) => a.status === 'COMPLETED');
  const r = latest?.result;
  const notConfigured = run.error?.response?.data?.errors?.[0]?.code === 'AI_NOT_CONFIGURED';

  return (
    <Card
      title="AI: what the evidence says"
      action={canWrite && (
        <div className="flex gap-2">
          {latest && <Button variant="ghost" className="px-3 py-1.5" loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>Run again</Button>}
          {!latest && <Button className="px-3 py-1.5" loading={run.isPending} onClick={() => run.mutate(false)}>Extract facts (AI)</Button>}
        </div>
      )}
    >
      {run.isError && (
        <div className="mb-3">
          <Alert>
            {apiErrorMessage(run.error)}
            {notConfigured && <> <Link className="underline" to="/app/settings/integrations">Open Integrations</Link></>}
          </Alert>
        </div>
      )}
      {!latest && !run.isError && <p className="text-sm text-white/45">The AI reads only this lead's evidence and lists facts that are written in it — each with the exact quote. It never adds anything from outside.</p>}
      {r && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-white/40">AI summary <Badge color="amber">inference — may be wrong</Badge></p>
            <p className="mt-1 text-sm">{r.summary || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Facts <Badge color="green">quoted from the evidence</Badge></p>
            {r.facts.length === 0 ? (
              <p className="mt-1 text-sm text-white/45">No clear facts in the evidence.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {r.facts.map((f, i) => (
                  <li key={i} className="rounded-lg bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/10">
                    <span className="text-white/45">{LABEL[f.label] || f.label}:</span> {f.value}
                    <p className="mt-1 text-xs text-white/50">“{f.quote}”</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {Object.values(r.statedRequirement || {}).some(Boolean) && (
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              {Object.entries(r.statedRequirement).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><dt className="text-xs capitalize text-white/40">Stated {k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
          <p className="text-xs text-white/40">
            {latest.droppedClaims > 0 && <span className="text-amber-300">{latest.droppedClaims} AI claim(s) removed because they were not in the evidence. · </span>}
            {r.instructionsDetected && <span className="text-amber-300">⚠ The evidence contains text aimed at AI — it was treated as data only. · </span>}
            {r.language && <>Language: {r.language} · </>}
            {latest.model} · {formatDateTime(latest.createdAt)}
          </p>
        </div>
      )}
    </Card>
  );
}
