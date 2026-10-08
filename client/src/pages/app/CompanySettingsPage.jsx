import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import useTenantSettings from '../../hooks/useTenantSettings.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { Card, PageHeader, LoadingState, ErrorState, Badge, Button, Alert } from '../../components/ui.jsx';
import { TagInput } from '../../components/forms.jsx';
import IndustryPackPicker from '../../components/settings/IndustryPackPicker.jsx';
import LogoUploader from '../../components/settings/LogoUploader.jsx';
import AiSettingsForm from '../../components/settings/AiSettingsForm.jsx';
import { ProfileForm, ServicesForm, IcpForm, DiscoveryForm, BrandForm } from '../../components/settings/sectionForms.jsx';
import { useMutation } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useSetSettings } from '../../hooks/useTenantSettings.js';
import { useToast } from '../../components/Toast.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { normalizePhrase, TEMPLATE_CHANNELS } from '../../utils/settingsOptions.js';
import { formatDate } from '../../utils/platform.js';

const TABS = [
  ['profile', 'Profile'],
  ['services', 'Services'],
  ['icp', 'Ideal customers'],
  ['discovery', 'Discovery'],
  ['brand', 'Brand'],
  ['pipeline', 'Pipeline'],
  ['ai', 'AI'],
  ['industry', 'Industry pack'],
];
const CHANNEL_LABEL = Object.fromEntries(TEMPLATE_CHANNELS);

function PipelineForm({ settings, readOnly }) {
  const [stages, setStages] = useState(settings.pipelineStages || []);
  const setSettings = useSetSettings();
  const toast = useToast();
  const save = useMutation({
    mutationFn: async () => (await api.patch('/settings/pipeline', { pipelineStages: stages })).data.data.settings,
    onSuccess: (s) => {
      setSettings(s);
      toast.success('Saved');
    },
  });
  return (
    <div className="space-y-4">
      <TagInput label="Pipeline stages (in order)" value={stages} onChange={setStages} normalize={normalizePhrase} max={15} disabled={readOnly} hint="Used by the Kanban pipeline (Phase 9). At least 2 stages; names must be unique." />
      {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
      {!readOnly && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>}
    </div>
  );
}

function StarterTemplates({ templates }) {
  if (!templates?.length) return <p className="text-sm text-white/40">No starter templates. Pick an industry pack to get some.</p>;
  return (
    <ul className="space-y-3">
      {templates.map((t) => (
        <li key={t.name} className="rounded-xl bg-ink-900 p-4 ring-1 ring-white/10">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="font-medium">{t.name}</p>
            <Badge>{CHANNEL_LABEL[t.channel] || t.channel}</Badge>
          </div>
          {t.subject && <p className="text-xs text-white/50">Subject: {t.subject}</p>}
          <p className="mt-1 whitespace-pre-wrap text-sm text-white/70">{t.body}</p>
        </li>
      ))}
    </ul>
  );
}

export default function CompanySettingsPage() {
  useDocumentTitle('Company settings');
  const { can } = useAuth();
  const settings = useTenantSettings();
  const [tab, setTab] = useState('profile');
  const readOnly = !can('tenant:update');

  if (settings.isLoading) return <LoadingState rows={8} />;
  if (settings.isError) return <ErrorState message={apiErrorMessage(settings.error)} onRetry={settings.refetch} />;
  const s = settings.data;
  const props = { settings: s, readOnly };

  return (
    <>
      <PageHeader
        title="Company settings"
        description={s.industryPack?.name ? `Industry: ${s.industryPack.name} · applied ${formatDate(s.industryPack.appliedAt)}` : 'Your company profile and how leads are found.'}
      />
      <div className="mb-6 -mx-1 flex gap-1 overflow-x-auto pb-1" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${tab === key ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* key → a fresh form each time the saved settings change */}
      <div key={`${tab}-${s.updatedAt}`} className="space-y-6">
        {tab === 'profile' && <Card title="Company profile"><ProfileForm {...props} /></Card>}
        {tab === 'services' && <Card title="Services & products"><ServicesForm {...props} /></Card>}
        {tab === 'icp' && <Card title="Ideal customer profile"><IcpForm {...props} /></Card>}
        {tab === 'discovery' && <Card title="Discovery terms"><DiscoveryForm {...props} /></Card>}
        {tab === 'brand' && (
          <>
            <Card title="Logo"><LogoUploader {...props} /></Card>
            <Card title="Brand voice & colour"><BrandForm {...props} /></Card>
          </>
        )}
        {tab === 'pipeline' && (
          <>
            <Card title="Pipeline stages"><PipelineForm {...props} /></Card>
            <Card title="Starter message templates"><StarterTemplates templates={s.messageTemplates} /></Card>
          </>
        )}
        {tab === 'ai' && <Card title="AI settings"><AiSettingsForm {...props} /></Card>}
        {tab === 'industry' && (
          <Card title="Industry pack">
            <IndustryPackPicker {...props} mode="MERGE" allowModeChoice submitLabel="Apply pack" />
          </Card>
        )}
      </div>
    </>
  );
}
