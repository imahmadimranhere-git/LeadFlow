import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../../lib/adminApi.js';
import { useAdminAuth } from '../../context/AdminAuthContext.jsx';
import { Card, PageHeader, Field, Button, Alert } from '../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

export default function AdminAccountPage() {
  useDocumentTitle('Admin account');
  const { admin, signOut } = useAdminAuth();
  const navigate = useNavigate();
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
      await adminApi.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      // The server invalidated every admin session (including this one) → log in again with the new password
      signOut();
      navigate('/super-admin/login', { replace: true });
    } catch (err) {
      setMessage(apiErrorMessage(err));
      setErrors(apiFieldErrors(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader title="My account" description="Super admin profile and password." />
      <div className="space-y-6">
        <Card title="Profile">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-white/50">Email</dt><dd className="mt-1 break-all">{admin.email}</dd></div>
            <div><dt className="text-white/50">Two-factor</dt><dd className="mt-1 text-brand-500">{admin.mfaEnabled ? 'Enabled' : 'Not enabled'}</dd></div>
            <div><dt className="text-white/50">Last login</dt><dd className="mt-1">{formatDateTime(admin.lastLoginAt)}</dd></div>
          </dl>
        </Card>
        <Card title="Change password">
          <form onSubmit={onSubmit} className="max-w-md space-y-4" noValidate>
            <Alert>{message}</Alert>
            <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" value={form.currentPassword} onChange={onChange} error={errors.currentPassword} />
            <Field label="New password" name="newPassword" type="password" autoComplete="new-password" value={form.newPassword} onChange={onChange} error={errors.newPassword} hint="At least 10 characters, with letters and numbers." />
            <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={onChange} error={errors.confirm} />
            <p className="text-xs text-white/40">After changing, you will be logged out and must log in again (with your authenticator code).</p>
            <Button type="submit" loading={loading}>Change password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
