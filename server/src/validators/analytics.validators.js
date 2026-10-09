import { z } from './common.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const rangeQuery = z.object({ from: day.optional(), to: day.optional() }).strict();
