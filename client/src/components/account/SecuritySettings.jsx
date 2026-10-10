// My account → security (Phase 27): email confirmation, two-step login (TOTP + recovery codes),
// and every logged-in device with "log out".
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../Toast.jsx';
import { Card, Button, Field, Alert, Badge, Modal, LoadingState, ErrorState } from '../ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const group4 = (s) => String(s).replace(/(.{4})/g, '$1 ').trim();

/** QR code drawn in the browser (the secret never goes to another website). */
function Qr({ text }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 200 }).then(setSrc).catch(() => setSrc(''));
  }, [text]);
  return src ? <img src={src} alt="QR code for your authenticator app" width={200} height={200} className="mx-auto rounded-lg bg-white p-2" /> : null;
}

function RecoveryCodes({ codes }) {
  const toast = useToast();
  const text = `LeadFlow recovery codes (each works ONCE)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leadflow-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return (
    <div className="space-y-3">
      <Alert type="info">Save these codes somewhere safe (password manager or printed). If you lose your phone, each code lets you log in ONCE. They will not be shown again.</Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-ink-900 p-3 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => {})}>Copy</Button>
        <Button variant="ghost" onClick={download}>Download .txt</Button>
      </div>
    </div>
  );
}

function SetupModal({ onClose }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState('password'); // password → scan → codes
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState(null);
  const [codes, setCodes] = useState(null);
  const start = useMutation({ mutationFn: async () => (await api.post('/auth/mfa/setup', { password })).data.data, onSuccess: (d) => { setSecret(d); setPassword(''); setStep('scan'); } });
  const enable = useMutation({ mutationFn: async () => (await api.post('/auth/mfa/enable', { code })).data.data, onSuccess: (d) => { setCodes(d.recoveryCodes); setStep('codes'); queryClient.invalidateQueries({ queryKey: ['auth', 'security'] }); } });
  const err = start.error || enable.error;
  const fe = apiFieldErrors(err);
  return (
    <Modal open onClose={step === 'codes' ? onClose : onClose} size="md" title="Turn on two-step login"
      footer={step === 'password' ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={start.isPending} disabled={!password} onClick={() => start.mutate()}>Continue</Button></>
        : step === 'scan' ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={enable.isPending} disabled={code.length !== 6} onClick={() => enable.mutate()}>Turn on</Button></>
          : <Button onClick={onClose}>I saved my codes</Button>}>
      <div className="space-y-4">
        {err && !Object.keys(fe).length && <Alert>{apiErrorMessage(err)}</Alert>}
        {step === 'password' && <Field label="Your password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fe.password} />}
        {step === 'scan' && secret && (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-white/75">
              <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
              <li>In the app tap <b>Add account → Scan a QR code</b>:
                <div className="mt-2"><Qr text={secret.otpauthUrl} /></div>
              </li>
              <li>Can't scan? Choose <b>Enter a setup key</b> and type this key (time-based):
                <p className="mt-2 select-all rounded-lg bg-ink-900 p-3 text-center font-mono text-base tracking-wider">{group4(secret.secret)}</p>
                <p className="mt-1 text-xs text-white/45">On this phone? <a className="underline" href={secret.otpauthUrl}>Open in authenticator app</a></p>
              </li>
              <li>Type the 6-digit code the app shows:</li>
            </ol>
            <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={fe.code} />
          </>
        )}
        {step === 'codes' && codes && <RecoveryCodes codes={codes} />}
      </div>
    </Modal>
  );
}

function ConfirmModal({ title, action, onClose, onDone, allowRecovery }) {
  const [f, setF] = useState({ password: '', code: '', recoveryCode: '' });
  const [useRecovery, setUseRecovery] = useState(false);
  const m = useMutation({ mutationFn: async () => (await api.post(action, { password: f.password, ...(useRecovery ? { recoveryCode: f.recoveryCode } : { code: f.code }) })).data.data, onSuccess: onDone });
  const fe = apiFieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="sm" title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!f.password || (useRecovery ? f.recoveryCode.length < 10 : f.code.length !== 6)} onClick={() => m.mutate()}>Confirm</Button></>}>
      <div className="space-y-3">
        {m.isError && <Alert>{fe.code || apiErrorMessage(m.error)}</Alert>}
        <Field label="Your password" name="password" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {useRecovery
          ? <Field label="Recovery code" name="recoveryCode" value={f.recoveryCode} onChange={(e) => setF({ ...f, recoveryCode: e.target.value })} />
          : <Field label="Code from your app" name="code" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} />}
        {allowRecovery && <button type="button" className="text-xs text-brand-500 underline" onClick={() => setUseRecovery(!useRecovery)}>{useRecovery ? 'Use the app code' : 'Use a recovery code instead'}</button>}
      </div>
    </Modal>
  );
}

function TwoStepCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState(null); // setup | disable | codes
  const [newCodes, setNewCodes] = useState(null);
  const s = useQuery({ queryKey: ['auth', 'security'], queryFn: async () => (await api.get('/auth/security')).data.data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['auth', 'security'] });
  if (s.isLoading) return <Card title="Two-step login"><LoadingState rows={2} /></Card>;
  if (s.isError) return <Card title="Two-step login"><ErrorState message={apiErrorMessage(s.error)} onRetry={s.refetch} /></Card>;
  const d = s.data;
  return (
    <Card title="Two-step login (recommended for owners & admins)">
      <div className="space-y-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          {d.mfaEnabled ? <Badge color="green">On</Badge> : <Badge color="amber">Off</Badge>}
          <span className="text-white/65">{d.mfaEnabled ? `Since ${formatDateTime(d.mfaEnabledAt)} · ${d.recoveryCodesLeft} recovery codes left` : 'With it, a stolen password alone is not enough to get into your account.'}</span>
        </p>
        {d.mfaEnabled && d.recoveryCodesLeft <= 3 && <Alert>Only {d.recoveryCodesLeft} recovery codes left — make new ones.</Alert>}
        <div className="flex flex-wrap gap-2">
          {!d.mfaEnabled && <Button onClick={() => setModal('setup')}>Turn on</Button>}
          {d.mfaEnabled && <Button variant="ghost" onClick={() => setModal('codes')}>New recovery codes</Button>}
          {d.mfaEnabled && <Button variant="danger" onClick={() => setModal('disable')}>Turn off</Button>}
        </div>
      </div>
      {modal === 'setup' && <SetupModal onClose={() => { setModal(null); refresh(); }} />}
      {modal === 'disable' && <ConfirmModal title="Turn off two-step login" action="/auth/mfa/disable" allowRecovery onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); toast.success('Two-step login is off'); }} />}
      {modal === 'codes' && <ConfirmModal title="Make new recovery codes" action="/auth/mfa/recovery-codes" onClose={() => setModal(null)} onDone={(r) => { setModal(null); setNewCodes(r.recoveryCodes); refresh(); }} />}
      {newCodes && <Modal open onClose={() => setNewCodes(null)} title="Your new recovery codes" footer={<Button onClick={() => setNewCodes(null)}>I saved my codes</Button>}><RecoveryCodes codes={newCodes} /><p className="mt-3 text-xs text-white/45">The old codes no longer work.</p></Modal>}
    </Card>
  );
}

function EmailCard() {
  const { user } = useAuth();
  const toast = useToast();
  const resend = useMutation({
    mutationFn: async () => (await api.post('/auth/resend-verification')).data.data,
    onSuccess: (d) => (d.alreadyVerified ? toast.success('Already confirmed') : d.sent ? toast.success(`Link sent to ${user.email}`) : toast.error(d.reason === 'TOO_MANY' ? 'Too many links in the last hour — try later.' : 'Email could not be sent (the platform email is not set up yet).')),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <Card title="Email address">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="break-all">{user.email}</span>
        {user.emailVerified ? <Badge color="green">confirmed</Badge> : <Badge color="amber">not confirmed</Badge>}
        {!user.emailVerified && <Button variant="ghost" className="px-3 py-1.5" loading={resend.isPending} onClick={() => resend.mutate()}>Send confirmation link</Button>}
      </p>
      <p className="mt-2 text-xs text-white/45">A confirmed email is needed so "Forgot password" can reach you.</p>
    </Card>
  );
}

function SessionsCard({ onLogoutAll }) {
  const { logout } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['auth', 'sessions'], queryFn: async () => (await api.get('/auth/sessions')).data.data.items });
  const revoke = useMutation({
    mutationFn: async (s) => { await api.delete(`/auth/sessions/${s.id}`); return s; },
    onSuccess: async (s) => {
      if (s.current) return logout();
      toast.success('That device is logged out (within 15 minutes at most)');
      return queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <Card title="Logged-in devices">
      {q.isLoading && <LoadingState rows={2} />}
      {q.isError && <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />}
      <ul className="divide-y divide-white/5 text-sm">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="font-medium">{s.device}</span>
            {s.current && <Badge color="green">this device</Badge>}
            <span className="text-xs text-white/45">{s.ip ? `IP ${s.ip} · ` : ''}logged in {formatDateTime(s.startedAt)} · last active {formatDateTime(s.lastActiveAt)}</span>
            <Button variant="ghost" className="ml-auto px-3 py-1.5" loading={revoke.isPending && revoke.variables?.id === s.id} onClick={() => revoke.mutate(s)}>Log out</Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="danger" onClick={onLogoutAll}>Log out of all devices</Button>
        <span className="text-xs text-white/40">Don't recognise a device? Log it out and change your password.</span>
      </div>
    </Card>
  );
}

export { EmailCard, TwoStepCard, SessionsCard };
