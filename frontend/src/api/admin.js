import apiClient from './client';

export const adminApi = {
  /**
   * Fetch all pending supplier verification applications.
   * Permitted roles: SUPER_ADMIN, VERIFICATION_ADMIN.
   */
  getPendingSuppliers: async () => {
    const res = await apiClient.get('/admin/suppliers/pending');
    return res.data;
  },

  /**
   * Approve or reject a supplier application.
   * Promotes the user to role = 'SUPPLIER' when approved.
   *
   * @param {number|string} supplierId - The user id (supplier_id)
   * @param {Object} data - { verification_status: 'VERIFIED' | 'REJECTED', verification_level?: string }
   */
  verifySupplier: async (supplierId, data = {}) => {
    const payload = {
      verification_status: data.verification_status || 'VERIFIED',
      verification_level: data.verification_level || 'LEVEL_2_BUSINESS',
      subscription_plan: data.subscription_plan || 'GROWTH',
      max_active_listings: data.max_active_listings || 25,
      transaction_fee_percent: data.transaction_fee_percent || 1.5,
    };
    const res = await apiClient.put(`/admin/suppliers/${supplierId}/verify`, payload);
    return res.data;
  },
};

export default adminApi;
