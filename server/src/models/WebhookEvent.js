// Every webhook event id we have processed → the same event can never be processed twice (replay protection).
import mongoose from '../config/mongoose.js';

const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, maxlength: 40 },
    eventId: { type: String, required: true, maxlength: 200 },
    type: { type: String, maxlength: 80, default: null },
    status: { type: String, enum: ['PROCESSING', 'PROCESSED', 'IGNORED'], default: 'PROCESSING' },
    note: { type: String, maxlength: 200, default: null },
  },
  { timestamps: true }
);

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // keep 90 days

const WebhookEvent = mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', webhookEventSchema);
export default WebhookEvent;
