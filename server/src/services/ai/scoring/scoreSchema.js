// What the AI must return for scoring. Note: there is NO "score" field — the server calculates it.
import { AI_FACTORS } from './scoreFormula.js';

export const LEAD_TYPES = ['EXPLICIT_BUYER_INTENT', 'STRONG_OPPORTUNITY', 'POSSIBLE_OPPORTUNITY', 'GENERAL_PROSPECT', 'IRRELEVANT', 'COMPETITOR', 'SPAM'];

const factor = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'reason', 'quote'],
  properties: {
    value: { type: 'integer', minimum: 0, maximum: 10 },
    reason: { type: 'string', maxLength: 200 },
    quote: { type: ['string', 'null'], maxLength: 300, description: 'Exact words copied from the evidence that prove this value, or null' },
  },
};

export const SCORE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['factors', 'intent', 'leadType', 'potentialService', 'recommendedAction', 'evidenceSummary'],
  properties: {
    factors: { type: 'object', additionalProperties: false, required: AI_FACTORS, properties: Object.fromEntries(AI_FACTORS.map((k) => [k, factor])) },
    intent: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    leadType: { type: 'string', enum: LEAD_TYPES },
    potentialService: { type: ['string', 'null'], maxLength: 120, description: 'One of the company services, exactly as written, or null' },
    recommendedAction: { type: 'string', maxLength: 300 },
    evidenceSummary: { type: 'string', maxLength: 400 },
  },
};
