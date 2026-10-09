// Catalog of integrations a company can connect. Pure data:
//   secretFields → encrypted in the vault, NEVER returned to the browser (only masked hints)
//   configFields → non-secret settings (IDs, host names) — returned normally
// connectType 'OAUTH' providers are connected with a login popup (built with their connectors, Phase 11+).
export const PROVIDER_CATEGORIES = ['AI', 'SEARCH', 'SOCIAL', 'MESSAGING', 'EMAIL', 'DATA'];

export const INTEGRATION_PROVIDERS = {
  OPENAI: {
    name: 'OpenAI',
    category: 'AI',
    description: 'Your own OpenAI key for lead scoring, message writing and reply suggestions.',
    docsUrl: 'https://platform.openai.com/api-keys',
    connectType: 'API_KEY',
    secretFields: [{ key: 'apiKey', label: 'API key', pattern: '^sk-[A-Za-z0-9_\\-]{20,200}$', patternHint: 'Starts with sk-' }],
    configFields: [{ key: 'organizationId', label: 'Organization ID (optional)', required: false, pattern: '^org-[A-Za-z0-9]{6,64}$' }],
  },
  ANTHROPIC: {
    name: 'Anthropic (Claude)',
    category: 'AI',
    description: 'Your own Anthropic API key as an alternative AI provider.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    connectType: 'API_KEY',
    secretFields: [{ key: 'apiKey', label: 'API key', pattern: '^sk-ant-[A-Za-z0-9_\\-]{20,250}$', patternHint: 'Starts with sk-ant-' }],
    configFields: [],
  },
  GOOGLE_PLACES: {
    name: 'Google Places API (New)',
    category: 'SEARCH',
    description: 'Official Google Maps business search for Local Business discovery. Results are shown live; Google’s terms limit storing them.',
    docsUrl: 'https://developers.google.com/maps/documentation/places/web-service/text-search',
    connectType: 'API_KEY',
    secretFields: [{ key: 'apiKey', label: 'API key', pattern: '^AIza[0-9A-Za-z_\\-]{35}$', patternHint: 'Starts with AIza (39 characters)' }],
    configFields: [],
  },
  BRAVE_SEARCH: {
    name: 'Brave Search API',
    category: 'SEARCH',
    description: 'Official web search API for Google/Web-style lead discovery.',
    docsUrl: 'https://brave.com/search/api/',
    connectType: 'API_KEY',
    secretFields: [{ key: 'apiKey', label: 'Subscription token', pattern: '^[A-Za-z0-9_\\-]{16,128}$' }],
    configFields: [],
  },
  GOOGLE_SEARCH: {
    name: 'Google Custom Search (legacy)',
    category: 'SEARCH',
    description: 'Closed to new customers; Google is shutting it down on 1 Jan 2027. Only use an existing key.',
    docsUrl: 'https://developers.google.com/custom-search/v1/overview',
    connectType: 'API_KEY',
    deprecated: true,
    secretFields: [{ key: 'apiKey', label: 'API key', pattern: '^[A-Za-z0-9_\\-]{30,60}$' }],
    configFields: [{ key: 'searchEngineId', label: 'Search engine ID (cx)', required: true, pattern: '^[A-Za-z0-9:_\\-]{5,64}$' }],
  },
  SMTP: {
    name: 'Email (SMTP)',
    category: 'EMAIL',
    description: 'Send approved emails from your own mailbox (Gmail/Workspace, Outlook, Zoho, your host...).',
    docsUrl: null,
    connectType: 'API_KEY',
    secretFields: [{ key: 'password', label: 'Password / app password' }],
    configFields: [
      { key: 'host', label: 'SMTP host', required: true, pattern: '^[A-Za-z0-9.\\-]{3,253}$', placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', required: true, options: ['465', '587', '2525'] },
      { key: 'username', label: 'Username', required: true, maxLength: 254 },
      { key: 'fromEmail', label: 'From email', required: true, type: 'email' },
      { key: 'fromName', label: 'From name', required: false, maxLength: 80 },
    ],
  },
  WHATSAPP_CLOUD: {
    name: 'WhatsApp Cloud API',
    category: 'MESSAGING',
    description: 'Official Meta WhatsApp Business API. Receive customer messages in Conversations and reply within the 24-hour window. Webhook URL: <your API address>/api/v1/webhooks/whatsapp',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    connectType: 'API_KEY',
    secretFields: [
      { key: 'accessToken', label: 'Permanent access token', pattern: '^[A-Za-z0-9]{50,600}$' },
      { key: 'appSecret', label: 'App secret (needed to receive messages)', required: false, pattern: '^[a-f0-9]{32}$', patternHint: '32 characters from Meta app → Settings → Basic' },
    ],
    configFields: [
      { key: 'phoneNumberId', label: 'Phone number ID', required: true, pattern: '^[0-9]{6,30}$' },
      { key: 'businessAccountId', label: 'WhatsApp Business Account ID', required: true, pattern: '^[0-9]{6,30}$' },
      { key: 'webhookVerifyToken', label: 'Webhook verify token (any random text, 16+ characters)', required: false, pattern: '^[A-Za-z0-9_-]{16,64}$' },
    ],
  },
  DATA_PROVIDER: {
    name: 'Data provider (custom)',
    category: 'DATA',
    description: 'An authorized third-party lead/data API you have a contract with. You are responsible for its compliance.',
    docsUrl: null,
    connectType: 'API_KEY',
    secretFields: [{ key: 'apiKey', label: 'API key', pattern: '^[\\x21-\\x7e]{8,500}$' }],
    configFields: [
      { key: 'baseUrl', label: 'API base URL (https)', required: true, type: 'url', placeholder: 'https://api.provider.com' },
      { key: 'authHeader', label: 'Auth header name', required: true, pattern: '^[A-Za-z][A-Za-z0-9\\-]{1,40}$', placeholder: 'Authorization' },
      { key: 'testPath', label: 'Test path (GET)', required: false, pattern: '^/[A-Za-z0-9/_\\-.?=&]{0,200}$', placeholder: '/v1/status' },
    ],
  },
  META_GRAPH: {
    name: 'Instagram (via Meta)',
    category: 'SOCIAL',
    description: 'Official Instagram hashtag search for your Business/Creator account. Connected with "Login with Facebook".',
    docsUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/hashtag-search',
    connectType: 'OAUTH',
    availableInPhase: null,
    secretFields: [],
    configFields: [],
  },
  INBOUND_WEBHOOK: {
    name: 'Website forms (webhook)',
    category: 'DATA',
    description: 'Receive leads from your website forms, WordPress, Zapier or Make — signed, so nobody else can post fake leads.',
    docsUrl: null,
    connectType: 'GENERATED',
    secretFields: [],
    configFields: [],
  },
  LINKEDIN: {
    name: 'LinkedIn',
    category: 'SOCIAL',
    description: 'LinkedIn offers no public API to search posts or people (only for approved partners). Save LinkedIn leads with the Chrome extension while you browse.',
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access',
    connectType: 'EXTENSION',
    availableInPhase: null,
    secretFields: [],
    configFields: [],
  },
};

export const PROVIDER_KEYS = Object.keys(INTEGRATION_PROVIDERS);
export const INTEGRATION_STATUSES = ['NOT_TESTED', 'CONNECTED', 'ERROR', 'DISABLED'];

/** What the browser may see about the catalog (no internal regexes needed beyond hints). */
export function publicCatalog() {
  return PROVIDER_KEYS.map((key) => {
    const p = INTEGRATION_PROVIDERS[key];
    return {
      key,
      name: p.name,
      category: p.category,
      description: p.description,
      docsUrl: p.docsUrl,
      connectType: p.connectType,
      deprecated: Boolean(p.deprecated),
      availableInPhase: p.availableInPhase || null,
      secretFields: p.secretFields.map(({ key: k, label, patternHint }) => ({ key: k, label, hint: patternHint || null })),
      configFields: p.configFields.map(({ key: k, label, required, options, placeholder, type }) => ({ key: k, label, required: Boolean(required), options: options || null, placeholder: placeholder || null, type: type || 'text' })),
    };
  });
}
