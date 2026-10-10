// Company AI settings (spec A21): provider, model, temperature, answer length, retries.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useSetSettings } from '../../hooks/useTenantSettings.js';
import { useToast } from '../Toast.jsx';
import { Button, Alert, SelectField, Field, LoadingState } from '../ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';

const PROVIDERS = [
  ['AUTO', 'Automatic — my own key first (OpenAI, then Anthropic)'],
  ['OPENAI', 'OpenAI'],
  ['ANTHROPIC', 'Anthropic (Claude)'],
];
const price = (m) => `$${m.inputPerMTok} in / $${m.outputPerMTok} out per 1M tokens`;

export default function AiSettingsForm({ settings, readOnly }) {
  const ai = settings.ai || {};
  const [f, setF] = useState({
    provider: ai.provider || 'AUTO',
    model: ai.model || '',
    temperature: ai.temperature ?? '',
    maxOutputTokens: ai.maxOutputTokens || 1000,
    maxRetries: ai.maxRetries ?? 1,
    monthlyBudgetUsd: ai.monthlyBudgetUsd ?? '',
    budgetAlertPercent: ai.budgetAlertPercent ?? 80,
    budgetHardStop: Boolean(ai.budgetHardStop),
  });
  const models = useQuery({ queryKey: ['ai', 'models'], queryFn: async () => (await api.get('/ai/models')).data.data.items, staleTime: 5 * 60_000 });
  const setSettings = useSetSettings();
  const toast = useToast();
  const save = useMutation({
    mutationFn: async () =>
      (await api.patch('/settings/ai', {
        provider: f.provider,
        model: f.provider === 'AUTO' || !f.model ? null : f.model,
        temperature: f.temperature === '' ? null : Number(f.temperature),
        maxOutputTokens: Number(f.maxOutputTokens),
        maxRetries: Number(f.maxRetries),
        monthlyBudgetUsd: f.monthlyBudgetUsd === '' ? null : Number(f.monthlyBudgetUsd),
        budgetAlertPercent: Number(f.budgetAlertPercent),
        budgetHardStop: f.budgetHardStop,
      })).data.data.settings,
    onSuccess: (s) => {
      setSettings(s);
      toast.success('AI settings saved');
    },
  });
  const errs = apiFieldErrors(save.error);
  if (models.isLoading) return <LoadingState rows={3} />;

  const forProvider = (models.data || []).filter((m) => m.provider === f.provider);
  const def = forProvider.find((m) => m.isDefault);

  return (
    <fieldset disabled={readOnly || save.isPending} className="space-y-4">
      {save.isError && !Object.keys(errs).length && <Alert>{apiErrorMessage(save.error)}</Alert>}
      <SelectField label="AI provider" name="provider" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value, model: '' })} options={PROVIDERS.map(([value, label]) => ({ value, label }))} />
      {f.provider !== 'AUTO' && (
        <SelectField
          label="Model"
          name="model"
          value={f.model}
          onChange={(e) => setF({ ...f, model: e.target.value })}
          error={errs.model}
          options={[
            { value: '', label: `Platform default${def ? ` — ${def.displayName} (${price(def)})` : ''}` },
            ...forProvider.map((m) => ({ value: m.modelId, label: `${m.displayName} — ${price(m)}${m.verified ? '' : ' · unverified'}` })),
          ]}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Temperature (empty = default)" name="temperature" type="number" min={0} max={1} step={0.1} value={f.temperature} onChange={(e) => setF({ ...f, temperature: e.target.value })} error={errs.temperature} hint="Lower = more predictable. Some models ignore it." />
        <Field label="Max answer tokens" name="maxOutputTokens" type="number" min={200} max={4000} step={100} value={f.maxOutputTokens} onChange={(e) => setF({ ...f, maxOutputTokens: e.target.value })} error={errs.maxOutputTokens} />
        <SelectField label="Retries on errors" name="maxRetries" value={f.maxRetries} onChange={(e) => setF({ ...f, maxRetries: e.target.value })} options={[0, 1, 2].map((n) => ({ value: n, label: String(n) }))} />
      </div>
      <div className="rounded-lg bg-white/[0.03] p-4 ring-1 ring-white/10">
        <p className="mb-3 text-sm font-medium">Monthly AI budget <span className="text-xs font-normal text-white/40">(estimated USD, your company's calendar month)</span></p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Budget in USD (empty = no budget)" name="monthlyBudgetUsd" type="number" min={0} step={0.5} value={f.monthlyBudgetUsd} onChange={(e) => setF({ ...f, monthlyBudgetUsd: e.target.value })} error={errs.monthlyBudgetUsd} />
          <SelectField label="Alert owners & admins at" name="budgetAlertPercent" value={f.budgetAlertPercent} onChange={(e) => setF({ ...f, budgetAlertPercent: e.target.value })} options={[50, 70, 80, 90, 100].map((n) => ({ value: n, label: `${n}% of the budget` }))} />
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-white/70">
          <input type="checkbox" className="mt-1" checked={f.budgetHardStop} onChange={(e) => setF({ ...f, budgetHardStop: e.target.checked })} />
          <span>Hard stop: refuse new AI requests once the budget is used up (otherwise you only get an alert). Requests already running can pass the line a little.</span>
        </label>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-xs text-white/45">
        <li>Your own key is added in <Link className="underline" to="/app/settings/integrations">Integrations</Link>. Its cost is billed by the AI provider to you.</li>
        <li>Prices shown are estimates from the platform's price list — the provider's bill is the real cost.</li>
        <li>Every AI request also counts against your plan's monthly AI requests and tokens.</li>
      </ul>
      {!readOnly && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>}
    </fieldset>
  );
}
