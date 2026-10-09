import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useSetSettings } from '../../hooks/useTenantSettings.js';
import { useToast } from '../Toast.jsx';
import { Button, Alert, Field, TextArea } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

export default function OutreachSettingsForm({ settings, readOnly }) {
  const o = settings.outreach || {};
  const [f, setF] = useState({ dailyEmailLimit: o.dailyEmailLimit || 100, emailSignature: o.emailSignature || '', postalAddress: o.postalAddress || '' });
  const setSettings = useSetSettings();
  const toast = useToast();
  const save = useMutation({
    mutationFn: async () => (await api.patch('/settings/outreach', { ...f, dailyEmailLimit: Number(f.dailyEmailLimit) })).data.data.settings,
    onSuccess: (s) => { setSettings(s); toast.success('Saved'); },
  });
  return (
    <fieldset disabled={readOnly || save.isPending} className="space-y-4">
      {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
      <Field label="Max emails per 24 hours" name="limit" type="number" min={1} max={1000} value={f.dailyEmailLimit} onChange={(e) => setF({ ...f, dailyEmailLimit: e.target.value })} hint="Sending too many cold emails gets a mailbox blocked. Start low (e.g. 30–50) and grow slowly." />
      <TextArea label="Email signature" name="sig" rows={3} maxLength={500} value={f.emailSignature} onChange={(e) => setF({ ...f, emailSignature: e.target.value })} />
      <Field label="Business postal address (email footer)" name="addr" maxLength={200} value={f.postalAddress} onChange={(e) => setF({ ...f, postalAddress: e.target.value })} hint="Many email laws (e.g. US CAN-SPAM) require a postal address in marketing emails." />
      <p className="text-xs text-white/45">Every email automatically gets an unsubscribe link. People who unsubscribe are added to your do-not-contact list.</p>
      {!readOnly && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>}
    </fieldset>
  );
}
