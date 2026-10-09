// Your scoring formula: how much each factor counts (0–100). Saving recalculates all scored leads
// from their saved analysis — no new AI cost.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useSetSettings } from '../../hooks/useTenantSettings.js';
import { useToast } from '../Toast.jsx';
import { Button, Alert } from '../ui.jsx';
import { FACTOR_LABEL } from '../leads/ScoringPanel.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

const HINT = {
  explicitBuyerIntent: 'AI · needs an exact quote (e.g. "looking for a web developer")',
  businessRelevance: 'AI · a business you could serve',
  serviceMatch: 'AI · need matches one of your services',
  publicActivity: 'AI · recent, active',
  evidenceStrength: 'AI · how clear the evidence is',
  locationMatch: 'Your data · city/country in your Ideal customers',
  industryMatch: 'Your data · industry in your Ideal customers',
  contactability: 'Your data · email/phone/website/profile',
  profileCompleteness: 'Your data · fields filled',
  websiteCondition: 'Website audit · WEAKER site = HIGHER value (opportunity for web/SEO). Set 0 if you don’t sell that',
};

export default function ScoringWeightsForm({ settings, readOnly }) {
  const [w, setW] = useState({ ...settings.scoringWeights });
  const setSettings = useSetSettings();
  const queryClient = useQueryClient();
  const toast = useToast();
  const total = Object.values(w).reduce((a, b) => a + Number(b || 0), 0);
  const save = useMutation({
    mutationFn: async () => (await api.patch('/settings/scoring', { scoringWeights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v)])) })).data.data.settings,
    onSuccess: (s) => {
      setSettings(s);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Saved — scores recalculated (no AI cost)');
    },
  });

  return (
    <fieldset disabled={readOnly || save.isPending} className="space-y-3">
      {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
      {Object.keys(FACTOR_LABEL).map((k) => (
        <div key={k} className="grid items-center gap-2 sm:grid-cols-[1fr_200px_60px]">
          <label htmlFor={`w-${k}`} className="text-sm">
            {FACTOR_LABEL[k]}
            <span className="block text-xs text-white/40">{HINT[k]}</span>
          </label>
          <input id={`w-${k}`} type="range" min={0} max={100} step={5} value={w[k] ?? 0} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="accent-brand-500" />
          <span className="text-right text-sm tabular-nums">{w[k] ?? 0} <span className="text-xs text-white/40">({total ? Math.round(((w[k] || 0) / total) * 100) : 0}%)</span></span>
        </div>
      ))}
      <p className="text-xs text-white/45">Score = Σ (weight × factor 0–10) ÷ Σ (weight × 10) × 100, over the factors that have data. The AI never chooses the number.</p>
      {!readOnly && <div className="flex justify-end"><Button loading={save.isPending} disabled={total === 0} onClick={() => save.mutate()}>Save & recalculate</Button></div>}
    </fieldset>
  );
}
