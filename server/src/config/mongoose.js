// Central Mongoose setup. ALL models must import mongoose from HERE
// (so global plugins are registered before any model is compiled).
import mongoose from 'mongoose';
import queryTimeoutPlugin from '../models/plugins/queryTimeout.js';
import safeJsonPlugin from '../models/plugins/safeJson.js';
import slowQueryPlugin from '../models/plugins/slowQuery.js';

mongoose.set('strictQuery', true); // filter fields not in the schema are dropped
mongoose.plugin(queryTimeoutPlugin);
mongoose.plugin(safeJsonPlugin);
mongoose.plugin(slowQueryPlugin); // Phase 30: log slow DB operations (no filter values)

export default mongoose;
