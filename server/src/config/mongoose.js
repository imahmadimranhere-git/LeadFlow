// Central Mongoose setup. ALL models must import mongoose from HERE
// (so global plugins are registered before any model is compiled).
import mongoose from 'mongoose';
import queryTimeoutPlugin from '../models/plugins/queryTimeout.js';
import safeJsonPlugin from '../models/plugins/safeJson.js';

mongoose.set('strictQuery', true); // filter fields not in the schema are dropped
mongoose.plugin(queryTimeoutPlugin);
mongoose.plugin(safeJsonPlugin);

export default mongoose;
