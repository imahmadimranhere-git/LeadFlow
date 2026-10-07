// Global plugin: every query gets a max execution time,
// so one slow/abusive query can't freeze the database.
export const MAX_QUERY_TIME_MS = 5000;

const OPS = [
  'find', 'findOne', 'countDocuments', 'distinct',
  'updateOne', 'updateMany', 'findOneAndUpdate',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
];

export default function queryTimeoutPlugin(schema) {
  schema.pre(OPS, async function () {
    if (this.getOptions().maxTimeMS === undefined) this.maxTimeMS(MAX_QUERY_TIME_MS);
  });
  schema.pre('aggregate', async function () {
    if (this.options.maxTimeMS === undefined) this.option({ maxTimeMS: MAX_QUERY_TIME_MS });
  });
}
