// UI copies of option lists (the server validates the real values).
export const LEAD_SOURCES = [
  ['CSV', 'CSV import'],
  ['GOOGLE_WEB', 'Google / Web'],
  ['LOCAL_BUSINESS', 'Local businesses'],
  ['INSTAGRAM', 'Instagram'],
  ['FACEBOOK', 'Facebook'],
  ['LINKEDIN', 'LinkedIn'],
  ['CHROME_EXTENSION', 'Chrome extension'],
  ['DATA_PROVIDER', 'Data provider'],
  ['WEBHOOK', 'Webhook / forms'],
];
export const BRAND_TONES = [
  ['PROFESSIONAL', 'Professional', 'Clear, polite and business-like.'],
  ['FRIENDLY', 'Friendly', 'Warm and conversational.'],
  ['TECHNICAL', 'Technical', 'Precise, with specific details.'],
  ['CONCISE', 'Concise', 'Short and to the point.'],
  ['CUSTOM', 'Custom', 'Describe your own style below.'],
];
export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
export const TEMPLATE_CHANNELS = [
  ['EMAIL', 'Email'],
  ['LINKEDIN', 'LinkedIn'],
  ['INSTAGRAM_DM', 'Instagram DM'],
  ['FACEBOOK_MESSAGE', 'Facebook message'],
  ['WHATSAPP', 'WhatsApp'],
  ['GENERAL', 'General'],
];
export const SCORING_FACTORS = [
  ['explicitBuyerIntent', 'Explicit buyer intent'],
  ['websiteCondition', 'Website condition'],
  ['businessRelevance', 'Business relevance'],
  ['serviceMatch', 'Service match'],
  ['industryMatch', 'Industry match'],
  ['locationMatch', 'Location match'],
  ['contactability', 'Contactability'],
  ['publicActivity', 'Public activity'],
  ['evidenceStrength', 'Evidence strength'],
  ['profileCompleteness', 'Profile completeness'],
];

export const normalizeHashtag = (s) => s.trim().replace(/^#+/, '').normalize('NFKC').toLocaleLowerCase();
export const normalizePhrase = (s) => s.replace(/\s+/g, ' ').trim();
