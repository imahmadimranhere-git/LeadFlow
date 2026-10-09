// Outreach messages & templates (spec A12, A13, A16). Pure data.
export { TEMPLATE_CHANNELS as MESSAGE_CHANNELS } from './settingsOptions.js';

// draft → review → approved → (outreach, Phase 17) sending → sent → replied / follow-up → closed
export const MESSAGE_STATUSES = ['GENERATING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SENDING', 'SENT', 'SEND_FAILED', 'REPLIED', 'FOLLOW_UP', 'CLOSED'];
export const AFTER_SEND_STATUSES = ['SENDING', 'SENT', 'REPLIED', 'FOLLOW_UP', 'CLOSED'];
export const SEND_VIA = ['SMTP', 'MANUAL', 'WHATSAPP_API'];
export const MESSAGE_ORIGINS = ['AI_GENERATED', 'TEMPLATE', 'MANUAL', 'AI_REPLY'];

// Max body length per channel (characters) — keeps drafts realistic for each platform
export const CHANNEL_LIMITS = Object.freeze({
  EMAIL: 3000,
  LINKEDIN: 1900,
  INSTAGRAM_DM: 1000,
  FACEBOOK_MESSAGE: 2000,
  WHATSAPP: 1000,
  GENERAL: 3000,
});
export const CHANNEL_LABEL = Object.freeze({
  EMAIL: 'Email',
  LINKEDIN: 'LinkedIn message',
  INSTAGRAM_DM: 'Instagram DM',
  FACEBOOK_MESSAGE: 'Facebook message',
  WHATSAPP: 'WhatsApp draft',
  GENERAL: 'General outreach',
});
export const SUBJECT_MAX = 150;
