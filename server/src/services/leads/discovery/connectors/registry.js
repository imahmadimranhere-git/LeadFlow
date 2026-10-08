// Which connector handles which source. Sources that need their own official API/OAuth are listed
// honestly as "not available yet" with the phase they arrive in.
import BaseConnector from './BaseConnector.js';
import WebSearchConnector from './WebSearchConnector.js';

class PlannedConnector extends BaseConnector {
  constructor(source, note, availableInPhase) {
    super(source);
    this.note = note;
    this.phase = availableInPhase;
  }

  getCapabilities() {
    return { source: this.source, available: false, requires: null, note: this.note, availableInPhase: this.phase };
  }
}

/** Sources that don't use one-off "runs": they work continuously in another place of the app. */
class ElsewhereConnector extends BaseConnector {
  constructor(source, note, handledBy) {
    super(source);
    this.note = note;
    this.handledBy = handledBy;
  }

  getCapabilities() {
    return { source: this.source, available: false, requires: null, note: this.note, availableInPhase: null, handledBy: this.handledBy };
  }
}

const factories = {
  GOOGLE_WEB: () => new WebSearchConnector(),
  CSV: () => new PlannedConnector('CSV', 'Use the CSV import tab.', null),
  LOCAL_BUSINESS: () => new PlannedConnector('LOCAL_BUSINESS', 'Needs an official places/business data API (e.g. Google Places) — added as its own integration later.', 16),
  INSTAGRAM: () => new ElsewhereConnector('INSTAGRAM', 'Official Instagram hashtag search runs on a schedule — set it up in Hashtag watches (needs Instagram connected).', '/app/hashtag-watches'),
  FACEBOOK: () => new ElsewhereConnector('FACEBOOK', 'Meta offers NO public Facebook post/hashtag search. Facebook Lead Ads forms can reach you through the website-forms webhook (e.g. via Zapier or Make).', '/app/settings/integrations'),
  LINKEDIN: () => new ElsewhereConnector('LINKEDIN', 'LinkedIn has no public post/people search API for normal apps. Save LinkedIn posts and profiles you are viewing with the Chrome extension.', '/app/settings/extension'),
  CHROME_EXTENSION: () => new ElsewhereConnector('CHROME_EXTENSION', 'Save a lead from the page you are looking at — Instagram, Facebook, LinkedIn or any website.', '/app/settings/extension'),
  DATA_PROVIDER: () => new PlannedConnector('DATA_PROVIDER', 'Your authorized data provider (Integrations) — mapping per provider.', 16),
  WEBHOOK: () => new ElsewhereConnector('WEBHOOK', 'Website forms, WordPress, Zapier or Make send leads to your private signed URL → Signals inbox.', '/app/settings/integrations'),
};

const overrides = new Map(); // tests replace connectors here

export function getConnector(source) {
  if (overrides.has(source)) return overrides.get(source)();
  const make = factories[source];
  return make ? make() : null;
}

export function registerConnector(source, factory) {
  overrides.set(source, factory);
}

export function listCapabilities() {
  return Object.keys(factories).map((s) => getConnector(s).getCapabilities());
}
