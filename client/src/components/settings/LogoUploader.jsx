import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { SETTINGS_KEY } from '../../hooks/useTenantSettings.js';
import useTenantLogo from '../../hooks/useTenantLogo.js';
import { useToast } from '../Toast.jsx';
import { Alert, Button } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX = 256 * 1024;

export default function LogoUploader({ settings, readOnly }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const input = useRef(null);
  const [localError, setLocalError] = useState('');
  const logoUrl = useTenantLogo(settings.branding?.hasLogo, settings.branding?.logoVersion);
  const refresh = () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });

  const upload = useMutation({
    // The file is sent as-is (raw bytes); the server checks the real type from the bytes.
    mutationFn: (file) => api.put('/settings/branding/logo', file, { headers: { 'Content-Type': file.type } }),
    onSuccess: () => {
      toast.success('Logo updated');
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete('/settings/branding/logo'),
    onSuccess: () => {
      toast.success('Logo removed');
      refresh();
    },
  });

  function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setLocalError('');
    if (!file) return;
    if (!TYPES.includes(file.type)) return setLocalError('Please choose a PNG, JPEG or WebP image (SVG is not allowed).');
    if (file.size > MAX) return setLocalError('The logo must be 256 KB or smaller.');
    upload.mutate(file);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-20 w-40 place-items-center overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10">
          {logoUrl ? <img src={logoUrl} alt="Company logo" className="max-h-16 max-w-36 object-contain" /> : <span className="text-xs text-white/30">No logo</span>}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept={TYPES.join(',')} className="hidden" onChange={onFile} />
            <Button variant="ghost" loading={upload.isPending} onClick={() => input.current?.click()}>{logoUrl ? 'Replace logo' : 'Upload logo'}</Button>
            {logoUrl && <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>}
          </div>
        )}
      </div>
      <p className="text-xs text-white/40">PNG, JPEG or WebP, up to 256 KB. Shown in your sidebar (and later on quotes & invoices).</p>
      {(localError || upload.isError) && <Alert>{localError || apiErrorMessage(upload.error)}</Alert>}
    </div>
  );
}
