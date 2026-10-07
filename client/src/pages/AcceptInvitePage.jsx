import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthShell, Field, Button, Alert } from '../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../utils/apiErrors.js';

export default function AcceptInvitePage() {
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [form, setForm] = useState({ name: '', password: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setLoading(true);
    try {
      await acceptInvite({ token, ...form });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
      setFieldErrors(apiFieldErrors(err));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="Invitation link missing" footer={<Link className="text-brand-500 hover:underline" to="/login">Go to login</Link>}>
        <Alert>This link is incomplete. Please ask your team admin for a new invitation.</Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join your team" subtitle="Set your name and password to accept the invitation.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Alert>{error}</Alert>
        <Field label="Your name" name="name" autoComplete="name" value={form.name} onChange={onChange} error={fieldErrors.name} required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={onChange}
          error={fieldErrors.password}
          hint="At least 10 characters, with letters and numbers."
          required
        />
        <Button type="submit" loading={loading} className="w-full">Accept invitation</Button>
      </form>
    </AuthShell>
  );
}
