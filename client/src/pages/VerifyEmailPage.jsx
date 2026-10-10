// Opened from the email link: /verify-email?token=...  Works logged in or not. Token removed from the URL.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthShell, Alert, Spinner } from '../components/ui.jsx';
import { apiErrorMessage } from '../utils/apiErrors.js';

export default function VerifyEmailPage() {
  const { status, reloadMe } = useAuth();
  const [result, setResult] = useState({ state: 'working' });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // React StrictMode runs effects twice in development; the link works only once
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token') || '';
    window.history.replaceState(null, '', window.location.pathname);
    api.post('/auth/verify-email', { token })
      .then(() => setResult({ state: 'ok' }))
      .catch((err) => setResult({ state: 'error', message: apiErrorMessage(err) }));
  }, []);
  useEffect(() => { if (result.state === 'ok' && status === 'authenticated') reloadMe().catch(() => {}); }, [result.state, status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthShell title="Email confirmation" footer={<Link className="text-brand-500 hover:underline" to={status === 'authenticated' ? '/app' : '/login'}>{status === 'authenticated' ? 'Go to the app' : 'Log in'}</Link>}>
      {result.state === 'working' && <div className="flex justify-center py-6"><Spinner /></div>}
      {result.state === 'ok' && <Alert type="success">Thank you — your email address is confirmed.</Alert>}
      {result.state === 'error' && <Alert>{result.message} You can send a new link from My account.</Alert>}
    </AuthShell>
  );
}
