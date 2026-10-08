// GOOGLE_WEB source = general web search through an OFFICIAL search API with the company's own key:
//   1) Brave Search API (preferred)   2) Google Custom Search (legacy, shuts down 1 Jan 2027)
// No scraping of Google result pages. Every request goes through SafeFetch.
import BaseConnector, { ConnectorError } from './BaseConnector.js';
import { getCredentials } from '../../../integrations/vaultService.js';
import { safeFetch, SafeFetchError } from '../../../../utils/safeFetch.js';

const stripHtml = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

function mapHttpError(status) {
  if (status === 401 || status === 403) return new ConnectorError('The search provider rejected your API key — check Settings → Integrations', { fatal: true });
  if (status === 429) return new ConnectorError('Search provider rate limit reached — try again later', { retryable: true });
  return new ConnectorError(`Search provider error (HTTP ${status})`);
}

export default class WebSearchConnector extends BaseConnector {
  constructor() {
    super('GOOGLE_WEB');
    this.backend = null;
    this.creds = null;
  }

  getCapabilities() {
    return {
      source: this.source,
      available: true,
      requires: ['BRAVE_SEARCH', 'GOOGLE_SEARCH'],
      note: 'Uses the official Brave Search API (or a legacy Google Custom Search key) from your Integrations.',
      availableInPhase: null,
    };
  }

  async authenticate() {
    const brave = await getCredentials('BRAVE_SEARCH', { purpose: 'discovery' });
    if (brave) {
      this.backend = 'BRAVE';
      this.creds = brave;
      return;
    }
    const google = await getCredentials('GOOGLE_SEARCH', { purpose: 'discovery' });
    if (google) {
      this.backend = 'GOOGLE';
      this.creds = google;
      return;
    }
    throw new ConnectorError('Connect Brave Search in Settings → Integrations first', { fatal: true });
  }

  get delayBetweenQueriesMs() {
    return 1100; // Brave's free plan allows ~1 request per second
  }

  async search(query) {
    let url;
    let headers = { accept: 'application/json' };
    if (this.backend === 'BRAVE') {
      url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: '10', safesearch: 'moderate' })}`;
      headers = { ...headers, 'x-subscription-token': this.creds.secrets.apiKey };
    } else {
      url = `https://www.googleapis.com/customsearch/v1?${new URLSearchParams({ key: this.creds.secrets.apiKey, cx: this.creds.config.searchEngineId, q: query, num: '10' })}`;
    }
    let res;
    try {
      res = await safeFetch(url, { headers, timeoutMs: 15000, maxBytes: 2 * 1024 * 1024, allowedContentTypes: ['application/json'] });
    } catch (err) {
      if (err instanceof SafeFetchError && err.code === 'TIMEOUT') throw new ConnectorError('Search provider timed out', { retryable: true });
      throw new ConnectorError('Could not reach the search provider', { retryable: true });
    }
    if (res.status !== 200) throw mapHttpError(res.status);
    let data;
    try {
      data = res.json();
    } catch {
      throw new ConnectorError('Search provider sent an unreadable answer');
    }
    const items = this.backend === 'BRAVE' ? data?.web?.results || [] : data?.items || [];
    return items.slice(0, 20);
  }

  normalize(raw) {
    const url = this.backend === 'BRAVE' ? raw.url : raw.link;
    return {
      title: stripHtml(raw.title).slice(0, 300),
      url: typeof url === 'string' ? url.slice(0, 2048) : null,
      snippet: stripHtml(raw.description ?? raw.snippet).slice(0, 1000),
    };
  }
}
