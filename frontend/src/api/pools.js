import apiClient from './client';

export const poolsApi = {
  // Fetch published active pools with dynamic tier progress
  getActivePools: async (params = {}) => {
    const res = await apiClient.get('/pools', { params });
    return res.data;
  },

  // Fetch full details and progress snapshot of a single pool
  getPoolById: async (id) => {
    const res = await apiClient.get(`/pools/${id}`);
    return res.data;
  },

  // Supplier: fetch own pools (draft, active, etc.)
  getMyPools: async () => {
    const res = await apiClient.get('/pools/supplier/my');
    return res.data;
  },
};

