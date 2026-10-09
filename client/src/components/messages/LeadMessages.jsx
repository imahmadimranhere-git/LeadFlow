// Lead page: write a message (AI / template / by hand) and see this lead's drafts.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Card, Button, Modal, SelectField, TextArea, Field, Alert, LoadingState } from '../ui.jsx';
import MessageCard from './MessageCard.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { CHANNELS, CHANNEL_LIMITS } from '../../utils/messageOptions.js';

function WriteModal({ lead, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('AI');
  const [f, setF] = useState({ channel: 'LINKEDIN', instructions: '', templateId: '', subject: '', body: '' });
  const templates = useQuery({ queryKey: ['templates', 'list'], queryFn: async () => (await api.get('/templates')).data.data.items });
  const create = useMutation({
    mutationFn: async () => {
      if (mode === 'AI') return (await api.post('/messages/generate', { leadId: lead.id, channel: f.channel, ...(f.instructions && { instructions: f.instructions }), ...(f.templateId && { templateId: f.templateId }) })).data.data.message;
      if (mode === 'TEMPLATE') return (await api.post('/messages/from-template', { leadId: lead.id, templateId: f.templateId })).data.data.message;
      return (await api.post('/messages/manual', { leadId: lead.id, channel: f.channel, body: f.body, ...(f.channel === 'EMAIL' && f.subject && { subject: f.subject }) })).data.data.message;
    },
    onSuccess: () => {
      toast.success('Draft ready — it waits for approval');
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      onClose();
    },
  });
  const tpl = (templates.data || []).filter((t) => mode === 'TEMPLATE' || t.channel === f.channel);
  const canSubmit = mode === 'TEMPLATE' ? Boolean(f.templateId) : mode === 'MANUAL' ? f.body.trim().length > 0 : true;

  return (
    <Modal open onClose={onClose} size="lg" title={`Message for ${lead.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>{mode === 'AI' ? 'Write with AI' : 'Create draft'}</Button></>}>
      <div className="space-y-4">
        {create.isError && (
          <Alert>
            {apiErrorMessage(create.error)}
            {create.error?.response?.data?.details?.messageId && <> — see the existing draft below.</>}
          </Alert>
        )}
        <div className="flex flex-wrap gap-1" role="tablist">
          {[['AI', 'AI draft'], ['TEMPLATE', 'From template'], ['MANUAL', 'Write myself']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`rounded-lg px-3 py-2 text-sm ${mode === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>
          ))}
        </div>
        {mode !== 'TEMPLATE' && <SelectField label="Channel" name="channel" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value, templateId: '' })} options={CHANNELS.map(([value, label]) => ({ value, label }))} />}
        {mode === 'AI' && (
          <>
            <TextArea label="What should the message say? (optional)" name="instructions" rows={3} maxLength={500} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} hint="e.g. offer a free 15-minute call. Prices, deadlines and promises are only included if you ask — and then need extra confirmation." />
            {tpl.length > 0 && <SelectField label="Use a template as starting point (optional)" name="tpl" value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })} options={[{ value: '', label: 'No template' }, ...tpl.map((t) => ({ value: t.id, label: t.name }))]} />}
            <p className="text-xs text-white/40">The AI uses only this lead's evidence and your company settings. Every personal sentence is checked against the evidence. Costs 1 AI request.</p>
          </>
        )}
        {mode === 'TEMPLATE' && (
          templates.isLoading ? <LoadingState rows={2} /> : tpl.length === 0 ? (
            <p className="text-sm text-white/50">No templates yet. <Link className="underline" to="/app/templates">Create one</Link>.</p>
          ) : (
            <SelectField label="Template" name="tplOnly" value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })} options={[{ value: '', label: 'Choose…' }, ...tpl.map((t) => ({ value: t.id, label: `${t.name} (${t.channel.toLowerCase()})` }))]} />
          )
        )}
        {mode === 'MANUAL' && (
          <>
            {f.channel === 'EMAIL' && <Field label="Subject" name="subject" maxLength={150} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}
            <TextArea label="Message" name="body" rows={8} maxLength={CHANNEL_LIMITS[f.channel]} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </>
        )}
      </div>
    </Modal>
  );
}

export default function LeadMessages({ lead, canWrite }) {
  const [writing, setWriting] = useState(false);
  const q = useQuery({ queryKey: ['messages', 'lead', lead.id], queryFn: async () => (await api.get('/messages', { params: { leadId: lead.id, limit: 20 } })).data.data.items });
  return (
    <Card
      title="Messages"
      action={
        <div className="flex gap-2">
          <Link to={`/app/conversations?lead=${lead.id}`} className="rounded-lg px-3 py-1.5 text-sm text-white/70 ring-1 ring-white/15 hover:bg-white/5">Conversations</Link>
          {canWrite && !lead.doNotContact && <Button className="px-3 py-1.5" onClick={() => setWriting(true)}>Write message</Button>}
        </div>
      }
    >
      {lead.doNotContact && <p className="mb-3 text-sm text-red-300">On your do-not-contact list — no messages can be prepared.</p>}
      {q.isLoading && <LoadingState rows={2} />}
      {q.data?.length === 0 && <p className="text-sm text-white/45">No messages yet. Every draft waits in the <Link className="underline" to="/app/approvals">approval queue</Link> — nothing is sent automatically.</p>}
      <div className="space-y-3">{q.data?.map((m) => <MessageCard key={m.id} message={m} showLead={false} />)}</div>
      {writing && <WriteModal lead={lead} onClose={() => setWriting(false)} />}
    </Card>
  );
}
