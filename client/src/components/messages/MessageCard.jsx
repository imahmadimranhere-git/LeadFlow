// One draft with everything a reviewer needs: text, flags, claims with proof, and the actions.
// All text is rendered as plain text (React escapes it) — AI or lead text can't inject HTML.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../Toast.jsx';
import { Badge, Button, Modal, Field, TextArea, Alert } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';
import { CHANNEL_LABEL, CHANNEL_LIMITS, STATUS_COLOR, STATUS_LABEL, ORIGIN_LABEL, INTENT_LABEL, INTENT_COLOR } from '../../utils/messageOptions.js';
import OutreachActions from './OutreachActions.jsx';

export default function MessageCard({ message: m, showLead = true }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(null); // 'edit' | 'reject' | 'approve' | 'template' | 'regenerate'
  const [form, setForm] = useState({});
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['messages'] });
  const approver = can('messages:approve');
  const mine = m.createdBy?.id === user?.id;
  const pending = m.status === 'PENDING_REVIEW';

  const act = useMutation({
    mutationFn: async ({ path, method = 'post', body }) => (await api[method](`/messages/${m.id}${path}`, body)).data.data,
    onSuccess: (_d, vars) => {
      toast.success(vars.done);
      setModal(null);
      refresh();
      if (vars.path === '/save-as-template') queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
  const open = (name, initial = {}) => {
    act.reset();
    setForm(initial);
    setModal(name);
  };
  const copy = () => navigator.clipboard?.writeText(`${m.subject ? `${m.subject}\n\n` : ''}${m.body}`).then(() => toast.success('Copied — paste it in the app you send from'), () => toast.error('Copy failed'));

  const blocking = (m.flags || []).filter((f) => f.blocking);
  const warnings = (m.flags || []).filter((f) => !f.blocking);

  return (
    <article className="rounded-xl bg-ink-900 p-4 ring-1 ring-white/10">
      <header className="flex flex-wrap items-center gap-2">
        <Badge color={STATUS_COLOR[m.status]}>{STATUS_LABEL[m.status]}</Badge>
        <span className="text-sm font-medium">{CHANNEL_LABEL[m.channel]}</span>
        <span className="text-xs text-white/40">{ORIGIN_LABEL[m.origin]}{m.editedByHuman && m.origin !== 'MANUAL' ? ' · edited' : ''}</span>
        {m.sensitive?.map((s) => <Badge key={s} color="amber">{s.toLowerCase()}</Badge>)}
        {showLead && m.leadId && <Link to={`/app/leads/${m.leadId.id}`} className="ml-auto text-xs text-brand-500 underline">{m.leadId.name}</Link>}
      </header>

      {m.replyIntent && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/60">
          <span>They:</span><Badge color={INTENT_COLOR[m.replyIntent]}>{INTENT_LABEL[m.replyIntent] || m.replyIntent}</Badge>
          {m.recommendedNextAction && <span>· Next step: <span className="text-white/85">{m.recommendedNextAction}</span></span>}
          {m.conversationId && <Link to={`/app/conversations?open=${m.conversationId}`} className="text-brand-500 underline">Open conversation</Link>}
        </p>
      )}
      {m.subject && <p className="mt-3 text-sm"><span className="text-white/40">Subject: </span>{m.subject}</p>}
      <p className="mt-2 whitespace-pre-wrap text-sm text-white/85">{m.body}</p>

      {blocking.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-red-500/10 p-3 text-xs text-red-300 ring-1 ring-red-500/30">
          {blocking.map((f, i) => <li key={i}>⛔ {f.message}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-300">
          {warnings.map((f, i) => <li key={i}>⚠ {f.message}</li>)}
        </ul>
      )}
      {m.claims?.length > 0 && (
        <details className="mt-2 text-xs text-white/55">
          <summary className="cursor-pointer">Personal statements ({m.claims.filter((c) => c.verified).length}/{m.claims.length} backed by the evidence)</summary>
          <ul className="mt-1 space-y-1">
            {m.claims.map((c, i) => (
              <li key={i}>{c.verified ? '✓' : '⚠'} {c.statement}{c.quote && <span className="text-white/35"> — “{c.quote}”</span>}</li>
            ))}
          </ul>
        </details>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {pending && approver && (
          <Button className="px-3 py-1.5" disabled={!m.canApprove} onClick={() => (m.sensitive?.length ? open('approve', { confirm: false }) : act.mutate({ path: '/approve', body: {}, done: 'Approved' }))}>Approve</Button>
        )}
        {(approver || mine) && <OutreachActions message={m} />}
        {(approver || mine) && ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_FAILED'].includes(m.status) && (
          <Button variant="ghost" className="px-3 py-1.5" onClick={() => open('edit', { subject: m.subject || '', body: m.body })}>Edit</Button>
        )}
        {pending && (approver || mine) && <Button variant="ghost" className="px-3 py-1.5" onClick={() => open('regenerate', { instructions: '' })}>Regenerate (AI)</Button>}
        {pending && approver && <Button variant="ghost" className="px-3 py-1.5" onClick={() => open('reject', { reason: '' })}>Reject</Button>}
        {m.status !== 'PENDING_REVIEW' && m.status !== 'GENERATING' && <Button variant="ghost" className="px-3 py-1.5" onClick={copy}>Copy text</Button>}
        {approver && <Button variant="ghost" className="px-3 py-1.5" onClick={() => open('template', { name: '' })}>Save as template</Button>}
        {['PENDING_REVIEW', 'REJECTED'].includes(m.status) && (approver || mine) && (
          <Button variant="ghost" className="px-3 py-1.5" onClick={() => act.mutate({ path: '', method: 'delete', done: 'Deleted' })}>Delete</Button>
        )}
        <span className="ml-auto text-xs text-white/35">
          {m.createdBy?.name} · {formatDateTime(m.createdAt)}
          {m.reviewedBy && <> · {m.status === 'APPROVED' ? 'approved' : 'reviewed'} by {m.reviewedBy.name}</>}
          {m.rejectReason && <> · “{m.rejectReason}”</>}
        </span>
      </footer>
      {m.sentAt && <p className="mt-2 text-xs text-white/40">Sent {formatDateTime(m.sentAt)}{m.sentVia === 'SMTP' ? ` by email to ${m.sentTo}` : ' (by hand)'}{m.sentBy?.name ? ` · ${m.sentBy.name}` : ''}{m.repliedAt ? ` · replied ${formatDateTime(m.repliedAt)}` : ''}{m.followUpAt ? ` · follow up ${formatDateTime(m.followUpAt)}` : ''}</p>}
      {m.sendError && <p className="mt-1 text-xs text-red-300">{m.sendError}</p>}

      <Modal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        size={modal === 'edit' ? 'lg' : 'sm'}
        title={{ edit: 'Edit message', reject: 'Reject draft', approve: 'Approve a sensitive message', template: 'Save as template', regenerate: 'Regenerate with AI' }[modal]}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            {modal === 'edit' && <Button loading={act.isPending} onClick={() => act.mutate({ path: '', method: 'patch', body: { ...(m.channel === 'EMAIL' ? { subject: form.subject } : {}), body: form.body }, done: 'Saved — back in review' })}>Save</Button>}
            {modal === 'reject' && <Button variant="danger" loading={act.isPending} onClick={() => act.mutate({ path: '/reject', body: form.reason ? { reason: form.reason } : {}, done: 'Rejected' })}>Reject</Button>}
            {modal === 'approve' && <Button loading={act.isPending} disabled={!form.confirm} onClick={() => act.mutate({ path: '/approve', body: { confirmSensitive: true }, done: 'Approved' })}>Approve</Button>}
            {modal === 'template' && <Button loading={act.isPending} disabled={!form.name} onClick={() => act.mutate({ path: '/save-as-template', body: { name: form.name }, done: 'Template saved' })}>Save</Button>}
            {modal === 'regenerate' && <Button loading={act.isPending} onClick={() => act.mutate({ path: '/regenerate', body: form.instructions ? { instructions: form.instructions } : {}, done: 'New draft written' })}>Regenerate</Button>}
          </>
        }
      >
        <div className="space-y-4">
          {act.isError && <Alert>{apiErrorMessage(act.error)}</Alert>}
          {modal === 'edit' && (
            <>
              {m.channel === 'EMAIL' && <Field label="Subject" name="subject" maxLength={150} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}
              <TextArea label="Message" name="body" rows={10} maxLength={CHANNEL_LIMITS[m.channel]} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} hint={`${form.body?.length || 0} / ${CHANNEL_LIMITS[m.channel]} characters. Saving sends it back to review.`} />
            </>
          )}
          {modal === 'reject' && <Field label="Reason (optional)" name="reason" maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
          {modal === 'approve' && (
            <label className="flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" className="mt-1" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} />
              This message mentions {m.sensitive.map((s) => s.toLowerCase()).join(', ')}. I checked every number, date and promise and they are correct.
            </label>
          )}
          {modal === 'template' && <Field label="Template name" name="tname" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} hint="Tip: afterwards replace names with {{firstName}}, {{companyName}}… in Templates." />}
          {modal === 'regenerate' && <TextArea label="What should change? (optional)" name="instr" rows={3} maxLength={500} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} hint="e.g. shorter, more formal, mention our free consultation. The old version is kept." />}
        </div>
      </Modal>
    </article>
  );
}
