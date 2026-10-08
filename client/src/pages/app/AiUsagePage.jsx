// Company AI usage: today / this month + the latest requests (metadata only — never the texts).
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { PageHeader, Card, StatCard, Badge, Pager, LoadingState, ErrorState, EmptyState } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const STATUS_COLOR = { SUCCESS: 'green', FAILED: 'red', INVALID_OUTPUT: 'amber' };
const usd = (n) => `$${Number(n || 0).toFixed(4)}`;
const num = (n) => Number(n || 0).toLocaleString();

export default function AiUsagePage() {
  useDocumentTitle('AI usage');
  const [page, setPage] = useState(1);
  const summary = useQuery({ queryKey: ['ai', 'usage', 'summary'], queryFn: async () => (await api.get('/ai/usage/summary')).data.data });
  const list = useQuery({ queryKey: ['ai', 'usage', page], queryFn: async () => (await api.get('/ai/usage', { params: { page, limit: 25 } })).data.data, placeholderData: keepPreviousData });

  if (summary.isLoading) return <LoadingState rows={4} />;
  if (summary.isError) return <ErrorState message={apiErrorMessage(summary.error)} onRetry={summary.refetch} />;
  const { today, month } = summary.data;

  return (
    <>
      <PageHeader title="AI usage" description="Estimated from the platform's price list. Your AI provider's bill is the real cost." />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Requests today" value={num(today.requests)} hint={today.failed ? `${today.failed} failed` : undefined} />
          <StatCard label="Cost today (est.)" value={usd(today.costUsd)} />
          <StatCard label="Requests this month" value={num(month.requests)} hint={`${num(month.inputTokens)} in / ${num(month.outputTokens)} out tokens`} />
          <StatCard label="Cost this month (est.)" value={usd(month.costUsd)} />
        </div>
        <Card title="Latest AI requests">
          {list.isLoading && <LoadingState rows={4} />}
          {list.data?.items.length === 0 && <EmptyState icon="cpu" title="No AI requests yet" />}
          {list.data?.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-white/40">
                  <tr><th className="py-2 pr-4">When</th><th className="pr-4">Type</th><th className="pr-4">Model</th><th className="pr-4">Key</th><th className="pr-4">Tokens</th><th className="pr-4">Cost</th><th className="pr-4">Status</th><th>User</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {list.data.items.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 pr-4 text-xs text-white/60">{formatDateTime(l.createdAt)}</td>
                      <td className="pr-4">{l.requestType.toLowerCase().replace(/_/g, ' ')}</td>
                      <td className="pr-4 font-mono text-xs">{l.model}</td>
                      <td className="pr-4 text-xs">{l.keySource === 'TENANT' ? 'yours' : 'platform'}</td>
                      <td className="pr-4">{num(l.totalTokens)}</td>
                      <td className="pr-4">{usd(l.estimatedCostUsd)}</td>
                      <td className="pr-4"><Badge color={STATUS_COLOR[l.status]}>{l.status.toLowerCase().replace('_', ' ')}</Badge>{l.attempts > 1 && <span className="ml-1 text-xs text-white/40">×{l.attempts}</span>}</td>
                      <td className="text-xs text-white/60">{l.userId?.name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager pagination={list.data?.pagination} onPage={setPage} />
        </Card>
      </div>
    </>
  );
}
