// Opened from the email link: /reset-password?token=...  The token is removed from the address bar
// straight away (so it doesn't stay in browser history or leak to other sites).
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api.js';
import { AuthShell, Field, Button, Alert } from '../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../utils/apiErrors.js';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [form, setForm] = useState({ newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [done, setDone] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { window.history.replaceState(null, '', window.location.pathname); }, []);
  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    if (form.newPassword !== form.confirm) return setFieldErrors({ confirm: 'Passwords do not match' });
    setLoading(true);
    try {
      const { data } = await api.post('/auth/reset-password', { token, newPassword: form.newPassword });
      setDone(data.data);
    } catch (err) {
      setError(apiErrorMessage(err));
      setFieldErrors(apiFieldErrors(err));
    } finally {
      setLoading(false);
    }
    return undefined;
  }
  if (!token) return <AuthShell title="Link not valid" subtitle="Open the link from the email again, or ask for a new one" footer={<Link className="text-brand-500 hover:underline" to="/forgot-password">Ask for a new link</Link>}><span /></AuthShell>;
  return (
    <AuthShell title="Choose a new password" subtitle="All your devices will be logged out" footer={<Link className="text-brand-500 hover:underline" to="/login">Back to log in</Link>}>
      {done ? (
        <div className="space-y-4">
          <Alert type="success">Password changed. Every device was logged out.{done.mfaStillRequired ? ' You will still need your two-step login code.' : ''}</Alert>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>Log in</Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Alert>{error}</Alert>
          {fieldErrors.token && <Alert>{fieldErrors.token}</Alert>}
          <Field label="New password" name="newPassword" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} error={fieldErrors.newPassword} hint="At least 10 characters, with letters and numbers." required />
          <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={fieldErrors.confirm} required />
          <Button type="submit" loading={loading} className="w-full">Save new password</Button>
          {error && <p className="text-center text-sm"><Link className="text-brand-500 hover:underline" to="/forgot-password">Ask for a new link</Link></p>}
        </form>
      )}
    </AuthShell>
  );
}
