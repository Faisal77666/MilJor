import apiClient from './client';

export const authApi = {
  // Login with identifier (email or phone) and password
  login: async ({ identifier, password }) => {
    const res = await apiClient.post('/auth/login', { identifier, password });
    return res.data;
  },

  // Public buyer registration
  register: async ({ full_name, business_name, email, phone, password, area, address }) => {
    const res = await apiClient.post('/auth/register', {
      full_name,
      business_name,
      email,
      phone,
      password,
      area,
      address,
    });
    return res.data;
  },

  // Hydrate authenticated user session profile
  getMe: async () => {
    const res = await apiClient.get('/auth/me');
    return res.data;
  },

  // Graceful session logout
  logout: async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network failures on logout
    } finally {
      localStorage.removeItem('miljor_token');
      localStorage.removeItem('miljor_user');
    }
  },

  // Verify email with OTP
  verifyEmail: async ({ email, otp }) => {
    const res = await apiClient.post('/auth/verify-email', { email, otp });
    return res.data;
  },

  // Resend OTP
  resendOtp: async ({ email }) => {
    const res = await apiClient.post('/auth/resend-otp', { email });
    return res.data;
  },

  // Apply for supplier verification
  applySupplier: async (data) => {
    const res = await apiClient.post('/auth/supplier/apply', data);
    return res.data;
  },
};

