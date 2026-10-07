import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, PageHeader, EmptyState, Icon, StatCard } from '../../components/ui.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

function ChecklistItem({ done, title, description, to, phase }) {
  return (
    <li className="flex gap-3 py-3">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${done ? 'bg-brand-500 text-white' : 'bg-white/5 text-white/30 ring-1 ring-white/10'}`}>
        {done ? <Icon name="checkCircle" className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${done ? 'text-white/50 line-through' : ''}`}>{title}</p>
        <p className="text-xs text-white/40">{description}</p>
      </div>
      {!done && to && (
        <Link to={to} className="self-center whitespace-nowrap text-xs text-brand-500 hover:underline">
          {phase ? `Phase ${phase}` : 'Open'} →
        </Link>
      )}
    </li>
  );
}

export default function DashboardPage() {
  useDocumentTitle('Dashboard');
  const { user, tenant, can } = useAuth();

  // Only users who may see the team load the team size
  const team = useQuery({
    queryKey: ['users', 'count'],
    queryFn: async () => (await api.get('/users', { params: { limit: 1 } })).data.data.pagination.total,
    enabled: can('users:read'),
  });

  const firstName = user.name.trim().split(/\s+/)[0];

  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} description={`Here's what's happening at ${tenant.name}.`} />

      {/* Numbers stay empty until the modules that produce them exist — no fake data */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total leads" value="—" hint="Lead management arrives in Phase 9" />
        <StatCard label="Qualified leads" value="—" hint="AI scoring arrives in Phase 14" />
        <StatCard label="Follow-ups due" value="—" hint="Follow-ups arrive in Phase 19" />
        <StatCard label="Team members" value={can('users:read') ? team.data ?? '…' : '—'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title="Getting started">
            <ul className="divide-y divide-white/5">
              <ChecklistItem done title="Create your workspace" description="Your company account is ready." />
              {can('users:invite') && (
                <ChecklistItem
                  done={(team.data ?? 0) > 1}
                  title="Invite your team"
                  description="Add sales people, managers or viewers."
                  to="/app/settings/team"
                />
              )}
              <ChecklistItem title="Set up your company & industry" description="Services, ideal customers, keywords and hashtags." to="/app/settings/company" phase={7} />
              <ChecklistItem title="Connect your tools" description="Add your own API keys securely." to="/app/settings/integrations" phase={8} />
              <ChecklistItem title="Add your first leads" description="Manually, by CSV, or from discovery." to="/app/leads" phase={9} />
            </ul>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card title="Recent leads">
            <EmptyState icon="target" title="No leads yet" description="Once lead management is live, your newest and highest-scoring leads appear here." />
          </Card>
        </div>
      </div>
    </>
  );
}
