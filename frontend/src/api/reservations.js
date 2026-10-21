import apiClient from './client';

// Helper to generate RFC4122 v4 UUID for idempotency headers
const generateIdempotencyKey = (prefix = 'res') => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

export const reservationsApi = {
  /**
   * Create a new reservation for an active pool.
   * Enforces mandatory X-Idempotency-Key header.
   *
   * @param {Object} data { pool_id: number, quantity: number }
   * @param {string} [customIdempotencyKey]
   */
  createReservation: async ({ pool_id, quantity }, customIdempotencyKey = null) => {
    const key = customIdempotencyKey || generateIdempotencyKey('res_create');
    const res = await apiClient.post(
      '/reservations',
      { pool_id: Number(pool_id), quantity: Number(quantity) },
      {
        headers: {
          'X-Idempotency-Key': key,
        },
      }
    );
    return res.data;
  },

  /**
   * Fetch all reservations belonging to the authenticated buyer.
   */
  getMyReservations: async () => {
    const res = await apiClient.get('/reservations/my');
    return res.data;
  },

  /**
   * Fetch a single reservation by ID.
   *
   * @param {number|string} id
   */
  getReservationById: async (id) => {
    const res = await apiClient.get(`/reservations/${id}`);
    return res.data;
  },

  /**
   * Cancel an existing reservation before cutoff.
   * Enforces mandatory X-Idempotency-Key header.
   *
   * @param {number|string} id
   * @param {string} [reason]
   * @param {string} [customIdempotencyKey]
   */
  cancelReservation: async (id, reason = '', customIdempotencyKey = null) => {
    const key = customIdempotencyKey || generateIdempotencyKey('res_cancel');
    const res = await apiClient.post(
      `/reservations/${id}/cancel`,
      { reason },
      {
        headers: {
          'X-Idempotency-Key': key,
        },
      }
    );
    return res.data;
  },

  /**
   * Update quantity of an active reservation before cutoff.
   * Enforces mandatory X-Idempotency-Key header.
   *
   * @param {number|string} id
   * @param {number} quantity
   * @param {string} [customIdempotencyKey]
   */
  updateReservationQuantity: async (id, quantity, customIdempotencyKey = null) => {
    const key = customIdempotencyKey || generateIdempotencyKey('res_patch');
    const res = await apiClient.patch(
      `/reservations/${id}`,
      { quantity: Number(quantity) },
      {
        headers: {
          'X-Idempotency-Key': key,
        },
      }
    );
    return res.data;
  },
};

export default reservationsApi;
