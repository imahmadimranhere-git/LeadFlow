// Outreach buttons on an approved / sent message. The server re-checks everything (approval, do-not-contact,
// consent, daily limit) at the moment of sending.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Button, Modal, Field, Alert, LoadingState } from '../ui.jsx';
import { ExternalLink } from '../leads/LeadBits.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { CHANNEL_LABEL } from '../../utils/messageOptions.js';

function SendModal({ m, onClose, onDone }) {
  const toast = useToast();
  const opts = useQuery({ queryKey: ['messages', 'send-options', m.id], queryFn: async () => (await api.get(`/messages/${m.id}/send-options`)).data.data });
  const sendEmail = useMutation({ mutationFn: () => api.post(`/messages/${m.id}/send-email`), onSuccess: () => { toast.success('Email sent'); onDone(); } });
  const sendWa = useMutation({ mutationFn: () => api.post(`/messages/${m.id}/send-whatsapp`), onSuccess: () => { toast.success('Sent on WhatsApp'); onDone(); } });
  const markSent = useMutation({ mutationFn: () => api.post(`/messages/${m.id}/mark-sent`, {}), onSuccess: () => { toast.success('Marked as sent'); onDone(); } });
  const copy = () => navigator.clipboard?.writeText(`${m.subject ? `${m.subject}\n\n` : ''}${m.body}`).then(() => toast.success('Copied'), () => toast.error('Copy failed'));
  const o = opts.data;
  const err = sendEmail.error || sendWa.error || markSent.error;

  return (
    <Modal open onClose={onClose} title={`Send ${CHANNEL_LABEL[m.channel]}`} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {opts.isLoading && <LoadingState rows={2} />}
      {o && (
        <div className="space-y-4 text-sm">
          {o.blockedReason && <Alert>{o.blockedReason} Sending is blocked.</Alert>}
          {err && <Alert>{apiErrorMessage(err)}</Alert>}
          {m.channel === 'EMAIL' && !o.blockedReason && (
            o.email?.smtpConnected ? (
              o.email.to ? (
                <>
                  <p>To: <span className="font-mono">{o.email.to}</span> — from your connected mailbox. An unsubscribe link is added automatically.</p>
                  <Button loading={sendEmail.isPending} onClick={() => sendEmail.mutate()}>Send email now</Button>
                </>
              ) : <p className="text-white/60">This lead has no email address.</p>
            ) : (
              <p className="text-white/60">Connect your mailbox in <Link className="underline" to="/app/settings/integrations">Settings → Integrations → Email (SMTP)</Link> — or copy the text, send it yourself and mark it as sent.</p>
            )
          )}
          {m.channel === 'WHATSAPP' && !o.blockedReason && o.whatsappApi?.connected && (
            o.whatsappApi.windowOpen ? (
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3">
                <p>The customer wrote to your WhatsApp Business number recently — you can reply through the API until <b>{new Date(o.whatsappApi.closesAt).toLocaleString()}</b>.</p>
                <Button className="mt-2" loading={sendWa.isPending} onClick={() => sendWa.mutate()}>Send via WhatsApp API</Button>
              </div>
            ) : (
              <p className="text-xs text-white/45">WhatsApp API: free text is only allowed within 24 hours after the customer wrote to your business number — so send this one from your own WhatsApp:</p>
            )
          )}
          {m.channel !== 'EMAIL' && !o.blockedReason && (
            <ol className="list-decimal space-y-2 pl-5 text-white/75">
              <li><button type="button" className="underline" onClick={copy}>Copy the text</button></li>
              <li>
                {o.whatsappUrl ? <ExternalLink href={o.whatsappUrl}>Open WhatsApp with the text</ExternalLink> : o.profileUrl ? <ExternalLink href={o.profileUrl}>Open their profile / post</ExternalLink> : 'Open the app and find the person'}
                {m.channel === 'WHATSAPP' && <span className="block text-xs text-white/40">The link uses the number saved on the lead — check it has the country code (e.g. 92…).</span>}
              </li>
              <li>Send it yourself, then come back and confirm:</li>
            </ol>
          )}
          {!o.blockedReason && <Button variant={m.channel === 'EMAIL' ? 'ghost' : 'primary'} loading={markSent.isPending} onClick={() => markSent.mutate()}>I sent it — mark as sent</Button>}
        </div>
      )}
    </Modal>
  );
}

export default function OutreachActions({ message: m }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState(null); // 'send' | 'followup'
  const [date, setDate] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['messages'] });
  const act = useMutation({
    mutationFn: ({ path, body = {} }) => api.post(`/messages/${m.id}${path}`, body),
    onSuccess: (_d, v) => { toast.success(v.done); setModal(null); refresh(); queryClient.invalidateQueries({ queryKey: ['leads'] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <>
      {['APPROVED', 'SEND_FAILED'].includes(m.status) && <Button className="px-3 py-1.5" onClick={() => setModal('send')}>{m.status === 'SEND_FAILED' ? 'Retry / send' : 'Send'}</Button>}
      {['SENT', 'FOLLOW_UP'].includes(m.status) && <Button variant="ghost" className="px-3 py-1.5" loading={act.isPending} onClick={() => act.mutate({ path: '/mark-replied', done: 'Marked as replied' })}>They replied</Button>}
      {['SENT', 'REPLIED', 'FOLLOW_UP'].includes(m.status) && <Button variant="ghost" className="px-3 py-1.5" onClick={() => setModal('followup')}>Follow up…</Button>}
      {['SENT', 'REPLIED', 'FOLLOW_UP', 'SEND_FAILED'].includes(m.status) && <Button variant="ghost" className="px-3 py-1.5" loading={act.isPending} onClick={() => act.mutate({ path: '/close', done: 'Closed' })}>Close</Button>}
      {modal === 'send' && <SendModal m={m} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); queryClient.invalidateQueries({ queryKey: ['leads'] }); }} />}
      <Modal
        open={modal === 'followup'}
        onClose={() => setModal(null)}
        size="sm"
        title="Follow up on"
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button disabled={!date} loading={act.isPending} onClick={() => act.mutate({ path: '/follow-up', body: { date: new Date(`${date}T09:00:00`).toISOString() }, done: 'Follow-up set' })}>Save</Button></>}
      >
        <Field label="Date" name="fu" type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} hint="You get a notification on that day (see Follow-ups)." />
      </Modal>
    </>
  );
}
