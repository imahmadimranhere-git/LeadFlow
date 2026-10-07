// Soft delete: records are hidden instead of permanently removed (undo, audit, GDPR flows).
// Deleted records are excluded from normal queries automatically.
// To include them, put deletedAt in your filter explicitly, e.g. { deletedAt: { $ne: null } }.
import mongoose from 'mongoose';

const FILTERED_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
];

export default function softDeletePlugin(schema) {
  schema.add({
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  });

  schema.pre(FILTERED_OPS, async function () {
    if (!Object.prototype.hasOwnProperty.call(this.getFilter(), 'deletedAt')) {
      this.where({ deletedAt: null });
    }
  });

  schema.pre('aggregate', async function () {
    const first = this.pipeline()[0];
    const mentionsDeleted = first?.$match && Object.prototype.hasOwnProperty.call(first.$match, 'deletedAt');
    if (!mentionsDeleted) this.pipeline().unshift({ $match: { deletedAt: null } });
  });

  schema.methods.softDelete = function softDelete(userId = null) {
    this.deletedAt = new Date();
    this.deletedBy = userId;
    return this.save();
  };

  schema.methods.restore = function restore() {
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
  };
}
