// "Forgot password?" — always shows the same message (we never say whether an email is registered).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api.js';
import { AuthShell, Field, Button, Alert } from '../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../utils/apiErrors.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim() });
      setDone(data.data.message);
    } catch (err) {
      setError(apiErrorMessage(err));
      setFieldErrors(apiFieldErrors(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthShell title="Forgot your password?" subtitle="We'll email you a link to choose a new one" footer={<Link className="text-brand-500 hover:underline" to="/login">Back to log in</Link>}>
      {done ? (
        <div className="space-y-3">
          <Alert type="success">{done}</Alert>
          <p className="text-sm text-white/60">The link works once, for 30 minutes. Nothing arrived after a few minutes? Check spam, or ask your company owner to check your email address.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Alert>{error}</Alert>
          <Field label="Email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} required />
          <Button type="submit" loading={loading} className="w-full" disabled={!email.trim()}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
