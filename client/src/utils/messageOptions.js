export const CHANNELS = [
  ['EMAIL', 'Email'],
  ['LINKEDIN', 'LinkedIn message'],
  ['INSTAGRAM_DM', 'Instagram DM'],
  ['FACEBOOK_MESSAGE', 'Facebook message'],
  ['WHATSAPP', 'WhatsApp draft'],
  ['GENERAL', 'General outreach'],
];
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS);
export const CHANNEL_LIMITS = { EMAIL: 3000, LINKEDIN: 1900, INSTAGRAM_DM: 1000, FACEBOOK_MESSAGE: 2000, WHATSAPP: 1000, GENERAL: 3000 };
export const STATUS_COLOR = { PENDING_REVIEW: 'amber', APPROVED: 'green', REJECTED: 'gray', GENERATING: 'blue', SENDING: 'blue', SENT: 'blue', SEND_FAILED: 'red', REPLIED: 'green', FOLLOW_UP: 'amber', CLOSED: 'gray' };
export const STATUS_LABEL = { PENDING_REVIEW: 'Pending review', APPROVED: 'Approved', REJECTED: 'Rejected', GENERATING: 'Writing…', SENDING: 'Sending…', SENT: 'Sent', SEND_FAILED: 'Send failed', REPLIED: 'Replied', FOLLOW_UP: 'Follow-up', CLOSED: 'Closed' };
export const ORIGIN_LABEL = { AI_GENERATED: 'AI draft', TEMPLATE: 'From template', MANUAL: 'Written by hand', AI_REPLY: 'AI reply suggestion' };
export const INTENT_LABEL = { INTERESTED: 'Interested', QUESTION: 'Question', PRICE_REQUEST: 'Asks for price', NEEDS_MORE_INFO: 'Needs more info', NOT_INTERESTED: 'Not interested', MEETING_REQUEST: 'Wants a meeting', UNKNOWN: 'Unclear' };
export const INTENT_COLOR = { INTERESTED: 'green', QUESTION: 'blue', PRICE_REQUEST: 'amber', NEEDS_MORE_INFO: 'blue', NOT_INTERESTED: 'gray', MEETING_REQUEST: 'green', UNKNOWN: 'gray' };
export const CONVERSATION_STATUS_LABEL = { ACTIVE: 'Needs reply', WAITING: 'Waiting for them', FOLLOW_UP: 'Follow-up', CLOSED: 'Closed', CONVERTED: 'Converted' };
export const CONVERSATION_STATUS_COLOR = { ACTIVE: 'amber', WAITING: 'blue', FOLLOW_UP: 'amber', CLOSED: 'gray', CONVERTED: 'green' };
export const TEMPLATE_VARIABLES = [
  ['firstName', 'First name'],
  ['personName', 'Full name'],
  ['companyName', "Lead's company"],
  ['industry', 'Industry'],
  ['city', 'City'],
  ['service', 'Matching service'],
  ['evidence', 'Real quote from the evidence'],
  ['myCompany', 'Your company'],
  ['myService', 'Your main service'],
  ['senderName', 'Your name'],
];
