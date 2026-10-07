// MANUAL / offline payments: the customer pays by bank transfer, JazzCash, Easypaisa or cash
// and you (super admin) press "Mark as paid". Lets you start selling before any gateway is approved.
const manualProvider = {
  name: 'MANUAL',
  supportsWebhooks: false,

  async createCheckout({ invoice, settings }) {
    return {
      type: 'MANUAL',
      reference: invoice.number,
      instructions: settings.manualPaymentInstructions,
    };
  },

  verifyWebhook() {
    throw new Error('Manual provider has no webhooks');
  },
};

export default manualProvider;
