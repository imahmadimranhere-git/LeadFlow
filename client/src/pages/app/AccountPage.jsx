import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Card, PageHeader, Field, Button, Alert, Modal } from '../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { ROLE_LABELS } from '../../utils/roles.js';
import { formatDate } from '../../utils/platform.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { EmailCard, TwoStepCard, SessionsCard } from '../../components/account/SecuritySettings.jsx';

function ChangePasswordForm() {
  const { changePassword } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setMessage('');
    setErrors({});
    if (form.newPassword !== form.confirm) {
      setErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setLoading(true);
    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed. Other devices have been logged out.');
    } catch (err) {
      setMessage(apiErrorMessage(err));
      setErrors(apiFieldErrors(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4" noValidate>
      <Alert>{message}</Alert>
      <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" value={form.currentPassword} onChange={onChange} error={errors.currentPassword} />
      <Field label="New password" name="newPassword" type="password" autoComplete="new-password" value={form.newPassword} onChange={onChange} error={errors.newPassword} hint="At least 10 characters, with letters and numbers." />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={onChange} error={errors.confirm} />
      <Button type="submit" loading={loading}>Change password</Button>
    </form>
  );
}

export default function AccountPage() {
  useDocumentTitle('My account');
  const { user, tenant, logoutAll } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <PageHeader title="My account" description="Your profile and security settings." />
      <div className="space-y-6">
        <Card title="Profile">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-white/50">Name</dt><dd className="mt-1">{user.name}</dd></div>
            <div><dt className="text-white/50">Email</dt><dd className="mt-1 break-all">{user.email}</dd></div>
            <div><dt className="text-white/50">Role</dt><dd className="mt-1">{ROLE_LABELS[user.role]}</dd></div>
            <div><dt className="text-white/50">Company</dt><dd className="mt-1">{tenant.name}</dd></div>
            <div><dt className="text-white/50">Member since</dt><dd className="mt-1">{formatDate(user.createdAt)}</dd></div>
            <div><dt className="text-white/50">Last login</dt><dd className="mt-1">{formatDate(user.lastLoginAt)}</dd></div>
          </dl>
        </Card>

        <Card title="Change password">
          <ChangePasswordForm />
        </Card>

        <EmailCard />
        <TwoStepCard />
        <SessionsCard onLogoutAll={() => setConfirmOpen(true)} />
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Log out of all devices?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await logoutAll();
              }}
            >
              Log out everywhere
            </Button>
          </>
        }
      >
        <p className="text-sm text-white/70">You will need to log in again on every device, including this one.</p>
      </Modal>
    </>
  );
}
