import apiClient from './client';

// Helper to generate RFC4122 v4 UUID for idempotency headers
const generateIdempotencyKey = (prefix = 'supp') => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

export const supplierApi = {
  /**
   * Fetch supplier's own pools (DRAFT, ACTIVE, CONFIRMED, etc.)
   */
  getMyPools: async () => {
    const res = await apiClient.get('/pools/supplier/my');
    return res.data;
  },

  /**
   * Fetch supplier's active inventory listings
   */
  getMyListings: async () => {
    const res = await apiClient.get('/listings/me');
    return res.data;
  },

  /**
   * Fetch supplier's reservation & demand summary for a specific pool
   * Adheres to Part 4C.2B buyer privacy invariants.
   *
   * @param {number|string} poolId
   */
  getPoolSupplierSummary: async (poolId) => {
    const res = await apiClient.get(`/pools/${poolId}/supplier/summary`);
    return res.data;
  },

  /**
   * Create a new regular pool draft.
   * Requires mandatory X-Idempotency-Key.
   *
   * @param {Object} poolData
   * @param {string} [customIdempotencyKey]
   */
  createPoolDraft: async (poolData, customIdempotencyKey = null) => {
    const key = customIdempotencyKey || generateIdempotencyKey('pool_create');
    const res = await apiClient.post('/pools', poolData, {
      headers: {
        'X-Idempotency-Key': key,
      },
    });
    return res.data;
  },

  /**
   * Update an existing DRAFT pool.
   *
   * @param {number|string} poolId
   * @param {Object} poolData
   * @param {string} [customIdempotencyKey]
   */
  updatePoolDraft: async (poolId, poolData, customIdempotencyKey = null) => {
    const key = customIdempotencyKey || generateIdempotencyKey('pool_update');
    const res = await apiClient.put(`/pools/${poolId}`, poolData, {
      headers: {
        'X-Idempotency-Key': key,
      },
    });
    return res.data;
  },

  /**
   * Publish a DRAFT pool to ACTIVE status.
   * Locks commercial terms and allocates inventory.
   * Requires mandatory X-Idempotency-Key.
   *
   * @param {number|string} poolId
   * @param {string} [customIdempotencyKey]
   */
  publishPool: async (poolId, customIdempotencyKey = null) => {
    const key = customIdempotencyKey || generateIdempotencyKey('pool_pub');
    const res = await apiClient.post(
      `/pools/${poolId}/publish`,
      {},
      {
        headers: {
          'X-Idempotency-Key': key,
        },
      }
    );
    return res.data;
  },

  /**
   * Cancel a DRAFT or eligible ACTIVE pool.
   *
   * @param {number|string} poolId
   * @param {string} [reason]
   */
  cancelPool: async (poolId, reason = '') => {
    const res = await apiClient.put(`/pools/${poolId}/cancel`, { reason });
    return res.data;
  },
};

export default supplierApi;
