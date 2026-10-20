// =============================================================================
// src/services/paymentProviderService.js  — NEW
// Provider abstraction layer — isolates payment gateway from business logic.
// JazzCash: BLOCKED_BY_EXTERNAL_CREDENTIALS (no sandbox credentials provided)
// MOCK_GATEWAY: Active for development — clearly labelled, never trusts itself
// =============================================================================

const PROVIDERS = {
  MOCK_GATEWAY: 'MOCK_GATEWAY',
  JAZZCASH: 'JAZZCASH',
  EASYPAISA: 'EASYPAISA',
};

class PaymentProviderService {

  // ---------------------------------------------------------------------------
  // initiatePayment — Creates a payment request with the provider
  // Returns: { success, transaction_ref, redirect_url, raw }
  // ---------------------------------------------------------------------------
  async initiatePayment({ provider, amount, orderId, buyerId, description }) {
    switch (provider) {

      case PROVIDERS.MOCK_GATEWAY: {
        // ⚠️  DEVELOPMENT ONLY — Never use in production
        // Generates a fake transaction ref that verifyPayment() will accept
        const transaction_ref = `MOCK-${Date.now()}-${Math.floor(Math.random() * 99999)}`;
        console.log(`[MOCK GATEWAY] Payment initiated: ${transaction_ref} | Amount: Rs ${amount}`);
        return {
          success: true,
          provider: PROVIDERS.MOCK_GATEWAY,
          transaction_ref,
          status: 'PENDING',
          message: '[DEV MODE] Mock payment initiated. Call /verify to complete.',
          raw: { mock: true, amount, order_id: orderId }
        };
      }

      case PROVIDERS.JAZZCASH:
        // =====================================================================
        // BLOCKED_BY_EXTERNAL_CREDENTIALS
        // JazzCash sandbox credentials not provided.
        // To enable: add JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD,
        //            JAZZCASH_INTEGRITY_SALT to .env
        // =====================================================================
        return {
          success: false,
          provider: PROVIDERS.JAZZCASH,
          status: 'BLOCKED_BY_EXTERNAL_CREDENTIALS',
          message: 'JazzCash integration requires sandbox credentials. See .env.example for required keys.',
          raw: null
        };

      case PROVIDERS.EASYPAISA:
        return {
          success: false,
          provider: PROVIDERS.EASYPAISA,
          status: 'BLOCKED_BY_EXTERNAL_CREDENTIALS',
          message: 'Easypaisa integration not yet configured.',
          raw: null
        };

      default:
        return {
          success: false,
          status: 'UNKNOWN_PROVIDER',
          message: `Unknown payment provider: ${provider}`,
          raw: null
        };
    }
  }

  // ---------------------------------------------------------------------------
  // verifyPayment — Server-side verification of a payment transaction
  // CRITICAL: Frontend success signals must NEVER be trusted. Always verify here.
  // Returns: { verified: bool, status, amount_verified, raw }
  // ---------------------------------------------------------------------------
  async verifyPayment({ provider, transaction_ref, expected_amount }) {
    switch (provider) {

      case PROVIDERS.MOCK_GATEWAY: {
        // ⚠️  DEVELOPMENT ONLY
        // In mock mode, any MOCK-prefixed transaction ref is "verified"
        if (!transaction_ref || !transaction_ref.startsWith('MOCK-')) {
          return { verified: false, status: 'VERIFICATION_FAILED', amount_verified: false };
        }
        console.log(`[MOCK GATEWAY] Payment verified: ${transaction_ref}`);
        return {
          verified: true,
          provider: PROVIDERS.MOCK_GATEWAY,
          status: 'PAID',
          amount_verified: true,
          raw: { mock: true, transaction_ref, verified_amount: expected_amount }
        };
      }

      case PROVIDERS.JAZZCASH:
        return {
          verified: false,
          status: 'BLOCKED_BY_EXTERNAL_CREDENTIALS',
          message: 'JazzCash verification requires live credentials.'
        };

      default:
        return { verified: false, status: 'UNKNOWN_PROVIDER' };
    }
  }

  // ---------------------------------------------------------------------------
  // initiateRefund — Requests refund from provider
  // ---------------------------------------------------------------------------
  async initiateRefund({ provider, transaction_ref, amount, reason }) {
    switch (provider) {
      case PROVIDERS.MOCK_GATEWAY:
        console.log(`[MOCK GATEWAY] Refund initiated: ${transaction_ref} | Amount: Rs ${amount}`);
        return {
          success: true,
          refund_ref: `REFUND-${Date.now()}`,
          status: 'REFUNDED',
          raw: { mock: true }
        };

      case PROVIDERS.JAZZCASH:
        return {
          success: false,
          status: 'BLOCKED_BY_EXTERNAL_CREDENTIALS',
          message: 'JazzCash refund requires live credentials.'
        };

      default:
        return { success: false, status: 'UNKNOWN_PROVIDER' };
    }
  }
}

module.exports = new PaymentProviderService();
