import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShoppingBag, User, LogOut, ShieldCheck, Layers } from 'lucide-react';

export const Navbar = () => {
  const { user, isAuthenticated, role, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getRoleBadge = (roleName) => {
    switch (roleName) {
      case 'BUYER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Buyer
          </span>
        );
      case 'SUPPLIER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            Supplier
          </span>
        );
      case 'ADMIN':
      case 'SUPER_ADMIN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
            Admin
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {roleName}
          </span>
        );
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Lahore Badge */}
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-sm shadow-emerald-200">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold text-xl tracking-tight text-gray-900 group-hover:text-emerald-700 transition">
                  MilJor
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-600 -mt-1">
                  Lahore B2B Food
                </span>
              </div>
            </Link>

            <span className="hidden md:inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              Collective Procurement
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              to="/pools"
              className="text-sm font-medium text-gray-700 hover:text-emerald-600 flex items-center gap-1.5 transition"
            >
              <Layers className="w-4 h-4 text-gray-500" />
              Active Pools
            </Link>
          </nav>

          {/* Auth State CTAs */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col items-end">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {user?.business_name || user?.full_name || user?.email}
                    </span>
                    {getRoleBadge(role)}
                  </div>
                  <span className="text-xs text-gray-500">{user?.area || 'Lahore'}</span>
                </div>

                <button
                  onClick={handleLogout}
                  title="Sign out"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-gray-200 transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:text-emerald-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg shadow-sm shadow-emerald-200 transition"
                >
                  <User className="w-4 h-4" />
                  Join as Buyer
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
