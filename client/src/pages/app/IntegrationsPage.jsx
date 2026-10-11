// Company integrations: own API keys, stored encrypted. Keys are typed once and never shown again —
// only masked hints like sk-••••1234.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../../components/Toast.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import {
  Card, PageHeader, Badge, Button, Field, SelectField, Modal, Alert, LoadingState, ErrorState, DropdownMenu, Icon,
} from '../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';
import { MetaCard, WebhookCard } from '../../components/settings/SpecialIntegrations.jsx';

const META_ERRORS = {
  expired_or_invalid: 'The login took too long or was already used. Please try again.',
  invalid_state: 'The login link was not valid. Please try again.',
  invalid_request: 'Facebook sent back an unexpected answer. Please try again.',
  cancelled: 'Login was cancelled.',
  no_instagram_business_account: 'No Instagram Business/Creator account linked to your Facebook Pages was found.',
  meta_refused: 'Meta refused the connection. The server terminal shows Meta’s exact reason (line "security:oauth_failed").',
  redirect_uri_mismatch: 'Meta does not accept the return address. In your Meta app → Facebook Login for Business → Settings, add the redirect URI exactly: http://localhost:5000/api/v1/integrations/meta/oauth/callback (or your API_PUBLIC_URL + that path).',
  bad_app_secret: 'Meta rejected the App Secret. Copy it again from Meta app → App settings → Basic (no spaces) into META_APP_SECRET in server/.env, then restart the server.',
  bad_app_id: 'Meta does not know this App ID. Copy it again from Meta app → App settings → Basic into META_APP_ID in server/.env, then restart the server.',
  bad_graph_version: 'The Graph API version in META_GRAPH_VERSION is not valid. Use the version shown in Meta app → App settings → Advanced (e.g. v24.0), then restart the server.',
  missing_permission: 'Connected to Facebook, but Meta did not give the Pages/Instagram permission. In the Meta app add instagram_basic, pages_show_list and business_management, then connect again and keep every permission ON.',
  meta_unreachable: 'The server could not reach Meta (graph.facebook.com). Check your internet and try again.',
};

const CATEGORY_LABELS = { AI: 'AI', SEARCH: 'Search', SOCIAL: 'Social', MESSAGING: 'Messaging', EMAIL: 'Email', DATA: 'Data providers' };
const STATUS = {
  CONNECTED: ['green', 'Connected'],
  NOT_TESTED: ['blue', 'Not tested'],
  ERROR: ['red', 'Error'],
  DISABLED: ['gray', 'Disabled'],
};

function ConnectModal({ provider, existing, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(existing?.label || '');
  const [secrets, setSecrets] = useState(Object.fromEntries(provider.secretFields.map((f) => [f.key, ''])));
  const [config, setConfig] = useState(Object.fromEntries(provider.configFields.map((f) => [f.key, existing?.config?.[f.key] || (f.options ? f.options[0] : '')])));

  const save = useMutation({
    mutationFn: () => api.put(`/integrations/${provider.key}`, { label, credentials: secrets, config }),
    onSuccess: () => {
      toast.success(`${provider.name} saved. Run "Test connection" to check it.`);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      onClose();
    },
  });
  const errs = apiFieldErrors(save.error);
  const fieldError = (k) => errs[k] || errs[`credentials.${k}`] || errs[`config.${k}`];

  return (
    <Modal
      open
      onClose={onClose}
      title={`${existing ? 'Edit' : 'Connect'} ${provider.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save securely</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} autoComplete="off" noValidate>
        {provider.deprecated && <Alert>{provider.description}</Alert>}
        {save.isError && !Object.keys(errs).length && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <Field label="Label (optional)" name="label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        {provider.secretFields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            name={`secret-${f.key}`}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={secrets[f.key]}
            placeholder={existing?.maskedHints?.[f.key] ? `Saved: ${existing.maskedHints[f.key]} — leave empty to keep` : ''}
            onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value.trim() }))}
            error={fieldError(f.key)}
            hint={f.hint}
          />
        ))}
        {provider.configFields.map((f) =>
          f.options ? (
            <SelectField key={f.key} label={f.label} name={`cfg-${f.key}`} value={config[f.key]} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} options={f.options.map((o) => ({ value: o, label: o }))} error={fieldError(f.key)} />
          ) : (
            <Field key={f.key} label={f.label} name={`cfg-${f.key}`} type={f.type === 'email' ? 'email' : 'text'} placeholder={f.placeholder || ''} value={config[f.key]} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} error={fieldError(f.key)} />
          )
        )}
        <p className="flex items-start gap-2 text-xs text-white/40">
          <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
          Secrets are encrypted (AES-256-GCM) before they are stored and are never shown again — not even to admins.
        </p>
        {provider.docsUrl && (
          <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-500 hover:underline">Where do I get this? ↗</a>
        )}
      </form>
    </Modal>
  );
}

function ProviderCard({ provider, integration, onConnect }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations'] });

  const test = useMutation({
    mutationFn: async () => (await api.post(`/integrations/${provider.key}/test`)).data.data.result,
    onSuccess: (r) => {
      (r.ok ? toast.success : toast.error)(`${provider.name}: ${r.message}`);
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (enabled) => api.patch(`/integrations/${provider.key}/status`, { enabled }),
    onSuccess: refresh,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/integrations/${provider.key}`),
    onSuccess: () => {
      toast.success(`${provider.name} removed`);
      setConfirmDelete(false);
      refresh();
    },
  });

  const [color, text] = integration ? STATUS[integration.status] : [];
  const oauthLater = provider.connectType === 'OAUTH';

  return (
    <div className="flex flex-col rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{provider.name}</p>
          {integration?.label && <p className="text-xs text-white/40">{integration.label}</p>}
        </div>
        {integration ? <Badge color={color}>{text}</Badge> : provider.deprecated ? <Badge color="amber">Legacy</Badge> : null}
      </div>
      <p className="mt-2 flex-1 text-sm text-white/55">{provider.description}</p>

      {integration && (
        <dl className="mt-4 space-y-1 text-xs text-white/50">
          {Object.entries(integration.maskedHints).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2"><dt>{provider.secretFields.find((f) => f.key === k)?.label || k}</dt><dd className="font-mono text-white/70">{v}</dd></div>
          ))}
          <div className="flex justify-between gap-2"><dt>Last tested</dt><dd>{formatDateTime(integration.lastTestedAt)}</dd></div>
          <div className="flex justify-between gap-2"><dt>Last used</dt><dd>{formatDateTime(integration.lastUsedAt)}</dd></div>
          {integration.lastError && <p className="pt-1 text-red-300">{integration.lastError}</p>}
        </dl>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {provider.connectType === 'EXTENSION' ? (
          <Link to="/app/settings/extension" className="text-sm text-brand-500 underline">Set up the Chrome extension</Link>
        ) : oauthLater ? (
          <Badge>Login connection arrives in Phase {provider.availableInPhase}</Badge>
        ) : integration ? (
          <>
            <Button className="px-3 py-1.5" loading={test.isPending} disabled={integration.status === 'DISABLED'} onClick={() => test.mutate()}>Test connection</Button>
            <DropdownMenu
              label={`More actions for ${provider.name}`}
              trigger={<Icon name="list" className="h-4 w-4" />}
              items={[
                { label: 'Edit', onSelect: onConnect },
                { label: integration.status === 'DISABLED' ? 'Enable' : 'Disable', onSelect: () => toggle.mutate(integration.status === 'DISABLED') },
                { label: 'Remove', danger: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </>
        ) : (
          <Button variant="ghost" className="px-3 py-1.5" onClick={onConnect}>Connect</Button>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${provider.name}?`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
          </>
        }
      >
        <p className="text-sm text-white/70">The stored key is deleted permanently. Features using it stop working until you connect again.</p>
        <p className="mt-2 text-xs text-white/40">Tip: also revoke the key in the provider's own dashboard if you think it leaked.</p>
      </Modal>
    </div>
  );
}

export default function IntegrationsPage() {
  useDocumentTitle('Integrations');
  const [editing, setEditing] = useState(null);
  const providers = useQuery({ queryKey: ['integrations', 'providers'], queryFn: async () => (await api.get('/integrations/providers')).data.data.items, staleTime: Infinity });
  const mine = useQuery({ queryKey: ['integrations', 'list'], queryFn: async () => (await api.get('/integrations')).data.data.items });
  const webhook = useQuery({ queryKey: ['integrations', 'inbound-webhook'], queryFn: async () => (await api.get('/integrations/inbound-webhook')).data.data.webhook });
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  // Back from "Connect with Facebook"
  useEffect(() => {
    const result = params.get('meta');
    if (!result) return;
    if (result === 'connected') toast.success('Instagram connected');
    else toast.error(META_ERRORS[params.get('reason')] || 'Instagram could not be connected');
    setParams({}, { replace: true });
  }, [params, setParams, toast]);

  if (providers.isLoading || mine.isLoading) return <LoadingState rows={6} />;
  const error = providers.error || mine.error;
  if (error) return <ErrorState message={apiErrorMessage(error)} onRetry={() => { providers.refetch(); mine.refetch(); }} />;

  const byProvider = Object.fromEntries(mine.data.map((i) => [i.provider, i]));
  const categories = [...new Set(providers.data.map((p) => p.category))];

  return (
    <>
      <PageHeader title="Integrations" description="Connect your own accounts. Keys are encrypted and only ever shown masked." />
      <div className="space-y-8">
        {categories.map((cat) => (
          <section key={cat}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">{CATEGORY_LABELS[cat] || cat}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {providers.data.filter((p) => p.category === cat).map((p) => {
                if (p.key === 'META_GRAPH') return <MetaCard key={p.key} provider={p} integration={byProvider[p.key]} />;
                if (p.key === 'INBOUND_WEBHOOK') return <WebhookCard key={p.key} provider={p} integration={byProvider[p.key]} endpointUrl={webhook.data?.endpointUrl} />;
                return <ProviderCard key={p.key} provider={p} integration={byProvider[p.key]} onConnect={() => setEditing(p)} />;
              })}
            </div>
          </section>
        ))}
        <Card title="Your responsibility">
          <ul className="list-disc space-y-1 pl-5 text-sm text-white/60">
            <li>Use only accounts and data providers you are allowed to use, and follow each platform's terms.</li>
            <li>Give keys the smallest permissions possible, and set spending limits in AI provider dashboards.</li>
            <li>If a key may have leaked: revoke it at the provider, then paste the new one here.</li>
          </ul>
        </Card>
      </div>
      {editing && <ConnectModal key={editing.key} provider={editing} existing={byProvider[editing.key]} onClose={() => setEditing(null)} />}
    </>
  );
}
