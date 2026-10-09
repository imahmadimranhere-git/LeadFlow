// Lead page: the lead's next follow-up (date + what to do), with done / snooze / change.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Card, Button, Badge, LoadingState } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatInZone } from '../../utils/zoned.js';
import FollowUpActions, { ScheduleModal, useFollowUpRefresh } from './FollowUpActions.jsx';

const BUCKET = { overdue: ['red', 'Overdue'], today: ['amber', 'Today'], upcoming: ['blue', 'This week'], later: ['gray', 'Later'] };

export default function FollowUpCard({ lead, canWrite }) {
  const toast = useToast();
  const refresh = useFollowUpRefresh();
  const [scheduling, setScheduling] = useState(false);
  const q = useQuery({ queryKey: ['follow-ups', 'lead', lead.id], queryFn: async () => (await api.get(`/follow-ups/${lead.id}`)).data.data });
  const clear = useMutation({ mutationFn: () => api.delete(`/follow-ups/${lead.id}`), onSuccess: () => { toast.success('Follow-up removed'); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e)) });
  const f = q.data;
  return (
    <Card title="Follow-up" action={canWrite && f && !f.followUpDate && <Button className="px-3 py-1.5" onClick={() => setScheduling(true)}>Schedule</Button>}>
      {q.isLoading && <LoadingState rows={1} />}
      {f && !f.followUpDate && <p className="text-sm text-white/45">No follow-up planned.</p>}
      {f?.followUpDate && (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge color={BUCKET[f.bucket]?.[0]}>{BUCKET[f.bucket]?.[1]}</Badge>
            <span>{formatInZone(f.followUpDate, f.timezone)}</span>
            <span className="text-xs text-white/35">({f.timezone})</span>
          </p>
          {f.followUpNote && <p className="whitespace-pre-wrap text-sm text-white/75">{f.followUpNote}</p>}
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <FollowUpActions leadId={lead.id} followUpDate={f.followUpDate} followUpNote={f.followUpNote} />
              <button type="button" className="text-xs text-white/40 underline" onClick={() => clear.mutate()}>Remove</button>
            </div>
          )}
        </div>
      )}
      {scheduling && <ScheduleModal leadId={lead.id} onClose={() => setScheduling(false)} />}
    </Card>
  );
}
