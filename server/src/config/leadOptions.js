// Lead option lists (spec section 12/13). Display labels can be renamed per tenant later.
export const LEAD_STATUSES = ['NEW', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'FOLLOW_UP', 'NEGOTIATION', 'CONVERTED', 'NOT_INTERESTED', 'LOST'];
export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const LEAD_TYPES = ['EXPLICIT_BUYER_INTENT', 'STRONG_OPPORTUNITY', 'POSSIBLE_OPPORTUNITY', 'GENERAL_PROSPECT', 'IRRELEVANT', 'COMPETITOR', 'SPAM'];
export const LEAD_INTENTS = ['LOW', 'MEDIUM', 'HIGH'];
// Where a lead came from: every lead-source connector + MANUAL (typed in by a person)
export { CONNECTORS as CONNECTOR_SOURCES } from '../models/Plan.js';
import { CONNECTORS } from '../models/Plan.js';
export const LEAD_SOURCES = ['MANUAL', ...CONNECTORS];

export const ACTIVITY_TYPES = ['CREATED', 'UPDATED', 'NOTE', 'STATUS_CHANGED', 'STAGE_CHANGED', 'ASSIGNED', 'SOURCE_ADDED', 'MERGED', 'DELETED', 'RESTORED'];
export const DNC_TYPES = ['EMAIL', 'PHONE', 'DOMAIN', 'SOCIAL'];

export const LEAD_LIMITS = Object.freeze({ tags: 20, customFields: 20, sourcesHistory: 50, bulk: 100, interestedItems: 20 });
