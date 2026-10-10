import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthShell, Field, Button, Alert } from '../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../utils/apiErrors.js';

export default function LoginPage() {
  const { login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [mfa, setMfa] = useState(null); // { mfaToken } after a correct password when two-step login is on
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const goOn = (recoveryCodesLeft) => {
    // only redirect to internal paths (prevents open-redirect tricks)
    const from = location.state?.from;
    const target = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/app';
    navigate(target, { replace: true, state: recoveryCodesLeft !== undefined ? { recoveryCodesLeft } : undefined });
  };

  async function run(fn) {
    setError('');
    setFieldErrors({});
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError(apiErrorMessage(err));
      setFieldErrors(apiFieldErrors(err));
      if (err.response?.status === 401 && mfa && /expired/i.test(apiErrorMessage(err))) setMfa(null); // ticket expired → password again
    } finally {
      setLoading(false);
    }
  }

  const onPassword = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await login(form);
      if (r.mfaRequired) {
        setMfa({ mfaToken: r.mfaToken });
        setForm((f) => ({ ...f, password: '' })); // don't keep the password in memory longer than needed
      } else goOn();
    });
  };
  const onCode = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await loginMfa({ mfaToken: mfa.mfaToken, ...(useRecovery ? { recoveryCode: code.trim() } : { code: code.trim() }) });
      goOn(r.recoveryCodesLeft);
    });
  };

  if (mfa) {
    return (
      <AuthShell title="Two-step login" subtitle={useRecovery ? 'Enter one of your recovery codes' : 'Enter the 6-digit code from your authenticator app'}>
        <form onSubmit={onCode} className="space-y-4" noValidate>
          <Alert>{error}</Alert>
          {useRecovery ? (
            <Field label="Recovery code" name="recoveryCode" autoComplete="off" placeholder="xxxxx-xxxxx" value={code} onChange={(e) => setCode(e.target.value)} error={fieldErrors.recoveryCode || fieldErrors.code} required />
          ) : (
            <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={fieldErrors.code} required autoFocus />
          )}
          <Button type="submit" loading={loading} className="w-full" disabled={useRecovery ? code.trim().length < 10 : code.length !== 6}>Verify</Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-brand-500 hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(''); }}>{useRecovery ? 'Use the app code' : 'Lost your phone? Use a recovery code'}</button>
            <button type="button" className="text-white/50 hover:underline" onClick={() => { setMfa(null); setCode(''); setError(''); }}>Back</button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your workspace"
      footer={<>New here? <Link className="text-brand-500 hover:underline" to="/register">Create an account</Link></>}
    >
      <form onSubmit={onPassword} className="space-y-4" noValidate>
        <Alert>{error}</Alert>
        <Field label="Email" name="email" type="email" autoComplete="email" value={form.email} onChange={onChange} error={fieldErrors.email} required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" value={form.password} onChange={onChange} error={fieldErrors.password} required />
        <div className="text-right text-sm"><Link className="text-brand-500 hover:underline" to="/forgot-password">Forgot password?</Link></div>
        <Button type="submit" loading={loading} className="w-full">Log in</Button>
      </form>
    </AuthShell>
  );
}
