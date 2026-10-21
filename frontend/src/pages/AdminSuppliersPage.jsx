import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from '../api/admin';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import {
  ShieldCheck,
  Building2,
  MapPin,
  FileText,
  BadgeCheck,
  Check,
  X,
  Clock,
  Loader2,
  RefreshCw,
  AlertCircle,
  Phone,
  Mail,
  User,
  ExternalLink
} from 'lucide-react';

export const AdminSuppliersPage = () => {
  const { user, isAuthenticated, isAdmin, role } = useAuth();
  const navigate = useNavigate();

  const [pendingList, setPendingList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) {
      toast.info('Please sign in as an administrator.');
      navigate('/login');
      return;
    }

    if (!isAdmin) {
      toast.error('Access restricted to platform administrators.');
      navigate('/pools');
      return;
    }

    fetchPendingSuppliers();
  }, [isAuthenticated, isAdmin]);

  const fetchPendingSuppliers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await adminApi.getPendingSuppliers();
      if (res.success && res.data?.suppliers) {
        setPendingList(res.data.suppliers);
      } else {
        setPendingList([]);
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Failed to fetch pending applications';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (supplierId, businessName, isApprove = true) => {
    try {
      setActionLoadingId(supplierId);
      const res = await adminApi.verifySupplier(supplierId, {
        verification_status: isApprove ? 'VERIFIED' : 'REJECTED',
        verification_level: 'LEVEL_2_BUSINESS',
      });

      if (res.success) {
        if (isApprove) {
          toast.success(`Supplier "${businessName}" successfully verified & upgraded to SUPPLIER role!`);
        } else {
          toast.info(`Application for "${businessName}" rejected.`);
        }
        // Remove from local list
        setPendingList((prev) => prev.filter((s) => s.supplier_id !== supplierId));
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Verification update failed';
      toast.error(msg);
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-gray-900">Administrator Access Required</h2>
        <p className="text-sm text-gray-500 mt-1 mb-6">
          Your current account role ({role}) does not have verification admin privileges.
        </p>
        <Link
          to="/pools"
          className="px-5 py-2.5 bg-emerald-600 text-white font-bold text-xs rounded-xl hover:bg-emerald-700 transition"
        >
          Return to Marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-200 mb-8">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-800 border border-purple-200">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
              Platform Administration
            </span>
            <span className="text-xs font-semibold text-gray-500">
              {role}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight mt-1.5">
            Pending Supplier Verifications
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Review food business licenses, warehouse facility addresses, and approve new verified wholesale suppliers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchPendingSuppliers}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 hover:text-emerald-700 hover:bg-gray-50 border border-gray-200 text-xs font-bold rounded-xl shadow-sm transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Queue
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mb-3" />
          <p className="text-sm text-gray-500 font-medium">Loading pending applications queue...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center max-w-md mx-auto">
          <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-rose-900">{error}</p>
          <button
            onClick={fetchPendingSuppliers}
            className="mt-4 px-4 py-2 bg-rose-600 text-white font-bold text-xs rounded-xl"
          >
            Retry
          </button>
        </div>
      ) : pendingList.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-3xl border border-gray-200/80 shadow-sm">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BadgeCheck className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-gray-900">All Applications Processed</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mt-1 mb-6">
            There are currently no supplier applications pending review. When a buyer submits a supplier application, it will appear here for verification.
          </p>
          <Link
            to="/supplier/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition"
          >
            View Active Suppliers & Pools
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
            <span>{pendingList.length} Supplier Applications Awaiting Review</span>
            <span>Affirmative Mandi Audit</span>
          </div>

          {pendingList.map((app) => {
            const isProcessing = actionLoadingId === app.supplier_id;

            return (
              <div
                key={app.id}
                className="bg-white rounded-3xl border border-gray-200/80 shadow-sm p-6 sm:p-8 hover:border-emerald-300 transition space-y-6"
              >
                {/* Top Bar: Business & Status */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-extrabold text-gray-900">
                        {app.business_name || 'Wholesale Business'}
                      </h2>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                        <Clock className="w-3 h-3 text-amber-600" />
                        Pending Review
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                      <User className="w-3.5 h-3.5 text-gray-400" />
                      <span>Applicant: <strong className="text-gray-800">{app.full_name}</strong></span>
                      <span>•</span>
                      <span>User ID: #{app.supplier_id}</span>
                      <span>•</span>
                      <span>Applied: {new Date(app.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </div>

                  <span className="font-mono text-xs font-semibold bg-gray-100 px-2.5 py-1 rounded-md text-gray-700 self-start sm:self-auto">
                    {app.verification_level || 'LEVEL_1_CONTACT'}
                  </span>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-1.5 font-bold text-gray-700 mb-1">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                      Mandi / District Zone
                    </div>
                    <span className="text-gray-900 font-semibold block">{app.area || 'Lahore'}</span>
                    <span className="text-gray-500 text-[11px] mt-0.5 block">{app.city || 'Lahore'}</span>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-1.5 font-bold text-gray-700 mb-1">
                      <Mail className="w-3.5 h-3.5 text-emerald-600" />
                      Contact Coordinates
                    </div>
                    <span className="text-gray-900 font-semibold block truncate" title={app.email}>
                      {app.email}
                    </span>
                    <span className="text-gray-600 font-mono text-[11px] mt-0.5 block flex items-center gap-1">
                      <Phone className="w-3 h-3 text-gray-400" />
                      {app.phone || 'N/A'}
                    </span>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-1.5 font-bold text-gray-700 mb-1">
                      <FileText className="w-3.5 h-3.5 text-emerald-600" />
                      FBR Tax NTN
                    </div>
                    <span className="text-gray-900 font-semibold font-mono block">
                      {app.tax_ntn || 'Not Provided (General Wholesaler)'}
                    </span>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-1.5 font-bold text-gray-700 mb-1">
                      <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" />
                      PFA Food License
                    </div>
                    <span className="text-gray-900 font-semibold font-mono block">
                      {app.food_license_no || 'Not Provided'}
                    </span>
                  </div>
                </div>

                {/* Warehouse Physical Address */}
                <div className="p-4 bg-gray-50/70 rounded-2xl border border-gray-100 text-xs">
                  <span className="font-bold text-gray-700 block mb-1">
                    Inspected Warehouse / Mill Physical Address:
                  </span>
                  <p className="text-gray-900 font-medium">
                    {app.address || 'Address provided during phone verification.'}
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <span className="text-gray-500 text-[11px]">
                    * Approving promotes this account from BUYER to SUPPLIER and unlocks pool publishing.
                  </span>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleVerify(app.supplier_id, app.business_name, false)}
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 font-bold rounded-xl border border-rose-200 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleVerify(app.supplier_id, app.business_name, true)}
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-extrabold rounded-xl shadow-sm shadow-emerald-200 transition"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Approve & Verify Supplier
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminSuppliersPage;

