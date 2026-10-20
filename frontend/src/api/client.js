import axios from 'axios';

// MilJor Base API Client
// Vite proxies '/api' to backend (http://localhost:5000 in dev)
const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach bearer JWT token if present in localStorage
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('miljor_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: normalize errors and handle 401 unauthenticated
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // If unauthorized, clear stale credentials
      const token = localStorage.getItem('miljor_token');
      if (token) {
        localStorage.removeItem('miljor_token');
        localStorage.removeItem('miljor_user');
        window.dispatchEvent(new Event('miljor:auth-expired'));
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;

