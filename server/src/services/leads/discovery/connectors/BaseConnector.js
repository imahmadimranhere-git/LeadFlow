// Every lead source has its own connector implementing this interface (spec section 11 / A3).
// The discovery engine only talks to this interface → new sources = one new file, nothing else changes.
import { buildQueries } from '../queryBuilder.js';

export class ConnectorError extends Error {
  /** fatal = stop the whole run (e.g. key rejected); otherwise only this query failed */
  constructor(message, { fatal = false, retryable = false } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.fatal = fatal;
    this.retryable = retryable;
  }
}

export default class BaseConnector {
  constructor(source) {
    this.source = source;
  }

  /** What the UI shows about this source. */
  getCapabilities() {
    return { source: this.source, available: false, requires: null, note: 'Not available yet', availableInPhase: null };
  }

  getSourceMetadata() {
    return { source: this.source };
  }

  buildQueries(settings, opts) {
    return buildQueries(settings, this.source, opts);
  }

  /** Loads credentials etc. Throws ConnectorError if the source can't be used right now. */
  async authenticate() {
    throw new ConnectorError('This source is not available yet', { fatal: true });
  }

  /** One query → raw results from the source. */
  async search() {
    return [];
  }

  /** Raw result → { title, url, snippet } */
  normalize(raw) {
    return raw;
  }

  /** Milliseconds to wait between queries (respect the provider's rate limits). */
  get delayBetweenQueriesMs() {
    return 0;
  }
}
