// CSV import wizard: 1) choose file  2) match columns  3) preview the result  4) import.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { Card, Button, Alert, Badge, StatCard } from '../../../components/ui.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';

const MAX_BYTES = 2 * 1024 * 1024;
const FIELD_LABELS = {
  name: 'Lead name', personName: 'Person', companyName: 'Company', industry: 'Industry', country: 'Country', city: 'City',
  website: 'Website', email: 'Email', phone: 'Phone', socialProfileUrl: 'Social profile', source: 'Source (kept as note)', notes: 'Notes / description',
};
const ISSUE_LABEL = { INVALID: ['red', 'Invalid'], DUPLICATE_DB: ['amber', 'Already a lead'], DUPLICATE_FILE: ['amber', 'Repeated in file'], POSSIBLE_DUPLICATE: ['blue', 'Possible duplicate'] };

export default function CsvImport() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef(null);
  const [job, setJob] = useState(null);
  const [mapping, setMapping] = useState({});
  const [options, setOptions] = useState({ importPossibleDuplicates: false, assignToMe: false });
  const [localError, setLocalError] = useState('');

  const upload = useMutation({
    mutationFn: async (file) =>
      (await api.post('/leads/imports', file, { headers: { 'Content-Type': 'text/csv', 'X-File-Name': encodeURIComponent(file.name.slice(0, 120)) } })).data.data.import,
    onSuccess: (j) => {
      setJob(j);
      setMapping(j.mapping);
    },
  });
  const preview = useMutation({
    mutationFn: async () => (await api.post(`/leads/imports/${job.id}/preview`, { mapping, options })).data.data.import,
    onSuccess: setJob,
  });
  const commit = useMutation({
    mutationFn: async () => (await api.post(`/leads/imports/${job.id}/commit`)).data.data.import,
    onSuccess: (j) => {
      setJob(j);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setLocalError('');
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return setLocalError('Please choose a .csv file. In Excel: File → Save As → "CSV UTF-8".');
    if (file.size > MAX_BYTES) return setLocalError('The file is larger than 2 MB — split it into smaller files.');
    upload.mutate(file);
  }

  const reset = () => {
    setJob(null);
    setMapping({});
    upload.reset();
    preview.reset();
    commit.reset();
  };

  // ---- step 1
  if (!job) {
    return (
      <Card title="Import leads from a CSV file">
        <div className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-white/60">
            <li>Columns can be: name, person, company, industry, country, city, website, email, phone, social profile, source, notes.</li>
            <li>Up to 5,000 rows and 2 MB per file. In Excel use “Save As → CSV UTF-8” so Urdu/Arabic text stays correct.</li>
            <li>Nothing is imported until you see the preview and confirm.</li>
          </ul>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          <Button loading={upload.isPending} onClick={() => fileInput.current?.click()}>Choose CSV file</Button>
          {(localError || upload.isError) && <Alert>{localError || apiErrorMessage(upload.error)}</Alert>}
        </div>
      </Card>
    );
  }

  // ---- step 4: done
  if (job.status === 'COMPLETED') {
    const s = job.summary;
    return (
      <Card title="Import finished">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Imported" value={s.imported} />
          <StatCard label="Skipped (duplicates)" value={s.duplicatesInDb + s.duplicatesInFile + (options.importPossibleDuplicates ? 0 : s.possibleDuplicates)} />
          <StatCard label="Skipped (invalid)" value={s.invalid} />
        </div>
        {s.failed > 0 && <p className="mt-3 text-sm text-amber-300">{s.failed} row(s) were created by someone else meanwhile and were skipped.</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/app/leads"><Button>View leads</Button></Link>
          <Button variant="ghost" onClick={reset}>Import another file</Button>
        </div>
      </Card>
    );
  }

  const usedFields = Object.values(mapping).filter(Boolean);
  const s = job.summary;

  return (
    <div className="space-y-6">
      <Card title={`2. Match the columns — ${job.fileName} (${job.rowCount} rows)`} action={<Button variant="ghost" className="px-3 py-1.5" onClick={reset}>Choose another file</Button>}>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-white/50">
              <tr><th className="px-2 py-2 font-medium">Column in your file</th><th className="px-2 py-2 font-medium">Example</th><th className="px-2 py-2 font-medium">Import as</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {job.headers.map((h, idx) => (
                <tr key={h}>
                  <td className="px-2 py-2 font-medium">{h}</td>
                  <td className="max-w-[220px] truncate px-2 py-2 text-white/50">{job.sampleRows?.[0]?.[idx] || '—'}</td>
                  <td className="px-2 py-2">
                    <select
                      aria-label={`Import ${h} as`}
                      value={mapping[h] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value || null }))}
                      className="w-full rounded-lg bg-ink-900 px-2 py-1.5 text-sm ring-1 ring-white/10"
                    >
                      <option value="">— don't import —</option>
                      {Object.entries(FIELD_LABELS).map(([f, l]) => (
                        <option key={f} value={f} disabled={usedFields.includes(f) && mapping[h] !== f}>{l}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.importPossibleDuplicates} onChange={(e) => setOptions((o) => ({ ...o, importPossibleDuplicates: e.target.checked }))} /> Also import “possible duplicates” (same company + city)</label>
          {can('leads:assign') && <label className="flex items-center gap-2"><input type="checkbox" checked={options.assignToMe} onChange={(e) => setOptions((o) => ({ ...o, assignToMe: e.target.checked }))} /> Assign imported leads to me</label>}
        </div>
        {preview.isError && <div className="mt-3"><Alert>{apiErrorMessage(preview.error)}</Alert></div>}
        <div className="mt-4 flex justify-end"><Button loading={preview.isPending} onClick={() => preview.mutate()}>Check file</Button></div>
      </Card>

      {job.status === 'PREVIEWED' && (
        <Card title="3. Preview">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Rows" value={s.total} />
            <StatCard label="Valid" value={s.valid} />
            <StatCard label="Invalid" value={s.invalid} />
            <StatCard label="Already leads" value={s.duplicatesInDb} />
            <StatCard label="Repeated in file" value={s.duplicatesInFile} />
            <StatCard label="Will be imported" value={s.toImport} />
          </div>
          {job.issues.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-medium text-white/70">Rows that need attention {job.issues.length >= 500 && '(first 500)'}</p>
              <div className="max-h-80 overflow-y-auto rounded-xl ring-1 ring-white/10">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-white/5">
                    {job.issues.map((i) => (
                      <tr key={`${i.row}-${i.type}`}>
                        <td className="w-20 px-3 py-2 text-white/50">Row {i.row}</td>
                        <td className="w-40 px-3 py-2"><Badge color={ISSUE_LABEL[i.type][0]}>{ISSUE_LABEL[i.type][1]}</Badge></td>
                        <td className="px-3 py-2 text-white/70">{i.field && i.field !== '-' ? `${i.field}: ` : ''}{i.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {commit.isError && <div className="mt-4"><Alert>{apiErrorMessage(commit.error)}</Alert></div>}
          <div className="mt-5 flex justify-end">
            <Button loading={commit.isPending} disabled={s.toImport === 0} onClick={() => commit.mutate()}>Import {s.toImport} lead(s)</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
