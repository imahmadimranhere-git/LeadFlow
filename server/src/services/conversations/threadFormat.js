// Pure: a thread as plain text (for the AI prompt, as DATA) and only the lead's own words (for fact-checks).
export const threadAsText = (items, { leadLabel = 'Lead', usLabel = 'Us' } = {}) =>
  items.map((m) => `[${new Date(m.at).toISOString().slice(0, 16).replace('T', ' ')}] ${m.direction === 'INBOUND' ? leadLabel : usLabel}: ${m.body}`).join('\n');

/** Only what the LEAD wrote — the evidence an AI statement about the lead may quote. */
export const inboundText = (items) => items.filter((m) => m.direction === 'INBOUND').map((m) => m.body).join('\n');
