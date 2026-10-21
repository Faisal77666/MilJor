import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { PoolsPage } from './pages/PoolsPage';
import { PoolDetailPage } from './pages/PoolDetailPage';
import { MyReservationsPage } from './pages/MyReservationsPage';
import { SupplierDashboardPage } from './pages/SupplierDashboardPage';
import { CreatePoolPage } from './pages/CreatePoolPage';
import { ApplySupplierPage } from './pages/ApplySupplierPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-emerald-500 selection:text-white">
          <Navbar />

          <div className="flex-1">
            <Routes>
              <Route path="/" element={<PoolsPage />} />
              <Route path="/pools" element={<PoolsPage />} />
              <Route path="/pools/:id" element={<PoolDetailPage />} />
              <Route path="/my-reservations" element={<MyReservationsPage />} />
              <Route path="/supplier/dashboard" element={<SupplierDashboardPage />} />
              <Route path="/supplier/pools/new" element={<CreatePoolPage />} />
              <Route path="/become-supplier" element={<ApplySupplierPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>

          <ToastContainer
            position="top-right"
            autoClose={3500}
            hideProgressBar={false}
            newestOnTop
            closeOnClick
            pauseOnHover
            theme="colored"
          />

          {/* Simple B2B Footer */}
          <footer className="bg-white border-t border-gray-200 py-8 px-4 sm:px-6 lg:px-8 mt-auto">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-gray-900 tracking-tight">MilJor</span>
                <span>— Lahore B2B Collective Food Procurement Marketplace</span>
              </div>
              <div className="flex items-center gap-4">
                <span>Direct Mills & Suppliers</span>
                <span>•</span>
                <span>Tier Volume Pricing</span>
                <span>•</span>
                <span>Lahore Delivery</span>
              </div>
            </div>
          </footer>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
