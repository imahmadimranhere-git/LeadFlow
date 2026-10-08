// Integrations that are not "paste a key":
//  - Instagram (Meta): "Connect with Facebook" login (OAuth). The token never reaches the browser.
//  - Website forms webhook: the platform generates a URL + secret; the secret is shown ONCE.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Badge, Button, Modal, Alert, SelectField, DropdownMenu, Icon } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const STATUS = { CONNECTED: ['green', 'Connected'], NOT_TESTED: ['blue', 'Connected'], ERROR: ['red', 'Needs attention'], DISABLED: ['gray', 'Disabled'] };

function Shell({ provider, integration, children }) {
  const [color, text] = integration ? STATUS[integration.status] : [];
  return (
    <div className="flex flex-col rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{provider.name}</p>
          {integration?.label && <p className="text-xs text-white/40">{integration.label}</p>}
        </div>
        {integration && <Badge color={color}>{text}</Badge>}
      </div>
      <p className="mt-2 flex-1 text-sm text-white/55">{provider.description}</p>
      {children}
    </div>
  );
}

function useCommon(provider) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations'] });
  const toggle = useMutation({ mutationFn: (enabled) => api.patch(`/integrations/${provider.key}/status`, { enabled }), onSuccess: refresh, onError: (e) => toast.error(apiErrorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.delete(`/integrations/${provider.key}`), onSuccess: () => { toast.success(`${provider.name} removed`); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e)) });
  return { toast, refresh, toggle, remove };
}

export function MetaCard({ provider, integration }) {
  const { toast, refresh, toggle, remove } = useCommon(provider);
  const [confirm, setConfirm] = useState(false);
  const connect = useMutation({
    mutationFn: async () => (await api.post('/integrations/meta/oauth/start')).data.data.authUrl,
    onSuccess: (url) => {
      // only ever leave the app for Facebook's own login page
      if (/^https:\/\/www\.facebook\.com\//.test(url)) window.location.assign(url);
      else toast.error('Unexpected login address');
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const choose = useMutation({ mutationFn: (igUserId) => api.put('/integrations/meta/account', { igUserId }), onSuccess: refresh, onError: (e) => toast.error(apiErrorMessage(e)) });

  let accounts = [];
  try {
    accounts = JSON.parse(integration?.config?.accounts || '[]');
  } catch {
    accounts = [];
  }

  return (
    <Shell provider={provider} integration={integration}>
      {integration && (
        <dl className="mt-4 space-y-1 text-xs text-white/50">
          {integration.config?.pageName && <div className="flex justify-between gap-2"><dt>Facebook Page</dt><dd className="text-white/70">{integration.config.pageName}</dd></div>}
          {integration.config?.tokenExpiresAt && <div className="flex justify-between gap-2"><dt>Login valid until</dt><dd>{formatDateTime(integration.config.tokenExpiresAt)}</dd></div>}
          <div className="flex justify-between gap-2"><dt>Last used</dt><dd>{formatDateTime(integration.lastUsedAt)}</dd></div>
          {integration.lastError && <p className="pt-1 text-red-300">{integration.lastError}</p>}
        </dl>
      )}
      {accounts.length > 1 && (
        <div className="mt-3">
          <SelectField label="Instagram account to use" name="igAccount" value={integration.config.igUserId} onChange={(e) => choose.mutate(e.target.value)} options={accounts.map((a) => ({ value: a.igUserId, label: `@${a.igUsername} (${a.pageName})` }))} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button className="px-3 py-1.5" variant={integration ? 'ghost' : 'primary'} loading={connect.isPending} onClick={() => connect.mutate()}>
          {integration ? 'Reconnect' : 'Connect with Facebook'}
        </Button>
        {integration && (
          <DropdownMenu
            label={`More actions for ${provider.name}`}
            trigger={<Icon name="list" className="h-4 w-4" />}
            items={[
              { label: integration.status === 'DISABLED' ? 'Enable' : 'Disable', onSelect: () => toggle.mutate(integration.status === 'DISABLED') },
              { label: 'Remove', danger: true, onSelect: () => setConfirm(true) },
            ]}
          />
        )}
      </div>
      {!integration && (
        <p className="mt-3 text-xs text-white/40">Needs an Instagram <strong>Business or Creator</strong> account linked to a Facebook Page.</p>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Disconnect Instagram?" size="sm" footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => { remove.mutate(); setConfirm(false); }}>Disconnect</Button></>}>
        <p className="text-sm text-white/70">Hashtag watches stop working. Also remove the app in Facebook → Settings → Business integrations to fully revoke access.</p>
      </Modal>
    </Shell>
  );
}

function CopyRow({ label, value, secret }) {
  const toast = useToast();
  return (
    <div>
      <p className="text-xs text-white/45">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className={`min-w-0 flex-1 break-all rounded-lg bg-ink-900 px-3 py-2 text-xs ring-1 ${secret ? 'ring-amber-500/40' : 'ring-white/10'}`}>{value}</code>
        <Button variant="ghost" className="px-3 py-1.5" onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success('Copied'), () => toast.error('Copy failed — select and copy by hand'))}>Copy</Button>
      </div>
    </div>
  );
}

const SNIPPET = (url) => `// Node.js example — run this on YOUR server (never put the secret in browser code)
import crypto from 'node:crypto';

const body = JSON.stringify({
  id: 'form-' + Date.now(),           // unique per submission (duplicates are ignored)
  name: 'Sara Khan', email: 'sara@example.com', phone: '+92 300 1234567',
  company: 'Khan Traders', city: 'Lahore', message: 'We need a new website',
  pageUrl: 'https://your-site.com/contact', consent: true, consentText: 'I agree to be contacted',
});
const t = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', process.env.LEADFLOW_WEBHOOK_SECRET).update(t + '.' + body).digest('hex');

await fetch('${url}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-LeadFlow-Signature': 't=' + t + ',v1=' + sig },
  body,
});`;

export function WebhookCard({ provider, integration, endpointUrl }) {
  const { toast, refresh, toggle, remove } = useCommon(provider);
  const [shown, setShown] = useState(null); // { endpointUrl, secret } — only right after create/rotate
  const [confirm, setConfirm] = useState(null); // 'rotate' | 'remove'
  const create = useMutation({ mutationFn: async () => (await api.post('/integrations/inbound-webhook')).data.data, onSuccess: (d) => { setShown(d); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e)) });
  const rotate = useMutation({ mutationFn: async () => (await api.post('/integrations/inbound-webhook/rotate')).data.data, onSuccess: (d) => { setShown(d); setConfirm(null); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e)) });

  return (
    <Shell provider={provider} integration={integration}>
      {integration && endpointUrl && (
        <div className="mt-4 space-y-2">
          <CopyRow label="Your webhook URL" value={endpointUrl} />
          <p className="text-xs text-white/45">Secret: <span className="font-mono text-white/70">{integration.maskedHints?.secret}</span> · last lead {formatDateTime(integration.lastUsedAt)}</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {integration ? (
          <>
            <Button variant="ghost" className="px-3 py-1.5" onClick={() => setShown({ endpointUrl, secret: null })}>How to send leads</Button>
            <DropdownMenu
              label={`More actions for ${provider.name}`}
              trigger={<Icon name="list" className="h-4 w-4" />}
              items={[
                { label: 'Rotate secret', onSelect: () => setConfirm('rotate') },
                { label: integration.status === 'DISABLED' ? 'Enable' : 'Disable', onSelect: () => toggle.mutate(integration.status === 'DISABLED') },
                { label: 'Remove', danger: true, onSelect: () => setConfirm('remove') },
              ]}
            />
          </>
        ) : (
          <Button className="px-3 py-1.5" variant="ghost" loading={create.isPending} onClick={() => create.mutate()}>Create webhook URL</Button>
        )}
      </div>

      <Modal open={Boolean(shown)} onClose={() => setShown(null)} title="Send leads from your website" size="lg" footer={<Button onClick={() => setShown(null)}>Done</Button>}>
        {shown && (
          <div className="space-y-4">
            <CopyRow label="Webhook URL" value={shown.endpointUrl} />
            {shown.secret && (
              <>
                <CopyRow label="Signing secret" value={shown.secret} secret />
                <Alert>Copy the secret now — it is shown only this once. Keep it on your server (environment variable), never in website JavaScript.</Alert>
              </>
            )}
            <p className="text-sm text-white/60">
              Every request must be signed: header <code>X-LeadFlow-Signature: t=…,v1=…</code> = HMAC-SHA256 of <code>t + "." + body</code> with your secret.
              Requests older than 5 minutes, or with a wrong signature, are refused. Each submission needs a unique <code>id</code>.
            </p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-ink-900 p-3 text-xs text-white/80 ring-1 ring-white/10">{SNIPPET(shown.endpointUrl)}</pre>
            <p className="text-xs text-white/40">Fields: id (required), name, email, phone, company, city, website, message, pageUrl, formName, consent (true/false), consentText, fields (up to 20 extra text values). Zapier/Make: use a “Code” step to sign.</p>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm === 'rotate' ? 'Create a new secret?' : 'Remove the webhook?'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" loading={rotate.isPending || remove.isPending} onClick={() => (confirm === 'rotate' ? rotate.mutate() : (remove.mutate(), setConfirm(null)))}>
              {confirm === 'rotate' ? 'Rotate' : 'Remove'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-white/70">
          {confirm === 'rotate' ? 'The old secret stops working immediately. Update your website/Zapier with the new one.' : 'The URL stops working immediately. Signals already received stay in the inbox.'}
        </p>
      </Modal>
    </Shell>
  );
}
