import React, { createContext, useContext, useState, useEffect } from 'react';
import { authApi } from '../api/auth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const cached = localStorage.getItem('miljor_user');
    try {
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem('miljor_token'));
  const [loading, setLoading] = useState(true);

  // Hydrate user profile on initial mount if token exists
  useEffect(() => {
    let isMounted = true;

    const hydrateSession = async () => {
      const storedToken = localStorage.getItem('miljor_token');
      if (!storedToken) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        const response = await authApi.getMe();
        if (isMounted && response.success && response.data?.user) {
          setUser(response.data.user);
          localStorage.setItem('miljor_user', JSON.stringify(response.data.user));
        }
      } catch (err) {
        console.warn('Session hydration failed:', err.message);
        if (isMounted) {
          setUser(null);
          setToken(null);
          localStorage.removeItem('miljor_token');
          localStorage.removeItem('miljor_user');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    hydrateSession();

    // Listen to 401 unauthenticated event
    const handleAuthExpired = () => {
      setUser(null);
      setToken(null);
    };

    window.addEventListener('miljor:auth-expired', handleAuthExpired);
    return () => {
      isMounted = false;
      window.removeEventListener('miljor:auth-expired', handleAuthExpired);
    };
  }, []);

  // Login handler
  const login = async ({ identifier, password }) => {
    const response = await authApi.login({ identifier, password });
    if (response.success && response.data?.token) {
      const newToken = response.data.token;
      const newUser = response.data.user;

      localStorage.setItem('miljor_token', newToken);
      localStorage.setItem('miljor_user', JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      return { success: true, user: newUser };
    }
    throw new Error(response.error?.message || 'Login failed');
  };

  // Register handler
  const register = async (formData) => {
    const response = await authApi.register(formData);
    if (response.success) {
      if (response.data?.token) {
        const newToken = response.data.token;
        const newUser = response.data.user;

        localStorage.setItem('miljor_token', newToken);
        localStorage.setItem('miljor_user', JSON.stringify(newUser));
        setToken(newToken);
        setUser(newUser);
      }
      return response;
    }
    throw new Error(response.error?.message || 'Registration failed');
  };

  // Verify Email OTP handler
  const verifyEmail = async ({ email, otp }) => {
    const response = await authApi.verifyEmail({ email, otp });
    if (response.success && response.data?.token) {
      const newToken = response.data.token;
      const newUser = response.data.user;

      localStorage.setItem('miljor_token', newToken);
      localStorage.setItem('miljor_user', JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      return { success: true, user: newUser };
    }
    throw new Error(response.error?.message || 'Verification failed');
  };

  // Resend OTP handler
  const resendOtp = async ({ email }) => {
    return await authApi.resendOtp({ email });
  };

  // Refresh user profile from server
  const refreshUser = async () => {
    try {
      const response = await authApi.getMe();
      if (response.success && response.data?.user) {
        setUser(response.data.user);
        localStorage.setItem('miljor_user', JSON.stringify(response.data.user));
        return response.data;
      }
    } catch (err) {
      console.warn('Failed to refresh user profile:', err.message);
    }
  };

  // Apply to become a supplier
  const applySupplier = async (formData) => {
    const res = await authApi.applySupplier(formData);
    await refreshUser();
    return res;
  };

  // Logout handler
  const logout = async () => {
    await authApi.logout();
    setUser(null);
    setToken(null);
  };

  const value = {
    user,
    token,
    isAuthenticated: Boolean(token && user),
    role: user?.role || null,
    isBuyer: user?.role === 'BUYER',
    isSupplier: user?.role === 'SUPPLIER',
    isAdmin: ['ADMIN', 'SUPER_ADMIN'].includes(user?.role),
    isVerified: Boolean(user?.is_verified),
    isPendingSupplier: user?.verification_status === 'PENDING_SUPPLIER_VERIFICATION',
    loading,
    login,
    register,
    verifyEmail,
    resendOtp,
    refreshUser,
    applySupplier,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

