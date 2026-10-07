// Phase 3 dashboard: proves login + roles work. Phase 5 replaces this with the real app layout.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Logo, Card, Button, Field, Alert, Spinner } from '../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../utils/apiErrors.js';
import { ROLE_LABELS, assignableRoles, canInvite, canSeeTeam } from '../utils/roles.js';

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function TeamList() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users', { params: { limit: 50, sort: 'createdAt' } })).data.data,
  });

  if (isLoading) return <Spinner />;
  if (isError) return <Alert>{apiErrorMessage(error)}</Alert>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-white/50">
          <tr>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">Role</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {data.items.map((u) => (
            <tr key={u.id}>
              <td className="py-2.5 pr-4">{u.name}</td>
              <td className="py-2.5 pr-4 text-white/70">{u.email}</td>
              <td className="py-2.5 pr-4">{ROLE_LABELS[u.role]}</td>
              <td className="py-2.5">
                <span className={u.status === 'ACTIVE' ? 'text-brand-500' : 'text-red-400'}>{u.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvitePanel({ actorRole }) {
  const queryClient = useQueryClient();
  const roles = assignableRoles(actorRole);
  const [form, setForm] = useState({ email: '', role: roles[roles.length - 1] || 'VIEWER' });
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  const pending = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await api.get('/invitations')).data.data.items,
  });

  const create = useMutation({
    mutationFn: async (body) => (await api.post('/invitations', body)).data.data,
    onSuccess: (data) => {
      setLink(data.inviteUrl);
      setCopied(false);
      setForm((f) => ({ ...f, email: '' }));
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id) => api.delete(`/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });

  const fieldErrors = apiFieldErrors(create.error);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-5">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setLink('');
          create.mutate(form);
        }}
        noValidate
      >
        <Field label="Email" name="email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} error={fieldErrors.email} />
        <div className="space-y-1.5">
          <label htmlFor="role" className="block text-sm font-medium text-white/80">Role</label>
          <select
            id="role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            className="w-full rounded-lg bg-ink-900 px-3 py-2.5 text-white ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500 outline-none"
          >
            {roles.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <Button type="submit" loading={create.isPending}>Invite</Button>
      </form>

      {create.isError && !fieldErrors.email && <Alert>{apiErrorMessage(create.error)}</Alert>}

      {link && (
        <Alert type="success">
          <p className="font-medium">Invitation created. Share this link with the person (valid 7 days, one-time use):</p>
          <p className="mt-2 break-all font-mono text-xs text-white/80">{link}</p>
          <Button type="button" variant="ghost" className="mt-3" onClick={copyLink}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
        </Alert>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium text-white/60">Pending invitations</h3>
        {pending.isLoading && <Spinner />}
        {pending.data?.length === 0 && <p className="text-sm text-white/40">No pending invitations.</p>}
        <ul className="divide-y divide-white/5">
          {pending.data?.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span>
                {inv.email} <span className="text-white/50">· {ROLE_LABELS[inv.role]} · expires {formatDate(inv.expiresAt)}</span>
              </span>
              <Button variant="danger" className="px-3 py-1.5" loading={revoke.isPending && revoke.variables === inv.id} onClick={() => revoke.mutate(inv.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, tenant, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <div className="min-h-screen bg-ink-900 text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Logo />
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-white/60 sm:inline">{user.name} · {ROLE_LABELS[user.role]}</span>
            <Button
              variant="ghost"
              loading={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                await logout();
              }}
            >
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {user.name} 👋</h1>
          <p className="mt-1 text-white/60">{tenant.name}</p>
        </div>

        <Card title="Your account">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-white/50">Email</dt><dd className="mt-1 break-all">{user.email}</dd></div>
            <div><dt className="text-white/50">Role</dt><dd className="mt-1">{ROLE_LABELS[user.role]}</dd></div>
            <div><dt className="text-white/50">Plan status</dt><dd className="mt-1">{tenant.status}</dd></div>
            <div><dt className="text-white/50">Trial ends</dt><dd className="mt-1">{formatDate(tenant.trialEndsAt)}</dd></div>
          </dl>
        </Card>

        {canSeeTeam(user.role) && (
          <Card title="Team">
            <TeamList />
          </Card>
        )}

        {canInvite(user.role) && (
          <Card title="Invite a team member">
            <InvitePanel actorRole={user.role} />
          </Card>
        )}
      </main>
    </div>
  );
}
