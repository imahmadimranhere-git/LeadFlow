// One form per settings section. Used by BOTH the onboarding wizard and the Company settings page.
// Each form keeps its own draft, saves only its own section (PATCH /settings/<section>),
// and puts the server's answer back into the cache.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useSetSettings } from '../../hooks/useTenantSettings.js';
import { useToast } from '../Toast.jsx';
import { Alert, Button, Field, TextArea } from '../ui.jsx';
import { TagInput, ToggleChips, ServicesEditor } from '../forms.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { LEAD_SOURCES, BRAND_TONES, COMPANY_SIZES, normalizeHashtag, normalizePhrase } from '../../utils/settingsOptions.js';
import { isReadableAccent, contrast } from '../../utils/color.js';

/** Shared save logic + footer for every section form. */
function useSectionSave(path, { toastOnSave }) {
  const setSettings = useSetSettings();
  const toast = useToast();
  return useMutation({
    mutationFn: async (body) => (await api.patch(`/settings/${path}`, body)).data.data.settings,
    onSuccess: (settings) => {
      setSettings(settings);
      if (toastOnSave) toast.success('Saved');
    },
  });
}

function Footer({ mutation, readOnly, submitLabel, secondary }) {
  const fieldErrors = apiFieldErrors(mutation.error);
  return (
    <div className="space-y-3 pt-2">
      {mutation.isError && (
        <Alert>
          {apiErrorMessage(mutation.error)}
          {Object.entries(fieldErrors).map(([f, m]) => (
            <span key={f} className="block text-xs">{f}: {m}</span>
          ))}
        </Alert>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>{secondary}</div>
          <Button type="submit" loading={mutation.isPending}>{submitLabel}</Button>
        </div>
      )}
    </div>
  );
}

const ReadOnlyNote = ({ readOnly }) =>
  readOnly ? <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-white/50">Only owners and admins can change these settings.</p> : null;

// ------------------------------------------------------------------ profile

export function ProfileForm({ settings, readOnly, submitLabel = 'Save', secondary, onSaved, toastOnSave = true }) {
  const p = settings.profile || {};
  const [f, setF] = useState({
    companyName: settings.companyName || '',
    description: p.description || '',
    website: p.website || '',
    email: p.email || '',
    phone: p.phone || '',
    address: p.address || '',
    country: p.country || '',
    city: p.city || '',
    socialLinks: { linkedin: '', facebook: '', instagram: '', x: '', youtube: '', ...Object.fromEntries(Object.entries(p.socialLinks || {}).map(([k, v]) => [k, v || ''])) },
  });
  const save = useSectionSave('profile', { toastOnSave });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setSocial = (k) => (e) => setF((x) => ({ ...x, socialLinks: { ...x.socialLinks, [k]: e.target.value } }));
  const errs = apiFieldErrors(save.error);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const { companyName, ...rest } = f;
        save.mutate({ ...rest, ...(companyName.trim() && { companyName: companyName.trim() }) }, { onSuccess: onSaved });
      }}
      noValidate
    >
      <ReadOnlyNote readOnly={readOnly} />
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" name="companyName" maxLength={120} value={f.companyName} onChange={set('companyName')} error={errs.companyName} />
          <Field label="Website" name="website" placeholder="https://" value={f.website} onChange={set('website')} error={errs.website} />
          <Field label="Business email" name="email" type="email" value={f.email} onChange={set('email')} error={errs.email} />
          <Field label="Phone" name="phone" value={f.phone} onChange={set('phone')} error={errs.phone} />
          <Field label="Country" name="country" maxLength={60} value={f.country} onChange={set('country')} />
          <Field label="City" name="city" maxLength={60} value={f.city} onChange={set('city')} />
        </div>
        <Field label="Address" name="address" maxLength={200} value={f.address} onChange={set('address')} />
        <TextArea label="What does your company do?" name="description" rows={3} maxLength={1000} value={f.description} onChange={set('description')} hint="Used later by AI to write messages in your words." />
        <details className="rounded-xl ring-1 ring-white/10">
          <summary className="cursor-pointer px-4 py-3 text-sm text-white/70">Social links</summary>
          <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
            {['linkedin', 'facebook', 'instagram', 'x', 'youtube'].map((k) => (
              <Field key={k} label={k === 'x' ? 'X (Twitter)' : k[0].toUpperCase() + k.slice(1)} name={`social-${k}`} placeholder="https://" value={f.socialLinks[k]} onChange={setSocial(k)} error={errs[`socialLinks.${k}`]} />
            ))}
          </div>
        </details>
      </fieldset>
      <Footer mutation={save} readOnly={readOnly} submitLabel={submitLabel} secondary={secondary} />
    </form>
  );
}

// ------------------------------------------------------------------ services

export function ServicesForm({ settings, readOnly, submitLabel = 'Save', secondary, onSaved, toastOnSave = true }) {
  const [services, setServices] = useState(settings.services?.map((s) => ({ name: s.name, description: s.description || '' })) || []);
  const save = useSectionSave('services', { toastOnSave });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ services: services.filter((s) => s.name.trim()) }, { onSuccess: onSaved });
      }}
      noValidate
    >
      <ReadOnlyNote readOnly={readOnly} />
      <p className="text-sm text-white/60">What do you sell? Leads are matched against these services.</p>
      <ServicesEditor value={services} onChange={setServices} disabled={readOnly} />
      <Footer mutation={save} readOnly={readOnly} submitLabel={submitLabel} secondary={secondary} />
    </form>
  );
}

// ------------------------------------------------------------------ ideal customer profile

export function IcpForm({ settings, readOnly, submitLabel = 'Save', secondary, onSaved, toastOnSave = true }) {
  const icp = settings.icp || {};
  const [f, setF] = useState({
    countries: icp.countries || [],
    cities: icp.cities || [],
    industries: icp.industries || [],
    businessTypes: icp.businessTypes || [],
    companySizes: icp.companySizes || [],
    targetRoles: icp.targetRoles || [],
  });
  const save = useSectionSave('icp', { toastOnSave });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(f, { onSuccess: onSaved }); }} noValidate>
      <ReadOnlyNote readOnly={readOnly} />
      <p className="text-sm text-white/60">Who is your ideal customer? Discovery and scoring use this.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <TagInput label="Countries" value={f.countries} onChange={set('countries')} normalize={normalizePhrase} max={50} placeholder="e.g. Pakistan" disabled={readOnly} />
        <TagInput label="Cities" value={f.cities} onChange={set('cities')} normalize={normalizePhrase} max={50} placeholder="e.g. Islamabad" disabled={readOnly} />
        <TagInput label="Industries" value={f.industries} onChange={set('industries')} normalize={normalizePhrase} max={50} placeholder="e.g. Restaurants" disabled={readOnly} />
        <TagInput label="Business types" value={f.businessTypes} onChange={set('businessTypes')} normalize={normalizePhrase} max={50} placeholder="e.g. Small business" disabled={readOnly} />
        <TagInput label="Target roles" value={f.targetRoles} onChange={set('targetRoles')} normalize={normalizePhrase} max={50} placeholder="e.g. Owner" disabled={readOnly} />
      </div>
      <ToggleChips label="Company size" options={COMPANY_SIZES.map((s) => [s, `${s} people`])} value={f.companySizes} onChange={set('companySizes')} disabled={readOnly} />
      <Footer mutation={save} readOnly={readOnly} submitLabel={submitLabel} secondary={secondary} />
    </form>
  );
}

// ------------------------------------------------------------------ discovery terms

export function DiscoveryForm({ settings, readOnly, submitLabel = 'Save', secondary, onSaved, toastOnSave = true }) {
  const d = settings.discovery || {};
  const [f, setF] = useState({
    keywords: d.keywords || [],
    hashtags: d.hashtags || [],
    intentPhrases: d.intentPhrases || [],
    negativeKeywords: d.negativeKeywords || [],
    preferredSources: d.preferredSources || [],
  });
  const save = useSectionSave('discovery', { toastOnSave });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const errs = apiFieldErrors(save.error);

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(f, { onSuccess: onSaved }); }} noValidate>
      <ReadOnlyNote readOnly={readOnly} />
      <TagInput label="Keywords" value={f.keywords} onChange={set('keywords')} normalize={normalizePhrase} placeholder="e.g. need a website" hint="Words people use when they need what you sell." disabled={readOnly} />
      <TagInput label="Hashtags" prefix="#" value={f.hashtags} onChange={set('hashtags')} normalize={normalizeHashtag} placeholder="e.g. needaplot" hint="Without spaces. # is added automatically." disabled={readOnly} error={errs['hashtags.0'] || errs.hashtags} />
      <TagInput label="Buyer-intent phrases" value={f.intentPhrases} onChange={set('intentPhrases')} normalize={normalizePhrase} placeholder='e.g. "looking for apartment"' hint="Only posts that really contain these are marked as buyer intent." disabled={readOnly} />
      <TagInput label="Negative keywords" value={f.negativeKeywords} onChange={set('negativeKeywords')} normalize={normalizePhrase} placeholder="e.g. job, free" hint="Results containing these are skipped." disabled={readOnly} />
      <ToggleChips label="Preferred lead sources" options={LEAD_SOURCES} value={f.preferredSources} onChange={set('preferredSources')} disabled={readOnly} />
      <p className="text-xs text-white/40">Which sources you can actually run depends on your plan and on the connections you add later (Phase 8+).</p>
      <Footer mutation={save} readOnly={readOnly} submitLabel={submitLabel} secondary={secondary} />
    </form>
  );
}

// ------------------------------------------------------------------ brand voice + colour

export function BrandForm({ settings, readOnly, submitLabel = 'Save', secondary, onSaved, toastOnSave = true }) {
  const [tone, setTone] = useState(settings.brandVoice?.tone || 'PROFESSIONAL');
  const [instructions, setInstructions] = useState(settings.brandVoice?.customInstructions || '');
  const [color, setColor] = useState(settings.branding?.accentColor || '');
  const voice = useSectionSave('brand-voice', { toastOnSave: false });
  const branding = useSectionSave('branding', { toastOnSave: false });
  const toast = useToast();

  const colorValid = !color || (/^#[0-9a-f]{6}$/i.test(color) && isReadableAccent(color));
  const busy = voice.isPending || branding.isPending;

  async function onSubmit(e) {
    e.preventDefault();
    await voice.mutateAsync({ tone, customInstructions: instructions });
    const current = settings.branding?.accentColor || null;
    const next = color || null;
    if (next !== current) await branding.mutateAsync({ accentColor: next });
    if (toastOnSave) toast.success('Saved');
    onSaved?.();
  }

  return (
    <form className="space-y-5" onSubmit={(e) => onSubmit(e).catch(() => {})} noValidate>
      <ReadOnlyNote readOnly={readOnly} />
      <fieldset disabled={readOnly}>
        <legend className="mb-2 text-sm font-medium text-white/80">Brand voice</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BRAND_TONES.map(([key, label, desc]) => (
            <label key={key} className={`cursor-pointer rounded-xl p-3 ring-1 ${tone === key ? 'bg-brand-500/10 ring-brand-500/50' : 'ring-white/10 hover:bg-white/5'}`}>
              <input type="radio" name="tone" value={key} checked={tone === key} onChange={() => setTone(key)} className="sr-only" />
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-white/50">{desc}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <TextArea
        label={tone === 'CUSTOM' ? 'Describe your style' : 'Extra style notes (optional)'}
        name="customInstructions"
        rows={3}
        maxLength={1000}
        value={instructions}
        disabled={readOnly}
        onChange={(e) => setInstructions(e.target.value)}
        hint='e.g. "Use simple English. Never promise prices. Mention we are based in Islamabad."'
      />

      <fieldset disabled={readOnly} className="space-y-2">
        <legend className="text-sm font-medium text-white/80">Brand colour</legend>
        <div className="flex flex-wrap items-center gap-3">
          <input type="color" aria-label="Pick brand colour" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#16a34a'} onChange={(e) => setColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg bg-transparent" />
          <input aria-label="Brand colour hex" value={color} placeholder="#16a34a (default)" maxLength={7} onChange={(e) => setColor(e.target.value.trim())} className="w-36 rounded-lg bg-ink-900 px-3 py-2 font-mono text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500" />
          {color && (
            <span className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(color) ? color : 'transparent' }}>
              Button preview
            </span>
          )}
          {color && !readOnly && <button type="button" className="text-xs text-white/50 hover:text-white" onClick={() => setColor('')}>Reset to default</button>}
        </div>
        {!colorValid && (
          <p className="text-xs text-amber-300">
            Hard to read{/^#[0-9a-f]{6}$/i.test(color) ? ` (contrast ${contrast(color, '#ffffff').toFixed(1)}:1 on white text)` : ''}. Pick a mid-tone colour.
          </p>
        )}
      </fieldset>

      {(voice.isError || branding.isError) && <Alert>{apiErrorMessage(voice.error || branding.error)}{apiFieldErrors(branding.error).accentColor && <span className="block text-xs">{apiFieldErrors(branding.error).accentColor}</span>}</Alert>}
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>{secondary}</div>
          <Button type="submit" loading={busy} disabled={!colorValid}>{submitLabel}</Button>
        </div>
      )}
    </form>
  );
}
