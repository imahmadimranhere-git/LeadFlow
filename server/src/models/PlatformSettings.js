// Platform-wide settings editable by the super admin (one document).
import mongoose from '../config/mongoose.js';

const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: 'platform' },
    billing: {
      manualPaymentInstructions: {
        type: String,
        maxlength: 2000,
        default: 'Please contact us for bank transfer / JazzCash / Easypaisa details and mention your invoice number.',
      },
      graceDays: { type: Number, min: 0, max: 30, default: 3 },
      invoiceDueDays: { type: Number, min: 1, max: 60, default: 7 },
    },
  },
  { timestamps: true, strict: 'throw' }
);

platformSettingsSchema.index({ key: 1 }, { unique: true });

const PlatformSettings = mongoose.models.PlatformSettings || mongoose.model('PlatformSettings', platformSettingsSchema);
export default PlatformSettings;
