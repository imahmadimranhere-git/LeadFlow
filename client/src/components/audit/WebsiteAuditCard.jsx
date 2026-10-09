// Lead page: check the lead's public website. Shows only what was really observed.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Card, Button, Badge, Alert } from '../ui.jsx';
import { ExternalLink } from '../leads/LeadBits.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const SEV = { FAIL: ['red', 'problem'], WARN: ['amber', 'suggestion'] };

export function AuditResult({ audit: a }) {
  if (a.status === 'BLOCKED_BY_ROBOTS' || a.status === 'FAILED') {
    return <Alert type="info">{a.status === 'FAILED' ? `Could not check the website: ${a.error}` : a.summary}</Alert>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-md px-2 py-0.5 text-lg font-semibold ${a.score >= 80 ? 'bg-brand-500/20 text-brand-500' : a.score >= 50 ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>{a.score}/100</span>
        <p className="text-sm">{a.summary}</p>
      </div>
      {a.issues?.length > 0 && (
        <ul className="space-y-2">
          {a.issues.map((i) => (
            <li key={i.id} className="rounded-lg bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/10">
              <Badge color={SEV[i.severity]?.[0]}>{SEV[i.severity]?.[1]}</Badge> <span className="font-medium">{i.title}</span> — {i.detail}
              {i.evidence && <p className="mt-1 break-all text-xs text-white/45">Observed: {i.evidence}</p>}
            </li>
          ))}
        </ul>
      )}
      {a.goodPoints?.length > 0 && <p className="text-xs text-white/55"><span className="text-brand-500">✓ Good:</span> {a.goodPoints.join(' · ')}</p>}
      {a.recommendations?.length > 0 && (
        <details className="text-sm text-white/70">
          <summary className="cursor-pointer text-white/55">Recommended improvements ({a.recommendations.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{a.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
      {a.potentialServices?.length > 0 && <p className="text-xs text-white/55">Your services that could help: {a.potentialServices.join(', ')}</p>}
      <p className="text-xs text-white/35">
        Checked {a.finalUrl && <ExternalLink href={a.finalUrl} className="text-xs" />} · {formatDateTime(a.createdAt)} · homepage only, {a.requests} request(s). Speed is one measurement from our server, not a full speed test.
      </p>
    </div>
  );
}

export default function WebsiteAuditCard({ lead, canWrite }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['audits', 'lead', lead.id];
  const q = useQuery({ queryKey: key, queryFn: async () => (await api.get(`/leads/${lead.id}/website-audits`)).data.data.items });
  const run = useMutation({
    mutationFn: async () => (await api.post(`/leads/${lead.id}/website-audit`)).data.data.audit,
    onSuccess: (a) => {
      if (a.status === 'COMPLETED') toast.success('Website checked');
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['leads', 'detail', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['leads', 'score', lead.id] });
    },
  });
  const latest = q.data?.[0];
  return (
    <Card title="Website check" action={canWrite && lead.website && <Button variant={latest ? 'ghost' : 'primary'} className="px-3 py-1.5" loading={run.isPending} onClick={() => run.mutate()}>{latest ? 'Check again' : 'Check website'}</Button>}>
      {run.isError && <div className="mb-3"><Alert>{apiErrorMessage(run.error)}</Alert></div>}
      {!lead.website && <p className="text-sm text-white/45">Add the lead's website to check it.</p>}
      {lead.website && !latest && !run.isPending && <p className="text-sm text-white/45">We check the public homepage safely (HTTPS, mobile, SEO basics, contact, speed, broken links). Only problems we really see are reported — a good site is called good.</p>}
      {run.isPending && <p className="text-sm text-white/45">Checking… (up to ~25 seconds)</p>}
      {latest && <AuditResult audit={latest} />}
    </Card>
  );
}
