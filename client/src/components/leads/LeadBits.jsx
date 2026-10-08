import { Badge, Icon } from '../ui.jsx';
import { STATUS_LABEL, STATUS_COLOR, PRIORITY_COLOR, safeHref } from '../../utils/leadOptions.js';

export function StatusBadge({ status }) {
  return <Badge color={STATUS_COLOR[status] || 'gray'}>{STATUS_LABEL[status] || status}</Badge>;
}

export function PriorityBadge({ priority }) {
  return <Badge color={PRIORITY_COLOR[priority] || 'gray'}>{priority?.toLowerCase()}</Badge>;
}

export function ScoreBadge({ score }) {
  if (score === null || score === undefined) return <span className="text-xs text-white/30">—</span>;
  const color = score >= 70 ? 'bg-brand-500/20 text-brand-500' : score >= 40 ? 'bg-amber-500/15 text-amber-300' : 'bg-white/10 text-white/60';
  return <span className={`inline-flex min-w-[2.5rem] justify-center rounded-md px-2 py-0.5 text-xs font-semibold ${color}`}>{score}</span>;
}

export function SafetyFlags({ lead }) {
  return (
    <>
      {lead.doNotContact && <Badge color="red">Do not contact</Badge>}
      {lead.suspectedInjection && (
        <span title="This lead's text looks like an attempt to manipulate AI. It is treated as data only.">
          <Badge color="amber">⚠ Suspicious text</Badge>
        </span>
      )}
    </>
  );
}

/** External link that can only ever be http(s), opens safely in a new tab. */
export function ExternalLink({ href, children, className = '' }) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children || href || '—'}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={`inline-flex items-center gap-1 break-all text-brand-500 hover:underline ${className}`}>
      {children || safe}
      <Icon name="globe" className="h-3 w-3 shrink-0" />
    </a>
  );
}
