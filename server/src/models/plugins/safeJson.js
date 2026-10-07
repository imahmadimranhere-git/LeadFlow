// Global plugin: controls what a document looks like when sent as JSON.
//  - removes __v
//  - turns _id into id
//  - removes every field marked { private: true } in the schema
//    (passwordHash, tokens, encrypted credentials...) → never leaks to the API
export default function safeJsonPlugin(schema) {
  const transform = (_doc, ret) => {
    if (ret._id !== undefined) {
      ret.id = String(ret._id);
      delete ret._id;
    }
    delete ret.__v;
    schema.eachPath((path, type) => {
      if (type.options?.private && !path.includes('.')) delete ret[path];
    });
    return ret;
  };
  schema.set('toJSON', { virtuals: true, versionKey: false, transform });
  schema.set('toObject', { virtuals: true, versionKey: false, transform });
}
