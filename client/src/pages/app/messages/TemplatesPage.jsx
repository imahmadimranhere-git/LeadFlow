// Message templates: plain text with {{variables}}. Managers+ edit; everyone who writes leads can use them.
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { PageHeader, Card, Button, Badge, Modal, Field, SelectField, TextArea, Alert, LoadingState, ErrorState, EmptyState } from '../../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { CHANNELS, CHANNEL_LABEL, CHANNEL_LIMITS, TEMPLATE_VARIABLES } from '../../../utils/messageOptions.js';

function TemplateModal({ template, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const bodyRef = useRef(null);
  const [f, setF] = useState(template ? { name: template.name, channel: template.channel, subject: template.subject || '', body: template.body, isActive: template.isActive } : { name: '', channel: 'LINKEDIN', subject: '', body: '', isActive: true });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, subject: f.channel === 'EMAIL' ? f.subject : '' };
      return template ? api.patch(`/templates/${template.id}`, body) : api.post('/templates', body);
    },
    onSuccess: () => {
      toast.success('Template saved');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      onClose();
    },
  });
  const errs = apiFieldErrors(save.error);
  const insert = (v) => {
    const el = bodyRef.current;
    const pos = el?.selectionStart ?? f.body.length;
    setF({ ...f, body: `${f.body.slice(0, pos)}{{${v}}}${f.body.slice(pos)}` });
  };
  return (
    <Modal open onClose={onClose} size="lg" title={template ? 'Edit template' : 'New template'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        {save.isError && <Alert>{apiErrorMessage(save.error)}{errs.body && ` — ${errs.body}`}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" name="name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
          <SelectField label="Channel" name="channel" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} options={CHANNELS.map(([value, label]) => ({ value, label }))} />
        </div>
        {f.channel === 'EMAIL' && <Field label="Subject" name="subject" maxLength={150} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}
        <div>
          <TextArea ref={bodyRef} label="Message" name="body" rows={8} maxLength={CHANNEL_LIMITS[f.channel]} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} hint="Fallback for empty values: {{firstName|there}}. {{evidence}} needs real evidence — no fallback." />
          <div className="mt-2 flex flex-wrap gap-1">
            {TEMPLATE_VARIABLES.map(([v, label]) => (
              <button key={v} type="button" title={label} onClick={() => insert(v)} className="rounded-md bg-white/5 px-2 py-1 font-mono text-xs text-white/70 hover:bg-white/10">{`{{${v}}}`}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
      </div>
    </Modal>
  );
}

export default function TemplatesPage() {
  useDocumentTitle('Templates');
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const manage = can('messages:approve');
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['templates', 'all'], queryFn: async () => (await api.get('/templates', { params: manage ? { all: 'true' } : {} })).data.data.items });
  const importStarters = useMutation({
    mutationFn: async () => (await api.post('/templates/import-starters')).data.data,
    onSuccess: (r) => { toast.success(r.imported ? `${r.imported} starter template(s) added` : 'Starter templates already added'); queryClient.invalidateQueries({ queryKey: ['templates'] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (q.isLoading) return <LoadingState rows={4} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable messages with {{firstName}}, {{companyName}} and more. Messages made from a template still go through approval."
        actions={manage && (
          <>
            <Button variant="ghost" loading={importStarters.isPending} onClick={() => importStarters.mutate()}>Add starter templates</Button>
            <Button onClick={() => setEditing('new')}>New template</Button>
          </>
        )}
      />
      {q.data.length === 0 ? (
        <Card><EmptyState icon="template" title="No templates yet" description="Add the starter templates of your industry pack, or create your own." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.map((t) => (
            <div key={t.id} className="rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{t.name}</p>
                <Badge>{CHANNEL_LABEL[t.channel]}</Badge>
                {!t.isActive && <Badge>inactive</Badge>}
                <span className="ml-auto text-xs text-white/40">used {t.timesUsed}×</span>
              </div>
              {t.subject && <p className="mt-2 text-xs text-white/50">Subject: {t.subject}</p>}
              <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-sm text-white/70">{t.body}</p>
              {manage && (
                <div className="mt-3 flex gap-2">
                  <Button variant="ghost" className="px-3 py-1.5" onClick={() => setEditing(t)}>Edit</Button>
                  <Button variant="ghost" className="px-3 py-1.5" onClick={() => remove.mutate(t.id)}>Delete</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <TemplateModal key={editing === 'new' ? 'new' : editing.id} template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
