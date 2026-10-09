// Company time zone ("today" for follow-ups) + the hour the daily follow-up email goes out.
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useSetSettings } from '../../hooks/useTenantSettings.js';
import { useToast } from '../Toast.jsx';
import { Button, Alert, SelectField } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

const FALLBACK = ['UTC', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];

export default function GeneralSettingsForm({ settings, readOnly }) {
  const g = settings.general || {};
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = useMemo(() => {
    let list = FALLBACK;
    try {
      list = Intl.supportedValuesOf('timeZone');
    } catch {
      /* older browser */
    }
    return [...new Set(['UTC', ...list])];
  }, []);
  const [f, setF] = useState({ timezone: g.timezone || 'UTC', digestHour: g.digestHour ?? 8 });
  const setSettings = useSetSettings();
  const toast = useToast();
  const save = useMutation({
    mutationFn: async () => (await api.patch('/settings/general', { timezone: f.timezone, digestHour: Number(f.digestHour) })).data.data.settings,
    onSuccess: (s) => { setSettings(s); toast.success('Saved'); },
  });
  return (
    <fieldset disabled={readOnly || save.isPending} className="space-y-4">
      {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
      <SelectField label="Company time zone" name="timezone" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} options={zones.map((z) => ({ value: z, label: z }))} />
      {browserTz && browserTz !== f.timezone && !readOnly && (
        <p className="text-xs text-white/50">Your device is in <b>{browserTz}</b>. <button type="button" className="underline" onClick={() => setF({ ...f, timezone: browserTz })}>Use it</button></p>
      )}
      <SelectField label="Daily follow-up email time" name="digestHour" value={String(f.digestHour)} onChange={(e) => setF({ ...f, digestHour: e.target.value })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))} />
      <p className="text-xs text-white/45">"Today", "overdue" and the daily email use this time zone. Each person turns the daily email on for themselves (Notifications → My settings).</p>
      {!readOnly && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>}
    </fieldset>
  );
}
