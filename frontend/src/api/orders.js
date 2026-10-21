import apiClient from './client';

// Helper to generate UUID or fallback unique token for idempotency headers
const generateIdempotencyKey = (prefix = 'ord') => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

export const ordersApi = {
  /**
   * Fetch all orders belonging to the authenticated buyer.
   *
   * @param {Object} [params]
   * @param {string} [params.status]
   * @param {number} [params.page]
   * @param {number} [params.limit]
   */
  getMyOrders: async (params = {}) => {
    const res = await apiClient.get('/orders/my', { params });
    return res.data;
  },

  /**
   * Fetch a single order by ID with enriched specification and financial details.
   *
   * @param {number|string} id
   */
  getOrderById: async (id) => {
    const res = await apiClient.get(`/orders/${id}`);
    return res.data;
  },

  /**
   * Create an authoritative order from an accepted reservation commitment.
   * Enforces mandatory X-Idempotency-Key.
   *
   * @param {Object} data { reservation_id, delivery_address, notes }
   */
  createOrder: async ({ reservation_id, delivery_address = null, notes = null }) => {
    const key = generateIdempotencyKey('ord_create');
    const res = await apiClient.post(
      '/orders',
      { reservation_id: Number(reservation_id), delivery_address, notes },
      {
        headers: {
          'X-Idempotency-Key': key,
        },
      }
    );
    return res.data;
  },

  /**
   * Initiate a Safepay sandbox checkout session for an AWAITING_PAYMENT order.
   * Enforces mandatory X-Idempotency-Key.
   *
   * @param {number|string} orderId
   * @param {Object} [data] { redirect_url, cancel_url }
   */
  initiateCheckout: async (orderId, { redirect_url = null, cancel_url = null } = {}) => {
    const key = generateIdempotencyKey('chk_init');
    const res = await apiClient.post(
      `/orders/${orderId}/checkout`,
      { redirect_url, cancel_url },
      {
        headers: {
          'X-Idempotency-Key': key,
        },
      }
    );
    return res.data;
  },

  /**
   * Query authoritative order payment status read-model.
   *
   * @param {number|string} orderId
   */
  getPaymentStatus: async (orderId) => {
    const res = await apiClient.get(`/orders/${orderId}/payment-status`);
    return res.data;
  },

  /**
   * Authoritatively reconcile payment with Safepay provider.
   *
   * @param {number|string} orderId
   */
  reconcilePayment: async (orderId) => {
    const res = await apiClient.post(`/orders/${orderId}/reconcile`);
    return res.data;
  },
};

export default ordersApi;
