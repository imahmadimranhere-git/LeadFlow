// Pick an Industry Pack → its suggestions are copied into the company's settings.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useSetSettings } from '../../hooks/useTenantSettings.js';
import { Alert, Button, Icon, LoadingState, ErrorState } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

export default function IndustryPackPicker({ settings, mode = 'REPLACE', allowModeChoice = false, submitLabel = 'Apply', secondary, onApplied, readOnly }) {
  const setSettings = useSetSettings();
  const [selected, setSelected] = useState(settings.industryPack?.packId || null);
  const [applyMode, setApplyMode] = useState(mode);
  const packs = useQuery({ queryKey: ['industry-packs'], queryFn: async () => (await api.get('/settings/industry-packs')).data.data.items });

  const apply = useMutation({
    mutationFn: async () => (await api.post('/settings/industry-pack', { packId: selected, mode: applyMode })).data.data.settings,
    onSuccess: (s) => {
      setSettings(s);
      onApplied?.(s);
    },
  });

  if (packs.isLoading) return <LoadingState rows={4} />;
  if (packs.isError) return <ErrorState message={apiErrorMessage(packs.error)} onRetry={packs.refetch} />;
  if (packs.data.length === 0) return <Alert type="info">No industry packs are available yet. You can set everything up manually.</Alert>;

  const chosen = packs.data.find((p) => p.id === selected);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Industry">
        {packs.data.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected === p.id}
            disabled={readOnly}
            onClick={() => setSelected(p.id)}
            className={`flex flex-col items-start rounded-xl p-4 text-left ring-1 transition ${selected === p.id ? 'bg-brand-500/10 ring-brand-500/60' : 'ring-white/10 hover:bg-white/5'}`}
          >
            <span className={`mb-3 grid h-10 w-10 place-items-center rounded-lg ${selected === p.id ? 'bg-brand-500 text-white' : 'bg-white/5 text-white/60'}`}>
              <Icon name={p.icon} />
            </span>
            <span className="font-medium">{p.name}</span>
            <span className="mt-1 text-xs text-white/50">{p.description}</span>
          </button>
        ))}
      </div>

      {chosen && (
        <div className="rounded-xl bg-ink-900 p-4 text-sm ring-1 ring-white/10">
          <p className="mb-2 font-medium">{chosen.name} will add:</p>
          <ul className="grid gap-1 text-white/60 sm:grid-cols-2">
            <li>{chosen.services.length} services</li>
            <li>{chosen.keywords.length} keywords</li>
            <li>{chosen.hashtags.length} hashtags {chosen.hashtags.slice(0, 3).map((h) => `#${h}`).join(' ')}</li>
            <li>{chosen.intentPhrases.length} buyer-intent phrases</li>
            <li>{chosen.negativeKeywords.length} negative keywords</li>
            <li>{chosen.messageTemplates.length} message templates</li>
          </ul>
          <p className="mt-2 text-xs text-white/40">Everything is copied into your settings — you can edit or delete any item afterwards.</p>
        </div>
      )}

      {allowModeChoice && !readOnly && (
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">How to apply</legend>
          <label className="flex items-center gap-2"><input type="radio" checked={applyMode === 'MERGE'} onChange={() => setApplyMode('MERGE')} /> Add to my current lists</label>
          <label className="flex items-center gap-2"><input type="radio" checked={applyMode === 'REPLACE'} onChange={() => setApplyMode('REPLACE')} /> Replace my current lists</label>
        </fieldset>
      )}

      {apply.isError && <Alert>{apiErrorMessage(apply.error)}</Alert>}
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>{secondary}</div>
          <Button loading={apply.isPending} disabled={!selected} onClick={() => apply.mutate()}>{submitLabel}</Button>
        </div>
      )}
    </div>
  );
}
