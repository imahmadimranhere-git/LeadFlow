// Hashtag report for one watch: PDF downloads straight away; CSV runs as a background export
// (appears on the Exports page). Both list people → your password is asked again.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { Modal, Button, Field, SelectField, Alert } from '../ui.jsx';
import { useToast } from '../Toast.jsx';
import { postDownloadFromApi, blobErrorMessage } from '../../utils/download.js';
import { apiErrorMessage } from '../../utils/apiErrors.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function HashtagReportModal({ watch, onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState(() => { const d = new Date(); const to = iso(d); d.setDate(d.getDate() - 29); return { format: 'PDF', from: iso(d), to, password: '' }; });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      if (f.format === 'PDF') {
        await postDownloadFromApi(`/hashtag-watches/${watch.id}/report`, f, 'hashtag-report.pdf');
        toast.success('Report downloaded');
      } else {
        await api.post(`/hashtag-watches/${watch.id}/report`, f);
        toast.success('CSV export started');
        navigate('/app/exports');
      }
      onClose();
    } catch (e) {
      setError(f.format === 'PDF' ? await blobErrorMessage(e) : apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Report: ${watch.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.password} onClick={run}>{f.format === 'PDF' ? 'Download PDF' : 'Start CSV export'}</Button></>}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <SelectField label="Format" name="format" value={f.format} onChange={set('format')} options={[{ value: 'PDF', label: 'PDF report (summary + posts)' }, { value: 'CSV', label: 'CSV (all captured posts)' }]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" name="from" type="date" value={f.from} onChange={set('from')} />
          <Field label="To" name="to" type="date" value={f.to} onChange={set('to')} />
        </div>
        <p className="text-xs text-white/50">The report lists people who posted, so please confirm your password. Missing author/contact data is shown as missing — never guessed.</p>
        <Field label="Your password" name="password" type="password" autoComplete="current-password" value={f.password} onChange={set('password')} />
      </div>
    </Modal>
  );
}
