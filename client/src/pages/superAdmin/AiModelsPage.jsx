// Super admin: AI models and their prices (USD per 1M tokens). Used for cost estimates and as defaults.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, PageHeader, Field, SelectField, Button, Badge, Modal, Alert, LoadingState, ErrorState } from '../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const EMPTY = { provider: 'ANTHROPIC', modelId: '', displayName: '', inputPerMTok: '', outputPerMTok: '', isActive: true, isDefault: false, verified: false, notes: '' };

function ModelModal({ model, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState(model ? { ...model, inputPerMTok: String(model.inputPerMTok), outputPerMTok: String(model.outputPerMTok) } : EMPTY);
  const save = useMutation({
    mutationFn: () => {
      const common = { displayName: f.displayName, inputPerMTok: Number(f.inputPerMTok), outputPerMTok: Number(f.outputPerMTok), isActive: f.isActive, isDefault: f.isDefault, verified: f.verified, notes: f.notes };
      return model ? adminApi.patch(`/ai-models/${model.id}`, common) : adminApi.post('/ai-models', { ...common, provider: f.provider, modelId: f.modelId });
    },
    onSuccess: () => {
      toast.success('Saved');
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-models'] });
      onClose();
    },
  });
  const errs = apiFieldErrors(save.error);
  const check = (k, label) => (
    <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <Modal open onClose={onClose} title={model ? `Edit ${model.modelId}` : 'Add AI model'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        {save.isError && !Object.keys(errs).length && <Alert>{apiErrorMessage(save.error)}</Alert>}
        {!model && (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Provider" name="provider" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} options={[{ value: 'ANTHROPIC', label: 'Anthropic' }, { value: 'OPENAI', label: 'OpenAI' }]} />
            <Field label="API model ID" name="modelId" value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value.trim() })} error={errs.modelId} hint="Exactly as in the provider's docs" />
          </div>
        )}
        <Field label="Display name" name="displayName" maxLength={80} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} error={errs.displayName} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Input $ / 1M tokens" name="in" type="number" min={0} step="0.01" value={f.inputPerMTok} onChange={(e) => setF({ ...f, inputPerMTok: e.target.value })} error={errs.inputPerMTok} />
          <Field label="Output $ / 1M tokens" name="out" type="number" min={0} step="0.01" value={f.outputPerMTok} onChange={(e) => setF({ ...f, outputPerMTok: e.target.value })} error={errs.outputPerMTok} />
        </div>
        <Field label="Notes" name="notes" maxLength={300} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <div className="flex flex-wrap gap-4">
          {check('isActive', 'Active (companies can choose it)')}
          {check('isDefault', 'Default for this provider')}
          {check('verified', 'Model ID verified')}
        </div>
      </div>
    </Modal>
  );
}

export default function AiModelsPage() {
  useDocumentTitle('AI models');
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['admin', 'ai-models'], queryFn: async () => (await adminApi.get('/ai-models')).data.data.items });
  if (q.isLoading) return <LoadingState rows={5} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;

  return (
    <>
      <PageHeader title="AI models & prices" description="Prices are used for cost estimates (USD per 1 million tokens). Check the official pricing pages regularly." actions={<Button onClick={() => setEditing('new')}>Add model</Button>} />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-white/40">
              <tr><th className="py-2 pr-4">Provider</th><th className="pr-4">Model</th><th className="pr-4">Input</th><th className="pr-4">Output</th><th className="pr-4">Status</th><th className="pr-4">Updated</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {q.data.map((m) => (
                <tr key={m.id}>
                  <td className="py-3 pr-4">{m.provider}</td>
                  <td className="pr-4"><p>{m.displayName}</p><p className="font-mono text-xs text-white/45">{m.modelId}</p></td>
                  <td className="pr-4">${m.inputPerMTok}</td>
                  <td className="pr-4">${m.outputPerMTok}</td>
                  <td className="pr-4 space-x-1">
                    {m.isDefault && <Badge color="green">default</Badge>}
                    {!m.isActive && <Badge>off</Badge>}
                    {!m.verified && <Badge color="amber">ID not verified</Badge>}
                  </td>
                  <td className="pr-4 text-xs text-white/45">{formatDateTime(m.updatedAt)}</td>
                  <td className="text-right"><Button variant="ghost" className="px-3 py-1.5" onClick={() => setEditing(m)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-white/40">
          Official prices: <a className="underline" href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noopener noreferrer">Anthropic</a> ·{' '}
          <a className="underline" href="https://openai.com/api/pricing/" target="_blank" rel="noopener noreferrer">OpenAI</a>. A wrong model ID makes AI requests fail with “model not available”.
        </p>
      </Card>
      {editing && <ModelModal key={editing === 'new' ? 'new' : editing.id} model={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
