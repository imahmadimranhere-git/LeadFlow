import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { Card, Badge, Spinner, Alert, Button, Field, SelectField, EmptyState } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { CURRENCIES, CONNECTORS, ERP_MODULES, LIMITS, formatMoney, formatLimit } from '../../utils/platform.js';

const toMinor = (major) => Math.round(Number(major || 0) * 100);
const toMajor = (minor) => String((Number(minor || 0) / 100));

function emptyForm() {
  return {
    code: '', name: '', description: '', currency: 'USD', priceMonthly: '0', priceYearly: '0', trialDays: '0',
    sortOrder: '0', isActive: true, isPublic: true, connectors: ['CSV'], erpModules: [],
    limits: Object.fromEntries(LIMITS.map(([k]) => [k, '0'])),
  };
}

function formFromPlan(p) {
  return {
    code: p.code, name: p.name, description: p.description || '', currency: p.currency,
    priceMonthly: toMajor(p.priceMonthlyMinor), priceYearly: toMajor(p.priceYearlyMinor),
    trialDays: String(p.trialDays), sortOrder: String(p.sortOrder), isActive: p.isActive, isPublic: p.isPublic,
    connectors: p.connectors, erpModules: p.erpModules,
    limits: Object.fromEntries(LIMITS.map(([k]) => [k, String(p.limits[k])])),
  };
}

function toPayload(f, isNew) {
  const body = {
    name: f.name.trim(),
    description: f.description.trim(),
    currency: f.currency,
    priceMonthlyMinor: toMinor(f.priceMonthly),
    priceYearlyMinor: toMinor(f.priceYearly),
    trialDays: Number(f.trialDays),
    sortOrder: Number(f.sortOrder),
    isActive: f.isActive,
    isPublic: f.isPublic,
    connectors: f.connectors,
    erpModules: f.erpModules,
    limits: Object.fromEntries(Object.entries(f.limits).map(([k, v]) => [k, Number(v)])),
  };
  if (isNew) body.code = f.code.trim().toLowerCase();
  return body;
}

function CheckboxGroup({ label, options, value, onChange }) {
  const toggle = (opt) => onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-white/80">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <label key={opt} className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs ring-1 ${value.includes(opt) ? 'bg-brand-500/15 text-brand-500 ring-brand-500/40' : 'text-white/60 ring-white/10'}`}>
            <input type="checkbox" className="sr-only" checked={value.includes(opt)} onChange={() => toggle(opt)} />
            {opt}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PlanEditor({ plan, onClose }) {
  const queryClient = useQueryClient();
  const isNew = !plan;
  const [f, setF] = useState(isNew ? emptyForm() : formFromPlan(plan));
  const set = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const m = useMutation({
    mutationFn: (body) => (isNew ? adminApi.post('/plans', body) : adminApi.patch(`/plans/${plan.id}`, body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      onClose();
    },
  });

  return (
    <Card title={isNew ? 'New plan' : `Edit plan: ${plan.name}`} action={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); m.mutate(toPayload(f, isNew)); }}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isNew && <Field label="Code (permanent)" name="code" value={f.code} onChange={set('code')} hint="e.g. starter-pk" />}
          <Field label="Name" name="name" value={f.name} onChange={set('name')} />
          <SelectField label="Currency" name="currency" value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <Field label="Monthly price" name="priceMonthly" type="number" min="0" step="0.01" value={f.priceMonthly} onChange={set('priceMonthly')} />
          <Field label="Yearly price" name="priceYearly" type="number" min="0" step="0.01" value={f.priceYearly} onChange={set('priceYearly')} />
          <Field label="Trial days" name="trialDays" type="number" min="0" max="90" value={f.trialDays} onChange={set('trialDays')} />
          <Field label="Sort order" name="sortOrder" type="number" min="0" value={f.sortOrder} onChange={set('sortOrder')} />
        </div>
        <Field label="Description" name="description" value={f.description} maxLength={500} onChange={set('description')} />

        <div>
          <p className="mb-2 text-sm font-medium text-white/80">Limits <span className="text-white/40">(-1 = unlimited)</span></p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LIMITS.map(([key, label]) => (
              <Field
                key={key}
                label={label}
                name={`limit-${key}`}
                type="number"
                min="-1"
                value={f.limits[key]}
                onChange={(e) => setF((prev) => ({ ...prev, limits: { ...prev.limits, [key]: e.target.value } }))}
              />
            ))}
          </div>
        </div>

        <CheckboxGroup label="Lead sources (connectors)" options={CONNECTORS} value={f.connectors} onChange={(v) => setF((p) => ({ ...p, connectors: v }))} />
        <CheckboxGroup label="ERP modules" options={ERP_MODULES} value={f.erpModules} onChange={(v) => setF((p) => ({ ...p, erpModules: v }))} />

        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /> Active (can be assigned)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isPublic} onChange={set('isPublic')} /> Public (shown on pricing page)</label>
        </div>

        {m.isError && (
          <Alert>
            {apiErrorMessage(m.error)}
            {(m.error?.response?.data?.errors || []).map((er) => (
              <span key={`${er.field}-${er.message}`} className="block text-xs">{er.field}: {er.message}</span>
            ))}
          </Alert>
        )}
        <Button type="submit" loading={m.isPending}>{isNew ? 'Create plan' : 'Save changes'}</Button>
      </form>
    </Card>
  );
}

export default function PlansPage() {
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, plan = edit
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: async () => (await adminApi.get('/plans')).data.data.items,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Plans</h1>
        {editing === undefined && <Button onClick={() => setEditing(null)}>New plan</Button>}
      </div>

      {editing !== undefined && <PlanEditor key={editing?.id || 'new'} plan={editing} onClose={() => setEditing(undefined)} />}

      {isLoading && <Spinner />}
      {isError && <Alert>{apiErrorMessage(error)}</Alert>}
      {data && data.length === 0 && <EmptyState>No plans yet. Run "npm run seed" or create one.</EmptyState>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((p) => (
          <Card
            key={p.id}
            title={p.name}
            action={<Button variant="ghost" className="px-3 py-1.5" onClick={() => setEditing(p)}>Edit</Button>}
          >
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge color={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
              {!p.isPublic && <Badge>Hidden</Badge>}
              <Badge color="blue">{p.code}</Badge>
            </div>
            <p className="text-lg font-semibold">{formatMoney(p.priceMonthlyMinor, p.currency)} <span className="text-sm font-normal text-white/50">/ month</span></p>
            <p className="text-xs text-white/40">{formatMoney(p.priceYearlyMinor, p.currency)} / year · {p.trialDays} trial days</p>
            <ul className="mt-4 space-y-1 text-sm text-white/70">
              {LIMITS.map(([key, label]) => (
                <li key={key} className="flex justify-between gap-2"><span className="text-white/50">{label}</span><span>{formatLimit(p.limits[key])}</span></li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
