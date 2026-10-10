// PHASE 29 — details shown on the Privacy Policy and Terms pages. EDIT THESE before going live,
// then have the texts reviewed by a lawyer and set `reviewed: true` (until then the pages say "Draft").
export const LEGAL = {
  reviewed: false,
  serviceName: 'LeadFlow',
  companyName: '[Your company legal name]',
  address: '[Registered address, city, country]',
  contactEmail: '[privacy@yourdomain.com]',
  effectiveDate: '[YYYY-MM-DD]',
  governingLaw: '[country / province]',
  // Services that process data for us (keep this list true — remove what you don't use)
  processors: [
    ['MongoDB Atlas', 'database hosting'],
    ['Render', 'API hosting'],
    ['Vercel', 'website hosting'],
    ['[Email provider]', 'password-reset and confirmation emails'],
    ['OpenAI / Anthropic', 'AI features — only when a company uses the platform AI key; companies can use their own key'],
  ],
};
