// =============================================================================
// src/controllers/orderController.js
// MilJor Part 4E.3: Safepay Sandbox Checkout & Authoritative Order Operations
// =============================================================================

const safepayCheckoutService = require('../services/safepayCheckoutService');
const orderService = require('../services/orderService');

class OrderController {

  /**
   * POST /api/v1/orders/:id/checkout
   * Buyer initiates Safepay sandbox checkout session for an AWAITING_PAYMENT order.
   * Enforces mandatory X-Idempotency-Key.
   */
  async initiateCheckout(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'];
      const { redirect_url, cancel_url } = req.body || {};

      // Test hook support (strictly isolated to test environments)
      let mockClient = null;
      if (process.env.NODE_ENV === 'test') {
        const mockHeader = req.headers['x-safepay-mock'];
        if (mockHeader === 'timeout') {
          mockClient = {
            init: async () => {
              const err = new Error('Safepay network request timed out');
              err.code = 'SAFEPAY_TIMEOUT';
              err.statusCode = 504;
              throw err;
            }
          };
        } else if (mockHeader === 'error') {
          mockClient = {
            init: async () => {
              const err = new Error('Safepay connection error: ECONNREFUSED');
              err.code = 'SAFEPAY_CONNECTION_ERROR';
              err.statusCode = 502;
              throw err;
            }
          };
        } else if (mockHeader === 'missing_token') {
          mockClient = {
            init: async () => {
              const err = new Error('Safepay response missing tracker token');
              err.code = 'INVALID_PROVIDER_RESPONSE';
              err.statusCode = 502;
              throw err;
            }
          };
        } else if (mockHeader === 'success' || mockHeader === 'mock_success') {
          mockClient = {
            init: async ({ amount, currency, orderCode }) => {
              const token = `track_sbx_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
              return {
                trackerToken: token,
                rawResponse: {
                  data: {
                    token,
                    amount,
                    currency
                  }
                }
              };
            },
            createPassportToken: async () => 'tbt_mock_test_token'
          };
        } else if (req.testHooks?.mockClient) {
          mockClient = req.testHooks.mockClient;
        }
      }

      const result = await safepayCheckoutService.initiateCheckout({
        orderId,
        actor,
        idempotencyKey,
        redirectUrl: redirect_url,
        cancelUrl: cancel_url,
        mockClient
      });

      // Link idempotency record if middleware active
      if (req.idempotency && req.idempotency.setResource && result.attempt) {
        await req.idempotency.setResource('payment_attempts', result.attempt.order_id);
      }

      return res.status(200).json({
        success: true,
        message: result.is_replay
          ? 'Checkout session retrieved (idempotent replay)'
          : 'Checkout session initiated successfully',
        data: result.attempt
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'UNAUTHORIZED' ? 401 :
        err.code === 'UNAUTHORIZED_ROLE' || err.code === 'ACCOUNT_SUSPENDED' || err.code === 'FORBIDDEN' ? 403 :
        err.code === 'ORDER_NOT_FOUND' ? 404 :
        err.code === 'ORDER_ALREADY_PAID' || err.code === 'PAYMENT_ALREADY_INITIATED' ? 409 :
        err.code === 'INVALID_ORDER_STATUS' || err.code === 'MISSING_TRACKER_TOKEN' || err.code === 'PAYABLE_COMPONENTS_UNRESOLVED' ? 422 :
        err.code === 'SAFEPAY_API_ERROR' || err.code === 'SAFEPAY_CONNECTION_ERROR' || err.code === 'INVALID_PROVIDER_RESPONSE' ? 502 :
        err.code === 'SAFEPAY_TIMEOUT' ? 504 : 500
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'CHECKOUT_FAILED',
          message: err.message
        }
      });
    }
  }

  /**
   * GET /api/v1/orders/:id/payment-status
   * Authoritative read-model for order payment and checkout lifecycle state.
   */
  async getPaymentStatus(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;

      const result = await safepayCheckoutService.getOrderPaymentStatus({
        orderId,
        actor
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'UNAUTHORIZED' ? 401 :
        err.code === 'FORBIDDEN' ? 403 :
        err.code === 'ORDER_NOT_FOUND' ? 404 : 500
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'STATUS_LOOKUP_FAILED',
          message: err.message
        }
      });
    }
  }

  /**
   * POST /api/v1/orders/:id/reconcile
   * Authoritatively reconciles order payment state with Safepay provider.
   */
  async reconcilePayment(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;

      let mockClient = null;
      if (process.env.NODE_ENV === 'test' && req.testHooks?.mockClient) {
        mockClient = req.testHooks.mockClient;
      }

      const result = await safepayCheckoutService.reconcilePaymentWithProvider({
        orderId,
        actor,
        mockClient
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'UNAUTHORIZED' ? 401 :
        err.code === 'FORBIDDEN' ? 403 :
        err.code === 'ORDER_NOT_FOUND' ? 404 :
        err.code === 'AMOUNT_MISMATCH' || err.code === 'CURRENCY_MISMATCH' || err.code === 'INVALID_TRANSACTION_SIGNATURE' || err.code === 'INVALID_ORDER_STATUS' || err.code === 'NO_ACTIVE_PAYMENT_ATTEMPT' ? 422 :
        err.code === 'SAFEPAY_API_ERROR' || err.code === 'SAFEPAY_CONNECTION_ERROR' || err.code === 'INVALID_PROVIDER_RESPONSE' || err.code === 'TRACKER_MISMATCH' ? 502 :
        err.code === 'SAFEPAY_TIMEOUT' ? 504 : 500
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'RECONCILIATION_FAILED',
          message: err.message
        }
      });
    }
  }

  /**
   * GET /api/v1/orders/my
   * List orders for the authenticated buyer.
   */
  async getMyOrders(req, res) {
    try {
      const actor = req.user;
      const { status, page, limit } = req.query || {};

      const result = await orderService.getMyOrders({
        actor,
        status: status || null,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'UNAUTHORIZED' ? 401 :
        err.code === 'FORBIDDEN' ? 403 : 500
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'LIST_ORDERS_FAILED',
          message: err.message
        }
      });
    }
  }

  /**
   * GET /api/v1/orders/:id
   * Get authoritative order by ID with enriched specification details.
   */
  async getOrderById(req, res) {
    try {
      const orderId = parseInt(req.params.id, 10);
      const actor = req.user;

      const order = await orderService.getOrderById({
        orderId,
        actor
      });

      return res.status(200).json({
        success: true,
        data: { order }
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'UNAUTHORIZED' ? 401 :
        err.code === 'FORBIDDEN' ? 403 :
        err.code === 'ORDER_NOT_FOUND' ? 404 : 500
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'GET_ORDER_FAILED',
          message: err.message
        }
      });
    }
  }

  /**
   * POST /api/v1/orders
   * Create an authoritative order from an accepted buyer reservation commitment.
   */
  async createOrder(req, res) {
    try {
      const { reservation_id, delivery_address, notes } = req.body || {};
      const reservationId = parseInt(reservation_id, 10);
      const actor = req.user;
      const idempotencyKey = req.idempotency ? req.idempotency.key : (req.headers['x-idempotency-key'] || null);

      if (!idempotencyKey) {
        return res.status(400).json({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'X-Idempotency-Key header is mandatory for order creation' }
        });
      }

      const result = await orderService.createOrderFromBuyerCommitment({
        reservationId,
        actor: {
          id: actor.id,
          role: actor.role,
          buyer_trust_status: actor.buyer_trust_status
        },
        idempotencyKey,
        deliveryAddress: delivery_address || null,
        notes: notes || null
      });

      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('orders', result.order.id);
      }

      return res.status(result.is_replay ? 200 : 201).json({
        success: true,
        message: result.is_replay
          ? 'Existing order retrieved successfully for this commitment'
          : 'Authoritative order created successfully from commercial commitment. Initial state is AWAITING_PAYMENT.',
        data: {
          order: result.order,
          is_replay: result.is_replay
        }
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'UNAUTHORIZED' ? 401 :
        err.code === 'FORBIDDEN' ? 403 :
        err.code === 'NOT_FOUND' || err.code === 'ORDER_NOT_FOUND' ? 404 :
        err.code === 'ALREADY_EXISTS' || err.code === 'ORDER_ALREADY_EXISTS' ? 409 : 422
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'ORDER_CREATION_FAILED',
          message: err.message
        }
      });
    }
  }
}

module.exports = new OrderController();
