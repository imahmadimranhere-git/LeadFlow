import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, PageHeader, DataTable, Badge, Button, Field, SelectField, Modal, DropdownMenu, Icon,
  Alert, Pager, EmptyState, ErrorState, LoadingState,
} from '../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { ROLE_LABELS, assignableRoles, canInvite } from '../../utils/roles.js';
import { formatDate } from '../../utils/platform.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const RANK = { TENANT_OWNER: 5, ADMIN: 4, MANAGER: 3, SALES: 2, VIEWER: 1 };
const canManage = (actor, target) => actor.id !== target.id && RANK[actor.role] > RANK[target.role];

function InviteModal({ open, onClose, actorRole }) {
  const queryClient = useQueryClient();
  const roles = assignableRoles(actorRole);
  const [form, setForm] = useState({ email: '', role: roles[roles.length - 1] || 'VIEWER' });
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: async (body) => (await api.post('/invitations', body)).data.data,
    onSuccess: (data) => {
      setLink(data.inviteUrl);
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });

  const close = () => {
    setForm((f) => ({ ...f, email: '' }));
    setLink('');
    setCopied(false);
    create.reset();
    onClose();
  };

  const fieldErrors = apiFieldErrors(create.error);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite a team member"
      footer={
        link ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate(form)}>Create invite link</Button>
          </>
        )
      }
    >
      {link ? (
        <div className="space-y-3">
          <Alert type="success">Invitation created for {form.email}. It works once and expires in 7 days.</Alert>
          <p className="break-all rounded-lg bg-ink-900 p-3 font-mono text-xs text-white/80">{link}</p>
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </Button>
          <p className="text-xs text-white/40">Email sending arrives in Phase 19 — for now, share this link yourself.</p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} noValidate>
          {create.isError && !fieldErrors.email && <Alert>{apiErrorMessage(create.error)}</Alert>}
          <Field label="Email" name="inviteEmail" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} error={fieldErrors.email} />
          <SelectField label="Role" name="inviteRole" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        </form>
      )}
    </Modal>
  );
}

function RoleModal({ target, actorRole, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState(target?.role);
  const m = useMutation({
    mutationFn: () => api.patch(`/users/${target.id}/role`, { role }),
    onSuccess: () => {
      toast.success(`${target.name} is now ${ROLE_LABELS[role]}`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  if (!target) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Change role — ${target.name}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={role === target.role} onClick={() => m.mutate()}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        {m.isError && <Alert>{apiErrorMessage(m.error)}</Alert>}
        <SelectField label="Role" name="newRole" value={role} onChange={(e) => setRole(e.target.value)} options={assignableRoles(actorRole).map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
      </div>
    </Modal>
  );
}

function StatusModal({ target, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const disabling = target?.status === 'ACTIVE';
  const m = useMutation({
    mutationFn: () => api.patch(`/users/${target.id}/status`, { status: disabling ? 'DISABLED' : 'ACTIVE' }),
    onSuccess: () => {
      toast.success(disabling ? `${target.name} has been disabled` : `${target.name} is active again`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  if (!target) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={disabling ? 'Disable user?' : 'Enable user?'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={disabling ? 'danger' : 'primary'} loading={m.isPending} onClick={() => m.mutate()}>
            {disabling ? 'Disable' : 'Enable'}
          </Button>
        </>
      }
    >
      {m.isError && <Alert>{apiErrorMessage(m.error)}</Alert>}
      <p className="text-sm text-white/70">
        {disabling
          ? `${target.name} will be logged out on all devices immediately and won't be able to log in.`
          : `${target.name} will be able to log in again.`}
      </p>
    </Modal>
  );
}

function PendingInvites() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['invitations'], queryFn: async () => (await api.get('/invitations')).data.data.items });
  const revoke = useMutation({
    mutationFn: (id) => api.delete(`/invitations/${id}`),
    onSuccess: () => {
      toast.success('Invitation revoked');
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (q.isLoading) return <LoadingState rows={2} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  if (q.data.length === 0) return <EmptyState icon="send" title="No pending invitations" />;

  return (
    <ul className="divide-y divide-white/5">
      {q.data.map((inv) => (
        <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <span className="min-w-0 break-all">
            {inv.email} <span className="text-white/40">· {ROLE_LABELS[inv.role]} · expires {formatDate(inv.expiresAt)}</span>
          </span>
          <Button variant="danger" className="px-3 py-1.5" loading={revoke.isPending && revoke.variables === inv.id} onClick={() => revoke.mutate(inv.id)}>
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}

export default function TeamPage() {
  useDocumentTitle('Team');
  const { user: me, can } = useAuth();
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);

  const q = useQuery({
    queryKey: ['users', page],
    queryFn: async () => (await api.get('/users', { params: { page, limit: 20, sort: 'createdAt' } })).data.data,
    placeholderData: keepPreviousData,
  });

  const manage = can('users:manage');
  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (u) => (
        <div className="min-w-0">
          <p className="font-medium">{u.name}{u.id === me.id && <span className="ml-2 text-xs text-white/40">(you)</span>}</p>
          <p className="truncate text-xs text-white/50">{u.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => ROLE_LABELS[u.role] },
    { key: 'status', header: 'Status', render: (u) => <Badge color={u.status === 'ACTIVE' ? 'green' : 'red'}>{u.status}</Badge> },
    { key: 'lastLoginAt', header: 'Last login', render: (u) => <span className="text-white/60">{formatDate(u.lastLoginAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12 text-right',
      render: (u) =>
        manage && canManage(me, u) ? (
          <DropdownMenu
            label={`Actions for ${u.name}`}
            trigger={<Icon name="list" className="h-4 w-4" />}
            items={[
              { label: 'Change role', onSelect: () => setRoleTarget(u) },
              { label: u.status === 'ACTIVE' ? 'Disable user' : 'Enable user', danger: u.status === 'ACTIVE', onSelect: () => setStatusTarget(u) },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Team"
        description="People who can access your workspace."
        actions={canInvite(me.role) && <Button onClick={() => setInviteOpen(true)}><Icon name="plus" className="h-4 w-4" /> Invite</Button>}
      />
      <div className="space-y-6">
        <Card>
          {q.isError ? (
            <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />
          ) : (
            <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} empty={<EmptyState icon="users" title="No team members" />} />
          )}
          <Pager pagination={q.data?.pagination} onPage={setPage} />
        </Card>
        {canInvite(me.role) && (
          <Card title="Pending invitations">
            <PendingInvites />
          </Card>
        )}
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} actorRole={me.role} />
      {roleTarget && <RoleModal target={roleTarget} actorRole={me.role} onClose={() => setRoleTarget(null)} />}
      {statusTarget && <StatusModal target={statusTarget} onClose={() => setStatusTarget(null)} />}
    </>
  );
}
