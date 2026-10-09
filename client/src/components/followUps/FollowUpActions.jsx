// Done / snooze / reschedule for one lead's follow-up. The server checks the lead is yours to change.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Button, Modal, Field, TextArea, Alert, DropdownMenu } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { snoozeDate, toLocalInput } from '../../utils/zoned.js';

export function useFollowUpRefresh() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
    queryClient.invalidateQueries({ queryKey: ['leads'] });
  };
}

export function ScheduleModal({ leadId, title = 'Schedule follow-up', initial, onClose }) {
  const toast = useToast();
  const refresh = useFollowUpRefresh();
  const [f, setF] = useState({ when: initial?.date ? toLocalInput(initial.date) : toLocalInput(snoozeDate(1)), note: initial?.note || '' });
  const save = useMutation({
    mutationFn: () => api.put(`/follow-ups/${leadId}`, { date: new Date(f.when).toISOString(), ...(f.note.trim() && { note: f.note.trim() }) }),
    onSuccess: () => { toast.success('Follow-up saved'); refresh(); onClose(); },
  });
  return (
    <Modal open onClose={onClose} size="sm" title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.when} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <Field label="When" name="when" type="datetime-local" value={f.when} min={toLocalInput(new Date())} onChange={(e) => setF({ ...f, when: e.target.value })} hint="Your device's time. You get a reminder at this time." />
        <TextArea label="What to do (optional)" name="note" rows={2} maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Send revised quote" />
      </div>
    </Modal>
  );
}

function DoneModal({ leadId, onClose }) {
  const toast = useToast();
  const refresh = useFollowUpRefresh();
  const [f, setF] = useState({ note: '', next: '' });
  const done = useMutation({
    mutationFn: () => api.post(`/follow-ups/${leadId}/done`, { ...(f.note.trim() && { note: f.note.trim() }), ...(f.next && { next: new Date(f.next).toISOString() }) }),
    onSuccess: () => { toast.success(f.next ? 'Done — next follow-up scheduled' : 'Done'); refresh(); onClose(); },
  });
  return (
    <Modal open onClose={onClose} size="sm" title="Follow-up done" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={done.isPending} onClick={() => done.mutate()}>Mark done</Button></>}>
      <div className="space-y-3">
        {done.isError && <Alert>{apiErrorMessage(done.error)}</Alert>}
        <TextArea label="What happened? (optional, saved in the lead's activity)" name="outcome" rows={2} maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <Field label="Next follow-up (optional)" name="next" type="datetime-local" value={f.next} min={toLocalInput(new Date())} onChange={(e) => setF({ ...f, next: e.target.value })} />
      </div>
    </Modal>
  );
}

export default function FollowUpActions({ leadId, followUpDate, followUpNote }) {
  const toast = useToast();
  const refresh = useFollowUpRefresh();
  const [modal, setModal] = useState(null);
  const snooze = useMutation({
    mutationFn: (days) => api.put(`/follow-ups/${leadId}`, { date: snoozeDate(days).toISOString() }),
    onSuccess: () => { toast.success('Snoozed'); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button className="px-3 py-1.5" onClick={() => setModal('done')}>Done</Button>
      <DropdownMenu
        label="Snooze"
        trigger={<span className="rounded-lg px-3 py-1.5 text-sm text-white/75 ring-1 ring-white/15 hover:bg-white/5">Snooze ▾</span>}
        items={[
          { label: 'Tomorrow 10:00', onSelect: () => snooze.mutate(1) },
          { label: 'In 3 days', onSelect: () => snooze.mutate(3) },
          { label: 'Next week', onSelect: () => snooze.mutate(7) },
          { label: 'Pick a time…', onSelect: () => setModal('schedule') },
        ]}
      />
      {modal === 'done' && <DoneModal leadId={leadId} onClose={() => setModal(null)} />}
      {modal === 'schedule' && <ScheduleModal leadId={leadId} initial={{ date: followUpDate, note: followUpNote }} onClose={() => setModal(null)} />}
    </div>
  );
}
