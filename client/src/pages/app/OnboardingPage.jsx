// First-run wizard for a new company. Every step saves immediately, so the owner can stop
// half-way and continue later; "Skip" ends the wizard and everything stays editable in Settings.
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import useTenantSettings, { useSetSettings } from '../../hooks/useTenantSettings.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { Logo, Button, FullPageLoader, ErrorState } from '../../components/ui.jsx';
import IndustryPackPicker from '../../components/settings/IndustryPackPicker.jsx';
import { ProfileForm, ServicesForm, IcpForm, DiscoveryForm, BrandForm } from '../../components/settings/sectionForms.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

const STEPS = [
  { key: 'industry', title: 'What is your industry?', description: 'We pre-fill services, keywords, hashtags and templates for you. You can change everything later.' },
  { key: 'company', title: 'Tell us about your company', description: 'Basic details used in messages, quotes and invoices.' },
  { key: 'services', title: 'What do you sell?', description: 'Leads are matched against these services.' },
  { key: 'icp', title: 'Who is your ideal customer?', description: 'Countries, cities and types of customers you want.' },
  { key: 'discovery', title: 'How should we find them?', description: 'Keywords, hashtags and buyer-intent phrases to look for.' },
  { key: 'brand', title: 'How should your messages sound?', description: 'Your brand voice and colour.' },
];

export default function OnboardingPage() {
  useDocumentTitle('Set up your workspace');
  const { can, access } = useAuth();
  const navigate = useNavigate();
  const settings = useTenantSettings();
  const setSettings = useSetSettings();
  const [step, setStep] = useState(0);

  const finish = useMutation({
    mutationFn: async (skipped) => (await api.post('/settings/onboarding/complete', { skipped })).data.data.settings,
    onSuccess: (s) => {
      setSettings(s);
      navigate('/app', { replace: true });
    },
  });

  if (access !== 'FULL' || !can('tenant:update')) return <Navigate to="/app" replace />;
  if (settings.isLoading) return <FullPageLoader />;
  if (settings.isError) return <ErrorState message={apiErrorMessage(settings.error)} onRetry={settings.refetch} />;
  if (!settings.data.onboardingRequired && !finish.isPending) return <Navigate to="/app" replace />;

  const s = settings.data;
  const current = STEPS[step];
  const next = () => setStep((i) => Math.min(i + 1, STEPS.length - 1));
  const back = step > 0 ? <Button variant="ghost" onClick={() => setStep((i) => i - 1)}>Back</Button> : null;
  const isLast = step === STEPS.length - 1;
  const formProps = { settings: s, toastOnSave: false, secondary: back, submitLabel: isLast ? 'Finish setup' : 'Save & continue', onSaved: isLast ? () => finish.mutate(false) : next };

  return (
    <div className="min-h-screen bg-ink-900 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-8">
        <Logo />
        <button type="button" className="text-sm text-white/50 hover:text-white" disabled={finish.isPending} onClick={() => finish.mutate(true)}>
          Skip for now
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {/* progress */}
        <ol className="mb-8 flex gap-1.5" aria-label="Progress">
          {STEPS.map((st, i) => (
            <li key={st.key} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-500' : 'bg-white/10'}`}>
              <span className="sr-only">{`Step ${i + 1}: ${st.title}${i === step ? ' (current)' : ''}`}</span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-brand-500">Step {step + 1} of {STEPS.length}</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{current.title}</h1>
        <p className="mt-2 text-white/60">{current.description}</p>

        <section className="mt-8 rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10 sm:p-7">
          {/* key={step} → each form starts from the latest saved settings */}
          <div key={current.key}>
            {current.key === 'industry' && (
              <IndustryPackPicker
                settings={s}
                mode="REPLACE"
                submitLabel="Use this industry"
                onApplied={next}
                secondary={<button type="button" className="text-sm text-white/50 hover:text-white" onClick={next}>I'll set it up myself</button>}
              />
            )}
            {current.key === 'company' && <ProfileForm {...formProps} />}
            {current.key === 'services' && <ServicesForm {...formProps} />}
            {current.key === 'icp' && <IcpForm {...formProps} />}
            {current.key === 'discovery' && <DiscoveryForm {...formProps} />}
            {current.key === 'brand' && <BrandForm {...formProps} />}
          </div>
          {finish.isError && <p className="mt-4 text-sm text-red-300">{apiErrorMessage(finish.error)}</p>}
        </section>
      </main>
    </div>
  );
}
