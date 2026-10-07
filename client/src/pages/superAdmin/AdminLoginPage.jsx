import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import adminApi from '../../lib/adminApi.js';
import { useAdminAuth } from '../../context/AdminAuthContext.jsx';
import { AuthShell, Field, Button, Alert } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

function QrImage({ text }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 200 }).then(setSrc).catch(() => setSrc(''));
  }, [text]);
  return src ? <img src={src} alt="Scan with your authenticator app" className="mx-auto rounded-lg bg-white p-2" width="200" height="200" /> : null;
}

export default function AdminLoginPage() {
  const { isAuthenticated, signIn } = useAdminAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('PASSWORD'); // PASSWORD → MFA_SETUP | MFA_REQUIRED
  const [form, setForm] = useState({ email: '', password: '', code: '' });
  const [mfa, setMfa] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return <Navigate to="/super-admin" replace />;

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  async function submitPassword(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await adminApi.post('/auth/login', { email: form.email, password: form.password });
      setMfa(data.data);
      setStep(data.data.step);
      setForm((f) => ({ ...f, password: '' })); // don't keep the password in memory
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await adminApi.post('/auth/mfa', { mfaToken: mfa.mfaToken, code: form.code.trim() });
      signIn(data.data);
      navigate('/super-admin', { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
      if (err.response?.data?.message?.includes('expired')) {
        setStep('PASSWORD');
        setMfa(null);
      }
    } finally {
      setLoading(false);
    }
  }

  if (step === 'PASSWORD') {
    return (
      <AuthShell title="Super Admin" subtitle="Platform owner login">
        <form onSubmit={submitPassword} className="space-y-4" noValidate>
          <Alert>{error}</Alert>
          <Field label="Email" name="email" type="email" autoComplete="username" value={form.email} onChange={onChange} />
          <Field label="Password" name="password" type="password" autoComplete="current-password" value={form.password} onChange={onChange} />
          <Button type="submit" loading={loading} className="w-full">Continue</Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={step === 'MFA_SETUP' ? 'Set up two-factor authentication' : 'Two-factor authentication'}
      subtitle={step === 'MFA_SETUP' ? 'Required for the super admin account.' : 'Enter the 6-digit code from your authenticator app.'}
    >
      <form onSubmit={submitCode} className="space-y-4" noValidate>
        {step === 'MFA_SETUP' && (
          <div className="space-y-3 text-sm text-white/70">
            <p>1. Install <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> on your phone.</p>
            <p>2. Scan this QR code (or type the key manually):</p>
            <QrImage text={mfa.otpauthUrl} />
            <p className="break-all rounded-lg bg-ink-900 p-3 text-center font-mono text-xs tracking-wider text-white">{mfa.secret}</p>
            <p>3. Enter the 6-digit code the app shows:</p>
          </div>
        )}
        <Alert>{error}</Alert>
        <Field
          label="6-digit code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, '') }))}
        />
        <Button type="submit" loading={loading} className="w-full">Verify</Button>
      </form>
    </AuthShell>
  );
}
